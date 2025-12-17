import type { IRoutingKernel } from './types.js';

// Legacy adapter wraps existing legacy implementations by delegating to provided callbacks.
export class LegacyRoutingKernelAdapter implements IRoutingKernel {
  readonly name: import('./types.js').RoutingMode = 'legacy';

  private impl: {
    manhattanPath: (A: { x: number; y: number }, P: { x: number; y: number }, mode: 'HV' | 'VH') => { x: number; y: number }[];
    snapToGridOrObject: (pos: { x: number; y: number }, snapRadius?: number) => { x: number; y: number };
    beginPlacement?: (start: { x: number; y: number }, mode: 'HV' | 'VH') => void;
    updatePlacement?: (cursor: { x: number; y: number }) => { preview: { x: number; y: number }[] };
    commitCorner?: () => { points: { x: number; y: number }[] };
    finishPlacement?: () => { points: { x: number; y: number }[] };
    cancelPlacement?: () => void;
  };

  constructor(impl: {
    manhattanPath: (A: { x: number; y: number }, P: { x: number; y: number }, mode: 'HV' | 'VH') => { x: number; y: number }[];
    snapToGridOrObject: (pos: { x: number; y: number }, snapRadius?: number) => { x: number; y: number };
    beginPlacement?: (start: { x: number; y: number }, mode: 'HV' | 'VH') => void;
    updatePlacement?: (cursor: { x: number; y: number }) => { preview: { x: number; y: number }[] };
    commitCorner?: () => { points: { x: number; y: number }[] };
    finishPlacement?: () => { points: { x: number; y: number }[] };
    cancelPlacement?: () => void;
  }) {
    this.impl = impl;
  }

  manhattanPath(A: { x: number; y: number }, P: { x: number; y: number }, mode: 'HV' | 'VH') {
    return this.impl.manhattanPath(A, P, mode);
  }

  snapToGridOrObject(pos: { x: number; y: number }, snapRadius?: number) {
    return this.impl.snapToGridOrObject(pos, snapRadius);
  }

  // Lifecycle delegates (fallback to legacy manhattan/snap semantics if not provided)
  private _placement = {
    started: false,
    mode: 'HV' as 'HV' | 'VH',
    committed: [] as { x: number; y: number }[],
    start: { x: 0, y: 0 },
    lastPreview: null as { x: number; y: number }[] | null,
  };

  beginPlacement(start: { x: number; y: number }, mode: 'HV' | 'VH'): void {
    if (this.impl.beginPlacement) return this.impl.beginPlacement(start, mode);
    const s = this.impl.snapToGridOrObject(start);
    this._placement.started = true;
    this._placement.mode = mode;
    this._placement.committed = [s];
    this._placement.start = s;
    this._placement.lastPreview = [s];
  }

  updatePlacement(cursor: { x: number; y: number }) {
    if (this.impl.updatePlacement) return this.impl.updatePlacement(cursor);
    const last = this._placement.committed[this._placement.committed.length - 1];
    const cur = this.impl.snapToGridOrObject(cursor);
    const seg = this.impl.manhattanPath(last, cur, this._placement.mode);
    const preview = [...this._placement.committed, ...seg.slice(1)];
    this._placement.lastPreview = preview;
    return { preview };
  }

  commitCorner() {
    if (this.impl.commitCorner) return this.impl.commitCorner();
    const pv = this._placement.lastPreview || this._placement.committed;
    if (pv.length >= 3) {
      const bend = pv[pv.length - 2];
      const prevEnd = pv[pv.length - 1];
      // avoid duplicate
      const tail = this._placement.committed[this._placement.committed.length - 1];
      if (!(tail.x === bend.x && tail.y === bend.y)) this._placement.committed.push(bend);
      if (!(bend.x === prevEnd.x && bend.y === prevEnd.y)) this._placement.committed.push(prevEnd);
    }
    return { points: [...this._placement.committed] };
  }

  finishPlacement() {
    if (this.impl.finishPlacement) return this.impl.finishPlacement();
    const points = this._placement.lastPreview || [...this._placement.committed];
    // reset
    this._placement.started = false;
    this._placement.lastPreview = null;
    return { points };
  }

  cancelPlacement(): void {
    if (this.impl.cancelPlacement) return this.impl.cancelPlacement();
    this._placement.started = false;
    this._placement.committed = [];
  }
}
