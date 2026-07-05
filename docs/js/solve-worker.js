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
        // Mirror handleSolve's two-pass solve (first pass skips tables; the
        // re-solve computes them and gives cleared variables a second chance).
        const parserTokens = new Tokenizer(text).tokenize();
        const context = createEvalContext(record, parsedConstants, parsedFunctions, text, parserTokens);
        const result = solveRecord(text, context, record, parserTokens, true, traceMode, includeTableOutputs);

        let outText = result.text;
        const verifyTokens = new Tokenizer(outText).tokenize();
        const verifyContext = createEvalContext(record, parsedConstants, parsedFunctions, outText, verifyTokens);
        verifyContext.preSolveValues = context.preSolveValues; // preserve x~ values so counters don't double-increment
        const verifyResult = solveRecord(outText, verifyContext, record, verifyTokens, false, false, includeTableOutputs);
        outText = verifyResult.text;

        // Re-append the first-pass trace (the re-solve strips it).
        if (traceMode && result.trace && result.trace.length > 0) {
            outText = appendTraceSection(outText, result.trace);
        }

        self.postMessage({
            id,
            ok: true,
            text: outText,
            solved: result.solved,               // first-pass count drives the status message
            errors: verifyResult.errors,
            equationVarStatus: verifyResult.equationVarStatus,
            tables: verifyResult.tables || []
        });
    } catch (err) {
        self.postMessage({ id, ok: false, error: (err && err.message) || String(err) });
    }
};
