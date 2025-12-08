/**
 * Type definitions for the Online Schematics Editor
 * Consolidated from types.d.ts and app.ts into a single ES module
 */

// ====== Basic Geometric Types ======

export type UUID = string;
export type Point = { x: number; y: number };
export type Axis = 'x' | 'y' | null;

// ====== Editor Mode Types ======

export type Mode = 'none' | 'select' | 'wire' | 'delete' | 'place' | 'pan' | 'move';
export type EditorMode = Mode | 'place-junction' | 'delete-junction';
export type PlaceType = 'resistor' | 'capacitor' | 'inductor' | 'diode' | 'npn' | 'pnp' | 'ground' | 'battery' | 'ac';
export type CounterKey = PlaceType | 'wire' | 'junction';
export type GridMode = 'line' | 'dot' | 'off';
export type SnapMode = 'grid' | '50mil' | 'off';

// ====== Selection Types ======

/**
 * Single selection item. Note: legacy `segIndex` support remains for backward
 * compatibility (some UI code may still set it to `null`), but the editor now
 * treats each visible straight sub-segment as its own `Wire` (identified by
 * `wire.id`). Prefer selecting segments by `{ kind: 'wire', id: <wireId>, segIndex: null }`.
 */
export type SelectionItem =
  | { kind: 'component'; id: string; segIndex: null }
  | { kind: 'wire'; id: string; segIndex: number | null }
  | { kind: 'label'; id: string; segIndex: null }    // component label text
  | { kind: 'value'; id: string; segIndex: null }    // component value text
  | { kind: 'junction'; id: string; segIndex: null }; // junction dot (id is stable unique identifier)

/**
 * Selection can be:
 * - Empty (items array is empty)
 * - Single item (items array has one element)
 * - Multiple items (items array has multiple elements)
 */
export interface Selection {
  items: SelectionItem[];
}

/**
 * Legacy single-selection type (deprecated - kept for backwards compatibility during migration)
 * @deprecated Use Selection with items array instead
 */
export type LegacySelection =
  | { kind: null; id: null; segIndex: null }
  | { kind: 'component'; id: string; segIndex: null }
  | { kind: 'wire'; id: string; segIndex: number | null }
  | { kind: 'label'; id: string; segIndex: null }
  | { kind: 'value'; id: string; segIndex: null }
  | { kind: 'junction'; id: string; segIndex: null };

// ====== Component Types ======

export type DiodeSubtype = 'generic' | 'schottky' | 'zener' | 'led' | 'photo' | 'tunnel' | 'varactor' | 'laser' | 'tvs_uni' | 'tvs_bi';
export type ResistorStyle = 'ansi' | 'iec';
export type CapacitorSubtype = 'standard' | 'polarized';

export type PinElectricalType = 'input' | 'output' | 'bidirectional' | 'power_in' | 'power_out' | 'passive' | 'unspecified';

/**
 * Pin definition for components with arbitrary pin counts.
 * Position is relative to component origin (x, y) and will be transformed by component rotation.
 */
export interface Pin {
  id: string;                    // pin number/name: "1", "2", "A", "B", "C", "E", etc.
  x: number;                     // relative X position from component center (before rotation)
  y: number;                     // relative Y position from component center (before rotation)
  rotation: number;              // pin orientation in degrees (0, 90, 180, 270)
  electricalType: PinElectricalType; // KiCad-compatible electrical type
  name?: string;                 // optional human-readable name ("VCC", "GND", "OUT", etc.)
  visible?: boolean;             // whether pin number/name is visible on schematic (default true)
}

/**
 * Graphic element for component symbols (lines, rectangles, circles, arcs, polygons, text)
 */
export type GraphicElement = 
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; stroke?: string; strokeWidth?: number }
  | { type: 'rectangle'; x: number; y: number; width: number; height: number; fill?: string; stroke?: string; strokeWidth?: number }
  | { type: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; strokeWidth?: number }
  | { type: 'arc'; cx: number; cy: number; r: number; startAngle: number; endAngle: number; stroke?: string; strokeWidth?: number }
  | { type: 'polyline'; points: Point[]; fill?: string; stroke?: string; strokeWidth?: number }
  | { type: 'polygon'; points: Point[]; fill?: string; stroke?: string; strokeWidth?: number }
  | { type: 'path'; d: string; fill?: string; stroke?: string; strokeWidth?: number }
  | { type: 'text'; x: number; y: number; text: string; fontSize?: number; anchor?: 'start' | 'middle' | 'end' };

export interface Component {
  id: string;
  type: PlaceType;
  x: number;
  y: number;
  rot: number;               // degrees, multiples of 90
  label: string;
  labelOffsetX?: number;     // label X offset from default position
  labelOffsetY?: number;     // label Y offset from default position
  value?: string;
  valueOffsetX?: number;     // value X offset from default position
  valueOffsetY?: number;     // value Y offset from default position
  props?: {
    unit?: string;           // Ω / F / H symbol for R/C/L
    subtype?: DiodeSubtype;  // diode subtype
    capacitorSubtype?: CapacitorSubtype; // capacitor subtype (standard/polarized)
    resistorStyle?: ResistorStyle; // resistor representation (ansi/iec), overrides project default
    capacitorStyle?: ResistorStyle; // polarized capacitor representation (ansi/iec), overrides project default
    voltage?: number;        // battery/AC source voltage
    [k: string]: any;        // future-safe
  };
  
  // NEW: Arbitrary pin support (backward compatible - undefined means use legacy pin calculation)
  pins?: Pin[];              // if defined, use these pins instead of computing from type
  graphics?: GraphicElement[]; // if defined, render these graphics instead of built-in symbol
  
  // Symbol library metadata (for imported components)
  libraryId?: string;        // reference to symbol library
  symbolName?: string;       // original symbol name from library

  // Relationships for embedded movement and chains
  embeddedInWireId?: string | null;   // wire.id this component is embedded in (persistent until explicitly cleared)
  embeddedAxis?: 'x' | 'y' | null;    // axis of the wire segment it is embedded on
  embeddedFixed?: number | null;      // fixed coordinate along the embedded axis (y if axis='x', x if axis='y')
  connectedTo?: string[];             // list of other component ids this component is directly connected to (pin coincidence)
}

// ====== Text Label Types ======

/**
 * Independent text label that can be placed anywhere and edited separately.
 * Can be associated with a component (for label/value text) or standalone.
 */
export interface TextLabel {
  id: string;
  text: string;
  x: number;                 // absolute position on canvas
  y: number;
  fontSize: number;          // in pixels
  fontFamily: string;        // font name
  bold: boolean;
  italic: boolean;
  underline: boolean;
  anchor: 'start' | 'middle' | 'end';
  parentComponentId?: string; // if associated with a component, the component's id
  labelType?: 'label' | 'value'; // which component field this represents (if any)
}

// ====== KiCad-friendly Stroke Types ======

export type RGBA01 = { r: number; g: number; b: number; a: number };  // 0..1
export type StrokeType = 'default' | 'solid' | 'dash' | 'dot' | 'dash_dot' | 'dash_dot_dot';
export type Stroke = { width: number; type: StrokeType; color: RGBA01 };  // mm + style + RGBA

// ====== Wire Types ======

export interface Wire {
  id: string;
  points: Point[];
  /** LEGACY editor field (kept for back-compat saves & SWP color heuristics) */
  color?: string;            // css color string
  /** KiCad-style override; width=0 and type='default' mean "use netclass/theme" */
  stroke?: Stroke;
  /** Optional net hook for later; defaults to 'default' netclass */
  netId?: string | null;
}

export interface WireSegment {
  wireId: UUID;
  index: number; // segment index within wire.points
  a: Point;
  b: Point;
}

// ====== Net & Theme Types ======

export type WireColorMode = 'auto' | 'black' | 'red' | 'green' | 'blue' | 'yellow' | 'magenta' | 'cyan';

export interface NetClass {
  id: string;
  name: string;
  wire: Stroke;                              // defaults for wires in this class
  junction: { size: number; color: RGBA01 }; // mm + RGBA
}

export interface Theme {
  wire: Stroke;                              // global fallback
  junction: { size: number; color: RGBA01 };
}

export interface Net {
  id: string;        // editor-side
  name?: string;     // KiCad label (if any)
  classId?: string;  // netclass id
}

export interface Junction {
  id: string;        // unique identifier
  at: Point;
  size?: number;
  color?: string;    // explicit override; otherwise follows netclass/theme
  netId?: string | null;
  manual?: boolean;  // true if manually placed by user
  suppressed?: boolean; // true if automatic junction was manually deleted
}

// ====== Topology Types ======

export type SWPEdge = {
  id: string;
  wireId: string | null;     // null for synthetic component-bridge edges
  i: number;                 // segment index within wireId (or -1 for bridge)
  a: Point;
  b: Point;
  axis: Axis;                // 'x' | 'y' | null (null = angled/non-axis)
  akey: string;              // "x,y"
  bkey: string;              // "x,y"
};

export type SWP = {
  id: string;                // e.g. "swp3"
  axis: Exclude<Axis, null>; // 'x' | 'y' only
  start: Point;              // canonical start endpoint of the span
  end: Point;                // canonical end endpoint of the span
  color: string;             // representative color for the span
  edgeWireIds: string[];     // contributing wire IDs
  edgeIndicesByWire: Record<string, number[]>; // per-wire segment indices that belong to the SWP
};

export interface WireSpan {
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

export type Topology = {
  nodes: Array<{ x: number; y: number; edges: Set<string>; axDeg: { x: number; y: number } }>;
  edges: SWPEdge[];
  swps: SWP[];
  compToSwp: Map<string, string>;  // component.id -> swp.id
};

// ====== Editor State Types ======

export type MoveCollapseCtx = {
  kind: 'swp';
  sid: string;               // SWP id
  axis: 'x' | 'y';
  fixed: number;             // orthogonal coordinate (y for 'x' spans, x for 'y' spans)
  minCenter: number;         // clamp for the component center along axis
  maxCenter: number;
  ends: { lo: number; hi: number }; // SWP endpoints along axis
  color: string;
  collapsedId: string;       // temp wire id used while collapsed
  lastCenter: number;        // last center position during drag
};

export type DrawingState = {
  active: boolean;
  points: Point[];
  cursor: Point | null;
};

export type MarqueeState = {
  active: boolean;
  start: Point | null;
  end: Point | null;
  rectEl: SVGRectElement | null;
  startedOnEmpty: boolean;
  shiftPreferComponents: boolean;
};

// ====== KiCad Export Types ======

export type KWire = {
  id: string;                  // uuid in KiCad; we'll keep our id for now
  points: Point[];             // (pts (xy …) …)
  stroke: Stroke;              // (stroke …)
  netId?: string | null;       // optional editor-side metadata
};
