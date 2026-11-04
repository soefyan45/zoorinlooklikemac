// Coding agents (Claude Code, opencode) in the notch.
//
// The extension owns a small D-Bus service on the session bus. The agents' hooks report
// what they are doing with one call:
//
//   gdbus call --session --dest io.github.soefyan45.ZorinNotch \
//     --object-path /io/github/soefyan45/ZorinNotch \
//     --method io.github.soefyan45.ZorinNotch1.AgentEvent \
//     '"claude"' '"<session id>"' '"working"' '"<project>"' '"<message>"'
//
// Events: working (busy), waiting (needs permission or input), done (finished its turn),
// end (session closed).
//
// Permissions go both ways, through the zorin-notchd daemon: it calls PermissionAsked when a
// Claude Code hook waits for the user, the notch shows Allow / Deny, and the answer goes back
// to the daemon's Answer. PermissionClosed means the request is gone (answered in the
// terminal, or too late). Nothing is allowed without an explicit click.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {LOG_PREFIX, trace} from './log.js';

export const BUS_NAME = 'io.github.soefyan45.ZorinNotch';
export const OBJECT_PATH = '/io/github/soefyan45/ZorinNotch';

const INTERFACE_XML = `
<node>
  <interface name="io.github.soefyan45.ZorinNotch1">
    <method name="AgentEvent">
      <arg type="s" name="agent" direction="in"/>
      <arg type="s" name="session" direction="in"/>
      <arg type="s" name="event" direction="in"/>
      <arg type="s" name="project" direction="in"/>
      <arg type="s" name="message" direction="in"/>
    </method>
    <method name="PermissionAsked">
      <arg type="s" name="id" direction="in"/>
      <arg type="s" name="agent" direction="in"/>
      <arg type="s" name="session" direction="in"/>
      <arg type="s" name="project" direction="in"/>
      <arg type="s" name="tool" direction="in"/>
      <arg type="s" name="detail" direction="in"/>
      <arg type="u" name="timeout" direction="in"/>
      <arg type="b" name="accepted" direction="out"/>
    </method>
    <method name="PermissionClosed">
      <arg type="s" name="id" direction="in"/>
      <arg type="s" name="reason" direction="in"/>
    </method>
  </interface>
</node>`;

export const AgentStatus = {
    WORKING: 'working',
    WAITING: 'waiting',
    DONE: 'done',
};

const EVENTS = new Set(['working', 'waiting', 'done', 'end']);
const AGENT_NAMES = {claude: 'Claude', opencode: 'opencode', codex: 'Codex'};
// A busy session that stays silent this long is assumed gone (agent killed, hook missing)
const STALE_MS = 10 * 60 * 1000;
const SWEEP_SECONDS = 60;
const FIELD_MAX = 300;

const DAEMON_BUS = 'io.github.soefyan45.ZorinNotchd';
const DAEMON_PATH = '/io/github/soefyan45/ZorinNotchd';
const DAEMON_INTERFACE = 'io.github.soefyan45.ZorinNotchd1';
// More requests than this at once is not a person answering: leave the rest to the terminal
const MAX_PERMISSIONS = 10;
// A request that was never closed leaves the notch this long after its timeout
const PERMISSION_GRACE_S = 5;

export function agentName(agent) {
    return AGENT_NAMES[agent] ?? agent;
}

function clean(text) {
    return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, FIELD_MAX);
}

export class AgentTracker {
    /**
     * @param {object} callbacks - {onChange(), onPopup(entry), onPermission(),
     *   permissionsEnabled()}
     */
    constructor({onChange, onPopup, onPermission = () => {}, permissionsEnabled = () => true}) {
        this._onChange = onChange;
        this._onPopup = onPopup;
        this._onPermission = onPermission;
        this._permissionsEnabled = permissionsEnabled;
        this._sessions = new Map();
        this._permissions = [];

        this._dbus = Gio.DBusExportedObject.wrapJSObject(INTERFACE_XML, this);
        this._dbus.export(Gio.DBus.session, OBJECT_PATH);
        this._nameId = Gio.bus_own_name(Gio.BusType.SESSION, BUS_NAME, Gio.BusNameOwnerFlags.NONE,
            null, null, () => console.warn(LOG_PREFIX, `could not own ${BUS_NAME}`));

        this._sweepId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SWEEP_SECONDS, () => {
            this._sweep();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // D-Bus method; also called directly by the self test
    AgentEvent(agent, session, event, project, message) {
        try {
            this.handle({agent, session, event, project, message});
        } catch (e) {
            console.error(LOG_PREFIX, 'agent event failed', e);
        }
    }

    // D-Bus method: the daemon asks for the user's answer. True when the notch takes the
    // request, false to let the terminal ask.
    PermissionAsked(id, agent, session, project, tool, detail, timeout) {
        let accepted = false;
        try {
            accepted = this._addPermission({id, agent, session, project, tool, detail, timeout});
        } catch (e) {
            console.error(LOG_PREFIX, 'permission request failed', e);
        }
        return new GLib.Variant('(b)', [accepted]);
    }

    // D-Bus method: the request is gone (answered in the terminal, timed out)
    PermissionClosed(id, reason) {
        trace(`permission ${String(id).slice(0, 8)} closed: ${reason}`);
        this._removePermission(clean(id));
    }

    _addPermission({id, agent, session, project, tool, detail, timeout}) {
        id = clean(id);
        if (!this._permissionsEnabled() || !id || this._permissions.length >= MAX_PERMISSIONS ||
            this._permissions.some(p => p.id === id))
            return false;
        agent = clean(agent).toLowerCase() || 'agent';
        const entry = {
            permission: true,
            id,
            agent,
            name: agentName(agent),
            session: clean(session) || 'default',
            project: clean(project),
            tool: clean(tool),
            detail: clean(detail),
            status: AgentStatus.WAITING,
            message: '',
            updated: Date.now(),
        };
        entry.timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            Math.max(1, timeout) + PERMISSION_GRACE_S, () => {
                entry.timeoutId = 0;
                this._removePermission(id);
                return GLib.SOURCE_REMOVE;
            });
        this._permissions.push(entry);
        trace(`permission ${id.slice(0, 8)}: ${entry.tool} ${entry.detail}`);
        this._onPermission();
        return true;
    }

    _removePermission(id) {
        const index = this._permissions.findIndex(p => p.id === id);
        if (index < 0)
            return;
        const [entry] = this._permissions.splice(index, 1);
        if (entry.timeoutId)
            GLib.source_remove(entry.timeoutId);
        this._onPermission();
    }

    // The request waiting longest, which the notch shows first
    get permission() {
        return this._permissions[0] ?? null;
    }

    get permissionCount() {
        return this._permissions.length;
    }

    // The user's click: tell the daemon, which tells the waiting hook
    answer(id, allow) {
        this._removePermission(id);
        Gio.DBus.session.call(DAEMON_BUS, DAEMON_PATH, DAEMON_INTERFACE, 'Answer',
            new GLib.Variant('(sb)', [id, allow]), null, Gio.DBusCallFlags.NONE, 3000, null,
            (connection, res) => {
                try {
                    const [known] = connection.call_finish(res).deepUnpack();
                    if (!known)
                        console.warn(LOG_PREFIX, 'permission answer came too late');
                } catch (e) {
                    console.warn(LOG_PREFIX, 'permission answer failed:', e.message);
                }
            });
    }

    handle({agent, session, event, project, message}) {
        agent = clean(agent).toLowerCase() || 'agent';
        session = clean(session) || 'default';
        event = clean(event).toLowerCase();
        if (!EVENTS.has(event))
            return;
        trace(`agent ${agent}/${session.slice(0, 8)}: ${event} ${message ?? ''}`);

        const key = `${agent}:${session}`;
        if (event === 'end') {
            if (this._sessions.delete(key))
                this._onChange();
            return;
        }

        const previous = this._sessions.get(key);
        const entry = {
            agent,
            name: agentName(agent),
            session,
            project: clean(project) || previous?.project || '',
            status: event,
            message: clean(message),
            updated: Date.now(),
        };

        if (event === AgentStatus.DONE)
            this._sessions.delete(key);
        else
            this._sessions.set(key, entry);

        // Pop out when the agent stops for the user; "waiting" only once per wait
        // and "done" only for a session that was running (some agents report the end twice)
        const announce = (event === AgentStatus.DONE && !!previous) ||
            (event === AgentStatus.WAITING && previous?.status !== AgentStatus.WAITING);
        if (announce)
            this._onPopup(entry);
        this._onChange();
    }

    _sweep() {
        const now = Date.now();
        let changed = false;
        for (const [key, entry] of this._sessions) {
            if (now - entry.updated > STALE_MS) {
                this._sessions.delete(key);
                changed = true;
            }
        }
        if (changed)
            this._onChange();
    }

    // Sessions still running, those waiting for the user first
    get active() {
        return [...this._sessions.values()].sort((a, b) =>
            (b.status === AgentStatus.WAITING) - (a.status === AgentStatus.WAITING) ||
            b.updated - a.updated);
    }

    get hasActive() {
        return this._sessions.size > 0;
    }

    // Activate the window the agent most likely runs in: a window whose title names the
    // project (terminals show the working directory), else the agent's own desktop app
    focus(entry) {
        const windows = global.get_window_actors().map(a => a.meta_window)
            .filter(w => w && !w.skip_taskbar);
        const project = entry.project.toLowerCase();
        const byTitle = project && windows.find(w => (w.title ?? '').toLowerCase().includes(project));
        const byApp = windows.find(w => (w.wm_class ?? '').toLowerCase().includes(entry.agent));
        const target = byTitle || byApp;
        if (target)
            target.activate(global.get_current_time());
        else
            trace(`agent ${entry.agent}: no window found for ${entry.project}`);
    }

    destroy() {
        if (this._sweepId) {
            GLib.source_remove(this._sweepId);
            this._sweepId = 0;
        }
        if (this._nameId) {
            Gio.bus_unown_name(this._nameId);
            this._nameId = 0;
        }
        this._dbus?.unexport();
        this._dbus = null;
        this._sessions.clear();
        for (const entry of this._permissions) {
            if (entry.timeoutId)
                GLib.source_remove(entry.timeoutId);
        }
        this._permissions = [];
    }
}
