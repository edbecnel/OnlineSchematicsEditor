// ================================================================================
// UTILITIES MODULE
// Pure helper functions with no dependencies on application state
// ================================================================================
// ====== DOM Utilities ======
export const $q = (sel, root = document) => root.querySelector(sel);
export const $qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function setAttr(el, name, value) {
    el.setAttribute(name, String(value));
}
export function setAttrs(el, attrs) {
    for (const [k, v] of Object.entries(attrs))
        el.setAttribute(k, String(v));
}
export function getClientXY(evt) {
    const t = evt.touches?.[0];
    const x = evt.clientX ?? t?.clientX ?? 0;
    const y = evt.clientY ?? t?.clientY ?? 0;
    return { x, y };
}
// ====== SVG Utilities ======
export function ensureSvgGroup(svg, id) {
    const existing = document.getElementById(id);
    if (existing) {
        if (existing instanceof SVGGElement) {
            return existing;
        }
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
// ====== Color Utilities ======
export function colorToHex(cstr) {
    const tmp = document.createElement('span');
    tmp.style.color = cstr;
    document.body.appendChild(tmp);
    const rgb = getComputedStyle(tmp).color;
    document.body.removeChild(tmp);
    const m = rgb.match(/\d+/g);
    if (!m)
        return '#000000';
    const [r, g, b] = m.map(n => Math.max(0, Math.min(255, parseInt(n, 10))));
    const hx = v => v.toString(16).padStart(2, '0').toUpperCase();
    return `#${hx(r)}${hx(g)}${hx(b)}`;
}
export function cssToRGBA01(css) {
    const tmp = document.createElement('span');
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
export function rgba01ToCss(c) {
    return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
}
// ====== Geometry Utilities ======
export const deg = (rad) => rad * 180 / Math.PI;
export const normDeg = (d) => ((d % 360) + 360) % 360;
export function rotatePoint(p, center, deg) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const dx = p.x - center.x, dy = p.y - center.y;
    return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}
export const eqPt = (p, q) => p.x === q.x && p.y === q.y;
export function pointToSegmentDistance(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0)
        return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = a.x + t * dx, qy = a.y + t * dy;
    return Math.sqrt((p.x - qx) ** 2 + (p.y - qy) ** 2);
}
export function projectPointToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0)
        return { ...a };
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + t * dx, y: a.y + t * dy };
}
export function segmentAngle(a, b) {
    return deg(Math.atan2(b.y - a.y, b.x - a.x));
}
export function rectFromPoints(a, b) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}
export function inRect(p, r) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
export function segsIntersect(p1, p2, q1, q2) {
    const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
    return ccw(p1, q1, q2) !== ccw(p2, q1, q2) && ccw(p1, p2, q1) !== ccw(p1, p2, q2);
}
export function segmentIntersectsRect(a, b, r) {
    if (inRect(a, r) || inRect(b, r))
        return true;
    const tl = { x: r.x, y: r.y };
    const tr = { x: r.x + r.w, y: r.y };
    const bl = { x: r.x, y: r.y + r.h };
    const br = { x: r.x + r.w, y: r.y + r.h };
    return segsIntersect(a, b, tl, tr) || segsIntersect(a, b, tr, br) ||
        segsIntersect(a, b, br, bl) || segsIntersect(a, b, bl, tl);
}
// ====== Misc Utilities ======
export function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}
//# sourceMappingURL=utils.js.map