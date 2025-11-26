// ================================================================================
// GEOMETRY UTILITIES
// ================================================================================
//
// This module provides geometric calculations, point/line operations, and
// snapping utilities for the schematic editor.
//
// ================================================================================
// ====== Point Comparison & Keys ======
/**
 * Create a unique key string for a point (rounded coordinates)
 */
export const keyPt = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;
/**
 * Compare two numbers with epsilon tolerance
 */
export const eqN = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;
/**
 * Compare two points with epsilon tolerance
 */
export function eqPtEps(a, b, eps = 0.75) {
    return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}
/**
 * Exact point comparison (no epsilon)
 */
export function samePt(a, b) {
    return !!a && !!b && a.x === b.x && a.y === b.y;
}
// ====== Distance & Projection ======
/**
 * Squared distance between two points
 */
export function dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}
/**
 * Distance between two points
 */
export function dist(a, b) {
    return Math.sqrt(dist2(a, b));
}
/**
 * Project point p onto line segment ab, returns {proj: Point, t: number}
 * t = 0 at a, t = 1 at b
 */
export function projectPointToSegmentWithT(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0)
        return { proj: { x: a.x, y: a.y }, t: 0 };
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    return {
        proj: { x: a.x + t * dx, y: a.y + t * dy },
        t
    };
}
/**
 * Find the nearest point on a line segment to a given point
 */
export function nearestPointOnSegment(p, a, b) {
    return projectPointToSegmentWithT(p, a, b).proj;
}
// ====== Point Array Utilities ======
/**
 * Find index of point in array with epsilon tolerance
 */
export function indexOfPointEps(pts, p, eps = 0.75) {
    for (let i = 0; i < pts.length; i++) {
        if (eqPtEps(pts[i], p, eps))
            return i;
    }
    return -1;
}
/**
 * Remove consecutive duplicate points from array
 */
export function collapseDuplicateVertices(pts) {
    const out = [];
    for (const p of pts) {
        const last = out[out.length - 1];
        if (!last || last.x !== p.x || last.y !== p.y) {
            out.push({ x: p.x, y: p.y });
        }
    }
    return out;
}
/**
 * Return a copy of points ordered to end at specified pin
 * If pin is interior, keep only the side up to the pin
 */
export function orderPointsEndingAt(pts, pin) {
    const n = pts.length;
    if (n === 0)
        return pts.slice();
    if (eqPtEps(pts[n - 1], pin))
        return pts.slice();
    if (eqPtEps(pts[0], pin))
        return pts.slice().reverse();
    const k = indexOfPointEps(pts, pin);
    return (k >= 0) ? pts.slice(0, k + 1) : pts.slice();
}
/**
 * Return a copy of points ordered to start at specified pin
 * If pin is interior, keep only the side from the pin
 */
export function orderPointsStartingAt(pts, pin) {
    const n = pts.length;
    if (n === 0)
        return pts.slice();
    if (eqPtEps(pts[0], pin))
        return pts.slice();
    if (eqPtEps(pts[n - 1], pin))
        return pts.slice().reverse();
    const k = indexOfPointEps(pts, pin);
    return (k >= 0) ? pts.slice(k) : pts.slice();
}
// ====== Polyline Normalization ======
/**
 * Normalize polyline by removing duplicates and colinear points
 * Returns null if invalid (< 2 points or zero-length)
 */
export function normalizedPolylineOrNull(pts) {
    const c = collapseDuplicateVertices(pts || []);
    if (c.length < 2)
        return null;
    if (c.length === 2 && samePt(c[0], c[1]))
        return null; // zero-length line
    // Remove intermediate colinear points
    if (c.length > 2) {
        const out = [];
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
            }
            else {
                out.push(b);
            }
        }
        out.push(c[c.length - 1]);
        if (out.length < 2)
            return null;
        return out;
    }
    return c;
}
// ====== Segment Finding ======
/**
 * Find nearest segment in polyline to a point
 * Returns {index, distance, proj} or null if none within maxDist
 */
export function nearestSegmentIndex(pts, p) {
    if (pts.length < 2)
        return null;
    let bestIdx = 0;
    let bestDist = Infinity;
    let bestProj = pts[0];
    for (let i = 0; i < pts.length - 1; i++) {
        const { proj } = projectPointToSegmentWithT(p, pts[i], pts[i + 1]);
        const d = dist(p, proj);
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
            bestProj = proj;
        }
    }
    return { index: bestIdx, dist: bestDist, proj: bestProj };
}
/**
 * Get midpoint of a segment in a polyline
 */
export function midOfSeg(pts, idx) {
    const a = pts[idx];
    const b = pts[idx + 1];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
// ====== Line Intersection ======
/**
 * Check if two axis-aligned segments intersect
 * Returns intersection point or null
 */
export function axisAlignedIntersection(a1, a2, b1, b2) {
    // Check if a is vertical and b is horizontal
    if (a1.x === a2.x && b1.y === b2.y) {
        const x = a1.x;
        const y = b1.y;
        if (Math.min(a1.y, a2.y) <= y && y <= Math.max(a1.y, a2.y) &&
            Math.min(b1.x, b2.x) <= x && x <= Math.max(b1.x, b2.x)) {
            return { x, y };
        }
    }
    // Check if a is horizontal and b is vertical
    else if (a1.y === a2.y && b1.x === b2.x) {
        const x = b1.x;
        const y = a1.y;
        if (Math.min(a1.x, a2.x) <= x && x <= Math.max(a1.x, a2.x) &&
            Math.min(b1.y, b2.y) <= y && y <= Math.max(b1.y, b2.y)) {
            return { x, y };
        }
    }
    return null;
}
//# sourceMappingURL=geometry.js.map