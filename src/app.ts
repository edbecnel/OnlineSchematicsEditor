// ================================================================================
// ONLINE SCHEMATICS EDITOR - Main Application
// ================================================================================
//
// NOTE: This file is being incrementally modularized.
// Pure utilities → utils.ts
// Constants → constants.ts
// See CODE_ORGANIZATION.md for details.
//
// ================================================================================

import * as Utils from './utils.js';
import * as Constants from './constants.js';
import * as Geometry from './geometry.js';
import * as State from './state.js';
import * as Components from './components.js';
import * as Wires from './wires.js';
import * as TopologyBuilder from './topology.js';
import * as Rendering from './rendering.js';
import * as Netlist from './netlist.js';
import * as Inspector from './inspector.js';
import * as FileIO from './fileio.js';
import * as Move from './move.js';
import * as UI from './ui.js';
import * as Input from './input.js';
import type { ClientXYEvent } from './utils.js';
import { ConstraintSolver } from './constraints/index.js';
import type { Entity } from './constraints/types.js';

import type {
  Point, Axis, Mode, PlaceType, CounterKey, Selection, SelectionItem, DiodeSubtype, ResistorStyle, CapacitorSubtype,
  Component, RGBA01, StrokeType, Stroke, Wire, WireColorMode,
  NetClass, Theme, Junction, SWPEdge, SWP, Topology,
  MoveCollapseCtx, KWire
} from './types.js';

import {
  PX_PER_MM, pxToNm, nmToPx, mmToPx,
  nmToUnit, unitToNm,
  parseDimInput, formatDimForDisplay
} from './conversions.js';

(function () {
  // --- Add UI for Place/Delete Junction Dot ---
  // Note: button event listener setup is done after setMode is defined (see attachJunctionDotButtons)
  // ====== Module Imports (re-export for internal use) ======
  const {
    $q, $qa, setAttr, setAttrs, getClientXY,
    colorToHex, cssToRGBA01, rgba01ToCss,
    deg, normDeg, rotatePoint, eqPt,
    pointToSegmentDistance, projectPointToSegment, segmentAngle,
    rectFromPoints, inRect, segsIntersect, segmentIntersectsRect,
    clamp
  } = Utils;

  const {
    GRID, NM_PER_MM, NM_PER_IN, NM_PER_MIL, SNAP_MILS, SNAP_NM,
    BASE_W, BASE_H,
    HINT_SNAP_TOLERANCE_PX, HINT_UNLOCK_THRESHOLD_PX,
    UNIT_OPTIONS, WIRE_COLOR_OPTIONS
  } = Constants;

  // ====== Local Types ======
  type UUID = string;
  type AnyProps = Record<string, any>;

  // Extend Mode to include custom junction dot modes
  type EditorMode = Mode | 'place-junction' | 'delete-junction';

  // ================================================================================
  // ====== 2. CONSTANTS & CONFIGURATION ======
  // ================================================================================

  // Global units state and persistence (available at module-init time to avoid TDZ issues)
  let globalUnits: 'mm' | 'in' | 'mils' = (localStorage.getItem('global.units') as any) || 'mm';
  function saveGlobalUnits() { localStorage.setItem('global.units', globalUnits); }

  // ================================================================================
  // ====== 5. DOM REFERENCES ======
  // ================================================================================

  const svg = $q<SVGSVGElement>('#svg');

  // Ensure required SVG layer <g> elements exist; create them if missing.
  // Layers (and enforce visual stacking order)
  const gWires = Utils.ensureSvgGroup(svg!, 'wires');
  const gComps = Utils.ensureSvgGroup(svg!, 'components');
  const gJunctions = Utils.ensureSvgGroup(svg!, 'junctions');
  const gDrawing = Utils.ensureSvgGroup(svg!, 'drawing');
  const gOverlay = Utils.ensureSvgGroup(svg!, 'overlay');

  // Keep desired order: wires → components → junctions → drawing (ghost/rubber-band) → overlay (marquee/crosshair)
  (function ensureLayerOrder() {
    if (!svg) return;
    [gWires, gComps, gJunctions, gDrawing, gOverlay].forEach(g => svg.appendChild(g));
  })();

  const inspector = $q<HTMLElement>('#inspector');
  const inspectorNone = $q<HTMLElement>('#inspectorNone');
  const projTitle = $q<HTMLInputElement>('#projTitle'); // uses .value later
  const defaultResistorStyleSelect = $q<HTMLSelectElement>('#defaultResistorStyleSelect');
  const junctionDotSizeSelect = $q<HTMLElement>('#junctionDotSizeSelect');
  const countsEl = $q<HTMLElement>('#counts');
  const overlayMode = $q<HTMLElement>('#modeLabel');
  const coordDisplay = $q<HTMLElement>('#coordDisplay');
  const coordInputGroup = $q<HTMLElement>('#coordInputGroup');
  const coordInputX = $q<HTMLInputElement>('#coordInputX');
  const coordInputY = $q<HTMLInputElement>('#coordInputY');
  const polarInputGroup = $q<HTMLElement>('#polarInputGroup');
  const coordInputLength = $q<HTMLInputElement>('#coordInputLength');
  const coordInputAngle = $q<HTMLInputElement>('#coordInputAngle');

  // Grid mode: 'line' (line grid), 'dot' (dot grid), 'off' (no grid) - persisted
  type GridMode = 'line' | 'dot' | 'off';
  let gridMode: GridMode = (localStorage.getItem('grid.mode') as GridMode) || 'line';

  // Junction dots visibility toggle state (persisted)
  let showJunctionDots = (localStorage.getItem('junctionDots.visible') !== 'false');
  // Junction dot size setting (persisted): 'small' | 'medium' | 'large'
  let junctionDotSize: 'smallest' | 'small' | 'default' | 'large' | 'largest' = (localStorage.getItem('junctionDots.size') as any) || 'default';
  // Custom junction size (optional, in mils) - overrides preset if set
  let junctionCustomSize: number | null = localStorage.getItem('junctionDots.customSize') ? parseFloat(localStorage.getItem('junctionDots.customSize')!) : null;
  // Default junction color (optional) - uses net class color if not set
  let junctionDefaultColor: string | null = localStorage.getItem('junctionDots.defaultColor') || null;

  // Tracking mode: when true, connection hints are enabled (persisted)
  let trackingMode = (localStorage.getItem('tracking.mode') !== 'false');

  // Default resistor style for project: 'ansi' (US zigzag) or 'iec' (rectangle) - persisted
  let defaultResistorStyle: ResistorStyle = (localStorage.getItem('defaultResistorStyle') as ResistorStyle) || 'ansi';

  // UI button ref (may be used before DOM-ready in some cases; guard accordingly)
  let gridToggleBtnEl: HTMLButtonElement | null = null;

  // Track Shift key state globally so we can enforce orthogonal preview even
  // when the user presses/releases Shift while dragging (some browsers/platforms
  // may not include shift in pointer events reliably during capture).
  let globalShiftDown = false;
  window.addEventListener('keydown', (e) => { if (e.key === 'Shift') globalShiftDown = true; });
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') globalShiftDown = false; });

  // Ortho mode: when true, all wiring is forced orthogonal (persisted)
  let orthoMode = (localStorage.getItem('ortho.mode') === 'true');
  function saveOrthoMode() { localStorage.setItem('ortho.mode', orthoMode ? 'true' : 'false'); }

  // Grid unit system: 'imperial' (mils) or 'metric' (mm)
  type GridUnit = 'imperial' | 'metric';
  let gridUnit: GridUnit = (localStorage.getItem('grid.unit') as GridUnit) || 'imperial';
  function saveGridUnit() { localStorage.setItem('grid.unit', gridUnit); }

  // Snap mode: 'grid' (snap to grid intersections/dots), '50mil' (imperial base), '1mm' (metric base), 'off' (no snapping)
  type SnapMode = 'grid' | '50mil' | '1mm' | 'off';
  let snapMode: SnapMode = (localStorage.getItem('snap.mode') as SnapMode) || '50mil';
  function saveSnapMode() { localStorage.setItem('snap.mode', snapMode); }

  // Crosshair display mode: 'full' or 'short'
  let crosshairMode: 'full' | 'short' = (localStorage.getItem('crosshair.mode') as 'full' | 'short') || 'full';

  // Connection hint: temporary lock to a wire endpoint's X AND Y coordinates
  type ConnectionHint = { lockedPt: Point; targetPt: Point; wasOrthoActive: boolean; lockAxis: 'x' | 'y' } | null;
  let connectionHint: ConnectionHint = null;
  // Visual shift indicator for temporary ortho mode
  let shiftOrthoVisualActive = false;
  // Visual indicator when endpoint circle overrides ortho mode
  let endpointOverrideActive = false;

  // ================================================================================
  // ================================================================================
  // ====== 3. STATE MANAGEMENT ======
  // ================================================================================
  // Type definitions moved to types.ts and imported at the top

  let mode: EditorMode = 'select';
  let placeType: PlaceType | null = null;
  // Selection object: supports multiple items
  let selection: Selection = { items: [] };
  let drawing: { active: boolean; points: Point[]; cursor: Point | null } = { active: false, points: [], cursor: null };
  
  // ====== Selection Helper Functions ======
  
  /**
   * Check if selection is empty
   */
  function isSelectionEmpty(): boolean {
    return selection.items.length === 0;
  }
  
  /**
   * Check if a specific item is selected
   */
  function isSelected(kind: string, id: string): boolean {
    return selection.items.some(item => item.kind === kind && item.id === id);
  }
  
  /**
   * Add an item to selection (for shift-click)
   */
  function addToSelection(kind: string, id: string, segIndex: number | null = null) {
    if (!isSelected(kind, id)) {
      selection.items.push({ kind, id, segIndex } as SelectionItem);
    }
  }
  
  /**
   * Remove an item from selection (for shift-click on already selected item)
   */
  function removeFromSelection(kind: string, id: string) {
    selection.items = selection.items.filter(item => !(item.kind === kind && item.id === id));
  }
  
  /**
   * Toggle an item in selection (for shift-click)
   */
  function toggleSelection(kind: string, id: string, segIndex: number | null = null) {
    if (isSelected(kind, id)) {
      removeFromSelection(kind, id);
    } else {
      addToSelection(kind, id, segIndex);
    }
  }
  
  /**
   * Set selection to a single item (clears existing selection)
   */
  function selectSingle(kind: string, id: string, segIndex: number | null = null) {
    selection.items = [{ kind, id, segIndex } as SelectionItem];
  }
  
  /**
   * Clear all selection
   */
  function clearSelection() {
    selection.items = [];
  }
  
  /**
   * Get first selected item (for backwards compatibility)
   */
  function getFirstSelection(): SelectionItem | null {
    return selection.items.length > 0 ? selection.items[0] : null;
  }
  
  // ====== Constraint System ======
  let USE_CONSTRAINTS = false; // Feature flag for constraint-based movement
  let USE_MANHATTAN_ROUTING = false; // Feature flag for KiCad-style Manhattan path routing
  let constraintSolver: ConstraintSolver | null = null;
  // Marquee selection (click+drag rectangle) state
  let marquee: {
    active: boolean;
    start: Point | null;
    end: Point | null;
    rectEl: SVGRectElement | null;
    startedOnEmpty: boolean;
    shiftPreferComponents: boolean;
    shiftCrossingMode: boolean; // true = select items crossing boundary, false = select items fully inside
  } = { active: false, start: null, end: null, rectEl: null, startedOnEmpty: false, shiftPreferComponents: false, shiftCrossingMode: false };

  // ---- Wire topology (nodes/edges/SWPs) + per-move collapse context ----
  let topology: Topology = { nodes: [], edges: [], swps: [], compToSwp: new Map() };
  let moveCollapseCtx: MoveCollapseCtx | null = null; // set while moving a component within its SWP
  let draggedComponentId: string | null = null; // track component being dragged to hide only its endpoint circles
  let lastMoveCompId: string | null = null;           // component id whose SWP is currently collapsed
  
  // ---- Wire stretch/drag state ----
  let wireStretchState: { 
    wire: Wire; 
    startMousePos: Point; 
    originalPoints: Point[];
    originalP0: Point;
    originalP1: Point;
    connectedWiresStart: Array<{ wire: Wire; isStart: boolean; originalPoint: Point }>;
    connectedWiresEnd: Array<{ wire: Wire; isStart: boolean; originalPoint: Point }>;
    componentsOnWire: Array<{ comp: Component; pins: Point[]; axis: 'x' | 'y' }>;
    junctionAtStart?: { id: string; at: Point; netId?: string; manual?: boolean; color?: string; size?: number; suppressed?: boolean };
    junctionAtEnd?: { id: string; at: Point; netId?: string; manual?: boolean; color?: string; size?: number; suppressed?: boolean };
    ghostConnectingWires: Array<{ from: Point; to: Point }>; // Visual feedback for connecting wires
    createdConnectingWireIds: string[]; // Track connecting wires we create so we can update them
    dragging: boolean;
  } | null = null;
  
  // Global state for free endpoint stretching along wire axis
  let endpointStretchState: {
    wire: Wire;
    endpointIndex: number; // 0 or 1 (which endpoint being stretched)
    originalPoints: Point[];
    axis: 'x' | 'y'; // Direction of wire
    fixedCoord: number; // The coordinate that doesn't change (x for vertical, y for horizontal)
    dragging: boolean;
  } | null = null;
  
  // Global state for lateral component dragging (breaking free from SWP)
  let componentDragState: {
    component: Component;
    wires: Array<{
      wire: Wire;
      pinIndex: number;
      originalPoints: Point[]; // Original wire geometry
      originalPinPosition: Point;
      axis: 'x' | 'y';
      isStart: boolean;
      shouldBreakAtFarEnd: boolean; // True if junction/component at far end
      farEndpoint: Point; // Far endpoint position for ghost wire
      perpendicularWires: Array<{ // Perpendicular wires connected at far end that need stretching
        wire: Wire;
        endpointIndex: number; // 0 or 1, which endpoint connects to our far end
        originalPoints: Point[];
      }>;
    }>;
    ghostWires: Array<{ from: Point; to: Point }>;
  } | null = null;

  // Suppress the next contextmenu after right-click finishing a wire
  let suppressNextContextMenu = false;
  // ViewBox zoom state
  let zoom = 1;
  let viewX = 0, viewY = 0; // pan in SVG units
  let viewW = BASE_W, viewH = BASE_H; // effective viewBox size (updated by applyZoom)
  function applyZoom() {
    // Match the SVG element's current aspect ratio so the grid fills the canvas (no letterboxing)
    const vw = Math.max(1, svg.clientWidth);
    const vh = Math.max(1, svg.clientHeight);
    const aspect = vw / vh;
    viewW = BASE_W / zoom;
    viewH = viewW / aspect;              // compute height from live aspect
    svg.setAttribute('viewBox', `${viewX} ${viewY} ${viewW} ${viewH}`);
    redrawGrid();
    // Re-render canvas overlays (endpoint circles, wires) so overlays stay aligned after zoom
    redrawCanvasOnly();
    // Update marquee stroke-width to maintain 1px appearance at any zoom level
    Input.updateMarqueeStroke(marquee.rectEl, zoom);
    updateZoomUI();
  }
  // keep grid filling canvas on window resizes
  window.addEventListener('resize', applyZoom);
  function redrawGrid() {
    const w = viewW, h = viewH;
    const rEl = document.getElementById('gridRect');
    const r = rEl as unknown as SVGRectElement | null;
    if (!r) return;
    setAttr(r, 'x', viewX);
    setAttr(r, 'y', viewY);
    setAttr(r, 'width', w);
    setAttr(r, 'height', h);

    // Calculate grid spacing using the same algorithm as dot grid
    // This ensures line grid intersections align with dot positions
    const scale = svg.clientWidth / Math.max(1, viewW); // screen px per user unit

    // Grid spacing depends on grid unit system (imperial vs metric)
    let baseGridUser: number;
    let snapMultiplier: number;
    const zoomMin = 0.25, zoom1x = 10;

    if (gridUnit === 'metric') {
      // Metric system: use mm-based grids
      // Base: 0.5mm, Zoom adaptive: 2.5mm (low) → 1mm (mid) → 0.5mm (high)
      baseGridUser = mmToPx(0.5); // 0.5mm base grid
      
      if (zoom <= zoomMin) {
        snapMultiplier = 5; // 2.5mm at low zoom
      } else if (zoom >= zoom1x) {
        snapMultiplier = 1; // 0.5mm from 10x zoom onward
      } else {
        // Discrete multipliers [1, 2, 5] for intermediate zooms
        const t = (zoom - zoomMin) / (zoom1x - zoomMin);
        const interpolated = 5 - t * 4;
        if (interpolated > 3) snapMultiplier = 5;
        else if (interpolated > 1.5) snapMultiplier = 2;
        else snapMultiplier = 1;
      }
    } else {
      // Imperial system: use mil-based grids (existing behavior)
      baseGridUser = nmToPx(SNAP_NM); // 50 mils = 5 user units
      
      if (zoom <= zoomMin) {
        snapMultiplier = 5; // 250 mils at low zoom
      } else if (zoom >= zoom1x) {
        snapMultiplier = 1; // 50 mils from 10x zoom onward
      } else {
        const t = (zoom - zoomMin) / (zoom1x - zoomMin);
        const interpolated = 5 - t * 4;
        if (interpolated > 3) snapMultiplier = 5;
        else if (interpolated > 1.5) snapMultiplier = 2;
        else snapMultiplier = 1;
      }
    }

    // Grid spacing in user units
    const minorUser = baseGridUser * snapMultiplier;

    // Major grid lines every 5 minor divisions
    const cellsPerMajor = 5;
    const majorUser = minorUser * cellsPerMajor;

    // Save chosen snap spacing for use by snap() function
    CURRENT_SNAP_USER_UNITS = minorUser;

    // Update grid pattern defs: `#grid` will represent a major cell and draw
    // its internal minor lines at multiples of minorUser. Anchor patterns to
    // the global origin (0,0) so lines lie on absolute multiples of minorUser.
    const patEl = document.getElementById('grid');
    const pat = patEl as unknown as SVGPatternElement | null;
    const patBoldEl = document.getElementById('gridBold');
    const patBold = patBoldEl as unknown as SVGPatternElement | null;
    const ns = 'http://www.w3.org/2000/svg';
    if (pat) {
      pat.setAttribute('width', String(majorUser));
      pat.setAttribute('height', String(majorUser));
      // clear and draw lines at every minorUser step within majorUser
      while (pat.firstChild) pat.removeChild(pat.firstChild);
      const bg = document.createElementNS(ns, 'rect');
      bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
      bg.setAttribute('width', String(majorUser)); bg.setAttribute('height', String(majorUser));
      bg.setAttribute('fill', 'none'); pat.appendChild(bg);
      // vertical lines (iterate integer steps to avoid FP drift)
      for (let xi = 0; xi <= cellsPerMajor; xi++) {
        const x = xi * minorUser;
        const ln = document.createElementNS(ns, 'line');
        ln.setAttribute('x1', String(x)); ln.setAttribute('y1', '0'); ln.setAttribute('x2', String(x)); ln.setAttribute('y2', String(majorUser));
        // major line if xi is multiple of cellsPerMajor
        const isMajor = (xi % cellsPerMajor) === 0;
        ln.setAttribute('stroke', isMajor ? 'var(--grid-bold)' : 'var(--grid)');
        ln.setAttribute('stroke-width', isMajor ? '1.5' : '0.6');
        pat.appendChild(ln);
      }
      // horizontal lines (iterate integer steps)
      for (let yi = 0; yi <= cellsPerMajor; yi++) {
        const y = yi * minorUser;
        const ln = document.createElementNS(ns, 'line');
        ln.setAttribute('x1', '0'); ln.setAttribute('y1', String(y)); ln.setAttribute('x2', String(majorUser)); ln.setAttribute('y2', String(y));
        const isMajor = (yi % cellsPerMajor) === 0;
        ln.setAttribute('stroke', isMajor ? 'var(--grid-bold)' : 'var(--grid)');
        ln.setAttribute('stroke-width', isMajor ? '1.5' : '0.6');
        pat.appendChild(ln);
      }
      // Anchor to global origin: no patternTransform so lines occur at absolute multiples
      pat.removeAttribute('patternTransform');
    }
    if (patBold) {
      // patBold will simply tile the major cell — ensure it matches majorUser
      patBold.setAttribute('width', String(majorUser));
      patBold.setAttribute('height', String(majorUser));
      // replace inner rect so it references current grid pattern
      while (patBold.firstChild) patBold.removeChild(patBold.firstChild);
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('width', String(majorUser)); rect.setAttribute('height', String(majorUser));
      rect.setAttribute('fill', 'url(#grid)'); patBold.appendChild(rect);
      const border = document.createElementNS(ns, 'path');
      border.setAttribute('d', `M${majorUser} 0H0V${majorUser}`);
      border.setAttribute('fill', 'none'); border.setAttribute('stroke', 'var(--grid-bold)'); border.setAttribute('stroke-width', '1.5');
      patBold.appendChild(border);
      patBold.removeAttribute('patternTransform');
    }

    // Update status bar UI with the current grid spacing in mils
    try {
      const k = document.getElementById('gridSizeKbd');
      // Convert minorUser to mils for display (5 user units = 50 mils)
      const milsPerUserUnit = 10; // 100 px/inch ÷ 1000 mils/inch = 0.1 px/mil, so 1 user unit = 10 mils
      const gridMils = Math.round(minorUser * milsPerUserUnit);
      if (k) k.textContent = `${gridMils} mil`;
    } catch (err) {/* ignore */ }

    // Update grid display based on gridMode
    try {
      const rEl = document.getElementById('gridRect') as unknown as SVGRectElement | null;
      if (rEl) {
        if (gridMode === 'line') {
          rEl.setAttribute('fill', 'url(#gridBold)');
        } else {
          rEl.setAttribute('fill', 'none');
        }
      }
    } catch (_) { }

    // Render dot grid with same spacing as line grid
    const dotGridEl = document.getElementById('dotGrid');
    if (dotGridEl && gridMode === 'dot') {
      dotGridEl.replaceChildren();

      // Use the same spacing calculation as line grid (already calculated above)
      const dotSpacingUser = minorUser;

      // Calculate dot radius (1 screen pixel)
      const dotRadius = 1 / scale;

      // Calculate visible bounds with padding
      const startX = Math.floor(viewX / dotSpacingUser) * dotSpacingUser;
      const endX = viewX + viewW + dotSpacingUser;
      const startY = Math.floor(viewY / dotSpacingUser) * dotSpacingUser;
      const endY = viewY + viewH + dotSpacingUser;

      // Draw dots at grid intersections
      for (let x = startX; x <= endX; x += dotSpacingUser) {
        for (let y = startY; y <= endY; y += dotSpacingUser) {
          const dot = document.createElementNS(ns, 'circle');
          dot.setAttribute('cx', String(x));
          dot.setAttribute('cy', String(y));
          dot.setAttribute('r', String(dotRadius));
          dot.setAttribute('fill', 'var(--grid)');
          dot.setAttribute('pointer-events', 'none');
          dotGridEl.appendChild(dot);
        }
      }

      dotGridEl.style.display = '';
    } else if (dotGridEl) {
      dotGridEl.style.display = 'none';
    }
  }
  function updateZoomUI() {
    const z = Math.round(zoom * 100);
    const inp = document.getElementById('zoomPct') as HTMLInputElement | null;
    if (inp && inp.value !== z + '%') inp.value = z + '%';
  }

  // Toggle grid visibility UI and persistence
  function updateGridToggleButton() {
    if (!gridToggleBtnEl) gridToggleBtnEl = document.getElementById('gridToggleBtn') as HTMLButtonElement | null;
    if (!gridToggleBtnEl) return;
    if (gridMode === 'off') {
      gridToggleBtnEl.classList.add('dim');
      gridToggleBtnEl.textContent = 'Grid';
    } else {
      gridToggleBtnEl.classList.remove('dim');
      if (gridMode === 'line') {
        gridToggleBtnEl.textContent = 'Grid: Lines';
      } else {
        gridToggleBtnEl.textContent = 'Grid: Dots';
      }
    }
  }

  function toggleGrid() {
    // Cycle through: line -> dot -> off -> line
    if (gridMode === 'line') {
      gridMode = 'dot';
    } else if (gridMode === 'dot') {
      gridMode = 'off';
    } else {
      gridMode = 'line';
    }
    localStorage.setItem('grid.mode', gridMode);
    redrawGrid();
    updateGridToggleButton();
  }

  // ================================================================================
  // ====== 3. STATE MANAGEMENT ======
  // ================================================================================

  // --- Component and Wire Counters ---
  let counters = { resistor: 1, capacitor: 1, inductor: 1, diode: 1, npn: 1, pnp: 1, ground: 1, battery: 1, ac: 1, wire: 1 };

  // --- Core Model Arrays ---
  let components: Component[] = [];
  let wires: Wire[] = [];
  let textLabels: import('./types.js').TextLabel[] = [];

  // --- Text Label Drag State (persists across redraws) ---
  let textDragState: { kind: 'label' | 'value'; componentId: string; startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null = null;

  // Nets collection: user-defined nets for manual assignment
  let nets: Set<string> = new Set(['default']);
  let activeNetClass: string = 'default';

  // --- Undo/Redo Stacks ---
  interface EditorState {
    components: Component[];
    wires: Wire[];
    junctions: typeof junctions;
    textLabels: typeof textLabels;
    selection: typeof selection;
    counters: typeof counters;
    nets: Set<string>;
    netClasses: Record<string, NetClass>;
    activeNetClass: string;
    wireDefaults: typeof WIRE_DEFAULTS;
    defaultResistorStyle: ResistorStyle;
  }
  let undoStack: EditorState[] = [];
  let redoStack: EditorState[] = [];
  const MAX_UNDO_STACK = 50; // Limit stack size to prevent memory issues

  function captureState(): EditorState {
    // Deep clone all mutable state
    return {
      components: JSON.parse(JSON.stringify(components)),
      wires: JSON.parse(JSON.stringify(wires)),
      junctions: JSON.parse(JSON.stringify(junctions)),
      textLabels: JSON.parse(JSON.stringify(textLabels)),
      selection: { ...selection },
      counters: { ...counters },
      nets: new Set(nets),
      netClasses: JSON.parse(JSON.stringify(NET_CLASSES)),
      activeNetClass: activeNetClass,
      wireDefaults: JSON.parse(JSON.stringify(WIRE_DEFAULTS)),
      defaultResistorStyle: defaultResistorStyle
    };
  }

  function restoreState(state: EditorState) {
    // Restore all state from snapshot
    components = JSON.parse(JSON.stringify(state.components));
    wires = JSON.parse(JSON.stringify(state.wires));
    junctions = JSON.parse(JSON.stringify(state.junctions));
    // Migrate: ensure all junctions have IDs (for backward compatibility)
    for (const j of junctions) {
      if (!j.id) j.id = State.uid('junction');
    }
    textLabels = JSON.parse(JSON.stringify(state.textLabels || []));
    selection = { ...state.selection };
    counters = { ...state.counters };
    nets = new Set(state.nets);

    // Restore NET_CLASSES by clearing and re-adding
    for (const key in NET_CLASSES) {
      if (key !== 'default') delete NET_CLASSES[key];
    }

    // Restore WIRE_DEFAULTS
    WIRE_DEFAULTS = JSON.parse(JSON.stringify(state.wireDefaults));
    const restoredClasses = JSON.parse(JSON.stringify(state.netClasses));
    for (const key in restoredClasses) {
      NET_CLASSES[key] = restoredClasses[key];
    }

    activeNetClass = state.activeNetClass;
    defaultResistorStyle = state.defaultResistorStyle;

    // Rebuild topology and UI
    rebuildTopology();
    redraw();
    renderNetList();
    renderInspector();
    syncWireToolbar(); // Update wire stroke toolbar to reflect restored defaults
  }

  // ====== Text Label Helpers ======
  
  /**
   * Create text labels for a component (label and value text)
   */
  function createLabelsForComponent(comp: Component) {
    // Determine label position based on component type
    let labelX = comp.x;
    let labelY = comp.y + 46;
    let anchor: 'start' | 'middle' | 'end' = 'middle';
    
    // Transistors have label to the right
    if (comp.type === 'npn' || comp.type === 'pnp') {
      labelX = comp.x + 60;
      labelY = comp.y;
      anchor = 'start';
    }
    
    // Create label text
    const labelId = `label-${comp.id}`;
    textLabels.push({
      id: labelId,
      text: comp.label,
      x: labelX,
      y: labelY,
      fontSize: 12,
      fontFamily: 'Arial, sans-serif',
      bold: false,
      italic: false,
      underline: false,
      anchor: anchor,
      parentComponentId: comp.id,
      labelType: 'label'
    });
    
    // Create value text if there's a value
    if (comp.value && comp.value.trim()) {
      const valueY = labelY + 16; // 16px below label
      const valueId = `value-${comp.id}`;
      textLabels.push({
        id: valueId,
        text: Components.formatValue(comp),
        x: labelX,
        y: valueY,
        fontSize: 12,
        fontFamily: 'Arial, sans-serif',
        bold: false,
        italic: false,
        underline: false,
        anchor: anchor,
        parentComponentId: comp.id,
        labelType: 'value'
      });
    }
  }

  function pushUndo() {
    // Capture current state before modification
    undoStack.push(captureState());

    // Limit stack size
    if (undoStack.length > MAX_UNDO_STACK) {
      undoStack.shift();
    }

    // Clear redo stack on new action
    redoStack = [];
    updateUndoRedoButtons();
  }

  function undo() {
    if (undoStack.length === 0) return;

    // Save current state to redo stack
    redoStack.push(captureState());

    // Restore previous state
    const prevState = undoStack.pop()!;
    restoreState(prevState);
    updateUndoRedoButtons();
  }

  function redo() {
    if (redoStack.length === 0) return;

    // Save current state to undo stack
    undoStack.push(captureState());

    // Restore next state
    const nextState = redoStack.pop()!;
    restoreState(nextState);
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement | null;
    const redoBtn = document.getElementById('redoBtn') as HTMLButtonElement | null;
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  // Palette state: diode subtype selection
  let diodeSubtype: DiodeSubtype = 'generic';
  let capacitorSubtype: CapacitorSubtype = 'standard';
  let transistorType: 'npn' | 'pnp' = 'npn';

  // Wire color state: default from CSS var, and current palette choice (affects new wires only)
  const defaultWireColor: string = (getComputedStyle(document.documentElement).getPropertyValue('--wire').trim() || '#c7f284');
  // --- Theme & NetClasses (moved early so redraw() doesn't hit TDZ) ---
  const THEME: Theme = {
    wire: { width: 0.25, type: 'solid', color: cssToRGBA01(defaultWireColor) },
    junction: { size: 0.762, color: cssToRGBA01('#FFFFFF') }
  };
  const NET_CLASSES: Record<string, NetClass> = {
    default: {
      id: 'default',
      name: 'Default',
      wire: { width: 0.25, type: 'solid', color: cssToRGBA01(defaultWireColor) },
      junction: { size: 0.762, color: cssToRGBA01('#FFFFFF') }
    }
  };

  type WireColorMode = 'custom' | 'auto' | 'white' | 'black' | 'red' | 'green' | 'blue' | 'yellow' | 'magenta' | 'cyan';
  let currentWireColorMode: WireColorMode = 'auto';

  function resolveWireColor(mode: WireColorMode): string {
    const map: Record<Exclude<WireColorMode, 'auto'>, string> = {
      custom: 'custom',
      white: '#ffffff',
      black: '#000000',
      red: 'red',
      green: 'lime',
      blue: 'deepskyblue',
      yellow: 'gold',
      magenta: 'magenta',
      cyan: 'cyan'
    };

    // Auto → choose black/white against current page theme
    if (mode === 'auto') {
      const bg = getComputedStyle(document.body).backgroundColor;
      const rgb = bg.match(/\d+/g)?.map(Number) || [0, 0, 0];
      const [r, g, b] = rgb;
      const srgb = [r / 255, g / 255, b / 255].map(v => (v <= 0.03928) ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
      return (L < 0.5) ? '#ffffff' : '#000000';
    }

    // Black → render as white in dark mode, but keep black internally
    if (mode === 'black') {
      const bg = getComputedStyle(document.body).backgroundColor;
      const rgb = bg.match(/\d+/g)?.map(Number) || [0, 0, 0];
      const [r, g, b] = rgb;
      const srgb = [r / 255, g / 255, b / 255].map(v => (v <= 0.03928) ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
      return (L < 0.5) ? '#ffffff' : '#000000';
    }

    // White → always render as white
    if (mode === 'white') {
      return '#ffffff';
    }

    // Custom → mirror the toolbar's explicit stroke color
    if (mode === 'custom') {
      const col = (typeof WIRE_DEFAULTS !== 'undefined' && WIRE_DEFAULTS?.stroke?.color)
        ? WIRE_DEFAULTS.stroke.color
        : cssToRGBA01(defaultWireColor);
      return rgba01ToCss(col);
    }

    // Named swatches
    return map[mode] || defaultWireColor;
  }

  let junctions: Junction[] = [];

  function wireColorNameFromValue(v) {
    const val = (v || '').toLowerCase();
    // map actual stroke values back to option keys when possible
    if (val === '#ffffff' || val === 'ffffff' || val === 'white') return 'white';
    if (val === '#000000' || val === '000000' || val === 'black') return 'black';
    if (val === 'red') return 'red';
    if (val === 'lime') return 'green';
    if (val === 'deepskyblue') return 'blue';
    if (val === 'gold') return 'yellow';
    if (val === 'magenta') return 'magenta';
    if (val === 'cyan') return 'cyan';
    // theme-contrast outcomes of 'auto'
    if (val === '#fff' || val === '#ffffff' || val === 'white') return 'auto';
    if (val === '#000' || val === '#000000' || val === 'black') return 'auto';
    // legacy default wire color → closest bucket
    if (val === '#c7f284') return 'yellow';
    // fallback
    return 'auto';
  }

  // Helper to create a split black/white swatch
  function createSplitSwatch(el: HTMLElement) {
    if (!el) return;
    el.style.background = 'linear-gradient(to bottom right, #000000 0%, #000000 49%, #ffffff 51%, #ffffff 100%)';
    el.style.border = '1px solid #666666';
  }

  const setSwatch = (el, color) => {
    if (!el) return;
    // Special handling for black/white: show split diagonal swatch
    const hexColor = colorToHex(color).toUpperCase();
    if (hexColor === '#000000' || hexColor === '#FFFFFF') {
      createSplitSwatch(el);
    } else {
      el.style.background = color;
      el.style.backgroundColor = color;
      el.style.border = '';
    }
  };

  // Snap to the configured SNAP_NM resolution (converted to px). We keep the
  // `GRID` constant for component/layout sizes; snapping is driven by SNAP_NM.
  // Current chosen snap spacing in SVG user units (set by redrawGrid()).
  let CURRENT_SNAP_USER_UNITS: number | null = null;

  const snap = (v: number): number => {
    if (snapMode === 'off') return v; // No snapping

    if (snapMode === 'grid') {
      // Snap to visible grid spacing (CURRENT_SNAP_USER_UNITS)
      const gridUnits = CURRENT_SNAP_USER_UNITS || baseSnapUser();
      return Math.round(v / gridUnits) * gridUnits;
    }

    if (snapMode === '1mm') {
      // Snap to 1mm grid
      const mmUnits = mmToPx(1.0);
      return Math.round(v / mmUnits) * mmUnits;
    }

    // Default: '50mil' mode - snap to 50-mil base grid
    const snapUnits = baseSnapUser(); // Returns 5 for 50 mil spacing
    return Math.round(v / snapUnits) * snapUnits;
  };

  function updateCounts() {
    countsEl.textContent = `Components: ${components.length} · Wires: ${wires.length}`;
  }

  function renderNetList() {
    const netListEl = document.getElementById('netList');
    if (!netListEl) return;

    // Collect all nets currently in use by wires
    const usedNets = new Set<string>();
    wires.forEach(w => { if (w.netId) usedNets.add(w.netId); });

    // Merge with user-defined nets
    usedNets.forEach(n => nets.add(n));

    if (nets.size === 0) {
      netListEl.textContent = 'No nets defined';
      return;
    }

    const netArray = Array.from(nets).sort();
    netListEl.textContent = '';

    const ul = document.createElement('ul');
    ul.style.margin = '0.5rem 0';
    ul.style.padding = '0 0 0 1.2rem';
    ul.style.listStyle = 'none';

    netArray.forEach(netName => {
      const li = document.createElement('li');
      li.style.marginBottom = '0.3rem';
      li.style.display = 'flex';
      li.style.alignItems = 'center';
      li.style.gap = '0.5rem';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = netName;
      nameSpan.style.flex = '1';
      nameSpan.style.cursor = 'pointer';
      nameSpan.title = 'Click to set as active net class';

      // Show active indicator
      if (netName === activeNetClass) {
        nameSpan.style.fontWeight = 'bold';
        nameSpan.style.color = 'var(--accent)';
        const indicator = document.createElement('span');
        indicator.textContent = ' ●';
        indicator.style.fontSize = '0.7rem';
        nameSpan.appendChild(indicator);
      }

      // Click to set as active net class
      nameSpan.onclick = () => {
        activeNetClass = netName;
        renderNetList();
      };

      // Edit button for all nets
      const editBtn = document.createElement('button');
      editBtn.textContent = '✎';
      editBtn.style.padding = '0.1rem 0.4rem';
      editBtn.style.fontSize = '1rem';
      editBtn.style.lineHeight = '1';
      editBtn.style.cursor = 'pointer';
      editBtn.title = 'Edit net properties';
      editBtn.onclick = () => {
        Netlist.showNetPropertiesDialog({
          netName,
          netClass: NET_CLASSES[netName],
          globalUnits,
          NM_PER_MM,
          formatDimForDisplay,
          parseDimInput,
          colorToHex,
          rgba01ToCss,
          onSave: (updates) => {
            pushUndo();
            NET_CLASSES[netName].wire.width = updates.width;
            NET_CLASSES[netName].wire.type = updates.type;
            NET_CLASSES[netName].wire.color = updates.color;
            wires.forEach(w => {
              if (w.netId === netName && w.stroke && w.stroke.type === 'default') {
                w.color = rgba01ToCss(NET_CLASSES[netName].wire.color);
              }
            });
            renderNetList();
            redraw();
          }
        });
      };

      li.appendChild(nameSpan);
      li.appendChild(editBtn);

      // Delete button (except for 'default')
      if (netName !== 'default') {
        const delBtn = document.createElement('button');
        delBtn.textContent = '×';
        delBtn.style.padding = '0.1rem 0.4rem';
        delBtn.style.fontSize = '1.2rem';
        delBtn.style.lineHeight = '1';
        delBtn.style.cursor = 'pointer';
        delBtn.title = 'Delete net';
        delBtn.onclick = () => {
          if (confirm(`Delete net "${netName}"? Wires using this net will be assigned to "default".`)) {
            nets.delete(netName);
            delete NET_CLASSES[netName];
            // Reassign any wires using this net to default
            wires.forEach(w => { if (w.netId === netName) w.netId = 'default'; });
            renderNetList();
            redraw();
          }
        };
        li.appendChild(delBtn);
      }

      ul.appendChild(li);
    });

    netListEl.appendChild(ul);
  }

  function addNet() {
    const name = prompt('Enter net name:');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (nets.has(trimmed)) {
      alert(`Net "${trimmed}" already exists.`);
      return;
    }
    // Create net class with default properties from THEME
    NET_CLASSES[trimmed] = {
      id: trimmed,
      name: trimmed,
      wire: { ...THEME.wire },
      junction: { ...THEME.junction }
    };
    nets.add(trimmed);
    renderNetList();
    // Show properties dialog for new net
    Netlist.showNetPropertiesDialog({
      netName: trimmed,
      netClass: NET_CLASSES[trimmed],
      globalUnits,
      NM_PER_MM,
      formatDimForDisplay,
      parseDimInput,
      colorToHex,
      rgba01ToCss,
      onSave: (updates) => {
        pushUndo();
        NET_CLASSES[trimmed].wire.width = updates.width;
        NET_CLASSES[trimmed].wire.type = updates.type;
        NET_CLASSES[trimmed].wire.color = updates.color;
        wires.forEach(w => {
          if (w.netId === trimmed && w.stroke && w.stroke.type === 'default') {
            w.color = rgba01ToCss(NET_CLASSES[trimmed].wire.color);
          }
        });
        renderNetList();
        redraw();
      }
    });
  }

  // Wire up junction dot buttons now that setMode is defined
  (function attachJunctionDotButtons() {
    const placeJunctionBtn = document.getElementById('placeJunctionDotBtn');
    const deleteJunctionBtn = document.getElementById('deleteJunctionDotBtn');
    if (placeJunctionBtn) {
      placeJunctionBtn.addEventListener('click', () => {
        setMode('place-junction');
      });
    }
    if (deleteJunctionBtn) {
      deleteJunctionBtn.addEventListener('click', () => {
        setMode('delete-junction');
      });
    }
  })();

  function setMode(m: EditorMode) {
    // Finalize any active wire drawing before mode change
    if (drawing.active && drawing.points.length > 0) {
      finishWire();
    }
    // Finalize any active SWP move when leaving Move mode
    if (mode === 'move' && m !== 'move') {
      ensureFinishSwpMove();
    }
    mode = m; overlayMode.textContent = m[0].toUpperCase() + m.slice(1);

    $qa<HTMLButtonElement>('#modeGroup button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === m);
    });
    // New: update custom junction dot buttons
    const pjBtn = document.getElementById('placeJunctionDotBtn');
    const djBtn = document.getElementById('deleteJunctionDotBtn');
    if (pjBtn) pjBtn.classList.toggle('active', m === 'place-junction');
    if (djBtn) djBtn.classList.toggle('active', m === 'delete-junction');

    // Ensure ortho button stays in sync when switching modes
    if (updateOrthoButtonVisual) updateOrthoButtonVisual();

    // reflect mode on body for cursor styles
    document.body.classList.remove('mode-select', 'mode-wire', 'mode-delete', 'mode-place', 'mode-pan', 'mode-move', 'mode-place-junction', 'mode-delete-junction');
    document.body.classList.add(`mode-${m}`);

    $qa<HTMLButtonElement>('#modeGroup button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === m);
    });

    // Ensure ortho button stays in sync when switching modes
    if (updateOrthoButtonVisual) updateOrthoButtonVisual();

    // reflect mode on body for cursor styles
    document.body.classList.remove('mode-select', 'mode-wire', 'mode-delete', 'mode-place', 'mode-pan', 'mode-move');
    document.body.classList.add(`mode-${m}`);
    // If user switches to Delete with an active selection, apply delete immediately
    const firstSel = getFirstSelection();
    if (m === 'delete' && firstSel) {
      if (firstSel.kind === 'component') { removeComponent(firstSel.id); return; }
      if (firstSel.kind === 'wire') {
        const w = wires.find(x => x.id === firstSel.id);
        if (w) {
          removeJunctionsAtWireEndpoints(w);
          pushUndo();
          wires = wires.filter(x => x.id !== w.id);
          clearSelection();
          normalizeAllWires();
          unifyInlineWires();
          redraw();
        }
        return;
      }
    }
    // Update diode subtype popup visibility with any mode change
    updateSubtypeVisibility();
    // SWP collapse is engaged as soon as Move mode is active with a selected component.
    if (m === 'move') {
      ensureCollapseForSelection();
    } else {
      // Leaving Move mode finalizes any collapsed SWP back into segments.
      ensureFinishSwpMove();
    }
    redraw(); // refresh wire/comp hit gating for the new mode
  }

  // Wire up Grid toggle button and shortcut (G)
  (function attachGridToggle() {
    try {
      gridToggleBtnEl = document.getElementById('gridToggleBtn') as HTMLButtonElement | null;
      if (gridToggleBtnEl) {
        gridToggleBtnEl.addEventListener('click', () => { toggleGrid(); });
        // initialize appearance
        updateGridToggleButton();
      }
    } catch (_) { }

    window.addEventListener('keydown', (e) => {
      // Ignore when typing in inputs or with modifier keys
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault(); toggleGrid();
      }
    });
  })();

  // Wire up Junction Dots toggle button
  (function attachJunctionDotsToggle() {
    try {
      const junctionDotsBtn = document.getElementById('junctionDotsBtn') as HTMLButtonElement | null;
      if (junctionDotsBtn) {
        function updateJunctionDotsButton() {
          if (showJunctionDots) {
            junctionDotsBtn.classList.add('active');
          } else {
            junctionDotsBtn.classList.remove('active');
          }
        }
        function toggleJunctionDots() {
          showJunctionDots = !showJunctionDots;
          localStorage.setItem('junctionDots.visible', showJunctionDots ? 'true' : 'false');
          updateJunctionDotsButton();
          redraw();
          renderDrawing(); // Update in-progress wire display
        }
        junctionDotsBtn.addEventListener('click', toggleJunctionDots);
        // initialize appearance
        updateJunctionDotsButton();
      }
    } catch (_) { }

    // Keyboard shortcut: . (period)
    window.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (e.key === '.') {
        e.preventDefault();
        showJunctionDots = !showJunctionDots;
        localStorage.setItem('junctionDots.visible', showJunctionDots ? 'true' : 'false');
        const btn = document.getElementById('junctionDotsBtn');
        if (btn) {
          if (showJunctionDots) btn.classList.add('active');
          else btn.classList.remove('active');
        }
        redraw();
        renderDrawing(); // Update in-progress wire display
      }
    });
  })();

  // Wire up Ortho mode toggle button and shortcut (O)
  let updateOrthoButtonVisual: (() => void) | null = null;
  (function attachOrthoToggle() {
    const orthoBtn = document.getElementById('orthoToggleBtn') as HTMLButtonElement | null;
    function updateOrthoButton() {
      if (!orthoBtn) return;
      // Show dimmed/inactive if endpoint circle is overriding ortho
      if (endpointOverrideActive) {
        orthoBtn.classList.remove('active');
        orthoBtn.style.opacity = '0.4';
      }
      // Show active if ortho mode is on OR if shift visual is active
      else if (orthoMode || shiftOrthoVisualActive) {
        orthoBtn.classList.add('active');
        orthoBtn.style.opacity = '';
      } else {
        orthoBtn.classList.remove('active');
        orthoBtn.style.opacity = '';
      }
    }
    updateOrthoButtonVisual = updateOrthoButton;
    function toggleOrtho() {
      orthoMode = !orthoMode;
      saveOrthoMode();
      updateOrthoButton();
    }
    if (orthoBtn) {
      orthoBtn.addEventListener('click', () => { toggleOrtho(); });
      updateOrthoButton();
    }
    window.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (e.key === 'o' || e.key === 'O') {
        e.preventDefault(); toggleOrtho();
      }
    });
  })();

  // Wire up Snap mode toggle button and shortcut (S)
  (function attachSnapToggle() {
    const snapBtn = document.getElementById('snapToggleBtn') as HTMLButtonElement | null;
    function updateSnapButton() {
      if (!snapBtn) return;
      // Update button text based on current mode
      if (snapMode === 'grid') {
        snapBtn.textContent = 'Grid';
        snapBtn.classList.add('active');
        snapBtn.title = 'Snap mode: Grid (S)';
      } else if (snapMode === '50mil') {
        snapBtn.textContent = '50mil';
        snapBtn.classList.add('active');
        snapBtn.title = 'Snap mode: 50mil (S)';
      } else if (snapMode === '1mm') {
        snapBtn.textContent = '1mm';
        snapBtn.classList.add('active');
        snapBtn.title = 'Snap mode: 1mm (S)';
      } else { // 'off'
        snapBtn.textContent = 'Off';
        snapBtn.classList.remove('active');
        snapBtn.title = 'Snap mode: Off (S)';
      }
    }
    function cycleSnapMode() {
      // Cycle through all modes: 50mil → 1mm → grid → off → 50mil
      // This allows users to choose any snap mode regardless of grid unit
      if (snapMode === '50mil') snapMode = '1mm';
      else if (snapMode === '1mm') snapMode = 'grid';
      else if (snapMode === 'grid') snapMode = 'off';
      else snapMode = '50mil';
      
      saveSnapMode();
      updateSnapButton();
      updateSnapStatus();
      
      // Re-sync constraints to update grid-snap based on new snap mode
      if (USE_CONSTRAINTS && constraintSolver) {
        syncConstraints();
      }
    }
    function updateSnapStatus() {
      const snapK = document.getElementById('snapKbd');
      if (!snapK) return;
      if (snapMode === 'off') {
        snapK.textContent = 'off';
      } else if (snapMode === 'grid') {
        snapK.textContent = 'grid';
      } else if (snapMode === '1mm') {
        snapK.textContent = '1mm';
      } else {
        snapK.textContent = '50mil';
      }
    }
    if (snapBtn) {
      snapBtn.addEventListener('click', () => { cycleSnapMode(); });
      updateSnapButton();
      updateSnapStatus();
    }
    window.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault(); cycleSnapMode();
      }
    });
  })();

  // Grid Unit Toggle (imperial/metric)
  (function attachGridUnitToggle() {
    const gridUnitBtn = document.getElementById('gridUnitBtn') as HTMLButtonElement | null;
    function updateGridUnitButton() {
      if (!gridUnitBtn) return;
      if (gridUnit === 'metric') {
        gridUnitBtn.textContent = 'mm';
        gridUnitBtn.title = 'Grid Units: Metric (U) - 0.5mm base';
      } else {
        gridUnitBtn.textContent = 'mil';
        gridUnitBtn.title = 'Grid Units: Imperial (U) - 50mil base';
      }
    }
    function toggleGridUnit() {
      gridUnit = gridUnit === 'imperial' ? 'metric' : 'imperial';
      saveGridUnit();
      updateGridUnitButton();
      
      // Auto-switch snap mode between 50mil ↔ 1mm when switching units
      if (gridUnit === 'metric' && snapMode === '50mil') {
        snapMode = '1mm';
        saveSnapMode();
      } else if (gridUnit === 'imperial' && snapMode === '1mm') {
        snapMode = '50mil';
        saveSnapMode();
      }
      
      // Auto-switch display units to match grid unit system
      if (gridUnit === 'metric' && (globalUnits === 'in' || globalUnits === 'mils')) {
        // Switching to metric: change display units to mm
        setGlobalUnits('mm');
        const unitsSelect = document.getElementById('unitsSelect') as HTMLSelectElement;
        if (unitsSelect) unitsSelect.value = 'mm';
      } else if (gridUnit === 'imperial' && globalUnits === 'mm') {
        // Switching to imperial: change display units to mils (more common than inches)
        setGlobalUnits('mils');
        const unitsSelect = document.getElementById('unitsSelect') as HTMLSelectElement;
        if (unitsSelect) unitsSelect.value = 'mils';
      }
      
      // Update snap button to reflect potential mode change
      const snapBtn = document.getElementById('snapToggleBtn') as HTMLButtonElement | null;
      if (snapBtn) {
        const updateBtn = () => {
          if (snapMode === 'grid') {
            snapBtn.textContent = 'Grid';
            snapBtn.classList.add('active');
          } else if (snapMode === '50mil') {
            snapBtn.textContent = '50mil';
            snapBtn.classList.add('active');
          } else if (snapMode === '1mm') {
            snapBtn.textContent = '1mm';
            snapBtn.classList.add('active');
          } else {
            snapBtn.textContent = 'Off';
            snapBtn.classList.remove('active');
          }
        };
        updateBtn();
      }
      
      redrawGrid(); // Redraw grid with new unit system
      redraw(); // Redraw canvas to apply new snapping
      
      // Re-sync constraints if enabled
      if (USE_CONSTRAINTS && constraintSolver) {
        syncConstraints();
      }
    }
    if (gridUnitBtn) {
      gridUnitBtn.addEventListener('click', toggleGridUnit);
      updateGridUnitButton();
    }
    window.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (e.key === 'u' || e.key === 'U') {
        e.preventDefault(); toggleGridUnit();
      }
    });
  })();

  // Wire up Crosshair toggle button and shortcut (X)
  (function attachCrosshairToggle() {
    const crosshairBtn = document.getElementById('crosshairToggleBtn') as HTMLButtonElement | null;
    function updateCrosshairButton() {
      if (!crosshairBtn) return;
      // Toggle visibility of full vs short crosshair lines in the SVG
      const fullLines = crosshairBtn.querySelectorAll('.crosshair-full');
      const shortLines = crosshairBtn.querySelectorAll('.crosshair-short');
      
      if (crosshairMode === 'full') {
        fullLines.forEach(line => (line as SVGElement).style.display = '');
        shortLines.forEach(line => (line as SVGElement).style.display = 'none');
        crosshairBtn.classList.add('active');
      } else {
        fullLines.forEach(line => (line as SVGElement).style.display = 'none');
        shortLines.forEach(line => (line as SVGElement).style.display = '');
        crosshairBtn.classList.remove('active');
      }
    }

    function toggleCrosshairMode() {
      crosshairMode = crosshairMode === 'full' ? 'short' : 'full';
      localStorage.setItem('crosshair.mode', crosshairMode);
      updateCrosshairButton();
      // Refresh crosshair display if in wire mode
      if (mode === 'wire' && drawing.cursor) {
        renderCrosshair(drawing.cursor.x, drawing.cursor.y);
      }
    }

    if (crosshairBtn) {
      crosshairBtn.addEventListener('click', toggleCrosshairMode);
      updateCrosshairButton();
    }

    window.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (e.key === 'x' || e.key === 'X') {
        e.preventDefault(); toggleCrosshairMode();
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault(); toggleCrosshairMode();
      }
    });
  })();

  // Wire up Tracking toggle button and shortcut (T)
  (function attachTrackingToggle() {
    const trackingBtn = document.getElementById('trackingToggleBtn') as HTMLButtonElement | null;
    function updateTrackingButton() {
      if (!trackingBtn) return;
      if (trackingMode) {
        trackingBtn.classList.add('active');
      } else {
        trackingBtn.classList.remove('active');
      }
    }

    function toggleTracking() {
      trackingMode = !trackingMode;
      localStorage.setItem('tracking.mode', trackingMode ? 'true' : 'false');
      updateTrackingButton();
      // Clear any active connection hint when disabling tracking
      if (!trackingMode) {
        connectionHint = null;
        renderConnectionHint();
      }
    }

    if (trackingBtn) {
      trackingBtn.addEventListener('click', toggleTracking);
      updateTrackingButton();
    }

    window.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault(); toggleTracking();
      }
    });
  })();

  // Wire up Theme toggle button
  (function attachThemeToggle() {
    const themeBtn = document.getElementById('themeToggleBtn') as HTMLButtonElement | null;
    const htmlEl = document.documentElement;

    // Load saved theme or default to dark
    let currentTheme = localStorage.getItem('theme') || 'dark';

    function applyTheme(theme: string) {
      if (theme === 'light') {
        htmlEl.setAttribute('data-theme', 'light');
      } else {
        htmlEl.removeAttribute('data-theme');
      }
      currentTheme = theme;
      localStorage.setItem('theme', theme);

      // Update button icon
      if (themeBtn) {
        themeBtn.textContent = theme === 'light' ? '🌙' : '☀';
      }

      // Always redraw when theme changes - any black wires need to flip to white/black
      // Also update the in-progress drawing if active
      redraw();
      renderDrawing();
    }

    function toggleTheme() {
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(newTheme);
    }

    // Apply saved theme on load
    applyTheme(currentTheme);

    if (themeBtn) {
      themeBtn.addEventListener('click', toggleTheme);
    }
  })();

  // Light theme background color customization
  (function attachLightBgColorPicker() {
    const colorPicker = document.getElementById('lightBgColorPicker') as HTMLInputElement | null;
    const swatchContainer = document.getElementById('lightBgColorSwatches') as HTMLDivElement | null;
    const deleteBtn = document.getElementById('deleteCustomColorBtn') as HTMLButtonElement | null;
    
    if (!colorPicker || !swatchContainer || !deleteBtn) return;

    // Load saved color or use default
    const savedColor = localStorage.getItem('lightBgColor') || '#e8e8e8';
    
    // Load custom colors from localStorage
    let customColors: string[] = [];
    try {
      const saved = localStorage.getItem('lightBgCustomColors');
      if (saved) {
        customColors = JSON.parse(saved);
      }
    } catch (e) {
      customColors = [];
    }
    
    function saveCustomColors() {
      localStorage.setItem('lightBgCustomColors', JSON.stringify(customColors));
    }
    
    function addCustomSwatch(color: string) {
      const customSwatch = document.createElement('button');
      customSwatch.type = 'button';
      customSwatch.className = 'color-swatch';
      customSwatch.setAttribute('data-color', color);
      customSwatch.title = 'Custom';
      customSwatch.style.cssText = `background: ${color}; width: 32px; height: 32px; border: 2px solid var(--muted); border-radius: 4px; cursor: pointer;`;
      swatchContainer.appendChild(customSwatch);
    }
    
    function applyLightBgColor(color: string, updatePicker: boolean = true) {
      document.documentElement.style.setProperty('--light-bg', color);
      localStorage.setItem('lightBgColor', color);
      if (updatePicker) {
        colorPicker.value = color;
      }
      
      // Update swatch selection
      const swatches = swatchContainer.querySelectorAll('.color-swatch');
      swatches.forEach(swatch => {
        const swatchColor = (swatch as HTMLElement).getAttribute('data-color');
        if (swatchColor?.toLowerCase() === color.toLowerCase()) {
          swatch.classList.add('selected');
        } else {
          swatch.classList.remove('selected');
        }
      });
      
      // Update delete button visibility
      const selectedSwatch = Array.from(swatches).find(s => 
        (s as HTMLElement).getAttribute('data-color')?.toLowerCase() === color.toLowerCase()
      ) as HTMLElement | undefined;
      
      const isPermanent = selectedSwatch?.getAttribute('data-permanent') === 'true';
      deleteBtn.style.display = isPermanent ? 'none' : 'block';
    }
    
    // Restore custom color swatches
    customColors.forEach(color => addCustomSwatch(color));
    
    // Apply saved color on load
    applyLightBgColor(savedColor);
    
    // Color picker live preview (no swatch creation)
    colorPicker.addEventListener('input', (e) => {
      const color = (e.target as HTMLInputElement).value;
      applyLightBgColor(color, false);
    });
    
    // Color picker closed - add to swatches if custom
    colorPicker.addEventListener('change', (e) => {
      const color = (e.target as HTMLInputElement).value;
      applyLightBgColor(color, false);
      
      // Check if this color already exists in swatches
      const swatches = swatchContainer.querySelectorAll('.color-swatch');
      const existingSwatch = Array.from(swatches).find(s => 
        (s as HTMLElement).getAttribute('data-color')?.toLowerCase() === color.toLowerCase()
      );
      
      // Only add if it's not already there
      if (!existingSwatch) {
        addCustomSwatch(color);
        customColors.push(color);
        saveCustomColors();
        applyLightBgColor(color, false); // Update selection to new swatch
      }
    });
    
    // Swatch clicks
    swatchContainer.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('color-swatch')) {
        const color = target.getAttribute('data-color');
        if (color) {
          applyLightBgColor(color);
        }
      }
    });
    
    // Delete button
    deleteBtn.addEventListener('click', () => {
      const currentColor = localStorage.getItem('lightBgColor') || '#e8e8e8';
      const swatches = Array.from(swatchContainer.querySelectorAll('.color-swatch')) as HTMLElement[];
      const selectedSwatch = swatches.find(s => 
        s.getAttribute('data-color')?.toLowerCase() === currentColor.toLowerCase()
      );
      
      if (selectedSwatch && selectedSwatch.getAttribute('data-permanent') !== 'true') {
        // Remove from custom colors array
        customColors = customColors.filter(c => c.toLowerCase() !== currentColor.toLowerCase());
        saveCustomColors();
        
        // Remove the swatch
        selectedSwatch.remove();
        
        // Switch to default color
        applyLightBgColor('#e8e8e8');
      }
    });
  })();  // ====== Component Drawing ======

  function drawComponent(c) {
    if (!c.props) c.props = {};
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('comp');
    g.setAttribute('data-id', c.id);

    // (selection ring removed; selection is shown by tinting the symbol graphics)

    // big invisible hit for easy click/drag
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    setAttr(hit, 'x', c.x - 40); setAttr(hit, 'y', c.y - 40);
    setAttr(hit, 'width', 80); setAttr(hit, 'height', 80);
    hit.setAttribute('fill', 'transparent');
    g.appendChild(hit);

    // Pin markers removed - drawn centrally to avoid duplicates

    // hover cue
    g.addEventListener('pointerenter', () => { g.classList.add('comp-hover'); });
    g.addEventListener('pointerleave', () => { g.classList.remove('comp-hover'); });

    // Components should not block clicks when wiring, placing, or managing junction dots
    g.style.pointerEvents = (mode === 'wire' || mode === 'place' || mode === 'place-junction' || mode === 'delete-junction') ? 'none' : 'auto';
    
    // Set cursor style based on mode and selection
    if (mode === 'move' && isSelected('component', c.id)) {
      g.style.cursor = 'move';
    } else if (mode === 'select') {
      g.style.cursor = 'pointer';
    } else {
      g.style.cursor = '';
    }

    // ---- Drag + selection (mouse) ----
    let dragging = false, dragOff = { x: 0, y: 0 }, slideCtx = null, dragStart = null;
    const componentInstanceId = Math.random(); // Track if component is recreated
    g.addEventListener('pointerdown', (e) => {
      if (mode === 'delete') { removeComponent(c.id); return; }
      // If no action is active, automatically activate Select mode when
      // the user clicks a component so the click behaves like a selection.
      if (mode === 'none') { setMode('select'); }
      
      if (!(mode === 'select' || mode === 'move')) return;
      if (e.button !== 0) return;
      
      // Handle shift-click for multi-select
      if (e.shiftKey) {
        toggleSelection('component', c.id, null);
        renderInspector(); 
        Rendering.updateSelectionOutline(selection);
        e.stopPropagation();
        return; // Don't drag or switch to move mode with shift-click
      }
      
      // If Select mode is active and this component is already selected,
      // interpret the click as intent to move the component: switch to Move.
      const firstSel = getFirstSelection();
      if (mode === 'select' && firstSel && firstSel.kind === 'component' && firstSel.id === c.id) {
        setMode('move');
      }
      
      // Regular click: select single item (clear multi-select)
      selectSingle('component', c.id, null);
      renderInspector(); 
      Rendering.updateSelectionOutline(selection);
      
      // If switching to a different component while in Move mode, finalize the prior SWP first.
      if (mode === 'move' && moveCollapseCtx && moveCollapseCtx.kind === 'swp' && lastMoveCompId && lastMoveCompId !== c.id) {
        ensureFinishSwpMove();
      }
      const pt = svgPoint(e);
      // Move only when Move mode is active; in Select mode: select only.
      if (mode !== 'move') { return; }
      dragging = true;
      draggedComponentId = c.id;
      updateEndpointCircles(); // Hide this component's circles
      dragOff.x = c.x - pt.x; dragOff.y = c.y - pt.y;
      // Clear any previous drag state from prior sessions
      componentDragState = null;
      // Prepare SWP-aware context (collapse SWP to a single straight run)
      slideCtx = null; // fallback only if no SWP detected
      rebuildTopology();
      const swpCtx = beginSwpMove(c);
      if (swpCtx) {
        dragging = true;
        slideCtx = null;       // ensure we use SWP move
        g.classList.add('moving');
        moveCollapseCtx = swpCtx;
        lastMoveCompId = c.id;
      } else {
        // fallback to legacy slide along adjacent wires (if no SWP)
        slideCtx = buildSlideContext(c);
      }
      const pins0 = Components.compPinPositions(c).map(p => ({ x: snapToBaseScalar(p.x), y: snapToBaseScalar(p.y) }));
      const wsA = wiresEndingAt(pins0[0]);
      const wsB = wiresEndingAt(pins0[1] || pins0[0]);
      dragStart = {
        x: c.x, y: c.y, pins: pins0,
        embedded: (wsA.length === 1 && wsB.length === 1),
        wA: wsA[0] || null, wB: wsB[0] || null
      };
      e.preventDefault();
      if (typeof g.setPointerCapture === 'function' && e.isPrimary) {
        try { g.setPointerCapture(e.pointerId); } catch (_) { }
      }
      e.stopPropagation();
    });
    g.addEventListener('pointermove', (e) => {
      if (!dragging) {
        return;
      }
      const p = svgPoint(e);
      const shiftHeld = (e as PointerEvent).shiftKey; // Detect Shift key for temporary constraint bypass
      
      // SWP move: allow free movement in both inline and lateral directions
      // Show stretched SWP wire through component and rubber-band perpendicular wires
      if (moveCollapseCtx && moveCollapseCtx.kind === 'swp') {
        const mc = moveCollapseCtx;
        const cand = snapPointPreferAnchor({ x: p.x + dragOff.x, y: p.y + dragOff.y });
        
        // Allow free movement in both directions
        let candX = cand.x;
        let candY = cand.y;
        
        // Check constraints if enabled (skip bounding box constraint if Shift is held)
        let moveAllowed = false;
        if (USE_CONSTRAINTS && constraintSolver) {
          updateConstraintPositions(); // Sync current positions before solving
          
          // Temporarily disable min-distance constraints if Shift is held
          if (shiftHeld) {
            constraintSolver.getGraph().getAllConstraints()
              .filter(c => c.type === 'min-distance' && c.metadata?.temporary)
              .forEach(c => c.enabled = false);
          }
          
          const result = constraintSolver.solve(c.id, { x: candX, y: candY });
          
          // Re-enable min-distance constraints
          if (shiftHeld) {
            constraintSolver.getGraph().getAllConstraints()
              .filter(c => c.type === 'min-distance' && c.metadata?.temporary)
              .forEach(c => c.enabled = true);
          }
          
          console.log(`🔍 Constraint check: ${c.label} to (${candX}, ${candY}) - Allowed: ${result.allowed}${shiftHeld ? ' (Shift: bbox disabled)' : ''}`);
          if (!result.allowed) {
            console.log(`   Violations:`, result.violatedConstraints.map(v => v.reason));
          }
          if (result.allowed) {
            moveAllowed = true;
            candX = result.finalPosition.x;
            candY = result.finalPosition.y;
          }
        } else if (!overlapsAnyOtherAt(c, candX, candY) && !pinsCoincideAnyAt(c, candX, candY)) {
          moveAllowed = true;
        }
        
        if (moveAllowed) {
          c.x = candX;
          c.y = candY;
          updateComponentDOM(c);
          updateCoordinateDisplay(c.x, c.y);
          updateCoordinateInputs(c.x, c.y);
          renderInspector();
          
          // Create ghost wires showing stretched SWP through component and rubber-banded perpendiculars
          if (!componentDragState) {
            componentDragState = { component: c, wires: [], ghostWires: [] };
          }
          componentDragState.ghostWires = [];
          
          // Get actual component pin positions at current location
          const pins = Components.compPinPositions(c).map(p => ({ 
            x: snapToBaseScalar(p.x), 
            y: snapToBaseScalar(p.y) 
          }));
          
          // Calculate the component's through-line axis (the line between its pins)
          const compAxis = Math.abs(pins[1].x - pins[0].x) > Math.abs(pins[1].y - pins[0].y) ? 'x' : 'y';
          
          // Find where the through-line intersects with perpendiculars from original SWP endpoints
          const origSwpStart = mc.axis === 'x' ? { x: mc.ends.lo, y: mc.fixed } : { x: mc.fixed, y: mc.ends.lo };
          const origSwpEnd = mc.axis === 'x' ? { x: mc.ends.hi, y: mc.fixed } : { x: mc.fixed, y: mc.ends.hi };
          
          // Extend the through-line to intersect with perpendiculars from original SWP endpoints
          let throughLineStart, throughLineEnd;
          
          if (compAxis === 'x') {
            // Component is horizontal - through-line extends horizontally at the component's Y
            // The perpendiculars from original SWP endpoints are vertical, intersecting at origSwpStart.x and origSwpEnd.x
            const throughY = (pins[0].y + pins[1].y) / 2; // Use average Y of pins
            throughLineStart = { x: origSwpStart.x, y: throughY };
            throughLineEnd = { x: origSwpEnd.x, y: throughY };
          } else {
            // Component is vertical - through-line extends vertically at the component's X
            // The perpendiculars from original SWP endpoints are horizontal, intersecting at origSwpStart.y and origSwpEnd.y
            const throughX = (pins[0].x + pins[1].x) / 2; // Use average X of pins
            throughLineStart = { x: throughX, y: origSwpStart.y };
            throughLineEnd = { x: throughX, y: origSwpEnd.y };
          }
          
          // Draw the ghost through-line segments with gap through component
          // For horizontal component: draw horizontal lines from intersection points to pins
          // For vertical component: draw vertical lines from intersection points to pins
          
          // Determine which pin is closer to which endpoint
          const dist0ToStart = Math.hypot(pins[0].x - throughLineStart.x, pins[0].y - throughLineStart.y);
          const dist1ToStart = Math.hypot(pins[1].x - throughLineStart.x, pins[1].y - throughLineStart.y);
          
          if (dist0ToStart < dist1ToStart) {
            // pins[0] is closer to throughLineStart, pins[1] to throughLineEnd
            componentDragState.ghostWires.push({ from: throughLineStart, to: pins[0] });
            componentDragState.ghostWires.push({ from: pins[1], to: throughLineEnd });
          } else {
            // pins[1] is closer to throughLineStart, pins[0] to throughLineEnd
            componentDragState.ghostWires.push({ from: throughLineStart, to: pins[1] });
            componentDragState.ghostWires.push({ from: pins[0], to: throughLineEnd });
          }
          
          // Also draw ghost perpendicular wires connected to the through-line endpoints
          // For multi-segment wires, we need to draw each segment individually to preserve the wire's shape
          const perpWiresAtStart = wiresEndingAt(origSwpStart).filter(w => w.id !== mc.collapsedId);
          const perpWiresAtEnd = wiresEndingAt(origSwpEnd).filter(w => w.id !== mc.collapsedId);
          
          for (const wire of perpWiresAtStart) {
            const matchStart = Geometry.eqPtEps(wire.points[0], origSwpStart, 1);
            // Create ghost wire with updated endpoint at throughLineStart
            const ghostPoints = matchStart 
              ? [throughLineStart, ...wire.points.slice(1)]
              : [...wire.points.slice(0, -1), throughLineStart];
            
            // Draw each segment of the ghost wire
            for (let i = 0; i < ghostPoints.length - 1; i++) {
              componentDragState.ghostWires.push({ from: ghostPoints[i], to: ghostPoints[i + 1] });
            }
          }
          
          for (const wire of perpWiresAtEnd) {
            const matchStart = Geometry.eqPtEps(wire.points[0], origSwpEnd, 1);
            // Create ghost wire with updated endpoint at throughLineEnd
            const ghostPoints = matchStart 
              ? [throughLineEnd, ...wire.points.slice(1)]
              : [...wire.points.slice(0, -1), throughLineEnd];
            
            // Draw each segment of the ghost wire
            for (let i = 0; i < ghostPoints.length - 1; i++) {
              componentDragState.ghostWires.push({ from: ghostPoints[i], to: ghostPoints[i + 1] });
            }
          }
          
          renderDrawing(); // Show ghost wires
        }
        
        return; // Stay in SWP mode - will reconstruct wires on pointerup
      }
      
      // Free drag mode - drag entire wires laterally with component (legacy path for non-SWP components)
      if (componentDragState && componentDragState.wires.length > 0) {
        const cand = snapPointPreferAnchor({ x: p.x + dragOff.x, y: p.y + dragOff.y });
        let candX = cand.x;
        let candY = cand.y;
        
        // Check constraints if enabled (skip bounding box constraint if Shift is held)
        if (USE_CONSTRAINTS && constraintSolver) {
          updateConstraintPositions(); // Sync current positions before solving
          
          // Temporarily disable min-distance constraints if Shift is held
          if (shiftHeld) {
            constraintSolver.getGraph().getAllConstraints()
              .filter(c => c.type === 'min-distance' && c.metadata?.temporary)
              .forEach(c => c.enabled = false);
          }
          
          const result = constraintSolver.solve(c.id, { x: candX, y: candY });
          
          // Re-enable min-distance constraints
          if (shiftHeld) {
            constraintSolver.getGraph().getAllConstraints()
              .filter(c => c.type === 'min-distance' && c.metadata?.temporary)
              .forEach(c => c.enabled = true);
          }
          
          if (!result.allowed) return; // Movement blocked
          candX = result.finalPosition.x;
          candY = result.finalPosition.y;
        }
        
        // Move component freely
        c.x = candX;
        c.y = candY;
        
        // Get new pin positions
        const newPins = Components.compPinPositions(c).map(p => ({ 
          x: snapToBaseScalar(p.x), 
          y: snapToBaseScalar(p.y) 
        }));
        
        // Clear ghost wires
        componentDragState.ghostWires = [];
        
        for (const dragWire of componentDragState.wires) {
          const newPin = newPins[dragWire.pinIndex];
          const wire = dragWire.wire;
          const delta = dragWire.axis === 'x' 
            ? (newPin.y - dragWire.originalPinPosition.y) 
            : (newPin.x - dragWire.originalPinPosition.x);
          
          // Create ghost of the entire moved wire
          const ghostWirePoints: Point[] = dragWire.originalPoints.map(pt => {
            if (dragWire.axis === 'x') {
              return { x: pt.x, y: pt.y + delta };
            } else {
              return { x: pt.x + delta, y: pt.y };
            }
          });
          
          // DON'T modify the original wire during drag - leave it in place
          // We'll show ghost instead and finalize on pointerup
          
          // Add ghost wire (entire wire being moved)
          componentDragState.ghostWires.push({
            from: ghostWirePoints[0],
            to: ghostWirePoints[ghostWirePoints.length - 1]
          });
          
          // Store the perpendicular wire updates but DON'T apply them yet during drag
          // We'll show them as additional ghost wires
          for (const perpWire of dragWire.perpendicularWires) {
            const movedFarEnd = ghostWirePoints[dragWire.isStart ? ghostWirePoints.length - 1 : 0];
            // Get the FIXED end of the perpendicular wire (opposite of the moving end)
            // endpointIndex tells us which end is connected to the moving horizontal wire
            const fixedPerpEnd = perpWire.endpointIndex === 0 
              ? perpWire.wire.points[perpWire.wire.points.length - 1]
              : perpWire.wire.points[0];
            
            // The perpendicular wire must maintain orthogonality
            // It was originally perpendicular to the main wire, so draw it with proper axis alignment
            // If the main wire is horizontal (axis='x'), perpendicular is vertical
            // If the main wire is vertical (axis='y'), perpendicular is horizontal
            if (dragWire.axis === 'x') {
              // Main wire is horizontal, so perpendicular is vertical
              // Draw vertical line from fixedPerpEnd to the y-coordinate of movedFarEnd, keeping x fixed
              componentDragState.ghostWires.push({
                from: fixedPerpEnd,
                to: { x: fixedPerpEnd.x, y: movedFarEnd.y }
              });
            } else {
              // Main wire is vertical, so perpendicular is horizontal
              // Draw horizontal line from fixedPerpEnd to the x-coordinate of movedFarEnd, keeping y fixed
              componentDragState.ghostWires.push({
                from: fixedPerpEnd,
                to: { x: movedFarEnd.x, y: fixedPerpEnd.y }
              });
            }
          }
        }
        
        // DON'T call updateComponentDOM or updateWireDOM during drag
        // Only update coordinates display and render ghost wires
        updateCoordinateDisplay(c.x, c.y);
        updateCoordinateInputs(c.x, c.y);
        
        // Render ghost wires and component to show preview during drag
        // Always call renderDrawing() to clear previous ghost wires, even if there are no new ones
        g.style.opacity = '0.5';
        updateComponentDOM(c);
        renderDrawing();
        
        return;
      }
      
      // Slide mode or regular free drag
      if (slideCtx) {
        if (slideCtx.axis === 'x') {
          let nx = snap(p.x + dragOff.x);
          nx = Math.max(Math.min(slideCtx.max, nx), slideCtx.min);
          let candX = nx, candY = slideCtx.fixed;
          
          // Check constraints if enabled (skip bounding box constraint if Shift is held)
          if (USE_CONSTRAINTS && constraintSolver) {
            updateConstraintPositions(); // Sync current positions before solving
            
            // Temporarily disable min-distance constraints if Shift is held
            if (shiftHeld) {
              constraintSolver.getGraph().getAllConstraints()
                .filter(c => c.type === 'min-distance' && c.metadata?.temporary)
                .forEach(c => c.enabled = false);
            }
            
            const result = constraintSolver.solve(c.id, { x: candX, y: candY });
            
            // Re-enable min-distance constraints
            if (shiftHeld) {
              constraintSolver.getGraph().getAllConstraints()
                .filter(c => c.type === 'min-distance' && c.metadata?.temporary)
                .forEach(c => c.enabled = true);
            }
            
            if (!result.allowed) return; // Movement blocked
            candX = result.finalPosition.x;
            candY = result.finalPosition.y;
          } else if (overlapsAnyOtherAt(c, candX, candY) || pinsCoincideAnyAt(c, candX, candY)) {
            return;
          }
          
          c.x = candX; c.y = candY;
          updateComponentDOM(c);
          updateCoordinateDisplay(c.x, c.y);
          updateCoordinateInputs(c.x, c.y);
          renderInspector();
        } else {
          let ny = snap(p.y + dragOff.y);
          ny = Math.max(Math.min(slideCtx.max, ny), slideCtx.min);
          let candX = slideCtx.fixed, candY = ny;
          
          // Check constraints if enabled (skip bounding box constraint if Shift is held)
          if (USE_CONSTRAINTS && constraintSolver) {
            updateConstraintPositions(); // Sync current positions before solving
            
            // Temporarily disable min-distance constraints if Shift is held
            if (shiftHeld) {
              constraintSolver.getGraph().getAllConstraints()
                .filter(c => c.type === 'min-distance' && c.metadata?.temporary)
                .forEach(c => c.enabled = false);
            }
            
            const result = constraintSolver.solve(c.id, { x: candX, y: candY });
            
            // Re-enable min-distance constraints
            if (shiftHeld) {
              constraintSolver.getGraph().getAllConstraints()
                .filter(c => c.type === 'min-distance' && c.metadata?.temporary)
                .forEach(c => c.enabled = true);
            }
            
            if (!result.allowed) return; // Movement blocked
            candX = result.finalPosition.x;
            candY = result.finalPosition.y;
          } else if (!overlapsAnyOtherAt(c, candX, candY) && !pinsCoincideAnyAt(c, candX, candY)) {
            // Legacy check passed
          } else {
            return;
          }
          
          c.y = candY; c.x = candX;
          updateComponentDOM(c);
          updateCoordinateDisplay(c.x, c.y);
          updateCoordinateInputs(c.x, c.y);
          renderInspector();
        }
      } else {
        // Regular free drag (no wire stretching)
        const cand = snapPointPreferAnchor({ x: p.x + dragOff.x, y: p.y + dragOff.y });
        let candX = cand.x;
        let candY = cand.y;
        
        // Check constraints if enabled (skip bounding box constraint if Shift is held)
        if (USE_CONSTRAINTS && constraintSolver) {
          updateConstraintPositions(); // Sync current positions before solving
          
          // Temporarily disable min-distance constraints if Shift is held
          if (shiftHeld) {
            constraintSolver.getGraph().getAllConstraints()
              .filter(c => c.type === 'min-distance' && c.metadata?.temporary)
              .forEach(c => c.enabled = false);
          }
          
          const result = constraintSolver.solve(c.id, { x: candX, y: candY });
          
          // Re-enable min-distance constraints
          if (shiftHeld) {
            constraintSolver.getGraph().getAllConstraints()
              .filter(c => c.type === 'min-distance' && c.metadata?.temporary)
              .forEach(c => c.enabled = true);
          }
          
          if (!result.allowed) return; // Movement blocked
          candX = result.finalPosition.x;
          candY = result.finalPosition.y;
        } else if (!overlapsAnyOtherAt(c, candX, candY)) {
          // Legacy check passed
        } else {
          return;
        }
        
        c.x = candX; c.y = candY;
        updateComponentDOM(c);
        updateCoordinateDisplay(c.x, c.y);
        updateCoordinateInputs(c.x, c.y);
        renderInspector();
      }
    });
    g.addEventListener('pointerup', (e) => {
      if (typeof g.releasePointerCapture === 'function' && e.isPrimary) {
        try { g.releasePointerCapture(e.pointerId); } catch (_) { }
      }
      if (!dragging) return;
      dragging = false;
      if (dragStart) {
        // If we were doing an SWP-constrained move, rebuild segments for that SWP
        if (moveCollapseCtx && moveCollapseCtx.kind === 'swp') {
          finishSwpMove(c);
          moveCollapseCtx = null;
          lastMoveCompId = null;
          g.classList.remove('moving');
          componentDragState = null;
          dragStart = null;
          draggedComponentId = null;
          renderDrawing(); // Clear ghost wires
          return;
        }
        
        // If we were dragging wires laterally, finalize the movement
        if (componentDragState && componentDragState.wires.length > 0) {
          // Restore component opacity
          g.style.opacity = '1';
          updateComponentDOM(c);
          
          // Get final pin positions
          const finalPins = Components.compPinPositions(c).map(p => ({ 
            x: snapToBaseScalar(p.x), 
            y: snapToBaseScalar(p.y) 
          }));
          
          // Move each wire to final position and restore perpendicular wires
          for (const dragWire of componentDragState.wires) {
            const finalPin = finalPins[dragWire.pinIndex];
            const delta = dragWire.axis === 'x' 
              ? (finalPin.y - dragWire.originalPinPosition.y) 
              : (finalPin.x - dragWire.originalPinPosition.x);
            
            // Move the wire perpendicular to its axis
            dragWire.wire.points = dragWire.originalPoints.map((pt, idx) => {
              if (dragWire.axis === 'x') {
                return { x: pt.x, y: pt.y + delta };
              } else {
                return { x: pt.x + delta, y: pt.y };
              }
            });
            
            // Update the component connection endpoint to match the new pin position
            const componentEndIndex = dragWire.isStart ? 0 : dragWire.wire.points.length - 1;
            dragWire.wire.points[componentEndIndex] = { x: finalPin.x, y: finalPin.y };
            
            // Move any MANUAL junction dots that were on this wire segment
            // Automatic junctions are connection points and should stay fixed
            const tolerance = 1.0; // tolerance for detecting if junction is on the original wire
            for (const junction of junctions) {
              // Skip suppressed junctions and automatic junctions
              if (junction.suppressed || !junction.manual) continue;
              
              // Check if this junction was on any point of the original wire
              for (const origPt of dragWire.originalPoints) {
                const dist = Math.hypot(junction.at.x - origPt.x, junction.at.y - origPt.y);
                if (dist < tolerance) {
                  // Move the junction the same delta as the wire
                  if (dragWire.axis === 'x') {
                    junction.at.y += delta;
                  } else {
                    junction.at.x += delta;
                  }
                  break; // Only move each junction once
                }
              }
            }
            
            // Now update the perpendicular wires at far end - maintain orthogonality
            for (const perpWire of dragWire.perpendicularWires) {
              const movedFarEnd = dragWire.wire.points[dragWire.isStart ? dragWire.wire.points.length - 1 : 0];
              
              // Get the perpendicular wire's endpoint that's being moved
              const perpEndpoint = perpWire.endpointIndex === 0 
                ? perpWire.wire.points[0]
                : perpWire.wire.points[perpWire.wire.points.length - 1];
              
              // Update ONLY the coordinate that changed, to maintain orthogonality
              // If the main wire is horizontal (axis='x'), perpendicular wire is vertical - update only Y
              // If the main wire is vertical (axis='y'), perpendicular wire is horizontal - update only X
              if (dragWire.axis === 'x') {
                // Main wire is horizontal, perpendicular is vertical - keep X, update Y
                const newEndpoint = { x: perpEndpoint.x, y: movedFarEnd.y };
                if (perpWire.endpointIndex === 0) {
                  perpWire.wire.points[0] = newEndpoint;
                } else {
                  perpWire.wire.points[perpWire.wire.points.length - 1] = newEndpoint;
                }
              } else {
                // Main wire is vertical, perpendicular is horizontal - keep Y, update X
                const newEndpoint = { x: movedFarEnd.x, y: perpEndpoint.y };
                if (perpWire.endpointIndex === 0) {
                  perpWire.wire.points[0] = newEndpoint;
                } else {
                  perpWire.wire.points[perpWire.wire.points.length - 1] = newEndpoint;
                }
              }
            }
          }
          
          // Clean up wire geometry (same as wire stretching feature)
          normalizeAllWires();
          
          // Remove very short wires that may have been created
          wires = wires.filter(w => {
            if (w.points.length < 2) return false;
            const p0 = w.points[0];
            const p1 = w.points[w.points.length - 1];
            const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
            return len >= 5;
          });
          
          // Unify inline wire segments to collapse collinear wires
          unifyInlineWires();
          
          // Re-break all wires at all component pins to fix any wires that now pass through components
          for (const comp of components) {
            breakWiresForComponent(comp);
          }
          
          // Rebuild topology and redraw
          rebuildTopology();
          redraw();
          renderDrawing(); // Clear ghost wires from drawing layer
          
          componentDragState = null;
          dragStart = null;
          draggedComponentId = null;
          updateEndpointCircles();
          return;
        }
        
        // When constraints are enabled, skip legacy overlap check (constraints already validated during drag)
        if (!USE_CONSTRAINTS && overlapsAnyOther(c)) {
          c.x = dragStart.x; c.y = dragStart.y;
          if (slideCtx && dragStart.pins?.length === 2) {
            adjustWireEnd(slideCtx.wA, slideCtx.pinAStart, dragStart.pins[0]);
            adjustWireEnd(slideCtx.wB, slideCtx.pinBStart, dragStart.pins[1]);
          }
          updateComponentDOM(c);
          if (slideCtx) { updateWireDOM(slideCtx.wA); updateWireDOM(slideCtx.wB); }
        } else {
          // Component moved successfully
          if (!dragStart.embedded) {
            const didBreak = breakWiresForComponent(c);
            if (didBreak) { deleteBridgeBetweenPins(c); redraw(); }
            else { updateComponentDOM(c); }
          } else {
            const didBreak = breakWiresForComponent(c);
            if (didBreak) { 
              deleteBridgeBetweenPins(c); 
              redraw(); 
            } else { 
              updateComponentDOM(c); 
            }
          }
        }
        componentDragState = null;
        dragStart = null;
        draggedComponentId = null;
        updateEndpointCircles(); // Restore circles
      }
    });
    g.addEventListener('pointercancel', () => { dragging = false; });

    // draw symbol via helper
    const symbolGroup = Rendering.buildSymbolGroup(c, GRID, defaultResistorStyle);
    g.appendChild(symbolGroup);
    
    // Add click handlers for label and value text for independent selection/movement
    const labelText = symbolGroup.querySelector(`[data-label-for="${c.id}"]`) as SVGTextElement;
    const valueText = symbolGroup.querySelector(`[data-value-for="${c.id}"]`) as SVGTextElement;
    
    if (labelText) {
      labelText.addEventListener('pointerdown', (e) => {
        if (mode === 'delete') return;
        if (mode === 'none') setMode('select');
        if (!(mode === 'select' || mode === 'move')) return;
        if (e.button !== 0) return;
        
        e.stopPropagation(); // Prevent component selection
        e.preventDefault(); // Prevent text selection
        selectSingle('label', c.id, null);
        renderInspector(); 
        Rendering.updateSelectionOutline(selection);
        
        // Auto-switch to Move mode if in Select mode
        if (mode === 'select') {
          setMode('move');
        }
        
        if (mode !== 'move') return;
        
        const pt = svgPoint(e);
        textDragState = {
          kind: 'label',
          componentId: c.id,
          startX: pt.x,
          startY: pt.y,
          startOffsetX: c.labelOffsetX || 0,
          startOffsetY: c.labelOffsetY || 0
        };
        pushUndo();
        
        if (typeof labelText.setPointerCapture === 'function' && e.isPrimary) {
          try { labelText.setPointerCapture(e.pointerId); } catch (_) { }
        }
      });
      
      labelText.addEventListener('pointermove', (e) => {
        if (!textDragState || textDragState.kind !== 'label' || textDragState.componentId !== c.id) return;
        const pt = svgPoint(e);
        const dx = pt.x - textDragState.startX;
        const dy = pt.y - textDragState.startY;
        
        // Transform delta to component's local coordinate system (inverse rotation)
        const radians = -(c.rot * Math.PI / 180);
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const localDx = dx * cos - dy * sin;
        const localDy = dx * sin + dy * cos;
        
        // Snap to 50 mil grid (GRID/5 = 5px)
        const snapSize = GRID / 5;
        c.labelOffsetX = Math.round((textDragState.startOffsetX + localDx) / snapSize) * snapSize;
        c.labelOffsetY = Math.round((textDragState.startOffsetY + localDy) / snapSize) * snapSize;
        
        redrawCanvasOnly();
        Rendering.updateSelectionOutline(selection); // Reapply selection highlighting
        renderInspector(); // Update inspector to show live offset values
      });
      
      labelText.addEventListener('pointerup', (e) => {
        if (textDragState && textDragState.kind === 'label' && textDragState.componentId === c.id) {
          if (typeof labelText.releasePointerCapture === 'function' && e.isPrimary) {
            try { labelText.releasePointerCapture(e.pointerId); } catch (_) { }
          }
          textDragState = null;
          renderInspector(); // Update inspector to show final offset values
        }
      });
    }
    
    if (valueText) {
      valueText.addEventListener('pointerdown', (e) => {
        if (mode === 'delete') return;
        if (mode === 'none') setMode('select');
        if (!(mode === 'select' || mode === 'move')) return;
        if (e.button !== 0) return;
        
        e.stopPropagation(); // Prevent component selection
        e.preventDefault(); // Prevent text selection
        selectSingle('value', c.id, null);
        renderInspector();
        Rendering.updateSelectionOutline(selection);
        
        // Auto-switch to Move mode if in Select mode
        if (mode === 'select') {
          setMode('move');
        }
        
        if (mode !== 'move') return;
        
        const pt = svgPoint(e);
        textDragState = {
          kind: 'value',
          componentId: c.id,
          startX: pt.x,
          startY: pt.y,
          startOffsetX: c.valueOffsetX || 0,
          startOffsetY: c.valueOffsetY || 0
        };
        pushUndo();
        
        if (typeof valueText.setPointerCapture === 'function' && e.isPrimary) {
          try { valueText.setPointerCapture(e.pointerId); } catch (_) { }
        }
      });
      
      valueText.addEventListener('pointermove', (e) => {
        if (!textDragState || textDragState.kind !== 'value' || textDragState.componentId !== c.id) return;
        const pt = svgPoint(e);
        const dx = pt.x - textDragState.startX;
        const dy = pt.y - textDragState.startY;
        
        // Transform delta to component's local coordinate system (inverse rotation)
        const radians = -(c.rot * Math.PI / 180);
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const localDx = dx * cos - dy * sin;
        const localDy = dx * sin + dy * cos;
        
        // Snap to 50 mil grid (GRID/5 = 5px)
        const snapSize = GRID / 5;
        c.valueOffsetX = Math.round((textDragState.startOffsetX + localDx) / snapSize) * snapSize;
        c.valueOffsetY = Math.round((textDragState.startOffsetY + localDy) / snapSize) * snapSize;
        
        redrawCanvasOnly();
        Rendering.updateSelectionOutline(selection); // Reapply selection highlighting
        renderInspector(); // Update inspector to show live offset values
      });
      
      valueText.addEventListener('pointerup', (e) => {
        if (textDragState && textDragState.kind === 'value' && textDragState.componentId === c.id) {
          if (typeof valueText.releasePointerCapture === 'function' && e.isPrimary) {
            try { valueText.releasePointerCapture(e.pointerId); } catch (_) { }
          }
          textDragState = null;
          renderInspector(); // Update inspector to show final offset values
        }
      });
    }
    
    return g;
  }


  function redrawCanvasOnly() {
    // components
    gComps.replaceChildren();
    for (const c of components) { gComps.appendChild(drawComponent(c)); }
    // wires (with wide, nearly-transparent hit-target + hover cue)
    gWires.replaceChildren();
    
    // During SWP drag, hide the collapsed SWP wire and perpendicular wires
    // Only hide wires when actively dragging (componentDragState exists)
    let wiresToSkip = new Set<string>();
    if (moveCollapseCtx && moveCollapseCtx.kind === 'swp' && componentDragState) {
      // Hide the collapsed SWP wire
      wiresToSkip.add(moveCollapseCtx.collapsedId);
      
      // Hide perpendicular wires at the original SWP endpoints
      const mc = moveCollapseCtx;
      const origSwpStart = mc.axis === 'x' ? { x: mc.ends.lo, y: mc.fixed } : { x: mc.fixed, y: mc.ends.lo };
      const origSwpEnd = mc.axis === 'x' ? { x: mc.ends.hi, y: mc.fixed } : { x: mc.fixed, y: mc.ends.hi };
      
      for (const endPt of [origSwpStart, origSwpEnd]) {
        const connectedWires = wiresEndingAt(endPt).filter(w => w.id !== mc.collapsedId);
        for (const wire of connectedWires) {
          wiresToSkip.add(wire.id);
        }
      }
    }
    
    for (const w of wires) {
      // Skip wires that are being dragged with SWP
      if (wiresToSkip.has(w.id)) continue;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-id', w.id);

      // visible stroke
      // visible stroke (effective: explicit → netclass → theme)
      ensureStroke(w);
      const eff = effectiveStroke(w, Netlist.netClassForWire(w, NET_CLASSES, activeNetClass), THEME);

      const vis = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      vis.setAttribute('class', 'wire-stroke');
      vis.setAttribute('fill', 'none');
      
      // Apply selection highlighting if this wire is selected
      const wireSelected = isSelected('wire', w.id);
      if (wireSelected) {
        vis.setAttribute('stroke', 'var(--accent)');
        vis.setAttribute('stroke-width', '3');
      } else {
        vis.setAttribute('stroke', rgba01ToCss(eff.color));
        vis.setAttribute('stroke-width', String(mmToPx(eff.width))); // default 0.25mm -> 1px
      }
      
      vis.setAttribute('stroke-linecap', 'butt');
      vis.setAttribute('stroke-linejoin', 'miter');
      const dashes = dashArrayFor(eff.type);
      if (dashes) vis.setAttribute('stroke-dasharray', dashes); else vis.removeAttribute('stroke-dasharray');
      vis.setAttribute('points', w.points.map(p => `${p.x},${p.y}`).join(' '));
      vis.setAttribute('data-wire-stroke', w.id);
      // visible stroke must NOT catch events—let the hit overlay do it
      vis.setAttribute('pointer-events', 'none');

      // transparent hit overlay (easy clicking)
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      hit.setAttribute('fill', 'none');
      hit.setAttribute('stroke', '#000');
      hit.setAttribute('stroke-opacity', '0.001'); // capture events reliably
      hit.setAttribute('stroke-width', '24');
      // GATE POINTER EVENTS: hit overlay disabled during Wire/Place/Junction modes so it doesn't block clicks
      const allowHits = (mode !== 'wire' && mode !== 'place' && mode !== 'place-junction' && mode !== 'delete-junction');
      hit.setAttribute('pointer-events', allowHits ? 'stroke' : 'none');
      hit.setAttribute('points', vis.getAttribute('points')); // IMPORTANT: give the hit polyline geometry
      
      // Set cursor style based on mode and selection
      if (mode === 'move' && isSelected('wire', w.id)) {
        hit.style.cursor = 'move';
      } else if (mode === 'select') {
        hit.style.cursor = 'pointer';
      } else {
        hit.style.cursor = '';
      }

      // interactions
      hit.addEventListener('pointerenter', () => { if (allowHits) vis.classList.add('hover'); });
      hit.addEventListener('pointerleave', () => { if (allowHits) vis.classList.remove('hover'); });
      hit.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; // Only handle left mouse button
        
        if (mode === 'delete') { 
          removeWireAtPoint(w, svgPoint(e));
        }
        else {
          if (mode === 'none') { setMode('select'); }
          
          if (mode === 'select' || mode === 'move') {
            // Handle shift-click for multi-select
            if (e.shiftKey) {
              toggleSelection('wire', w.id, null);
              renderInspector();
              redraw();
              e.stopPropagation();
              return; // Don't drag or switch to move mode with shift-click
            }
            
            // If in Select mode and this wire is already selected, switch to Move mode
            const firstSel = getFirstSelection();
            if (mode === 'select' && firstSel && firstSel.kind === 'wire' && firstSel.id === w.id) {
              setMode('move');
            }
            
            // Regular click: select single item (clear multi-select)
            selecting('wire', w.id, null);
            
            // If in move mode and selected, initiate wire drag
            const currentSel = getFirstSelection();
            if (mode === 'move' && currentSel && currentSel.kind === 'wire' && currentSel.id === w.id) {
              const p0 = { x: snapToBaseScalar(w.points[0].x), y: snapToBaseScalar(w.points[0].y) };
              const p1 = { x: snapToBaseScalar(w.points[w.points.length - 1].x), y: snapToBaseScalar(w.points[w.points.length - 1].y) };
              
              // Find wires connected at start point
              // If a junction (manual or automatic) exists at p0, do not treat wires as connected for stretching
              const hasJunctionAtStart = junctions.some(j => Math.abs(j.at.x - p0.x) < 1 && Math.abs(j.at.y - p0.y) < 1);
              const connectedAtStart = hasJunctionAtStart ? [] : wires.filter(wire => {
                if (wire.id === w.id) return false;
                const wireStart = wire.points[0];
                const wireEnd = wire.points[wire.points.length - 1];
                return (Math.hypot(wireStart.x - p0.x, wireStart.y - p0.y) < 1) ||
                       (Math.hypot(wireEnd.x - p0.x, wireEnd.y - p0.y) < 1);
              }).map(wire => {
                const isStart = Math.hypot(wire.points[0].x - p0.x, wire.points[0].y - p0.y) < 1;
                const originalPoint = isStart 
                  ? { x: wire.points[0].x, y: wire.points[0].y }
                  : { x: wire.points[wire.points.length - 1].x, y: wire.points[wire.points.length - 1].y };
                return { wire, isStart, originalPoint };
              });
              
              console.log(`connectedAtStart: ${connectedAtStart.length} wires:`, connectedAtStart.map(c => `${c.wire.id}`));
              
              // Find wires connected at end point
              // If a junction (manual or automatic) exists at p1, do not treat wires as connected for stretching
              const hasJunctionAtEnd = junctions.some(j => Math.abs(j.at.x - p1.x) < 1 && Math.abs(j.at.y - p1.y) < 1);
              const connectedAtEnd = hasJunctionAtEnd ? [] : wires.filter(wire => {
                if (wire.id === w.id) return false;
                const wireStart = wire.points[0];
                const wireEnd = wire.points[wire.points.length - 1];
                return (Math.hypot(wireStart.x - p1.x, wireStart.y - p1.y) < 1) ||
                       (Math.hypot(wireEnd.x - p1.x, wireEnd.y - p1.y) < 1);
              }).map(wire => {
                const isStart = Math.hypot(wire.points[0].x - p1.x, wire.points[0].y - p1.y) < 1;
                const originalPoint = isStart 
                  ? { x: wire.points[0].x, y: wire.points[0].y }
                  : { x: wire.points[wire.points.length - 1].x, y: wire.points[wire.points.length - 1].y };
                return { wire, isStart, originalPoint };
              });
              
              // Determine wire axis
              const isHorizontal = Math.abs(p0.y - p1.y) < 1;
              const isVertical = Math.abs(p0.x - p1.x) < 1;
              const wireAxis: 'x' | 'y' = isHorizontal ? 'x' : 'y';
              
              // Find 2-pin components that have at least one pin at the wire endpoints OR on connected wires OR on the wire itself
              const componentsOnWire = components.filter(comp => {
                if (!['resistor', 'capacitor', 'inductor', 'diode', 'battery', 'ac'].includes(comp.type)) {
                  return false;
                }
                const pins = Components.compPinPositions(comp).map(p => ({
                  x: snapToBaseScalar(p.x),
                  y: snapToBaseScalar(p.y)
                }));
                if (pins.length !== 2) return false;
                
                const wireIsHorizontal = Math.abs(p0.y - p1.y) < 1;
                const wireIsVertical = Math.abs(p0.x - p1.x) < 1;
                
                // Check if at least one pin is at either endpoint of the wire being dragged
                const pin0AtP0 = Math.abs(pins[0].x - p0.x) < 1 && Math.abs(pins[0].y - p0.y) < 1;
                const pin0AtP1 = Math.abs(pins[0].x - p1.x) < 1 && Math.abs(pins[0].y - p1.y) < 1;
                const pin1AtP0 = Math.abs(pins[1].x - p0.x) < 1 && Math.abs(pins[1].y - p0.y) < 1;
                const pin1AtP1 = Math.abs(pins[1].x - p1.x) < 1 && Math.abs(pins[1].y - p1.y) < 1;
                
                if (pin0AtP0 || pin0AtP1 || pin1AtP0 || pin1AtP1) {
                  return true;
                }
                
                // Check if component is ON the wire segment being dragged (not just at endpoints)
                if (wireIsHorizontal) {
                  // For horizontal wire, check if any pin is on the wire
                  for (const pin of pins) {
                    if (Math.abs(pin.y - p0.y) < 1 && pin.x >= Math.min(p0.x, p1.x) && pin.x <= Math.max(p0.x, p1.x)) {
                      return true;
                    }
                  }
                } else if (wireIsVertical) {
                  // For vertical wire, check if any pin is on the wire
                  for (const pin of pins) {
                    if (Math.abs(pin.x - p0.x) < 1 && pin.y >= Math.min(p0.y, p1.y) && pin.y <= Math.max(p0.y, p1.y)) {
                      return true;
                    }
                  }
                }
                
                // Also check if component has a pin on any connected wire at the endpoints
                const allConnectedWires = [...connectedAtStart, ...connectedAtEnd];
                for (const conn of allConnectedWires) {
                  const cw = conn.wire;
                  const cwp0 = cw.points[0];
                  const cwp1 = cw.points[cw.points.length - 1];
                  const cwIsHoriz = Math.abs(cwp0.y - cwp1.y) < 1;
                  
                  for (const pin of pins) {
                    if (cwIsHoriz) {
                      // Check if pin is on horizontal connected wire
                      if (Math.abs(pin.y - cwp0.y) < 1 && pin.x >= Math.min(cwp0.x, cwp1.x) && pin.x <= Math.max(cwp0.x, cwp1.x)) {
                        return true;
                      }
                    } else {
                      // Check if pin is on vertical connected wire
                      if (Math.abs(pin.x - cwp0.x) < 1 && pin.y >= Math.min(cwp0.y, cwp1.y) && pin.y <= Math.max(cwp0.y, cwp1.y)) {
                        return true;
                      }
                    }
                  }
                }
                
                return false;
              }).map(comp => {
                const pins = Components.compPinPositions(comp).map(p => ({
                  x: snapToBaseScalar(p.x),
                  y: snapToBaseScalar(p.y)
                }));
                // Determine component's axis based on pin positions
                const compIsHorizontal = Math.abs(pins[0].y - pins[1].y) < 1;
                const compAxis: 'x' | 'y' = compIsHorizontal ? 'x' : 'y';
                return { comp, pins, axis: compAxis };
              });
              
              // Check for junctions at wire endpoints OR at the far end of perpendicular connecting wires
              let junctionAtStart = junctions.find(j => 
                Math.abs(j.at.x - p0.x) < 1.0 && Math.abs(j.at.y - p0.y) < 1.0
              );
              let junctionAtEnd = junctions.find(j => 
                Math.abs(j.at.x - p1.x) < 1.0 && Math.abs(j.at.y - p1.y) < 1.0
              );
              
              // If no junction at endpoint, check if there's a perpendicular connecting wire
              // whose far end has a junction (this handles wires already moved from junction)
              if (!junctionAtStart) {
                const isHoriz = Math.abs(p0.y - p1.y) < 1;
                const isVert = Math.abs(p0.x - p1.x) < 1;
                
                // Find perpendicular wire at p0
                const perpWire = connectedAtStart.find(conn => {
                  const cw = conn.wire;
                  const cwStart = cw.points[0];
                  const cwEnd = cw.points[cw.points.length - 1];
                  const cwIsHoriz = Math.abs(cwStart.y - cwEnd.y) < 1;
                  const cwIsVert = Math.abs(cwStart.x - cwEnd.x) < 1;
                  return (isHoriz && cwIsVert) || (isVert && cwIsHoriz);
                });
                
                if (perpWire) {
                  // Find the far end of the perpendicular wire
                  const farEnd = perpWire.isStart 
                    ? perpWire.wire.points[perpWire.wire.points.length - 1]
                    : perpWire.wire.points[0];
                  // Check if there's a junction at the far end
                  junctionAtStart = junctions.find(j =>
                    Math.abs(j.at.x - farEnd.x) < 1e-3 && Math.abs(j.at.y - farEnd.y) < 1e-3
                  );
                }
              }
              
              if (!junctionAtEnd) {
                const isHoriz = Math.abs(p0.y - p1.y) < 1;
                const isVert = Math.abs(p0.x - p1.x) < 1;
                
                // Find perpendicular wire at p1
                const perpWire = connectedAtEnd.find(conn => {
                  const cw = conn.wire;
                  const cwStart = cw.points[0];
                  const cwEnd = cw.points[cw.points.length - 1];
                  const cwIsHoriz = Math.abs(cwStart.y - cwEnd.y) < 1;
                  const cwIsVert = Math.abs(cwStart.x - cwEnd.x) < 1;
                  return (isHoriz && cwIsVert) || (isVert && cwIsHoriz);
                });
                
                if (perpWire) {
                  // Find the far end of the perpendicular wire
                  const farEnd = perpWire.isStart 
                    ? perpWire.wire.points[perpWire.wire.points.length - 1]
                    : perpWire.wire.points[0];
                  // Check if there's a junction at the far end
                  junctionAtEnd = junctions.find(j =>
                    Math.abs(j.at.x - farEnd.x) < 1e-3 && Math.abs(j.at.y - farEnd.y) < 1e-3
                  );
                }
              }
              
              wireStretchState = {
                wire: w,
                startMousePos: svgPoint(e),
                originalPoints: w.points.map(pt => ({ x: pt.x, y: pt.y })),
                originalP0: p0,
                originalP1: p1,
                connectedWiresStart: connectedAtStart,
                connectedWiresEnd: connectedAtEnd,
                componentsOnWire,
                junctionAtStart,
                junctionAtEnd,
                ghostConnectingWires: [],
                createdConnectingWireIds: [],
                dragging: false
              };
            }
          }
        }
        e.stopPropagation();
      });

      g.appendChild(hit);
      g.appendChild(vis);

      // Wire endpoint markers removed - drawn centrally to avoid duplicates

      // persistent selection highlight for the selected wire segment
      if (isSelected('wire', w.id)) {
        if (w.points.length >= 2) {
          const a = w.points[0], b = w.points[w.points.length - 1];
          const selSeg = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          setAttr(selSeg, 'x1', a.x); setAttr(selSeg, 'y1', a.y);
          setAttr(selSeg, 'x2', b.x); setAttr(selSeg, 'y2', b.y);
          selSeg.setAttribute('stroke', 'var(--select)');
          selSeg.setAttribute('stroke-width', '3');
          selSeg.setAttribute('stroke-linecap', 'round');
          selSeg.setAttribute('pointer-events', 'none');
          g.appendChild(selSeg);
        }
      }
      gWires.appendChild(g);
    }
    // junctions: only draw if showJunctionDots is true
    gJunctions.replaceChildren();
    if (showJunctionDots) {
      for (const j of junctions) {
        // Skip suppressed junctions (invisible markers for deleted automatic junctions)
        if (j.suppressed) continue;

        const nc = NET_CLASSES[j.netId || 'default'] || NET_CLASSES.default;
        // Use per-instance size if set, otherwise use custom size, otherwise use preset size
        // Custom sizes for better visibility: Smallest=15mils, Small=30mils, Default=40mils, Large=50mils, Largest=65mils (diameter)
        const sizeMils = j.size !== undefined ? j.size :
                        junctionCustomSize !== null ? junctionCustomSize :
                        (junctionDotSize === 'smallest' ? 15 : junctionDotSize === 'small' ? 30 : junctionDotSize === 'default' ? 40 : junctionDotSize === 'large' ? 50 : 65);
        const diameterMm = sizeMils * 0.0254; // Convert mils to mm
        const radiusMm = diameterMm / 2;
        // Use fractional pixels for better differentiation (SVG supports sub-pixel rendering)
        const radiusPx = Math.max(1, radiusMm * (100 / 25.4));
        // Use per-instance color if set, otherwise use default color, otherwise use netclass color
        let color = j.color ? j.color : junctionDefaultColor ? junctionDefaultColor : rgba01ToCss(nc.junction.color);
        
        // Theme-aware black/white handling: if junction color is white or black,
        // render as black in light mode and white in dark mode
        const colorLower = color.toLowerCase().replace(/\s/g, '');
        const isWhite = colorLower === '#ffffff' || colorLower === '#fff' || 
                       colorLower === 'rgb(255,255,255)' || colorLower === 'rgba(255,255,255,1)' ||
                       colorLower === 'white';
        const isBlack = colorLower === '#000000' || colorLower === '#000' || 
                       colorLower === 'rgb(0,0,0)' || colorLower === 'rgba(0,0,0,1)' ||
                       colorLower === 'black';
        
        if (isWhite || isBlack) {
          // Use theme-aware wire color variable
          color = 'var(--wire)';
        }
        
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        setAttr(dot, 'cx', j.at.x); setAttr(dot, 'cy', j.at.y);
        setAttr(dot, 'r', radiusPx);
        dot.setAttribute('fill', color);
        dot.setAttribute('stroke', 'var(--bg)');
        dot.setAttribute('stroke-width', '1');
        dot.setAttribute('data-junction-id', j.id);
        dot.style.cursor = 'pointer';
        
        // Add click handler to select junction
        dot.addEventListener('pointerdown', (e) => {
          if (mode === 'select' || mode === 'move') {
            selectSingle('junction', j.id, null);
            renderInspector();
            Rendering.updateSelectionOutline(selection);
            e.stopPropagation();
          } else if (mode === 'none') {
            setMode('select');
            selectSingle('junction', j.id, null);
            renderInspector();
            Rendering.updateSelectionOutline(selection);
            e.stopPropagation();
          }
        });
        
        gJunctions.appendChild(dot);
      }
    }
    // (Optional: if you want endpoint/pin dots, draw them in a different layer, not gJunctions)

    Rendering.updateSelectionOutline(selection);
    updateCounts();
    renderNetList();

    // Update endpoint circles after all rendering is done
    updateEndpointCircles();
  }

  function updateEndpointCircles_OLD_TO_DELETE() {
    // OLD DUPLICATE CODE - DO NOT USE
    // Remove existing endpoint circles
    try {
      const existing = $qa('[data-endpoint]', gOverlay);
      console.log('Removing existing endpoint circles:', existing.length);
      existing.forEach(el => el.remove());
    } catch (_) { }
    // Redraw them (respecting draggedComponentId filter)
    if (mode === 'wire' || mode === 'place' || mode === 'move' || mode === 'select' || mode === 'place-junction' || mode === 'delete-junction') {
      const ns = 'http://www.w3.org/2000/svg';
      for (const w of wires) {
        if (!w.points || w.points.length < 2) continue;
        ensureStroke(w);
        const eff = effectiveStroke(w, Netlist.netClassForWire(w, NET_CLASSES, activeNetClass), THEME);
        // compute circle diameter in user units: about 3x the visible stroke width (in px -> user units)
        const strokePx = Math.max(1, mmToPx(eff.width || 0.25));
        // convert px to user units: 1 user unit == 1 SVG coordinate; userScale = screen px per user unit
        const userPerPx = 1 / Math.max(1e-6, userScale());
        // Slightly reduce the visual prominence: use a smaller multiplier and
        // a smaller minimum diameter so circles are less dominant.
        const side = Math.max(3, Math.round(strokePx * 2.2 * userPerPx));
        const half = side / 2;
        const ends = [w.points[0], w.points[w.points.length - 1]];
        for (const [ei, pt] of ends.map((p, i) => [i, p] as [number, Point])) {
          // Choose a fixed on-screen size (px) that scales with zoom level
          // 9px normal, 7px when < 75%, 6px when <= 25%
          let desiredScreenPx = 9;
          if (zoom <= 0.25) desiredScreenPx = 6;
          else if (zoom < 0.75) desiredScreenPx = 7;
          const scale = userScale(); // screen px per user unit
          const widthUser = desiredScreenPx / Math.max(1e-6, scale);
          // Center the circle directly on the actual wire point in SVG coordinates
          const rx = pt.x - widthUser / 2;
          const ry = pt.y - widthUser / 2;
          const circle = document.createElementNS(ns, 'circle');
          circle.setAttribute('data-endpoint', '1');
          circle.setAttribute('cx', String(pt.x));
          circle.setAttribute('cy', String(pt.y));
          circle.setAttribute('r', String(widthUser / 2));
          circle.setAttribute('fill', 'rgba(0,200,0,0.08)');
          circle.setAttribute('stroke', 'lime');
          circle.setAttribute('stroke-width', String(1 / Math.max(1e-6, scale)));
          circle.style.cursor = 'pointer';
          (circle as any).endpoint = { x: pt.x, y: pt.y };
          (circle as any).wireId = w.id;
          (circle as any).endpointIndex = ei; // 0=start, 1=end
          circle.addEventListener('pointerdown', (ev) => {
            const ep = (ev.currentTarget as any).endpoint as Point;
            const wid = (ev.currentTarget as any).wireId as string | undefined;
            // Let junction dot modes bubble to main SVG handler
            if (mode === 'place-junction' || mode === 'delete-junction') {
              return; // Don't prevent or stop - let it bubble
            }
            ev.preventDefault(); ev.stopPropagation();
            if (mode === 'select') {
              if (wid) { selectSingle('wire', wid, null); renderInspector(); Rendering.updateSelectionOutline(selection); }
              return;
            }
            if (!ep) return;
            if (mode === 'wire') {
              if (!drawing.active) { drawing.active = true; drawing.points = [{ x: ep.x, y: ep.y }]; drawing.cursor = { x: ep.x, y: ep.y }; }
              else {
                drawing.points.push({ x: ep.x, y: ep.y });
                drawing.cursor = { x: ep.x, y: ep.y };
                if (endpointOverrideActive) {
                  endpointOverrideActive = false;
                  if (updateOrthoButtonVisual) updateOrthoButtonVisual();
                }
              }
              renderDrawing(); redraw();
            } else if (mode === 'place' && placeType) {
              const at = { x: ep.x, y: ep.y };
              let rot = 0;
              if (isTwoPinType(placeType)) {
                const hit = nearestSegmentAtPoint(at, 18);
                if (hit) { rot = normDeg(hit.angle); }
              }
              const id = State.uid(placeType);
              const labelPrefix = { resistor: 'R', capacitor: 'C', inductor: 'L', diode: 'D', npn: 'Q', pnp: 'Q', ground: 'GND', battery: 'BT', ac: 'AC' }[placeType] || 'X';
              const comp: Component = { id, type: placeType, x: at.x, y: at.y, rot, label: `${labelPrefix}${counters[placeType] - 1}`, value: '', props: {} };
              if (placeType === 'diode') (comp.props as Component['props']).subtype = diodeSubtype as DiodeSubtype;
              if (placeType === 'resistor') (comp.props as Component['props']).resistorStyle = defaultResistorStyle;
              if (placeType === 'capacitor') {
                (comp.props as Component['props']).capacitorSubtype = capacitorSubtype;
                if (capacitorSubtype === 'polarized') {
                  (comp.props as Component['props']).capacitorStyle = defaultResistorStyle;
                }
              }
              pushUndo();
              components.push(comp);
              breakWiresForComponent(comp);
              if (isTwoPinType(placeType)) deleteBridgeBetweenPins(comp);
              setMode('select'); placeType = null;
              selectSingle('component', id, null);
              redraw();
            }
          });
          gOverlay.appendChild(circle);
        }
      }

      // Also add endpoint circles for component pins
      for (const c of components) {
        // Skip circles for component being dragged to avoid visual lag
        if (draggedComponentId && c.id === draggedComponentId) continue;
        const pins = Components.compPinPositions(c);
        for (const pin of pins) {
          // Scale circle diameter with zoom: 9px normal, 7px when < 75%, 6px when <= 25%
          let desiredScreenPx = 9;
          if (zoom <= 0.25) desiredScreenPx = 6;
          else if (zoom < 0.75) desiredScreenPx = 7;
          const scale = userScale();
          const widthUser = desiredScreenPx / Math.max(1e-6, scale);
          const rx = pin.x - widthUser / 2;
          const ry = pin.y - widthUser / 2;
          const circle = document.createElementNS(ns, 'circle');
          circle.setAttribute('data-endpoint', '1');
          circle.setAttribute('cx', String(pin.x));
          circle.setAttribute('cy', String(pin.y));
          circle.setAttribute('r', String(widthUser / 2));
          circle.setAttribute('fill', 'rgba(0,200,0,0.08)');
          circle.setAttribute('stroke', 'lime');
          circle.setAttribute('stroke-width', String(1 / Math.max(1e-6, scale)));
          circle.style.cursor = 'pointer';
          (circle as any).endpoint = { x: pin.x, y: pin.y };
          (circle as any).componentId = c.id;
          circle.addEventListener('pointerdown', (ev) => {
            const ep = (ev.currentTarget as any).endpoint as Point;
            const cid = (ev.currentTarget as any).componentId as string | undefined;
            // Let junction dot modes bubble to main SVG handler
            if (mode === 'place-junction' || mode === 'delete-junction') {
              return; // Don't prevent or stop - let it bubble
            }
            ev.preventDefault(); ev.stopPropagation();
            if (mode === 'select') {
              if (cid) { selectSingle('component', cid, null); renderInspector(); Rendering.updateSelectionOutline(selection); }
              return;
            }
            if (!ep) return;
            if (mode === 'wire') {
              if (!drawing.active) { drawing.active = true; drawing.points = [{ x: ep.x, y: ep.y }]; drawing.cursor = { x: ep.x, y: ep.y }; }
              else {
                drawing.points.push({ x: ep.x, y: ep.y });
                drawing.cursor = { x: ep.x, y: ep.y };
                if (endpointOverrideActive) {
                  endpointOverrideActive = false;
                  if (updateOrthoButtonVisual) updateOrthoButtonVisual();
                }
              }
              renderDrawing(); redraw();
            } else if (mode === 'place' && placeType) {
              const at = { x: ep.x, y: ep.y };
              let rot = 0;
              if (isTwoPinType(placeType)) {
                const hit = nearestSegmentAtPoint(at, 18);
                if (hit) { rot = normDeg(hit.angle); }
              }
              const id = State.uid(placeType);
              const labelPrefix = { resistor: 'R', capacitor: 'C', inductor: 'L', diode: 'D', npn: 'Q', pnp: 'Q', ground: 'GND', battery: 'BT', ac: 'AC' }[placeType] || 'X';
              const comp: Component = { id, type: placeType, x: at.x, y: at.y, rot, label: `${labelPrefix}${counters[placeType] - 1}`, value: '', props: {} };
              if (placeType === 'diode') (comp.props as Component['props']).subtype = diodeSubtype as DiodeSubtype;
              if (placeType === 'resistor') (comp.props as Component['props']).resistorStyle = defaultResistorStyle;
              if (placeType === 'capacitor') {
                (comp.props as Component['props']).capacitorSubtype = capacitorSubtype;
                if (capacitorSubtype === 'polarized') {
                  (comp.props as Component['props']).capacitorStyle = defaultResistorStyle;
                }
              }
              pushUndo();
              components.push(comp);
              breakWiresForComponent(comp);
              if (isTwoPinType(placeType)) deleteBridgeBetweenPins(comp);
              setMode('select'); placeType = null;
              selectSingle('component', id, null);
              redraw();
            }
          });
          gOverlay.appendChild(circle);
        }
      }
    }
  } // End of OLD duplicate code - should be deleted

  function updateEndpointCircles() {
    // Remove existing endpoint circles
    try {
      $qa('[data-endpoint]', gOverlay).forEach(el => el.remove());
    } catch (_) { }
    // Redraw them (respecting draggedComponentId filter)
    if (mode === 'wire' || mode === 'place' || mode === 'move' || mode === 'select' || mode === 'place-junction' || mode === 'delete-junction') {
      const ns = 'http://www.w3.org/2000/svg';
      // Wire endpoints
      for (const w of wires) {
        if (!w.points || w.points.length < 2) continue;
        ensureStroke(w);
        const eff = effectiveStroke(w, Netlist.netClassForWire(w, NET_CLASSES, activeNetClass), THEME);
        // Store actual indices in the points array (0 and length-1)
        const endpointIndices = [0, w.points.length - 1];
        const endpointPoints = [w.points[0], w.points[w.points.length - 1]];
        for (let i = 0; i < 2; i++) {
          const actualIndex = endpointIndices[i];
          const pt = endpointPoints[i];
          let desiredScreenPx = 9;
          if (zoom <= 0.25) desiredScreenPx = 6;
          else if (zoom < 0.75) desiredScreenPx = 7;
          const scale = userScale();
          const widthUser = desiredScreenPx / Math.max(1e-6, scale);
          const circle = document.createElementNS(ns, 'circle');
          circle.setAttribute('data-endpoint', '1');
          circle.setAttribute('cx', String(pt.x));
          circle.setAttribute('cy', String(pt.y));
          circle.setAttribute('r', String(widthUser / 2));
          circle.setAttribute('fill', 'rgba(0,200,0,0.08)');
          circle.setAttribute('stroke', 'lime');
          circle.setAttribute('stroke-width', String(1 / Math.max(1e-6, scale)));
          circle.style.cursor = 'pointer';
          circle.style.pointerEvents = 'all'; // Ensure circle captures pointer events
          circle.style.zIndex = '9999'; // Force on top
          (circle as any).endpoint = { x: pt.x, y: pt.y };
          (circle as any).wireId = w.id;
          (circle as any).endpointIndex = actualIndex;
          gOverlay.appendChild(circle);
        }
      }
      // Component pin endpoints
      for (const c of components) {
        if (draggedComponentId && c.id === draggedComponentId) continue;
        const pins = Components.compPinPositions(c);
        for (const pin of pins) {
          let desiredScreenPx = 9;
          if (zoom <= 0.25) desiredScreenPx = 6;
          else if (zoom < 0.75) desiredScreenPx = 7;
          const scale = userScale();
          const widthUser = desiredScreenPx / Math.max(1e-6, scale);
          const circle = document.createElementNS(ns, 'circle');
          circle.setAttribute('data-endpoint', '1');
          circle.setAttribute('cx', String(pin.x));
          circle.setAttribute('cy', String(pin.y));
          circle.setAttribute('r', String(widthUser / 2));
          circle.setAttribute('fill', 'rgba(0,200,0,0.08)');
          circle.setAttribute('stroke', 'lime');
          circle.setAttribute('stroke-width', String(1 / Math.max(1e-6, scale)));
          circle.style.cursor = 'pointer';
          circle.style.pointerEvents = 'all'; // Ensure circle captures pointer events
          (circle as any).endpoint = { x: pin.x, y: pin.y };
          (circle as any).componentId = c.id;
          gOverlay.appendChild(circle);
        }
      }
    }
  }

  function redraw() {
    rebuildTopology();
    redrawCanvasOnly();
    renderInspector();
    
    // Ensure gOverlay is the last child so circles are on top of everything
    // Do this AFTER all other rendering including inspector
    if (gOverlay && gOverlay.parentNode) {
      gOverlay.parentNode.appendChild(gOverlay);
    }
  }

  function selecting(kind, id, segIndex = null) {
    // If we're in Move mode and have a collapsed SWP, finalize it when switching away
    // from the current component (or to a non-component selection).
    const firstSel = getFirstSelection();
    if (mode === 'move' && moveCollapseCtx && firstSel && firstSel.kind === 'component') {
      const prevId = firstSel.id;
      if (kind !== 'component' || id !== prevId) {
        ensureFinishSwpMove();
      }
    }
    // Normalize segIndex: legacy callers may pass undefined; prefer null for clarity.
    const si = Number.isInteger(segIndex) ? segIndex : null;
    // Use new helper function to select single item
    selectSingle(kind, id, si);
    // If we're in Move mode and a component is now selected, collapse its SWP immediately.
    if (mode === 'move' && kind === 'component') {
      ensureCollapseForSelection();
    }
    redraw();
  }

  function mendWireAtPoints(hitA, hitB) {
    if (hitA && hitB) {
      const wA = hitA.w, wB = hitB.w;
      // Orient so that aPoints ends at pinA and bPoints starts at pinB
      const aPoints = (hitA.endIndex === wA.points.length - 1) ? wA.points.slice() : wA.points.slice().reverse();
      const bPoints = (hitB.endIndex === 0) ? wB.points.slice() : wB.points.slice().reverse();
      // Remove the pin vertices themselves, then concatenate
      const left = aPoints.slice(0, Math.max(0, aPoints.length - 1));
      const right = bPoints.slice(1);
      const joined = left.concat(right);
      const merged = Geometry.collapseDuplicateVertices(joined);
      // Replace the two wires with a single merged polyline
      wires = wires.filter(w => w !== wA && w !== wB);
      if (merged.length >= 2) {
        // prefer left-side stroke; fall back to right-side stroke; else fall back to legacy color
        const inheritedStroke = wA.stroke ? { ...wA.stroke } : (wB.stroke ? { ...wB.stroke } : undefined);
        const colorCss = inheritedStroke ? rgba01ToCss(inheritedStroke.color) : (wA.color || wB.color || defaultWireColor);
        // Push as per-segment wires rather than a single polyline
        for (let i = 0; i < merged.length - 1; i++) {
          const segPts = [merged[i], merged[i + 1]];
          const segStroke = inheritedStroke ? { ...inheritedStroke, color: { ...inheritedStroke.color } } : undefined;
          wires.push({ id: State.uid('wire'), points: segPts, color: segStroke ? rgba01ToCss(segStroke.color) : colorCss, stroke: segStroke });
        }
      }
    }
  }

  function removeComponent(id) {
    pushUndo();
    const comp = components.find(c => c.id === id);
    // Mend only for simple 2-pin parts
    if (comp && ['resistor', 'capacitor', 'inductor', 'diode', 'battery', 'ac'].includes(comp.type)) {
      // Use raw pin positions (no snap) so angled wires mend correctly
      const pins = Components.compPinPositions(comp);
      if (pins.length === 2) {
        // Find the two wire endpoints that touch the pins (works for angled too)
        const hitA = findWireEndpointNear(pins[0], 0.9);
        const hitB = findWireEndpointNear(pins[1], 0.9);
        if (hitA && hitB) {
          mendWireAtPoints(hitA, hitB);
        }
      }
    }
    components = components.filter(c => c.id !== id);
    if (isSelected('component', id)) removeFromSelection('component', id);
    normalizeAllWires();
    unifyInlineWires();
    redraw();
  }

  function removeWireAtPoint(w, p) {
    // For per-segment wires, deleting the clicked segment removes the whole wire object.
    if (!w) return;
    if (w.points.length === 2) {
      removeJunctionsAtWireEndpoints(w);
      pushUndo();
      wires = wires.filter(x => x.id !== w.id);
      clearSelection();
      
      // Clear wireStretchState if the deleted wire was being tracked (or was created by stretching)
      if (wireStretchState) {
        // Check if deleted wire is the one being stretched or is a created connecting wire
        if (wireStretchState.wire.id === w.id || wireStretchState.createdConnectingWireIds.includes(w.id)) {
          wireStretchState = null;
        }
      }
      
      normalizeAllWires();
      unifyInlineWires();
      redraw();
      return;
    }
    // Fallback for multi-point polylines: delete only the clicked sub-segment.
    const nearest = Geometry.nearestSegmentIndex(w.points, p);
    if (!nearest) return;
    const idx = nearest.index;
    if (idx < 0 || idx >= w.points.length - 1) return;
    removeJunctionsAtWireEndpoints(w);
    pushUndo();
    removeWireSegment(w, idx);
  }

  function removeWireSegment(w, idx) {
    if (!w) return;
    if (idx < 0 || idx >= w.points.length - 1) return;
    const left = w.points.slice(0, idx + 1);   // up to the start of removed seg (no segment if len<2)
    const right = w.points.slice(idx + 1);     // from end of removed seg
    // Remove original wire
    wires = wires.filter(x => x.id !== w.id);
    // Add split pieces back if they contain at least one segment
    const L = Geometry.normalizedPolylineOrNull(left);
    const R = Geometry.normalizedPolylineOrNull(right);
    if (L) wires.push({ id: State.uid('wire'), points: L, color: w.color, stroke: w.stroke ? { ...w.stroke } : undefined });
    if (R) wires.push({ id: State.uid('wire'), points: R, color: w.color, stroke: w.stroke ? { ...w.stroke } : undefined });
    if (isSelected('wire', w.id)) removeFromSelection('wire', w.id);
    normalizeAllWires();
    unifyInlineWires();
    redraw();
  }

  // Format value+unit shown on the schematic label line
  function formatValue(c) {
    const v = (c.value ?? '').toString().trim();
    if (!v) return '';
    if (c.type === 'resistor') {
      const u = (c.props && c.props.unit) || '\u03A9'; // Ω
      return `${v} ${u}`;
    }
    if (c.type === 'capacitor') {
      const u = (c.props && c.props.unit) || 'F';
      return `${v} ${u}`;
    }
    if (c.type === 'inductor') {
      const u = (c.props && c.props.unit) || 'H';
      return `${v} ${u}`;
    }
    return v;
  }

  // Angles / nearest segment helpers
  const isTwoPinType = (t: string) => ['resistor', 'capacitor', 'inductor', 'diode', 'battery', 'ac'].includes(t);

  // nearestSegmentAtPoint - local app-specific version that searches wires array
  function nearestSegmentAtPoint(p, maxDist = 18) {
    let best = null, bestD = Infinity;
    for (const w of wires) {
      for (let i = 0; i < w.points.length - 1; i++) {
        const a = w.points[i], b = w.points[i + 1];
        const { proj, t } = Geometry.projectPointToSegmentWithT(p, a, b);
        if (t <= 0 || t >= 1) continue; // interior only
        const d = Math.hypot(p.x - proj.x, p.y - proj.y);
        if (d < bestD) { bestD = d; best = { w, idx: i, q: proj, angle: segmentAngle(a, b) }; }
      }
    }
    return (best && bestD <= maxDist) ? best : null;
  }

  function reselectNearestAt(p: Point) {
    const hit = nearestSegmentAtPoint(p, 24);
    if (hit && hit.w) {
      selecting('wire', hit.w.id, hit.idx);
    } else {
      redraw();
    }
  }

  // ----- Marquee helpers -----
  function beginMarqueeAt(p, startedOnEmpty, preferComponents) {
    marquee.active = true; marquee.start = p; marquee.end = p; marquee.startedOnEmpty = !!startedOnEmpty;
    marquee.shiftPreferComponents = !!preferComponents;
    marquee.shiftCrossingMode = !!preferComponents; // Shift enables crossing mode selection
    if (marquee.rectEl) marquee.rectEl.remove();
    marquee.rectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    marquee.rectEl.setAttribute('class', 'marquee');
    gOverlay.appendChild(marquee.rectEl);
    // Set initial stroke-width based on current zoom
    Input.updateMarqueeStroke(marquee.rectEl, zoom);
    updateMarqueeTo(p);
  }
  function updateMarqueeTo(p) {
    if (!marquee.active) return;
    marquee.end = p;
    const r = rectFromPoints(marquee.start, marquee.end);
    setAttr(marquee.rectEl, 'x', r.x); setAttr(marquee.rectEl, 'y', r.y);
    setAttr(marquee.rectEl, 'width', r.w); setAttr(marquee.rectEl, 'height', r.h);
  }
  function finishMarquee() {
    if (!marquee.active) return false;
    const r = rectFromPoints(marquee.start, marquee.end);
    const movedEnough = (Math.abs(r.w) > 2 || Math.abs(r.h) > 2);
    // remove rect
    marquee.rectEl?.remove(); marquee.rectEl = null;
    const wasShiftMode = marquee.shiftCrossingMode;
    marquee.active = false;
    
    // If it wasn't really a drag, treat it as a normal empty click
    if (!movedEnough) {
      if (marquee.startedOnEmpty) {
        clearSelection();
        redraw();
      }
      return false;
    }
    
    // Collect all items in/crossing the marquee rectangle
    const selectedItems: SelectionItem[] = [];
    
    // Check wires - either fully inside or crossing boundary
    for (const w of wires) {
      // For wires, we check if any segment is in/crossing the rectangle
      let wireSelected = false;
      for (let i = 0; i < w.points.length - 1; i++) {
        const a = w.points[i], b = w.points[i + 1];
        
        if (wasShiftMode) {
          // Shift mode: select if crossing boundary
          if (segmentIntersectsRect(a, b, r)) {
            wireSelected = true;
            break;
          }
        } else {
          // Normal mode: select if fully inside (both endpoints inside)
          if (inRect(a, r) && inRect(b, r)) {
            wireSelected = true;
            break;
          }
        }
      }
      
      if (wireSelected && !isSelected('wire', w.id)) {
        selectedItems.push({ kind: 'wire', id: w.id, segIndex: null });
      }
    }
    
    // Check components - center point must be inside for normal mode, any pin inside for crossing mode
    for (const c of components) {
      let compSelected = false;
      
      if (wasShiftMode) {
        // Shift mode: select if any pin crosses boundary or is inside
        const pins = Components.compPinPositions(c);
        for (const pin of pins) {
          if (inRect(pin, r)) {
            compSelected = true;
            break;
          }
        }
      } else {
        // Normal mode: select if center is fully inside
        if (inRect({ x: c.x, y: c.y }, r)) {
          compSelected = true;
        }
      }
      
      if (compSelected && !isSelected('component', c.id)) {
        selectedItems.push({ kind: 'component', id: c.id, segIndex: null });
      }
    }
    
    // Check junctions - point must be inside
    for (const j of junctions) {
      // Skip suppressed junctions (invisible markers)
      if (j.suppressed) continue;
      
      if (inRect(j.at, r) && !isSelected('junction', j.id)) {
        selectedItems.push({ kind: 'junction', id: j.id, segIndex: null });
      }
    }
    
    // If no items found, clear selection (unless started on empty and no drag)
    if (selectedItems.length === 0) {
      if (!marquee.startedOnEmpty) {
        // Keep existing selection if we didn't start on empty space
        redraw();
        return false;
      }
      clearSelection();
      redraw();
      return false;
    }
    
    // Update selection - replace current selection with marquee selection
    selection.items = selectedItems;
    redraw();
    return true;
  }

  function breakWiresForComponent(c) {
    // Break wires at EACH connection pin (not at component center)
    // Special handling: if a wire segment has both its endpoints near component pins,
    // remove it entirely (it will be replaced by the component)
    let broke = false;
    const pins = Components.compPinPositions(c);
    const PIN_TOLERANCE = 5; // pixels
    
    // Check for wire segments that span between the two pins
    if (pins.length === 2) {
      const wiresToRemove = [];
      for (const w of wires) {
        // Check if this wire segment has endpoints at/near both pins
        if (w.points.length === 2) {
          const p0 = w.points[0], p1 = w.points[1];
          const p0NearPinA = Math.hypot(p0.x - pins[0].x, p0.y - pins[0].y) < PIN_TOLERANCE;
          const p0NearPinB = Math.hypot(p0.x - pins[1].x, p0.y - pins[1].y) < PIN_TOLERANCE;
          const p1NearPinA = Math.hypot(p1.x - pins[0].x, p1.y - pins[0].y) < PIN_TOLERANCE;
          const p1NearPinB = Math.hypot(p1.x - pins[1].x, p1.y - pins[1].y) < PIN_TOLERANCE;
          
          if ((p0NearPinA && p1NearPinB) || (p0NearPinB && p1NearPinA)) {
            wiresToRemove.push(w);
          }
        }
      }
      
      // Remove wires that span the component
      for (const w of wiresToRemove) {
        wires = wires.filter(x => x.id !== w.id);
        broke = true;
      }
    }
    
    // Now break wires at each pin location
    for (const pin of pins) {
      if (breakNearestWireAtPin(pin)) broke = true;
    }
    return broke;
  }
  function breakNearestWireAtPin(pin) {
    // Break ALL wire segments that should be split at this pin location
    // Collect segments that need breaking to avoid modifying array during iteration
    const segmentsToBreak: Array<{ w: Wire, i: number, bp: Point }> = [];
    
    for (const w of wires) {
      for (let i = 0; i < w.points.length - 1; i++) {
        const a = w.points[i], b = w.points[i + 1];
        const { proj, t } = Geometry.projectPointToSegmentWithT(pin, a, b);
        const dist = pointToSegmentDistance(pin, a, b);
        
        // Check if pin is exactly at an endpoint
        const EPS = 1e-2;
        const atStart = Math.hypot(pin.x - a.x, pin.y - a.y) < EPS;
        const atEnd = Math.hypot(pin.x - b.x, pin.y - b.y) < EPS;
        
        // axis-aligned fallback for robust vertical/horizontal splitting
        const isVertical = (a.x === b.x);
        const isHorizontal = (a.y === b.y);
        const withinVert = isVertical && Math.abs(pin.x - a.x) <= GRID / 2 && pin.y > Math.min(a.y, b.y) && pin.y < Math.max(a.y, b.y);
        const withinHorz = isHorizontal && Math.abs(pin.y - a.y) <= GRID / 2 && pin.x > Math.min(a.x, b.x) && pin.x < Math.max(a.x, b.x);
        const nearInterior = (t > 0.001 && t < 0.999 && dist <= 20);
        
        // Only break at true interior points (not at endpoints)
        if (!atStart && !atEnd && (withinVert || withinHorz || nearInterior)) {
          const bp = nearInterior ? { x: proj.x, y: proj.y } : { x: snapToBaseScalar(pin.x), y: snapToBaseScalar(pin.y) };
          segmentsToBreak.push({ w, i, bp });
        }
      }
    }
    
    // Now break all collected segments
    let broke = false;
    for (const { w, i, bp } of segmentsToBreak) {
      // Check if this wire still exists (might have been removed by previous break)
      if (!wires.includes(w)) continue;
      
      const left = w.points.slice(0, i + 1).concat([bp]);
      const right = [bp].concat(w.points.slice(i + 1));
      
      // replace original with normalized children (drop degenerate)
      wires = wires.filter(x => x.id !== w.id);
      const L = Geometry.normalizedPolylineOrNull(left);
      const R = Geometry.normalizedPolylineOrNull(right);
      if (L) wires.push({ id: State.uid('wire'), points: L, color: w.color, stroke: w.stroke ? { ...w.stroke } : undefined });
      if (R) wires.push({ id: State.uid('wire'), points: R, color: w.color, stroke: w.stroke ? { ...w.stroke } : undefined });
      broke = true;
    }
    
    return broke;
  }
  // Remove the small bridge wire between the two pins of a 2-pin part
  function deleteBridgeBetweenPins(c) {
    const twoPin = ['resistor', 'capacitor', 'inductor', 'diode', 'battery', 'ac'];
    if (!twoPin.includes(c.type)) return;
    const pins = Components.compPinPositions(c);
    if (pins.length !== 2) return;
    const a = { x: pins[0].x, y: pins[0].y };
    const b = { x: pins[1].x, y: pins[1].y };
    const EPS = 1e-3;
    const eq = (p, q) => Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS;
    wires = wires.filter(w => {
      if (w.points.length !== 2) return true;
      const p0 = w.points[0], p1 = w.points[1];
      const isBridge = (eq(p0, a) && eq(p1, b)) || (eq(p0, b) && eq(p1, a));
      return !isBridge;
    });
  }

  // Remove junction dots at wire endpoints when a wire is deleted
  // Only remove if no other wires will be connected to that point after deletion
  function removeJunctionsAtWireEndpoints(w: Wire) {
    if (!w.points || w.points.length < 2) return;
    const EPS = 1e-3;
    const firstPt = w.points[0];
    const lastPt = w.points[w.points.length - 1];

    junctions = junctions.filter(j => {
      const atFirst = Math.abs(j.at.x - firstPt.x) < EPS && Math.abs(j.at.y - firstPt.y) < EPS;
      const atLast = Math.abs(j.at.x - lastPt.x) < EPS && Math.abs(j.at.y - lastPt.y) < EPS;

      if (!atFirst && !atLast) return true; // Keep junction if not at this wire's endpoints

      // Check if any OTHER wires are connected to this junction point
      const jPt = j.at;
      const otherWiresConnected = wires.some(other => {
        if (other.id === w.id) return false; // Skip the wire being deleted
        return other.points.some(pt =>
          Math.abs(pt.x - jPt.x) < EPS && Math.abs(pt.y - jPt.y) < EPS
        );
      });

      // Keep the junction if other wires are still connected
      return otherWiresConnected;
    });
  }

  // ================================================================================
  // ====== 6. CORE RENDERING ======
  // ================================================================================

  // ====== SVG helpers ======
  function svgPoint(evt: ClientXYEvent): Point {
    const pt = svg.createSVGPoint();
    pt.x = (evt as any).clientX ?? (evt as any).touches?.[0]?.clientX ?? 0;
    pt.y = (evt as any).clientY ?? (evt as any).touches?.[0]?.clientY ?? 0;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: pt.x, y: pt.y } as Point;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: (p as any).x, y: (p as any).y } as Point;
  }

  // ----- Slide helpers (simple case: each pin terminates one 2-point, axis-aligned wire) -----
  function userScale() { return svg.clientWidth / Math.max(1, viewW); }

  // base snap in SVG user units corresponding to SNAP_NM (50 mils)
  function baseSnapUser() {
    // Return the base snap grid spacing in user units based on grid unit system
    // This is independent of zoom - the viewBox scaling handles the visual zoom
    if (gridUnit === 'metric') {
      return mmToPx(0.5); // 0.5mm for metric
    }
    return nmToPx(SNAP_NM); // 50 mils (5 user units) for imperial
  }

  // Snap a scalar value to the base 50-mil grid in user units
  function snapToBaseScalar(v: number) { const b = baseSnapUser(); return Math.round(v / b) * b; }

  // ====== Manhattan Path Helper (KiCad-style routing) ======
  
  /**
   * Generate orthogonal Manhattan path between two points.
   * Returns array of points forming horizontal-then-vertical or vertical-then-horizontal path.
   * @param A Start point (fixed, never moves)
   * @param P End point (target, may be off-grid)
   * @param mode 'HV' = horizontal first, then vertical; 'VH' = vertical first, then horizontal
   * @returns Array of points: [A, ..., P] with 0 or 1 intermediate bend point
   */
  function manhattanPath(A: Point, P: Point, mode: 'HV' | 'VH'): Point[] {
    // If A and P already share X or Y, only need straight segment
    if (Math.abs(A.x - P.x) < 0.01) {
      return [{ x: A.x, y: A.y }, { x: A.x, y: P.y }];
    }
    if (Math.abs(A.y - P.y) < 0.01) {
      return [{ x: A.x, y: A.y }, { x: P.x, y: A.y }];
    }

    // Need a bend - create intermediate point
    if (mode === 'HV') {
      // Horizontal first, then vertical
      const B: Point = { x: P.x, y: A.y };
      return [{ x: A.x, y: A.y }, B, { x: P.x, y: P.y }];
    } else {
      // Vertical first, then horizontal
      const B: Point = { x: A.x, y: P.y };
      return [{ x: A.x, y: A.y }, B, { x: P.x, y: P.y }];
    }
  }

  /**
   * Snap to grid or nearby object (pin, wire endpoint, junction).
   * Object snap overrides grid snap when cursor is near a connection point.
   * @param pos Raw cursor position in SVG user coordinates
   * @param snapRadius Radius in SVG user units to search for nearby objects
   * @returns Snapped point
   */
  function snapToGridOrObject(pos: Point, snapRadius: number = 10): Point {
    // Search for nearby snap objects
    const nearby = findNearbySnapObject(pos, snapRadius);
    if (nearby) {
      return nearby.position;
    }

    // No object nearby - snap to grid
    return { x: snap(pos.x), y: snap(pos.y) };
  }

  /**
   * Find nearby snap object (pin, wire endpoint, junction) within radius.
   * @param pos Cursor position
   * @param radius Search radius in SVG user units
   * @returns Snap object with position, or null if none found
   */
  function findNearbySnapObject(pos: Point, radius: number): { position: Point; type: 'pin' | 'wireEnd' | 'junction' } | null {
    let nearest: { position: Point; type: 'pin' | 'wireEnd' | 'junction' } | null = null;
    let nearestDist = radius;

    // Check component pins
    for (const comp of components) {
      const pins = Components.compPinPositions(comp);
      for (const pin of pins) {
        const dist = Math.hypot(pin.x - pos.x, pin.y - pos.y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = { position: { x: pin.x, y: pin.y }, type: 'pin' };
        }
      }
    }

    // Check wire endpoints
    for (const wire of wires) {
      if (wire.points.length < 2) continue;
      const endpoints = [wire.points[0], wire.points[wire.points.length - 1]];
      for (const ep of endpoints) {
        const dist = Math.hypot(ep.x - pos.x, ep.y - pos.y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = { position: { x: ep.x, y: ep.y }, type: 'wireEnd' };
        }
      }
    }

    // Check junctions
    for (const junction of junctions) {
      const dist = Math.hypot(junction.at.x - pos.x, junction.at.y - pos.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = { position: { x: junction.at.x, y: junction.at.y }, type: 'junction' };
      }
    }

    return nearest;
  }

  // ====== Constraint System Initialization ======
  function initConstraintSystem() {
    constraintSolver = new ConstraintSolver(snap, snapToBaseScalar);
    console.log('✅ Constraint system initialized');
    
    // Expose to window for console access
    (window as any).constraintSolver = constraintSolver;
    
    // Make USE_CONSTRAINTS flag accessible from console
    Object.defineProperty(window, 'USE_CONSTRAINTS', {
      get() { return USE_CONSTRAINTS; },
      set(value: boolean) { 
        USE_CONSTRAINTS = value; 
        console.log(`Constraint system ${value ? 'ENABLED' : 'DISABLED'}`);
        if (value) {
          syncConstraints(); // Sync when enabling
        }
      }
    });
    
    // Make USE_MANHATTAN_ROUTING flag accessible from console
    Object.defineProperty(window, 'USE_MANHATTAN_ROUTING', {
      get() { return USE_MANHATTAN_ROUTING; },
      set(value: boolean) { 
        USE_MANHATTAN_ROUTING = value; 
        console.log(`Manhattan routing ${value ? 'ENABLED' : 'DISABLED'}`);
        if (drawing.active) {
          renderDrawing(); // Update preview if wire drawing is active
        }
      }
    });
  }

  /**
   * Calculate maximum pin extent (distance from center to furthest pin) for a component
   */
  function getComponentPinExtent(c: Component): number {
    const pins = Components.compPinPositions(c);
    if (pins.length === 0) return 0;
    
    let maxDist = 0;
    for (const pin of pins) {
      const dx = pin.x - c.x;
      const dy = pin.y - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      maxDist = Math.max(maxDist, dist);
    }
    return maxDist;
  }

  /**
   * Calculate bounding box dimensions for a component
   * Returns { extent: half-length along component axis, width: half-width perpendicular to axis }
   */
  function getComponentBoundingBox(c: Component): { extent: number; width: number } {
    // Get pin positions to calculate actual extent
    const pins = Components.compPinPositions(c);
    
    // For transistors and ground symbols
    if (c.type === 'npn' || c.type === 'pnp' || c.type === 'ground') {
      // Calculate actual bounding box from pins
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const pin of pins) {
        minX = Math.min(minX, pin.x);
        maxX = Math.max(maxX, pin.x);
        minY = Math.min(minY, pin.y);
        maxY = Math.max(maxY, pin.y);
      }
      const halfWidth = (maxX - minX) / 2;
      const halfHeight = (maxY - minY) / 2;
      // For these components, rotation doesn't matter for bounding box
      return { extent: Math.max(halfWidth, halfHeight), width: Math.min(halfWidth, halfHeight) };
    }
    
    // For two-pin components (resistor, capacitor, inductor, diode, battery, ac)
    // These are oriented along their rotation axis
    const pinExtent = getComponentPinExtent(c);
    
    // Get body dimensions based on component type and style
    let bodyHalfLength = 30; // Default for IEC resistor (60/2)
    let bodyHalfWidth = 12;  // Default height (24/2)
    
    if (c.type === 'resistor') {
      const style = (c.props?.resistorStyle as string) || 'iec';
      if (style === 'iec') {
        bodyHalfLength = 30; // 60 units / 2
        bodyHalfWidth = 12;  // 24 units / 2
      } else {
        // ANSI zigzag: x±39 to body edges, ±12 vertical
        bodyHalfLength = 39;
        bodyHalfWidth = 12;
      }
    } else if (c.type === 'capacitor') {
      // Capacitor plates at x±6, height ±16, plus possible +/- marks extend to ~±26
      bodyHalfLength = 26;
      bodyHalfWidth = 16;
    } else if (c.type === 'inductor') {
      // 4 coils of radius 8 = 64px/2 = 32
      bodyHalfLength = 32;
      bodyHalfWidth = 8;
    } else if (c.type === 'diode') {
      // Diode triangle and cathode bar: roughly ±24 horizontal, ±16 vertical
      bodyHalfLength = 24;
      bodyHalfWidth = 16;
    } else if (c.type === 'battery') {
      // Battery plates at various positions, roughly ±20 horizontal, ±20 vertical
      bodyHalfLength = 20;
      bodyHalfWidth = 20;
    } else if (c.type === 'ac') {
      // AC symbol circle, roughly ±16 radius
      bodyHalfLength = 16;
      bodyHalfWidth = 16;
    }
    
    // Use pin extent (which includes lead length) for the full extent
    return { extent: pinExtent, width: bodyHalfWidth };
  }

  /**
   * Update all component positions in constraint graph (for live drag checking)
   */
  function updateConstraintPositions() {
    if (!constraintSolver) return;
    for (const c of components) {
      if (constraintSolver.getEntity(c.id)) {
        constraintSolver.getGraph().updateEntityPosition(c.id, { x: c.x, y: c.y });
      }
    }
  }

  function syncConstraints() {
    if (!constraintSolver || !USE_CONSTRAINTS) return;
    
    console.log(`🔄 Syncing constraints for ${components.length} components:`, components.map(c => `${c.id}(${c.label})`).join(', '));
    
    // Clear temporary constraints from previous sync
    const clearedCount = constraintSolver.clearTemporaryConstraints();
    console.log(`   Cleared ${clearedCount} temporary constraints`);
    
    // Add all components as entities with constraints
    for (const c of components) {
      // Create entity for this component
      const entity: Entity = {
        id: c.id,
        type: 'component' as const,
        position: { x: c.x, y: c.y },
        constraints: new Set<string>(),
        metadata: { type: c.type, label: c.label, rot: c.rot }
      };
      
      // Add or update entity in graph
      const existing = constraintSolver.getEntity(c.id);
      if (!existing) {
        constraintSolver.addEntity(entity);
      } else {
        // Update position and metadata
        existing.position = { x: c.x, y: c.y };
        existing.metadata = { type: c.type, label: c.label, rot: c.rot };
      }
      
      // Add grid snap constraint based on current snap mode
      if (snapMode !== 'off') {
        const gridSize = snapMode === 'grid' 
          ? (CURRENT_SNAP_USER_UNITS || baseSnapUser())
          : baseSnapUser(); // 50mil mode
        
        constraintSolver.addConstraint({
          id: `grid_${c.id}`,
          type: 'on-grid',
          priority: 50,
          entities: [c.id],
          params: { gridSize },
          enabled: true,
          metadata: { temporary: true }
        });
      }
      
      // Add directional no-overlap constraints with other components
      // Different min-distances based on component orientation and relative position
      for (let i = components.indexOf(c) + 1; i < components.length; i++) {
        const other = components[i];
        // Only create constraint once per pair by checking index
        // (component at index i only creates constraints with components at index > i)
            // Calculate relative orientation and position
            const rot1 = ((c.rot % 360) + 360) % 360;
            const rot2 = ((other.rot % 360) + 360) % 360;
            const dx = other.x - c.x;
            const dy = other.y - c.y;
            
            // Determine if components are horizontal (0/180) or vertical (90/270)
            const isHoriz1 = (rot1 === 0 || rot1 === 180);
            const isHoriz2 = (rot2 === 0 || rot2 === 180);
            
            // Check if perpendicular (one horizontal, one vertical)
            const isPerpendicular = isHoriz1 !== isHoriz2;
            
            let minDistance: number;
            
            // Calculate bounding box parameters for both components
            const bbox1 = getComponentBoundingBox(c);
            const bbox2 = getComponentBoundingBox(other);
            
            if (isPerpendicular) {
              // Perpendicular: Allow T-connections, minimal clearance
              minDistance = 10;
              console.log(`🔍 Min-distance (perpendicular): ${c.label} <-> ${other.label}, Min: ${minDistance}`);
            } else {
              // Use bounding box collision - pass geometry parameters
              minDistance = 0; // Not used for bbox collision, but required by interface
              console.log(`🔍 Bounding box constraint: ${c.label} <-> ${other.label}`);
              console.log(`   ${c.label}: extent=${bbox1.extent}, width=${bbox1.width}`);
              console.log(`   ${other.label}: extent=${bbox2.extent}, width=${bbox2.width}`);
            }
            
        constraintSolver.addConstraint({
          id: `no_overlap_${c.id}_${other.id}`,
          type: 'min-distance',
          priority: 70,
          entities: [c.id, other.id],
          params: { 
            distance: minDistance, 
            measureFrom: 'center',
            bodyExtent: bbox1.extent,
            bodyWidth: bbox1.width,
            bodyExtent2: bbox2.extent,
            bodyWidth2: bbox2.width
          },
          enabled: true,
          metadata: { temporary: true }
        });
      }
    }
    
    console.log(`Synced ${components.length} components with constraint system`);
  }

  // Collect anchor points: component pins and wire endpoints (snapped to base grid)
  function collectAnchors() {
    const out: Point[] = [];
    for (const c of components) {
      const pins = Components.compPinPositions(c);
      for (const p of pins) out.push({ x: snapToBaseScalar(p.x), y: snapToBaseScalar(p.y) });
    }
    for (const w of wires) {
      if (!w.points || w.points.length < 2) continue;
      const a = w.points[0], b = w.points[w.points.length - 1];
      // Use actual coordinates, not snapped, to match endpoint circle storage
      out.push({ x: a.x, y: a.y });
      out.push({ x: b.x, y: b.y });
    }
    return out;
  }

  // Find nearest anchor to `pt` within thresholdPx screen pixels. Returns Point or null.
  function nearestAnchorTo(pt: Point, thresholdPx = 10) {
    const anchors = collectAnchors();
    const scale = userScale();
    let best: Point | null = null; let bestD = Infinity;
    for (const a of anchors) {
      const dx = (a.x - pt.x) * scale; const dy = (a.y - pt.y) * scale;
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (bestD <= thresholdPx) return best;
    return null;
  }

  // Debug helper: dump anchors, overlay rects, and wire endpoints to console
  function debugDumpAnchors() {
    try {
      // (console logging removed)
      const rects = $qa<SVGElement>('[data-endpoint]', gOverlay).map(r => ({
        endpoint: (r as any).endpoint || null,
        wireId: (r as any).wireId || null,
        bbox: (r as SVGGraphicsElement).getBBox()
      }));
    } catch (err) { }
  }

  // Snap a user-space point to nearest anchor or wire segment if within threshold, else to grid via snap().
  function snapPointPreferAnchor(p: Point, thresholdPx = 10) {
    // First, check for anchors (wire endpoints and component pins)
    const a = nearestAnchorTo(p, thresholdPx);
    if (a) return { x: a.x, y: a.y };

    // Second, check for nearby wire segments (snap to wire anywhere along its length)
    // Convert 50 mils threshold to user units for wire segment snapping
    const scale = svg.clientWidth / Math.max(1, viewW);
    const wireSnapThreshold = nmToPx(SNAP_NM); // 50 mils in user units
    const wireSnapThresholdPx = wireSnapThreshold * scale;

    const seg = nearestSegmentAtPoint(p, wireSnapThresholdPx);
    if (seg && seg.q) {
      // When grid snap is enabled, find the nearest grid point on the wire segment
      if (snapMode !== 'off') {
        const a = seg.w.points[seg.idx];
        const b = seg.w.points[seg.idx + 1];
        
        // Determine snap spacing
        const gridUnits = snapMode === 'grid' 
          ? (CURRENT_SNAP_USER_UNITS || baseSnapUser())
          : baseSnapUser(); // 50mil
        
        // Find all grid points along the segment and pick the closest to mouse
        let bestGridPoint = null;
        let bestGridDist = Infinity;
        
        const EPS = 0.01; // Tolerance for axis alignment check
        
        if (Math.abs(a.x - b.x) < EPS) {
          // Vertical segment - iterate through y grid points
          const x = a.x;
          const minY = Math.min(a.y, b.y);
          const maxY = Math.max(a.y, b.y);
          const startGrid = Math.ceil(minY / gridUnits);
          const endGrid = Math.floor(maxY / gridUnits);
          
          for (let i = startGrid; i <= endGrid; i++) {
            const y = i * gridUnits;
            const dist = Math.hypot(p.x - x, p.y - y);
            if (dist < bestGridDist) {
              bestGridDist = dist;
              bestGridPoint = { x, y };
            }
          }
        } else if (Math.abs(a.y - b.y) < EPS) {
          // Horizontal segment - iterate through x grid points
          const y = a.y;
          const minX = Math.min(a.x, b.x);
          const maxX = Math.max(a.x, b.x);
          const startGrid = Math.ceil(minX / gridUnits);
          const endGrid = Math.floor(maxX / gridUnits);
          
          for (let i = startGrid; i <= endGrid; i++) {
            const x = i * gridUnits;
            const dist = Math.hypot(p.x - x, p.y - y);
            if (dist < bestGridDist) {
              bestGridDist = dist;
              bestGridPoint = { x, y };
            }
          }
        }
        
        // Return the nearest grid point if found, otherwise snap the projection
        if (bestGridPoint) {
          return bestGridPoint;
        }
        // Fallback: snap the projected point if no grid intersections found
        return { x: snap(seg.q.x), y: snap(seg.q.y) };
      }
      
      // No grid snap or no grid point found - use projected point
      return { x: seg.q.x, y: seg.q.y };
    }

    // Finally, fall back to grid snapping
    return { x: snap(p.x), y: snap(p.y) };
  }
  function wiresEndingAt(pt) {
    return wires.filter(w => {
      const a = w.points[0], b = w.points[w.points.length - 1];
      return eqPt(a, pt) || eqPt(b, pt);
    });
  }
  function adjacentOther(w, endPt) {
    // return the vertex adjacent to the endpoint that equals endPt
    const n = w.points.length;
    if (n < 2) return null;
    if (eqPt(w.points[0], endPt)) return w.points[1];
    if (eqPt(w.points[n - 1], endPt)) return w.points[n - 2];
    return null;
  }

  // Helper to create Move context
  function createMoveContext() {
    return {
      components, wires, junctions, selection, moveCollapseCtx, lastMoveCompId, topology,
      snap, snapToBaseScalar, eqPt, eqPtEps: Geometry.eqPtEps, eqN: Geometry.eqN, keyPt: Geometry.keyPt,
      compPinPositions: Components.compPinPositions, wiresEndingAt, adjacentOther,
      pushUndo, redraw, redrawCanvasOnly, uid: State.uid,
      rebuildTopology, findSwpById, swpIdForComponent,
      updateComponentDOM: (c) => updateComponentDOM(c), updateWireDOM,
      setAttr, buildSymbolGroup: (c) => Rendering.buildSymbolGroup(c, GRID, defaultResistorStyle),
      rgba01ToCss, ensureStroke, pointToSegmentDistance
    };
  }

  function buildSlideContext(c) { return Move.buildSlideContext(createMoveContext(), c); }

  function adjustWireEnd(w, oldEnd, newEnd) {
    if (!w) return;
    const ctx = createMoveContext();
    // Find and update the matching endpoint
    if (ctx.eqPt(w.points[0], oldEnd)) {
      w.points[0] = { x: newEnd.x, y: newEnd.y };
    } else if (ctx.eqPt(w.points[w.points.length - 1], oldEnd)) {
      w.points[w.points.length - 1] = { x: newEnd.x, y: newEnd.y };
    }
  }
  function replaceEndpoint(w, oldEnd, newEnd) { return Move.replaceEndpoint(createMoveContext(), w, oldEnd, newEnd); }

  // Determine axis from a 2-pin part’s pin positions ('x' = horizontal, 'y' = vertical)
  function axisFromPins(pins: Point[] | Array<{ x: number; y: number }>): Axis {
    if (!pins || pins.length < 2) return null;
    if (pins[0].y === pins[1].y) return 'x';
    if (pins[0].x === pins[1].x) return 'y';
    return null;
  }
  function wireAlongAxisAt(pt, axis) { return Move.wireAlongAxisAt(createMoveContext(), pt, axis); }

  function updateComponentDOM(c) { return Move.updateComponentDOM(createMoveContext(), c, gComps); }

  function rebuildSymbolGroup(c, g) { return Move.rebuildSymbolGroup(createMoveContext(), c, g); }

  function wirePointsString(w) { return w.points.map(p => `${p.x},${p.y}`).join(' '); }

  function updateWireDOM(w) {
    if (!w) return;
    const group = gWires.querySelector(`g[data-id="${w.id}"]`);
    if (!group) return;
    const pts = wirePointsString(w);
    group.querySelectorAll('polyline').forEach(pl => pl.setAttribute('points', pts));
    const vis = group.querySelector('polyline[data-wire-stroke]');
    if (vis) {
      ensureStroke(w);
      const eff = effectiveStroke(w, Netlist.netClassForWire(w, NET_CLASSES, activeNetClass), THEME);
      vis.setAttribute('stroke', rgba01ToCss(eff.color));
      vis.setAttribute('stroke-width', String(mmToPx(eff.width)));
      const dashes = dashArrayFor(eff.type);
      if (dashes) vis.setAttribute('stroke-dasharray', dashes); else vis.removeAttribute('stroke-dasharray');
    }
  }

  // ================================================================================
  // ====== 8. INTERACTION HANDLERS ======
  // ================================================================================

  svg.addEventListener('pointerdown', (e) => {
    // --- Manual Junction Dot Placement/Deletion and shared pointerdown setup ---
    const p = svgPoint(e);
    const tgt = e.target as Element;
    
    // If endpoint stretch is active, any left-click confirms and ends it
    if (endpointStretchState && endpointStretchState.dragging && e.button === 0) {
      const w = endpointStretchState.wire;
      
      // Remove the drag dot
      const dot = gDrawing.querySelector('[data-endpoint-drag-dot]');
      if (dot) dot.remove();
      
      // Check if wire became too short (< 5 pixels) - if so, delete it
      const len = Math.hypot(w.points[1].x - w.points[0].x, w.points[1].y - w.points[0].y);
      if (len < 5) {
        wires = wires.filter(wire => wire.id !== w.id);
        clearSelection();
      }
      
      // Normalize and clean up
      normalizeAllWires();
      unifyInlineWires();
      splitWiresAtTJunctions();
      normalizeAllWires();
      rebuildTopology();
      redraw();
      
      endpointStretchState = null;
      e.preventDefault();
      return;
    }
    
    let endpointClicked: Point | null = null;
    if (tgt && (tgt.tagName === 'rect' || tgt.tagName === 'circle') && (tgt as any).endpoint) {
      endpointClicked = (tgt as any).endpoint as Point;
    }
    const snapCandDown = endpointClicked
      ? endpointClicked
      : (mode === 'wire') ? snapPointPreferAnchor({ x: p.x, y: p.y }) : { x: snap(p.x), y: snap(p.y) };
    const x = snapCandDown.x, y = snapCandDown.y;

    if (mode === 'place-junction' && e.button === 0) {
      // Place a junction dot at the clicked location
      const TOL = 50; // mils
      const tol = TOL * 0.0254 * (100 / 25.4); // Convert mils to mm, then mm to pixels

      let bestPt: Point | null = null;
      let bestDist = Infinity;

      // Build all segments
      const segments: Array<{ a: Point, b: Point, wId: string }> = [];
      for (const w of wires) {
        for (let i = 0; i < w.points.length - 1; i++) {
          segments.push({ a: w.points[i], b: w.points[i + 1], wId: w.id });
        }
      }

      // Helper: Find closest point on an axis-aligned segment to the click point
      const closestPointOnSegment = (a: Point, b: Point, click: Point): Point => {
        if (a.x === b.x) {
          // Vertical segment - clamp y coordinate
          const y = Math.max(Math.min(a.y, b.y), Math.min(click.y, Math.max(a.y, b.y)));
          return { x: a.x, y };
        } else if (a.y === b.y) {
          // Horizontal segment - clamp x coordinate
          const x = Math.max(Math.min(a.x, b.x), Math.min(click.x, Math.max(a.x, b.x)));
          return { x, y: a.y };
        }
        return a;
      };

      // Helper: Check if two axis-aligned segments intersect and return intersection point
      const segmentIntersection = (s1: { a: Point, b: Point }, s2: { a: Point, b: Point }): Point | null => {
        if (s1.a.x === s1.b.x && s2.a.y === s2.b.y) {
          // s1 vertical, s2 horizontal
          const x = s1.a.x;
          const y = s2.a.y;
          if (Math.min(s1.a.y, s1.b.y) <= y && y <= Math.max(s1.a.y, s1.b.y) &&
            Math.min(s2.a.x, s2.b.x) <= x && x <= Math.max(s2.a.x, s2.b.x)) {
            return { x, y };
          }
        } else if (s1.a.y === s1.b.y && s2.a.x === s2.b.x) {
          // s1 horizontal, s2 vertical
          const x = s2.a.x;
          const y = s1.a.y;
          if (Math.min(s1.a.x, s1.b.x) <= x && x <= Math.max(s1.a.x, s1.b.x) &&
            Math.min(s2.a.y, s2.b.y) <= y && y <= Math.max(s2.a.y, s2.b.y)) {
            return { x, y };
          }
        }
        return null;
      };

      // Step 1: Check if you clicked within 50 mils of ANY intersection
      let nearestIntersection: Point | null = null;
      let nearestIntersectionDist = Infinity;

      for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
          if (segments[i].wId === segments[j].wId) continue;
          const intersection = segmentIntersection(segments[i], segments[j]);
          if (intersection) {
            const distFromClick = Math.hypot(intersection.x - p.x, intersection.y - p.y);
            if (distFromClick < nearestIntersectionDist) {
              nearestIntersectionDist = distFromClick;
              nearestIntersection = intersection;
            }
          }
        }
      }

      // If click is within 50 mils of an intersection, snap to it
      if (nearestIntersection && nearestIntersectionDist <= tol) {
        bestPt = nearestIntersection;
      } else {
        // Step 2: Not near an intersection, so find closest point on any wire
        let closestOnWire: Point | null = null;
        let closestWireDist = Infinity;

        for (const seg of segments) {
          const closest = closestPointOnSegment(seg.a, seg.b, p);
          const d = Math.hypot(closest.x - p.x, closest.y - p.y);
          if (d < closestWireDist) {
            closestWireDist = d;
            closestOnWire = closest;
          }
        }

        // If within 50 mils of a wire, place it there
        if (closestOnWire && closestWireDist <= tol) {
          bestPt = closestOnWire;
        } else {
          // Not near anything - don't place junction in open space
          return;
        }
      }
      
      // Snap bestPt to base grid to match wire endpoint snapping
      // This ensures junction position matches wire endpoints after normalization
      bestPt = { x: snapToBaseScalar(bestPt.x), y: snapToBaseScalar(bestPt.y) };
      
      // Remove any existing junction at this location (suppressed or automatic)
      // When user manually places a junction, it should replace any automatic one
      const existingJunction = junctions.find(j => 
        Math.abs(j.at.x - bestPt.x) < 1e-3 && Math.abs(j.at.y - bestPt.y) < 1e-3
      );
      
      // Only add junction if none exists, or if existing one is automatic/suppressed (replace it)
      if (!existingJunction || !existingJunction.manual || existingJunction.suppressed) {
        pushUndo();
        
        // Remove existing automatic or suppressed junction
        if (existingJunction) {
          junctions = junctions.filter(j => j.id !== existingJunction.id);
        }
        
        // Check if we're placing junction on a wire segment (not at endpoint)
        // If so, split that wire into two segments at the junction point
        const TOL_SPLIT = 1e-3; // Tight tolerance for endpoint matching
        for (const w of wires) {
          // Check if junction is on a segment (not at an endpoint)
          for (let i = 0; i < w.points.length - 1; i++) {
            const a = w.points[i];
            const b = w.points[i + 1];
            
            // Skip if junction is at an endpoint
            const isAtEndpointA = Math.hypot(bestPt.x - a.x, bestPt.y - a.y) < TOL_SPLIT;
            const isAtEndpointB = Math.hypot(bestPt.x - b.x, bestPt.y - b.y) < TOL_SPLIT;
            if (isAtEndpointA || isAtEndpointB) continue;
            
            // Check if point lies on this segment
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) continue;
            
            const t = ((bestPt.x - a.x) * dx + (bestPt.y - a.y) * dy) / (len * len);
            if (t > 0 && t < 1) { // Strictly between endpoints
              const closestX = a.x + t * dx;
              const closestY = a.y + t * dy;
              if (Math.hypot(closestX - bestPt.x, closestY - bestPt.y) < TOL_SPLIT) {
                // Junction is on this segment - split the wire
                // Create first segment: from a to junction point
                const wire1: Wire = {
                  id: State.uid('wire'),
                  points: [{ x: a.x, y: a.y }, { x: bestPt.x, y: bestPt.y }],
                  color: w.color,
                  stroke: w.stroke ? { ...w.stroke } : undefined,
                  netId: w.netId
                };
                
                // Create second segment: from junction point to b
                const wire2: Wire = {
                  id: State.uid('wire'),
                  points: [{ x: bestPt.x, y: bestPt.y }, { x: b.x, y: b.y }],
                  color: w.color,
                  stroke: w.stroke ? { ...w.stroke } : undefined,
                  netId: w.netId
                };
                
                // Remove the original wire and add the two new segments
                wires = wires.filter(wire => wire.id !== w.id);
                wires.push(wire1, wire2);
                break; // Only split one wire per junction placement
              }
            }
          }
        }
        
        // Always use the default junction color from settings
        junctions.push({ id: State.uid('junction'), at: { x: bestPt.x, y: bestPt.y }, manual: true, color: junctionDefaultColor || undefined });
        
        // After splitting wires, normalize them into separate 2-point wire objects
        normalizeAllWires();
        splitWiresAtTJunctions();
        normalizeAllWires();
        
        redraw();
      }
      // Stay in place-junction mode to allow placing multiple dots
      return;
    }
    if (mode === 'delete-junction' && e.button === 0) {
      // Delete a junction dot at the clicked location (within 50 mils)
      const TOL = 50; // mils
      const tol = TOL * 0.0254 * (100 / 25.4); // Convert mils to mm, then mm to pixels
      let idx = -1;
      let minDist = Infinity;
      for (let i = 0; i < junctions.length; ++i) {
        const j = junctions[i];
        const d = Math.hypot(j.at.x - p.x, j.at.y - p.y);
        if (d <= tol && d < minDist) {
          minDist = d;
          idx = i;
        }
      }
      if (idx !== -1) {
        const junction = junctions[idx];
        pushUndo();
        // Always add suppressed marker to prevent automatic junction from being recreated
        junctions.splice(idx, 1);
        junctions.push({ id: State.uid('junction'), at: junction.at, manual: true, suppressed: true });
        
        // Merge any collinear wires that were separated by this junction
        normalizeAllWires();
        unifyInlineWires();
        
        redraw();
      }
      // Stay in delete-junction mode to allow deleting multiple dots
      return;
    }
    // If user clicks on empty canvas while in Move mode, cancel the move and
    // return to Select mode with no selection. This matches the expectation
    // that clicking off deselects and exits Move.
    try {
      const onComp = !!(tgt && tgt.closest && tgt.closest('g.comp'));
      const onWire = !!(tgt && tgt.closest && tgt.closest('#wires g'));
      const onJunction = !!(tgt && tgt.hasAttribute && tgt.hasAttribute('data-junction-id'));
      const onEndpoint = !!(tgt && (tgt as any).endpoint); // Check if clicking on an endpoint marker
      
      // Handle clicking on a free wire endpoint to stretch it along its axis
      // Allow this from any mode except wire mode (where endpoints are for connecting)
      if (mode !== 'wire' && e.button === 0 && onEndpoint && (tgt as any).wireId) {
        const wireId = (tgt as any).wireId;
        const endpointIndex = (tgt as any).endpointIndex;
        const wire = wires.find(w => w.id === wireId);
        
        if (wire && wire.points.length === 2) {
          const endpoint = wire.points[endpointIndex];
          const otherEnd = wire.points[endpointIndex === 0 ? (wire.points.length - 1) : 0];
          
          // Check if this endpoint is free (not connected to anything)
          const connectedWires = wiresEndingAt(endpoint).filter(w => w.id !== wireId);
          const connectedComps = components.filter(c => {
            const pins = Components.compPinPositions(c);
            return pins.some(pin => Math.hypot(pin.x - endpoint.x, pin.y - endpoint.y) < 1);
          });
          
          const isFree = connectedWires.length === 0 && connectedComps.length === 0;
          
          if (isFree) {
            // Determine axis (horizontal or vertical)
            const isVertical = Math.abs(wire.points[0].x - wire.points[1].x) < 0.1;
            const isHorizontal = Math.abs(wire.points[0].y - wire.points[1].y) < 0.1;
            
            if (isVertical || isHorizontal) {
              // Start endpoint stretch - automatically switch to move mode
              pushUndo();
              endpointStretchState = {
                wire,
                endpointIndex,
                originalPoints: wire.points.map(pt => ({ x: pt.x, y: pt.y })),
                axis: isVertical ? 'y' : 'x',
                fixedCoord: isVertical ? wire.points[0].x : wire.points[0].y,
                dragging: true
              };
              
              // Draw the dot immediately at the endpoint
              // Remove any existing drag dots first
              gDrawing.querySelectorAll('[data-endpoint-drag-dot]').forEach(el => el.remove());
              
              const ns = 'http://www.w3.org/2000/svg';
              const dot = document.createElementNS(ns, 'circle');
              dot.setAttribute('data-endpoint-drag-dot', '1');
              dot.setAttribute('cx', String(wire.points[endpointIndex].x));
              dot.setAttribute('cy', String(wire.points[endpointIndex].y));
              dot.setAttribute('r', '3');
              dot.setAttribute('fill', '#ffffff');
              dot.setAttribute('stroke', '#000000');
              dot.setAttribute('stroke-width', '1');
              dot.style.pointerEvents = 'none';
              gDrawing.appendChild(dot);
              
              setMode('move');
              clearSelection(); // Don't select the wire so endpoint remains visible
              e.stopPropagation();
              e.preventDefault();
              return;
            }
          }
        }
      }
      
      if (mode === 'move' && e.button === 0 && !onComp && !onWire && !onJunction && !onEndpoint) {
        clearSelection();
        setMode('select');
        renderInspector(); redraw();
        return;
      }
      // If in none mode with something selected, clicking empty space should deselect
      if (mode === 'none' && e.button === 0 && !onComp && !onWire && !onJunction && !onEndpoint && !isSelectionEmpty()) {
        clearSelection();
        renderInspector(); redraw();
        return;
      }
    } catch (_) { }
    // Middle mouse drag pans
    if (e.button === 1) {
      e.preventDefault(); beginPan(e);
      return;
    }
    // Right-click cancels endpoint stretch
    if (e.button === 2 && endpointStretchState && endpointStretchState.dragging) {
      e.preventDefault();
      suppressNextContextMenu = true;
      // Remove the drag dot
      const dot = gDrawing.querySelector('[data-endpoint-drag-dot]');
      if (dot) dot.remove();
      // Restore original points
      const w = endpointStretchState.wire;
      w.points = endpointStretchState.originalPoints.map(pt => ({ x: pt.x, y: pt.y }));
      updateWireDOM(w);
      endpointStretchState = null;
      normalizeAllWires();
      splitWiresAtTJunctions();
      normalizeAllWires();
      redraw();
      return;
    }
    // Right-click ends wire placement (when wiring) or exits junction dot modes
    if (e.button === 2 && mode === 'wire' && drawing.active) {
      e.preventDefault();
      suppressNextContextMenu = true; // ensure the imminent contextmenu is blocked
      finishWire();
      return;
    }
    if (e.button === 2 && (mode === 'place-junction' || mode === 'delete-junction')) {
      e.preventDefault();
      suppressNextContextMenu = true;
      setMode('select');
      return;
    }
    if (mode === 'place' && placeType) {
      const id = State.uid(placeType);
      const labelPrefix = { resistor: 'R', capacitor: 'C', inductor: 'L', diode: 'D', npn: 'Q', pnp: 'Q', ground: 'GND', battery: 'BT', ac: 'AC' }[placeType] || 'X';
      // If a 2-pin part is dropped near a segment, project to it and align rotation
      let at = { x, y }, rot = 0;
      if (isTwoPinType(placeType)) {
        const hit = nearestSegmentAtPoint(p, 18);
        if (hit) { 
          // Snap the projection point to the grid to ensure component pins align with wire endpoints
          at = { x: snap(hit.q.x), y: snap(hit.q.y) }; 
          rot = normDeg(hit.angle); 
        }
      }
      // Extract numeric suffix from ID for label (e.g., resistor1 -> R1)
      const idNumber = id.match(/\d+$/)?.[0] || '0';
      const comp: Component = {
        id, type: placeType, x: at.x, y: at.y, rot, label: `${labelPrefix}${idNumber}`, value: '',
        props: {}
      };
      if (placeType === 'diode') {
        (comp.props as Component['props']).subtype = diodeSubtype as DiodeSubtype;
      }
      if (placeType === 'resistor') {
        (comp.props as Component['props']).resistorStyle = defaultResistorStyle;
      }
      if (placeType === 'capacitor') {
        (comp.props as Component['props']).capacitorSubtype = capacitorSubtype;
        if (capacitorSubtype === 'polarized') {
          (comp.props as Component['props']).capacitorStyle = defaultResistorStyle;
        }
      }
      components.push(comp);
      
      // Check constraints if enabled (unless Shift key is held to bypass collision)
      const shiftHeld = (e as PointerEvent).shiftKey;
      if (USE_CONSTRAINTS && constraintSolver && !shiftHeld) {
        syncConstraints(); // Add the new component to constraint system
        
        // Check if placement violates any constraints
        const result = constraintSolver.solve(comp.id, { x: comp.x, y: comp.y });
        if (!result.allowed) {
          // Placement violates constraints - remove the component and resync
          components.pop();
          syncConstraints();
          console.warn(`⚠️ Cannot place ${comp.label} at (${comp.x}, ${comp.y}) - would overlap existing component`);
          redraw();
          return;
        }
      } else if (USE_CONSTRAINTS && constraintSolver && shiftHeld) {
        // Shift held - allow overlapping placement
        syncConstraints(); // Still need to sync the new component
        console.log(`🔑 Shift: Placed ${comp.label} at (${comp.x}, ${comp.y}) (collision check bypassed)`);
      }
      
      // Break wires at pins and remove inner bridge segment for 2-pin parts
      breakWiresForComponent(comp);
      deleteBridgeBetweenPins(comp);
      setMode('select');
      placeType = null;
      selectSingle('component', id, null);
      redraw();
      return;
    }
    if (mode === 'wire') {
      // start drawing if not active, else add point
      if (!drawing.active) {
        // Use object snap if Manhattan routing is enabled, otherwise use standard grid snap
        const startPoint = USE_MANHATTAN_ROUTING 
          ? snapToGridOrObject({ x: p.x, y: p.y }, 10) 
          : { x, y };
        drawing.active = true; 
        drawing.points = [startPoint]; 
        drawing.cursor = startPoint;
      } else {
        // Check if we clicked on an endpoint circle (during drawing)
        const tgt = e.target as Element;

        // Check if the target or any parent has endpoint data
        let endpointData: Point | null = null;

        // First check if target is a rect with endpoint data
        if (tgt && tgt.tagName === 'rect' && (tgt as any).endpoint) {
          endpointData = (tgt as any).endpoint as Point;
        }

        // Also check if target is within gDrawing or gOverlay and has endpoint rects nearby
        if (!endpointData && tgt) {
          // Check all rect elements in overlay and drawing layers for endpoint data
          const allRects = [
            ...$qa<SVGRectElement>('rect[data-endpoint]', gOverlay),
            ...$qa<SVGRectElement>('rect', gDrawing)
          ];

          for (const rect of allRects) {
            if ((rect as any).endpoint) {
              const ep = (rect as any).endpoint as Point;
              // Check if click is within this rect's bounds
              const rectBounds = rect.getBBox();
              const pt = svgPoint(e);
              if (pt.x >= rectBounds.x && pt.x <= rectBounds.x + rectBounds.width &&
                pt.y >= rectBounds.y && pt.y <= rectBounds.y + rectBounds.height) {
                endpointData = ep;
                break;
              }
            }
          }
        }

        let nx, ny;
        if (endpointData) {
          // Use the exact anchor position stored on the endpoint circle - no ortho constraint
          nx = endpointData.x;
          ny = endpointData.y;
        } else {
          // Always use drawing.cursor position which already has connection hints,
          // ortho constraints, and object snapping applied from the pointermove handler.
          // This ensures clicks place points exactly where the visual preview shows them.
          nx = drawing.cursor ? drawing.cursor.x : x;
          ny = drawing.cursor ? drawing.cursor.y : y;
        }

        // KiCad-style Manhattan routing: If enabled, check if we need to insert bend for orthogonality
        if (USE_MANHATTAN_ROUTING && drawing.points.length >= 1) {
          const start = drawing.points[drawing.points.length - 1]; // Last placed point
          const end = { x: nx, y: ny };
          
          // Check if this segment would be diagonal (not orthogonal)
          const dx = Math.abs(end.x - start.x);
          const dy = Math.abs(end.y - start.y);
          const isDiagonal = dx > 0.01 && dy > 0.01; // Both X and Y differ significantly
          
          if (isDiagonal) {
            // Would be diagonal - insert bend to make it orthogonal
            const mode: 'HV' | 'VH' = dx >= dy ? 'HV' : 'VH';
            const manhattanPts = manhattanPath(start, end, mode);
            
            // Add intermediate bend points (skip first point which is already in drawing.points,
            // and skip last point which is the click position - it becomes the new cursor position)
            for (let i = 1; i < manhattanPts.length - 1; i++) {
              drawing.points.push(manhattanPts[i]);
            }
            
            // Add the final clicked point
            drawing.points.push({ x: nx, y: ny });
            drawing.cursor = { x: nx, y: ny };
          } else {
            // Already orthogonal - just add the point
            drawing.points.push({ x: nx, y: ny });
            drawing.cursor = { x: nx, y: ny };
          }
        } else {
          // Manhattan routing disabled or no points yet - normal behavior
          drawing.points.push({ x: nx, y: ny });
          drawing.cursor = { x: nx, y: ny };
        }
        
        // Clear connection hint after placing a point
        connectionHint = null;
      }
      renderDrawing();
    }
    if (mode === 'select' && e.button === 0) {
      // Start marquee only if pointerdown is on empty canvas; defer clearing until mouseup if it's just a click
      const tgt = e.target as Element;
      const onComp = tgt && tgt.closest('g.comp');
      const onWire = tgt && tgt.closest('#wires g');
      const onJunction = tgt && tgt.hasAttribute && tgt.hasAttribute('data-junction-id');
      if (!onComp && !onWire && !onJunction) {
        beginMarqueeAt(svgPoint(e), /*startedOnEmpty=*/true, /*preferComponents=*/e.shiftKey);
      }
    }
    if (mode === 'pan' && e.button === 0) {
      beginPan(e);
      return;
    }
  });

  svg.addEventListener('dblclick', (e) => {
    if (mode === 'wire' && drawing.active) { finishWire(); }
  });
  // Rubber-band wire, placement ghost, crosshair, and hover pan cursor
  svg.addEventListener('pointermove', (e) => {
    // Free endpoint stretch mode handling
    if (endpointStretchState && endpointStretchState.dragging) {
      const p = svgPoint(e);
      const w = endpointStretchState.wire;
      const axis = endpointStretchState.axis;
      const fixedCoord = endpointStretchState.fixedCoord;
      const endpointIndex = endpointStretchState.endpointIndex;
      const otherEndIndex = endpointIndex === 0 ? (w.points.length - 1) : 0;
      const otherEndpoint = w.points[otherEndIndex];
      
      // Constrain movement along the wire's axis
      // Allow shrinking but prevent crossing past the other endpoint (minimum length stays at 5px for deletion check)
      if (axis === 'x') {
        // Horizontal wire - move endpoint horizontally (allow full range, will be deleted if too short)
        const newX = snap(p.x);
        w.points[endpointIndex].x = newX;
        w.points[endpointIndex].y = fixedCoord;
        w.points[otherEndIndex].y = fixedCoord; // Ensure other end stays on axis
      } else {
        // Vertical wire - move endpoint vertically (allow full range, will be deleted if too short)
        const newY = snap(p.y);
        w.points[endpointIndex].x = fixedCoord;
        w.points[endpointIndex].y = newY;
        w.points[otherEndIndex].x = fixedCoord; // Ensure other end stays on axis
      }
      
      updateWireDOM(w);
      
      // Draw a visible white dot at the dragging endpoint
      // Remove ALL existing drag dots first
      gDrawing.querySelectorAll('[data-endpoint-drag-dot]').forEach(el => el.remove());
      
      const ns = 'http://www.w3.org/2000/svg';
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('data-endpoint-drag-dot', '1');
      dot.setAttribute('cx', String(w.points[endpointIndex].x));
      dot.setAttribute('cy', String(w.points[endpointIndex].y));
      dot.setAttribute('r', '3');
      dot.setAttribute('fill', '#ffffff');
      dot.setAttribute('stroke', '#000000');
      dot.setAttribute('stroke-width', '1');
      dot.style.pointerEvents = 'none';
      gDrawing.appendChild(dot);
      
      updateCoordinateDisplay(w.points[endpointIndex].x, w.points[endpointIndex].y);
      updateCoordinateInputs(w.points[endpointIndex].x, w.points[endpointIndex].y);
      showCoordinateInputs();
      return;
    }
    
    // Wire stretch handling
    if (wireStretchState && mode === 'move') {
      const p = svgPoint(e);
      let justStartedDragging = false;
      if (!wireStretchState.dragging) {
        // Check if mouse moved enough to start dragging
        const dist = Math.hypot(p.x - wireStretchState.startMousePos.x, p.y - wireStretchState.startMousePos.y);
        if (dist > 10) {
          wireStretchState.dragging = true;
          justStartedDragging = true;
          pushUndo();
        }
      }
      
      if (wireStretchState.dragging) {
        const w = wireStretchState.wire;
        const p0 = wireStretchState.originalP0;
        const p1 = wireStretchState.originalP1;
        const isHorizontal = Math.abs(p0.y - p1.y) < 1;
        const isVertical = Math.abs(p0.x - p1.x) < 1;
        
        if (isHorizontal) {
          // Horizontal wire - move vertically
          const delta = p.y - wireStretchState.startMousePos.y;
          const newY = snap(p0.y + delta);
          
          // Update main wire position
          // Create NEW point objects to avoid modifying shared points from wire splitting
          w.points[0] = { x: p0.x, y: newY };
          w.points[1] = { x: p1.x, y: newY };
          
          // Update ghost connecting wires for visual feedback
          wireStretchState.ghostConnectingWires = [];
          
          // Handle connected wires at start endpoint
          const startPos = wireStretchState.originalP0;
          // Filter for perpendicular wires only (vertical wires for horizontal wire movement)
          const perpConnectedWiresStart = wireStretchState.connectedWiresStart.filter(conn => {
            const cw = conn.wire;
            const cwStart = cw.points[0];
            const cwEnd = cw.points[cw.points.length - 1];
            const isVertical = Math.abs(cwStart.x - cwEnd.x) < 1;
            return isVertical; // For horizontal wire, only stretch vertical connecting wires
          });
          
          if (perpConnectedWiresStart.length === 0 && wireStretchState.junctionAtStart) {
            // No existing perpendicular connecting wire but there's a junction - create ghost for visual feedback
            const junctionPos = wireStretchState.junctionAtStart.at;
            wireStretchState.ghostConnectingWires.push({
              from: { x: junctionPos.x, y: junctionPos.y },
              to: { x: junctionPos.x, y: newY }
            });
          } else {
            // Existing perpendicular connecting wire(s) - stretch them in real-time
            perpConnectedWiresStart.forEach(conn => {
              const endToUpdate = conn.isStart ? 0 : conn.wire.points.length - 1;
              conn.wire.points[endToUpdate].y = newY;
            });
          }
          
          // Handle connected wires at end endpoint
          const endPos = wireStretchState.originalP1;
          // Filter for perpendicular wires only (vertical wires for horizontal wire movement)
          const perpConnectedWiresEnd = wireStretchState.connectedWiresEnd.filter(conn => {
            const cw = conn.wire;
            const cwStart = cw.points[0];
            const cwEnd = cw.points[cw.points.length - 1];
            const isVertical = Math.abs(cwStart.x - cwEnd.x) < 1;
            return isVertical; // For horizontal wire, only stretch vertical connecting wires
          });
          
          if (perpConnectedWiresEnd.length === 0 && wireStretchState.junctionAtEnd) {
            // No existing perpendicular connecting wire but there's a junction - create ghost for visual feedback
            const junctionPos = wireStretchState.junctionAtEnd.at;
            wireStretchState.ghostConnectingWires.push({
              from: { x: junctionPos.x, y: junctionPos.y },
              to: { x: junctionPos.x, y: newY }
            });
          } else {
            // Existing perpendicular connecting wire(s) - stretch them in real-time
            perpConnectedWiresEnd.forEach(conn => {
              const endToUpdate = conn.isStart ? 0 : conn.wire.points.length - 1;
              conn.wire.points[endToUpdate].y = newY;
            });
          }
          
          wireStretchState.componentsOnWire.forEach(compInfo => {
            compInfo.pins.forEach(pin => {
              // For horizontal wire moving vertically, create vertical connecting wires
              // Only create if pin is at one of the wire endpoints (not just anywhere on the horizontal plane)
              const pinAtStartY = Math.abs(pin.y - wireStretchState.originalP0.y) < 1;
              const pinAtStartX = Math.abs(pin.x - wireStretchState.originalP0.x) < 1;
              const pinAtEndY = Math.abs(pin.y - wireStretchState.originalP1.y) < 1;
              const pinAtEndX = Math.abs(pin.x - wireStretchState.originalP1.x) < 1;
              
              // Pin must be at the wire's Y level AND at one of the endpoints' X position
              if (pinAtStartY && (pinAtStartX || pinAtEndX)) {
                // Use the wire endpoint's X position, not the pin's X position
                // This ensures the connecting wire aligns with the grid-snapped wire endpoint
                const wireEndpointX = pinAtStartX ? wireStretchState.originalP0.x : wireStretchState.originalP1.x;
                wireStretchState.ghostConnectingWires.push({
                  from: { x: wireEndpointX, y: pin.y },
                  to: { x: wireEndpointX, y: newY }
                });
              }
            });
          });
          
        } else if (isVertical) {
          // Vertical wire - move horizontally
          const delta = p.x - wireStretchState.startMousePos.x;
          const newX = snap(p0.x + delta);
          
          // Update main wire position
          // Create NEW point objects to avoid modifying shared points from wire splitting
          w.points[0] = { x: newX, y: p0.y };
          w.points[1] = { x: newX, y: p1.y };
          
          // Update ghost connecting wires for visual feedback
          wireStretchState.ghostConnectingWires = [];
          
          // Handle connected wires at start endpoint
          const startPos = wireStretchState.originalP0;
          // Filter for perpendicular wires only (horizontal wires for vertical wire movement)
          const perpConnectedWiresStart = wireStretchState.connectedWiresStart.filter(conn => {
            const cw = conn.wire;
            const cwStart = cw.points[0];
            const cwEnd = cw.points[cw.points.length - 1];
            const isHorizontal = Math.abs(cwStart.y - cwEnd.y) < 1;
            return isHorizontal; // For vertical wire, only stretch horizontal connecting wires
          });
          
          if (perpConnectedWiresStart.length === 0 && wireStretchState.junctionAtStart) {
            // No existing perpendicular connecting wire but there's a junction - create ghost for visual feedback
            const junctionPos = wireStretchState.junctionAtStart.at;
            wireStretchState.ghostConnectingWires.push({
              from: { x: junctionPos.x, y: junctionPos.y },
              to: { x: newX, y: junctionPos.y }
            });
          } else {
            // Existing perpendicular connecting wire(s) - stretch them in real-time
            perpConnectedWiresStart.forEach(conn => {
              const endToUpdate = conn.isStart ? 0 : conn.wire.points.length - 1;
              conn.wire.points[endToUpdate].x = newX;
            });
          }
          
          // Handle connected wires at end endpoint
          const endPos = wireStretchState.originalP1;
          // Filter for perpendicular wires only (horizontal wires for vertical wire movement)
          const perpConnectedWiresEnd = wireStretchState.connectedWiresEnd.filter(conn => {
            const cw = conn.wire;
            const cwStart = cw.points[0];
            const cwEnd = cw.points[cw.points.length - 1];
            const isHorizontal = Math.abs(cwStart.y - cwEnd.y) < 1;
            return isHorizontal; // For vertical wire, only stretch horizontal connecting wires
          });
          
          if (perpConnectedWiresEnd.length === 0 && wireStretchState.junctionAtEnd) {
            // No existing perpendicular connecting wire but there's a junction - create ghost for visual feedback
            const junctionPos = wireStretchState.junctionAtEnd.at;
            wireStretchState.ghostConnectingWires.push({
              from: { x: junctionPos.x, y: junctionPos.y },
              to: { x: newX, y: junctionPos.y }
            });
          } else {
            // Existing perpendicular connecting wire(s) - stretch them in real-time
            perpConnectedWiresEnd.forEach(conn => {
              const endToUpdate = conn.isStart ? 0 : conn.wire.points.length - 1;
              conn.wire.points[endToUpdate].x = newX;
            });
          }
          
          wireStretchState.componentsOnWire.forEach(compInfo => {
            compInfo.pins.forEach(pin => {
              // For vertical wire moving horizontally, create horizontal connecting wires
              // Only create if pin is at one of the wire endpoints (not just anywhere on the vertical plane)
              const pinAtStartX = Math.abs(pin.x - wireStretchState.originalP0.x) < 1;
              const pinAtStartY = Math.abs(pin.y - wireStretchState.originalP0.y) < 1;
              const pinAtEndX = Math.abs(pin.x - wireStretchState.originalP1.x) < 1;
              const pinAtEndY = Math.abs(pin.y - wireStretchState.originalP1.y) < 1;
              
              // Pin must be at the wire's X level AND at one of the endpoints' Y position
              if (pinAtStartX && (pinAtStartY || pinAtEndY)) {
                // Use the wire endpoint's Y position, not the pin's Y position
                // This ensures the connecting wire aligns with the grid-snapped wire endpoint
                const wireEndpointY = pinAtStartY ? wireStretchState.originalP0.y : wireStretchState.originalP1.y;
                wireStretchState.ghostConnectingWires.push({
                  from: { x: wireStretchState.originalP0.x, y: wireEndpointY },
                  to: { x: newX, y: wireEndpointY }
                });
              }
            });
          });
        }
        
        updateWireDOM(w);
        
        // Always render during wire stretch to show ghost connecting wires
        renderDrawing();
      }
      return;
    }
    
    // Early exit for panning - skip expensive snap calculations
    if (isPanning) { doPan(e); return; }

    const p = svgPoint(e);
    // Prefer anchors while wiring so cursor and added points align to endpoints/pins
    // When Manhattan routing is enabled, use object snap to connect to off-grid pins
    let snapCandMove: Point;
    if (mode === 'wire' && USE_MANHATTAN_ROUTING) {
      snapCandMove = snapToGridOrObject({ x: p.x, y: p.y }, 10);
    } else if (mode === 'wire') {
      snapCandMove = snapPointPreferAnchor({ x: p.x, y: p.y });
    } else {
      snapCandMove = { x: snap(p.x), y: snap(p.y) };
    }
    let x = snapCandMove.x, y = snapCandMove.y;
    // Marquee update (Select mode). Track Shift to flip priority while dragging.
    if (marquee.active) {
      marquee.shiftPreferComponents = !!((e as PointerEvent).shiftKey || globalShiftDown);
      updateMarqueeTo(svgPoint(e));
    }

    // Check if hovering over an endpoint circle that would create a non-orthogonal line
    if (mode === 'wire' && drawing.active && drawing.points.length > 0) {
      const tgt = e.target as Element;
      if (tgt && tgt.tagName === 'rect' && (tgt as any).endpoint) {
        const ep = (tgt as any).endpoint as Point;
        const prev = drawing.points[drawing.points.length - 1];
        const dx = Math.abs(ep.x - prev.x);
        const dy = Math.abs(ep.y - prev.y);
        const isNonOrtho = (orthoMode || globalShiftDown) && dx > 0.01 && dy > 0.01;
        if (isNonOrtho && !endpointOverrideActive) {
          endpointOverrideActive = true;
          if (updateOrthoButtonVisual) updateOrthoButtonVisual();
        } else if (!isNonOrtho && endpointOverrideActive) {
          endpointOverrideActive = false;
          if (updateOrthoButtonVisual) updateOrthoButtonVisual();
        }
      } else if (endpointOverrideActive) {
        // Not hovering over endpoint anymore, clear the override
        endpointOverrideActive = false;
        if (updateOrthoButtonVisual) updateOrthoButtonVisual();
      }
    }

    if (mode === 'wire' && drawing.active) {
      // enforce orthogonal preview while Shift is down (or globally tracked) or when ortho mode is on
      const isShift = (e as PointerEvent).shiftKey || globalShiftDown;

      // Update visual indicator for shift-based temporary ortho (only if ortho mode is not already active)
      if (!orthoMode && isShift && !shiftOrthoVisualActive) {
        shiftOrthoVisualActive = true;
        if (updateOrthoButtonVisual) updateOrthoButtonVisual();
      } else if (!orthoMode && !isShift && shiftOrthoVisualActive) {
        shiftOrthoVisualActive = false;
        if (updateOrthoButtonVisual) updateOrthoButtonVisual();
      }

      const forceOrtho = isShift || orthoMode;

      if (drawing.points && drawing.points.length > 0) {
        const last = drawing.points[drawing.points.length - 1];
        const dx = Math.abs(x - last.x), dy = Math.abs(y - last.y);

        // Apply standard ortho constraint FIRST (if no hint is active yet)
        if (!connectionHint && forceOrtho) {
          if (dx >= dy) y = last.y; else x = last.x;
        }

        // Connection hint logic: try to lock onto nearby wire endpoint X or Y axis (only if tracking is enabled)
        // Use RAW mouse position (p) for candidate search to avoid grid snap interference
        // Convert pixel tolerances to SVG user coordinates based on current zoom
        const scale = svg.clientWidth / Math.max(1, viewW); // screen px per user unit
        const snapTol = HINT_SNAP_TOLERANCE_PX / scale; // convert to SVG user units
        const unlockThresh = HINT_UNLOCK_THRESHOLD_PX / scale; // convert to SVG user units



        // Collect all wire endpoints as candidates (only if tracking mode is enabled)
        const candidates: Point[] = [];

        if (trackingMode) {
          // Get the first point of the wire being drawn (to exclude it from candidates)
          const drawingStartPt = drawing.points.length > 0 ? drawing.points[0] : null;

          // Helper function to check if a point matches the drawing start point
          const isDrawingStart = (pt: Point) => {
            return drawingStartPt && pt.x === drawingStartPt.x && pt.y === drawingStartPt.y;
          };

          let wireEndpointCount = 0;
          wires.forEach(w => {
            if (w.points && w.points.length >= 2) {
              // Add first endpoint if it's not the drawing start point
              const firstPt = w.points[0];
              if (!isDrawingStart(firstPt)) {
                candidates.push(firstPt);
                wireEndpointCount++;
              }
              // Add last endpoint if it's not the drawing start point
              const lastPt = w.points[w.points.length - 1];
              if (!isDrawingStart(lastPt)) {
                candidates.push(lastPt);
                wireEndpointCount++;
              }
            }
          });
          // Also include component pins if they're not the drawing start point
          let componentPinCount = 0;
          components.forEach(c => {
            const pins = Components.compPinPositions(c);
            pins.forEach(p => {
              if (!isDrawingStart(p)) {
                candidates.push({ x: p.x, y: p.y });
                componentPinCount++;
              }
            });
          });

          // Include intermediate points of the wire being drawn
          // Skip only the last point (current segment start - we're drawing FROM it)
          // Include all other placed points (including the second-to-last point)
          let wirePointCandidates = 0;
          for (let i = 0; i < drawing.points.length - 1; i++) {
            candidates.push({ x: drawing.points[i].x, y: drawing.points[i].y });
            wirePointCandidates++;
          }


          // Check if we should unlock (moved too far from the hint target)
          if (connectionHint) {
            // Check distance from current mouse to the original target point
            const distFromTarget = Math.sqrt(
              Math.pow(x - connectionHint.targetPt.x, 2) +
              Math.pow(y - connectionHint.targetPt.y, 2)
            );
            if (distFromTarget > unlockThresh) {
              connectionHint = null; // unlock
            }
          }

          if (!connectionHint && candidates.length > 0) {
            // Find the nearest candidate in EITHER X or Y direction (whichever is closer)
            // Exclude candidates where the hint line would be colinear with current segment
            let bestCand: Point | null = null;
            let bestAxisDist = Infinity;
            let bestIsHorizontalHint = true; // true = horizontal hint line (lock Y), false = vertical hint line (lock X)

            // Helper to check if hint line would be problematic
            const shouldExcludeCandidate = (cand: Point, isHorizontalHint: boolean): boolean => {
              // Check if the line from cursor to candidate is colinear with line from last to cursor
              // Using cross product: if (cursor - last) × (candidate - cursor) ≈ 0, they're colinear
              const segmentX = x - last.x;
              const segmentY = y - last.y;
              const hintX = cand.x - x;
              const hintY = cand.y - y;
              const crossProduct = Math.abs(segmentX * hintY - segmentY * hintX);

              // Exclude if colinear with current segment
              if (crossProduct < 0.5) return true;

              // Also exclude if the hint direction matches the current dragging direction
              // If dragging vertically (dx < dy) and hint is vertical, exclude
              // If dragging horizontally (dx >= dy) and hint is horizontal, exclude
              const isDraggingVertically = dy > dx;
              const hintIsVertical = !isHorizontalHint;

              if (isDraggingVertically && hintIsVertical) {
                return true; // Exclude vertical hints when dragging vertically
              }
              if (!isDraggingVertically && !hintIsVertical) {
                return true; // Exclude horizontal hints when dragging horizontally
              }

              return false;
            };

            let checkCount = 0;
            candidates.forEach(cand => {
              // Use RAW mouse position (p) for distance checks, not snapped position
              // This prevents grid snap from interfering with tracking detection
              const rawX = p.x;
              const rawY = p.y;

              // Check X-axis proximity (for vertical hint line - locks X, varies Y)
              const xDist = Math.abs(rawX - cand.x);

              if (xDist < snapTol && xDist < bestAxisDist && !shouldExcludeCandidate(cand, false)) {
                bestAxisDist = xDist;
                bestCand = cand;
                bestIsHorizontalHint = false; // vertical hint line
              }

              // Check Y-axis proximity (for horizontal hint line - locks Y, varies X)
              const yDist = Math.abs(rawY - cand.y);

              if (yDist < snapTol && yDist < bestAxisDist && !shouldExcludeCandidate(cand, true)) {
                bestAxisDist = yDist;
                bestCand = cand;
                bestIsHorizontalHint = true; // horizontal hint line
              }

              checkCount++;
            });

            if (bestCand) {
              // Snap the cursor position to align orthogonally with the candidate
              // Use current snapped position as base, but override the locked axis
              let snappedX = x;
              let snappedY = y;

              if (bestIsHorizontalHint) {
                // Horizontal hint: snap Y to candidate's Y (cursor moves to align horizontally)
                snappedY = bestCand.y;
                // X uses the snapped grid position
              } else {
                // Vertical hint: snap X to candidate's X (cursor moves to align vertically)
                snappedX = bestCand.x;
                // Y uses the snapped grid position
              }

              connectionHint = {
                lockedPt: { x: snappedX, y: snappedY },  // Lock snapped position
                targetPt: bestCand,   // The candidate point to show hint line to
                wasOrthoActive: orthoMode || isShift,
                lockAxis: bestIsHorizontalHint ? 'y' : 'x'  // Which axis was snapped
              };

            }
          }
        } // end if(trackingMode)

        // Apply connection hint lock (but still respect ortho constraint)
        if (connectionHint) {
          // Keep cursor at the snapped position
          x = connectionHint.lockedPt.x;
          y = connectionHint.lockedPt.y;

          // Re-apply ortho constraint to ensure we stay orthogonal
          if (forceOrtho) {
            if (dx >= dy) {
              // Moving horizontally: Y must stay locked to last.y
              y = last.y;
            } else {
              // Moving vertically: X must stay locked to last.x
              x = last.x;
            }
          }

          // Temporarily enable ortho if not already active
          if (!connectionHint.wasOrthoActive && !shiftOrthoVisualActive) {
            shiftOrthoVisualActive = true;
            if (updateOrthoButtonVisual) updateOrthoButtonVisual();
          }
        }
        // Note: Standard ortho was already applied earlier (before hint detection)
      }
      drawing.cursor = { x, y };
      renderDrawing();
      renderConnectionHint();
    } else {
      drawing.cursor = null;
      connectionHint = null; // clear hint when not drawing
      renderConnectionHint(); // clear visual hint
      // Clear shift visual if active
      if (shiftOrthoVisualActive) {
        shiftOrthoVisualActive = false;
        if (updateOrthoButtonVisual) updateOrthoButtonVisual();
      }
    }
    if (mode === 'place' && placeType) {
      renderGhostAt({ x, y }, placeType);
    } else {
      clearGhost();
    }

    // Update coordinate display and input boxes when placing wire, components, or moving
    const firstSel = getFirstSelection();
    if (mode === 'wire' || mode === 'place' || mode === 'place-junction' || mode === 'delete-junction' || (mode === 'move' && firstSel && firstSel.kind === 'component')) {
      // For move mode, show component's current position
      if (mode === 'move' && firstSel && firstSel.kind === 'component') {
        const comp = components.find(c => c.id === firstSel.id);
        if (comp) {
          updateCoordinateDisplay(comp.x, comp.y);
          updateCoordinateInputs(comp.x, comp.y);
        }
      } else {
        updateCoordinateDisplay(x, y);
        updateCoordinateInputs(x, y);
      }
      showCoordinateInputs();
      
      // Show polar inputs only when actively drawing a wire (after first point)
      if (mode === 'wire' && drawing.active && drawing.points.length > 0) {
        updatePolarInputs(x, y);
        showPolarInputs();
      } else {
        hidePolarInputs();
      }
    } else {
      hideCoordinateDisplay();
      hideCoordinateInputs();
      hidePolarInputs();
    }

    // crosshair overlay while in wire mode, place mode, select mode, move mode, delete mode, or junction modes
    // Use raw mouse position (p) for crosshair, not snapped position (x, y)
    if (mode === 'wire' || mode === 'place' || mode === 'select' || mode === 'move' || mode === 'delete' || mode === 'place-junction' || mode === 'delete-junction') { 
      renderCrosshair(p.x, p.y); 
    } else { 
      clearCrosshair(); 
    }
  });

  svg.addEventListener('pointerup', (e) => {
    // Finish free endpoint stretch if active
    if (endpointStretchState && endpointStretchState.dragging) {
      const w = endpointStretchState.wire;
      
      // Remove the temporary drag dot
      gDrawing.querySelectorAll('[data-endpoint-drag-dot]').forEach(el => el.remove());
      
      // Check if wire became too short (< 5 pixels) - if so, delete it
      const len = Math.hypot(w.points[1].x - w.points[0].x, w.points[1].y - w.points[0].y);
      if (len < 5) {
        wires = wires.filter(wire => wire.id !== w.id);
        clearSelection();
      }
      
      // Normalize and clean up
      normalizeAllWires();
      unifyInlineWires();
      rebuildTopology();
      redraw();
      
      endpointStretchState = null;
      return;
    }
    
    // Finish wire stretch if active
    if (wireStretchState) {
      if (wireStretchState.dragging) {
        // Don't remove any existing wires - let unifyInlineWires handle merging
        const w = wireStretchState.wire;
        const newP0 = w.points[0];
        const newP1 = w.points[w.points.length - 1];
        const isHoriz = Math.abs(newP0.y - newP1.y) < 1;
        const isVert = Math.abs(newP0.x - newP1.x) < 1;
        
        // Update or create connecting wires from ghost wires
        const newWireIds: string[] = [];
        
        // First, update any connecting wires we created on a previous drag
        wireStretchState.createdConnectingWireIds.forEach(wireId => {
          const existingWire = wires.find(w => w.id === wireId);
          if (existingWire && wireStretchState.ghostConnectingWires.length > 0) {
            // Update the existing connecting wire with new coordinates
            const ghost = wireStretchState.ghostConnectingWires[0]; // Use first ghost
            existingWire.points[0] = { x: ghost.from.x, y: ghost.from.y };
            existingWire.points[1] = { x: ghost.to.x, y: ghost.to.y };
            newWireIds.push(wireId);
            wireStretchState.ghostConnectingWires.shift(); // Remove this ghost, we handled it
          }
        });
        
        // Create new wires for any remaining ghosts
        wireStretchState.ghostConnectingWires.forEach(ghost => {
          // Only create if the wire has meaningful length (> 5 pixels to avoid tiny stubs)
          const dist = Math.hypot(ghost.to.x - ghost.from.x, ghost.to.y - ghost.from.y);
          if (dist > 5) {
            const newWire: Wire = {
              id: State.uid('wire'),
              points: [
                { x: ghost.from.x, y: ghost.from.y },
                { x: ghost.to.x, y: ghost.to.y }
              ],
              color: wireStretchState.wire.color || defaultWireColor,
              netId: wireStretchState.wire.netId // Inherit netId from the wire being stretched
            };
            wires.push(newWire);
            newWireIds.push(newWire.id);
          }
        });
        
        // Remember which wires we created/updated for next time
        wireStretchState.createdConnectingWireIds = newWireIds;

        
        // Normalize and clean up wire geometry
        normalizeAllWires();
        
        // Remove very short wires (< 5 pixels) that may have been created or shrunk during stretch
        const wiresBefore = wires.length;
        wires = wires.filter(w => {
          if (w.points.length < 2) return false;
          const p0 = w.points[0];
          const p1 = w.points[w.points.length - 1];
          const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
          return len >= 5;
        });
        
        // Unify inline wire segments to collapse collinear wires
        // This will merge the connecting wires back into the main wire if they're aligned
        unifyInlineWires();
        
        // Rebuild topology and redraw
        rebuildTopology();
        redraw();
      }
      wireStretchState = null; // Clear state before renderDrawing so ghosts don't re-render
      renderDrawing(); // Clear ghost wires from drawing layer
      return;
    }
    
    // Finish marquee selection if active; otherwise just end any pan
    if (marquee.active) { finishMarquee(); }
    endPan();
  });
  svg.addEventListener('pointerleave', (e) => { endPan(); });
  // Ensure middle-click doesn't trigger browser autoscroll and supports pan in all browsers
  svg.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); beginPan(e); } });
  svg.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); } });
  // Suppress native context menu while finishing wire with right-click
  // Suppress native context menu right after a right-click wire finish
  svg.addEventListener('contextmenu', (e) => {
    if ((mode === 'wire' && drawing.active) || suppressNextContextMenu) {
      e.preventDefault();
      suppressNextContextMenu = false; // one-shot
    }
  });
  // Zoom on wheel, centered on mouse location (keeps mouse position stable in view)
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const scale = (e.deltaY < 0) ? 1.1 : (1 / 1.1);
    const oldZoom = zoom;
    const newZoom = clamp(oldZoom * scale, 0.25, 10);
    if (newZoom === oldZoom) return;
    // focal point in svg coords
    const fp = svgPoint(e);
    // Use current/effective view sizes to avoid jumps on non-16:10 canvases
    const oldW = viewW, oldH = viewH;
    const vw = Math.max(1, svg.clientWidth), vh = Math.max(1, svg.clientHeight);
    const aspect = vw / vh;
    const newW = (BASE_W / newZoom);
    const newH = newW / aspect;
    viewX = fp.x - (fp.x - viewX) * (newW / oldW);
    viewY = fp.y - (fp.y - viewY) * (newH / oldH);
    zoom = newZoom;
    applyZoom();
  }, { passive: false });

  // Initialize constraint system
  initConstraintSystem();

  window.addEventListener('keydown', (e) => {
    // Block ALL app shortcuts while the user is editing a field in the Inspector (or any editable).
    if (isEditingKeystrokesTarget(e)) {
      // Also suppress the browser's default Ctrl+S / Ctrl+K while typing, but do nothing app-side.
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'k')) e.preventDefault();
      return;
    }

    // Undo/Redo shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((k === 'y') || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
        return;
      }
    }
    if (e.key === 'Escape') {
      // If endpoint stretch is active, cancel it
      if (endpointStretchState && endpointStretchState.dragging) {
        // Restore original points
        const w = endpointStretchState.wire;
        w.points = endpointStretchState.originalPoints.map(pt => ({ x: pt.x, y: pt.y }));
        updateWireDOM(w);
        endpointStretchState = null;
        redraw();
        return;
      }
      // If a drawing is in progress, cancel it first
      if (drawing.active) {
        drawing.active = false; drawing.points = []; gDrawing.replaceChildren();
        connectionHint = null;
        renderConnectionHint(); // clear hint visual
        if (shiftOrthoVisualActive) {
          shiftOrthoVisualActive = false;
          if (updateOrthoButtonVisual) updateOrthoButtonVisual();
        }
        return;
      }
      // If any non-none mode is active (wire/delete/pan/move/select), pressing
      // Escape should deactivate the active button and enter 'none'. This
      // mirrors typical toolbar behavior and ensures Escape clears modes other
      // than just Select.
      if (mode !== 'none') {
        setMode('none');
        return;
      }
      // If already in 'none', fallback to clearing selection if present.
      const firstSel = getFirstSelection();
      if (firstSel && (firstSel.kind === 'component' || firstSel.kind === 'wire')) {
        clearSelection();
        renderInspector(); redraw();
      }
    }
    if (e.key === 'Enter' && mode === 'move') { 
      e.preventDefault();
      setMode('select'); 
      return;
    }
    if (e.key === 'Enter' && drawing.active) { finishWire(); }
    if (e.key === 'Enter' && (mode === 'place-junction' || mode === 'delete-junction')) { setMode('select'); }
    if (e.key.toLowerCase() === 'w') { setMode('wire'); }
    if (e.key.toLowerCase() === 'v') { setMode('select'); }
    if (e.key.toLowerCase() === 'p') { setMode('pan'); }
    if (e.key.toLowerCase() === 'm') { setMode('move'); }
    if (e.key.toLowerCase() === 'r') {
      rotateSelected();
    }
    if (e.key === 'Delete') {
      const delSel = getFirstSelection();
      if (delSel && delSel.kind === 'component') { removeComponent(delSel.id); }
      if (delSel && delSel.kind === 'wire') {
        // Per-segment model: each segment is its own Wire object. Delete the selected segment wire.
        const w = wires.find(x => x.id === delSel.id);
        if (w) {
          removeJunctionsAtWireEndpoints(w);
          pushUndo();
          wires = wires.filter(x => x.id !== w.id);
          clearSelection();
          normalizeAllWires();
          unifyInlineWires();
          redraw();
          // Force immediate visual update
          requestAnimationFrame(() => redrawCanvasOnly());
        }
      }
    }
    // Arrow-key move when component, label, or value is selected
    const arrowSel = getFirstSelection();
    if (arrowSel && (arrowSel.kind === 'component' || arrowSel.kind === 'label' || arrowSel.kind === 'value') && e.key.startsWith('Arrow')) {
      // If in Select mode, automatically switch to Move mode
      if (mode === 'select') {
        setMode('move');
        // Show coordinate inputs immediately after switching to Move mode (only for components)
        if (arrowSel.kind === 'component') {
          const comp = components.find(c => c.id === arrowSel.id);
          if (comp) {
            updateCoordinateDisplay(comp.x, comp.y);
            updateCoordinateInputs(comp.x, comp.y);
            showCoordinateInputs();
          }
        }
      }
      
      // Calculate step size:
      // - No modifiers: 250 mils (GRID = 25 px)
      // - Shift: 50 mils (GRID / 5 = 5 px)
      // - Shift+Alt: 1 mil (0.1 px)
      let step = GRID; // 250 mils (default)
      if (e.shiftKey && e.altKey) {
        step = 0.1; // 1 mil (finest adjustment)
      } else if (e.shiftKey) {
        step = GRID / 5; // 50 mils (fine adjustment)
      }
      
      let dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      if (e.key === 'ArrowRight') dx = step;
      if (e.key === 'ArrowUp') dy = -step;
      if (e.key === 'ArrowDown') dy = step;
      
      if (dx !== 0 || dy !== 0) { 
        e.preventDefault();
        
        // Move label or value text (update offsets)
        if (arrowSel.kind === 'label' || arrowSel.kind === 'value') {
          pushUndo();
          const comp = components.find(c => c.id === arrowSel.id);
          if (comp) {
            // Transform delta to component's local coordinate system (inverse rotation)
            const radians = -(comp.rot * Math.PI / 180);
            const cos = Math.cos(radians);
            const sin = Math.sin(radians);
            const localDx = dx * cos - dy * sin;
            const localDy = dx * sin + dy * cos;
            
            if (arrowSel.kind === 'label') {
              comp.labelOffsetX = (comp.labelOffsetX || 0) + localDx;
              comp.labelOffsetY = (comp.labelOffsetY || 0) + localDy;
            } else if (arrowSel.kind === 'value') {
              comp.valueOffsetX = (comp.valueOffsetX || 0) + localDx;
              comp.valueOffsetY = (comp.valueOffsetY || 0) + localDy;
            }
            redrawCanvasOnly();
            Rendering.updateSelectionOutline(selection); // Reapply selection highlighting
            renderInspector(); // Update inspector to show new offset values
          }
        } else {
          // Move component
          moveSelectedBy(dx, dy);
          // Update coordinate display and inputs after move
          const comp = components.find(c => c.id === arrowSel.id);
          if (comp) {
            updateCoordinateDisplay(comp.x, comp.y);
            updateCoordinateInputs(comp.x, comp.y);
          }
        }
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveJSON(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); clearAll(); }

    // Coordinate input activation shortcut (Ctrl+L for cartesian, Ctrl+Shift+L for polar when drawing wire)
    const ctrlLSel = getFirstSelection();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l' && (mode === 'wire' || mode === 'place' || mode === 'place-junction' || mode === 'delete-junction' || (mode === 'move' && ctrlLSel && ctrlLSel.kind === 'component'))) {
      e.preventDefault();
      
      // Use polar input if Shift is held and we're actively drawing a wire
      if (e.shiftKey && mode === 'wire' && drawing.active && drawing.points.length > 0 && coordInputLength && polarInputGroup) {
        coordInputActive = true;
        coordInputLength.focus();
        coordInputLength.select();
      } else if (coordInputX && coordInputGroup) {
        coordInputActive = true;
        coordInputX.focus();
        coordInputX.select();
      }
      return;
    }

    // Component placement shortcuts
    if (e.key.toLowerCase() === 'c' && !isEditingKeystrokesTarget(e)) {
      e.preventDefault();
      if (e.altKey) {
        // Alt+C = Polarized Capacitor
        capacitorSubtype = 'polarized';
      } else {
        // C = Standard Capacitor
        capacitorSubtype = 'standard';
      }
      updateCapacitorButtonIcon();
      updateCapacitorSubtypeButtons();
      placeType = 'capacitor';
      setMode('place');
    }

    // Quick debug dump: press 'D' (when not focused on an input) to log anchors/overlays
    if (e.key.toLowerCase() === 'd' && !isEditingKeystrokesTarget(e)) {
      e.preventDefault(); debugDumpAnchors();
    }
  });

  // Decide color for a just-drawn wire if it will merge into an existing straight wire path (Wire/SWP).
  function pickSwpAdoptColorForNewWire(pts) {
    if (!pts || pts.length < 2) return null;

    // Build SWPs from the current canvas BEFORE adding the new wire
    rebuildTopology();

    const axisOf = (a, b) => (a && b && a.y === b.y) ? 'x' : (a && b && a.x === b.x) ? 'y' : null;
    const newAxis = axisOf(pts[0], pts[1]) || axisOf(pts[pts.length - 2], pts[pts.length - 1]) || null;

    function colorAtEndpoint(p) {
      // Look for an existing wire endpoint we are snapping to
      const hit = findWireEndpointNear(p, 0.9);
      if (!hit) return null;

      // Which segment touches that endpoint? (start -> seg 0, end -> seg n-2)
      const segIdx = (hit.endIndex === 0) ? 0 : (hit.w.points.length - 2);

      // If that segment belongs to a Wire (SWP), use its color; else fallback to that wire's color
      const swp = swpForWireSegment(hit.w.id, segIdx);
      if (swp) return { color: swp.color, axis: axisAtEndpoint(hit.w, hit.endIndex) };

      return { color: hit.w.color || defaultWireColor, axis: axisAtEndpoint(hit.w, hit.endIndex) };
    }

    const startInfo = colorAtEndpoint(pts[0]);
    const endInfo = colorAtEndpoint(pts[pts.length - 1]);

    // Prefer endpoint whose axis matches the new wire's axis (i.e., will merge inline)
    if (newAxis) {
      if (startInfo && startInfo.axis === newAxis) return startInfo.color;
      if (endInfo && endInfo.axis === newAxis) return endInfo.color;
    }

    // Otherwise: prefer start, else end
    if (startInfo) return startInfo.color;
    if (endInfo) return endInfo.color;

    return null;
  }

  // --- Helpers to color only the colinear segment(s) that join an existing Wire (SWP) ---

  // Split a polyline into contiguous runs of same "axis":
  // 'x' = horizontal, 'y' = vertical, null = angled (non-axis-aligned)
  function splitPolylineIntoRuns(pts) {
    const runs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const axis = (a && b && a.y === b.y) ? 'x' : (a && b && a.x === b.x) ? 'y' : null;
      if (!runs.length || runs[runs.length - 1].axis !== axis) {
        runs.push({ start: i, end: i, axis });
      } else {
        runs[runs.length - 1].end = i;
      }
    }
    return runs;
  }

  // If the given endpoint 'pt' is snapping onto an existing Wire (SWP) endpoint
  // and the segment axis matches that SWP, return that SWP's color; else null.
  function adoptColorAtEndpointForAxis(pt: Point, axis: Axis): string | null {
    if (!axis) return null;                 // only axis-aligned runs can be part of an SWP
    rebuildTopology();                     // inspect current canvas BEFORE adding new pieces
    const hit = findWireEndpointNear(pt, 0.9);
    if (!hit) return null;

    // Require colinearity at the touched endpoint
    const hitAxis = axisAtEndpoint(hit.w, hit.endIndex);
    if (hitAxis !== axis) return null;

    // Get the SWP at that existing segment
    const segIdx = (hit.endIndex === 0) ? 0 : (hit.w.points.length - 2);
    const swp = swpForWireSegment(hit.w.id, segIdx);
    if (!swp) return null;                 // only adopt if it truly becomes part of that SWP

    return swp.color || defaultWireColor;
  }

  function strokeOfWire(w: Wire): Stroke {
    ensureStroke(w);
    return { width: w.stroke!.width, type: w.stroke!.type, color: w.stroke!.color };
  }

  // If an endpoint joins colinear to an existing SWP, inherit that wire's *stroke*.
  function adoptStrokeAtEndpointForAxis(pt: Point, axis: Axis): Stroke | null {
    if (!axis) return null;
    rebuildTopology();
    const hit = findWireEndpointNear(pt, 0.9);
    if (!hit) return null;
    const hitAxis = axisAtEndpoint(hit.w, hit.endIndex);
    if (hitAxis !== axis) return null;
    const segIdx = (hit.endIndex === 0) ? 0 : (hit.w.points.length - 2);
    const swp = swpForWireSegment(hit.w.id, segIdx);
    if (!swp) return null;
    return strokeOfWire(hit.w);
  }

  // Emit the new polyline as multiple wires:
  // - each axis-aligned run becomes one wire
  // - only the run that attaches *colinear* to an existing SWP adopts that SWP's color
  // - bends (non-axis) are emitted as their own wires with the current toolbar color
  // - UNLESS Manhattan routing is enabled, in which case keep as single polyline
  function emitRunsFromPolyline(pts) {
    const curCol = resolveWireColor(currentWireColorMode);
    
    // When Manhattan routing is enabled, emit as single polyline wire to avoid junctions at bends
    if (USE_MANHATTAN_ROUTING && pts.length >= 2) {
      const tool = strokeForNewWires();
      const stroke: Stroke = tool
        ? { width: tool.width, type: tool.type, color: tool.color }
        : { width: 0, type: 'default', color: cssToRGBA01(curCol) };
      
      const css = rgba01ToCss(stroke.color);
      const netId = activeNetClass;
      
      // Create single wire with all points (polyline)
      wires.push({ 
        id: State.uid('wire'), 
        points: pts.map(p => ({ x: p.x, y: p.y })), 
        color: css, 
        stroke: { ...stroke, color: { ...stroke.color } }, 
        netId 
      });
      return;
    }
    
    // Original behavior: split into runs
    const runs = splitPolylineIntoRuns(pts);

    for (const run of runs) {
      const subPts = pts.slice(run.start, run.end + 2); // include end+1 vertex
      // default/fallback stroke: use toolbar's explicit stroke when not using netclass; otherwise palette color only
      const tool = strokeForNewWires();
      let stroke: Stroke = tool
        ? { width: tool.width, type: tool.type, color: tool.color }
        : { width: 0, type: 'default', color: cssToRGBA01(curCol) };

      // Try to adopt stroke from colinear attachment at the start or end (only one end should match)
      if (run.start === 0) {
        const ad = adoptStrokeAtEndpointForAxis(subPts[0], run.axis);
        if (ad) stroke = ad;
      }
      if (run.end === pts.length - 2 && (!stroke || (stroke.type === 'default' && stroke.width <= 0))) {
        const ad2 = adoptStrokeAtEndpointForAxis(subPts[subPts.length - 1], run.axis);
        if (ad2) stroke = ad2;
      }

      // Keep legacy color alongside stroke for back-compat & SWP heuristics
      const css = rgba01ToCss(stroke.color);
      // Emit as per-segment wires: one 2-point Wire per adjacent pair
      for (let i = 0; i < subPts.length - 1; i++) {
        const segmentPts = [subPts[i], subPts[i + 1]];
        // clone stroke so each segment can be edited independently
        const segStroke = stroke ? { ...stroke, color: { ...stroke.color } } : undefined;
        // Always assign to activeNetClass (net assignment independent of custom properties)
        const netId = activeNetClass;
        wires.push({ id: State.uid('wire'), points: segmentPts, color: rgba01ToCss(segStroke ? segStroke.color : cssToRGBA01(curCol)), stroke: segStroke, netId });
      }
    }
  }

  function finishWire() {
    // Commit only if we have at least one segment
    if (drawing.points.length >= 2) {
      // De-dup consecutive identical points to avoid zero-length segments
      const pts = [];
      for (const p of drawing.points) {
        if (!pts.length || pts[pts.length - 1].x !== p.x || pts[pts.length - 1].y !== p.y) pts.push({ x: p.x, y: p.y });
      }
      
      // Filter out short segments caused by accidental mouse movements.
      // For Manhattan routing, we need to be more careful to preserve orthogonality
      // while removing tiny segments from mouse jitter.
      const MIN_SEGMENT_LENGTH = 15; // Increased threshold for better filtering
      
      if (pts.length >= 2) {
        const filtered = [pts[0]]; // Always keep the first point
        
        for (let i = 1; i < pts.length; i++) {
          const last = filtered[filtered.length - 1];
          const curr = pts[i];
          const dx = curr.x - last.x;
          const dy = curr.y - last.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          
          // For intermediate points: only keep if segment is long enough
          if (i < pts.length - 1) {
            if (len >= MIN_SEGMENT_LENGTH) {
              filtered.push(curr);
            }
          } else {
            // Last point: keep if it's far enough OR if we only have one segment total
            if (len >= MIN_SEGMENT_LENGTH || filtered.length === 1) {
              filtered.push(curr);
            }
            // If last segment is too short and we have multiple segments, drop it
          }
        }
        
        pts.length = 0;
        pts.push(...filtered);
      }
      
      if (pts.length >= 2) {
        pushUndo();
        // Emit per-run so only truly colinear joins adopt an existing Wire's color.
        // Bends (non-axis runs) stay with the current toolbar color.
        emitRunsFromPolyline(pts);

        // Post-process: if user placed components while wire was in limbo,
        // split this newly added wire wherever pins land, and remove any inner bridge.
        // (Safe for all components; non-intersecting pins are ignored by the splitter.)
        const comps = components.slice();
        for (const c of comps) {
          const didBreak = breakWiresForComponent(c);
          if (didBreak) deleteBridgeBetweenPins(c);
        }
        // Stitch end-to-end collinear runs back into the original wire path
        normalizeAllWires();
        unifyInlineWires();
      }
    }
    // Reset drawing state and visuals
    drawing.active = false;
    drawing.points = [];
    drawing.cursor = null;
    connectionHint = null;
    renderConnectionHint(); // clear hint visual
    if (shiftOrthoVisualActive) {
      shiftOrthoVisualActive = false;
      if (updateOrthoButtonVisual) updateOrthoButtonVisual();
    }
    gDrawing.replaceChildren();
    clearCrosshair();
    redraw();
  }

  function renderDrawing() {
    gDrawing.replaceChildren();
    
    // Render ghost connecting wires during wire stretch operation (before early return)
    if (wireStretchState && wireStretchState.dragging && wireStretchState.ghostConnectingWires.length > 0) {
      const wireColor = wireStretchState.wire.color || defaultWireColor;
      wireStretchState.ghostConnectingWires.forEach(ghost => {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('stroke', wireColor);
        line.setAttribute('stroke-width', '1');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('pointer-events', 'none');
        setAttr(line, 'x1', ghost.from.x);
        setAttr(line, 'y1', ghost.from.y);
        setAttr(line, 'x2', ghost.to.x);
        setAttr(line, 'y2', ghost.to.y);
        gDrawing.appendChild(line);
      });
    }
    
    // Render ghost connecting wires during lateral component drag (before early return)
    if (componentDragState && componentDragState.ghostWires.length > 0) {
      const wireColor = moveCollapseCtx?.color || defaultWireColor;
      componentDragState.ghostWires.forEach((ghost, idx) => {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('stroke', wireColor);
        line.setAttribute('stroke-width', '1');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('pointer-events', 'none');
        line.setAttribute('opacity', '0.8');
        setAttr(line, 'x1', ghost.from.x);
        setAttr(line, 'y1', ghost.from.y);
        setAttr(line, 'x2', ghost.to.x);
        setAttr(line, 'y2', ghost.to.y);
        gDrawing.appendChild(line);
      });
    }
    
    if (!drawing.active) return;
    
    // For Manhattan routing, start with just the placed points (no cursor preview by default)
    // We'll add orthogonal preview segments below based on cursor position
    let pts = USE_MANHATTAN_ROUTING ? drawing.points : (drawing.cursor ? [...drawing.points, drawing.cursor] : drawing.points);

    // KiCad-style Manhattan routing: If enabled, show Manhattan path preview for current segment
    // This takes precedence over simple ortho constraint
    if (USE_MANHATTAN_ROUTING && drawing.cursor && drawing.points.length >= 1) {
      const cursor = drawing.cursor;
      const lastPlaced = drawing.points[drawing.points.length - 1];
      
      // Skip preview if cursor is at the same position as the last placed point
      // This prevents duplicate overlapping segments after a click
      const cursorAtLastPoint = Math.abs(cursor.x - lastPlaced.x) < 0.1 && 
                                Math.abs(cursor.y - lastPlaced.y) < 0.1;
      
      if (cursorAtLastPoint) {
        pts = drawing.points; // Just show the placed points, no preview
      } else {
        // Check for backtracking: if we have at least 2 placed points and the cursor
        // has moved back past the last placed point, remove that point from preview
        let effectivePoints = [...drawing.points];
      
      if (effectivePoints.length >= 2) {
        const prevPoint = effectivePoints[effectivePoints.length - 2];
        const lastPoint = effectivePoints[effectivePoints.length - 1];
        
        // Determine if last segment was horizontal or vertical
        const lastDx = Math.abs(lastPoint.x - prevPoint.x);
        const lastDy = Math.abs(lastPoint.y - prevPoint.y);
        
        if (lastDx > 0.5 && lastDy < 0.5) {
          // Last segment was horizontal
          // Check if cursor has backtracked past prevPoint on X axis
          const movedRight = lastPoint.x > prevPoint.x;
          const cursorBacktracked = movedRight 
            ? cursor.x < prevPoint.x 
            : cursor.x > prevPoint.x;
          
          if (cursorBacktracked) {
            effectivePoints.pop(); // Remove the last point that we've backtracked past
          }
        } else if (lastDy > 0.5 && lastDx < 0.5) {
          // Last segment was vertical
          // Check if cursor has backtracked past prevPoint on Y axis
          const movedDown = lastPoint.y > prevPoint.y;
          const cursorBacktracked = movedDown 
            ? cursor.y < prevPoint.y 
            : cursor.y > prevPoint.y;
          
          if (cursorBacktracked) {
            effectivePoints.pop(); // Remove the last point that we've backtracked past
          }
        }
      }
      
      const start = effectivePoints[effectivePoints.length - 1]; // Last effective point
      const end = cursor;
      
      // Check if segment would be diagonal
      const dx = Math.abs(end.x - start.x);
      const dy = Math.abs(end.y - start.y);
      const minDistance = 0.5; // Minimum distance to consider for direction
      
      // If both dimensions are significant, show Manhattan path
      if (dx > minDistance && dy > minDistance) {
        // Determine mode based on connection hint if active, otherwise use distance
        let mode: 'HV' | 'VH';
        if (connectionHint) {
          // Connection hint is active - respect the locked axis
          // If Y is locked (horizontal hint), we must move horizontally first
          // If X is locked (vertical hint), we must move vertically first
          mode = connectionHint.lockAxis === 'y' ? 'HV' : 'VH';
        } else {
          // No hint - use normal distance-based logic
          mode = dx >= dy ? 'HV' : 'VH';
        }
        const manhattanPts = manhattanPath(start, end, mode);
        pts = [...effectivePoints, ...manhattanPts.slice(1)];
      } else if (dx > minDistance || dy > minDistance) {
        // One dimension is dominant - show orthogonal line (snap to axis)
        if (dx >= dy) {
          // Horizontal movement dominant
          pts = [...effectivePoints, { x: end.x, y: start.y }];
        } else {
          // Vertical movement dominant
          pts = [...effectivePoints, { x: start.x, y: end.y }];
        }
      } else {
        // If both dimensions are too small, just show the effective points
        pts = effectivePoints;
      }
      } // end of else block for cursorAtLastPoint check
    } else if (drawing.cursor && drawing.points.length > 0 && (orthoMode || globalShiftDown) && !USE_MANHATTAN_ROUTING) {
      // Simple ortho constraint (only when Manhattan routing is disabled)
      // This prevents any non-orthogonal lines from flickering during rendering
      const last = drawing.points[drawing.points.length - 1];
      const cursor = drawing.cursor;
      const dx = Math.abs(cursor.x - last.x);
      const dy = Math.abs(cursor.y - last.y);
      let constrainedCursor = { ...cursor };
      if (dx >= dy) {
        constrainedCursor.y = last.y; // horizontal
      } else {
        constrainedCursor.x = last.x; // vertical
      }
      pts = [...drawing.points, constrainedCursor];
    }

    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    const drawColor = resolveWireColor(currentWireColorMode);
    pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', drawColor); pl.setAttribute('stroke-width', '1'); pl.setAttribute('stroke-linecap', 'round'); pl.setAttribute('stroke-linejoin', 'round');
    pl.setAttribute('marker-start', 'url(#dot)');
    pl.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
    gDrawing.appendChild(pl);

    // Draw temporary junction dots where the in-progress wire crosses existing wires
    if (pts.length >= 2 && showJunctionDots) {
      const segments: Array<{ a: Point, b: Point }> = [];
      for (let i = 0; i < pts.length - 1; i++) {
        segments.push({ a: pts[i], b: pts[i + 1] });
      }

      // Check intersections with existing wires
      for (const w of wires) {
        for (let i = 0; i < w.points.length - 1; i++) {
          const wa = w.points[i];
          const wb = w.points[i + 1];

          for (const seg of segments) {
            // Check for intersection
            let intersection: Point | null = null;
            if (seg.a.x === seg.b.x && wa.y === wb.y) {
              // drawing segment vertical, wire horizontal
              const x = seg.a.x;
              const y = wa.y;
              if (Math.min(seg.a.y, seg.b.y) <= y && y <= Math.max(seg.a.y, seg.b.y) &&
                Math.min(wa.x, wb.x) <= x && x <= Math.max(wa.x, wb.x)) {
                intersection = { x, y };
              }
            } else if (seg.a.y === seg.b.y && wa.x === wb.x) {
              // drawing segment horizontal, wire vertical
              const x = wa.x;
              const y = seg.a.y;
              if (Math.min(seg.a.x, seg.b.x) <= x && x <= Math.max(seg.a.x, seg.b.x) &&
                Math.min(wa.y, wb.y) <= y && y <= Math.max(wa.y, wb.y)) {
                intersection = { x, y };
              }
            }

            if (intersection) {
              const sizeMils = junctionCustomSize !== null ? junctionCustomSize :
                              (junctionDotSize === 'smallest' ? 15 : junctionDotSize === 'small' ? 30 : junctionDotSize === 'default' ? 40 : junctionDotSize === 'large' ? 50 : 65);
              const diameterMm = sizeMils * 0.0254;
              const radiusMm = diameterMm / 2;
              const radiusPx = Math.max(1, radiusMm * (100 / 25.4));

              const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
              setAttr(dot, 'cx', intersection.x);
              setAttr(dot, 'cy', intersection.y);
              setAttr(dot, 'r', radiusPx);
              dot.setAttribute('fill', drawColor);
              dot.setAttribute('stroke', 'var(--bg)');
              dot.setAttribute('stroke-width', '1');
              gDrawing.appendChild(dot);
            }
          }
        }
      }
    }

    // keep endpoint marker in sync with in-progress color
    const dot = document.querySelector('#dot circle');
    if (dot) dot.setAttribute('fill', drawColor);

  }

  // Render connection hint in overlay layer (above crosshair for visibility)
  function renderConnectionHint() {
    // Remove any existing hint
    $qa<SVGElement>('[data-hint]', gOverlay).forEach(el => el.remove());

    if (connectionHint && drawing.active && drawing.points.length > 0) {
      const hintLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hintLine.setAttribute('data-hint', '1');
      hintLine.setAttribute('stroke', '#00ff00'); // bright green

      // Use constant stroke width in SVG units for consistent appearance
      const scale = svg.clientWidth / Math.max(1, viewW);
      const strokeWidth = 2; // 2 SVG units (constant visual width)
      const dashLength = 10; // 10 SVG units for dashes
      const dashGap = 5; // 5 SVG units for gaps

      hintLine.setAttribute('stroke-width', String(strokeWidth));
      hintLine.setAttribute('stroke-dasharray', `${dashLength},${dashGap}`);
      hintLine.setAttribute('stroke-linecap', 'round');
      hintLine.setAttribute('pointer-events', 'none');
      hintLine.setAttribute('opacity', '1');

      // Draw from the current cursor position to the target point
      // The cursor has been snapped to align orthogonally with the target
      hintLine.setAttribute('x1', String(drawing.cursor.x));
      hintLine.setAttribute('y1', String(drawing.cursor.y));
      hintLine.setAttribute('x2', String(connectionHint.targetPt.x));
      hintLine.setAttribute('y2', String(connectionHint.targetPt.y));

      gOverlay.appendChild(hintLine);
    }
  }

  // ----- Crosshair overlay -----
  function clearCrosshair() {
    // Only remove the crosshair lines, not the marquee rect
    $qa<SVGElement>('[data-crosshair]', gOverlay).forEach(el => el.remove());
  }
  function renderCrosshair(x, y) {
    clearCrosshair(); // remove previous crosshair lines, keep marquee intact

    const hline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const vline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hline.setAttribute('data-crosshair', '1');
    vline.setAttribute('data-crosshair', '1');

    if (crosshairMode === 'short') {
      // Short crosshair: 40 pixels in each direction, light gray solid line
      const halfLenPixels = 40;
      const scale = svg.clientWidth / Math.max(1, viewW);
      const halfLen = halfLenPixels / scale; // Convert to SVG user coordinates
      const strokeWidth = 1; // 1 SVG unit (constant visual width)
      const xL = x - halfLen, xR = x + halfLen;
      const yT = y - halfLen, yB = y + halfLen;
      setAttr(hline, 'x1', xL); setAttr(hline, 'y1', y);
      setAttr(hline, 'x2', xR); setAttr(hline, 'y2', y);
      setAttr(vline, 'x1', x); setAttr(vline, 'y1', yT);
      setAttr(vline, 'x2', x); setAttr(vline, 'y2', yB);
      hline.style.stroke = '#999';  // light gray
      vline.style.stroke = '#999';
      hline.style.strokeWidth = String(strokeWidth);
      vline.style.strokeWidth = String(strokeWidth);
      hline.style.strokeDasharray = 'none';  // solid line
      vline.style.strokeDasharray = 'none';
      hline.style.pointerEvents = 'none';
      vline.style.pointerEvents = 'none';
      hline.style.opacity = '0.4';  // semi-transparent so hints show through
      vline.style.opacity = '0.4';
    } else {
      // Full-screen crosshair: span the visible viewBox, same styling as short
      const scale = svg.clientWidth / Math.max(1, viewW);
      const strokeWidth = 1; // 1 SVG unit (constant visual width, same as short)
      const xL = viewX, xR = viewX + viewW;
      const yT = viewY, yB = viewY + viewH;
      setAttr(hline, 'x1', xL); setAttr(hline, 'y1', y);
      setAttr(hline, 'x2', xR); setAttr(hline, 'y2', y);
      setAttr(vline, 'x1', x); setAttr(vline, 'y1', yT);
      setAttr(vline, 'x2', x); setAttr(vline, 'y2', yB);
      hline.style.stroke = '#999';  // light gray (same as short)
      vline.style.stroke = '#999';
      hline.style.strokeWidth = String(strokeWidth);
      vline.style.strokeWidth = String(strokeWidth);
      hline.style.strokeDasharray = 'none';  // solid line (same as short)
      vline.style.strokeDasharray = 'none';
      hline.style.pointerEvents = 'none';
      vline.style.pointerEvents = 'none';
      hline.style.opacity = '0.4';  // semi-transparent so hints show through (same as short)
      vline.style.opacity = '0.4';
    }

    gOverlay.appendChild(hline); gOverlay.appendChild(vline);
  }

  // ----- Coordinate display -----
  function updateCoordinateDisplay(x: number, y: number) {
    if (!coordDisplay) return;
    // Convert user units (pixels) to nanometers, then to current units
    const xNm = pxToNm(x);
    const yNm = pxToNm(y);
    const xVal = nmToUnit(xNm, globalUnits);
    const yVal = nmToUnit(yNm, globalUnits);

    // Format with appropriate precision based on units
    let precision = 2;
    if (globalUnits === 'mils') precision = 0;
    if (globalUnits === 'mm') precision = 2;
    if (globalUnits === 'in') precision = 4;

    const xStr = xVal.toFixed(precision);
    const yStr = yVal.toFixed(precision);
    
    // If actively drawing a wire and have at least one point, show distance from last point
    let displayText = `${xStr}, ${yStr} ${globalUnits}`;
    if (mode === 'wire' && drawing.active && drawing.points.length > 0) {
      const lastPt = drawing.points[drawing.points.length - 1];
      const dx = x - lastPt.x;
      const dy = y - lastPt.y;
      const distPx = Math.sqrt(dx * dx + dy * dy);
      const distNm = pxToNm(distPx);
      const distVal = nmToUnit(distNm, globalUnits);
      const distStr = distVal.toFixed(precision);
      displayText = `${xStr}, ${yStr} ${globalUnits} · L: ${distStr}`;
    }
    
    coordDisplay.textContent = displayText;
    coordDisplay.style.display = '';
  }

  function hideCoordinateDisplay() {
    if (!coordDisplay) return;
    coordDisplay.style.display = 'none';
  }

  // ----- Coordinate input boxes -----
  let coordInputActive = false;
  let lastMouseX = 0, lastMouseY = 0; // Track last mouse position for input boxes

  function updateCoordinateInputs(x: number, y: number) {
    if (!coordInputX || !coordInputY || !coordInputGroup) return;
    // Store current mouse position
    lastMouseX = x;
    lastMouseY = y;

    // Don't update if user is actively typing
    if (coordInputActive) return;

    // Convert to current units and format
    const xNm = pxToNm(x);
    const yNm = pxToNm(y);
    const xVal = nmToUnit(xNm, globalUnits);
    const yVal = nmToUnit(yNm, globalUnits);

    let precision = 2;
    if (globalUnits === 'mils') precision = 0;
    if (globalUnits === 'mm') precision = 2;
    if (globalUnits === 'in') precision = 4;

    coordInputX.value = xVal.toFixed(precision);
    coordInputY.value = yVal.toFixed(precision);
  }

  function showCoordinateInputs() {
    if (!coordInputGroup) return;
    coordInputGroup.style.display = 'flex';
  }

  function hideCoordinateInputs() {
    if (!coordInputGroup) return;
    coordInputGroup.style.display = 'none';
    coordInputActive = false;
  }

  function acceptCoordinateInput() {
    if (!coordInputX || !coordInputY) return null;

    // Parse X and Y with unit support
    const xParsed = parseDimInput(coordInputX.value, globalUnits);
    const yParsed = parseDimInput(coordInputY.value, globalUnits);

    if (!xParsed || !yParsed) return null;

    // Convert to pixels
    const xPx = nmToPx(xParsed.nm);
    const yPx = nmToPx(yParsed.nm);

    coordInputActive = false;
    coordInputX.blur();
    coordInputY.blur();

    return { x: xPx, y: yPx };
  }

  // Set up coordinate input event handlers
  if (coordInputX && coordInputY) {
    // Handle Tab key to switch between X and Y
    coordInputX.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        coordInputY.focus();
        coordInputY.select();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const point = acceptCoordinateInput();
        if (point) {
          // Simulate a click at the specified coordinate
          handleCoordinateInputClick(point);
        }
      } else if (e.key === 'Escape') {
        coordInputActive = false;
        coordInputX.blur();
        coordInputY.blur();
      }
    });

    coordInputY.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          coordInputX.focus();
          coordInputX.select();
        } else {
          // Tab from Y wraps to X
          coordInputX.focus();
          coordInputX.select();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const point = acceptCoordinateInput();
        if (point) {
          handleCoordinateInputClick(point);
        }
      } else if (e.key === 'Escape') {
        coordInputActive = false;
        coordInputX.blur();
        coordInputY.blur();
      }
    });

    // Mark as active when user focuses
    coordInputX.addEventListener('focus', () => { coordInputActive = true; });
    coordInputY.addEventListener('focus', () => { coordInputActive = true; });

    // When user clicks away or blurs, deactivate
    coordInputX.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== coordInputY) coordInputActive = false;
      }, 100);
    });
    coordInputY.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== coordInputX) coordInputActive = false;
      }, 100);
    });
  }

  // ----- Polar coordinate input (length/angle) -----
  function updatePolarInputs(x: number, y: number) {
    if (!coordInputLength || !coordInputAngle || !polarInputGroup) return;
    
    // Don't update if user is actively typing
    if (coordInputActive) return;
    
    // Only show polar inputs if actively drawing a wire
    if (!drawing.active || drawing.points.length === 0) return;
    
    // Calculate length and angle from last point
    const lastPt = drawing.points[drawing.points.length - 1];
    const dx = x - lastPt.x;
    const dy = y - lastPt.y;
    const lengthPx = Math.sqrt(dx * dx + dy * dy);
    const lengthNm = pxToNm(lengthPx);
    const lengthVal = nmToUnit(lengthNm, globalUnits);
    
    // Calculate angle: 0° = right (+X), 90° = up (-Y in screen coordinates, but we want +Y)
    // Note: screen Y increases downward, so we negate dy for standard math convention
    let angleDeg = Math.atan2(-dy, dx) * (180 / Math.PI);
    if (angleDeg < 0) angleDeg += 360; // Normalize to 0-360
    
    let precision = 2;
    if (globalUnits === 'mils') precision = 0;
    if (globalUnits === 'mm') precision = 2;
    if (globalUnits === 'in') precision = 4;
    
    coordInputLength.value = lengthVal.toFixed(precision);
    coordInputAngle.value = angleDeg.toFixed(1);
  }
  
  function showPolarInputs() {
    if (!polarInputGroup) return;
    polarInputGroup.style.display = 'flex';
  }
  
  function hidePolarInputs() {
    if (!polarInputGroup) return;
    polarInputGroup.style.display = 'none';
    coordInputActive = false;
  }
  
  function acceptPolarInput() {
    if (!coordInputLength || !coordInputAngle || !drawing.active || drawing.points.length === 0) return null;
    
    // Parse length with unit support
    const lengthParsed = parseDimInput(coordInputLength.value, globalUnits);
    if (!lengthParsed) return null;
    
    // Parse angle in degrees
    const angleDeg = parseFloat(coordInputAngle.value);
    if (isNaN(angleDeg)) return null;
    
    // Get last point
    const lastPt = drawing.points[drawing.points.length - 1];
    
    // Convert polar to cartesian
    // Angle: 0° = right (+X), 90° = up (-Y in screen coords)
    const angleRad = angleDeg * (Math.PI / 180);
    const lengthPx = nmToPx(lengthParsed.nm);
    const dx = lengthPx * Math.cos(angleRad);
    const dy = -lengthPx * Math.sin(angleRad); // Negative because screen Y goes down
    
    const x = lastPt.x + dx;
    const y = lastPt.y + dy;
    
    coordInputActive = false;
    coordInputLength.blur();
    coordInputAngle.blur();
    
    return { x, y };
  }
  
  // Set up polar coordinate input event handlers
  if (coordInputLength && coordInputAngle) {
    coordInputLength.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        coordInputAngle.focus();
        coordInputAngle.select();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const point = acceptPolarInput();
        if (point) {
          handleCoordinateInputClick(point);
        }
      } else if (e.key === 'Escape') {
        coordInputActive = false;
        coordInputLength.blur();
        coordInputAngle.blur();
      }
    });
    
    coordInputAngle.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          coordInputLength.focus();
          coordInputLength.select();
        } else {
          coordInputLength.focus();
          coordInputLength.select();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const point = acceptPolarInput();
        if (point) {
          handleCoordinateInputClick(point);
        }
      } else if (e.key === 'Escape') {
        coordInputActive = false;
        coordInputLength.blur();
        coordInputAngle.blur();
      }
    });
    
    coordInputLength.addEventListener('focus', () => { coordInputActive = true; });
    coordInputAngle.addEventListener('focus', () => { coordInputActive = true; });
    
    coordInputLength.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== coordInputAngle) coordInputActive = false;
      }, 100);
    });
    coordInputAngle.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== coordInputLength) coordInputActive = false;
      }, 100);
    });
  }

  // Handle coordinate input click - place component or add wire point
  function handleCoordinateInputClick(point: { x: number, y: number }) {
    // Use exact coordinates as entered - no snapping for keyed-in values
    const x = point.x;
    const y = point.y;
    const snapPt = { x, y };

    const coordSel = getFirstSelection();
    if (mode === 'move' && coordSel && coordSel.kind === 'component') {
      // Move selected component to typed coordinates
      const comp = components.find(c => c.id === coordSel.id);
      if (comp) {
        if (!overlapsAnyOtherAt(comp, snapPt.x, snapPt.y) && !pinsCoincideAnyAt(comp, snapPt.x, snapPt.y)) {
          pushUndo();
          comp.x = snapPt.x;
          comp.y = snapPt.y;
          breakWiresForComponent(comp);
          deleteBridgeBetweenPins(comp);
          rebuildTopology();
          redraw();
          updateCoordinateInputs(comp.x, comp.y);
        }
      }
    } else if (mode === 'wire') {
      if (!drawing.active) {
        // Start wire at typed coordinate
        drawing.active = true;
        drawing.points = [snapPt];
        connectionHint = null;
        renderDrawing();
      } else {
        // Add point to active wire
        drawing.points.push(snapPt);
        rebuildTopology();
        renderDrawing();
      }
      updateCoordinateInputs(snapPt.x, snapPt.y);
    } else if (mode === 'place' && placeType) {
      // Place component at typed coordinate
      const id = State.uid(placeType);
      const labelPrefix = { resistor: 'R', capacitor: 'C', inductor: 'L', diode: 'D', npn: 'Q', pnp: 'Q', ground: 'GND', battery: 'BT', ac: 'AC' }[placeType] || 'X';
      const comp: Component = {
        id, type: placeType, x: snapPt.x, y: snapPt.y, rot: 0, label: `${labelPrefix}${counters[placeType] - 1}`, value: '',
        props: {}
      };
      if (placeType === 'diode') {
        (comp.props as Component['props']).subtype = diodeSubtype as DiodeSubtype;
      }
      if (placeType === 'resistor') {
        (comp.props as Component['props']).resistorStyle = defaultResistorStyle;
      }
      if (placeType === 'capacitor') {
        (comp.props as Component['props']).capacitorSubtype = capacitorSubtype;
        if (capacitorSubtype === 'polarized') {
          (comp.props as Component['props']).capacitorStyle = defaultResistorStyle;
        }
      }
      components.push(comp);
      breakWiresForComponent(comp);
      deleteBridgeBetweenPins(comp);
      setMode('select');
      placeType = null;
      pushUndo();
      rebuildTopology(); redraw();
      updateCoordinateInputs(snapPt.x, snapPt.y);
    } else if (mode === 'place-junction') {
      // Place junction at typed coordinate (reuse existing junction placement logic)
      const TOL = 50;
      const tol = TOL * 0.0254 * (100 / 25.4);

      let bestPt: Point | null = null;
      let bestDist = Infinity;

      // Build all segments
      const segments: Array<{ a: Point, b: Point, wId: string }> = [];
      for (const w of wires) {
        for (let i = 0; i < w.points.length - 1; i++) {
          segments.push({ a: w.points[i], b: w.points[i + 1], wId: w.id });
        }
      }

      // Find intersections and wire points within tolerance
      const allWireIntersections: Point[] = [];
      for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
          const s1 = segments[i], s2 = segments[j];
          const intersect = segmentIntersectionPoint(s1, s2);
          if (intersect) allWireIntersections.push(intersect);
        }
      }

      // Check intersections
      for (const pt of allWireIntersections) {
        const d = Math.sqrt((pt.x - snapPt.x) ** 2 + (pt.y - snapPt.y) ** 2);
        if (d < tol && d < bestDist) {
          bestPt = pt;
          bestDist = d;
        }
      }

      // If no intersection found within tolerance, find closest point on any wire
      if (!bestPt) {
        for (const seg of segments) {
          const closest = closestPointOnAxisAlignedSegment(seg.a, seg.b, snapPt);
          const d = Math.sqrt((closest.x - snapPt.x) ** 2 + (closest.y - snapPt.y) ** 2);
          if (d < bestDist) {
            bestPt = closest;
            bestDist = d;
          }
        }
      }

      if (bestPt) {
        // Check if junction already exists at this location
        const existing = junctions.find(j => Math.abs(j.at.x - bestPt!.x) < 1e-3 && Math.abs(j.at.y - bestPt!.y) < 1e-3);
        if (!existing) {
          junctions.push({ id: State.uid('junction'), at: bestPt, manual: true });
          pushUndo();
          rebuildTopology();
          requestAnimationFrame(() => { redrawCanvasOnly(); });
        }
      }
      updateCoordinateInputs(snapPt.x, snapPt.y);
    } else if (mode === 'delete-junction') {
      // Delete junction at typed coordinate
      const TOL = 50;
      const tol = TOL * 0.0254 * (100 / 25.4);

      const idx = junctions.findIndex(j => {
        const dx = Math.abs(j.at.x - snapPt.x);
        const dy = Math.abs(j.at.y - snapPt.y);
        return Math.sqrt(dx * dx + dy * dy) < tol;
      });

      if (idx !== -1) {
        const junction = junctions[idx];
        if (!junction.manual) {
          junctions[idx] = { id: State.uid('junction'), at: junction.at, manual: true, suppressed: true };
        } else {
          junctions.splice(idx, 1);
        }
        pushUndo();
        rebuildTopology();
        requestAnimationFrame(() => { redrawCanvasOnly(); });
      }
      updateCoordinateInputs(snapPt.x, snapPt.y);
    }
  }

  // Helper: Check if two axis-aligned segments intersect and return intersection point
  function segmentIntersectionPoint(s1: { a: Point, b: Point }, s2: { a: Point, b: Point }): Point | null {
    if (s1.a.x === s1.b.x && s2.a.y === s2.b.y) {
      const x = s1.a.x;
      const y = s2.a.y;
      if (Math.min(s1.a.y, s1.b.y) <= y && y <= Math.max(s1.a.y, s1.b.y) &&
        Math.min(s2.a.x, s2.b.x) <= x && x <= Math.max(s2.a.x, s2.b.x)) {
        return { x, y };
      }
    } else if (s1.a.y === s1.b.y && s2.a.x === s2.b.x) {
      const x = s2.a.x;
      const y = s1.a.y;
      if (Math.min(s1.a.x, s1.b.x) <= x && x <= Math.max(s1.a.x, s1.b.x) &&
        Math.min(s2.a.y, s2.b.y) <= y && y <= Math.max(s2.a.y, s2.b.y)) {
        return { x, y };
      }
    }
    return null;
  }

  // Helper: Find closest point on an axis-aligned segment
  function closestPointOnAxisAlignedSegment(a: Point, b: Point, click: Point): Point {
    if (a.x === b.x) {
      const y = Math.max(Math.min(a.y, b.y), Math.min(click.y, Math.max(a.y, b.y)));
      return { x: a.x, y };
    } else if (a.y === b.y) {
      const x = Math.max(Math.min(a.x, b.x), Math.min(click.x, Math.max(a.x, b.x)));
      return { x, y: a.y };
    }
    return a;
  }

  // ----- Placement ghost -----
  let ghostEl: SVGGElement | null = null;
  function clearGhost() { if (ghostEl) { ghostEl.remove(); ghostEl = null; } }
  function renderGhostAt(pos, type) {
    clearGhost();
    let at = { x: pos.x, y: pos.y }, rot = 0;
    if (isTwoPinType(type)) {
      const hit = nearestSegmentAtPoint(pos, 18);
      if (hit) { at = hit.q; rot = normDeg(hit.angle); }
    }
    const ghost: Component = { id: '__ghost__', type, x: at.x, y: at.y, rot, label: '', value: '', props: {} };
    if (type === 'diode') {
      (ghost.props as Component['props']).subtype = diodeSubtype as DiodeSubtype;
    }
    ghostEl = drawComponent(ghost);
    ghostEl.style.opacity = '0.5';
    ghostEl.style.pointerEvents = 'none';
    gDrawing.appendChild(ghostEl);
  }

  function rotateSelected() {
    const rotSel = getFirstSelection();
    if (!rotSel || rotSel.kind !== 'component') return;
    const c = components.find(x => x.id === rotSel.id); if (!c) return;
    pushUndo();
    c.rot = (c.rot + 90) % 360;
    // After rotation, if pins now cross a wire, split and remove bridge
    if (breakWiresForComponent(c)) {
      deleteBridgeBetweenPins(c);
    }
    redraw();
  }

  // ====== Toolbar ======
  document.getElementById('modeGroup')!.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    const m = btn.dataset.mode as Mode | undefined;
    if (!m) return;
    // Toggle Select: clicking Select when already active deselects (goes to 'none')
    if (m === 'select' && mode === 'select') setMode('none');
    else setMode(m);
  });

  // Fallback selection by delegation (ensures inspector opens on click)
  gComps.addEventListener('pointerdown', (e) => {
    if (!(mode === 'select' || mode === 'move')) return;
    const compG = (e.target as Element).closest('g.comp') as SVGGElement | null;
    if (compG) {
      const id = compG.getAttribute('data-id');
      
      // Handle shift-click for multi-select
      if (e.shiftKey) {
        toggleSelection('component', id, null);
        renderInspector();
        Rendering.updateSelectionOutline(selection);
        e.stopPropagation();
        return;
      }
      
      selecting('component', id);
      e.stopPropagation();
    }
  });

  const paletteRow2 = document.getElementById('paletteRow2') as HTMLElement;
  function positionSubtypeDropdown() {
    if (!paletteRow2) return;
    const headerEl = document.querySelector('header');
    // Position under the active button (diode, capacitor, or transistor)
    let activeBtn: Element | null = null;
    if (placeType === 'diode') {
      activeBtn = document.querySelector('#paletteRow1 button[data-tool="diode"]');
    } else if (placeType === 'capacitor') {
      activeBtn = document.querySelector('#paletteRow1 button[data-tool="capacitor"]');
    } else if (placeType === 'npn' || placeType === 'pnp') {
      activeBtn = document.querySelector('#paletteRow1 button[data-tool="transistor"]');
    }
    if (!headerEl || !activeBtn) return;
    const hb = headerEl.getBoundingClientRect();
    const bb = activeBtn.getBoundingClientRect();
    // Position just under the active button, with a small vertical gap
    paletteRow2.style.left = (bb.left - hb.left) + 'px';
    paletteRow2.style.top = (bb.bottom - hb.top + 6) + 'px';
  }
  window.addEventListener('resize', () => { if (paletteRow2.style.display !== 'none') positionSubtypeDropdown(); });

  // Show subtype row for diode, capacitor, or transistor placement
  function updateSubtypeVisibility() {
    if (!paletteRow2) return;
    const show = (mode === 'place' && (placeType === 'diode' || placeType === 'capacitor' || placeType === 'npn' || placeType === 'pnp'));
    if (show) {
      paletteRow2.style.display = 'block';
      const ds = document.getElementById('diodeSelect') as HTMLSelectElement | null;
      const capacitorSubtypes = document.querySelector('.capacitor-subtypes') as HTMLElement | null;
      const transistorSubtypes = document.querySelector('.transistor-subtypes') as HTMLElement | null;
      if (ds) ds.style.display = (placeType === 'diode') ? 'inline-block' : 'none';
      if (capacitorSubtypes) capacitorSubtypes.style.display = (placeType === 'capacitor') ? 'flex' : 'none';
      if (transistorSubtypes) transistorSubtypes.style.display = (placeType === 'npn' || placeType === 'pnp') ? 'flex' : 'none';
      if (ds && placeType === 'diode') ds.value = diodeSubtype;
      if (capacitorSubtypes && placeType === 'capacitor') updateCapacitorSubtypeButtons();
      if (transistorSubtypes && (placeType === 'npn' || placeType === 'pnp')) updateTransistorSubtypeButtons();
      positionSubtypeDropdown();
    } else {
      paletteRow2.style.display = 'none';
    }
  }

  // Any button in the header (except the Diode, Capacitor, or Transistor buttons) hides the popup
  (function () {
    const headerEl = document.querySelector('header');
    headerEl.addEventListener('click', (e) => {
      const btn = (e.target as Element | null)?.closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      const isDiodeBtn = btn.matches('#paletteRow1 button[data-tool="diode"]');
      const isCapacitorBtn = btn.matches('#paletteRow1 button[data-tool="capacitor"]');
      const isTransistorBtn = btn.matches('#paletteRow1 button[data-tool="transistor"]');
      const isSubtypeBtn = btn.closest('#paletteRow2');
      if (!isDiodeBtn && !isCapacitorBtn && !isTransistorBtn && !isSubtypeBtn) {
        paletteRow2.style.display = 'none';
      }
    }, true);
  })();

  document.getElementById('paletteRow1')!.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    const tool = btn.dataset.tool;
    
    // Handle transistor button specially - map to current transistor type
    if (tool === 'transistor') {
      placeType = transistorType; // Use current transistor type (npn or pnp)
    } else {
      placeType = (tool as PlaceType | undefined) || placeType;
    }
    
    setMode('place');
    // Reveal sub-type row for types that have subtypes (diode, capacitor, transistor)
    if (placeType === 'diode' || placeType === 'capacitor' || tool === 'transistor') {
      paletteRow2.style.display = 'block';
      const ds = document.getElementById('diodeSelect') as HTMLSelectElement | null;
      const cs = document.getElementById('capacitorSelect') as HTMLSelectElement | null;
      if (ds) ds.value = diodeSubtype;
      if (cs) cs.value = capacitorSubtype;
      positionSubtypeDropdown();
    } else {
      paletteRow2.style.display = 'none';
    }
    updateSubtypeVisibility();
  });
  // Diode subtype select → enter Place mode for diode using chosen subtype
  const diodeSel = $q<HTMLSelectElement>('#diodeSelect');
  if (diodeSel) {
    diodeSel.value = diodeSubtype;
    diodeSel.addEventListener('change', () => {
      diodeSubtype = (diodeSel.value as DiodeSubtype) || 'generic';
      placeType = 'diode'; setMode('place');
      // ensure the subtype row is visible while placing diodes
      updateSubtypeVisibility();
    });
    // clicking the dropdown should also arm diode placement without changing the value
    diodeSel.addEventListener('mousedown', () => {
      placeType = 'diode'; setMode('place');
      paletteRow2.style.display = 'block';
      positionSubtypeDropdown();
      updateSubtypeVisibility();
    });
  }

  // Update capacitor toolbar button icon based on selected subtype
  function updateCapacitorButtonIcon() {
    const capacitorBtn = document.querySelector('#paletteRow1 button[data-tool="capacitor"]');
    if (!capacitorBtn) return;

    const svg = capacitorBtn.querySelector('svg');
    if (!svg) return;

    if (capacitorSubtype === 'polarized') {
      // Polarized capacitor icon - ANSI style (straight + curved)
      if (defaultResistorStyle === 'iec') {
        // IEC: two straight plates
        svg.innerHTML = `
          <path d="M2 12H26" />
          <path d="M26 4V20" />
          <path d="M38 4V20" />
          <path d="M38 12H62" />
        `.trim();
      } else {
        // ANSI: straight + curved
        svg.innerHTML = `
          <path d="M2 12H26" />
          <path d="M26 4V20" />
          <path d="M38 4 Q 32 12 38 20" />
          <path d="M38 12H62" />
        `.trim();
      }
    } else {
      // Standard capacitor icon (two straight plates)
      svg.innerHTML = `
        <path d="M2 12H26" />
        <path d="M26 4V20" />
        <path d="M38 4V20" />
        <path d="M38 12H62" />
      `.trim();
    }
  }

  // Capacitor subtype buttons → enter Place mode for capacitor using chosen subtype
  function updateCapacitorSubtypeButtons() {
    const standardBtn = document.getElementById('capacitorStandard');
    const polarizedBtn = document.getElementById('capacitorPolarized');
    if (standardBtn) {
      standardBtn.classList.toggle('active', capacitorSubtype === 'standard');
    }
    if (polarizedBtn) {
      polarizedBtn.classList.toggle('active', capacitorSubtype === 'polarized');
      // Update polarized button icon based on schematic standard
      const svg = polarizedBtn.querySelector('svg');
      if (svg) {
        if (defaultResistorStyle === 'iec') {
          // IEC: two straight plates
          svg.innerHTML = `
            <path d="M2 12H26" />
            <path d="M26 4V20" />
            <path d="M38 4V20" />
            <path d="M38 12H62" />
          `.trim();
        } else {
          // ANSI: straight + curved
          svg.innerHTML = `
            <path d="M2 12H26" />
            <path d="M26 4V20" />
            <path d="M38 4 Q 32 12 38 20" />
            <path d="M38 12H62" />
          `.trim();
        }
      }
    }
  }

  const capacitorStandardBtn = document.getElementById('capacitorStandard');
  const capacitorPolarizedBtn = document.getElementById('capacitorPolarized');

  if (capacitorStandardBtn) {
    capacitorStandardBtn.addEventListener('click', () => {
      capacitorSubtype = 'standard';
      updateCapacitorButtonIcon();
      updateCapacitorSubtypeButtons();
      placeType = 'capacitor';
      setMode('place');
    });
  }

  if (capacitorPolarizedBtn) {
    capacitorPolarizedBtn.addEventListener('click', () => {
      capacitorSubtype = 'polarized';
      updateCapacitorButtonIcon();
      updateCapacitorSubtypeButtons();
      placeType = 'capacitor';
      setMode('place');
    });
  }

  // Initialize capacitor button icon and subtype buttons on load
  updateCapacitorButtonIcon();
  updateCapacitorSubtypeButtons();

  // Transistor subtype buttons (NPN/PNP)
  function updateTransistorSubtypeButtons() {
    const npnBtn = document.getElementById('transistorNPN');
    const pnpBtn = document.getElementById('transistorPNP');
    if (npnBtn) npnBtn.classList.toggle('active', transistorType === 'npn');
    if (pnpBtn) pnpBtn.classList.toggle('active', transistorType === 'pnp');
  }

  const transistorNPNBtn = document.getElementById('transistorNPN');
  const transistorPNPBtn = document.getElementById('transistorPNP');

  if (transistorNPNBtn) {
    transistorNPNBtn.addEventListener('click', () => {
      transistorType = 'npn';
      updateTransistorSubtypeButtons();
      placeType = 'npn';
      setMode('place');
    });
  }

  if (transistorPNPBtn) {
    transistorPNPBtn.addEventListener('click', () => {
      transistorType = 'pnp';
      updateTransistorSubtypeButtons();
      placeType = 'pnp';
      setMode('place');
    });
  }

  // Initialize transistor subtype buttons on load
  updateTransistorSubtypeButtons();

  document.getElementById('rotateBtn').addEventListener('click', rotateSelected);
  document.getElementById('clearBtn').addEventListener('click', clearAll);
  document.getElementById('addNetBtn')!.addEventListener('click', addNet);

  // Undo/Redo button handlers
  document.getElementById('undoBtn')?.addEventListener('click', undo);
  document.getElementById('redoBtn')?.addEventListener('click', redo);


  // ================================================================================
  // ====== 9. UI COMPONENTS - TOOLBAR & DIALOGS ======
  // ================================================================================

  // Wire stroke defaults (global for NEW wires) — popover with KiCad-like fields
  const wireColorBtn = document.getElementById('wireColorBtn') as HTMLButtonElement;
  const wireColorMenu = document.getElementById('wireColorMenu') as HTMLElement;
  const wireColorSwatch = document.getElementById('wireColorSwatch') as HTMLElement;

  // Persisted global defaults for new wires
  type WireStrokeDefaults = {
    useNetclass: boolean;        // if true, new wires use netclass/theme (stroke width=0, type='default')
    stroke: Stroke;              // explicit stroke when useNetclass=false
  };

  function loadWireDefaults(): WireStrokeDefaults {
    try {
      const raw = localStorage.getItem('wire.defaults');
      if (raw) {
        const parsed = JSON.parse(raw);
        // very defensive merge with reasonable fallbacks
        return {
          useNetclass: !!parsed.useNetclass,
          stroke: {
            width: Math.max(0, +((parsed.stroke?.width ?? 0))),
            type: (parsed.stroke?.type ?? 'default'),
            color: parsed.stroke?.color ?? cssToRGBA01(resolveWireColor('auto')),
          }
        } as WireStrokeDefaults;
      }
    } catch { }
    // baseline: netclass defaults, with a sane color for when user flips to custom
    return {
      useNetclass: true,
      stroke: { width: 0, type: 'default', color: cssToRGBA01(resolveWireColor('auto')) }
    };
  }
  function saveWireDefaults() { localStorage.setItem('wire.defaults', JSON.stringify(WIRE_DEFAULTS)); }

  let WIRE_DEFAULTS: WireStrokeDefaults = loadWireDefaults();

  // keep existing color-mode plumbing backwards compatible by mirroring to it
  function mirrorDefaultsIntoLegacyColorMode() {
    if (WIRE_DEFAULTS.useNetclass) {
      currentWireColorMode = 'auto';
    } else {
      // Check if the color is black - if so, set mode to 'black' for theme-aware rendering
      const c = WIRE_DEFAULTS.stroke.color;
      if (c.r < 0.01 && c.g < 0.01 && c.b < 0.01) {
        currentWireColorMode = 'black';
      } else {
        currentWireColorMode = 'custom';
      }
    }
  }

  // tiny helper: rebuild preview SVG (simple line)
  function buildStrokePreview(st: Stroke): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '160'); svg.setAttribute('height', '22');
    svg.style.display = 'block';
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '8'); line.setAttribute('x2', '152');
    line.setAttribute('y1', '11'); line.setAttribute('y2', '11');
    line.setAttribute('stroke', rgba01ToCss(st.color));
    line.setAttribute('stroke-width', String(Math.max(1, mmToPx(st.width || 0.25))));
    // dash mapping like inspector
    const style = st.type || 'default';
    const dash = style === 'dash' ? '6 4' :
      style === 'dot' ? '2 4' :
        style === 'dash_dot' ? '6 4 2 4' :
          style === 'dash_dot_dot' ? '6 4 2 4 2 4' : '';
    if (dash) line.setAttribute('stroke-dasharray', dash);
    svg.appendChild(line);
    return svg;
  }

  // Rebuild the popover UI each time it opens
  function buildWireStrokeMenu(menuEl: HTMLElement) {
    menuEl.replaceChildren();

    // container
    const box = document.createElement('div');
    box.style.display = 'grid';
    box.style.gridTemplateColumns = 'auto';
    box.style.rowGap = '6px';
    box.style.padding = '8px';
    box.style.minWidth = '220px';
    box.style.maxWidth = '260px';

    // header
    const h = document.createElement('div');
    h.textContent = 'Wire Stroke';
    h.style.fontWeight = '600';
    box.appendChild(h);

    // Net class selection
    const rowUse = document.createElement('label');
    rowUse.style.display = 'grid';
    rowUse.style.gridTemplateColumns = '1fr';
    const capUse = document.createElement('div');
    capUse.textContent = 'Net Class';
    const selNetClass = document.createElement('select');

    // Add all available net classes
    Array.from(nets).sort().forEach(netName => {
      const o = document.createElement('option');
      o.value = netName;
      o.textContent = netName;
      selNetClass.appendChild(o);
    });

    // Set current value
    selNetClass.value = activeNetClass;

    rowUse.append(capUse, selNetClass);
    box.appendChild(rowUse);

    // Use custom properties checkbox
    const rowCustom = document.createElement('label');
    rowCustom.style.display = 'flex';
    rowCustom.style.alignItems = 'center';
    rowCustom.style.gap = '6px';
    rowCustom.style.marginTop = '4px';
    const chkCustom = document.createElement('input');
    chkCustom.type = 'checkbox';
    chkCustom.checked = !WIRE_DEFAULTS.useNetclass;
    const lblCustom = document.createElement('span');
    lblCustom.textContent = 'Use custom properties';
    rowCustom.append(chkCustom, lblCustom);
    box.appendChild(rowCustom);

    // Width (mm)
    const rowW = document.createElement('label');
    rowW.style.display = 'grid';
    rowW.style.gridTemplateColumns = '1fr';
    const capW = document.createElement('div'); capW.textContent = `Width (${globalUnits})`;
    const inpW = document.createElement('input');
    // Use text so users can type unit suffixes (e.g., "0.5 mm", "12 mils", "0.02 in").
    inpW.type = 'text';
    const initialNm = ((WIRE_DEFAULTS.stroke as any).widthNm != null)
      ? (WIRE_DEFAULTS.stroke as any).widthNm
      : unitToNm(WIRE_DEFAULTS.stroke.width || 0, 'mm');
    inpW.value = formatDimForDisplay(initialNm, globalUnits);
    rowW.append(capW, inpW);
    box.appendChild(rowW);

    // Line style
    const rowS = document.createElement('label');
    rowS.style.display = 'grid';
    rowS.style.gridTemplateColumns = '1fr';
    const capS = document.createElement('div'); capS.textContent = 'Line style';
    const selS = document.createElement('select');
    ['default', 'solid', 'dash', 'dot', 'dash_dot', 'dash_dot_dot'].forEach(v => {
      const o = document.createElement('option'); o.value = v; o.textContent = v.replace('_', '-');
      selS.appendChild(o);
    });
    selS.value = (WIRE_DEFAULTS.stroke.type || 'default') as string;
    rowS.append(capS, selS);
    box.appendChild(rowS);

    // Color + opacity
    const rowC = document.createElement('div');
    rowC.style.display = 'grid';
    rowC.style.gridTemplateColumns = '1fr';
    const capC = document.createElement('div'); capC.textContent = 'Color / Opacity';
    const wrapC = document.createElement('div');
    wrapC.style.display = 'grid';
    wrapC.style.gridTemplateColumns = '1fr 1fr';
    wrapC.style.gap = '6px';
    const inpColor = document.createElement('input'); inpColor.type = 'color';
    const rgb = WIRE_DEFAULTS.stroke.color; // RGBA01
    const hex = '#'
      + [rgb.r, rgb.g, rgb.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    inpColor.value = hex;
    const inpA = document.createElement('input'); inpA.type = 'range'; inpA.min = '0'; inpA.max = '1'; inpA.step = '0.01'; inpA.value = String(rgb.a ?? 1);
    wrapC.append(inpColor, inpA);
    rowC.append(capC, wrapC);
    box.appendChild(rowC);

    // Standard color swatches (toolbar menu)
    (function () {
      const swatches = [
        ['black', '#000000'],
        ['red', '#FF0000'], ['green', '#00FF00'], ['blue', '#0000FF'],
        ['cyan', '#00FFFF'], ['magenta', '#FF00FF'], ['yellow', '#FFFF00']
      ];
      const pal = document.createElement('div'); pal.className = 'palette';
      pal.style.gridTemplateColumns = `repeat(${swatches.length}, 20px)`;
      swatches.forEach(([k, col]) => {
        const b = document.createElement('button'); b.className = 'swatch-btn';
        b.title = (k as string).toUpperCase();
        // Special handling for black: create split diagonal swatch
        if (col === '#000000') {
          b.style.background = 'linear-gradient(to bottom right, #000000 0%, #000000 49%, #ffffff 51%, #ffffff 100%)';
          b.style.border = '1px solid #666666';
          b.title = 'BLACK/WHITE';
        } else {
          b.style.background = String(col);
        }
        b.addEventListener('click', (ev) => {
          // Switch to custom color immediately
          chkCustom.checked = true;
          WIRE_DEFAULTS.useNetclass = false;
          const rgba = cssToRGBA01(String(col)); rgba.a = parseFloat(inpA.value) || 1;
          WIRE_DEFAULTS.stroke.color = rgba;
          mirrorDefaultsIntoLegacyColorMode();
          saveWireDefaults();
          syncWireToolbar();
          setEnabledStates();
          // update inputs + preview
          inpColor.value = String(col as string);
          refreshPreview();
        });
        pal.appendChild(b);
      });
      box.appendChild(document.createElement('div'));
      box.appendChild(pal);
    })();

    // Preview
    const rowP = document.createElement('div');
    const capP = document.createElement('div'); capP.textContent = 'Preview';
    const prevHolder = document.createElement('div');
    prevHolder.style.border = '1px solid #ccc';
    prevHolder.style.borderRadius = '6px';
    prevHolder.style.padding = '4px';
    // Match the page background so “auto”/netclass colors always contrast correctly.
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    prevHolder.style.background = bodyBg;

    rowP.append(capP, prevHolder);
    box.appendChild(rowP);

    function currentPreviewStroke(): Stroke {
      if (WIRE_DEFAULTS.useNetclass) {
        // Show the *effective netclass stroke* (not “auto” black/white).
        const nc = NET_CLASSES.default.wire;
        return { width: nc.width, type: nc.type, color: nc.color };
      }
      // Not using netclass defaults: resolve only the LINE STYLE if it is 'default'.
      const st = { ...WIRE_DEFAULTS.stroke };
      if (st.type === 'default') {
        const netClass = NET_CLASSES[activeNetClass] || NET_CLASSES.default;
        const nc = netClass.wire;
        st.type = (nc.type && nc.type !== 'default') ? nc.type : 'solid';
      }
      return st;
    }

    function refreshPreview() {
      prevHolder.replaceChildren(buildStrokePreview(currentPreviewStroke()));
    }

    function syncAllFieldsToEffective() {
      let st: Stroke;
      if (WIRE_DEFAULTS.useNetclass) {
        // Use the active net class properties for visual feedback
        const netClass = NET_CLASSES[activeNetClass] || NET_CLASSES.default;
        const nc = netClass.wire;
        st = { width: nc.width, type: nc.type, color: nc.color };
      } else {
        st = WIRE_DEFAULTS.stroke;
      }
      // Width: show in the currently selected global units using nm internal representation when available
      const stNm = (st && (st as any).widthNm != null) ? (st as any).widthNm : unitToNm(st.width ?? 0, 'mm');
      inpW.value = formatDimForDisplay(stNm, globalUnits);
      // Style
      selS.value = (st.type || 'default') as string;
      // Color & opacity
      const hex = '#' + [st.color.r, st.color.g, st.color.b]
        .map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
      inpColor.value = hex;
      inpA.value = String(Math.max(0, Math.min(1, st.color.a ?? 1)));
    }

    function setEnabledStates() {
      const useCustom = chkCustom.checked;
      inpW.disabled = !useCustom;
      selS.disabled = !useCustom;
      inpColor.disabled = !useCustom;
      inpA.disabled = !useCustom;
    }

    // Wire up events
    selNetClass.onchange = () => {
      activeNetClass = selNetClass.value;
      renderNetList();
      if (!chkCustom.checked) {
        // If using net class properties, update display
        mirrorDefaultsIntoLegacyColorMode();
        saveWireDefaults();
        syncWireToolbar();
        setEnabledStates();
        syncAllFieldsToEffective();
        refreshPreview();
      }
    };

    chkCustom.onchange = () => {
      WIRE_DEFAULTS.useNetclass = !chkCustom.checked;
      if (chkCustom.checked) {
        // Switching to custom: populate with current net class values
        const nc = NET_CLASSES[activeNetClass] || NET_CLASSES.default;
        WIRE_DEFAULTS.stroke = {
          width: nc.wire.width,
          type: nc.wire.type,
          color: { ...nc.wire.color }
        };
        (WIRE_DEFAULTS.stroke as any).widthNm = Math.round(nc.wire.width * NM_PER_MM);
      }
      mirrorDefaultsIntoLegacyColorMode();
      saveWireDefaults();
      syncWireToolbar();
      setEnabledStates();
      syncAllFieldsToEffective();
      refreshPreview();
    };
    // Allow temporary empty/invalid text while typing without snapping back to netclass.
    // Allow temporary empty/invalid text while typing. Parse with suffixes when a valid numeric+suffix present.
    inpW.oninput = () => {
      const raw = (inpW.value || '').trim();
      if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return;
      const parsed = parseDimInput(raw, globalUnits);
      if (!parsed) return;
      const mmVal = parsed.nm / NM_PER_MM;
      // update defaults using mm for backward compatibility, but keep widthNm for internal precision
      WIRE_DEFAULTS.stroke.width = mmVal;
      (WIRE_DEFAULTS.stroke as any).widthNm = parsed.nm;
      // If a positive width is typed, enable custom properties mode
      if (mmVal > 0 && !chkCustom.checked) {
        chkCustom.checked = true;
        WIRE_DEFAULTS.useNetclass = false;
        if (WIRE_DEFAULTS.stroke.type === 'default') {
          WIRE_DEFAULTS.stroke.type = 'solid';
          selS.value = 'solid';
        }
        setEnabledStates();
      }
      mirrorDefaultsIntoLegacyColorMode();
      saveWireDefaults();
      syncWireToolbar();
      refreshPreview();
    };
    // Commit on blur/Enter: parse with optional suffix and normalize to nm/mm
    inpW.onchange = () => {
      const parsed = parseDimInput((inpW.value || '').trim(), globalUnits);
      const nm = parsed ? parsed.nm : 0;
      const val = (nm / NM_PER_MM) || 0;
      WIRE_DEFAULTS.stroke.width = val;
      (WIRE_DEFAULTS.stroke as any).widthNm = nm;
      if (val <= 0) {
        WIRE_DEFAULTS.useNetclass = true;
        WIRE_DEFAULTS.stroke.type = 'default';
        selS.value = 'default';
      } else {
        WIRE_DEFAULTS.useNetclass = false;
        if (WIRE_DEFAULTS.stroke.type === 'default') {
          WIRE_DEFAULTS.stroke.type = 'solid';
          selS.value = 'solid';
        }
      }
      // Net class dropdown value is preserved
      mirrorDefaultsIntoLegacyColorMode();
      saveWireDefaults();
      syncWireToolbar();
      setEnabledStates();
      // Normalize and show the committed value in the current global units.
      inpW.value = formatDimForDisplay(nm, globalUnits);
      refreshPreview();
    };
    selS.onchange = () => {
      const val = selS.value as StrokeType;

      if (val === 'default') {
        // Only defer the LINE STYLE to the netclass
        WIRE_DEFAULTS.stroke.type = 'default';
      } else {
        WIRE_DEFAULTS.stroke.type = val;
        if ((WIRE_DEFAULTS.stroke.width || 0) <= 0) {
          WIRE_DEFAULTS.stroke.width = 0.25; // give it a sane visible width
        }
      }
      // Reflect toolbar + preview instantly
      mirrorDefaultsIntoLegacyColorMode();
      saveWireDefaults();
      syncWireToolbar();
      setEnabledStates();
      refreshPreview();
    };

    inpColor.oninput = () => {
      const c = cssToRGBA01(inpColor.value);
      WIRE_DEFAULTS.stroke.color = {
        ...WIRE_DEFAULTS.stroke.color,
        r: c.r,
        g: c.g,
        b: c.b,
      };
      saveWireDefaults();
      syncWireToolbar();
      refreshPreview();
    };
    inpA.oninput = () => {
      WIRE_DEFAULTS.stroke.color = {
        ...WIRE_DEFAULTS.stroke.color,
        a: clamp(+inpA.value, 0, 1),
      };
      saveWireDefaults();
      syncWireToolbar();
      refreshPreview();
    };

    setEnabledStates();
    syncAllFieldsToEffective();
    refreshPreview();
    menuEl.appendChild(box);
  }

  function syncWireToolbar() {
    // show effective color in swatch & border
    const col = WIRE_DEFAULTS.useNetclass
      ? rgba01ToCss(NET_CLASSES.default.wire.color)     // reflect actual netclass color
      : rgba01ToCss(WIRE_DEFAULTS.stroke.color);
    setSwatch(wireColorSwatch, col);
    const hex = colorToHex(col);
    const label = WIRE_DEFAULTS.useNetclass
      ? 'Netclass defaults'
      : `${(WIRE_DEFAULTS.stroke.type || 'default')} @ ${formatDimForDisplay((WIRE_DEFAULTS.stroke as any).widthNm != null ? (WIRE_DEFAULTS.stroke as any).widthNm : unitToNm(WIRE_DEFAULTS.stroke.width || 0, 'mm'), globalUnits)}`;
    wireColorBtn.title = `Wire Stroke: ${label} — ${hex}`;
    wireColorBtn.style.borderColor = col;
    const dot = document.querySelector('#dot circle'); if (dot) (dot as SVGElement).setAttribute('fill', col);
  }

  function openWireMenu() {
    buildWireStrokeMenu(wireColorMenu);
    // Use block flow for form content (not the old swatch grid)
    wireColorMenu.style.display = 'block';
  }
  function closeWireMenu() { wireColorMenu.style.display = 'none'; }

  // init
  if (wireColorBtn) {
    mirrorDefaultsIntoLegacyColorMode();
    syncWireToolbar();
    wireColorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = wireColorMenu.style.display !== 'none';
      if (isOpen) closeWireMenu(); else openWireMenu();
    });
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (t && !wireColorMenu.contains(t) && t !== wireColorBtn) closeWireMenu();
    });
    window.addEventListener('resize', closeWireMenu);
  }

  // Zoom controls
  document.getElementById('zoomInBtn').addEventListener('click', () => { zoom = Math.min(10, zoom * 1.25); applyZoom(); });
  document.getElementById('zoomOutBtn').addEventListener('click', () => { zoom = Math.max(0.25, zoom / 1.25); applyZoom(); });
  document.getElementById('zoomResetBtn').addEventListener('click', () => { zoom = 1; applyZoom(); viewX = 0; viewY = 0; applyZoom(); });
  document.getElementById('zoomPct')!.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const raw = (input?.value || '').trim();
    const n = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
    if (!isFinite(n) || n <= 0) { updateZoomUI(); return; }
    zoom = clamp(n, 0.25, 10); applyZoom();
  });

  // ---- NEW: while typing, ignore app keyboard shortcuts ----
  // Treat focused INPUT / TEXTAREA / SELECT / contenteditable as "editing" targets.
  function isEditingKeystrokesTarget(evt: KeyboardEvent): boolean {
    const t = (evt.target as HTMLElement) || null;
    const a = (document.activeElement as HTMLElement) || null;
    const isEditable = (el: HTMLElement | null) => {
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select';
    };
    return isEditable(t) || isEditable(a);
  }

  // Pan helpers
  var isPanning = false, panStartClient = null, panStartView = null, panPointerId = null;
  var panAnimationFrame = null;
  var pendingPanPosition = null;

  function beginPan(e) {
    isPanning = true;
    document.body.classList.add('panning');
    // Store screen coordinates (clientX/Y) instead of SVG coordinates to avoid feedback loop
    panStartClient = { x: e.clientX, y: e.clientY };
    panStartView = { x: viewX, y: viewY };
    panPointerId = e.pointerId;
    svg.setPointerCapture?.(panPointerId);
  }

  function doPan(e) {
    if (!isPanning) return;

    // Calculate delta in screen pixels
    const clientDx = e.clientX - panStartClient.x;
    const clientDy = e.clientY - panStartClient.y;

    // Convert screen pixel delta to SVG user units
    const scale = viewW / Math.max(1, svg.clientWidth);
    const dx = clientDx * scale;
    const dy = clientDy * scale;

    // Update view position directly
    pendingPanPosition = {
      x: panStartView.x - dx,
      y: panStartView.y - dy
    };

    // Use requestAnimationFrame to batch updates at 60fps
    if (panAnimationFrame === null) {
      panAnimationFrame = requestAnimationFrame(() => {
        panAnimationFrame = null;
        if (pendingPanPosition) {
          viewX = pendingPanPosition.x;
          viewY = pendingPanPosition.y;
          // Update viewBox for smooth panning
          svg.setAttribute('viewBox', `${viewX} ${viewY} ${viewW} ${viewH}`);
        }
      });
    }
  }
  function endPan() {
    if (!isPanning) return;
    isPanning = false;
    document.body.classList.remove('panning');
    if (panPointerId != null) svg.releasePointerCapture?.(panPointerId);
    panPointerId = null;
    // Final update after panning completes
    if (panAnimationFrame !== null) {
      cancelAnimationFrame(panAnimationFrame);
      panAnimationFrame = null;
    }
    // Full redraw including grid after panning completes
    applyZoom();
  }

  function clearAll() {
    FileIO.clearAll({
      components,
      wires,
      junctions,
      nets,
      activeNetClass,
      NET_CLASSES,
      THEME,
      defaultResistorStyle,
      counters,
      GRID,
      projTitle,
      defaultResistorStyleSelect,
      normalizeAllWires,
      ensureStroke: (w: Wire) => ensureStroke(w),
      rgba01ToCss,
      cssToRGBA01,
      renderNetList,
      redraw,
      keyPt: (p: { x: number; y: number }) => Geometry.keyPt(p),
      selection,
      drawing,
      gDrawing
    });
  }

  // ================================================================================
  // ====== 9. UI COMPONENTS - INSPECTOR ======
  // ================================================================================

  // ====== Units & conversion helpers ======
  // Internal resolution: nanometers (integers). Display units: mm / in / mils
  // (NM_PER_* constants are declared near the top-level so they're available to all code.)

  // Global units state & persistence are declared at module top-level to avoid TDZ issues
  // Conversion functions now imported from conversions.ts

  // Specialized input used for coordinates (x/y) that are stored in px internally.
  function dimNumberPx(pxVal: number, onCommit: (px: number) => void) {
    const inp = document.createElement('input'); inp.type = 'text';
    // display initial value converted to current units
    const nm = pxToNm(pxVal);
    inp.value = formatDimForDisplay(nm, globalUnits);
    // commit on blur or Enter
    function commitFromStr(str: string) {
      const parsed = parseDimInput(str);
      if (!parsed) return; // ignore invalid
      const px = Math.round(nmToPx(parsed.nm));
      onCommit(px);
      // refresh displayed (normalize units & formatting)
      inp.value = formatDimForDisplay(parsed.nm, globalUnits);
    }
    inp.addEventListener('blur', () => commitFromStr(inp.value));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commitFromStr(inp.value); inp.blur(); } });
    return inp;
  }

  // Forward declaration for junction size UI update
  let updateJunctionSizeUI: (() => void) | null = null;

  // Update UI after unit changes
  function setGlobalUnits(u: 'mm' | 'in' | 'mils') {
    globalUnits = u; saveGlobalUnits();
    // Update junction size label and input
    if (updateJunctionSizeUI) updateJunctionSizeUI();
    // Refresh inspector UI and any open popovers
    renderInspector(); // safe to call repeatedly
  }

  // Hook up the units select in the status bar
  (function installUnitsSelect() {
    const unitsSelect = document.getElementById('unitsSelect') as HTMLSelectElement;
    if (!unitsSelect) return;

    // Set initial value
    unitsSelect.value = globalUnits;

    // Handle changes
    unitsSelect.addEventListener('change', () => {
      const u = unitsSelect.value as 'mm' | 'in' | 'mils';
      setGlobalUnits(u);
    });

    // Update resistor toolbar icon
    function updateResistorToolbarIcon() {
      const btn = $q('[data-tool="resistor"]');
      if (!btn) return;
      const svg = btn.querySelector('svg');
      if (!svg) return;

      if (defaultResistorStyle === 'iec') {
        // IEC rectangle icon
        svg.innerHTML = '<path d="M2 12H14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="14" y="6" width="36" height="12" rx="1" stroke="currentColor" stroke-width="2" fill="none"/><path d="M50 12H62" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
      } else {
        // US/ANSI zigzag icon
        svg.innerHTML = '<path d="M2 12H10L14 6L22 18L30 6L38 18L46 6L54 18L58 12H62" />';
      }
    }

    // Resistor style selector
    defaultResistorStyleSelect.value = defaultResistorStyle;
    updateResistorToolbarIcon();
    defaultResistorStyleSelect.addEventListener('change', () => {
      const style = defaultResistorStyleSelect.value as ResistorStyle;
      defaultResistorStyle = style;
      localStorage.setItem('defaultResistorStyle', style);
      updateResistorToolbarIcon();
      updateCapacitorButtonIcon();
      updateCapacitorSubtypeButtons();
      // Note: Don't redraw canvas - only affects newly placed resistors
    });

    // Junction dot size selector (custom button-based selector)
    const updateJunctionSizeSelection = (size: 'smallest' | 'small' | 'default' | 'large' | 'largest') => {
      junctionDotSizeSelect.querySelectorAll('.junction-size-option').forEach(btn => {
        btn.classList.toggle('selected', btn.getAttribute('data-size') === size);
      });
    };
    updateJunctionSizeSelection(junctionDotSize);
    junctionDotSizeSelect.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('.junction-size-option') as HTMLElement;
      if (!target) return;
      const size = target.getAttribute('data-size') as 'smallest' | 'small' | 'default' | 'large' | 'largest' | 'custom';
      if (size && size !== 'custom') {
        // Map preset size to mils value
        const sizeInMils = size === 'smallest' ? 15 : size === 'small' ? 30 : size === 'default' ? 40 : size === 'large' ? 50 : 65;
        
        junctionDotSize = size;
        localStorage.setItem('junctionDots.size', size);
        updateJunctionSizeSelection(size);
        
        // Update custom size input to show the preset value
        if (junctionCustomSizeInput) {
          junctionCustomSize = sizeInMils;
          const sizeNm = sizeInMils * 0.0254 * NM_PER_MM;
          junctionCustomSizeInput.value = formatDimForDisplay(sizeNm, globalUnits);
          localStorage.setItem('junctionDots.customSize', String(sizeInMils));
        }
        
        updateCustomJunctionPreview();
        redraw(); // Redraw to apply new junction dot size immediately
      } else if (size === 'custom' && junctionCustomSize !== null) {
        // Clicking custom preview selects it
        junctionDotSize = 'default'; // Reset to a preset since custom is not a preset
        updateJunctionSizeSelection('default');
        redraw();
      }
    });

    // Custom junction size input
    const junctionCustomSizeInput = $q<HTMLInputElement>('#junctionCustomSizeInput');
    const junctionCustomSizeLabel = $q<HTMLElement>('#junctionCustomSizeLabel');
    const junctionCustomPreview = $q<HTMLButtonElement>('#junctionCustomPreview');
    const junctionCustomPreviewSvg = $q<SVGElement>('#junctionCustomPreviewSvg');
    
    // Function to update the custom junction preview button
    const updateCustomJunctionPreview = () => {
      if (!junctionCustomPreview || !junctionCustomPreviewSvg) return;
      
      if (junctionCustomSize !== null && junctionCustomSize > 0) {
        // Check if custom size matches any preset
        const presetSizes = { smallest: 15, small: 30, default: 40, large: 50, largest: 65 };
        let matchedPreset: string | null = null;
        
        for (const [preset, size] of Object.entries(presetSizes)) {
          if (Math.abs(junctionCustomSize - size) < 0.01) { // Allow tiny floating point differences
            matchedPreset = preset;
            break;
          }
        }
        
        if (matchedPreset) {
          // Hide custom button and highlight the matching preset
          junctionCustomPreview.style.display = 'none';
          junctionDotSizeSelect.querySelectorAll('.junction-size-option').forEach(btn => {
            const btnSize = btn.getAttribute('data-size');
            btn.classList.toggle('selected', btnSize === matchedPreset);
          });
          return;
        }
        
        // Show the preview button for non-preset custom sizes
        junctionCustomPreview.style.display = 'flex';
        // Remove selection from preset buttons
        junctionDotSizeSelect.querySelectorAll('.junction-size-option').forEach(btn => {
          if (btn.getAttribute('data-size') !== 'custom') {
            btn.classList.remove('selected');
          }
        });
        // Select the custom button
        junctionCustomPreview.classList.add('selected');
        
        // Calculate radius in SVG units (approximate scaling to match other buttons)
        // The preview buttons use a 24x24 viewBox with center at 12,12
        // Scale: roughly 1 mil ≈ 0.1 SVG units for visual consistency
        const radiusSvg = junctionCustomSize * 0.1;
        const maxRadius = 10; // Maximum radius that fits well in the button
        
        // Clear previous content
        junctionCustomPreviewSvg.innerHTML = '';
        
        if (radiusSvg <= maxRadius) {
          // Show as filled circle
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', '12');
          circle.setAttribute('cy', '12');
          circle.setAttribute('r', String(radiusSvg));
          circle.setAttribute('fill', 'currentColor');
          circle.setAttribute('stroke', 'var(--bg)');
          circle.setAttribute('stroke-width', '1');
          junctionCustomPreviewSvg.appendChild(circle);
        } else {
          // Show as empty circle with + sign for oversized
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', '12');
          circle.setAttribute('cy', '12');
          circle.setAttribute('r', '9');
          circle.setAttribute('fill', 'none');
          circle.setAttribute('stroke', 'currentColor');
          circle.setAttribute('stroke-width', '1.5');
          junctionCustomPreviewSvg.appendChild(circle);
          
          // Add + sign
          const plusV = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          plusV.setAttribute('x1', '12');
          plusV.setAttribute('y1', '8');
          plusV.setAttribute('x2', '12');
          plusV.setAttribute('y2', '16');
          plusV.setAttribute('stroke', 'currentColor');
          plusV.setAttribute('stroke-width', '1.5');
          junctionCustomPreviewSvg.appendChild(plusV);
          
          const plusH = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          plusH.setAttribute('x1', '8');
          plusH.setAttribute('y1', '12');
          plusH.setAttribute('x2', '16');
          plusH.setAttribute('y2', '12');
          plusH.setAttribute('stroke', 'currentColor');
          plusH.setAttribute('stroke-width', '1.5');
          junctionCustomPreviewSvg.appendChild(plusH);
        }
        
        // Update tooltip
        const sizeNm = junctionCustomSize * 0.0254 * NM_PER_MM;
        const displayValue = formatDimForDisplay(sizeNm, globalUnits);
        junctionCustomPreview.title = `Custom (${displayValue})`;
      } else {
        // Hide the preview button if no custom size
        junctionCustomPreview.style.display = 'none';
        junctionCustomPreview.classList.remove('selected');
      }
    };
    
    // Make function available to setGlobalUnits
    updateJunctionSizeUI = () => {
      if (junctionCustomSizeLabel) {
        junctionCustomSizeLabel.textContent = `Custom Junction Size (${globalUnits})`;
      }
      if (junctionCustomSizeInput && junctionCustomSize !== null) {
        // Convert mils to current units for display
        const sizeNm = junctionCustomSize * 0.0254 * NM_PER_MM;
        junctionCustomSizeInput.value = formatDimForDisplay(sizeNm, globalUnits);
      }
      updateCustomJunctionPreview();
    };
    
    if (junctionCustomSizeInput) {
      // Initialize with current value
      updateJunctionSizeUI();
      
      let lastValidSizeMils: number | null = junctionCustomSize; // Track last valid size for nearest preset calculation
      
      const handleCustomSizeChange = () => {
        const inputValue = junctionCustomSizeInput.value.trim();
        const parsed = parseDimInput(inputValue, globalUnits);
        
        if (parsed && parsed.nm > 0) {
          // Valid size entered - convert nm to mils for storage
          const sizeMils = parsed.nm / (0.0254 * NM_PER_MM);
          junctionCustomSize = sizeMils;
          lastValidSizeMils = sizeMils;
          localStorage.setItem('junctionDots.customSize', String(junctionCustomSize));
          
          // Update input to show formatted value with units
          junctionCustomSizeInput.value = formatDimForDisplay(parsed.nm, globalUnits);
        } else if (inputValue === '') {
          // Input cleared - auto-select nearest preset based on last valid size
          if (lastValidSizeMils !== null) {
            const presetValues = [15, 30, 40, 50, 65];
            const presetNames: ('smallest' | 'small' | 'default' | 'large' | 'largest')[] = ['smallest', 'small', 'default', 'large', 'largest'];
            let nearestPreset = presetValues[0];
            let nearestIndex = 0;
            let minDiff = Math.abs(lastValidSizeMils - presetValues[0]);
            
            for (let i = 0; i < presetValues.length; i++) {
              const diff = Math.abs(lastValidSizeMils - presetValues[i]);
              if (diff < minDiff) {
                minDiff = diff;
                nearestPreset = presetValues[i];
                nearestIndex = i;
              }
            }
            
            // Update to nearest preset
            junctionCustomSize = nearestPreset;
            lastValidSizeMils = nearestPreset;
            junctionDotSize = presetNames[nearestIndex];
            localStorage.setItem('junctionDots.customSize', String(junctionCustomSize));
            localStorage.setItem('junctionDots.size', junctionDotSize);
            
            // Update button selection
            updateJunctionSizeSelection(junctionDotSize);
            
            // Update input with formatted value
            const sizeNm = nearestPreset * 0.0254 * NM_PER_MM;
            junctionCustomSizeInput.value = formatDimForDisplay(sizeNm, globalUnits);
          } else {
            // No previous value, just clear
            junctionCustomSize = null;
            lastValidSizeMils = null;
            localStorage.removeItem('junctionDots.customSize');
            junctionCustomSizeInput.value = '';
          }
        }
        updateCustomJunctionPreview();
        redraw();
      };
      
      junctionCustomSizeInput.addEventListener('change', handleCustomSizeChange);
      junctionCustomSizeInput.addEventListener('blur', handleCustomSizeChange);
      
      // Handle input event for immediate feedback when clearing
      junctionCustomSizeInput.addEventListener('input', () => {
        if (junctionCustomSizeInput.value.trim() === '') {
          updateCustomJunctionPreview(); // Hide button immediately, but don't change junctionCustomSize yet
        }
      });
    }

    // Default junction color picker
    const junctionDefaultColorPicker = $q<HTMLInputElement>('#junctionDefaultColorPicker');
    const junctionDefaultOpacity = $q<HTMLInputElement>('#junctionDefaultOpacity');
    if (junctionDefaultColorPicker && junctionDefaultOpacity) {
      // Initialize with current value
      if (junctionDefaultColor) {
        const hex = colorToHex(junctionDefaultColor);
        junctionDefaultColorPicker.value = hex;
        // Extract opacity if it's rgba
        if (junctionDefaultColor.includes('rgba')) {
          const match = junctionDefaultColor.match(/rgba?\(.*?,\s*(\d*\.?\d+)\s*\)/);
          if (match) junctionDefaultOpacity.value = match[1];
        }
      } else {
        junctionDefaultColorPicker.value = '#000000';
        junctionDefaultOpacity.value = '1';
      }

      const applyColor = () => {
        const hex = junctionDefaultColorPicker.value;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const a = parseFloat(junctionDefaultOpacity.value);
        junctionDefaultColor = `rgba(${r},${g},${b},${a})`;
        localStorage.setItem('junctionDots.defaultColor', junctionDefaultColor);
        redraw();
      };

      junctionDefaultColorPicker.addEventListener('input', applyColor);
      junctionDefaultOpacity.addEventListener('input', applyColor);
      
      // Add color swatches
      const junctionColorSwatches = $q<HTMLElement>('#junctionColorSwatches');
      if (junctionColorSwatches) {
        const swatches = [
          '#000000', '#ff0000', '#00ff00', '#0000ff',
          '#ffff00', '#ff00ff', '#00ffff', '#ffffff',
          '#808080', '#800000', '#008000', '#000080'
        ];
        
        swatches.forEach(color => {
          const swatch = document.createElement('div');
          swatch.style.width = '20px';
          swatch.style.height = '20px';
          swatch.style.backgroundColor = color;
          swatch.style.border = '1px solid var(--border)';
          swatch.style.cursor = 'pointer';
          swatch.title = color;
          swatch.onclick = () => {
            junctionDefaultColorPicker.value = color;
            applyColor();
          };
          junctionColorSwatches.appendChild(swatch);
        });
      }
    }
  })();

  // Wrapper for Inspector.renderInspector that provides context
  function renderInspector() {
    Inspector.renderInspector({
      selection,
      components,
      wires,
      junctions,
      nets,
      activeNetClass,
      globalUnits,
      defaultResistorStyle,
      junctionDotSize,
      junctionCustomSize,
      junctionDefaultColor,
      NET_CLASSES,
      THEME,
      NM_PER_MM,
      UNIT_OPTIONS: {
        resistor: ['\u03A9', 'k\u03A9', 'M\u03A9'],
        capacitor: ['pF', 'nF', '\u00B5F', 'mF'],
        inductor: ['\u00B5H', 'mH', 'H']
      },
      pushUndo,
      redrawCanvasOnly,
      redraw,
      renderNetList,
      renderInspector: () => renderInspector(),
      uid: (prefix: string) => State.uid(prefix as CounterKey),
      compPinPositions: Components.compPinPositions,
      snap: (val: number) => snap(val),
      snapToBaseScalar: (val: number) => snapToBaseScalar(val),
      swpForWireSegment: (wireId: string, segIndex: number) => swpForWireSegment(wireId, segIndex),
      ensureStroke: (w: Wire) => ensureStroke(w),
      effectiveStroke: (w: Wire, nc: NetClass, th: Theme) => effectiveStroke(w, nc, th),
      netClassForWire: (w: Wire) => Netlist.netClassForWire(w, NET_CLASSES, activeNetClass),
      updateWireDOM: (w: Wire) => updateWireDOM(w),
      restrokeSwpSegments: (swp: SWP | null, patch: Partial<Stroke>) => restrokeSwpSegments(swp, patch),
      midOfSeg: (pts: Point[], idx: number) => Geometry.midOfSeg(pts, idx),
      reselectNearestAt: (p: Point) => reselectNearestAt(p),
      normalizeAllWires: () => normalizeAllWires(),
      rebuildTopology: () => rebuildTopology(),
      wiresEndingAt: (pt: Point) => wiresEndingAt(pt),
      selecting: (kind, id, segIndex) => selecting(kind, id, segIndex),
      pxToNm: (px: number) => pxToNm(px),
      nmToPx: (nm: number) => nmToPx(nm),
      mmToPx: (mm: number) => mmToPx(mm),
      formatDimForDisplay: (nm: number, units: 'mm' | 'in' | 'mils') => formatDimForDisplay(nm, units),
      parseDimInput: (str: string) => parseDimInput(str, globalUnits),
      rgba01ToCss: (c: RGBA01) => rgba01ToCss(c),
      colorToHex: (css: string) => colorToHex(css),
      dashArrayFor: (type: string) => dashArrayFor(type as StrokeType),
      setAttrs: (el: SVGElement, attrs: Record<string, any>) => Utils.setAttrs(el, attrs)
    }, inspector, inspectorNone);
  }

  // ====== Embed / overlap helpers ======
  function isEmbedded(c) { return Move.isEmbedded(createMoveContext(), c); }
  function overlapsAnyOther(c) { return Move.overlapsAnyOther(createMoveContext(), c); }
  function overlapsAnyOtherAt(c, x, y) { return Move.overlapsAnyOtherAt(createMoveContext(), c, x, y); }

  function pinsCoincideAnyAt(c, x, y, eps = 0.75) { return Move.pinsCoincideAnyAt(createMoveContext(), c, x, y, eps); }
  function moveSelectedBy(dx, dy) { 
    // Try constraint-based movement first
    const moveSel = getFirstSelection();
    if (USE_CONSTRAINTS && constraintSolver && moveSel && moveSel.kind === 'component') {
      return moveComponentWithConstraints(dx, dy);
    }
    
    // Fallback to existing movement logic
    return Move.moveSelectedBy(createMoveContext(), dx, dy); 
  }
  
  function moveComponentWithConstraints(dx: number, dy: number) {
    const constraintSel = getFirstSelection();
    if (!constraintSolver || !constraintSel || constraintSel.kind !== 'component') return;
    
    const c = components.find(comp => comp.id === constraintSel.id);
    if (!c) return;
    
    // Calculate proposed position
    const proposedX = snap(c.x + dx);
    const proposedY = snap(c.y + dy);
    
    // Use constraint solver
    const result = constraintSolver.solve(c.id, { x: proposedX, y: proposedY });
    
    if (result.allowed) {
      // Move the component
      c.x = result.finalPosition.x;
      c.y = result.finalPosition.y;
      
      // Apply any cascading updates to other entities
      for (const update of result.affectedEntities) {
        if (update.id !== c.id) {
          // Handle other entity updates (wires, junctions, etc.)
          console.log('Constraint update:', update);
        }
      }
      
      // Update UI
      rebuildTopology();
      redraw();
      renderInspector();
    } else {
      // Movement blocked - do NOT move the component
      console.log('Movement blocked by constraints:', 
        result.violatedConstraints.map(v => v.reason).join(', '));
      // Component stays at current position
    }
  }

  // --- Mend helpers ---
  // Find a wire whose **endpoint** is near the given point; returns {w, endIndex:0|n-1}
  function findWireEndpointNear(pt, tol = 0.9) {
    for (const w of wires) {
      const n = w.points.length;
      if (n < 2) continue;
      if (Geometry.dist2(w.points[0], pt) <= tol * tol) return { w, endIndex: 0 };
      if (Geometry.dist2(w.points[n - 1], pt) <= tol * tol) return { w, endIndex: n - 1 };
    }
    return null;
  }
  // Split wires at T-junction points (where one wire's endpoint touches another's segment)
  // This must be called BEFORE rebuildTopology() to ensure proper wire segmentation
  function splitWiresAtTJunctions() {
    let segments = [];
    for (const w of wires) {
      const pts = w.points || [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = { x: Math.round(pts[i].x), y: Math.round(pts[i].y) };
        const b = { x: Math.round(pts[i + 1].x), y: Math.round(pts[i + 1].y) };
        segments.push({ w, i, a, b });
      }
    }
    
    function isEndpoint(pt, seg) {
      return (pt.x === seg.a.x && pt.y === seg.a.y) || (pt.x === seg.b.x && pt.y === seg.b.y);
    }
    
    let intersectionPoints = [];
    // Find T-junctions: endpoint of one wire lands on interior of another wire's segment
    for (let i = 0; i < segments.length; i++) {
      const s1 = segments[i];
      for (let j = 0; j < segments.length; j++) {
        if (i === j) continue;
        const s2 = segments[j];
        if (s1.w.id === s2.w.id) continue;
        
        // Check s1.a (start point)
        if (!isEndpoint(s1.a, s2)) {
          if (
            (s2.a.x === s2.b.x && s1.a.x === s2.a.x && Math.min(s2.a.y, s2.b.y) < s1.a.y && s1.a.y < Math.max(s2.a.y, s2.b.y)) ||
            (s2.a.y === s2.b.y && s1.a.y === s2.a.y && Math.min(s2.a.x, s2.b.x) < s1.a.x && s1.a.x < Math.max(s2.a.x, s2.b.x))
          ) {
            intersectionPoints.push(Geometry.keyPt(s1.a));
          }
        }
        // Check s1.b (end point)
        if (!isEndpoint(s1.b, s2)) {
          if (
            (s2.a.x === s2.b.x && s1.b.x === s2.a.x && Math.min(s2.a.y, s2.b.y) < s1.b.y && s1.b.y < Math.max(s2.a.y, s2.b.y)) ||
            (s2.a.y === s2.b.y && s1.b.y === s2.a.y && Math.min(s2.a.x, s2.b.x) < s1.b.x && s1.b.x < Math.max(s2.a.x, s2.b.x))
          ) {
            intersectionPoints.push(Geometry.keyPt(s1.b));
          }
        }
      }
    }
    
    intersectionPoints = Array.from(new Set(intersectionPoints));
    if (intersectionPoints.length === 0) return; // No T-junctions to split
    
    // Build map of wires that need splitting
    const insertMap = new Map();
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      for (const k of intersectionPoints) {
        const [ix, iy] = k.split(',').map(Number);
        if (
          ((s.a.x === s.b.x && s.a.x === ix && Math.min(s.a.y, s.b.y) < iy && iy < Math.max(s.a.y, s.b.y)) ||
            (s.a.y === s.b.y && s.a.y === iy && Math.min(s.a.x, s.b.x) < ix && ix < Math.max(s.a.x, s.b.x)))
        ) {
          if (!insertMap.has(s.w.id)) insertMap.set(s.w.id, []);
          insertMap.get(s.w.id).push({ x: ix, y: iy });
        }
      }
    }
    
    // Split wires that have T-junction points on them
    for (const [wid, ptsToInsert] of insertMap.entries()) {
      const w = wires.find(wire => wire.id === wid);
      if (!w || !ptsToInsert.length) continue;
      
      let newPts = [w.points[0]];
      for (let i = 1; i < w.points.length; i++) {
        const a = w.points[i - 1], b = w.points[i];
        let segPts = ptsToInsert.filter(pt => {
          if (a.x === b.x && pt.x === a.x && Math.min(a.y, b.y) < pt.y && pt.y < Math.max(a.y, b.y)) return true;
          if (a.y === b.y && pt.y === a.y && Math.min(a.x, b.x) < pt.x && pt.x < Math.max(a.x, b.x)) return true;
          return false;
        });
        segPts.sort((p1, p2) => (a.x === b.x) ? (p1.y - p2.y) : (p1.x - p2.x));
        for (const p of segPts) newPts.push(p);
        newPts.push(b);
      }
      w.points = newPts.filter((pt, idx, arr) => idx === 0 || pt.x !== arr[idx - 1].x || pt.y !== arr[idx - 1].y);
    }
  }

  function normalizeAllWires() {
    // Convert each wire polyline into one or more 2-point segment wires.
    // This gives each straight segment its own persistent `id` and stroke.
    const next: Wire[] = [];
    for (const w of wires) {
      const c = Geometry.normalizedPolylineOrNull(w.points);
      if (!c) continue;
      if (c.length === 2) {
        // Already a single segment — preserve id to keep stability where possible
        next.push({ id: w.id, points: c, color: w.color || defaultWireColor, stroke: w.stroke, netId: (w as any).netId || 'default' } as Wire);
      } else {
        // Break into per-segment wires. Each segment gets a fresh id.
        for (let i = 0; i < c.length - 1; i++) {
          const pts = [c[i], c[i + 1]];
          next.push({ id: State.uid('wire'), points: pts, color: w.color || defaultWireColor, stroke: w.stroke ? { ...w.stroke } : undefined, netId: (w as any).netId || 'default' } as Wire);
        }
      }
    }
    wires = next;
  }

  // Split a polyline keeping ONLY the segments whose indices are in keepIdxSet.
  // Replaces the original wire with up to three wires: left, mid, right.
  // Returns the newly-created mid wire (whose points length==2) or the original wire
  // if no split was necessary. The new wires copy the original stroke/color/netId.
  function isolateWireSegment(w: Wire, segIndex: number): Wire | null {
    if (!w) return null;
    if (!Number.isInteger(segIndex) || segIndex < 0 || segIndex >= (w.points.length - 1)) return null;
    // If the wire already consists of a single segment, nothing to do.
    if (w.points.length === 2) return w;

    const leftPts = w.points.slice(0, segIndex + 1);
    const midPts = w.points.slice(segIndex, segIndex + 2);
    const rightPts = w.points.slice(segIndex + 1);

    const L = Geometry.normalizedPolylineOrNull(leftPts);
    const M = Geometry.normalizedPolylineOrNull(midPts);
    const R = Geometry.normalizedPolylineOrNull(rightPts);

    // Remove the original wire and insert the pieces in its place
    wires = wires.filter(x => x.id !== w.id);
    let midWire: Wire | null = null;
    const pushPiece = (pts: Point[] | null) => {
      if (!pts) return null;
      const nw: Wire = { id: State.uid('wire'), points: pts, color: w.color, stroke: w.stroke ? { ...w.stroke } : undefined, netId: (w as any).netId || 'default' } as Wire;
      wires.push(nw);
      return nw;
    };

    // Preserve ordering: left, mid, right
    if (L) pushPiece(L);
    if (M) midWire = pushPiece(M);
    if (R) pushPiece(R);

    // Normalize and rebuild topology so downstream code sees updated indices
    normalizeAllWires();
    rebuildTopology();
    return midWire;
  }

  // === Inline merge: join collinear wires that meet end-to-end (excluding component pins) ===
  function allPinKeys() {
    const s = new Set();
    for (const c of components) {
      const pins = Components.compPinPositions(c).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
      for (const p of pins) s.add(Geometry.keyPt(p));
    }
    return s;
  }
  function axisAtEndpoint(w, endIndex) {
    const n = w.points.length; if (n < 2) return null;
    const a = w.points[endIndex];
    const b = (endIndex === 0) ? w.points[1] : w.points[n - 2];
    if (a.y === b.y) return 'x';
    if (a.x === b.x) return 'y';
    return null;
  }
  function endpointPairsByKey() {
    // key -> array of { w, endIndex, axis, other }
    const map = new Map();
    for (const w of wires) {
      const n = w.points.length;
      if (n < 2) continue;
      const ends = [0, n - 1];
      for (const endIndex of ends) {
        const p = w.points[endIndex];
        const key = Geometry.keyPt({ x: Math.round(p.x), y: Math.round(p.y) });
        const ax = axisAtEndpoint(w, endIndex);
        const other = (endIndex === 0) ? w.points[1] : w.points[n - 2];
        (map.get(key) || (map.set(key, []), map.get(key))).push({ w, endIndex, axis: ax, other });
      }
    }
    return map;
  }

  function unifyInlineWires() {
    const pinKeys = allPinKeys();
    let anyChange = false;

    // Iterate merges until stable, but guard against pathological loops.
    const MAX_ITER = 200;
    let iter = 0;
    const seen = new Set<string>();
    while (iter < MAX_ITER) {
      iter++;
      let mergedThisPass = false;

      // detect repeated global state to avoid endless cycles
      const sig = wires.map(w => `${w.id}:${w.points.map(p => Geometry.keyPt(p)).join('|')}`).join(';');
      if (seen.has(sig)) {
        console.warn('unifyInlineWires: detected repeating state, aborting merge loop', { iter, sig });
        break;
      }
      seen.add(sig);

      const pairs = endpointPairsByKey();
      // Try to merge exactly-two-endpoint nodes that are collinear and not at a component pin or junction.
      for (const [key, list] of pairs) {
        if (pinKeys.has(key)) continue;          // never merge across component pins
        
        // Check if there's a junction at this location - never merge across junctions
        // But ignore suppressed junctions (invisible markers for deleted junctions)
        const [kx, ky] = key.split(',').map(n => parseInt(n, 10));
        const hasJunction = junctions.some(j => {
          if (j.suppressed) return false;  // Ignore suppressed junctions
          const jx = Math.round(j.at.x);
          const jy = Math.round(j.at.y);
          return jx === kx && jy === ky;
        });
        if (hasJunction) continue;
        
        if (list.length !== 2) continue;         // only consider clean 1:1 joins
        const a = list[0], b = list[1];
        if (a.w === b.w) continue;               // ignore self-joins
        if (!a.axis || !b.axis) continue;        // must both be axis-aligned
        if (a.axis !== b.axis) continue;         // must be the same axis

        // Choose the "existing/first" wire as primary by their order in the
        // `wires` array (earlier index = older/existing). Primary's properties
        // will be adopted for the merged segment.
        const idxA = wires.indexOf(a.w);
        const idxB = wires.indexOf(b.w);
        // If either wire reference is no longer present in `wires` (because a prior
        // merge in this same scan mutated the array), skip this stale pair and
        // continue. We'll recompute pairs on the next outer iteration.
        if (idxA === -1 || idxB === -1) {
          continue;
        }
        const primary = (idxA <= idxB) ? a : b;
        const secondary = (primary === a) ? b : a;

        // Orient primary (left) so it ENDS at the join, secondary (right) so it STARTS at the join
        // Ensure endpoints are canonicalized to base-grid before merging to
        // avoid tiny rounding differences that can re-split after normalization.
        const lp = primary.w.points.map(p => ({ x: snapToBaseScalar(p.x), y: snapToBaseScalar(p.y) }));
        const rp = secondary.w.points.map(p => ({ x: snapToBaseScalar(p.x), y: snapToBaseScalar(p.y) }));
        const lPts = (primary.endIndex === lp.length - 1) ? lp : lp.reverse();
        const rPts = (secondary.endIndex === 0) ? rp : rp.reverse();

        const mergedPts = lPts.concat(rPts.slice(1));  // drop duplicate join point
        const merged = Geometry.normalizedPolylineOrNull(mergedPts);
        if (!merged) continue;

        // Adopt primary wire's stroke/color (preserve its id when possible)
        ensureStroke(primary.w);
        const newStroke = strokeOfWire(primary.w);
        const newColor = rgba01ToCss(newStroke.color);
        const primaryId = primary.w.id;

        // Replace both wires with a single merged segment that uses the primary id
        const countBefore = wires.length;
        wires = wires.filter(w => w !== primary.w && w !== secondary.w);
        wires.push({ id: primaryId, points: merged, color: newColor, stroke: newStroke, netId: primary.w.netId || 'default' });

        mergedThisPass = true;
        anyChange = true;
        // normalize and check that progress was made (wire count decreased)
        normalizeAllWires();
        if (wires.length >= countBefore) {
          // Emit a richer diagnostic to help reproduce and debug why the merge
          // failed to reduce the wire count (likely due to normalization/splitting).
          console.warn('unifyInlineWires: merge did not reduce wire count; aborting to avoid loop', {
            key, primaryId, primaryIdx: idxA, secondaryIdx: idxB, countBefore, countAfter: wires.length,
            primaryPts: primary.w.points.slice(), secondaryPts: secondary.w.points.slice(), mergedPts: merged, sigBefore: sig
          });
          break;
        }
        // restart scanning from fresh topology by breaking out of the inner loop so
        // the outer while() recomputes endpoint pairs against the new `wires` list.
        rebuildTopology();
        break;
      }

      if (mergedThisPass) {
        // already continued after handling merge
        continue;
      }

      // nothing merged on this pass -> stable
      break;
    }

    if (iter >= MAX_ITER) {
      console.warn('unifyInlineWires: reached iteration limit', MAX_ITER);
    }
    return anyChange;
  }

  // Apply a stroke "patch" to all segments in the SWP.
  // Segments outside the SWP keep their original stroke/color.
  function restrokeSwpSegments(swp: SWP | null, patch: Partial<Stroke>) {
    if (!swp) return;
    const result: Wire[] = [];
    // With per-segment wires, a SWP lists contributing wire IDs in `edgeWireIds`.
    // Apply the patch to any wire whose id is included in that list; leave others untouched.
    const swpSet = new Set((swp.edgeWireIds || []).filter(Boolean));
    for (const w of wires) {
      ensureStroke(w);
      if (!swpSet.has(w.id)) {
        result.push(w);
        continue;
      }
      // This wire is part of the SWP: apply the patch to the whole two-point segment.
      const src = w.stroke!;
      const nextWidthMm = (patch.width != null ? patch.width : src.width);
      const nextWidthNm = (patch.width != null ? Math.round(patch.width * NM_PER_MM) : ((src as any).widthNm != null ? (src as any).widthNm : Math.round((src.width || 0) * NM_PER_MM)));
      const next: Stroke = {
        width: nextWidthMm,
        type: (patch.type != null ? patch.type : src.type),
        color: (patch.color != null ? patch.color : src.color)
      };
      (next as any).widthNm = nextWidthNm;
      const css = rgba01ToCss(next.color);
      result.push({ id: w.id, points: w.points.slice(), color: css, stroke: next, netId: w.netId || 'default' });
    }
    wires = result;
    normalizeAllWires();
    rebuildTopology(); // caller will refresh selection + UI
  }

  // ===== CSS <-> RGBA helpers (0..1) + internal<->KiCad wire adapters =====

  // Map Stroke.type to SVG dash arrays for preview
  function dashArrayFor(type: Stroke['type']): string | null {
    switch (type) {
      case 'dash': return '8 6';
      case 'dot': return '1 6';
      case 'dash_dot': return '8 6 1 6';
      case 'dash_dot_dot': return '8 6 1 6 1 6';
      default: return null; // 'solid' or 'default'
    }
  }

  // Small inline SVG preview for a Stroke
  // function buildStrokePreview(st: Stroke): SVGSVGElement {
  //   const svg = document.createElementNS('http://www.w3.org/2000/svg','svg') as unknown as SVGSVGElement;
  //   svg.setAttribute('width','100%');
  //   svg.setAttribute('height','28');
  //   svg.setAttribute('viewBox','0 0 200 28');
  //   const line = document.createElementNS('http://www.w3.org/2000/svg','line');
  //   line.setAttribute('x1','8'); line.setAttribute('x2','192');
  //   line.setAttribute('y1','14'); line.setAttribute('y2','14');
  //   line.setAttribute('stroke', rgba01ToCss(st.color as RGBA01));
  //   line.setAttribute('stroke-width', String(Math.max(0.25, st.width || 0.25)));
  //   const d = dashArrayFor(st.type);
  //   if(d) line.setAttribute('stroke-dasharray', d);
  //   svg.appendChild(line);
  //   return svg;
  // }

  // px rendering helpers imported from conversions.ts

  // Precedence: explicit wire.stroke → netclass → theme.
  // NOTE: width<=0 OR type==='default' means "don’t override lower-precedence value".
  function effectiveStroke(w: Wire, nc: NetClass, th: Theme): Stroke {
    // Helper to obtain width in mm for a Stroke: prefer widthNm if present.
    const widthMmOf = (s?: Stroke | null): number => {
      if (!s) return 0;
      // @ts-ignore allow optional widthNm property
      if (s && (s as any).widthNm != null) return (s as any).widthNm / NM_PER_MM;
      return s.width || 0;
    };

    const from = (base: Stroke, over?: Stroke): Stroke => {
      if (!over) return base;
      const baseW = widthMmOf(base);
      const overW = widthMmOf(over);
      return {
        width: (overW && overW > 0) ? overW : baseW,
        type: (over && over.type && over.type !== 'default') ? over.type : base.type,
        // New rule: if the wire is set to *full* netclass defaults (width<=0 AND type='default'),
        // use the base (netclass/theme) color; otherwise keep the wire's explicit color even if
        // the style is 'default' so only the pattern is inherited.
        color: ((overW ?? 0) <= 0 && (!over || !over.type || over.type === 'default'))
          ? base.color : ((over && over.color) || base.color)
      };
    };
    const sWire = w.stroke;
    const sNC = nc.wire;
    const sTH = th.wire;
    const result = from(from(sTH, sNC), sWire);

    // Special handling: if wire color is black (r≈0, g≈0, b≈0), render as white in dark mode
    const isBlack = result.color.r < 0.01 && result.color.g < 0.01 && result.color.b < 0.01;
    if (isBlack) {
      const bg = getComputedStyle(document.body).backgroundColor;
      const rgb = bg.match(/\d+/g)?.map(Number) || [0, 0, 0];
      const [r, g, b] = rgb;
      const srgb = [r / 255, g / 255, b / 255].map(v => (v <= 0.03928) ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
      if (L < 0.5) {
        // Dark mode: render black as white
        result.color = { r: 1, g: 1, b: 1, a: result.color.a };
      }
    }

    // Special handling: if wire color is white (r≈1, g≈1, b≈1), render as black in light mode
    const isWhite = result.color.r > 0.99 && result.color.g > 0.99 && result.color.b > 0.99;
    if (isWhite) {
      const bg = getComputedStyle(document.body).backgroundColor;
      const rgb = bg.match(/\d+/g)?.map(Number) || [255, 255, 255];
      const [r, g, b] = rgb;
      const srgb = [r / 255, g / 255, b / 255].map(v => (v <= 0.03928) ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
      if (L >= 0.5) {
        // Light mode: render white as black
        result.color = { r: 0, g: 0, b: 0, a: result.color.a };
      }
    }

    return result;
  }

  // NEW: stroke used for **newly placed wires** from the global Wire control.
  // Returning `undefined` means: do not attach an explicit stroke → let netclass/theme render it.
  function strokeForNewWires(): Stroke | undefined {
    // If the toolbar is set to use netclass defaults, we don't provide an explicit stroke.
    // That lets effectiveStroke() fall back to the netclass/theme settings.
    if (WIRE_DEFAULTS.useNetclass) return undefined;

    // Clone the configured explicit stroke so we don't accidentally share references.
    const st = WIRE_DEFAULTS.stroke;
    const out: Stroke = {
      width: st.width,
      type: st.type,
      color: { r: st.color.r, g: st.color.g, b: st.color.b, a: st.color.a }
    };
    // preserve nm precision when available
    if ((st as any).widthNm != null) (out as any).widthNm = (st as any).widthNm;
    else if (typeof st.width === 'number') (out as any).widthNm = Math.round((st.width || 0) * NM_PER_MM);
    return out;
  }

  // Ensure a wire has a stroke object (mapping legacy color→stroke.color, width=0, type='default')
  function ensureStroke(w: Wire): void {
    if (!w.stroke) {
      w.stroke = { width: 0, type: 'default', color: cssToRGBA01(w.color || defaultWireColor) };
    }
  }

  // Choose a sensible default wire stroke to match our current look (no behavior change)
  // NOTE: KiCad is mm-based; we’ll start with 0.25 mm as a typical schematic wire width.
  const DEFAULT_KICAD_STROKE: Stroke = {
    width: 0.25,
    type: 'solid',
    color: cssToRGBA01(defaultWireColor)
  };

  // Adapter: current internal wire -> KiCad-style KWire (keeps geometry; maps color only)
  // Adapter: current internal wire -> KiCad-style KWire (keeps geometry; maps color only)
  function toKicadWire(
    w: { id: string; points: Point[]; color?: string },
    strokeBase: Stroke = DEFAULT_KICAD_STROKE
  ): KWire {
    const col = w.color || defaultWireColor;
    return {
      id: w.id,
      points: w.points.map(p => ({ x: p.x, y: p.y })),    // shallow copy
      stroke: {
        ...strokeBase,
        color: cssToRGBA01(col),
      },
      netId: null,
    };
  }

  // Batch adapter (not used yet; future export step can call this)
  function collectKicadWires(): KWire[] {
    return wires.map(w => toKicadWire(w));
  }

  // ====== Save / Load ======
  document.getElementById('saveBtn').addEventListener('click', saveJSON);
  document.getElementById('loadBtn').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput')!.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { try { loadFromJSON(reader.result); } catch (err) { alert('Failed to load JSON: ' + err); } };
    reader.readAsText(f);
  });

  function saveJSON() {
    FileIO.saveJSON({
      components,
      wires,
      junctions,
      nets,
      activeNetClass,
      NET_CLASSES,
      THEME,
      defaultResistorStyle,
      counters,
      GRID,
      projTitle,
      defaultResistorStyleSelect,
      normalizeAllWires,
      ensureStroke: (w: Wire) => ensureStroke(w),
      rgba01ToCss,
      cssToRGBA01,
      renderNetList,
      redraw,
      keyPt: (p: { x: number; y: number }) => Geometry.keyPt(p),
      selection,
      drawing,
      gDrawing
    });
  }

  function loadFromJSON(text) {
    FileIO.loadFromJSON({
      components,
      wires,
      junctions,
      nets,
      activeNetClass,
      NET_CLASSES,
      THEME,
      defaultResistorStyle,
      counters,
      GRID,
      projTitle,
      defaultResistorStyleSelect,
      normalizeAllWires,
      ensureStroke: (w: Wire) => ensureStroke(w),
      rgba01ToCss,
      cssToRGBA01,
      renderNetList,
      redraw,
      keyPt: (p: { x: number; y: number }) => Geometry.keyPt(p),
      selection,
      drawing,
      gDrawing,
      compPinPositions: Components.compPinPositions,
      breakWiresForComponent,
      deleteBridgeBetweenPins
    }, text);
  }

  // ====== Topology: nodes, edges, SWPs ======
  function rebuildTopology(): void {
    // Skip automatic junction detection and wire splitting during wire stretch
    // This prevents junctions from appearing to move as wires are dragged
    const skipAutoJunctionLogic = wireStretchState !== null;
    
    const nodes = new Map();     // key -> {x,y,edges:Set<edgeId>, axDeg:{x:number,y:number}}
    const edges = [];            // {id, wireId, i, a:{x,y}, b:{x,y}, axis:'x'|'y'|null, akey, bkey}
    const axisOf = (a, b) => (a.y === b.y) ? 'x' : (a.x === b.x) ? 'y' : null;
    function addNode(p) {
      const k = Geometry.keyPt(p);
      if (!nodes.has(k)) nodes.set(k, { x: Math.round(p.x), y: Math.round(p.y), edges: new Set(), axDeg: { x: 0, y: 0 } });
      return k;
    }
    // Build edges from polylines (axis-aligned only for SWPs)
    // --- NEW: Insert nodes at all true wire-to-wire intersections (not just endpoints) ---
    // Step 1: Collect all segment endpoints
    let segmentPoints = [];
    let segments = [];
    for (const w of wires) {
      const pts = w.points || [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = { x: Math.round(pts[i].x), y: Math.round(pts[i].y) };
        const b = { x: Math.round(pts[i + 1].x), y: Math.round(pts[i + 1].y) };
        segments.push({ w, i, a, b });
        segmentPoints.push(Geometry.keyPt(a));
        segmentPoints.push(Geometry.keyPt(b));
      }
    }
    // Step 2: Find all true intersections (not at endpoints) AND T-junctions (endpoint-to-segment)
    function isEndpoint(pt, seg) {
      return (pt.x === seg.a.x && pt.y === seg.a.y) || (pt.x === seg.b.x && pt.y === seg.b.y);
    }
    function segsCross(s1, s2) {
      // Only axis-aligned segments
      if (s1.a.x === s1.b.x && s2.a.y === s2.b.y) {
        // s1 vertical, s2 horizontal
        if (
          Math.min(s1.a.y, s1.b.y) < s2.a.y && s2.a.y < Math.max(s1.a.y, s1.b.y) &&
          Math.min(s2.a.x, s2.b.x) < s1.a.x && s1.a.x < Math.max(s2.a.x, s2.b.x)
        ) {
          return { x: s1.a.x, y: s2.a.y };
        }
      } else if (s1.a.y === s1.b.y && s2.a.x === s2.b.x) {
        // s1 horizontal, s2 vertical
        if (
          Math.min(s2.a.y, s2.b.y) < s1.a.y && s1.a.y < Math.max(s2.a.y, s2.b.y) &&
          Math.min(s1.a.x, s1.b.x) < s2.a.x && s2.a.x < Math.max(s1.a.x, s1.b.x)
        ) {
          return { x: s2.a.x, y: s1.a.y };
        }
      }
      return null;
    }
    let intersectionPoints = [];
    // REMOVE: True crossings (plus sign) - do not add junctions for these
    // T-junctions: endpoint of one wire lands on interior of another wire's segment
    for (let i = 0; i < segments.length; i++) {
      const s1 = segments[i];
      for (let j = 0; j < segments.length; j++) {
        if (i === j) continue;
        const s2 = segments[j];
        if (s1.w.id === s2.w.id) continue;
        // Check s1.a (start point)
        if (!isEndpoint(s1.a, s2)) {
          // Is s1.a on s2 (interior)?
          if (
            (s2.a.x === s2.b.x && s1.a.x === s2.a.x && Math.min(s2.a.y, s2.b.y) < s1.a.y && s1.a.y < Math.max(s2.a.y, s2.b.y)) ||
            (s2.a.y === s2.b.y && s1.a.y === s2.a.y && Math.min(s2.a.x, s2.b.x) < s1.a.x && s1.a.x < Math.max(s2.a.x, s2.b.x))
          ) {
            intersectionPoints.push(Geometry.keyPt(s1.a));
          }
        }
        // Check s1.b (end point)
        if (!isEndpoint(s1.b, s2)) {
          if (
            (s2.a.x === s2.b.x && s1.b.x === s2.a.x && Math.min(s2.a.y, s2.b.y) < s1.b.y && s1.b.y < Math.max(s2.a.y, s2.b.y)) ||
            (s2.a.y === s2.b.y && s1.b.y === s2.a.y && Math.min(s2.a.x, s2.b.x) < s1.b.x && s1.b.x < Math.max(s2.a.x, s2.b.x))
          ) {
            intersectionPoints.push(Geometry.keyPt(s1.b));
          }
        }
      }
    }
    // Remove duplicates
    intersectionPoints = Array.from(new Set(intersectionPoints));
    // Step 3: Split wire polylines at all intersection points
    // Build a map: wireId -> array of points to insert (as {x, y})
    const insertMap = new Map();
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      for (const k of intersectionPoints) {
        const [ix, iy] = k.split(',').map(Number);
        // Is this intersection on this segment?
        if (
          ((s.a.x === s.b.x && s.a.x === ix && Math.min(s.a.y, s.b.y) < iy && iy < Math.max(s.a.y, s.b.y)) ||
            (s.a.y === s.b.y && s.a.y === iy && Math.min(s.a.x, s.b.x) < ix && ix < Math.max(s.a.x, s.b.x)))
        ) {
          if (!insertMap.has(s.w.id)) insertMap.set(s.w.id, []);
          insertMap.get(s.w.id).push({ x: ix, y: iy });
        }
      }
    }

    // For each wire, insert all intersection points into its polyline, then sort
    for (const [wid, ptsToInsert] of insertMap.entries()) {
      const w = wires.find(w => w.id === wid);
      if (!w || !ptsToInsert.length) continue;
      // Insert and sort points along the wire
      let newPts = [w.points[0]];
      for (let i = 1; i < w.points.length; i++) {
        const a = w.points[i - 1], b = w.points[i];
        // Find all intersection points on this segment
        let segPts = ptsToInsert.filter(pt => {
          if (a.x === b.x && pt.x === a.x && Math.min(a.y, b.y) < pt.y && pt.y < Math.max(a.y, b.y)) return true;
          if (a.y === b.y && pt.y === a.y && Math.min(a.x, b.x) < pt.x && pt.x < Math.max(a.x, b.x)) return true;
          return false;
        });
        // Sort along the segment
        segPts.sort((p1, p2) => (a.x === b.x) ? (p1.y - p2.y) : (p1.x - p2.x));
        for (const p of segPts) newPts.push(p);
        newPts.push(b);
      }
      // Remove duplicates
      w.points = newPts.filter((pt, idx, arr) => idx === 0 || pt.x !== arr[idx - 1].x || pt.y !== arr[idx - 1].y);
    }
    
    // Now, rebuild segmentPoints from all wires (now split at intersections)
    segmentPoints = [];
    for (const w of wires) {
      const pts = w.points || [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = { x: Math.round(pts[i].x), y: Math.round(pts[i].y) };
        const b = { x: Math.round(pts[i + 1].x), y: Math.round(pts[i + 1].y) };
        segmentPoints.push(Geometry.keyPt(a));
        segmentPoints.push(Geometry.keyPt(b));
      }
    }
    // Step 4: Add nodes for all unique points
    for (const k of new Set(segmentPoints)) {
      const [x, y] = k.split(',').map(Number);
      addNode({ x, y });
    }
    // Step 5: Build edges, splitting segments at intersection points
    for (const w of wires) {
      const pts = w.points || [];
      let segPts = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const a = { x: Math.round(pts[i - 1].x), y: Math.round(pts[i - 1].y) };
        const b = { x: Math.round(pts[i].x), y: Math.round(pts[i].y) };
        // Find all intersection points on this segment (excluding endpoints)
        let segIntersections = [];
        for (const k of intersectionPoints) {
          const [ix, iy] = k.split(',').map(Number);
          // Is this intersection on this segment?
          if (
            ((a.x === b.x && a.x === ix && Math.min(a.y, b.y) < iy && iy < Math.max(a.y, b.y)) ||
              (a.y === b.y && a.y === iy && Math.min(a.x, b.x) < ix && ix < Math.max(a.x, b.x)))
          ) {
            segIntersections.push({ x: ix, y: iy });
          }
        }
        // Sort intersections along the segment
        segIntersections.sort((p1, p2) => (a.x === b.x) ? (p1.y - p2.y) : (p1.x - p2.x));
        // Insert intersection points into segPts
        for (const p of segIntersections) {
          segPts.push(p);
        }
        segPts.push(b);
      }
      // Now, build edges between consecutive segPts
      for (let i = 0; i < segPts.length - 1; i++) {
        const a = { x: segPts[i].x, y: segPts[i].y };
        const b = { x: segPts[i + 1].x, y: segPts[i + 1].y };
        const ax = axisOf(a, b);
        const akey = addNode(a), bkey = addNode(b);
        const id = `${w.id}:${i}`;
        edges.push({ id, wireId: w.id, i, a, b, axis: ax, akey, bkey });
        const na = nodes.get(akey), nb = nodes.get(bkey);
        na.edges.add(id); nb.edges.add(id);
        if (ax) { na.axDeg[ax]++; nb.axDeg[ax]++; }
      }
    }

    // --- Component bridge edges for embedded components ---
    // Add synthetic edges ONLY for components that are truly embedded in a single continuous wire path
    // This allows SWP-based movement while preventing incorrect grouping of unrelated components
    const twoPinForBridge = ['resistor', 'capacitor', 'inductor', 'diode', 'battery', 'ac'];
    for (const c of components) {
      if (!twoPinForBridge.includes(c.type)) continue;
      const pins = Components.compPinPositions(c).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
      if (pins.length !== 2) continue;
      let axis = null;
      if (pins[0].y === pins[1].y) axis = 'x';
      else if (pins[0].x === pins[1].x) axis = 'y';
      if (!axis) continue; // only bridge axis-aligned 2-pin parts
      
      // Find wires touching each pin
      const hitA = findWireEndpointNear(pins[0], 0.9);
      const hitB = findWireEndpointNear(pins[1], 0.9);
      if (!(hitA && hitB)) continue;
      
      // CRITICAL: Only create bridge if the component connects exactly TWO wires (one on each side)
      // Count how many DIFFERENT wires touch the component's pins
      const wiresAtA = [];
      const wiresAtB = [];
      for (const w of wires) {
        const atA = w.points.some(p => Math.abs(p.x - pins[0].x) < 0.5 && Math.abs(p.y - pins[0].y) < 0.5);
        const atB = w.points.some(p => Math.abs(p.x - pins[1].x) < 0.5 && Math.abs(p.y - pins[1].y) < 0.5);
        if (atA) wiresAtA.push(w);
        if (atB) wiresAtB.push(w);
      }
      
      // Only create bridge if each pin touches exactly ONE wire (simple embedded case)
      // If multiple wires touch either pin, component is at a junction - no bridge
      if (wiresAtA.length !== 1 || wiresAtB.length !== 1) continue;
      
      // Also ensure they're different wires
      if (wiresAtA[0].id === wiresAtB[0].id) continue;
      
      const akey = addNode(pins[0]), bkey = addNode(pins[1]);
      const id = `comp:${c.id}`;
      edges.push({ id, wireId: null, i: -1, a: pins[0], b: pins[1], axis, akey, bkey });
      const na = nodes.get(akey), nb = nodes.get(bkey);
      na.edges.add(id); nb.edges.add(id);
      na.axDeg[axis]++; nb.axDeg[axis]++;
    }

    // SWPs: maximal straight runs where interior nodes have axis-degree==2
    const visited = new Set();
    const swps = [];
    const edgeById = new Map(edges.map(e => [e.id, e]));
    function otherEdgeWithSameAxis(nodeKey, fromEdge) {
      const n = nodes.get(nodeKey); if (!n) return null;
      if (!fromEdge.axis) return null;
      if (n.axDeg[fromEdge.axis] !== 2) return null; // branch or dead-end
      for (const eid of n.edges) {
        if (eid === fromEdge.id) continue;
        const e = edgeById.get(eid);
        if (e && e.axis === fromEdge.axis) {
          // ensure this edge actually touches this node
          if (e.akey === nodeKey || e.bkey === nodeKey) return e;
        }
      }
      return null;
    }

    for (const e0 of edges) {
      if (!e0.axis) continue;
      if (visited.has(e0.id)) continue;
      // Walk both directions along the same axis to capture the entire straight run
      const chainSet = new Set();
      function walkDir(cur, enterNodeKey) {
        while (cur && !chainSet.has(cur.id)) {
          chainSet.add(cur.id);
          const nextNodeKey = (cur.akey === enterNodeKey) ? cur.bkey : cur.akey;
          const nxt = otherEdgeWithSameAxis(nextNodeKey, cur);
          if (!nxt) break;
          enterNodeKey = nextNodeKey;
          cur = nxt;
        }
      }
      walkDir(e0, e0.akey);
      walkDir(e0, e0.bkey);
      const chain = [...chainSet].map(id => edgeById.get(id));
      chain.forEach(ed => visited.add(ed.id));

      // Determine endpoints (min/max along axis)
      const allNodes = new Set();
      chain.forEach(ed => { allNodes.add(ed.akey); allNodes.add(ed.bkey); });
      const pts = [...allNodes].map(k => nodes.get(k));
      let start, end, axis = e0.axis;
      if (axis === 'x') {
        pts.sort((u, v) => u.x - v.x);
        start = pts[0]; end = pts[pts.length - 1];
      } else {
        pts.sort((u, v) => u.y - v.y);
        start = pts[0]; end = pts[pts.length - 1];
      }
      // Pick color: "left/top" edge's source wire color
      let leadEdge = chain[0];
      if (axis === 'x') {
        leadEdge = chain.reduce((m, e) => Math.min(e.a.x, e.b.x) < Math.min(m.a.x, m.b.x) ? e : m, chain[0]);
      } else {
        leadEdge = chain.reduce((m, e) => Math.min(e.a.y, e.b.y) < Math.min(m.a.y, m.b.y) ? e : m, chain[0]);
      }
      const leadWire = wires.find(w => w.id === leadEdge.wireId);
      // If all contributing wire segments share the same color, use it; otherwise default to white.
      const segColors = [...new Set(
        chain
          .map(e => e.wireId)
          .filter(Boolean)
          .map(id => (wires.find(w => w.id === id)?.color) || defaultWireColor)
      )];
      const swpColor = (segColors.length === 1) ? segColors[0] : '#FFFFFF';

      // Track both the wire IDs and the exact segment indices per wire.
      const edgeWireIds = [...new Set(chain.map(e => e.wireId).filter(Boolean))];
      const edgeIndicesByWire: Record<string, number[]> = {};
      for (const e of chain) {
        if (!e.wireId) continue;               // skip synthetic component bridges
        (edgeIndicesByWire[e.wireId] ||= []).push(e.i);
      }
      // normalize & sort indices per wire
      for (const k in edgeIndicesByWire) {
        edgeIndicesByWire[k] = [...new Set(edgeIndicesByWire[k])].sort((a, b) => a - b);
      }

      swps.push({
        id: `swp${swps.length + 1}`,
        axis,
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        color: swpColor,
        edgeWireIds,
        edgeIndicesByWire
      });
    }
    // Map components (2-pin only) onto SWPs
    const compToSwp = new Map();
    const twoPin = ['resistor', 'capacitor', 'inductor', 'diode', 'battery', 'ac'];
    for (const c of components) {
      if (!twoPin.includes(c.type)) continue;
      const pins = Components.compPinPositions(c).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
      if (pins.length !== 2) continue;
      for (const s of swps) {
        if (s.axis === 'x') {
          const y = s.start.y;
          const minx = Math.min(s.start.x, s.end.x), maxx = Math.max(s.start.x, s.end.x);
          if (Geometry.eqN(pins[0].y, y) && Geometry.eqN(pins[1].y, y) &&
            Math.min(pins[0].x, pins[1].x) >= minx - 0.5 &&
            Math.max(pins[0].x, pins[1].x) <= maxx + 0.5) {
            compToSwp.set(c.id, s.id); break;
          }
        } else if (s.axis === 'y') {
          const x = s.start.x;
          const miny = Math.min(s.start.y, s.end.y), maxy = Math.max(s.start.y, s.end.y);
          if (Geometry.eqN(pins[0].x, x) && Geometry.eqN(pins[1].x, x) &&
            Math.min(pins[0].y, pins[1].y) >= miny - 0.5 &&
            Math.max(pins[0].y, pins[1].y) <= maxy + 0.5) {
            compToSwp.set(c.id, s.id); break;
          }
        }
      }
    }
    topology = { nodes: [...nodes.values()], edges, swps, compToSwp };

    // --- JUNCTION LOGIC: Add junctions for wire-to-wire T-junctions (including at component pins) ---
    // Skip automatic junction detection during wire stretch to prevent junctions from moving
    if (!skipAutoJunctionLogic) {
      // Preserve manually placed junctions, reuse automatic junction IDs
      const manualJunctions = junctions.filter(j => j.manual);
      const oldAutomaticJunctions = junctions.filter(j => !j.manual && !j.suppressed);
      junctions = [...manualJunctions];
    // Build a set of all component pin positions (rounded)
    const pinKeys = new Set();
    for (const c of components) {
      const pins = Components.compPinPositions(c).map(p => `${Math.round(p.x)},${Math.round(p.y)}`);
      for (const k of pins) pinKeys.add(k);
    }
    // For each node in the topology, check if it is a valid wire-to-wire intersection
    for (const node of nodes.values()) {
      const k = `${node.x},${node.y}`;
      // Gather all wires touching this node
      const wireIds = new Set();
      let hasMidSegment = false;
      for (const eid of node.edges) {
        const edge = edges.find(e => e.id === eid);
        if (edge && edge.wireId) {
          wireIds.add(edge.wireId);
          const w = wires.find(w => w.id === edge.wireId);
          if (w) {
            // Check if node is NOT an endpoint for this wire
            const isStart = (Math.round(w.points[0].x) === node.x && Math.round(w.points[0].y) === node.y);
            const isEnd = (Math.round(w.points[w.points.length - 1].x) === node.x && Math.round(w.points[w.points.length - 1].y) === node.y);
            if (!isStart && !isEnd) hasMidSegment = true;
          }
        }
      }
      // Add a junction for wire-to-wire connections:
      // - At least 3 wires meet (multiple endpoints at same point), OR
      // - At least 2 wires meet AND at least one wire passes through (T-junction), OR
      // - At least 2 wires meet at a component pin
      const isComponentPin = pinKeys.has(k);
      const shouldCreateJunction = (wireIds.size >= 3) || (wireIds.size >= 2 && (hasMidSegment || isComponentPin));
      
      if (shouldCreateJunction) {
        // Check if this location already has a manual junction (including suppressed ones)
        const hasManualJunction = manualJunctions.some(j =>
          Math.abs(j.at.x - node.x) < 1e-3 && Math.abs(j.at.y - node.y) < 1e-3
        );

        // Only create automatic junction if no manual junction exists at this location
        if (!hasManualJunction) {
          // Use the netId of the first wire found, or 'default'
          let netId = 'default';
          for (const wid of wireIds) {
            const w = wires.find(w => w.id === wid);
            if (w && w.netId) { netId = w.netId; break; }
          }
          // Check if an automatic junction already exists at this location (preserve ID and per-instance overrides)
          const existingAuto = oldAutomaticJunctions.find(j =>
            Math.abs(j.at.x - node.x) < 1e-3 && Math.abs(j.at.y - node.y) < 1e-3
          );
          // Add as automatic junction (will be recreated by topology rebuild if wires change)
          junctions.push({
            id: existingAuto ? existingAuto.id : State.uid('junction'),
            at: { x: node.x, y: node.y },
            netId,
            size: existingAuto?.size,   // preserve per-instance override if it existed, else undefined
            color: existingAuto?.color  // preserve per-instance override if it existed, else undefined
          });
        }
      }
    }
    
      // After detecting automatic junctions, split wires at T-junctions
      // This inserts junction points into wire polylines so they can be properly split
      splitWiresAtTJunctions();
    } // End if (!skipAutoJunctionLogic)
    
    // Split wires at junction points (both manual and automatic)
    // This ensures that wires are separated into distinct segments at junctions
    const wiresToSplit = [];
    for (const junction of junctions) {
      const jx = Math.round(junction.at.x);
      const jy = Math.round(junction.at.y);
      
      // Find wires that have this junction point in their polyline (not at endpoints)
      for (const w of wires) {
        if (w.points.length < 2) continue;
        
        // Check if junction point exists in the polyline
        let junctionIndex = -1;
        for (let i = 0; i < w.points.length; i++) {
          const pt = w.points[i];
          const px = Math.round(pt.x), py = Math.round(pt.y);
          if (px === jx && py === jy) {
            junctionIndex = i;
            break;
          }
        }
        
        // Only split if junction is in the middle (not at endpoints)
        if (junctionIndex > 0 && junctionIndex < w.points.length - 1) {
          wiresToSplit.push({ wire: w, junctionIndex });
        }
      }
    }
    
    // Actually split the wires
    let didSplitWires = false;
    for (const { wire, junctionIndex } of wiresToSplit) {
      // Split the wire at this index
      const firstHalf = wire.points.slice(0, junctionIndex + 1);
      const secondHalf = wire.points.slice(junctionIndex);
      
      // Update original wire with first half
      wire.points = firstHalf;
      
      // Create new wire with second half
      const newWire: Wire = {
        id: State.uid('wire'),
        points: secondHalf,
        color: wire.color,
        stroke: wire.stroke ? { ...wire.stroke } : undefined,
        netId: wire.netId
      };
      wires.push(newWire);
      didSplitWires = true;
    }
    
    // If we split wires, rebuild topology to detect junctions at the new wire endpoints
    if (didSplitWires) {
      rebuildTopology();
    }
    
    // Sync constraints after topology changes
    if (USE_CONSTRAINTS && constraintSolver) {
      syncConstraints();
    }
  }

  // ---- SWP Move: collapse current SWP to a single straight wire, constrain move, rebuild on finish ----
  function findSwpById(id: string): SWP | undefined { return topology.swps.find(s => s.id === id); }
  function swpIdForComponent(c: any): string | null { return topology.compToSwp.get(c.id) || null; }
  // Return the SWP that contains wire segment (wireId, segIndex), or null
  function swpForWireSegment(wireId: string, segIndex?: number): SWP | null {
    for (const s of topology.swps) {
      if (s.edgeWireIds && s.edgeWireIds.includes(wireId)) return s;
    }
    return null;
  }
  function compCenterAlongAxis(c, axis) { return Move.compCenterAlongAxis(c, axis); }
  function halfPinSpan(c, axis) { return Move.halfPinSpan(createMoveContext(), c, axis); }
  function pinSpanAlongAxis(c, axis) { return Move.pinSpanAlongAxis(createMoveContext(), c, axis); }
  function beginSwpMove(c) { return Move.beginSwpMove(createMoveContext(), c); }
  function finishSwpMove(c, skipRedraw = false) {
    const ctx = createMoveContext();
    Move.finishSwpMove(ctx, c, true); // Skip redraw in Move function
    // The Move function reassigns ctx.wires, so we need to sync it back
    wires.length = 0;
    wires.push(...ctx.wires);
    
    // Re-break all wires at all component pins to fix any wires that now pass through components
    // This is necessary because perpendicular wires may have been stretched through components
    // Do this BEFORE normalizing to ensure components split the wires properly
    for (const comp of components) {
      breakWiresForComponent(comp);
    }
    
    // Now normalize and clean up after breaking
    normalizeAllWires();
    unifyInlineWires();
    
    // Now redraw with the synced wires
    if (!skipRedraw) {
      rebuildTopology();
      redraw();
    }
  }
  function ensureFinishSwpMove() {
    if (!moveCollapseCtx || moveCollapseCtx.kind !== 'swp') return;
    if (!lastMoveCompId) return;
    const c = components.find(x => x.id === lastMoveCompId);
    if (c) {
      finishSwpMove(c);
      moveCollapseCtx = null;
      lastMoveCompId = null;
    }
  }

  function ensureCollapseForSelection() {
    const collapseSel = getFirstSelection();
    if (!collapseSel || collapseSel.kind !== 'component') return;
    const c = components.find(x => x.id === collapseSel.id); if (!c) return;
    rebuildTopology();
    const sid = swpIdForComponent(c);
    if (!sid) return;
    if (moveCollapseCtx && moveCollapseCtx.kind === 'swp' && moveCollapseCtx.sid === sid) {
      lastMoveCompId = c.id;
      return;
    }
    if (moveCollapseCtx && moveCollapseCtx.kind === 'swp') {
      const prev = components.find(x => x.id === lastMoveCompId);
      finishSwpMove(prev || c);
      moveCollapseCtx = null;
      lastMoveCompId = null;
    }
    const swpCtx = beginSwpMove(c);
    if (swpCtx) {
      moveCollapseCtx = swpCtx;
      lastMoveCompId = c.id;
    }
  }

  // ====== Boot ======
  // start at 1:1 (defer applyZoom until after panels are initialized)
  redraw();

  // Ensure button states reflect initial values
  updateGridToggleButton();
  if (updateOrthoButtonVisual) updateOrthoButtonVisual();

  // Manually initialize junction dots and tracking buttons if they weren't caught by IIFEs
  const jdBtn = document.getElementById('junctionDotsBtn');
  if (jdBtn) {
    if (showJunctionDots) jdBtn.classList.add('active');
    else jdBtn.classList.remove('active');
  }
  const trBtn = document.getElementById('trackingToggleBtn');
  if (trBtn) {
    if (trackingMode) trBtn.classList.add('active');
    else trBtn.classList.remove('active');
  }

  // ====== Resizable and Collapsible Panels ======
  (function initPanels() {
    const leftPanel = document.getElementById('left') as HTMLElement;
    const rightPanel = document.getElementById('right') as HTMLElement;
    const leftResizer = document.querySelector('[data-resizer="left"]') as HTMLElement;
    const rightResizer = document.querySelector('[data-resizer="right"]') as HTMLElement;

    // Store expanded widths
    const panelState = {
      left: { width: 320, collapsed: false },
      right: { width: 320, collapsed: false }
    };

    // Load saved state from localStorage
    try {
      const saved = localStorage.getItem('panel.state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.left) panelState.left = parsed.left;
        if (parsed.right) panelState.right = parsed.right;
      }
    } catch (_) { }

    function saveState() {
      localStorage.setItem('panel.state', JSON.stringify(panelState));
    }

    // Get minimal collapsed width - just wide enough for button and single letter
    function getCollapsedWidth(): number {
      return 40; // Minimal width for single letter + button
    }

    // Apply saved state on load
    if (leftPanel) {
      const leftHeader = leftPanel.querySelector('.panel-header h2') as HTMLElement;
      if (panelState.left.collapsed) {
        leftPanel.classList.add('collapsed');
        leftPanel.style.width = getCollapsedWidth() + 'px';
        if (leftHeader) leftHeader.textContent = 'I';
      } else {
        leftPanel.style.width = panelState.left.width + 'px';
        if (leftHeader) leftHeader.textContent = 'Inspector';
      }
    }
    if (rightPanel) {
      const rightHeader = rightPanel.querySelector('.panel-header h2') as HTMLElement;
      if (panelState.right.collapsed) {
        rightPanel.classList.add('collapsed');
        rightPanel.style.width = getCollapsedWidth() + 'px';
        if (rightHeader) rightHeader.textContent = 'P';
      } else {
        rightPanel.style.width = panelState.right.width + 'px';
        if (rightHeader) rightHeader.textContent = 'Project';
      }
    }

    // Update button indicators based on state
    const leftToggle = document.querySelector('[data-panel="left"]') as HTMLElement;
    const rightToggle = document.querySelector('[data-panel="right"]') as HTMLElement;
    if (leftToggle) leftToggle.textContent = panelState.left.collapsed ? '▶' : '◀';
    if (rightToggle) rightToggle.textContent = panelState.right.collapsed ? '◀' : '▶';

    // Apply zoom after initial panel state to ensure correct canvas size
    // Wait for CSS transition to complete (200ms) before measuring
    setTimeout(() => {
      svg.getBoundingClientRect();
      applyZoom();
    }, 250);

    // Panel collapse/expand toggle
    document.querySelectorAll('.panel-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = (e.target as HTMLElement).getAttribute('data-panel');
        if (!target) return;

        const panel = document.getElementById(target);
        if (!panel) return;

        const isLeft = target === 'left';
        const state = isLeft ? panelState.left : panelState.right;
        const header = panel.querySelector('.panel-header h2') as HTMLElement;
        const fullText = isLeft ? 'Inspector' : 'Project';
        const letterText = isLeft ? 'I' : 'P';

        if (state.collapsed) {
          // Expand
          panel.classList.remove('collapsed');
          panel.style.width = state.width + 'px';
          state.collapsed = false;
          if (header) header.textContent = fullText;
          (btn as HTMLElement).textContent = isLeft ? '◀' : '▶';
        } else {
          // Collapse
          const collapsedWidth = getCollapsedWidth();
          panel.classList.add('collapsed');
          panel.style.width = collapsedWidth + 'px';
          state.collapsed = true;
          if (header) header.textContent = letterText;
          (btn as HTMLElement).textContent = isLeft ? '▶' : '◀';
        }

        saveState();
        // Wait for CSS transition to complete before recalculating viewBox
        setTimeout(() => {
          svg.getBoundingClientRect();
          applyZoom(); // Recalculate SVG viewBox after resize
        }, 250);
      });
    });

    // Section collapse/expand toggle (Settings, Nets, etc.)
    document.querySelectorAll('.section-header').forEach(header => {
      header.addEventListener('click', () => {
        const sectionName = header.getAttribute('data-section');
        if (!sectionName) return;

        const content = document.querySelector(`[data-section-content="${sectionName}"]`);
        const toggle = header.querySelector('.section-toggle');
        if (!content || !toggle) return;

        const isCollapsed = content.classList.contains('collapsed');
        
        if (isCollapsed) {
          // Expand
          content.classList.remove('collapsed');
          toggle.classList.remove('collapsed');
          localStorage.setItem(`section-${sectionName}-collapsed`, 'false');
        } else {
          // Collapse
          content.classList.add('collapsed');
          toggle.classList.add('collapsed');
          localStorage.setItem(`section-${sectionName}-collapsed`, 'true');
        }
      });

      // Restore collapsed state from localStorage
      const sectionName = header.getAttribute('data-section');
      if (sectionName) {
        const isCollapsed = localStorage.getItem(`section-${sectionName}-collapsed`) === 'true';
        if (isCollapsed) {
          const content = document.querySelector(`[data-section-content="${sectionName}"]`);
          const toggle = header.querySelector('.section-toggle');
          if (content && toggle) {
            content.classList.add('collapsed');
            toggle.classList.add('collapsed');
          }
        }
      }
    });

    // Resizer drag functionality
    function initResizer(resizer: HTMLElement, panel: HTMLElement, isLeft: boolean) {
      let startX = 0;
      let startWidth = 0;

      function onMouseDown(e: MouseEvent) {
        if (e.button !== 0) return;
        e.preventDefault();

        const state = isLeft ? panelState.left : panelState.right;
        if (state.collapsed) return; // Don't resize when collapsed

        startX = e.clientX;
        startWidth = panel.offsetWidth;

        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      }

      function onMouseMove(e: MouseEvent) {
        const delta = isLeft ? (e.clientX - startX) : (startX - e.clientX);
        let newWidth = startWidth + delta;

        // Enforce min/max constraints
        const minW = parseInt(getComputedStyle(panel).minWidth) || 200;
        const maxW = parseInt(getComputedStyle(panel).maxWidth) || 600;
        newWidth = Math.max(minW, Math.min(maxW, newWidth));

        panel.style.width = newWidth + 'px';
        // Force a layout reflow before recalculating viewBox
        svg.getBoundingClientRect();
        applyZoom(); // Recalculate SVG viewBox during resize
      }

      function onMouseUp() {
        resizer.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        const state = isLeft ? panelState.left : panelState.right;
        state.width = panel.offsetWidth;
        saveState();

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }

      resizer.addEventListener('mousedown', onMouseDown);
    }

    if (leftResizer && leftPanel) initResizer(leftResizer, leftPanel, true);
    if (rightResizer && rightPanel) initResizer(rightResizer, rightPanel, false);
  })();
})();
