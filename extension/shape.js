// Cairo drawing of the notch, following the paths in the Pego design.
// A compact notch (300×32) has 6 px ears and an 11 px bottom radius; an expanded panel has
// 10 px ears and a 28 px bottom radius. Below LINE_HEIGHT the notch is drawn as the idle line.
// The liquid style (Pego "Notch liquid", after notching's shape.ts) draws a lens instead of
// the line, which drops into a bead that leans toward the pointer while it is near.

import Cairo from 'cairo';

import {Color, Shape} from './tokens.js';

const KAPPA = 0.5523; // cubic Bézier approximation of a quarter circle
const LINE_MAX_HEIGHT = 8;
const COMPACT_HEIGHT = 32;
// Expanded fill: solid black over the status row, then a fade into the panel color
const SOLID_TOP = 32;
const FADE = 40;
const UNREAD_DOT_RADIUS = 3;
const FLOATING_RADIUS = 22;
// Liquid style: up to this height the notch is a lens or a bead, above it a notch
const LIQUID_MAX_HEIGHT = 16;
const LIQUID_SAMPLES = 72;
// The expanded liquid panel: solid at the top, then easing down to this opacity
const LIQUID_FADE_FROM = 0.15;
const LIQUID_FADE_TO = 0.75;
// A dot with a soft halo around it
function glowDot(cr, x, y, r, [red, green, blue], alpha) {
    const halo = new Cairo.RadialGradient(x, y, 0, x, y, r * 2.2);
    halo.addColorStopRGBA(0, red, green, blue, 0.55 * alpha);
    halo.addColorStopRGBA(1, red, green, blue, 0);
    cr.newPath();
    cr.arc(x, y, r * 2.2, 0, 2 * Math.PI);
    cr.setSource(halo);
    cr.fill();
    cr.newPath();
    cr.arc(x, y, r, 0, 2 * Math.PI);
    cr.setSourceRGBA(red, green, blue, alpha);
    cr.fill();
}

export function parseColor(hex) {
    const n = hex.replace('#', '');
    const c = i => parseInt(n.slice(i, i + 2), 16) / 255;
    return [c(0), c(2), c(4), n.length >= 8 ? c(6) : 1];
}

function setColor(cr, hex, alphaScale = 1) {
    const [r, g, b, a] = parseColor(hex);
    cr.setSourceRGBA(r, g, b, a * alphaScale);
}

// Quadratic curve from the current point, converted to a cubic for Cairo
function quadTo(cr, x0, y0, cx, cy, x1, y1) {
    cr.curveTo(
        x0 + 2 / 3 * (cx - x0), y0 + 2 / 3 * (cy - y0),
        x1 + 2 / 3 * (cx - x1), y1 + 2 / 3 * (cy - y1),
        x1, y1);
}

// Notch outline at (x, 0), w × h, with concave top ears and rounded bottom corners.
// The compact design uses quadratic bottom corners (control offset 2/3 r), the expanded one
// circular ones.
function notchPath(cr, x, w, h, ear, radius, circular) {
    const r = Math.max(0, Math.min(radius, h - ear, (w - 2 * ear) / 2));
    const k = r * (circular ? KAPPA : 2 / 3);
    const right = x + w;

    cr.newPath();
    cr.moveTo(x, 0);
    cr.lineTo(right, 0);
    quadTo(cr, right, 0, right - ear, 0, right - ear, ear);
    cr.lineTo(right - ear, h - r);
    cr.curveTo(right - ear, h - r + k, right - ear - r + k, h, right - ear - r, h);
    cr.lineTo(x + ear + r, h);
    cr.curveTo(x + ear + r - k, h, x + ear, h - r + k, x + ear, h - r);
    cr.lineTo(x + ear, ear);
    quadTo(cr, x + ear, ear, x + ear, 0, x, 0);
    cr.closePath();
}

function smoothstep(a, b, x) {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
}

// Depth below the top edge at x (from the center) of a liquid shape of half width W and
// depth H: a blend of the lens profile (s = 0, flat middle, tapering ends) and the bead
// profile (s = 1, round drop), its deepest point pulled toward bx
function liquidDepth(x, W, H, s, bx) {
    const c = Math.max(-W * 0.5, Math.min(W * 0.5, bx));
    const u = x < c ? (c - x) / (W + c) : (x - c) / (W - c);
    if (u >= 1)
        return 0;
    const lens = 1 - smoothstep(0.24, 1, u);
    const bead = Math.pow(1 - u * u, 2.4);
    return H * ((1 - s) * lens + s * bead);
}

function liquidPath(cr, cx, W, H, s, bx) {
    cr.newPath();
    cr.moveTo(cx - W, 0);
    for (let i = 1; i < LIQUID_SAMPLES; i++) {
        const x = -W + 2 * W * i / LIQUID_SAMPLES;
        cr.lineTo(cx + x, liquidDepth(x, W, H, s, bx));
    }
    cr.lineTo(cx + W, 0);
    cr.closePath();
}

function roundedRect(cr, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    cr.newPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

/**
 * Agent animation on the standby line.
 *
 * @param {object} activity - {style: 'sweep' | 'swap' | 'dots', phase: seconds,
 *   waiting: bool, workColor, waitColor, music: bool (equalizer bars in waitColor)}
 */
function drawActivity(cr, x, w, h, scale, {style, phase, waiting, workColor, waitColor, music = false}) {
    const [wr, wg, wb] = parseColor(workColor);
    const [ar, ag, ab] = parseColor(waitColor);

    if (music) {
        // Music playing: a few bars dancing in the accent color, like an equalizer
        const [mr, mg, mb] = parseColor(waitColor);
        const bars = 5;
        const barWidth = 2 * scale;
        const gap = 2.2 * scale;
        const left = x + (w - (bars * barWidth + (bars - 1) * gap)) / 2;
        for (let i = 0; i < bars; i++) {
            const level = 0.5 + 0.5 * Math.sin(phase * 2 * Math.PI * (0.9 + 0.17 * i) + i * 1.7);
            const barHeight = h * (0.25 + 0.5 * level);
            roundedRect(cr, left + i * (barWidth + gap), (h - barHeight) / 2, barWidth, barHeight, barWidth / 2);
            cr.setSourceRGBA(mr, mg, mb, 1);
            cr.fill();
        }
        return;
    }

    if (waiting) {
        // Needs the user: the whole line breathes in the accent color
        const alpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(phase * 2 * Math.PI / 1.4));
        roundedRect(cr, x, 0, w, h, h / 2);
        cr.setSourceRGBA(ar, ag, ab, alpha);
        cr.fill();
        return;
    }

    if (style === 'swap' || style === 'dots') {
        // The dots light up inside the line, which the notch makes a slim pill for them
        const cx = x + w / 2;
        const cy = h / 2;
        const r = Math.min(2.2 * scale, h * 0.3);

        if (style === 'swap') {
            // Two dots trading places, the one in front a little larger
            const angle = phase * 2 * Math.PI / 1.6;
            const spread = 7 * scale;
            const dots = [
                {dx: Math.cos(angle) * spread, depth: Math.sin(angle), color: [wr, wg, wb]},
                {dx: -Math.cos(angle) * spread, depth: -Math.sin(angle), color: [1, 1, 1]},
            ].sort((a, b) => a.depth - b.depth);
            for (const dot of dots)
                glowDot(cr, cx + dot.dx, cy, r * (1 + 0.15 * dot.depth), dot.color, 0.75 + 0.25 * dot.depth);
        } else {
            // Three dots lighting up one after the other, left to right
            const gap = 8 * scale;
            for (let i = 0; i < 3; i++) {
                const wave = Math.max(0, Math.sin(phase * 2 * Math.PI / 1.2 - i * 0.75));
                glowDot(cr, cx + (i - 1) * gap, cy, r * (0.85 + 0.25 * wave), [wr, wg, wb], 0.3 + 0.7 * wave);
            }
        }
    } else {
        // A glowing segment sweeping left and right along the line
        const segment = Math.max(w * 0.35, 24 * scale);
        const t = 0.5 + 0.5 * Math.sin(phase * 2 * Math.PI / 1.8);
        const start = x + (w - segment) * t;
        const gradient = new Cairo.LinearGradient(start, 0, start + segment, 0);
        gradient.addColorStopRGBA(0, wr, wg, wb, 0);
        gradient.addColorStopRGBA(0.5, wr, wg, wb, 1);
        gradient.addColorStopRGBA(1, wr, wg, wb, 0);
        roundedRect(cr, x, 0, w, h, h / 2);
        cr.setSource(gradient);
        cr.fill();
    }
}

/**
 * Draw the notch centered in an area of areaWidth.
 * Sizes are in device pixels (already multiplied by the scale factor).
 *
 * @param {object} cr - Cairo context
 * @param {number} areaWidth - width of the drawing area
 * @param {number} w - notch width
 * @param {number} h - notch height
 * @param {object} opts - {scale, ringColor, expanded, showCamera, liquid}
 *   liquid: null, or {rest, drop, lean, phase} in device pixels: the lens thickness and the
 *   bead's extra depth (they set how far the lens has turned into a bead), the lean toward
 *   the pointer and the time in seconds (the bead breathes)
 */
export function drawNotch(cr, areaWidth, w, h, opts) {
    const {
        scale = 1,
        ringColor = Color.notchIdleEdge,
        edgeColor = Color.notchGlassEdge,
        panelColor = Color.notchPanel,
        expanded = false,
        showCamera = false,
        unreadDot = false,
        accentColor = Color.accent,
        solidTop = true,
        floating = false,
        activity = null,
        liquid = null,
    } = opts;
    if (w <= 0 || h <= 0)
        return;

    const x = (areaWidth - w) / 2;
    const fluid = liquid && !floating;

    if (fluid && !expanded && h <= LIQUID_MAX_HEIGHT * scale) {
        drawLiquid(cr, areaWidth, w, h, scale, liquid, {ringColor, activity, unreadDot, accentColor});
        return;
    }

    if (h <= LINE_MAX_HEIGHT * scale) {
        // Idle and hover: a black line with a thin light ring around it
        roundedRect(cr, x - scale, 0, w + 2 * scale, h + scale, (h + scale) / 2);
        setColor(cr, ringColor);
        cr.fill();
        roundedRect(cr, x, 0, w, h, h / 2);
        setColor(cr, Color.notch);
        cr.fill();

        // A coding agent at work (or waiting for the user) animates the line itself
        if (activity)
            drawActivity(cr, x, w, h, scale, activity);

        // Unread notifications: an accent dot just right of the line
        if (unreadDot) {
            const r = UNREAD_DOT_RADIUS * scale;
            cr.newPath();
            cr.arc(x + w + 2 * r + scale, r + scale, r, 0, 2 * Math.PI);
            setColor(cr, accentColor);
            cr.fill();
        }
        return;
    }

    // Ears grow in as the line (or the bead) turns into a notch
    const start = (fluid ? LIQUID_MAX_HEIGHT : LINE_MAX_HEIGHT) * scale;
    const t = Math.min(1, (h - start) / (COMPACT_HEIGHT * scale - start));
    const ear = (expanded ? Shape.expandedEar : Shape.compactEar) * scale * t;
    const radius = (expanded ? Shape.expandedBottomRadius : Shape.compactBottomRadius) * scale;

    if (floating) {
        // Floating notch: a pill (compact) or a card with round corners (expanded), no ears
        roundedRect(cr, x, 0, w, h, expanded ? FLOATING_RADIUS * scale : h / 2);
    } else {
        notchPath(cr, x, w, h, ear, radius, expanded);
    }
    if (expanded && fluid && solidTop) {
        // Liquid panel: plain black, solid at the top, easing into a fade at the bottom
        const gradient = new Cairo.LinearGradient(0, 0, 0, h);
        gradient.addColorStopRGBA(0, 0, 0, 0, 1);
        for (let i = 0; i <= 10; i++) {
            const step = i / 10;
            gradient.addColorStopRGBA(LIQUID_FADE_FROM + (1 - LIQUID_FADE_FROM) * step, 0, 0, 0,
                1 - (1 - LIQUID_FADE_TO) * smoothstep(0, 1, step));
        }
        cr.setSource(gradient);
        cr.fill();
    } else if (expanded) {
        if (solidTop) {
            // Dark: solid black under the status row, fading into the translucent panel
            const solidEnd = Math.min(1, SOLID_TOP * scale / h);
            const fadeEnd = Math.min(1, (SOLID_TOP + FADE) * scale / h);
            const gradient = new Cairo.LinearGradient(0, 0, 0, h);
            gradient.addColorStopRGBA(0, ...parseColor(Color.notch));
            gradient.addColorStopRGBA(solidEnd, ...parseColor(Color.notch));
            gradient.addColorStopRGBA(fadeEnd, ...parseColor(panelColor));
            gradient.addColorStopRGBA(1, ...parseColor(panelColor));
            cr.setSource(gradient);
        } else {
            // Light: one frosted surface
            setColor(cr, panelColor);
        }
        cr.fillPreserve();
        cr.setLineWidth(scale);
        setColor(cr, edgeColor);
        cr.stroke();
    } else {
        setColor(cr, Color.notch);
        cr.fill();
        // The notch block of the bar modes: agents and music play on a line inside it
        if (activity) {
            const dots = activity.music || activity.style === 'swap' || activity.style === 'dots';
            const lineW = Math.min(120 * scale, w - 2 * ear - 40 * scale);
            const lineH = (dots ? 8 : 4) * scale;
            cr.save();
            cr.translate(0, h - lineH - 8 * scale);
            drawActivity(cr, x + (w - lineW) / 2, lineW, lineH, scale, activity);
            cr.restore();
        }
    }

    if (showCamera && h >= 26 * scale) {
        const size = Shape.cameraSize * scale;
        cr.newPath();
        cr.arc(areaWidth / 2, Shape.cameraY * scale, size / 2, 0, 2 * Math.PI);
        setColor(cr, Color.camera);
        cr.fillPreserve();
        cr.setLineWidth(scale);
        setColor(cr, Color.cameraEdge);
        cr.stroke();
    }
}

// The lens (at rest) or the bead (pointer near): the closer the height is to rest + drop, the
// rounder it gets. Agent and music animations play inside the shape.
function drawLiquid(cr, areaWidth, w, h, scale, {rest, drop, lean = 0, phase = 0},
    {ringColor, activity, unreadDot, accentColor}) {
    const s = Math.min(1, Math.max(0, (h - rest) / Math.max(1, drop)));
    const depth = h * (1 + 0.035 * s * Math.sin(phase * 2.2));
    const cx = areaWidth / 2;
    const W = w / 2;
    const bx = lean * s;

    // A thin light ring keeps it visible on dark wallpapers
    liquidPath(cr, cx, W, depth, s, bx);
    cr.setLineWidth(2 * scale);
    setColor(cr, ringColor);
    cr.stroke();
    liquidPath(cr, cx, W, depth, s, bx);
    setColor(cr, Color.notch);
    cr.fillPreserve();

    if (activity) {
        cr.save();
        cr.clip();
        drawActivity(cr, cx - W, w, depth, scale, activity);
        cr.restore();
    }
    cr.newPath();

    if (unreadDot) {
        const r = UNREAD_DOT_RADIUS * scale;
        cr.arc(cx + W + 2 * r + scale, r + scale, r, 0, 2 * Math.PI);
        setColor(cr, accentColor);
        cr.fill();
    }
}
