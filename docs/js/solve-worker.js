/**
 * MathPad Solve Worker
 *
 * Runs the pure solve off the main thread so the UI stays responsive and a
 * long solve can be stopped (the main thread terminates this worker).
 *
 * The solve modules are self-contained and free of DOM/window references, so
 * they load and run unchanged here via importScripts. storage.js is included
 * because solveRecord calls stripStaleSections; its localStorage access is all
 * inside functions (never at load), so importScripts is safe.
 *
 * Protocol:
 *   main → worker: { id, text, record, parsedConstants, parsedFunctions,
 *                    traceMode, includeTableOutputs }
 *   worker → main: { id, ok: true,  text, solved, errors, equationVarStatus, tables }
 *              or: { id, ok: false, error }
 *
 * parsedConstants / parsedFunctions are plain-data Maps (structured-cloneable).
 * The EvalContext is a class instance with methods, so it can't cross the
 * boundary — the worker builds it locally from these inputs via createEvalContext,
 * exactly as handleSolve did on the main thread.
 */

importScripts(
    'parser.js',
    'line-parser.js',
    'evaluator.js',
    'solver.js',
    'variables.js',
    'storage.js',
    'solve-engine.js'
);

self.onmessage = function(e) {
    const { id, text, record, parsedConstants, parsedFunctions, traceMode, includeTableOutputs } = e.data;

    try {
        // The two-pass solve lives in solve-engine.js (solveRecordTwoPass), shared
        // with the test scripts so the sequence isn't duplicated.
        const out = solveRecordTwoPass(text, record, parsedConstants, parsedFunctions, {
            traceMode,
            includeTableOutputs
        });
        self.postMessage({ id, ok: true, ...out });
    } catch (err) {
        self.postMessage({ id, ok: false, error: (err && err.message) || String(err) });
    }
};

// Announce readiness: reaching here means importScripts above succeeded, so the
// main thread knows the worker is usable (not blocked by file://) and can route
// solves to it. If the import failed, this line never runs and the main thread
// sees the worker's onerror instead and falls back to a synchronous solve.
self.postMessage({ ready: true });
