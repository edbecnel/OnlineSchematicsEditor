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
import type { ClientXYEvent } from './utils.js';

import type {
  Point, Axis, Mode, PlaceType, CounterKey, Selection, DiodeSubtype,
  Component, RGBA01, StrokeType, Stroke, Wire, WireColorMode,
  NetClass, Theme, Junction, SWPEdge, SWP, Topology,
  MoveCollapseCtx, KWire
} from './types.js';

import {
  PX_PER_MM, pxToNm, nmToPx, mmToPx,
  nmToUnit, unitToNm,
  parseDimInput, formatDimForDisplay
} from './conversions.js';

(function(){
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

// ================================================================================
// ====== 2. CONSTANTS & CONFIGURATION ======
// ================================================================================

  // Global units state and persistence (available at module-init time to avoid TDZ issues)
  let globalUnits: 'mm' | 'in' | 'mils' = (localStorage.getItem('global.units') as any) || 'mm';
  function saveGlobalUnits(){ localStorage.setItem('global.units', globalUnits); }

// ================================================================================
// ====== 5. DOM REFERENCES ======
// ================================================================================

const svg = $q<SVGSVGElement>('#svg');

// Ensure required SVG layer <g> elements exist; create them if missing.
function ensureSvgGroup(id: string): SVGGElement {
  const existing = document.getElementById(id);
  if (existing) {
    if (existing instanceof SVGGElement) {
      return existing;
    }
    // If an element with this id exists but isn’t an <g>, replace it with a proper SVG <g>.
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
    g.setAttribute('id', id);
    existing.replaceWith(g);
    return g;
  }
  if (!svg) throw new Error(`Missing <svg id="svg"> root; cannot create #${id}`);
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
  g.setAttribute('id', id);
  svg.appendChild(g);
  return g;
}

// Layers (and enforce visual stacking order)
const gWires     = ensureSvgGroup('wires');
const gComps     = ensureSvgGroup('components');
const gJunctions = ensureSvgGroup('junctions');
const gDrawing   = ensureSvgGroup('drawing');
const gOverlay   = ensureSvgGroup('overlay');

// Keep desired order: wires → components → junctions → drawing (ghost/rubber-band) → overlay (marquee/crosshair)
(function ensureLayerOrder() {
  if (!svg) return;
  [gWires, gComps, gJunctions, gDrawing, gOverlay].forEach(g => svg.appendChild(g));
})();

const inspector = $q<HTMLElement>('#inspector');
const inspectorNone = $q<HTMLElement>('#inspectorNone');
const projTitle = $q<HTMLInputElement>('#projTitle'); // uses .value later
const countsEl = $q<HTMLElement>('#counts');
const overlayMode = $q<HTMLElement>('#modeLabel');
const coordDisplay = $q<HTMLElement>('#coordDisplay');

// Grid mode: 'line' (line grid), 'dot' (dot grid), 'off' (no grid) - persisted
type GridMode = 'line' | 'dot' | 'off';
let gridMode: GridMode = (localStorage.getItem('grid.mode') as GridMode) || 'line';

// Junction dots visibility toggle state (persisted)
let showJunctionDots = (localStorage.getItem('junctionDots.visible') !== 'false');

// Tracking mode: when true, connection hints are enabled (persisted)
let trackingMode = (localStorage.getItem('tracking.mode') !== 'false');

// UI button ref (may be used before DOM-ready in some cases; guard accordingly)
let gridToggleBtnEl: HTMLButtonElement | null = null;

// Track Shift key state globally so we can enforce orthogonal preview even
// when the user presses/releases Shift while dragging (some browsers/platforms
// may not include shift in pointer events reliably during capture).
let globalShiftDown = false;
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') globalShiftDown = true; });
window.addEventListener('keyup',   (e) => { if (e.key === 'Shift') globalShiftDown = false; });

// Ortho mode: when true, all wiring is forced orthogonal (persisted)
let orthoMode = (localStorage.getItem('ortho.mode') === 'true');
function saveOrthoMode(){ localStorage.setItem('ortho.mode', orthoMode ? 'true' : 'false'); }

// Snap mode: 'grid' (snap to grid intersections/dots), '50mil' (snap to 50mil base), 'off' (no snapping)
type SnapMode = 'grid' | '50mil' | 'off';
let snapMode: SnapMode = (localStorage.getItem('snap.mode') as SnapMode) || '50mil';
function saveSnapMode(){ localStorage.setItem('snap.mode', snapMode); }

// Crosshair display mode: 'full' or 'short'
let crosshairMode: 'full' | 'short' = (localStorage.getItem('crosshair.mode') as 'full' | 'short') || 'full';

// Connection hint: temporary lock to a wire endpoint's X AND Y coordinates
type ConnectionHint = { lockedPt: Point; targetPt: Point; wasOrthoActive: boolean; lockAxis: 'x' | 'y' } | null;
let connectionHint: ConnectionHint = null;
// Visual shift indicator for temporary ortho mode
let shiftOrthoVisualActive = false;
// Visual indicator when endpoint square overrides ortho mode
let endpointOverrideActive = false;

// ================================================================================
// ================================================================================
// ====== 3. STATE MANAGEMENT ======
// ================================================================================
// Type definitions moved to types.ts and imported at the top

let mode: Mode = 'select';
let placeType: PlaceType | null = null;
// Selection object: prefer `wire.id` for segment selections. `segIndex` is
// deprecated and retained only for backwards compatibility (use `null`).
let selection: Selection = { kind: null, id: null, segIndex: null };
let drawing: { active: boolean; points: Point[]; cursor: Point | null } = { active: false, points: [], cursor: null };
// Marquee selection (click+drag rectangle) state
let marquee: {
  active: boolean;
  start: Point | null;
  end: Point | null;
  rectEl: SVGRectElement | null;
  startedOnEmpty: boolean;
  shiftPreferComponents: boolean;
} = { active: false, start: null, end: null, rectEl: null, startedOnEmpty: false, shiftPreferComponents: false };

  // ---- Wire topology (nodes/edges/SWPs) + per-move collapse context ----
  let topology: Topology = { nodes: [], edges: [], swps: [], compToSwp: new Map() };
  let moveCollapseCtx: MoveCollapseCtx | null = null; // set while moving a component within its SWP
  let lastMoveCompId: string | null = null;           // component id whose SWP is currently collapsed

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
    // Re-render canvas overlays (endpoint squares, wires) so overlays stay aligned after zoom
    redrawCanvasOnly();
    updateZoomUI();
  }
  // keep grid filling canvas on window resizes
  window.addEventListener('resize', applyZoom);
  function redrawGrid(){
    const w = viewW, h = viewH;
    const rEl = document.getElementById('gridRect');
    const r = rEl as unknown as SVGRectElement | null;
    if(!r) return;
    setAttr(r, 'x', viewX);
    setAttr(r, 'y', viewY);
    setAttr(r, 'width', w);
    setAttr(r, 'height', h);

    // Calculate grid spacing using the same algorithm as dot grid
    // This ensures line grid intersections align with dot positions
    const scale = svg.clientWidth / Math.max(1, viewW); // screen px per user unit
    
    // Grid spacing must always be a multiple of the base 50 mil grid
    // Use zoom-dependent spacing for readability
    const baseSnapUser = nmToPx(SNAP_NM); // 50 mils = 5 user units
    const zoomMin = 0.25, zoom1x = 10;
    let snapMultiplier: number;
    
    if(zoom <= zoomMin){
      snapMultiplier = 5; // 250 mils (5 * 50 mils) at low zoom
    } else if(zoom >= zoom1x){
      snapMultiplier = 1; // 50 mils from 10x zoom onward
    } else {
      // Use discrete multipliers at intermediate zooms to maintain 50 mil alignment
      // Choose the nearest integer multiplier from [1, 2, 5]
      const t = (zoom - zoomMin) / (zoom1x - zoomMin);
      const interpolated = 5 - t * 4; // 5 down to 1
      if(interpolated > 3) snapMultiplier = 5;
      else if(interpolated > 1.5) snapMultiplier = 2;
      else snapMultiplier = 1;
    }
    
    // Grid spacing in user units - always a multiple of 50 mils
    const minorUser = baseSnapUser * snapMultiplier;
    
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
    if(pat){
      pat.setAttribute('width', String(majorUser));
      pat.setAttribute('height', String(majorUser));
      // clear and draw lines at every minorUser step within majorUser
      while(pat.firstChild) pat.removeChild(pat.firstChild);
      const bg = document.createElementNS(ns, 'rect');
      bg.setAttribute('x','0'); bg.setAttribute('y','0');
      bg.setAttribute('width', String(majorUser)); bg.setAttribute('height', String(majorUser));
      bg.setAttribute('fill','none'); pat.appendChild(bg);
      // vertical lines (iterate integer steps to avoid FP drift)
      for(let xi = 0; xi <= cellsPerMajor; xi++){
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
      for(let yi = 0; yi <= cellsPerMajor; yi++){
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
    if(patBold){
      // patBold will simply tile the major cell — ensure it matches majorUser
      patBold.setAttribute('width', String(majorUser));
      patBold.setAttribute('height', String(majorUser));
      // replace inner rect so it references current grid pattern
      while(patBold.firstChild) patBold.removeChild(patBold.firstChild);
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
    try{
      const k = document.getElementById('gridSizeKbd');
      // Convert minorUser to mils for display (5 user units = 50 mils)
      const milsPerUserUnit = 10; // 100 px/inch ÷ 1000 mils/inch = 0.1 px/mil, so 1 user unit = 10 mils
      const gridMils = Math.round(minorUser * milsPerUserUnit);
      if(k) k.textContent = `${gridMils} mil`;
    }catch(err){/* ignore */}

    // Update grid display based on gridMode
    try{
      const rEl = document.getElementById('gridRect') as unknown as SVGRectElement | null;
      if(rEl){
        if(gridMode === 'line'){
          rEl.setAttribute('fill', 'url(#gridBold)');
        } else {
          rEl.setAttribute('fill', 'none');
        }
      }
    }catch(_){ }
    
    // Render dot grid with same spacing as line grid
    const dotGridEl = document.getElementById('dotGrid');
    if(dotGridEl && gridMode === 'dot'){
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
      for(let x = startX; x <= endX; x += dotSpacingUser){
        for(let y = startY; y <= endY; y += dotSpacingUser){
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
    } else if(dotGridEl){
      dotGridEl.style.display = 'none';
    }
  }
  function updateZoomUI(){
    const z = Math.round(zoom * 100);
    const inp = document.getElementById('zoomPct') as HTMLInputElement | null;
    if (inp && inp.value !== z + '%') inp.value = z + '%';
  }

  // Toggle grid visibility UI and persistence
  function updateGridToggleButton(){
    if(!gridToggleBtnEl) gridToggleBtnEl = document.getElementById('gridToggleBtn') as HTMLButtonElement | null;
    if(!gridToggleBtnEl) return;
    if(gridMode === 'off'){
      gridToggleBtnEl.classList.add('dim');
      gridToggleBtnEl.textContent = 'Grid';
    } else {
      gridToggleBtnEl.classList.remove('dim');
      if(gridMode === 'line'){
        gridToggleBtnEl.textContent = 'Grid: Lines';
      } else {
        gridToggleBtnEl.textContent = 'Grid: Dots';
      }
    }
  }

  function toggleGrid(){
    // Cycle through: line -> dot -> off -> line
    if(gridMode === 'line'){
      gridMode = 'dot';
    } else if(gridMode === 'dot'){
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
  let counters = { resistor:1, capacitor:1, inductor:1, diode:1, npn:1, pnp:1, ground:1, battery:1, ac:1, wire:1 };
  
  // --- Core Model Arrays ---
  let components: Component[] = [];
  let wires: Wire[] = [];
  
  // Nets collection: user-defined nets for manual assignment
  let nets: Set<string> = new Set(['default']);
  let activeNetClass: string = 'default';

  // --- Undo/Redo Stacks ---
  interface EditorState {
    components: Component[];
    wires: Wire[];
    selection: typeof selection;
    counters: typeof counters;
    nets: Set<string>;
    netClasses: Record<string, NetClass>;
    activeNetClass: string;
    wireDefaults: typeof WIRE_DEFAULTS;
  }
  let undoStack: EditorState[] = [];
  let redoStack: EditorState[] = [];
  const MAX_UNDO_STACK = 50; // Limit stack size to prevent memory issues

  function captureState(): EditorState {
    // Deep clone all mutable state
    return {
      components: JSON.parse(JSON.stringify(components)),
      wires: JSON.parse(JSON.stringify(wires)),
      selection: { ...selection },
      counters: { ...counters },
      nets: new Set(nets),
      netClasses: JSON.parse(JSON.stringify(NET_CLASSES)),
      activeNetClass: activeNetClass,
      wireDefaults: JSON.parse(JSON.stringify(WIRE_DEFAULTS))
    };
  }

  function restoreState(state: EditorState) {
    // Restore all state from snapshot
    components = JSON.parse(JSON.stringify(state.components));
    wires = JSON.parse(JSON.stringify(state.wires));
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
    
    // Rebuild topology and UI
    rebuildTopology();
    redraw();
    renderNetList();
    renderInspector();
    syncWireToolbar(); // Update wire stroke toolbar to reflect restored defaults
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

  // Wire color state: default from CSS var, and current palette choice (affects new wires only)
  const defaultWireColor: string = (getComputedStyle(document.documentElement).getPropertyValue('--wire').trim() || '#c7f284');
  // --- Theme & NetClasses (moved early so redraw() doesn't hit TDZ) ---
  const THEME: Theme = {
    wire: { width: 0.25, type: 'solid', color: cssToRGBA01(defaultWireColor) },
    junction: { size: 1.2, color: cssToRGBA01('#FFFFFF') }
  };
  const NET_CLASSES: Record<string, NetClass> = {
    default: {
      id: 'default',
      name: 'Default',
      wire: { width: 0.25, type: 'solid', color: cssToRGBA01(defaultWireColor) },
      junction: { size: 1.2, color: cssToRGBA01('#FFFFFF') }
    }
  };
  function netClassForWire(w: Wire): NetClass {
    // Use wire's assigned netId if present
    if(w.netId){
      return NET_CLASSES[w.netId] || NET_CLASSES.default;
    }
    // If wire is using netclass defaults (width=0, type=default) but no netId, use active net class
    if(w.stroke && w.stroke.width <= 0 && w.stroke.type === 'default'){
      return NET_CLASSES[activeNetClass] || NET_CLASSES.default;
    }
    // Fallback to default
    return NET_CLASSES.default;
  }

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
      const L = 0.2126*srgb[0] + 0.7152*srgb[1] + 0.0722*srgb[2];
      return (L < 0.5) ? '#ffffff' : '#000000';
    }
    
    // Black → render as white in dark mode, but keep black internally
    if (mode === 'black') {
      const bg = getComputedStyle(document.body).backgroundColor;
      const rgb = bg.match(/\d+/g)?.map(Number) || [0, 0, 0];
      const [r, g, b] = rgb;
      const srgb = [r / 255, g / 255, b / 255].map(v => (v <= 0.03928) ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      const L = 0.2126*srgb[0] + 0.7152*srgb[1] + 0.0722*srgb[2];
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

  let junctions: Array<{ at: Point; size?: number; color?: string; netId?: string|null }> = [];

  function wireColorNameFromValue(v){
    const val = (v||'').toLowerCase();
    // map actual stroke values back to option keys when possible
    if(val==='#ffffff' || val==='ffffff' || val==='white') return 'white';
    if(val==='#000000' || val==='000000' || val==='black') return 'black';
    if(val==='red') return 'red';
    if(val==='lime') return 'green';
    if(val==='deepskyblue') return 'blue';
    if(val==='gold') return 'yellow';
    if(val==='magenta') return 'magenta';
    if(val==='cyan') return 'cyan';
    // theme-contrast outcomes of 'auto'
    if(val==='#fff' || val==='#ffffff' || val==='white') return 'auto';
    if(val==='#000' || val==='#000000' || val==='black') return 'auto';
    // legacy default wire color → closest bucket
    if(val==='#c7f284') return 'yellow';
    // fallback
    return 'auto';
  }
  
  // Helper to create a split black/white swatch
  function createSplitSwatch(el: HTMLElement){
    if(!el) return;
    el.style.background = 'linear-gradient(to bottom right, #000000 0%, #000000 49%, #ffffff 51%, #ffffff 100%)';
    el.style.border = '1px solid #666666';
  }
  
  const setSwatch = (el, color)=>{ 
    if(!el) return;
    // Special handling for black/white: show split diagonal swatch
    const hexColor = colorToHex(color).toUpperCase();
    if(hexColor === '#000000' || hexColor === '#FFFFFF'){
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
    
    // Default: '50mil' mode - snap to 50-mil base grid
    const snapUnits = baseSnapUser(); // Returns 5 for 50 mil spacing
    return Math.round(v / snapUnits) * snapUnits;
  };
  const uid = (prefix: CounterKey): string => `${prefix}${counters[prefix]++}`;

  function updateCounts(){
    countsEl.textContent = `Components: ${components.length} · Wires: ${wires.length}`;
  }

  function renderNetList(){
    const netListEl = document.getElementById('netList');
    if(!netListEl) return;
    
    // Collect all nets currently in use by wires
    const usedNets = new Set<string>();
    wires.forEach(w => { if(w.netId) usedNets.add(w.netId); });
    
    // Merge with user-defined nets
    usedNets.forEach(n => nets.add(n));
    
    if(nets.size === 0){
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
      if(netName === activeNetClass){
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
        showNetPropertiesDialog(netName);
      };
      
      li.appendChild(nameSpan);
      li.appendChild(editBtn);
      
      // Delete button (except for 'default')
      if(netName !== 'default'){
        const delBtn = document.createElement('button');
        delBtn.textContent = '×';
        delBtn.style.padding = '0.1rem 0.4rem';
        delBtn.style.fontSize = '1.2rem';
        delBtn.style.lineHeight = '1';
        delBtn.style.cursor = 'pointer';
        delBtn.title = 'Delete net';
        delBtn.onclick = () => {
          if(confirm(`Delete net "${netName}"? Wires using this net will be assigned to "default".`)){
            nets.delete(netName);
            delete NET_CLASSES[netName];
            // Reassign any wires using this net to default
            wires.forEach(w => { if(w.netId === netName) w.netId = 'default'; });
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
  
  function addNet(){
    const name = prompt('Enter net name:');
    if(!name) return;
    const trimmed = name.trim();
    if(!trimmed) return;
    if(nets.has(trimmed)){
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
    showNetPropertiesDialog(trimmed);
  }
  
  function showNetPropertiesDialog(netName: string){
    const netClass = NET_CLASSES[netName];
    if(!netClass) return;
    
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.6)';
    overlay.style.zIndex = '1000';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    
    // Create dialog
    const dialog = document.createElement('div');
    dialog.style.background = 'var(--panel)';
    dialog.style.border = '1px solid #273042';
    dialog.style.borderRadius = '12px';
    dialog.style.padding = '1.5rem';
    dialog.style.minWidth = '400px';
    dialog.style.maxWidth = '500px';
    dialog.style.boxShadow = '0 8px 32px rgba(0,0,0,0.4)';
    
    // Title
    const title = document.createElement('h2');
    title.textContent = `Net Properties: ${netName}`;
    title.style.marginTop = '0';
    title.style.marginBottom = '1rem';
    dialog.appendChild(title);
    
    // Width control
    const widthRow = document.createElement('div');
    widthRow.className = 'row';
    widthRow.style.marginBottom = '1rem';
    const widthLabel = document.createElement('label');
    widthLabel.textContent = `Wire Width (${globalUnits})`;
    widthLabel.style.display = 'block';
    widthLabel.style.marginBottom = '0.3rem';
    const widthInput = document.createElement('input');
    widthInput.type = 'text';
    const widthNm = Math.round((netClass.wire.width || 0) * NM_PER_MM);
    widthInput.value = formatDimForDisplay(widthNm, globalUnits);
    widthRow.appendChild(widthLabel);
    widthRow.appendChild(widthInput);
    dialog.appendChild(widthRow);
    
    // Line style control
    const styleRow = document.createElement('div');
    styleRow.className = 'row';
    styleRow.style.marginBottom = '1rem';
    const styleLabel = document.createElement('label');
    styleLabel.textContent = 'Line Style';
    styleLabel.style.display = 'block';
    styleLabel.style.marginBottom = '0.3rem';
    const styleSelect = document.createElement('select');
    ['default','solid','dash','dot','dash_dot','dash_dot_dot'].forEach(v=>{
      const o=document.createElement('option'); 
      o.value=v; 
      o.textContent=v.replace(/_/g,'·'); 
      styleSelect.appendChild(o);
    });
    styleSelect.value = netClass.wire.type;
    styleRow.appendChild(styleLabel);
    styleRow.appendChild(styleSelect);
    dialog.appendChild(styleRow);
    
    // Color control
    const colorRow = document.createElement('div');
    colorRow.className = 'row';
    colorRow.style.marginBottom = '1rem';
    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Wire Color';
    colorLabel.style.display = 'block';
    colorLabel.style.marginBottom = '0.3rem';
    
    const colorInputsRow = document.createElement('div');
    colorInputsRow.style.display = 'flex';
    colorInputsRow.style.gap = '0.5rem';
    colorInputsRow.style.alignItems = 'center';
    
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.title = 'Pick color';
    const rgbCss = `rgba(${Math.round(netClass.wire.color.r*255)},${Math.round(netClass.wire.color.g*255)},${Math.round(netClass.wire.color.b*255)},${netClass.wire.color.a})`;
    colorInput.value = colorToHex(rgbCss);
    
    const alphaInput = document.createElement('input');
    alphaInput.type = 'range';
    alphaInput.min = '0';
    alphaInput.max = '1';
    alphaInput.step = '0.05';
    alphaInput.style.flex = '1';
    alphaInput.value = String(netClass.wire.color.a);
    alphaInput.title = 'Opacity';
    
    const alphaLabel = document.createElement('span');
    alphaLabel.textContent = `${Math.round(netClass.wire.color.a * 100)}%`;
    alphaLabel.style.minWidth = '3ch';
    alphaLabel.style.fontSize = '0.9rem';
    alphaLabel.style.color = 'var(--muted)';
    
    alphaInput.oninput = () => {
      alphaLabel.textContent = `${Math.round(parseFloat(alphaInput.value) * 100)}%`;
    };
    
    // Color swatch toggle button
    const swatchToggle = document.createElement('button');
    swatchToggle.type = 'button';
    swatchToggle.title = 'Show color swatches';
    swatchToggle.style.marginLeft = '6px';
    swatchToggle.style.width = '22px';
    swatchToggle.style.height = '22px';
    swatchToggle.style.borderRadius = '4px';
    swatchToggle.style.display = 'inline-flex';
    swatchToggle.style.alignItems = 'center';
    swatchToggle.style.justifyContent = 'center';
    swatchToggle.style.padding = '0';
    swatchToggle.style.fontSize = '12px';
    swatchToggle.innerHTML = '<svg width="12" height="8" viewBox="0 0 12 8" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M1 1l5 5 5-5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    
    colorInputsRow.appendChild(colorInput);
    colorInputsRow.appendChild(alphaInput);
    colorInputsRow.appendChild(alphaLabel);
    colorInputsRow.appendChild(swatchToggle);
    
    colorRow.appendChild(colorLabel);
    colorRow.appendChild(colorInputsRow);
    dialog.appendChild(colorRow);
    
    // Color swatch palette popover
    const swatches = [
      ['black','#000000'],
      ['red','#FF0000'], ['green','#00FF00'], ['blue','#0000FF'],
      ['cyan','#00FFFF'], ['magenta','#FF00FF'], ['yellow','#FFFF00']
    ];
    const popover = document.createElement('div');
    popover.style.position = 'absolute';
    popover.style.display = 'none';
    popover.style.zIndex = '10001';
    popover.style.background = 'var(--panel)';
    popover.style.padding = '8px';
    popover.style.borderRadius = '6px';
    popover.style.border = '1px solid #273042';
    popover.style.boxShadow = '0 6px 18px rgba(0,0,0,0.3)';
    const pal = document.createElement('div');
    pal.style.display = 'grid';
    pal.style.gridTemplateColumns = `repeat(${swatches.length}, 18px)`;
    pal.style.gap = '8px';
    swatches.forEach(([name, col])=>{
      const b = document.createElement('button');
      b.title = String(name).toUpperCase();
      b.type = 'button';
      if(col === '#000000'){
        b.style.background = 'linear-gradient(to bottom right, #000000 0%, #000000 49%, #ffffff 51%, #ffffff 100%)';
        b.style.border = '1px solid #666666';
        b.title = 'BLACK/WHITE';
      } else {
        b.style.background = String(col);
        b.style.border = '1px solid rgba(0,0,0,0.12)';
      }
      b.style.width = '18px';
      b.style.height = '18px';
      b.style.borderRadius = '4px';
      b.style.padding = '0';
      b.style.cursor = 'pointer';
      b.onclick = (e) => {
        e.stopPropagation();
        colorInput.value = String(col);
        alphaInput.value = '1';
        alphaLabel.textContent = '100%';
        popover.style.display = 'none';
      };
      pal.appendChild(b);
    });
    popover.appendChild(pal);
    dialog.appendChild(popover);
    
    const showSwatchPopover = () => {
      const rect = swatchToggle.getBoundingClientRect();
      popover.style.left = `${rect.left}px`;
      popover.style.top = `${rect.bottom + 6}px`;
      popover.style.display = 'block';
    };
    const hideSwatchPopover = () => {
      popover.style.display = 'none';
    };
    
    swatchToggle.onclick = (e) => {
      e.stopPropagation();
      if(popover.style.display === 'block'){
        hideSwatchPopover();
      } else {
        showSwatchPopover();
      }
    };
    
    // Buttons
    const buttonRow = document.createElement('div');
    buttonRow.style.display = 'flex';
    buttonRow.style.gap = '0.5rem';
    buttonRow.style.justifyContent = 'flex-end';
    buttonRow.style.marginTop = '1.5rem';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
      document.body.removeChild(overlay);
    };
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'ok';
    saveBtn.onclick = () => {
      // Parse width
      const parsed = parseDimInput(widthInput.value || '0', globalUnits);
      const nm = parsed ? parsed.nm : 0;
      const valMm = nm / NM_PER_MM;
      
      // Parse color
      const hex = colorInput.value || '#ffffff';
      const m = hex.replace('#','');
      const r = parseInt(m.slice(0,2),16);
      const g = parseInt(m.slice(2,4),16);
      const b = parseInt(m.slice(4,6),16);
      const a = Math.max(0, Math.min(1, parseFloat(alphaInput.value) || 1));
      
      // Update net class
      pushUndo();
      netClass.wire.width = valMm;
      netClass.wire.type = styleSelect.value as StrokeType;
      netClass.wire.color = { r: r/255, g: g/255, b: b/255, a };
      
      // Update any wires using this net
      wires.forEach(w => {
        if(w.netId === netName && w.stroke && w.stroke.type === 'default'){
          // If wire is using netclass defaults, redraw to pick up changes
          w.color = rgba01ToCss(netClass.wire.color);
        }
      });
      
      document.body.removeChild(overlay);
      renderNetList();
      redraw();
    };
    
    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(saveBtn);
    dialog.appendChild(buttonRow);
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    // Close on overlay click
    overlay.onclick = (e) => {
      if(e.target === overlay){
        document.body.removeChild(overlay);
      }
    };
    
    // Close on Escape key
    const escHandler = (e: KeyboardEvent) => {
      if(e.key === 'Escape' && document.body.contains(overlay)){
        document.body.removeChild(overlay);
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  function setMode(m: Mode){
    // Finalize any active wire drawing before mode change
    if(drawing.active && drawing.points.length > 0){
      finishWire();
    }
    mode = m; overlayMode.textContent = m[0].toUpperCase()+m.slice(1);

    $qa<HTMLButtonElement>('#modeGroup button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === m);
    });
    
    // Ensure ortho button stays in sync when switching modes
    if(updateOrthoButtonVisual) updateOrthoButtonVisual();

    // reflect mode on body for cursor styles
    document.body.classList.remove('mode-select','mode-wire','mode-delete','mode-place','mode-pan','mode-move');
    document.body.classList.add(`mode-${m}`);
    // If user switches to Delete with an active selection, apply delete immediately
    if (m==='delete' && selection.kind){
      if(selection.kind==='component'){ removeComponent(selection.id); return; }
      if(selection.kind==='wire'){
        const w = wires.find(x=>x.id===selection.id);
        if(w){
          pushUndo();
          wires = wires.filter(x => x.id !== w.id);
          selection = { kind:null, id:null, segIndex:null };
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
  (function attachGridToggle(){
    try{
      gridToggleBtnEl = document.getElementById('gridToggleBtn') as HTMLButtonElement | null;
      if(gridToggleBtnEl){
        gridToggleBtnEl.addEventListener('click', ()=>{ toggleGrid(); });
        // initialize appearance
        updateGridToggleButton();
      }
    }catch(_){ }

    window.addEventListener('keydown', (e)=>{
      // Ignore when typing in inputs or with modifier keys
      if(e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if(e.key === 'g' || e.key === 'G'){
        e.preventDefault(); toggleGrid();
      }
    });
  })();

  // Wire up Junction Dots toggle button
  (function attachJunctionDotsToggle(){
    try{
      const junctionDotsBtn = document.getElementById('junctionDotsBtn') as HTMLButtonElement | null;
      if(junctionDotsBtn){
        function updateJunctionDotsButton(){
          if(showJunctionDots){
            junctionDotsBtn.classList.add('active');
          } else {
            junctionDotsBtn.classList.remove('active');
          }
        }
        function toggleJunctionDots(){
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
    }catch(_){ }
    
    // Keyboard shortcut: . (period)
    window.addEventListener('keydown', (e)=>{
      if(e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if(e.key === '.'){
        e.preventDefault();
        showJunctionDots = !showJunctionDots;
        localStorage.setItem('junctionDots.visible', showJunctionDots ? 'true' : 'false');
        const btn = document.getElementById('junctionDotsBtn');
        if(btn){
          if(showJunctionDots) btn.classList.add('active');
          else btn.classList.remove('active');
        }
        redraw();
        renderDrawing(); // Update in-progress wire display
      }
    });
  })();

  // Wire up Ortho mode toggle button and shortcut (O)
  let updateOrthoButtonVisual: (() => void) | null = null;
  (function attachOrthoToggle(){
    const orthoBtn = document.getElementById('orthoToggleBtn') as HTMLButtonElement | null;
    function updateOrthoButton(){
      if(!orthoBtn) return;
      // Show dimmed/inactive if endpoint square is overriding ortho
      if(endpointOverrideActive){
        orthoBtn.classList.remove('active');
        orthoBtn.style.opacity = '0.4';
      }
      // Show active if ortho mode is on OR if shift visual is active
      else if(orthoMode || shiftOrthoVisualActive){
        orthoBtn.classList.add('active');
        orthoBtn.style.opacity = '';
      } else {
        orthoBtn.classList.remove('active');
        orthoBtn.style.opacity = '';
      }
    }
    updateOrthoButtonVisual = updateOrthoButton;
    function toggleOrtho(){
      orthoMode = !orthoMode;
      saveOrthoMode();
      updateOrthoButton();
    }
    if(orthoBtn){
      orthoBtn.addEventListener('click', ()=>{ toggleOrtho(); });
      updateOrthoButton();
    }
    window.addEventListener('keydown', (e)=>{
      if(e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if(e.key === 'o' || e.key === 'O'){
        e.preventDefault(); toggleOrtho();
      }
    });
  })();

  // Wire up Snap mode toggle button and shortcut (S)
  (function attachSnapToggle(){
    const snapBtn = document.getElementById('snapToggleBtn') as HTMLButtonElement | null;
    function updateSnapButton(){
      if(!snapBtn) return;
      // Update button text based on current mode
      if(snapMode === 'grid'){
        snapBtn.textContent = 'Grid';
        snapBtn.classList.add('active');
        snapBtn.title = 'Snap mode: Grid (S)';
      } else if(snapMode === '50mil'){
        snapBtn.textContent = '50mil';
        snapBtn.classList.add('active');
        snapBtn.title = 'Snap mode: 50mil (S)';
      } else { // 'off'
        snapBtn.textContent = 'Off';
        snapBtn.classList.remove('active');
        snapBtn.title = 'Snap mode: Off (S)';
      }
    }
    function cycleSnapMode(){
      // Cycle: 50mil → grid → off → 50mil
      if(snapMode === '50mil') snapMode = 'grid';
      else if(snapMode === 'grid') snapMode = 'off';
      else snapMode = '50mil';
      saveSnapMode();
      updateSnapButton();
      updateSnapStatus();
    }
    function updateSnapStatus(){
      const snapK = document.getElementById('snapKbd');
      if(!snapK) return;
      if(snapMode === 'off'){
        snapK.textContent = 'off';
      } else if(snapMode === 'grid'){
        snapK.textContent = 'grid';
      } else {
        snapK.textContent = '50mil';
      }
    }
    if(snapBtn){
      snapBtn.addEventListener('click', ()=>{ cycleSnapMode(); });
      updateSnapButton();
      updateSnapStatus();
    }
    window.addEventListener('keydown', (e)=>{
      if(e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if(e.key === 's' || e.key === 'S'){
        e.preventDefault(); cycleSnapMode();
      }
    });
  })();

  // Wire up Crosshair toggle button and shortcut (X)
  (function attachCrosshairToggle(){
    const crosshairBtn = document.getElementById('crosshairToggleBtn') as HTMLButtonElement | null;
    function updateCrosshairButton(){
      if(!crosshairBtn) return;
      // Full mode: outline in crosshair color (darker gray #888)
      // Short mode: outline in lighter gray
      if(crosshairMode === 'full'){
        crosshairBtn.style.outline = '2px solid #888';
      } else {
        crosshairBtn.style.outline = '2px solid #555';
      }
    }
    
    function toggleCrosshairMode(){
      crosshairMode = crosshairMode === 'full' ? 'short' : 'full';
      localStorage.setItem('crosshair.mode', crosshairMode);
      updateCrosshairButton();
      // Refresh crosshair display if in wire mode
      if(mode === 'wire' && drawing.cursor){
        renderCrosshair(drawing.cursor.x, drawing.cursor.y);
      }
    }
    
    if(crosshairBtn){
      crosshairBtn.addEventListener('click', toggleCrosshairMode);
      updateCrosshairButton();
    }
    
    window.addEventListener('keydown', (e)=>{
      if(e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if(e.key === 'x' || e.key === 'X'){
        e.preventDefault(); toggleCrosshairMode();
      }
      if(e.key === '+' || e.key === '='){
        e.preventDefault(); toggleCrosshairMode();
      }
    });
  })();

  // Wire up Tracking toggle button and shortcut (T)
  (function attachTrackingToggle(){
    const trackingBtn = document.getElementById('trackingToggleBtn') as HTMLButtonElement | null;
    function updateTrackingButton(){
      if(!trackingBtn) return;
      if(trackingMode){
        trackingBtn.classList.add('active');
      } else {
        trackingBtn.classList.remove('active');
      }
    }
    
    function toggleTracking(){
      trackingMode = !trackingMode;
      localStorage.setItem('tracking.mode', trackingMode ? 'true' : 'false');
      updateTrackingButton();
      // Clear any active connection hint when disabling tracking
      if(!trackingMode){
        connectionHint = null;
        renderConnectionHint();
      }
    }
    
    if(trackingBtn){
      trackingBtn.addEventListener('click', toggleTracking);
      updateTrackingButton();
    }
    
    window.addEventListener('keydown', (e)=>{
      if(e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if(e.key === 't' || e.key === 'T'){
        e.preventDefault(); toggleTracking();
      }
    });
  })();

  // Wire up Theme toggle button
  (function attachThemeToggle(){
    const themeBtn = document.getElementById('themeToggleBtn') as HTMLButtonElement | null;
    const htmlEl = document.documentElement;
    
    // Load saved theme or default to dark
    let currentTheme = localStorage.getItem('theme') || 'dark';
    
    function applyTheme(theme: string){
      if(theme === 'light'){
        htmlEl.setAttribute('data-theme', 'light');
      } else {
        htmlEl.removeAttribute('data-theme');
      }
      currentTheme = theme;
      localStorage.setItem('theme', theme);
      
      // Update button icon
      if(themeBtn){
        themeBtn.textContent = theme === 'light' ? '🌙' : '☀';
      }
      
      // Always redraw when theme changes - any black wires need to flip to white/black
      // Also update the in-progress drawing if active
      redraw();
      renderDrawing();
    }
    
    function toggleTheme(){
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(newTheme);
    }
    
    // Apply saved theme on load
    applyTheme(currentTheme);
    
    if(themeBtn){
      themeBtn.addEventListener('click', toggleTheme);
    }
  })();  // ====== Component Drawing ======
  function compPinPositions(c){
    // two-pin components: pins at +/- 2*GRID along the component rotation axis
    const r = ((c.rot % 360) + 360) % 360;
    if(c.type==='npn' || c.type==='pnp'){      // base at center; collector top; emitter bottom (before rotation)
      const pins = [ {name:'B', x:c.x, y:c.y}, {name:'C', x:c.x, y:c.y-2*GRID}, {name:'E', x:c.x, y:c.y+2*GRID} ];
      return pins.map(p=>rotatePoint(p, {x:c.x, y:c.y}, r));
    } else if (c.type==='ground') {
      // single pin at top of ground symbol
      return [ {name:'G', x:c.x, y:c.y - 2} ];
    } else {      
      // Generic 2-pin (resistor, capacitor, inductor, diode, battery, ac)
      const L = 2*GRID;
      const rad = r * Math.PI/180;
      const ux = Math.cos(rad), uy = Math.sin(rad);
      const a = { x: c.x - L*ux, y: c.y - L*uy, name:'A' };
      const b = { x: c.x + L*ux, y: c.y + L*uy, name:'B' };
      return [a,b];      
    }
  }

  function drawComponent(c){
    if(!c.props) c.props = {};
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.classList.add('comp');
    g.setAttribute('data-id', c.id);

    // (selection ring removed; selection is shown by tinting the symbol graphics)

    // big invisible hit for easy click/drag
    const hit = document.createElementNS('http://www.w3.org/2000/svg','rect');
    setAttr(hit, 'x', c.x-60); setAttr(hit, 'y', c.y-60);
    setAttr(hit, 'width', 120); setAttr(hit, 'height', 120);
    hit.setAttribute('fill','transparent');
    g.appendChild(hit);

    // pins
    compPinPositions(c).forEach((p,idx)=>{
      const pin = document.createElementNS('http://www.w3.org/2000/svg','circle');
      setAttr(pin, 'cx', p.x); setAttr(pin, 'cy', p.y);
      setAttr(pin, 'r', 3);      
      pin.setAttribute('fill', 'var(--pin)');
      // 1px outline for contrast (especially against white wires). Non-scaling via global CSS.
      pin.setAttribute('stroke', 'var(--bg)');
      pin.setAttribute('stroke-width', '1');
      pin.setAttribute('data-pin', String(idx));
      g.appendChild(pin);
    });

    // hover cue
    g.addEventListener('pointerenter', ()=>{ g.classList.add('comp-hover'); });
    g.addEventListener('pointerleave', ()=>{ g.classList.remove('comp-hover'); });

    // Components should not block clicks when wiring or placing
    g.style.pointerEvents = (mode==='wire' || mode==='place') ? 'none' : 'auto';

    // ---- Drag + selection (mouse) ----
    let dragging=false, dragOff={x:0,y:0}, slideCtx=null, dragStart=null;
    g.addEventListener('pointerdown', (e)=>{
      if(mode==='delete'){ removeComponent(c.id); return; }
      // If no action is active, automatically activate Select mode when
      // the user clicks a component so the click behaves like a selection.
      if(mode === 'none'){ setMode('select'); }
      // If Select mode is active and this component is already selected,
      // interpret the click as intent to move the component: switch to Move.
      if(mode === 'select' && selection.kind === 'component' && selection.id === c.id){
        setMode('move');
      }
      if(!(mode==='select' || mode==='move')) return;
      if(e.button!==0) return;
      // persist selection until user clicks elsewhere
      selection = {kind:'component', id:c.id, segIndex:null};
      renderInspector(); updateSelectionOutline();
      // If switching to a different component while in Move mode, finalize the prior SWP first.
      if (mode === 'move' && moveCollapseCtx && moveCollapseCtx.kind === 'swp' && lastMoveCompId && lastMoveCompId !== c.id) {
        ensureFinishSwpMove();
      }
      const pt = svgPoint(e);
      // Move only when Move mode is active; in Select mode: select only.
      if(mode!=='move'){ return; }
      dragging=true;
      dragOff.x = c.x - pt.x; dragOff.y = c.y - pt.y;
      // Prepare SWP-aware context (collapse SWP to a single straight run)
      slideCtx = null; // fallback only if no SWP detected
      rebuildTopology();
      const swpCtx = beginSwpMove(c);
      if(swpCtx){
        dragging = true;
        slideCtx = null;       // ensure we use SWP move
        g.classList.add('moving');
      }else{
        // fallback to legacy slide along adjacent wires (if no SWP)
        slideCtx = buildSlideContext(c);
      }
      const pins0 = compPinPositions(c).map(p=>({x:snapToBaseScalar(p.x),y:snapToBaseScalar(p.y)}));
      const wsA = wiresEndingAt(pins0[0]);
      const wsB = wiresEndingAt(pins0[1]||pins0[0]);
      dragStart = {
        x:c.x, y:c.y, pins:pins0,
        embedded:(wsA.length===1 && wsB.length===1),
        wA: wsA[0]||null, wB: wsB[0]||null
      };
      e.preventDefault();
      if (typeof g.setPointerCapture === 'function' && e.isPrimary) {
        try { g.setPointerCapture(e.pointerId); } catch(_) {}
      }
      e.stopPropagation();
    });
    g.addEventListener('pointermove', (e)=>{
    if(!dragging) return;
    const p = svgPoint(e);
    // Prefer SWP move if active
    if(moveCollapseCtx && moveCollapseCtx.kind==='swp'){
      const mc = moveCollapseCtx;
      if(mc.axis==='x'){
        let cand = snapPointPreferAnchor({ x: p.x + dragOff.x, y: p.y + dragOff.y });
        let nx = cand.x;
        nx = Math.max(mc.minCenter, Math.min(mc.maxCenter, nx));
        const candX = nx, candY = mc.fixed;
        if(!overlapsAnyOtherAt(c, candX, candY) && !pinsCoincideAnyAt(c, candX, candY)){
          c.x = candX; c.y = candY; mc.lastCenter = candX;
          updateComponentDOM(c);
        }
      } else {
        let cand = snapPointPreferAnchor({ x: p.x + dragOff.x, y: p.y + dragOff.y });
        let ny = cand.y;
        ny = Math.max(mc.minCenter, Math.min(mc.maxCenter, ny));
        const candX = mc.fixed, candY = ny;
        if(!overlapsAnyOtherAt(c, candX, candY) && !pinsCoincideAnyAt(c, candX, candY)){
          c.y = candY; c.x = candX; mc.lastCenter = ny;
          updateComponentDOM(c);
        }
      }
    } else if(slideCtx){
        if(slideCtx.axis==='x'){
            let nx = snap(p.x + dragOff.x);
            nx = Math.max(Math.min(slideCtx.max, nx), slideCtx.min);
            const candX = nx, candY = slideCtx.fixed;
            if(overlapsAnyOtherAt(c, candX, candY) || pinsCoincideAnyAt(c, candX, candY)) return;
            c.x = candX; c.y = candY;
        }else{
          let ny = snap(p.y + dragOff.y);
          ny = Math.max(Math.min(slideCtx.max, ny), slideCtx.min);
          const candX = slideCtx.fixed, candY = ny;
          if(!overlapsAnyOtherAt(c, candX, candY) && !pinsCoincideAnyAt(c, candX, candY)){
            c.y = candY; c.x = candX;
          }
          const pinsNow = compPinPositions(c).map(p=>({x:snapToBaseScalar(p.x),y:snapToBaseScalar(p.y)}));
          adjustWireEnd(slideCtx.wA, slideCtx.pinAStart, pinsNow[0]);
          adjustWireEnd(slideCtx.wB, slideCtx.pinBStart, pinsNow[1]);
          slideCtx.pinAStart = pinsNow[0]; slideCtx.pinBStart = pinsNow[1];
          updateComponentDOM(c); updateWireDOM(slideCtx.wA); updateWireDOM(slideCtx.wB);
        }
      }else{
        const cand = snapPointPreferAnchor({ x: p.x + dragOff.x, y: p.y + dragOff.y });
        const candX = cand.x;
        const candY = cand.y;
        if(!overlapsAnyOtherAt(c, candX, candY)){
          c.x = candX; c.y = candY;
          updateComponentDOM(c);
        }
      }
    });
    g.addEventListener('pointerup', (e)=>{
      if (typeof g.releasePointerCapture === 'function' && e.isPrimary) {
        try { g.releasePointerCapture(e.pointerId); } catch(_) {}
      }
      if(!dragging) return;
      dragging=false;
      if(dragStart){
        // If we were doing an SWP-constrained move, rebuild segments for that SWP
        if(moveCollapseCtx && moveCollapseCtx.kind==='swp'){
          finishSwpMove(c);
          g.classList.remove('moving');
          dragStart=null;
          return;
        }
        if(overlapsAnyOther(c)){
          c.x = dragStart.x; c.y = dragStart.y;
          if(slideCtx && dragStart.pins?.length===2){
            adjustWireEnd(slideCtx.wA, slideCtx.pinAStart, dragStart.pins[0]);
            adjustWireEnd(slideCtx.wB, slideCtx.pinBStart, dragStart.pins[1]);
          }
          updateComponentDOM(c);
          if(slideCtx){ updateWireDOM(slideCtx.wA); updateWireDOM(slideCtx.wB); }
        }else{
          if(!dragStart.embedded){
            const didBreak = breakWiresForComponent(c);
            if(didBreak){ deleteBridgeBetweenPins(c); redraw(); }
            else { updateComponentDOM(c); }
          }else{
            updateComponentDOM(c);
            if(slideCtx){ updateWireDOM(slideCtx.wA); updateWireDOM(slideCtx.wB); }
          }
        }
        dragStart=null;
      }
    });
    g.addEventListener('pointercancel', ()=>{ dragging=false; });

    // draw symbol via helper
    g.appendChild(buildSymbolGroup(c));
    return g;
  }

  // Build a fresh SVG group for a component’s symbol and label text.
  function buildSymbolGroup(c){
    const gg = document.createElementNS('http://www.w3.org/2000/svg','g');
    gg.setAttribute('transform', `rotate(${c.rot} ${c.x} ${c.y})`);
    const add = (el)=>{ gg.appendChild(el); return el; };
    const line = (x1,y1,x2,y2)=>{ const ln = document.createElementNS('http://www.w3.org/2000/svg','line'); ln.setAttribute('x1',x1); ln.setAttribute('y1',y1); ln.setAttribute('x2',x2); ln.setAttribute('y2',y2); ln.setAttribute('stroke','var(--component)'); ln.setAttribute('stroke-width','2'); return add(ln); };
    const path = (d)=>{ const p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d',d); p.setAttribute('fill','none'); p.setAttribute('stroke','var(--component)'); p.setAttribute('stroke-width','2'); return add(p); };

    // two-pin lead stubs
    if(['resistor','capacitor','inductor','diode','battery','ac'].includes(c.type)){
      const ax = c.x - 48, bx = c.x + 48, y = c.y;
      line(ax, y, ax+12, y); line(bx-12, y, bx, y);
    }
    if(c.type==='resistor'){
      const y=c.y, x=c.x-36;
      path(`M ${x} ${y} l 8 -10 l 8 20 l 8 -20 l 8 20 l 8 -20 l 8 20 l 8 -10`);
    }
    if(c.type==='capacitor'){
      const y=c.y, x1=c.x-8, x2=c.x+8;
      line(x1, y-16, x1, y+16);
      line(x2, y-16, x2, y+16);
    }
    if(c.type==='inductor'){
      const y=c.y, start=c.x-28, r=8; let d=`M ${start} ${y}`;
      for(let i=0;i<5;i++) d += ` q ${r} -${r} ${r*2} 0`;
      path(d);
    }
    if(c.type==='diode'){
      // subtype-aware diode rendering
      drawDiodeInto(gg, c, (c.props && c.props.subtype) ? c.props.subtype : 'generic');      
    }
    if(c.type==='battery'){
      // Battery symbol: negative terminal (long line) on left, positive terminal (short line) on right
      // Pins are at x ± 2*GRID (x ± 48), so draw lines extending toward the pins
      const y=c.y;
      const pinOffset = 2*GRID; // 48px
      
      // Negative terminal (long line) - left side
      const xNeg = c.x - 10;
      line(xNeg, y-18, xNeg, y+18);
      // Connection line from negative terminal to left pin
      line(xNeg, y, c.x - pinOffset, y);
      
      // Positive terminal (short line) - right side
      const xPos = c.x + 10;
      line(xPos, y-12, xPos, y+12);
      // Connection line from positive terminal to right pin
      line(xPos, y, c.x + pinOffset, y);
      
      // Add polarity symbols - offset above the centerline for better visibility
      const plusText = document.createElementNS('http://www.w3.org/2000/svg','text');
      plusText.setAttribute('x', String(xPos + 16));
      plusText.setAttribute('y', String(y - 8));
      plusText.setAttribute('text-anchor','start');
      plusText.setAttribute('font-size','16');
      plusText.setAttribute('font-weight','bold');
      plusText.setAttribute('fill','var(--component)');
      plusText.textContent = '+';
      gg.appendChild(plusText);
      
      const minusText = document.createElementNS('http://www.w3.org/2000/svg','text');
      minusText.setAttribute('x', String(xNeg - 16));
      minusText.setAttribute('y', String(y - 8));
      minusText.setAttribute('text-anchor','end');
      minusText.setAttribute('font-size','16');
      minusText.setAttribute('font-weight','bold');
      minusText.setAttribute('fill','var(--component)');
      minusText.textContent = '−';
      gg.appendChild(minusText);
    }
    if(c.type==='ac'){
      const circ = document.createElementNS('http://www.w3.org/2000/svg','circle');
      setAttr(circ, 'cx', c.x);
      setAttr(circ, 'cy', c.y);
      setAttr(circ, 'r', 14);
      circ.setAttribute('fill','none'); circ.setAttribute('stroke','var(--component)'); circ.setAttribute('stroke-width','2');
      gg.appendChild(circ);
      path(`M ${c.x-10} ${c.y} q 5 -8 10 0 q 5 8 10 0`);
    }
    if(c.type==='npn' || c.type==='pnp'){
      const x=c.x, y=c.y, arrowOut = c.type==='npn';
      line(x, y-28, x, y+28);         // base
      line(x, y-10, x+30, y-30);      // collector
      line(x, y+10, x+30, y+30);      // emitter
      const arr = document.createElementNS('http://www.w3.org/2000/svg','path');
      const dx = arrowOut ? 8 : -8;
      arr.setAttribute('d', `M ${x+30} ${y+30} l ${-dx} -6 l 0 12 Z`);
      arr.setAttribute('fill','var(--component)'); gg.appendChild(arr);
    }
    if(c.type==='ground'){
      const y=c.y, x=c.x;
      line(x-16, y,   x+16, y);
      line(x-10, y+6, x+10, y+6);
      line(x-4,  y+12, x+4, y+12);
    }
    // label (and optional voltage line)
    const label = document.createElementNS('http://www.w3.org/2000/svg','text');
    label.setAttribute('x', c.x); label.setAttribute('y', c.y+46);
    label.setAttribute('text-anchor','middle'); label.setAttribute('font-size','12'); label.setAttribute('fill','var(--ink)');
    const valText = formatValue(c);
    label.textContent = valText ? `${c.label} (${valText})` : c.label;
    gg.appendChild(label);
    if(c.type==='battery' || c.type==='ac'){
      const vtxt = document.createElementNS('http://www.w3.org/2000/svg','text');
      vtxt.setAttribute('x', c.x); vtxt.setAttribute('y', c.y+62);
      vtxt.setAttribute('text-anchor','middle'); vtxt.setAttribute('font-size','12'); vtxt.setAttribute('fill','var(--ink)');
      const v = (c.props && (c.props.voltage ?? '') !== '') ? `${c.props.voltage} V` : '';
      vtxt.textContent = v; gg.appendChild(vtxt);
    }
    return gg;
  }

  // Draw diode into existing symbol group 'gg' honoring rotation already set on gg.
  function drawDiodeInto(gg, c, subtype){
    const stroke='var(--component)'; const sw=2;
    const add = (el)=>{ gg.appendChild(el); return el; };
    const mk = (tag)=> document.createElementNS('http://www.w3.org/2000/svg', tag);
    const lineEl = (x1,y1,x2,y2,w=sw)=>{ const ln=mk('line'); ln.setAttribute('x1',x1); ln.setAttribute('y1',y1); ln.setAttribute('x2',x2); ln.setAttribute('y2',y2); ln.setAttribute('stroke',stroke); ln.setAttribute('stroke-width',w); ln.setAttribute('fill','none'); return add(ln); };
    const pathEl = (d,w=sw)=>{ const p=mk('path'); p.setAttribute('d',d); p.setAttribute('stroke',stroke); p.setAttribute('stroke-width',w); p.setAttribute('fill','none'); return add(p); };
    // Base geometry around center
    const y=c.y, xTri=c.x-24;
    // Triangle (anode) and bar (cathode)
    pathEl(`M ${xTri} ${y-16} L ${xTri} ${y+16} L ${c.x} ${y} Z`);
    lineEl(c.x+8, y-16, c.x+8, y+16); // cathode bar
    // Subtype adorners near cathode side
    const cx=c.x+8, cy=y;
    const addArrow = (outward=true)=>{
      const dir = outward ? 1 : -1, ax = cx + (outward?10:-10);
      pathEl(`M ${ax} ${cy-10} l ${6*dir} -6 m -6 6 l ${6*dir} 6`);
      pathEl(`M ${ax} ${cy+10} l ${6*dir} -6 m -6 6 l ${6*dir} 6`);
    };
    switch(String(subtype||'generic').toLowerCase()){
      case 'zener':
        // Bent cathode: two short slanted ticks into bar
        lineEl(cx-14, cy-6, cx, cy);
        lineEl(cx-14, cy+6, cx, cy);
        break;
      case 'schottky':
        // Schottky: small second bar close to cathode
        lineEl(cx-6, cy-12, cx-6, cy+12);
        break;
      case 'led':
        addArrow(true);
        break;
      case 'photo':
        addArrow(false);
        break;
      case 'tunnel':
        // Tunnel/Esaki: extra vertical bar near cathode
        lineEl(cx-10, cy-12, cx-10, cy+12);
        break;
      case 'varactor':
      case 'varicap':
        // Varactor: parallel plate near cathode (capacitor-like)
        lineEl(cx+8, cy-12, cx+8, cy+12);
        break;
      case 'laser':
        // Laser diode: LED arrows + cavity line
        addArrow(true);
        lineEl(cx+14, cy-14, cx+14, cy+14);
        break;
      case 'generic':
      default:
        // no extra marks
        break;
    }
  }  

  function redrawCanvasOnly(){
    // components
    gComps.replaceChildren();
    for(const c of components){ gComps.appendChild(drawComponent(c)); }
    // wires (with wide, nearly-transparent hit-target + hover cue)
    gWires.replaceChildren();
    for (const w of wires){
      const g = document.createElementNS('http://www.w3.org/2000/svg','g');
      g.setAttribute('data-id', w.id);

      // visible stroke
      // visible stroke (effective: explicit → netclass → theme)
      ensureStroke(w);
      const eff = effectiveStroke(w, netClassForWire(w), THEME);

      const vis = document.createElementNS('http://www.w3.org/2000/svg','polyline');
      vis.setAttribute('class','wire-stroke');
      vis.setAttribute('fill','none');
      vis.setAttribute('stroke', rgba01ToCss(eff.color));
      vis.setAttribute('stroke-width', String(mmToPx(eff.width))); // default 0.25mm -> 1px
      vis.setAttribute('stroke-linecap','round');
      vis.setAttribute('stroke-linejoin','round');
      const dashes = dashArrayFor(eff.type);
      if (dashes) vis.setAttribute('stroke-dasharray', dashes); else vis.removeAttribute('stroke-dasharray');
      vis.setAttribute('points', w.points.map(p=>`${p.x},${p.y}`).join(' '));
      vis.setAttribute('data-wire-stroke', w.id);
      // visible stroke must NOT catch events—let the hit overlay do it
      vis.setAttribute('pointer-events','none');

      // transparent hit overlay (easy clicking)
      const hit = document.createElementNS('http://www.w3.org/2000/svg','polyline');
      hit.setAttribute('fill','none');
      hit.setAttribute('stroke','#000');
      hit.setAttribute('stroke-opacity','0.001'); // capture events reliably
      hit.setAttribute('stroke-width','24');
      // GATE POINTER EVENTS: hit overlay disabled during Wire/Place so it doesn't block clicks
      const allowHits = (mode!=='wire' && mode!=='place');
      hit.setAttribute('pointer-events', allowHits ? 'stroke' : 'none');
      hit.setAttribute('points', vis.getAttribute('points')); // IMPORTANT: give the hit polyline geometry

      // interactions
      hit.addEventListener('pointerenter', ()=>{ if(allowHits) vis.classList.add('hover'); });
      hit.addEventListener('pointerleave', ()=>{ if(allowHits) vis.classList.remove('hover'); });
      hit.addEventListener('pointerdown', (e)=>{
        if (mode === 'delete') { removeWireAtPoint(w, svgPoint(e)); }
        else {
          if(mode === 'none'){ setMode('select'); }
          if (mode === 'select' || mode==='move') {
            // Select by wire (segment) id only; legacy segIndex is no longer required.
            selecting('wire', w.id, null);
          }
        }
        e.stopPropagation();
      });

      g.appendChild(hit);
      g.appendChild(vis);
      // persistent selection highlight for the selected wire segment
      if (selection.kind === 'wire' && selection.id === w.id) {
        if (w.points.length >= 2) {
          const a = w.points[0], b = w.points[w.points.length-1];
          const selSeg = document.createElementNS('http://www.w3.org/2000/svg','line');
          setAttr(selSeg, 'x1', a.x); setAttr(selSeg, 'y1', a.y);
          setAttr(selSeg, 'x2', b.x); setAttr(selSeg, 'y2', b.y);
          selSeg.setAttribute('stroke','var(--select)');
          selSeg.setAttribute('stroke-width','3');
          selSeg.setAttribute('stroke-linecap','round');
          selSeg.setAttribute('pointer-events','none');
          g.appendChild(selSeg);
        }
      }
      gWires.appendChild(g);
    }
    // junctions
    gJunctions.replaceChildren();
    for (const j of junctions){
      const nc = NET_CLASSES[j.netId || 'default'] || NET_CLASSES.default;
      const sizeMm = (j.size!=null ? j.size : nc.junction.size);
      const color = j.color ? j.color : rgba01ToCss(nc.junction.color);
      const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
      setAttr(dot, 'cx', j.at.x); setAttr(dot, 'cy', j.at.y);
      setAttr(dot, 'r', Math.max(2, Math.round(mmToPx(sizeMm)/2)));
      dot.setAttribute('fill', color);
      dot.setAttribute('stroke', 'var(--bg)');
      dot.setAttribute('stroke-width', '1');
      gJunctions.appendChild(dot);
    }
    
    // Draw junction dots at wire endpoints if enabled
    if(showJunctionDots){
      const scale = svg.clientWidth / Math.max(1, viewW);
      const dotRadius = 3 / scale; // 3 screen pixels
      for(const w of wires){
        if(w.points.length < 2) continue;
        // Draw dots at first and last points
        for(const pt of [w.points[0], w.points[w.points.length - 1]]){
          const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
          setAttr(dot, 'cx', pt.x); setAttr(dot, 'cy', pt.y);
          setAttr(dot, 'r', dotRadius);
          dot.setAttribute('fill', 'white');
          dot.setAttribute('stroke', 'black');
          dot.setAttribute('stroke-width', String(1 / scale)); // 1 screen pixel
          dot.setAttribute('pointer-events', 'none');
          gJunctions.appendChild(dot);
        }
      }
    }
    updateSelectionOutline();    
    updateCounts();
    renderNetList();

    // Endpoint selection squares (overlay). Visible while placing wires or components
    // Remove any previous endpoint markers in the overlay
    try{
      $qa('[data-endpoint]', gOverlay).forEach(el => el.remove());
    }catch(_){ }
    // Show endpoint squares while wiring, placing, or when Select is active
    if(mode === 'wire' || mode === 'place' || mode === 'select'){
      const ns = 'http://www.w3.org/2000/svg';
      for(const w of wires){
        if(!w.points || w.points.length < 2) continue;
        ensureStroke(w);
        const eff = effectiveStroke(w, netClassForWire(w), THEME);
        // compute square size in user units: about 3x the visible stroke width (in px -> user units)
        const strokePx = Math.max(1, mmToPx(eff.width || 0.25));
        // convert px to user units: 1 user unit == 1 SVG coordinate; userScale = screen px per user unit
        const userPerPx = 1 / Math.max(1e-6, userScale());
        // Slightly reduce the visual prominence: use a smaller multiplier and
        // a smaller minimum side so squares are less dominant.
        const side = Math.max(3, Math.round(strokePx * 2.2 * userPerPx));
        const half = side / 2;
        const ends = [ w.points[0], w.points[w.points.length-1] ];
        for(const [ei, pt] of ends.map((p,i)=>[i,p] as [number,Point])){
            // Choose a fixed on-screen size (px) so squares remain visible when zoomed out.
            const desiredScreenPx = 9;
            const scale = userScale(); // screen px per user unit
            const widthUser = desiredScreenPx / Math.max(1e-6, scale);
            // Center the square directly on the actual wire point in SVG coordinates
            const rx = pt.x - widthUser / 2;
            const ry = pt.y - widthUser / 2;
            const rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('data-endpoint', '1');
            rect.setAttribute('x', String(rx)); rect.setAttribute('y', String(ry));
            rect.setAttribute('width', String(widthUser)); rect.setAttribute('height', String(widthUser));
            rect.setAttribute('fill', 'rgba(0,200,0,0.08)');
            rect.setAttribute('stroke', 'lime'); rect.setAttribute('stroke-width', String(1 / Math.max(1e-6, scale)));
          rect.style.cursor = 'pointer';
          // Store the actual wire endpoint coordinates (not snapped) so connections align precisely
          (rect as any).endpoint = { x: pt.x, y: pt.y };
          (rect as any).wireId = w.id;
          (rect as any).endpointIndex = ei; // 0=start, 1=end
          // Click/tap behavior: snap to exact endpoint when placing wires/components
          rect.addEventListener('pointerdown', (ev)=>{
            const ep = (ev.currentTarget as any).endpoint as Point;
            const wid = (ev.currentTarget as any).wireId as string | undefined;
            // Prevent the event from bubbling up to the main SVG handler which
            // also listens for pointerdown; overlay clicks must be handled here
            // exclusively to guarantee canonical base-grid snapping.
            ev.preventDefault(); ev.stopPropagation();
            try{ console.debug('[overlay] endpoint-click', { ep, wireId: wid }); }catch(_){ }
            if(mode === 'select'){
              // In select mode, pick the wire segment corresponding to this endpoint
              if(wid){ selection = { kind: 'wire', id: wid, segIndex: null }; renderInspector(); updateSelectionOutline(); }
              return;
            }
            if(!ep) return;
            if(mode === 'wire'){
              // start or add a drawing point exactly at the endpoint
              if(!drawing.active){ drawing.active = true; drawing.points = [{ x: ep.x, y: ep.y }]; drawing.cursor = { x: ep.x, y: ep.y }; }
              else {
                // Use exact endpoint coordinates - no ortho constraint when clicking connection squares
                drawing.points.push({ x: ep.x, y: ep.y });
                drawing.cursor = { x: ep.x, y: ep.y };
                // Clear the override indicator that was set on hover
                if(endpointOverrideActive){
                  endpointOverrideActive = false;
                  if(updateOrthoButtonVisual) updateOrthoButtonVisual();
                }
              }
              renderDrawing(); redraw();
            } else if(mode === 'place' && placeType){
              // Place a component centered at the endpoint (mimic pointerdown place behavior)
              const at = { x: ep.x, y: ep.y };
              let rot = 0;
              if(isTwoPinType(placeType)){
                const hit = nearestSegmentAtPoint(at, 18);
                if(hit){ rot = normDeg(hit.angle); }
              }
              const id = uid(placeType);
              const labelPrefix = {resistor:'R', capacitor:'C', inductor:'L', diode:'D', npn:'Q', pnp:'Q', ground:'GND', battery:'BT', ac:'AC'}[placeType] || 'X';
              const comp: Component = { id, type: placeType, x: at.x, y: at.y, rot, label: `${labelPrefix}${counters[placeType]-1}`, value: '', props: {} };
              if (placeType === 'diode') (comp.props as Component['props']).subtype = diodeSubtype as DiodeSubtype;
              pushUndo();
              components.push(comp);
              breakWiresForComponent(comp);
              if(isTwoPinType(placeType)) deleteBridgeBetweenPins(comp);
              setMode('select'); placeType = null;
              selection = { kind: 'component', id, segIndex: null };
              redraw();
            }
          });
          gOverlay.appendChild(rect);
        }
      }
    }
  }

  function redraw(){
    redrawCanvasOnly();
    renderInspector();
    rebuildTopology();
  }

  // Update selection styling (no circle; tint symbol graphics via CSS)
  function updateSelectionOutline(){
    document.querySelectorAll('#components g.comp').forEach(g=>{
      const id = g.getAttribute('data-id');
      const on = selection.kind==='component' && selection.id===id;
      g.classList.toggle('selected', !!on);
    });    
  }

  function selecting(kind, id, segIndex=null){
    // If we're in Move mode and have a collapsed SWP, finalize it when switching away
    // from the current component (or to a non-component selection).
    if (mode === 'move' && moveCollapseCtx && selection.kind === 'component') {
      const prevId = selection.id;
      if (kind !== 'component' || id !== prevId) {
        ensureFinishSwpMove();
      }
    }
    // Normalize segIndex: legacy callers may pass undefined; prefer null for clarity.
    const si = Number.isInteger(segIndex) ? segIndex : null;
    selection = { kind, id, segIndex: si };
    // If we're in Move mode and a component is now selected, collapse its SWP immediately.
    if (mode === 'move' && kind === 'component') {
      ensureCollapseForSelection();
    }
    redraw();
  }

  function mendWireAtPoints(hitA, hitB){
    if (hitA && hitB){
      const wA = hitA.w, wB = hitB.w;
      // Orient so that aPoints ends at pinA and bPoints starts at pinB
      const aPoints = (hitA.endIndex === wA.points.length-1) ? wA.points.slice() : wA.points.slice().reverse();
      const bPoints = (hitB.endIndex === 0)                  ? wB.points.slice() : wB.points.slice().reverse();
      // Remove the pin vertices themselves, then concatenate
      const left  = aPoints.slice(0, Math.max(0, aPoints.length - 1));
      const right = bPoints.slice(1);
      const joined = left.concat(right);
      const merged = collapseDuplicateVertices(joined);
      // Replace the two wires with a single merged polyline
      wires = wires.filter(w => w!==wA && w!==wB);
      if (merged.length >= 2) {
        // prefer left-side stroke; fall back to right-side stroke; else fall back to legacy color
        const inheritedStroke = wA.stroke ? { ...wA.stroke } : (wB.stroke ? { ...wB.stroke } : undefined);
        const colorCss = inheritedStroke ? rgba01ToCss(inheritedStroke.color) : (wA.color || wB.color || defaultWireColor);
        // Push as per-segment wires rather than a single polyline
        for(let i=0;i<merged.length-1;i++){
          const segPts = [ merged[i], merged[i+1] ];
          const segStroke = inheritedStroke ? { ...inheritedStroke, color: { ...inheritedStroke.color } } : undefined;
          wires.push({ id: uid('wire'), points: segPts, color: segStroke ? rgba01ToCss(segStroke.color) : colorCss, stroke: segStroke });
        }
      }
    }        
  }

  function removeComponent(id){
    pushUndo();
    const comp = components.find(c=>c.id===id);
    // Mend only for simple 2-pin parts
    if (comp && ['resistor','capacitor','inductor','diode','battery','ac'].includes(comp.type)) {
      // Use raw pin positions (no snap) so angled wires mend correctly
      const pins = compPinPositions(comp);
      if (pins.length === 2) {
        // Find the two wire endpoints that touch the pins (works for angled too)
        const hitA = findWireEndpointNear(pins[0], 0.9);
        const hitB = findWireEndpointNear(pins[1], 0.9);
        if (hitA && hitB){
          mendWireAtPoints(hitA, hitB);
        }        
      }
    }
    components = components.filter(c => c.id !== id);
    if (selection.id === id) selection = { kind:null, id:null, segIndex:null };
    normalizeAllWires();
    unifyInlineWires();
    redraw();
  }

  function removeWireAtPoint(w, p){
    // For per-segment wires, deleting the clicked segment removes the whole wire object.
    if (!w) return;
    pushUndo();
    if (w.points.length === 2) {
      wires = wires.filter(x => x.id !== w.id);
      selection = { kind: null, id: null, segIndex: null };
      normalizeAllWires();
      unifyInlineWires();
      redraw();
      return;
    }
    // Fallback for multi-point polylines: delete only the clicked sub-segment.
    const idx = nearestSegmentIndex(w.points, p);
    if (idx < 0 || idx >= w.points.length - 1) return;
    removeWireSegment(w, idx);
  }

  function removeWireSegment(w, idx){
    if(!w) return;
    if (idx < 0 || idx >= w.points.length - 1) return;
     const left = w.points.slice(0, idx + 1);   // up to the start of removed seg (no segment if len<2)
     const right = w.points.slice(idx + 1);     // from end of removed seg
     // Remove original wire
     wires = wires.filter(x => x.id !== w.id);
     // Add split pieces back if they contain at least one segment
     const L = normalizedPolylineOrNull(left);
     const R = normalizedPolylineOrNull(right);
  if (L) wires.push({ id: uid('wire'), points: L, color: w.color, stroke: w.stroke ? { ...w.stroke } : undefined });
  if (R) wires.push({ id: uid('wire'), points: R, color: w.color, stroke: w.stroke ? { ...w.stroke } : undefined });
     if (selection.id === w.id) selection = { kind:null, id:null, segIndex:null };
     normalizeAllWires();
     unifyInlineWires();
     redraw();
    }  

  // Format value+unit shown on the schematic label line
  function formatValue(c){
    const v = (c.value ?? '').toString().trim();
    if(!v) return '';
    if(c.type==='resistor'){
      const u = (c.props && c.props.unit) || '\u03A9'; // Ω
      return `${v} ${u}`;
    }
    if(c.type==='capacitor'){
      const u = (c.props && c.props.unit) || 'F';
      return `${v} ${u}`;
    }
    if(c.type==='inductor'){
      const u = (c.props && c.props.unit) || 'H';
      return `${v} ${u}`;
    }
    return v;
  }  

  function nearestSegmentIndex(pts: Point[], p: Point){
    let best=-1, bestD=1e9;
    for(let i=0;i<pts.length-1;i++){
      const d = pointToSegmentDistance(p, pts[i], pts[i+1]);
      if(d<bestD){ bestD=d; best=i; }
    }
    return best;
  }

  // Local version of projectPointToSegment that returns {q, t} format
  function projectPointToSegmentWithT(p: Point, a: Point, b: Point){
    const A={x:a.x,y:a.y}, B={x:b.x,y:b.y}, P={x:p.x,y:p.y};
    const ABx=B.x-A.x, ABy=B.y-A.y; const APx=P.x-A.x, APy=P.y-A.y;
    const ab2 = ABx*ABx + ABy*ABy; if(ab2===0) return {q:{x:A.x,y:A.y}, t:0};
    let t = (APx*ABx + APy*ABy)/ab2; t=Math.max(0, Math.min(1,t));
    return { q:{ x:A.x + t*ABx, y:A.y + t*ABy }, t };
  }

  // Angles / nearest segment helpers
  const isTwoPinType = (t: string) => ['resistor','capacitor','inductor','diode','battery','ac'].includes(t);

  function nearestSegmentAtPoint(p, maxDist=18){
    let best=null, bestD=Infinity;
    for(const w of wires){
      for(let i=0;i<w.points.length-1;i++){
        const a=w.points[i], b=w.points[i+1];
        const {q,t} = projectPointToSegmentWithT(p,a,b);
        if(t<=0 || t>=1) continue; // interior only
        const d = Math.hypot(p.x-q.x, p.y-q.y);
        if(d<bestD){ bestD=d; best={w, idx:i, q, angle: segmentAngle(a,b)}; }
      }
    }
    return (best && bestD<=maxDist) ? best : null;
  }
  // --- Keep selection stable across a restroke that rewrites wire objects ---
  function midOfSeg(pts: Point[], idx: number): Point {
    const a = pts[idx], b = pts[idx+1];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function reselectNearestAt(p: Point) {
    const hit = nearestSegmentAtPoint(p, 24);
    if (hit && hit.w) {
      selecting('wire', hit.w.id, hit.idx); // will redraw + rebuild the Inspector
    } else {
      redraw(); // fallback
    }
  }

  // ----- Marquee helpers -----
  function beginMarqueeAt(p, startedOnEmpty, preferComponents){
    marquee.active = true; marquee.start = p; marquee.end = p; marquee.startedOnEmpty = !!startedOnEmpty;
    marquee.shiftPreferComponents = !!preferComponents;  
    if(marquee.rectEl) marquee.rectEl.remove();
    marquee.rectEl = document.createElementNS('http://www.w3.org/2000/svg','rect');
    marquee.rectEl.setAttribute('class','marquee');
    gOverlay.appendChild(marquee.rectEl);
    updateMarqueeTo(p);
  }
  function updateMarqueeTo(p){
    if(!marquee.active) return;
    marquee.end = p;
    const r = rectFromPoints(marquee.start, marquee.end);
    setAttr(marquee.rectEl, 'x', r.x); setAttr(marquee.rectEl, 'y', r.y);
    setAttr(marquee.rectEl, 'width', r.w); setAttr(marquee.rectEl, 'height', r.h);
  }
  function finishMarquee(){
    if(!marquee.active) return false;
    const r = rectFromPoints(marquee.start, marquee.end);
    const movedEnough = (Math.abs(r.w) > 2 || Math.abs(r.h) > 2);
    // remove rect
    marquee.rectEl?.remove(); marquee.rectEl=null;
    marquee.active=false;
    // If it wasn't really a drag, treat it as a normal empty click
    if(!movedEnough){
      if(marquee.startedOnEmpty){
        selection = {kind:null,id:null,segIndex:null};
        redraw();
      }
      return false;
    }
    // Build candidates once
    const cx = r.x + r.w/2, cy = r.y + r.h/2;
    const segs = [];
    for(const w of wires){
      for(let i=0;i<w.points.length-1;i++){
        const a=w.points[i], b=w.points[i+1];
        if(segmentIntersectsRect(a,b,r)){
          const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
          const d2=(mx-cx)*(mx-cx)+(my-cy)*(my-cy);
          segs.push({w, idx:i, d2});
        }
      }
    }
    const comps = [];
    for(const c of components){
      if(inRect({x:c.x,y:c.y}, r)){
        const d2=(c.x-cx)*(c.x-cx)+(c.y-cy)*(c.y-cy);
        comps.push({c,d2});
      }
    }
    // Decide priority based on Shift during drag
    const preferComponents = !!marquee.shiftPreferComponents;
    if(preferComponents){
      if(comps.length){
        comps.sort((u,v)=>u.d2-v.d2);
        selection = {kind:'component', id:comps[0].c.id, segIndex:null};
        redraw(); return true;
      }
      if(segs.length){
        segs.sort((u,v)=>u.d2-v.d2);
        const pick = segs[0];
        selection = {kind:'wire', id:pick.w.id, segIndex:null};
        redraw(); return true;
      }
    }else{
      if(segs.length){
        segs.sort((u,v)=>u.d2-v.d2);
        const pick = segs[0];
        selection = {kind:'wire', id:pick.w.id, segIndex:null};
        redraw(); return true;
      }
      if(comps.length){
        comps.sort((u,v)=>u.d2-v.d2);
        selection = {kind:'component', id:comps[0].c.id, segIndex:null};
        redraw(); return true;
      }
    }    
    // Nothing hit: clear selection
    selection = {kind:null,id:null,segIndex:null};
    redraw();
    return false;
  }

  function breakWiresForComponent(c){
    // Break wires at EACH connection pin (not at component center)
    let broke=false;
    const pins = compPinPositions(c);
    for (const pin of pins){
      if(breakNearestWireAtPin(pin)) broke=true;
    }
    return broke;
  }
  function breakNearestWireAtPin(pin){
    // search all wires/segments for nearest to this pin; split if close
    for(const w of [...wires]){
      for(let i=0;i<w.points.length-1;i++){
        const a=w.points[i], b=w.points[i+1];
        const {q,t} = projectPointToSegmentWithT(pin,a,b);
        const dist = pointToSegmentDistance(pin,a,b);
        // axis-aligned fallback for robust vertical/horizontal splitting
        const isVertical = (a.x===b.x);
        const isHorizontal = (a.y===b.y);
        const withinVert = isVertical && Math.abs(pin.x - a.x) <= GRID/2 && pin.y >= Math.min(a.y,b.y) && pin.y <= Math.max(a.y,b.y);
        const withinHorz = isHorizontal && Math.abs(pin.y - a.y) <= GRID/2 && pin.x >= Math.min(a.x,b.x) && pin.x <= Math.max(a.x,b.x);
        const nearInterior = (t>0.001 && t<0.999 && dist <= 20);        
        if( withinVert || withinHorz || nearInterior ){
          // For angled (nearInterior), split at the exact projection q; else use snapped pin
          const bp = nearInterior ? {x:q.x, y:q.y} : {x:snapToBaseScalar(pin.x), y:snapToBaseScalar(pin.y)};
          const left  = w.points.slice(0,i+1).concat([bp]);
          const right = [bp].concat(w.points.slice(i+1));
          // replace original with normalized children (drop degenerate)
          wires = wires.filter(x=>x.id!==w.id);
          const L = normalizedPolylineOrNull(left);
          const R = normalizedPolylineOrNull(right);
          if (L) wires.push({ id: uid('wire'), points: L, color: w.color, stroke: w.stroke ? { ...w.stroke } : undefined });
          if (R) wires.push({ id: uid('wire'), points: R, color: w.color, stroke: w.stroke ? { ...w.stroke } : undefined });
          return true;
        }
      }
    }
    return false;
  }
  // Remove the small bridge wire between the two pins of a 2-pin part
  function deleteBridgeBetweenPins(c){
    const twoPin = ['resistor','capacitor','inductor','diode','battery','ac'];
    if(!twoPin.includes(c.type)) return;
    const pins = compPinPositions(c);
    if(pins.length !== 2) return;
    const a = {x:pins[0].x, y:pins[0].y};
    const b = {x:pins[1].x, y:pins[1].y};
    const EPS = 1e-3;
    const eq = (p,q)=> Math.abs(p.x-q.x)<EPS && Math.abs(p.y-q.y)<EPS;
    wires = wires.filter(w=>{
      if(w.points.length!==2) return true;
      const p0=w.points[0], p1=w.points[1];
      const isBridge = (eq(p0,a)&&eq(p1,b)) || (eq(p0,b)&&eq(p1,a));
      return !isBridge;
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
  function userScale(){ return svg.clientWidth / Math.max(1, viewW); }

  // base snap in SVG user units corresponding to SNAP_NM (50 mils)
  function baseSnapUser(){
    // 50 mils is always 5 user units in our coordinate system (100 px/inch DPI)
    // This is independent of zoom - the viewBox scaling handles the visual zoom
    return nmToPx(SNAP_NM); // Returns 5 user units for 50 mils
  }

  // Snap a scalar value to the base 50-mil grid in user units
  function snapToBaseScalar(v: number){ const b = baseSnapUser(); return Math.round(v / b) * b; }

  // Collect anchor points: component pins and wire endpoints (snapped to base grid)
  function collectAnchors(){
    const out: Point[] = [];
    for(const c of components){
      const pins = compPinPositions(c);
      for(const p of pins) out.push({ x: snapToBaseScalar(p.x), y: snapToBaseScalar(p.y) });
    }
    for(const w of wires){
      if(!w.points || w.points.length<2) continue;
      const a = w.points[0], b = w.points[w.points.length-1];
      // Use actual coordinates, not snapped, to match endpoint square storage
      out.push({ x: a.x, y: a.y });
      out.push({ x: b.x, y: b.y });
    }
    return out;
  }

  // Find nearest anchor to `pt` within thresholdPx screen pixels. Returns Point or null.
  function nearestAnchorTo(pt: Point, thresholdPx = 10){
    const anchors = collectAnchors();
    const scale = userScale();
    let best: Point | null = null; let bestD = Infinity;
    for(const a of anchors){
      const dx = (a.x - pt.x) * scale; const dy = (a.y - pt.y) * scale;
      const d = Math.hypot(dx, dy);
      if(d < bestD){ bestD = d; best = a; }
    }
    if(bestD <= thresholdPx) return best;
    return null;
  }

  // Debug helper: dump anchors, overlay rects, and wire endpoints to console
  function debugDumpAnchors(){
    try{
      console.groupCollapsed('DEBUG Anchors Dump');
      console.log('collectAnchors()', collectAnchors());
      const rects = $qa<SVGElement>('[data-endpoint]', gOverlay).map(r=>({
        endpoint: (r as any).endpoint || null,
        wireId: (r as any).wireId || null,
        bbox: (r as SVGGraphicsElement).getBBox()
      }));
      console.log('overlayRects', rects);
      console.log('wires endpoints', wires.map(w=>({ id: w.id, start: w.points?.[0] || null, end: w.points?.[w.points.length-1] || null })));
      console.groupEnd();
    }catch(err){ console.warn('debugDumpAnchors failed', err); }
  }

  // Snap a user-space point to nearest anchor or wire segment if within threshold, else to grid via snap().
  function snapPointPreferAnchor(p: Point, thresholdPx = 10){
    // First, check for anchors (wire endpoints and component pins)
    const a = nearestAnchorTo(p, thresholdPx);
    if(a) return { x: a.x, y: a.y };
    
    // Second, check for nearby wire segments (snap to wire anywhere along its length)
    // Convert 50 mils threshold to user units for wire segment snapping
    const scale = svg.clientWidth / Math.max(1, viewW);
    const wireSnapThreshold = nmToPx(SNAP_NM); // 50 mils in user units
    const wireSnapThresholdPx = wireSnapThreshold * scale;
    
    const seg = nearestSegmentAtPoint(p, wireSnapThresholdPx);
    if(seg && seg.q){
      // Snap to the projected point on the wire segment
      return { x: seg.q.x, y: seg.q.y };
    }
    
    // Finally, fall back to grid snapping
    return { x: snap(p.x), y: snap(p.y) };
  }
  function wiresEndingAt(pt){
    return wires.filter(w=>{
      const a=w.points[0], b=w.points[w.points.length-1];
      return eqPt(a,pt) || eqPt(b,pt);
    });
  }
  function otherEnd(w, endPt){
    const a=w.points[0], b=w.points[w.points.length-1];
    return eqPt(a,endPt)? b : a;
  }
  function otherEndpointOf(w, endPt){
    const a=w.points[0], b=w.points[w.points.length-1];
    return eqPt(a,endPt)? b : a;
  }  
  function adjacentOther(w, endPt){
    // return the vertex adjacent to the endpoint that equals endPt
    const n = w.points.length;
    if(n<2) return null;
    if(eqPt(w.points[0], endPt)) return w.points[1];
    if(eqPt(w.points[n-1], endPt)) return w.points[n-2];
    return null;
  }  

  function buildSlideContext(c){
    // only for simple 2-pin parts
    if(!['resistor','capacitor','inductor','diode','battery','ac'].includes(c.type)) return null;
    const pins = compPinPositions(c).map(p=>({x:snapToBaseScalar(p.x),y:snapToBaseScalar(p.y)}));
    if(pins.length!==2) return null;
    const axis = axisFromPins(pins);
    if(!axis) return null;
    const wA = wireAlongAxisAt(pins[0], axis);
    const wB = wireAlongAxisAt(pins[1], axis);
    if(!wA || !wB) return null;
    const aAdj = adjacentOther(wA, pins[0]);
    const bAdj = adjacentOther(wB, pins[1]);
    if(!aAdj || !bAdj) return null;
    if(axis==='x'){
      const fixed = pins[0].y;
      const min = Math.min(aAdj.x, bAdj.x);
      const max = Math.max(aAdj.x, bAdj.x);
      return {axis:'x', fixed, min, max, wA, wB, pinAStart:pins[0], pinBStart:pins[1]};
    } else {
      const fixed = pins[0].x;
      const min = Math.min(aAdj.y, bAdj.y);
      const max = Math.max(aAdj.y, bAdj.y);
      return {axis:'y', fixed, min, max, wA, wB, pinAStart:pins[0], pinBStart:pins[1]};
    }
  }

  function adjustWireEnd(w, oldEnd, newEnd){
    // replace whichever endpoint equals oldEnd with newEnd
    if(eqPt(w.points[0], oldEnd)) w.points[0] = {...newEnd};
    else if(eqPt(w.points[w.points.length-1], oldEnd)) w.points[w.points.length-1] = {...newEnd};
  }
  function replaceEndpoint(w, oldEnd, newEnd){
    // Replace a matching endpoint in w with newEnd, preserving all other vertices.
    if(eqPt(w.points[0], oldEnd)) {
      w.points[0] = {...newEnd};
      // collapse duplicate vertex if needed
      if(w.points.length>1 && eqPt(w.points[0], w.points[1])) w.points.shift();
    } else if(eqPt(w.points[w.points.length-1], oldEnd)) {
      w.points[w.points.length-1] = {...newEnd};
      if(w.points.length>1 && eqPt(w.points[w.points.length-1], w.points[w.points.length-2])) w.points.pop();
    }
  }

  // Determine axis from a 2-pin part’s pin positions ('x' = horizontal, 'y' = vertical)
  function axisFromPins(pins: Point[] | Array<{x:number; y:number}>): Axis {
    if(!pins || pins.length<2) return null;
    if(pins[0].y === pins[1].y) return 'x';
    if(pins[0].x === pins[1].x) return 'y';
    return null;
  }
  // Pick the wire at 'pt' that runs along the given axis (ignores branches at junctions)
  function wireAlongAxisAt(pt, axis){
    const ws = wiresEndingAt(pt);
    for(const w of ws){
      const adj = adjacentOther(w, pt);
      if(!adj) continue;
      if(axis==='x' && adj.y === pt.y) return w;   // horizontal wire
      if(axis==='y' && adj.x === pt.x) return w;   // vertical wire
    }
    return null;
  }  

  // ------- Lightweight DOM updaters (avoid full redraw during drag) -------
  function updateComponentDOM(c){
    const g = gComps.querySelector(`g.comp[data-id="${c.id}"]`); if(!g) return;
    // selection outline & hit rect
    const outline = g.querySelector('[data-outline]');
    if(outline){ outline.setAttribute('cx', c.x); outline.setAttribute('cy', c.y); }
    const hit = g.querySelector('rect');
    if (hit) { 
      setAttr(hit, 'x', c.x - 60); 
      setAttr(hit, 'y', c.y - 60); 
    }

    // pins
    const pins = compPinPositions(c);
    const pinEls = g.querySelectorAll('circle[data-pin]');
    for(let i=0;i<Math.min(pinEls.length, pins.length);i++){
      // pin circles (inside the for-loop):
      setAttr(pinEls[i], 'cx', pins[i].x);
      setAttr(pinEls[i], 'cy', pins[i].y);
    }
    // Rebuild the inner symbol group so absolute geometry (lines/paths) follows new x/y.
    rebuildSymbolGroup(c, g);
  }

  // Replace the first-level symbol <g> inside a component with a fresh one.
  function rebuildSymbolGroup(c, g){
    const old = g.querySelector(':scope > g'); // the inner symbol group we appended in drawComponent
    const fresh = buildSymbolGroup(c);
    if(old) g.replaceChild(fresh, old); else g.appendChild(fresh);
  }

  function wirePointsString(w){ return w.points.map(p=>`${p.x},${p.y}`).join(' '); }

  function updateWireDOM(w){
    if(!w) return;
    const group = gWires.querySelector(`g[data-id="${w.id}"]`);
    if(!group) return;
    const pts = wirePointsString(w);
    group.querySelectorAll('polyline').forEach(pl=> pl.setAttribute('points', pts));
    const vis = group.querySelector('polyline[data-wire-stroke]');
    if (vis) {
      ensureStroke(w);
      const eff = effectiveStroke(w, netClassForWire(w), THEME);
      vis.setAttribute('stroke', rgba01ToCss(eff.color));
      vis.setAttribute('stroke-width', String(mmToPx(eff.width)));
      const dashes = dashArrayFor(eff.type);
      if (dashes) vis.setAttribute('stroke-dasharray', dashes); else vis.removeAttribute('stroke-dasharray');
    }
  }

// ================================================================================
// ====== 8. INTERACTION HANDLERS ======
// ================================================================================

  svg.addEventListener('pointerdown', (e)=>{
    const p = svgPoint(e);
    // If user clicks on empty canvas while in Move mode, cancel the move and
    // return to Select mode with no selection. This matches the expectation
    // that clicking off deselects and exits Move.
    try{
      const tgt = e.target as Element;
      const onComp = !!(tgt && tgt.closest && tgt.closest('g.comp'));
      const onWire = !!(tgt && tgt.closest && tgt.closest('#wires g'));
      if(mode === 'move' && e.button === 0 && !onComp && !onWire){
        selection = { kind: null, id: null, segIndex: null };
        setMode('select');
        renderInspector(); redraw();
        return;
      }
    }catch(_){ }
    
    // Check if clicking on an endpoint square - if so, use exact position without snapping
    const tgt = e.target as Element;
    let endpointClicked: Point | null = null;
    if(tgt && tgt.tagName === 'rect' && (tgt as any).endpoint){
      endpointClicked = (tgt as any).endpoint as Point;
    }
    
    const snapCandDown = endpointClicked 
      ? endpointClicked 
      : (mode==='wire') ? snapPointPreferAnchor({ x: p.x, y: p.y }) : { x: snap(p.x), y: snap(p.y) };
    const x = snapCandDown.x, y = snapCandDown.y;
    // Middle mouse drag pans
    if (e.button === 1){
      e.preventDefault(); beginPan(e);
      return;
    }
    // Right-click ends wire placement (when wiring)
    if (e.button === 2 && mode==='wire' && drawing.active){
      e.preventDefault();
      suppressNextContextMenu = true; // ensure the imminent contextmenu is blocked
      finishWire();
      return;
    }       
    if(mode==='place' && placeType){
      const id = uid(placeType);
      const labelPrefix = {resistor:'R', capacitor:'C', inductor:'L', diode:'D', npn:'Q', pnp:'Q', ground:'GND', battery:'BT', ac:'AC'}[placeType] || 'X';
      // If a 2-pin part is dropped near a segment, project to it and align rotation
      let at = {x, y}, rot=0;
      if(isTwoPinType(placeType)){
        const hit = nearestSegmentAtPoint(p, 18);
        if(hit){ at = hit.q; rot = normDeg(hit.angle); }
      }
      const comp: Component = {
        id, type: placeType, x: at.x, y: at.y, rot, label: `${labelPrefix}${counters[placeType]-1}`, value: '', 
        props: {}
      };
      if (placeType === 'diode') {
        (comp.props as Component['props']).subtype = diodeSubtype as DiodeSubtype;
      }
      components.push(comp);
      // Break wires at pins and remove inner bridge segment for 2-pin parts
      breakWiresForComponent(comp);
      deleteBridgeBetweenPins(comp);      
      setMode('select');
      placeType = null;
      selection = { kind: 'component', id, segIndex: null };
      redraw();
      return;
    }
    if(mode==='wire'){
      // start drawing if not active, else add point
      if(!drawing.active){ 
        drawing.active=true; drawing.points=[{x,y}]; drawing.cursor={x,y};
      } else {
        // Check if we clicked on an endpoint square (during drawing)
        const tgt = e.target as Element;
        
        // Check if the target or any parent has endpoint data
        let endpointData: Point | null = null;
        
        // First check if target is a rect with endpoint data
        if(tgt && tgt.tagName === 'rect' && (tgt as any).endpoint){
          endpointData = (tgt as any).endpoint as Point;
        }
        
        // Also check if target is within gDrawing or gOverlay and has endpoint rects nearby
        if(!endpointData && tgt){
          // Check all rect elements in overlay and drawing layers for endpoint data
          const allRects = [
            ...$qa<SVGRectElement>('rect[data-endpoint]', gOverlay),
            ...$qa<SVGRectElement>('rect', gDrawing)
          ];
          
          for(const rect of allRects){
            if((rect as any).endpoint){
              const ep = (rect as any).endpoint as Point;
              // Check if click is within this rect's bounds
              const rectBounds = rect.getBBox();
              const pt = svgPoint(e);
              if(pt.x >= rectBounds.x && pt.x <= rectBounds.x + rectBounds.width &&
                 pt.y >= rectBounds.y && pt.y <= rectBounds.y + rectBounds.height){
                endpointData = ep;
                break;
              }
            }
          }
        }
        
        let nx, ny;
        if(endpointData){
          // Use the exact anchor position stored on the endpoint square - no ortho constraint
          nx = endpointData.x;
          ny = endpointData.y;
        } else {
          // Use the cursor position which already respects ortho mode and connection hints
          // This ensures clicks place points where the visual preview shows them
          nx = drawing.cursor ? drawing.cursor.x : x;
          ny = drawing.cursor ? drawing.cursor.y : y;
        }
        
        drawing.points.push({x: nx, y: ny});
        // Clear connection hint after placing a point
        connectionHint = null;
        drawing.cursor = { x: nx, y: ny };
      }
      renderDrawing();
    }
    if(mode==='select' && e.button===0){
      // Start marquee only if pointerdown is on empty canvas; defer clearing until mouseup if it's just a click
      const tgt = e.target as Element;
      const onComp = tgt && tgt.closest('g.comp');
      const onWire = tgt && tgt.closest('#wires g');
      if(!onComp && !onWire){
        beginMarqueeAt(svgPoint(e), /*startedOnEmpty=*/true, /*preferComponents=*/e.shiftKey);
      }
    }    
    if(mode==='pan' && e.button===0){
      beginPan(e);
      return;
    }    
  });

  svg.addEventListener('dblclick', (e)=>{
    if(mode==='wire' && drawing.active){ finishWire(); }
  });
  // Rubber-band wire, placement ghost, crosshair, and hover pan cursor
  svg.addEventListener('pointermove', (e)=>{
    // Early exit for panning - skip expensive snap calculations
    if (isPanning){ doPan(e); return; }
    
    const p = svgPoint(e);
    // Prefer anchors while wiring so cursor and added points align to endpoints/pins
    const snapCandMove = (mode === 'wire') ? snapPointPreferAnchor({ x: p.x, y: p.y }) : { x: snap(p.x), y: snap(p.y) };
    let x = snapCandMove.x, y = snapCandMove.y;
    // Marquee update (Select mode). Track Shift to flip priority while dragging.
      if(marquee.active){
      marquee.shiftPreferComponents = !!((e as PointerEvent).shiftKey || globalShiftDown);
      updateMarqueeTo(svgPoint(e));
    }  
    
    // Check if hovering over an endpoint square that would create a non-orthogonal line
    if(mode === 'wire' && drawing.active && drawing.points.length > 0){
      const tgt = e.target as Element;
      if(tgt && tgt.tagName === 'rect' && (tgt as any).endpoint){
        const ep = (tgt as any).endpoint as Point;
        const prev = drawing.points[drawing.points.length - 1];
        const dx = Math.abs(ep.x - prev.x);
        const dy = Math.abs(ep.y - prev.y);
        const isNonOrtho = (orthoMode || globalShiftDown) && dx > 0.01 && dy > 0.01;
        if(isNonOrtho && !endpointOverrideActive){
          endpointOverrideActive = true;
          if(updateOrthoButtonVisual) updateOrthoButtonVisual();
        } else if(!isNonOrtho && endpointOverrideActive){
          endpointOverrideActive = false;
          if(updateOrthoButtonVisual) updateOrthoButtonVisual();
        }
      } else if(endpointOverrideActive){
        // Not hovering over endpoint anymore, clear the override
        endpointOverrideActive = false;
        if(updateOrthoButtonVisual) updateOrthoButtonVisual();
      }
    }
    
    if(mode==='wire' && drawing.active){
      // enforce orthogonal preview while Shift is down (or globally tracked) or when ortho mode is on
      const isShift = (e as PointerEvent).shiftKey || globalShiftDown;
      
      // Update visual indicator for shift-based temporary ortho (only if ortho mode is not already active)
      if(!orthoMode && isShift && !shiftOrthoVisualActive){
        shiftOrthoVisualActive = true;
        if(updateOrthoButtonVisual) updateOrthoButtonVisual();
      } else if(!orthoMode && !isShift && shiftOrthoVisualActive){
        shiftOrthoVisualActive = false;
        if(updateOrthoButtonVisual) updateOrthoButtonVisual();
      }
      
      const forceOrtho = isShift || orthoMode;
      
      if(drawing.points && drawing.points.length>0){
        const last = drawing.points[drawing.points.length-1];
        const dx = Math.abs(x - last.x), dy = Math.abs(y - last.y);
        
        // Apply standard ortho constraint FIRST (if no hint is active yet)
        if(!connectionHint && forceOrtho){
          if(dx >= dy) y = last.y; else x = last.x;
        }
        
        // Connection hint logic: try to lock onto nearby wire endpoint X or Y axis (only if tracking is enabled)
        // Use RAW mouse position (p) for candidate search to avoid grid snap interference
        // Convert pixel tolerances to SVG user coordinates based on current zoom
        const scale = svg.clientWidth / Math.max(1, viewW); // screen px per user unit
        const snapTol = HINT_SNAP_TOLERANCE_PX / scale; // convert to SVG user units
        const unlockThresh = HINT_UNLOCK_THRESHOLD_PX / scale; // convert to SVG user units
        

        
        // Collect all wire endpoints as candidates (only if tracking mode is enabled)
        const candidates: Point[] = [];
        
        if(trackingMode){
          // Get the first point of the wire being drawn (to exclude it from candidates)
          const drawingStartPt = drawing.points.length > 0 ? drawing.points[0] : null;
        
          // Helper function to check if a point matches the drawing start point
          const isDrawingStart = (pt: Point) => {
            return drawingStartPt && pt.x === drawingStartPt.x && pt.y === drawingStartPt.y;
          };
          
          let wireEndpointCount = 0;
          wires.forEach(w => {
            if(w.points && w.points.length >= 2){
              // Add first endpoint if it's not the drawing start point
              const firstPt = w.points[0];
              if(!isDrawingStart(firstPt)){
                candidates.push(firstPt);
                wireEndpointCount++;
              }
              // Add last endpoint if it's not the drawing start point
              const lastPt = w.points[w.points.length-1];
              if(!isDrawingStart(lastPt)){
                candidates.push(lastPt);
                wireEndpointCount++;
              }
            }
          });
          // Also include component pins if they're not the drawing start point
          let componentPinCount = 0;
          components.forEach(c => {
            const pins = compPinPositions(c);
            pins.forEach(p => {
              if(!isDrawingStart(p)){
                candidates.push({x:p.x, y:p.y});
                componentPinCount++;
              }
            });
          });

          // Include intermediate points of the wire being drawn
          // Skip only the last point (current segment start - we're drawing FROM it)
          // Include all other placed points (including the second-to-last point)
          let wirePointCandidates = 0;
          for(let i = 0; i < drawing.points.length - 1; i++){
            candidates.push({x: drawing.points[i].x, y: drawing.points[i].y});
            wirePointCandidates++;
          }

          
          // Check if we should unlock (moved too far from the hint target)
          if(connectionHint){
            // Check distance from current mouse to the original target point
            const distFromTarget = Math.sqrt(
              Math.pow(x - connectionHint.targetPt.x, 2) + 
              Math.pow(y - connectionHint.targetPt.y, 2)
            );
            if(distFromTarget > unlockThresh){
              connectionHint = null; // unlock
            }
          }
          
          if(!connectionHint && candidates.length > 0){
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
              if(crossProduct < 0.5) return true;
              
              // Also exclude if the hint direction matches the current dragging direction
              // If dragging vertically (dx < dy) and hint is vertical, exclude
              // If dragging horizontally (dx >= dy) and hint is horizontal, exclude
              const isDraggingVertically = dy > dx;
              const hintIsVertical = !isHorizontalHint;
              
              if(isDraggingVertically && hintIsVertical){
                return true; // Exclude vertical hints when dragging vertically
              }
              if(!isDraggingVertically && !hintIsVertical){
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
              
              if(xDist < snapTol && xDist < bestAxisDist && !shouldExcludeCandidate(cand, false)){
                bestAxisDist = xDist;
                bestCand = cand;
                bestIsHorizontalHint = false; // vertical hint line
              }
              
              // Check Y-axis proximity (for horizontal hint line - locks Y, varies X)
              const yDist = Math.abs(rawY - cand.y);
              
              if(yDist < snapTol && yDist < bestAxisDist && !shouldExcludeCandidate(cand, true)){
                bestAxisDist = yDist;
                bestCand = cand;
                bestIsHorizontalHint = true; // horizontal hint line
              }
              
              checkCount++;
            });
            
            if(bestCand){
              // Snap the cursor position to align orthogonally with the candidate
              // Use current snapped position as base, but override the locked axis
              let snappedX = x;
              let snappedY = y;
              
              if(bestIsHorizontalHint){
                // Horizontal hint: snap Y to candidate's Y (cursor moves to align horizontally)
                snappedY = bestCand.y;
                // X uses the snapped grid position
              } else {
                // Vertical hint: snap X to candidate's X (cursor moves to align vertically)
                snappedX = bestCand.x;
                // Y uses the snapped grid position
              }
              
              connectionHint = { 
                lockedPt: {x: snappedX, y: snappedY},  // Lock snapped position
                targetPt: bestCand,   // The candidate point to show hint line to
                wasOrthoActive: orthoMode || isShift,
                lockAxis: bestIsHorizontalHint ? 'y' : 'x'  // Which axis was snapped
              };

            }
          }
        } // end if(trackingMode)
        
        // Apply connection hint lock (but still respect ortho constraint)
        if(connectionHint){
          // Keep cursor at the snapped position
          x = connectionHint.lockedPt.x;
          y = connectionHint.lockedPt.y;
          
          // Re-apply ortho constraint to ensure we stay orthogonal
          if(forceOrtho){
            if(dx >= dy){
              // Moving horizontally: Y must stay locked to last.y
              y = last.y;
            } else {
              // Moving vertically: X must stay locked to last.x
              x = last.x;
            }
          }
          
          // Temporarily enable ortho if not already active
          if(!connectionHint.wasOrthoActive && !shiftOrthoVisualActive){
            shiftOrthoVisualActive = true;
            if(updateOrthoButtonVisual) updateOrthoButtonVisual();
          }
        }
        // Note: Standard ortho was already applied earlier (before hint detection)
      }
      drawing.cursor = {x, y};
      renderDrawing();
      renderConnectionHint();
    } else {
      drawing.cursor = null;
      connectionHint = null; // clear hint when not drawing
      renderConnectionHint(); // clear visual hint
      // Clear shift visual if active
      if(shiftOrthoVisualActive){
        shiftOrthoVisualActive = false;
        if(updateOrthoButtonVisual) updateOrthoButtonVisual();
      }
    }
    if(mode==='place' && placeType){
      renderGhostAt({x, y}, placeType);
    } else {
      clearGhost();
    }
    
    // Update coordinate display when placing wire or components
    if(mode === 'wire' || mode === 'place'){
      updateCoordinateDisplay(x, y);
    } else {
      hideCoordinateDisplay();
    }
    
    // crosshair overlay while in wire mode (even if not actively drawing)
    // Use raw mouse position (p) for crosshair, not snapped position (x, y)
    if(mode==='wire'){ renderCrosshair(p.x, p.y); } else { clearCrosshair(); }    
  });

  svg.addEventListener('pointerup', (e)=>{
    // Finish marquee selection if active; otherwise just end any pan
    if(marquee.active){ finishMarquee(); }
    endPan();
  });
  svg.addEventListener('pointerleave', (e)=>{ endPan(); });
  // Ensure middle-click doesn't trigger browser autoscroll and supports pan in all browsers
  svg.addEventListener('mousedown', (e)=>{ if(e.button===1){ e.preventDefault(); beginPan(e); } });
  svg.addEventListener('auxclick', (e)=>{ if(e.button===1){ e.preventDefault(); } });
  // Suppress native context menu while finishing wire with right-click
  // Suppress native context menu right after a right-click wire finish
  svg.addEventListener('contextmenu', (e)=>{
    if (mode==='wire' && (drawing.active || suppressNextContextMenu)) {
      e.preventDefault();
      suppressNextContextMenu = false; // one-shot
    }
  });
  // Zoom on wheel, centered on mouse location (keeps mouse position stable in view)
  svg.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const scale = (e.deltaY < 0) ? 1.1 : (1/1.1);
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
  }, {passive:false});  

  window.addEventListener('keydown', (e)=>{
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
    if(e.key==='Escape'){
      // If a drawing is in progress, cancel it first
      if(drawing.active){
        drawing.active=false; drawing.points=[]; gDrawing.replaceChildren();
        connectionHint = null;
        renderConnectionHint(); // clear hint visual
        if(shiftOrthoVisualActive){
          shiftOrthoVisualActive = false;
          if(updateOrthoButtonVisual) updateOrthoButtonVisual();
        }
        return;
      }
      // If any non-none mode is active (wire/delete/pan/move/select), pressing
      // Escape should deactivate the active button and enter 'none'. This
      // mirrors typical toolbar behavior and ensures Escape clears modes other
      // than just Select.
      if(mode !== 'none'){
        setMode('none');
        return;
      }
      // If already in 'none', fallback to clearing selection if present.
      if(selection.kind === 'component' || selection.kind === 'wire'){
        selection = { kind: null, id: null, segIndex: null };
        renderInspector(); redraw();
      }
    }
    if(e.key==='Enter' && drawing.active){ finishWire(); }
    if(e.key.toLowerCase()==='w'){ setMode('wire'); }
    if(e.key.toLowerCase()==='v'){ setMode('select'); }
    if(e.key.toLowerCase()==='p'){ setMode('pan'); }
    if(e.key.toLowerCase()==='m'){ setMode('move'); }
    if(e.key.toLowerCase()==='r'){
      rotateSelected();
    }
    if(e.key==='Delete'){
      if(selection.kind==='component'){ removeComponent(selection.id); }
      if(selection.kind==='wire'){
        // Per-segment model: each segment is its own Wire object. Delete the selected segment wire.
        const w = wires.find(x=>x.id===selection.id);
        if(w){
          pushUndo();
          wires = wires.filter(x => x.id !== w.id);
          selection = { kind: null, id: null, segIndex: null };
          normalizeAllWires();
          unifyInlineWires();
          redraw();
        }
      }
    }
    // Arrow-key move in Move mode
    if(mode==='move' && selection.kind==='component'){
      const step = GRID;
      let dx=0, dy=0;
      if(e.key==='ArrowLeft')  dx=-step;
      if(e.key==='ArrowRight') dx= step;
      if(e.key==='ArrowUp')    dy=-step;
      if(e.key==='ArrowDown')  dy= step;
      if(dx!==0 || dy!==0){ e.preventDefault(); moveSelectedBy(dx,dy); }
    }    
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); saveJSON(); }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); clearAll(); }
    // Quick debug dump: press 'D' (when not focused on an input) to log anchors/overlays
    if(e.key.toLowerCase()==='d' && !isEditingKeystrokesTarget(e)){
      e.preventDefault(); debugDumpAnchors();
    }
  });

  // Decide color for a just-drawn wire if it will merge into an existing straight wire path (Wire/SWP).
  function pickSwpAdoptColorForNewWire(pts){
    if(!pts || pts.length < 2) return null;

    // Build SWPs from the current canvas BEFORE adding the new wire
    rebuildTopology();

    const axisOf = (a,b)=> (a && b && a.y===b.y) ? 'x' : (a && b && a.x===b.x) ? 'y' : null;
    const newAxis = axisOf(pts[0], pts[1]) || axisOf(pts[pts.length-2], pts[pts.length-1]) || null;

    function colorAtEndpoint(p){
      // Look for an existing wire endpoint we are snapping to
      const hit = findWireEndpointNear(p, 0.9);
      if(!hit) return null;

      // Which segment touches that endpoint? (start -> seg 0, end -> seg n-2)
      const segIdx = (hit.endIndex === 0) ? 0 : (hit.w.points.length - 2);

      // If that segment belongs to a Wire (SWP), use its color; else fallback to that wire's color
      const swp = swpForWireSegment(hit.w.id, segIdx);
      if(swp) return { color: swp.color, axis: axisAtEndpoint(hit.w, hit.endIndex) };

      return { color: hit.w.color || defaultWireColor, axis: axisAtEndpoint(hit.w, hit.endIndex) };
    }

    const startInfo = colorAtEndpoint(pts[0]);
    const endInfo   = colorAtEndpoint(pts[pts.length-1]);

    // Prefer endpoint whose axis matches the new wire's axis (i.e., will merge inline)
    if(newAxis){
      if(startInfo && startInfo.axis === newAxis) return startInfo.color;
      if(endInfo && endInfo.axis === newAxis)     return endInfo.color;
    }

    // Otherwise: prefer start, else end
    if(startInfo) return startInfo.color;
    if(endInfo)   return endInfo.color;

    return null;
  }

  // --- Helpers to color only the colinear segment(s) that join an existing Wire (SWP) ---

  // Split a polyline into contiguous runs of same "axis":
  // 'x' = horizontal, 'y' = vertical, null = angled (non-axis-aligned)
  function splitPolylineIntoRuns(pts){
    const runs = [];
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      const axis = (a && b && a.y===b.y) ? 'x' : (a && b && a.x===b.x) ? 'y' : null;
      if(!runs.length || runs[runs.length-1].axis !== axis){
        runs.push({ start:i, end:i, axis });
      }else{
        runs[runs.length-1].end = i;
      }
    }
    return runs;
  }

  // If the given endpoint 'pt' is snapping onto an existing Wire (SWP) endpoint
  // and the segment axis matches that SWP, return that SWP's color; else null.
  function adoptColorAtEndpointForAxis(pt: Point, axis: Axis): string | null {
    if(!axis) return null;                 // only axis-aligned runs can be part of an SWP
    rebuildTopology();                     // inspect current canvas BEFORE adding new pieces
    const hit = findWireEndpointNear(pt, 0.9);
    if(!hit) return null;

    // Require colinearity at the touched endpoint
    const hitAxis = axisAtEndpoint(hit.w, hit.endIndex);
    if(hitAxis !== axis) return null;

    // Get the SWP at that existing segment
    const segIdx = (hit.endIndex === 0) ? 0 : (hit.w.points.length - 2);
    const swp = swpForWireSegment(hit.w.id, segIdx);
    if(!swp) return null;                 // only adopt if it truly becomes part of that SWP

    return swp.color || defaultWireColor;
  }

  function strokeOfWire(w: Wire): Stroke {
    ensureStroke(w);
    return { width: w.stroke!.width, type: w.stroke!.type, color: w.stroke!.color };
  }

  // If an endpoint joins colinear to an existing SWP, inherit that wire's *stroke*.
  function adoptStrokeAtEndpointForAxis(pt: Point, axis: Axis): Stroke | null {
    if(!axis) return null;
    rebuildTopology();
    const hit = findWireEndpointNear(pt, 0.9);
    if(!hit) return null;
    const hitAxis = axisAtEndpoint(hit.w, hit.endIndex);
    if(hitAxis !== axis) return null;
    const segIdx = (hit.endIndex === 0) ? 0 : (hit.w.points.length - 2);
    const swp = swpForWireSegment(hit.w.id, segIdx);
    if(!swp) return null;
    return strokeOfWire(hit.w);
  }

  // Emit the new polyline as multiple wires:
  // - each axis-aligned run becomes one wire
  // - only the run that attaches *colinear* to an existing SWP adopts that SWP's color
  // - bends (non-axis) are emitted as their own wires with the current toolbar color
  function emitRunsFromPolyline(pts){
    const runs = splitPolylineIntoRuns(pts);
    const curCol = resolveWireColor(currentWireColorMode);

    for(const run of runs){
      const subPts = pts.slice(run.start, run.end + 2); // include end+1 vertex
      // default/fallback stroke: use toolbar's explicit stroke when not using netclass; otherwise palette color only
      const tool = strokeForNewWires();
      let stroke: Stroke = tool
        ? { width: tool.width, type: tool.type, color: tool.color }
        : { width: 0, type: 'default', color: cssToRGBA01(curCol) };

      // Try to adopt stroke from colinear attachment at the start or end (only one end should match)
      if(run.start === 0){
        const ad = adoptStrokeAtEndpointForAxis(subPts[0], run.axis);
        if(ad) stroke = ad;
      }
      if(run.end === pts.length - 2 && (!stroke || (stroke.type==='default' && stroke.width<=0))){
        const ad2 = adoptStrokeAtEndpointForAxis(subPts[subPts.length-1], run.axis);
        if(ad2) stroke = ad2;
      }

      // Keep legacy color alongside stroke for back-compat & SWP heuristics
      const css = rgba01ToCss(stroke.color);
      // Emit as per-segment wires: one 2-point Wire per adjacent pair
      for(let i=0;i<subPts.length-1;i++){
        const segmentPts = [ subPts[i], subPts[i+1] ];
        // clone stroke so each segment can be edited independently
        const segStroke = stroke ? { ...stroke, color: { ...stroke.color } } : undefined;
        // Always assign to activeNetClass (net assignment independent of custom properties)
        const netId = activeNetClass;
        wires.push({ id: uid('wire'), points: segmentPts, color: rgba01ToCss(segStroke ? segStroke.color : cssToRGBA01(curCol)), stroke: segStroke, netId });
      }
    }
  }

  function finishWire(){
    // Commit only if we have at least one segment
    if(drawing.points.length >= 2){
      // De-dup consecutive identical points to avoid zero-length segments
      const pts = [];
      for(const p of drawing.points){
        if(!pts.length || pts[pts.length-1].x!==p.x || pts[pts.length-1].y!==p.y) pts.push({x:p.x,y:p.y});
      }
      if(pts.length >= 2){
        pushUndo();
        // Emit per-run so only truly colinear joins adopt an existing Wire's color.
        // Bends (non-axis runs) stay with the current toolbar color.
        emitRunsFromPolyline(pts);

        // Post-process: if user placed components while wire was in limbo,
        // split this newly added wire wherever pins land, and remove any inner bridge.
        // (Safe for all components; non-intersecting pins are ignored by the splitter.)
        const comps = components.slice();
        for(const c of comps){
          const didBreak = breakWiresForComponent(c);
          if(didBreak) deleteBridgeBetweenPins(c);
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
    if(shiftOrthoVisualActive){
      shiftOrthoVisualActive = false;
      if(updateOrthoButtonVisual) updateOrthoButtonVisual();
    }
    gDrawing.replaceChildren();
    clearCrosshair();
    redraw();
  }

  function renderDrawing(){
    gDrawing.replaceChildren();
    if(!drawing.active) return;
    let pts = drawing.cursor ? [...drawing.points, drawing.cursor] : drawing.points;
    
    // Apply ortho constraint to cursor position in rendered polyline if ortho mode is active
    // This prevents any non-orthogonal lines from flickering during rendering
    if(drawing.cursor && drawing.points.length > 0 && (orthoMode || globalShiftDown)){
      const last = drawing.points[drawing.points.length - 1];
      const cursor = drawing.cursor;
      const dx = Math.abs(cursor.x - last.x);
      const dy = Math.abs(cursor.y - last.y);
      let constrainedCursor = { ...cursor };
      if(dx >= dy){
        constrainedCursor.y = last.y; // horizontal
      } else {
        constrainedCursor.x = last.x; // vertical
      }
      pts = [...drawing.points, constrainedCursor];
    }
    
    const pl = document.createElementNS('http://www.w3.org/2000/svg','polyline');    
    const drawColor = resolveWireColor(currentWireColorMode);
    pl.setAttribute('fill','none'); pl.setAttribute('stroke', drawColor); pl.setAttribute('stroke-width','1'); pl.setAttribute('stroke-linecap','round'); pl.setAttribute('stroke-linejoin','round');
    pl.setAttribute('marker-start','url(#dot)');
    pl.setAttribute('points', pts.map(p=>`${p.x},${p.y}`).join(' '));
    gDrawing.appendChild(pl);
    
    // Draw junction dots at each placed point (not the cursor)
    const scale = userScale(); // screen px per user unit
    const dotRadius = 3 / scale; // 3 screen pixels
    for(let i = 0; i < drawing.points.length; i++){
      const pt = drawing.points[i];
      const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
      circle.setAttribute('cx', String(pt.x));
      circle.setAttribute('cy', String(pt.y));
      circle.setAttribute('r', String(dotRadius));
      circle.setAttribute('fill', 'white');
      circle.setAttribute('stroke', 'black');
      circle.setAttribute('stroke-width', String(1 / scale)); // 1 screen pixel
      gDrawing.appendChild(circle);
      
      // Also draw green endpoint squares at each placed point
      const desiredScreenPx = 9;
      const widthUser = desiredScreenPx / scale;
      // Center the square directly on the actual wire point in SVG coordinates
      const rx = pt.x - widthUser / 2;
      const ry = pt.y - widthUser / 2;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(rx));
      rect.setAttribute('y', String(ry));
      rect.setAttribute('width', String(widthUser));
      rect.setAttribute('height', String(widthUser));
      rect.setAttribute('fill', 'rgba(0,200,0,0.08)');
      rect.setAttribute('stroke', 'lime');
      rect.setAttribute('stroke-width', String(1 / scale));
      rect.style.cursor = 'pointer';
      // Store actual coordinates (not snapped) so connections align precisely
      (rect as any).endpoint = { x: pt.x, y: pt.y };
      gDrawing.appendChild(rect);
    }
    
    // keep endpoint marker in sync with in-progress color
    const dot = document.querySelector('#dot circle');
    if (dot) dot.setAttribute('fill', drawColor);
    
  }
  
  // Render connection hint in overlay layer (above crosshair for visibility)
  function renderConnectionHint(){
    // Remove any existing hint
    $qa<SVGElement>('[data-hint]', gOverlay).forEach(el => el.remove());
    
    if(connectionHint && drawing.active && drawing.points.length > 0){
      const hintLine = document.createElementNS('http://www.w3.org/2000/svg','line');
      hintLine.setAttribute('data-hint','1');
      hintLine.setAttribute('stroke','#00ff00'); // bright green
      
      // Calculate stroke width that scales with zoom to stay visible
      const scale = svg.clientWidth / Math.max(1, viewW);
      const strokeWidth = 2 / scale; // 2 screen pixels for better visibility
      const dashLength = 10 / scale; // 10 screen pixels for dashes
      const dashGap = 5 / scale; // 5 screen pixels for gaps
      
      hintLine.setAttribute('stroke-width', String(strokeWidth));
      hintLine.setAttribute('stroke-dasharray', `${dashLength},${dashGap}`);
      hintLine.setAttribute('stroke-linecap','round');
      hintLine.setAttribute('pointer-events','none');
      hintLine.setAttribute('opacity','1');
      
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
  function clearCrosshair(){
    // Only remove the crosshair lines, not the marquee rect
    $qa<SVGElement>('[data-crosshair]', gOverlay).forEach(el => el.remove());
  }
  function renderCrosshair(x,y){
    clearCrosshair(); // remove previous crosshair lines, keep marquee intact
    
    const hline = document.createElementNS('http://www.w3.org/2000/svg','line');
    const vline = document.createElementNS('http://www.w3.org/2000/svg','line');
    hline.setAttribute('data-crosshair','1');
    vline.setAttribute('data-crosshair','1');
    
    if(crosshairMode === 'short'){
      // Short crosshair: 40 pixels in each direction, light gray solid line
      const halfLenPixels = 40;
      const scale = svg.clientWidth / Math.max(1, viewW);
      const halfLen = halfLenPixels / scale; // Convert to SVG user coordinates
      const strokeWidth = 1 / scale; // 1 screen pixel
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
      const strokeWidth = 1 / scale; // 1 screen pixel (same as short)
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
  function updateCoordinateDisplay(x: number, y: number){
    if(!coordDisplay) return;
    // Convert user units (pixels) to nanometers, then to current units
    const xNm = pxToNm(x);
    const yNm = pxToNm(y);
    const xVal = nmToUnit(xNm, globalUnits);
    const yVal = nmToUnit(yNm, globalUnits);
    
    // Format with appropriate precision based on units
    let precision = 2;
    if(globalUnits === 'mils') precision = 0;
    if(globalUnits === 'mm') precision = 2;
    if(globalUnits === 'in') precision = 4;
    
    const xStr = xVal.toFixed(precision);
    const yStr = yVal.toFixed(precision);
    coordDisplay.textContent = `${xStr}, ${yStr} ${globalUnits}`;
    coordDisplay.style.display = '';
  }
  
  function hideCoordinateDisplay(){
    if(!coordDisplay) return;
    coordDisplay.style.display = 'none';
  }

  // ----- Placement ghost -----
  let ghostEl: SVGGElement | null = null;
  function clearGhost(){ if(ghostEl){ ghostEl.remove(); ghostEl=null; } }
  function renderGhostAt(pos, type){
    clearGhost();
    let at = {x:pos.x, y:pos.y}, rot = 0;
    if(isTwoPinType(type)){
      const hit = nearestSegmentAtPoint(pos, 18);
      if(hit){ at = hit.q; rot = normDeg(hit.angle); }
    }
    const ghost: Component = { id:'__ghost__', type, x: at.x, y: at.y, rot, label:'', value:'', props:{} };
    if (type === 'diode') {
      (ghost.props as Component['props']).subtype = diodeSubtype as DiodeSubtype;
    }
    ghostEl = drawComponent(ghost);
    ghostEl.style.opacity = '0.5';
    ghostEl.style.pointerEvents = 'none';
    gDrawing.appendChild(ghostEl);
  }  

  function rotateSelected(){
    if(selection.kind!=='component') return;
    const c = components.find(x=>x.id===selection.id); if(!c) return;
    pushUndo();
    c.rot = (c.rot + 90)%360;
    // After rotation, if pins now cross a wire, split and remove bridge
    if(breakWiresForComponent(c)){
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
  gComps.addEventListener('pointerdown', (e)=>{
    if(!(mode==='select' || mode==='move')) return;
    const compG = (e.target as Element).closest('g.comp') as SVGGElement | null;
    if(compG){
      const id = compG.getAttribute('data-id');
      selecting('component', id);
      e.stopPropagation();
    }
  });  

  const paletteRow2 = document.getElementById('paletteRow2') as HTMLElement;
  function positionSubtypeDropdown(){
    if(!paletteRow2) return;
    const headerEl = document.querySelector('header');
    const diodeBtn = document.querySelector('#paletteRow1 button[data-tool="diode"]');
    if(!headerEl || !diodeBtn) return;
    const hb = headerEl.getBoundingClientRect();
    const bb = diodeBtn.getBoundingClientRect();
    // Position just under the Diode button, with a small vertical gap
    paletteRow2.style.left = (bb.left - hb.left) + 'px';
    paletteRow2.style.top  = (bb.bottom - hb.top + 6) + 'px';
  }
  window.addEventListener('resize', ()=>{ if(paletteRow2.style.display!=='none') positionSubtypeDropdown(); });

  // Show only while placing diode; hide otherwise.
  function updateSubtypeVisibility(){
    if(!paletteRow2) return;
    const show = (mode === 'place' && placeType === 'diode');
    if (show){
      paletteRow2.style.display = 'block';
      const ds = document.getElementById('diodeSelect') as HTMLSelectElement | null;
      if (ds) ds.value = diodeSubtype;
      positionSubtypeDropdown();
    } else {
      paletteRow2.style.display = 'none';
    }
  }

  // Any button in the header (except the Diode button) hides the popup
  (function(){
    const headerEl = document.querySelector('header');
    headerEl.addEventListener('click', (e) => {
      const btn = (e.target as Element | null)?.closest('button') as HTMLButtonElement | null;
      if (!btn) return;    
      const isDiodeBtn = btn.matches('#paletteRow1 button[data-tool="diode"]');
      if(!isDiodeBtn){
        paletteRow2.style.display = 'none';
      }
    }, true);
  })();  

  document.getElementById('paletteRow1')!.addEventListener('click', (e)=>{
    const btn = (e.target as Element | null)?.closest('button') as HTMLButtonElement | null;
    if(!btn) return;
    placeType = (btn.dataset.tool as PlaceType | undefined) || placeType;
    setMode('place');
    // Reveal sub-type row only for types that have subtypes (currently: diode)
    if (placeType === 'diode') {
      paletteRow2.style.display = 'block';
      // keep dropdown reflecting last chosen subtype
      const ds = document.getElementById('diodeSelect') as HTMLSelectElement | null; if (ds) ds.value = diodeSubtype;
      positionSubtypeDropdown();
    } else {
      paletteRow2.style.display = 'none';
    }
    // Show only for diode; hide for all others
    updateSubtypeVisibility();        
  });
  // Diode subtype select → enter Place mode for diode using chosen subtype
  const diodeSel = $q<HTMLSelectElement>('#diodeSelect');
  if (diodeSel){
    diodeSel.value = diodeSubtype;
    diodeSel.addEventListener('change', ()=>{
      diodeSubtype = (diodeSel.value as DiodeSubtype) || 'generic';
      placeType = 'diode'; setMode('place');
      // ensure the subtype row is visible while placing diodes
      updateSubtypeVisibility();     
    });
    // clicking the dropdown should also arm diode placement without changing the value
    diodeSel.addEventListener('mousedown', ()=>{
      placeType='diode'; setMode('place');
      paletteRow2.style.display = 'block';
      positionSubtypeDropdown();
      updateSubtypeVisibility();
    });
  }

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
    } catch {}
    // baseline: netclass defaults, with a sane color for when user flips to custom
    return {
      useNetclass: true,
      stroke: { width: 0, type: 'default', color: cssToRGBA01(resolveWireColor('auto')) }
    };
  }
  function saveWireDefaults(){ localStorage.setItem('wire.defaults', JSON.stringify(WIRE_DEFAULTS)); }

  let WIRE_DEFAULTS: WireStrokeDefaults = loadWireDefaults();

  // keep existing color-mode plumbing backwards compatible by mirroring to it
  function mirrorDefaultsIntoLegacyColorMode(){
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
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width','160'); svg.setAttribute('height','22');
    svg.style.display = 'block';
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1','8'); line.setAttribute('x2','152');
    line.setAttribute('y1','11'); line.setAttribute('y2','11');
    line.setAttribute('stroke', rgba01ToCss(st.color));
    line.setAttribute('stroke-width', String(Math.max(1, mmToPx(st.width || 0.25))));
    // dash mapping like inspector
    const style = st.type || 'default';
    const dash = style==='dash' ? '6 4' :
                style==='dot' ? '2 4' :
                style==='dash_dot' ? '6 4 2 4' :
                style==='dash_dot_dot' ? '6 4 2 4 2 4' : '';
    if (dash) line.setAttribute('stroke-dasharray', dash);
    svg.appendChild(line);
    return svg;
  }

  // Rebuild the popover UI each time it opens
  function buildWireStrokeMenu(menuEl: HTMLElement){
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
    ['default','solid','dash','dot','dash_dot','dash_dot_dot'].forEach(v=>{
      const o = document.createElement('option'); o.value = v; o.textContent = v.replace('_','-');
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
      + [rgb.r,rgb.g,rgb.b].map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
    inpColor.value = hex;
    const inpA = document.createElement('input'); inpA.type = 'range'; inpA.min='0'; inpA.max='1'; inpA.step='0.01'; inpA.value = String(rgb.a ?? 1);
    wrapC.append(inpColor, inpA);
    rowC.append(capC, wrapC);
    box.appendChild(rowC);

    // Standard color swatches (toolbar menu)
    (function(){
      const swatches = [
        ['black','#000000'],
        ['red','#FF0000'], ['green','#00FF00'], ['blue','#0000FF'],
        ['cyan','#00FFFF'], ['magenta','#FF00FF'], ['yellow','#FFFF00']
      ];
      const pal = document.createElement('div'); pal.className = 'palette';
      pal.style.gridTemplateColumns = `repeat(${swatches.length}, 20px)`;
      swatches.forEach(([k,col])=>{
        const b = document.createElement('button'); b.className = 'swatch-btn';
        b.title = (k as string).toUpperCase();
        // Special handling for black: create split diagonal swatch
        if(col === '#000000'){
          b.style.background = 'linear-gradient(to bottom right, #000000 0%, #000000 49%, #ffffff 51%, #ffffff 100%)';
          b.style.border = '1px solid #666666';
          b.title = 'BLACK/WHITE';
        } else {
          b.style.background = String(col);
        }
        b.addEventListener('click', (ev)=>{
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

    function refreshPreview(){
      prevHolder.replaceChildren(buildStrokePreview(currentPreviewStroke()));
    }

    function syncAllFieldsToEffective(){
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
        .map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
      inpColor.value = hex;
      inpA.value = String(Math.max(0, Math.min(1, st.color.a ?? 1)));
    }

    function setEnabledStates(){
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
      const parsed = parseDimInput((inpW.value||'').trim(), globalUnits);
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

  function syncWireToolbar(){
    // show effective color in swatch & border
    const col = WIRE_DEFAULTS.useNetclass
      ? rgba01ToCss(NET_CLASSES.default.wire.color)     // reflect actual netclass color
      : rgba01ToCss(WIRE_DEFAULTS.stroke.color);
    setSwatch(wireColorSwatch, col);
    const hex = colorToHex(col);
    const label = WIRE_DEFAULTS.useNetclass
      ? 'Netclass defaults'
      : `${(WIRE_DEFAULTS.stroke.type||'default')} @ ${formatDimForDisplay((WIRE_DEFAULTS.stroke as any).widthNm != null ? (WIRE_DEFAULTS.stroke as any).widthNm : unitToNm(WIRE_DEFAULTS.stroke.width || 0, 'mm'), globalUnits)}`;
    wireColorBtn.title = `Wire Stroke: ${label} — ${hex}`;
    wireColorBtn.style.borderColor = col;
    const dot = document.querySelector('#dot circle'); if(dot) (dot as SVGElement).setAttribute('fill', col);
  }

  function openWireMenu(){
    buildWireStrokeMenu(wireColorMenu);
    // Use block flow for form content (not the old swatch grid)
    wireColorMenu.style.display = 'block';
  }
  function closeWireMenu(){ wireColorMenu.style.display = 'none'; }

  // init
  if (wireColorBtn){
    mirrorDefaultsIntoLegacyColorMode();
    syncWireToolbar();
    wireColorBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const isOpen = wireColorMenu.style.display !== 'none';
      if(isOpen) closeWireMenu(); else openWireMenu();
    });
    document.addEventListener('pointerdown', (e)=>{
      const t = e.target as Node;
      if (t && !wireColorMenu.contains(t) && t !== wireColorBtn) closeWireMenu();
    });
    window.addEventListener('resize', closeWireMenu);
  }

  // Zoom controls
  document.getElementById('zoomInBtn').addEventListener('click', ()=>{ zoom = Math.min(10, zoom*1.25); applyZoom(); });
  document.getElementById('zoomOutBtn').addEventListener('click', ()=>{ zoom = Math.max(0.25, zoom/1.25); applyZoom(); });
  document.getElementById('zoomResetBtn').addEventListener('click', ()=>{ zoom = 1; applyZoom(); viewX=0; viewY=0; applyZoom(); });
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
  
  function beginPan(e){
    isPanning = true;
    document.body.classList.add('panning');
    // Store screen coordinates (clientX/Y) instead of SVG coordinates to avoid feedback loop
    panStartClient = {x: e.clientX, y: e.clientY};
    panStartView = {x:viewX, y:viewY};
    panPointerId = e.pointerId;
    svg.setPointerCapture?.(panPointerId);
  }
  
  function doPan(e){
    if(!isPanning) return;
    
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
  function endPan(){
    if(!isPanning) return;
    isPanning = false;
    document.body.classList.remove('panning');
    if(panPointerId!=null) svg.releasePointerCapture?.(panPointerId);
    panPointerId = null;
    // Final update after panning completes
    if (panAnimationFrame !== null) {
      cancelAnimationFrame(panAnimationFrame);
      panAnimationFrame = null;
    }
    // Full redraw including grid after panning completes
    applyZoom();
  }  

  function clearAll(){
    if(!confirm('Clear the canvas? This cannot be undone.')) return;
    components = [];
    wires = [];
    selection = {kind:null, id:null, segIndex:null};
    // Cancel any in-progress wire drawing and clear overlay
    drawing.active = false;
    drawing.points = [];
    gDrawing.replaceChildren();
    // Reset ID counters
    counters = { resistor:1, capacitor:1, inductor:1, diode:1, npn:1, pnp:1, ground:1, battery:1, ac:1, wire:1 };
    // Reset nets to default only
    nets = new Set(['default']);
    renderNetList();
    redraw();
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
  function dimNumberPx(pxVal: number, onCommit: (px:number)=>void){
    const inp = document.createElement('input'); inp.type = 'text';
    // display initial value converted to current units
    const nm = pxToNm(pxVal);
    inp.value = formatDimForDisplay(nm, globalUnits);
    // commit on blur or Enter
    function commitFromStr(str: string){
      const parsed = parseDimInput(str);
      if(!parsed) return; // ignore invalid
      const px = Math.round(nmToPx(parsed.nm));
      onCommit(px);
      // refresh displayed (normalize units & formatting)
      inp.value = formatDimForDisplay(parsed.nm, globalUnits);
    }
    inp.addEventListener('blur', ()=> commitFromStr(inp.value));
    inp.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ commitFromStr(inp.value); inp.blur(); } });
    return inp;
  }

  // Update UI after unit changes
  function setGlobalUnits(u: 'mm'|'in'|'mils'){
    globalUnits = u; saveGlobalUnits();
    // Refresh inspector UI and any open popovers
    renderInspector(); // safe to call repeatedly
  }

  // Hook up the units select in the status bar
  (function installUnitsSelect(){
    const unitsSelect = document.getElementById('unitsSelect') as HTMLSelectElement;
    if(!unitsSelect) return;
    
    // Set initial value
    unitsSelect.value = globalUnits;
    
    // Handle changes
    unitsSelect.addEventListener('change', ()=>{
      const u = unitsSelect.value as 'mm'|'in'|'mils';
      setGlobalUnits(u);
    });
  })();

  function renderInspector(){
    inspector.replaceChildren();
    if(selection.kind==='component'){
      const c = components.find(x=>x.id===selection.id);
      inspectorNone.style.display = c? 'none' : 'block';
      if(!c) return;
      const wrap = document.createElement('div');

      wrap.appendChild(rowPair('ID', text(c.id, true)));
      wrap.appendChild(rowPair('Type', text(c.type, true)));

      wrap.appendChild(rowPair('Label', input(c.label, v=>{ pushUndo(); c.label=v; redrawCanvasOnly(); } )));

      // value field for generic components
      const showValue = ['resistor','capacitor','inductor','diode'].includes(c.type);
      // Value + Unit (inline) for R, C, L. (Diode keeps a simple Value field if desired.)
      if(c.type==='resistor' || c.type==='capacitor' || c.type==='inductor'){
        if(!c.props) c.props = {};
        const typeKey = c.type;
        const container = document.createElement('div');
        container.className = 'hstack';      
        // numeric / text value
        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.value = c.value || '';
        valInput.oninput = ()=>{ pushUndo(); c.value = valInput.value; redrawCanvasOnly(); };
        // unit select (uses symbols, e.g., kΩ, µF, mH)
        const sel = unitSelect(typeKey, (c.props.unit) || defaultUnit(typeKey), (u)=>{
          pushUndo(); c.props.unit = u; redrawCanvasOnly();
        });
        container.appendChild(valInput);
        container.appendChild(sel);
        wrap.appendChild(rowPair('Value', container));
      } else if (c.type==='diode'){
        // Value (optional text) for diode
        wrap.appendChild(rowPair('Value', input(c.value||'', v=>{ pushUndo(); c.value=v; redrawCanvasOnly(); } )));
        // Subtype (editable)
        const subSel = document.createElement('select');
        ['generic','schottky','zener','led','photo','tunnel','varactor','laser'].forEach(v=>{
          const o=document.createElement('option'); o.value=v;
          o.textContent = ({
            generic:'Generic', schottky:'Schottky', zener:'Zener',
            led:'Light-emitting (LED)', photo:'Photo', tunnel:'Tunnel',
            varactor:'Varactor / Varicap', laser:'Laser'
          })[v]; subSel.appendChild(o);
        });
        subSel.value = (c.props && c.props.subtype) ? c.props.subtype : 'generic';
        subSel.onchange = () => {
          pushUndo();
          if (!c.props) c.props = {};
          (c.props as Component['props']).subtype = subSel.value as DiodeSubtype;
          diodeSubtype = subSel.value as DiodeSubtype;
          redrawCanvasOnly();
        };
        wrap.appendChild(rowPair('Subtype', subSel));      
      }

      // voltage for DC battery & AC source
      if(c.type==='battery' || c.type==='ac'){
        if(!c.props) c.props = {};
        wrap.appendChild(rowPair('Voltage (V)', number(c.props.voltage ?? 0, v=>{ pushUndo(); c.props.voltage=v; redrawCanvasOnly(); } )));
      }
      // position + rotation (X/Y are shown in selected units; internal positions are px)
      wrap.appendChild(rowPair('X', dimNumberPx(c.x, v=>{ pushUndo(); c.x = snap(v); redrawCanvasOnly(); } )));
      wrap.appendChild(rowPair('Y', dimNumberPx(c.y, v=>{ pushUndo(); c.y = snap(v); redrawCanvasOnly(); } )));
      wrap.appendChild(rowPair('Rotation', number(c.rot, v=>{ pushUndo(); c.rot = (Math.round(v/90)*90)%360; redrawCanvasOnly(); } )));

      inspector.appendChild(wrap);
      // After the DOM is in place, size any Value/Units selects to their content (capped at 50%)
      fitInspectorUnitSelects();
      return;
    }
    // WIRE INSPECTOR
    if(selection.kind==='wire'){
      const w = wires.find(x=>x.id===selection.id);
      inspectorNone.style.display = w? 'none' : 'block';
      if(!w) return;
      const wrap = document.createElement('div');

      // Legacy selection.segIndex is deprecated. Treat the selected `wire` as the
      // segment itself (per-segment `Wire` objects). Find the SWP by wire id.
      const swp = swpForWireSegment(w.id, 0);

      // ---- Wire ID (read-only) ----
      // Prefer the SWP id (e.g. "swp3"). Fallback to the underlying polyline id if no SWP detected.
      wrap.appendChild(rowPair('Segment ID', text(w.id, true)));
      if (swp) wrap.appendChild(rowPair('SWP', text(swp.id, true)));

      // ---- Wire Endpoints (read-only) ----
      // If a specific segment is selected, show that segment's endpoints.
      // Otherwise, prefer the SWP canonical endpoints; fallback to the polyline endpoints.
      if (w && w.points && w.points.length >= 2) {
        const A = w.points[0], B = w.points[w.points.length - 1];
        wrap.appendChild(rowPair('Wire Start', text(`${formatDimForDisplay(pxToNm(A.x), globalUnits)}, ${formatDimForDisplay(pxToNm(A.y), globalUnits)}`  , true)));
        wrap.appendChild(rowPair('Wire End',   text(`${formatDimForDisplay(pxToNm(B.x), globalUnits)}, ${formatDimForDisplay(pxToNm(B.y), globalUnits)}`, true)));
      } else if (swp) {
        wrap.appendChild(rowPair('Wire Start', text(`${formatDimForDisplay(pxToNm(swp.start.x), globalUnits)}, ${formatDimForDisplay(pxToNm(swp.start.y), globalUnits)}`, true)));
        wrap.appendChild(rowPair('Wire End',   text(`${formatDimForDisplay(pxToNm(swp.end.x), globalUnits)}, ${formatDimForDisplay(pxToNm(swp.end.y), globalUnits)}`, true)));
      } else {
        const A = w.points[0], B = w.points[w.points.length-1];
        wrap.appendChild(rowPair('Wire Start', text(`${formatDimForDisplay(pxToNm(A.x), globalUnits)}, ${formatDimForDisplay(pxToNm(A.y), globalUnits)}`, true)));
        wrap.appendChild(rowPair('Wire End',   text(`${formatDimForDisplay(pxToNm(B.x), globalUnits)}, ${formatDimForDisplay(pxToNm(B.y), globalUnits)}`, true)));
      }

      // ---- Net Assignment (includes Net Class selection) ----
      const netRow = document.createElement('div'); netRow.className='row';
      const netLbl = document.createElement('label'); netLbl.textContent='Net Class'; netLbl.style.width='90px';
      const netSel = document.createElement('select');
      
      // Populate with all available nets
      Array.from(nets).sort().forEach(netName => {
        const o = document.createElement('option');
        o.value = netName;
        o.textContent = netName;
        netSel.appendChild(o);
      });
      
      netRow.appendChild(netLbl);
      netRow.appendChild(netSel);
      wrap.appendChild(netRow);

      // Set net dropdown initial value
      netSel.value = w.netId || activeNetClass;

      // Use custom properties checkbox
      const customRow = document.createElement('div'); customRow.className='row';
      const customLbl = document.createElement('label'); customLbl.style.display='flex'; customLbl.style.alignItems='center'; customLbl.style.gap='6px';
      const chkCustom = document.createElement('input');
      chkCustom.type = 'checkbox';
      const hasCustomProps = () => { 
        ensureStroke(w); 
        return w.stroke!.width > 0 || (w.stroke!.type !== 'default' && w.stroke!.type !== undefined);
      };
      chkCustom.checked = hasCustomProps();
      const lblCustomText = document.createElement('span');
      lblCustomText.textContent = 'Use custom properties';
      customLbl.append(chkCustom, lblCustomText);
      customRow.appendChild(customLbl);
      wrap.appendChild(customRow);
      
      // ---- Wire Stroke (KiCad-style) ----
      (function(){
        ensureStroke(w);
        const holder = document.createElement('div');
        
        // Net selection handler - updates wire's net class assignment
        netSel.onchange = () => {
          pushUndo();
          ensureStroke(w);
          activeNetClass = netSel.value;
          renderNetList();
          w.netId = netSel.value;
          
          if (!chkCustom.checked) {
            // If not using custom properties, update to use net class visuals
            const netClass = NET_CLASSES[netSel.value];
            const patch: Partial<Stroke> = { width: 0, type: 'default' };
            w.stroke = { ...(w.stroke as Stroke), ...patch };
            delete (w.stroke as any).widthNm;
            w.color = rgba01ToCss(netClass.wire.color);
            updateWireDOM(w);
            redrawCanvasOnly();
          }
          
          selection = { kind: 'wire', id: w.id, segIndex: null };
          syncWidth(); syncStyle(); syncColor(); syncPreview();
        };

        // Custom properties checkbox handler
        chkCustom.onchange = () => {
          pushUndo();
          ensureStroke(w);
          if (chkCustom.checked) {
            // Switching to custom: populate with current effective values (width/type from effectiveStroke,
            // but preserve the actual net class color, not the display-adjusted color)
            const nc = NET_CLASSES[w.netId || activeNetClass] || NET_CLASSES.default;
            const eff = effectiveStroke(w, nc, THEME);
            // Determine the raw color to use (from wire's current stroke, or from netclass if using defaults)
            const rawColor = (w.stroke && w.stroke.width > 0) ? w.stroke.color : nc.wire.color;
            const patch: Partial<Stroke> = {
              width: eff.width,
              type: (eff.type === 'default' ? 'solid' : eff.type) || 'solid',
              color: rawColor
            };
            w.stroke = { ...(w.stroke as Stroke), ...patch };
            (w.stroke as any).widthNm = Math.round(patch.width! * NM_PER_MM);
            w.color = rgba01ToCss(rawColor);
          } else {
            // Switching to net class: use defaults
            const netClass = NET_CLASSES[w.netId || activeNetClass];
            const patch: Partial<Stroke> = { width: 0, type: 'default' };
            w.stroke = { ...(w.stroke as Stroke), ...patch };
            delete (w.stroke as any).widthNm;
            w.color = rgba01ToCss(netClass.wire.color);
          }
          updateWireDOM(w);
          redrawCanvasOnly();
          selection = { kind: 'wire', id: w.id, segIndex: null };
          syncWidth(); syncStyle(); syncColor(); syncPreview();
        };

        // Width (in selected units)
        const widthRow = document.createElement('div'); widthRow.className='row';
        const wLbl = document.createElement('label'); wLbl.textContent = `Width (${globalUnits})`; wLbl.style.width='90px';
        const wIn = document.createElement('input'); wIn.type='text'; wIn.step = '0.05';
        const syncWidth = ()=>{
          const eff = effectiveStroke(w, netClassForWire(w), THEME);
          const effNm = Math.round((eff.width || 0) * NM_PER_MM);
          wIn.value = formatDimForDisplay(effNm, globalUnits);
          wIn.disabled = !chkCustom.checked;
        };
        // Live, non-destructive width updates while typing so the inspector DOM
        // isn't rebuilt on every keystroke. The final onchange will perform any
        // SWP-wide restroke and normalization.
        let hasUndoForThisEdit = false;
        wIn.onfocus = () => {
          // Push undo once when editing starts
          if (!hasUndoForThisEdit) {
            pushUndo();
            hasUndoForThisEdit = true;
          }
        };
        wIn.oninput = () => {
          try {
            const parsed = parseDimInput(wIn.value || '0', globalUnits);
            if (!parsed) return;
            const nm = parsed.nm;
            const valMm = nm / NM_PER_MM;
            // store both mm and nm for precision; update DOM for immediate feedback
            ensureStroke(w);
            (w.stroke as any).widthNm = nm;
            w.stroke!.width = valMm;
            w.color = rgba01ToCss(w.stroke!.color);
            updateWireDOM(w);
            syncPreview();
          } catch (err) {
            // ignore transient parse errors while typing
          }
        };

        wIn.onchange = () => {
          // pushUndo() called on focus, not here, to avoid duplicate entries
          ensureStroke(w);
          const parsed = parseDimInput(wIn.value || '0', globalUnits);
          const nm = parsed ? parsed.nm : 0;
          const valMm = nm / NM_PER_MM; // mm for legacy fields
          const mid = (w.points && w.points.length >= 2) ? midOfSeg(w.points, 0) : null;
          // Selected wire is the segment itself: apply directly to `w`.
          if (w.points && w.points.length === 2) {
            (w.stroke as any).widthNm = nm;
            w.stroke!.width = valMm;
            if (valMm <= 0) w.stroke!.type = 'default';
            w.color = rgba01ToCss(w.stroke!.color);
            updateWireDOM(w); redrawCanvasOnly();
            selection = { kind: 'wire', id: w.id, segIndex: null };
          } else if (swp) {
            restrokeSwpSegments(swp, { width: valMm, type: valMm>0 ? (w.stroke!.type==='default'?'solid':w.stroke!.type) : 'default' });
            if (mid) reselectNearestAt(mid); else redraw();
          } else {
            (w.stroke as any).widthNm = nm;
            w.stroke!.width = valMm;
            if (valMm<=0) w.stroke!.type = 'default'; // mirror KiCad precedence
            updateWireDOM(w); redrawCanvasOnly();
          }
          // Normalize displayed value to chosen units
          wIn.value = formatDimForDisplay(nm, globalUnits);
        };
        widthRow.appendChild(wLbl); widthRow.appendChild(wIn); holder.appendChild(widthRow);

        // Line style
        const styleRow = document.createElement('div'); styleRow.className='row';
        const sLbl = document.createElement('label'); sLbl.textContent='Line style'; sLbl.style.width='90px';
        const sSel = document.createElement('select');
        ['default','solid','dash','dot','dash_dot','dash_dot_dot'].forEach(v=>{
          const o=document.createElement('option'); o.value=v; o.textContent=v.replace(/_/g,'·'); sSel.appendChild(o);
        });
        const syncStyle = ()=>{ 
          const eff = effectiveStroke(w, netClassForWire(w), THEME); 
          sSel.value = (!chkCustom.checked ? 'default' : w.stroke!.type); 
          sSel.disabled = !chkCustom.checked; 
        };
        sSel.onchange = () => {
          pushUndo();
          ensureStroke(w);
          const val = (sSel.value || 'solid') as StrokeType;
          const mid = (w.points && w.points.length >= 2) ? midOfSeg(w.points, 0) : null;
          if (w.points && w.points.length === 2) {
            ensureStroke(w);
            w.stroke!.type = val;
            updateWireDOM(w); redrawCanvasOnly();
            selection = { kind: 'wire', id: w.id, segIndex: null };
          } else if (swp) {
            // Only change the style; do not force width to 0 when 'default' is chosen.
            restrokeSwpSegments(swp, { type: val });            
            if (mid) reselectNearestAt(mid); else redraw();
          } else {
            w.stroke!.type = val;
            // Selecting 'default' now only defers the style to netclass.
            // Width and color remain as-is.
            updateWireDOM(w); redrawCanvasOnly();
          }
          syncPreview();
        };
        styleRow.appendChild(sLbl); styleRow.appendChild(sSel); holder.appendChild(styleRow);
                // Color (RGB) + Opacity
        const colorRow = document.createElement('div');
        colorRow.className = 'row hstack';

        const cLbl = document.createElement('label');
        cLbl.textContent = 'Color';
        cLbl.style.width = '90px';

        const cIn = document.createElement('input');
        cIn.type = 'color';
        // Tooltip for the color button
        cIn.title = 'Pick color';
        
        // Set initial value before defining syncColor
        ensureStroke(w);
        const initialColor = w.stroke!.color;
        const initialHex = '#' + [initialColor.r, initialColor.g, initialColor.b]
          .map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
        cIn.value = initialHex;

        const aIn = document.createElement('input');
        aIn.type = 'range';
        aIn.min = '0';
        aIn.max = '1';
        aIn.step = '0.05';
        // keep compact so it fits in the inspector width
        aIn.style.flex = '0 0 120px';
        aIn.style.maxWidth = '140px';
        aIn.value = String(Math.max(0, Math.min(1, initialColor.a)));

        const syncColor = () => {
          // Use raw stored color, not effective stroke (which may convert black/white for visibility)
          ensureStroke(w);
          const rawColor = w.stroke!.color;
          // Disable first, then update values, then re-enable to force browser to refresh
          const wasDisabled = cIn.disabled;
          cIn.disabled = true;
          aIn.disabled = true;
          
          // If not using custom properties, show netclass color instead
          if (!chkCustom.checked) {
            const nc = NET_CLASSES[w.netId || activeNetClass];
            const rgbCss = `rgba(${Math.round(nc.wire.color.r*255)},${Math.round(nc.wire.color.g*255)},${Math.round(nc.wire.color.b*255)},${nc.wire.color.a})`;
            const hex = colorToHex(rgbCss);
            cIn.value = hex;
            aIn.value = String(Math.max(0, Math.min(1, nc.wire.color.a)));
          } else {
            const rgbCss = `rgba(${Math.round(rawColor.r*255)},${Math.round(rawColor.g*255)},${Math.round(rawColor.b*255)},${rawColor.a})`;
            const hex = colorToHex(rgbCss);
            cIn.value = hex;
            aIn.value = String(Math.max(0, Math.min(1, rawColor.a)));
          }
          
          // Re-enable after updating value to force refresh
          cIn.disabled = !chkCustom.checked;
          aIn.disabled = !chkCustom.checked;
        };

        function onColorCommit() {
          pushUndo();
          // parse #RRGGBB + alpha slider → RGBA01
          const hex = cIn.value || '#ffffff';
          const m = hex.replace('#','');
          const r = parseInt(m.slice(0,2),16), g = parseInt(m.slice(2,4),16), b = parseInt(m.slice(4,6),16);
          const a = Math.max(0, Math.min(1, parseFloat(aIn.value) || 1));
          const newColor: RGBA01 = { r:r/255, g:g/255, b:b/255, a };

          const patch: Partial<Stroke> = { color: newColor };

          const mid = (w.points && w.points.length >= 2) ? midOfSeg(w.points, 0) : null;

          if (w.points && w.points.length === 2) {
            ensureStroke(w);
            w.stroke = { ...w.stroke!, color: newColor };
            w.color = rgba01ToCss(w.stroke.color);
            updateWireDOM(w);
            redrawCanvasOnly();
            selection = { kind: 'wire', id: w.id, segIndex: null };
          } else if (swp) {
            // update only the segments that belong to this SWP
            restrokeSwpSegments(swp, patch);
            if (mid) reselectNearestAt(mid); else redraw();
          } else {
            ensureStroke(w);
            w.stroke = { ...w.stroke!, color: newColor };
            // keep legacy css color in sync for any flows that still read w.color
            w.color = rgba01ToCss(w.stroke.color);
            updateWireDOM(w);
            redrawCanvasOnly();
          }
          // refresh all inspector controls + live preview
          syncWidth(); syncStyle(); syncColor(); syncPreview();
        }

        // Live (non-destructive) updates while the user drags the color/alpha controls.
        // These update only the selected wire's stroke and DOM so the native color picker
        // isn't closed by a full inspector re-render mid-drag. The heavier commit that
        // applies edits across an SWP (restrokeSwpSegments) runs on change/commit.
        const liveApplyColor = () => {
          try {
            const hex = cIn.value || '#ffffff';
            const m = hex.replace('#','');
            const r = parseInt(m.slice(0,2),16), g = parseInt(m.slice(2,4),16), b = parseInt(m.slice(4,6),16);
            const a = Math.max(0, Math.min(1, parseFloat(aIn.value) || 1));
            const newColor: RGBA01 = { r: r/255, g: g/255, b: b/255, a };
            // Apply locally to this wire only (no SWP-wide restroke) so we don't replace the inspector DOM.
            ensureStroke(w);
            w.stroke = { ...w.stroke!, color: newColor };
            w.color = rgba01ToCss(w.stroke.color);
            updateWireDOM(w);
            syncPreview(); // update the tiny preview line
          } catch (err) {
            // Ignore transient parse errors while typing
          }
        };

        let hasColorUndo = false;
        const ensureColorUndo = () => {
          if (!hasColorUndo) {
            pushUndo();
            hasColorUndo = true;
          }
        };
        cIn.onfocus = ensureColorUndo;
        aIn.onfocus = ensureColorUndo;
        cIn.oninput = () => {
          ensureColorUndo();
          liveApplyColor();
        };
        aIn.oninput = () => {
          ensureColorUndo();
          liveApplyColor();
        };
        // Finalize (apply across SWP if present) when the picker is closed or change is committed
        cIn.onchange = () => {
          ensureColorUndo(); // Ensure undo is pushed even if oninput never fired
          const hex = cIn.value || '#ffffff';
          const m = hex.replace('#','');
          const r = parseInt(m.slice(0,2),16), g = parseInt(m.slice(2,4),16), b = parseInt(m.slice(4,6),16);
          const a = Math.max(0, Math.min(1, parseFloat(aIn.value) || 1));
          const newColor: RGBA01 = { r:r/255, g:g/255, b:b/255, a };

          const patch: Partial<Stroke> = { color: newColor };
          const mid = (w.points && w.points.length >= 2) ? midOfSeg(w.points, 0) : null;

          if (w.points && w.points.length === 2) {
            ensureStroke(w);
            w.stroke = { ...w.stroke!, color: newColor };
            w.color = rgba01ToCss(w.stroke.color);
            updateWireDOM(w);
            redrawCanvasOnly();
            selection = { kind: 'wire', id: w.id, segIndex: null };
          } else if (swp) {
            restrokeSwpSegments(swp, patch);
            if (mid) reselectNearestAt(mid); else redraw();
          } else {
            ensureStroke(w);
            w.stroke = { ...w.stroke!, color: newColor };
            w.color = rgba01ToCss(w.stroke.color);
            updateWireDOM(w);
            redrawCanvasOnly();
          }
          syncWidth(); syncStyle(); syncColor(); syncPreview();
        };
        aIn.onchange = () => {
          ensureColorUndo(); // Ensure undo is pushed even if oninput never fired
          const hex = cIn.value || '#ffffff';
          const m = hex.replace('#','');
          const r = parseInt(m.slice(0,2),16), g = parseInt(m.slice(2,4),16), b = parseInt(m.slice(4,6),16);
          const a = Math.max(0, Math.min(1, parseFloat(aIn.value) || 1));
          const newColor: RGBA01 = { r:r/255, g:g/255, b:b/255, a };

          const patch: Partial<Stroke> = { color: newColor };
          const mid = (w.points && w.points.length >= 2) ? midOfSeg(w.points, 0) : null;

          if (w.points && w.points.length === 2) {
            ensureStroke(w);
            w.stroke = { ...w.stroke!, color: newColor };
            w.color = rgba01ToCss(w.stroke.color);
            updateWireDOM(w);
            redrawCanvasOnly();
            selection = { kind: 'wire', id: w.id, segIndex: null };
          } else if (swp) {
            restrokeSwpSegments(swp, patch);
            if (mid) reselectNearestAt(mid); else redraw();
          } else {
            ensureStroke(w);
            w.stroke = { ...w.stroke!, color: newColor };
            w.color = rgba01ToCss(w.stroke.color);
            updateWireDOM(w);
            redrawCanvasOnly();
          }
          syncWidth(); syncStyle(); syncColor(); syncPreview();
        };

        colorRow.appendChild(cLbl);
        colorRow.appendChild(cIn);
        colorRow.appendChild(aIn);
        // small toggle to open the swatch popover (separate from the native color picker)
        const swatchToggle = document.createElement('button');
        swatchToggle.type = 'button';
        swatchToggle.className = 'swatch-toggle';
        swatchToggle.title = 'Show swatches';
        swatchToggle.setAttribute('aria-haspopup','true');
        swatchToggle.setAttribute('aria-expanded','false');
        swatchToggle.tabIndex = 0;
        swatchToggle.setAttribute('role','button');
        swatchToggle.style.marginLeft = '6px';
        swatchToggle.style.width = '22px';
        swatchToggle.style.height = '22px';
        swatchToggle.style.borderRadius = '4px';
        swatchToggle.style.display = 'inline-flex';
        swatchToggle.style.alignItems = 'center';
        swatchToggle.style.justifyContent = 'center';
        swatchToggle.style.padding = '0';
        swatchToggle.style.fontSize = '12px';
        // small caret SVG for consistency
        swatchToggle.innerHTML = '<svg width="12" height="8" viewBox="0 0 12 8" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M1 1l5 5 5-5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        colorRow.appendChild(swatchToggle);
        holder.appendChild(colorRow);

        // Small swatch palette for the inspector color picker — hidden by default.
        (function(){
          const swatches = [
            ['black','#000000'],
            ['red','#FF0000'], ['green','#00FF00'], ['blue','#0000FF'],
            ['cyan','#00FFFF'], ['magenta','#FF00FF'], ['yellow','#FFFF00']
          ];
          const palWrap = document.createElement('div');
            // Build a floating swatch popover that appears under the color input (not inline in the inspector)
            const popover = document.createElement('div');
            popover.className = 'inspector-color-popover';
            popover.style.position = 'absolute';
            popover.style.display = 'none';
            popover.style.zIndex = '9999';
            popover.style.background = 'var(--panel)';
            popover.style.padding = '8px';
            popover.style.borderRadius = '6px';
            popover.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
            popover.style.pointerEvents = 'auto';
            popover.style.userSelect = 'none';
            const pal = document.createElement('div');
            pal.style.display = 'grid';
            pal.style.gridTemplateColumns = `repeat(${swatches.length}, 18px)`;
            pal.style.gap = '8px';
            pal.style.alignItems = 'center';
            swatches.forEach(([k,col])=>{
              const b = document.createElement('button'); b.className = 'swatch-btn';
              b.title = (k as string).toUpperCase();
              // Special handling for black: create split diagonal swatch
              if(col === '#000000'){
                b.style.background = 'linear-gradient(to bottom right, #000000 0%, #000000 49%, #ffffff 51%, #ffffff 100%)';
                b.style.border = '1px solid #666666';
                b.title = 'BLACK/WHITE';
              } else {
                b.style.background = String(col);
              }
              b.style.width = '18px'; b.style.height = '18px'; b.style.borderRadius = '4px';
              b.style.border = '1px solid rgba(0,0,0,0.12)';
              b.style.padding = '0';
              // Prevent blur race when user clicks a swatch
              b.addEventListener('pointerdown', (ev)=>{ ev.preventDefault(); });
              b.addEventListener('click', ()=>{
                ensureColorUndo();
                cIn.value = String(col as string);
                aIn.value = '1';
                // Call the change handler directly
                if (cIn.onchange) cIn.onchange.call(cIn, new Event('change'));
                hidePopover();
              });
              pal.appendChild(b);
            });
            popover.appendChild(pal);
            document.body.appendChild(popover);

            function showPopover(){
              const r = cIn.getBoundingClientRect();
              const left = Math.max(6, window.scrollX + r.left);
              let top = window.scrollY + r.bottom + 6;
              const popH = popover.offsetHeight || 120;
              const viewportBottom = window.scrollY + window.innerHeight;
              if(top + popH > viewportBottom - 8){
                // place above the input if below space is constrained
                top = window.scrollY + r.top - popH - 6;
              }
              popover.style.left = `${left}px`;
              popover.style.top = `${top}px`;
              // animate in
              popover.style.display = 'block';
              popover.style.transition = 'opacity 140ms ease, transform 140ms ease';
              popover.style.opacity = '0';
              popover.style.transform = 'translateY(-6px)';
              // force layout then animate
              popover.getBoundingClientRect();
              requestAnimationFrame(()=>{ popover.style.opacity = '1'; popover.style.transform = 'translateY(0)'; });
              swatchToggle.setAttribute('aria-expanded','true');
            }
            function hidePopover(){
              popover.style.opacity = '0';
              popover.style.transform = 'translateY(-6px)';
              swatchToggle.setAttribute('aria-expanded','false');
              setTimeout(()=>{ popover.style.display = 'none'; }, 160);
            }

            // Show popover when the swatch toggle is clicked. Keep the native
            // color picker behavior on the color input unchanged (clicking
            // `cIn` will open the browser color picker as before).
            swatchToggle.addEventListener('pointerdown', (e)=>{ e.stopPropagation(); e.preventDefault(); if(popover.style.display === 'block'){ hidePopover(); } else { showPopover(); } });
            // keyboard accessibility: toggle on Enter/Space
            swatchToggle.addEventListener('keydown', (e)=>{
              if(e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar'){
                e.preventDefault(); if(popover.style.display === 'block'){ hidePopover(); } else { showPopover(); }
              }
            });
            // If user clicks outside the popover and color input, hide it
            document.addEventListener('pointerdown', (ev)=>{
              const t = ev.target as Node | null;
              if(!t) return;
              if(t === cIn || popover.contains(t)) return;
              hidePopover();
            });

          // host popover is used (showHost / hideHost) — legacy popover handlers removed
        })();

        // Live preview of effective stroke
        const prevRow = document.createElement('div'); prevRow.className='row';
        const pLbl = document.createElement('label'); pLbl.textContent='Preview'; pLbl.style.width='90px';
        const pSvg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        pSvg.setAttribute('width','160'); pSvg.setAttribute('height','24');
        const pLine = document.createElementNS('http://www.w3.org/2000/svg','line');
        setAttrs(pLine, { x1:10, y1:12, x2:150, y2:12 });
        pLine.setAttribute('stroke-linecap','round');
        pSvg.appendChild(pLine);
        function syncPreview(){
          const eff = effectiveStroke(w, netClassForWire(w), THEME);
          // For the preview swatch, use the raw stored color (before black/white conversions)
          ensureStroke(w);
          const rawColor = (netSel.value !== '__none__') 
            ? NET_CLASSES[netSel.value].wire.color 
            : w.stroke!.color;
          pLine.setAttribute('stroke', rgba01ToCss(rawColor));
          pLine.setAttribute('stroke-width', String(mmToPx(eff.width)));
          const d = dashArrayFor(eff.type);
          if(d) pLine.setAttribute('stroke-dasharray', d); else pLine.removeAttribute('stroke-dasharray');
        }
        prevRow.appendChild(pLbl); prevRow.appendChild(pSvg);
        holder.appendChild(prevRow);

        // One-shot rebuild to wire up initial UI state
        function rebuild(){
        // refresh live stroke from model + precedence
        syncWidth(); syncStyle(); syncColor(); syncPreview();
        }
        rebuild();

        // Header row: left-justified section title (“Wire Stroke”)
        const wsHeader = document.createElement('div'); wsHeader.className = 'row';
        const wsLabel = document.createElement('label');
        wsLabel.textContent = 'Wire Stroke';
        wsLabel.style.width = 'auto';          // don’t reserve the 90px label column
        wsLabel.style.fontWeight = '600';
        wsHeader.appendChild(wsLabel);
        wrap.appendChild(wsHeader);

        // Then put the stroke rows directly below the header (no indent)
        wrap.appendChild(holder);
      })();

      inspector.appendChild(wrap);
      return;
    }
    // nothing selected
    inspectorNone.style.display = 'block';
  }

  function rowPair(lbl: string, control: HTMLElement): HTMLDivElement {
    const d1 = document.createElement('div'); d1.className = 'row';
    const l = document.createElement('label'); l.textContent = lbl; l.style.width = '90px'; d1.appendChild(l);
    d1.appendChild(control);
    return d1;
  }
  function input(val: string, on: (v: string) => void): HTMLInputElement {
    const i = document.createElement('input'); i.type = 'text'; i.value = val; i.oninput = () => on(i.value); return i;
  }
  function number(val: number, on: (v: number) => void): HTMLInputElement {
    const i = document.createElement('input'); i.type = 'number'; i.value = String(val); i.oninput = () => on(parseFloat(i.value) || 0); return i;
  }
  function text(val: string, readonly: boolean = false): HTMLInputElement {
    const i = document.createElement('input'); i.type = 'text'; i.value = val; i.readOnly = readonly; return i;
  }
  function unitSelect(
    kind: 'resistor' | 'capacitor' | 'inductor',
    current: string,
    onChange: (unit: string) => void
  ): HTMLSelectElement {
    const sel = document.createElement('select');
    (UNIT_OPTIONS[kind] || []).forEach(u => {
      const opt = document.createElement('option'); opt.value = u; opt.textContent = u; sel.appendChild(opt);
    });
    sel.value = current || defaultUnit(kind);
    sel.onchange = () => onChange(sel.value);
    return sel;
  }
  function fitInspectorUnitSelects(): void {
    const sels = inspector.querySelectorAll('.hstack select');
    sels.forEach((s) => sizeUnitSelectToContent(s as HTMLSelectElement));
  }
  function sizeUnitSelectToContent(sel: HTMLSelectElement): void {
    const row = sel.closest('.hstack'); if (!row) return;
    const cs = getComputedStyle(sel);
    const font = cs.font || `${cs.fontStyle} ${cs.fontVariant} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = font;
    let maxText = 0;
    Array.from(sel.options).forEach(o => {
      const w = ctx.measureText(o.textContent || '').width;
      if (w > maxText) maxText = w;
    });
    const pad = 36;
    const desired = Math.ceil(maxText + pad);
    const rowW = (row as HTMLElement).getBoundingClientRect().width || 0;
    const cap = Math.max(0, Math.floor(rowW * 0.5));
    const finalW = Math.min(desired, cap);
    sel.style.width = finalW > 0 ? `${finalW}px` : 'auto';
  }
  function defaultUnit(kind: 'resistor' | 'capacitor' | 'inductor'): string {
    if(kind==='resistor') return '\u03A9'; // Ω
    if(kind==='capacitor') return 'F';
    if(kind==='inductor') return 'H';
    return '';
  }
  // ====== Embed / overlap helpers ======
  function isEmbedded(c){
    const pins = compPinPositions(c).map(p=>({x:snapToBaseScalar(p.x),y:snapToBaseScalar(p.y)}));
    if(pins.length<2) return false;
    return wiresEndingAt(pins[0]).length===1 && wiresEndingAt(pins[1]).length===1;
  }
  function overlapsAnyOther(c){
    const R = 56; // same as selection outline radius
    for(const o of components){
      if(o.id===c.id) continue;
      const dx = o.x - c.x, dy = o.y - c.y;
      if((dx*dx + dy*dy) < (R*R)) return true;
    }
    return false;
  }
  // Test overlap if 'c' were at (x,y) without committing the move.
  function overlapsAnyOtherAt(c, x, y){
    const R = 56;
    for(const o of components){
      if(o.id===c.id) continue;
      const dx = o.x - x, dy = o.y - y;
      if((dx*dx + dy*dy) < (R*R)) return true;
    }
    return false;
  }
  
  // Prevent a component's pins from landing exactly on another component's pins.
  function pinsCoincideAnyAt(c, x, y, eps=0.75){
    // Compute THIS component's pins if its center were at (x,y)
    const ghost = { ...c, x, y };
    const myPins = compPinPositions(ghost).map(p=>({x:snap(p.x), y:snap(p.y)}));
    for(const o of components){
      if(o.id===c.id) continue;
      const oPins = compPinPositions(o).map(p=>({x:snap(p.x), y:snap(p.y)}));
      for(const mp of myPins){
        for(const op of oPins){
          if (eqPtEps(mp, op, eps)) return true;
        }
      }
    }
    return false;
  }  

  // ====== Move helpers (mouse drag already handled; this handles arrow keys & clamping) ======
  function moveSelectedBy(dx, dy){
    pushUndo();
    const c = components.find(x=>x.id===selection.id); if(!c) return;
    // If an SWP is collapsed for THIS component, move along that SWP with proper clamps.
    if (moveCollapseCtx && moveCollapseCtx.kind==='swp' && swpIdForComponent(c)===moveCollapseCtx.sid){
      const mc = moveCollapseCtx;
      if(mc.axis==='x'){
        let nx = snap(c.x + dx);
        nx = Math.max(mc.minCenter, Math.min(mc.maxCenter, nx));
        if(!overlapsAnyOtherAt(c, nx, mc.fixed) && !pinsCoincideAnyAt(c, nx, mc.fixed)){
          c.x = nx; c.y = mc.fixed; mc.lastCenter = nx;
        }
      } else {
        let ny = snap(c.y + dy);
        ny = Math.max(mc.minCenter, Math.min(mc.maxCenter, ny));
        if(!overlapsAnyOtherAt(c, mc.fixed, ny) && !pinsCoincideAnyAt(c, mc.fixed, ny)){
          c.y = ny; c.x = mc.fixed; mc.lastCenter = ny;
        }
      }
      redrawCanvasOnly();
      return;
    }    
    const ctx = buildSlideContext(c);
    if(ctx){
      // slide along constrained axis
      if(ctx.axis==='x'){
        let nx = snap(c.x + dx);
        nx = Math.max(Math.min(ctx.max, nx), ctx.min);
        if(!overlapsAnyOtherAt(c, nx, ctx.fixed) && !pinsCoincideAnyAt(c, nx, ctx.fixed)){
          c.x = nx; c.y = ctx.fixed;
        }
      }else{
        let ny = snap(c.y + dy);
        ny = Math.max(Math.min(ctx.max, ny), ctx.min);
        if(!overlapsAnyOtherAt(c, ctx.fixed, ny) && !pinsCoincideAnyAt(c, ctx.fixed, ny)){
          c.y = ny; c.x = ctx.fixed;
        }
      }
      const pins = compPinPositions(c).map(p=>({x:snapToBaseScalar(p.x),y:snapToBaseScalar(p.y)}));
      adjustWireEnd(ctx.wA, ctx.pinAStart, pins[0]);
      adjustWireEnd(ctx.wB, ctx.pinBStart, pins[1]);
      ctx.pinAStart = pins[0]; ctx.pinBStart = pins[1];
      redraw();
    }else{
      const nx = snap(c.x + dx), ny = snap(c.y + dy);
      if(!overlapsAnyOtherAt(c, nx, ny) && !pinsCoincideAnyAt(c, nx, ny)){
        c.x = nx; c.y = ny;
      }
      redrawCanvasOnly();
    }
  }

  // --- Mend helpers ---
  // --- Epsilon geometry helpers ---
  function eqPtEps(a,b,eps=0.75){ return Math.abs(a.x-b.x)<=eps && Math.abs(a.y-b.y)<=eps; }
  function dist2(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return dx*dx + dy*dy; }
  function indexOfPointEps(pts, p, eps=0.75){
    for(let i=0;i<pts.length;i++){ if(eqPtEps(pts[i], p, eps)) return i; }
    return -1;
  }

  const keyPt = (p)=> `${Math.round(p.x)},${Math.round(p.y)}`;
  const eqN = (a,b,eps=0.5)=> Math.abs(a-b)<=eps;

  // Return a copy whose LAST point is 'pin'. If 'pin' is interior, keep only the side up to the pin.
  function orderPointsEndingAt(pts, pin){
    const n = pts.length;
    if(n===0) return pts.slice();
    if(eqPtEps(pts[n-1], pin)) return pts.slice();
    if(eqPtEps(pts[0], pin)) return pts.slice().reverse();
    const k = indexOfPointEps(pts, pin);    
    return (k>=0) ? pts.slice(0, k+1) : pts.slice();
  }
  // Return a copy whose FIRST point is 'pin'. If 'pin' is interior, keep only the side from the pin.
  function orderPointsStartingAt(pts, pin){
    const n = pts.length;
    if(n===0) return pts.slice();
    if(eqPtEps(pts[0], pin)) return pts.slice();
    if(eqPtEps(pts[n-1], pin)) return pts.slice().reverse();
    const k = indexOfPointEps(pts, pin);
    return (k>=0) ? pts.slice(k) : pts.slice();
  }
  function collapseDuplicateVertices(pts){
    const out=[]; for(const p of pts){
      const last = out[out.length-1];
      if(!last || last.x!==p.x || last.y!==p.y) out.push({x:p.x, y:p.y});
    }
    return out;
  }
  // Find a wire whose **endpoint** is near the given point; returns {w, endIndex:0|n-1}
  function findWireEndpointNear(pt, tol=0.9){
    for(const w of wires){
      const n = w.points.length;
      if(n<2) continue;
      if(dist2(w.points[0], pt) <= tol*tol) return { w, endIndex:0 };
      if(dist2(w.points[n-1], pt) <= tol*tol) return { w, endIndex:n-1 };
    }
    return null;
  }  

  // Helpers to validate/normalize wire polylines
  function samePt(a,b){ return !!a && !!b && a.x===b.x && a.y===b.y; }
  function normalizedPolylineOrNull(pts){
    const c = collapseDuplicateVertices(pts||[]);
    if (c.length < 2) return null;
    if (c.length === 2 && samePt(c[0], c[1])) return null; // zero-length line
    // Remove intermediate colinear points so straight runs collapse to two-point segments
    if (c.length > 2){
      const out = [] as Point[];
      out.push(c[0]);
      for(let i=1;i<c.length-1;i++){
        const a = out[out.length-1];
        const b = c[i];
        const d = c[i+1];
        // Check colinearity via cross product: (b-a) x (d-b) == 0
        const v1x = b.x - a.x, v1y = b.y - a.y;
        const v2x = d.x - b.x, v2y = d.y - b.y;
        if((v1x * v2y - v1y * v2x) === 0){
          // b is colinear; skip it
          continue;
        } else {
          out.push(b);
        }
      }
      out.push(c[c.length-1]);
      if(out.length < 2) return null;
      return out;
    }
    return c;
  }
  function normalizeAllWires(){
    // Convert each wire polyline into one or more 2-point segment wires.
    // This gives each straight segment its own persistent `id` and stroke.
    const next: Wire[] = [];
    for (const w of wires){
      const c = normalizedPolylineOrNull(w.points);
      if (!c) continue;
      if (c.length === 2){
        // Already a single segment — preserve id to keep stability where possible
        next.push({ id: w.id, points: c, color: w.color || defaultWireColor, stroke: w.stroke, netId: (w as any).netId || 'default' } as Wire);
      } else {
        // Break into per-segment wires. Each segment gets a fresh id.
        for (let i = 0; i < c.length - 1; i++){
          const pts = [ c[i], c[i+1] ];
          next.push({ id: uid('wire'), points: pts, color: w.color || defaultWireColor, stroke: w.stroke ? { ...w.stroke } : undefined, netId: (w as any).netId || 'default' } as Wire);
        }
      }
    }
    wires = next;
  }
  
  // Split a polyline by removing segments whose 0-based indices are in removeIdxSet.
  // Returns an array of point arrays (each ≥ 2 points after normalization).
  function splitPolylineByRemovedSegments(pts, removeIdxSet){
    if(!pts || pts.length < 2) return [];
    const out = [];
    let cur = [ pts[0] ];
    for(let i=0; i<pts.length-1; i++){
      if(removeIdxSet.has(i)){
        // close current piece before the removed segment
        if(cur.length >= 2){
          const np = normalizedPolylineOrNull(cur);
          if(np) out.push(np);
        }
        // start a new piece after the removed segment
        cur = [ pts[i+1] ];
      } else {
        cur.push(pts[i+1]);
      }
    }
    if(cur.length >= 2){
      const np = normalizedPolylineOrNull(cur);
      if(np) out.push(np);
    }
    return out;
  }

  // Split a polyline keeping ONLY the segments whose indices are in keepIdxSet.
  // Returns an array of point arrays (each ≥ 2 points).
  function splitPolylineByKeptSegments(pts, keepIdxSet){
    if(!pts || pts.length < 2) return [];
    const out = [];
    let cur = [];
    for(let i=0;i<pts.length-1;i++){
      const a = pts[i], b = pts[i+1];
      if(keepIdxSet.has(i)){
        if(cur.length===0) cur.push({x:a.x,y:a.y});
        cur.push({x:b.x,y:b.y});
      } else {
        if(cur.length>=2){
          const np = normalizedPolylineOrNull(cur);
          if(np) out.push(np);
        }
        cur = [];
      }
    }
    if(cur.length>=2){
      const np = normalizedPolylineOrNull(cur);
      if(np) out.push(np);
    }
    return out;
  }

  // Isolate a single segment (by index) from a polyline `w`.
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

    const L = normalizedPolylineOrNull(leftPts);
    const M = normalizedPolylineOrNull(midPts);
    const R = normalizedPolylineOrNull(rightPts);

    // Remove the original wire and insert the pieces in its place
    wires = wires.filter(x => x.id !== w.id);
    let midWire: Wire | null = null;
    const pushPiece = (pts: Point[] | null) => {
      if (!pts) return null;
      const nw: Wire = { id: uid('wire'), points: pts, color: w.color, stroke: w.stroke ? { ...w.stroke } : undefined, netId: (w as any).netId || 'default' } as Wire;
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
  function allPinKeys(){
    const s = new Set();
    for(const c of components){
      const pins = compPinPositions(c).map(p=>({x:Math.round(p.x), y:Math.round(p.y)}));
      for(const p of pins) s.add(keyPt(p));
    }
    return s;
  }
  function axisAtEndpoint(w, endIndex){
    const n=w.points.length; if(n<2) return null;
    const a = w.points[endIndex];
    const b = (endIndex===0)? w.points[1] : w.points[n-2];
    if(a.y===b.y) return 'x';
    if(a.x===b.x) return 'y';
    return null;
  }
  function endpointPairsByKey(){
    // key -> array of { w, endIndex, axis, other }
    const map = new Map();
    for(const w of wires){
      const n=w.points.length;
      if(n<2) continue;
      const ends = [0, n-1];
      for(const endIndex of ends){
        const p = w.points[endIndex];
        const key = keyPt({x:Math.round(p.x), y:Math.round(p.y)});
        const ax = axisAtEndpoint(w, endIndex);
        const other = (endIndex===0)? w.points[1] : w.points[n-2];
        (map.get(key) || (map.set(key, []), map.get(key))).push({ w, endIndex, axis:ax, other });
      }
    }
    return map;
  }

  function unifyInlineWires(){
    const pinKeys = allPinKeys();
    let anyChange = false;

    // Iterate merges until stable, but guard against pathological loops.
    const MAX_ITER = 200;
    let iter = 0;
    const seen = new Set<string>();
    while(iter < MAX_ITER){
      iter++;
      let mergedThisPass = false;

      // detect repeated global state to avoid endless cycles
      const sig = wires.map(w => `${w.id}:${w.points.map(p=>keyPt(p)).join('|')}`).join(';');
      if(seen.has(sig)){
        console.warn('unifyInlineWires: detected repeating state, aborting merge loop', { iter, sig });
        break;
      }
      seen.add(sig);

      const pairs = endpointPairsByKey();
      // Try to merge exactly-two-endpoint nodes that are collinear and not at a component pin.
      for(const [key, list] of pairs){
        if(pinKeys.has(key)) continue;          // never merge across component pins
        if(list.length !== 2) continue;         // only consider clean 1:1 joins
        const a = list[0], b = list[1];
        if(a.w === b.w) continue;               // ignore self-joins
        if(!a.axis || !b.axis) continue;        // must both be axis-aligned
        if(a.axis !== b.axis) continue;         // must be the same axis

        const [kx, ky] = key.split(',').map(n=>parseInt(n,10));
        // Choose the "existing/first" wire as primary by their order in the
        // `wires` array (earlier index = older/existing). Primary's properties
        // will be adopted for the merged segment.
        const idxA = wires.indexOf(a.w);
        const idxB = wires.indexOf(b.w);
        // If either wire reference is no longer present in `wires` (because a prior
        // merge in this same scan mutated the array), skip this stale pair and
        // continue. We'll recompute pairs on the next outer iteration.
        if(idxA === -1 || idxB === -1){
          console.debug('unifyInlineWires: stale pair skipped (wire ref missing)', { key, idxA, idxB, aId: a.w?.id, bId: b.w?.id });
          continue;
        }
        const primary = (idxA <= idxB) ? a : b;
        const secondary = (primary === a) ? b : a;

        // Orient primary (left) so it ENDS at the join, secondary (right) so it STARTS at the join
        // Ensure endpoints are canonicalized to base-grid before merging to
        // avoid tiny rounding differences that can re-split after normalization.
        const lp = primary.w.points.map(p => ({ x: snapToBaseScalar(p.x), y: snapToBaseScalar(p.y) }));
        const rp = secondary.w.points.map(p => ({ x: snapToBaseScalar(p.x), y: snapToBaseScalar(p.y) }));
        const lPts = (primary.endIndex === lp.length-1) ? lp : lp.reverse();
        const rPts = (secondary.endIndex === 0) ? rp : rp.reverse();

        const mergedPts = lPts.concat(rPts.slice(1));  // drop duplicate join point
        const merged = normalizedPolylineOrNull(mergedPts);
        if(!merged) continue;

        // Adopt primary wire's stroke/color (preserve its id when possible)
        ensureStroke(primary.w);
        const newStroke = strokeOfWire(primary.w);
        const newColor = rgba01ToCss(newStroke.color);
        const primaryId = primary.w.id;
        console.debug('unifyInlineWires: attempting merge', { key, primaryId, primaryIdx: idxA, secondaryIdx: idxB, lPts, rPts, merged });

        // Replace both wires with a single merged segment that uses the primary id
        const countBefore = wires.length;
        wires = wires.filter(w => w !== primary.w && w !== secondary.w);
        wires.push({ id: primaryId, points: merged, color: newColor, stroke: newStroke, netId: primary.w.netId || 'default' });

        mergedThisPass = true;
        anyChange = true;
        // normalize and check that progress was made (wire count decreased)
        normalizeAllWires();
        if(wires.length >= countBefore){
          // Emit a richer diagnostic to help reproduce and debug why the merge
          // failed to reduce the wire count (likely due to normalization/splitting).
          console.warn('unifyInlineWires: merge did not reduce wire count; aborting to avoid loop', {
            key, primaryId, primaryIdx: idxA, secondaryIdx: idxB, countBefore, countAfter: wires.length,
            primaryPts: primary.w.points.slice(), secondaryPts: secondary.w.points.slice(), mergedPts: merged, sigBefore: sig
          });
          // Also dump current wires summary to console for deeper inspection
          try{ console.debug('wires snapshot', wires.map(w => ({ id: w.id, start: w.points?.[0], end: w.points?.[w.points.length-1], pts: w.points }))); }catch(_){ }
          break;
        }
        // restart scanning from fresh topology by breaking out of the inner loop so
        // the outer while() recomputes endpoint pairs against the new `wires` list.
        rebuildTopology();
        break;
      }

      if(mergedThisPass){
        // already continued after handling merge
        continue;
      }

      // nothing merged on this pass -> stable
      break;
    }

    if(iter >= MAX_ITER){
      console.warn('unifyInlineWires: reached iteration limit', MAX_ITER);
    }
    return anyChange;
  }

  // Apply a stroke "patch" to all segments in the SWP.
  // Segments outside the SWP keep their original stroke/color.
  function restrokeSwpSegments(swp: SWP | null, patch: Partial<Stroke>){
    if(!swp) return;
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
    switch(type){
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
    const sNC   = nc.wire;
    const sTH   = th.wire;
    const result = from(from(sTH, sNC), sWire);
    
    // Special handling: if wire color is black (r≈0, g≈0, b≈0), render as white in dark mode
    const isBlack = result.color.r < 0.01 && result.color.g < 0.01 && result.color.b < 0.01;
    if(isBlack){
      const bg = getComputedStyle(document.body).backgroundColor;
      const rgb = bg.match(/\d+/g)?.map(Number) || [0, 0, 0];
      const [r, g, b] = rgb;
      const srgb = [r / 255, g / 255, b / 255].map(v => (v <= 0.03928) ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      const L = 0.2126*srgb[0] + 0.7152*srgb[1] + 0.0722*srgb[2];
      if(L < 0.5){
        // Dark mode: render black as white
        result.color = { r: 1, g: 1, b: 1, a: result.color.a };
      }
    }
    
    // Special handling: if wire color is white (r≈1, g≈1, b≈1), render as black in light mode
    const isWhite = result.color.r > 0.99 && result.color.g > 0.99 && result.color.b > 0.99;
    if(isWhite){
      const bg = getComputedStyle(document.body).backgroundColor;
      const rgb = bg.match(/\d+/g)?.map(Number) || [255, 255, 255];
      const [r, g, b] = rgb;
      const srgb = [r / 255, g / 255, b / 255].map(v => (v <= 0.03928) ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      const L = 0.2126*srgb[0] + 0.7152*srgb[1] + 0.0722*srgb[2];
      if(L >= 0.5){
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
  document.getElementById('loadBtn').addEventListener('click', ()=> document.getElementById('fileInput').click());
  document.getElementById('fileInput')!.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ()=>{ try{ loadFromJSON(reader.result); } catch(err){ alert('Failed to load JSON: '+err); } };
    reader.readAsText(f);
  });

  function saveJSON(){
    // Clean up any accidental duplicates/zero-length segments before saving
    const SAVE_LEGACY_WIRE_COLOR = true; // back-compat flag (old format keeps {color})
    normalizeAllWires();
    // build a wires array that always includes KiCad-style stroke; keep {color} if flag enabled
    const wiresOut = wires.map(w=>{
      ensureStroke(w);
      const base = { id: w.id, points: w.points, stroke: w.stroke, netId: w.netId || 'default' } as any;
      if (SAVE_LEGACY_WIRE_COLOR) base.color = w.color || rgba01ToCss(w.stroke!.color);
      return base;
    });
    const data = {
      version: 2,
      title: projTitle.value || 'Untitled',
      grid: GRID,
      components,
      wires: wiresOut,
      junctions,
      nets: Array.from(nets),
      activeNetClass,
      netClasses: Object.fromEntries(
        Object.entries(NET_CLASSES)
          .filter(([id]) => id !== 'default')
          .map(([id, nc]) => [id, nc])
      )
    };
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (projTitle.value?.trim()||'schematic') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function loadFromJSON(text){
    const data = JSON.parse(text);
    components = data.components||[];
    wires = (data.wires||[]);
    projTitle.value = data.title||'';
    
    // Restore nets (add default if not present)
    nets = new Set(data.nets || ['default']);
    if(!nets.has('default')) nets.add('default');
    
    // Restore active net class
    if(data.activeNetClass && typeof data.activeNetClass === 'string'){
      activeNetClass = data.activeNetClass;
    } else {
      activeNetClass = 'default';
    }
    
    // Restore net classes (custom net properties)
    if(data.netClasses && typeof data.netClasses === 'object'){
      Object.entries(data.netClasses).forEach(([id, nc]: [string, any]) => {
        if(nc && typeof nc === 'object'){
          NET_CLASSES[id] = {
            id: nc.id || id,
            name: nc.name || id,
            wire: nc.wire || { ...THEME.wire },
            junction: nc.junction || { ...THEME.junction }
          };
        }
      });
    }

    // Backfill stroke from legacy color (and ensure presence for v2)
    wires.forEach((w:any)=>{
      if (!w.stroke) {
        const css = w.color || defaultWireColor;
        w.stroke = { width: 0, type:'default', color: cssToRGBA01(css) };
      }
      // keep legacy color in sync so SWP heuristics & old flows remain stable
      if (!w.color) w.color = rgba01ToCss(w.stroke.color);
      // Preserve an internal nanometer resolution where possible
      if ((w.stroke as any).widthNm == null && typeof w.stroke.width === 'number') {
        (w.stroke as any).widthNm = Math.round((w.stroke.width || 0) * NM_PER_MM);
      }
      if (!w.netId) w.netId = 'default';
    });

    junctions = Array.isArray(data.junctions) ? data.junctions : [];

    normalizeAllWires();

    // re-seed counters so new IDs continue incrementing nicely
    const used = { resistor:0, capacitor:0, inductor:0, diode:0, npn:0, pnp:0, ground:0, battery:0, ac:0, wire:0 };
    for(const c of components){ const k=c.type; const num=parseInt((c.label||'').replace(/^[A-Z]+/,'').trim())||0; used[k]=Math.max(used[k], num); }
    for(const w of wires){ const n=parseInt((w.id||'').replace(/^wire/,''))||0; used.wire=Math.max(used.wire,n); }
    Object.keys(counters).forEach(k=> counters[k] = used[k]+1 );
    selection={kind:null, id:null, segIndex:null}; 
    renderNetList();
    redraw();
  }

  // ====== Topology: nodes, edges, SWPs ======
  function rebuildTopology(): void {
    const nodes = new Map();     // key -> {x,y,edges:Set<edgeId>, axDeg:{x:number,y:number}}
    const edges = [];            // {id, wireId, i, a:{x,y}, b:{x,y}, axis:'x'|'y'|null, akey, bkey}
    const axisOf = (a,b)=> (a.y===b.y) ? 'x' : (a.x===b.x) ? 'y' : null;
    function addNode(p){
      const k = keyPt(p);
      if(!nodes.has(k)) nodes.set(k, { x:Math.round(p.x), y:Math.round(p.y), edges:new Set(), axDeg:{x:0,y:0} });
      return k;
    }
    // Build edges from polylines (axis-aligned only for SWPs)
    for(const w of wires){
      const pts = w.points||[];
      for(let i=0;i<pts.length-1;i++){
        const a = {x:Math.round(pts[i].x), y:Math.round(pts[i].y)};
        const b = {x:Math.round(pts[i+1].x), y:Math.round(pts[i+1].y)};
        const ax = axisOf(a,b);
        const akey = addNode(a), bkey = addNode(b);
        const id = `${w.id}:${i}`;
        edges.push({ id, wireId:w.id, i, a, b, axis:ax, akey, bkey });
        const na = nodes.get(akey), nb = nodes.get(bkey);
        na.edges.add(id); nb.edges.add(id);
        if(ax) { na.axDeg[ax]++; nb.axDeg[ax]++; }
      }
    }

    // --- NEW: Add synthetic "component bridge" edges so SWPs span through embedded 2-pin components ---
    // This lets a straight wire path continue across the part, enabling collapse at move-start and
    // proper re-segmentation at move-end.
    const twoPinForBridge = ['resistor','capacitor','inductor','diode','battery','ac'];
    for (const c of components){
      if(!twoPinForBridge.includes(c.type)) continue;
      const pins = compPinPositions(c).map(p=>({x:Math.round(p.x), y:Math.round(p.y)}));
      if (pins.length !== 2) continue;
      let axis = null;
      if (pins[0].y === pins[1].y) axis = 'x';
      else if (pins[0].x === pins[1].x) axis = 'y';
      if (!axis) continue; // only bridge axis-aligned 2-pin parts
      // Only bridge when the component is actually embedded: both pins touch wire endpoints.
      const hitA = findWireEndpointNear(pins[0], 0.9);
      const hitB = findWireEndpointNear(pins[1], 0.9);
      if(!(hitA && hitB)) continue;
      const akey = addNode(pins[0]), bkey = addNode(pins[1]);
      const id = `comp:${c.id}`;
      edges.push({ id, wireId:null, i:-1, a:pins[0], b:pins[1], axis, akey, bkey });
      const na = nodes.get(akey), nb = nodes.get(bkey);
      na.edges.add(id); nb.edges.add(id);
      na.axDeg[axis]++; nb.axDeg[axis]++;
    }

    // SWPs: maximal straight runs where interior nodes have axis-degree==2
    const visited = new Set();
    const swps = [];
    const edgeById = new Map(edges.map(e=>[e.id,e]));
    function otherEdgeWithSameAxis(nodeKey, fromEdge){
      const n = nodes.get(nodeKey); if(!n) return null;
      if(!fromEdge.axis) return null;
      if(n.axDeg[fromEdge.axis]!==2) return null; // branch or dead-end
      for(const eid of n.edges){
        if(eid===fromEdge.id) continue;
        const e = edgeById.get(eid);
        if(e && e.axis===fromEdge.axis){
          // ensure this edge actually touches this node
          if(e.akey===nodeKey || e.bkey===nodeKey) return e;
        }
      }
      return null;
    }

    for (const e0 of edges){
      if (!e0.axis) continue;
      if (visited.has(e0.id)) continue;
      // Walk both directions along the same axis to capture the entire straight run
      const chainSet = new Set();
      function walkDir(cur, enterNodeKey){
        while (cur && !chainSet.has(cur.id)){
          chainSet.add(cur.id);
          const nextNodeKey = (cur.akey===enterNodeKey) ? cur.bkey : cur.akey;
          const nxt = otherEdgeWithSameAxis(nextNodeKey, cur);
          if(!nxt) break;
          enterNodeKey = nextNodeKey;
          cur = nxt;
        }
      }
      walkDir(e0, e0.akey);
      walkDir(e0, e0.bkey);
      const chain = [...chainSet].map(id=>edgeById.get(id));
      chain.forEach(ed => visited.add(ed.id));

      // Determine endpoints (min/max along axis)
      const allNodes = new Set();
      chain.forEach(ed=>{ allNodes.add(ed.akey); allNodes.add(ed.bkey); });
      const pts = [...allNodes].map(k=>nodes.get(k));
      let start, end, axis=e0.axis;
      if(axis==='x'){
        pts.sort((u,v)=> u.x-v.x);
        start = pts[0]; end = pts[pts.length-1];
      }else{
        pts.sort((u,v)=> u.y-v.y);
        start = pts[0]; end = pts[pts.length-1];
      }
      // Pick color: "left/top" edge's source wire color
      let leadEdge = chain[0];
      if(axis==='x'){
        leadEdge = chain.reduce((m,e)=> Math.min(e.a.x,e.b.x) < Math.min(m.a.x,m.b.x) ? e : m, chain[0]);
      } else {
        leadEdge = chain.reduce((m,e)=> Math.min(e.a.y,e.b.y) < Math.min(m.a.y,m.b.y) ? e : m, chain[0]);
      }
      const leadWire = wires.find(w=>w.id===leadEdge.wireId);
      // If all contributing wire segments share the same color, use it; otherwise default to white.
      const segColors = [...new Set(
        chain
          .map(e => e.wireId)
          .filter(Boolean)
          .map(id => (wires.find(w=>w.id===id)?.color) || defaultWireColor)
      )];
      const swpColor = (segColors.length === 1) ? segColors[0] : '#FFFFFF';

      // Track both the wire IDs and the exact segment indices per wire.
      const edgeWireIds = [...new Set(chain.map(e=>e.wireId).filter(Boolean))];
      const edgeIndicesByWire: Record<string, number[]> = {};
      for(const e of chain){
        if(!e.wireId) continue;               // skip synthetic component bridges
        (edgeIndicesByWire[e.wireId] ||= []).push(e.i);
      }
      // normalize & sort indices per wire
      for(const k in edgeIndicesByWire){
        edgeIndicesByWire[k] = [...new Set(edgeIndicesByWire[k])].sort((a,b) => a - b);
      }

      swps.push({
        id: `swp${swps.length+1}`,
        axis,
        start:{x:start.x,y:start.y},
        end:{x:end.x,y:end.y},
        color: swpColor,
        edgeWireIds,
        edgeIndicesByWire
      });
    }
    // Map components (2-pin only) onto SWPs
    const compToSwp = new Map();
    const twoPin = ['resistor','capacitor','inductor','diode','battery','ac'];
    for(const c of components){
      if(!twoPin.includes(c.type)) continue;
      const pins = compPinPositions(c).map(p=>({x:Math.round(p.x), y:Math.round(p.y)}));
      if(pins.length!==2) continue;
      for(const s of swps){
        if(s.axis==='x'){
          const y = s.start.y;
          const minx = Math.min(s.start.x, s.end.x), maxx=Math.max(s.start.x, s.end.x);
          if(eqN(pins[0].y, y) && eqN(pins[1].y,y) &&
             Math.min(pins[0].x,pins[1].x) >= minx-0.5 &&
             Math.max(pins[0].x,pins[1].x) <= maxx+0.5){
            compToSwp.set(c.id, s.id); break;
          }
        } else if (s.axis==='y'){
          const x = s.start.x;
          const miny = Math.min(s.start.y, s.end.y), maxy=Math.max(s.start.y, s.end.y);
          if(eqN(pins[0].x, x) && eqN(pins[1].x,x) &&
             Math.min(pins[0].y,pins[1].y) >= miny-0.5 &&
             Math.max(pins[0].y,pins[1].y) <= maxy+0.5){
            compToSwp.set(c.id, s.id); break;
          }
        }
      }
    }
    topology = { nodes:[...nodes.values()], edges, swps, compToSwp };
  }

  // ---- SWP Move: collapse current SWP to a single straight wire, constrain move, rebuild on finish ----
function findSwpById(id: string): SWP | undefined { return topology.swps.find(s=>s.id===id); }
function swpIdForComponent(c: any): string | null { return topology.compToSwp.get(c.id) || null; }
// Return the SWP that contains wire segment (wireId, segIndex), or null
function swpForWireSegment(wireId: string, segIndex?: number): SWP | null {
  for (const s of topology.swps) {
    if (s.edgeWireIds && s.edgeWireIds.includes(wireId)) return s;
  }
  return null;
}
  function compCenterAlongAxis(c, axis){ return axis==='x' ? c.x : c.y; }
  function pinSpanAlongAxis(c, axis){
    const pins = compPinPositions(c);
    if(axis==='x'){
      const xs = pins.map(p=>Math.round(p.x)); return { lo: Math.min(...xs), hi: Math.max(...xs) };
    } else {
      const ys = pins.map(p=>Math.round(p.y)); return { lo: Math.min(...ys), hi: Math.max(...ys) };
    }
  }
  function halfPinSpan(c, axis){
    const s = pinSpanAlongAxis(c, axis);
    return (axis==='x') ? (s.hi - s.lo)/2 : (s.hi - s.lo)/2;
  }  
  function beginSwpMove(c){
    const sid = swpIdForComponent(c);
    if(!sid) return null;
    // Already collapsed for this SWP? Keep it; just remember which component we're moving.
    if (moveCollapseCtx && moveCollapseCtx.kind==='swp' && moveCollapseCtx.sid===sid){
      lastMoveCompId = c.id;
      return moveCollapseCtx;
    }
    // Capture undo state before beginning move
    pushUndo();
    const swp = findSwpById(sid); if(!swp) return null;    
    // Collapse the SWP: remove all its wires, replace with a single straight polyline
    // Collapse the SWP: remove only the SWP's segments from their host wires (preserve perpendicular legs),
    // then add one straight polyline for the collapsed SWP.
    const originalWires = JSON.parse(JSON.stringify(wires));
    const rebuilt = [];
  // Collect original segment strokes for the SWP so we can reassign them after move
  const originalSegments: Array<{ wireId?: string; index?: number; lo: number; hi: number; mid: number; stroke?: Stroke }>=[];
  // Also capture a snapshot of the full wires that contributed to this SWP so we can
  // find the closest original physical segment by distance at restore time.
  const origWireSnapshot: Array<{ id: string; points: Point[]; stroke?: Stroke }> = [];
    // With per-segment wires, originalWires already contains 2-point wires.
    for (const w of originalWires) {
      if (swp.edgeWireIds && swp.edgeWireIds.includes(w.id)) {
        // This segment is part of the SWP: remove it from the collapsed set and
        // record its axis-aligned extent + stroke for later remapping.
        const p0 = w.points[0]; const p1 = w.points[1];
        if (p0 && p1) {
          const lo = (swp.axis === 'x') ? Math.min(p0.x, p1.x) : Math.min(p0.y, p1.y);
          const hi = (swp.axis === 'x') ? Math.max(p0.x, p1.x) : Math.max(p0.y, p1.y);
          const mid = (lo + hi) / 2;
          originalSegments.push({ wireId: w.id, index: 0, lo, hi, mid, stroke: w.stroke } as any);
        }
        origWireSnapshot.push({ id: w.id, points: w.points.map(p=>({x:p.x,y:p.y})), stroke: w.stroke });
      } else {
        // untouched wire (preserve full object including stroke)
        rebuilt.push(w);
      }
    }
  // sort original segments along axis (by midpoint)
  originalSegments.sort((a,b)=> a.mid - b.mid);
    const p0 = swp.start, p1 = swp.end;
  const collapsed = { id: uid('wire'), points:[{x:p0.x,y:p0.y},{x:p1.x,y:p1.y}], color: swp.color };
    wires = rebuilt.concat([collapsed]);

    // Compute allowed span for c (no overlap with other components in this SWP)
    const axis = swp.axis;
    const myHalf = halfPinSpan(c, axis);
    const fixed = (axis==='x') ? p0.y : p0.x;
    const endLo = (axis==='x') ? Math.min(p0.x, p1.x) : Math.min(p0.y, p1.y);
    const endHi = (axis==='x') ? Math.max(p0.x, p1.x) : Math.max(p0.y, p1.y);
    // Other components on this SWP, build neighbor-based exclusion using real half-spans
    const others = components.filter(o => o.id!==c.id && swpIdForComponent(o)===sid)
                             .map(o=>({ center: compCenterAlongAxis(o,axis), half: halfPinSpan(o,axis) }))
                             .sort((a,b)=> a.center - b.center);
    const t0 = compCenterAlongAxis(c, axis);
    let leftBound = endLo + myHalf, rightBound = endHi - myHalf;
    for(const o of others){
      const gap = myHalf + o.half; // centers must be ≥ this far apart
      if(o.center <= t0) leftBound  = Math.max(leftBound,  o.center + gap);
      if(o.center >= t0) rightBound = Math.min(rightBound, o.center - gap);
    }
    // Clamp current component to the fixed line (orthogonal coordinate)
    if(axis==='x'){ c.y = fixed; } else { c.x = fixed; }
    redrawCanvasOnly(); // reflect the collapsed wire visually
    moveCollapseCtx = {
      kind:'swp', sid, axis, fixed,
      minCenter: leftBound, maxCenter: rightBound,
      ends:{ lo:endLo, hi:endHi }, color: swp.color,
      collapsedId: collapsed.id,
      lastCenter: t0,
      // attached metadata: original SWP contributing segments (lo/hi in axis coords + stroke)
      originalSegments,
      origWireSnapshot
    } as any;
    lastMoveCompId = c.id;
    return moveCollapseCtx;
  }
  function finishSwpMove(c){
    if(!moveCollapseCtx || moveCollapseCtx.kind!=='swp') return;
    const mc = moveCollapseCtx;
    const axis = mc.axis;
    // Safety clamp: ensure the component's pins sit within [lo, hi]
    const myHalf = halfPinSpan(c, axis);
    let ctr = compCenterAlongAxis(c, axis);
    if(ctr - myHalf < mc.ends.lo) ctr = mc.ends.lo + myHalf;
    if(ctr + myHalf > mc.ends.hi) ctr = mc.ends.hi - myHalf;
    if(axis==='x'){ c.x = ctr; c.y = mc.fixed; } else { c.y = ctr; c.x = mc.fixed; }
    updateComponentDOM(c);    
    const lo = mc.ends.lo, hi = mc.ends.hi;
    const EPS = 0.5;
    // Keep ONLY components whose two pins lie within this SWP’s endpoints.
    const inSwpComps = components.filter(o=>{
      const pins = compPinPositions(o);
      if(axis==='x'){
        if(!(eqN(pins[0].y, mc.fixed) && eqN(pins[1].y, mc.fixed))) return false;
        const sp = pinSpanAlongAxis(o, 'x');
        return sp.lo >= lo-EPS && sp.hi <= hi+EPS;
      }else{
        if(!(eqN(pins[0].x, mc.fixed) && eqN(pins[1].x, mc.fixed))) return false;
        const sp = pinSpanAlongAxis(o, 'y');
        return sp.lo >= lo-EPS && sp.hi <= hi+EPS;
      }
    }).sort((a,b)=> compCenterAlongAxis(a,axis) - compCenterAlongAxis(b,axis));

    // Sweep lo→hi, carving gaps at each component’s pin span.
    const newSegs = [];
    let cursor = lo;
    for(const o of inSwpComps){
      const sp = pinSpanAlongAxis(o, axis);
      const a = (axis==='x') ? {x:cursor, y:mc.fixed} : {x:mc.fixed, y:cursor};
      const b = (axis==='x') ? {x:sp.lo,  y:mc.fixed} : {x:mc.fixed, y:sp.lo};
      if( (axis==='x' ? a.x < b.x : a.y < b.y) ){
        // choose stroke for this segment by finding the closest original physical segment
        // using the origWireSnapshot (distance to segment) and fall back to overlap matching
        const segMidPt = { x: (a.x + b.x)/2, y: (a.y + b.y)/2 };
        let chosenStroke: Stroke | undefined = undefined;
        if ((mc as any).origWireSnapshot && (mc as any).origWireSnapshot.length){
          let bestD = Infinity;
          for(const ow of (mc as any).origWireSnapshot){
            const pts = ow.points || [];
            for(let i=0;i<pts.length-1;i++){
              const d = pointToSegmentDistance(segMidPt, pts[i], pts[i+1]);
              if (d < bestD){ bestD = d; chosenStroke = ow.stroke; }
            }
          }
          // If closest distance is too large, attempt overlap-based match as fallback
          if (bestD > 12 && (mc as any).originalSegments && (mc as any).originalSegments.length){
            let bestOverlap = 0;
            const segStart = axis==='x' ? a.x : a.y;
            const segEnd = axis==='x' ? b.x : b.y;
            const segLo = Math.min(segStart, segEnd), segHi = Math.max(segStart, segEnd);
            for(const os of (mc as any).originalSegments){
              const ov = Math.max(0, Math.min(segHi, os.hi) - Math.max(segLo, os.lo));
              if (ov > bestOverlap){ bestOverlap = ov; chosenStroke = os.stroke; }
            }
            // if still none, choose nearest by midpoint
            if(!chosenStroke){
              const segMid = (segStart + segEnd) / 2;
              let bestDist = Infinity;
              for(const os of (mc as any).originalSegments){
                const osMid = (os.lo + os.hi) / 2;
                const d = Math.abs(segMid - osMid);
                if (d < bestDist){ bestDist = d; chosenStroke = os.stroke; }
              }
            }
          }
        } else if ((mc as any).originalSegments && (mc as any).originalSegments.length){
          // fallback if no snapshot present
          let bestOverlap = 0;
          const segStart = axis==='x' ? a.x : a.y;
          const segEnd = axis==='x' ? b.x : b.y;
          const segLo = Math.min(segStart, segEnd), segHi = Math.max(segStart, segEnd);
          for(const os of (mc as any).originalSegments){
            const ov = Math.max(0, Math.min(segHi, os.hi) - Math.max(segLo, os.lo));
            if (ov > bestOverlap){ bestOverlap = ov; chosenStroke = os.stroke; }
          }
        }
        newSegs.push({ id: uid('wire'), points:[a,b], color: chosenStroke ? rgba01ToCss(chosenStroke.color) : mc.color, stroke: chosenStroke });
      }
      cursor = sp.hi;
    }
    // Tail segment (last gap → end)
    const tailA = (axis==='x') ? {x:cursor, y:mc.fixed} : {x:mc.fixed, y:cursor};
    const tailB = (axis==='x') ? {x:hi,     y:mc.fixed} : {x:mc.fixed, y:hi};
    if( (axis==='x' ? tailA.x < tailB.x : tailA.y < tailB.y) ){
      const segMidPt = { x: (tailA.x + tailB.x)/2, y: (tailA.y + tailB.y)/2 };
      let chosenStroke: Stroke | undefined = undefined;
      if ((mc as any).origWireSnapshot && (mc as any).origWireSnapshot.length){
        let bestD = Infinity;
        for(const ow of (mc as any).origWireSnapshot){
          const pts = ow.points || [];
          for(let i=0;i<pts.length-1;i++){
            const d = pointToSegmentDistance(segMidPt, pts[i], pts[i+1]);
            if (d < bestD){ bestD = d; chosenStroke = ow.stroke; }
          }
        }
        if (bestD > 12 && (mc as any).originalSegments && (mc as any).originalSegments.length){
          let bestOverlap = 0;
          const segStart = axis==='x' ? tailA.x : tailA.y;
          const segEnd = axis==='x' ? tailB.x : tailB.y;
          const segLo = Math.min(segStart, segEnd), segHi = Math.max(segStart, segEnd);
          for(const os of (mc as any).originalSegments){
            const ov = Math.max(0, Math.min(segHi, os.hi) - Math.max(segLo, os.lo));
            if (ov > bestOverlap){ bestOverlap = ov; chosenStroke = os.stroke; }
          }
          if(!chosenStroke){
            const segMid = (segStart + segEnd) / 2;
            let bestDist = Infinity;
            for(const os of (mc as any).originalSegments){
              const osMid = (os.lo + os.hi) / 2;
              const d = Math.abs(segMid - osMid);
              if (d < bestDist){ bestDist = d; chosenStroke = os.stroke; }
            }
          }
        }
      } else if ((mc as any).originalSegments && (mc as any).originalSegments.length){
        let bestOverlap = 0;
        const segStart = axis==='x' ? tailA.x : tailA.y;
        const segEnd = axis==='x' ? tailB.x : tailB.y;
        const segLo = Math.min(segStart, segEnd), segHi = Math.max(segStart, segEnd);
        for(const os of (mc as any).originalSegments){
          const ov = Math.max(0, Math.min(segHi, os.hi) - Math.max(segLo, os.lo));
          if (ov > bestOverlap){ bestOverlap = ov; chosenStroke = os.stroke; }
        }
      }
      newSegs.push({ id: uid('wire'), points:[tailA, tailB], color: chosenStroke ? rgba01ToCss(chosenStroke.color) : mc.color, stroke: chosenStroke });
    }

    // Restore: remove only the collapsed straight run; add the reconstructed SWP segments beside all other wires
    const untouched = wires.filter(w=> w.id!==mc.collapsedId);
    // Map original segments -> reconstructed segments by order along the axis when possible
    try {
      const orig = ((mc as any).originalSegments || []).slice().sort((a,b)=> a.mid - b.mid);
      const mapped = newSegs.map((s, idx) => ({ idx, mid: (axis==='x' ? (s.points[0].x + s.points[1].x)/2 : (s.points[0].y + s.points[1].y)/2), seg: s }));
      mapped.sort((a,b)=> a.mid - b.mid);
      const n = Math.min(orig.length, mapped.length);
      for(let i=0;i<n;i++){
        const os = orig[i];
        const tar = mapped[i].seg;
        if(os && os.stroke){
          tar.stroke = os.stroke;
          tar.color = rgba01ToCss(os.stroke.color);
        }
      }
      // any remaining unmapped segments keep mc.color (already set)
    } catch (err) {
      // fall back to default behavior if matching fails
    }
    wires = untouched.concat(newSegs);
    moveCollapseCtx = null;
    lastMoveCompId = null;    
    normalizeAllWires();
    rebuildTopology();
    redraw();
  }

  // Ensure current selection's SWP is collapsed if possible (Move mode entry or selection of a component).
  function ensureCollapseForSelection(){
    if (selection.kind !== 'component') return;
    const c = components.find(x => x.id === selection.id); if (!c) return;
    rebuildTopology();
    const sid = swpIdForComponent(c);
    if (!sid) return;
    if (moveCollapseCtx && moveCollapseCtx.kind==='swp' && moveCollapseCtx.sid===sid){
      lastMoveCompId = c.id; // already collapsed for this SWP
      return;
    }
    // If another SWP is currently collapsed, finalize it first.
    if (moveCollapseCtx && moveCollapseCtx.kind==='swp'){
      const prev = components.find(x => x.id === lastMoveCompId);
      finishSwpMove(prev || c);
    }
    beginSwpMove(c);
  }

  // Finalize any active SWP collapse (used when leaving Move mode or switching selection away).
  function ensureFinishSwpMove(){
    if (moveCollapseCtx && moveCollapseCtx.kind==='swp'){
      const prev = components.find(x => x.id === lastMoveCompId);
      if (prev) {
        finishSwpMove(prev);
      } else {
        // Fallback: finalize using any component that sits on this SWP
        const anyOn = components.find(o => swpIdForComponent(o) === moveCollapseCtx.sid);
        if (anyOn) finishSwpMove(anyOn); else moveCollapseCtx = null;
      }
    }
  }
  
  // ====== Boot ======
  // start at 1:1 (defer applyZoom until after panels are initialized)
  redraw();
  
  // Ensure button states reflect initial values
  updateGridToggleButton();
  if(updateOrthoButtonVisual) updateOrthoButtonVisual();
  
  // Manually initialize junction dots and tracking buttons if they weren't caught by IIFEs
  const jdBtn = document.getElementById('junctionDotsBtn');
  if(jdBtn){
    if(showJunctionDots) jdBtn.classList.add('active');
    else jdBtn.classList.remove('active');
  }
  const trBtn = document.getElementById('trackingToggleBtn');
  if(trBtn){
    if(trackingMode) trBtn.classList.add('active');
    else trBtn.classList.remove('active');
  }
  
  // ====== Resizable and Collapsible Panels ======
  (function initPanels(){
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
      if(saved){
        const parsed = JSON.parse(saved);
        if(parsed.left) panelState.left = parsed.left;
        if(parsed.right) panelState.right = parsed.right;
      }
    } catch(_){}
    
    function saveState(){
      localStorage.setItem('panel.state', JSON.stringify(panelState));
    }
    
    // Get minimal collapsed width - just wide enough for button and single letter
    function getCollapsedWidth(): number {
      return 40; // Minimal width for single letter + button
    }
    
    // Apply saved state on load
    if(leftPanel){
      const leftHeader = leftPanel.querySelector('.panel-header h2') as HTMLElement;
      if(panelState.left.collapsed){
        leftPanel.classList.add('collapsed');
        leftPanel.style.width = getCollapsedWidth() + 'px';
        if(leftHeader) leftHeader.textContent = 'I';
      } else {
        leftPanel.style.width = panelState.left.width + 'px';
        if(leftHeader) leftHeader.textContent = 'Inspector';
      }
    }
    if(rightPanel){
      const rightHeader = rightPanel.querySelector('.panel-header h2') as HTMLElement;
      if(panelState.right.collapsed){
        rightPanel.classList.add('collapsed');
        rightPanel.style.width = getCollapsedWidth() + 'px';
        if(rightHeader) rightHeader.textContent = 'P';
      } else {
        rightPanel.style.width = panelState.right.width + 'px';
        if(rightHeader) rightHeader.textContent = 'Project';
      }
    }
    
    // Update button indicators based on state
    const leftToggle = document.querySelector('[data-panel="left"]') as HTMLElement;
    const rightToggle = document.querySelector('[data-panel="right"]') as HTMLElement;
    if(leftToggle) leftToggle.textContent = panelState.left.collapsed ? '▶' : '◀';
    if(rightToggle) rightToggle.textContent = panelState.right.collapsed ? '◀' : '▶';
    
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
        if(!target) return;
        
        const panel = document.getElementById(target);
        if(!panel) return;
        
        const isLeft = target === 'left';
        const state = isLeft ? panelState.left : panelState.right;
        const header = panel.querySelector('.panel-header h2') as HTMLElement;
        const fullText = isLeft ? 'Inspector' : 'Project';
        const letterText = isLeft ? 'I' : 'P';
        
        if(state.collapsed){
          // Expand
          panel.classList.remove('collapsed');
          panel.style.width = state.width + 'px';
          state.collapsed = false;
          if(header) header.textContent = fullText;
          (btn as HTMLElement).textContent = isLeft ? '◀' : '▶';
        } else {
          // Collapse
          const collapsedWidth = getCollapsedWidth();
          panel.classList.add('collapsed');
          panel.style.width = collapsedWidth + 'px';
          state.collapsed = true;
          if(header) header.textContent = letterText;
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
    
    // Resizer drag functionality
    function initResizer(resizer: HTMLElement, panel: HTMLElement, isLeft: boolean){
      let startX = 0;
      let startWidth = 0;
      
      function onMouseDown(e: MouseEvent){
        if(e.button !== 0) return;
        e.preventDefault();
        
        const state = isLeft ? panelState.left : panelState.right;
        if(state.collapsed) return; // Don't resize when collapsed
        
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      }
      
      function onMouseMove(e: MouseEvent){
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
      
      function onMouseUp(){
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
    
    if(leftResizer && leftPanel) initResizer(leftResizer, leftPanel, true);
    if(rightResizer && rightPanel) initResizer(rightResizer, rightPanel, false);
  })();
})();