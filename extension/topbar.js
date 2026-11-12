// Top bar beside the notch (Pego "Mode bar"), for the bar modes that show one:
//   bar:     a thin tinted bar across the top, like macOS: active app left, status and time right
//   islands: the same content in small glass islands floating below the top edge, with the
//            dock's glass, so the wallpaper shows between them
// The notch stays drawn over its middle. The bar reserves its height, so maximized windows
// start below it, and hides in fullscreen.
// actions: {toggleOverview(), openPanel(), openList(), openSystem(anchor)}

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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
    constructor(mode, actions) {
        this._mode = mode;
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

        const [systemGroup, systemBox] = group(() => actions.openSystem(systemGroup), _('System'));
        this.system = new SystemChip();
        systemBox.add_child(this.system.actor);
        this._systemGroup = systemGroup;
        systemGroup.visible = false;

        const right = new St.BoxLayout({style_class: 'zorin-notch-topbar-right', x_expand: true,
            x_align: Clutter.ActorAlign.END});
        right.add_child(systemGroup);
        right.add_child(statusGroup);
        right.add_child(timeGroup);
        this.actor.add_child(appGroup);
        this.actor.add_child(right);

        Main.layoutManager.addTopChrome(this.actor, {affectsStruts: true, trackFullscreen: true});
        Main.layoutManager.connectObject('monitors-changed', () => this._place(), this);
        Shell.WindowTracker.get_default().connectObject('notify::focus-app', () => this._syncApp(), this);
        this.setMode(mode);
        this._syncApp();
    }

    setMode(mode) {
        this._mode = mode;
        if (mode === BarMode.ISLANDS)
            this.actor.add_style_class_name('islands');
        else
            this.actor.remove_style_class_name('islands');
        this._place();
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
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this.actor.set_position(monitor.x, monitor.y);
        this.actor.set_size(monitor.width, (HEIGHT[this._mode] ?? HEIGHT[BarMode.BAR]) * scale);
    }

    destroy() {
        Main.layoutManager.disconnectObject(this);
        Shell.WindowTracker.get_default().disconnectObject(this);
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
    }
}
