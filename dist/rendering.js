// rendering.ts - SVG rendering and drawing
// Handles component symbols, wire visualization, junction dots, endpoint circles, selection outline
import { formatValue } from './components.js';
// ========================================================================================
// ===== SVG ELEMENT CREATION HELPERS =====
// ========================================================================================
const SVG_NS = 'http://www.w3.org/2000/svg';
function setAttr(el, name, value) {
    el.setAttribute(name, String(value));
}
function setAttrs(el, attrs) {
    for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, String(v));
    }
}
export function rgba01ToCss(c) {
    return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
}
// ========================================================================================
// ===== COMPONENT SYMBOL RENDERING =====
// ========================================================================================
/**
 * Build SVG group for a component's symbol and label text.
 */
export function buildSymbolGroup(c, GRID, defaultResistorStyle) {
    const gg = document.createElementNS(SVG_NS, 'g');
    gg.setAttribute('transform', `rotate(${c.rot} ${c.x} ${c.y})`);
    const add = (el) => { gg.appendChild(el); return el; };
    const line = (x1, y1, x2, y2) => {
        const ln = document.createElementNS(SVG_NS, 'line');
        setAttrs(ln, { x1, y1, x2, y2, stroke: 'var(--component)', 'stroke-width': '2' });
        return add(ln);
    };
    const path = (d) => {
        const p = document.createElementNS(SVG_NS, 'path');
        setAttrs(p, { d, fill: 'none', stroke: 'var(--component)', 'stroke-width': '2' });
        return add(p);
    };
    const y = c.y, x = c.x;
    const ax = c.x - 50, bx = c.x + 50; // Pin positions at ±50 (2*GRID)
    switch (c.type) {
        case 'resistor':
            drawResistor(gg, c, x, y, ax, bx, defaultResistorStyle, line, path, add);
            break;
        case 'capacitor':
            drawCapacitor(gg, c, x, y, ax, bx, defaultResistorStyle, line, path, add);
            break;
        case 'inductor':
            drawInductor(x, y, ax, bx, path);
            break;
        case 'diode':
            drawDiodeInto(gg, c, c.props?.subtype || 'generic');
            break;
        case 'battery':
            drawBattery(c, x, y, GRID, line, add);
            break;
        case 'ac':
            drawACSource(x, y, ax, bx, line, add, path);
            break;
        case 'npn':
        case 'pnp':
            drawTransistor(c, x, y, line, add);
            break;
        case 'ground':
            drawGround(x, y, line);
            break;
    }
    // Label and voltage text
    const label = document.createElementNS(SVG_NS, 'text');
    setAttrs(label, { x: c.x, y: c.y + 46, 'text-anchor': 'middle', 'font-size': '12', fill: 'var(--ink)' });
    const valText = formatValue(c);
    label.textContent = valText ? `${c.label} (${valText})` : c.label;
    gg.appendChild(label);
    if (c.type === 'battery' || c.type === 'ac') {
        const vtxt = document.createElementNS(SVG_NS, 'text');
        setAttrs(vtxt, { x: c.x, y: c.y + 62, 'text-anchor': 'middle', 'font-size': '12', fill: 'var(--ink)' });
        const v = (c.props?.voltage ?? '') !== '' ? `${c.props.voltage} V` : '';
        vtxt.textContent = v;
        gg.appendChild(vtxt);
    }
    return gg;
}
function drawResistor(gg, c, x, y, ax, bx, defaultResistorStyle, line, path, add) {
    const style = c.props?.resistorStyle || defaultResistorStyle;
    if (style === 'iec') {
        // IEC rectangular resistor
        const rectWidth = 60;
        const rectLeft = x - rectWidth / 2;
        const rectRight = x + rectWidth / 2;
        line(ax, y, rectLeft, y);
        line(rectRight, y, bx, y);
        const rect = document.createElementNS(SVG_NS, 'rect');
        setAttrs(rect, {
            x: rectLeft, y: y - 12, width: rectWidth, height: 24, rx: 1,
            stroke: 'var(--component)', 'stroke-width': '2', fill: 'none'
        });
        add(rect);
    }
    else {
        // US/ANSI zigzag resistor
        path(`M ${ax} ${y} H ${x - 39} L ${x - 33} ${y - 12} L ${x - 21} ${y + 12} L ${x - 9} ${y - 12} L ${x + 3} ${y + 12} L ${x + 15} ${y - 12} L ${x + 27} ${y + 12} L ${x + 33} ${y} H ${bx}`);
    }
}
function drawCapacitor(gg, c, x, y, ax, bx, defaultResistorStyle, line, path, add) {
    const subtype = c.props?.capacitorSubtype || 'standard';
    if (subtype === 'polarized') {
        const style = c.props?.capacitorStyle || defaultResistorStyle;
        const x1 = x - 6, x2 = x + 6;
        if (style === 'iec') {
            // IEC polarized: straight plates with +/- marks
            line(x - 48, y, x1, y);
            line(x1, y - 16, x1, y + 16);
            line(x2, y - 16, x2, y + 16);
            line(x2, y, x + 48, y);
            line(x - 18, y - 24, x - 18, y - 12);
            line(x - 24, y - 18, x - 12, y - 18);
            line(x + 12, y - 18, x + 24, y - 18);
        }
        else {
            // ANSI polarized: straight + curved plates
            line(x - 48, y, x1, y);
            line(x1, y - 16, x1, y + 16);
            const curveLeft = x2 - 6;
            path(`M ${x2} ${y - 16} Q ${curveLeft} ${y} ${x2} ${y + 16}`);
            line(x2, y, x + 48, y);
            line(x - 20, y - 24, x - 20, y - 12);
            line(x - 26, y - 18, x - 14, y - 18);
        }
    }
    else {
        // Standard non-polarized capacitor
        const x1 = x - 6, x2 = x + 6;
        line(x - 48, y, x1, y);
        line(x1, y - 16, x1, y + 16);
        line(x2, y - 16, x2, y + 16);
        line(x2, y, x + 48, y);
    }
}
function drawInductor(x, y, ax, bx, path) {
    const totalWidth = 100;
    const r = 8;
    const numCoils = 6;
    const coilWidth = totalWidth / numCoils;
    let d = `M ${ax} ${y}`;
    for (let i = 0; i < numCoils; i++) {
        d += ` q ${coilWidth / 2} -${r} ${coilWidth} 0`;
    }
    path(d);
}
function drawDiodeInto(gg, c, subtype) {
    const stroke = 'var(--component)';
    const sw = 2;
    const add = (el) => { gg.appendChild(el); return el; };
    const mk = (tag) => document.createElementNS(SVG_NS, tag);
    const lineEl = (x1, y1, x2, y2, w = sw) => {
        const ln = mk('line');
        setAttrs(ln, { x1, y1, x2, y2, stroke, 'stroke-width': w, fill: 'none' });
        return add(ln);
    };
    const pathEl = (d, w = sw) => {
        const p = mk('path');
        setAttrs(p, { d, stroke, 'stroke-width': w, fill: 'none' });
        return add(p);
    };
    const y = c.y, ax = c.x - 50, bx = c.x + 50, cx = c.x + 8, cy = y;
    const addArrow = (outward = true) => {
        const dir = outward ? 1 : -1, arrX = cx + (outward ? 10 : -10);
        pathEl(`M ${arrX} ${cy - 10} l ${6 * dir} -6 m -6 6 l ${6 * dir} 6`);
        pathEl(`M ${arrX} ${cy + 10} l ${6 * dir} -6 m -6 6 l ${6 * dir} 6`);
    };
    switch (String(subtype).toLowerCase()) {
        case 'tvs_bi':
            // Bidirectional TVS: two triangles pointing at each other
            lineEl(ax, cy - 16, ax, cy + 16);
            pathEl(`M ${ax} ${cy} L ${ax + 16} ${cy - 16} L ${ax + 16} ${cy + 16} Z`);
            pathEl(`M ${bx} ${cy} L ${bx - 16} ${cy - 16} L ${bx - 16} ${cy + 16} Z`);
            lineEl(bx, cy - 16, bx, cy + 16);
            lineEl(ax + 16, cy, bx - 16, cy);
            break;
        default:
            // Standard diode: triangle + cathode bar
            pathEl(`M ${ax} ${y} L ${ax} ${y - 16} L ${c.x} ${y} L ${ax} ${y + 16} Z`);
            lineEl(bx, y - 16, bx, y + 16);
            lineEl(c.x, y, bx, y);
            // Subtype adorners
            switch (String(subtype).toLowerCase()) {
                case 'zener':
                    lineEl(cx - 14, cy - 6, cx, cy);
                    lineEl(cx - 14, cy + 6, cx, cy);
                    break;
                case 'schottky':
                    lineEl(cx - 6, cy - 12, cx - 6, cy + 12);
                    break;
                case 'led':
                    addArrow(true);
                    break;
                case 'photo':
                    addArrow(false);
                    break;
                case 'tunnel':
                    lineEl(cx - 10, cy - 12, cx - 10, cy + 12);
                    break;
                case 'varactor':
                case 'varicap':
                    lineEl(cx + 8, cy - 12, cx + 8, cy + 12);
                    break;
                case 'laser':
                    addArrow(true);
                    lineEl(cx + 14, cy - 14, cx + 14, cy + 14);
                    break;
                case 'tvs_uni':
                    lineEl(bx, cy - 16, bx - 8, cy - 22);
                    lineEl(bx, cy + 16, bx - 8, cy + 22);
                    break;
            }
            break;
    }
}
function drawBattery(c, x, y, GRID, line, add) {
    const pinOffset = 2 * GRID;
    const xNeg = c.x - 10, xPos = c.x + 10;
    line(xNeg, y - 18, xNeg, y + 18);
    line(xNeg, y, c.x - pinOffset, y);
    line(xPos, y - 12, xPos, y + 12);
    line(xPos, y, c.x + pinOffset, y);
    const plusText = document.createElementNS(SVG_NS, 'text');
    setAttrs(plusText, {
        x: xPos + 16, y: y - 8, 'text-anchor': 'start',
        'font-size': '16', 'font-weight': 'bold', fill: 'var(--component)'
    });
    plusText.textContent = '+';
    add(plusText);
    const minusText = document.createElementNS(SVG_NS, 'text');
    setAttrs(minusText, {
        x: xNeg - 16, y: y - 8, 'text-anchor': 'end',
        'font-size': '16', 'font-weight': 'bold', fill: 'var(--component)'
    });
    minusText.textContent = '−';
    add(minusText);
}
function drawACSource(x, y, ax, bx, line, add, path) {
    const radius = 40;
    line(ax, y, x - radius, y);
    line(x + radius, y, bx, y);
    const circ = document.createElementNS(SVG_NS, 'circle');
    setAttrs(circ, {
        cx: x, cy: y, r: radius, fill: 'none',
        stroke: 'var(--component)', 'stroke-width': '2'
    });
    add(circ);
    path(`M ${x - 30} ${y} q 15 -20 30 0 q 15 20 30 0`);
}
function drawTransistor(c, x, y, line, add) {
    const arrowOut = c.type === 'npn';
    line(x, y - 28, x, y + 28);
    line(x, y - 10, x + 30, y - 30);
    line(x, y + 10, x + 30, y + 30);
    const arr = document.createElementNS(SVG_NS, 'path');
    const dx = arrowOut ? 8 : -8;
    arr.setAttribute('d', `M ${x + 30} ${y + 30} l ${-dx} -6 l 0 12 Z`);
    arr.setAttribute('fill', 'var(--component)');
    add(arr);
}
function drawGround(x, y, line) {
    line(x - 16, y, x + 16, y);
    line(x - 10, y + 6, x + 10, y + 6);
    line(x - 4, y + 12, x + 4, y + 12);
}
// ========================================================================================
// ===== WIRE RENDERING =====
// ========================================================================================
/**
 * Calculate dash array for stroke type.
 */
export function dashArrayFor(type) {
    switch (type) {
        case 'dashed': return '8 4';
        case 'dotted': return '2 4';
        default: return null;
    }
}
/**
 * Get effective stroke for a wire (explicit → netclass → theme).
 */
export function effectiveStroke(wire, netClass, theme) {
    if (wire.stroke)
        return wire.stroke;
    if (netClass?.wire)
        return netClass.wire;
    return theme.wire;
}
/**
 * Ensure wire has a stroke object (create from color if needed).
 */
export function ensureStroke(wire) {
    if (wire.stroke)
        return;
    if (wire.color && wire.color !== '#000000') {
        const match = wire.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (match) {
            const r = parseInt(match[1], 10) / 255;
            const g = parseInt(match[2], 10) / 255;
            const b = parseInt(match[3], 10) / 255;
            const a = match[4] ? parseFloat(match[4]) : 1;
            wire.stroke = {
                color: { r, g, b, a },
                width: 0.25,
                type: 'solid'
            };
        }
    }
}
// ========================================================================================
// ===== JUNCTION DOT RENDERING =====
// ========================================================================================
/**
 * Create SVG circle element for a junction dot.
 */
export function createJunctionDot(j, junctionDotSize, NET_CLASSES, rgba01ToCssFn) {
    const nc = NET_CLASSES[j.netId || 'default'] || NET_CLASSES.default;
    const sizeMils = junctionDotSize === 'small' ? 50 : junctionDotSize === 'medium' ? 70 : 90;
    const diameterMm = sizeMils * 0.0254;
    const radiusMm = diameterMm / 2;
    const radiusPx = Math.max(1, radiusMm * (100 / 25.4));
    const color = j.color ? j.color : rgba01ToCssFn(nc.junction.color);
    const dot = document.createElementNS(SVG_NS, 'circle');
    setAttrs(dot, { cx: j.at.x, cy: j.at.y, r: radiusPx, fill: color, stroke: 'var(--bg)', 'stroke-width': '1' });
    return dot;
}
/**
 * Create SVG circle element for wire/component endpoint indicator.
 */
export function createEndpointCircle(pt, options) {
    let desiredScreenPx = 9;
    if (options.zoom <= 0.25)
        desiredScreenPx = 6;
    else if (options.zoom < 0.75)
        desiredScreenPx = 7;
    const scale = options.userScale();
    const widthUser = desiredScreenPx / Math.max(1e-6, scale);
    const circle = document.createElementNS(SVG_NS, 'circle');
    setAttrs(circle, {
        cx: pt.x,
        cy: pt.y,
        r: widthUser / 2,
        fill: 'rgba(0,200,0,0.08)',
        stroke: 'lime',
        'stroke-width': 1 / Math.max(1e-6, scale)
    });
    circle.setAttribute('data-endpoint', '1');
    circle.style.cursor = 'pointer';
    return circle;
}
// ========================================================================================
// ===== SELECTION OUTLINE =====
// ========================================================================================
/**
 * Update selection styling on component elements.
 */
export function updateSelectionOutline(selection) {
    document.querySelectorAll('#components g.comp').forEach(g => {
        const id = g.getAttribute('data-id');
        const on = selection.kind === 'component' && selection.id === id;
        g.classList.toggle('selected', !!on);
    });
}
// ========================================================================================
// ===== DRAWING OVERLAY (WIRE IN PROGRESS) =====
// ========================================================================================
/**
 * Render the wire being drawn (active drawing state).
 */
export function renderDrawing(gDrawing, drawingPoints, cursor, orthoMode) {
    gDrawing.replaceChildren();
    if (drawingPoints.length === 0)
        return;
    const pts = [...drawingPoints];
    if (cursor && drawingPoints.length > 0) {
        const last = drawingPoints[drawingPoints.length - 1];
        if (orthoMode) {
            const dx = Math.abs(cursor.x - last.x);
            const dy = Math.abs(cursor.y - last.y);
            const snapPt = dx > dy ? { x: cursor.x, y: last.y } : { x: last.x, y: cursor.y };
            pts.push(snapPt);
        }
        else {
            pts.push(cursor);
        }
    }
    const polyline = document.createElementNS(SVG_NS, 'polyline');
    polyline.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', 'cyan');
    polyline.setAttribute('stroke-width', '2');
    polyline.setAttribute('stroke-dasharray', '4 2');
    gDrawing.appendChild(polyline);
    // Draw dots at each vertex
    for (const p of pts) {
        const circle = document.createElementNS(SVG_NS, 'circle');
        setAttrs(circle, { cx: p.x, cy: p.y, r: 3, fill: 'cyan' });
        gDrawing.appendChild(circle);
    }
}
// ========================================================================================
// ===== PREVIEW JUNCTION DOT (WHILE DRAWING WIRE) =====
// ========================================================================================
/**
 * Create preview junction dot shown while drawing wire.
 */
export function createPreviewJunctionDot(at, junctionDotSize) {
    const sizeMils = junctionDotSize === 'small' ? 50 : junctionDotSize === 'medium' ? 70 : 90;
    const diameterMm = sizeMils * 0.0254;
    const radiusMm = diameterMm / 2;
    const radiusPx = Math.max(1, radiusMm * (100 / 25.4));
    const previewDot = document.createElementNS(SVG_NS, 'circle');
    setAttrs(previewDot, {
        cx: at.x,
        cy: at.y,
        r: radiusPx,
        fill: 'rgba(255,255,255,0.6)',
        stroke: 'rgba(255,255,255,0.8)',
        'stroke-width': '1',
        'data-preview-junction': '1'
    });
    return previewDot;
}
//# sourceMappingURL=rendering.js.map