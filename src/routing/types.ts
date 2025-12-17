export type RoutingMode = 'legacy' | 'kicad';

export interface IRoutingKernel {
  // Current mode name
  readonly name: RoutingMode;

  // Manhattan/orthogonal path generator: returns a simple HV/VH rectilinear L-path as 
  // an array of points including endpoints
  // NOTE: This does not perform obstacle avoidance or autorouting.  
  manhattanPath(A: { x: number; y: number }, P: { x: number; y: number }, mode: 'HV' | 'VH'): { x: number; y: number }[];

  // Snap helper: snap to grid or nearby object
  snapToGridOrObject(pos: { x: number; y: number }, snapRadius?: number): { x: number; y: number };

  // Optional lifecycle hooks
  init?(): void;
  dispose?(): void;
}
