// Tray icons (app indicators such as Claude or Tilix, keyboard layout, screen recording) live
// in the panel's right box, which zorin-taskbar shows in the dock. While the notch is enabled
// they are moved into the tray row of the full panel (06) and put back, at their original
// place, when it is disabled. The indicators keep their own menus; only their parent changes.

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {LOG_PREFIX, trace} from './log.js';

export class TrayBridge {
    /**
     * @param {St.BoxLayout} row - the tray row in the full panel
     * @param {Function} onChange - called when icons come, go or change visibility
     */
    constructor(row, onChange) {
        this._row = row;
        this._onChange = onChange;
        this._moved = new Map(); // container -> index in the right box
        this._idleId = 0;

        this._box = Main.panel._rightBox ?? null;
        if (!this._box) {
            console.warn(LOG_PREFIX, 'panel right box not found, tray stays in the dock');
            return;
        }
        this._box.connectObject('child-added', () => this._queueMove(), this);
        this._moveAll();
    }

    // Indicators added later (an app starting) are moved on the next idle, after the panel
    // has finished adding them
    _queueMove() {
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._idleId = 0;
            this._moveAll();
            return GLib.SOURCE_REMOVE;
        });
    }

    _moveAll() {
        const children = this._box.get_children();
        children.forEach((container, index) => {
            if (this._moved.has(container))
                return;
            this._moved.set(container, index);
            this._box.remove_child(container);
            this._row.add_child(container);
            container.connectObject(
                'notify::visible', () => this._onChange(),
                'destroy', () => {
                    this._moved.delete(container);
                    this._onChange();
                },
                this);
            trace(`tray: moved ${container.child?.constructor?.name ?? 'indicator'} into the notch`);
        });
        this._onChange();
    }

    get hasVisibleIcons() {
        return [...this._moved.keys()].some(container => container.visible);
    }

    // Open indicator menus would point at a notch that is closing
    closeMenus() {
        for (const container of this._moved.keys())
            container.child?.menu?.close?.();
    }

    destroy() {
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        this.closeMenus();
        this._box?.disconnectObject(this);

        // Back to the right box, in their original order
        const entries = [...this._moved.entries()].sort((a, b) => a[1] - b[1]);
        for (const [container, index] of entries) {
            container.disconnectObject(this);
            if (container.get_parent() === this._row)
                this._row.remove_child(container);
            if (this._box && !container.get_parent())
                this._box.insert_child_at_index(container, Math.min(index, this._box.get_n_children()));
        }
        this._moved.clear();
    }
}
