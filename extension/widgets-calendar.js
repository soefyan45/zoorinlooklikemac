// The calendar widget's styles (Pego "Galeri · gaya widget kalender"): full (default, with the
// date and next-event tiles), agenda blocks, week arc, glass month, today's meetings, black and
// white, and tear-off. Events come from GNOME's calendar server (the same as the clock's menu:
// local calendars and online accounts such as Google).
// ctx: {now, events(begin, end), hasEvent(day), state, setState(patch), openCalendar(), openMenu(actor)}

import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {_} from './i18n.js';
import {C, EVENT_COLORS, RADIUS, WIDTH, addDays, box, button, drawing, fmt, hm, icon, isAllDay, rgbaOf,
    sameDay, spacer, startOfDay, text, weekStart} from './widgetkit.js';

const ACCENT = '#F05A24';

function card(style, children, vertical = true) {
    // The width includes padding and border (a CSS width would not)
    const actor = box({vertical, style: `border-radius: ${RADIUS}px; ` +
        `box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35); ${style}`}, children);
    actor.width = WIDTH;
    return actor;
}

const darkCard = `background-color: ${C.panel}; border: 1px solid ${C.edge}; padding: 16px; spacing: 10px;`;

function todayEvents(ctx) {
    const day = startOfDay(ctx.now);
    return ctx.events(day, addDays(day, 1));
}

// Timed events still to come today (or running now)
function upcoming(ctx) {
    return todayEvents(ctx).filter(e => !isAllDay(e) && e.end > ctx.now);
}

function timeRange(event) {
    return isAllDay(event) ? _('All day') : _('{0} to {1}', hm(event.date), hm(event.end));
}

function minutesUntil(ctx, event) {
    return Math.max(0, Math.round((event.date - ctx.now) / 60000));
}

function untilText(ctx, event) {
    const m = minutesUntil(ctx, event);
    if (event.date <= ctx.now)
        return _('now');
    return m < 60 ? _('{0} min left', m) : _('{0} h left', Math.round(m / 60));
}

function weekdayNames() {
    const monday = weekStart(new Date());
    return [0, 1, 2, 3, 4, 5, 6].map(i => fmt(addDays(monday, i), '%a'));
}

/**
 * A month as a grid of 6 weeks starting on Monday.
 * colors: {text, muted, todayBg, todayText, dot, header}, round: today as a circle or a square
 */
function monthGrid(ctx, month, colors, {cell = 38, round = true, caps = false} = {}) {
    const grid = box({vertical: true, style: 'spacing: 2px;'});
    const header = box();
    header.layout_manager.homogeneous = true;
    for (const name of weekdayNames()) {
        header.add_child(text(caps ? name.toUpperCase() : name, `color: ${colors.header}; font-size: ${caps ? 10 : 11}px; ` +
            `font-weight: 600; text-align: center;${caps ? '' : ''}`, {x_expand: true}));
    }
    grid.add_child(header);
    let day = weekStart(new Date(month.getFullYear(), month.getMonth(), 1));
    for (let week = 0; week < 6; week++) {
        const row = box();
        row.layout_manager.homogeneous = true;
        for (let i = 0; i < 7; i++, day = addDays(day, 1)) {
            const inMonth = day.getMonth() === month.getMonth();
            const isToday = sameDay(day, ctx.now);
            const number = text(day.getDate(), `color: ${isToday ? colors.todayText : inMonth ? colors.text : colors.muted}; ` +
                `font-size: 13px; font-weight: ${isToday ? 700 : 500}; text-align: center;`, {x_align: Clutter.ActorAlign.CENTER});
            const face = new St.Bin({child: number, x_align: Clutter.ActorAlign.CENTER,
                style: `width: 28px; height: 28px; border-radius: ${round ? 999 : 8}px;` +
                    (isToday ? ` background-color: ${colors.todayBg};` : '')});
            const dot = new St.Widget({style: `width: 4px; height: 4px; border-radius: 2px; background-color: ` +
                `${inMonth && ctx.hasEvent(day) && !isToday ? colors.dot : 'transparent'};`,
            x_align: Clutter.ActorAlign.CENTER});
            row.add_child(box({vertical: true, expand: true, style: `height: ${cell}px; spacing: 1px;`}, [face, dot]));
        }
        grid.add_child(row);
    }
    return grid;
}

function navButton(iconName, color, onClick) {
    return button(icon(iconName, 14, color), onClick, 'padding: 4px; border-radius: 999px;');
}

function shownMonth(ctx) {
    const month = new Date(ctx.now.getFullYear(), ctx.now.getMonth() + (ctx.state.monthOffset ?? 0), 1);
    return month;
}

function eventRow(event, index, colors) {
    return box({style: `background-color: ${colors.tile}; border-radius: 8px; padding: 8px 10px; spacing: 10px;`}, [
        new St.Widget({style: `width: 3px; border-radius: 2px; background-color: ${EVENT_COLORS[index % EVENT_COLORS.length]};`,
            y_expand: true}),
        box({vertical: true, expand: true, style: 'spacing: 2px;'}, [
            text(event.summary, `color: ${colors.text}; font-size: 13px; font-weight: 700;`),
            text(timeRange(event), `color: ${colors.muted}; font-size: 11px;`),
        ]),
    ]);
}

// The two small tiles above the full calendar: today's date and the next event
function smallTiles(ctx) {
    const tile = children => {
        const actor = box({vertical: true, style: `border-radius: ${RADIUS}px; ` +
            `background-color: ${C.panel}; border: 1px solid ${C.edge}; padding: 14px; spacing: 2px; ` +
            'box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);'}, children);
        actor.set_size((WIDTH - 16) / 2, (WIDTH - 16) / 2);
        return actor;
    };
    const events = todayEvents(ctx);
    const date = tile([
        text(fmt(ctx.now, '%A').toUpperCase(), `color: ${ACCENT}; font-size: 11px; font-weight: 800;`),
        text(ctx.now.getDate(), `color: ${C.text}; font-size: 40px; font-weight: 800;`),
        spacer(),
        text(fmt(ctx.now, '%B %Y'), `color: ${C.text}; font-size: 13px; font-weight: 700;`),
        text(_('{0} events today', events.length), `color: ${C.label}; font-size: 11px;`),
    ]);
    const next = upcoming(ctx)[0];
    const nextTile = next ? tile([
        box({style: 'spacing: 6px;'}, [icon('alarm-symbolic', 14, ACCENT),
            text(_('Next'), `color: ${C.label}; font-size: 12px; font-weight: 600;`)]),
        spacer(),
        box({style: 'spacing: 6px;'}, [
            text(next.date <= ctx.now ? _('Now') : minutesUntil(ctx, next) < 60 ? minutesUntil(ctx, next)
                : hm(next.date), `color: ${C.text}; font-size: 30px; font-weight: 800;`),
            next.date > ctx.now && minutesUntil(ctx, next) < 60
                ? text(_('min left'), `color: ${C.label}; font-size: 12px;`, {y_align: Clutter.ActorAlign.END}) : null,
        ]),
        spacer(),
        text(next.summary, `color: ${C.text}; font-size: 13px; font-weight: 700;`),
        text(timeRange(next), `color: ${C.label}; font-size: 11px;`),
    ]) : tile([
        box({style: 'spacing: 6px;'}, [icon('alarm-symbolic', 14, ACCENT),
            text(_('Next'), `color: ${C.label}; font-size: 12px; font-weight: 600;`)]),
        spacer(),
        text(_('Nothing else today'), `color: ${C.text}; font-size: 14px; font-weight: 700;`, {}),
        spacer(),
    ]);
    nextTile.reactive = true;
    return box({style: 'spacing: 16px;'}, [date, nextTile]);
}

export function calendarFull(ctx) {
    const month = shownMonth(ctx);
    const week = GLib.DateTime.new_from_unix_local(Math.floor(ctx.now.getTime() / 1000)).get_week_of_year();
    const head = box({style: 'padding: 0 4px;'}, [
        box({vertical: true, expand: true, style: 'spacing: 2px;'}, [
            text(fmt(month, '%B').toUpperCase(), `color: ${ACCENT}; font-size: 11px; font-weight: 800;`),
            text(`${month.getFullYear()} · ${_('week {0}', week)}`, `color: ${C.text}; font-size: 15px; font-weight: 700;`),
        ]),
        navButton('go-previous-symbolic', C.label, () => ctx.setState({monthOffset: (ctx.state.monthOffset ?? 0) - 1})),
        navButton('go-next-symbolic', C.label, () => ctx.setState({monthOffset: (ctx.state.monthOffset ?? 0) + 1})),
    ]);
    const grid = monthGrid(ctx, month, {text: C.text, muted: 'rgba(255, 255, 255, 0.4)', todayBg: ACCENT,
        todayText: '#FFFFFF', dot: C.text, header: C.label});
    const events = todayEvents(ctx);
    const list = box({vertical: true, style: `border-top: 1px solid ${C.edge}; padding-top: 10px; spacing: 6px;`}, [
        box({style: 'padding: 0 4px;'}, [
            text(_('Today'), `color: ${C.text}; font-size: 13px; font-weight: 700;`),
            spacer(),
            text(_('{0} events', events.length), `color: ${C.label}; font-size: 11px;`),
        ]),
        ...(events.length ? events.slice(0, 3).map((e, i) => eventRow(e, i, {tile: C.tile, text: C.text, muted: C.label}))
            : [text(_('No events today'), `color: ${C.label}; font-size: 12px; padding: 4px;`)]),
    ]);
    const calendar = card(darkCard, [head, grid, list]);
    return box({vertical: true, style: 'spacing: 16px;'}, [smallTiles(ctx), calendar]);
}

export function calendarAgenda(ctx) {
    const events = todayEvents(ctx);
    const allDay = events.filter(isAllDay);
    const timed = events.filter(e => !isAllDay(e));
    const next = timed.find(e => e.end > ctx.now);
    const left = box({vertical: true, style: 'width: 92px; spacing: 0;', yAlign: Clutter.ActorAlign.CENTER}, [
        text(fmt(ctx.now, '%b').toUpperCase(), `color: ${C.inkMuted}; font-size: 15px; font-weight: 600; text-align: center;`,
            {x_align: Clutter.ActorAlign.CENTER}),
        text(ctx.now.getDate(), `color: ${C.ink}; font-size: 50px; font-weight: 600;`, {x_align: Clutter.ActorAlign.CENTER}),
        text(fmt(ctx.now, '%A'), `color: ${C.inkMuted}; font-size: 13px;`, {x_align: Clutter.ActorAlign.CENTER}),
    ]);
    const right = box({vertical: true, expand: true, style: 'spacing: 8px;'}, [
        ...allDay.slice(0, 1).map(e => box({style: `background-color: ${C.ink}; border-radius: 999px; padding: 6px 12px; spacing: 6px;`}, [
            icon('flag-symbolic', 12, '#FFFFFF'),
            text(`${e.summary} · ${_('all day')}`, 'color: #FFFFFF; font-size: 12px; font-weight: 700;', {x_expand: true}),
        ])),
        ...timed.slice(0, 3).map(e => box({vertical: true, style: `border-radius: 12px; padding: 10px 12px; spacing: 2px; ` +
            (e === next ? `background-color: ${C.paper}; border: 2px solid ${C.ink};` : `background-color: ${C.block};`)}, [
            text(e.summary, `color: ${C.ink}; font-size: 13px; font-weight: 700;`),
            text(timeRange(e), `color: ${C.inkMuted}; font-size: 11px;`),
        ])),
        events.length ? null : text(_('No events today'), `color: ${C.inkMuted}; font-size: 13px;`, {y_expand: true}),
    ]);
    return card(`background-color: ${C.paper}; padding: 14px; spacing: 10px;`, [left, right], false);
}

// Seven days on a curve, today raised in a ring (drawn: St cannot place text along a curve)
function weekArc(ctx) {
    const monday = weekStart(ctx.now);
    const names = weekdayNames();
    return drawing(WIDTH - 32, 112, (cr, w, h) => {
        cr.selectFontFace('Inter', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        const y = i => 30 + 34 * ((i - 3) / 3) ** 2;
        // The band under the days
        cr.moveTo(0, h);
        for (let x = 0; x <= w; x += 4) {
            const t = x / w * 6;
            cr.lineTo(x, y(t) + 40);
        }
        cr.lineTo(w, h);
        cr.closePath();
        cr.setSourceRGBA(1, 1, 1, 0.1);
        cr.fill();
        for (let i = 0; i < 7; i++) {
            const day = addDays(monday, i);
            const x = (i + 0.5) / 7 * w;
            const cy = y(i) + 26;
            const isToday = sameDay(day, ctx.now);
            const past = day < startOfDay(ctx.now);
            cr.setFontSize(11);
            const name = names[i];
            let ext = cr.textExtents(name);
            cr.setSourceRGBA(1, 1, 1, past || i > 4 ? 0.55 : 0.9);
            cr.moveTo(x - ext.xAdvance / 2, cy - 18);
            cr.showText(name);
            if (isToday) {
                cr.arc(x, cy, 15, 0, 2 * Math.PI);
                cr.setSourceRGBA(...rgbaOf(C.today));
                cr.fillPreserve();
                cr.setSourceRGBA(1, 1, 1, 0.35);
                cr.setLineWidth(2);
                cr.stroke();
            }
            cr.setFontSize(isToday ? 14 : 15);
            const number = `${day.getDate()}`;
            ext = cr.textExtents(number);
            cr.setSourceRGBA(1, 1, 1, past && !isToday ? 0.55 : 1);
            cr.moveTo(x - ext.xAdvance / 2, cy + 5);
            cr.showText(number);
            if (ctx.hasEvent(day)) {
                cr.arc(x, cy + 21, 2, 0, 2 * Math.PI);
                cr.setSourceRGBA(...(isToday ? rgbaOf(ACCENT) : [1, 1, 1, 0.9]));
                cr.fill();
            }
        }
    });
}

export function calendarWeekArc(ctx) {
    const view = ctx.state.view ?? 'week';
    const segment = (name, label) => button(text(label, `color: ${view === name ? C.ink : C.text}; font-size: 13px; font-weight: 600;`),
        () => ctx.setState({view: name}),
        `padding: 5px 14px; border-radius: 999px;${view === name ? ' background-color: #FFFFFF;' : ''}`);
    const add = button(icon('list-add-symbolic', 16, C.text), () => ctx.openCalendar(),
        'background-color: rgba(255, 255, 255, 0.15); border-radius: 999px; padding: 6px;');
    const top = box({style: 'spacing: 6px;'}, [
        box({style: 'background-color: rgba(255, 255, 255, 0.15); border-radius: 999px; padding: 3px;'}, [
            segment('week', _('Week')), segment('month', _('Month')),
        ]),
        spacer(),
        add,
    ]);
    const title = box({style: 'padding-top: 6px;'}, [
        text(fmt(ctx.now, '%B'), `color: ${C.text}; font-size: 30px; font-weight: 800;`),
        spacer(),
        text(ctx.now.getDate(), `color: ${C.text}; font-size: 30px; font-weight: 800;`),
    ]);
    const body = view === 'week' ? weekArc(ctx)
        : monthGrid(ctx, shownMonth(ctx), {text: C.text, muted: 'rgba(255, 255, 255, 0.4)', todayBg: C.today,
            todayText: '#FFFFFF', dot: C.text, header: C.label}, {cell: 34});
    const foot = box({style: `border-top: 1px solid rgba(255, 255, 255, 0.15); padding-top: 10px;`}, [
        button(box({style: 'spacing: 6px;'}, [icon('alarm-symbolic', 14, C.text),
            text(_('Add reminder'), `color: ${C.text}; font-size: 12px; font-weight: 600;`)]), () => ctx.openCalendar(),
        'padding: 4px;'),
        spacer(),
        button(box({style: 'spacing: 6px;'}, [icon('list-add-symbolic', 14, C.text),
            text(_('New event'), `color: ${C.text}; font-size: 12px; font-weight: 700;`)]), () => ctx.openCalendar(),
        'background-color: rgba(255, 255, 255, 0.18); border-radius: 999px; padding: 6px 12px;'),
    ]);
    return card(`background-gradient-direction: vertical; background-gradient-start: ${C.slateTop}; ` +
        `background-gradient-end: ${C.slateBottom}; border: 1px solid ${C.edge}; padding: 16px; spacing: 8px;`,
    [top, title, body, foot]);
}

export function calendarGlassMonth(ctx) {
    const month = shownMonth(ctx);
    const head = box({style: 'padding: 0 2px 4px 2px;'}, [
        navButton('go-previous-symbolic', C.ink, () => ctx.setState({monthOffset: (ctx.state.monthOffset ?? 0) - 1})),
        spacer(),
        text(fmt(month, '%B %Y'), `color: ${C.ink}; font-size: 15px; font-weight: 600;`),
        spacer(),
        navButton('go-next-symbolic', C.ink, () => ctx.setState({monthOffset: (ctx.state.monthOffset ?? 0) + 1})),
    ]);
    const grid = monthGrid(ctx, month, {text: C.ink, muted: 'rgba(36, 34, 28, 0.4)', todayBg: C.today,
        todayText: '#FFFFFF', dot: C.inkMuted, header: C.inkMuted}, {round: false, caps: true});
    return card(`background-color: ${C.frost}; border: 1px solid rgba(255, 255, 255, 0.55); padding: 14px; spacing: 6px;`,
        [head, grid]);
}

export function calendarMeetings(ctx) {
    const head = box({style: `background-color: ${ACCENT}; border-radius: ${RADIUS}px ${RADIUS}px 0 0; padding: 12px;`}, [
        spacer(),
        text(fmt(ctx.now, '%B %Y'), 'color: #FFFFFF; font-size: 16px; font-weight: 700;'),
        icon('pan-down-symbolic', 14, '#FFFFFF', {style: 'color: #FFFFFF; padding-left: 4px;'}),
        spacer(),
    ]);
    const monday = weekStart(ctx.now);
    const days = box({style: 'spacing: 0;', expand: true});
    days.layout_manager.homogeneous = true;
    for (let i = 0; i < 5; i++) {
        const day = addDays(monday, i);
        const isToday = sameDay(day, ctx.now);
        days.add_child(box({vertical: true, expand: true, style: 'spacing: 4px;'}, [
            text(fmt(day, '%a').toUpperCase(), `color: ${isToday ? C.ink : C.inkMuted}; font-size: 10px; ` +
                `font-weight: ${isToday ? 800 : 500};`, {x_align: Clutter.ActorAlign.CENTER}),
            new St.Bin({x_align: Clutter.ActorAlign.CENTER, style: `width: 30px; height: 30px; border-radius: 999px;` +
                (isToday ? ` background-color: ${ACCENT};` : ''),
            child: text(day.getDate(), `color: ${isToday ? '#FFFFFF' : C.ink}; font-size: 15px; font-weight: 700;`)}),
        ]));
    }
    const week = box({style: 'padding: 10px 8px 4px 8px;'}, [
        icon('go-previous-symbolic', 12, C.inkMuted, {y_align: Clutter.ActorAlign.CENTER}), days,
        icon('go-next-symbolic', 12, C.inkMuted, {y_align: Clutter.ActorAlign.CENTER}),
    ]);
    const events = todayEvents(ctx).slice(0, 3);
    const next = upcoming(ctx)[0];
    const rows = box({vertical: true, style: 'padding: 6px 12px 14px 12px; spacing: 10px;'},
        events.length ? events.map((e, i) => box({style: 'spacing: 10px;'}, [
            new St.Bin({style: 'width: 36px; height: 36px; border-radius: 999px; background-color: rgba(240, 90, 36, 0.12);',
                child: icon(isAllDay(e) ? 'flag-symbolic' : 'x-office-calendar-symbolic', 16, ACCENT)}),
            box({vertical: true, expand: true, style: 'spacing: 2px;'}, [
                text(e.summary, `color: ${C.ink}; font-size: 13px; font-weight: 700;`),
                text(timeRange(e), `color: ${C.inkMuted}; font-size: 11px;`),
            ]),
            button(text(_('Open'), `color: ${e === next ? ACCENT : C.ink}; font-size: 11px; font-weight: 700;`),
                () => ctx.openCalendar(), `border-radius: 8px; padding: 5px 10px; background-color: ` +
                `${e === next ? C.block : 'rgba(36, 34, 28, 0.08)'};`, {y_align: Clutter.ActorAlign.CENTER}),
        ])) : [text(_('No events today'), `color: ${C.inkMuted}; font-size: 13px; padding: 8px 4px;`)]);
    return card(`background-color: ${C.paper};`, [head, week, rows]);
}

export function calendarMono(ctx) {
    const list = upcoming(ctx);
    const [next, after] = list;
    const add = button(icon('list-add-symbolic', 16, '#FFFFFF'), () => ctx.openCalendar(),
        'background-color: rgba(255, 255, 255, 0.14); border-radius: 999px; padding: 7px;');
    const top = box({}, [
        text(fmt(ctx.now, '%a %-d'), 'color: #FFFFFF; font-size: 26px; font-weight: 800;'),
        spacer(),
        add,
    ]);
    if (!next) {
        return card(`background-color: ${C.black}; padding: 18px; spacing: 14px;`, [top,
            text(_('Nothing else today'), 'color: rgba(255, 255, 255, 0.7); font-size: 14px;')]);
    }
    const chips = box({style: 'spacing: 6px;'}, [
        text(_('Next'), `color: ${C.black}; background-color: #FFFFFF; border-radius: 6px; padding: 3px 8px; ` +
            'font-size: 11px; font-weight: 700;'),
        text(untilText(ctx, next), 'color: #FFFFFF; background-color: rgba(255, 255, 255, 0.16); border-radius: 6px; ' +
            'padding: 3px 8px; font-size: 11px; font-weight: 700;'),
    ]);
    const event = box({style: 'spacing: 10px;'}, [
        new St.Widget({style: 'width: 3px; background-color: #FFFFFF; border-radius: 2px;', y_expand: true}),
        box({vertical: true, expand: true, style: 'spacing: 2px;'}, [
            text(next.summary, 'color: #FFFFFF; font-size: 15px; font-weight: 800;'),
            text(timeRange(next), 'color: rgba(255, 255, 255, 0.7); font-size: 12px;'),
        ]),
        button(box({style: 'spacing: 6px;'}, [icon('x-office-calendar-symbolic', 14, C.black),
            text(_('Open'), `color: ${C.black}; font-size: 12px; font-weight: 700;`)]), () => ctx.openCalendar(),
        'background-color: #FFFFFF; border-radius: 8px; padding: 7px 12px;', {y_align: Clutter.ActorAlign.CENTER}),
    ]);
    const then = after ? box({style: 'border-top: 1px solid rgba(255, 255, 255, 0.14); padding-top: 10px;'}, [
        text(_('Then: {0}', after.summary), 'color: rgba(255, 255, 255, 0.7); font-size: 12px;', {x_expand: true}),
        text(hm(after.date), 'color: #FFFFFF; font-size: 12px; font-weight: 700;'),
    ]) : null;
    return card(`background-color: ${C.black}; padding: 18px; spacing: 12px;`, [top, chips, event, then]);
}

export function calendarTearOff(ctx) {
    const events = todayEvents(ctx).slice(0, 3);
    const head = new St.Bin({style: `background-color: ${ACCENT}; border-radius: ${RADIUS}px ${RADIUS}px 0 0; padding: 8px;`,
        x_expand: true, child: text(ctx.now.getFullYear(), 'color: #FFFFFF; font-size: 18px; font-weight: 800;')});
    const left = box({vertical: true, style: 'width: 110px;', yAlign: Clutter.ActorAlign.CENTER}, [
        text(ctx.now.getDate(), `color: ${C.ink}; font-size: 52px; font-weight: 800;`, {x_align: Clutter.ActorAlign.CENTER}),
        text(fmt(ctx.now, '%B'), `color: ${C.inkMuted}; font-size: 13px;`, {x_align: Clutter.ActorAlign.CENTER}),
    ]);
    const right = box({vertical: true, expand: true, style: `border-left: 1px solid rgba(36, 34, 28, 0.15); ` +
        'padding-left: 14px; spacing: 10px;', yAlign: Clutter.ActorAlign.CENTER},
    events.length ? events.map((e, i) => box({style: 'spacing: 8px;'}, [
        new St.Widget({style: `width: 7px; height: 7px; border-radius: 4px; margin-top: 5px; ` +
            `background-color: ${EVENT_COLORS[i % EVENT_COLORS.length]};`, y_align: Clutter.ActorAlign.START}),
        box({vertical: true, expand: true, style: 'spacing: 1px;'}, [
            text(e.summary, `color: ${C.ink}; font-size: 12px; font-weight: 700;`),
            text(timeRange(e), `color: ${C.inkMuted}; font-size: 10px;`),
        ]),
    ])) : [text(_('No events today'), `color: ${C.inkMuted}; font-size: 12px;`)]);
    return card(`background-color: ${C.paper};`, [head,
        box({style: 'padding: 16px 16px 18px 8px;'}, [left, right])]);
}

export const CALENDAR_STYLES = {
    'full': calendarFull,
    'agenda': calendarAgenda,
    'week-arc': calendarWeekArc,
    'glass-month': calendarGlassMonth,
    'meetings': calendarMeetings,
    'mono': calendarMono,
    'tear-off': calendarTearOff,
};
