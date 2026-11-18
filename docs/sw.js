/**
 * MathPad service worker — makes the app installable and usable offline.
 *
 * Network-first: when online, every request goes to the network (so a new
 * deploy is picked up on the next load, with no stale-cache mixing of old and
 * new files) and the response refreshes the cache; offline, the cached copy is
 * served. The app shell is precached on install so the app opens offline even
 * before every file has been fetched once. Same-origin GETs only: Google
 * (sign-in, Drive) goes straight to the network and degrades gracefully offline.
 *
 * SHELL lists the files the app needs to start; add new js/css files here
 * (a missing entry only affects offline use until that file is fetched once).
 */
const CACHE = 'mathpad-v1';
const SHELL = [
    './',
    'index.html',
    'help.html',
    'manifest.json',
    'MathPad.png',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'css/style.css',
    'js/theme.js',
    'js/parser.js',
    'js/line-parser.js',
    'js/evaluator.js',
    'js/solver.js',
    'js/variables.js',
    'js/storage.js',
    'js/drive.js',
    'js/editor.js',
    'js/variables-panel.js',
    'js/solve-engine.js',
    'js/solve-runner.js',
    'js/solve-worker.js',
    'js/ui.js',
    'js/app.js',
];

self.addEventListener('install', (event) => {
    // Each file on its own, so one failure doesn't abort the install
    event.waitUntil(caches.open(CACHE).then(cache => Promise.all(
        SHELL.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))
    )).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
    event.respondWith(
        fetch(req).then(res => {
            if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then(cache => cache.put(req, copy));
            }
            return res;
        }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit =>
            hit || (req.mode === 'navigate' ? caches.match('./') : Response.error())))
    );
});
