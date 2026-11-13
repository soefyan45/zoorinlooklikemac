// Fan boost and CPU limits (Preferences > Notch > Fan, Power) for the zoorin-fan-boost root service
// (scripts/install-fan-boost.sh): the settings go to the service's config file, which belongs
// to the desktop user; the service reads it every few seconds. Without the service there is no
// file and nothing is written.
//
// No GNOME Shell imports here: the preferences window uses this module too.

import GLib from 'gi://GLib';

export const FAN_CONFIG = '/etc/zoorin-fan-boost/fan.conf';

export const FAN_SCRIPT = '/usr/local/bin/zoorin-fan-boost';

export function fanServiceInstalled() {
    return GLib.file_test(FAN_CONFIG, GLib.FileTest.EXISTS);
}

// Whether the installed service also sets the CPU limits (an older one only drives the fan)
export function cpuControlInstalled() {
    if (!fanServiceInstalled())
        return false;
    try {
        const [, script] = GLib.file_get_contents(FAN_SCRIPT);
        return new TextDecoder().decode(script).includes('CPU_MAX');
    } catch (_e) {
        return false;
    }
}

export class FanBoostConfig {
    constructor(settings) {
        this._settings = settings;
        // Plain connect: connectObject() exists only inside GNOME Shell, not in the preferences
        this._ids = ['fan-boost', 'fan-boost-on', 'fan-boost-off', 'cpu-max-perf', 'cpu-turbo', 'cpu-epp']
            .map(key => settings.connect(`changed::${key}`, () => this.write()));
        this.write();
    }

    write() {
        if (!fanServiceInstalled())
            return;
        const on = this._settings.get_int('fan-boost-on');
        const off = Math.min(this._settings.get_int('fan-boost-off'), on - 1);
        const settings = this._settings;
        const text = '# Written by Zoorinlooklikemac (Preferences > Notch > Fan, Power)\n' +
            `ENABLED=${settings.get_boolean('fan-boost') ? 1 : 0}\nON=${on}\nOFF=${off}\nINTERVAL=2\n` +
            `CPU_MAX=${settings.get_int('cpu-max-perf')}\nTURBO=${settings.get_boolean('cpu-turbo') ? 1 : 0}\n` +
            `EPP=${settings.get_string('cpu-epp')}\n`;
        try {
            const [, current] = GLib.file_get_contents(FAN_CONFIG);
            if (new TextDecoder().decode(current) === text)
                return;
            GLib.file_set_contents(FAN_CONFIG, text);
        } catch (e) {
            console.warn('[zorin-notch] fan settings not written:', e.message);
        }
    }

    destroy() {
        this._ids.forEach(id => this._settings.disconnect(id));
        this._ids = [];
    }
}
