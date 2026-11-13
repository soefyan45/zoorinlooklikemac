// System info for the notch (Pego "Bar sistem"). The zorin-notchd daemon reads the numbers
// (daemon/src/sysinfo.rs); this asks it every few seconds while the info is shown, keeps a short
// history of the CPU load for the charts, and warns once when the CPU gets hot.
// Without the daemon there is simply nothing to show.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {_, decimal} from './i18n.js';

const BUS_NAME = 'io.github.soefyan45.ZorinNotchd';
const OBJECT_PATH = '/io/github/soefyan45/ZorinNotchd';
const INTERFACE = 'io.github.soefyan45.ZorinNotchd1';
const CALL_TIMEOUT_MS = 3000;
// CPU loads kept for the panel's chart
export const HISTORY = 40;
// Below this the temperature dot is green; from the warning setting on it is red
const WARM = 60;
// The warning comes back only after cooling this much below the limit
const COOL_DOWN = 5;
// Laptop CPUs touch high temperatures for a few seconds all the time: warn only when it stays
// hot this long, and not again sooner than this
const HOT_HOLD_MS = 30 * 1000;
const HOT_REPEAT_MS = 15 * 60 * 1000;

export const SystemItem = {
    CPU_LOAD: 'cpu-load',
    CPU_TEMP: 'cpu-temp',
    GPU: 'gpu',
    MEMORY: 'memory',
    SSD_TEMP: 'ssd-temp',
    NETWORK: 'network',
};

// Colors of the temperature dot and of the "follow temperature" chart
export const TEMP_COLORS = {cool: '#34C759', warm: '#FEBC2E', hot: '#FF453A'};

export function tempLevel(temp, warning) {
    if (temp === null || temp === undefined)
        return 'cool';
    return temp >= warning ? 'hot' : temp >= WARM ? 'warm' : 'cool';
}

export function formatBytes(bytes) {
    if (bytes >= 1e9)
        return `${decimal(bytes / 1e9)} GB`;
    if (bytes >= 1e6)
        return `${decimal(bytes / 1e6)} MB`;
    return `${Math.round(bytes / 1e3)} KB`;
}

export function formatSpeed(bytesPerSecond) {
    return `${formatBytes(bytesPerSecond)}/s`;
}

export class SystemStats {
    /**
     * @param {Gio.Settings} settings - show-system, system-interval, system-temp-warning
     * @param {object} callbacks - {onChange(), onHot(temp)}
     */
    constructor(settings, {onChange, onHot}) {
        this._settings = settings;
        this._onChange = onChange;
        this._onHot = onHot;
        this.latest = null;
        this.history = [];
        this._timerId = 0;
        this._warned = false;
        this._hotSince = null;
        this._lastWarning = -Infinity;
        this._cancellable = new Gio.Cancellable();
        this._settings.connectObject(
            'changed::show-system', () => this._schedule(),
            'changed::system-interval', () => this._schedule(), this);
        this._watchers = 0;
        this._schedule();
    }

    get enabled() {
        return this._settings.get_boolean('show-system');
    }

    get interval() {
        return Math.max(1, this._settings.get_int('system-interval'));
    }

    // The panel asks for fresher numbers while it is open, even with the bar item off
    watch(on) {
        this._watchers = Math.max(0, this._watchers + (on ? 1 : -1));
        this._schedule();
        if (on)
            this.refresh();
    }

    _schedule() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        if (!this.enabled && !this._watchers) {
            this.latest = null;
            this._onChange();
            return;
        }
        this.refresh();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.interval, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    refresh() {
        Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, INTERFACE, 'Stats', null,
            new GLib.VariantType('(s)'), Gio.DBusCallFlags.NONE, CALL_TIMEOUT_MS, this._cancellable,
            (connection, res) => {
                let stats = null;
                try {
                    const [json] = connection.call_finish(res).deepUnpack();
                    stats = JSON.parse(json);
                } catch (_e) {
                    // Daemon missing or too slow: nothing to show
                }
                if (this._cancellable.is_cancelled())
                    return;
                this._take(stats);
            });
    }

    _take(stats) {
        this.latest = stats;
        if (stats?.cpu) {
            this.history.push(stats.cpu.load);
            if (this.history.length > HISTORY)
                this.history.shift();
            this._checkHeat(stats.cpu.temp);
        }
        this._onChange();
    }

    // One notification when the CPU stays above the limit, then quiet until it has cooled down
    // and some time has passed. now: milliseconds (the self test passes its own clock)
    _checkHeat(temp, now = GLib.get_monotonic_time() / 1000) {
        if (typeof temp !== 'number')
            return;
        const warning = this._settings.get_int('system-temp-warning');
        if (temp < warning) {
            this._hotSince = null;
            if (temp < warning - COOL_DOWN)
                this._warned = false;
            return;
        }
        this._hotSince ??= now;
        if (!this._warned && now - this._hotSince >= HOT_HOLD_MS && now - this._lastWarning >= HOT_REPEAT_MS) {
            this._warned = true;
            this._lastWarning = now;
            this._onHot(temp);
        }
    }

    // Free and total space of the system disk, in bytes
    static disk() {
        try {
            const info = Gio.File.new_for_path('/').query_filesystem_info('filesystem::free,filesystem::size', null);
            return {free: info.get_attribute_uint64('filesystem::free'), size: info.get_attribute_uint64('filesystem::size')};
        } catch (_e) {
            return null;
        }
    }

    destroy() {
        this._cancellable.cancel();
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        this._settings.disconnectObject(this);
    }
}

// "{0}°", used in the bar
export function degrees(temp) {
    return typeof temp === 'number' ? `${Math.round(temp)}°` : '–';
}

export function hotMessage(temp) {
    return [_('The CPU is hot'), _('{0}°C, above your warning limit', Math.round(temp))];
}
