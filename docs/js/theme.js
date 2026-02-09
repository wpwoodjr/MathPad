/**
 * MathPad Web - Theme Module
 * Handles light/dark theme detection, toggle, and persistence.
 * ES2015-safe (no arrow functions, optional chaining, or nullish coalescing).
 */
(function() {
    var STORAGE_KEY = 'mathpad_theme';
    var SUN_ICON = '\u2604'; // ☄ (comet - visible on e-ink)
    var MOON_ICON = '\u263D'; // ☽

    function getSavedTheme() {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            return null;
        }
    }

    function getSystemTheme() {
        try {
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                return 'light';
            }
        } catch (e) {
            // matchMedia not supported
        }
        return 'dark';
    }

    function getEffectiveTheme() {
        var saved = getSavedTheme();
        if (saved === 'light' || saved === 'dark') {
            return saved;
        }
        return getSystemTheme();
    }

    function applyTheme(theme) {
        if (theme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
    }

    function updateToggleButton(theme) {
        var btn = document.getElementById('btn-theme');
        if (!btn) return;
        btn.innerHTML = theme === 'light' ? MOON_ICON : SUN_ICON;
        btn.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    }

    function toggleTheme() {
        var current = getEffectiveTheme();
        var next = current === 'light' ? 'dark' : 'light';
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch (e) {
            // localStorage not available
        }
        applyTheme(next);
        updateToggleButton(next);
    }

    function listenForSystemChanges() {
        try {
            var mql = window.matchMedia('(prefers-color-scheme: light)');
            var handler = function() {
                // Only react if no saved preference
                if (!getSavedTheme()) {
                    var theme = getSystemTheme();
                    applyTheme(theme);
                    updateToggleButton(theme);
                }
            };
            // addListener is deprecated but has wider support than addEventListener
            if (mql.addEventListener) {
                mql.addEventListener('change', handler);
            } else if (mql.addListener) {
                mql.addListener(handler);
            }
        } catch (e) {
            // matchMedia not supported
        }
    }

    // Apply theme immediately to prevent flash of wrong theme
    var initialTheme = getEffectiveTheme();
    applyTheme(initialTheme);

    // Set up button and system listener once DOM is ready
    function onReady() {
        updateToggleButton(getEffectiveTheme());
        var btn = document.getElementById('btn-theme');
        if (btn) {
            btn.addEventListener('click', toggleTheme);
        }
        listenForSystemChanges();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        onReady();
    }
})();
