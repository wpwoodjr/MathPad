/**
 * Shared helpers for gen-expected.js and run-tests.js to capture the
 * solver's equationVarStatus map in expected-output files.
 *
 * Format: a `VarStatus = "var:state, var:state, ..."` line is injected
 * right after each record's `Status` line. Always emitted, including
 * for all-green and equation-less records — gives the test harness
 * uniform coverage of the highlighting state across every record.
 * Empty map serializes as `VarStatus = ""`. Entries are sorted by
 * variable name for stable diffs.
 */

/**
 * @param {Map<string,'solved'|'unsolved'|'partial'>} equationVarStatus
 * @returns {string} formatted line content (without the
 *   `VarStatus = "..."` wrapper). Empty string for empty/missing maps.
 */
function formatVarStatus(equationVarStatus) {
    if (!equationVarStatus || equationVarStatus.size === 0) return '';
    const entries = [...equationVarStatus.entries()];
    entries.sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([name, s]) => `${name}:${s}`).join(', ');
}

/**
 * Insert `VarStatus = "..."` lines into an exported expected file's
 * text, one per record at the position right after that record's
 * `Status` line. Records whose entry in varStatusByRecord is null are
 * skipped (no line inserted).
 *
 * @param {string} text - the output of exportToText(data)
 * @param {(string|null)[]} varStatusByRecord - one entry per record in
 *   data.records order, matching formatVarStatus() return values
 * @returns {string}
 */
function injectVarStatusLines(text, varStatusByRecord) {
    const lines = text.split('\n');
    const out = [];
    let recordIdx = 0;
    for (const line of lines) {
        out.push(line);
        if (line.startsWith('Status = ')) {
            const vs = varStatusByRecord[recordIdx];
            out.push(`VarStatus = "${vs ?? ''}"`);
        }
        // The separator marks the end of one record and the start of
        // the next — bump the index there.
        if (line.startsWith('~~~~~~~~~~~~~~~~~~~~~~~~~~~')) {
            recordIdx++;
        }
    }
    return out.join('\n');
}

module.exports = { formatVarStatus, injectVarStatusLines };
