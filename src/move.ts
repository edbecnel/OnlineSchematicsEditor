// move.ts - Component and wire movement logic
// Handles SWP-based component movement, slide contexts, and collision detection

import type {
  Component, Wire, Point, Axis, Selection, MoveCollapseCtx, Stroke
} from './types.js';
import type { SWP, Topology } from './topology.js';

// Context interface for movement operations
export interface MoveContext {
  // State
  components: Component[];
  wires: Wire[];
  selection: Selection;
  moveCollapseCtx: MoveCollapseCtx | null;
  lastMoveCompId: string | null;
  topology: Topology;

  // Functions - geometry
  snap: (val: number) => number;
  snapToBaseScalar: (val: number) => number;
  eqPt: (a: Point, b: Point) => boolean;
  eqPtEps: (a: Point, b: Point, eps?: number) => boolean;
  eqN: (a: number, b: number, eps?: number) => boolean;
  keyPt: (p: Point) => string;

  // Functions - component operations
  compPinPositions: (c: Component) => Point[];
  wiresEndingAt: (pt: Point) => Wire[];
  adjacentOther: (w: Wire, pt: Point) => Point | null;

  // Functions - state mutation
  pushUndo: () => void;
  redraw: () => void;
  redrawCanvasOnly: () => void;
  uid: (prefix: string) => string;

  // Functions - topology
  rebuildTopology: () => void;
  findSwpById: (id: string) => SWP | null;
  swpIdForComponent: (c: Component) => string | null;

  // Functions - rendering
  updateComponentDOM: (c: Component) => void;
  updateWireDOM: (w: Wire) => void;
  setAttr: (el: Element, attr: string, val: any) => void;
  buildSymbolGroup: (c: Component) => SVGGElement;
  rgba01ToCss: (c: { r: number; g: number; b: number; a: number }) => string;

  // Functions - wire operations
  ensureStroke: (w: Wire) => void;
  pointToSegmentDistance: (p: Point, a: Point, b: Point) => number;
}

// Helper to check if a component is embedded (both pins connected to single wires)
export function isEmbedded(ctx: MoveContext, c: Component): boolean {
  const pins = ctx.compPinPositions(c).map(p => ({
    x: ctx.snapToBaseScalar(p.x),
    y: ctx.snapToBaseScalar(p.y)
  }));
  if (pins.length < 2) return false;
  return ctx.wiresEndingAt(pins[0]).length === 1 && ctx.wiresEndingAt(pins[1]).length === 1;
}

// Helper to check if a component overlaps any other component
export function overlapsAnyOther(ctx: MoveContext, c: Component): boolean {
  const R = 56; // same as selection outline radius
  for (const o of ctx.components) {
    if (o.id === c.id) continue;
    const dx = o.x - c.x, dy = o.y - c.y;
    if ((dx * dx + dy * dy) < (R * R)) return true;
  }
  return false;
}

// Test overlap if 'c' were at (x,y) without committing the move
export function overlapsAnyOtherAt(ctx: MoveContext, c: Component, x: number, y: number): boolean {
  const R = 56;
  for (const o of ctx.components) {
    if (o.id === c.id) continue;
    const dx = o.x - x, dy = o.y - y;
    if ((dx * dx + dy * dy) < (R * R)) return true;
  }
  return false;
}

// Prevent a component's pins from landing exactly on another component's pins
export function pinsCoincideAnyAt(ctx: MoveContext, c: Component, x: number, y: number, eps: number = 0.75): boolean {
  // Compute THIS component's pins if its center were at (x,y)
  const ghost = { ...c, x, y };
  const myPins = ctx.compPinPositions(ghost).map(p => ({
    x: ctx.snap(p.x),
    y: ctx.snap(p.y)
  }));
  for (const o of ctx.components) {
    if (o.id === c.id) continue;
    const oPins = ctx.compPinPositions(o).map(p => ({
      x: ctx.snap(p.x),
      y: ctx.snap(p.y)
    }));
    for (const mp of myPins) {
      for (const op of oPins) {
        if (ctx.eqPtEps(mp, op, eps)) return true;
      }
    }
  }
  return false;
}

// Determine axis from a 2-pin part's pin positions ('x' = horizontal, 'y' = vertical)
export function axisFromPins(pins: Point[] | Array<{ x: number; y: number }>): Axis {
  if (!pins || pins.length < 2) return null;
  if (pins[0].y === pins[1].y) return 'x';
  if (pins[0].x === pins[1].x) return 'y';
  return null;
}

// Pick the wire at 'pt' that runs along the given axis (ignores branches at junctions)
export function wireAlongAxisAt(ctx: MoveContext, pt: Point, axis: Axis): Wire | null {
  const ws = ctx.wiresEndingAt(pt);
  for (const w of ws) {
    const adj = ctx.adjacentOther(w, pt);
    if (!adj) continue;
    if (axis === 'x' && adj.y === pt.y) return w;   // horizontal wire
    if (axis === 'y' && adj.x === pt.x) return w;   // vertical wire
  }
  return null;
}

// Build a slide context for constrained component movement along wires
export function buildSlideContext(ctx: MoveContext, c: Component): any {
  // only for simple 2-pin parts
  if (!['resistor', 'capacitor', 'inductor', 'diode', 'battery', 'ac'].includes(c.type)) return null;
  const pins = ctx.compPinPositions(c).map(p => ({
    x: ctx.snapToBaseScalar(p.x),
    y: ctx.snapToBaseScalar(p.y)
  }));
  if (pins.length !== 2) return null;
  const axis = axisFromPins(pins);
  if (!axis) return null;
  const wA = wireAlongAxisAt(ctx, pins[0], axis);
  const wB = wireAlongAxisAt(ctx, pins[1], axis);
  if (!wA || !wB) return null;
  const aAdj = ctx.adjacentOther(wA, pins[0]);
  const bAdj = ctx.adjacentOther(wB, pins[1]);
  if (!aAdj || !bAdj) return null;
  if (axis === 'x') {
    const fixed = pins[0].y;
    const min = Math.min(aAdj.x, bAdj.x);
    const max = Math.max(aAdj.x, bAdj.x);
    return { axis: 'x', fixed, min, max, wA, wB, pinAStart: pins[0], pinBStart: pins[1] };
  } else {
    const fixed = pins[0].x;
    const min = Math.min(aAdj.y, bAdj.y);
    const max = Math.max(aAdj.y, bAdj.y);
    return { axis: 'y', fixed, min, max, wA, wB, pinAStart: pins[0], pinBStart: pins[1] };
  }
}

// Adjust wire endpoint from old position to new position
export function adjustWireEnd(ctx: MoveContext, w: Wire, oldEnd: Point, newEnd: Point): void {
  // replace whichever endpoint equals oldEnd with newEnd
  if (ctx.eqPt(w.points[0], oldEnd)) w.points[0] = { ...newEnd };
  else if (ctx.eqPt(w.points[w.points.length - 1], oldEnd)) w.points[w.points.length - 1] = { ...newEnd };
}

// Replace a matching endpoint in w with newEnd, preserving all other vertices
export function replaceEndpoint(ctx: MoveContext, w: Wire, oldEnd: Point, newEnd: Point): void {
  if (ctx.eqPt(w.points[0], oldEnd)) {
    w.points[0] = { ...newEnd };
    // collapse duplicate vertex if needed
    if (w.points.length > 1 && ctx.eqPt(w.points[0], w.points[1])) w.points.shift();
  } else if (ctx.eqPt(w.points[w.points.length - 1], oldEnd)) {
    w.points[w.points.length - 1] = { ...newEnd };
    if (w.points.length > 1 && ctx.eqPt(w.points[w.points.length - 1], w.points[w.points.length - 2])) w.points.pop();
  }
}

// Move selected component by dx, dy (handles arrow keys & clamping)
export function moveSelectedBy(ctx: MoveContext, dx: number, dy: number): void {
  ctx.pushUndo();
  const c = ctx.components.find(x => x.id === ctx.selection.id);
  if (!c) return;
  
  // If an SWP is collapsed for THIS component, move along that SWP with proper clamps
  if (ctx.moveCollapseCtx && ctx.moveCollapseCtx.kind === 'swp' && ctx.swpIdForComponent(c) === ctx.moveCollapseCtx.sid) {
    const mc = ctx.moveCollapseCtx;
    if (mc.axis === 'x') {
      let nx = ctx.snap(c.x + dx);
      nx = Math.max(mc.minCenter, Math.min(mc.maxCenter, nx));
      if (!overlapsAnyOtherAt(ctx, c, nx, mc.fixed) && !pinsCoincideAnyAt(ctx, c, nx, mc.fixed)) {
        c.x = nx;
        c.y = mc.fixed;
        mc.lastCenter = nx;
      }
    } else {
      let ny = ctx.snap(c.y + dy);
      ny = Math.max(mc.minCenter, Math.min(mc.maxCenter, ny));
      if (!overlapsAnyOtherAt(ctx, c, mc.fixed, ny) && !pinsCoincideAnyAt(ctx, c, mc.fixed, ny)) {
        c.y = ny;
        c.x = mc.fixed;
        mc.lastCenter = ny;
      }
    }
    ctx.redrawCanvasOnly();
    return;
  }
  
  const slideCtx = buildSlideContext(ctx, c);
  if (slideCtx) {
    // slide along constrained axis
    if (slideCtx.axis === 'x') {
      let nx = ctx.snap(c.x + dx);
      nx = Math.max(Math.min(slideCtx.max, nx), slideCtx.min);
      if (!overlapsAnyOtherAt(ctx, c, nx, slideCtx.fixed) && !pinsCoincideAnyAt(ctx, c, nx, slideCtx.fixed)) {
        c.x = nx;
        c.y = slideCtx.fixed;
      }
    } else {
      let ny = ctx.snap(c.y + dy);
      ny = Math.max(Math.min(slideCtx.max, ny), slideCtx.min);
      if (!overlapsAnyOtherAt(ctx, c, slideCtx.fixed, ny) && !pinsCoincideAnyAt(ctx, c, slideCtx.fixed, ny)) {
        c.y = ny;
        c.x = slideCtx.fixed;
      }
    }
    const pins = ctx.compPinPositions(c).map(p => ({
      x: ctx.snapToBaseScalar(p.x),
      y: ctx.snapToBaseScalar(p.y)
    }));
    adjustWireEnd(ctx, slideCtx.wA, slideCtx.pinAStart, pins[0]);
    adjustWireEnd(ctx, slideCtx.wB, slideCtx.pinBStart, pins[1]);
    slideCtx.pinAStart = pins[0];
    slideCtx.pinBStart = pins[1];
    ctx.redraw();
  } else {
    const nx = ctx.snap(c.x + dx), ny = ctx.snap(c.y + dy);
    if (!overlapsAnyOtherAt(ctx, c, nx, ny) && !pinsCoincideAnyAt(ctx, c, nx, ny)) {
      c.x = nx;
      c.y = ny;
    }
    ctx.redrawCanvasOnly();
  }
}

// Update component DOM elements during drag (lightweight, no full redraw)
export function updateComponentDOM(ctx: MoveContext, c: Component, gComps: SVGGElement): void {
  const g = gComps.querySelector(`g.comp[data-id="${c.id}"]`);
  if (!g) return;
  
  // selection outline & hit rect
  const outline = g.querySelector('[data-outline]');
  if (outline) {
    outline.setAttribute('cx', String(c.x));
    outline.setAttribute('cy', String(c.y));
  }
  const hit = g.querySelector('rect');
  if (hit) {
    ctx.setAttr(hit, 'x', c.x - 60);
    ctx.setAttr(hit, 'y', c.y - 60);
  }

  // pins
  const pins = ctx.compPinPositions(c);
  const pinEls = g.querySelectorAll('circle[data-pin]');
  for (let i = 0; i < Math.min(pinEls.length, pins.length); i++) {
    ctx.setAttr(pinEls[i], 'cx', pins[i].x);
    ctx.setAttr(pinEls[i], 'cy', pins[i].y);
  }
  
  // Rebuild the inner symbol group so absolute geometry (lines/paths) follows new x/y
  rebuildSymbolGroup(ctx, c, g);
}

// Replace the first-level symbol <g> inside a component with a fresh one
export function rebuildSymbolGroup(ctx: MoveContext, c: Component, g: Element): void {
  const old = g.querySelector(':scope > g'); // the inner symbol group we appended in drawComponent
  const fresh = ctx.buildSymbolGroup(c);
  if (old) g.replaceChild(fresh, old);
  else g.appendChild(fresh);
}

// Helper functions for SWP-based movement
export function compCenterAlongAxis(c: Component, axis: Axis): number {
  return axis === 'x' ? c.x : c.y;
}

export function halfPinSpan(ctx: MoveContext, c: Component, axis: Axis): number {
  const pins = ctx.compPinPositions(c);
  if (pins.length < 2) return 0;
  const span = axis === 'x' ? Math.abs(pins[1].x - pins[0].x) : Math.abs(pins[1].y - pins[0].y);
  return span / 2;
}

export function pinSpanAlongAxis(ctx: MoveContext, c: Component, axis: Axis): { lo: number; hi: number } {
  const pins = ctx.compPinPositions(c);
  if (pins.length < 2) return { lo: 0, hi: 0 };
  const vals = axis === 'x' ? [pins[0].x, pins[1].x] : [pins[0].y, pins[1].y];
  return { lo: Math.min(...vals), hi: Math.max(...vals) };
}

// Begin SWP-based move: collapse SWP to single straight wire
export function beginSwpMove(ctx: MoveContext, c: Component): MoveCollapseCtx | null {
  const sid = ctx.swpIdForComponent(c);
  if (!sid) return null;
  
  // Already collapsed for this SWP? Keep it; just remember which component we're moving
  if (ctx.moveCollapseCtx && ctx.moveCollapseCtx.kind === 'swp' && ctx.moveCollapseCtx.sid === sid) {
    ctx.lastMoveCompId = c.id;
    return ctx.moveCollapseCtx;
  }
  
  // Capture undo state before beginning move
  ctx.pushUndo();
  const swp = ctx.findSwpById(sid);
  if (!swp) return null;
  
  // Collapse the SWP: remove only the SWP's segments from their host wires (preserve perpendicular legs),
  // then add one straight polyline for the collapsed SWP
  const originalWires = JSON.parse(JSON.stringify(ctx.wires));
  const rebuilt = [];
  
  // Collect original segment strokes for the SWP so we can reassign them after move
  const originalSegments: Array<{ wireId?: string; index?: number; lo: number; hi: number; mid: number; stroke?: Stroke }> = [];
  
  // Also capture a snapshot of the full wires that contributed to this SWP
  const origWireSnapshot: Array<{ id: string; points: Point[]; stroke?: Stroke }> = [];
  
  // With per-segment wires, originalWires already contains 2-point wires
  for (const w of originalWires) {
    if (swp.edgeWireIds && swp.edgeWireIds.includes(w.id)) {
      // This segment is part of the SWP: remove it from the collapsed set and
      // record its axis-aligned extent + stroke for later remapping
      const p0 = w.points[0];
      const p1 = w.points[1];
      if (p0 && p1) {
        const lo = (swp.axis === 'x') ? Math.min(p0.x, p1.x) : Math.min(p0.y, p1.y);
        const hi = (swp.axis === 'x') ? Math.max(p0.x, p1.x) : Math.max(p0.y, p1.y);
        const mid = (lo + hi) / 2;
        originalSegments.push({ wireId: w.id, index: 0, lo, hi, mid, stroke: w.stroke } as any);
      }
      origWireSnapshot.push({ id: w.id, points: w.points.map(p => ({ x: p.x, y: p.y })), stroke: w.stroke });
    } else {
      // untouched wire (preserve full object including stroke)
      rebuilt.push(w);
    }
  }
  
  // sort original segments along axis (by midpoint)
  originalSegments.sort((a, b) => a.mid - b.mid);
  const p0 = swp.start, p1 = swp.end;
  const collapsed = {
    id: ctx.uid('wire'),
    points: [{ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }],
    color: swp.color
  };
  ctx.wires.length = 0;
  ctx.wires.push(...rebuilt, collapsed as any);

  // Compute allowed span for c (no overlap with other components in this SWP)
  const axis = swp.axis;
  const myHalf = halfPinSpan(ctx, c, axis);
  const fixed = (axis === 'x') ? p0.y : p0.x;
  const endLo = (axis === 'x') ? Math.min(p0.x, p1.x) : Math.min(p0.y, p1.y);
  const endHi = (axis === 'x') ? Math.max(p0.x, p1.x) : Math.max(p0.y, p1.y);
  
  // Other components on this SWP, build neighbor-based exclusion using real half-spans
  const others = ctx.components.filter(o => o.id !== c.id && ctx.swpIdForComponent(o) === sid)
    .map(o => ({ center: compCenterAlongAxis(o, axis), half: halfPinSpan(ctx, o, axis) }))
    .sort((a, b) => a.center - b.center);
  const t0 = compCenterAlongAxis(c, axis);
  let leftBound = endLo + myHalf, rightBound = endHi - myHalf;
  for (const o of others) {
    const gap = myHalf + o.half; // centers must be ≥ this far apart
    if (o.center <= t0) leftBound = Math.max(leftBound, o.center + gap);
    if (o.center >= t0) rightBound = Math.min(rightBound, o.center - gap);
  }
  
  // Clamp current component to the fixed line (orthogonal coordinate)
  if (axis === 'x') {
    c.y = fixed;
  } else {
    c.x = fixed;
  }
  ctx.redrawCanvasOnly(); // reflect the collapsed wire visually
  
  const moveCtx: MoveCollapseCtx = {
    kind: 'swp',
    sid,
    axis,
    fixed,
    minCenter: leftBound,
    maxCenter: rightBound,
    ends: { lo: endLo, hi: endHi },
    color: swp.color,
    collapsedId: collapsed.id,
    lastCenter: t0,
    // attached metadata: original SWP contributing segments (lo/hi in axis coords + stroke)
    originalSegments,
    origWireSnapshot
  } as any;
  
  ctx.lastMoveCompId = c.id;
  return moveCtx;
}

// Finish SWP-based move: rebuild wire segments with proper stroke assignment
export function finishSwpMove(ctx: MoveContext, c: Component): void {
  if (!ctx.moveCollapseCtx || ctx.moveCollapseCtx.kind !== 'swp') return;
  const mc = ctx.moveCollapseCtx;
  const axis = mc.axis;
  
  // Safety clamp: ensure the component's pins sit within [lo, hi]
  const myHalf = halfPinSpan(ctx, c, axis);
  let ctr = compCenterAlongAxis(c, axis);
  if (ctr - myHalf < mc.ends.lo) ctr = mc.ends.lo + myHalf;
  if (ctr + myHalf > mc.ends.hi) ctr = mc.ends.hi - myHalf;
  if (axis === 'x') {
    c.x = ctr;
    c.y = mc.fixed;
  } else {
    c.y = ctr;
    c.x = mc.fixed;
  }
  ctx.updateComponentDOM(c);
  
  const lo = mc.ends.lo, hi = mc.ends.hi;
  const EPS = 0.5;
  
  // Keep ONLY components whose two pins lie within this SWP's endpoints
  const inSwpComps = ctx.components.filter(o => {
    const pins = ctx.compPinPositions(o);
    if (axis === 'x') {
      if (!(ctx.eqN(pins[0].y, mc.fixed) && ctx.eqN(pins[1].y, mc.fixed))) return false;
      const sp = pinSpanAlongAxis(ctx, o, 'x');
      return sp.lo >= lo - EPS && sp.hi <= hi + EPS;
    } else {
      if (!(ctx.eqN(pins[0].x, mc.fixed) && ctx.eqN(pins[1].x, mc.fixed))) return false;
      const sp = pinSpanAlongAxis(ctx, o, 'y');
      return sp.lo >= lo - EPS && sp.hi <= hi + EPS;
    }
  }).sort((a, b) => compCenterAlongAxis(a, axis) - compCenterAlongAxis(b, axis));

  // Sweep lo→hi, carving gaps at each component's pin span
  const newSegs = [];
  let cursor = lo;
  for (const o of inSwpComps) {
    const sp = pinSpanAlongAxis(ctx, o, axis);
    const a = (axis === 'x') ? { x: cursor, y: mc.fixed } : { x: mc.fixed, y: cursor };
    const b = (axis === 'x') ? { x: sp.lo, y: mc.fixed } : { x: mc.fixed, y: sp.lo };
    if ((axis === 'x' ? a.x < b.x : a.y < b.y)) {
      const chosenStroke = findBestStroke(ctx, mc, a, b, axis);
      newSegs.push({
        id: ctx.uid('wire'),
        points: [a, b],
        color: chosenStroke ? ctx.rgba01ToCss(chosenStroke.color) : mc.color,
        stroke: chosenStroke
      });
    }
    cursor = sp.hi;
  }
  
  // Tail segment (last gap → end)
  const tailA = (axis === 'x') ? { x: cursor, y: mc.fixed } : { x: mc.fixed, y: cursor };
  const tailB = (axis === 'x') ? { x: hi, y: mc.fixed } : { x: mc.fixed, y: hi };
  if ((axis === 'x' ? tailA.x < tailB.x : tailA.y < tailB.y)) {
    const chosenStroke = findBestStroke(ctx, mc, tailA, tailB, axis);
    newSegs.push({
      id: ctx.uid('wire'),
      points: [tailA, tailB],
      color: chosenStroke ? ctx.rgba01ToCss(chosenStroke.color) : mc.color,
      stroke: chosenStroke
    });
  }
  
  // Replace collapsed wire with new segments
  ctx.wires = ctx.wires.filter(w => w.id !== mc.collapsedId).concat(newSegs as any);
  ctx.moveCollapseCtx = null;
  ctx.lastMoveCompId = null;
  ctx.rebuildTopology();
  ctx.redraw();
}

// Helper to find the best stroke for a wire segment based on original segments
function findBestStroke(ctx: MoveContext, mc: MoveCollapseCtx, a: Point, b: Point, axis: Axis): Stroke | undefined {
  const segMidPt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let chosenStroke: Stroke | undefined = undefined;
  
  if ((mc as any).origWireSnapshot && (mc as any).origWireSnapshot.length) {
    let bestD = Infinity;
    for (const ow of (mc as any).origWireSnapshot) {
      const pts = ow.points || [];
      for (let i = 0; i < pts.length - 1; i++) {
        const d = ctx.pointToSegmentDistance(segMidPt, pts[i], pts[i + 1]);
        if (d < bestD) {
          bestD = d;
          chosenStroke = ow.stroke;
        }
      }
    }
    
    // If closest distance is too large, attempt overlap-based match as fallback
    if (bestD > 12 && (mc as any).originalSegments && (mc as any).originalSegments.length) {
      let bestOverlap = 0;
      const segStart = axis === 'x' ? a.x : a.y;
      const segEnd = axis === 'x' ? b.x : b.y;
      const segLo = Math.min(segStart, segEnd), segHi = Math.max(segStart, segEnd);
      for (const os of (mc as any).originalSegments) {
        const ov = Math.max(0, Math.min(segHi, os.hi) - Math.max(segLo, os.lo));
        if (ov > bestOverlap) {
          bestOverlap = ov;
          chosenStroke = os.stroke;
        }
      }
      // if still none, choose nearest by midpoint
      if (!chosenStroke) {
        const segMid = (segStart + segEnd) / 2;
        let bestDist = Infinity;
        for (const os of (mc as any).originalSegments) {
          const osMid = (os.lo + os.hi) / 2;
          const d = Math.abs(segMid - osMid);
          if (d < bestDist) {
            bestDist = d;
            chosenStroke = os.stroke;
          }
        }
      }
    }
  } else if ((mc as any).originalSegments && (mc as any).originalSegments.length) {
    // fallback if no snapshot present
    let bestOverlap = 0;
    const segStart = axis === 'x' ? a.x : a.y;
    const segEnd = axis === 'x' ? b.x : b.y;
    const segLo = Math.min(segStart, segEnd), segHi = Math.max(segStart, segEnd);
    for (const os of (mc as any).originalSegments) {
      const ov = Math.max(0, Math.min(segHi, os.hi) - Math.max(segLo, os.lo));
      if (ov > bestOverlap) {
        bestOverlap = ov;
        chosenStroke = os.stroke;
      }
    }
  }
  
  return chosenStroke;
}

// Ensure SWP move is finished (cleanup function)
export function ensureFinishSwpMove(ctx: MoveContext): void {
  if (!ctx.moveCollapseCtx || ctx.moveCollapseCtx.kind !== 'swp') return;
  if (!ctx.lastMoveCompId) return;
  const c = ctx.components.find(x => x.id === ctx.lastMoveCompId);
  if (c) finishSwpMove(ctx, c);
}
