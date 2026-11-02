// Bridge to GNOME Shell 46's own quick settings. The notch never talks to NetworkManager,
// BlueZ or the audio server itself: every toggle and slider drives the same object the GNOME
// menu uses, so behaviour (and safety checks) stay GNOME's.
//
// All access goes through private fields of QuickSettings (`_network`, `_bluetooth`, ...).
// Each one is guarded: when a field is missing the matching control reports available=false
// and the notch hides it.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const LOG_PREFIX = '[zorin-notch]';
const WAIT_MS = 500;
const WAIT_TRIES = 20;

function quickSettings() {
    return Main.panel.statusArea.quickSettings ?? null;
}

// A GNOME QuickToggle (St.Button with checked/title/subtitle); clicking it runs GNOME's handler
class Toggle {
    constructor(getToggle) {
        this._getToggle = getToggle;
    }

    get _toggle() {
        try {
            return this._getToggle() ?? null;
        } catch {
            return null;
        }
    }

    get available() {
        const toggle = this._toggle;
        return !!toggle && toggle.visible && toggle.reactive !== false;
    }

    get checked() {
        return !!this._toggle?.checked;
    }

    get subtitle() {
        return this._toggle?.subtitle ?? '';
    }

    get iconName() {
        return this._toggle?.icon_name ?? null;
    }

    toggle() {
        const toggle = this._toggle;
        if (!toggle)
            return;
        toggle.emit('clicked', 1);
    }

    watch(callback, owner) {
        this._toggle?.connectObject(
            'notify::checked', callback,
            'notify::subtitle', callback,
            'notify::visible', callback,
            'notify::icon-name', callback,
            owner);
    }

    unwatch(owner) {
        this._toggle?.disconnectObject(owner);
    }
}

// "Do not disturb": the same setting as the switch in GNOME's notification list
class DndToggle {
    constructor() {
        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
    }

    get available() {
        return true;
    }

    get checked() {
        return !this._settings.get_boolean('show-banners');
    }

    get subtitle() {
        return '';
    }

    get iconName() {
        return 'notifications-disabled-symbolic';
    }

    toggle() {
        this._settings.set_boolean('show-banners', this.checked);
    }

    watch(callback, owner) {
        this._settings.connectObject('changed::show-banners', callback, owner);
    }

    unwatch(owner) {
        this._settings.disconnectObject(owner);
    }
}

// The GNOME slider inside a QuickSlider (volume, brightness)
class SliderLink {
    constructor(getItem) {
        this._getItem = getItem;
    }

    get item() {
        try {
            return this._getItem() ?? null;
        } catch {
            return null;
        }
    }

    get available() {
        const item = this.item;
        return !!item?.slider && item.visible;
    }

    get slider() {
        return this.item?.slider ?? null;
    }

    get iconName() {
        return this.item?.icon_name ?? null;
    }
}

export class QuickSettingsBridge {
    constructor(onChange) {
        this._onChange = onChange;
        this._watching = false;
        this._waitId = 0;
        this._tries = 0;

        const items = name => quickSettings()?.[name]?.quickSettingsItems?.[0];
        this.wifi = new Toggle(() => quickSettings()?._network?._wirelessToggle);
        this.bluetooth = new Toggle(() => items('_bluetooth'));
        this.darkMode = new Toggle(() => items('_darkMode'));
        this.dnd = new DndToggle();
        this.volume = new SliderLink(() => quickSettings()?._volumeOutput?._output);
        this.brightness = new SliderLink(() => items('_brightness'));

        // The indicators are created asynchronously after the panel; wait for the network one
        if (!this._attach())
            this._waitId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WAIT_MS, () => {
                if (this._attach() || ++this._tries >= WAIT_TRIES) {
                    this._waitId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
    }

    _attach() {
        if (!quickSettings()?._network)
            return false;

        const changed = () => this._onChange();
        for (const control of [this.wifi, this.bluetooth, this.darkMode, this.dnd])
            control.watch(changed, this);
        for (const link of [this.volume, this.brightness])
            link.item?.connectObject('notify::visible', changed, this);
        this._watching = true;
        this._onChange();
        return true;
    }

    // Wi-Fi networks as GNOME's menu lists them: [{name, iconName, secure, active, activate()}]
    wifiNetworks() {
        const toggle = quickSettings()?._network?._wirelessToggle;
        const networks = [];
        try {
            for (const deviceItem of toggle?._items?.values() ?? []) {
                for (const [network, item] of deviceItem._networkItems ?? []) {
                    if (!item.visible || !network.name)
                        continue;
                    networks.push({
                        name: network.name,
                        iconName: network.icon_name || 'network-wireless-symbolic',
                        secure: network.secure,
                        active: network.is_active,
                        strength: network.signal_strength,
                        activate: () => network.activate(),
                    });
                }
            }
        } catch (e) {
            console.warn(LOG_PREFIX, `cannot read Wi-Fi networks: ${e.message}`);
        }
        networks.sort((a, b) => b.active - a.active || b.strength - a.strength);
        return networks;
    }

    // Ask GNOME to rescan, the same as opening its Wi-Fi menu
    scanWifi() {
        const toggle = quickSettings()?._network?._wirelessToggle;
        try {
            toggle?._scanDevices?.().catch(() => {});
        } catch (e) {
            console.warn(LOG_PREFIX, `Wi-Fi scan failed: ${e.message}`);
        }
    }

    openSettings(panelDesktopId = 'org.gnome.Settings.desktop') {
        const app = Shell.AppSystem.get_default().lookup_app(panelDesktopId);
        if (app)
            app.activate();
        else
            console.warn(LOG_PREFIX, `${panelDesktopId} not found`);
    }

    destroy() {
        if (this._waitId) {
            GLib.source_remove(this._waitId);
            this._waitId = 0;
        }
        if (this._watching) {
            for (const control of [this.wifi, this.bluetooth, this.darkMode, this.dnd])
                control.unwatch(this);
            for (const link of [this.volume, this.brightness])
                link.item?.disconnectObject(this);
        }
        this.dnd._settings.run_dispose();
    }
}
