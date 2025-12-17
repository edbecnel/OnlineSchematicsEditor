import type { IRoutingKernel, RoutingMode } from './types.js';

// A minimal default legacy kernel used as a safe compile-time/runtime default.
// This ensures the facade always has a legacy kernel (no null) until the real
// legacy adapter from `app.ts` is installed.
class DefaultLegacyKernel implements IRoutingKernel {
  readonly name: RoutingMode = 'legacy';

  init(): void { /* no-op */ }
  dispose(): void { /* no-op */ }

  manhattanPath(A: { x: number; y: number }, P: { x: number; y: number }, mode: 'HV' | 'VH') {
    // Simple, deterministic L-shaped path: prefer the requested mode.
    if (Math.abs(A.x - P.x) < 1e-6) return [{ x: A.x, y: A.y }, { x: A.x, y: P.y }];
    if (Math.abs(A.y - P.y) < 1e-6) return [{ x: A.x, y: A.y }, { x: P.x, y: A.y }];
    if (mode === 'HV') {
      return [{ x: A.x, y: A.y }, { x: P.x, y: A.y }, { x: P.x, y: P.y }];
    } else {
      return [{ x: A.x, y: A.y }, { x: A.x, y: P.y }, { x: P.x, y: P.y }];
    }
  }

  snapToGridOrObject(pos: { x: number; y: number }, snapRadius?: number) {
    // No snapping in default; real adapter will replace this.
    return { x: pos.x, y: pos.y };
  }

  beginPlacement(start: { x: number; y: number }, mode: 'HV' | 'VH'): void {
    /* no-op */
  }
  updatePlacement(cursor: { x: number; y: number }): { preview: { x: number; y: number }[] } {
    return { preview: [] };
  }
  commitCorner(): { points: { x: number; y: number }[] } { return { points: [] }; }
  finishPlacement(): { points: { x: number; y: number }[] } { return { points: [] }; }
  cancelPlacement(): void { /* no-op */ }
}

export class RoutingFacade {
  private kernel: IRoutingKernel;
  private isDefaultKernel = true;
  private warnedDefault = false;

  private warnIfDefault(method: string) {
    if (!this.warnedDefault && this.isDefaultKernel) {
      this.warnedDefault = true;
      console.warn(
        `[RoutingFacade] DefaultLegacyKernel is still active (method: ${method}). ` +
        `app.ts should call routingFacade.setKernel(...) early during startup.`
      );
    }
  }

  constructor() {
    this.kernel = new DefaultLegacyKernel();
    this.isDefaultKernel = true;
    this.kernel.init?.();
  }

  setKernel(k: IRoutingKernel) {
    if (this.kernel && this.kernel.dispose) this.kernel.dispose();
    this.kernel = k;
    this.isDefaultKernel = false;
    if (this.kernel.init) this.kernel.init();
  }


  getMode(): RoutingMode {
    this.warnIfDefault('getMode');
    return this.kernel.name;
  }

  manhattanPath(A: { x: number; y: number }, P: { x: number; y: number }, mode: 'HV' | 'VH') {
    this.warnIfDefault('manhattanPath');
    return this.kernel.manhattanPath(A, P, mode);
  }

  snapToGridOrObject(pos: { x: number; y: number }, snapRadius?: number) {
    this.warnIfDefault('snapToGridOrObject');
    return this.kernel.snapToGridOrObject(pos, snapRadius);
  }

  // Wire placement lifecycle pass-throughs
  beginPlacement(start: { x: number; y: number }, mode: 'HV' | 'VH') {
    this.warnIfDefault('beginPlacement');
    return this.kernel.beginPlacement(start, mode);
  }
  updatePlacement(cursor: { x: number; y: number }) {
    this.warnIfDefault('updatePlacement');
    return this.kernel.updatePlacement(cursor);
  }
  commitCorner() {
    this.warnIfDefault('commitCorner');
    return this.kernel.commitCorner();
  }
  finishPlacement() {
    this.warnIfDefault('finishPlacement');
    return this.kernel.finishPlacement();
  }
  cancelPlacement() {
    this.warnIfDefault('cancelPlacement');
    return this.kernel.cancelPlacement();
  }
}

// Export a singleton facade for easy import/use
export const routingFacade = new RoutingFacade();
