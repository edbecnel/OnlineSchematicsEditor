// KiCad routing kernel implementation.
// Not wired into runtime by default; only used when routingkernelMode=""

import type { IRoutingKernel, RoutingMode } from './types.js';
import type { RoutingState, KWire, Connectivity, KPoint } from './kicad/model.js';
import { deriveConnectivity } from './kicad/connectivity.js';

export type HitTestResult =
	| { kind: 'none' }
	| { kind: 'pin'; pinId: string; distance: number }
	| { kind: 'junction'; junctionId: string; distance: number }
	| { kind: 'wire-endpoint'; wireId: string; endpointIndex: 0 | 1; distance: number }
	| { kind: 'wire-corner'; wireId: string; pointIndex: number; distance: number }
	| { kind: 'wire-segment'; wireId: string; segmentIndex: number; distance: number };

export class KiCadRoutingKernel implements IRoutingKernel {
	readonly name: RoutingMode = 'kicad';

	private state: RoutingState = { wires: [], junctions: [], pins: [], tolerance: 0.5 };
	private connectivity: Connectivity | null = null;
	private snapDelegate: ((pos: { x: number; y: number }, snapRadius?: number) => { x: number; y: number }) | null = null;
	private lineDrawingMode: 'orthogonal' | 'free' = 'orthogonal';
	private placement = {
		started: false,
		mode: 'HV' as 'HV' | 'VH',
		committed: [] as { x: number; y: number }[],
		lastPreview: null as { x: number; y: number }[] | null,
		activeAxis: null as 'H' | 'V' | null,
		modeLockedForSegment: false,
	};

	setState(state: RoutingState) {
		this.state = state;
		this.rebuildConnectivity();
	}
	getState(): RoutingState { return this.state; }
	getConnectivity(): Connectivity {
		if (!this.connectivity) this.rebuildConnectivity();
		return this.connectivity!;
	}

	rebuildConnectivity(): Connectivity {
		this.connectivity = deriveConnectivity(this.state);
		return this.connectivity;
	}

	init(): void { /* no-op */ }
	dispose(): void { /* no-op */ }

	// Allow host app to provide snapping implementation (grid/object/junction, etc.)
	configureSnap(delegate: (pos: { x: number; y: number }, snapRadius?: number) => { x: number; y: number }) {
		this.snapDelegate = delegate;
	}

	setLineDrawingMode(mode: 'orthogonal' | 'free'): void {
		this.lineDrawingMode = mode;
		// Placement preview will reflect this on next updatePlacement call.
	}

	manhattanPath(A: { x: number; y: number }, P: { x: number; y: number }, mode: 'HV' | 'VH') {
		if (Math.abs(A.x - P.x) < 1e-6) return [{ x: A.x, y: A.y }, { x: A.x, y: P.y }];
		if (Math.abs(A.y - P.y) < 1e-6) return [{ x: A.x, y: A.y }, { x: P.x, y: A.y }];
		if (mode === 'HV') return [{ x: A.x, y: A.y }, { x: P.x, y: A.y }, { x: P.x, y: P.y }];
		return [{ x: A.x, y: A.y }, { x: A.x, y: P.y }, { x: P.x, y: P.y }];
	}

	snapToGridOrObject(pos: { x: number; y: number }, snapRadius?: number) {
		if (this.snapDelegate) return this.snapDelegate(pos, snapRadius);
		return { x: pos.x, y: pos.y };
	}

	beginPlacement(start: { x: number; y: number }, mode: 'HV' | 'VH'): void {
		const s = this.snapToGridOrObject(start);
		this.placement.started = true;
		this.placement.mode = mode;
		this.placement.committed = [s];
		this.placement.lastPreview = [s];
		this.placement.activeAxis = null;
		this.placement.modeLockedForSegment = false;
	}

	updatePlacement(cursor: { x: number; y: number }) {
		const last = this.placement.committed[this.placement.committed.length - 1];
		const cur = this.snapToGridOrObject(cursor);
		let seg: { x: number; y: number }[];
		if (this.lineDrawingMode === 'free') {
			// Free angle mode: straight line from last to cursor
			seg = [{ x: last.x, y: last.y }, { x: cur.x, y: cur.y }];
		} else {
			// Orthogonal mode with KiCad-style auto-corner behavior
			const dx = Math.abs(cur.x - last.x);
			const dy = Math.abs(cur.y - last.y);
			const MIN_DIST = 0.5;
			const TURN_THRESHOLD = 1.0; // Minimum movement to detect direction change

			// Before meaningful movement, just track straight to avoid spurious bends.
			if (dx < MIN_DIST && dy < MIN_DIST) {
				seg = [{ x: last.x, y: last.y }, { x: cur.x, y: cur.y }];
			} else {
				// Decide initial active axis only after meaningful movement to avoid jitter.
				if (!this.placement.activeAxis && (dx >= MIN_DIST || dy >= MIN_DIST)) {
					this.placement.activeAxis = (dx >= dy) ? 'H' : 'V';
				}

				// Detect direction change: if moving perpendicular to current axis, auto-commit corner
				if (this.placement.activeAxis) {
					const movingH = (dx >= dy);
					const movingV = (dy > dx);
					
					if (this.placement.activeAxis === 'H' && movingV && dy >= TURN_THRESHOLD) {
						// Was horizontal, now moving vertical: commit corner at (cur.x, last.y)
						const corner = { x: cur.x, y: last.y };
						if (!(last.x === corner.x && last.y === corner.y)) {
							this.placement.committed.push(corner);
						}
						this.placement.activeAxis = 'V';
						this.placement.modeLockedForSegment = false;
					} else if (this.placement.activeAxis === 'V' && movingH && dx >= TURN_THRESHOLD) {
						// Was vertical, now moving horizontal: commit corner at (last.x, cur.y)
						const corner = { x: last.x, y: cur.y };
						if (!(last.x === corner.x && last.y === corner.y)) {
							this.placement.committed.push(corner);
						}
						this.placement.activeAxis = 'H';
						this.placement.modeLockedForSegment = false;
					}
				}

				// Update last after potential corner commit
				const updatedLast = this.placement.committed[this.placement.committed.length - 1];
				
				// Once we have a chosen axis and both dx/dy are significant, lock the mode
				// for this segment so the bend doesn't flip mid-drag.
				const updatedDx = Math.abs(cur.x - updatedLast.x);
				const updatedDy = Math.abs(cur.y - updatedLast.y);
				
				if (this.placement.activeAxis && !this.placement.modeLockedForSegment && updatedDx >= MIN_DIST && updatedDy >= MIN_DIST) {
					this.placement.mode = (this.placement.activeAxis === 'H') ? 'HV' : 'VH';
					this.placement.modeLockedForSegment = true;
				}

				seg = this.manhattanPath(updatedLast, cur, this.placement.mode);
			}
		}
		const preview = [...this.placement.committed, ...seg.slice(1)];
		this.placement.lastPreview = preview;
		return { preview };
	}

	commitCorner() {
		const preview = this.placement.lastPreview || this.placement.committed;
		const tail = this.placement.committed[this.placement.committed.length - 1];
		if (this.lineDrawingMode === 'free') {
			// Free angle: just add the endpoint
			if (preview.length >= 2) {
				const end = preview[preview.length - 1];
				if (!(tail.x === end.x && tail.y === end.y)) this.placement.committed.push(end);
			}
		} else {
			// Orthogonal: commit the bend point and endpoint from preview
			if (preview.length >= 3) {
				const bend = preview[preview.length - 2];
				const end = preview[preview.length - 1];
				if (!(tail.x === bend.x && tail.y === bend.y)) this.placement.committed.push(bend);
				if (!(bend.x === end.x && bend.y === end.y)) this.placement.committed.push(end);
			}
		}
		// Reset direction tracking for the next segment
		this.placement.activeAxis = null;
		this.placement.modeLockedForSegment = false;
		return { points: [...this.placement.committed] };
	}

	finishPlacement() {
		const points = this.placement.lastPreview || [...this.placement.committed];
		const wire: KWire = { id: `w${this.state.wires.length + 1}`, points };
		this.state.wires.push(wire);
		this.rebuildConnectivity();
		this.placement.started = false;
		this.placement.lastPreview = null;
		return { points };
	}

	cancelPlacement(): void {
		this.placement.started = false;
		this.placement.committed = [];
		this.placement.lastPreview = null;
	}

	private dist(a: KPoint, b: KPoint): number {
		return Math.hypot(a.x - b.x, a.y - b.y);
	}

	private pointToSegmentDistance(p: KPoint, a: KPoint, b: KPoint): { distance: number; onSegment: boolean } {
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

	private normalizePolyline(points: KPoint[], options?: { removeColinear?: boolean }): KPoint[] {
		// Remove consecutive duplicates
		const out: KPoint[] = [];
		for (const p of points) {
			const last = out[out.length - 1];
			if (!last || last.x !== p.x || last.y !== p.y) out.push({ x: p.x, y: p.y });
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

	hitTest(point: KPoint, tolerance: number = this.state.tolerance): HitTestResult {
		const p = point;
		type Cand = { kind: HitTestResult['kind']; distance: number; priority: number; payload: any };
		const candidates: Cand[] = [];

		for (const pin of this.state.pins) {
			const d = this.dist(p, pin.at);
			if (d <= tolerance) candidates.push({ kind: 'pin', distance: d, priority: 0, payload: { pinId: pin.id } });
		}
		for (const j of this.state.junctions) {
			const d = this.dist(p, j.at);
			if (d <= tolerance) candidates.push({ kind: 'junction', distance: d, priority: 1, payload: { junctionId: j.id } });
		}

		for (const w of this.state.wires) {
			if (w.points.length < 2) continue;
			const start = w.points[0];
			const end = w.points[w.points.length - 1];
			{
				const d0 = this.dist(p, start);
				if (d0 <= tolerance) candidates.push({ kind: 'wire-endpoint', distance: d0, priority: 2, payload: { wireId: w.id, endpointIndex: 0 as 0 } });
				const d1 = this.dist(p, end);
				if (d1 <= tolerance) candidates.push({ kind: 'wire-endpoint', distance: d1, priority: 2, payload: { wireId: w.id, endpointIndex: 1 as 1 } });
			}
			for (let i = 1; i < w.points.length - 1; i++) {
				const d = this.dist(p, w.points[i]);
				if (d <= tolerance) candidates.push({ kind: 'wire-corner', distance: d, priority: 3, payload: { wireId: w.id, pointIndex: i } });
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

		if (candidates.length === 0) return { kind: 'none' };
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

	moveWireEndpoint(wireId: string, endpointIndex: 0 | 1, newPos: KPoint): { points: KPoint[] } {
		const w = this.state.wires.find(ww => ww.id === wireId);
		if (!w) throw new Error(`Wire not found: ${wireId}`);
		if (w.points.length < 2) return { points: w.points };
		const snapped = this.snapToGridOrObject(newPos, this.state.tolerance);

		// Special-case a 2-point wire: preserve diagonals (free-angle) by keeping it a 2-point segment.
		// Only enforce Manhattan when the segment is already orthogonal.
		if (w.points.length === 2) {
			w.points[endpointIndex === 0 ? 0 : 1] = { x: snapped.x, y: snapped.y };
			// If it is orthogonal, keep it as-is; if diagonal, keep it diagonal.
			w.points = this.normalizePolyline(w.points, { removeColinear: true });
			this.rebuildConnectivity();
			return { points: [...w.points] };
		}

		const old0 = w.points[0];
		const oldN = w.points[w.points.length - 1];
		if (endpointIndex === 0) {
			const old1 = w.points[1];
			w.points[0] = { x: snapped.x, y: snapped.y };
			// Preserve axis for orthogonal segments; for diagonal, do not force orthogonality.
			if (old0.x === old1.x) {
				w.points[1] = { x: w.points[0].x, y: old1.y };
			} else if (old0.y === old1.y) {
				w.points[1] = { x: old1.x, y: w.points[0].y };
			}
		} else {
			const oldPrev = w.points[w.points.length - 2];
			w.points[w.points.length - 1] = { x: snapped.x, y: snapped.y };
			if (oldPrev.x === oldN.x) {
				w.points[w.points.length - 2] = { x: w.points[w.points.length - 1].x, y: oldPrev.y };
			} else if (oldPrev.y === oldN.y) {
				w.points[w.points.length - 2] = { x: oldPrev.x, y: w.points[w.points.length - 1].y };
			}
		}

		w.points = this.normalizePolyline(w.points, { removeColinear: true });
		this.rebuildConnectivity();
		return { points: [...w.points] };
	}

	dragWireSegment(wireId: string, segmentIndex: number, cursor: KPoint): { points: KPoint[] } {
		const w = this.state.wires.find(ww => ww.id === wireId);
		if (!w) throw new Error(`Wire not found: ${wireId}`);
		if (segmentIndex < 0 || segmentIndex >= w.points.length - 1) throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
		const a = w.points[segmentIndex];
		const b = w.points[segmentIndex + 1];
		const snapped = this.snapToGridOrObject(cursor, this.state.tolerance);

		if (a.y === b.y) {
			// Horizontal: shift by Y.
			const dy = snapped.y - a.y;
			w.points[segmentIndex] = { x: a.x, y: a.y + dy };
			w.points[segmentIndex + 1] = { x: b.x, y: b.y + dy };
		} else if (a.x === b.x) {
			// Vertical: shift by X.
			const dx = snapped.x - a.x;
			w.points[segmentIndex] = { x: a.x + dx, y: a.y };
			w.points[segmentIndex + 1] = { x: b.x + dx, y: b.y };
		} else {
			throw new Error(`Non-orthogonal segment encountered for ${wireId} seg ${segmentIndex}`);
		}

		w.points = this.normalizePolyline(w.points, { removeColinear: true });
		this.rebuildConnectivity();
		return { points: [...w.points] };
	}

	insertCorner(wireId: string, segmentIndex: number, cursor: KPoint): { points: KPoint[]; inserted: boolean } {
		const w = this.state.wires.find(ww => ww.id === wireId);
		if (!w) throw new Error(`Wire not found: ${wireId}`);
		if (segmentIndex < 0 || segmentIndex >= w.points.length - 1) throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
		const a = w.points[segmentIndex];
		const b = w.points[segmentIndex + 1];
		const snapped = this.snapToGridOrObject(cursor, this.state.tolerance);
		let ins: KPoint;
		if (a.y === b.y) {
			const minX = Math.min(a.x, b.x);
			const maxX = Math.max(a.x, b.x);
			const x = Math.max(minX, Math.min(maxX, snapped.x));
			ins = { x, y: a.y };
		} else if (a.x === b.x) {
			const minY = Math.min(a.y, b.y);
			const maxY = Math.max(a.y, b.y);
			const y = Math.max(minY, Math.min(maxY, snapped.y));
			ins = { x: a.x, y };
		} else {
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

	removeCorner(wireId: string, pointIndex: number): { points: KPoint[]; removed: boolean } {
		const w = this.state.wires.find(ww => ww.id === wireId);
		if (!w) throw new Error(`Wire not found: ${wireId}`);
		if (pointIndex <= 0 || pointIndex >= w.points.length - 1) return { points: [...w.points], removed: false };
		const prev = w.points[pointIndex - 1];
		const next = w.points[pointIndex + 1];
		const mergeValid = (prev.x === next.x) || (prev.y === next.y);
		if (!mergeValid) return { points: [...w.points], removed: false };
		w.points.splice(pointIndex, 1);
		w.points = this.normalizePolyline(w.points, { removeColinear: true });
		this.rebuildConnectivity();
		return { points: [...w.points], removed: true };
	}
}
