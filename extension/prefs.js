// Preferences window: language, dock (auto hide, size, spacing, position, zoom, glass) and
// notch (timings, coding agents, standby line, notification width, panel opacity,
// animations). Every row is bound to the extension's GSettings; the extension applies the
// changes live.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {LANGUAGES, _, setLanguage} from './i18n.js';

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
        window.set_default_size(620, 760);
        window.title = 'Zorin Notch';

        // Dock
        const dock = new Adw.PreferencesPage({title: 'Dock', icon_name: 'view-app-grid-symbolic'});

        const language = new Adw.PreferencesGroup();
        language.add(choiceRow(settings, 'language', 'Language',
            'Language of the notch and this window; the window updates when reopened', LANGUAGES, false));
        dock.add(language);

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
        const notchBehavior = new Adw.PreferencesGroup({title: _('Behavior')});
        notchBehavior.add(spinRow(settings, 'notification-seconds', 'Notification time',
            'Seconds before a notification turns back into the line', {lower: 2, upper: 30}));
        notchBehavior.add(spinRow(settings, 'status-seconds', 'Status time',
            'Seconds before a clicked status closes by itself', {lower: 2, upper: 30}));
        notchBehavior.add(switchRow(settings, 'show-agents', 'AI agents in the notch',
            'Claude Code and opencode: working, needs permission, finished'));
        notch.add(notchBehavior);

        const notchLook = new Adw.PreferencesGroup({title: _('Appearance')});
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
        window.add(notch);
    }
}
