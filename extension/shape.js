// Cairo drawing of the notch, following the paths in the Pego design.
// A compact notch (300×32) has 6 px ears and an 11 px bottom radius; an expanded panel has
// 10 px ears and a 28 px bottom radius. Below LINE_HEIGHT the notch is drawn as the idle line.

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
 * Draw the notch centered in an area of areaWidth.
 * Sizes are in device pixels (already multiplied by the scale factor).
 *
 * @param {object} cr - Cairo context
 * @param {number} areaWidth - width of the drawing area
 * @param {number} w - notch width
 * @param {number} h - notch height
 * @param {object} opts - {scale, ringColor, expanded, showCamera}
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
    } = opts;
    if (w <= 0 || h <= 0)
        return;

    const x = (areaWidth - w) / 2;

    if (h <= LINE_MAX_HEIGHT * scale) {
        // Idle and hover: a black line with a thin light ring around it
        roundedRect(cr, x - scale, 0, w + 2 * scale, h + scale, (h + scale) / 2);
        setColor(cr, ringColor);
        cr.fill();
        roundedRect(cr, x, 0, w, h, h / 2);
        setColor(cr, Color.notch);
        cr.fill();

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

    // Ears grow in as the line turns into a notch
    const t = Math.min(1, (h - LINE_MAX_HEIGHT * scale) / ((COMPACT_HEIGHT - LINE_MAX_HEIGHT) * scale));
    const ear = (expanded ? Shape.expandedEar : Shape.compactEar) * scale * t;
    const radius = (expanded ? Shape.expandedBottomRadius : Shape.compactBottomRadius) * scale;

    if (floating) {
        // Floating notch: a pill (compact) or a card with round corners (expanded), no ears
        roundedRect(cr, x, 0, w, h, expanded ? FLOATING_RADIUS * scale : h / 2);
    } else {
        notchPath(cr, x, w, h, ear, radius, expanded);
    }
    if (expanded) {
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
