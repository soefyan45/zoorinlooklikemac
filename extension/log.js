// Logging helpers. Tracing is off by default; turn it on with ZORIN_NOTCH_TRACE=1 (nested test)
// or, in a normal session, by creating the file ~/.cache/zorin-notch/trace.

import GLib from 'gi://GLib';

export const LOG_PREFIX = '[zorin-notch]';

const TRACE_FILE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'zorin-notch', 'trace']);

const TRACE_ENV = !!GLib.getenv('ZORIN_NOTCH_TRACE');
// The file is looked up at most this often (trace() runs on every dock motion)
const TRACE_CHECK_US = 5 * 1000 * 1000;
let traceFile = false;
let traceCheckedAt = -Infinity;

export function traceEnabled() {
    if (TRACE_ENV)
        return true;
    const now = GLib.get_monotonic_time();
    if (now - traceCheckedAt > TRACE_CHECK_US) {
        traceCheckedAt = now;
        traceFile = GLib.file_test(TRACE_FILE, GLib.FileTest.EXISTS);
    }
    return traceFile;
}

export function trace(...args) {
    if (traceEnabled())
        console.log(LOG_PREFIX, ...args);
}
