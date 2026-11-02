// Magnification for the zorin-taskbar dock: icons under and near the pointer grow, like the
// macOS dock. zorin-taskbar has no such option, so this scales its icon actors from the
// outside. Only the scale of each icon changes (no layout, no settings): the dock's own size
// stays the same, and everything returns to scale 1 in destroy().
//
// The taskbar clips its icons to the dock, so icons grow around their center and the
// maximum scale is kept small enough to fit the dock's padding.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';

import {LOG_PREFIX, trace} from './log.js';

const MAX_SCALE = 1.32;
// Distance (in icon widths) over which the magnification fades out to the neighbors
const RANGE_ICONS = 2.2;
const EASE_MS = 90;
// While icons are magnified, check that the pointer is still over the dock: a leave event is
// not always delivered when the pointer exits through a child icon
const WATCH_MS = 60;
const WAIT_MS = 500;
const WAIT_TRIES = 60;

// Pointer position as the shell's input sees it (follows virtual devices too)
function pointerPosition() {
    const seat = Clutter.get_default_backend().get_default_seat();
    const [, coords] = seat.query_state(seat.get_pointer(), null);
    return [coords.x, coords.y];
}

export class DockZoom {
    constructor() {
        this._watched = new Set();
        this._emitter = null;
        this._waitId = 0;
        // zorin-taskbar may be enabled after us at login; wait for it
        if (!this._connect()) {
            let tries = 0;
            this._waitId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WAIT_MS, () => {
                if (this._connect())
                    return this._stopWaiting();
                if (++tries < WAIT_TRIES)
                    return GLib.SOURCE_CONTINUE;
                console.warn(LOG_PREFIX, 'zorin-taskbar not found, dock zoom disabled');
                return this._stopWaiting();
            });
        }
    }

    _stopWaiting() {
        this._waitId = 0;
        return GLib.SOURCE_REMOVE;
    }

    _connect() {
        this._emitter = global.zorinTaskbar ?? null;
        if (!this._emitter)
            return false;
        // Panels are rebuilt when the taskbar settings or monitors change
        this._panelsId = this._emitter.connect('panels-created', () => this._attach());
        this._attach();
        return true;
    }

    _attach() {
        this._detach();
        for (const panel of this._emitter.panels ?? []) {
            const taskbar = panel.taskbar;
            const target = taskbar?._scrollView;
            if (!target)
                continue;
            target.reactive = true;
            target.connectObject(
                'motion-event', (_actor, event) => {
                    this._magnify(taskbar, event.get_coords()[0]);
                    return Clutter.EVENT_PROPAGATE;
                },
                'leave-event', () => {
                    this._reset(taskbar);
                    return Clutter.EVENT_PROPAGATE;
                },
                this);
            this._watched.add({taskbar, target});
        }
        trace(`dock zoom on ${this._watched.size} taskbar(s)`);
    }

    _icons(taskbar) {
        try {
            const containers = taskbar._getTaskbarIcons?.() ?? taskbar._box?.get_children() ?? [];
            return containers.map(c => c.child).filter(Boolean);
        } catch {
            return [];
        }
    }

    _magnify(taskbar, pointerX) {
        trace(`dock zoom: motion x=${Math.round(pointerX)} seat=${pointerPosition().map(Math.round)}`);
        this._watch(taskbar);
        for (const icon of this._icons(taskbar)) {
            const [x] = icon.get_transformed_position();
            const width = icon.get_transformed_size()[0] / (icon.scale_x || 1);
            if (!width)
                continue;
            const center = x + icon.get_transformed_size()[0] / 2;
            const distance = Math.abs(pointerX - center) / (width * RANGE_ICONS);
            // Smooth cosine falloff: full size under the pointer, 1 at the edge of the range
            const t = distance < 1 ? (1 + Math.cos(Math.PI * distance)) / 2 : 0;
            this._scale(icon, 1 + (MAX_SCALE - 1) * t);
        }
    }

    _scale(icon, scale) {
        if (Math.abs(icon.scale_x - scale) < 0.005)
            return;
        icon.pivot_point = new Graphene.Point({x: 0.5, y: 0.5});
        icon.ease({
            scale_x: scale,
            scale_y: scale,
            duration: EASE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _watch(taskbar) {
        // The self test drives _magnify with a virtual pointer the seat does not report
        if (this._watchId || this.noWatch)
            return;
        this._watchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WATCH_MS, () => {
            const target = taskbar._scrollView;
            let inside = false;
            try {
                const [px, py] = pointerPosition();
                const [x, y] = target.get_transformed_position();
                const [w, h] = target.get_transformed_size();
                inside = px >= x && px <= x + w && py >= y && py <= y + h;
            } catch {}
            if (inside)
                return GLib.SOURCE_CONTINUE;
            trace('dock zoom: pointer left the dock');
            this._watchId = 0;
            this._reset(taskbar);
            return GLib.SOURCE_REMOVE;
        });
    }

    _reset(taskbar) {
        for (const icon of this._icons(taskbar))
            this._scale(icon, 1);
    }

    _detach() {
        if (this._watchId) {
            GLib.source_remove(this._watchId);
            this._watchId = 0;
        }
        for (const {taskbar, target} of this._watched) {
            // The taskbar may already be gone when its panels were rebuilt
            try {
                target.disconnectObject(this);
                for (const icon of this._icons(taskbar)) {
                    icon.remove_transition('scale-x');
                    icon.remove_transition('scale-y');
                    icon.set_scale(1, 1);
                }
            } catch {}
        }
        this._watched.clear();
    }

    destroy() {
        if (this._waitId) {
            GLib.source_remove(this._waitId);
            this._waitId = 0;
        }
        if (this._panelsId)
            this._emitter.disconnect(this._panelsId);
        this._panelsId = 0;
        this._detach();
    }
}
