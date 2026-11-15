// The weather widget's styles (Pego "Galeri · gaya widget cuaca"): full (default), sun arc, big
// temperature and date strip. Each takes the shaped weather from weather.js and returns an actor
// WIDTH wide. actions: {openMenu(actor)}

import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import St from 'gi://St';

import {_} from './i18n.js';
import {describe, hourText} from './weather.js';
import {C, RADIUS, WIDTH, addDays, box, button, drawing, fmt, icon, rgbaOf, spacer, startOfDay, text} from './widgetkit.js';

const TONE = {sun: C.sun, rain: C.rain, cloud: C.text};
const deg = t => `${Math.round(t)}°`;

function card(style, children, vertical = true) {
    // The width includes padding and border (a CSS width would not)
    const actor = box({vertical, style: `border-radius: ${RADIUS}px; ` +
        `box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35); ${style}`}, children);
    actor.width = WIDTH;
    return actor;
}

const darkCard = `background-color: ${C.panel}; border: 1px solid ${C.edge}; padding: 16px; spacing: 12px;`;

// Without weather: what is missing, in the style's frame
export function weatherMessage(message) {
    return card(darkCard, [
        box({style: 'spacing: 8px;'}, [
            icon('weather-overcast-symbolic', 20, C.label),
            text(_('Weather'), `color: ${C.text}; font-size: 14px; font-weight: 700;`),
        ]),
        text(message, `color: ${C.label}; font-size: 12px;`, {}),
    ]);
}

function dayName(date, index) {
    return index === 0 ? _('Today') : fmt(new Date(`${date}T12:00`), '%a');
}

// The low-high range of a day on the week's scale
function rangeBar(width, low, high, weekLow, weekHigh) {
    return drawing(width, 4, (cr, w, h) => {
        const span = Math.max(1, weekHigh - weekLow);
        cr.setSourceRGBA(1, 1, 1, 0.12);
        cr.rectangle(0, 0, w, h);
        cr.fill();
        const x0 = (low - weekLow) / span * w;
        const x1 = (high - weekLow) / span * w;
        const gradient = new Cairo.LinearGradient(0, 0, w, 0);
        gradient.addColorStopRGBA(0, ...rgbaOf(C.rain));
        gradient.addColorStopRGBA(1, ...rgbaOf(C.sun));
        cr.setSource(gradient);
        cr.rectangle(x0, 0, Math.max(h, x1 - x0), h);
        cr.fill();
    });
}

export function weatherFull(w, actions) {
    const now = describe(w.code, w.isDay);
    const today = w.days[0];
    const place = box({style: 'spacing: 4px;'}, [
        text(w.place, `color: ${C.text}; font-size: 13px; font-weight: 700;`),
        icon('find-location-symbolic', 12, C.text),
    ]);
    const head = box({style: 'padding: 0 4px;'}, [
        box({vertical: true, style: 'spacing: 4px;'}, [
            place,
            text(deg(w.temp), `color: ${C.text}; font-size: 48px; font-weight: 300;`),
        ]),
        spacer(),
        box({vertical: true, style: 'spacing: 4px;', xAlign: Clutter.ActorAlign.END}, [
            icon(now.icon, 28, TONE[now.tone], {x_align: Clutter.ActorAlign.END}),
            text(now.text, `color: ${C.text}; font-size: 13px; font-weight: 600;`, {x_align: Clutter.ActorAlign.END}),
            text(_('H: {0}  L: {1}', deg(today.max), deg(today.min)), `color: ${C.label}; font-size: 12px;`,
                {x_align: Clutter.ActorAlign.END}),
        ]),
    ]);

    const rain = w.rain ? box({style: `background-color: ${C.tile}; border: 1px solid ${C.tileEdge}; ` +
        'border-radius: 6px; padding: 8px 10px; spacing: 8px;'}, [
        icon('weather-showers-symbolic', 16, C.rain),
        text(_('Rain from about {0}, {1}% chance', hourText(w.rain.time), w.rain.chance),
            `color: ${C.text}; font-size: 12px;`, {x_expand: true}),
    ]) : null;

    const hours = box({style: `border-top: 1px solid ${C.edge}; padding-top: 12px;`});
    hours.layout_manager.homogeneous = true;
    w.hours.slice(0, 6).forEach((hour, i) => {
        const look = describe(hour.code, hour.isDay);
        hours.add_child(box({vertical: true, style: 'spacing: 6px;', expand: true}, [
            text(i === 0 ? _('Now') : hourText(hour.time).slice(0, 2), `color: ${i === 0 ? C.text : C.label}; ` +
                'font-size: 11px; font-weight: 600;', {x_align: Clutter.ActorAlign.CENTER}),
            icon(look.icon, 18, TONE[look.tone], {x_align: Clutter.ActorAlign.CENTER}),
            text(deg(hour.temp), `color: ${C.text}; font-size: 13px; font-weight: 600;`, {x_align: Clutter.ActorAlign.CENTER}),
        ]));
    });

    const days = box({vertical: true, style: `border-top: 1px solid ${C.edge}; padding-top: 8px; spacing: 4px;`});
    const weekLow = Math.min(...w.days.map(d => d.min));
    const weekHigh = Math.max(...w.days.map(d => d.max));
    w.days.slice(0, 5).forEach((day, i) => {
        const look = describe(day.code, true);
        days.add_child(box({style: 'spacing: 10px; padding: 3px 4px;'}, [
            text(dayName(day.date, i), `color: ${C.text}; font-size: 12px; font-weight: 600; width: 56px;`),
            icon(look.icon, 16, TONE[look.tone]),
            text(deg(day.min), `color: ${C.label}; font-size: 12px; width: 30px; text-align: right;`),
            box({expand: true, yAlign: Clutter.ActorAlign.CENTER}, [rangeBar(112, day.min, day.max, weekLow, weekHigh)]),
            text(deg(day.max), `color: ${C.text}; font-size: 12px; font-weight: 600; width: 30px; text-align: right;`),
        ]));
    });

    const foot = box({style: 'padding: 0 4px; spacing: 6px;'}, [
        text(_('Updated {0}', hourText(w.time)), `color: ${C.label}; font-size: 11px;`),
        spacer(),
        icon('weather-showers-scattered-symbolic', 14, C.label),
        text(`${Math.round(w.humidity)}%`, `color: ${C.label}; font-size: 11px;`),
        icon('weather-windy-symbolic', 14, C.label),
        text(`${Math.round(w.wind)} ${_('km/h')}`, `color: ${C.label}; font-size: 11px;`),
    ]);
    return card(darkCard, [head, rain, hours, days, foot]);
}

// Part of the day for the sky's color and its name
function dayPart(w) {
    const hour = parseInt(w.time.slice(11, 13));
    if (!w.isDay)
        return {name: _('Night'), top: '#0C1626', bottom: '#1E3A5C'};
    if (hour < 11)
        return {name: _('Morning'), top: C.skyTop, bottom: C.skyBottom};
    if (hour < 15)
        return {name: _('Midday'), top: C.skyTop, bottom: C.skyBottom};
    return {name: _('Afternoon'), top: C.warmTop, bottom: C.warmBottom};
}

const minutes = iso => parseInt(iso.slice(11, 13)) * 60 + parseInt(iso.slice(14, 16));

export function weatherSunArc(w) {
    const part = dayPart(w);
    const today = w.days[0];
    const now = describe(w.code, w.isDay);
    const sunset = minutes(today.sunset);
    const sunrise = minutes(today.sunrise);
    const t = minutes(w.time);
    const sunLine = t < sunset && t >= sunrise
        ? _('Sunset {0}', hourText(today.sunset))
        : _('Sunrise {0}', hourText(t >= sunset ? w.days[1]?.sunrise ?? today.sunrise : today.sunrise));
    // Where the sun (or by night, the moon) is along the arc
    const along = w.isDay ? (t - sunrise) / Math.max(1, sunset - sunrise)
        : ((t - sunset + 1440) % 1440) / Math.max(1, 1440 - (sunset - sunrise));

    const head = box({style: 'padding: 16px 20px 0 20px;'}, [
        box({vertical: true, style: 'spacing: 3px;', expand: true}, [
            text(part.name, `color: ${C.text}; font-size: 20px; font-weight: 700;`),
            text(`${now.text} · ${w.place}`, `color: ${C.text}; font-size: 13px;`),
            text(sunLine, `color: ${C.text}; font-size: 12px; font-weight: 600;`),
        ]),
        text(deg(w.temp), `color: ${C.text}; font-size: 34px; font-weight: 300;`, {y_align: Clutter.ActorAlign.START}),
    ]);
    const arc = drawing(WIDTH, 78, (cr, width, height) => {
        // A wide arc rising from both bottom corners
        const cx = width / 2;
        const rx = width * 0.62;
        const ry = height * 1.05;
        const cy = height + ry * 0.35;
        cr.save();
        cr.translate(cx, cy);
        cr.scale(rx, ry);
        cr.arc(0, 0, 1, Math.PI, 2 * Math.PI);
        cr.restore();
        cr.setSourceRGBA(1, 1, 1, 0.16);
        cr.setLineWidth(18);
        cr.strokePreserve();
        cr.setSourceRGBA(1, 1, 1, 0.55);
        cr.setLineWidth(3);
        cr.stroke();
        const a = Math.PI + Math.PI * (0.18 + 0.64 * Math.min(1, Math.max(0, along)));
        const x = cx + rx * Math.cos(a);
        const y = cy + ry * Math.sin(a);
        cr.arc(x, y, 12, 0, 2 * Math.PI);
        cr.setSourceRGBA(1, 1, 1, 0.9);
        cr.fill();
        cr.arc(x, y, 10, 0, 2 * Math.PI);
        cr.setSourceRGBA(...(w.isDay ? rgbaOf(C.sun) : [0.92, 0.94, 1, 1]));
        cr.fill();
    });
    return card(`background-gradient-direction: vertical; background-gradient-start: ${part.top}; ` +
        `background-gradient-end: ${part.bottom}; border: 1px solid ${C.edge};`, [head, spacer(), arc]);
}

function windWord(kmh) {
    return kmh < 12 ? _('Light wind') : kmh < 30 ? _('Moderate wind') : _('Strong wind');
}

function uvWord(uv) {
    return uv < 3 ? _('Low') : uv < 6 ? _('Moderate') : uv < 8 ? _('High') : _('Very high');
}

export function weatherBig(w, actions) {
    const now = describe(w.code, w.isDay);
    const today = w.days[0];
    const more = button(icon('view-more-horizontal-symbolic', 16, C.text), () => actions.openMenu(more),
        'padding: 2px; border-radius: 999px;');
    const head = box({style: 'spacing: 6px;'}, [
        box({vertical: true, expand: true, style: 'spacing: 2px;'}, [
            box({style: 'spacing: 6px;'}, [
                icon('mark-location-symbolic', 14, C.text),
                text(w.place, `color: ${C.text}; font-size: 14px; font-weight: 700;`),
            ]),
            text(`${fmt(new Date(), '%a, %-d %b')} · ${hourText(w.time)}`, `color: ${C.label}; font-size: 12px;`),
        ]),
        more,
    ]);
    const temp = box({style: 'spacing: 2px; padding-top: 6px;'}, [
        text(Math.round(w.temp), `color: ${C.text}; font-size: 92px; font-weight: 200;`),
        text(w.unit, `color: ${C.text}; font-size: 26px; font-weight: 300;`, {y_align: Clutter.ActorAlign.START}),
        spacer(),
        box({vertical: true, style: 'spacing: 4px;', yAlign: Clutter.ActorAlign.END}, [
            icon(now.icon, 32, TONE[now.tone], {x_align: Clutter.ActorAlign.END}),
            text(now.text, `color: ${C.text}; font-size: 13px; font-weight: 600;`, {x_align: Clutter.ActorAlign.END}),
        ]),
    ]);
    const chip = (iconName, value) => box({style: `background-color: ${C.tile}; border-radius: 999px; ` +
        'padding: 3px 8px; spacing: 4px;'}, [icon(iconName, 12, C.text),
        text(value, `color: ${C.text}; font-size: 12px; font-weight: 600;`)]);
    const chips = box({style: 'spacing: 6px;'}, [chip('go-up-symbolic', deg(today.max)), chip('go-down-symbolic', deg(today.min))]);

    const fact = (iconName, color, value, caption) => box({vertical: true, expand: true, style: 'spacing: 2px;'}, [
        box({style: 'spacing: 4px;', xAlign: Clutter.ActorAlign.CENTER}, [icon(iconName, 14, color),
            text(value, `color: ${C.text}; font-size: 13px; font-weight: 700;`)]),
        text(caption, `color: ${C.label}; font-size: 11px;`, {x_align: Clutter.ActorAlign.CENTER}),
    ]);
    const facts = box({style: `background-color: ${C.tile}; border: 1px solid ${C.tileEdge}; border-radius: 12px; padding: 10px;`}, [
        w.rain ? fact('weather-showers-symbolic', C.rain, hourText(w.rain.time), _('Rain starts'))
            : fact('weather-clear-symbolic', C.sun, '–', _('No rain')),
        fact('weather-windy-symbolic', C.text, `${Math.round(w.wind)} ${_('km/h')}`, windWord(w.wind)),
        fact('weather-clear-symbolic', C.sun, `UV ${Math.round(today.uv ?? 0)}`, uvWord(today.uv ?? 0)),
    ]);
    facts.layout_manager.homogeneous = true;

    const hours = box({style: 'padding-top: 4px;'});
    hours.layout_manager.homogeneous = true;
    w.hours.slice(1, 6).forEach(hour => {
        const look = describe(hour.code, hour.isDay);
        hours.add_child(box({vertical: true, style: 'spacing: 4px;', expand: true}, [
            new St.Bin({style: `background-color: ${C.tile}; border-radius: 999px; width: 36px; height: 36px;`,
                child: icon(look.icon, 18, TONE[look.tone]), x_align: Clutter.ActorAlign.CENTER}),
            text(hourText(hour.time), `color: ${C.label}; font-size: 11px;`, {x_align: Clutter.ActorAlign.CENTER}),
            text(deg(hour.temp), `color: ${C.text}; font-size: 13px; font-weight: 700;`, {x_align: Clutter.ActorAlign.CENTER}),
        ]));
    });
    return card(`background-gradient-direction: vertical; background-gradient-start: ${C.warmTop}; ` +
        `background-gradient-end: ${C.warmBottom}; border: 1px solid ${C.edge}; padding: 16px; spacing: 10px;`,
    [head, temp, chips, facts, hours]);
}

export function weatherStrip(w) {
    const today = startOfDay(new Date());
    const block = box({vertical: true, style: `background-color: #F05A24; border-radius: ${RADIUS}px 0 0 ${RADIUS}px; ` +
        'padding: 0 14px; width: 62px;', yAlign: Clutter.ActorAlign.FILL}, [
        spacer(),
        text(fmt(today, '%b').toUpperCase(), 'color: rgba(255, 255, 255, 0.85); font-size: 11px; font-weight: 700;'),
        text(fmt(today, '%A'), 'color: #FFFFFF; font-size: 15px; font-weight: 800;'),
        spacer(),
    ]);
    const strip = box({style: `background-color: ${C.paper}; border-radius: 0 ${RADIUS}px ${RADIUS}px 0; padding: 12px 10px;`,
        expand: true});
    strip.layout_manager.homogeneous = true;
    for (let offset = -2; offset <= 2; offset++) {
        const date = addDays(today, offset);
        const iso = fmt(date, '%Y-%m-%d');
        const day = w.days.find(d => d.date === iso);
        const look = day ? describe(day.code, true) : null;
        const isToday = offset === 0;
        const top = isToday && day
            ? box({style: `background-color: ${C.ink}; border-radius: 999px; padding: 2px 6px; spacing: 3px;`,
                xAlign: Clutter.ActorAlign.CENTER}, [
                icon(look.icon, 12, C.sun),
                text(deg(w.temp), 'color: #FFFFFF; font-size: 11px; font-weight: 700;'),
            ])
            : icon(look?.icon ?? 'weather-overcast-symbolic', 14, C.inkMuted, {x_align: Clutter.ActorAlign.CENTER});
        strip.add_child(box({vertical: true, style: 'spacing: 4px;', expand: true}, [
            top,
            text(date.getDate(), `color: ${isToday ? C.ink : C.inkMuted}; font-size: ${isToday ? 22 : 15}px; ` +
                `font-weight: ${isToday ? 800 : 500};`, {x_align: Clutter.ActorAlign.CENTER}),
            text(fmt(date, '%a'), `color: ${isToday ? C.ink : C.inkMuted}; font-size: 10px; ` +
                `font-weight: ${isToday ? 700 : 400};`, {x_align: Clutter.ActorAlign.CENTER}),
        ]));
    }
    return card('', [block, strip], false);
}

export const WEATHER_STYLES = {
    'full': weatherFull,
    'sun-arc': weatherSunArc,
    'big': weatherBig,
    'strip': weatherStrip,
};
