"use strict";
// ====== DOM and SVG Utilities ======
Object.defineProperty(exports, "__esModule", { value: true });
exports.$qa = exports.$q = void 0;
exports.setAttr = setAttr;
exports.setAttrs = setAttrs;
exports.getClientXY = getClientXY;
exports.ensureSvgGroup = ensureSvgGroup;
exports.colorToHex = colorToHex;
exports.cssToRGBA01 = cssToRGBA01;
exports.rgba01ToCss = rgba01ToCss;
// Allow using dataset/value/closest cleanly with typed elements
const $q = (sel, root = document) => root.querySelector(sel);
exports.$q = $q;
const $qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
exports.$qa = $qa;
// Small helper so numeric SVG attributes compile without changing behavior
function setAttr(el, name, value) {
    el.setAttribute(name, String(value));
}
function setAttrs(el, attrs) {
    for (const [k, v] of Object.entries(attrs))
        el.setAttribute(k, String(v));
}
// Pointer/touch coordinate helper
function getClientXY(evt) {
    const t = evt.touches?.[0];
    const x = evt.clientX ?? t?.clientX ?? 0;
    const y = evt.clientY ?? t?.clientY ?? 0;
    return { x, y };
}
// Ensure required SVG layer <g> elements exist; create them if missing.
function ensureSvgGroup(svg, id) {
    const existing = document.getElementById(id);
    if (existing) {
        if (existing instanceof SVGGElement) {
            return existing;
        }
        // If an element with this id exists but isn't an <g>, replace it with a proper SVG <g>.
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('id', id);
        existing.replaceWith(g);
        return g;
    }
    if (!svg)
        throw new Error(`Missing <svg id="svg"> root; cannot create #${id}`);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', id);
    svg.appendChild(g);
    return g;
}
// Color conversion utilities
function colorToHex(cstr) {
    const tmp = document.createElement('div');
    tmp.style.color = cstr;
    document.body.appendChild(tmp);
    const computed = getComputedStyle(tmp).color;
    document.body.removeChild(tmp);
    const m = computed.match(/\d+/g);
    if (!m)
        return '#000000';
    const hex = '#' + m.slice(0, 3).map(v => parseInt(v).toString(16).padStart(2, '0')).join('');
    return hex;
}
function cssToRGBA01(css) {
    const tmp = document.createElement('div');
    tmp.style.color = css;
    document.body.appendChild(tmp);
    const computed = getComputedStyle(tmp).color;
    document.body.removeChild(tmp);
    const m = computed.match(/[\d.]+/g);
    if (!m)
        return { r: 0, g: 0, b: 0, a: 1 };
    const [r, g, b, a = 1] = m.map(Number);
    return { r: r / 255, g: g / 255, b: b / 255, a };
}
function rgba01ToCss(c) {
    return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
}
//# sourceMappingURL=utils.js.map