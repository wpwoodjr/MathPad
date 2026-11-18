#!/usr/bin/env node
/**
 * Variables-panel browser tests (editable outputs / given outputs).
 *
 * Drives the real app in headless Chromium over the DevTools protocol: starts
 * its own no-cache static server for docs/, launches Chromium with a fresh
 * profile (fresh seeded records), and runs the scenarios below. Each check
 * polls for its condition rather than sleeping a fixed time.
 *
 * Usage: node tests/run-panel-tests.js [-v]
 *   CHROME=/path/to/chromium   to pick the browser (default: first found on PATH)
 * Needs Chromium/Chrome and a global WebSocket (Node 22+, or Node 20/21, where
 * this script re-runs itself with --experimental-websocket).
 * Prints SKIP and exits 0 when no browser is found.
 */
const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

if (typeof WebSocket === 'undefined') {
    const r = spawnSync(process.execPath, ['--experimental-websocket', '--no-warnings', __filename, ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
}

const VERBOSE = process.argv.includes('-v');
const DOCS = path.join(__dirname, '..', 'docs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
    if (process.env.CHROME) return process.env.CHROME;
    for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']) {
        try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch { /* next */ }
    }
    for (const p of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                     '/Applications/Chromium.app/Contents/MacOS/Chromium']) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function startServer() {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
                    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
    const server = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p.endsWith('/')) p += 'index.html';
        const file = path.join(DOCS, path.normalize(p));
        if (!file.startsWith(DOCS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404); res.end(); return;
        }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// ---------------------------------------------------------------- CDP client
class Page {
    constructor(ws) {
        this.ws = ws; this.id = 0; this.pending = new Map();
        ws.onmessage = m => {
            const d = JSON.parse(m.data);
            const p = this.pending.get(d.id);
            if (p) { this.pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); }
        };
    }
    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++this.id;
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    async eval(expr) {
        const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(`${expr.slice(0, 80)}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
        return r.result.value;
    }
    async key(key, { shift = false } = {}) {
        const codes = { Enter: 13, Escape: 27, Tab: 9 };
        const p = { key, code: key, windowsVirtualKeyCode: codes[key], modifiers: shift ? 8 : 0 };
        await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...p });
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
    }
    insertText(text) { return this.send('Input.insertText', { text }); }
}

// In-page helpers (installed after each load)
const HELPERS = `
window.__t = {
    row(n) {
        return [...this.panel().container.querySelectorAll('.variable-row')].find(r =>
            r.querySelector('.variable-name-text')?.textContent.trim().split(/\\s+/).pop() === n);
    },
    field(n) { return this.row(n)?.querySelector('input'); },
    // given-look: input styling (no variable-value-output) + as-input row
    st(n) {
        const r = this.row(n), i = r?.querySelector('input');
        if (!i) return null;
        const btn = r.querySelector('.variable-solve-btn');
        const nameColor = getComputedStyle(r.querySelector('.variable-name')).color;
        const probe = document.createElement('span');
        probe.style.color = 'var(--success-color)'; document.body.appendChild(probe);
        const green = getComputedStyle(probe).color; probe.remove();
        return {
            value: i.value,
            look: !i.classList.contains('variable-value-output') && r.classList.contains('as-input'),
            btn: !!btn && !btn.classList.contains('variable-solve-btn-hidden'),
            green: nameColor === green,
            solved: r.classList.contains('has-solved'),
            ending: r.classList.contains('given-ending'),
        };
    },
    givens() { return [...this.panel().givenOutputNames()].sort().join(','); },
    panel() { return UIState.editors.get(UIState.currentRecordId).variablesManager; },
    // the active record's formulas textarea (other open tabs have hidden ones)
    textarea() { return [...document.querySelectorAll('textarea')].find(t => t.offsetParent); },
    status() { return document.getElementById('status-text').textContent; },
};
true`;

// ---------------------------------------------------------------- harness
const results = [];
let current = null;

async function waitFor(page, expr, timeout = 4000) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
        try { last = await page.eval(expr); if (last) return true; } catch (e) { last = e.message; }
        await sleep(50);
    }
    return false;
}

async function check(page, desc, expr, timeout) {
    const ok = await waitFor(page, expr, timeout);
    if (!ok) {
        let detail = '';
        try { detail = JSON.stringify(await page.eval(`(() => { const o = {}; for (const r of __t.panel().container.querySelectorAll('.variable-row')) { const n = r.querySelector('.variable-name-text')?.textContent.trim().split(/\\s+/).pop(); if (n && __t.st(n)) o[n] = __t.st(n); } return { rows: o, givens: __t.givens(), status: __t.status() }; })()`)); } catch { /* ignore */ }
        current.failures.push(`${desc}\n      state: ${detail}`);
    } else if (VERBOSE) console.log(`    ok: ${desc}`);
}

// Checks that something does NOT become true within a short window
async function checkStays(page, desc, expr, ms = 600) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (!(await page.eval(expr))) { current.failures.push(desc); return; }
        await sleep(50);
    }
    if (VERBOSE) console.log(`    ok: ${desc}`);
}

async function scenario(name, fn, page) {
    current = { name, failures: [] };
    if (VERBOSE) console.log(`  ${name}`);
    try { await fn(page); } catch (e) { current.failures.push(`threw: ${e.stack || e.message}`); }
    results.push(current);
}

// ---------------------------------------------------------------- actions
const S = n => `__t.st(${JSON.stringify(n)})`;

async function setText(page, text) {
    await page.eval(`(() => { const ta = __t.textarea(); ta.focus(); ta.value = ${JSON.stringify(text)};
        ta.dispatchEvent(new Event('input', { bubbles: true })); ta.blur();
        flushPendingVarsUpdates(); })()`);  // run the debounced panel update now, not mid-scenario
}
async function type(page, name, text) {
    await page.eval(`(() => { const i = __t.field(${JSON.stringify(name)}); i.focus(); i.select(); })()`);
    await page.insertText(text);
}
// Focus a field and delete its contents, as typing would
async function clearField(page, name) {
    await type(page, name, 'x');
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
}
const blur = (page, name) => page.eval(`__t.field(${JSON.stringify(name)}).blur()`);
const click = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
const solve = page => click(page, '#btn-solve');
// Marks the status text to detect whether a solve runs. Also marks the saved
// persistent status, which the Drive status flash (drive.js) restores into the
// status bar on a timer — otherwise that restore would erase the mark.
const markStatus = page => page.eval(`(() => {
    document.getElementById('status-text').textContent = '__mark__';
    UI.lastPersistentStatus = { message: '__mark__', isError: false };
})()`);
const btnOf = n => `__t.row(${JSON.stringify(n)}).querySelector('.variable-solve-btn')`;

async function openRecord(page, title) {
    await page.eval(`(() => { const it = [...document.querySelectorAll('.record-item')].find(e => e.textContent.trim() === ${JSON.stringify(title)}); it.click(); })()`);
}

// A real mouse press (pointerdown then click), like the user's
async function mouseClick(page, elemExpr) {
    const { x, y } = await page.eval(`(() => { const r = ${elemExpr}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
}

async function tap(page, elemExpr) {
    const { x, y } = await page.eval(`(() => { const r = ${elemExpr}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(30);
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// ---------------------------------------------------------------- scenarios
const SCENARIOS = [
    ['Length Conversions: enter one value, Enter; a second entry replaces it', async p => {
        await openRecord(p, 'Length Conversions');
        await check(p, 'record open', `!!__t.field('feet')`);
        await type(p, 'feet', '3');
        await check(p, 'typing feet: input look, green name, ⟲', `${S('feet')}.look && ${S('feet')}.green && ${S('feet')}.btn`);
        await check(p, 'inches still plain while typing feet', `!${S('inches')}.look && !${S('inches')}.btn`);
        await p.key('Enter');
        await check(p, 'inches = 36, yards = 1', `${S('inches')}.value === '36' && ${S('yards')}.value === '1'`);
        await check(p, 'feet is the given, solved', `__t.givens() === 'feet' && ${S('feet')}.solved && ${S('feet')}.look && ${S('feet')}.btn`);
        await check(p, 'other outputs plain', `!${S('inches')}.look && !${S('inches')}.btn && !${S('inches')}.solved`);
        await type(p, 'yards', '2');
        await check(p, 'typing yards after the solve: feet shown ending', `${S('feet')}.ending && !${S('feet')}.look && !${S('feet')}.btn && ${S('yards')}.look`);
        await p.key('Enter');
        await check(p, 'feet = 6, inches = 72', `${S('feet')}.value === '6' && ${S('inches')}.value === '72'`);
        await check(p, 'yards is now the only given', `__t.givens() === 'yards' && !${S('feet')}.look`);
        await solve(p);
        await check(p, 'plain Solve keeps yards', `__t.givens() === 'yards' && ${S('feet')}.value === '6' && /Solved/.test(__t.status())`);
    }],

    ['Multiple givens: w and h entered, area derived; undo/redo; new set after a solve', async p => {
        await setText(p, '--Variables--\nw->\nh->\narea->\n\narea = w*h');
        await check(p, 'rows', `!!__t.field('area')`);
        await type(p, 'w', '2'); await blur(p, 'w');
        await check(p, 'w given after click away (no solve)', `__t.givens() === 'w' && ${S('w')}.look && ${S('w')}.btn && ${S('area')}.value === ''`);
        await type(p, 'h', '3');
        await check(p, 'typing h before a solve: w stays a given (not ending)', `${S('w')}.look && !${S('w')}.ending && ${S('h')}.look`);
        await p.key('Enter');
        await check(p, 'area = 6, w and h givens', `${S('area')}.value === '6' && __t.givens() === 'h,w' && ${S('w')}.solved && ${S('h')}.solved`);
        await solve(p);
        await check(p, 'plain Solve keeps both', `/Solved/.test(__t.status()) && __t.givens() === 'h,w' && ${S('area')}.value === '6'`);
        await type(p, 'area', '12');
        await check(p, 'typing area: w and h shown ending', `${S('w')}.ending && ${S('h')}.ending && !${S('w')}.btn && ${S('area')}.look`);
        await p.key('Escape');
        await check(p, 'Escape: w and h givens again, area unchanged', `!${S('w')}.ending && ${S('w')}.look && ${S('h')}.look && ${S('area')}.value === '6' && !${S('area')}.look`);
        await click(p, '#btn-undo');
        await check(p, 'undo the solve: w and h still givens, area empty', `${S('area')}.value === '' && __t.givens() === 'h,w' && ${S('w')}.look && ${S('h')}.look`);
        await click(p, '#btn-redo');
        await check(p, 'redo: solved state back', `${S('area')}.value === '6' && __t.givens() === 'h,w' && ${S('w')}.solved`);
        await type(p, 'area', '12'); await blur(p, 'area');
        await check(p, 'area entered: w and h end, area the only given', `__t.givens() === 'area' && !${S('w')}.look && !${S('h')}.look`);
        await type(p, 'w', '3'); await p.key('Enter');
        await check(p, 'area and w givens → h = 4', `${S('h')}.value === '4' && __t.givens() === 'area,w' && !${S('h')}.look`);
    }],

    ['Converter with a parameter: input entry ends the given', async p => {
        await setText(p, '--Variables--\nusd->\neur->\nrate: 0.9\n\neur = usd*rate');
        await check(p, 'rows', `!!__t.field('rate')`);
        await type(p, 'usd', '100'); await p.key('Enter');
        await check(p, 'eur = 90, usd given', `${S('eur')}.value === '90' && __t.givens() === 'usd'`);
        await type(p, 'rate', '0.95');
        await check(p, 'typing rate: usd ending', `${S('usd')}.ending && !${S('usd')}.look && !${S('usd')}.btn`);
        await p.key('Escape');
        await check(p, 'Escape: usd given again', `!${S('usd')}.ending && ${S('usd')}.look && __t.givens() === 'usd'`);
        await type(p, 'rate', '0.9'); await blur(p, 'rate');
        await check(p, 'rate retyped to the same value: still an edit, usd given ended', `__t.givens() === '' && !${S('usd')}.look && !${S('usd')}.green`);
        await type(p, 'usd', '100'); await p.key('Enter');
        await check(p, 'usd given again', `__t.givens() === 'usd' && ${S('eur')}.value === '90'`);
        await type(p, 'rate', '0.95'); await blur(p, 'rate');
        await check(p, 'rate committed: usd given ended', `__t.givens() === '' && !${S('usd')}.look && !${S('usd')}.green`);
    }],

    ['Goal seek: enter an output, ⟲ an input; changing an input solves forward', async p => {
        await setText(p, '--Variables--\nprice: 10\nqty<- 5\ntotal->\n\ntotal = price*qty');
        await check(p, 'rows', `!!__t.field('total')`);
        await solve(p);
        await check(p, 'total = 50', `${S('total')}.value === '50'`);
        await type(p, 'total', '200'); await blur(p, 'total');
        await check(p, 'total given', `__t.givens() === 'total'`);
        await p.eval(`${btnOf('qty')}.click()`);
        await check(p, 'goal seek: qty = 20, total kept', `${S('qty')}.value === '20' && ${S('total')}.value === '200' && __t.givens() === 'total'`);
        await type(p, 'price', '20'); await p.key('Enter');
        await check(p, 'price changed: given ended, total = 400 forward', `${S('total')}.value === '400' && __t.givens() === ''`);
    }],

    ['Retyping an output\'s value makes it a given, and Enter solves from it', async p => {
        await setText(p, '--Variables--\na->\nb->\n\nb = a*2');
        await check(p, 'rows', `!!__t.field('b')`);
        await type(p, 'a', '5'); await p.key('Enter');
        await check(p, 'b = 10', `${S('b')}.value === '10' && __t.givens() === 'a'`);
        await markStatus(p);
        await type(p, 'b', '10'); await p.key('Enter');
        await check(p, 'Enter solved from b: a = 5, b the given', `__t.status() !== '__mark__' && /Solved/.test(__t.status()) && ${S('a')}.value === '5' && __t.givens() === 'b' && ${S('b')}.solved`);
        await type(p, 'a', '5'); await blur(p, 'a');
        await check(p, 'retyping a (after the success): b ended, a the given', `__t.givens() === 'a' && !${S('b')}.look`);
        await solve(p);
        await check(p, 'Solve from a: b = 10', `${S('b')}.value === '10' && __t.givens() === 'a'`);
        await markStatus(p);
        await type(p, 'a', '5'); await p.key('Enter');
        await check(p, 'retyping the given itself + Enter: an edit, solves (a still the given)', `__t.status() !== '__mark__' && __t.givens() === 'a' && ${S('b')}.value === '10'`);
        await type(p, 'b', '7'); await p.key('Escape');
        await check(p, 'Escape after typing in b: value reverted, b not a given, a still is', `${S('b')}.value === '10' && __t.givens() === 'a' && !${S('b')}.look && ${S('a')}.look`);
    }],

    ['Clearing an output: after a success it ends the givens; after a failure it drops just it', async p => {
        await setText(p, '--Variables--\nw->\nh->\narea->\n\narea = w*h');
        await check(p, 'rows', `!!__t.field('area')`);
        await type(p, 'h', '3'); await blur(p, 'h');
        await type(p, 'area', '6'); await p.key('Enter');
        await check(p, 'w = 2, givens h and area', `${S('w')}.value === '2' && __t.givens() === 'area,h'`);
        await clearField(p, 'w');
        await check(p, 'w blank while typing: h and area shown ending, w plain', `${S('h')}.ending && ${S('area')}.ending && !${S('w')}.look && !${S('w')}.btn`);
        await p.key('Escape');
        await check(p, 'Escape: w back to 2, h and area givens', `${S('w')}.value === '2' && __t.givens() === 'area,h' && ${S('h')}.look && !${S('h')}.ending`);
        await clearField(p, 'w'); await blur(p, 'w');
        await check(p, 'w cleared (click away): givens ended', `${S('w')}.value === '' && __t.givens() === '' && !${S('h')}.look`);
        // after a failed solve: clearing a given drops just it
        await type(p, 'h', '3'); await blur(p, 'h');
        await type(p, 'w', '2'); await blur(p, 'w');
        await type(p, 'area', '7'); await p.key('Enter');
        await check(p, 'over-determined error', `/balance/i.test(__t.status()) && __t.givens() === 'area,h,w'`);
        await clearField(p, 'area');
        await check(p, 'clearing given area after the error: area shown ending, h and w not', `${S('area')}.ending && !${S('area')}.look && ${S('h')}.look && !${S('h')}.ending`);
        await p.key('Enter');
        await check(p, 'Enter: area = 6 from h and w', `${S('area')}.value === '6' && __t.givens() === 'h,w'`);
        await click(p, '#btn-undo');
        await check(p, 'undo the solve: area blank, h and w givens', `${S('area')}.value === '' && __t.givens() === 'h,w'`);
    }],

    ['⟲ on a given (not just typed) solves for it, like an input\'s ⟲', async p => {
        await setText(p, '--Variables--\nw->\nh->\narea->\n\narea = w*h');
        await check(p, 'rows', `!!__t.field('area')`);
        await type(p, 'h', '3'); await blur(p, 'h');
        await type(p, 'w', '2'); await blur(p, 'w');
        await type(p, 'area', '7'); await p.key('Enter');
        await check(p, 'over-determined: error, all three givens', `/balance/i.test(__t.status()) && __t.givens() === 'area,h,w'`);
        await p.eval(`${btnOf('area')}.click()`);
        await check(p, 'area ⟲: area = 6 derived, h and w givens', `${S('area')}.value === '6' && __t.givens() === 'h,w' && !${S('area')}.look && /Solved/.test(__t.status())`);
        await click(p, '#btn-undo');
        await check(p, 'undo: area 7 a given again', `${S('area')}.value === '7' && __t.givens() === 'area,h,w'`);
    }],

    ['After a failed solve, entries keep the givens', async p => {
        await setText(p, '--Variables--\nw->\nh->\narea->\n\narea = w*h');
        await check(p, 'rows', `!!__t.field('area')`);
        await type(p, 'h', '2'); await blur(p, 'h');
        await type(p, 'w', '3'); await blur(p, 'w');
        await type(p, 'area', '7'); await p.key('Enter');
        await check(p, 'over-determined: error', `/balance/i.test(__t.status()) && __t.givens() === 'area,h,w'`);
        await type(p, 'area', '6');
        await check(p, 'typing after the error: nothing shown ending', `!${S('h')}.ending && !${S('w')}.ending && ${S('h')}.look`);
        await p.key('Enter');
        // (all three given and balanced: the app reports "Nothing to solve")
        await check(p, 'fixed area to 6: balances, all three still givens', `/Solved|Nothing to solve/.test(__t.status()) && __t.givens() === 'area,h,w' && ${S('h')}.solved`);
        // too few givens: an entry after the error adds to them
        await setText(p, '--Variables--\nw->\nh->\narea->\n\narea = w*h');
        await check(p, 'rows again', `${S('area')}.value === '' && __t.givens() === ''`);
        await type(p, 'h', '2'); await p.key('Enter');
        await check(p, 'only h: unknowns error', `/unknown/i.test(__t.status()) && __t.givens() === 'h'`);
        await type(p, 'w', '3'); await p.key('Enter');
        await check(p, 'w added to h: area = 6', `${S('area')}.value === '6' && __t.givens() === 'h,w'`);
        // after that success, an entry starts a new set again
        await type(p, 'area', '12'); await blur(p, 'area');
        await check(p, 'after a success: new set', `__t.givens() === 'area'`);
    }],

    ['A panel entry right after a formula edit survives the debounced panel update', async p => {
        await setText(p, '--Variables--\nw->\nh->\narea->\n\narea = w*h');
        await check(p, 'rows', `!!__t.field('area')`);
        await p.eval(`(() => { const ta = __t.textarea(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); })()`);
        await p.insertText(' ');  // schedules the 500ms panel update
        await type(p, 'h', '3'); await blur(p, 'h');
        await type(p, 'w', '2'); await blur(p, 'w');
        await sleep(800);  // past the debounce
        await check(p, 'h and w kept their values and stayed givens', `${S('h')}.value === '3' && ${S('w')}.value === '2' && __t.givens() === 'h,w' && /h-> 3/.test(__t.textarea().value)`);
        await solve(p);
        await check(p, 'Solve: area = 6', `${S('area')}.value === '6' && __t.givens() === 'h,w'`);
    }],

    ['Tab only moves; Enter solves when anything changed since the last solve', async p => {
        await setText(p, '--Variables--\nw->\nh->\narea->\n\narea = w*h');
        await check(p, 'rows', `!!__t.field('area')`);
        await markStatus(p);
        await type(p, 'w', '2'); await p.key('Tab');
        await check(p, 'Tab moved to h', `document.activeElement === __t.field('h')`);
        await p.insertText('3'); await p.key('Tab');
        await check(p, 'Tab moved to area', `document.activeElement === __t.field('area')`);
        await checkStays(p, 'no solve on Tab', `__t.status() === '__mark__' && ${S('area')}.value === ''`);
        await p.key('Enter');
        await check(p, 'Enter in untouched area: earlier entries count → area = 6', `${S('area')}.value === '6' && __t.givens() === 'h,w'`);
        await markStatus(p);
        await p.eval(`__t.field('h').focus()`); await p.key('Enter');
        await checkStays(p, 'Enter with nothing changed: no solve', `__t.status() === '__mark__' && __t.givens() === 'h,w'`);
        // an input typed back to its value after a success: ends the givens, Enter solves
        await setText(p, '--Variables--\nprice: 10\nqty<- 5\ntotal->\n\ntotal = price*qty');
        await check(p, 'rows 2', `!!__t.field('total')`);
        await type(p, 'total', '200'); await blur(p, 'total');
        await p.eval(`${btnOf('qty')}.click()`);
        await check(p, 'goal seek: qty = 20', `${S('qty')}.value === '20' && __t.givens() === 'total'`);
        await markStatus(p);
        await type(p, 'price', '10'); await p.key('Enter');
        await check(p, 'price retyped + Enter: given ended and solved forward (total = 200)', `__t.status() !== '__mark__' && __t.givens() === '' && ${S('total')}.value === '200' && !${S('total')}.look`);
    }],

    ['Persistent outputs (:>) are editable but never givens: the entry is what x~ reads', async p => {
        await setText(p, '--Variables--\nn:>\nprice<- 20\nqty<- 3\ntotal:>\n\nn = if(n~?; n~ + 1; 1)\ntotal = price*qty');
        await check(p, 'rows', `!!__t.field('n') && !__t.field('n').readOnly`);
        await solve(p);
        await check(p, 'n = 1, total = 60', `${S('n')}.value === '1' && ${S('total')}.value === '60'`);
        await solve(p);
        await check(p, 'n = 2', `${S('n')}.value === '2'`);
        await type(p, 'n', '10');
        await check(p, 'typing in n: output look, no ⟲', `!${S('n')}.look && !${S('n')}.btn && !${S('n')}.green`);
        await p.key('Enter');
        await check(p, 'Enter: solved from n~ = 10 → n = 11, not a given', `${S('n')}.value === '11' && __t.givens() === ''`);
        await type(p, 'total', '100'); await p.key('Enter');
        await check(p, 'entry into a :> total is recomputed: 60', `${S('total')}.value === '60' && __t.givens() === ''`);
        await click(p, '#btn-clear');
        await check(p, 'Clear keeps :> values (n = 12 after the total solve), clears <- inputs', `${S('n')}.value === '12' && ${S('total')}.value === '60' && __t.field('price').value === ''`);
    }],

    ['A formula edit ends the givens immediately', async p => {
        await setText(p, '--Variables--\na->\nb->\n\nb = a*2');
        await check(p, 'rows', `!!__t.field('b')`);
        await type(p, 'a', '5'); await p.key('Enter');
        await check(p, 'a given', `__t.givens() === 'a' && ${S('b')}.value === '10'`);
        await p.eval(`(() => { const ta = __t.textarea(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); })()`);
        await p.insertText(' ');
        await check(p, 'given gone within 100ms (before the debounced update)', `__t.givens() === '' && !${S('a')}.look`, 100);
        await solve(p);
        await check(p, 'Solve now has no given', `/unknown/i.test(__t.status())`);
    }],

    ['Touch: type a value, tap the output\'s ⟲', async p => {
        await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        await setText(p, '--Variables--\na->\nb->\n\nb = a*2');
        await check(p, 'rows', `!!__t.field('b')`);
        await check(p, 'output ⟲ hidden at rest', `!${S('a')}.btn`);
        await type(p, 'a', '4');
        await check(p, '⟲ shown while typing', `${S('a')}.btn`);
        await tap(p, btnOf('a'));
        await check(p, 'tap solved from the typed value: b = 8', `${S('b')}.value === '8' && __t.givens() === 'a' && ${S('a')}.btn`);
        await tap(p, btnOf('b'));  // hidden: b isn't a given — nothing happens
        await type(p, 'b', '10'); await tap(p, btnOf('b'));
        await check(p, 'typed b, tapped its ⟲: a = 5, b the given', `${S('a')}.value === '5' && __t.givens() === 'b'`);
        await p.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }],

    ['Failed solve whose error is elsewhere: the given stays (not just the failing equation\'s vars)', async p => {
        const rec = '--Variables--\nx = sqrt(y)\nx:\ny:\n\nv = x*y\nv->';
        for (const which of ['x', 'y']) {
            await setText(p, rec);
            await check(p, 'rows', `!!__t.field('v')`);
            await type(p, 'x', '7'); await p.key('Enter');
            await check(p, 'y = 49, v = 343', `${S('y')}.value === '49' && ${S('v')}.value === '343'`);
            await type(p, 'v', '17');
            await mouseClick(p, btnOf(which));
            await check(p, `${which} ⟲: fails, v still the given`, `/doesn't balance/.test(__t.status()) && __t.givens() === 'v' && ${S('v')}.value === '17' && ${S('v')}.look`);
        }
        // y ⟲ case: the error is on line 2 (x = sqrt(y)), which doesn't involve v
        await solve(p);
        await check(p, 'plain Solve keeps v (not cleared)', `${S('v')}.value === '17' && __t.givens() === 'v'`);
        await click(p, '#btn-undo');
        await check(p, 'undo: y back to 49, v the given', `${S('y')}.value === '49' && __t.givens() === 'v'`);
        await click(p, '#btn-redo');
        await check(p, 'redo: the failed solve again, v still the given', `${S('y')}.value !== '49' && __t.givens() === 'v' && ${S('v')}.look`);
        // v's ⟲ solves for v (7 × 2.43); line 2 still fails, so v stays a given
        await mouseClick(p, btnOf('v'));
        await check(p, 'v ⟲ with errors left: v re-derived, still the given', `${S('v')}.value !== '17' && ${S('v')}.value !== '' && __t.givens() === 'v' && /doesn't balance/.test(__t.status())`);
        await solve(p);
        await check(p, 'plain Solve keeps the re-derived v', `${S('v')}.value !== '17' && ${S('v')}.value !== '' && __t.givens() === 'v'`);
    }],

    ['Tab stops: inputs and given outputs, not plain outputs (all outputs when there are no inputs)', async p => {
        await setText(p, '--Variables--\na: 1\nb->\nc: 2\n\nb = a + c');
        await check(p, 'rows', `!!__t.field('c')`);
        await type(p, 'a', '1'); await p.key('Tab');
        await check(p, 'Tab from a skips plain output b → c', `document.activeElement === __t.field('c')`);
        await p.key('Tab');
        await check(p, 'Tab from c wraps to a', `document.activeElement === __t.field('a')`);
        await p.key('Tab', { shift: true });
        await check(p, 'Shift+Tab from a → c', `document.activeElement === __t.field('c')`);
        await type(p, 'b', '5'); await p.key('Tab');
        await check(p, 'Tab from the output being typed → c', `document.activeElement === __t.field('c')`);
        await p.key('Tab', { shift: true });
        await check(p, 'b is a given now: Shift+Tab from c → b', `document.activeElement === __t.field('b') && __t.givens() === 'b'`);
    }],

    ['Entries survive: an unchanged typed field, a stopped solve; Tab on a lone stop; an output displaying an input is read-only', async p => {
        await setText(p, '--Variables--\nfeet->\ninches->\n\ninches = feet*12');
        await check(p, 'rows', `!!__t.field('inches')`);
        await type(p, 'feet', '3'); await p.key('Tab');
        await check(p, 'Tab → inches', `document.activeElement === __t.field('inches')`);
        await p.insertText('5');
        await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await p.key('Enter');
        await check(p, 'typing and erasing in inches keeps feet the given: inches = 36', `${S('inches')}.value === '36' && __t.givens() === 'feet'`);

        await type(p, 'inches', '24'); await blur(p, 'inches');
        await check(p, 'inches entered', `__t.givens() === 'inches'`);
        const stopped = await p.eval(`(() => { if (!solveRunner.async) return false; handleSolve(); stopSolve(); return true; })()`);
        if (stopped) {
            await check(p, 'solve stopped', `/stopped/.test(__t.status())`);
            await check(p, 'stopped solve: inches still the given', `__t.givens() === 'inches' && ${S('inches')}.look`);
            await solve(p);
            await check(p, 'the next Solve uses it: feet = 2', `${S('feet')}.value === '2'`);
        } else current.failures.push('solve runner not async (worker unavailable) — stop path not tested');

        await setText(p, '--Variables--\nx: 1\ny->\n\ny = x*2');
        await check(p, 'rows', `!!__t.field('y')`);
        await type(p, 'x', '1'); await p.key('Tab');
        await check(p, 'Tab with x the only stop: focus stays on x', `document.activeElement === __t.field('x')`);
        await blur(p, 'x');

        // x-> displays the input x (declared above the marker too): read-only;
        // a formula edit that adds/removes the input rebuilds the row
        await setText(p, 'x: 5\n--Variables--\nx->\ny->\n\ny = x*2');
        await check(p, 'rows', `!!__t.field('y')`);
        await check(p, 'x-> displaying input x is read-only, no ⟲', `__t.field('x').readOnly && !${S('x')}.btn`);
        await solve(p);
        await check(p, 'solves: x shows 5, y = 10', `${S('x')}.value === '5' && ${S('y')}.value === '10'`);
        await setText(p, '// x: 5\n--Variables--\nx->\ny->\n\ny = x*2');  // same lines, input commented out
        await check(p, 'without the input, x-> is an editable output', `!__t.field('x').readOnly`);
    }],

    ['Pressing the panel right after a line-shifting formula edit (mouse)', async p => {
        await setText(p, '--Variables--\nx: 1\ny->\n\ny = x*2');
        await check(p, 'rows', `!!__t.field('x')`);
        await p.eval(`(() => { const ta = __t.textarea(); ta.focus(); ta.value = 'z = 1\\n' + ta.value; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await mouseClick(p, `__t.field('x')`);
        await check(p, 'the click focuses x (its row was rebuilt under the press)', `document.activeElement === __t.field('x')`);
        await blur(p, 'x');
        await p.eval(`(() => { const ta = __t.textarea(); ta.focus(); ta.value = 'w = 1\\n' + ta.value; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await markStatus(p);
        await mouseClick(p, btnOf('x'));
        await check(p, 'the click on ⟲ solves', `__t.status() !== '__mark__' && !/Solving/.test(__t.status())`);
    }],

    ['Clear ends the givens', async p => {
        await setText(p, '--Variables--\na->\nb->\n\nb = a*2');
        await check(p, 'rows', `!!__t.field('b')`);
        await type(p, 'a', '5'); await p.key('Enter');
        await check(p, 'a given', `__t.givens() === 'a'`);
        await click(p, '#btn-clear');
        await check(p, 'cleared, no givens', `__t.givens() === '' && ${S('a')}.value === '' && !${S('a')}.look`);
    }],
];

// ---------------------------------------------------------------- main
(async () => {
    const chrome = findChrome();
    if (!chrome) { console.log('SKIP: no Chromium/Chrome found (set CHROME=/path/to/browser)'); return; }

    const server = await startServer();
    const port = server.address().port;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mathpad-panel-'));
    const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
        '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,1000', 'about:blank'],
        { stdio: 'ignore' });
    const cleanup = () => {
        try { proc.kill('SIGKILL'); } catch { /* gone */ }
        server.close();
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    };

    let exitCode = 1;
    try {
        const portFile = path.join(profile, 'DevToolsActivePort');
        let devPort;
        for (let i = 0; i < 100 && !devPort; i++) {
            if (fs.existsSync(portFile)) devPort = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
            if (!devPort) await sleep(100);
        }
        if (!devPort) throw new Error('Chromium did not start (no DevToolsActivePort)');
        const tabs = await (await fetch(`http://127.0.0.1:${devPort}/json`)).json();
        const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        const page = new Page(ws);
        await page.send('Page.enable');
        await page.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
        const loaded = await waitFor(page, `typeof UIState !== 'undefined' && !!document.querySelector('.record-item')`, 10000);
        if (!loaded) throw new Error('app did not load');
        await page.eval(HELPERS);
        if (!(await page.eval(`!!__t.panel()`))) throw new Error('could not find the variables panel object');

        for (const [name, fn] of SCENARIOS) await scenario(name, fn, page);

        let passed = 0, failed = 0;
        for (const r of results) {
            if (r.failures.length === 0) { console.log(`PASS: ${r.name}`); passed++; }
            else {
                console.log(`FAIL: ${r.name}`);
                for (const f of r.failures) console.log(`    ${f}`);
                failed++;
            }
        }
        console.log(`\n${passed} passed, ${failed} failed`);
        exitCode = failed > 0 ? 1 : 0;
        ws.close();
    } catch (e) {
        console.error(`ERROR: ${e.message}`);
    } finally {
        cleanup();
    }
    process.exit(exitCode);
})();
