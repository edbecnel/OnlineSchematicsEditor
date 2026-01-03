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

  // Wire placement lifecycle (Phase 3)
  beginPlacement(start: { x: number; y: number }, mode: 'HV' | 'VH'): void;
  updatePlacement(cursor: { x: number; y: number }): { preview: { x: number; y: number }[] };
  commitCorner(): { points: { x: number; y: number }[] };
  finishPlacement(): { points: { x: number; y: number }[] };
  cancelPlacement(): void;

  // Optional: control line drawing mode for preview/placement
  // 'orthogonal' = manhattan / rectilinear preview
  // 'free' = straight segment preview
  setLineDrawingMode?(mode: 'orthogonal' | 'free'): void;

  // Optional lifecycle hooks
  init?(): void;
  dispose?(): void;
}
