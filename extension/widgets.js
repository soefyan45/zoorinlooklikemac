// Desktop widgets (Pego "Pilihan D · Widget desktop"): the calendar on the left and the weather on
// the right of the primary display, in the styles picked in Preferences > Widget or with a right
// click on a widget. By default they sit on the desktop, under the windows (above the desktop
// icons, so they can be clicked); "show above windows" puts them over everything instead.
// The calendar comes from GNOME's calendar server, the weather from Open-Meteo (weather.js).
// In the nested test session (dryRun) both use fixed sample data and nothing goes online.

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import GLib from 'gi://GLib';

import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {_} from './i18n.js';
import {LOG_PREFIX} from './log.js';
import {Weather} from './weather.js';
import {CALENDAR_CHOICES, WEATHER_CHOICES} from './widgetchoices.js';
import {CALENDAR_STYLES} from './widgets-calendar.js';
import {WEATHER_STYLES, weatherMessage} from './widgets-weather.js';
import {addDays, startOfDay, weekStart} from './widgetkit.js';

export {CALENDAR_CHOICES, WEATHER_CHOICES};

const MARGIN = 24;
const CALENDAR_APPS = ['org.gnome.Calendar.desktop', 'org.gnome.Evolution.desktop'];

// Fixed events for the nested test session
class SampleEvents {
    constructor() {
        const now = new Date();
        const at = (h, m = 0) => {
            const d = startOfDay(now);
            d.setHours(h, m);
            return d;
        };
        const soon = new Date(now.getTime() + 49 * 60000);
        this._events = [
            {id: '1', summary: 'Sprint 46', date: startOfDay(now), end: addDays(startOfDay(now), 1)},
            {id: '2', summary: 'Review desain notch', date: soon, end: new Date(soon.getTime() + 3600000)},
            {id: '3', summary: 'Kirim laporan Oktober', date: at(23, 30), end: at(23, 45)},
            {id: '4', summary: 'Nonton bareng rilis Zorin OS 18', date: addDays(at(20), 1), end: addDays(at(21, 30), 1)},
        ];
    }

    requestRange() {}

    getEvents(begin, end) {
        return this._events.filter(e => e.date < end && e.end > begin).sort((a, b) => a.date - b.date);
    }

    hasEvents(day) {
        return this.getEvents(startOfDay(day), addDays(startOfDay(day), 1)).length > 0;
    }

    destroy() {}
}

const SAMPLE_WEATHER = (() => {
    const now = GLib.DateTime.new_now_local();
    const iso = d => d.format('%Y-%m-%dT%H:00');
    const hours = [];
    for (let i = 0; i < 24; i++) {
        const t = now.add_hours(i);
        hours.push({time: iso(t), temp: 24 - Math.min(5, i), code: [2, 3, 51, 61, 61, 2][i % 6], rain: i === 2 ? 70 : 10,
            isDay: t.get_hour() >= 6 && t.get_hour() < 18});
    }
    const days = [0, 1, 2, 3, 4, 5].map(i => ({date: now.add_days(i).format('%Y-%m-%d'), code: [2, 61, 95, 0, 2, 3][i],
        max: [27, 26, 25, 28, 27, 26][i], min: [18, 18, 17, 18, 19, 18][i],
        sunrise: `${now.add_days(i).format('%Y-%m-%d')}T05:31`, sunset: `${now.add_days(i).format('%Y-%m-%d')}T17:48`, uv: 6}));
    return {place: 'Bandung', time: iso(now).replace(':00', `:${now.format('%M')}`), temp: 24, feels: 25, humidity: 82,
        wind: 9, code: 2, isDay: now.get_hour() >= 6 && now.get_hour() < 18, unit: '°C', hours, days,
        rain: {time: hours[2].time, chance: 70}};
})();

export class DesktopWidgets {
    /**
     * @param {Gio.Settings} settings
     * @param {object} options - {dryRun, openPreferences()}
     */
    constructor(settings, {dryRun = false, openPreferences = null} = {}) {
        this._settings = settings;
        this._dryRun = dryRun;
        this._openPreferences = openPreferences;
        this._state = {calendar: {}, weather: {}};
        this._menus = new PopupMenu.PopupMenuManager(Main.layoutManager.uiGroup);

        this._calendarBin = this._column('calendar');
        this._weatherBin = this._column('weather');
        this._columns = [this._calendarBin, this._weatherBin];
        this._onTop = null;

        this._events = dryRun ? new SampleEvents() : new Calendar.DBusEventSource();
        if (!dryRun)
            this._events.connectObject('changed', () => this._render(), this);
        this._weather = dryRun ? null : new Weather(settings, () => this._render());

        settings.connectObject(
            'changed::widget-weather', () => this._sync(),
            'changed::widget-calendar', () => this._sync(),
            'changed::widgets-on-top', () => this._sync(),
            'changed::weather-unit', () => this._render(), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._place(), this);
        global.display.connectObject('workareas-changed', () => this._place(),
            'restacked', () => this._restack(), this);
        Main.overview.connectObject('showing', () => this._syncVisible(), 'hidden', () => this._syncVisible(), this);
        // Relative times ("49 min left") and the date move on every minute
        this._minuteId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60, () => {
            this._render();
            return GLib.SOURCE_CONTINUE;
        });
        this._sync();
    }

    // A column: holds one widget, opens its style menu on a right click
    _column(kind) {
        const bin = new St.Bin({name: `zorinNotchWidget-${kind}`, reactive: true, x_align: Clutter.ActorAlign.START});
        bin.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                return Clutter.EVENT_PROPAGATE;
            this.openMenu(kind, bin);
            return Clutter.EVENT_STOP;
        });
        return bin;
    }

    get weatherStyle() {
        return this._settings.get_string('widget-weather');
    }

    get calendarStyle() {
        return this._settings.get_string('widget-calendar');
    }

    _sync() {
        const onTop = this._settings.get_boolean('widgets-on-top');
        if (onTop !== this._onTop) {
            this._detach();
            this._onTop = onTop;
            for (const column of this._columns) {
                if (onTop)
                    Main.layoutManager.addChrome(column, {affectsInputRegion: true, trackFullscreen: true});
                else
                    global.window_group.add_child(column);
            }
        }
        this._weather?.setActive(this.weatherStyle !== 'hidden');
        this._render();
        this._restack();
    }

    _detach() {
        for (const column of this._columns) {
            if (this._onTop)
                Main.layoutManager.removeChrome(column);
            else
                column.get_parent()?.remove_child(column);
        }
    }

    // On the desktop: just above the desktop icons' window (or the wallpaper), under every other
    // window. Mutter restacks its window actors on every stack change, so this runs again then.
    _restack() {
        if (this._onTop !== false)
            return;
        const group = global.window_group;
        const desktop = global.get_window_actors()
            .filter(actor => actor.meta_window?.get_window_type() === Meta.WindowType.DESKTOP).at(-1);
        const anchor = desktop?.get_parent() === group ? desktop : Main.layoutManager._backgroundGroup;
        for (const column of this._columns) {
            if (column.get_parent() === group && anchor?.get_parent() === group)
                group.set_child_above_sibling(column, anchor);
        }
    }

    _syncVisible() {
        // Above the windows they would cover the overview
        const visible = !(this._onTop && Main.overview.visible);
        this._calendarBin.visible = visible && this.calendarStyle !== 'hidden';
        this._weatherBin.visible = visible && this.weatherStyle !== 'hidden';
    }

    _calendarContext() {
        const now = new Date();
        const state = this._state.calendar;
        const month = new Date(now.getFullYear(), now.getMonth() + (state.monthOffset ?? 0), 1);
        const begin = addDays(weekStart(month), -7);
        this._events.requestRange(begin, addDays(begin, 56));
        return {
            now,
            state,
            events: (from, to) => this._events.getEvents(from, to),
            hasEvent: day => this._events.hasEvents(day),
            setState: patch => {
                Object.assign(state, patch);
                this._render();
            },
            openCalendar: () => this._openCalendar(),
            openMenu: actor => this.openMenu('calendar', actor),
        };
    }

    _render() {
        if (!this._columns)
            return;
        try {
            const calendar = this.calendarStyle;
            this._calendarBin.child = CALENDAR_STYLES[calendar]?.(this._calendarContext()) ?? null;
            const style = WEATHER_STYLES[this.weatherStyle];
            let weather = null;
            if (style) {
                const data = this._dryRun ? SAMPLE_WEATHER : this._weather.data;
                weather = data ? style(data, {openMenu: actor => this.openMenu('weather', actor)})
                    : weatherMessage(this._weather?.error ?? _('Loading the weather…'));
            }
            this._weatherBin.child = weather;
        } catch (e) {
            console.error(LOG_PREFIX, 'widgets not drawn', e);
        }
        this._syncVisible();
        this._place();
    }

    _place() {
        const layout = Main.layoutManager;
        const monitor = layout.primaryMonitor;
        if (!monitor)
            return;
        const area = layout.getWorkAreaForMonitor(layout.primaryIndex);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const margin = MARGIN * scale;
        this._calendarBin.set_position(area.x + margin, area.y + margin);
        const [, width] = this._weatherBin.get_preferred_width(-1);
        this._weatherBin.set_position(area.x + area.width - margin - width, area.y + margin);
    }

    _openCalendar() {
        if (this._dryRun) {
            console.log(LOG_PREFIX, 'dry-run: would open the calendar app');
            return;
        }
        const app = CALENDAR_APPS.map(id => Shell.AppSystem.get_default().lookup_app(id)).find(Boolean);
        app?.activate();
    }

    // The style menu of a widget (right click, or its "…" button)
    openMenu(kind, sourceActor) {
        this._menu?.destroy();
        const menu = new PopupMenu.PopupMenu(sourceActor, 0.5, St.Side.TOP);
        const key = kind === 'weather' ? 'widget-weather' : 'widget-calendar';
        const current = this._settings.get_string(key);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(kind === 'weather' ? _('Weather widget style') : _('Calendar widget style')));
        for (const [value, title] of kind === 'weather' ? WEATHER_CHOICES : CALENDAR_CHOICES) {
            const item = menu.addAction(_(title), () => this._settings.set_string(key, value));
            item.setOrnament(value === current ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction(_('Widget settings…'), () => this._openPreferences?.());
        Main.uiGroup.add_child(menu.actor);
        this._menus.addMenu(menu);
        menu.connect('open-state-changed', (_m, open) => {
            if (!open) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    if (this._menu === menu) {
                        menu.destroy();
                        this._menu = null;
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
        this._menu = menu;
        menu.open(true);
        return menu;
    }

    destroy() {
        if (this._minuteId)
            GLib.source_remove(this._minuteId);
        this._minuteId = 0;
        this._menu?.destroy();
        this._menu = null;
        this._settings.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.overview.disconnectObject(this);
        this._events.disconnectObject?.(this);
        this._events.destroy();
        this._weather?.destroy();
        this._detach();
        this._columns.forEach(column => column.destroy());
        this._columns = null;
    }
}

