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
    dirtySeq: 0,                // bumped on every edit; guards against an in-flight save clearing a newer edit's dirty flag
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

// True while a token request is open (popup/iframe in flight). Stops the
// incidental gesture-renewal from stacking a second popup. An explicit Sign In
// click (requestDriveSignIn) clears it first, so a wedged request — e.g. GIS
// went silent and called neither callback — can never swallow a user click.
let _signInProgress = false;

/**
 * Fire a token request (fire-and-forget — there is no returned promise to
 * await). At most one request is open at a time. The outcome arrives via the
 * GIS callbacks:
 *   - success → store the token, then run the full post-sign-in sequence
 *   - cancel / blocked / error → clear the guard and refresh the UI
 * No timeout: there is nothing to "settle", and a wedged guard is cleared by
 * the next explicit sign-in click (requestDriveSignIn) rather than a timer.
 * @param {string} [promptMode] - GIS prompt: '' (auto), 'consent', 'select_account'
 */
function driveSignIn(promptMode) {
    if (!DriveState.tokenClient) return;
    if (_signInProgress) return;
    _signInProgress = true;

    DriveState.tokenClient.callback = (resp) => {
        _signInProgress = false;
        if (resp.error) {
            console.error('Drive auth error:', resp.error);
            updateDriveUI();
            return;
        }
        DriveState.accessToken = resp.access_token;
        DriveState.tokenExpiry = Date.now() + (resp.expires_in * 1000);
        console.log('Drive token obtained at', new Date().toLocaleTimeString(), 'expires', new Date(DriveState.tokenExpiry).toLocaleTimeString());
        // fetchUserEmail catches its own errors and never rejects.
        fetchUserEmail().then(() => {
            saveDriveState();
            onDriveSignedIn();   // un-gray + adopt (no-op if already bound) + sync + timer
        });
    };

    // GIS routes user cancellation (closing the popup) and other non-OAuth
    // failures here — e.g. err.type 'popup_closed' / 'popup_failed_to_open' —
    // NOT through callback. Just clear the guard and reflect the (still
    // signed-out / "click to sync") state.
    DriveState.tokenClient.error_callback = (err) => {
        _signInProgress = false;
        console.warn('Drive auth dismissed:', err && err.type);
        updateDriveUI();
    };

    DriveState.tokenClient.requestAccessToken({
        prompt: promptMode || '',
        hint: DriveState.userEmail || ''
    });
}

/**
 * Explicit, user-initiated sign-in (Sign In button / avatar click). Clears any
 * stale in-flight flag first, so the click is always an immediate retry — even
 * if a previous request wedged (GIS returned neither callback). The incidental
 * gesture-renewal path calls driveSignIn directly and DOES respect the guard.
 * @param {string} [promptMode]
 */
function requestDriveSignIn(promptMode) {
    _signInProgress = false;
    driveSignIn(promptMode);
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
    if (_signInProgress) return;  // a token request is already in flight
    if (DriveState.accessToken && Date.now() < DriveState.tokenExpiry - RENEW_MARGIN_MS) return;
    const now = Date.now();
    if (now - _lastRenewAttempt < RENEW_THROTTLE_MS) return;
    _lastRenewAttempt = now;
    // Synchronous call within the gesture so requestAccessToken keeps the user
    // activation. Fire-and-forget: the success callback runs onDriveSignedIn.
    driveSignIn('');
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
const CANONICAL_FILE_NAME = 'MathPad.json';

// Files live in the MathPad folder, so names stay short — .json is the only
// extension. Append it to a user-entered name that doesn't already have it.
function ensureJsonExt(name) {
    return /\.json$/i.test(name) ? name : name + '.json';
}

// A unique, timestamped default for a new Drive file (e.g.
// MathPad-2026-06-25-143005.json). Used everywhere we prompt for a new-file
// name so two devices saving at once don't collide on a shared default.
function defaultNewFileName() {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    return `MathPad-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
        `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
}

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
                // Update existing file — content only, don't overwrite name.
                // Request `trashed` so we can detect a file deleted in the
                // Drive UI: "delete" there only moves it to Trash, where it's
                // still reachable by id, so a PATCH silently updates the
                // trashed copy unless we check (a 404 only fires on permanent
                // deletion / emptied trash).
                resp = await driveMultipartRequest(
                    `https://www.googleapis.com/upload/drive/v3/files/${DriveState.fileId}?uploadType=multipart&fields=id,name,modifiedTime,lastModifyingUser,md5Checksum,trashed`,
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

            if (result.trashed && !forceNew && attempt === 0) {
                // We just wrote to a trashed file (deleted in the Drive UI) —
                // abandon it and retry, which creates a fresh file in its place.
                DriveState.fileId = null;
                localStorage.removeItem(DRIVE_KEYS.fileId);
                continue;
            }

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
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,modifiedTime,lastModifyingUser,md5Checksum,trashed`
    );
    if (!resp) return null;
    try {
        if (!resp.ok) return null;
        const meta = await resp.json();
        return {
            name: meta.name,
            modifiedTime: meta.modifiedTime,
            lastModifyingUser: meta.lastModifyingUser?.emailAddress || null,
            md5Checksum: meta.md5Checksum || null,
            trashed: !!meta.trashed
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
    DriveState.dirtySeq++;
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
 * recently modified if duplicates exist). Tri-state: { id, name } found / null
 * confirmed-none / false lookup-failed.
 */
async function findCanonicalFile() {
    const folderId = await ensureMathPadFolder();
    if (!folderId) return false;   // couldn't determine (folder lookup failed)
    const q = encodeURIComponent(
        `name = '${CANONICAL_FILE_NAME}' and '${folderId}' in parents and trashed = false`
    );
    const resp = await driveFetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=modifiedTime desc&pageSize=1`
    );
    if (!resp || !resp.ok) return false;   // couldn't determine (query failed)
    try {
        const data = await resp.json();
        if (data.files && data.files.length > 0) {
            return { id: data.files[0].id, name: data.files[0].name };
        }
        return null;   // query succeeded: no canonical file exists
    } catch (e) {
        console.error('Drive canonical-file search error:', e);
        return false;  // couldn't determine (parse error)
    }
}

/**
 * On a fresh device (signed in but no local fileId), bind to the existing
 * canonical file, then resolve the first-encounter conflict explicitly —
 * this device's records and the Drive file are two datasets meeting for the
 * first time, and we never replace local silently. If no canonical file
 * exists yet, create it immediately — signing in should persist to Drive
 * right away, not wait for the first edit to flip the dirty flag.
 *
 * One-shot: the three-way runs here (right after sign-in), not in the periodic
 * runSyncCycle, so it can't re-prompt every 15s. Each outcome leaves clean
 * sync state, so the runSyncCycle that follows in onDriveSignedIn is a no-op.
 */
async function adoptCanonicalFile() {
    if (DriveState.fileId) return;        // already bound to a file
    if (!isDriveAuthenticated()) return;
    const file = await findCanonicalFile();
    if (file === false) return;   // lookup failed — try again on a later sign-in
    if (!file) {
        // No canonical file on Drive yet.
        if (!UI.data) return;
        const files = await driveListFiles();
        if (!files) return;   // couldn't list — defer to a later sign-in
        if (files.length === 0) {
            // Nothing on Drive — create the canonical now with this device's
            // records so signing in persists immediately (driveSaveFile creates
            // MathPad.json when fileId is unset), not waiting for the first edit.
            await pushLocalToDrive();
        } else {
            // Other files exist — the user's real data may be in one of them,
            // so ask rather than silently seeding a fresh canonical that this
            // device (and others) would then adopt over the real data.
            await resolveNoCanonical(files);
        }
        return;
    }
    DriveState.fileId = file.id;
    DriveState.fileName = file.name;
    saveDriveState();
    const meta = await driveGetMetadata(file.id);
    // If metadata can't be fetched (network), leave bound — runSyncCycle's
    // conflict dialog reconciles on a later cycle.
    if (meta) {
        const ago = formatTimeAgo(meta.modifiedTime);
        const who = meta.lastModifyingUser || 'unknown';
        await resolveSyncConflict(meta, 'Sync with Google Drive',
            `This device has its own records, and Drive already has a file ` +
            `"${meta.name}" (modified ${ago} by ${who}). Which version do you want to keep?`,
            false, true);
    }
}

/**
 * Pick an existing Drive file, bind to it, and run the 3-way sync conflict
 * against it (load it / keep mine / fork / pick another). Returns true when the
 * device ends bound+resolved (caller should finish), or false when the picker
 * was dismissed (caller should loop back to its own choices). Shared by the
 * "no canonical" and "trashed file" setup dialogs.
 */
async function chooseExistingFileAndResolve() {
    const picked = await openDriveFileChooser();
    if (!picked) return false;   // dismissed the picker
    DriveState.fileId = picked.id;
    DriveState.fileName = picked.name;
    saveDriveState();
    const pmeta = await driveGetMetadata(picked.id);
    if (!pmeta) { updateDriveStatus('Sync error •'); return true; }
    const ago = formatTimeAgo(pmeta.modifiedTime);
    const who = pmeta.lastModifyingUser || 'unknown';
    await resolveSyncConflict(pmeta, 'Sync with Google Drive',
        `Drive file "${pmeta.name}" was modified ${ago} by ${who}. ` +
        `Which version do you want to keep?`, false, true);
    return true;
}

/**
 * Sign-in found no MathPad.json but the user has other Drive files — their real
 * data may live in one, so don't silently seed a fresh canonical. Offer to
 * create MathPad.json from this device's records, OR pick an existing file to
 * sync with (then resolve against it). Non-dismissable: signing in must end
 * bound to a file. Loops so backing out of the picker returns to the choices.
 */
async function resolveNoCanonical(files) {
    while (true) {
        const choice = await showChoiceDialog({
            title: 'Set up Drive sync',
            message: `You don't have a "${CANONICAL_FILE_NAME}" yet, but you have ` +
                `${files.length} other file${files.length !== 1 ? 's' : ''} in your Drive. ` +
                `How should this device sync?`,
            options: [
                {
                    key: 'choose', primary: true, label: 'Use an existing file…',
                    sub: 'Sync this device with one of your existing Drive files (likely where your records already are).'
                },
                {
                    key: 'create', label: `Create ${CANONICAL_FILE_NAME}`,
                    sub: `Save this device's records as ${CANONICAL_FILE_NAME}, the default file other devices adopt automatically.`
                },
                {
                    key: 'new', label: 'Sync to a new file…',
                    sub: "Save this device's records to a new file with a name you choose."
                }
            ]
        });

        if (choice === 'create') {
            await pushLocalToDrive();
            return;
        }

        if (choice === 'new') {
            if (await syncToNewFile() === 'cancelled') continue;   // back to the choices
            return;
        }

        if (choice === 'choose') {
            // Pick an existing file, bind to it, and resolve against it — same
            // path as the adoption dialog's "Keep both — sync to an existing file".
            if (await chooseExistingFileAndResolve()) return;
            continue;   // dismissed the picker → back to the choices
        }
    }
}

/**
 * Promise-based modal with N explicit, labeled choices (no OK/Cancel
 * ambiguity). Each option is a button with a bold label + an optional
 * one-line explanation. Resolves to the chosen option's `key`.
 *
 * By default there is no dismiss (the buttons are the only exits — used for
 * the adoption conflict, where a fresh device must not be left unresolved).
 * Pass `dismissable: true` (e.g. the file picker, where opening is optional)
 * to allow Escape / click-outside, which resolve to null.
 * @param {{title, message, options: Array<{key, label, sub, primary}>, dismissable}} cfg
 * @returns {Promise<string|null>}
 */
function showChoiceDialog({ title, message, options, dismissable = false }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'choice-dialog';
        const content = document.createElement('div');
        content.className = 'choice-dialog-content';

        const h = document.createElement('div');
        h.className = 'choice-dialog-title';
        h.textContent = title;
        content.appendChild(h);

        if (message) {
            const msg = document.createElement('div');
            msg.className = 'choice-dialog-message';
            msg.textContent = message;
            content.appendChild(msg);
        }

        let onKey = null;
        const finish = (key) => {
            if (onKey) document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            resolve(key);
        };

        const btns = document.createElement('div');
        btns.className = 'choice-dialog-buttons';
        for (const opt of options) {
            const b = document.createElement('button');
            if (opt.primary) b.className = 'primary';
            const label = document.createElement('span');
            label.className = 'choice-label';
            label.textContent = opt.label;
            b.appendChild(label);
            if (opt.sub) {
                const sub = document.createElement('span');
                sub.className = 'choice-sub';
                sub.textContent = opt.sub;
                b.appendChild(sub);
            }
            b.addEventListener('click', () => finish(opt.key));
            btns.appendChild(b);
        }
        content.appendChild(btns);

        if (dismissable) {
            const cancel = document.createElement('button');
            cancel.className = 'choice-dialog-cancel';
            cancel.textContent = 'Cancel';
            cancel.addEventListener('click', () => finish(null));
            content.appendChild(cancel);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
            onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
            document.addEventListener('keydown', onKey, true);
        }

        overlay.appendChild(content);
        document.body.appendChild(overlay);
    });
}

/**
 * Prompt for a name and save this device's records to a NEW Drive file, then
 * sync with it (driveSaveFile forceNew repoints fileId). The date + local
 * HHMMSS default avoids collisions; a name collision (case-insensitive)
 * reconciles with the existing file instead of making a "<name> (1)" duplicate.
 * Returns 'cancelled' if the user backs out of the name prompt (caller should
 * loop back to its choices), otherwise 'done'.
 */
async function syncToNewFile() {
    const def = defaultNewFileName();
    const entered = prompt("Name for this device's new Drive file:", def);
    if (entered === null) return 'cancelled';
    const name = ensureJsonExt(entered.trim() || def);
    const files = await driveListFiles();
    const existing = findByName(files, name);
    if (existing) {
        await reconcileExistingFile(existing, false);
        return 'done';
    }
    updateDriveStatus('Saving...');
    const ok = await driveSaveFile(UI.data, name, true);
    if (ok) {
        clearDriveDirty();
        updateDriveStatus(savedDriveStatus());
    } else {
        updateDriveStatus('Sync error •');
    }
    return 'done';
}

/**
 * Three-way resolution when this device's local records and the Drive file
 * disagree — used both for fresh-device adoption and for an ongoing
 * "Drive has newer data" conflict. A single labeled-choice dialog:
 *   Load from Drive — take the Drive version (local records replaced).
 *   Keep both       — save THIS device's records as a NEW Drive file and
 *                     sync with that; the Drive file is left untouched.
 *   Keep mine       — overwrite the Drive file with this device's records.
 * Every branch leaves sync state consistent so the periodic cycle won't
 * re-prompt. Caller supplies the title/message for the situation. When
 * `dismissable` is true the dialog can be cancelled (returns false, no
 * action taken); otherwise the three choices are the only exits. Returns
 * true once a choice is acted on.
 */
async function resolveSyncConflict(meta, title, message, dismissable = false, allowChooseOther = false) {
    const n = (UI.data && UI.data.records) ? UI.data.records.length : 0;

    // "Keep both — sync to an existing file" is only useful if there's a file
    // other than the one currently bound to switch to.
    let canChoose = false;
    if (allowChooseOther) {
        const allFiles = await driveListFiles();
        canChoose = !!(allFiles && allFiles.some(f => f.id !== DriveState.fileId));
    }

    // Loop so cancelling the "keep both" name prompt goes BACK to the choices
    // rather than committing — the only terminal exits are an actual decision.
    while (true) {
        const choice = await showChoiceDialog({
            title,
            message,
            dismissable,
            options: [
                {
                    key: 'load', primary: true, label: 'Load from Drive',
                    sub: `Replace this device's ${n} record${n !== 1 ? 's' : ''} with the Drive file's contents.`
                },
                {
                    key: 'mine', label: 'Keep mine',
                    sub: "Overwrite the Drive file with this device's records."
                },
                {
                    key: 'both', label: 'Keep both — sync to a new file',
                    sub: "Save this device's records as a new Drive file and sync with that. The existing file is left untouched."
                },
                ...(canChoose ? [{
                    key: 'choose', label: 'Keep both — sync to an existing file',
                    sub: 'Leave this file untouched and sync this device with a different existing Drive file, then choose how to resolve it.'
                }] : [])
            ]
        });

        if (choice === null) return false;   // dismissed (only when dismissable)

        if (choice === 'choose') {
            // "Keep both — sync to an existing file": leave the current file
            // untouched, pick a different existing one, bind to it, and re-show
            // this dialog to resolve against THAT file (load it / keep mine /
            // fork / pick yet another). Replaces the old keep-both-then-type-
            // the-existing-name workaround.
            const picked = await openDriveFileChooser();
            if (!picked) continue;   // dismissed the picker → back to the choices
            DriveState.fileId = picked.id;
            DriveState.fileName = picked.name;
            saveDriveState();
            const pmeta = await driveGetMetadata(picked.id);
            if (!pmeta) { updateDriveStatus('Sync error •'); return true; }
            const ago = formatTimeAgo(pmeta.modifiedTime);
            const who = pmeta.lastModifyingUser || 'unknown';
            return await resolveSyncConflict(pmeta, 'Sync with Google Drive',
                `Drive file "${pmeta.name}" was modified ${ago} by ${who}. ` +
                `Which version do you want to keep?`, dismissable, true);
        }

        if (choice === 'load') {
            updateDriveStatus('Loading...');
            const data = await driveLoadFile(DriveState.fileId);
            if (data) applyDriveData(data);
            else updateDriveStatus('Load failed');
            return true;
        }

        if (choice === 'both') {
            // Fork to a new file (this device then syncs it). Cancelling the
            // name prompt backs out to the choices.
            if (await syncToNewFile() === 'cancelled') continue;
            return true;
        }

        // Keep mine: overwrite the canonical file. Match this remote checksum
        // (so the periodic cycle sees no conflict) and mark dirty so it pushes
        // local over the canonical file.
        DriveState.declinedRemoteTime = meta.modifiedTime;
        DriveState.lastChecksum = meta.md5Checksum || DriveState.lastChecksum;
        DriveState.driveDirty = true;
        saveDriveState();
        return true;
    }
}

/**
 * Saving to a name that already exists on Drive (another device made it, etc.).
 * Bind to that file and reconcile via the shared 3-way dialog instead of
 * letting Drive create a "<name> (1)" duplicate. Returns resolveSyncConflict's
 * result (true acted / false dismissed). Used by Save As, the keep-both fork,
 * and trashed-file recovery.
 */
async function reconcileExistingFile(existing, dismissable) {
    DriveState.fileId = existing.id;
    DriveState.fileName = existing.name;   // adopt the existing file's actual name/casing
    saveDriveState();
    const meta = await driveGetMetadata(existing.id);
    if (!meta) return false;
    return await resolveSyncConflict(meta, 'A file already exists',
        `A file named "${existing.name}" already exists on Drive. ` +
        `Which version do you want to keep?`, dismissable);
}

/**
 * Case-insensitive filename lookup in a Drive file list. Drive permits multiple
 * files with the same name differing only in case, so a collision check must
 * fold case — otherwise a "Foo.json" vs "foo.json" mismatch slips through and
 * Drive creates a "<name> (1)" duplicate.
 */
function findByName(files, name) {
    if (!files) return null;
    const lower = name.toLowerCase();
    return files.find(f => f.name.toLowerCase() === lower) || null;
}

/**
 * The synced file was deleted in the Drive UI (trashed). Unbind from it and ask
 * what to do — recreate the same file, use one of the user's other Drive files,
 * save to a new one, or stop syncing entirely (sign out). No "signed in but not
 * syncing" limbo state. If "Recreate" (or "Save to a new file") lands on a name
 * that already exists, the create branch reconciles via the 3-way dialog instead
 * of making a duplicate — the user, not an up-front auto-adopt, makes that call.
 */
async function resolveTrashedFile(trashedName) {
    // Unbind from the trashed file up front.
    DriveState.fileId = null;
    DriveState.lastChecksum = null;
    DriveState.lastModifiedTime = null;
    localStorage.removeItem(DRIVE_KEYS.fileId);

    // A DIFFERENTLY-named file enables a "use an existing file" option — the
    // user's real data may live in one. A file with the SAME name as the trashed
    // one is excluded: "Recreate it" already reconciles to that (its create
    // branch does a findByName), so offering both would point at the same file.
    // (Lists only app-created files; a same-name MathPad.json the user
    // hand-copied in the Drive UI is invisible — see driveListFiles.)
    const otherFiles = await driveListFiles();
    const lowerTrashed = trashedName.toLowerCase();
    const sameNameExists = !!(otherFiles && otherFiles.some(f => f.name.toLowerCase() === lowerTrashed));
    const canChoose = !!(otherFiles && otherFiles.some(f => f.name.toLowerCase() !== lowerTrashed));

    // When a live file already shares the trashed file's name, "recreate" really
    // means "adopt that existing file and reconcile" — the create branch's
    // findByName lands it in the 3-way dialog rather than making a fresh file —
    // so label it honestly. (Same 'recreate' key either way; only the wording
    // changes.)
    const options = [
        sameNameExists
            ? {
                key: 'recreate', primary: true, label: `Use the existing "${trashedName}"`,
                sub: `A "${trashedName}" already exists on Drive — sync with it and choose which version to keep.`
            }
            : {
                key: 'recreate', primary: true, label: 'Recreate it',
                sub: `Save to a fresh "${trashedName}" and keep syncing.`
            }
    ];
    if (canChoose) {
        options.push({
            key: 'choose', label: 'Use an existing file…',
            sub: 'Sync this device with one of your other Drive files instead.'
        });
    }
    options.push(
        {
            key: 'new', label: 'Save to a new file',
            sub: 'Pick a new name; this device syncs to that file instead.'
        },
        {
            key: 'stop', label: 'Stop syncing and sign out',
            sub: 'Leave it deleted and sign out of Google Drive.'
        }
    );

    while (true) {
        const choice = await showChoiceDialog({
            title: 'Drive file was deleted',
            message: `The Drive file "${trashedName}" was moved to Trash. ` +
                `What would you like to do with this device's records?`,
            options
        });

        if (choice === 'choose') {
            // Pick an existing file, bind to it, and resolve against it.
            if (await chooseExistingFileAndResolve()) return;
            continue;   // dismissed the picker → back to the choices
        }

        if (choice === 'stop') {
            // Clear dirty first so driveSignOut's flush doesn't recreate the
            // file we're choosing to leave deleted. Records stay in localStorage.
            clearDriveDirty();
            await driveSignOut();
            updateDriveUI();
            return;
        }

        let name = trashedName;
        if (choice === 'new') {
            const def = defaultNewFileName();
            const entered = prompt('Name for the new Drive file:', def);
            if (entered === null) continue;   // cancelled → back to the choices
            name = ensureJsonExt(entered.trim() || def);
        }

        // A file of this name may already exist — e.g. another device already
        // recreated the deleted file. Adopt it and reconcile rather than
        // creating a duplicate (which Drive would name "<name> (1)").
        const files = await driveListFiles();
        const existing = findByName(files, name);
        if (existing) {
            await reconcileExistingFile(existing, false);
            return;
        }

        // No collision: create a fresh file with `name` and sync to it.
        DriveState.fileName = name;
        saveDriveState();
        updateDriveStatus('Saving...');
        const ok = await driveSaveFile(UI.data, name, true);
        if (ok) {
            clearDriveDirty();
            updateDriveStatus(savedDriveStatus());
        } else {
            updateDriveStatus('Sync error •');
        }
        return;
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

        // File was deleted in the Drive UI (moved to Trash but still reachable
        // by id). Ask what to do rather than silently recreating.
        if (meta.trashed) {
            await resolveTrashedFile(meta.name);
            return;
        }

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
            // Drive has a newer version of this file — same three-way as
            // adoption (Load / Keep both / Keep mine), so a conflict never
            // forces you to lose a side.
            const ago = formatTimeAgo(meta.modifiedTime);
            const who = meta.lastModifyingUser || 'unknown';
            await resolveSyncConflict(meta, 'Drive has newer data',
                `The Drive file "${meta.name}" was updated ${ago} by ${who}. Which version do you want to keep?`);
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
    const seq = DriveState.dirtySeq;
    const ok = await driveSaveFile(UI.data);
    if (ok) {
        // Only clear dirty if no edit landed during the save — otherwise that
        // edit's dirty flag would be wiped and its data never pushed (a newer
        // value would be silently lost while the stale one sits on Drive).
        if (DriveState.dirtySeq === seq) clearDriveDirty();
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
        const seq = DriveState.dirtySeq;
        if (await driveSaveFile(UI.data)) {
            if (DriveState.dirtySeq === seq) clearDriveDirty();
        }
    }
}

/**
 * Run a user-initiated Drive operation (Save As / Open) while holding
 * syncInProgress, so the periodic runSyncCycle can't fire inside it and stack
 * a second "Drive has newer data" dialog on top of its async dialogs. No-ops
 * if a cycle is already running.
 */
async function withSyncSuspended(fn) {
    if (DriveState.syncInProgress) return;
    DriveState.syncInProgress = true;
    try {
        return await fn();
    } finally {
        DriveState.syncInProgress = false;
    }
}

// ---- File Listing (replaces Picker — no API key needed) ----

/**
 * List files in the MathPad folder (falls back to all Drive files).
 *
 * Hard limit of the drive.file scope: the app can only ever see files it
 * CREATED or that the user explicitly OPENED through the app. A MathPad.json the
 * user made by copying/duplicating in the Drive web UI was neither, so it is
 * invisible here by design — files.list won't return it and files.get on its id
 * would 403. There's no client-side way around it without the Google Picker
 * (which grants per-file access on selection). Normal cross-device sync is
 * unaffected: every file the app makes is app-created and thus visible.
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
        alert('No MathPad files found in your Drive.');
        return null;
    }

    // Click-to-select dialog: one button per file (current file marked).
    // driveListFiles already returns them newest-first.
    const chosenId = await showChoiceDialog({
        title: 'Open from Google Drive',
        message: 'Choose a file to sync with on this device.',
        dismissable: true,
        options: files.map(f => ({
            key: f.id,
            primary: f.id === DriveState.fileId,
            label: f.name,
            sub: `Modified ${formatTimeAgo(f.modifiedTime)}` +
                (f.id === DriveState.fileId ? ' · current' : '')
        }))
    });
    if (!chosenId) return null;  // dismissed
    const f = files.find(x => x.id === chosenId);
    return f ? { id: f.id, name: f.name } : null;
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
    await withSyncSuspended(async () => {
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
    });
}

/**
 * Handle saving as a new file on Drive.
 */
async function handleDriveSaveAs() {
    // Default to a fresh, unique name — "Save As" creates a NEW file, so
    // pre-filling the current file's name would invite an accidental
    // same-name collision/reconcile instead of a new file.
    const def = defaultNewFileName();
    const entered = prompt('File name:', def);
    if (entered === null) return;
    const name = ensureJsonExt(entered.trim() || def);
    if (!UI.data) return;

    await withSyncSuspended(async () => {
        // If a file of that name already exists (Drive allows same-named files
        // — e.g. another device made it), reconcile rather than creating a
        // duplicate. Dismissable so the user can back out and pick a new name.
        const files = await driveListFiles();
        const existing = findByName(files, name);
        if (existing) {
            const prev = {
                fileId: DriveState.fileId, fileName: DriveState.fileName,
                lastChecksum: DriveState.lastChecksum, lastModifiedTime: DriveState.lastModifiedTime
            };
            const resolved = await reconcileExistingFile(existing, true);
            if (!resolved) {
                // Cancelled (or metadata fetch failed) — restore prior binding.
                Object.assign(DriveState, prev);
                saveDriveState();
                updateDriveStatus();
            }
            return;
        }

        // No collision — create a new file and sync to it.
        DriveState.fileName = name;
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
    });
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
window.requestDriveSignIn = requestDriveSignIn;
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
