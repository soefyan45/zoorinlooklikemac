// Spotlight: app search in a glass box centered near the top of the screen, like macOS.
// Opened from the notch's Search button or by typing in the overview (Super, then type).
// The content (entry, ranked results, ↑/↓/Enter) is SearchView; this module only hosts it,
// holds the keyboard while it is open, and closes on Esc, a click outside, or a launch.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {FileSearch} from './filesearch.js';
import {LOG_PREFIX} from './log.js';
import {SearchView} from './views.js';

const WIDTH = 640;
// Distance of the box from the top of the monitor, as a share of its height
const TOP_RATIO = 0.18;
const ANIMATION_MS = 160;

export class Spotlight {
    /**
     * @param {object} options - {theme: ThemeManager or null, settings: Gio.Settings or null};
     *   without settings Spotlight searches apps only
     */
    constructor({theme = null, settings = null} = {}) {
        this._theme = theme;
        this._grab = null;
        this._settings = settings;
        const files = settings ? new FileSearch(settings) : null;

        this._view = new SearchView({
            launch: app => this.close(() => app.activate()),
            searchInOverview: query => this.close(() => {
                Main.overview.show();
                Main.overview.searchEntry?.set_text(query);
            }),
            ...(files && {
                searchFiles: (query, cancellable) => files.search(query, cancellable),
                filesEnabled: () => files.enabled,
                openUri: uri => this.close(() =>
                    Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1))),
            }),
        });

        // The view fills the box whatever the width of its rows
        this._view.actor.x_expand = true;
        this._view.actor.x_align = Clutter.ActorAlign.FILL;

        this.actor = new St.Bin({
            style_class: 'zorin-notch-spotlight',
            child: this._view.actor,
            reactive: true,
            visible: false,
            opacity: 0,
        });
        this.actor.connect('captured-event', (_actor, event) => this._onEvent(event));
        Main.layoutManager.uiGroup.add_child(this.actor);

        this._view.entry.clutter_text.connect('text-changed', () => this._place());
    }

    get isOpen() {
        return this.actor.visible;
    }

    get view() {
        return this._view;
    }

    open(text = '') {
        this.syncTheme();
        this._view.reset();
        if (text) {
            this._view.entry.text = text;
            this._view.entry.clutter_text.set_cursor_position(-1);
        }
        Main.layoutManager.uiGroup.set_child_above_sibling(this.actor, null);
        this.actor.show();
        this._place();

        if (!this._grab) {
            const grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
            if ((grab.get_seat_state() & Clutter.GrabState.KEYBOARD) === 0) {
                Main.popModal(grab);
                console.warn(LOG_PREFIX, 'spotlight could not grab the keyboard');
            } else {
                this._grab = grab;
            }
        }
        this._view.focus();

        this.actor.remove_all_transitions();
        this.actor.set_pivot_point(0.5, 0);
        this.actor.scale_x = this.actor.scale_y = 0.96;
        this.actor.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            duration: ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // Close, then run what the user picked (it may open windows that need the keyboard)
    close(then = null) {
        if (!this.isOpen)
            return;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this.actor.remove_all_transitions();
        this.actor.ease({
            opacity: 0,
            duration: ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => this.actor.hide(),
        });
        try {
            then?.();
        } catch (e) {
            console.error(LOG_PREFIX, 'spotlight action failed', e);
        }
    }

    // Light theme follows the notch's
    syncTheme() {
        if (this._theme?.isLight)
            this.actor.add_style_class_name('zorin-notch-light');
        else
            this.actor.remove_style_class_name('zorin-notch-light');
    }

    _place() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = Math.min(WIDTH * scale, monitor.width - 32 * scale);
        this.actor.set_width(width);
        this.actor.set_position(
            Math.round(monitor.x + (monitor.width - width) / 2),
            Math.round(monitor.y + monitor.height * TOP_RATIO));
    }

    _onEvent(event) {
        if (!this._grab)
            return Clutter.EVENT_PROPAGATE;
        const type = event.type();
        if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
            const [x, y] = event.get_coords();
            const target = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
            if (!this.actor.contains(target)) {
                this.close();
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._view.destroy();
        this.actor.destroy();
    }
}
