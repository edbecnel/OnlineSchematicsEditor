// ================================================================================
// Routing Kernel Installation
// ================================================================================
//
// This module handles routing kernel selection and initialization.
// It is the ONLY place that imports and constructs routing kernel implementations.
//

import { routingFacade } from './facade.js';
import { KiCadRoutingKernel } from './kicadKernel.js';
import type { Point } from '../types.js';

/**
 * Dependencies required by routing kernels
 */
export interface RoutingDependencies {
  /** Snap to grid or nearby object */
  snapToGridOrObject: (pos: Point, snapRadius?: number) => Point;
  /** Get current ortho mode state */
  getOrthoMode: () => boolean;
}

/**
 * Install and configure routing kernels based on mode selection.
 * This is called once during app startup.
 * 
 * @param deps - Dependency object containing callback functions
 */
export function installRouting(deps: RoutingDependencies): void {
  // Create KiCad routing kernel (legacy adapter removed - KiCad is now the only kernel)
  const kicadKernel = new KiCadRoutingKernel();
  
  // Configure KiCad kernel with app-level snapping and ortho mode
  kicadKernel.configureSnap((pos, snapRadius) => deps.snapToGridOrObject(pos as any, snapRadius as any));
  kicadKernel.setLineDrawingMode?.(deps.getOrthoMode() ? 'orthogonal' : 'free');
  
  // Install KiCad kernel as the only kernel
  routingFacade.setKernel(kicadKernel);

  // Expose routingKernelMode on window for backward compatibility with existing checks
  // Always reports 'kicad' since legacy has been removed
  Object.defineProperty(window, 'routingKernelMode', {
    get() { return 'kicad'; },
    set(_value: string) {
      console.warn('[Routing] routingKernelMode is read-only. KiCad kernel is always active.');
    }
  });

  // Quick verification: ensure kernel responds
  try {
    const sample = routingFacade.manhattanPath({ x: 0, y: 0 }, { x: 20, y: 15 }, 'HV');
    console.debug('RoutingFacade initialized (KiCad). Sample Manhattan path:', sample);
  } catch (e) {
    console.warn('RoutingFacade initialization check failed:', e);
  }

  console.info('[Routing] KiCad kernel installed and active.');
}
