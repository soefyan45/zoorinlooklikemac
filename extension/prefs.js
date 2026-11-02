// Preferences window: dock (auto hide, size, position, zoom, glass) and notch (timings,
// coding agents, panel opacity, animations). Every row is bound to the extension's GSettings;
// the extension applies the changes live.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const AUTOHIDE = [
    ['off', 'Mati'],
    ['all-windows', 'Saat jendela menutupi dock'],
    ['focused-window', 'Saat jendela aktif menutupi dock'],
    ['maximized-window', 'Hanya saat jendela maksimal'],
];

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, subtitle, {lower, upper, step = 1, digits = 0}) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        digits,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

// Opacity shown as a percentage, stored as 0..1
function percentRow(settings, key, title, subtitle, lower, upper) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
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

function autohideRow(settings) {
    const row = new Adw.ComboRow({
        title: 'Sembunyikan otomatis',
        subtitle: 'Dock turun keluar layar dan muncul lagi saat kursor ke bawah',
        model: Gtk.StringList.new(AUTOHIDE.map(([, label]) => label)),
    });
    const sync = () => {
        const index = AUTOHIDE.findIndex(([id]) => id === settings.get_string('dock-autohide'));
        row.selected = Math.max(0, index);
    };
    sync();
    row.connect('notify::selected', () => settings.set_string('dock-autohide', AUTOHIDE[row.selected][0]));
    settings.connect('changed::dock-autohide', sync);
    return row;
}

export default class ZorinNotchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(620, 720);
        window.title = 'Zorin Notch';

        // Dock
        const dock = new Adw.PreferencesPage({title: 'Dock', icon_name: 'view-app-grid-symbolic'});
        const dockBehaviour = new Adw.PreferencesGroup({
            title: 'Perilaku',
            description: 'Dock memakai zorin-taskbar; pengaturan ini diteruskan ke sana.',
        });
        dockBehaviour.add(autohideRow(settings));
        dockBehaviour.add(switchRow(settings, 'dock-zoom', 'Efek zoom ikon',
            'Ikon di bawah kursor membesar seperti di macOS'));
        dock.add(dockBehaviour);

        const dockLook = new Adw.PreferencesGroup({title: 'Tampilan'});
        dockLook.add(spinRow(settings, 'dock-size', 'Tinggi dock',
            'Dalam piksel; ukuran ikon mengikuti', {lower: 32, upper: 64, step: 2}));
        dockLook.add(spinRow(settings, 'dock-margin', 'Jarak dari bawah layar',
            'Dalam piksel', {lower: 0, upper: 24}));
        dockLook.add(percentRow(settings, 'dock-glass-opacity', 'Kepekatan kaca',
            'Dalam persen; 0 = tanpa latar', 0, 100));
        dock.add(dockLook);
        window.add(dock);

        // Notch
        const notch = new Adw.PreferencesPage({title: 'Notch', icon_name: 'preferences-desktop-display-symbolic'});
        const notchBehaviour = new Adw.PreferencesGroup({title: 'Perilaku'});
        notchBehaviour.add(spinRow(settings, 'notification-seconds', 'Lama notifikasi',
            'Detik sebelum notifikasi kembali jadi garis', {lower: 2, upper: 30}));
        notchBehaviour.add(spinRow(settings, 'status-seconds', 'Lama status',
            'Detik sebelum status yang diklik menutup sendiri', {lower: 2, upper: 30}));
        notchBehaviour.add(switchRow(settings, 'show-agents', 'Agent AI di notch',
            'Status Claude Code dan opencode: sedang bekerja, butuh izin, selesai'));
        notch.add(notchBehaviour);

        const notchLook = new Adw.PreferencesGroup({title: 'Tampilan'});
        notchLook.add(spinRow(settings, 'idle-width', 'Lebar garis standby',
            'Dalam piksel; saat kursor mendekat garis melebar 40 px', {lower: 40, upper: 300, step: 10}));
        notchLook.add(spinRow(settings, 'idle-height', 'Tebal garis standby',
            'Dalam piksel', {lower: 2, upper: 8}));
        notchLook.add(spinRow(settings, 'notification-width', 'Lebar notifikasi',
            'Dalam piksel; lebar notch saat menampilkan notifikasi', {lower: 320, upper: 640, step: 10}));
        notchLook.add(percentRow(settings, 'panel-opacity', 'Kepekatan panel',
            'Dalam persen; panel penuh, Wi-Fi, notifikasi', 40, 100));
        notchLook.add(switchRow(settings, 'animations', 'Animasi',
            'Mati = notch langsung berubah ukuran tanpa pegas'));
        notch.add(notchLook);
        window.add(notch);
    }
}
