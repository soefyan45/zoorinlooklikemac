// Music in the notch: follows the media players on the session bus (MPRIS, the standard that
// browsers, Spotify, VLC and others speak) and offers the one that plays, or else the one
// that played last, with its title, artist, cover and the play/pause/next/previous controls.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {LOG_PREFIX, trace} from './log.js';

const PLAYER_PREFIX = 'org.mpris.MediaPlayer2.';
const PLAYER_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_INTERFACE = 'org.mpris.MediaPlayer2.Player';

export class MediaWatcher {
    /**
     * @param {function} onChange - called when what the notch shows about music changes
     */
    constructor(onChange) {
        this._onChange = onChange;
        this._players = new Map();
        this._tick = 0;
        this._cancellable = new Gio.Cancellable();

        this._subscription = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus',
            null, Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _n, params) => {
                const [name, , owner] = params.deepUnpack();
                if (!name.startsWith(PLAYER_PREFIX))
                    return;
                if (owner)
                    this._add(name);
                else
                    this._remove(name);
            });
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1,
            this._cancellable, (connection, res) => {
                try {
                    const [names] = connection.call_finish(res).deepUnpack();
                    names.filter(n => n.startsWith(PLAYER_PREFIX)).forEach(n => this._add(n));
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(LOG_PREFIX, 'listing media players failed:', e.message);
                }
            });
    }

    _add(name) {
        if (this._players.has(name))
            return;
        const entry = {name, proxy: null, activity: 0};
        this._players.set(name, entry);
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
            name, PLAYER_PATH, PLAYER_INTERFACE, this._cancellable, (_source, res) => {
                try {
                    entry.proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    this._players.delete(name);
                    trace(`media player ${name}: ${e.message}`);
                    return;
                }
                // The player may have gone while the proxy was being made
                if (this._players.get(name) !== entry) {
                    entry.proxy = null;
                    return;
                }
                entry.proxy.connectObject('g-properties-changed', () => {
                    this._touch(entry);
                    this._onChange();
                }, this);
                this._touch(entry);
                this._onChange();
            });
    }

    _remove(name) {
        const entry = this._players.get(name);
        if (!entry)
            return;
        this._players.delete(name);
        entry.proxy?.disconnectObject(this);
        this._onChange();
    }

    // Most recently active first: the order of "last played"
    _touch(entry) {
        entry.activity = ++this._tick;
    }

    _read(entry) {
        const proxy = entry.proxy;
        const status = proxy?.get_cached_property('PlaybackStatus')?.unpack();
        if (status !== 'Playing' && status !== 'Paused')
            return null;
        const metadata = proxy.get_cached_property('Metadata')?.recursiveUnpack() ?? {};
        const artists = metadata['xesam:artist'];
        return {
            name: entry.name,
            playing: status === 'Playing',
            title: String(metadata['xesam:title'] ?? ''),
            artist: Array.isArray(artists) ? artists.join(', ') : String(artists ?? ''),
            artUrl: String(metadata['mpris:artUrl'] ?? ''),
            activity: entry.activity,
        };
    }

    /**
     * The player to show: one that plays, else the one that last played or paused.
     * @returns {{name, playing, title, artist, artUrl}|null}
     */
    get current() {
        const tracks = [...this._players.values()].map(e => this._read(e)).filter(Boolean);
        tracks.sort((a, b) => (b.playing - a.playing) || (b.activity - a.activity));
        return tracks[0] ?? null;
    }

    playPause() {
        this._call('PlayPause');
    }

    next() {
        this._call('Next');
    }

    previous() {
        this._call('Previous');
    }

    _call(method) {
        const track = this.current;
        if (!track)
            return;
        Gio.DBus.session.call(track.name, PLAYER_PATH, PLAYER_INTERFACE, method, null, null,
            Gio.DBusCallFlags.NONE, 2000, null, (connection, res) => {
                try {
                    connection.call_finish(res);
                } catch (e) {
                    trace(`media ${method} on ${track.name} failed: ${e.message}`);
                }
            });
    }

    destroy() {
        this._cancellable.cancel();
        if (this._subscription) {
            Gio.DBus.session.signal_unsubscribe(this._subscription);
            this._subscription = 0;
        }
        for (const entry of this._players.values())
            entry.proxy?.disconnectObject(this);
        this._players.clear();
    }
}
