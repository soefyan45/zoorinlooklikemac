// Development-only self test, run when ZORIN_NOTCH_SELFTEST is set (scripts/nested-test.sh).
// 1. Recreates the notch 10 times and checks no actor is left behind.
// 2. Puts the notch in each state and saves a screenshot of the top center to the shot dir.
// 3. Checks the panel: dark mode toggle, Esc and a click outside close it.
// The nested session has its own dconf database, so toggling settings here is harmless.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import St from 'gi://St';

import {State} from './notch.js';

const LOG_PREFIX = '[zorin-notch][selftest]';
const SETTLE_MS = 1500;
const SHOT_SIZE = [760, 340];

function wait(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

function check(name, ok, detail = '') {
    console.log(LOG_PREFIX, `${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

function countNotchActors() {
    let count = 0;
    const visit = actor => {
        if (actor.name === 'zorinNotch')
            count++;
        actor.get_children().forEach(visit);
    };
    visit(Main.layoutManager.uiGroup);
    return count;
}

async function screenshotFull(file) {
    const monitor = Main.layoutManager.primaryMonitor;
    const stream = Gio.File.new_for_path(file).replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await new Promise(resolve => shooter.screenshot_area(monitor.x, monitor.y, monitor.width,
        monitor.height, stream, () => resolve()));
    stream.close(null);
}

async function screenshot(file) {
    const monitor = Main.layoutManager.primaryMonitor;
    const [w, h] = SHOT_SIZE;
    const x = monitor.x + Math.round((monitor.width - w) / 2);
    const stream = Gio.File.new_for_path(file).replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await new Promise((resolve, reject) => {
        shooter.screenshot_area(x, monitor.y, w, h, stream, (_obj, res) => {
            try {
                shooter.screenshot_area_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
    stream.close(null);
}

function virtualDevices() {
    const seat = Clutter.get_default_backend().get_default_seat();
    return {
        keyboard: seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE),
        pointer: seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE),
    };
}

function pressKey(keyboard, keyval) {
    const time = GLib.get_monotonic_time();
    keyboard.notify_keyval(time, keyval, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(time + 1000, keyval, Clutter.KeyState.RELEASED);
}

// The motion is processed asynchronously; press only after the pointer has arrived
async function clickAt(pointer, x, y) {
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    await wait(150);
    const time = GLib.get_monotonic_time();
    pointer.notify_button(time, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    pointer.notify_button(time + 1000, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
}

async function shoot(notch, shotDir, state) {
    notch.setState(state);
    await wait(SETTLE_MS);
    const file = `${shotDir}/${state}.png`;
    await screenshot(file);
    console.log(LOG_PREFIX, `shot ${state}: ${file} ` +
        `(state=${notch.state} size=${notch.debugSize} actor=${notch.actor.width}x${notch.actor.height})`);
}

// A stand-in for an app indicator: it lands in the panel's right box like a real one
async function testTray(notch, keyboard, shotDir) {
    const button = new PanelMenu.Button(0.5, 'Uji tray', false);
    button.add_child(new St.Icon({icon_name: 'face-smile-symbolic', style_class: 'system-status-icon'}));
    button.menu.addMenuItem(new PopupMenu.PopupMenuItem('Item uji'));
    Main.panel.addToStatusArea('zorinNotchTrayTest', button);
    await wait(300);
    check('tray icon moves into the notch', button.container.get_parent() === notch._panelView.trayRow,
        `${button.container.get_parent()?.style_class}`);

    notch.setState(State.PANEL);
    await wait(SETTLE_MS);
    check('tray row shown in the panel', notch._panelView.trayRow.visible);
    if (shotDir) {
        await screenshot(`${shotDir}/panel-tray.png`);
        console.log(LOG_PREFIX, `shot panel-tray (size=${notch.debugSize})`);
    }
    button.menu.open();
    await wait(300);
    check('tray menu opens from the notch', button.menu.isOpen);
    button.menu.close();
    await wait(200);
    pressKey(keyboard, Clutter.KEY_Escape);
    await wait(400);
    check('panel closes after the tray menu', notch.state === State.IDLE, notch.state);
    button.destroy();
}

// Magnification on the zorin-taskbar dock (needs DOCK=1 for the dock layout). The virtual
// pointer of the test is not the seat's pointer, so the zoom math is driven directly; real
// mouse motion is covered by hand.
async function testDockZoom(extension, shotDir) {
    const zoom = extension._dockZoom;
    const taskbar = global.zorinTaskbar?.panels?.[0]?.taskbar;
    const icons = taskbar?._getTaskbarIcons?.().map(c => c.child) ?? [];
    if (!zoom || !icons.length) {
        check('dock zoom', false, `zoom=${!!zoom} icons=${icons.length}`);
        return;
    }
    // Geometry of the dock, outermost first, to see where its padding comes from
    const panel = global.zorinTaskbar.panels[0];
    const chain = [['panelBox', panel.panelBox], ['clipContainer', panel.clipContainer], ['dtpPanel', panel],
        ['panel', panel.panel], ['taskbar.actor', taskbar.actor], ['_container', taskbar._container],
        ['_scrollView', taskbar._scrollView], ['_box', taskbar._box], ['item0', taskbar._box?.get_first_child()]];
    for (const [name, actor] of chain) {
        if (!actor)
            continue;
        const [ax, ay] = actor.get_transformed_position();
        const node = actor.get_theme_node?.();
        const pad = node ? ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'].map(side => node.get_padding(St.Side[side])).join(',') : '-';
        console.log(LOG_PREFIX, `dock geom ${name}: x=${Math.round(ax)} y=${Math.round(ay)} ` +
            `${actor.width}x${actor.height} pad=${pad} style="${actor.get_style?.() ?? ''}" class="${actor.style_class ?? ''}"`);
    }
    for (const item of taskbar._box?.get_children() ?? []) {
        const c = item.child;
        console.log(LOG_PREFIX, `dock item ${c?.app?.get_id?.() ?? item.constructor.name}: item=${item.width} ` +
            `itemStyle="${item.get_style?.() ?? ''}" child=${c?.width} childStyle="${c?.get_style?.() ?? ''}" ` +
            `iconC=${c?._iconContainer?.width} iconCStyle="${c?._iconContainer?.get_style?.()}" ` +
            `iconKids=${c?._iconContainer?.get_children?.().map(k => `${k.constructor.name}:${k.width}/${k.get_style?.() ?? ''}/${k.style_class ?? ''}`).join(' ')} ` +
            `icon=${c?.icon?.width} iconSize=${c?.icon?.iconSize} kids=${c?.get_children?.().map(k => `${k.constructor.name}:${k.width}${k.visible ? '' : '(h)'}`).join(' ')}`);
    }
    for (const child of panel.panel?.get_children?.() ?? [])
        console.log(LOG_PREFIX, `dock panel child ${child.name ?? child.constructor.name}: ${child.width}x${child.height} visible=${child.visible}`);

    const icon = icons[0];
    const [x] = icon.get_transformed_position();
    const [w] = icon.get_transformed_size();
    zoom.noWatch = true;
    zoom._magnify(taskbar, x + w / 2);
    await wait(300);
    check('dock icon grows under the pointer', icon.scale_x > 1.2, icon.scale_x.toFixed(2));
    if (icons[1])
        console.log(LOG_PREFIX, `neighbor scale ${icons[1].scale_x.toFixed(2)}`);
    if (shotDir) {
        const monitor = Main.layoutManager.primaryMonitor;
        const stream = Gio.File.new_for_path(`${shotDir}/dock-zoom.png`)
            .replace(null, false, Gio.FileCreateFlags.NONE, null);
        const shooter = new Shell.Screenshot();
        await new Promise(resolve => shooter.screenshot_area(monitor.x + monitor.width / 2 - 300,
            monitor.y + monitor.height - 90, 600, 90, stream, () => resolve()));
        stream.close(null);
    }
    zoom._reset(taskbar);
    zoom.noWatch = false;
    await wait(300);
    check('dock icon returns to normal size', Math.abs(icon.scale_x - 1) < 0.01, icon.scale_x.toFixed(2));
}

// zorin-taskbar disabled and enabled again (it makes a new emitter): the dock must get its zoom,
// compact icons and glass plate back instead of turning into the plain bar
async function testDockSurvivesTaskbarRestart(extension) {
    const zoom = extension._dockZoom;
    const uuid = 'zorin-taskbar@zorinos.com';
    if (!zoom || !Main.extensionManager.lookup(uuid)) {
        check('dock survives a taskbar restart', false, 'no dock zoom or taskbar');
        return;
    }
    const before = zoom._plates.size;
    Main.extensionManager.disableExtension(uuid);
    await wait(500);
    check('dock lets go when the taskbar is disabled', zoom._plates.size === 0 && zoom._watched.size === 0,
        `plates=${zoom._plates.size} watched=${zoom._watched.size}`);
    Main.extensionManager.enableExtension(uuid);
    for (let i = 0; i < 20 && zoom._plates.size < before; i++)
        await wait(500);
    check('dock zoom and plate return after the taskbar is enabled again',
        before > 0 && zoom._plates.size === before && zoom._watched.size === before,
        `before=${before} plates=${zoom._plates.size} watched=${zoom._watched.size}`);
}

// Spotlight files: a fake daemon on the bus answers Search, so the client, the groups and the
// settings can be checked without Tracker
const FAKE_DAEMON_XML = `<node><interface name="io.github.soefyan45.ZorinNotchd1">
<method name="Search">
  <arg type="s" direction="in" name="query"/><arg type="u" direction="in" name="limit"/>
  <arg type="b" direction="in" name="files"/><arg type="b" direction="in" name="content"/>
  <arg type="a(sssss)" direction="out" name="hits"/>
</method></interface></node>`;

async function testFileSearch(extension, notch, shotDir) {
    const settings = extension.getSettings();
    const calls = [];
    const exported = Gio.DBusExportedObject.wrapJSObject(FAKE_DAEMON_XML, {
        Search(query, limit, files, content) {
            calls.push({query, files, content});
            return new GLib.Variant('(a(sssss))', [[
                ['file', 'report.txt', 'file:///home/test/Documents/report.txt', '', 'text/plain'],
                ['folder', 'Reports', 'file:///home/test/Reports', '', 'inode/directory'],
                ['document', 'budget.pdf', 'file:///home/test/Documents/budget.pdf', 'the «report» is due', 'application/pdf'],
            ]]);
        },
    });
    exported.export(Gio.DBus.session, '/io/github/soefyan45/ZorinNotchd');
    const owner = Gio.bus_own_name_on_connection(Gio.DBus.session, 'io.github.soefyan45.ZorinNotchd',
        Gio.BusNameOwnerFlags.NONE, null, null);
    try {
        check('file search settings default to on',
            settings.get_boolean('search-files') && settings.get_boolean('search-content'));

        notch.openSearch();
        await wait(500);
        const view = notch.spotlight.view;
        check('hint mentions files', view.entry.hint_text.length > 0 && view.entry.hint_text !== 'Search apps…',
            view.entry.hint_text);
        view.entry.text = 'report';
        await wait(1200);
        const keys = view._rows.map(r => r.key);
        check('daemon is asked once, with both kinds', calls.length === 1 && calls[0].query === 'report' &&
            calls[0].files && calls[0].content, JSON.stringify(calls));
        check('hits show up as files and document contents',
            keys.includes('hit:file:///home/test/Documents/report.txt') &&
            keys.includes('hit:file:///home/test/Reports') &&
            keys.includes('hit:file:///home/test/Documents/budget.pdf'), keys.join(', '));
        check('overview row stays last', keys[keys.length - 1] === 'overview', keys.join(', '));
        check('hits open their folder with Ctrl+Enter',
            view._rows.filter(r => r.key.startsWith('hit:')).every(r => typeof r.reveal === 'function'));
        if (shotDir)
            await screenshotFull(`${shotDir}/search-files.png`);

        // Both kinds off: nothing is asked and nothing is shown
        settings.set_boolean('search-files', false);
        settings.set_boolean('search-content', false);
        notch.spotlight.close();
        await wait(500);
        notch.openSearch();
        await wait(500);
        view.entry.text = 'report2';
        await wait(1000);
        check('no daemon call with the kinds off', calls.length === 1, `${calls.length}`);
        check('no hits with the kinds off', !view._rows.some(r => r.key.startsWith('hit:')));
        check('hint goes back to apps only', view.entry.hint_text === 'Search apps…', view.entry.hint_text);
    } finally {
        settings.reset('search-files');
        settings.reset('search-content');
        notch.spotlight.close();
        await wait(500);
        Gio.bus_unown_name(owner);
        exported.unexport();
    }
}

// Permissions: the real daemon and the real hook, against the nested session bus. The hook
// waits; the notch shows Allow / Deny; the answer reaches the hook's stdout.
function findByStyle(actor, styleClass) {
    if (actor.has_style_class_name?.(styleClass))
        return actor;
    for (const child of actor.get_children()) {
        const found = findByStyle(child, styleClass);
        if (found)
            return found;
    }
    return null;
}

async function testPermissions(extension, notch, shotDir) {
    const rust = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'zorin-notchd']);
    if (!GLib.file_test(rust, GLib.FileTest.IS_EXECUTABLE)) {
        console.log(LOG_PREFIX, 'SKIP permissions (zorin-notchd is not installed)');
        return;
    }
    const settings = extension.getSettings();
    const daemon = Gio.Subprocess.new([rust, 'daemon'], Gio.SubprocessFlags.NONE);
    const runHook = (tool, input) => {
        const proc = new Gio.Subprocess({
            argv: [rust, 'hook', 'claude'],
            flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE,
        });
        proc.init(null);
        const payload = JSON.stringify({
            hook_event_name: 'PermissionRequest', session_id: 'sesi-izin', cwd: '/tmp/proyek-izin',
            tool_name: tool, tool_input: input,
        });
        const result = new Promise(resolve => proc.communicate_utf8_async(payload, null, (p, res) => {
            try {
                resolve(p.communicate_utf8_finish(res)[1]);
            } catch (_e) {
                resolve(null);
            }
        }));
        // A broken hook must not hold the test for its whole minute
        const bounded = Promise.race([result, wait(6000).then(() => 'STILL WAITING')]);
        return {proc, result: bounded};
    };
    const decision = out => {
        try {
            return JSON.parse(out).hookSpecificOutput.decision.behavior;
        } catch (_e) {
            return out || 'none';
        }
    };
    try {
        await wait(1000);
        notch.setState(State.IDLE);
        await wait(500);

        const allowed = runHook('Bash', {command: 'ls -la /tmp'});
        await wait(1500);
        const entry = notch._agents.permission;
        check('permission request reaches the notch',
            !!entry && entry.tool === 'Bash' && entry.detail === 'ls -la /tmp' && entry.project === 'proyek-izin',
            JSON.stringify(entry && {tool: entry.tool, detail: entry.detail, project: entry.project}));
        check('notch shows Allow and Deny', notch.state === State.AGENT && notch._agentView.entry?.id === entry?.id &&
            !!findByStyle(notch._agentView.actor, 'zorin-notch-ai-button') &&
            !!findByStyle(notch._agentView.actor, 'zorin-notch-notif-button'), notch.state);
        check('no auto close while it waits', !notch._autoCloseId);
        if (shotDir)
            await screenshot(`${shotDir}/permission.png`);
        findByStyle(notch._agentView.actor, 'zorin-notch-ai-button').emit('clicked', 0);
        const allowResult = decision(await allowed.result);
        check('Allow gives the hook an allow decision', allowResult === 'allow', allowResult);
        await wait(500);
        check('notch lets go after the answer', !notch._agents.permission && notch.state !== State.AGENT, notch.state);

        const denied = runHook('Bash', {command: `cd /var/www && ${'git log --oneline --decorate --all && '.repeat(7)}echo done`});
        await wait(1500);
        if (shotDir)
            await screenshot(`${shotDir}/permission-long.png`);
        findByStyle(notch._agentView.actor, 'zorin-notch-notif-button').emit('clicked', 0);
        const denyResult = decision(await denied.result);
        check('Deny gives the hook a deny decision', denyResult === 'deny', denyResult);
        await wait(500);

        // Two at once: first one, then the other
        const first = runHook('Bash', {command: 'echo one'});
        await wait(800);
        const second = runHook('Bash', {command: 'echo two'});
        await wait(1200);
        check('two requests queue up', notch._agents.permissionCount === 2, `${notch._agents.permissionCount}`);
        findByStyle(notch._agentView.actor, 'zorin-notch-ai-button').emit('clicked', 0);
        await wait(800);
        check('the next request shows after the first is answered',
            notch._agentView.entry?.detail === 'echo two' && notch.state === State.AGENT,
            `${notch._agentView.entry?.detail} ${notch.state}`);
        findByStyle(notch._agentView.actor, 'zorin-notch-notif-button').emit('clicked', 0);
        const answers = [decision(await first.result), decision(await second.result)];
        check('each hook gets its own answer', answers.join() === 'allow,deny', answers.join());

        // Answered in the terminal: Claude Code ends the hook, the notch lets go
        const gone = runHook('Bash', {command: 'pwd'});
        await wait(1500);
        check('request shows again', !!notch._agents.permission);
        gone.proc.force_exit();
        await wait(3000);
        check('notch drops a request whose hook is gone', !notch._agents.permission && notch.state !== State.AGENT,
            `${notch._agents.permission?.detail} ${notch.state}`);

        // Not for the notch: too long to read in full, or a question to the user
        const long = runHook('Bash', {command: 'x'.repeat(400)});
        const question = runHook('AskUserQuestion', {questions: []});
        const longResult = decision(await long.result);
        const questionResult = decision(await question.result);
        check('a command too long to show goes to the terminal', longResult === 'none' && !notch._agents.permission, longResult);
        check('a question to the user goes to the terminal', questionResult === 'none', questionResult);

        // Switched off: no wait at all
        settings.set_boolean('agent-permissions', false);
        const off = runHook('Bash', {command: 'ls'});
        const offResult = decision(await off.result);
        check('switched off: the hook asks the terminal at once', offResult === 'none' && !notch._agents.permission, offResult);
    } finally {
        settings.reset('agent-permissions');
        daemon.force_exit();
        notch._agents.handle({agent: 'claude', session: 'sesi-izin', event: 'end', project: 'proyek-izin', message: ''});
        notch.setState(State.IDLE);
        await wait(500);
    }
}

// Music: a fake MPRIS player on the bus. The line dances while it plays, hovering shows its
// title and controls, pausing lets the line rest, and the setting turns it all off.
const FAKE_PLAYER_XML = `<node><interface name="org.mpris.MediaPlayer2.Player">
<method name="PlayPause"/><method name="Next"/><method name="Previous"/>
<property name="PlaybackStatus" type="s" access="read"/>
<property name="Metadata" type="a{sv}" access="read"/>
</interface></node>`;

async function testMedia(extension, notch, shotDir) {
    const settings = extension.getSettings();
    const state = {status: 'Playing'};
    const calls = [];
    const exported = Gio.DBusExportedObject.wrapJSObject(FAKE_PLAYER_XML, {
        get PlaybackStatus() {
            return state.status;
        },
        get Metadata() {
            return new GLib.Variant('a{sv}', {
                'xesam:title': new GLib.Variant('s', 'Jalan Braga'),
                'xesam:artist': new GLib.Variant('as', ['Kolektif Senja']),
            });
        },
        PlayPause() {
            calls.push('PlayPause');
        },
        Next() {
            calls.push('Next');
        },
        Previous() {
            calls.push('Previous');
        },
    });
    exported.export(Gio.DBus.session, '/org/mpris/MediaPlayer2');
    const owner = Gio.bus_own_name_on_connection(Gio.DBus.session, 'org.mpris.MediaPlayer2.zorintest',
        Gio.BusNameOwnerFlags.NONE, null, null);
    notch.freezePointer(true);
    try {
        notch.setState(State.IDLE);
        await wait(2000);
        const track = notch._media.current;
        check('media watcher finds the player', track?.title === 'Jalan Braga' &&
            track.artist === 'Kolektif Senja' && track.playing, JSON.stringify(track));
        check('music playing animates the line', notch.state === State.ACTIVITY, notch.state);
        check('the line makes room for the bars', notch._height.target >= 8, `${notch._height.target}`);
        if (shotDir)
            await screenshot(`${shotDir}/media-line.png`);

        // The panel's Now playing card
        notch.setState(State.PANEL);
        await wait(SETTLE_MS);
        const card = notch._panelView._nowPlaying;
        check('panel shows the Now playing card', card.actor.visible && card._title.text === 'Jalan Braga' &&
            card._artist.text === 'Kolektif Senja', `${card.actor.visible} ${card._title.text}`);
        check('the card shows the pause button while playing', card.playButton.child.icon_name === 'media-playback-pause-symbolic');
        if (shotDir)
            await screenshot(`${shotDir}/media-card.png`);
        card.playButton.emit('clicked', 0);
        await wait(400);
        check('the card button reaches the player', calls.join() === 'PlayPause', calls.join());
        calls.length = 0;
        notch.setState(State.IDLE);
        await wait(500);

        notch.setState(State.PEEK);
        await waitSettled(notch);
        await wait(1000);
        check('hover shows the music row instead of the clock', notch._mediaRow.actor.visible &&
            !notch._statusRow.actor.visible, `${notch._mediaRow.actor.visible} ${notch._statusRow.actor.visible}`);
        if (shotDir)
            await screenshot(`${shotDir}/media-peek.png`);
        notch._mediaRow.playButton.emit('clicked', 0);
        notch._mediaRow.nextButton.emit('clicked', 0);
        notch._mediaRow.previousButton.emit('clicked', 0);
        await wait(500);
        check('the buttons reach the player', calls.join() === 'PlayPause,Next,Previous', calls.join());

        state.status = 'Paused';
        exported.emit_property_changed('PlaybackStatus', new GLib.Variant('s', 'Paused'));
        // The change travels over the bus: wait until the notch has heard it
        for (let i = 0; i < 20 && notch._media.current?.playing; i++)
            await wait(250);
        notch.setState(State.IDLE);
        await wait(1000);
        check('paused: the line rests', notch.state === State.IDLE, notch.state);
        check('paused: the player is still offered', notch._media.current && !notch._media.current.playing);

        state.status = 'Playing';
        exported.emit_property_changed('PlaybackStatus', new GLib.Variant('s', 'Playing'));
        for (let i = 0; i < 20 && !notch._media.current?.playing; i++)
            await wait(250);
        await wait(1000);
        check('playing again: the line dances', notch.state === State.ACTIVITY, notch.state);

        settings.set_boolean('show-media', false);
        await wait(1000);
        check('setting off: the line rests', notch.state === State.IDLE, notch.state);
        settings.reset('show-media');
        await wait(500);

        Gio.bus_unown_name(owner);
        exported.unexport();
        await wait(1000);
        check('player gone: nothing is shown', !notch._media.current && notch.state === State.IDLE, notch.state);
    } finally {
        notch.freezePointer(false);
        settings.reset('show-media');
        notch.setState(State.IDLE);
        await wait(500);
    }
}

// Coding agents: the D-Bus service, the activity row (04) and the agent popup (08). The real
// Claude Code hook script is run too, against the nested session bus.
function callAgentEvent(...args) {
    return new Promise((resolve, reject) => Gio.DBus.session.call(
        'io.github.soefyan45.ZorinNotch', '/io/github/soefyan45/ZorinNotch',
        'io.github.soefyan45.ZorinNotch1', 'AgentEvent',
        new GLib.Variant('(sssss)', args), null, Gio.DBusCallFlags.NONE, 2000, null,
        (conn, res) => {
            try {
                conn.call_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        }));
}

async function testAgents(notch, shotDir) {
    notch.setState(State.IDLE);
    await wait(500);

    await callAgentEvent('claude', 'sesi-uji', 'working', 'zoorinlooklikemac', 'Running Bash');
    await wait(SETTLE_MS);
    check('working agent animates the standby line', notch.state === State.ACTIVITY &&
        Math.round(notch._height.value) <= 8, `${notch.state} ${notch.debugSize}`);
    check('line animation runs', notch._activityTimeline.is_playing());
    notch._settings.set_string('agent-color', 'teal');
    check('animation color follows the preferences', notch._agentColor() === '#4FD1C5', notch._agentColor());
    notch._settings.reset('agent-color');
    check('default animation color is the accent', notch._agentColor() === '#F05A24', notch._agentColor());
    if (shotDir) {
        for (const style of ['sweep', 'swap', 'dots']) {
            notch._settings.set_string('agent-indicator', style);
            await wait(400);
            await screenshot(`${shotDir}/activity-${style}.png`);
        }
        notch._settings.set_string('agent-indicator', 'dots');
        notch._settings.set_string('agent-color', 'teal');
        await wait(400);
        await screenshot(`${shotDir}/activity-dots-teal.png`);
        notch._settings.reset('agent-indicator');
        notch._settings.reset('agent-color');
    }

    // Hovering while an agent works shows its row
    notch.setState(State.PEEK);
    await wait(SETTLE_MS);
    check('hover shows date, time, network and battery while an agent works',
        notch._statusRow.actor.visible && !notch._activityRow.actor.visible);
    if (shotDir)
        await screenshot(`${shotDir}/activity.png`);
    notch.setState(State.IDLE);
    await wait(500);

    await callAgentEvent('claude', 'sesi-uji', 'waiting', 'zoorinlooklikemac', 'Claude needs your permission to use Bash');
    await wait(SETTLE_MS);
    check('waiting agent pops out (08)', notch.state === State.AGENT, notch.state);
    if (shotDir) {
        await screenshot(`${shotDir}/aiNotification.png`);
        console.log(LOG_PREFIX, `shot agent (size=${notch.debugSize})`);
    }
    notch.setState(State.IDLE);
    await wait(500);
    check('dismissed popup returns to the activity line', notch.state === State.ACTIVITY, notch.state);
    if (shotDir)
        await screenshot(`${shotDir}/activity-waiting.png`);

    await callAgentEvent('claude', 'sesi-uji', 'done', 'zoorinlooklikemac', 'Claude finished its turn');
    await wait(SETTLE_MS);
    check('done agent pops out', notch.state === State.AGENT, notch.state);
    notch.setState(State.IDLE);
    await wait(500);
    check('no active agent: back to the idle line', notch.state === State.IDLE, notch.state);

    // The real hook script, fed like Claude Code feeds it
    const repo = GLib.getenv('ZORIN_NOTCH_REPO');
    if (repo) {
        const json = JSON.stringify({
            hook_event_name: 'PreToolUse', session_id: 'sesi-hook', cwd: '/tmp/proyek-hook', tool_name: 'Edit',
        });
        GLib.spawn_command_line_async(`bash -c ${GLib.shell_quote(`echo ${GLib.shell_quote(json)} | ${repo}/agents/claude-hook.sh`)}`);
        await wait(SETTLE_MS);
        const hooked = notch._agents.active.find(e => e.session === 'sesi-hook');
        check('claude-hook.sh reaches the notch', !!hooked && hooked.project === 'proyek-hook',
            hooked ? `${hooked.status} ${hooked.project} "${hooked.message}"` : 'nothing');
        notch._agents.handle({agent: 'claude', session: 'sesi-hook', event: 'end'});
        await wait(300);
    }

    // The Rust hook binary (scripts/install-daemon.sh), as Claude Code and opencode call it
    const rust = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'zorin-notchd']);
    if (GLib.file_test(rust, GLib.FileTest.IS_EXECUTABLE)) {
        const json = JSON.stringify({
            hook_event_name: 'PreToolUse', session_id: 'sesi-rust', cwd: '/tmp/proyek-rust', tool_name: 'Edit',
        });
        GLib.spawn_command_line_async(`bash -c ${GLib.shell_quote(`echo ${GLib.shell_quote(json)} | ${rust} hook claude`)}`);
        GLib.spawn_command_line_async(`${rust} event opencode sesi-rust-oc working proyek-oc 'Running bash'`);
        await wait(SETTLE_MS);
        const hooked = notch._agents.active.find(e => e.session === 'sesi-rust');
        check('zorin-notchd hook claude reaches the notch',
            !!hooked && hooked.project === 'proyek-rust' && hooked.message === 'Running Edit',
            hooked ? `${hooked.status} ${hooked.project} "${hooked.message}"` : 'nothing');
        const event = notch._agents.active.find(e => e.session === 'sesi-rust-oc');
        check('zorin-notchd event reaches the notch', !!event && event.agent === 'opencode',
            event ? `${event.agent} ${event.status} ${event.project} "${event.message}"` : 'nothing');
        GLib.spawn_command_line_async(`${rust} event claude sesi-rust end proyek-rust`);
        GLib.spawn_command_line_async(`${rust} event opencode sesi-rust-oc end proyek-oc`);
        await wait(300);
    }
}

// Preferences reach the notch and the dock (isolated dconf in the nested session)
async function testSettings(extension, notch) {
    const settings = extension.getSettings();
    notch.setState(State.IDLE);
    await wait(500);

    settings.set_int('idle-width', 200);
    await wait(SETTLE_MS);
    check('idle width follows the preferences', Math.round(notch._width.value) === 200, notch.debugSize);
    settings.reset('idle-width');

    const taskbar = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.zorin-taskbar'});
    settings.set_string('dock-autohide', 'all-windows');
    await wait(300);
    check('auto hide turns on zorin-taskbar intellihide',
        taskbar.get_boolean('intellihide') && taskbar.get_string('intellihide-behaviour') === 'ALL_WINDOWS',
        `${taskbar.get_boolean('intellihide')} ${taskbar.get_string('intellihide-behaviour')}`);
    settings.set_string('dock-autohide', 'off');
    await wait(300);
    check('auto hide off turns intellihide off', !taskbar.get_boolean('intellihide'));

    settings.set_int('dock-size', 48);
    await wait(300);
    check('dock size goes to zorin-taskbar', taskbar.get_int('panel-size') === 48 &&
        Object.values(JSON.parse(taskbar.get_string('panel-sizes'))).every(v => v === 48),
        `${taskbar.get_int('panel-size')} ${taskbar.get_string('panel-sizes')}`);
    const dockHeight = global.zorinTaskbar?.panels?.[0]?.height;
    check('dock really resizes', dockHeight === 48, `${dockHeight}`);
    settings.set_int('dock-size', 40);
    await wait(300);

    check('notch keeps unredirect off while shown', notch._unredirectHeld === true);

    settings.set_int('dock-margin', 6);
    await wait(300);
    check('dock margin goes to zorin-taskbar', taskbar.get_int('panel-margin') === 6, `${taskbar.get_int('panel-margin')}`);
    settings.reset('dock-margin');

    const zoom = extension._dockZoom;
    const [entry] = zoom?._plates?.values() ?? [];
    if (entry) {
        entry.anchor.translation_y = 30;
        await wait(100);
        check('glass plate slides with the hiding dock', entry.plate.translation_y === 30, `${entry.plate.translation_y}`);
        entry.anchor.translation_y = 0;
        settings.set_double('dock-glass-opacity', 0.6);
        await wait(100);
        check('glass opacity follows the preferences', (entry.plate.get_style() ?? '').includes('0.60'), entry.plate.get_style());
        settings.reset('dock-glass-opacity');

        const width = entry.plate.width;
        settings.set_int('dock-plate-padding', 12);
        await wait(200);
        check('glass padding follows the preferences', entry.plate.width === width + 12,
            `${width} -> ${entry.plate.width}`);
        settings.reset('dock-plate-padding');

        const icon = zoom._icons(entry.taskbar)[0];
        settings.set_int('dock-icon-spacing', 9);
        await wait(200);
        check('icon spacing follows the preferences', (icon?._iconContainer?.get_style() ?? '').includes(' 8px'),
            icon?._iconContainer?.get_style());
        settings.reset('dock-icon-spacing');
    } else {
        check('glass plate exists', false, 'no plate (run with DOCK=1)');
    }
}

// Language: English by default; Indonesian rebuilds the notch with translated texts
async function testLanguage(extension) {
    const settings = extension.getSettings();
    const english = extension.notch._panelView._bell.accessible_name;
    check('English is the default', settings.get_string('language') === 'en' && english === 'Notifications', english);
    settings.set_string('language', 'id');
    await wait(500);
    const notch = extension.notch;
    check('Indonesian rebuilds the notch', notch?._panelView?._bell?.accessible_name === 'Notifikasi',
        notch?._panelView?._bell?.accessible_name);
    notch._agents.handle({agent: 'claude', session: 'bahasa', event: 'working', project: 'x', message: 'Running Edit'});
    notch._agents.handle({agent: 'claude', session: 'bahasa', event: 'waiting', project: 'x', message: 'Needs permission for Edit'});
    await wait(SETTLE_MS);
    const shown = notch._agentView.actor.get_children().map(c => c.text).filter(Boolean).join(' | ');
    check('agent messages are translated', shown.includes('Butuh izin untuk Edit'), shown);
    notch._agents.handle({agent: 'claude', session: 'bahasa', event: 'end'});
    settings.set_string('language', 'en');
    await wait(500);
}

// Light theme with a blue accent: notch content, Cairo surface and dock glass follow
async function testTheme(extension, shotDir) {
    const settings = extension.getSettings();
    settings.set_string('theme', 'light');
    settings.set_string('accent', 'blue');
    await wait(500);
    const notch = extension.notch;
    notch.freezePointer(true);
    check('light theme marks the notch', notch.actor.has_style_class_name('zorin-notch-light'));
    check('light surface for the expanded notch', notch._surface().solidTop === false, notch._surface().fill);
    const css = new TextDecoder().decode(extension._theme._file.load_contents(null)[1]);
    check('accent goes into the theme stylesheet', css.includes('#0A84FF'));
    // zorin-taskbar draws the dots of apps with open windows in this widget's background color
    const dot = new St.Widget({style_class: 'app-grid-running-dot'});
    Main.uiGroup.add_child(dot);
    const dotColor = dot.get_theme_node().get_background_color();
    dot.destroy();
    check('dock running dots take the accent color',
        dotColor.red === 0x0A && dotColor.green === 0x84 && dotColor.blue === 0xFF,
        `${dotColor.red},${dotColor.green},${dotColor.blue}`);
    const [plate] = [...(extension._dockZoom?._plates?.values() ?? [])];
    if (plate)
        check('dock glass turns light', (plate.plate.get_style() ?? '').includes('255, 255, 255'), plate.plate.get_style());

    if (shotDir) {
        notch.setState(State.PANEL);
        await wait(SETTLE_MS);
        await screenshot(`${shotDir}/panel-light.png`);
        notch.setState(State.IDLE);
        notch.openSearch('te');
        await wait(SETTLE_MS);
        await screenshotFull(`${shotDir}/search-light.png`);
        notch.spotlight.close();
        await wait(400);
    }
    notch.setState(State.IDLE);
    settings.reset('theme');
    settings.reset('accent');
    await wait(500);
    check('dark theme again', !extension.notch.actor.has_style_class_name('zorin-notch-light'));
    if (shotDir) {
        const dark = extension.notch;
        dark.openSearch('te');
        await wait(SETTLE_MS);
        await screenshotFull(`${shotDir}/search-dark.png`);
        dark.spotlight.close();
        await wait(400);
    }
    notch.freezePointer(false);
}

// Floating notch, and typing in the overview opening the notch search
// Liquid notch style: a lens at rest, a bead (deeper, narrower, jelly springs) when the pointer
// is near, firmer springs for the notch and the panel, back to the classic line when off
// Springs settle in a second on a smooth desktop; a slow nested session needs longer
async function waitSettled(notch, maxMs = 8000) {
    await wait(300);
    for (let waited = 300; waited < maxMs && !(notch._width.settled && notch._height.settled); waited += 200)
        await wait(200);
}

async function testLiquid(extension, shotDir) {
    // The language test rebuilt the notch: take the current one
    const notch = extension.notch;
    const settings = extension.getSettings();
    notch.freezePointer(true);
    try {
        settings.set_string('notch-style', 'liquid');
        notch.setState(State.IDLE);
        await waitSettled(notch);
        check('liquid lens rests at the line size', Math.round(notch._height.value) === settings.get_int('idle-height'),
            notch.debugSize);
        if (shotDir)
            await screenshot(`${shotDir}/liquid-idle.png`);

        notch._leanTarget = 6;
        notch.setState(State.HOVER);
        await waitSettled(notch);
        const [hoverW, hoverH] = notch._sizeOf(State.HOVER);
        check('pointer near: the lens drops into a bead', hoverH === settings.get_int('idle-height') + 9 &&
            hoverW < settings.get_int('idle-width') && Math.abs(notch._height.value - hoverH) < 1.5, notch.debugSize);
        check('the bead has jelly springs', notch._height._damping < 10, `${notch._height._damping}`);
        check('the bead breathes and leans', notch._activityTimeline.is_playing() && notch._lean > 1,
            `${notch._activityTimeline.is_playing()} ${notch._lean.toFixed(2)}`);
        if (shotDir)
            await screenshot(`${shotDir}/liquid-hover.png`);

        notch.setState(State.PEEK);
        await wait(SETTLE_MS);
        check('the notch has firmer springs', notch._height._damping > 30, `${notch._height._damping}`);
        if (shotDir)
            await screenshot(`${shotDir}/liquid-peek.png`);
        notch.setState(State.PANEL);
        await waitSettled(notch);
        await wait(1000);
        check('liquid panel shows its content', notch._panelView.actor.visible && notch._panelView.actor.opacity === 255,
            `${notch._panelView.actor.visible} ${notch._panelView.actor.opacity}`);
        if (shotDir)
            await screenshot(`${shotDir}/liquid-panel.png`);
        notch.setState(State.IDLE);
        await wait(500);
    } finally {
        settings.reset('notch-style');
        notch.freezePointer(false);
        notch.setState(State.IDLE);
        await waitSettled(notch);
    }
    check('classic style is back after the reset', notch._height._damping === 34 &&
        Math.round(notch._height.value) === settings.get_int('idle-height'), `${notch._height._damping} ${notch.debugSize}`);
}

async function testFloatingAndOverview(extension, shotDir) {
    const settings = extension.getSettings();
    const notch = extension.notch;
    notch.freezePointer(true);
    notch.setState(State.STATUS);
    settings.set_boolean('notch-floating', true);
    await wait(SETTLE_MS);
    const monitor = Main.layoutManager.primaryMonitor;
    check('floating notch sits below the top edge', notch.actor.y === monitor.y + settings.get_int('notch-float-offset'),
        `y=${notch.actor.y}`);
    if (shotDir)
        await screenshot(`${shotDir}/floating.png`);
    settings.reset('notch-floating');
    await wait(SETTLE_MS);
    check('attached notch is back at the top', notch.actor.y === monitor.y, `y=${notch.actor.y}`);
    notch.setState(State.IDLE);
    notch.freezePointer(false);

    Main.overview.show();
    await wait(SETTLE_MS);
    Main.overview.searchEntry.set_text('ter');
    await wait(SETTLE_MS * 2);
    const current = extension.notch;
    const view = current.spotlight.view;
    check('typing in the overview opens spotlight', current.spotlight.isOpen && view.entry.text === 'ter',
        `open=${current.spotlight.isOpen} "${view.entry.text}" overview=${Main.overview.visible}`);
    current.spotlight.close();
    await wait(500);
}

function sendNotification(title, body, {urgency = MessageTray.Urgency.NORMAL, action = null} = {}) {
    const source = new MessageTray.Source({title: 'Uji Notch', iconName: 'mail-unread-symbolic'});
    Main.messageTray.add(source);
    const notification = new MessageTray.Notification({source, title, body, urgency});
    if (action)
        notification.addAction(action, () => {});
    source.addNotification(notification);
    return notification;
}

async function testNotifications(notch, pointer, keyboard, shotDir) {
    notch.setState(State.IDLE);
    await wait(500);

    // 05: a normal notification pops out of the notch and is marked as seen
    const popup = sendNotification('kebun zub zub · project for testing a very long title', 'Allow Claude to run rtk grep -rn something in the project folder', {action: 'Allow once'});
    await wait(SETTLE_MS);
    check('notification pops out (05)', notch.state === State.NOTIFICATION, notch.state);
    check('popup marks it seen', popup.acknowledged === true);
    if (shotDir) {
        await screenshot(`${shotDir}/notification.png`);
        console.log(LOG_PREFIX, `shot notification (size=${notch.debugSize})`);
    }

    // A short drag springs back; a long one hides the popup, the notification stays in the
    // list, and an update of it does not pop it out again. The pan gesture itself needs a
    // real pointer, so its handlers are driven directly.
    notch._notificationView.drag(40);
    const fading = notch._notificationView.actor.opacity;
    check('popup fades while dragged', fading < 255 && fading > 100, `${fading}`);
    notch._notificationView.release();
    await wait(1000);
    check('short swipe springs back', notch.state === State.NOTIFICATION &&
        notch._notificationView.actor.translation_x === 0, `${notch._notificationView.actor.translation_x}`);
    notch._notificationView.drag(200);
    notch._notificationView.release();
    await wait(500);
    check('long swipe hides the popup', notch.state !== State.NOTIFICATION, notch.state);
    check('swiped notification stays in the list', notch._messages.list().includes(popup));
    notch._queuePopup(popup);
    await wait(500);
    check('an update does not bring a hidden popup back', notch.state !== State.NOTIFICATION, notch.state);

    // The × button does the same as the swipe
    const another = sendNotification('Unduhan selesai', 'laporan-q3.pdf');
    for (let i = 0; i < 16 && notch.state !== State.NOTIFICATION; i++)
        await wait(250);
    await wait(500);
    check('a new popup shows', notch.state === State.NOTIFICATION, notch.state);
    if (shotDir)
        await screenshot(`${shotDir}/notification-hide-button.png`);
    notch._notificationView.hideButton.emit('clicked', 0);
    await wait(100);
    check('the hide button draws the popup up', notch._notificationView.actor.translation_y < 0 &&
        notch._notificationView.actor.translation_x === 0, `${notch._notificationView.actor.translation_y}`);
    await wait(700);
    check('the hide button hides the popup', notch.state !== State.NOTIFICATION, notch.state);
    check('the hidden notification stays in the list', notch._messages.list().includes(another));
    notch.setState(State.IDLE);
    await wait(500);

    // Do not disturb: GNOME's own filter keeps the banner (and so the popup) away
    const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
    settings.set_boolean('show-banners', false);
    sendNotification('Saat senyap', 'Tidak boleh muncul');
    await wait(SETTLE_MS);
    check('do not disturb blocks the popup', notch.state === State.IDLE, notch.state);
    settings.set_boolean('show-banners', true);

    // Unread notifications show a dot; clicking the line opens the list (07)
    sendNotification('Bisa kirim file laporan Q3?', 'Mau aku cek sebelum rapat jam 14.00.',
        {urgency: MessageTray.Urgency.LOW});
    await wait(500);
    const unread = notch._messages.unreadCount;
    check('unread count', unread > 0, `${unread}`);
    if (shotDir)
        await screenshot(`${shotDir}/idle-unread.png`);

    // A virtual pointer press does not reach a non-grabbing actor in the nested shell, so the
    // click logic is driven directly; a real mouse click is checked by hand
    notch.activate();
    await wait(SETTLE_MS);
    check('click with unread opens the list (07)', notch.state === State.LIST, notch.state);
    if (shotDir) {
        await screenshot(`${shotDir}/notificationList.png`);
        console.log(LOG_PREFIX, `shot list (size=${notch.debugSize})`);
    }

    pressKey(keyboard, Clutter.KEY_Escape);
    await wait(500);
    check('closing the list marks all read', notch._messages.unreadCount === 0,
        `${notch._messages.unreadCount} unread`);
}

// 10: the power menu lists GNOME's available actions; in the nested session they only log
async function testPower(notch, shotDir) {
    if (!GLib.getenv('ZORIN_NOTCH_DRY_RUN')) {
        check('power menu', false, 'refusing to test power actions without dry-run');
        return;
    }
    notch.setState(State.POWER);
    await wait(SETTLE_MS);
    check('power menu opens (10)', notch.state === State.POWER, notch.state);
    const items = notch._powerView._items.filter(i => i.actionId);
    console.log(LOG_PREFIX, `power items: ${items.map(i => `${i.actionId}=${i.visible}`).join(' ')}`);
    if (shotDir) {
        await screenshot(`${shotDir}/power.png`);
        console.log(LOG_PREFIX, `shot power (size=${notch.debugSize})`);
    }

    // Without gnome-session (nested) GNOME hides restart and power off; use the first one left
    const action = ['poweroff', 'restart', 'logout'].map(id => items.find(i => i.actionId === id))
        .find(i => i?.visible);
    check('session action hidden when unavailable', items.every(i => i.visible === notch._power.can(i.actionId)));
    if (action) {
        action.emit('clicked', 1);
        await wait(500);
        check(`${action.actionId} closes the notch (dry-run)`, notch.state === State.IDLE, notch.state);
    }

    if (shotDir && GLib.getenv('ZORIN_NOTCH_SHOT_FULL')) {
        const monitor = Main.layoutManager.primaryMonitor;
        const stream = Gio.File.new_for_path(`${shotDir}/desktop.png`)
            .replace(null, false, Gio.FileCreateFlags.NONE, null);
        const shooter = new Shell.Screenshot();
        await new Promise(resolve => shooter.screenshot_area(monitor.x, monitor.y,
            monitor.width, monitor.height, stream, () => resolve()));
        stream.close(null);
    }
}

export async function runSelfTest(extension) {
    const shotDir = GLib.getenv('ZORIN_NOTCH_SHOT_DIR');
    try {
        await wait(SETTLE_MS);

        for (let i = 0; i < 10; i++) {
            extension.disable();
            extension.enable();
        }
        await wait(300);
        const actors = countNotchActors();
        check('enable/disable x10 leaves one notch', actors === 1, `${actors} actor(s)`);

        const notch = extension.notch;
        notch.freezePointer(true);

        if (shotDir) {
            GLib.mkdir_with_parents(shotDir, 0o755);
            for (const state of [State.IDLE, State.HOVER, State.PEEK, State.STATUS, State.PANEL, State.WIFI])
                await shoot(notch, shotDir, state);
        }

        // Dark mode tile drives GNOME's own toggle
        const darkMode = notch._bridge.darkMode;
        if (darkMode.available) {
            const before = darkMode.checked;
            darkMode.toggle();
            await wait(300);
            check('dark mode toggle', darkMode.checked !== before, `${before} -> ${darkMode.checked}`);
            darkMode.toggle();
        } else {
            check('dark mode toggle', false, 'toggle not available');
        }

        const {keyboard, pointer} = virtualDevices();

        notch.setState(State.PANEL);
        await wait(SETTLE_MS);
        pressKey(keyboard, Clutter.KEY_Escape);
        await wait(500);
        check('Esc closes the panel', notch.state === State.IDLE, notch.state);

        notch.setState(State.PANEL);
        await wait(SETTLE_MS);
        const monitor = Main.layoutManager.primaryMonitor;
        await clickAt(pointer, monitor.x + 40, monitor.y + monitor.height / 2);
        await wait(500);
        check('click outside closes the panel', notch.state === State.IDLE, notch.state);

        await testNotifications(notch, pointer, keyboard, shotDir);
        await testPower(notch, shotDir);
        await testTray(notch, keyboard, shotDir);

        // Bell in the panel opens the notification list at any time
        notch.setState(State.PANEL);
        await wait(SETTLE_MS);
        notch._panelView._bell.emit('clicked', 1);
        await wait(SETTLE_MS);
        check('bell opens the notification list', notch.state === State.LIST, notch.state);

        // "Search" closes the panel and opens Spotlight with the keyboard in the entry
        notch.setState(State.PANEL);
        await wait(SETTLE_MS);
        notch.openSearch();
        await wait(SETTLE_MS);
        const search = notch.spotlight.view;
        check('spotlight opens', notch.spotlight.isOpen);
        check('search entry has keyboard focus', global.stage.key_focus === search.entry.clutter_text);
        search.entry.text = 'term';
        await wait(SETTLE_MS);
        check('search finds apps', search._results.length > 0,
            search._results.map(a => a.get_name()).join(', '));
        if (shotDir)
            await screenshotFull(`${shotDir}/search.png`);
        pressKey(keyboard, Clutter.KEY_Escape);
        await wait(500);
        check('Esc closes spotlight', !notch.spotlight.isOpen);
        if (shotDir)
            await screenshot(`${shotDir}/panel-bell-list.png`);
        notch.setState(State.IDLE);
        await wait(500);
        await testFileSearch(extension, notch, shotDir);
        await testMedia(extension, notch, shotDir);
        await testDockZoom(extension, shotDir);
        await testAgents(notch, shotDir);
        await testPermissions(extension, notch, shotDir);
        await testSettings(extension, notch);
        await testLanguage(extension);
        await testTheme(extension, shotDir);
        await testLiquid(extension, shotDir);
        await testFloatingAndOverview(extension, shotDir);
        await testDockSurvivesTaskbarRestart(extension);

        notch.freezePointer(false);
        notch.setState(State.IDLE);
        console.log(LOG_PREFIX, 'done');
    } catch (e) {
        console.error(LOG_PREFIX, 'failed', e);
    }
}
