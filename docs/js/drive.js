/**
 * MathPad Drive - Google Drive integration for cloud persistence
 *
 * Provides save/load to Google Drive so records persist across sessions and devices.
 * Uses Google Identity Services (GIS) for auth and raw fetch() for Drive API.
 * Falls back gracefully if Google scripts fail to load (ad blocker, offline).
 */

// ---- Configuration ----
// TODO: Replace with your own credentials from Google Cloud Console
const DRIVE_CLIENT_ID = '274176068779-rjoi1liel0smr65d58ji03tjumla8us6.apps.googleusercontent.com';
const DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file email';

// ---- State ----
const DriveState = {
    tokenClient: null,
    accessToken: null,
    tokenExpiry: 0,
    userEmail: null,
    fileId: null,
    fileName: null,
    lastModifiedTime: null,
    lastModifiedBy: null,
    driveDirty: false,
    saveInProgress: false,
    syncInProgress: false,
    syncTimer: null,
    lastSyncTime: 0,
    statusInterval: null,
    ready: false
};

const SYNC_INTERVAL_MS = 60000;   // 60 seconds between sync cycles
const MIN_SYNC_GAP_MS = 60000;    // Minimum gap between syncs

// ---- localStorage keys for Drive state ----
const DRIVE_KEYS = {
    email: 'mathpad_drive_email',
    fileId: 'mathpad_drive_fileId',
    fileName: 'mathpad_drive_fileName',
    modifiedTime: 'mathpad_drive_modifiedTime',
    dirty: 'mathpad_drive_dirty'
};

// ---- Init ----

/**
 * Initialize Drive module. Waits for GIS library to load.
 * @returns {Promise<boolean>} true if GIS loaded successfully
 */
function initDriveModule() {
    return new Promise((resolve) => {
        // Check if GIS already loaded
        if (window.google && window.google.accounts) {
            initTokenClient();
            restoreDriveState();
            DriveState.ready = true;
            resolve(true);
            return;
        }
        // Wait up to 10 seconds for async script
        let elapsed = 0;
        const interval = setInterval(() => {
            elapsed += 200;
            if (window.google && window.google.accounts) {
                clearInterval(interval);
                initTokenClient();
                restoreDriveState();
                DriveState.ready = true;
                resolve(true);
            } else if (elapsed >= 10000) {
                clearInterval(interval);
                console.log('Google Identity Services not available');
                resolve(false);
            }
        }, 200);
    });
}

function initTokenClient() {
    DriveState.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: DRIVE_CLIENT_ID,
        scope: DRIVE_SCOPES,
        callback: '' // Set dynamically
    });
}

function restoreDriveState() {
    DriveState.userEmail = localStorage.getItem(DRIVE_KEYS.email);
    DriveState.fileId = localStorage.getItem(DRIVE_KEYS.fileId);
    DriveState.fileName = localStorage.getItem(DRIVE_KEYS.fileName);
    DriveState.lastModifiedTime = localStorage.getItem(DRIVE_KEYS.modifiedTime);
    DriveState.driveDirty = localStorage.getItem(DRIVE_KEYS.dirty) === '1';
}

function saveDriveState() {
    const set = (k, v) => v ? localStorage.setItem(k, v) : localStorage.removeItem(k);
    set(DRIVE_KEYS.email, DriveState.userEmail);
    set(DRIVE_KEYS.fileId, DriveState.fileId);
    set(DRIVE_KEYS.fileName, DriveState.fileName);
    set(DRIVE_KEYS.modifiedTime, DriveState.lastModifiedTime);
    set(DRIVE_KEYS.dirty, DriveState.driveDirty ? '1' : null);
}

// ---- Auth ----

// In-flight token request promise (prevents concurrent popups)
let _tokenPromise = null;

/**
 * Request an access token (one popup at most).
 * Uses stored email as hint to auto-select account when possible.
 * @param {string} [prompt] - GIS prompt value: '' (auto), 'consent', 'select_account'
 * @returns {Promise<boolean>}
 */
function driveSignIn(prompt) {
    if (_tokenPromise) return _tokenPromise;

    _tokenPromise = new Promise((resolve) => {
        if (!DriveState.tokenClient) {
            _tokenPromise = null;
            resolve(false);
            return;
        }
        DriveState.tokenClient.callback = (resp) => {
            _tokenPromise = null;
            if (resp.error) {
                console.error('Drive auth error:', resp.error);
                resolve(false);
                return;
            }
            DriveState.accessToken = resp.access_token;
            DriveState.tokenExpiry = Date.now() + (resp.expires_in * 1000);
            fetchUserEmail().then(() => {
                saveDriveState();
                resolve(true);
            }).catch(() => {
                saveDriveState();
                resolve(true);
            });
        };
        DriveState.tokenClient.requestAccessToken({
            prompt: prompt || '',
            hint: DriveState.userEmail || ''
        });
    });

    return _tokenPromise;
}

/**
 * Sign out and clear Drive state.
 */
function driveSignOut() {
    if (DriveState.driveDirty) {
        flushDriveSync();
    }
    if (DriveState.accessToken) {
        google.accounts.oauth2.revoke(DriveState.accessToken);
    }
    DriveState.accessToken = null;
    DriveState.tokenExpiry = 0;
    DriveState.userEmail = null;
    DriveState.fileId = null;
    DriveState.fileName = null;
    DriveState.lastModifiedTime = null;
    DriveState.lastModifiedBy = null;
    clearDriveDirty();
    stopDriveSync();
    // Clear localStorage
    Object.values(DRIVE_KEYS).forEach(k => localStorage.removeItem(k));
}

/**
 * Check if user has an active token.
 */
function isDriveAuthenticated() {
    return !!DriveState.accessToken;
}

/**
 * Check if user was previously signed in (remembered from localStorage).
 * Returns false until Drive module is initialized, preventing premature
 * markDriveDirty calls from storage.js before we're ready.
 */
function isDriveSignedIn() {
    if (!DriveState.ready) return false;
    return !!DriveState.accessToken || !!DriveState.userEmail;
}

function getDriveUserEmail() {
    return DriveState.userEmail;
}

/**
 * Ensure we have a valid token, requesting one if needed.
 * At most one popup per session (auto-selects account if possible).
 * @returns {Promise<boolean>}
 */
async function ensureToken() {
    if (DriveState.accessToken && Date.now() < DriveState.tokenExpiry - 60000) {
        return true;
    }
    if (!DriveState.userEmail) return false;
    return await driveSignIn();
}

async function fetchUserEmail() {
    try {
        const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': 'Bearer ' + DriveState.accessToken }
        });
        if (resp.ok) {
            const info = await resp.json();
            DriveState.userEmail = info.email;
            saveDriveState();
        }
    } catch (e) {
        console.error('Failed to fetch user email:', e);
    }
}

// ---- File Operations ----

/**
 * Save data to Drive. Creates file if no fileId, updates otherwise.
 * @param {object} data - The MathPad data object
 * @returns {Promise<boolean>}
 */
async function driveSaveFile(data) {
    if (!(await ensureToken())) return false;

    const fileName = DriveState.fileName || 'MathPad.mathpad.json';
    const content = JSON.stringify(data);
    const metadata = {
        name: fileName,
        mimeType: 'application/json'
    };

    try {
        let resp;
        if (DriveState.fileId) {
            // Update existing file (multipart PATCH)
            resp = await driveMultipartRequest(
                `https://www.googleapis.com/upload/drive/v3/files/${DriveState.fileId}?uploadType=multipart&fields=id,name,modifiedTime,lastModifyingUser`,
                'PATCH', metadata, content
            );
        } else {
            // Create new file (multipart POST)
            resp = await driveMultipartRequest(
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,lastModifyingUser',
                'POST', metadata, content
            );
        }

        if (resp.status === 401) {
            // Token expired, retry once
            DriveState.accessToken = null;
            if (await ensureToken()) {
                return await driveSaveFile(data);
            }
            return false;
        }

        if (resp.status === 404 && DriveState.fileId) {
            // File deleted externally, create new
            DriveState.fileId = null;
            saveDriveState();
            return await driveSaveFile(data);
        }

        if (!resp.ok) {
            console.error('Drive save failed:', resp.status, await resp.text());
            return false;
        }

        const result = await resp.json();
        DriveState.fileId = result.id;
        DriveState.fileName = result.name;
        DriveState.lastModifiedTime = result.modifiedTime;
        DriveState.lastModifiedBy = result.lastModifyingUser?.emailAddress || DriveState.userEmail;
        saveDriveState();
        return true;
    } catch (e) {
        console.error('Drive save error:', e);
        return false;
    }
}

/**
 * Build a multipart request for Drive API.
 */
async function driveMultipartRequest(url, method, metadata, content) {
    const boundary = 'mathpad_boundary_' + Date.now();
    const body = [
        '--' + boundary,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        '--' + boundary,
        'Content-Type: application/json',
        '',
        content,
        '--' + boundary + '--'
    ].join('\r\n');

    return await fetch(url, {
        method,
        headers: {
            'Authorization': 'Bearer ' + DriveState.accessToken,
            'Content-Type': 'multipart/related; boundary=' + boundary
        },
        body
    });
}

/**
 * Load file content from Drive.
 * @param {string} fileId
 * @returns {Promise<object|null>} parsed data or null
 */
async function driveLoadFile(fileId) {
    if (!(await ensureToken())) return null;

    try {
        // Fetch content
        const resp = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            { headers: { 'Authorization': 'Bearer ' + DriveState.accessToken } }
        );
        if (!resp.ok) {
            console.error('Drive load failed:', resp.status);
            return null;
        }
        const data = await resp.json();

        // Fetch metadata for modifiedTime
        const meta = await driveGetMetadata(fileId);
        if (meta) {
            DriveState.lastModifiedTime = meta.modifiedTime;
            DriveState.lastModifiedBy = meta.lastModifyingUser;
            saveDriveState();
        }

        return data;
    } catch (e) {
        console.error('Drive load error:', e);
        return null;
    }
}

/**
 * Get file metadata (lightweight, no content).
 * @param {string} fileId
 * @returns {Promise<{modifiedTime: string, lastModifyingUser: string}|null>}
 */
async function driveGetMetadata(fileId) {
    if (!(await ensureToken())) return null;

    try {
        const resp = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime,lastModifyingUser`,
            { headers: { 'Authorization': 'Bearer ' + DriveState.accessToken } }
        );
        if (!resp.ok) return null;
        const meta = await resp.json();
        return {
            modifiedTime: meta.modifiedTime,
            lastModifyingUser: meta.lastModifyingUser?.emailAddress || null
        };
    } catch (e) {
        console.error('Drive metadata error:', e);
        return null;
    }
}

// ---- Sync ----

function clearDriveDirty() {
    DriveState.driveDirty = false;
    saveDriveState();
}

/**
 * Mark data as needing Drive sync. Triggers immediate sync if enough time has passed.
 */
function markDriveDirty() {
    DriveState.driveDirty = true;
    saveDriveState();
    updateDriveStatus();
    // If enough time since last sync, trigger immediate sync
    if (Date.now() - DriveState.lastSyncTime >= MIN_SYNC_GAP_MS) {
        runSyncCycle();
    }
}

/**
 * Start periodic sync timer.
 */
function startDriveSync() {
    stopDriveSync();
    DriveState.syncTimer = setInterval(runSyncCycle, SYNC_INTERVAL_MS);
    DriveState.statusInterval = setInterval(updateDriveStatus, 10000);
}

/**
 * Stop periodic sync timer.
 */
function stopDriveSync() {
    if (DriveState.syncTimer) {
        clearInterval(DriveState.syncTimer);
        DriveState.syncTimer = null;
    }
    if (DriveState.statusInterval) {
        clearInterval(DriveState.statusInterval);
        DriveState.statusInterval = null;
    }
}

/**
 * Run one sync cycle:
 * 1. Check Drive metadata for newer data
 * 2. If newer, prompt user to load
 * 3. If not newer and dirty, push local data
 */
async function runSyncCycle() {
    if (!isDriveAuthenticated()) return;
    if (DriveState.syncInProgress) return;

    DriveState.syncInProgress = true;
    DriveState.lastSyncTime = Date.now();

    try {
        // If no file yet, create one on first dirty
        if (!DriveState.fileId) {
            if (DriveState.driveDirty && typeof UI !== 'undefined' && UI.data) {
                updateDriveStatus('Saving...');
                const ok = await driveSaveFile(UI.data);
                if (ok) {
                    clearDriveDirty();
                    updateDriveStatus();
                }
            }
            return;
        }

        // Check remote metadata
        const meta = await driveGetMetadata(DriveState.fileId);
        if (!meta) return; // Network error, try next cycle

        const remoteTime = new Date(meta.modifiedTime).getTime();
        const localTime = DriveState.lastModifiedTime ? new Date(DriveState.lastModifiedTime).getTime() : 0;

        if (remoteTime > localTime + 1000) {
            // Drive has newer data — prompt user
            const ago = formatTimeAgo(meta.modifiedTime);
            const who = meta.lastModifyingUser || 'unknown';
            const load = confirm(
                `Drive has newer data (modified ${ago} by ${who}).\n\nLoad from Drive?`
            );
            if (load) {
                updateDriveStatus('Loading...');
                const data = await driveLoadFile(DriveState.fileId);
                if (data && typeof reloadUIWithData === 'function') {
                    reloadUIWithData(data);
                    clearDriveDirty();
                    updateDriveStatus();
                }
            } else {
                // User declined — keep local, it will overwrite Drive on next sync.
                // Update lastModifiedTime so next cycle doesn't re-prompt.
                DriveState.lastModifiedTime = meta.modifiedTime;
                saveDriveState();
                DriveState.driveDirty = true;
            }
        } else if (DriveState.driveDirty && typeof UI !== 'undefined' && UI.data) {
            // Push local data to Drive
            updateDriveStatus('Saving...');
            const ok = await driveSaveFile(UI.data);
            if (ok) {
                clearDriveDirty();
            }
            updateDriveStatus();
        }
    } finally {
        DriveState.syncInProgress = false;
    }
}

/**
 * Immediate save if dirty (for beforeunload/solve). Skips conflict check.
 */
async function flushDriveSync() {
    if (!isDriveAuthenticated() || !DriveState.driveDirty) return;
    if (typeof UI !== 'undefined' && UI.data) {
        DriveState.saveInProgress = true;
        await driveSaveFile(UI.data);
        DriveState.saveInProgress = false;
        clearDriveDirty();
    }
}

// ---- File Listing (replaces Picker — no API key needed) ----

/**
 * List .mathpad.json files in the user's Drive.
 * @returns {Promise<Array<{id: string, name: string, modifiedTime: string}>|null>}
 */
async function driveListFiles() {
    if (!(await ensureToken())) return null;

    try {
        const query = encodeURIComponent("trashed = false");
        const fields = encodeURIComponent('files(id,name,modifiedTime)');
        const resp = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=modifiedTime desc&pageSize=20`,
            { headers: { 'Authorization': 'Bearer ' + DriveState.accessToken } }
        );
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.files || [];
    } catch (e) {
        console.error('Drive list files error:', e);
        return null;
    }
}

/**
 * Show a simple file chooser dialog using Drive API file listing.
 * @returns {Promise<{id: string, name: string}|null>}
 */
async function openDriveFileChooser() {
    const files = await driveListFiles();
    if (!files) {
        alert('Could not list Drive files.');
        return null;
    }
    if (files.length === 0) {
        alert('No .mathpad.json files found in your Drive.');
        return null;
    }

    // Build a numbered list for prompt
    const lines = files.map((f, i) =>
        `${i + 1}. ${f.name} (${formatTimeAgo(f.modifiedTime)})`
    );
    const choice = prompt(
        'Open MathPad file from Drive:\n\n' + lines.join('\n') + '\n\nEnter number:'
    );
    if (!choice) return null;
    const idx = parseInt(choice, 10) - 1;
    if (idx < 0 || idx >= files.length || isNaN(idx)) return null;
    return { id: files[idx].id, name: files[idx].name };
}

// ---- Status Helpers ----

/**
 * Get Drive last save info for status display.
 * @returns {{ago: string, email: string}|null}
 */
function getDriveLastSaveInfo() {
    if (!DriveState.lastModifiedTime) return null;
    return {
        ago: formatTimeAgo(DriveState.lastModifiedTime),
        email: DriveState.lastModifiedBy || DriveState.userEmail || ''
    };
}

function formatTimeAgo(isoDate) {
    const diff = Date.now() - new Date(isoDate).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return seconds + 's ago';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    return days + 'd ago';
}

// ---- UI Helpers ----

/**
 * Show the Drive controls container.
 */
function showDriveControls() {
    const el = document.getElementById('drive-controls');
    if (el) el.style.display = 'flex';
}

/**
 * Update Drive UI: toggle sign-in button vs avatar button.
 */
function updateDriveUI() {
    const signInBtn = document.getElementById('btn-drive-signin');
    const avatarBtn = document.getElementById('btn-drive-menu');

    if (isDriveSignedIn()) {
        if (signInBtn) signInBtn.style.display = 'none';
        if (avatarBtn) {
            avatarBtn.style.display = 'flex';
            const initial = (DriveState.userEmail || '?')[0].toUpperCase();
            avatarBtn.textContent = initial;
            avatarBtn.title = DriveState.userEmail || 'Google Drive';
        }
    } else {
        if (signInBtn) signInBtn.style.display = '';
        if (avatarBtn) avatarBtn.style.display = 'none';
    }

    updateDriveStatus();
}

/**
 * Update the Drive status in the right side of the status bar.
 * @param {string} [override] - Optional override message (e.g. "Saving...")
 */
function updateDriveStatus(override) {
    const el = document.getElementById('status-drive');
    if (!el) return;

    if (!isDriveSignedIn()) {
        el.textContent = '';
        return;
    }

    if (override) {
        el.textContent = override;
        return;
    }

    const dirty = DriveState.driveDirty ? ' \u2022' : '';
    const info = getDriveLastSaveInfo();
    if (info) {
        el.textContent = `Saved ${info.ago}${dirty} | ${info.email}`;
    } else if (!isDriveAuthenticated()) {
        const initial = (DriveState.userEmail || '?')[0].toUpperCase();
        el.textContent = `Click ${initial} to sync with Drive`;
    } else {
        el.textContent = (DriveState.userEmail || '') + dirty;
    }
}

/**
 * Handle opening a file from Drive picker.
 */
async function handleDriveOpen() {
    // Flush any pending changes to current file before switching
    if (DriveState.driveDirty && DriveState.fileId && typeof UI !== 'undefined' && UI.data) {
        updateDriveStatus('Saving...');
        await driveSaveFile(UI.data);
        clearDriveDirty();
    }

    const picked = await openDriveFileChooser();
    if (!picked) return;

    updateDriveStatus('Loading...');
    const data = await driveLoadFile(picked.id);
    if (data && typeof reloadUIWithData === 'function') {
        DriveState.fileId = picked.id;
        DriveState.fileName = picked.name;
        saveDriveState();
        reloadUIWithData(data);
        clearDriveDirty();
        updateDriveStatus();
        const count = data.records ? data.records.length : 0;
        if (typeof setStatus === 'function') {
            setStatus(`Loaded ${count} record${count !== 1 ? 's' : ''} from Drive`);
        }
    } else {
        updateDriveStatus();
        if (typeof setStatus === 'function') {
            setStatus('Failed to load from Drive', true, false);
        }
    }
}

/**
 * Handle saving as a new file on Drive.
 */
async function handleDriveSaveAs() {
    const name = prompt('File name:', DriveState.fileName || 'MathPad.mathpad.json');
    if (!name) return;

    DriveState.fileId = null; // Force create new
    DriveState.fileName = name;

    if (typeof UI !== 'undefined' && UI.data) {
        updateDriveStatus('Saving...');
        const ok = await driveSaveFile(UI.data);
        if (ok) {
            clearDriveDirty();
            updateDriveStatus();
            if (typeof setStatus === 'function') {
                setStatus('Saved to Drive as ' + name, false, false);
            }
        } else {
            updateDriveStatus();
            if (typeof setStatus === 'function') {
                setStatus('Failed to save to Drive', true, false);
            }
        }
    }
}

/**
 * Handle sign out from Drive.
 */
function handleDriveSignOut() {
    driveSignOut();
    updateDriveUI();
    closeDriveDropdown();
}

/**
 * Toggle Drive dropdown menu.
 */
function toggleDriveDropdown() {
    const dropdown = document.getElementById('drive-dropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('visible');

    // Update file info in dropdown
    const fileEl = document.getElementById('drive-dropdown-file');
    if (fileEl) {
        if (DriveState.fileName) {
            fileEl.textContent = DriveState.fileName;
            fileEl.style.display = '';
        } else {
            fileEl.style.display = 'none';
        }
    }
}

function closeDriveDropdown() {
    const dropdown = document.getElementById('drive-dropdown');
    if (dropdown) dropdown.classList.remove('visible');
}

// Export to global scope
window.initDriveModule = initDriveModule;
window.driveSignIn = driveSignIn;
window.driveSignOut = driveSignOut;
window.isDriveSignedIn = isDriveSignedIn;
window.isDriveAuthenticated = isDriveAuthenticated;
window.getDriveUserEmail = getDriveUserEmail;
window.markDriveDirty = markDriveDirty;
window.startDriveSync = startDriveSync;
window.stopDriveSync = stopDriveSync;
window.runSyncCycle = runSyncCycle;
window.flushDriveSync = flushDriveSync;
window.showDriveControls = showDriveControls;
window.updateDriveUI = updateDriveUI;
window.updateDriveStatus = updateDriveStatus;
window.handleDriveOpen = handleDriveOpen;
window.handleDriveSaveAs = handleDriveSaveAs;
window.handleDriveSignOut = handleDriveSignOut;
window.toggleDriveDropdown = toggleDriveDropdown;
window.closeDriveDropdown = closeDriveDropdown;
window.DriveState = DriveState;
