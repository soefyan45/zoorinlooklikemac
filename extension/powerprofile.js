// The power profile (power saver, balanced, performance) of power-profiles-daemon, the same
// switch as in GNOME's quick settings. It needs no root: the daemon lets the desktop user change
// it. Shown in the system panel and in Preferences > Notch > Power.
//
// No GNOME Shell imports here: the preferences window uses this module too.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'net.hadess.PowerProfiles';
const OBJECT_PATH = '/net/hadess/PowerProfiles';

export const PROFILES = ['power-saver', 'balanced', 'performance'];

export class PowerProfiles {
    /** @param {Function} onChange - called when the profile or the daemon changes */
    constructor(onChange) {
        this._proxy = null;
        this._signalId = 0;
        this._cancellable = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
            BUS_NAME, OBJECT_PATH, BUS_NAME, this._cancellable, (_o, res) => {
                try {
                    this._proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (_e) {
                    // No power-profiles-daemon: nothing to switch
                    return;
                }
                this._signalId = this._proxy.connect('g-properties-changed', () => onChange());
                onChange();
            });
    }

    get available() {
        return !!this._proxy?.get_name_owner();
    }

    // The profiles this machine offers, in PROFILES order
    get profiles() {
        const value = this._proxy?.get_cached_property('Profiles');
        if (!value)
            return [];
        const offered = value.recursiveUnpack().map(p => p.Profile);
        return PROFILES.filter(p => offered.includes(p));
    }

    get active() {
        return this._proxy?.get_cached_property('ActiveProfile')?.unpack() ?? null;
    }

    set active(profile) {
        if (!this._proxy || !PROFILES.includes(profile) || profile === this.active)
            return;
        this._proxy.call('org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', [BUS_NAME, 'ActiveProfile', new GLib.Variant('s', profile)]),
            Gio.DBusCallFlags.NONE, -1, null, (proxy, res) => {
                try {
                    proxy.call_finish(res);
                } catch (e) {
                    console.warn('[zorin-notch] power profile not changed:', e.message);
                }
            });
    }

    destroy() {
        this._cancellable.cancel();
        if (this._signalId)
            this._proxy.disconnect(this._signalId);
        this._signalId = 0;
        this._proxy = null;
    }
}
