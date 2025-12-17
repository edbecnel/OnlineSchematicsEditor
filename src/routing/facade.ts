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
}

export class RoutingFacade {
  private kernel: IRoutingKernel;

  constructor() {
    this.kernel = new DefaultLegacyKernel();
    this.kernel.init?.();
  }

  setKernel(k: IRoutingKernel) {
    if (this.kernel && this.kernel.dispose) this.kernel.dispose();
    this.kernel = k;
    if (this.kernel.init) this.kernel.init();
  }


  getMode(): RoutingMode {
    return this.kernel.name;
  }

  manhattanPath(A: { x: number; y: number }, P: { x: number; y: number }, mode: 'HV' | 'VH') {
    return this.kernel.manhattanPath(A, P, mode);
  }

  snapToGridOrObject(pos: { x: number; y: number }, snapRadius?: number) {
    return this.kernel.snapToGridOrObject(pos, snapRadius);
  }
}

// Export a singleton facade for easy import/use
export const routingFacade = new RoutingFacade();
