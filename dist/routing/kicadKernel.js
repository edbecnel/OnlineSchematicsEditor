// KiCad routing kernel implementation.
// Not wired into runtime by default; only used when routingkernelMode=""
import { deriveConnectivity } from './kicad/connectivity.js';
export class KiCadRoutingKernel {
    constructor() {
        this.name = 'kicad';
        this.state = { wires: [], junctions: [], pins: [], tolerance: 0.5 };
        this.connectivity = null;
        this.snapDelegate = null;
        this.placement = {
            started: false,
            mode: 'HV',
            committed: [],
            lastPreview: null,
        };
    }
    setState(state) {
        this.state = state;
        this.rebuildConnectivity();
    }
    getState() { return this.state; }
    getConnectivity() {
        if (!this.connectivity)
            this.rebuildConnectivity();
        return this.connectivity;
    }
    rebuildConnectivity() {
        this.connectivity = deriveConnectivity(this.state);
        return this.connectivity;
    }
    init() { }
    dispose() { }
    // Allow host app to provide snapping implementation (grid/object/junction, etc.)
    configureSnap(delegate) {
        this.snapDelegate = delegate;
    }
    manhattanPath(A, P, mode) {
        if (Math.abs(A.x - P.x) < 1e-6)
            return [{ x: A.x, y: A.y }, { x: A.x, y: P.y }];
        if (Math.abs(A.y - P.y) < 1e-6)
            return [{ x: A.x, y: A.y }, { x: P.x, y: A.y }];
        if (mode === 'HV')
            return [{ x: A.x, y: A.y }, { x: P.x, y: A.y }, { x: P.x, y: P.y }];
        return [{ x: A.x, y: A.y }, { x: A.x, y: P.y }, { x: P.x, y: P.y }];
    }
    snapToGridOrObject(pos, snapRadius) {
        if (this.snapDelegate)
            return this.snapDelegate(pos, snapRadius);
        return { x: pos.x, y: pos.y };
    }
    beginPlacement(start, mode) {
        const s = this.snapToGridOrObject(start);
        this.placement.started = true;
        this.placement.mode = mode;
        this.placement.committed = [s];
        this.placement.lastPreview = [s];
    }
    updatePlacement(cursor) {
        const last = this.placement.committed[this.placement.committed.length - 1];
        const cur = this.snapToGridOrObject(cursor);
        const seg = this.manhattanPath(last, cur, this.placement.mode);
        const preview = [...this.placement.committed, ...seg.slice(1)];
        this.placement.lastPreview = preview;
        return { preview };
    }
    commitCorner() {
        const preview = this.placement.lastPreview || this.placement.committed;
        if (preview.length >= 3) {
            const bend = preview[preview.length - 2];
            const end = preview[preview.length - 1];
            const tail = this.placement.committed[this.placement.committed.length - 1];
            if (!(tail.x === bend.x && tail.y === bend.y))
                this.placement.committed.push(bend);
            if (!(bend.x === end.x && bend.y === end.y))
                this.placement.committed.push(end);
        }
        return { points: [...this.placement.committed] };
    }
    finishPlacement() {
        const points = this.placement.lastPreview || [...this.placement.committed];
        const wire = { id: `w${this.state.wires.length + 1}`, points };
        this.state.wires.push(wire);
        this.rebuildConnectivity();
        this.placement.started = false;
        this.placement.lastPreview = null;
        return { points };
    }
    cancelPlacement() {
        this.placement.started = false;
        this.placement.committed = [];
    }
    dist(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }
    pointToSegmentDistance(p, a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-12) {
            return { distance: this.dist(p, a), onSegment: false };
        }
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
        const tt = Math.max(0, Math.min(1, t));
        const proj = { x: a.x + tt * dx, y: a.y + tt * dy };
        const d = this.dist(p, proj);
        return { distance: d, onSegment: t >= 0 && t <= 1 };
    }
    normalizePolyline(points, options) {
        // Remove consecutive duplicates
        const out = [];
        for (const p of points) {
            const last = out[out.length - 1];
            if (!last || last.x !== p.x || last.y !== p.y)
                out.push({ x: p.x, y: p.y });
        }
        const removeColinear = options?.removeColinear ?? true;
        if (removeColinear) {
            // Remove colinear middle points (A-B-C where A->B->C is straight)
            let changed = true;
            while (changed && out.length >= 3) {
                changed = false;
                for (let i = 1; i < out.length - 1; i++) {
                    const a = out[i - 1];
                    const b = out[i];
                    const c = out[i + 1];
                    const colinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
                    if (colinear) {
                        out.splice(i, 1);
                        changed = true;
                        break;
                    }
                }
            }
        }
        return out;
    }
    hitTest(point, tolerance = this.state.tolerance) {
        const p = point;
        const candidates = [];
        for (const pin of this.state.pins) {
            const d = this.dist(p, pin.at);
            if (d <= tolerance)
                candidates.push({ kind: 'pin', distance: d, priority: 0, payload: { pinId: pin.id } });
        }
        for (const j of this.state.junctions) {
            const d = this.dist(p, j.at);
            if (d <= tolerance)
                candidates.push({ kind: 'junction', distance: d, priority: 1, payload: { junctionId: j.id } });
        }
        for (const w of this.state.wires) {
            if (w.points.length < 2)
                continue;
            const start = w.points[0];
            const end = w.points[w.points.length - 1];
            {
                const d0 = this.dist(p, start);
                if (d0 <= tolerance)
                    candidates.push({ kind: 'wire-endpoint', distance: d0, priority: 2, payload: { wireId: w.id, endpointIndex: 0 } });
                const d1 = this.dist(p, end);
                if (d1 <= tolerance)
                    candidates.push({ kind: 'wire-endpoint', distance: d1, priority: 2, payload: { wireId: w.id, endpointIndex: 1 } });
            }
            for (let i = 1; i < w.points.length - 1; i++) {
                const d = this.dist(p, w.points[i]);
                if (d <= tolerance)
                    candidates.push({ kind: 'wire-corner', distance: d, priority: 3, payload: { wireId: w.id, pointIndex: i } });
            }
            for (let si = 0; si < w.points.length - 1; si++) {
                const a = w.points[si];
                const b = w.points[si + 1];
                const { distance, onSegment } = this.pointToSegmentDistance(p, a, b);
                if (onSegment && distance <= tolerance) {
                    candidates.push({ kind: 'wire-segment', distance, priority: 4, payload: { wireId: w.id, segmentIndex: si } });
                }
            }
        }
        if (candidates.length === 0)
            return { kind: 'none' };
        candidates.sort((a, b) => (a.distance - b.distance) || (a.priority - b.priority));
        const best = candidates[0];
        switch (best.kind) {
            case 'pin': return { kind: 'pin', pinId: best.payload.pinId, distance: best.distance };
            case 'junction': return { kind: 'junction', junctionId: best.payload.junctionId, distance: best.distance };
            case 'wire-endpoint': return { kind: 'wire-endpoint', wireId: best.payload.wireId, endpointIndex: best.payload.endpointIndex, distance: best.distance };
            case 'wire-corner': return { kind: 'wire-corner', wireId: best.payload.wireId, pointIndex: best.payload.pointIndex, distance: best.distance };
            case 'wire-segment': return { kind: 'wire-segment', wireId: best.payload.wireId, segmentIndex: best.payload.segmentIndex, distance: best.distance };
            default: return { kind: 'none' };
        }
    }
    moveWireEndpoint(wireId, endpointIndex, newPos) {
        const w = this.state.wires.find(ww => ww.id === wireId);
        if (!w)
            throw new Error(`Wire not found: ${wireId}`);
        if (w.points.length < 2)
            return { points: w.points };
        const snapped = this.snapToGridOrObject(newPos, this.state.tolerance);
        // Special-case a 2-point wire: keep it orthogonal by turning it into an L-path when needed.
        if (w.points.length === 2) {
            const other = w.points[endpointIndex === 0 ? 1 : 0];
            const start = endpointIndex === 0 ? snapped : other;
            const end = endpointIndex === 0 ? other : snapped;
            const dx = Math.abs(end.x - start.x);
            const dy = Math.abs(end.y - start.y);
            const mode = dx >= dy ? 'HV' : 'VH';
            w.points = this.normalizePolyline(this.manhattanPath(start, end, mode), { removeColinear: true });
            this.rebuildConnectivity();
            return { points: [...w.points] };
        }
        const old0 = w.points[0];
        const oldN = w.points[w.points.length - 1];
        if (endpointIndex === 0) {
            const old1 = w.points[1];
            w.points[0] = { x: snapped.x, y: snapped.y };
            // Preserve the axis of the first segment by shifting the adjacent vertex accordingly.
            if (old0.x === old1.x) {
                w.points[1] = { x: w.points[0].x, y: old1.y };
            }
            else {
                w.points[1] = { x: old1.x, y: w.points[0].y };
            }
        }
        else {
            const oldPrev = w.points[w.points.length - 2];
            w.points[w.points.length - 1] = { x: snapped.x, y: snapped.y };
            if (oldPrev.x === oldN.x) {
                w.points[w.points.length - 2] = { x: w.points[w.points.length - 1].x, y: oldPrev.y };
            }
            else {
                w.points[w.points.length - 2] = { x: oldPrev.x, y: w.points[w.points.length - 1].y };
            }
        }
        w.points = this.normalizePolyline(w.points, { removeColinear: true });
        this.rebuildConnectivity();
        return { points: [...w.points] };
    }
    dragWireSegment(wireId, segmentIndex, cursor) {
        const w = this.state.wires.find(ww => ww.id === wireId);
        if (!w)
            throw new Error(`Wire not found: ${wireId}`);
        if (segmentIndex < 0 || segmentIndex >= w.points.length - 1)
            throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
        const a = w.points[segmentIndex];
        const b = w.points[segmentIndex + 1];
        const snapped = this.snapToGridOrObject(cursor, this.state.tolerance);
        if (a.y === b.y) {
            // Horizontal: shift by Y.
            const dy = snapped.y - a.y;
            w.points[segmentIndex] = { x: a.x, y: a.y + dy };
            w.points[segmentIndex + 1] = { x: b.x, y: b.y + dy };
        }
        else if (a.x === b.x) {
            // Vertical: shift by X.
            const dx = snapped.x - a.x;
            w.points[segmentIndex] = { x: a.x + dx, y: a.y };
            w.points[segmentIndex + 1] = { x: b.x + dx, y: b.y };
        }
        else {
            throw new Error(`Non-orthogonal segment encountered for ${wireId} seg ${segmentIndex}`);
        }
        w.points = this.normalizePolyline(w.points, { removeColinear: true });
        this.rebuildConnectivity();
        return { points: [...w.points] };
    }
    insertCorner(wireId, segmentIndex, cursor) {
        const w = this.state.wires.find(ww => ww.id === wireId);
        if (!w)
            throw new Error(`Wire not found: ${wireId}`);
        if (segmentIndex < 0 || segmentIndex >= w.points.length - 1)
            throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
        const a = w.points[segmentIndex];
        const b = w.points[segmentIndex + 1];
        const snapped = this.snapToGridOrObject(cursor, this.state.tolerance);
        let ins;
        if (a.y === b.y) {
            const minX = Math.min(a.x, b.x);
            const maxX = Math.max(a.x, b.x);
            const x = Math.max(minX, Math.min(maxX, snapped.x));
            ins = { x, y: a.y };
        }
        else if (a.x === b.x) {
            const minY = Math.min(a.y, b.y);
            const maxY = Math.max(a.y, b.y);
            const y = Math.max(minY, Math.min(maxY, snapped.y));
            ins = { x: a.x, y };
        }
        else {
            throw new Error(`Non-orthogonal segment encountered for ${wireId} seg ${segmentIndex}`);
        }
        if ((ins.x === a.x && ins.y === a.y) || (ins.x === b.x && ins.y === b.y)) {
            return { points: [...w.points], inserted: false };
        }
        w.points.splice(segmentIndex + 1, 0, ins);
        // Keep the inserted vertex even if it is colinear; it is a deliberate split point.
        w.points = this.normalizePolyline(w.points, { removeColinear: false });
        this.rebuildConnectivity();
        return { points: [...w.points], inserted: true };
    }
    removeCorner(wireId, pointIndex) {
        const w = this.state.wires.find(ww => ww.id === wireId);
        if (!w)
            throw new Error(`Wire not found: ${wireId}`);
        if (pointIndex <= 0 || pointIndex >= w.points.length - 1)
            return { points: [...w.points], removed: false };
        const prev = w.points[pointIndex - 1];
        const next = w.points[pointIndex + 1];
        const mergeValid = (prev.x === next.x) || (prev.y === next.y);
        if (!mergeValid)
            return { points: [...w.points], removed: false };
        w.points.splice(pointIndex, 1);
        w.points = this.normalizePolyline(w.points, { removeColinear: true });
        this.rebuildConnectivity();
        return { points: [...w.points], removed: true };
    }
}
//# sourceMappingURL=kicadKernel.js.map