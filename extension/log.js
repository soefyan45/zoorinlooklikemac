// Logging helpers. Tracing is off by default; turn it on with ZORIN_NOTCH_TRACE=1 (nested test)
// or, in a normal session, by creating the file ~/.cache/zorin-notch/trace.

import GLib from 'gi://GLib';

export const LOG_PREFIX = '[zorin-notch]';

const TRACE_FILE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'zorin-notch', 'trace']);

export function traceEnabled() {
    return !!GLib.getenv('ZORIN_NOTCH_TRACE') || GLib.file_test(TRACE_FILE, GLib.FileTest.EXISTS);
}

export function trace(...args) {
    if (traceEnabled())
        console.log(LOG_PREFIX, ...args);
}
