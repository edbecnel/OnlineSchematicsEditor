// ================================================================================
// UTILITIES MODULE
// Pure helper functions with no dependencies on application state
// ================================================================================

// ====== DOM Utilities ======

export const $q = <T extends Element>(sel: string, root: ParentNode | Document = document) =>
  root.querySelector<T>(sel)!;

export const $qa = <T extends Element>(sel: string, root: ParentNode | Document = document) =>
  Array.from(root.querySelectorAll<T>(sel));

export function setAttr(el: Element, name: string, value: number | string) {
  el.setAttribute(name, String(value));
}

export function setAttrs(el: Element, attrs: Record<string, number | string>) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
}

// ====== Event Utilities ======

export type ClientXYEvent = {
  clientX?: number;
  clientY?: number;
  touches?: Array<{ clientX: number; clientY: number }> | TouchList;
};

export function getClientXY(evt: ClientXYEvent) {
  const t = (evt as any).touches?.[0];
  const x = (evt as any).clientX ?? t?.clientX ?? 0;
  const y = (evt as any).clientY ?? t?.clientY ?? 0;
  return { x, y };
}

// ====== SVG Utilities ======

export function ensureSvgGroup(svg: SVGSVGElement, id: string): SVGGElement {
  const existing = document.getElementById(id);
  if (existing) {
    if (existing instanceof SVGGElement) {
      return existing;
    }
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
    g.setAttribute('id', id);
    existing.replaceWith(g);
    return g;
  }
  if (!svg) throw new Error(`Missing <svg id="svg"> root; cannot create #${id}`);
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
  g.setAttribute('id', id);
  svg.appendChild(g);
  return g;
}

// ====== Color Utilities ======

export function colorToHex(cstr: string): string {
  const tmp = document.createElement('span');
  tmp.style.color = cstr;
  document.body.appendChild(tmp);
  const rgb = getComputedStyle(tmp).color;
  document.body.removeChild(tmp);
  const m = rgb.match(/\d+/g);
  if (!m) return '#000000';
  const [r, g, b] = m.map(n => Math.max(0, Math.min(255, parseInt(n, 10))));
  const hx = v => v.toString(16).padStart(2, '0').toUpperCase();
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

export function cssToRGBA01(css: string): { r: number; g: number; b: number; a: number } {
  const tmp = document.createElement('span');
  tmp.style.color = css;
  document.body.appendChild(tmp);
  const computed = getComputedStyle(tmp).color;
  document.body.removeChild(tmp);
  const m = computed.match(/[\d.]+/g);
  if (!m) return { r: 0, g: 0, b: 0, a: 1 };
  const [r, g, b, a = 1] = m.map(Number);
  return { r: r / 255, g: g / 255, b: b / 255, a };
}

export function rgba01ToCss(c: { r: number; g: number; b: number; a: number }): string {
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
}

// ====== Geometry Utilities ======

export const deg = (rad: number): number => rad * 180 / Math.PI;
export const normDeg = (d: number): number => ((d % 360) + 360) % 360;

export function rotatePoint(p: { x: number; y: number }, center: { x: number; y: number }, deg: number) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = p.x - center.x, dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

export const eqPt = (p: { x: number; y: number }, q: { x: number; y: number }) => 
  p.x === q.x && p.y === q.y;

export function pointToSegmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + t * dx, qy = a.y + t * dy;
  return Math.sqrt((p.x - qx) ** 2 + (p.y - qy) ** 2);
}

export function projectPointToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): { x: number; y: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { ...a };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function segmentAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return deg(Math.atan2(b.y - a.y, b.x - a.x));
}

export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function inRect(
  p: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number }
): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function segsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  q1: { x: number; y: number },
  q2: { x: number; y: number }
): boolean {
  const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  return ccw(p1, q1, q2) !== ccw(p2, q1, q2) && ccw(p1, p2, q1) !== ccw(p1, p2, q2);
}

export function segmentIntersectsRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number }
): boolean {
  if (inRect(a, r) || inRect(b, r)) return true;
  const tl = { x: r.x, y: r.y };
  const tr = { x: r.x + r.w, y: r.y };
  const bl = { x: r.x, y: r.y + r.h };
  const br = { x: r.x + r.w, y: r.y + r.h };
  return segsIntersect(a, b, tl, tr) || segsIntersect(a, b, tr, br) ||
         segsIntersect(a, b, br, bl) || segsIntersect(a, b, bl, tl);
}

// ====== Misc Utilities ======

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
