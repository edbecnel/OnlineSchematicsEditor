// KiCad routing kernel implementation.
// Not wired into runtime by default; only used when routingkernelMode=""

import type { IRoutingKernel, RoutingMode } from './types.js';
import type { RoutingState, KWire } from './kicad/model.js';
import { deriveConnectivity } from './kicad/connectivity.js';

export class KiCadRoutingKernel implements IRoutingKernel {
	readonly name: RoutingMode = 'kicad';

	private state: RoutingState = { wires: [], junctions: [], pins: [], tolerance: 0.5 };
	private snapDelegate: ((pos: { x: number; y: number }, snapRadius?: number) => { x: number; y: number }) | null = null;
	private placement = {
		started: false,
		mode: 'HV' as 'HV' | 'VH',
		committed: [] as { x: number; y: number }[],
		lastPreview: null as { x: number; y: number }[] | null,
	};

	setState(state: RoutingState) { this.state = state; }
	getState(): RoutingState { return this.state; }

	init(): void { /* no-op */ }
	dispose(): void { /* no-op */ }

	// Allow host app to provide snapping implementation (grid/object/junction, etc.)
	configureSnap(delegate: (pos: { x: number; y: number }, snapRadius?: number) => { x: number; y: number }) {
		this.snapDelegate = delegate;
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
	}

	updatePlacement(cursor: { x: number; y: number }) {
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
			if (!(tail.x === bend.x && tail.y === bend.y)) this.placement.committed.push(bend);
			if (!(bend.x === end.x && bend.y === end.y)) this.placement.committed.push(end);
		}
		return { points: [...this.placement.committed] };
	}

	finishPlacement() {
		const points = this.placement.lastPreview || [...this.placement.committed];
		const wire: KWire = { id: `w${this.state.wires.length + 1}`, points };
		this.state.wires.push(wire);
		// derive connectivity for side effects/consistency
		deriveConnectivity(this.state);
		this.placement.started = false;
		this.placement.lastPreview = null;
		return { points };
	}

	cancelPlacement(): void {
		this.placement.started = false;
		this.placement.committed = [];
	}
}
