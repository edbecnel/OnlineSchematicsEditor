/**
 * Minimal KiCad-friendly types (editor-only). No runtime effect.
 * Stage 1: keep compatibility with current data (wires have `color`).
 * Later we can switch to `stroke` to match KiCad's (wire (stroke ...)) cleanly.
 */

type UUID = string;

interface Point { x: number; y: number; }

interface Stroke {
  width: number; // mm
  type: 'default'|'solid'|'dash'|'dot'|'dash_dot'|'dash_dot_dot';
  color: { r:number; g:number; b:number; a:number }; // 0–1 RGBA
}

interface Wire {
  id: UUID;
  points: Point[];
  /** CURRENT editor field */
  color?: string;
  /** FUTURE KiCad-style override (when we migrate) */
  stroke?: Stroke;
  /** Editor-side net id; KiCad derives this at import */
  netId?: string;
}

interface WireSegment {
  wireId: UUID;
  index: number; // segment index within wire.points
  a: Point;
  b: Point;
}

type Axis = 'x'|'y'|null;

interface WireSpan {
  /** Editor-only ID, e.g. "swp3" */
  id: string;
  axis: Axis;
  start: Point;
  end: Point;
  color: string;
  /** Which polyline segments participate in this span */
  edgeWireIds: UUID[];
  edgeIndicesByWire: Record<UUID, number[]>;
}

interface Junction {
  at: Point;
  size?: number;
  color?: string; // explicit override; otherwise follows netclass/theme
}

interface Net {
  id: string;        // editor-side
  name?: string;     // KiCad label (if any)
  classId?: string;  // netclass id
}

interface NetClass {
  id: string;
  name: string;
  wire: Stroke;
  junction: { size: number; color: { r:number; g:number; b:number; a:number } };
}

interface Theme {
  wire: Stroke;
  junction: { size: number; color: { r:number; g:number; b:number; a:number } };
}
