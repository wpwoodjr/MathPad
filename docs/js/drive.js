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
    driveDirty: false,
    syncInProgress: false,
    syncTimer: null,
    statusInterval: null,
    ready: false
};

const SYNC_INTERVAL_MS = 15000;   // 15 seconds between sync cycles
const RENEW_MARGIN_MS = 5 * 60 * 1000;  // renew the token this long before expiry

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
                console.warn('Google Identity Services not available');
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

    if (!DriveState.tokenClient) {
        return Promise.resolve(false);
    }

    _tokenPromise = new Promise((resolve) => {
        // Timeout: if GIS blocks the popup, the callback never fires.
        // 5s for silent renewal (iframe), 120s for interactive (account picker / consent).
        const timeoutMs = (promptMode === '') ? 5000 : 120000;
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                _tokenPromise = null;
                resolve(false);
            }
        }, timeoutMs);

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
            // fetchUserEmail catches its own errors and never rejects.
            fetchUserEmail().then(() => {
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

/**
 * Ensure we have a currently-valid token. VALIDATE-ONLY: never opens a popup.
 *
 * GIS implicit-flow renewal (requestAccessToken) requires a user gesture for
 * the popup to open — a timer or API-call context has no activation, so the
 * popup is blocked. Renewal therefore happens in maybeRenewToken() on the
 * user's own clicks/keystrokes, or via an explicit sign-in click. Here we
 * just report whether a valid token exists, dropping an expired one so
 * isDriveAuthenticated() reads false and the UI shows "click to sync".
 *
 * @returns {Promise<boolean>}
 */
async function ensureToken() {
    if (DriveState.accessToken && Date.now() < DriveState.tokenExpiry) {
        return true;
    }
    if (DriveState.accessToken) {
        DriveState.accessToken = null;
        DriveState.tokenExpiry = 0;
        saveDriveState();
    }
    return false;
}

const RENEW_THROTTLE_MS = 60000;  // min gap between gesture-triggered renewals
let _lastRenewAttempt = 0;

/**
 * Renew the token opportunistically from a user gesture (click/keypress) when
 * it's near expiry or already expired. The gesture supplies the activation the
 * GIS renewal popup needs, so during active use the token rolls over
 * seamlessly. Throttled so a failing renewal can't pop on every keystroke.
 * No-op unless signed in and actually near expiry. Attached to document
 * pointerdown/keydown in app.js.
 */
function maybeRenewToken() {
    if (!isDriveSignedIn() || !DriveState.userEmail) return;
    if (_tokenPromise) return;  // a token request is already in flight
    if (DriveState.accessToken && Date.now() < DriveState.tokenExpiry - RENEW_MARGIN_MS) return;
    const now = Date.now();
    if (now - _lastRenewAttempt < RENEW_THROTTLE_MS) return;
    _lastRenewAttempt = now;
    // Synchronous call within the gesture so requestAccessToken keeps the
    // user activation; the 5s ('') timeout bails fast if it can't complete.
    driveSignIn('').then((ok) => {
        if (!ok) return;
        updateDriveUI();   // un-gray the avatar (isDriveAuthenticated() is true again)
        runSyncCycle();
    });
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
// The one file every device syncs to by default. New files are created with
// this name, and a fresh device adopts the existing one by it on sign-in, so
// data follows the user across browsers/hosts without manual file-picking.
const CANONICAL_FILE_NAME = 'MathPad.mathpad.json';

/**
 * Find or create the "MathPad" folder in the user's Drive root.
 * Caches the folder ID in DriveState and localStorage.
 * @returns {Promise<string|null>} folder ID, or null on failure
 */
async function ensureMathPadFolder() {
    if (DriveState.folderId) {
        // Verify folder still exists
        const resp = await driveFetch(
            `https://www.googleapis.com/drive/v3/files/${DriveState.folderId}?fields=id,trashed`
        );
        // Network/token error — keep cached ID, try again later
        if (!resp) return DriveState.folderId;
        if (resp.ok) {
            const meta = await resp.json();
            if (!meta.trashed) return DriveState.folderId;
            // Folder trashed — clear and recreate
        } else if (resp.status !== 404) {
            // Transient error (403, 500, etc.) — keep cached ID, try again later
            return DriveState.folderId;
        }
        DriveState.folderId = null;
        localStorage.removeItem(DRIVE_KEYS.folderId);
    }

    // Search for existing folder
    const q = encodeURIComponent(
        `name = '${MATHPAD_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`
    );
    const searchResp = await driveFetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`
    );
    if (searchResp && searchResp.ok) {
        const data = await searchResp.json();
        if (data.files && data.files.length > 0) {
            DriveState.folderId = data.files[0].id;
            saveDriveState();
            return DriveState.folderId;
        }
    } else if (!searchResp) {
        return null;
    }

    // Create folder
    const createResp = await driveFetch(
        'https://www.googleapis.com/drive/v3/files?fields=id',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: MATHPAD_FOLDER_NAME,
                mimeType: 'application/vnd.google-apps.folder',
                parents: ['root']
            })
        }
    );
    if (createResp && createResp.ok) {
        const data = await createResp.json();
        DriveState.folderId = data.id;
        saveDriveState();
        return DriveState.folderId;
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

    const fileName = overrideName || DriveState.fileName || CANONICAL_FILE_NAME;
    // Strip stale generated sections (Tables, Trace, References) per record
    // before serializing — the Drive file shouldn't carry display artifacts
    // from the last solve. cleanDataForSave shallow-clones so in-memory
    // record.text stays as-is for the current session.
    const content = JSON.stringify(cleanDataForSave(data));

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
 * Authenticated Drive fetch with one automatic 401 retry (token refresh).
 * Injects the Authorization header; pass other headers/body via options as
 * usual. Returns the Response so callers can inspect .ok / .status, or null
 * if a token couldn't be obtained or the network failed. Single source of
 * the ensure-token → fetch → on-401-refresh-and-retry policy.
 */
async function driveFetch(url, options = {}) {
    if (!(await ensureToken())) return null;
    const withAuth = () => fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), 'Authorization': 'Bearer ' + DriveState.accessToken }
    });
    try {
        let resp = await withAuth();
        if (resp.status === 401) {
            DriveState.accessToken = null;
            if (!(await ensureToken())) return null;
            resp = await withAuth();
        }
        return resp;
    } catch (e) {
        console.error('Drive fetch error:', url, e);
        return null;
    }
}

/**
 * Load file content from Drive.
 * @param {string} fileId
 * @returns {Promise<object|null>} parsed data or null
 */
async function driveLoadFile(fileId) {
    const resp = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    if (!resp) return null;
    try {
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
    const resp = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,modifiedTime,lastModifyingUser,md5Checksum`
    );
    if (!resp) return null;
    try {
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
 * Find the canonical MathPad file in the MathPad folder (by name, most
 * recently modified if duplicates exist). Returns { id, name } or null.
 */
async function findCanonicalFile() {
    const folderId = await ensureMathPadFolder();
    if (!folderId) return null;
    const q = encodeURIComponent(
        `name = '${CANONICAL_FILE_NAME}' and '${folderId}' in parents and trashed = false`
    );
    const resp = await driveFetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=modifiedTime desc&pageSize=1`
    );
    if (!resp || !resp.ok) return null;
    try {
        const data = await resp.json();
        if (data.files && data.files.length > 0) {
            return { id: data.files[0].id, name: data.files[0].name };
        }
    } catch (e) {
        console.error('Drive canonical-file search error:', e);
    }
    return null;
}

/**
 * On a fresh device (signed in but no local fileId), bind to the existing
 * canonical file, then resolve the first-encounter conflict explicitly —
 * this device's records and the Drive file are two datasets meeting for the
 * first time, and we never replace local silently. If no canonical file
 * exists yet, do nothing — the first dirty sync creates it.
 *
 * One-shot: the three-way runs here (right after sign-in), not in the periodic
 * runSyncCycle, so it can't re-prompt every 15s. Each outcome leaves clean
 * sync state, so the runSyncCycle that follows in onDriveSignedIn is a no-op.
 */
async function adoptCanonicalFile() {
    if (DriveState.fileId) return;        // already bound to a file
    if (!isDriveAuthenticated()) return;
    const file = await findCanonicalFile();
    if (!file) return;
    DriveState.fileId = file.id;
    DriveState.fileName = file.name;
    saveDriveState();
    const meta = await driveGetMetadata(file.id);
    // If metadata can't be fetched (network), leave bound — runSyncCycle's
    // binary "Drive has newer data — load?" prompt reconciles on a later cycle.
    if (meta) await resolveAdoptionConflict(meta);
}

/**
 * Three-way resolution when a fresh device's local records meet an existing
 * Drive file. Presented as two confirm() steps (no custom UI):
 *   Load from Drive — join the canonical dataset (local records replaced).
 *   Keep both       — save THIS device's records as a NEW Drive file and
 *                     sync with that; the canonical file is left untouched.
 *   Keep mine       — overwrite the canonical file with this device's records.
 * Every branch leaves sync state consistent so the periodic cycle won't
 * re-prompt.
 */
async function resolveAdoptionConflict(meta) {
    const ago = formatTimeAgo(meta.modifiedTime);
    const who = meta.lastModifyingUser || 'unknown';
    const n = (UI.data && UI.data.records) ? UI.data.records.length : 0;

    const loadDrive = confirm(
        `This device has its own records, and Drive already has a saved ` +
        `MathPad file (modified ${ago} by ${who}).\n\n` +
        `OK — Load the Drive file onto this device (replaces this device's ` +
        `${n} record${n !== 1 ? 's' : ''}).\n` +
        `Cancel — Keep this device's records (you'll choose how next).`
    );
    if (loadDrive) {
        updateDriveStatus('Loading...');
        const data = await driveLoadFile(DriveState.fileId);
        if (data) applyDriveData(data);
        else updateDriveStatus('Load failed');
        return;
    }

    const keepBoth = confirm(
        `Keep this device's records.\n\n` +
        `OK — Keep BOTH: save this device's records as a NEW Drive file and ` +
        `sync with that (the existing file is left untouched).\n` +
        `Cancel — Keep MINE: overwrite the Drive file with this device's records.`
    );
    if (keepBoth) {
        // Fork to a new file; this device now syncs to it (driveSaveFile with
        // forceNew repoints fileId). Cancelling the name keeps the default —
        // "keep both" is the committed choice, the name is just cosmetic.
        const def = `MathPad-${new Date().toISOString().slice(0, 10)}.mathpad.json`;
        const entered = prompt("Name for this device's new Drive file:", def);
        const name = (entered && entered.trim()) || def;
        updateDriveStatus('Saving...');
        const ok = await driveSaveFile(UI.data, name, true);
        if (ok) {
            clearDriveDirty();
            updateDriveStatus(savedDriveStatus());
        } else {
            updateDriveStatus('Sync error •');
        }
    } else {
        // Keep mine: overwrite the canonical file. Match this remote checksum
        // (so the periodic cycle sees no conflict) and mark dirty so it pushes
        // local over the canonical file.
        DriveState.declinedRemoteTime = meta.modifiedTime;
        DriveState.lastChecksum = meta.md5Checksum || DriveState.lastChecksum;
        DriveState.driveDirty = true;
        saveDriveState();
    }
}

/**
 * Post-sign-in sequence, shared by the Sign In button and the avatar
 * button. Adopts the canonical file (cross-device load), runs an
 * immediate sync, and starts the periodic timer.
 */
async function onDriveSignedIn() {
    updateDriveUI();
    await adoptCanonicalFile();
    await runSyncCycle();
    startDriveSync();
    updateDriveStatus();
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
            const initial = (DriveState.userEmail || '?')[0].toUpperCase();
            const dirty = DriveState.driveDirty ? ' \u2022' : '';
            updateDriveStatus(`Click ${initial} to sync${dirty} | ${DriveState.userEmail}`);
        }
        return;
    }
    if (DriveState.syncInProgress) return;

    DriveState.syncInProgress = true;

    try {
        // If no file yet, create one on first dirty
        if (!DriveState.fileId) {
            if (DriveState.driveDirty && UI.data) {
                await pushLocalToDrive();
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
            await pushLocalToDrive();
        }
    } finally {
        DriveState.syncInProgress = false;
    }
}

/**
 * Push the current local data to Drive and update dirty flag + status.
 * Shared by runSyncCycle's create-first-file and push-when-dirty branches.
 * @returns {Promise<boolean>}
 */
async function pushLocalToDrive() {
    const ok = await driveSaveFile(UI.data);
    if (ok) {
        clearDriveDirty();
        updateDriveStatus(savedDriveStatus());
    } else {
        updateDriveStatus('Sync error •');
    }
    return ok;
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
    const folderId = await ensureMathPadFolder();
    const q = folderId
        ? `'${folderId}' in parents and trashed = false`
        : 'trashed = false';
    const query = encodeURIComponent(q);
    const fields = encodeURIComponent('files(id,name,modifiedTime)');
    const resp = await driveFetch(
        `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=modifiedTime desc&pageSize=20`
    );
    if (!resp || !resp.ok) return null;
    try {
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
    if (override) {
        text = override;
    } else {
        const dirty = DriveState.driveDirty ? ' \u2022' : '';
        // Already returned above if not signed in
        if (!isDriveAuthenticated()) {
            const initial = (DriveState.userEmail || '?')[0].toUpperCase();
            text = `Click ${initial} to sync${dirty} | ${DriveState.userEmail}`;
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

    // On small screens where status-drive is hidden, flash override messages
    if (override && getComputedStyle(el).display === 'none') {
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
    const name = prompt('File name:', DriveState.fileName || CANONICAL_FILE_NAME);
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
window.onDriveSignedIn = onDriveSignedIn;
window.maybeRenewToken = maybeRenewToken;
window.driveSignOut = driveSignOut;
window.isDriveSignedIn = isDriveSignedIn;
window.isDriveAuthenticated = isDriveAuthenticated;
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
