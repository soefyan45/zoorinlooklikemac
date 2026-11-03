// Magnification for the zorin-taskbar dock: icons under and near the pointer grow, like the
// macOS dock. zorin-taskbar has no such option, so this scales its icon actors from the
// outside. Only the scale of each icon changes (no layout, no settings): the dock's own size
// stays the same, and everything returns to scale 1 in destroy().
//
// The taskbar clips its icons to the dock, so icons grow around their center and the
// maximum scale is kept small enough to fit the dock's padding.
//
// It also draws the dock's glass background as a separate plate hugging the icons
// (zorin-notch-dock-plate). The taskbar itself stays as tall as its panel size, because it
// derives the icon size from it; the plate is only a few pixels larger than the icons, so
// the dock looks slim while icons and their click area keep their size. The taskbar's own
// background is made transparent by the dock preset.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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
const DOCK_STYLE_CLASS = 'zorin-notch-dock';
// Horizontal room around each icon. zorin-taskbar uses 4 px margin + 8 px padding per side;
// the vertical padding (which sets the icon size) is kept as is.
const DEFAULT_ICON_SPACING = 4;
// Room between the icons and the edge of the glass plate (vertical is 5/6 of horizontal)
const DEFAULT_PLATE_PADDING = 6;

// Pointer position as the shell's input sees it (follows virtual devices too)
function pointerPosition() {
    const seat = Clutter.get_default_backend().get_default_seat();
    const [, coords] = seat.query_state(seat.get_pointer(), null);
    return [coords.x, coords.y];
}

// Dock preferences of this extension -> zorin-taskbar settings. Written only when the user
// changes them in the preferences window, so the taskbar keeps any other configuration.
const TASKBAR_SCHEMA = 'org.gnome.shell.extensions.zorin-taskbar';
const AUTOHIDE_BEHAVIOUR = {
    'all-windows': 'ALL_WINDOWS',
    'focused-window': 'FOCUSED_WINDOWS',
    'maximized-window': 'MAXIMIZED_WINDOWS',
};

// zorin-taskbar applies a new size live only through panel-sizes (JSON per monitor);
// panel-size is just the fallback read when a panel is created. Write both.
function setPanelSizes(taskbar, size) {
    let sizes = {};
    let positions = {};
    try {
        sizes = JSON.parse(taskbar.get_string('panel-sizes') || '{}');
        positions = JSON.parse(taskbar.get_string('panel-positions') || '{}');
    } catch {}
    // Every monitor key the taskbar already knows, plus index 0 for the primary monitor
    for (const key of new Set([...Object.keys(sizes), ...Object.keys(positions), '0']))
        sizes[key] = size;
    taskbar.set_int('panel-size', size);
    taskbar.set_string('panel-sizes', JSON.stringify(sizes));
}

function taskbarSettings() {
    const schema = Gio.SettingsSchemaSource.get_default()?.lookup(TASKBAR_SCHEMA, true);
    return schema ? new Gio.Settings({settings_schema: schema}) : null;
}

export class DockZoom {
    /**
     * @param {Gio.Settings} settings - the extension's settings (dock-* keys)
     */
    constructor(settings = null, theme = null) {
        this._settings = settings;
        this._theme = theme;
        this._taskbarSettings = taskbarSettings();
        this._settings?.connectObject('changed', (_s, key) => this._onSettingsChanged(key), this);
        this._watched = new Set();
        this._styled = new Set();
        this._compacted = new Map(); // icon -> its original inline styles
        this._plates = new Map(); // panel -> glass plate behind its icons
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

    _onSettingsChanged(key) {
        const taskbar = this._taskbarSettings;
        switch (key) {
        case 'dock-autohide': {
            const mode = this._settings.get_string('dock-autohide');
            if (!taskbar)
                break;
            taskbar.set_boolean('intellihide', mode !== 'off');
            if (AUTOHIDE_BEHAVIOUR[mode])
                taskbar.set_string('intellihide-behaviour', AUTOHIDE_BEHAVIOUR[mode]);
            break;
        }
        case 'dock-size':
            if (taskbar)
                setPanelSizes(taskbar, this._settings.get_int('dock-size'));
            break;
        case 'dock-margin':
            taskbar?.set_int('panel-margin', this._settings.get_int('dock-margin'));
            break;
        case 'dock-zoom':
            if (!this._zoomEnabled)
                this._watched.forEach(({taskbar: t}) => this._reset(t));
            break;
        case 'dock-glass-opacity':
            this._plates.forEach(({plate}) => this._stylePlate(plate));
            break;
        case 'dock-icon-spacing':
            this._watched.forEach(({taskbar: t}) => this._compactAll(t, true));
            break;
        case 'dock-plate-padding':
            this._plates.forEach(({plate, taskbar: t, anchor}) => this._syncPlate(plate, t, anchor));
            break;
        }
    }

    // Horizontal room on each side of an icon
    get _iconSpacing() {
        return this._settings?.get_int('dock-icon-spacing') ?? DEFAULT_ICON_SPACING;
    }

    // [horizontal, vertical] room between the icons and the edge of the glass
    get _platePadding() {
        const x = this._settings?.get_int('dock-plate-padding') ?? DEFAULT_PLATE_PADDING;
        return [x, Math.max(2, Math.round(x * 5 / 6))];
    }

    get _zoomEnabled() {
        return this._settings?.get_boolean('dock-zoom') ?? true;
    }

    // Glass tint with the opacity from the preferences (the CSS class holds edge and radius)
    _stylePlate(plate) {
        const opacity = this._settings?.get_double('dock-glass-opacity') ?? 0.36;
        // Fully rounded ends whatever the plate height
        const radius = `border-radius: ${Math.round((plate.height || 34) / 2)}px;`;
        const glass = this._theme?.plateStyle(opacity) ??
            `background-gradient-start: rgba(36, 48, 68, ${opacity.toFixed(2)}); ` +
            `background-gradient-end: rgba(20, 30, 48, ${opacity.toFixed(2)});`;
        plate.set_style(radius + glass);
    }

    // Light or dark glass after a theme change
    onThemeChanged() {
        this._plates.forEach(({plate}) => this._stylePlate(plate));
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
            panel.add_style_class_name?.(DOCK_STYLE_CLASS);
            this._styled.add(panel);
            const taskbar = panel.taskbar;
            const target = taskbar?._scrollView;
            if (!target)
                continue;
            this._compactAll(taskbar);
            this._addPlate(panel, taskbar);
            taskbar._box?.connectObject('child-added', () => {
                // The taskbar styles a new icon while adding it; compact it afterwards
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._compactAll(taskbar);
                    return GLib.SOURCE_REMOVE;
                });
            }, this);
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

    _addPlate(panel, taskbar) {
        const anchor = panel.panelBox ?? panel;
        // The plate lives in uiGroup (stage coordinates), just below the dock's top-level
        // container, so it is drawn under the icons
        const uiGroup = Main.layoutManager.uiGroup;
        let top = anchor;
        while (top && top.get_parent() !== uiGroup)
            top = top.get_parent();
        if (!top || !taskbar._box)
            return;
        const plate = new St.Widget({style_class: 'zorin-notch-dock-plate', reactive: false});
        uiGroup.insert_child_below(plate, top);
        this._stylePlate(plate);
        // Auto hide slides the panel box out of the screen: the plate slides with it
        const binding = anchor.bind_property('translation-y', plate, 'translation-y',
            GObject.BindingFlags.SYNC_CREATE);
        this._plates.set(panel, {plate, binding, anchor, taskbar});

        const sync = () => this._syncPlate(plate, taskbar, anchor);
        // Icons coming and going resize the box; the dock re-centers by moving the panel
        taskbar._box.connectObject('notify::allocation', sync, 'notify::mapped', sync, this);
        panel.connectObject('notify::allocation', sync, this);
        anchor.connectObject('notify::allocation', sync, 'notify::visible', sync, this);
        sync();
    }

    _syncPlate(plate, taskbar, anchor) {
        const box = taskbar._box;
        if (!box?.mapped || !box.width || !anchor.visible) {
            plate.hide();
            return;
        }
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const [x, y] = box.get_transformed_position();
        const [w, h] = box.get_transformed_size();
        const iconSize = (taskbar.iconSize || 24) * scale;
        const [padX, padY] = this._platePadding;
        const height = Math.round(iconSize + 2 * padY * scale);
        // The box position includes the auto-hide slide, which the plate gets from its binding
        const baseY = y - anchor.translation_y;
        const resized = plate.height !== height;
        plate.set_position(Math.round(x - padX * scale), Math.round(baseY + (h - height) / 2));
        plate.set_size(Math.round(w + 2 * padX * scale), height);
        if (resized)
            this._stylePlate(plate);
        plate.show();
    }

    // Narrower dock: the spacing from the preferences instead of zorin-taskbar's 12 px per side.
    // force re-applies it to icons already done (the spacing changed).
    _compactAll(taskbar, force = false) {
        const spacing = this._iconSpacing;
        const margin = Math.min(1, spacing);
        for (const icon of this._icons(taskbar)) {
            const container = icon._iconContainer;
            if (!container || (this._compacted.has(icon) && !force))
                continue;
            if (!this._compacted.has(icon))
                this._compacted.set(icon, {icon: icon.get_style(), container: container.get_style()});
            const original = this._compacted.get(icon);
            const vertical = /padding:\s*([\d.]+)px/.exec(original.container ?? '')?.[1] ?? '8';
            icon.set_style(`padding: 0 ${margin}px;`);
            container.set_style(`padding: ${vertical}px ${spacing - margin}px;`);
        }
    }

    _magnify(taskbar, pointerX) {
        if (!this._zoomEnabled)
            return;
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
                taskbar._box?.disconnectObject(this);
                target.disconnectObject(this);
                for (const icon of this._icons(taskbar)) {
                    icon.remove_transition('scale-x');
                    icon.remove_transition('scale-y');
                    icon.set_scale(1, 1);
                }
            } catch {}
        }
        this._watched.clear();
        for (const [icon, original] of this._compacted) {
            try {
                icon.set_style(original.icon);
                icon._iconContainer?.set_style(original.container);
            } catch {}
        }
        this._compacted.clear();
        for (const [panel, {plate, binding, anchor}] of this._plates) {
            try {
                binding.unbind();
                panel.disconnectObject(this);
                anchor.disconnectObject(this);
            } catch {}
            plate.destroy();
        }
        this._plates.clear();
        for (const panel of this._styled) {
            try {
                panel.remove_style_class_name?.(DOCK_STYLE_CLASS);
            } catch {}
        }
        this._styled.clear();
    }

    destroy() {
        this._settings?.disconnectObject(this);
        this._taskbarSettings = null;
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
