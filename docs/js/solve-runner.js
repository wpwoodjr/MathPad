/**
 * SolveRunner
 *
 * Runs a record solve off the main thread in a Web Worker when possible, and
 * falls back to solving synchronously on the main thread when a worker isn't
 * usable (e.g. the page was loaded from file://, which browsers block workers
 * from). It encapsulates the whole worker lifecycle — spawn, readiness
 * handshake, error detection, terminate/respawn — and normalizes every outcome
 * to a single Promise so callers don't branch on worker-vs-sync.
 *
 * run(inputs) resolves to one of:
 *   { ok: true, text, solved, errors, equationVarStatus, tables }  — a result
 *   { ok: false, error }                                           — solve threw
 *   null                                                           — stopped
 *
 * `inputs` must be structured-cloneable for the worker path (text, record,
 * parsedConstants/parsedFunctions Maps, traceMode, includeTableOutputs); the
 * sync path uses the same object directly. The `syncSolve(inputs)` callback
 * (injected) performs the on-thread solve, keeping this class free of
 * solve-engine specifics and of any DOM.
 *
 * The worker announces `{ready:true}` once its modules import; a solve is only
 * routed to it once ready. On file:// the worker never becomes ready (its load
 * is blocked), so the first solve goes straight to the sync path — no waiting on
 * a worker that will never reply.
 */
class SolveRunner {
    constructor(workerUrl, syncSolve) {
        this._workerUrl = workerUrl;
        this._syncSolve = syncSolve;
        this._worker = null;
        this._ready = false;    // worker announced {ready:true} (modules imported OK)
        this._broken = false;   // worker errored — stop retrying, stay synchronous
        this._seq = 0;          // monotonic id; matches a reply to its request
        this._active = null;    // { id, inputs, resolve } for the in-flight worker solve
        this._spawn();
    }

    // True when a solve would run off-thread (worker constructed and ready).
    get async() { return !!(this._worker && this._ready); }

    // True while a worker solve is awaiting its reply — the stoppable state.
    // (Sync solves block the thread, so they're never "running" observably.)
    get running() { return this._active !== null; }

    _spawn() {
        if (this._broken) return;  // already failed once — stay synchronous
        // Browsers block loading a worker from file:// (and merely attempting it
        // logs a SecurityError on every page load), so skip straight to sync.
        if (typeof location !== 'undefined' && location.protocol === 'file:') {
            this._broken = true;
            return;
        }
        this._ready = false;
        try {
            this._worker = new Worker(this._workerUrl);
            this._worker.onmessage = (e) => this._onMessage(e);
            this._worker.onerror = (e) => this._onError(e);
        } catch (e) {
            // Constructor threw (no Worker support, or a blocking policy).
            this._worker = null;
            this._broken = true;
            console.error('Solve worker unavailable — using synchronous solve:', e);
        }
    }

    // Run a solve. Off-thread when a ready worker is available, else synchronous.
    run(inputs) {
        if (this.async) {
            return new Promise((resolve) => {
                const id = ++this._seq;
                this._active = { id, inputs, resolve };
                try {
                    this._worker.postMessage({ id, ...inputs });
                } catch (e) {
                    // Non-cloneable payload or dead worker — fall back synchronously
                    // (syncSolve takes the objects directly, so a structured-clone
                    // failure doesn't affect it).
                    console.error('Solve postMessage failed — using synchronous solve:', e);
                    this._active = null;
                    resolve(this._runSync(inputs));
                }
            });
        }
        return Promise.resolve(this._runSync(inputs));
    }

    // Stop an in-flight worker solve: terminate the worker (the only way to
    // interrupt the synchronous solve running inside it), respawn a fresh one
    // for next time, and resolve the pending run() with null. Returns false when
    // idle (nothing to stop).
    stop() {
        if (!this._active) return false;
        const { resolve } = this._active;
        this._active = null;
        if (this._worker) this._worker.terminate();
        this._worker = null;
        this._spawn();
        resolve(null);
        return true;
    }

    _runSync(inputs) {
        try {
            return { ok: true, ...this._syncSolve(inputs) };
        } catch (e) {
            return { ok: false, error: (e && e.message) || String(e) };
        }
    }

    _onMessage(e) {
        const msg = e.data;
        // Readiness handshake: posted once the worker's modules import, so we
        // know it's usable (not blocked by file://) before routing solves to it.
        if (msg && msg.ready) { this._ready = true; return; }

        // Ignore stale/mismatched replies. A terminated worker never sends, so
        // this is belt-and-suspenders against an id race.
        if (!this._active || msg.id !== this._active.id) return;
        const { resolve } = this._active;
        this._active = null;
        resolve(msg);  // { id, ok, ... } — shape matches _runSync's result
    }

    _onError(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        console.error('Solve worker error — using synchronous solve:', (e && e.message) || e);
        // The worker can't run in this environment (typically file:// blocking
        // its load). Disable it for the session; solves fall back to sync.
        this._broken = true;
        this._ready = false;
        if (this._worker) { this._worker.terminate(); this._worker = null; }
        // Replay an in-flight solve synchronously so the click isn't lost. On
        // file:// nothing is in flight (solves are ready-gated to sync), so
        // _active is null here and this no-ops.
        if (this._active) {
            const { inputs, resolve } = this._active;
            this._active = null;
            resolve(this._runSync(inputs));
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SolveRunner };
}
