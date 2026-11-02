// Read-only data sources for the notch status row: clock, battery and network.
// Each source calls onChange() when its value changes and cleans up in destroy().

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const LOG_PREFIX = '[zorin-notch]';

// Time only, following the user's 12/24 h setting and locale (same as the GNOME clock)
export class ClockSource {
    constructor(onChange) {
        this._clock = new GnomeDesktop.WallClock({time_only: true});
        this._clock.connectObject('notify::clock', () => onChange(), this);
    }

    get text() {
        return this._clock.clock;
    }

    destroy() {
        this._clock.disconnectObject(this);
        this._clock.run_dispose();
        this._clock = null;
    }
}

// UPower display device over the system bus (public, stable API)
export class BatterySource {
    constructor(onChange) {
        this._onChange = onChange;
        this._proxy = null;
        this._cancellable = new Gio.Cancellable();

        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.NONE,
            null,
            'org.freedesktop.UPower',
            '/org/freedesktop/UPower/devices/DisplayDevice',
            'org.freedesktop.UPower.Device',
            this._cancellable,
            (_obj, res) => {
                try {
                    this._proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(LOG_PREFIX, `UPower unavailable: ${e.message}`);
                    return;
                }
                this._proxy.connectObject('g-properties-changed', () => this._onChange(), this);
                this._onChange();
            });
    }

    _get(name) {
        return this._proxy?.get_cached_property(name)?.unpack() ?? null;
    }

    get present() {
        return !!this._get('IsPresent');
    }

    get percentage() {
        const value = this._get('Percentage');
        return value === null ? null : Math.round(value);
    }

    get iconName() {
        return this._get('IconName') || 'battery-missing-symbolic';
    }

    destroy() {
        this._cancellable.cancel();
        this._proxy?.disconnectObject(this);
        this._proxy = null;
    }
}

// Mirrors the icon of GNOME's own network indicator, so the notch shows exactly what the
// quick settings would. The indicator is created asynchronously by the panel, so wait for it.
const NETWORK_WAIT_MS = 500;
const NETWORK_WAIT_TRIES = 20;

export class NetworkSource {
    constructor(onChange) {
        this._onChange = onChange;
        this._indicator = null;
        this._waitId = 0;
        this._tries = 0;

        if (!this._attach())
            this._waitId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, NETWORK_WAIT_MS, () => {
                if (this._attach() || ++this._tries >= NETWORK_WAIT_TRIES) {
                    this._waitId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
    }

    _attach() {
        // Private field of GNOME Shell 46's QuickSettings; guarded in case it changes
        const indicator = Main.panel.statusArea.quickSettings?._network?._primaryIndicator;
        if (!indicator)
            return false;

        this._indicator = indicator;
        this._indicator.connectObject(
            'notify::icon-name', () => this._onChange(),
            'notify::visible', () => this._onChange(),
            'destroy', () => {
                this._indicator = null;
                this._onChange();
            },
            this);
        this._onChange();
        return true;
    }

    get iconName() {
        return this._indicator?.visible ? this._indicator.icon_name : null;
    }

    destroy() {
        if (this._waitId) {
            GLib.source_remove(this._waitId);
            this._waitId = 0;
        }
        this._indicator?.disconnectObject(this);
        this._indicator = null;
    }
}
