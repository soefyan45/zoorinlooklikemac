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
// end (session closed). Nothing is sent back to the agents: the notch only shows state.

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

export function agentName(agent) {
    return AGENT_NAMES[agent] ?? agent;
}

function clean(text) {
    return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, FIELD_MAX);
}

export class AgentTracker {
    /**
     * @param {object} callbacks - {onChange(), onPopup(entry)}
     */
    constructor({onChange, onPopup}) {
        this._onChange = onChange;
        this._onPopup = onPopup;
        this._sessions = new Map();

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
    }
}
