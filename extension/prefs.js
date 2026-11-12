// Preferences window: language, dock (auto hide, size, spacing, position, zoom, glass) and
// notch (timings, coding agents, standby line, notification width, panel opacity,
// animations). Every row is bound to the extension's GSettings; the extension applies the
// changes live.

import Adw from 'gi://Adw';
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
        window.set_default_size(620, 760);
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
        window.add(notch);
    }
}
