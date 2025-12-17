import type { IRoutingKernel } from './types.js';

// Legacy adapter wraps existing legacy implementations by delegating to provided callbacks.
export class LegacyRoutingKernelAdapter implements IRoutingKernel {
  readonly name: import('./types.js').RoutingMode = 'legacy';

  private impl: {
    manhattanPath: (A: { x: number; y: number }, P: { x: number; y: number }, mode: 'HV' | 'VH') => { x: number; y: number }[];
    snapToGridOrObject: (pos: { x: number; y: number }, snapRadius?: number) => { x: number; y: number };
  };

  constructor(impl: {
    manhattanPath: (A: { x: number; y: number }, P: { x: number; y: number }, mode: 'HV' | 'VH') => { x: number; y: number }[];
    snapToGridOrObject: (pos: { x: number; y: number }, snapRadius?: number) => { x: number; y: number };
  }) {
    this.impl = impl;
  }

  manhattanPath(A: { x: number; y: number }, P: { x: number; y: number }, mode: 'HV' | 'VH') {
    return this.impl.manhattanPath(A, P, mode);
  }

  snapToGridOrObject(pos: { x: number; y: number }, snapRadius?: number) {
    return this.impl.snapToGridOrObject(pos, snapRadius);
  }
}
