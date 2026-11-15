// Look of the top bar's glass (Preferences > Menu bar, Pego "Preferences · tampilan Menu bar"):
// glass style, tint, transparency, background blur, bottom edge, and when it turns solid or
// switches to dark text. The bar (topbar.js) and the preview in the preferences both use it.
//
// No GNOME Shell imports here: the preferences window uses this module too.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

export const GLASS_STYLES = {
    // Picking a style sets these; the sliders and the tint can change them afterwards
    clear: {tint: '#0B0F1A', transparency: 80, blur: 12},
    frost: {tint: '#F5F5F5', transparency: 30, blur: 30},
    dark: {tint: '#0B0F1A', transparency: 52, blur: 24},
    wallpaper: {tint: null, transparency: 45, blur: 24},
};

export const TINTS = [
    ['#0B0F1A', 'Graphite'],
    ['#0C1626', 'Midnight blue'],
    ['#1E3B2C', 'Forest'],
    ['#6B3A1F', 'Caramel'],
    ['#3B3B3D', 'Gray'],
    ['#F5F5F5', 'White'],
    ['#F05A24', 'Orange'],
];

export const LOOK_KEYS = ['bar-glass', 'bar-tint', 'bar-transparency', 'bar-blur', 'bar-edge',
    'bar-solid-maximized', 'bar-reduce-transparency', 'bar-auto-text'];

export function parseHex(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
    if (!m)
        return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]) {
    return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function luminance([r, g, b]) {
    const lin = v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// The picture of the desktop background (the dark one in dark mode), or null
let desktopSettings = null;

export function wallpaperFile() {
    try {
        desktopSettings ??= [new Gio.Settings({schema_id: 'org.gnome.desktop.background'}),
            new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})];
        const [background, iface] = desktopSettings;
        const dark = iface.get_string('color-scheme') === 'prefer-dark';
        const uri = background.get_string(dark ? 'picture-uri-dark' : 'picture-uri') ||
            background.get_string('picture-uri');
        const path = uri ? Gio.File.new_for_uri(uri).get_path() : null;
        return path && GLib.file_test(path, GLib.FileTest.IS_REGULAR) && !path.endsWith('.xml') ? path : null;
    } catch (_e) {
        return null;
    }
}

let wallpaperCache = {path: null, color: null};

// The average color of the wallpaper, darkened so white text stays readable on it
export function wallpaperColor() {
    const path = wallpaperFile();
    if (!path)
        return parseHex(GLASS_STYLES.dark.tint);
    if (wallpaperCache.path === path)
        return wallpaperCache.color;
    let color = parseHex(GLASS_STYLES.dark.tint);
    try {
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 16, 16, false);
        const pixels = pixbuf.get_pixels();
        const stride = pixbuf.get_rowstride();
        const channels = pixbuf.get_n_channels();
        const sum = [0, 0, 0];
        let count = 0;
        for (let y = 0; y < pixbuf.get_height(); y++) {
            for (let x = 0; x < pixbuf.get_width(); x++) {
                const i = y * stride + x * channels;
                sum[0] += pixels[i];
                sum[1] += pixels[i + 1];
                sum[2] += pixels[i + 2];
                count++;
            }
        }
        color = sum.map(v => (v / Math.max(1, count)) * 0.55);
    } catch (_e) {
        // Unreadable picture: graphite
    }
    wallpaperCache = {path, color};
    return color;
}

/**
 * The bar's paint from the settings.
 * @param {Gio.Settings} settings
 * @param {boolean} maximized - a maximized window is on the bar's monitor
 * @returns {{color: number[], alpha: number, blur: number, edge: number, darkText: boolean, solid: boolean}}
 */
export function barLook(settings, maximized = false) {
    const glass = settings.get_string('bar-glass');
    const color = glass === 'wallpaper' ? wallpaperColor()
        : parseHex(settings.get_string('bar-tint')) ?? parseHex(GLASS_STYLES.dark.tint);
    const solid = settings.get_boolean('bar-reduce-transparency') ||
        (maximized && settings.get_boolean('bar-solid-maximized'));
    const alpha = solid ? 1 : 1 - settings.get_int('bar-transparency') / 100;
    return {
        color,
        alpha,
        solid,
        blur: solid ? 0 : settings.get_int('bar-blur'),
        edge: settings.get_int('bar-edge') / 100,
        // Light glass that is not see-through: dark text
        darkText: settings.get_boolean('bar-auto-text') && alpha >= 0.25 && luminance(color) > 0.45,
    };
}

export function rgbaCss(color, alpha) {
    return `rgba(${color.map(Math.round).join(', ')}, ${alpha.toFixed(3)})`;
}
