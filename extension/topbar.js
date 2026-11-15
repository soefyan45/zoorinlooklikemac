// Top bar beside the notch (Pego "Mode bar"), for the bar modes that show one:
//   bar:     a thin tinted bar across the top, like macOS: active app left, status and time right
//   islands: the same content in small glass islands floating below the top edge, with the
//            dock's glass, so the wallpaper shows between them
// The notch stays drawn over its middle. The bar reserves its height, so maximized windows
// start below it, and hides in fullscreen. With the notch following the mouse there is one bar
// per monitor, like macOS: the bar of the monitor without the notch is dimmed (setActive).
// The bars never move, so maximized windows do not jump when the pointer changes monitors.
// actions: {toggleOverview(), openPanel(), openList(), openSystem(anchor)}

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {LOOK_KEYS, barLook, rgbaCss} from './barlook.js';
import {_} from './i18n.js';
import {SystemChip} from './systempanel.js';

export const BarMode = {
    LINE: 'line',
    NOTCH: 'notch-status',
    BAR: 'bar',
    ISLANDS: 'islands',
};

// Height reserved at the top in each mode
const HEIGHT = {[BarMode.BAR]: 32, [BarMode.ISLANDS]: 44};
// Content of a bar on a monitor without the notch
const INACTIVE_OPACITY = 115;

function label(text, styleClass) {
    return new St.Label({text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
}

function icon(iconName) {
    return new St.Icon({icon_name: iconName, style_class: 'zorin-notch-topbar-icon'});
}

// A clickable group of the bar; an island in the islands mode
function group(onClick, accessibleName) {
    const box = new St.BoxLayout({style_class: 'zorin-notch-topbar-content'});
    const button = new St.Button({
        style_class: 'zorin-notch-topbar-group',
        child: box,
        accessible_name: accessibleName,
        can_focus: true,
        y_align: Clutter.ActorAlign.START,
    });
    button.connect('clicked', onClick);
    return [button, box];
}

export class TopBar {
    constructor(mode, actions, monitorIndex, settings) {
        this._settings = settings;
        this._groups = [];
        this._blurs = [];
        this._lookId = 0;
        this._mode = mode;
        this._monitorIndex = monitorIndex;
        this.active = true;
        this.actor = new St.BoxLayout({style_class: 'zorin-notch-topbar', name: 'zorinNotchTopBar'});

        const [appGroup, appBox] = group(() => actions.toggleOverview(), _('Activities'));
        this._appIcon = new St.Bin({style_class: 'zorin-notch-topbar-app-icon'});
        this._appName = label('', 'zorin-notch-topbar-app');
        appBox.add_child(this._appIcon);
        appBox.add_child(this._appName);

        const [statusGroup, statusBox] = group(() => actions.openPanel(), _('Settings'));
        this.statusGroup = statusGroup;
        this._network = icon('network-wireless-symbolic');
        this._batteryLabel = label('', 'zorin-notch-topbar-text');
        this._battery = icon('battery-missing-symbolic');
        statusBox.add_child(this._network);
        statusBox.add_child(this._batteryLabel);
        statusBox.add_child(this._battery);

        const [timeGroup, timeBox] = group(() => actions.openList(), _('Notifications'));
        this._date = label('', 'zorin-notch-topbar-date');
        this._time = label('', 'zorin-notch-topbar-time');
        timeBox.add_child(this._date);
        timeBox.add_child(this._time);

        // "Activities" beside the app, as in the design's full bar (the islands keep just the app)
        const [activitiesGroup, activitiesBox] = group(() => actions.toggleOverview(), _('Activities'));
        activitiesBox.add_child(label(_('Activities'), 'zorin-notch-topbar-text'));
        this._activitiesGroup = activitiesGroup;

        const [systemGroup, systemBox] = group(() => actions.openSystem(systemGroup), _('System'));
        systemGroup.add_style_class_name('system');
        this.system = new SystemChip();
        systemBox.add_child(this.system.actor);
        this._systemGroup = systemGroup;
        systemGroup.visible = false;

        this._groups = [appGroup, activitiesGroup, systemGroup, statusGroup, timeGroup];
        // Islands follow the hover themselves: their glass is an inline style
        for (const button of this._groups)
            button.connect('notify::hover', () => this._paintIslands());

        const right = new St.BoxLayout({style_class: 'zorin-notch-topbar-right', x_expand: true,
            x_align: Clutter.ActorAlign.END});
        right.add_child(systemGroup);
        right.add_child(statusGroup);
        right.add_child(timeGroup);
        const left = new St.BoxLayout({style_class: 'zorin-notch-topbar-left'});
        left.add_child(appGroup);
        left.add_child(activitiesGroup);
        this.actor.add_child(left);
        this.actor.add_child(right);
        this._content = [left, right];

        Main.layoutManager.addTopChrome(this.actor, {affectsStruts: true, trackFullscreen: true});
        Main.layoutManager.connectObject('monitors-changed', () => this._place(), this);
        Shell.WindowTracker.get_default().connectObject('notify::focus-app', () => this._syncApp(), this);
        // The glass (Preferences > Menu bar), solid while a maximized window is on this display
        this._settings?.connectObject(...LOOK_KEYS.flatMap(key => [`changed::${key}`, () => this._applyLook()]), this);
        global.window_manager.connectObject(
            'size-changed', () => this._queueLook(),
            'minimize', () => this._queueLook(),
            'unminimize', () => this._queueLook(),
            'map', () => this._queueLook(),
            'destroy', () => this._queueLook(), this);
        global.display.connectObject('restacked', () => this._queueLook(), this);
        global.workspace_manager.connectObject('active-workspace-changed', () => this._queueLook(), this);
        this._backgroundSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._backgroundSettings.connectObject('changed', () => this._queueLook(), this);
        this.setMode(mode);
        this._syncApp();
    }

    setMode(mode) {
        this._mode = mode;
        if (mode === BarMode.ISLANDS)
            this.actor.add_style_class_name('islands');
        else
            this.actor.remove_style_class_name('islands');
        this._activitiesGroup.visible = mode !== BarMode.ISLANDS;
        this._place();
        this._applyLook();
    }

    _monitor() {
        return Main.layoutManager.monitors[this._monitorIndex] ?? Main.layoutManager.primaryMonitor;
    }

    // Whether a maximized window shows on this bar's display
    _maximizedHere() {
        const index = this._monitor()?.index;
        return global.workspace_manager.get_active_workspace().list_windows().some(window =>
            window.get_monitor() === index && !window.minimized && window.showing_on_its_workspace() &&
            window.window_type === Meta.WindowType.NORMAL && (window.get_maximized() & Meta.MaximizeFlags.VERTICAL));
    }

    // Window signals come in bursts: paint once after them
    _queueLook() {
        if (this._lookId)
            return;
        this._lookId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._lookId = 0;
            this._applyLook();
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyLook() {
        if (!this._settings)
            return;
        const look = barLook(this._settings, this._maximizedHere());
        const key = JSON.stringify([look, this._mode]);
        if (key === this._lookKey)
            return;
        this._lookKey = key;
        this._look = look;
        const islands = this._mode === BarMode.ISLANDS;
        this.actor.style = islands ? null
            : `background-color: ${rgbaCss(look.color, look.alpha)};` +
              (look.edge > 0 ? ` border-bottom: 1px solid rgba(255, 255, 255, ${look.edge});` : '');
        if (look.darkText)
            this.actor.add_style_class_name('dark-text');
        else
            this.actor.remove_style_class_name('dark-text');
        this._paintIslands();
        // The blur sits on the bar, or on each island
        this._blurs.forEach(({actor}) => actor.remove_effect_by_name('zorin-notch-glass'));
        this._blurs = [];
        if (look.blur > 0) {
            for (const actor of islands ? this._groups : [this.actor]) {
                const effect = new Shell.BlurEffect({mode: Shell.BlurMode.BACKGROUND, brightness: 1,
                    radius: look.blur});
                actor.add_effect_with_name('zorin-notch-glass', effect);
                this._blurs.push({actor, effect});
            }
        }
    }

    _paintIslands() {
        const islands = this._mode === BarMode.ISLANDS;
        for (const button of this._groups) {
            if (!islands || !this._look) {
                button.style = null;
                continue;
            }
            const alpha = this._look.solid ? 1 : Math.min(1, this._look.alpha + (button.hover ? 0.15 : 0));
            button.style = `background-color: ${rgbaCss(this._look.color, alpha)};`;
        }
    }

    setMonitor(index) {
        if (index === this._monitorIndex)
            return;
        this._monitorIndex = index;
        this._place();
        this._queueLook();
    }

    // The bar of a monitor without the notch shows its content dimmed
    setActive(active) {
        this.active = active;
        for (const box of this._content)
            box.opacity = active ? 255 : INACTIVE_OPACITY;
    }

    // The focused app, or the desktop's name when no app has the focus
    _syncApp() {
        const app = Shell.WindowTracker.get_default().focus_app;
        this._appName.text = app ? app.get_name() : 'Zorin OS';
        this._appIcon.child = app ? app.create_icon_texture(16) : new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            style_class: 'zorin-notch-topbar-icon',
        });
    }

    update({time, networkIcon, battery}) {
        this._date.text = GLib.DateTime.new_now_local().format('%a %-d %b');
        this._time.text = time;
        this._network.visible = !!networkIcon;
        if (networkIcon)
            this._network.icon_name = networkIcon;
        this._batteryLabel.visible = this._battery.visible = !!battery;
        if (battery) {
            this._batteryLabel.text = `${battery.percentage}%`;
            this._battery.icon_name = battery.iconName;
        }
    }

    updateSystem(info) {
        this.system.update(info);
        this._systemGroup.visible = this.system.actor.visible;
    }

    _place() {
        const monitor = this._monitor();
        if (!monitor)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this.actor.set_position(monitor.x, monitor.y);
        this.actor.set_size(monitor.width, (HEIGHT[this._mode] ?? HEIGHT[BarMode.BAR]) * scale);
    }

    destroy() {
        if (this._lookId)
            GLib.source_remove(this._lookId);
        this._lookId = 0;
        this._settings?.disconnectObject(this);
        this._backgroundSettings.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        Shell.WindowTracker.get_default().disconnectObject(this);
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
    }
}
