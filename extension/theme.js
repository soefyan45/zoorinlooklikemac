// Theme (dark, light, or following GNOME's dark mode) and accent color for the notch and the
// dock. The light look and the accent are a small stylesheet generated here and loaded on top
// of stylesheet.css (which is the dark design); the Cairo-drawn notch and the dock plate ask
// this module for their colors.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {LOG_PREFIX} from './log.js';

export const ACCENTS = {
    orange: {color: '#F05A24', on: '#0F0E12'},
    blue: {color: '#0A84FF', on: '#FFFFFF'},
    green: {color: '#30D158', on: '#0B2614'},
    purple: {color: '#BF5AF2', on: '#FFFFFF'},
    pink: {color: '#FF375F', on: '#FFFFFF'},
};

// Expanded notch surface per theme; alpha comes from the panel-opacity preference
const SURFACE = {
    dark: {fill: [6, 8, 15], edge: '#FFFFFF2E', solidTop: true},
    light: {fill: [246, 247, 250], edge: '#FFFFFFB3', solidTop: false},
};

// Content views of the expanded notch (their style classes)
const VIEWS = ['panel', 'wifi', 'list', 'notif', 'agent', 'power', 'search'];

const STYLE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'zorin-notch']);
// Stylesheets are named theme-<shell pid>-<time>.css: a nested test shell shares this folder
const PID = new Gio.Credentials().get_unix_pid();

// Remove stylesheets left by shells that ended without disabling the extension (logout, crash)
function removeStale() {
    let files;
    try {
        files = Gio.File.new_for_path(STYLE_DIR).enumerate_children('standard::name',
            Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        return;
    }
    for (const info of files) {
        const name = info.get_name();
        const owner = /^theme-(\d+)-\d+\.css$/.exec(name)?.[1];
        // Older names (theme-<time>.css) carry no pid and are always stale
        const stale = owner ? !GLib.file_test(`/proc/${owner}`, GLib.FileTest.IS_DIR)
            : /^theme-\d+\.css$/.test(name);
        if (!stale)
            continue;
        try {
            files.get_child(info).delete(null);
        } catch {}
    }
    files.close(null);
}

function rgba([r, g, b], a) {
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// "sel" for every view, scoped to the light notch
function inViews(...selectors) {
    return VIEWS.flatMap(view => selectors.map(sel => `.zorin-notch-light .zorin-notch-${view} ${sel}`.trim()))
        .join(',\n');
}

function lightCss() {
    const text = '#1D1D1F';
    const muted = 'rgba(0, 0, 0, 0.55)';
    return `
${VIEWS.map(v => `.zorin-notch-light .zorin-notch-${v}`).join(',\n')} { color: ${text}; }
${inViews('.zorin-notch-status', '.zorin-notch-icon', '.zorin-notch-status-icon', '.zorin-notch-notif-glyph',
        '.zorin-notch-search-icon', '.zorin-notch-search-glyph', '.zorin-notch-tray .panel-button',
        '.zorin-notch-tray .system-status-icon')} { color: ${text}; }
${inViews('.zorin-notch-tray .panel-button')} { background-color: rgba(0, 0, 0, 0.06); }
${inViews('.zorin-notch-tile-subtitle', '.zorin-notch-slider-value', '.zorin-notch-group-label',
        '.zorin-notch-menu-meta', '.zorin-notch-menu-trail', '.zorin-notch-list-count', '.zorin-notch-link-button',
        '.zorin-notch-agent-source', '.zorin-notch-notif-time', '.zorin-notch-notif-body', '.zorin-notch-notif-app',
        '.zorin-notch-agent-message', '.zorin-notch-list-empty')} { color: ${muted}; }
${inViews('.zorin-notch-tile', '.zorin-notch-notif-row')} {
    background-color: rgba(255, 255, 255, 0.62);
    border-color: rgba(0, 0, 0, 0.06);
}
${inViews('.zorin-notch-round-button', '.zorin-notch-pill-button', '.zorin-notch-tile-circle',
        '.zorin-notch-menu-icon', '.zorin-notch-notif-button', '.zorin-notch-switch', '.zorin-notch-notif-icon')} {
    background-color: rgba(0, 0, 0, 0.06);
    color: ${text};
}
${inViews('.zorin-notch-round-button:hover', '.zorin-notch-pill-button:hover', '.zorin-notch-tile-circle:hover',
        '.zorin-notch-notif-button:hover', '.zorin-notch-menu-item:hover')} { background-color: rgba(0, 0, 0, 0.1); }
${inViews('.zorin-notch-slider')} { -barlevel-background-color: rgba(0, 0, 0, 0.1); }
${inViews('.zorin-notch-search-entry')} { color: ${text}; }
${inViews('.zorin-notch-search-name')} { color: ${text}; }
${inViews('.zorin-notch-search-meta')} { color: ${muted}; }
${inViews('.zorin-notch-search-entry StLabel.hint-text')} { color: rgba(0, 0, 0, 0.4); }
${inViews('.zorin-notch-divider')} { background-color: rgba(0, 0, 0, 0.08); }
${inViews('.zorin-notch-media-cover')} { background-color: rgba(0, 0, 0, 0.08); color: ${muted}; }
`;
}

function accentCss(accent, light) {
    const {color, on} = accent;
    // Accent rules also in the light scope, which is more specific than the plain ones and
    // would otherwise win with its neutral control color
    const both = (...selectors) => [...selectors, ...(light ? [inViews(...selectors)] : [])].join(',\n');
    // On the dark notch the sliders stay white like the design; the light one uses the accent
    return `
${both('.zorin-notch-tile-circle:checked', '.zorin-notch-switch:checked', '.zorin-notch-menu-icon.accent',
        '.zorin-notch-unread-dot', '.zorin-notch-activity-dot:waiting')} { background-color: ${color}; }
${both('.zorin-notch-tile-circle:checked .zorin-notch-icon', '.zorin-notch-menu-icon.accent .zorin-notch-icon')} { color: ${on}; }
/* Dock dots for apps with open windows: zorin-taskbar draws them in this widget's color */
.app-grid-running-dot { background-color: ${color}; }
.zorin-notch-search-entry { caret-color: ${color}; }
.zorin-notch-search-row:selected { background-color: ${color}; }
.zorin-notch-search-row:selected .zorin-notch-search-name,
.zorin-notch-search-row:selected .zorin-notch-search-meta,
.zorin-notch-light .zorin-notch-search .zorin-notch-search-row:selected .zorin-notch-search-name,
.zorin-notch-light .zorin-notch-search .zorin-notch-search-row:selected .zorin-notch-search-meta { color: ${on}; }
${light ? `.zorin-notch-light .zorin-notch-slider { -barlevel-active-background-color: ${color}; }` : ''}
`;
}

export class ThemeManager {
    /**
     * @param {Gio.Settings} settings - the extension's settings (theme, accent)
     * @param {Function} onChange - called after the theme or accent changed
     */
    constructor(settings, onChange) {
        this._settings = settings;
        this._onChange = onChange;
        this._file = null;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

        this._settings.connectObject(
            'changed::theme', () => this._apply(),
            'changed::accent', () => this._apply(),
            'changed::panel-opacity', () => this._onChange(),
            this);
        this._interface.connectObject('changed::color-scheme', () => {
            if (this._settings.get_string('theme') === 'system')
                this._apply();
        }, this);
        // GNOME reloads its theme (e.g. a new shell theme) and drops extra stylesheets
        this._context = St.ThemeContext.get_for_stage(global.stage);
        // Loading a stylesheet emits 'changed' too: only reload into a theme we have not used yet
        this._context.connectObject('changed', () => {
            if (this._context.get_theme() !== this._loadedTheme)
                this._load();
        }, this);

        removeStale();
        this._apply();
    }

    get isLight() {
        const theme = this._settings.get_string('theme');
        if (theme === 'system')
            return this._interface.get_string('color-scheme') !== 'prefer-dark';
        return theme === 'light';
    }

    get accent() {
        return ACCENTS[this._settings.get_string('accent')] ?? ACCENTS.orange;
    }

    // Colors for the Cairo-drawn expanded notch
    get surface() {
        const surface = SURFACE[this.isLight ? 'light' : 'dark'];
        const opacity = this._settings.get_double('panel-opacity');
        const alpha = Math.round(opacity * 255).toString(16).padStart(2, '0');
        const hex = '#' + surface.fill.map(c => c.toString(16).padStart(2, '0')).join('') + alpha;
        return {fill: hex, edge: surface.edge, solidTop: surface.solidTop};
    }

    // Inline style for the dock's glass plate
    plateStyle(opacity) {
        if (opacity <= 0)
            return 'background-gradient-direction: none; border-color: transparent;';
        if (this.isLight) {
            return `background-gradient-start: ${rgba([255, 255, 255], (opacity * 1.5).toFixed(2))};` +
                ` background-gradient-end: ${rgba([236, 238, 244], (opacity * 1.4).toFixed(2))};` +
                ' border-color: rgba(255, 255, 255, 0.7);';
        }
        return `background-gradient-start: ${rgba([36, 48, 68], opacity.toFixed(2))};` +
            ` background-gradient-end: ${rgba([20, 30, 48], opacity.toFixed(2))};`;
    }

    _apply() {
        this._write();
        this._load();
        this._onChange();
    }

    _write() {
        const css = (this.isLight ? lightCss() : '') + accentCss(this.accent, this.isLight);
        GLib.mkdir_with_parents(STYLE_DIR, 0o755);
        // A new file name each time: St caches stylesheets by file
        const file = Gio.File.new_for_path(GLib.build_filenamev([STYLE_DIR, `theme-${PID}-${Date.now()}.css`]));
        try {
            file.replace_contents(new TextEncoder().encode(css), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            console.error(LOG_PREFIX, 'could not write the theme stylesheet', e);
            return;
        }
        this._unload();
        this._file?.delete(null);
        this._file = file;
    }

    _load() {
        const theme = this._context.get_theme();
        if (!theme || !this._file)
            return;
        this._loadedTheme = theme;
        try {
            theme.unload_stylesheet(this._file);
            theme.load_stylesheet(this._file);
        } catch (e) {
            console.error(LOG_PREFIX, 'could not load the theme stylesheet', e);
        }
    }

    _unload() {
        if (this._file)
            this._loadedTheme?.unload_stylesheet(this._file);
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._interface.disconnectObject(this);
        this._context.disconnectObject(this);
        this._unload();
        try {
            this._file?.delete(null);
        } catch {}
        this._file = null;
    }
}
