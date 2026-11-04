// File and document search for Spotlight. The work is done by the zorin-notchd daemon
// (daemon/src/search.rs, through GNOME's Tracker index); this is its D-Bus client.
// Without the daemon or without Tracker the search just finds nothing: Spotlight then shows
// apps only, as before.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'io.github.soefyan45.ZorinNotchd';
const OBJECT_PATH = '/io/github/soefyan45/ZorinNotchd';
const INTERFACE = 'io.github.soefyan45.ZorinNotchd1';
// Results per group (files, document contents)
const LIMIT = 4;
// The daemon starts on demand; the first call may wait for it
const TIMEOUT_MS = 3000;

export class FileSearch {
    /**
     * @param {Gio.Settings} settings - the "search-files" and "search-content" keys
     */
    constructor(settings) {
        this._settings = settings;
    }

    get enabled() {
        return this._settings.get_boolean('search-files') || this._settings.get_boolean('search-content');
    }

    /**
     * @returns {Promise<{kind: string, title: string, uri: string, snippet: string, mime: string}[]>}
     *   kind is "file", "folder" or "document"; empty on any failure or when both kinds are off
     */
    search(query, cancellable = null) {
        const files = this._settings.get_boolean('search-files');
        const content = this._settings.get_boolean('search-content');
        if (!query || (!files && !content))
            return Promise.resolve([]);

        return new Promise(resolve => {
            Gio.DBus.session.call(
                BUS_NAME, OBJECT_PATH, INTERFACE, 'Search',
                new GLib.Variant('(subb)', [query, LIMIT, files, content]),
                new GLib.VariantType('(a(sssss))'),
                Gio.DBusCallFlags.NONE, TIMEOUT_MS, cancellable,
                (connection, res) => {
                    try {
                        const [rows] = connection.call_finish(res).deepUnpack();
                        resolve(rows.map(([kind, title, uri, snippet, mime]) =>
                            ({kind, title, uri, snippet, mime})));
                    } catch (_e) {
                        // Cancelled, daemon missing or too slow
                        resolve([]);
                    }
                });
        });
    }
}
