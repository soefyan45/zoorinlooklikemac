// Preferences window: language, dock (auto hide, size, spacing, position, zoom, glass) and
// notch (timings, coding agents, standby line, notification width, panel opacity,
// animations). Every row is bound to the extension's GSettings; the extension applies the
// changes live.

import Adw from 'gi://Adw';
import Cairo from 'cairo';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {LANGUAGES, _, setLanguage} from './i18n.js';

const THEMES = [
    ['dark', 'Dark'],
    ['light', 'Light'],
    ['system', 'Follow system'],
];

const ACCENT_NAMES = [
    ['orange', 'Orange'],
    ['blue', 'Blue'],
    ['green', 'Green'],
    ['purple', 'Purple'],
    ['pink', 'Pink'],
];

const AGENT_INDICATORS = [
    ['sweep', 'Light sweeping along the line'],
    ['swap', 'Two dots trading places'],
    ['dots', 'Three pulsing dots'],
];

// Same colors as theme.js (which the preferences cannot import: it needs GNOME Shell)
const ACCENT_HEX = {orange: '#F05A24', blue: '#0A84FF', green: '#30D158', purple: '#BF5AF2', pink: '#FF375F'};

// Card pickers (Pego "Halaman konfig"): a small drawn preview, a title and a line below
const CARD_CSS = `
.zn-cards { margin-top: 4px; }
.zn-card { padding: 8px; border-radius: 14px; background: alpha(currentColor, 0.06); }
.zn-card:checked { background: alpha(currentColor, 0.06); box-shadow: inset 0 0 0 2px @accent_bg_color; }
.zn-card-title { font-weight: 600; }
.zn-swatch { padding: 4px; min-width: 0; min-height: 0; border-radius: 999px; }
.zn-swatch:checked { box-shadow: inset 0 0 0 2px @accent_bg_color; }
`;

function rgba(hex, alpha = 1) {
    const n = hex.replace('#', '');
    return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255).concat(alpha);
}

function roundRect(cr, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

function paint(cr, color, alpha = 1) {
    cr.setSourceRGBA(...rgba(color, alpha));
    cr.fill();
}

// A wallpaper with the dock at the bottom, as in the design's previews
function previewWallpaper(cr, w, h, warm) {
    const sky = new Cairo.LinearGradient(0, 0, 0, h);
    sky.addColorStopRGBA(0, ...rgba(warm ? '#E58A55' : '#4A7396'));
    sky.addColorStopRGBA(1, ...rgba('#1E3A5C'));
    roundRect(cr, 0, 0, w, h, 8);
    cr.setSource(sky);
    cr.fill();
}

function previewDock(cr, w, h) {
    roundRect(cr, w / 2 - 45, h - 16, 90, 10, 4);
    cr.setSourceRGBA(...rgba('#182335', 0.6));
    cr.fillPreserve();
    cr.setLineWidth(1);
    cr.setSourceRGBA(1, 1, 1, 0.28);
    cr.stroke();
}

function previewGlass(cr, x, y, w, h) {
    roundRect(cr, x, y, w, h, h / 2);
    cr.setSourceRGBA(...rgba('#182335', 0.65));
    cr.fillPreserve();
    cr.setLineWidth(1);
    cr.setSourceRGBA(1, 1, 1, 0.35);
    cr.stroke();
}

const BAR_PREVIEWS = {
    'line': (cr, w) => {
        roundRect(cr, w / 2 - 20, 0, 40, 3, 1.5);
        paint(cr, '#000000');
    },
    'notch-status': (cr, w) => {
        roundRect(cr, w / 2 - 50, -6, 100, 18, 5);
        paint(cr, '#000000');
        roundRect(cr, w / 2 - 43, 4.5, 26, 3, 1.5);
        roundRect(cr, w / 2 + 27, 4.5, 16, 3, 1.5);
        paint(cr, '#FFFFFF');
    },
    'bar': (cr, w) => {
        cr.rectangle(0, 0, w, 10);
        paint(cr, '#0B0F1A', 0.48);
        roundRect(cr, w / 2 - 25, -6, 50, 16, 4);
        paint(cr, '#000000');
        roundRect(cr, 6, 3.5, 22, 3, 1.5);
        roundRect(cr, w - 40, 3.5, 34, 3, 1.5);
        paint(cr, '#FFFFFF');
    },
    'islands': (cr, w) => {
        previewGlass(cr, 5, 3, 30, 8);
        roundRect(cr, w / 2 - 20, -5, 40, 14, 3);
        paint(cr, '#000000');
        previewGlass(cr, w - 65, 3, 30, 8);
        previewGlass(cr, w - 31, 3, 26, 8);
    },
};

// Fill and edge of the detail panel per style, for the previews
function panelFill(settings, style) {
    if (style === 'glass')
        return ['#182335', 0.62, '#FFFFFF', 0.4];
    if (style === 'glass-accent')
        return [ACCENT_HEX[settings.get_string('accent')] ?? ACCENT_HEX.orange, 0.5, '#FFFFFF', 0.35];
    return ['#06080F', 0.8, '#FFFFFF', 0.18];
}

function drawPanelPreview(cr, w, h, fill, edge) {
    const [color, alpha, edgeColor, edgeAlpha] = fill;
    const x = w / 2 - 55;
    const y = h / 2 - 38;
    roundRect(cr, x, y, 110, 76, 10);
    if (edge === 'accent') {
        const tint = new Cairo.LinearGradient(0, y, 0, y + 76);
        tint.addColorStopRGBA(0, ...rgba(color, alpha));
        tint.addColorStopRGBA(0.7, ...rgba('#0B0F1A', 0.8));
        cr.setSource(tint);
    } else {
        cr.setSourceRGBA(...rgba(color, alpha));
    }
    cr.fillPreserve();
    cr.setLineWidth(1);
    cr.setSourceRGBA(...rgba(edgeColor, edgeAlpha));
    cr.stroke();
    roundRect(cr, x + 8, y + 8, 40, 4, 2);
    paint(cr, '#FFFFFF');
    roundRect(cr, x + 8, y + 18, 94, 24, 5);
    roundRect(cr, x + 8, y + 47, 45, 20, 5);
    roundRect(cr, x + 57, y + 47, 45, 20, 5);
    paint(cr, '#FFFFFF', 0.12);
}

/**
 * A row of cards, one per choice of a string setting; the checked one is the setting's value.
 * cards: [{value, title, subtitle, draw(cr, w, h)}]
 */
function cardPicker(settings, key, cards) {
    const box = new Gtk.Box({spacing: 12, homogeneous: true, css_classes: ['zn-cards']});
    const buttons = new Map();
    let first = null;
    for (const card of cards) {
        const area = new Gtk.DrawingArea({content_width: 136, content_height: 80});
        area.set_draw_func((_area, cr, w, h) => {
            try {
                card.draw(cr, w, h);
            } finally {
                cr.$dispose();
            }
        });
        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4});
        content.append(area);
        content.append(new Gtk.Label({label: _(card.title), xalign: 0, css_classes: ['zn-card-title']}));
        if (card.subtitle)
            content.append(new Gtk.Label({label: _(card.subtitle), xalign: 0, wrap: true, css_classes: ['dim-label', 'caption']}));
        const button = new Gtk.ToggleButton({child: content, css_classes: ['zn-card'], tooltip_text: _(card.title)});
        if (first)
            button.set_group(first);
        else
            first = button;
        button.connect('toggled', () => {
            if (button.active && settings.get_string(key) !== card.value)
                settings.set_string(key, card.value);
        });
        buttons.set(card.value, {button, area});
        box.append(button);
    }
    const sync = () => {
        buttons.get(settings.get_string(key))?.button.set_active(true);
    };
    sync();
    settings.connect(`changed::${key}`, sync);
    // Previews that show the accent follow it
    settings.connect('changed::accent', () => buttons.forEach(({area}) => area.queue_draw()));
    return box;
}

// Round color swatches for a string setting, as the suffix of a row
function swatchPicker(settings, key, swatches) {
    const box = new Gtk.Box({spacing: 6, valign: Gtk.Align.CENTER});
    const buttons = new Map();
    let first = null;
    for (const swatch of swatches) {
        const area = new Gtk.DrawingArea({content_width: 18, content_height: 18});
        area.set_draw_func((_area, cr, w, h) => {
            try {
                cr.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, 2 * Math.PI);
                const colors = swatch.colors();
                if (colors.length > 1) {
                    const gradient = new Cairo.LinearGradient(0, 0, w, 0);
                    colors.forEach((color, i) => gradient.addColorStopRGBA(i / (colors.length - 1), ...rgba(color)));
                    cr.setSource(gradient);
                } else {
                    cr.setSourceRGBA(...rgba(colors[0]));
                }
                cr.fill();
            } finally {
                cr.$dispose();
            }
        });
        const button = new Gtk.ToggleButton({child: area, css_classes: ['zn-swatch', 'flat'], tooltip_text: _(swatch.title)});
        if (first)
            button.set_group(first);
        else
            first = button;
        button.connect('toggled', () => {
            if (button.active && settings.get_string(key) !== swatch.value)
                settings.set_string(key, swatch.value);
        });
        buttons.set(swatch.value, {button, area});
        box.append(button);
    }
    const sync = () => buttons.get(settings.get_string(key))?.button.set_active(true);
    sync();
    settings.connect(`changed::${key}`, sync);
    settings.connect('changed::accent', () => buttons.forEach(({area}) => area.queue_draw()));
    return box;
}

const SYSTEM_ITEMS = [
    ['cpu-load', 'CPU load'],
    ['cpu-temp', 'CPU temperature'],
    ['gpu', 'GPU'],
    ['memory', 'Memory'],
    ['ssd-temp', 'SSD temperature'],
    ['network', 'Network speed'],
];

const PANEL_STYLES = [
    ['dark', 'Solid dark'],
    ['glass', 'Glass (like the dock)'],
    ['glass-accent', 'Accent glass'],
];

const CHART_COLORS = [
    ['accent', 'Accent color'],
    ['teal', 'Teal'],
    ['blue', 'Blue'],
    ['purple', 'Purple'],
    ['white', 'White'],
    ['temperature', 'Follow the temperature'],
];

// One switch per item of a string list setting: on = in the list
function listSwitchRow(settings, key, value, title) {
    const row = new Adw.SwitchRow({title: _(title)});
    const sync = () => {
        row.active = settings.get_strv(key).includes(value);
    };
    sync();
    row.connect('notify::active', () => {
        const list = settings.get_strv(key).filter(v => v !== value);
        if (row.active)
            list.push(value);
        if (list.join() !== settings.get_strv(key).join())
            settings.set_strv(key, list);
    });
    settings.connect(`changed::${key}`, sync);
    return row;
}

const NOTCH_STYLES = [
    ['classic', 'Classic line'],
    ['liquid', 'Liquid drop'],
];

const AGENT_COLORS = [
    ['accent', 'Accent color'],
    ['teal', 'Teal'],
    ['orange', 'Orange'],
    ['blue', 'Blue'],
    ['green', 'Green'],
    ['purple', 'Purple'],
    ['pink', 'Pink'],
    ['white', 'White'],
];

const AUTOHIDE = [
    ['off', 'Off'],
    ['all-windows', 'When windows cover the dock'],
    ['focused-window', 'When the active window covers the dock'],
    ['maximized-window', 'Only for maximized windows'],
];

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title: _(title), subtitle: _(subtitle)});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, subtitle, {lower, upper, step = 1, digits = 0}) {
    const row = new Adw.SpinRow({
        title: _(title),
        subtitle: _(subtitle),
        digits,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

// Opacity shown as a percentage, stored as 0..1
function percentRow(settings, key, title, subtitle, lower, upper) {
    const row = new Adw.SpinRow({
        title: _(title),
        subtitle: _(subtitle),
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: 5, page_increment: 10}),
    });
    row.value = Math.round(settings.get_double(key) * 100);
    row.connect('notify::value', () => settings.set_double(key, row.value / 100));
    settings.connect(`changed::${key}`, () => {
        const value = Math.round(settings.get_double(key) * 100);
        if (row.value !== value)
            row.value = value;
    });
    return row;
}

// A string key shown as a list of choices: [[value, label], ...]
function choiceRow(settings, key, title, subtitle, choices, translate = true) {
    const row = new Adw.ComboRow({
        title: _(title),
        subtitle: _(subtitle),
        model: Gtk.StringList.new(choices.map(([, label]) => (translate ? _(label) : label))),
    });
    const sync = () => {
        const index = choices.findIndex(([value]) => value === settings.get_string(key));
        row.selected = Math.max(0, index);
    };
    sync();
    row.connect('notify::selected', () => settings.set_string(key, choices[row.selected][0]));
    settings.connect(`changed::${key}`, sync);
    return row;
}

export default class ZorinNotchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        setLanguage(settings.get_string('language'));
        window.set_default_size(720, 820);
        const css = new Gtk.CssProvider();
        if (css.load_from_string)
            css.load_from_string(CARD_CSS);
        else
            css.load_from_data(CARD_CSS, -1);
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        window.title = 'Zorin Notch';

        // Dock
        const dock = new Adw.PreferencesPage({title: 'Dock', icon_name: 'view-app-grid-symbolic'});

        const general = new Adw.PreferencesGroup({title: _('General')});
        general.add(choiceRow(settings, 'language', 'Language',
            'Language of the notch and this window; the window updates when reopened', LANGUAGES, false));
        general.add(choiceRow(settings, 'theme', 'Theme',
            'Look of the notch and the dock', THEMES));
        general.add(choiceRow(settings, 'accent', 'Accent color',
            'Active toggles, switches and highlights', ACCENT_NAMES));
        dock.add(general);

        const dockBehavior = new Adw.PreferencesGroup({
            title: _('Behavior'),
            description: _('The dock uses zorin-taskbar; these settings are passed on to it.'),
        });
        dockBehavior.add(choiceRow(settings, 'dock-autohide', 'Auto hide',
            'The dock slides off the screen and comes back when the pointer reaches the bottom', AUTOHIDE));
        dockBehavior.add(switchRow(settings, 'dock-zoom', 'Icon zoom',
            'Icons under the pointer grow, like on macOS'));
        dock.add(dockBehavior);

        const dockLook = new Adw.PreferencesGroup({title: _('Appearance')});
        dockLook.add(spinRow(settings, 'dock-size', 'Dock size',
            'Height in pixels; the icon size follows', {lower: 32, upper: 64, step: 2}));
        dockLook.add(spinRow(settings, 'dock-icon-spacing', 'Icon spacing',
            'In pixels, on each side of an icon', {lower: 0, upper: 12}));
        dockLook.add(spinRow(settings, 'dock-plate-padding', 'Glass padding',
            'In pixels, between the icons and the edge of the glass', {lower: 2, upper: 20}));
        dockLook.add(spinRow(settings, 'dock-margin', 'Distance from the bottom',
            'In pixels', {lower: 0, upper: 24}));
        dockLook.add(percentRow(settings, 'dock-glass-opacity', 'Glass opacity',
            'In percent; 0 = no background', 0, 100));
        dock.add(dockLook);
        window.add(dock);

        // Notch
        const notch = new Adw.PreferencesPage({title: 'Notch', icon_name: 'preferences-desktop-display-symbolic'});

        // Top bar: four cards with a preview each
        const barGroup = new Adw.PreferencesGroup({title: _('Top bar'),
            description: _('What shows at the top while the notch rests')});
        barGroup.add(cardPicker(settings, 'bar-mode', [
            {value: 'line', title: 'Thin line', subtitle: 'Cleanest'},
            {value: 'notch-status', title: 'Status notch', subtitle: 'Clock and battery always visible'},
            {value: 'bar', title: 'Full menu bar', subtitle: 'Like macOS'},
            {value: 'islands', title: 'Glass islands', subtitle: 'Clean, the wallpaper shows through'},
        ].map(card => ({...card, draw: (cr, w, h) => {
            previewWallpaper(cr, w, h, false);
            BAR_PREVIEWS[card.value](cr, w, h);
            previewDock(cr, w, h);
        }}))));
        notch.add(barGroup);
        const notchBehavior = new Adw.PreferencesGroup({title: _('Behavior')});
        notchBehavior.add(spinRow(settings, 'notification-seconds', 'Notification time',
            'Seconds before a notification turns back into the line', {lower: 2, upper: 30}));
        notchBehavior.add(spinRow(settings, 'status-seconds', 'Status time',
            'Seconds before a clicked status closes by itself', {lower: 2, upper: 30}));
        notchBehavior.add(switchRow(settings, 'spotlight-on-type', 'Search while typing in the overview',
            'Press Super and start typing: the notch search opens instead of the overview search'));
        notchBehavior.add(switchRow(settings, 'search-files', 'Search files',
            'Spotlight also finds files and folders by name'));
        notchBehavior.add(switchRow(settings, 'search-content', 'Search document contents',
            'Spotlight also finds text inside documents (indexed by GNOME Tracker)'));
        notchBehavior.add(switchRow(settings, 'show-agents', 'AI agents in the notch',
            'Claude Code and opencode: working, needs permission, finished'));
        notchBehavior.add(switchRow(settings, 'show-media', 'Music in the notch',
            'Equalizer on the line while music plays; hover for the title and controls'));
        const permissions = switchRow(settings, 'agent-permissions', 'Answer permissions on the notch',
            'Claude Code asks Allow or Deny on the notch; no answer in a minute and it asks in the terminal');
        settings.bind('show-agents', permissions, 'sensitive', Gio.SettingsBindFlags.GET);
        notchBehavior.add(permissions);
        const indicator = choiceRow(settings, 'agent-indicator', 'Working animation',
            'On the standby line while an agent works; hover the notch for details', AGENT_INDICATORS);
        settings.bind('show-agents', indicator, 'sensitive', Gio.SettingsBindFlags.GET);
        notchBehavior.add(indicator);
        const indicatorColor = choiceRow(settings, 'agent-color', 'Animation color',
            'Color of the working animation', AGENT_COLORS);
        settings.bind('show-agents', indicatorColor, 'sensitive', Gio.SettingsBindFlags.GET);
        notchBehavior.add(indicatorColor);
        notch.add(notchBehavior);

        const notchLook = new Adw.PreferencesGroup({title: _('Appearance')});
        notchLook.add(choiceRow(settings, 'notch-style', 'Notch style',
            'Liquid: a lens at rest that drops into a bead toward the pointer', NOTCH_STYLES));
        notchLook.add(switchRow(settings, 'notch-floating', 'Floating notch',
            'A rounded pill below the top edge instead of a notch cut into it'));
        const offset = spinRow(settings, 'notch-float-offset', 'Distance from the top',
            'In pixels, for the floating notch', {lower: 2, upper: 32});
        settings.bind('notch-floating', offset, 'sensitive', Gio.SettingsBindFlags.GET);
        notchLook.add(offset);
        notchLook.add(spinRow(settings, 'idle-width', 'Standby line width',
            'In pixels; it grows by 40 px when the pointer comes near', {lower: 40, upper: 300, step: 10}));
        notchLook.add(spinRow(settings, 'idle-height', 'Standby line thickness',
            'In pixels', {lower: 2, upper: 8}));
        notchLook.add(spinRow(settings, 'notification-width', 'Notification width',
            'In pixels; width of the notch when it shows a notification', {lower: 320, upper: 640, step: 10}));
        notchLook.add(percentRow(settings, 'panel-opacity', 'Panel opacity',
            'In percent; full panel, Wi-Fi, notifications', 40, 100));
        notchLook.add(switchRow(settings, 'animations', 'Animations',
            'Off = the notch changes size at once, without springs'));
        notch.add(notchLook);

        // System info (needs the zorin-notchd daemon)
        const system = new Adw.PreferencesGroup({title: _('System info'),
            description: _('Shown in every top bar mode; click it for the details')});
        system.add(switchRow(settings, 'show-system', 'Show system info',
            'CPU load and temperature in the status row or the top bar'));
        const items = new Adw.ExpanderRow({title: _('Shown in the top bar'),
            subtitle: _('The detail panel always shows everything')});
        for (const [value, title] of SYSTEM_ITEMS)
            items.add_row(listSwitchRow(settings, 'system-items', value, title));
        system.add(items);
        system.add(switchRow(settings, 'system-graph', 'Mini graph', 'Small bars of the CPU load next to its number'));
        system.add(spinRow(settings, 'system-interval', 'Update every', 'Seconds; less often saves battery',
            {lower: 1, upper: 10}));
        system.add(spinRow(settings, 'system-temp-warning', 'Temperature warning',
            '°C: the dot turns red above it', {lower: 60, upper: 100}));
        system.add(switchRow(settings, 'system-temp-notify', 'Heat notification',
            'A notification when the CPU stays above the warning for 30 seconds'));
        const repeat = spinRow(settings, 'system-temp-repeat', 'Remind again after',
            'Minutes before another heat notification', {lower: 5, upper: 240, step: 5});
        settings.bind('system-temp-notify', repeat, 'sensitive', Gio.SettingsBindFlags.GET);
        system.add(repeat);
        for (const row of [items])
            settings.bind('show-system', row, 'sensitive', Gio.SettingsBindFlags.GET);

        // Detail panel: three style cards and the chart color
        const panelGroup = new Adw.PreferencesGroup({title: _('Detail panel style'),
            description: _('Background and chart color of the panel that opens when the system info is clicked')});
        panelGroup.add(cardPicker(settings, 'system-panel-style', PANEL_STYLES.map(([value, title]) => ({
            value, title, subtitle: '',
            draw: (cr, w, h) => {
                previewWallpaper(cr, w, h, true);
                drawPanelPreview(cr, w, h, panelFill(settings, value), value === 'glass-accent' ? 'accent' : 'plain');
            },
        }))));
        const chartRow = new Adw.ActionRow({title: _('Chart color'), subtitle: _('CPU load bars in the bar and the panel')});
        chartRow.add_suffix(swatchPicker(settings, 'system-chart-color', CHART_COLORS.map(([value, title]) => ({
            value, title,
            colors: () => {
                if (value === 'accent')
                    return [ACCENT_HEX[settings.get_string('accent')] ?? ACCENT_HEX.orange];
                if (value === 'temperature')
                    return ['#34C759', '#FEBC2E', '#FF453A'];
                return [{teal: '#4FD1C5', blue: '#0A84FF', purple: '#BF5AF2', white: '#FFFFFF'}[value]];
            },
        }))));
        // Its own group, so it sits below the cards (a group lists its rows before other widgets)
        const chartGroup = new Adw.PreferencesGroup();
        chartGroup.add(chartRow);

        // Order as in the design: top bar, system info, detail panel, then the rest
        for (const group of [notchBehavior, notchLook])
            notch.remove(group);
        notch.add(system);
        notch.add(panelGroup);
        notch.add(chartGroup);
        notch.add(notchBehavior);
        notch.add(notchLook);
        window.add(notch);
    }
}
