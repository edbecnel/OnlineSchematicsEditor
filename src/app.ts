(function(){
// ====== Minimal shared types (temporary, editor-internal) ======
type UUID = string;
type AnyProps = Record<string, any>;

// Allow using dataset/value/closest cleanly with typed elements
const $q = <T extends Element>(sel: string, root: ParentNode | Document = document) =>
  root.querySelector<T>(sel)!;
const $qa = <T extends Element>(sel: string, root: ParentNode | Document = document) =>
  Array.from(root.querySelectorAll<T>(sel));

// Small helper so numeric SVG attributes compile without changing behavior
function setAttr(el: Element, name: string, value: number | string) {
  el.setAttribute(name, String(value));
}
function setAttrs(el: Element, attrs: Record<string, number | string>) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
}

// Accepts Pointer/Mouse/Touch-ish events safely
type ClientXYEvent = {
  clientX?: number;
  clientY?: number;
  touches?: Array<{ clientX: number; clientY: number }> | TouchList;
};

// Pointer/touch coordinate helper
function getClientXY(evt: ClientXYEvent) {
  const t = (evt as any).touches?.[0];
  const x = (evt as any).clientX ?? t?.clientX ?? 0;
  const y = (evt as any).clientY ?? t?.clientY ?? 0;
  return { x, y };
}

  // ====== Core State ======
  const GRID: number = 24; // px

  // Nanometer resolution constants (internal units)
  const NM_PER_MM = 1_000_000;   // 1 mm == 1,000,000 nm
  const NM_PER_IN = 25_400_000;  // 25.4 mm == 1 inch
  const NM_PER_MIL = NM_PER_IN / 1000; // 0.001 in

  // Global units state and persistence (available at module-init time to avoid TDZ issues)
  let globalUnits: 'mm' | 'in' | 'mils' = (localStorage.getItem('global.units') as any) || 'mm';
  function saveGlobalUnits(){ localStorage.setItem('global.units', globalUnits); }

// DOM refs
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

// ===== Types (editor-only; no runtime) =====
type Mode = 'select' | 'wire' | 'delete' | 'place' | 'pan' | 'move';
type PlaceType = 'resistor' | 'capacitor' | 'inductor' | 'diode' | 'npn' | 'pnp' | 'ground' | 'battery' | 'ac';
// Selection shape. Note: legacy `segIndex` support remains for backward
// compatibility (some UI code may still set it to `null`), but the editor now
// treats each visible straight sub-segment as its own `Wire` (identified by
// `wire.id`). Prefer selecting segments by `selection = { kind: 'wire', id: <wireId>, segIndex: null }`.
type Selection =
  | { kind: null; id: null; segIndex: null }
  | { kind: 'component'; id: string; segIndex: null }
  | { kind: 'wire'; id: string; segIndex: number | null };
type Point = { x: number; y: number };
type Axis = 'x' | 'y' | null;
// ----- Editor model shapes (no behavior change) -----
type DiodeSubtype = 'generic' | 'schottky' | 'zener' | 'led' | 'photo' | 'tunnel' | 'varactor' | 'laser';

interface Component {
  id: string;
  type: PlaceType;
  x: number;
  y: number;
  rot: number;               // degrees, multiples of 90
  label: string;
  value?: string;
  props?: {
    unit?: string;           // Ω / F / H symbol for R/C/L
    subtype?: DiodeSubtype;  // diode subtype
    voltage?: number;        // battery/AC source voltage
    [k: string]: any;        // future-safe
  };
}

interface Wire {
  id: string;
  points: Point[];
  /** LEGACY editor field (kept for back-compat saves & SWP color heuristics) */
  color?: string;            // css color string
  /** KiCad-style override; width=0 and type='default' mean "use netclass/theme" */
  stroke?: Stroke;
  /** Optional net hook for later; defaults to 'default' netclass */
  netId?: string | null;
}

type CounterKey = PlaceType | 'wire';
// --- SWP / Topology shapes (editor-only) ---
type SWPEdge = {
  id: string;
  wireId: string | null;     // null for synthetic component-bridge edges
  i: number;                 // segment index within wireId (or -1 for bridge)
  a: Point;
  b: Point;
  axis: Axis;                // 'x' | 'y' | null (null = angled/non-axis)
  akey: string;              // "x,y"
  bkey: string;              // "x,y"
};

type SWP = {
  id: string;                // e.g. "swp3"
  axis: Exclude<Axis, null>; // 'x' | 'y' only
  start: Point;              // canonical start endpoint of the span
  end: Point;                // canonical end endpoint of the span
  color: string;             // representative color for the span
  edgeWireIds: string[];     // contributing wire IDs
  edgeIndicesByWire: Record<string, number[]>; // per-wire segment indices that belong to the SWP
};

type Topology = {
  nodes: Array<{ x: number; y: number; edges: Set<string>; axDeg: { x: number; y: number } }>;
  edges: SWPEdge[];
  swps: SWP[];
  compToSwp: Map<string, string>;  // component.id -> swp.id
};

type MoveCollapseCtx = {
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

// ===== KiCad-friendly types (no behavior; types + adapters only) =====
type RGBA01 = { r: number; g: number; b: number; a: number };            // 0..1
type StrokeType = 'default' | 'solid' | 'dash' | 'dot' | 'dash_dot' | 'dash_dot_dot';
type Stroke = { width: number; type: StrokeType; color: RGBA01 };        // mm + style + RGBA

// Minimal net/theming for precedence (explicit → netclass → theme)
type NetClass = {
  id: string;
  name: string;
  wire: Stroke;                              // defaults for wires in this class
  junction: { size: number; color: RGBA01 }; // mm + RGBA
};
type Theme = {
  wire: Stroke;                              // global fallback
  junction: { size: number; color: RGBA01 };
};
type KWire = {
  id: string;                  // uuid in KiCad; we’ll keep our id for now
  points: Point[];             // (pts (xy …) …)
  stroke: Stroke;              // (stroke …)
  netId?: string | null;       // optional editor-side metadata
};

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
  const BASE_W = 1600, BASE_H = 1000;
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
    updateZoomUI();
  }
  // keep grid filling canvas on window resizes
  window.addEventListener('resize', applyZoom);
  function redrawGrid(){
    const w = viewW, h = viewH;
    const r = document.getElementById('gridRect');
    if(!r) return;
    setAttr(r, 'x', viewX);
    setAttr(r, 'y', viewY);
    setAttr(r, 'width', w);
    setAttr(r, 'height', h);
  }
  function updateZoomUI(){
    const z = Math.round(zoom * 100);
    const inp = document.getElementById('zoomPct') as HTMLInputElement | null;
    if (inp && inp.value !== z + '%') inp.value = z + '%';
  }

  let counters = { resistor:1, capacitor:1, inductor:1, diode:1, npn:1, pnp:1, ground:1, battery:1, ac:1, wire:1 };
  // Core model arrays (global)
  let components: Component[] = [];
  let wires: Wire[] = [];

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
    return NET_CLASSES[w.netId || 'default'] || NET_CLASSES.default;
  }

  type WireColorMode = 'custom' | 'auto' | 'red' | 'green' | 'blue' | 'yellow' | 'magenta' | 'cyan';
  let currentWireColorMode: WireColorMode = 'auto';

  function resolveWireColor(mode: WireColorMode): string {
    const map: Record<Exclude<WireColorMode, 'auto'>, string> = {
      custom: 'custom',
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

  // Options used in both toolbar and Inspector (names -> resolved stroke colors)
  const WIRE_COLOR_OPTIONS: Array<[WireColorMode, string]> = [
    ['auto','Auto (Black/White)'],
    ['red','Red'], ['green','Green'], ['blue','Blue'],
    ['yellow','Yellow'], ['magenta','Magenta'], ['cyan','Cyan']
  ];

  let junctions: Array<{ at: Point; size?: number; color?: string; netId?: string|null }> = [];

  // Convert CSS color ("rgb(...)" or color name) to #RRGGBB
  function colorToHex(cstr){
    const tmp = document.createElement('span');
    tmp.style.color = cstr; document.body.appendChild(tmp);
    const rgb = getComputedStyle(tmp).color; document.body.removeChild(tmp);
    const m = rgb.match(/\d+/g); if(!m) return '#000000';
    const [r,g,b] = m.map(n=> Math.max(0,Math.min(255,parseInt(n,10))));
    const hx = v=> v.toString(16).padStart(2,'0').toUpperCase();
    return `#${hx(r)}${hx(g)}${hx(b)}`;
  }

  function wireColorNameFromValue(v){
    const val = (v||'').toLowerCase();
    // map actual stroke values back to option keys when possible
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
  const setSwatch = (el, color)=>{ 
    if(!el) return; 
    el.style.background = color; 
    el.style.backgroundColor = color; 
  }; 

  // ====== Unit options for Value fields ======
  const UNIT_OPTIONS = {
    resistor: ['T\u03A9','G\u03A9','M\u03A9','k\u03A9','\u03A9','m\u03A9'],                // TΩ … mΩ
    capacitor: ['TF','GF','MF','kF','F','mF','\u00B5F','nF','pF'],                        // µ = \u00B5
    inductor: ['TH','GH','MH','kH','H','mH','\u00B5H','nH']                               // µ = \u00B5
  };

  const snap = (v: number): number => Math.round(v / GRID) * GRID;
  const uid = (prefix: CounterKey): string => `${prefix}${counters[prefix]++}`;

  function updateCounts(){
    countsEl.textContent = `Components: ${components.length} · Wires: ${wires.length}`;
  }

  function setMode(m: Mode){
    mode = m; overlayMode.textContent = m[0].toUpperCase()+m.slice(1);

    $qa<HTMLButtonElement>('#modeGroup button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === m);
    });

    // reflect mode on body for cursor styles
    document.body.classList.remove('mode-select','mode-wire','mode-delete','mode-place','mode-pan','mode-move');
    document.body.classList.add(`mode-${m}`);
    // If user switches to Delete with an active selection, apply delete immediately
    if (m==='delete' && selection.kind){
      if(selection.kind==='component'){ removeComponent(selection.id); return; }
      if(selection.kind==='wire'){
        const w = wires.find(x=>x.id===selection.id);
        if(w){
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

  // ====== Component Drawing ======
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

  function rotatePoint(p, center, deg){
    const rad = deg*Math.PI/180; const s=Math.sin(rad), co=Math.cos(rad);
    const dx=p.x-center.x, dy=p.y-center.y;
    return { x: center.x + dx*co - dy*s, y: center.y + dx*s + dy*co, name:p.name };
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
      const pins0 = compPinPositions(c).map(p=>({x:snap(p.x),y:snap(p.y)}));
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
        let nx = snap(p.x + dragOff.x);
        nx = Math.max(mc.minCenter, Math.min(mc.maxCenter, nx));
        const candX = nx, candY = mc.fixed;
        if(!overlapsAnyOtherAt(c, candX, candY) && !pinsCoincideAnyAt(c, candX, candY)){
          c.x = candX; c.y = candY; mc.lastCenter = candX;
          updateComponentDOM(c);
        }
      } else {
        let ny = snap(p.y + dragOff.y);
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
          const pinsNow = compPinPositions(c).map(p=>({x:snap(p.x),y:snap(p.y)}));
          adjustWireEnd(slideCtx.wA, slideCtx.pinAStart, pinsNow[0]);
          adjustWireEnd(slideCtx.wB, slideCtx.pinBStart, pinsNow[1]);
          slideCtx.pinAStart = pinsNow[0]; slideCtx.pinBStart = pinsNow[1];
          updateComponentDOM(c); updateWireDOM(slideCtx.wA); updateWireDOM(slideCtx.wB);
        }
      }else{
        const candX = snap(p.x + dragOff.x);
        const candY = snap(p.y + dragOff.y);
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
      const y=c.y, xLong=c.x-10, xShort=c.x+6;
      line(xLong, y-18, xLong, y+18);
      line(xShort, y-12, xShort, y+12);
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
        else if (mode === 'select' || mode==='move') {
          // Select by wire (segment) id only; legacy segIndex is no longer required.
          selecting('wire', w.id, null);
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
    updateSelectionOutline();    
    updateCounts();
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

  function pointToSegmentDistance(p: Point, a: Point, b: Point){
    const A = {x:a.x, y:a.y}, B={x:b.x, y:b.y}, P={x:p.x, y:p.y};
    const ABx=B.x-A.x, ABy=B.y-A.y; const APx=P.x-A.x, APy=P.y-A.y;
    const ab2 = ABx*ABx + ABy*ABy; if(ab2===0) return Math.hypot(APx,APy);
    let t = (APx*ABx + APy*ABy)/ab2; t=Math.max(0, Math.min(1,t));
    const Qx=A.x + t*ABx, Qy=A.y + t*ABy; return Math.hypot(P.x-Qx, P.y-Qy);
  }

  function projectPointToSegment(p: Point, a: Point, b: Point){
    const A={x:a.x,y:a.y}, B={x:b.x,y:b.y}, P={x:p.x,y:p.y};
    const ABx=B.x-A.x, ABy=B.y-A.y; const APx=P.x-A.x, APy=P.y-A.y;
    const ab2 = ABx*ABx + ABy*ABy; if(ab2===0) return {q:{x:A.x,y:A.y}, t:0};
    let t = (APx*ABx + APy*ABy)/ab2; t=Math.max(0, Math.min(1,t));
    return { q:{ x:A.x + t*ABx, y:A.y + t*ABy }, t };
  }

  // Angles / nearest segment helpers
  const deg = (rad: number): number => rad * 180 / Math.PI;
  const normDeg = (d: number): number => ((d % 360) + 360) % 360;
  const isTwoPinType = (t: string) => ['resistor','capacitor','inductor','diode','battery','ac'].includes(t);
  function segmentAngle(a: Point, b: Point): number { return deg(Math.atan2(b.y - a.y, b.x - a.x)); }

  function nearestSegmentAtPoint(p, maxDist=18){
    let best=null, bestD=Infinity;
    for(const w of wires){
      for(let i=0;i<w.points.length-1;i++){
        const a=w.points[i], b=w.points[i+1];
        const {q,t} = projectPointToSegment(p,a,b);
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
  const rectFromPoints = (a,b)=>{
    const x = Math.min(a.x,b.x), y = Math.min(a.y,b.y);
    return { x, y, w: Math.abs(a.x-b.x), h: Math.abs(a.y-b.y) };
  };
  const inRect = (p, r)=> p.x>=r.x && p.x<=r.x+r.w && p.y>=r.y && p.y<=r.y+r.h;
  function segsIntersect(p1,p2,q1,q2){
    const o = (a,b,c)=>Math.sign((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));
    const on = (a,b,c)=> Math.min(a.x,b.x)<=c.x && c.x<=Math.max(a.x,b.x) && Math.min(a.y,b.y)<=c.y && c.y<=Math.max(a.y,b.y);
    const o1=o(p1,p2,q1), o2=o(p1,p2,q2), o3=o(q1,q2,p1), o4=o(q1,q2,p2);
    if(o1!==o2 && o3!==o4) return true;
    if(o1===0 && on(p1,p2,q1)) return true;
    if(o2===0 && on(p1,p2,q2)) return true;
    if(o3===0 && on(q1,q2,p1)) return true;
    if(o4===0 && on(q1,q2,p2)) return true;
    return false;
  }
  function segmentIntersectsRect(a,b,r){
    if(inRect(a,r) || inRect(b,r)) return true;
    const R = [{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];
    return segsIntersect(a,b,R[0],R[1]) || segsIntersect(a,b,R[1],R[2]) ||
           segsIntersect(a,b,R[2],R[3]) || segsIntersect(a,b,R[3],R[0]);
  }
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
        const {q,t} = projectPointToSegment(pin,a,b);
        const dist = pointToSegmentDistance(pin,a,b);
        // axis-aligned fallback for robust vertical/horizontal splitting
        const isVertical = (a.x===b.x);
        const isHorizontal = (a.y===b.y);
        const withinVert = isVertical && Math.abs(pin.x - a.x) <= GRID/2 && pin.y >= Math.min(a.y,b.y) && pin.y <= Math.max(a.y,b.y);
        const withinHorz = isHorizontal && Math.abs(pin.y - a.y) <= GRID/2 && pin.x >= Math.min(a.x,b.x) && pin.x <= Math.max(a.x,b.x);
        const nearInterior = (t>0.001 && t<0.999 && dist <= 20);        
        if( withinVert || withinHorz || nearInterior ){
          // For angled (nearInterior), split at the exact projection q; else use snapped pin
          const bp = nearInterior ? {x:q.x, y:q.y} : {x:snap(pin.x), y:snap(pin.y)};
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
  const eqPt = (p,q)=> p.x===q.x && p.y===q.y;
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
    const pins = compPinPositions(c).map(p=>({x:snap(p.x),y:snap(p.y)}));
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

  // ====== Interaction ======
  svg.addEventListener('pointerdown', (e)=>{
    const p = svgPoint(e);
    const x = snap(p.x), y=snap(p.y);
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
        drawing.points.push({x,y});
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
    const p = svgPoint(e);
    const x = snap(p.x), y = snap(p.y);
    if (isPanning){ doPan(e); return; }
    // Marquee update (Select mode). Track Shift to flip priority while dragging.
    if(marquee.active){
      marquee.shiftPreferComponents = !!e.shiftKey;
      updateMarqueeTo(svgPoint(e));
    }  
    if(mode==='wire' && drawing.active){
      drawing.cursor = {x, y};
      renderDrawing();
    } else {
      drawing.cursor = null;
    }
    if(mode==='place' && placeType){
      renderGhostAt({x, y}, placeType);
    } else {
      clearGhost();
    }
    // crosshair overlay while in wire mode (even if not actively drawing)
    if(mode==='wire'){ renderCrosshair(x,y); } else { clearCrosshair(); }    
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
    const newZoom = clamp(oldZoom * scale, 0.25, 8);
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
    if(e.key==='Escape'){
      if(drawing.active){
        drawing.active=false; drawing.points=[]; gDrawing.replaceChildren();
      } else {
        // Deselect any selected component or wire (including a single wire segment)
        if(selection.kind === 'component' || selection.kind === 'wire'){
          selection = { kind: null, id: null, segIndex: null };
          // Refresh UI to reflect cleared selection
          renderInspector(); redraw();
        }
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
        wires.push({ id: uid('wire'), points: segmentPts, color: rgba01ToCss(segStroke ? segStroke.color : cssToRGBA01(curCol)), stroke: segStroke, netId: 'default' });
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
    gDrawing.replaceChildren();
    clearCrosshair();
    redraw();
  }

  function renderDrawing(){
    gDrawing.replaceChildren();
    if(!drawing.active) return;
    const pts = drawing.cursor ? [...drawing.points, drawing.cursor] : drawing.points;
    const pl = document.createElementNS('http://www.w3.org/2000/svg','polyline');    
    const drawColor = resolveWireColor(currentWireColorMode);
    pl.setAttribute('fill','none'); pl.setAttribute('stroke', drawColor); pl.setAttribute('stroke-width','1'); pl.setAttribute('stroke-linecap','round'); pl.setAttribute('stroke-linejoin','round');
    pl.setAttribute('marker-start','url(#dot)');
    pl.setAttribute('points', pts.map(p=>`${p.x},${p.y}`).join(' '));
    gDrawing.appendChild(pl);
    // keep endpoint marker in sync with in-progress color
    const dot = document.querySelector('#dot circle');
    if (dot) dot.setAttribute('fill', drawColor);    
  }

  // ----- Crosshair overlay -----
  function clearCrosshair(){
    // Only remove the crosshair lines, not the marquee rect
    $qa<SVGElement>('[data-crosshair]', gOverlay).forEach(el => el.remove());
  }
  function renderCrosshair(x,y){
    clearCrosshair(); // remove previous crosshair lines, keep marquee intact
    // span the *visible* viewBox, accounting for pan offsets
    const xL = viewX, xR = viewX + viewW;
    const yT = viewY, yB = viewY + viewH;    
    const hline = document.createElementNS('http://www.w3.org/2000/svg','line');
    hline.setAttribute('data-crosshair','1');
    setAttr(hline, 'x1', xL); setAttr(hline, 'y1', y);
    setAttr(hline, 'x2', xR); setAttr(hline, 'y2', y);
    const vline = document.createElementNS('http://www.w3.org/2000/svg','line');
    vline.setAttribute('data-crosshair','1');
    setAttr(vline, 'x1', x); setAttr(vline, 'y1', yT);
    setAttr(vline, 'x2', x); setAttr(vline, 'y2', yB);
    gOverlay.appendChild(hline); gOverlay.appendChild(vline);
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
    setMode(m);
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
      currentWireColorMode = 'custom';
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

    // Use netclass defaults
    const rowUse = document.createElement('label');
    rowUse.style.display = 'flex';
    rowUse.style.alignItems = 'center';
    rowUse.style.gap = '8px';
    const chkUse = document.createElement('input');
    chkUse.type = 'checkbox';
    chkUse.checked = WIRE_DEFAULTS.useNetclass;
    const capUse = document.createElement('span');
    capUse.textContent = 'Use netclass defaults';
    rowUse.append(chkUse, capUse);
    box.appendChild(rowUse);

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
    inpW.value = formatDimForDisplay(initialNm);
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
        const nc = NET_CLASSES.default.wire;
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
        const nc = NET_CLASSES.default.wire;
        st = { width: nc.width, type: nc.type, color: nc.color };
      } else {
        st = WIRE_DEFAULTS.stroke;
      }
      // Width: show in the currently selected global units using nm internal representation when available
      const stNm = (st && (st as any).widthNm != null) ? (st as any).widthNm : unitToNm(st.width ?? 0, 'mm');
      inpW.value = formatDimForDisplay(stNm);
      // Style
      selS.value = (st.type || 'default') as string;
      // Color & opacity
      const hex = '#' + [st.color.r, st.color.g, st.color.b]
        .map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
      inpColor.value = hex;
      inpA.value = String(Math.max(0, Math.min(1, st.color.a ?? 1)));
    }

    function setEnabledStates(){
      const on = !WIRE_DEFAULTS.useNetclass;
      inpW.disabled = !on;
      selS.disabled = !on;
      inpColor.disabled = !on;
      inpA.disabled = !on;
    }

    // Wire up events
    chkUse.onchange = () => {
      WIRE_DEFAULTS.useNetclass = chkUse.checked;
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
      const parsed = parseDimInput(raw);
      if (!parsed) return;
      const mmVal = parsed.nm / NM_PER_MM;
      // update defaults using mm for backward compatibility, but keep widthNm for internal precision
      WIRE_DEFAULTS.stroke.width = mmVal;
      (WIRE_DEFAULTS.stroke as any).widthNm = parsed.nm;
      // If a positive width is typed, treat it as explicit/custom immediately
      if (mmVal > 0 && WIRE_DEFAULTS.useNetclass) {
        WIRE_DEFAULTS.useNetclass = false;
        if (WIRE_DEFAULTS.stroke.type === 'default') {
          WIRE_DEFAULTS.stroke.type = 'solid';
          selS.value = 'solid';
        }
        chkUse.checked = false;
        setEnabledStates();
      }
      mirrorDefaultsIntoLegacyColorMode();
      saveWireDefaults();
      syncWireToolbar();
      refreshPreview();
    };
    // Commit on blur/Enter: parse with optional suffix and normalize to nm/mm
    inpW.onchange = () => {
      const parsed = parseDimInput((inpW.value||'').trim());
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
      chkUse.checked = WIRE_DEFAULTS.useNetclass;
      mirrorDefaultsIntoLegacyColorMode();
      saveWireDefaults();
      syncWireToolbar();
      setEnabledStates();
      // Normalize and show the committed value in the current global units.
      inpW.value = formatDimForDisplay(nm);
      refreshPreview();
    };
    selS.onchange = () => {
      const val = selS.value as StrokeType;

      if (val === 'default') {
        // Now: only defer the LINE STYLE to the netclass. Do not change the checkbox,
        // width, or color. Width==0 still means "use netclass width" and is independent.
        WIRE_DEFAULTS.stroke.type = 'default';
      } else {
        WIRE_DEFAULTS.stroke.type = val;
        if ((WIRE_DEFAULTS.stroke.width || 0) <= 0) {
          WIRE_DEFAULTS.stroke.width = 0.25; // give it a sane visible width
        }
      }
      // Reflect checkbox + toolbar + preview instantly
      chkUse.checked = WIRE_DEFAULTS.useNetclass;
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
      : `${(WIRE_DEFAULTS.stroke.type||'default')} @ ${formatDimForDisplay((WIRE_DEFAULTS.stroke as any).widthNm != null ? (WIRE_DEFAULTS.stroke as any).widthNm : unitToNm(WIRE_DEFAULTS.stroke.width || 0, 'mm'))}`;
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
  document.getElementById('zoomInBtn').addEventListener('click', ()=>{ zoom = Math.min(8, zoom*1.25); applyZoom(); });
  document.getElementById('zoomOutBtn').addEventListener('click', ()=>{ zoom = Math.max(0.25, zoom/1.25); applyZoom(); });
  document.getElementById('zoomResetBtn').addEventListener('click', ()=>{ zoom = 1; applyZoom(); viewX=0; viewY=0; applyZoom(); });
  document.getElementById('zoomPct')!.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const raw = (input?.value || '').trim();
    const n = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
    if (!isFinite(n) || n <= 0) { updateZoomUI(); return; }
    zoom = clamp(n, 0.25, 8); applyZoom();
  });

  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

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
  var isPanning = false, panStartSvg = null, panStartView = null, panPointerId = null;
  function beginPan(e){
    isPanning = true;
    document.body.classList.add('panning');
    const p = svgPoint(e);
    panStartSvg = {x:p.x, y:p.y};
    panStartView = {x:viewX, y:viewY};
    panPointerId = e.pointerId;
    svg.setPointerCapture?.(panPointerId);
  }
  function doPan(e){
    if(!isPanning) return;
    const p = svgPoint(e);
    const dx = p.x - panStartSvg.x;
    const dy = p.y - panStartSvg.y;
    viewX = panStartView.x - dx;
    viewY = panStartView.y - dy;
    applyZoom();  // updates grid to fill viewport
  }
  function endPan(){
    if(!isPanning) return;
    isPanning = false;
    document.body.classList.remove('panning');
    if(panPointerId!=null) svg.releasePointerCapture?.(panPointerId);
    panPointerId = null;
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
    redraw();
  }

  // ====== Inspector ======
  // ====== Units & conversion helpers ======
  // Internal resolution: nanometers (integers). Display units: mm / in / mils
  // (NM_PER_* constants are declared near the top-level so they're available to all code.)

  // Global units state & persistence are declared at module top-level to avoid TDZ issues

  // px <-> nm helpers (PX_PER_MM is defined lower in the file; it's safe because these helpers are
  // used only after initialization completes at runtime).
  function pxToNm(px: number){ return Math.round(px * (NM_PER_MM / (PX_PER_MM || 4))); }
  function nmToPx(nm: number){ return (nm * (PX_PER_MM || 4)) / NM_PER_MM; }

  // Convert nm -> value in requested display unit (number)
  function nmToUnit(nm: number, u: 'mm'|'in'|'mils'){
    if(u==='mm') return nm / NM_PER_MM;
    if(u==='in') return nm / NM_PER_IN;
    return nm / NM_PER_MIL; // mils
  }
  // Convert value in unit -> nm
  function unitToNm(val: number, u: 'mm'|'in'|'mils'){
    if(u==='mm') return Math.round(val * NM_PER_MM);
    if(u==='in') return Math.round(val * NM_PER_IN);
    return Math.round(val * NM_PER_MIL);
  }

  // Parse a user-typed dimension like "1 mm", "0.0254 in", "39.37 mils" (case-insensitive)
  // Returns { nm, unitNormalized } or null if parse failed.
  function parseDimInput(str: string, assumeUnit: 'mm'|'in'|'mils' = globalUnits){
    if(!str) return null;
    const s = String(str).trim();
    const m = s.match(/^([0-9.+\-eE]+)\s*([a-zA-Z]*)$/);
    if(!m) return null;
    const n = parseFloat(m[1]); if(Number.isNaN(n)) return null;
    const suf = (m[2]||'').toLowerCase();
    if(!suf) return { nm: unitToNm(n, assumeUnit), unit: assumeUnit };
    if(suf==='mm') return { nm: unitToNm(n,'mm'), unit:'mm' };
    if(suf==='in' || suf==='inch' || suf==='inches') return { nm: unitToNm(n,'in'), unit:'in' };
    if(suf==='mil' || suf==='mils') return { nm: unitToNm(n,'mils'), unit:'mils' };
    // Unknown suffix: treat as assumeUnit
    return { nm: unitToNm(n, assumeUnit), unit: assumeUnit };
  }

  // Format an nm value for display in the currently selected global units.
  // Returns string like "12.34 mm" or "39.37 mils". For 'in' uses suffix 'in'.
  function formatDimForDisplay(nm: number){
    const u = globalUnits;
    const v = nmToUnit(nm, u);
    if(u==='mm') return `${(Math.round(v*100)/100).toFixed(2)} mm`;
    if(u==='in') return `${(Math.round(v*10000)/10000).toFixed(4)} in`;
    // mils
    return `${(Math.round(v*100)/100).toFixed(2)} mils`;
  }

  // Specialized input used for coordinates (x/y) that are stored in px internally.
  function dimNumberPx(pxVal: number, onCommit: (px:number)=>void){
    const inp = document.createElement('input'); inp.type = 'text';
    // display initial value converted to current units
    const nm = pxToNm(pxVal);
    inp.value = formatDimForDisplay(nm);
    // commit on blur or Enter
    function commitFromStr(str: string){
      const parsed = parseDimInput(str);
      if(!parsed) return; // ignore invalid
      const px = Math.round(nmToPx(parsed.nm));
      onCommit(px);
      // refresh displayed (normalize units & formatting)
      inp.value = formatDimForDisplay(parsed.nm);
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

  // Insert a simple Units selector into the header (shows current units; opens dropdown)
  (function installUnitsButton(){
    const header = document.querySelector('header'); if(!header) return;
    const modeGroup = document.getElementById('modeGroup');
    const grp = document.createElement('div'); grp.className = 'group'; grp.style.marginLeft = '8px';
    grp.style.position = 'relative'; // anchor for absolute dropdown
    const btn = document.createElement('button'); btn.id = 'unitsBtn'; btn.title = 'Display units'; btn.textContent = (globalUnits === 'mm') ? 'mm' : (globalUnits==='in'? 'in' : 'mils');
    const menu = document.createElement('div'); menu.id = 'unitsMenu';
    // Always open downward: anchor at top:100% (below the header group)
    menu.style.position='absolute'; menu.style.top='calc(100% + 6px)'; menu.style.left='0'; menu.style.bottom='auto';
    menu.style.display='none'; menu.style.background='#0e1219'; menu.style.border='1px solid #273042'; menu.style.padding='6px'; menu.style.borderRadius='8px'; menu.style.zIndex = '1000';
    menu.style.maxHeight = '50vh'; menu.style.overflow = 'auto';
    ['mm','in','mils'].forEach(u=>{
      const b = document.createElement('button'); b.style.display='block'; b.style.width='100%'; b.textContent = u;
      b.addEventListener('click', ()=>{ setGlobalUnits(u as any); btn.textContent = (u==='mm')? 'mm' : (u==='in' ? 'in' : 'mils'); menu.style.display='none'; });
      menu.appendChild(b);
    });
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); menu.style.display = menu.style.display==='none' ? 'block' : 'none'; });
    document.addEventListener('click', ()=>{ menu.style.display='none'; });
    grp.appendChild(btn); grp.appendChild(menu);
  // Insert the units group into the modeGroup so it sits immediately after the Mode buttons
  if(modeGroup) modeGroup.appendChild(grp);
  else header.appendChild(grp);
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

      wrap.appendChild(rowPair('Label', input(c.label, v=>{ c.label=v; redrawCanvasOnly(); } )));

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
        valInput.oninput = ()=>{ c.value = valInput.value; redrawCanvasOnly(); };
        // unit select (uses symbols, e.g., kΩ, µF, mH)
        const sel = unitSelect(typeKey, (c.props.unit) || defaultUnit(typeKey), (u)=>{
          c.props.unit = u; redrawCanvasOnly();
        });
        container.appendChild(valInput);
        container.appendChild(sel);
        wrap.appendChild(rowPair('Value', container));
      } else if (c.type==='diode'){
        // Value (optional text) for diode
        wrap.appendChild(rowPair('Value', input(c.value||'', v=>{ c.value=v; redrawCanvasOnly(); } )));
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
        wrap.appendChild(rowPair('Voltage (V)', number(c.props.voltage ?? 0, v=>{ c.props.voltage=v; redrawCanvasOnly(); } )));
      }
      // position + rotation (X/Y are shown in selected units; internal positions are px)
      wrap.appendChild(rowPair('X', dimNumberPx(c.x, v=>{ c.x = snap(v); redrawCanvasOnly(); } )));
      wrap.appendChild(rowPair('Y', dimNumberPx(c.y, v=>{ c.y = snap(v); redrawCanvasOnly(); } )));
      wrap.appendChild(rowPair('Rotation', number(c.rot, v=>{ c.rot = (Math.round(v/90)*90)%360; redrawCanvasOnly(); } )));

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
        wrap.appendChild(rowPair('Wire Start', text(`${formatDimForDisplay(pxToNm(A.x))}, ${formatDimForDisplay(pxToNm(A.y))}`, true)));
        wrap.appendChild(rowPair('Wire End',   text(`${formatDimForDisplay(pxToNm(B.x))}, ${formatDimForDisplay(pxToNm(B.y))}`, true)));
      } else if (swp) {
        wrap.appendChild(rowPair('Wire Start', text(`${formatDimForDisplay(pxToNm(swp.start.x))}, ${formatDimForDisplay(pxToNm(swp.start.y))}`, true)));
        wrap.appendChild(rowPair('Wire End',   text(`${formatDimForDisplay(pxToNm(swp.end.x))}, ${formatDimForDisplay(pxToNm(swp.end.y))}`, true)));
      } else {
        const A = w.points[0], B = w.points[w.points.length-1];
        wrap.appendChild(rowPair('Wire Start', text(`${formatDimForDisplay(pxToNm(A.x))}, ${formatDimForDisplay(pxToNm(A.y))}`, true)));
        wrap.appendChild(rowPair('Wire End',   text(`${formatDimForDisplay(pxToNm(B.x))}, ${formatDimForDisplay(pxToNm(B.y))}`, true)));
      }

      // ---- Wire Stroke (KiCad-style) ----
      (function(){
        ensureStroke(w);
        const holder = document.createElement('div');

        // Use netclass defaults toggle
        const useNCRow = document.createElement('div'); useNCRow.className='row';
        const useNCLabel = document.createElement('label'); useNCLabel.textContent = 'Use netclass defaults';
        useNCLabel.style.width = '90px';
        const useNC = document.createElement('input'); useNC.type='checkbox';
        const isUsingNC = () => { ensureStroke(w); return (w.stroke!.type === 'default' && w.stroke!.width <= 0); };
        useNC.checked = isUsingNC();
        useNC.onchange = () => {
          ensureStroke(w);
          // Selected wire is the target segment itself (per-segment wires).
          const mid = (w.points && w.points.length >= 2) ? midOfSeg(w.points, 0) : null;
              if (useNC.checked) {
                // Delegate styling to netclass/theme
                const patch: Partial<Stroke> = { width: 0, type: 'default' };
                // If a specific segment is selected, isolate it and apply only to that segment
                // The selected `wire` represents the segment; operate on it directly.
                if (w.points && w.points.length === 2) {
                  ensureStroke(w);
                  w.stroke = { ...(w.stroke as Stroke), ...patch };
                  w.color = rgba01ToCss((w.stroke as Stroke).color);
                  updateWireDOM(w); redrawCanvasOnly();
                  selection = { kind: 'wire', id: w.id, segIndex: null };
                } else if (swp) {
                  restrokeSwpSegments(swp, patch);
                  if (mid) reselectNearestAt(mid); else redraw();
                } else {
                  w.stroke = { ...(w.stroke as Stroke), ...patch };
                  updateWireDOM(w); redrawCanvasOnly();
                }
              } else {
                // Start from the current effective stroke so the user gets editable defaults
                const eff = strokeOfWire(w); // your effective stroke getter used for preview
                const patch: Partial<Stroke> = {
                  width: Math.max(0.05, eff.width || 0.25),
                  type: (eff.type === 'default' ? 'solid' : eff.type) || 'solid',
                  color: eff.color
                };
                if (w.points && w.points.length === 2) {
                  ensureStroke(w);
                  w.stroke = { ...(w.stroke as Stroke), ...patch };
                  w.color = rgba01ToCss((w.stroke as Stroke).color);
                  updateWireDOM(w); redrawCanvasOnly();
                  selection = { kind: 'wire', id: w.id, segIndex: null };
                } else if (swp) {
                  restrokeSwpSegments(swp, patch);
                  if (mid) reselectNearestAt(mid); else redraw();
                } else {
                  w.stroke = { ...(w.stroke as Stroke), ...patch };
                  w.color = rgba01ToCss((w.stroke as Stroke).color);
                  updateWireDOM(w); redrawCanvasOnly();
                }
              }
          // Keep the controls and preview in sync without forcing a full rebuild.
          syncWidth(); syncStyle(); syncColor(); syncPreview();
        };
        useNCRow.appendChild(useNCLabel); useNCRow.appendChild(useNC);
        holder.appendChild(useNCRow);

        // Width (in selected units)
        const widthRow = document.createElement('div'); widthRow.className='row';
        const wLbl = document.createElement('label'); wLbl.textContent = `Width (${globalUnits})`; wLbl.style.width='90px';
        const wIn = document.createElement('input'); wIn.type='text'; wIn.step = '0.05';
        const syncWidth = ()=>{
          const eff = effectiveStroke(w, netClassForWire(w), THEME);
          const effNm = Math.round((eff.width || 0) * NM_PER_MM);
          wIn.value = formatDimForDisplay(effNm);
          wIn.disabled = isUsingNC();
        };
        // Live, non-destructive width updates while typing so the inspector DOM
        // isn't rebuilt on every keystroke. The final onchange will perform any
        // SWP-wide restroke and normalization.
        wIn.oninput = () => {
          try {
            const parsed = parseDimInput(wIn.value || '0');
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
          ensureStroke(w);
          const parsed = parseDimInput(wIn.value || '0');
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
          wIn.value = formatDimForDisplay(nm);
        };
        widthRow.appendChild(wLbl); widthRow.appendChild(wIn); holder.appendChild(widthRow);

        // Line style
        const styleRow = document.createElement('div'); styleRow.className='row';
        const sLbl = document.createElement('label'); sLbl.textContent='Line style'; sLbl.style.width='90px';
        const sSel = document.createElement('select');
        ['default','solid','dash','dot','dash_dot','dash_dot_dot'].forEach(v=>{
          const o=document.createElement('option'); o.value=v; o.textContent=v.replace(/_/g,'·'); sSel.appendChild(o);
        });
        const syncStyle = ()=>{ const eff = effectiveStroke(w, netClassForWire(w), THEME); sSel.value = (isUsingNC() ? 'default' : w.stroke!.type); sSel.disabled = isUsingNC(); };
        sSel.onchange = () => {
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

        const aIn = document.createElement('input');
        aIn.type = 'range';
        aIn.min = '0';
        aIn.max = '1';
        aIn.step = '0.05';
        // keep compact so it fits in the inspector width
        aIn.style.flex = '0 0 120px';
        aIn.style.maxWidth = '140px';

        const syncColor = () => {
          const eff = effectiveStroke(w, netClassForWire(w), THEME);
          // convert current effective RGBA(0..1) → #RRGGBB for the color input
          const rgbCss = `rgba(${Math.round(eff.color.r*255)},${Math.round(eff.color.g*255)},${Math.round(eff.color.b*255)},${eff.color.a})`;
          const hex = colorToHex(rgbCss);
          cIn.value = hex;
          aIn.value = String(Math.max(0, Math.min(1, eff.color.a)));
          const disabled = isUsingNC();
          cIn.disabled = disabled;
          aIn.disabled = disabled;
        };

        function onColorCommit() {
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

        cIn.oninput = liveApplyColor;
        aIn.oninput = liveApplyColor;
        // Finalize (apply across SWP if present) when the picker is closed or change is committed
        cIn.onchange = onColorCommit;
        aIn.onchange = onColorCommit;

        colorRow.appendChild(cLbl);
        colorRow.appendChild(cIn);
        colorRow.appendChild(aIn);
        holder.appendChild(colorRow);

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
          pLine.setAttribute('stroke', rgba01ToCss(eff.color));
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
    const pins = compPinPositions(c).map(p=>({x:snap(p.x),y:snap(p.y)}));
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
      const pins = compPinPositions(c).map(p=>({x:snap(p.x),y:snap(p.y)}));
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
    let changed = false;

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
      let left, right;                         // "left" == left/top piece, per your rule
      if(a.axis==='x'){
        // Decide which piece is to the left of the join
        const aLeft = Math.min(a.other.x, kx) < kx;
        const bLeft = Math.min(b.other.x, kx) < kx;
        if(aLeft && !bLeft){ left=a; right=b; }
        else if(bLeft && !aLeft){ left=b; right=a; }
        else {
          const minxA = Math.min(...a.w.points.map(p => p.x));
          const minxB = Math.min(...b.w.points.map(p => p.x));
          left  = (minxA <= minxB) ? a : b;
          right = (left === a) ? b : a;
        }
      } else { // 'y'
        const aTop = Math.min(a.other.y, ky) < ky;
        const bTop = Math.min(b.other.y, ky) < ky;
        if(aTop && !bTop){ left=a; right=b; }
        else if(bTop && !aTop){ left=b; right=a; }
        else {
          const minyA = Math.min(...a.w.points.map(p=>p.y));
          const minyB = Math.min(...b.w.points.map(p=>p.y));
          left = (minyA <= minyB) ? a : b; right = (left===a) ? b : a;
        }
      }

      // Orient left piece so it ENDS at the join, right piece so it STARTS at the join
      const lp = left.w.points.slice();
      const rp = right.w.points.slice();
      const lPts = (left.endIndex === lp.length-1) ? lp : lp.reverse();
      const rPts = (right.endIndex === 0) ? rp : rp.reverse();

      const mergedPts = lPts.concat(rPts.slice(1));  // drop duplicate join point
      const merged = normalizedPolylineOrNull(mergedPts);
      if(!merged) continue;

      // Adopt left/top wire's stroke (and keep legacy color in sync)
      ensureStroke(left.w);
      const newStroke = strokeOfWire(left.w);
      const newColor = rgba01ToCss(newStroke.color);

      // Replace
      wires = wires.filter(w => w !== left.w && w !== right.w);
      wires.push({ id: uid('wire'), points: merged, color: newColor, stroke: newStroke, netId: left.w.netId || 'default' });

      changed = true;
      break; // wires changed; stop this pass and recurse
    }
    if(changed){
      normalizeAllWires();
      // Re-run until no merges remain
      return unifyInlineWires() || true;
    }
    return false;
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

  // Parse any CSS color to [0..1] RGBA
  function cssToRGBA01(cstr: string): RGBA01 {
    // Use a temp element to canonicalize the color, then parse computed rgb/rgba(...)
    const tmp = document.createElement('span');
    tmp.style.color = cstr;
    document.body.appendChild(tmp);
    const rgb = getComputedStyle(tmp).color; // "rgb(r,g,b)" or "rgba(r,g,b,a)"
    document.body.removeChild(tmp);
    const m = rgb.match(/[\d.]+/g) || ['0','0','0','1'];
    const r = Math.max(0, Math.min(255, parseFloat(m[0] || '0'))) / 255;
    const g = Math.max(0, Math.min(255, parseFloat(m[1] || '0'))) / 255;
    const b = Math.max(0, Math.min(255, parseFloat(m[2] || '0'))) / 255;
    const a = Math.max(0, Math.min(1,   parseFloat(m[3] || '1')));
    return { r, g, b, a };
  }

  // Convert 0..1 RGBA to css rgba(r,g,b,a)
  function rgba01ToCss(c: RGBA01): string {
    const r = Math.round(c.r * 255);
    const g = Math.round(c.g * 255);
    const b = Math.round(c.b * 255);
    const a = Math.max(0, Math.min(1, c.a));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

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

  // px rendering helpers (keep visuals stable; 0.25 mm ≈ 1 px on canvas)
  const PX_PER_MM = 4;  // 1 mm → 4 px; 0.25 mm → 1 px
  const mmToPx = (mm: number) => Math.max(1, Math.round(Math.max(0, mm) * PX_PER_MM));

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
    return from(from(sTH, sNC), sWire);
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
      junctions
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
    selection={kind:null, id:null, segIndex:null}; redraw();
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
  // start at 1:1
  applyZoom();
  redraw();
})();