// Content of the expanded notch: full panel (06), Wi-Fi settings (09), notification (05) and
// notification list (07). Layout and copy follow the Pego frames.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {_, agentMessage} from './i18n.js';
import {relativeTime} from './messages.js';

const MAX_OTHER_NETWORKS = 3;
const MAX_LIST_ROWS = 4;
// Horizontal drag past this distance dismisses a notification row (Pego 07: "geser kanan")
const SWIPE_DISMISS_PX = 120;

function notificationIcon(notification) {
    const gicon = notification.gicon ?? notification.source?.icon ?? null;
    const iconName = notification.iconName || notification.source?.iconName || 'dialog-information-symbolic';
    return gicon
        ? new St.Icon({gicon, style_class: 'zorin-notch-notif-glyph'})
        : new St.Icon({icon_name: iconName, style_class: 'zorin-notch-notif-glyph'});
}

function notificationIconBox(notification) {
    return new St.Bin({style_class: 'zorin-notch-notif-icon', child: notificationIcon(notification)});
}

// Text in notifications may contain markup; show it as plain text
function plain(text) {
    return (text ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function label(text, styleClass, props = {}) {
    return new St.Label({text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER, ...props});
}

function icon(iconName, styleClass = 'zorin-notch-icon') {
    return new St.Icon({icon_name: iconName, style_class: styleClass});
}

function roundButton(iconName, accessibleName, onClick) {
    const button = new St.Button({
        style_class: 'zorin-notch-round-button',
        child: icon(iconName),
        accessible_name: accessibleName,
        can_focus: true,
    });
    button.connect('clicked', onClick);
    return button;
}

function pillButton(iconName, text, onClick) {
    const box = new St.BoxLayout({style_class: 'zorin-notch-pill-content'});
    box.add_child(icon(iconName));
    box.add_child(label(text, 'zorin-notch-pill-label'));
    const button = new St.Button({style_class: 'zorin-notch-pill-button', child: box, can_focus: true});
    button.connect('clicked', onClick);
    return button;
}

// Clock left of the camera, network and battery right of it (Pego "Status" row)
export class StatusRow {
    constructor(styleClass = 'zorin-notch-status') {
        this.actor = new St.BoxLayout({style_class: styleClass, x_expand: true});
        this._left = label('', 'zorin-notch-clock', {x_expand: true});
        this._networkIcon = icon('network-wireless-symbolic', 'zorin-notch-status-icon');
        this._batteryLabel = label('', 'zorin-notch-battery');
        this._batteryIcon = icon('battery-missing-symbolic', 'zorin-notch-status-icon');

        const right = new St.BoxLayout({style_class: 'zorin-notch-status-right', x_align: Clutter.ActorAlign.END});
        right.add_child(this._networkIcon);
        right.add_child(this._batteryLabel);
        right.add_child(this._batteryIcon);

        this.actor.add_child(this._left);
        this.actor.add_child(right);
    }

    update({clock, networkIcon, battery}) {
        this._left.text = clock;
        this._networkIcon.visible = !!networkIcon;
        if (networkIcon)
            this._networkIcon.icon_name = networkIcon;
        this._batteryLabel.visible = this._batteryIcon.visible = !!battery;
        if (battery) {
            this._batteryLabel.text = `${battery.percentage}%`;
            this._batteryIcon.icon_name = battery.iconName;
        }
    }
}

// Quick setting tile: the circle toggles, the name opens details (or toggles too)
class Tile {
    constructor(control, title, fallbackIcon, onOpen) {
        this._control = control;
        this._title = title;
        this._fallbackIcon = fallbackIcon;

        this.actor = new St.BoxLayout({style_class: 'zorin-notch-tile', x_expand: true});
        this._circle = new St.Button({
            style_class: 'zorin-notch-tile-circle',
            child: icon(fallbackIcon),
            accessible_name: title,
            can_focus: true,
        });
        this._circle.connect('clicked', () => control.toggle());

        const text = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
        this._titleLabel = label(title, 'zorin-notch-tile-title');
        this._subtitleLabel = label('', 'zorin-notch-tile-subtitle');
        text.add_child(this._titleLabel);
        text.add_child(this._subtitleLabel);
        this._name = new St.Button({child: text, x_expand: true, can_focus: true, x_align: Clutter.ActorAlign.START});
        this._name.connect('clicked', () => (onOpen ? onOpen() : control.toggle()));

        this.actor.add_child(this._circle);
        this.actor.add_child(this._name);
    }

    update() {
        const {checked, available} = this._control;
        this.actor.visible = available;
        if (checked)
            this._circle.add_style_pseudo_class('checked');
        else
            this._circle.remove_style_pseudo_class('checked');
        this._circle.child.icon_name = this._control.iconName || this._fallbackIcon;
        this._subtitleLabel.text = this._control.subtitle || (checked ? _('On') : _('Off'));
    }
}

// Our slider mirrors GNOME's: both share value and maximum, so dragging ours moves the volume
class SliderRow {
    constructor(link, fallbackIcon, accessibleName) {
        this._link = link;
        this._fallbackIcon = fallbackIcon;
        this._binding = null;

        this.actor = new St.BoxLayout({style_class: 'zorin-notch-slider-row'});
        this._icon = icon(fallbackIcon);
        this._slider = new Slider(0);
        this._slider.add_style_class_name('zorin-notch-slider');
        this._slider.x_expand = true;
        this._slider.accessible_name = accessibleName;
        this._value = label('', 'zorin-notch-slider-value');
        this._slider.connect('notify::value', () => this._syncValue());

        this.actor.add_child(this._icon);
        this.actor.add_child(this._slider);
        this.actor.add_child(this._value);
    }

    update() {
        const source = this._link.slider;
        this.actor.visible = this._link.available;
        if (!source)
            return;

        if (this._binding?.source !== source) {
            this._binding?.unbind();
            this._slider.maximum_value = source.maximum_value;
            this._binding = source.bind_property('value', this._slider, 'value',
                GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);
        }
        this._icon.icon_name = this._link.iconName || this._fallbackIcon;
        this._syncValue();
    }

    _syncValue() {
        this._value.text = `${Math.round(this._slider.value * 100)}%`;
    }

    destroy() {
        this._binding?.unbind();
        this._binding = null;
    }
}

/**
 * Full panel (06): status, quick settings, sliders and actions.
 * actions: {openWifi, showApps, search, openSettings, lockScreen, openPower}
 */
export class PanelView {
    constructor(bridge, actions) {
        this.actor = new St.BoxLayout({style_class: 'zorin-notch-panel', vertical: true});
        this.statusRow = new StatusRow('zorin-notch-status zorin-notch-panel-status');

        const tiles = new St.BoxLayout({style_class: 'zorin-notch-tiles', x_expand: true});
        tiles.layout_manager.homogeneous = true;
        this._tiles = [
            new Tile(bridge.wifi, 'Wi-Fi', 'network-wireless-symbolic', actions.openWifi),
            new Tile(bridge.bluetooth, 'Bluetooth', 'bluetooth-active-symbolic'),
            new Tile(bridge.darkMode, _('Dark mode'), 'dark-mode-symbolic'),
            new Tile(bridge.dnd, _('Do not disturb'), 'notifications-disabled-symbolic'),
        ];
        this._tiles.forEach(tile => tiles.add_child(tile.actor));

        const sliders = new St.BoxLayout({style_class: 'zorin-notch-sliders', vertical: true});
        this._sliders = [
            new SliderRow(bridge.volume, 'audio-volume-high-symbolic', _('Volume')),
            new SliderRow(bridge.brightness, 'display-brightness-symbolic', _('Brightness')),
        ];
        this._sliders.forEach(row => sliders.add_child(row.actor));

        const actionRow = new St.BoxLayout({style_class: 'zorin-notch-actions', x_expand: true});
        const left = new St.BoxLayout({style_class: 'zorin-notch-actions-group', x_expand: true});
        left.add_child(pillButton('view-app-grid-symbolic', _('Apps'), actions.showApps));
        left.add_child(pillButton('system-search-symbolic', _('Search'), actions.search));
        const right = new St.BoxLayout({style_class: 'zorin-notch-actions-group'});
        // Notification list (07) at any time, not only when the unread dot is shown
        this._bell = roundButton('notification-symbolic', _('Notifications'), actions.openNotifications);
        this._bell.child.fallback_icon_name = 'preferences-system-notifications-symbolic';
        right.add_child(this._bell);
        // Zorin Notch preferences (dock and notch), next to GNOME Settings
        const prefs = roundButton('preferences-desktop-appearance-symbolic', _('Zorin Notch settings'),
            actions.openPreferences);
        prefs.child.fallback_icon_name = 'emblem-system-symbolic';
        right.add_child(prefs);
        right.add_child(roundButton('emblem-system-symbolic', _('Settings'), actions.openSettings));
        right.add_child(roundButton('system-lock-screen-symbolic', _('Lock screen'), actions.lockScreen));
        right.add_child(roundButton('system-shutdown-symbolic', _('Power'), actions.openPower));
        actionRow.add_child(left);
        actionRow.add_child(right);

        // Tray icons moved out of the dock (filled by TrayBridge); hidden when there are none
        this.trayRow = new St.BoxLayout({style_class: 'zorin-notch-tray', x_expand: true});

        const body = new St.BoxLayout({style_class: 'zorin-notch-panel-body', vertical: true});
        body.add_child(tiles);
        body.add_child(sliders);
        body.add_child(this.trayRow);
        body.add_child(actionRow);

        this.actor.add_child(this.statusRow.actor);
        this.actor.add_child(body);
    }

    update({trayVisible = false, unread = 0} = {}) {
        this._tiles.forEach(tile => tile.update());
        this._sliders.forEach(row => row.update());
        this.trayRow.visible = trayVisible;
        this._bell.child.icon_name = unread > 0 ? 'notification-new-symbolic' : 'notification-symbolic';
    }

    destroy() {
        this._sliders.forEach(row => row.destroy());
        this.actor.destroy();
    }
}

// Row of the Wi-Fi list and the power menu (Pego "Notch Menu Item")
function menuItem({iconName, text, meta, trailIcon, accent, bold, onClick}) {
    const box = new St.BoxLayout({style_class: 'zorin-notch-menu-item-content', x_expand: true});
    const iconBox = new St.Bin({
        style_class: `zorin-notch-menu-icon${accent ? ` ${accent}` : ''}`,
        child: icon(iconName),
    });
    box.add_child(iconBox);
    box.add_child(label(text, `zorin-notch-menu-label${bold ? ' bold' : ''}`, {x_expand: true}));
    if (meta)
        box.add_child(label(meta, 'zorin-notch-menu-meta'));
    if (trailIcon)
        box.add_child(icon(trailIcon, 'zorin-notch-menu-trail'));

    const button = new St.Button({
        style_class: 'zorin-notch-menu-item',
        child: box,
        x_expand: true,
        can_focus: true,
    });
    button.connect('clicked', onClick);
    return button;
}

/**
 * Wi-Fi settings (09): switch, connected network, other networks and a link to Settings.
 * actions: {back, openWifiSettings}
 */
export class WifiView {
    constructor(bridge, actions) {
        this._bridge = bridge;
        this._actions = actions;

        this.actor = new St.BoxLayout({style_class: 'zorin-notch-wifi', vertical: true});
        this.statusRow = new StatusRow('zorin-notch-status zorin-notch-wifi-status');

        const head = new St.BoxLayout({style_class: 'zorin-notch-wifi-head'});
        const back = roundButton('pan-start-symbolic', _('Back'), actions.back);
        back.add_style_class_name('small');
        head.add_child(back);
        head.add_child(label('Wi-Fi', 'zorin-notch-view-title', {x_expand: true}));
        this._switch = new St.Button({
            style_class: 'zorin-notch-switch',
            child: new St.Widget({style_class: 'zorin-notch-switch-knob'}),
            accessible_name: 'Wi-Fi',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._switch.connect('clicked', () => bridge.wifi.toggle());
        head.add_child(this._switch);

        this._list = new St.BoxLayout({style_class: 'zorin-notch-wifi-list', vertical: true});

        this.actor.add_child(this.statusRow.actor);
        this.actor.add_child(head);
        this.actor.add_child(this._list);
    }

    update() {
        const enabled = this._bridge.wifi.checked;
        if (enabled)
            this._switch.add_style_pseudo_class('checked');
        else
            this._switch.remove_style_pseudo_class('checked');
        this._switch.child.x_align = enabled ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;

        this._list.destroy_all_children();
        const networks = enabled ? this._bridge.wifiNetworks() : [];
        const active = networks.filter(n => n.active);
        const others = networks.filter(n => !n.active).slice(0, MAX_OTHER_NETWORKS);

        if (active.length) {
            this._list.add_child(label(_('Connected'), 'zorin-notch-group-label'));
            for (const network of active) {
                this._list.add_child(menuItem({
                    iconName: network.iconName,
                    text: network.name,
                    meta: network.secure ? _('Secured') : _('Unsecured'),
                    trailIcon: 'object-select-symbolic',
                    accent: 'accent',
                    bold: true,
                    onClick: () => {},
                }));
            }
        }
        if (others.length) {
            this._list.add_child(label(_('Other networks'), 'zorin-notch-group-label'));
            for (const network of others) {
                this._list.add_child(menuItem({
                    iconName: network.iconName,
                    text: network.name,
                    meta: network.secure ? _('Locked') : _('Unsecured'),
                    onClick: () => network.activate(),
                }));
            }
        }
        if (!enabled)
            this._list.add_child(label(_('Wi-Fi is off'), 'zorin-notch-group-label'));

        this._list.add_child(menuItem({
            iconName: 'emblem-system-symbolic',
            text: _('More Wi-Fi settings'),
            trailIcon: 'pan-end-symbolic',
            onClick: this._actions.openWifiSettings,
        }));
    }

    destroy() {
        this.actor.destroy();
    }
}

/**
 * Notification that pops out of the notch (05): app icon, title, time, body, one action.
 * actions: {activate(notification), runAction(notification, action)}
 */
export class NotificationView {
    constructor(actions) {
        this._actions = actions;
        this.notification = null;

        this.actor = new St.BoxLayout({style_class: 'zorin-notch-notif', reactive: true});
        this.actor.connect('button-release-event', () => {
            if (this.notification)
                this._actions.activate(this.notification);
            return Clutter.EVENT_STOP;
        });
    }

    show(notification) {
        this.notification = notification;
        this.actor.destroy_all_children();

        this.actor.add_child(notificationIconBox(notification));

        const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        // The title gives way (ellipsized) so the time keeps its place, with a gap between them
        const titleRow = new St.BoxLayout({style_class: 'zorin-notch-notif-title-row', x_expand: true});
        titleRow.add_child(label(plain(notification.title), 'zorin-notch-notif-title', {x_expand: true}));
        titleRow.add_child(label(relativeTime(notification.datetime), 'zorin-notch-notif-time', {x_expand: false}));
        text.add_child(titleRow);
        const body = plain(notification.body);
        if (body)
            text.add_child(label(body, 'zorin-notch-notif-body'));
        this.actor.add_child(text);

        // First action of the notification, or "Buka" to open it like GNOME's banner would
        const [action] = notification.actions ?? [];
        const button = new St.Button({
            style_class: 'zorin-notch-notif-button',
            label: action ? plain(action.label) : _('Open'),
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });
        button.connect('clicked', () => {
            if (action)
                this._actions.runAction(notification, action);
            else
                this._actions.activate(notification);
        });
        this.actor.add_child(button);
    }

    clear() {
        this.notification = null;
        this.actor.destroy_all_children();
    }

    destroy() {
        this.actor.destroy();
    }
}

// One notification in the list (Pego "Notch Notif Row"); drag it right to dismiss
function notificationRow(notification, actions) {
    const row = new St.BoxLayout({style_class: 'zorin-notch-notif-row', x_expand: true});
    row.add_child(notificationIconBox(notification));

    const text = new St.BoxLayout({vertical: true, x_expand: true});
    const meta = new St.BoxLayout({style_class: 'zorin-notch-notif-meta', x_expand: true});
    meta.add_child(label(plain(notification.source?.title), 'zorin-notch-notif-app', {x_expand: true}));
    meta.add_child(label(relativeTime(notification.datetime), 'zorin-notch-notif-time'));
    if (!notification.acknowledged)
        meta.add_child(new St.Widget({style_class: 'zorin-notch-unread-dot', y_align: Clutter.ActorAlign.CENTER}));
    text.add_child(meta);
    text.add_child(label(plain(notification.title), 'zorin-notch-notif-title'));
    const body = plain(notification.body);
    if (body)
        text.add_child(label(body, 'zorin-notch-notif-body'));
    row.add_child(text);

    const button = new St.Button({child: row, x_expand: true, can_focus: true, reactive: true});
    button.connect('clicked', () => {
        // A drag also ends with a release; only a click without movement opens the notification
        if (Math.abs(button.translation_x) < 4)
            actions.activate(notification);
    });

    const pan = new Clutter.PanAction({pan_axis: Clutter.PanAxis.X_AXIS});
    pan.connect('pan', action => {
        const [dx] = action.get_motion_delta(0);
        button.translation_x = Math.max(0, button.translation_x + dx);
        button.opacity = 255 * Math.max(0.2, 1 - button.translation_x / (2 * SWIPE_DISMISS_PX));
        return false;
    });
    pan.connect('gesture-end', () => {
        if (button.translation_x > SWIPE_DISMISS_PX) {
            actions.dismiss(notification);
        } else {
            button.ease({
                translation_x: 0,
                opacity: 255,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    });
    button.add_action(pan);
    return button;
}

/**
 * Notification list (07): status, header with count and "Bersihkan semua", newest rows.
 * actions: {activate(notification), dismiss(notification), clearAll()}
 */
export class ListView {
    constructor(source, actions) {
        this._source = source;
        this._actions = actions;

        this.actor = new St.BoxLayout({style_class: 'zorin-notch-list', vertical: true});
        this.statusRow = new StatusRow('zorin-notch-status zorin-notch-panel-status');

        const head = new St.BoxLayout({style_class: 'zorin-notch-list-head'});
        head.add_child(label(_('Notifications'), 'zorin-notch-view-title'));
        this._count = label('', 'zorin-notch-list-count', {x_expand: true});
        head.add_child(this._count);
        const clear = new St.Button({
            style_class: 'zorin-notch-link-button',
            label: _('Clear all'),
            can_focus: true,
        });
        clear.connect('clicked', () => actions.clearAll());
        head.add_child(clear);

        this._rows = new St.BoxLayout({style_class: 'zorin-notch-list-rows', vertical: true});

        this.actor.add_child(this.statusRow.actor);
        this.actor.add_child(head);
        this.actor.add_child(this._rows);
    }

    update() {
        const notifications = this._source.list();
        const unread = this._source.unreadCount;
        this._count.text = unread ? _('{0} new', unread) : '';

        this._rows.destroy_all_children();
        for (const notification of notifications.slice(0, MAX_LIST_ROWS))
            this._rows.add_child(notificationRow(notification, this._actions));
        if (!notifications.length)
            this._rows.add_child(label(_('No notifications'), 'zorin-notch-list-empty'));
    }

    destroy() {
        this.actor.destroy();
    }
}

/**
 * Power menu (10). Every entry runs GNOME's own system action; Keluar, Mulai ulang and
 * Matikan open GNOME's end-session dialog, which asks for confirmation (state 11).
 * power: {can(id), run(id)}, battery(): percentage or null
 */
export class PowerView {
    constructor(power, battery) {
        this._power = power;
        this._battery = battery;

        this.actor = new St.BoxLayout({style_class: 'zorin-notch-power', vertical: true});

        const head = new St.BoxLayout({style_class: 'zorin-notch-power-head'});
        head.add_child(label(_('Power'), 'zorin-notch-view-title', {x_expand: true}));
        this._batteryLabel = label('', 'zorin-notch-list-count');
        head.add_child(this._batteryLabel);
        this.actor.add_child(head);

        const item = (id, iconName, text, extra = {}) => {
            const button = menuItem({iconName, text, onClick: () => power.run(id), ...extra});
            button.actionId = id;
            return button;
        };
        this._items = [
            item('lock', 'system-lock-screen-symbolic', _('Lock screen'), {meta: 'Super + L'}),
            item('suspend', 'weather-clear-night-symbolic', _('Suspend')),
            item('logout', 'system-log-out-symbolic', _('Log out'), {meta: _('End session')}),
            new St.Widget({style_class: 'zorin-notch-divider', x_expand: true}),
            item('restart', 'system-reboot-symbolic', _('Restart')),
            item('poweroff', 'system-shutdown-symbolic', _('Power off'), {accent: 'danger', bold: true}),
        ];
        this._items.forEach(child => this.actor.add_child(child));
    }

    update() {
        const percentage = this._battery();
        this._batteryLabel.text = percentage === null ? '' : _('Battery {0}%', percentage);
        for (const child of this._items) {
            if (child.actionId)
                child.visible = this._power.can(child.actionId);
        }
        // The divider separates the session actions from restart/power off; drop it when
        // neither of those is available
        const divider = this._items.find(child => !child.actionId);
        divider.visible = this._power.can('restart') || this._power.can('poweroff');
    }

    destroy() {
        this.actor.destroy();
    }
}

const AGENT_STATUS_TEXT = {
    working: 'working…',
    waiting: 'needs you',
    done: 'done',
};
const AGENT_TITLE = {
    waiting: 'Needs permission or input',
    done: 'Finished',
};

/**
 * Running agents in the compact notch (state 04): agent and project left of center, what
 * it is doing right of it. A teal dot pulses while it works and turns orange when it waits.
 */
export class ActivityRow {
    constructor() {
        this.actor = new St.BoxLayout({style_class: 'zorin-notch-status zorin-notch-activity', x_expand: true});
        const left = new St.BoxLayout({style_class: 'zorin-notch-activity-left', x_expand: true});
        this._dot = new St.Widget({style_class: 'zorin-notch-activity-dot', y_align: Clutter.ActorAlign.CENTER});
        this._label = label('', 'zorin-notch-activity-label', {x_expand: true});
        left.add_child(this._dot);
        left.add_child(this._label);

        this._state = label('', 'zorin-notch-activity-state', {x_align: Clutter.ActorAlign.END});
        this.actor.add_child(left);
        this.actor.add_child(this._state);
    }

    update(sessions) {
        const [first] = sessions;
        if (!first)
            return;
        const more = sessions.length > 1 ? ` +${sessions.length - 1}` : '';
        this._label.text = `${first.name}${first.project ? ` · ${first.project}` : ''}${more}`;
        this._state.text = _(AGENT_STATUS_TEXT[first.status] ?? '');
        const waiting = first.status === 'waiting';
        if (waiting)
            this._dot.add_style_pseudo_class('waiting');
        else
            this._dot.remove_style_pseudo_class('waiting');
        this._pulse(!waiting);
    }

    // Gentle opacity pulse while the agent works
    _pulse(on) {
        this._dot.remove_all_transitions();
        this._dot.opacity = 255;
        if (!on)
            return;
        this._dot.ease({
            opacity: 90,
            duration: 700,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            repeatCount: -1,
            autoReverse: true,
        });
    }

    destroy() {
        this._dot.remove_all_transitions();
        this.actor.destroy();
    }
}

/**
 * Agent popup (state 08): teal badge with the agent, project and time, what happened,
 * and Buka (focus its window) / Abaikan.
 * actions: {open(entry), dismiss()}
 */
export class AgentView {
    constructor(actions) {
        this._actions = actions;
        this.entry = null;
        this.actor = new St.BoxLayout({style_class: 'zorin-notch-agent', vertical: true});
    }

    show(entry) {
        this.entry = entry;
        this.actor.destroy_all_children();

        const head = new St.BoxLayout({style_class: 'zorin-notch-agent-head'});
        head.add_child(new St.Bin({
            style_class: 'zorin-notch-ai-badge',
            child: label(entry.name, 'zorin-notch-ai-badge-label'),
            y_align: Clutter.ActorAlign.CENTER,
        }));
        head.add_child(label(entry.project || 'agent', 'zorin-notch-agent-source', {x_expand: true}));
        head.add_child(label(_('now'), 'zorin-notch-agent-source'));
        this.actor.add_child(head);

        this.actor.add_child(label(_(AGENT_TITLE[entry.status] ?? entry.status), 'zorin-notch-agent-title'));
        if (entry.message)
            this.actor.add_child(label(agentMessage(entry.message), 'zorin-notch-agent-message'));

        const actionsRow = new St.BoxLayout({style_class: 'zorin-notch-agent-actions'});
        const open = new St.Button({style_class: 'zorin-notch-ai-button', can_focus: true});
        const openBox = new St.BoxLayout({style_class: 'zorin-notch-pill-content'});
        openBox.add_child(icon('utilities-terminal-symbolic', 'zorin-notch-ai-button-icon'));
        openBox.add_child(label(_('Open'), 'zorin-notch-ai-button-label'));
        open.child = openBox;
        open.connect('clicked', () => this._actions.open(entry));
        const skip = new St.Button({
            style_class: 'zorin-notch-link-button',
            label: _('Dismiss'),
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            can_focus: true,
        });
        skip.connect('clicked', () => this._actions.dismiss());
        actionsRow.add_child(open);
        actionsRow.add_child(skip);
        this.actor.add_child(actionsRow);
    }

    clear() {
        this.entry = null;
        this.actor.destroy_all_children();
    }

    destroy() {
        this.actor.destroy();
    }
}

const MAX_SEARCH_RESULTS = 6;
const SUGGESTED_APPS = 4;
// Files are searched when the typing pauses, from this many characters on
const FILE_SEARCH_DELAY_MS = 150;
const FILE_SEARCH_MIN_CHARS = 2;

// Snippet from the daemon: matches are marked « », shown in bold on one line
function snippetLabel(snippet) {
    const text = snippet.replace(/\s+/g, ' ').trim();
    const markup = GLib.markup_escape_text(text, -1).replaceAll('«', '<b>').replaceAll('»', '</b>');
    const snippetLine = label('', 'zorin-notch-search-meta', {x_align: Clutter.ActorAlign.START});
    snippetLine.clutter_text.set_markup(markup);
    return snippetLine;
}

function fileIcon(hit) {
    if (hit.kind === 'folder')
        return new Gio.ThemedIcon({name: 'folder'});
    return Gio.content_type_get_icon(hit.mime || 'application/octet-stream');
}

/**
 * App search in the notch ("Search"), Spotlight style: a large entry, then the matching apps
 * ranked like GNOME's own app search (Shell.AppSystem.search, then by usage), or the most
 * used apps while the entry is empty. The selected row is highlighted with the accent; ↑/↓
 * move it, Enter opens it. The last row hands the query over to the GNOME overview.
 * Below the apps come files and document contents from the daemon, when it is there; Ctrl+Enter
 * on one of them opens its folder.
 * actions: {launch(app), searchInOverview(query),
 *   optional: searchFiles(query, cancellable) -> Promise of hits, filesEnabled(), openUri(uri)}
 */
export class SearchView {
    constructor(actions) {
        this._actions = actions;
        this._results = [];
        this._rows = [];
        this._selected = 0;
        this._hits = [];
        this._fileSearchTimeout = 0;
        this._fileSearchCancellable = null;

        this.actor = new St.BoxLayout({style_class: 'zorin-notch-search', vertical: true});
        // Kept for the notch's status updates; the Spotlight layout does not show it
        this.statusRow = new StatusRow('zorin-notch-status zorin-notch-panel-status');

        this.entry = new St.Entry({
            style_class: 'zorin-notch-search-entry',
            hint_text: _('Search apps…'),
            can_focus: true,
            x_expand: true,
            primary_icon: new St.Icon({icon_name: 'system-search-symbolic', style_class: 'zorin-notch-search-icon'}),
        });
        this.entry.clutter_text.connect('text-changed', () => this.update());
        this.entry.clutter_text.connect('activate', () => this._rows[this._selected]?.activate());
        this.entry.clutter_text.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Down || key === Clutter.KEY_Up) {
                this._select(this._selected + (key === Clutter.KEY_Down ? 1 : -1));
                return Clutter.EVENT_STOP;
            }
            const enter = key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter;
            const reveal = this._rows[this._selected]?.reveal;
            if (enter && reveal && (event.get_state() & Clutter.ModifierType.CONTROL_MASK)) {
                reveal();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._list = new St.BoxLayout({style_class: 'zorin-notch-search-results', vertical: true});

        this.actor.add_child(this.entry);
        this.actor.add_child(this._list);
    }

    reset() {
        this._hits = [];
        this.entry.hint_text = this._actions.filesEnabled?.() ? _('Search apps and files…') : _('Search apps…');
        this.entry.text = '';
        this.update();
    }

    focus() {
        this.entry.grab_key_focus();
    }

    _search(query) {
        const appSystem = Shell.AppSystem.get_default();
        const usage = Shell.AppUsage.get_default();
        if (!query) {
            return usage.get_most_used().filter(app => app?.app_info?.should_show())
                .slice(0, SUGGESTED_APPS);
        }
        const ids = [];
        for (const group of Shell.AppSystem.search(query))
            ids.push(...group.sort((a, b) => usage.compare(a, b)));
        return ids.map(id => appSystem.lookup_app(id))
            .filter(app => app?.app_info?.should_show())
            .slice(0, MAX_SEARCH_RESULTS);
    }

    _row({key, gicon, iconActor, text, meta, snippet = '', onActivate, onReveal = null}) {
        const box = new St.BoxLayout({style_class: 'zorin-notch-search-row-content', x_expand: true});
        box.add_child(new St.Bin({
            style_class: 'zorin-notch-search-app-icon',
            child: iconActor ?? new St.Icon({gicon, icon_size: 18, style_class: 'zorin-notch-search-glyph'}),
        }));
        const name = label(text, 'zorin-notch-search-name', {x_expand: true});
        if (snippet) {
            const column = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            column.add_child(name);
            column.add_child(snippetLabel(snippet));
            box.add_child(column);
        } else {
            box.add_child(name);
        }
        box.add_child(label(meta, 'zorin-notch-search-meta'));
        const row = new St.Button({
            style_class: 'zorin-notch-search-row',
            child: box,
            x_expand: true,
            can_focus: false,
        });
        row.key = key;
        row.activate = onActivate;
        row.reveal = onReveal;
        row.connect('clicked', onActivate);
        const index = this._rows.length;
        row.connect('notify::hover', () => {
            if (row.hover)
                this._select(index);
        });
        this._rows.push(row);
        this._list.add_child(row);
        return row;
    }

    _select(index) {
        if (!this._rows.length)
            return;
        this._selected = Math.max(0, Math.min(index, this._rows.length - 1));
        this._rows.forEach((row, i) => {
            if (i === this._selected)
                row.add_style_pseudo_class('selected');
            else
                row.remove_style_pseudo_class('selected');
        });
    }

    update() {
        const query = this.entry.text.trim();
        this._results = this._search(query);
        if (!query)
            this._hits = [];
        this._scheduleFileSearch(query);
        this._render(query, false);
    }

    // Draws apps, then files and document contents, then the hand-over to the overview.
    // With keepSelection the highlighted row stays on the same result (hits arriving late).
    _render(query, keepSelection) {
        const selectedKey = keepSelection ? this._rows[this._selected]?.key : null;
        this._list.destroy_all_children();
        this._rows = [];

        const grouped = this._hits.length > 0;
        if (grouped && this._results.length)
            this._list.add_child(label(_('Applications'), 'zorin-notch-group-label'));
        for (const app of this._results) {
            this._row({
                key: `app:${app.get_id()}`,
                iconActor: app.create_icon_texture(24),
                text: app.get_name(),
                meta: _('App'),
                onActivate: () => this._actions.launch(app),
            });
        }
        this._addHits(_('Files'), this._hits.filter(h => h.kind !== 'document'));
        this._addHits(_('Document contents'), this._hits.filter(h => h.kind === 'document'));
        if (query) {
            if (!this._results.length && !grouped)
                this._list.add_child(label(_('No matching apps'), 'zorin-notch-list-empty'));
            this._row({
                key: 'overview',
                gicon: new Gio.ThemedIcon({name: 'system-search-symbolic'}),
                text: _('Search “{0}” in Overview', query),
                meta: 'Overview',
                onActivate: () => this._actions.searchInOverview(query),
            });
        }
        this._list.visible = this._rows.length > 0;
        const index = this._rows.findIndex(row => row.key === selectedKey);
        this._select(index >= 0 ? index : 0);
    }

    _addHits(title, hits) {
        if (!hits.length)
            return;
        this._list.add_child(label(title, 'zorin-notch-group-label'));
        for (const hit of hits) {
            const folder = Gio.File.new_for_uri(hit.uri).get_parent();
            this._row({
                key: `hit:${hit.uri}`,
                gicon: fileIcon(hit),
                text: hit.title,
                meta: folder?.get_basename() ?? '',
                snippet: hit.snippet,
                onActivate: () => this._actions.openUri(hit.uri),
                onReveal: folder ? () => this._actions.openUri(folder.get_uri()) : null,
            });
        }
    }

    // Files are looked up when the typing pauses; an older answer never replaces a newer query
    _scheduleFileSearch(query) {
        this._cancelFileSearch();
        if (query.length < FILE_SEARCH_MIN_CHARS || !this._actions.searchFiles || !this._actions.openUri)
            return;
        this._fileSearchTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FILE_SEARCH_DELAY_MS, () => {
            this._fileSearchTimeout = 0;
            this._searchFiles(query);
            return GLib.SOURCE_REMOVE;
        });
    }

    async _searchFiles(query) {
        const cancellable = new Gio.Cancellable();
        this._fileSearchCancellable = cancellable;
        const hits = await this._actions.searchFiles(query, cancellable);
        if (cancellable.is_cancelled())
            return;
        this._fileSearchCancellable = null;
        this._hits = hits;
        this._render(query, true);
    }

    _cancelFileSearch() {
        if (this._fileSearchTimeout) {
            GLib.source_remove(this._fileSearchTimeout);
            this._fileSearchTimeout = 0;
        }
        this._fileSearchCancellable?.cancel();
        this._fileSearchCancellable = null;
    }

    destroy() {
        this._cancelFileSearch();
        this.actor.destroy();
    }
}

// Format of the panel's date and time ("Sab 31 Okt  12.52")
export function panelDateText(clockText) {
    const date = GLib.DateTime.new_now_local().format('%a %-d %b');
    return `${date}  ${clockText}`;
}
