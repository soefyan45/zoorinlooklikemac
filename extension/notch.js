// The notch actor: state machine, spring animation and the content of each state.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {LOG_PREFIX, trace} from './log.js';
import {drawNotch} from './shape.js';
import {Color, IdleHitArea, StateSize, Timing} from './tokens.js';
import {BatterySource, ClockSource, NetworkSource} from './sources.js';
import {QuickSettingsBridge} from './quicksettings.js';
import {NotificationSource} from './messages.js';
import {PowerActions} from './power.js';
import {TrayBridge} from './tray.js';
import {AgentTracker} from './agents.js';
import {
    ActivityRow, AgentView, ListView, NotificationView, PanelView, PowerView, SearchView, StatusRow,
    WifiView, panelDateText,
} from './views.js';

import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';


export const State = {
    IDLE: 'idle',
    HOVER: 'hover',
    PEEK: 'peek',
    STATUS: 'status',
    NOTIFICATION: 'notification',
    PANEL: 'panel',
    WIFI: 'wifi',
    LIST: 'notificationList',
    POWER: 'power',
    SEARCH: 'search',
    // A coding agent is working: the notch stays at status size and shows it (Pego 04)
    ACTIVITY: 'activity',
    // A coding agent finished or needs the user (Pego 08)
    AGENT: 'aiNotification',
};

// Expanded states use the large notch shape; modal ones also take keyboard and outside clicks
const EXPANDED = new Set([
    State.NOTIFICATION, State.PANEL, State.WIFI, State.LIST, State.POWER, State.SEARCH, State.AGENT,
]);
const MODAL = new Set([State.PANEL, State.WIFI, State.LIST, State.POWER, State.SEARCH]);
// A popup may only replace these states; otherwise it waits in the queue
const INTERRUPTIBLE = new Set([State.IDLE, State.HOVER, State.PEEK, State.STATUS, State.ACTIVITY]);

// Spring constants per axis, close to critical damping (ratio ~0.93) so the notch glides into
// place with a hint of overshoot instead of wobbling; height settles a bit faster so the notch
// "drops" while it widens
const WIDTH_SPRING = {stiffness: 260, damping: 30};
const HEIGHT_SPRING = {stiffness: 340, damping: 34};

const POINTER_POLL_MS = 50;
// The hover line is this much larger than the standby line (design: 120×4 -> 160×6)
const HOVER_GROW = [40, 2];
// Extra room around the peeking notch before it falls back to the hover line
const PEEK_MARGIN = 14;
// Area around the top center where an approaching pointer turns the line into the hover line
const APPROACH_ZONE = {halfWidth: 200, height: 60};
// Status row: inset by the compact ears, 30 px tall (Pego "stRow")
const STATUS_ROW_INSET = 6;
const STATUS_ROW_HEIGHT = 30;
const CONTENT_MIN_HEIGHT = 28;
// Expanded views: padding from the notch edges (Pego frames)
const VIEW_PADDING = {
    // Popups start close to the top edge: the design's room for the camera is gone
    [State.NOTIFICATION]: {x: 22, top: 14, bottom: 14},
    [State.PANEL]: {x: 30, top: 0, bottom: 20},
    [State.WIFI]: {x: 22, top: 0, bottom: 20},
    [State.LIST]: {x: 30, top: 0, bottom: 24},
    [State.POWER]: {x: 20, top: 16, bottom: 18},
    [State.SEARCH]: {x: 30, top: 0, bottom: 20},
    [State.AGENT]: {x: 22, top: 14, bottom: 18},
};
// How long an agent popup stays when nobody looks at it
const AGENT_POPUP_MS = {done: 6000, waiting: 12000};
const WIFI_REFRESH_MS = 3000;

class Spring {
    constructor(value, {stiffness, damping}) {
        this.value = value;
        this.target = value;
        this.velocity = 0;
        this._stiffness = stiffness;
        this._damping = damping;
    }

    step(dt) {
        const accel = this._stiffness * (this.target - this.value) - this._damping * this.velocity;
        this.velocity += accel * dt;
        this.value += this.velocity * dt;
    }

    snap() {
        this.value = this.target;
        this.velocity = 0;
    }

    get settled() {
        return Math.abs(this.target - this.value) < 0.05 && Math.abs(this.velocity) < 0.05;
    }
}

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

export class Notch {
    /**
     * @param {object} options - {settings: Gio.Settings of the extension, openPreferences()}
     */
    constructor({settings, openPreferences}) {
        this._settings = settings;
        this._openPreferences = openPreferences;
        this._state = State.IDLE;
        const [w, h] = this._sizeOf(State.IDLE);
        this._width = new Spring(w, WIDTH_SPRING);
        this._height = new Spring(h, HEIGHT_SPRING);
        this._grab = null;
        this._autoCloseId = 0;
        this._wifiRefreshId = 0;
        this._popupQueue = [];
        this._popupId = 0;

        this._buildActors();
        this._buildSources();
        this._settings?.connectObject('changed', (_s, key) => this._onSettingsChanged(key), this);

        this._ticker = new Clutter.Timeline({actor: this.actor, duration: 1000, repeat_count: -1});
        this._ticker.connect('new-frame', () => this._tick(Math.min(this._ticker.get_delta(), 50) / 1000));

        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POINTER_POLL_MS, () => {
            this._pollPointer();
            return GLib.SOURCE_CONTINUE;
        });

        Main.layoutManager.addTopChrome(this.actor);
        Main.layoutManager.connectObject('monitors-changed', () => this._relayout(), this);
        global.display.connectObject('in-fullscreen-changed', () => this._syncFullscreen(), this);
        St.ThemeContext.get_for_stage(global.stage).connectObject(
            'notify::scale-factor', () => this._relayout(), this);

        this._relayout();
        this._syncFullscreen();
    }

    _buildActors() {
        this.actor = new St.Widget({
            name: 'zorinNotch',
            reactive: true,
            track_hover: true,
            accessible_name: 'Notch',
        });
        // A click counts only when the press also started on the notch; otherwise the release of
        // a click outside (which just closed the panel) would reopen it
        this.actor.connect('button-press-event', () => {
            this._pressed = true;
            return Clutter.EVENT_PROPAGATE;
        });
        this.actor.connect('button-release-event', (_actor, event) => this._onClick(event));
        this.actor.connect('captured-event', (_actor, event) => {
            return this._onCapturedEvent(event);
        });
        this.actor.connect('notify::hover', () => this._pollPointer());

        this._area = new St.DrawingArea();
        this._area.connect('repaint', area => this._repaint(area));
        this.actor.add_child(this._area);

        const actions = {
            openWifi: () => this.setState(State.WIFI),
            back: () => this.setState(State.PANEL),
            showApps: () => this._closeThen(() => Main.overview.showApps()),
            search: () => this.setState(State.SEARCH),
            openSettings: () => this._closeThen(() => this._bridge.openSettings()),
            openPreferences: () => this._closeThen(() => this._openPreferences?.()),
            openWifiSettings: () => this._closeThen(() => this._bridge.openSettings('gnome-wifi-panel.desktop')),
            lockScreen: () => this._closeThen(() => this._power.run('lock')),
            openPower: () => this.setState(State.POWER),
            openNotifications: () => this.setState(State.LIST),
        };

        // Power runs only after the notch has closed (and released its grab)
        this._power = new PowerActions({dryRun: !!GLib.getenv('ZORIN_NOTCH_DRY_RUN')});
        const power = {
            can: id => this._power.can(id),
            run: id => this._closeThen(() => this._power.run(id)),
        };

        const notificationActions = {
            activate: notification => this._closeThen(() => notification.activate()),
            runAction: (notification, action) => this._closeThen(() => action.activate()),
            dismiss: notification =>
                notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED),
            clearAll: () => this._messages.clearAll(),
        };

        // One content layer per state; only the layer of the current state is shown
        this._statusRow = new StatusRow();
        this._bridge = new QuickSettingsBridge(() => this._syncViews());
        this._messages = new NotificationSource({
            onPopup: notification => this._queuePopup(notification),
            onChange: () => this._onMessagesChanged(),
        });
        this._panelView = new PanelView(this._bridge, actions);
        this._tray = new TrayBridge(this._panelView.trayRow, () => this._syncViews());
        this._wifiView = new WifiView(this._bridge, actions);
        this._notificationView = new NotificationView(notificationActions);
        this._listView = new ListView(this._messages, notificationActions);
        this._searchView = new SearchView({
            launch: app => this._closeThen(() => app.activate()),
            searchInOverview: query => this._closeThen(() => {
                Main.overview.show();
                Main.overview.searchEntry?.set_text(query);
            }),
        });
        this._searchView.entry.clutter_text.connect('text-changed', () => this._fitHeight());
        this._activityRow = new ActivityRow();
        this._agentView = new AgentView({
            open: entry => this._closeThen(() => this._agents.focus(entry)),
            dismiss: () => this.setState(State.IDLE),
        });
        this._agents = new AgentTracker({
            onChange: () => this._onAgentsChanged(),
            onPopup: entry => {
                if (this._settings?.get_boolean('show-agents') ?? true)
                    this._queuePopup({agentEntry: entry});
            },
        });
        this._powerView = new PowerView(power, () =>
            this._battery?.present ? this._battery.percentage : null);
        this._layers = {
            // Hovering the notch (peek) already shows the status row
            [State.PEEK]: this._statusRow.actor,
            [State.STATUS]: this._statusRow.actor,
            [State.NOTIFICATION]: this._notificationView.actor,
            [State.PANEL]: this._panelView.actor,
            [State.WIFI]: this._wifiView.actor,
            [State.LIST]: this._listView.actor,
            [State.POWER]: this._powerView.actor,
            [State.SEARCH]: this._searchView.actor,
            [State.ACTIVITY]: this._activityRow.actor,
            [State.AGENT]: this._agentView.actor,
        };
        for (const layer of Object.values(this._layers)) {
            layer.opacity = 0;
            layer.visible = false;
            this.actor.add_child(layer);
        }
    }

    _buildSources() {
        this._clock = new ClockSource(() => this._syncStatus());
        this._battery = new BatterySource(() => this._syncStatus());
        this._network = new NetworkSource(() => this._syncStatus());
        this._syncStatus();
    }

    _syncStatus() {
        const clock = this._clock?.text ?? '';
        const battery = this._battery?.present && this._battery.percentage !== null
            ? {percentage: this._battery.percentage, iconName: this._battery.iconName}
            : null;
        const networkIcon = this._network?.iconName ?? null;

        this._statusRow.update({clock: panelDateText(clock), networkIcon, battery});
        this._panelView.statusRow.update({clock: panelDateText(clock), networkIcon, battery});
        this._wifiView.statusRow.update({clock, networkIcon, battery});
        this._listView.statusRow.update({clock, networkIcon, battery});
        this._searchView.statusRow.update({clock, networkIcon, battery});
    }

    _syncViews() {
        const view = {
            [State.PANEL]: this._panelView,
            [State.WIFI]: this._wifiView,
            [State.LIST]: this._listView,
            [State.POWER]: this._powerView,
            [State.SEARCH]: this._searchView,
        }[this._state];
        if (!view)
            return;
        // A failing view must not break the state machine; it just shows what it has
        try {
            view.update({
                trayVisible: this._tray?.hasVisibleIcons ?? false,
                unread: this._messages?.unreadCount ?? 0,
            });
        } catch (e) {
            console.error(LOG_PREFIX, `${this._state} view update failed`, e);
        }
        this._fitHeight();
    }

    _onAgentsChanged() {
        if (!this._activityRow)
            return;
        this._activityRow.update(this._agents.active);
        if (this._state === State.IDLE && this._agentsShown())
            this.setState(State.ACTIVITY);
        else if (this._state === State.ACTIVITY && !this._agentsShown())
            this.setState(State.IDLE);
    }

    _onMessagesChanged() {
        if (!this._listView)
            return;
        if (this._state === State.LIST)
            this._syncViews();
        this._area?.queue_repaint();
    }

    // GNOME already filtered these (do not disturb, app policy, urgency); show them one by one
    // Items are GNOME notifications or {agentEntry} from the agent tracker
    _queuePopup(item) {
        if (item.agentEntry) {
            this._popupQueue.push(item);
            this._showNextPopup();
            return;
        }
        const notification = item;
        if (this._popupQueue.includes(notification) || this._notificationView.notification === notification)
            return;
        this._popupQueue.push(notification);
        notification.connectObject('destroy', () => {
            this._popupQueue = this._popupQueue.filter(n => n !== notification);
            if (this._notificationView.notification === notification && this._state === State.NOTIFICATION)
                this.setState(State.IDLE);
        }, this);
        this._showNextPopup();
    }

    _showNextPopup() {
        if (!this._popupQueue.length)
            return;
        if (!INTERRUPTIBLE.has(this._state)) {
            trace(`popup waits: state ${this._state}, ${this._popupQueue.length} queued`);
            return;
        }

        const next = this._popupQueue.shift();
        if (next.agentEntry) {
            const entry = next.agentEntry;
            this._agentView.show(entry);
            this.setState(State.AGENT);
            this._armAutoClose(AGENT_POPUP_MS[entry.status] ?? AGENT_POPUP_MS.done);
            return;
        }

        const notification = next;
        // What GNOME's banner would do when shown: mark seen and play the sound
        notification.acknowledged = true;
        notification.playSound();

        this._notificationView.show(notification);
        this.setState(State.NOTIFICATION);
        this._armAutoClose(this._seconds('notification-seconds', Timing.notificationMs), () => {
            if (notification.is_transient)
                notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
        });
    }

    get state() {
        return this._state;
    }

    // Size of a state; the standby line, its hover line and the notification follow settings
    _sizeOf(state) {
        const settings = this._settings;
        if (!settings)
            return StateSize[state];
        const idle = [settings.get_int('idle-width'), settings.get_int('idle-height')];
        switch (state) {
        case State.IDLE:
            return idle;
        case State.HOVER:
            return [idle[0] + HOVER_GROW[0], idle[1] + HOVER_GROW[1]];
        case State.NOTIFICATION:
            return [settings.get_int('notification-width'), StateSize.notification[1]];
        default:
            return StateSize[state];
        }
    }

    // Click target around the standby line, never smaller than the design's 200 × 12
    _hitArea() {
        const [w, h] = this._sizeOf(State.IDLE);
        return [Math.max(IdleHitArea[0], w + 80), Math.max(IdleHitArea[1], h + 8)];
    }

    // $notch-panel with the opacity from the preferences
    _panelColor() {
        const opacity = this._settings?.get_double('panel-opacity');
        if (opacity === undefined)
            return Color.notchPanel;
        const alpha = Math.round(opacity * 255).toString(16).padStart(2, '0');
        return `${Color.notchPanel.slice(0, 7)}${alpha}`;
    }

    _seconds(key, fallbackMs) {
        return this._settings ? this._settings.get_int(key) * 1000 : fallbackMs;
    }

    // Coding agents shown only when enabled in the preferences
    _agentsShown() {
        return (this._settings?.get_boolean('show-agents') ?? true) && !!this._agents?.hasActive;
    }

    _onSettingsChanged(key) {
        switch (key) {
        case 'idle-width':
        case 'idle-height':
        case 'notification-width': {
            const [w, h] = this._sizeOf(this._state);
            this._width.target = w;
            this._height.target = h;
            this._wake();
            break;
        }
        case 'show-agents':
            this._onAgentsChanged();
            break;
        case 'panel-opacity':
            this._area.queue_repaint();
            break;
        }
    }

    get debugSize() {
        return `${this._width.value.toFixed(1)}x${this._height.value.toFixed(1)}`;
    }

    // Stop the pointer from changing the state (used by the self test to hold a state)
    freezePointer(frozen) {
        this._pointerFrozen = frozen;
    }

    setState(state) {
        // While an agent works the notch rests on its activity instead of the idle line
        if (state === State.IDLE && this._agentsShown())
            state = State.ACTIVITY;
        if (state === this._state)
            return;

        const previous = this._state;
        trace(`state ${previous} -> ${state}`);
        this._state = state;
        const [w, h] = this._sizeOf(state);
        this._width.target = w;
        this._height.target = h;

        this._clearAutoClose();
        if (state === State.STATUS)
            this._armAutoClose(this._seconds('status-seconds', Timing.statusAutoCloseMs));

        this._setWifiRefresh(state === State.WIFI);
        if (state === State.WIFI)
            this._bridge.scanWifi();

        // The list counts as read once it has been seen
        if (previous === State.PANEL)
            this._tray?.closeMenus();
        if (previous === State.LIST)
            this._messages.markAllRead();

        // Show the layer first: a hidden St widget has no style yet, so measuring it would
        // ignore its CSS sizes. Measure again before the next redraw, once it is styled.
        this._syncLayers(previous);
        if (previous === State.NOTIFICATION)
            this._notificationView.clear();
        if (previous === State.AGENT)
            this._agentView.clear();
        this._syncViews();
        if (state === State.SEARCH)
            this._searchView.reset();
        this._setModal(MODAL.has(state));
        // Typing goes straight into the search entry
        if (state === State.SEARCH && this._grab)
            this._searchView.focus();

        // Queued popups wait for the notch to be free
        if (INTERRUPTIBLE.has(state) && this._popupQueue.length && !this._popupId) {
            this._popupId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._popupId = 0;
                this._showNextPopup();
                return GLib.SOURCE_REMOVE;
            });
        }
        if (EXPANDED.has(state)) {
            global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                if (this.actor && EXPANDED.has(this._state))
                    this._fitHeight();
                return GLib.SOURCE_REMOVE;
            });
        }
        this._wake();
    }

    // Expanded views take the height of their content (the Pego sizes are for the design's data)
    _fitHeight() {
        const padding = VIEW_PADDING[this._state];
        const layer = this._layers[this._state];
        if (!padding || !layer)
            return;

        const scale = scaleFactor();
        const width = (this._sizeOf(this._state)[0] - 2 * padding.x) * scale;
        const [, natural] = layer.get_preferred_height(width);
        this._height.target = padding.top + Math.ceil(natural / scale) + padding.bottom;
        this._wake();
    }

    _closeThen(callback) {
        this.setState(State.IDLE);
        try {
            callback();
        } catch (e) {
            console.error(LOG_PREFIX, 'action failed', e);
        }
    }

    _armAutoClose(ms, onClose = null) {
        this._autoCloseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            // Keep it open while the pointer rests on it
            if (this.actor.hover)
                return GLib.SOURCE_CONTINUE;
            this._autoCloseId = 0;
            try {
                onClose?.();
            } catch (e) {
                console.error(LOG_PREFIX, 'auto close failed', e);
            }
            this.setState(State.IDLE);
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearAutoClose() {
        if (this._autoCloseId) {
            GLib.source_remove(this._autoCloseId);
            this._autoCloseId = 0;
        }
    }

    _setWifiRefresh(enabled) {
        if (this._wifiRefreshId) {
            GLib.source_remove(this._wifiRefreshId);
            this._wifiRefreshId = 0;
        }
        if (enabled)
            this._wifiRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WIFI_REFRESH_MS, () => {
                this._syncViews();
                return GLib.SOURCE_CONTINUE;
            });
    }

    // While expanded the notch holds a modal grab: keyboard focus for Esc, and clicks
    // outside the notch reach us so we can close
    _setModal(modal) {
        if (modal && !this._grab) {
            const grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
            if ((grab.get_seat_state() & Clutter.GrabState.KEYBOARD) === 0) {
                Main.popModal(grab);
                console.warn(LOG_PREFIX, 'could not grab the keyboard');
                return;
            }
            this._grab = grab;
            this.actor.grab_key_focus();
        } else if (!modal && this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
    }

    _onCapturedEvent(event) {
        if (!this._grab)
            return Clutter.EVENT_PROPAGATE;

        const type = event.type();
        if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
            this.setState(State.IDLE);
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
            const [x, y] = event.get_coords();
            const target = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
            if (!this.actor.contains(target)) {
                this.setState(State.IDLE);
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onClick(event) {
        const pressed = this._pressed;
        this._pressed = false;
        if (!pressed || event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        return this.activate() ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }

    // What a click on the notch itself does; returns false when the click belongs to content
    activate() {
        switch (this._state) {
        case State.IDLE:
        case State.HOVER:
        case State.PEEK:
            // With unread notifications (the accent dot) a click opens the list instead
            // The status is already visible while hovering, so a click opens the panel
            this.setState(this._messages.unreadCount > 0 ? State.LIST : State.PANEL);
            return true;
        case State.STATUS:
            this.setState(State.PANEL);
            return true;
        default:
            // Clicks inside the panel belong to its buttons
            return false;
        }
    }

    _pollPointer() {
        if (this._pointerFrozen || !this.actor.visible ||
            this._state === State.STATUS || EXPANDED.has(this._state))
            return;

        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const [px, py] = global.get_pointer();
        const scale = scaleFactor();

        // Stay in peek while the pointer is on the notch or just around it, so moving along
        // its edge does not make it flicker between peek and hover
        const margin = (this._state === State.PEEK ? PEEK_MARGIN : 0) * scale;
        const [ax, ay] = this.actor.get_transformed_position();
        const [aw, ah] = this.actor.get_transformed_size();
        if (this.actor.hover || (px >= ax - margin && px <= ax + aw + margin &&
            py >= ay && py <= ay + ah + margin)) {
            this.setState(State.PEEK);
            return;
        }

        const dx = Math.abs(px - (monitor.x + monitor.width / 2));
        const dy = py - monitor.y;
        if (this._agentsShown()) {
            this.setState(State.ACTIVITY);
            return;
        }
        const near = dy >= 0 && dy <= APPROACH_ZONE.height * scale &&
            dx <= APPROACH_ZONE.halfWidth * scale;
        this.setState(near ? State.HOVER : State.IDLE);
    }

    _wake() {
        if (!St.Settings.get().enable_animations || !(this._settings?.get_boolean('animations') ?? true)) {
            this._width.snap();
            this._height.snap();
            this._relayout();
            return;
        }
        if (!this._ticker.is_playing())
            this._ticker.start();
    }

    _tick(dt) {
        // Two half steps keep the stiffer springs stable on long frames
        for (let i = 0; i < 2; i++) {
            this._width.step(dt / 2);
            this._height.step(dt / 2);
        }
        if (this._width.settled && this._height.settled) {
            this._width.snap();
            this._height.snap();
            this._ticker.stop();
        }
        this._relayout();
    }

    // Show the layer of the current state after the shape has started to grow
    _syncLayers(previous) {
        const previousLayer = this._layers[previous];
        const layer = this._layers[this._state];
        if (previousLayer && previousLayer !== layer) {
            previousLayer.remove_all_transitions();
            previousLayer.opacity = 0;
            previousLayer.visible = false;
        }
        if (!layer)
            return;

        layer.visible = true;
        layer.remove_all_transitions();
        layer.ease({
            opacity: 255,
            duration: 180,
            delay: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // Size and place the actor around the current shape (never smaller than the idle click area).
    // While the springs move, the box only grows: resizing every frame would make GNOME
    // recompute the chrome input region and reallocate the Cairo surface on each frame, which is
    // what made the animation stutter. It shrinks to fit once the springs settle.
    _relayout() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const scale = scaleFactor();
        const [hitW, hitH] = this._hitArea();
        let width = Math.ceil(Math.max(this._width.value, this._width.target, hitW) * scale);
        let height = Math.ceil(Math.max(this._height.value, this._height.target, hitH) * scale);
        if (this._ticker?.is_playing() && this._box) {
            width = Math.max(width, this._box.width);
            height = Math.max(height, this._box.height);
        }

        const boxChanged = this._box?.width !== width || this._box?.height !== height ||
            this._box?.monitorX !== monitor.x || this._box?.monitorWidth !== monitor.width;
        if (!boxChanged) {
            this._activityRow.actor.visible = this._state === State.ACTIVITY &&
                this._height.value >= CONTENT_MIN_HEIGHT;
            this._statusRow.actor.visible = (this._state === State.STATUS || this._state === State.PEEK) &&
                this._height.value >= CONTENT_MIN_HEIGHT;
            this._area.queue_repaint();
            return;
        }
        this._box = {width, height, monitorX: monitor.x, monitorWidth: monitor.width};

        this.actor.set_size(width, height);
        this.actor.set_position(monitor.x + Math.round((monitor.width - width) / 2), monitor.y);
        this._area.set_size(width, height);

        const rowWidth = Math.round((StateSize.status[0] - 2 * STATUS_ROW_INSET) * scale);
        for (const row of [this._statusRow.actor, this._activityRow.actor]) {
            row.set_size(rowWidth, Math.round(STATUS_ROW_HEIGHT * scale));
            row.set_position(Math.round((width - rowWidth) / 2), 0);
        }
        this._activityRow.actor.visible = this._state === State.ACTIVITY &&
            this._height.value >= CONTENT_MIN_HEIGHT;
        // Hide the row while the notch is still too short to hold it
        this._statusRow.actor.visible = (this._state === State.STATUS || this._state === State.PEEK) &&
            this._height.value >= CONTENT_MIN_HEIGHT;

        for (const state of EXPANDED) {
            const padding = VIEW_PADDING[state];
            const viewWidth = Math.round((this._sizeOf(state)[0] - 2 * padding.x) * scale);
            this._layers[state].set_width(viewWidth);
            this._layers[state].set_position(Math.round((width - viewWidth) / 2), Math.round(padding.top * scale));
        }

        this._area.queue_repaint();
    }

    _repaint(area) {
        const cr = area.get_context();
        try {
            const [areaWidth] = area.get_surface_size();
            const scale = scaleFactor();
            drawNotch(cr, areaWidth, this._width.value * scale, Math.max(0, this._height.value) * scale, {
                scale,
                ringColor: this._state === State.IDLE ? Color.notchIdleEdge : Color.notchGlassEdge,
                panelColor: this._state === State.NOTIFICATION ? Color.notchGlass : this._panelColor(),
                edgeColor: this._state === State.AGENT ? Color.aiEdge : Color.notchGlassEdge,
                expanded: EXPANDED.has(this._state),
                showCamera: false,
                unreadDot: (this._messages?.unreadCount ?? 0) > 0,
            });
        } catch (e) {
            console.error(LOG_PREFIX, 'repaint failed', e);
        } finally {
            cr.$dispose();
        }
    }

    _syncFullscreen() {
        this.actor.visible = !Main.layoutManager.primaryMonitor?.inFullscreen;
    }

    destroy() {
        this._setModal(false);
        this._clearAutoClose();
        this._setWifiRefresh(false);
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        this._ticker.stop();
        this._ticker = null;

        this._settings?.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        global.display.disconnectObject(this);
        St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);

        if (this._popupId) {
            GLib.source_remove(this._popupId);
            this._popupId = 0;
        }
        this._popupQueue.forEach(n => n.disconnectObject?.(this));
        this._notificationView.notification?.disconnectObject(this);
        this._popupQueue = [];

        this._clock.destroy();
        this._battery.destroy();
        this._network.destroy();
        this._bridge.destroy();
        this._messages.destroy();
        // The tray icons go back to the dock before the panel (their parent) is destroyed
        this._tray.destroy();
        this._tray = null;
        this._panelView.destroy();
        this._wifiView.destroy();
        this._notificationView.destroy();
        this._listView.destroy();
        this._powerView.destroy();
        this._searchView.destroy();
        this._agents.destroy();
        this._activityRow.destroy();
        this._agentView.destroy();
        this._clock = this._battery = this._network = this._bridge = this._messages = null;

        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
        this.actor = null;
    }
}
