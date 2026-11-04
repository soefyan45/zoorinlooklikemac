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
        await testDockZoom(extension, shotDir);
        await testAgents(notch, shotDir);
        await testSettings(extension, notch);
        await testLanguage(extension);
        await testTheme(extension, shotDir);
        await testFloatingAndOverview(extension, shotDir);

        notch.freezePointer(false);
        notch.setState(State.IDLE);
        console.log(LOG_PREFIX, 'done');
    } catch (e) {
        console.error(LOG_PREFIX, 'failed', e);
    }
}
