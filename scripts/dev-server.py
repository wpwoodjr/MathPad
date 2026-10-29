#!/usr/bin/env python3
"""
MathPad local dev server: serves docs/ with browser caching disabled.

Use this instead of `python3 -m http.server`, which sends no cache headers —
browsers then cache heuristically and can keep running OLD copies of the
scripts the solve Web Worker loads via importScripts (even after a hard
reload), mixing old and new code. `Cache-Control: no-store` forces a fresh
fetch of every file on every load.

Usage: python3 scripts/dev-server.py [port]   (default 8000)
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    docs = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs')
    handler = functools.partial(NoCacheHandler, directory=os.path.normpath(docs))
    server = http.server.ThreadingHTTPServer(('', port), handler)
    print(f'Serving {os.path.normpath(docs)} at http://localhost:{port}/ (no-cache)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
