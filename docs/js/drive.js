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
    lastChecksum: null,
    folderId: null,             // ID of "MathPad" folder on Drive
    declinedRemoteTime: null,   // Remote modifiedTime we already prompted about (prevents re-prompt)
    silentRenewalFailed: false,
    driveDirty: false,
    syncInProgress: false,
    syncTimer: null,
    statusInterval: null,
    ready: false
};

const SYNC_INTERVAL_MS = 15000;   // 15 seconds between sync cycles

// ---- localStorage keys for Drive state ----
const DRIVE_KEYS = {
    email: 'mathpad_drive_email',
    fileId: 'mathpad_drive_fileId',
    fileName: 'mathpad_drive_fileName',
    modifiedTime: 'mathpad_drive_modifiedTime',
    checksum: 'mathpad_drive_checksum',
    lastModifiedBy: 'mathpad_drive_lastModifiedBy',
    folderId: 'mathpad_drive_folderId',
    dirty: 'mathpad_drive_dirty',
    accessToken: 'mathpad_drive_token',
    tokenExpiry: 'mathpad_drive_tokenExpiry'
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
    DriveState.lastChecksum = localStorage.getItem(DRIVE_KEYS.checksum);
    DriveState.lastModifiedBy = localStorage.getItem(DRIVE_KEYS.lastModifiedBy);
    DriveState.folderId = localStorage.getItem(DRIVE_KEYS.folderId);
    DriveState.driveDirty = localStorage.getItem(DRIVE_KEYS.dirty) === '1';
    DriveState.accessToken = localStorage.getItem(DRIVE_KEYS.accessToken);
    const expiry = localStorage.getItem(DRIVE_KEYS.tokenExpiry);
    DriveState.tokenExpiry = expiry ? Number(expiry) : 0;
    if (DriveState.accessToken && DriveState.tokenExpiry) {
        console.log('Drive token restored, expires', new Date(DriveState.tokenExpiry).toLocaleTimeString());
    }
}

function saveDriveState() {
    const set = (k, v) => v ? localStorage.setItem(k, v) : localStorage.removeItem(k);
    set(DRIVE_KEYS.email, DriveState.userEmail);
    // Only write fileId/fileName when set — never remove (only driveSignOut clears them)
    if (DriveState.fileId) localStorage.setItem(DRIVE_KEYS.fileId, DriveState.fileId);
    if (DriveState.fileName) localStorage.setItem(DRIVE_KEYS.fileName, DriveState.fileName);
    if (DriveState.folderId) localStorage.setItem(DRIVE_KEYS.folderId, DriveState.folderId);
    set(DRIVE_KEYS.checksum, DriveState.lastChecksum);
    set(DRIVE_KEYS.lastModifiedBy, DriveState.lastModifiedBy);
    set(DRIVE_KEYS.modifiedTime, DriveState.lastModifiedTime);
    set(DRIVE_KEYS.dirty, DriveState.driveDirty ? '1' : null);
    set(DRIVE_KEYS.accessToken, DriveState.accessToken);
    set(DRIVE_KEYS.tokenExpiry, DriveState.tokenExpiry ? String(DriveState.tokenExpiry) : null);
}

// ---- Auth ----

// In-flight token request promise (prevents concurrent popups)
let _tokenPromise = null;

/**
 * Request an access token (one popup at most).
 * Uses stored email as hint to auto-select account when possible.
 * @param {string} [promptMode] - GIS prompt value: '' (auto), 'consent', 'select_account'
 * @returns {Promise<boolean>}
 */
function driveSignIn(promptMode) {
    if (_tokenPromise) return _tokenPromise;

    _tokenPromise = new Promise((resolve) => {
        if (!DriveState.tokenClient) {
            _tokenPromise = null;
            resolve(false);
            return;
        }
        // Timeout: if GIS blocks the popup, the callback never fires.
        // 120 seconds allows time for account picker / consent screens.
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                _tokenPromise = null;
                resolve(false);
            }
        }, 120000);

        DriveState.tokenClient.callback = (resp) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            _tokenPromise = null;
            if (resp.error) {
                console.error('Drive auth error:', resp.error);
                resolve(false);
                return;
            }
            DriveState.accessToken = resp.access_token;
            DriveState.tokenExpiry = Date.now() + (resp.expires_in * 1000);
            console.log('Drive token obtained at', new Date().toLocaleTimeString(), 'expires', new Date(DriveState.tokenExpiry).toLocaleTimeString());
            DriveState.silentRenewalFailed = false;
            fetchUserEmail().then(() => {
                saveDriveState();
                resolve(true);
            }).catch(() => {
                saveDriveState();
                resolve(true);
            });
        };
        DriveState.tokenClient.requestAccessToken({
            prompt: promptMode || '',
            hint: DriveState.userEmail || ''
        });
    });

    return _tokenPromise;
}

/**
 * Sign out and clear Drive state.
 */
async function driveSignOut() {
    stopDriveSync();
    if (DriveState.driveDirty) {
        await flushDriveSync();
        if (DriveState.driveDirty) {
            // Flush failed — warn user
            if (!confirm('Failed to save changes to Drive. Sign out anyway?')) {
                startDriveSync();
                return;
            }
        }
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
    DriveState.declinedRemoteTime = null;
    DriveState.silentRenewalFailed = false;
    clearDriveDirty();
    clearDriveStatusFlash();
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
    // Token expired or missing — clear it so isDriveAuthenticated() returns false
    console.log('Token expired at', new Date().toLocaleTimeString(), 'expiry was', DriveState.tokenExpiry ? new Date(DriveState.tokenExpiry).toLocaleTimeString() : 'none');
    DriveState.accessToken = null;
    DriveState.tokenExpiry = 0;
    saveDriveState();
    // Try silent renewal once — if it fails, user must click avatar
    if (DriveState.silentRenewalFailed || !DriveState.userEmail) return false;
    const ok = await driveSignIn('');
    if (!ok) {
        console.log('Silent token renewal failed at', new Date().toLocaleTimeString());
        DriveState.silentRenewalFailed = true;
    }
    return ok;
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

// ---- Folder ----

const MATHPAD_FOLDER_NAME = 'MathPad';

/**
 * Find or create the "MathPad" folder in the user's Drive root.
 * Caches the folder ID in DriveState and localStorage.
 * @returns {Promise<string|null>} folder ID, or null on failure
 */
async function ensureMathPadFolder() {
    if (DriveState.folderId) {
        // Verify folder still exists
        try {
            const resp = await fetch(
                `https://www.googleapis.com/drive/v3/files/${DriveState.folderId}?fields=id,trashed`,
                { headers: { 'Authorization': 'Bearer ' + DriveState.accessToken } }
            );
            if (resp.ok) {
                const meta = await resp.json();
                if (!meta.trashed) return DriveState.folderId;
                // Folder trashed — clear and recreate
            } else if (resp.status !== 404) {
                // Transient error (403, 500, etc.) — keep cached ID, try again later
                return DriveState.folderId;
            }
        } catch (e) {
            // Network error — keep cached ID, try again later
            return DriveState.folderId;
        }
        DriveState.folderId = null;
        localStorage.removeItem(DRIVE_KEYS.folderId);
    }

    // Search for existing folder
    try {
        const q = encodeURIComponent(
            `name = '${MATHPAD_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`
        );
        const resp = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`,
            { headers: { 'Authorization': 'Bearer ' + DriveState.accessToken } }
        );
        if (resp.ok) {
            const data = await resp.json();
            if (data.files && data.files.length > 0) {
                DriveState.folderId = data.files[0].id;
                saveDriveState();
                return DriveState.folderId;
            }
        }
    } catch (e) {
        console.error('Drive folder search error:', e);
        return null;
    }

    // Create folder
    try {
        const resp = await fetch(
            'https://www.googleapis.com/drive/v3/files?fields=id',
            {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + DriveState.accessToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: MATHPAD_FOLDER_NAME,
                    mimeType: 'application/vnd.google-apps.folder',
                    parents: ['root']
                })
            }
        );
        if (resp.ok) {
            const data = await resp.json();
            DriveState.folderId = data.id;
            saveDriveState();
            return DriveState.folderId;
        }
    } catch (e) {
        console.error('Drive folder create error:', e);
    }
    return null;
}

// ---- File Operations ----

/**
 * Save data to Drive. Creates file if no fileId, updates otherwise.
 * @param {object} data - The MathPad data object
 * @returns {Promise<boolean>}
 */
async function driveSaveFile(data, overrideName, forceNew) {
    if (!(await ensureToken())) return false;

    const fileName = overrideName || DriveState.fileName || 'MathPad.mathpad.json';
    const content = JSON.stringify(data);

    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            let resp;
            if (DriveState.fileId && !forceNew) {
                // Update existing file — content only, don't overwrite name
                resp = await driveMultipartRequest(
                    `https://www.googleapis.com/upload/drive/v3/files/${DriveState.fileId}?uploadType=multipart&fields=id,name,modifiedTime,lastModifyingUser,md5Checksum`,
                    'PATCH', { mimeType: 'application/json' }, content
                );
            } else {
                // Create new file in MathPad folder
                const folderId = await ensureMathPadFolder();
                const metadata = { name: fileName, mimeType: 'application/json' };
                if (folderId) metadata.parents = [folderId];
                resp = await driveMultipartRequest(
                    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,lastModifyingUser,md5Checksum',
                    'POST', metadata, content
                );
            }

            if (resp.status === 401 && attempt === 0) {
                // Token expired — refresh and retry once
                DriveState.accessToken = null;
                if (!(await ensureToken())) return false;
                continue;
            }

            if (resp.status === 404 && DriveState.fileId && attempt === 0) {
                // File deleted externally — clear fileId, retry will create new
                DriveState.fileId = null;
                localStorage.removeItem(DRIVE_KEYS.fileId);
                continue;
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
            DriveState.lastChecksum = result.md5Checksum || null;
            DriveState.declinedRemoteTime = null;
            saveDriveState();
            return true;
        }
        return false;
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
        let resp = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            { headers: { 'Authorization': 'Bearer ' + DriveState.accessToken } }
        );
        if (resp.status === 401) {
            DriveState.accessToken = null;
            if (!(await ensureToken())) return null;
            resp = await fetch(
                `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
                { headers: { 'Authorization': 'Bearer ' + DriveState.accessToken } }
            );
        }
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
            DriveState.lastChecksum = meta.md5Checksum || null;
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
        let resp = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,modifiedTime,lastModifyingUser,md5Checksum`,
            { headers: { 'Authorization': 'Bearer ' + DriveState.accessToken } }
        );
        if (resp.status === 401) {
            DriveState.accessToken = null;
            if (!(await ensureToken())) return null;
            resp = await fetch(
                `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,modifiedTime,lastModifyingUser,md5Checksum`,
                { headers: { 'Authorization': 'Bearer ' + DriveState.accessToken } }
            );
        }
        if (!resp.ok) return null;
        const meta = await resp.json();
        return {
            name: meta.name,
            modifiedTime: meta.modifiedTime,
            lastModifyingUser: meta.lastModifyingUser?.emailAddress || null,
            md5Checksum: meta.md5Checksum || null
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
    if (!isDriveAuthenticated()) {
        // Token expired or not yet obtained — prompt user to reconnect
        if (isDriveSignedIn()) {
            updateDriveUI();
            updateDriveStatus();
        }
        return;
    }
    if (DriveState.syncInProgress) return;

    DriveState.syncInProgress = true;

    try {
        // If no file yet, create one on first dirty
        if (!DriveState.fileId) {
            if (DriveState.driveDirty && UI.data) {
                const ok = await driveSaveFile(UI.data);
                if (ok) {
                    clearDriveDirty();
                    updateDriveStatus(savedDriveStatus());
                } else {
                    updateDriveStatus('Sync error •');
                }
            }
            return;
        }

        // Check remote metadata
        const meta = await driveGetMetadata(DriveState.fileId);
        if (!meta) return; // Network error, try next cycle

        // Sync file name if renamed on Drive
        if (meta.name && meta.name !== DriveState.fileName) {
            DriveState.fileName = meta.name;
            saveDriveState();
        }

        // Detect remote content change: prefer checksum, fall back to modifiedTime
        const remoteTime = new Date(meta.modifiedTime).getTime();
        const localTime = DriveState.lastModifiedTime ? new Date(DriveState.lastModifiedTime).getTime() : 0;
        const declinedTime = DriveState.declinedRemoteTime ? new Date(DriveState.declinedRemoteTime).getTime() : 0;
        const knownTime = Math.max(localTime, declinedTime);
        const contentChanged = (meta.md5Checksum && DriveState.lastChecksum)
            ? meta.md5Checksum !== DriveState.lastChecksum
            : remoteTime > knownTime + 1000;

        if (contentChanged) {
            // Drive has newer data — prompt user
            const ago = formatTimeAgo(meta.modifiedTime);
            const who = meta.lastModifyingUser || 'unknown';
            const load = confirm(
                `Drive has newer data (modified ${ago} by ${who}).\n\nLoad from Drive?`
            );
            if (load) {
                updateDriveStatus('Loading...');
                const data = await driveLoadFile(DriveState.fileId);
                if (data) {
                    applyDriveData(data);
                } else {
                    updateDriveStatus('Load failed');
                }
            } else {
                // User declined — keep local, it will overwrite Drive on next sync.
                // Track declined values so we don't re-prompt for the same remote change.
                DriveState.declinedRemoteTime = meta.modifiedTime;
                DriveState.lastChecksum = meta.md5Checksum || DriveState.lastChecksum;
                DriveState.driveDirty = true;
                saveDriveState();
            }
        } else if (DriveState.driveDirty && UI.data) {
            // Push local data to Drive
            const ok = await driveSaveFile(UI.data);
            if (ok) {
                clearDriveDirty();
                updateDriveStatus(savedDriveStatus());
            } else {
                updateDriveStatus('Sync error •');
            }
        }
    } finally {
        DriveState.syncInProgress = false;
    }
}

/**
 * Immediate save if dirty (for beforeunload/solve). Skips conflict check.
 */
async function flushDriveSync() {
    if (!isDriveAuthenticated() || !DriveState.driveDirty || DriveState.syncInProgress) return;
    if (UI.data) {
        if (await driveSaveFile(UI.data)) {
            clearDriveDirty();
        }
    }
}

// ---- File Listing (replaces Picker — no API key needed) ----

/**
 * List .mathpad.json files in the MathPad folder (falls back to all Drive files).
 * @returns {Promise<Array<{id: string, name: string, modifiedTime: string}>|null>}
 */
async function driveListFiles() {
    if (!(await ensureToken())) return null;

    try {
        const folderId = await ensureMathPadFolder();
        const q = folderId
            ? `'${folderId}' in parents and trashed = false`
            : 'trashed = false';
        const query = encodeURIComponent(q);
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
            avatarBtn.classList.toggle('inactive', !isDriveAuthenticated());
        }
    } else {
        if (signInBtn) signInBtn.style.display = '';
        if (avatarBtn) avatarBtn.style.display = 'none';
    }

    updateDriveStatus();
}

/**
 * Update the Drive status in the right side of the status bar.
 * On small screens where #status-drive is hidden, briefly flash the
 * drive status in the main status text area for 2 seconds.
 * @param {string} [override] - Optional override message (e.g. "Saving...")
 */
let _driveStatusTimer = null;

function updateDriveStatus(override) {
    const el = document.getElementById('status-drive');
    if (!el) return;

    if (!isDriveSignedIn()) {
        el.textContent = '';
        return;
    }

    let text;
    let flash = !!override;
    if (override) {
        text = override;
    } else {
        const dirty = DriveState.driveDirty ? ' \u2022' : '';
        if (isDriveSignedIn() && !isDriveAuthenticated()) {
            const initial = (DriveState.userEmail || '?')[0].toUpperCase();
            text = `Click ${initial} to sync${dirty} | ${DriveState.userEmail}`;
            flash = true;
        } else {
            const info = getDriveLastSaveInfo();
            if (info) {
                text = `Saved ${info.ago}${dirty} | ${info.email}`;
            } else {
                text = (DriveState.userEmail || '') + dirty;
            }
        }
    }

    el.textContent = text;

    // On small screens where status-drive is hidden, flash important messages
    if (flash && text && getComputedStyle(el).display === 'none') {
        const statusText = document.getElementById('status-text');
        if (statusText) {
            clearDriveStatusFlash();
            statusText.textContent = text;
            _driveStatusTimer = setTimeout(() => {
                _driveStatusTimer = null;
                // Restore previous status
                if (UI.lastPersistentStatus) {
                    statusText.textContent = UI.lastPersistentStatus.message;
                    const bar = document.getElementById('status-bar');
                    if (bar) bar.className = 'status-bar' + (UI.lastPersistentStatus.isError ? ' error' : '');
                }
            }, 2000);
        }
    }
}

function savedDriveStatus() {
    const info = getDriveLastSaveInfo();
    if (info) return `Saved ${info.ago} | ${info.email}`;
    return null;
}

function applyDriveData(data) {
    reloadUIWithData(data);
    clearDriveDirty();
    updateDriveStatus();
    const count = data.records ? data.records.length : 0;
    setStatus(`Loaded ${count} record${count !== 1 ? 's' : ''} from Drive`, false, false);
    restoreStatusAfterDelay();
}

function clearDriveStatusFlash() {
    if (_driveStatusTimer) {
        clearTimeout(_driveStatusTimer);
        _driveStatusTimer = null;
    }
}

/**
 * Handle opening a file from Drive picker.
 */
async function handleDriveOpen() {
    // Flush any pending changes to current file before switching
    if (DriveState.driveDirty && DriveState.fileId && UI.data) {
        updateDriveStatus('Saving...');
        const saved = await driveSaveFile(UI.data);
        if (saved) {
            clearDriveDirty();
        } else if (!confirm('Failed to save current file to Drive. Open new file anyway?')) {
            updateDriveStatus();
            return;
        }
    }

    const picked = await openDriveFileChooser();
    if (!picked) return;

    updateDriveStatus('Loading...');
    const data = await driveLoadFile(picked.id);
    if (data) {
        DriveState.fileId = picked.id;
        DriveState.fileName = picked.name;
        saveDriveState();
        applyDriveData(data);
    } else {
        updateDriveStatus();
        setStatus('Failed to load from Drive', true, false);
    }
}

/**
 * Handle saving as a new file on Drive.
 */
async function handleDriveSaveAs() {
    const name = prompt('File name:', DriveState.fileName || 'MathPad.mathpad.json');
    if (!name) return;

    if (UI.data) {
        updateDriveStatus('Saving...');
        const ok = await driveSaveFile(UI.data, name, true);
        if (ok) {
            clearDriveDirty();
            updateDriveStatus();
            setStatus('Saved to Drive as ' + name, false, false);
        } else {
            updateDriveStatus();
            setStatus('Failed to save to Drive', true, false);
        }
    }
}

/**
 * Handle sign out from Drive.
 */
async function handleDriveSignOut() {
    closeDriveDropdown();
    await driveSignOut();
    updateDriveUI();
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
window.clearDriveStatusFlash = clearDriveStatusFlash;
window.handleDriveOpen = handleDriveOpen;
window.handleDriveSaveAs = handleDriveSaveAs;
window.handleDriveSignOut = handleDriveSignOut;
window.toggleDriveDropdown = toggleDriveDropdown;
window.closeDriveDropdown = closeDriveDropdown;
window.DriveState = DriveState;
