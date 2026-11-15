// Small building blocks for the desktop widgets (widgets.js and its styles): St actors with the
// design's inline look, so each style stays readable as a list of boxes and labels.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

export const WIDTH = 344;
export const RADIUS = 22;

// Pego variables of the widgets
export const C = {
    panel: 'rgba(6, 8, 15, 0.78)',
    edge: 'rgba(255, 255, 255, 0.18)',
    tile: 'rgba(255, 255, 255, 0.07)',
    tileEdge: 'rgba(255, 255, 255, 0.06)',
    label: 'rgba(255, 255, 255, 0.72)',
    text: '#FFFFFF',
    sun: '#FFD25A',
    rain: '#7CC4FF',
    track: 'rgba(255, 255, 255, 0.12)',
    black: '#0B0B0C',
    block: '#FFDCCB',
    frost: 'rgba(243, 241, 236, 0.95)',
    ink: '#24221C',
    inkMuted: '#5C584D',
    paper: '#FBF7EF',
    today: '#1E3A5C',
    slateTop: 'rgba(71, 92, 127, 0.95)',
    slateBottom: 'rgba(49, 69, 106, 0.95)',
    skyTop: '#1F6FBF',
    skyBottom: '#6DB6F2',
    warmTop: '#355F86',
    warmBottom: '#8C5232',
};

export const EVENT_COLORS = ['#F05A24', '#30D158', '#0A84FF', '#BF5AF2', '#FFD25A'];

/** A label: text, then style as CSS (font-size, color, ...) */
export function text(content, style = '', props = {}) {
    const label = new St.Label({text: `${content ?? ''}`, y_align: Clutter.ActorAlign.CENTER, ...props});
    label.style = `font-family: Inter, sans-serif; ${style}`;
    label.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
    return label;
}

export function icon(name, size, color, props = {}) {
    return new St.Icon({icon_name: name, icon_size: size, style: `color: ${color};`,
        fallback_icon_name: 'image-missing-symbolic', ...props});
}

/** A box: vertical or not, a style, and children */
export function box({vertical = false, style = '', expand = false, xAlign, yAlign, ...props} = {}, children = []) {
    const actor = new St.BoxLayout({vertical, style, x_expand: expand, ...props});
    if (xAlign !== undefined)
        actor.x_align = xAlign;
    if (yAlign !== undefined)
        actor.y_align = yAlign;
    for (const child of children.filter(Boolean))
        actor.add_child(child);
    return actor;
}

export function spacer() {
    return new St.Widget({x_expand: true, y_expand: true});
}

/** A flat button around a child (or a label) */
export function button(child, onClick, style = '', props = {}) {
    const actor = new St.Button({
        child: typeof child === 'string' ? text(child, 'font-weight: 600; font-size: 12px;') : child,
        style,
        can_focus: true,
        reactive: true,
        track_hover: true,
        ...props,
    });
    actor.connect('clicked', () => onClick());
    return actor;
}

/** A Cairo drawing of a fixed size */
export function drawing(width, height, draw) {
    const area = new St.DrawingArea({width, height});
    area.connect('repaint', () => {
        const cr = area.get_context();
        try {
            draw(cr, ...area.get_surface_size());
        } finally {
            cr.$dispose();
        }
    });
    return area;
}

export function rgbaOf(hex, alpha = 1) {
    const n = hex.replace('#', '');
    return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255).concat(alpha);
}

/** "16.00" */
export function hm(date) {
    return GLib.DateTime.new_from_unix_local(Math.floor(date.getTime() / 1000)).format('%H.%M');
}

export function fmt(date, format) {
    return GLib.DateTime.new_from_unix_local(Math.floor(date.getTime() / 1000)).format(format);
}

export function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

export function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

export function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The Monday that starts the week of date */
export function weekStart(date) {
    const d = startOfDay(date);
    return addDays(d, -((d.getDay() + 6) % 7));
}

export function isAllDay(event) {
    const start = event.date;
    return start.getHours() === 0 && start.getMinutes() === 0 &&
        event.end.getTime() - start.getTime() >= 24 * 3600 * 1000 - 60000;
}

export function roundRect(cr, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}
