// wires.ts - Wire operations and management
// Handles wire breaking, mending, normalization, unification, vertex manipulation

import { Point, Wire } from './types.js';
import { dist2, keyPt, projectPointToSegmentWithT, nearestPointOnSegment, collapseDuplicateVertices as geomCollapseDuplicates } from './geometry.js';

// ========================================================================================
// ===== WIRE BREAKING & MENDING =====
// ========================================================================================

/**
 * Break wires at all component pin positions.
 * Returns true if any wire was broken.
 */
export function breakWiresAtPins(pins: Point[], wires: Wire[], uid: (prefix: string) => string, snapToBaseScalar: (v: number) => number, GRID: number): { wires: Wire[], broke: boolean } {
  let broke = false;
  let updatedWires = [...wires];
  
  for (const pin of pins) {
    const result = breakNearestWireAtPin(pin, updatedWires, uid, snapToBaseScalar, GRID);
    updatedWires = result.wires;
    if (result.broke) broke = true;
  }
  
  return { wires: updatedWires, broke };
}

/**
 * Break nearest wire at a specific pin position.
 * Splits wire segment if pin is on or near it (within tolerance).
 */
export function breakNearestWireAtPin(pin: Point, wires: Wire[], uid: (prefix: string) => string, snapToBaseScalar: (v: number) => number, GRID: number): { wires: Wire[], broke: boolean } {
  const pointToSegmentDistance = (p: Point, a: Point, b: Point) => {
    const nearest = nearestPointOnSegment(p, a, b);
    return Math.hypot(p.x - nearest.x, p.y - nearest.y);
  };
  
  // Break ALL wire segments that should be split at this pin location
  // Collect segments that need breaking to avoid modifying array during iteration
  const segmentsToBreak: Array<{ w: Wire, i: number, bp: Point }> = [];
  
  for (const w of wires) {
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], b = w.points[i + 1];
      const { proj, t } = projectPointToSegmentWithT(pin, a, b);
      const dist = pointToSegmentDistance(pin, a, b);
      
      // Check if pin is exactly at an endpoint
      const EPS = 1e-2;
      const atStart = Math.hypot(pin.x - a.x, pin.y - a.y) < EPS;
      const atEnd = Math.hypot(pin.x - b.x, pin.y - b.y) < EPS;
      
      // axis-aligned fallback for robust vertical/horizontal splitting
      const isVertical = (a.x === b.x);
      const isHorizontal = (a.y === b.y);
      const withinVert = isVertical && Math.abs(pin.x - a.x) <= GRID / 2 && pin.y > Math.min(a.y, b.y) && pin.y < Math.max(a.y, b.y);
      const withinHorz = isHorizontal && Math.abs(pin.y - a.y) <= GRID / 2 && pin.x > Math.min(a.x, b.x) && pin.x < Math.max(a.x, b.x);
      const nearInterior = (t > 0.001 && t < 0.999 && dist <= 20);
      
      // Only break at true interior points (not at endpoints)
      if (!atStart && !atEnd && (withinVert || withinHorz || nearInterior)) {
        const bp = nearInterior ? { x: proj.x, y: proj.y } : { x: snapToBaseScalar(pin.x), y: snapToBaseScalar(pin.y) };
        segmentsToBreak.push({ w, i, bp });
      }
    }
  }
  
  // Now break all collected segments
  let broke = false;
  for (const { w, i, bp } of segmentsToBreak) {
    // Check if this wire still exists (might have been removed by previous break)
    if (!wires.includes(w)) continue;
    
    const left = w.points.slice(0, i + 1).concat([bp]);
    const right = [bp].concat(w.points.slice(i + 1));
    
    // replace original with normalized children (drop degenerate)
    wires = wires.filter(x => x.id !== w.id);
    const L = normalizedPolylineOrNull(left);
    const R = normalizedPolylineOrNull(right);
    if (L) wires.push({ id: uid('wire'), points: L, color: w.color, stroke: w.stroke ? { ...w.stroke } : undefined });
    if (R) wires.push({ id: uid('wire'), points: R, color: w.color, stroke: w.stroke ? { ...w.stroke } : undefined });
    broke = true;
  }
  
  return { wires, broke };
}

/**
 * Mend (join) two wires at their endpoints, creating a single merged wire.
 * Used when removing a component between two wire endpoints.
 */
export function mendWireAtPoints(hitA: { w: Wire, endIndex: number } | null, hitB: { w: Wire, endIndex: number } | null, wires: Wire[], uid: (prefix: string) => string, defaultWireColor: string): Wire[] {
  if (!hitA || !hitB) return wires;
  
  const wA = hitA.w, wB = hitB.w;
  // Orient so that aPoints ends at pinA and bPoints starts at pinB
  const aPoints = (hitA.endIndex === wA.points.length - 1) ? wA.points.slice() : wA.points.slice().reverse();
  const bPoints = (hitB.endIndex === 0) ? wB.points.slice() : wB.points.slice().reverse();
  
  // Remove the pin vertices themselves, then concatenate
  const left = aPoints.slice(0, Math.max(0, aPoints.length - 1));
  const right = bPoints.slice(1);
  const joined = left.concat(right);
  const merged = collapseDuplicateVertices(joined);
  
  // Replace the two wires with a single merged polyline
  wires = wires.filter(w => w !== wA && w !== wB);
  if (merged.length >= 2) {
    // Helper for color conversion (assumes rgba01ToCss is available in app context)
    const rgba01ToCss = (c: { r: number, g: number, b: number, a: number }) =>
      `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
    
    // prefer left-side stroke; fall back to right-side stroke; else fall back to legacy color
    const inheritedStroke = wA.stroke ? { ...wA.stroke } : (wB.stroke ? { ...wB.stroke } : undefined);
    const colorCss = inheritedStroke ? rgba01ToCss(inheritedStroke.color) : (wA.color || wB.color || defaultWireColor);
    
    // Push as per-segment wires rather than a single polyline
    for (let i = 0; i < merged.length - 1; i++) {
      const segPts = [merged[i], merged[i + 1]];
      const segStroke = inheritedStroke ? { ...inheritedStroke, color: { ...inheritedStroke.color } } : undefined;
      wires.push({ id: uid('wire'), points: segPts, color: segStroke ? rgba01ToCss(segStroke.color) : colorCss, stroke: segStroke });
    }
  }
  return wires;
}

/**
 * Find a wire endpoint near the given point (within tolerance).
 * Returns { w, endIndex } where endIndex is 0 (start) or length-1 (end).
 */
export function findWireEndpointNear(pt: Point, wires: Wire[], tol = 0.9): { w: Wire, endIndex: number } | null {
  for (const w of wires) {
    const n = w.points.length;
    if (n < 2) continue;
    if (dist2(w.points[0], pt) <= tol * tol) return { w, endIndex: 0 };
    if (dist2(w.points[n - 1], pt) <= tol * tol) return { w, endIndex: n - 1 };
  }
  return null;
}

/**
 * Delete the small bridge wire between two pins of a component (when placing/removing).
 */
export function deleteBridgeBetweenPins(pins: Point[], wires: Wire[]): Wire[] {
  if (pins.length !== 2) return wires;
  
  const a = { x: pins[0].x, y: pins[0].y };
  const b = { x: pins[1].x, y: pins[1].y };
  const EPS = 1e-3;
  const eq = (p: Point, q: Point) => Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS;
  
  return wires.filter(w => {
    if (w.points.length !== 2) return true;
    const p0 = w.points[0], p1 = w.points[1];
    const isBridge = (eq(p0, a) && eq(p1, b)) || (eq(p0, b) && eq(p1, a));
    return !isBridge;
  });
}

// ========================================================================================
// ===== WIRE NORMALIZATION & VALIDATION =====
// ========================================================================================

/**
 * Collapse consecutive duplicate vertices in a point array.
 */
export function collapseDuplicateVertices(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * Check if two points are exactly equal.
 */
function samePt(a: Point | null | undefined, b: Point | null | undefined): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

/**
 * Normalize a polyline: collapse duplicates, remove colinear points, validate length.
 * Returns null if the polyline is invalid (< 2 points or zero length).
 */
export function normalizedPolylineOrNull(pts: Point[] | null | undefined): Point[] | null {
  const c = collapseDuplicateVertices(pts || []);
  if (c.length < 2) return null;
  if (c.length === 2 && samePt(c[0], c[1])) return null; // zero-length line
  
  // Remove intermediate colinear points so straight runs collapse to two-point segments
  if (c.length > 2) {
    const out: Point[] = [];
    out.push(c[0]);
    for (let i = 1; i < c.length - 1; i++) {
      const a = out[out.length - 1];
      const b = c[i];
      const d = c[i + 1];
      // Check colinearity via cross product: (b-a) x (d-b) == 0
      const v1x = b.x - a.x, v1y = b.y - a.y;
      const v2x = d.x - b.x, v2y = d.y - b.y;
      if ((v1x * v2y - v1y * v2x) === 0) {
        // b is colinear; skip it
        continue;
      } else {
        out.push(b);
      }
    }
    out.push(c[c.length - 1]);
    if (out.length < 2) return null;
    return out;
  }
  return c;
}

/**
 * Normalize all wires: convert each polyline into one or more 2-point segment wires.
 * Each straight segment gets its own persistent id and stroke.
 */
export function normalizeAllWires(wires: Wire[], uid: (prefix: string) => string, defaultWireColor: string): Wire[] {
  const next: Wire[] = [];
  for (const w of wires) {
    const c = normalizedPolylineOrNull(w.points);
    if (!c) continue;
    if (c.length === 2) {
      // Already a single segment — preserve id to keep stability where possible
      next.push({ 
        id: w.id, 
        points: c, 
        color: w.color || defaultWireColor, 
        stroke: w.stroke, 
        netId: (w as any).netId || 'default' 
      } as Wire);
    } else {
      // Break into per-segment wires. Each segment gets a fresh id.
      for (let i = 0; i < c.length - 1; i++) {
        const pts = [c[i], c[i + 1]];
        next.push({ 
          id: uid('wire'), 
          points: pts, 
          color: w.color || defaultWireColor, 
          stroke: w.stroke ? { ...w.stroke } : undefined, 
          netId: (w as any).netId || 'default' 
        } as Wire);
      }
    }
  }
  return next;
}

// ========================================================================================
// ===== WIRE SEGMENT OPERATIONS =====
// ========================================================================================

/**
 * Split a polyline by removing segments at specified indices.
 * Returns array of normalized point arrays (each ≥ 2 points).
 */
export function splitPolylineByRemovedSegments(pts: Point[], removeIdxSet: Set<number>): Point[][] {
  if (!pts || pts.length < 2) return [];
  const out: Point[][] = [];
  let cur = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    if (removeIdxSet.has(i)) {
      // close current piece before the removed segment
      if (cur.length >= 2) {
        const np = normalizedPolylineOrNull(cur);
        if (np) out.push(np);
      }
      // start a new piece after the removed segment
      cur = [pts[i + 1]];
    } else {
      cur.push(pts[i + 1]);
    }
  }
  if (cur.length >= 2) {
    const np = normalizedPolylineOrNull(cur);
    if (np) out.push(np);
  }
  return out;
}

/**
 * Split a polyline keeping ONLY segments at specified indices.
 * Returns array of normalized point arrays (each ≥ 2 points).
 */
export function splitPolylineByKeptSegments(pts: Point[], keepIdxSet: Set<number>): Point[][] {
  if (!pts || pts.length < 2) return [];
  const out: Point[][] = [];
  let cur: Point[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (keepIdxSet.has(i)) {
      if (cur.length === 0) cur.push({ x: a.x, y: a.y });
      cur.push({ x: b.x, y: b.y });
    } else {
      if (cur.length >= 2) {
        const np = normalizedPolylineOrNull(cur);
        if (np) out.push(np);
      }
      cur = [];
    }
  }
  if (cur.length >= 2) {
    const np = normalizedPolylineOrNull(cur);
    if (np) out.push(np);
  }
  return out;
}

/**
 * Isolate a single segment from a multi-point wire, splitting it into up to 3 pieces.
 * Returns the new middle wire (the isolated segment) or the original if already a single segment.
 */
export function isolateWireSegment(w: Wire, segIndex: number, wires: Wire[], uid: (prefix: string) => string): { wires: Wire[], midWire: Wire | null } {
  if (!w) return { wires, midWire: null };
  if (!Number.isInteger(segIndex) || segIndex < 0 || segIndex >= (w.points.length - 1)) 
    return { wires, midWire: null };
  
  // If the wire already consists of a single segment, nothing to do.
  if (w.points.length === 2) return { wires, midWire: w };

  const leftPts = w.points.slice(0, segIndex + 1);
  const midPts = w.points.slice(segIndex, segIndex + 2);
  const rightPts = w.points.slice(segIndex + 1);

  const L = normalizedPolylineOrNull(leftPts);
  const M = normalizedPolylineOrNull(midPts);
  const R = normalizedPolylineOrNull(rightPts);

  // Remove the original wire and insert the pieces in its place
  wires = wires.filter(x => x.id !== w.id);
  let midWire: Wire | null = null;
  const pushPiece = (pts: Point[] | null): Wire | null => {
    if (!pts) return null;
    const nw: Wire = { 
      id: uid('wire'), 
      points: pts, 
      color: w.color, 
      stroke: w.stroke ? { ...w.stroke } : undefined, 
      netId: (w as any).netId || 'default' 
    } as Wire;
    wires.push(nw);
    return nw;
  };

  // Preserve ordering: left, mid, right
  if (L) pushPiece(L);
  if (M) midWire = pushPiece(M);
  if (R) pushPiece(R);

  return { wires, midWire };
}

// ========================================================================================
// ===== WIRE UNIFICATION (COLLINEAR MERGING) =====
// ========================================================================================

/**
 * Get all component pin positions as a set of string keys.
 */
function allPinKeys(components: any[], compPinPositions: (c: any) => Point[]): Set<string> {
  const s = new Set<string>();
  for (const c of components) {
    const pins = compPinPositions(c).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    for (const p of pins) s.add(keyPt(p));
  }
  return s;
}

/**
 * Determine axis alignment at a wire endpoint (x or y axis).
 */
function axisAtEndpoint(w: Wire, endIndex: number): 'x' | 'y' | null {
  const n = w.points.length;
  if (n < 2) return null;
  const a = w.points[endIndex];
  const b = (endIndex === 0) ? w.points[1] : w.points[n - 2];
  if (a.y === b.y) return 'x';
  if (a.x === b.x) return 'y';
  return null;
}

/**
 * Build a map of wire endpoints grouped by position key.
 */
function endpointPairsByKey(wires: Wire[]): Map<string, Array<{ w: Wire, endIndex: number, axis: 'x' | 'y' | null, other: Point }>> {
  const map = new Map<string, Array<{ w: Wire, endIndex: number, axis: 'x' | 'y' | null, other: Point }>>();
  for (const w of wires) {
    const n = w.points.length;
    if (n < 2) continue;
    const ends = [0, n - 1];
    for (const endIndex of ends) {
      const p = w.points[endIndex];
      const key = keyPt({ x: Math.round(p.x), y: Math.round(p.y) });
      const ax = axisAtEndpoint(w, endIndex);
      const other = (endIndex === 0) ? w.points[1] : w.points[n - 2];
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ w, endIndex, axis: ax, other });
    }
  }
  return map;
}

/**
 * Unify inline wires: merge collinear wire segments that meet end-to-end.
 * Excludes merges across component pins. Iterates until no more merges possible.
 */
export function unifyInlineWires(
  wires: Wire[], 
  components: any[], 
  compPinPositions: (c: any) => Point[], 
  snapToBaseScalar: (v: number) => number,
  uid: (prefix: string) => string,
  defaultWireColor: string
): Wire[] {
  const pinKeys = allPinKeys(components, compPinPositions);
  
  // Iterate merges until stable, but guard against pathological loops.
  const MAX_ITER = 200;
  let iter = 0;
  const seen = new Set<string>();
  
  while (iter < MAX_ITER) {
    iter++;
    let mergedThisPass = false;

    // detect repeated global state to avoid endless cycles
    const sig = wires.map(w => `${w.id}:${w.points.map(p => keyPt(p)).join('|')}`).join(';');
    if (seen.has(sig)) {
      console.warn('unifyInlineWires: detected repeating state, aborting merge loop', { iter, sig });
      break;
    }
    seen.add(sig);

    const pairs = endpointPairsByKey(wires);
    
    // Try to merge exactly-two-endpoint nodes that are collinear and not at a component pin.
    for (const [key, list] of pairs) {
      if (pinKeys.has(key)) continue;          // never merge across component pins
      if (list.length !== 2) continue;         // only consider clean 1:1 joins
      const a = list[0], b = list[1];
      if (a.w === b.w) continue;               // ignore self-joins
      if (!a.axis || !b.axis) continue;        // must both be axis-aligned
      if (a.axis !== b.axis) continue;         // must be the same axis

      // Choose the "existing/first" wire as primary by their order in the wires array
      const idxA = wires.indexOf(a.w);
      const idxB = wires.indexOf(b.w);
      
      // If either wire reference is no longer present, skip this stale pair
      if (idxA === -1 || idxB === -1) continue;
      
      const primary = (idxA <= idxB) ? a : b;
      const secondary = (primary === a) ? b : a;

      // Orient primary (left) so it ENDS at the join, secondary (right) so it STARTS at the join
      const lp = primary.w.points.map(p => ({ x: snapToBaseScalar(p.x), y: snapToBaseScalar(p.y) }));
      const rp = secondary.w.points.map(p => ({ x: snapToBaseScalar(p.x), y: snapToBaseScalar(p.y) }));
      const lPts = (primary.endIndex === lp.length - 1) ? lp : lp.reverse();
      const rPts = (secondary.endIndex === 0) ? rp : rp.reverse();

      const mergedPts = lPts.concat(rPts.slice(1));  // drop duplicate join point
      const merged = normalizedPolylineOrNull(mergedPts);
      if (!merged) continue;

      // Prefer primary's stroke; else secondary's; else default
      const mergedStroke = primary.w.stroke ? { ...primary.w.stroke } : (secondary.w.stroke ? { ...secondary.w.stroke } : undefined);
      const mergedColor = primary.w.color || secondary.w.color || defaultWireColor;

      // Remove both old wires, push merged segments
      wires = wires.filter(w => w !== primary.w && w !== secondary.w);
      for (let i = 0; i < merged.length - 1; i++) {
        wires.push({
          id: uid('wire'),
          points: [merged[i], merged[i + 1]],
          color: mergedColor,
          stroke: mergedStroke ? { ...mergedStroke } : undefined,
          netId: (primary.w as any).netId || 'default'
        } as Wire);
      }

      mergedThisPass = true;
      break; // Restart scan after a successful merge
    }

    if (!mergedThisPass) break; // No more merges possible
  }

  return wires;
}

// ========================================================================================
// ===== WIRE QUERY HELPERS =====
// ========================================================================================

/**
 * Find all wires whose endpoints match the given point.
 */
export function wiresEndingAt(pt: Point, wires: Wire[]): Wire[] {
  const eqPt = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3;
  return wires.filter(w => {
    const a = w.points[0], b = w.points[w.points.length - 1];
    return eqPt(a, pt) || eqPt(b, pt);
  });
}

/**
 * Get the opposite endpoint of a wire given one endpoint.
 */
export function otherEndpointOf(w: Wire, endPt: Point): Point {
  const eqPt = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3;
  const a = w.points[0], b = w.points[w.points.length - 1];
  return eqPt(a, endPt) ? b : a;
}

/**
 * Get the vertex adjacent to an endpoint (the second or second-to-last point).
 */
export function adjacentOther(w: Wire, endPt: Point): Point | null {
  const eqPt = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3;
  const n = w.points.length;
  if (n < 2) return null;
  if (eqPt(w.points[0], endPt)) return w.points[1];
  if (eqPt(w.points[n - 1], endPt)) return w.points[n - 2];
  return null;
}
