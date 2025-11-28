// inspector.ts - Inspector panel rendering and property editors
// Handles component and wire property editing in the inspector panel

import type {
  Component, Wire, Selection, Point, Stroke, RGBA01, NetClass, Theme,
  ResistorStyle, CapacitorSubtype, DiodeSubtype
} from './types.js';
import type { SWP } from './topology.js';
import { nmToUnit, unitToNm } from './conversions.js';

// Helper to create a row with label and control
export function rowPair(lbl: string, control: HTMLElement): HTMLDivElement {
  const d1 = document.createElement('div');
  d1.className = 'row';
  const l = document.createElement('label');
  l.textContent = lbl;
  l.style.width = '90px';
  d1.appendChild(l);
  d1.appendChild(control);
  return d1;
}

// Helper to create a text input
export function input(val: string, on: (v: string) => void): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = val;
  i.oninput = () => on(i.value);
  return i;
}

// Helper to create a number input
export function number(val: number, on: (v: number) => void): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.value = String(val);
  i.oninput = () => on(parseFloat(i.value) || 0);
  return i;
}

// Helper to create a read-only text input
export function text(val: string, readonly: boolean = false): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = val;
  i.readOnly = readonly;
  return i;
}

// Helper to create a unit selector (resistor, capacitor, inductor)
export function unitSelect(
  kind: 'resistor' | 'capacitor' | 'inductor',
  current: string,
  onChange: (unit: string) => void,
  UNIT_OPTIONS: Record<string, string[]>,
  defaultUnit: (kind: 'resistor' | 'capacitor' | 'inductor') => string
): HTMLSelectElement {
  const sel = document.createElement('select');
  (UNIT_OPTIONS[kind] || []).forEach(u => {
    const opt = document.createElement('option');
    opt.value = u;
    opt.textContent = u;
    sel.appendChild(opt);
  });
  sel.value = current || defaultUnit(kind);
  sel.onchange = () => onChange(sel.value);
  return sel;
}

// Helper to fit inspector unit selects to their content
export function fitInspectorUnitSelects(inspector: HTMLElement): void {
  const sels = inspector.querySelectorAll('.hstack select');
  sels.forEach((s) => sizeUnitSelectToContent(s as HTMLSelectElement));
}

// Helper to size a unit select to its content
export function sizeUnitSelectToContent(sel: HTMLSelectElement): void {
  const row = sel.closest('.hstack');
  if (!row) return;
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

// Helper to get default unit for component type
export function defaultUnit(kind: 'resistor' | 'capacitor' | 'inductor'): string {
  if (kind === 'resistor') return '\u03A9'; // Ω
  if (kind === 'capacitor') return 'F';
  if (kind === 'inductor') return 'H';
  return '';
}

// Helper to create a dimension input (displays in user units, stores in px)
export function dimNumberPx(
  pxVal: number,
  onCommit: (px: number) => void,
  pxToNm: (px: number) => number,
  nmToPx: (nm: number) => number,
  formatDimForDisplay: (nm: number, units: 'mm' | 'in' | 'mils') => string,
  parseDimInput: (str: string) => { nm: number } | null,
  globalUnits: 'mm' | 'in' | 'mils'
): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'text';
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
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commitFromStr(inp.value);
      inp.blur();
    }
  });
  return inp;
}

// Context for inspector rendering - contains all dependencies
export interface InspectorContext {
  // State
  components: Component[];
  wires: Wire[];
  junctions: any[];
  selection: Selection;
  nets: Set<string>;
  activeNetClass: string;
  globalUnits: 'mm' | 'in' | 'mils';
  defaultResistorStyle: ResistorStyle;
  junctionDotSize: 'smallest' | 'small' | 'default' | 'large' | 'largest';
  NET_CLASSES: Record<string, NetClass>;
  THEME: Theme;
  NM_PER_MM: number;
  UNIT_OPTIONS: Record<string, string[]>;

  // Functions - state mutation
  pushUndo: () => void;
  redrawCanvasOnly: () => void;
  redraw: () => void;
  renderNetList: () => void;
  renderInspector: () => void;
  uid: (prefix: string) => string;

  // Functions - component operations
  compPinPositions: (c: Component) => Point[];
  snap: (val: number) => number;
  snapToBaseScalar: (val: number) => number;

  // Functions - wire operations
  swpForWireSegment: (wireId: string, segIndex: number) => SWP | null;
  ensureStroke: (w: Wire) => void;
  effectiveStroke: (w: Wire, nc: NetClass, th: Theme) => Stroke;
  netClassForWire: (w: Wire) => NetClass;
  updateWireDOM: (w: Wire) => void;
  restrokeSwpSegments: (swp: SWP | null, patch: Partial<Stroke>) => void;
  midOfSeg: (pts: Point[], idx: number) => Point;
  reselectNearestAt: (p: Point) => void;
  normalizeAllWires: () => void;
  rebuildTopology: () => void;
  wiresEndingAt: (pt: Point) => Wire[];
  selecting: (kind: 'component' | 'wire' | null, id: string | null, segIndex: number | null) => void;

  // Functions - conversion utilities
  pxToNm: (px: number) => number;
  nmToPx: (nm: number) => number;
  mmToPx: (mm: number) => number;
  formatDimForDisplay: (nm: number, units: 'mm' | 'in' | 'mils') => string;
  parseDimInput: (str: string) => { nm: number } | null;
  rgba01ToCss: (c: RGBA01) => string;
  colorToHex: (css: string) => string;
  dashArrayFor: (type: string) => string | null;
  setAttrs: (el: SVGElement, attrs: Record<string, any>) => void;
}

// Main function to render the inspector panel
export function renderInspector(ctx: InspectorContext, inspector: HTMLElement, inspectorNone: HTMLElement): void {
  inspector.replaceChildren();

  // COMPONENT INSPECTOR
  if (ctx.selection.kind === 'component') {
    const c = ctx.components.find(x => x.id === ctx.selection.id);
    inspectorNone.style.display = c ? 'none' : 'block';
    if (!c) return;
    const wrap = document.createElement('div');

    wrap.appendChild(rowPair('ID', text(c.id, true)));
    wrap.appendChild(rowPair('Type', text(c.type, true)));

    wrap.appendChild(rowPair('Label', input(c.label, v => {
      ctx.pushUndo();
      c.label = v;
      ctx.redrawCanvasOnly();
    })));

    // value field for generic components
    const showValue = ['resistor', 'capacitor', 'inductor', 'diode'].includes(c.type);
    // Value + Unit (inline) for R, C, L. (Diode keeps a simple Value field if desired.)
    if (c.type === 'resistor' || c.type === 'capacitor' || c.type === 'inductor') {
      if (!c.props) c.props = {};
      const typeKey = c.type;
      const container = document.createElement('div');
      container.className = 'hstack';
      // numeric / text value
      const valInput = document.createElement('input');
      valInput.type = 'text';
      valInput.value = c.value || '';
      valInput.oninput = () => {
        ctx.pushUndo();
        c.value = valInput.value;
        ctx.redrawCanvasOnly();
      };
      // unit select (uses symbols, e.g., kΩ, µF, mH)
      const sel = unitSelect(typeKey, (c.props.unit) || defaultUnit(typeKey), (u) => {
        ctx.pushUndo();
        c.props!.unit = u;
        ctx.redrawCanvasOnly();
      }, ctx.UNIT_OPTIONS, defaultUnit);
      container.appendChild(valInput);
      container.appendChild(sel);
      wrap.appendChild(rowPair('Value', container));

      // Resistor style selector (only for resistors)
      if (c.type === 'resistor') {
        const styleSel = document.createElement('select');
        const ansiOpt = document.createElement('option');
        ansiOpt.value = 'ansi';
        ansiOpt.textContent = 'ANSI/IEEE (US)';
        const iecOpt = document.createElement('option');
        iecOpt.value = 'iec';
        iecOpt.textContent = 'IEC (International)';
        styleSel.appendChild(ansiOpt);
        styleSel.appendChild(iecOpt);
        styleSel.value = c.props.resistorStyle || ctx.defaultResistorStyle;
        styleSel.onchange = () => {
          ctx.pushUndo();
          if (!c.props) c.props = {};
          c.props.resistorStyle = styleSel.value as ResistorStyle;
          ctx.redrawCanvasOnly();
        };
        wrap.appendChild(rowPair('Standard', styleSel));
      }

      // Capacitor subtype and style selectors (only for capacitors)
      if (c.type === 'capacitor') {
        const subSel = document.createElement('select');
        const stdOpt = document.createElement('option');
        stdOpt.value = 'standard';
        stdOpt.textContent = 'Standard';
        const polOpt = document.createElement('option');
        polOpt.value = 'polarized';
        polOpt.textContent = 'Polarized';
        subSel.appendChild(stdOpt);
        subSel.appendChild(polOpt);
        subSel.value = c.props.capacitorSubtype || 'standard';
        subSel.onchange = () => {
          ctx.pushUndo();
          if (!c.props) c.props = {};
          c.props.capacitorSubtype = subSel.value as CapacitorSubtype;
          if (subSel.value === 'polarized' && !c.props.capacitorStyle) {
            c.props.capacitorStyle = ctx.defaultResistorStyle;
          }
          ctx.redrawCanvasOnly();
          ctx.renderInspector(); // Refresh inspector to show/hide Standard selector
        };
        wrap.appendChild(rowPair('Subtype', subSel));

        // Style selector for polarized capacitors
        if (c.props.capacitorSubtype === 'polarized') {
          const styleSel = document.createElement('select');
          const ansiOpt = document.createElement('option');
          ansiOpt.value = 'ansi';
          ansiOpt.textContent = 'ANSI/IEEE (US)';
          const iecOpt = document.createElement('option');
          iecOpt.value = 'iec';
          iecOpt.textContent = 'IEC (International)';
          styleSel.appendChild(ansiOpt);
          styleSel.appendChild(iecOpt);
          styleSel.value = c.props.capacitorStyle || ctx.defaultResistorStyle;
          styleSel.onchange = () => {
            ctx.pushUndo();
            if (!c.props) c.props = {};
            c.props.capacitorStyle = styleSel.value as ResistorStyle;
            ctx.redrawCanvasOnly();
          };
          wrap.appendChild(rowPair('Standard', styleSel));
        }
      }
    } else if (c.type === 'diode') {
      // Value (optional text) for diode
      wrap.appendChild(rowPair('Value', input(c.value || '', v => {
        ctx.pushUndo();
        c.value = v;
        ctx.redrawCanvasOnly();
      })));
      // Subtype (editable)
      const subSel = document.createElement('select');
      ['generic', 'schottky', 'zener', 'led', 'photo', 'tunnel', 'varactor', 'laser'].forEach(v => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = ({
          generic: 'Generic', schottky: 'Schottky', zener: 'Zener',
          led: 'Light-emitting (LED)', photo: 'Photo', tunnel: 'Tunnel',
          varactor: 'Varactor / Varicap', laser: 'Laser'
        })[v];
        subSel.appendChild(o);
      });
      subSel.value = (c.props && c.props.subtype) ? c.props.subtype : 'generic';
      subSel.onchange = () => {
        ctx.pushUndo();
        if (!c.props) c.props = {};
        (c.props as Component['props']).subtype = subSel.value as DiodeSubtype;
        ctx.redrawCanvasOnly();
      };
      wrap.appendChild(rowPair('Subtype', subSel));
    }

    // voltage for DC battery & AC source
    if (c.type === 'battery' || c.type === 'ac') {
      if (!c.props) c.props = {};
      wrap.appendChild(rowPair('Voltage (V)', number(c.props.voltage ?? 0, v => {
        ctx.pushUndo();
        c.props!.voltage = v;
        ctx.redrawCanvasOnly();
      })));
    }

    // position + rotation (X/Y are shown in selected units; internal positions are px)
    wrap.appendChild(rowPair('X', dimNumberPx(c.x, v => {
      ctx.pushUndo();
      c.x = ctx.snap(v);
      ctx.redrawCanvasOnly();
    }, ctx.pxToNm, ctx.nmToPx, ctx.formatDimForDisplay, ctx.parseDimInput, ctx.globalUnits)));
    wrap.appendChild(rowPair('Y', dimNumberPx(c.y, v => {
      ctx.pushUndo();
      c.y = ctx.snap(v);
      ctx.redrawCanvasOnly();
    }, ctx.pxToNm, ctx.nmToPx, ctx.formatDimForDisplay, ctx.parseDimInput, ctx.globalUnits)));
    wrap.appendChild(rowPair('Rotation', number(c.rot, v => {
      ctx.pushUndo();
      c.rot = (Math.round(v / 90) * 90) % 360;
      ctx.redrawCanvasOnly();
    })));

    inspector.appendChild(wrap);
    // After the DOM is in place, size any Value/Units selects to their content (capped at 50%)
    fitInspectorUnitSelects(inspector);
    return;
  }

  // LABEL TEXT INSPECTOR
  if (ctx.selection.kind === 'label') {
    const c = ctx.components.find(x => x.id === ctx.selection.id);
    inspectorNone.style.display = c ? 'none' : 'block';
    if (!c) return;
    const wrap = document.createElement('div');

    wrap.appendChild(rowPair('Component', text(c.id, true)));
    wrap.appendChild(rowPair('Label Text', input(c.label, v => {
      ctx.pushUndo();
      c.label = v;
      ctx.redrawCanvasOnly();
    })));
    
    // Calculate global position from offsets
    // Start with default label position in local space
    let labelLocalX = c.x;
    let labelLocalY = c.y + 46;
    if (c.type === 'npn' || c.type === 'pnp') {
      labelLocalX = c.x + 60;
      labelLocalY = c.y;
    }
    // Add user offsets
    labelLocalX += (c.labelOffsetX || 0);
    labelLocalY += (c.labelOffsetY || 0);
    
    // Rotate to get global position (labels are counter-rotated in rendering)
    // So we don't rotate them - they stay at their local position
    const labelGlobalX = labelLocalX;
    const labelGlobalY = labelLocalY;
    
    // Convert to current units for display
    const labelGlobalXNm = ctx.pxToNm(labelGlobalX);
    const labelGlobalYNm = ctx.pxToNm(labelGlobalY);
    const labelGlobalXDisplay = nmToUnit(labelGlobalXNm, ctx.globalUnits);
    const labelGlobalYDisplay = nmToUnit(labelGlobalYNm, ctx.globalUnits);
    
    // Determine precision based on units
    let precision = 2;
    if (ctx.globalUnits === 'mils') precision = 0;
    if (ctx.globalUnits === 'in') precision = 4;
    
    wrap.appendChild(rowPair(`X (${ctx.globalUnits})`, number(parseFloat(labelGlobalXDisplay.toFixed(precision)), v => {
      ctx.pushUndo();
      // Convert from current units to px global position
      const nmValue = unitToNm(v, ctx.globalUnits);
      const globalX = ctx.nmToPx(nmValue);
      
      // Calculate default position
      let defaultX = c.x;
      if (c.type === 'npn' || c.type === 'pnp') {
        defaultX = c.x + 60;
      }
      
      // Calculate offset
      c.labelOffsetX = globalX - defaultX;
      ctx.redrawCanvasOnly();
    })));
    
    wrap.appendChild(rowPair(`Y (${ctx.globalUnits})`, number(parseFloat(labelGlobalYDisplay.toFixed(precision)), v => {
      ctx.pushUndo();
      // Convert from current units to px global position
      const nmValue = unitToNm(v, ctx.globalUnits);
      const globalY = ctx.nmToPx(nmValue);
      
      // Calculate default position
      let defaultY = c.y + 46;
      if (c.type === 'npn' || c.type === 'pnp') {
        defaultY = c.y;
      }
      
      // Calculate offset
      c.labelOffsetY = globalY - defaultY;
      ctx.redrawCanvasOnly();
    })));
    
    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset Position';
    resetBtn.onclick = () => {
      ctx.pushUndo();
      c.labelOffsetX = 0;
      c.labelOffsetY = 0;
      ctx.redrawCanvasOnly();
      ctx.renderInspector();
    };
    wrap.appendChild(resetBtn);

    inspector.appendChild(wrap);
    return;
  }

  // VALUE TEXT INSPECTOR
  if (ctx.selection.kind === 'value') {
    const c = ctx.components.find(x => x.id === ctx.selection.id);
    inspectorNone.style.display = c ? 'none' : 'block';
    if (!c) return;
    const wrap = document.createElement('div');

    wrap.appendChild(rowPair('Component', text(c.id, true)));
    wrap.appendChild(rowPair('Value Text', input(c.value || '', v => {
      ctx.pushUndo();
      c.value = v;
      ctx.redrawCanvasOnly();
    })));
    
    // Calculate global position from offsets
    // Value default position is independent of label
    let valueLocalX = c.x;
    let valueLocalY = c.y + 62;
    if (c.type === 'npn' || c.type === 'pnp') {
      valueLocalX = c.x + 60;
      valueLocalY = c.y + 16;
    }
    valueLocalX += (c.valueOffsetX || 0);
    valueLocalY += (c.valueOffsetY || 0);
    
    // Values don't rotate (counter-rotated in rendering)
    const valueGlobalX = valueLocalX;
    const valueGlobalY = valueLocalY;
    
    // Convert to current units for display
    const valueGlobalXNm = ctx.pxToNm(valueGlobalX);
    const valueGlobalYNm = ctx.pxToNm(valueGlobalY);
    const valueGlobalXDisplay = nmToUnit(valueGlobalXNm, ctx.globalUnits);
    const valueGlobalYDisplay = nmToUnit(valueGlobalYNm, ctx.globalUnits);
    
    // Determine precision based on units
    let precision = 2;
    if (ctx.globalUnits === 'mils') precision = 0;
    if (ctx.globalUnits === 'in') precision = 4;
    
    wrap.appendChild(rowPair(`X (${ctx.globalUnits})`, number(parseFloat(valueGlobalXDisplay.toFixed(precision)), v => {
      ctx.pushUndo();
      // Convert from current units to px global position
      const nmValue = unitToNm(v, ctx.globalUnits);
      const globalX = ctx.nmToPx(nmValue);
      
      // Calculate default value position (independent of label)
      let defaultValueX = c.x;
      if (c.type === 'npn' || c.type === 'pnp') {
        defaultValueX = c.x + 60;
      }
      
      // Calculate offset
      c.valueOffsetX = globalX - defaultValueX;
      ctx.redrawCanvasOnly();
    })));
    
    wrap.appendChild(rowPair(`Y (${ctx.globalUnits})`, number(parseFloat(valueGlobalYDisplay.toFixed(precision)), v => {
      ctx.pushUndo();
      // Convert from current units to px global position
      const nmValue = unitToNm(v, ctx.globalUnits);
      const globalY = ctx.nmToPx(nmValue);
      
      // Calculate default value position (independent of label)
      let defaultValueY = c.y + 62;
      if (c.type === 'npn' || c.type === 'pnp') {
        defaultValueY = c.y + 16;
      }
      
      // Calculate offset
      c.valueOffsetY = globalY - defaultValueY;
      ctx.redrawCanvasOnly();
    })));
    
    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset Position';
    resetBtn.onclick = () => {
      ctx.pushUndo();
      c.valueOffsetX = 0;
      c.valueOffsetY = 0;
      ctx.redrawCanvasOnly();
      ctx.renderInspector();
    };
    wrap.appendChild(resetBtn);

    inspector.appendChild(wrap);
    return;
  }

  // JUNCTION INSPECTOR
  if (ctx.selection.kind === 'junction') {
    const jId = ctx.selection.id;
    const j = ctx.junctions.find(j => j.id === jId);
    inspectorNone.style.display = j ? 'none' : 'block';
    if (!j) return;
    
    const wrap = document.createElement('div');
    wrap.appendChild(rowPair('Type', text(j.manual ? 'Manual Junction' : 'Auto Junction', true)));
    
    // Position (read-only)
    const xNm = ctx.pxToNm(j.at.x);
    const yNm = ctx.pxToNm(j.at.y);
    const xDisplay = nmToUnit(xNm, ctx.globalUnits);
    const yDisplay = nmToUnit(yNm, ctx.globalUnits);
    let precision = 2;
    if (ctx.globalUnits === 'mils') precision = 0;
    if (ctx.globalUnits === 'in') precision = 4;
    
    wrap.appendChild(rowPair(`X (${ctx.globalUnits})`, text(xDisplay.toFixed(precision), true)));
    wrap.appendChild(rowPair(`Y (${ctx.globalUnits})`, text(yDisplay.toFixed(precision), true)));
    
    // Size (diameter in current units)
    const sizeRow = document.createElement('div');
    sizeRow.className = 'row';
    const sizeLbl = document.createElement('label');
    sizeLbl.textContent = `Size (${ctx.globalUnits})`;
    sizeLbl.style.width = '90px';
    const sizeIn = document.createElement('input');
    sizeIn.type = 'text';
    
    // Get current size (from junction override or global default)
    const currentSizeMils = j.size || (ctx.junctionDotSize === 'smallest' ? 15 : 
                                       ctx.junctionDotSize === 'small' ? 30 : 
                                       ctx.junctionDotSize === 'default' ? 40 : 
                                       ctx.junctionDotSize === 'large' ? 50 : 65);
    // Convert mils to nm: 1 mil = 0.0254 mm, so mils * 0.0254 * NM_PER_MM
    const currentSizeNm = currentSizeMils * 0.0254 * ctx.NM_PER_MM;
    sizeIn.value = ctx.formatDimForDisplay(currentSizeNm, ctx.globalUnits);
    
    sizeIn.onchange = () => {
      ctx.pushUndo();
      const parsed = ctx.parseDimInput(sizeIn.value || '0');
      if (parsed) {
        // Convert nm to mils: nm / (0.0254 * NM_PER_MM)
        const sizeMils = parsed.nm / (0.0254 * ctx.NM_PER_MM);
        j.size = sizeMils;
        ctx.redrawCanvasOnly();
        ctx.renderInspector();
      }
    };
    
    sizeRow.appendChild(sizeLbl);
    sizeRow.appendChild(sizeIn);
    wrap.appendChild(sizeRow);
    
    // Color picker with opacity and swatches
    const colorRow = document.createElement('div');
    colorRow.className = 'row hstack';
    const colorLbl = document.createElement('label');
    colorLbl.textContent = 'Color';
    colorLbl.style.width = '90px';
    
    const colorIn = document.createElement('input');
    colorIn.type = 'color';
    colorIn.title = 'Pick color';
    
    // Get current color (from junction override, netclass, or default)
    let currentColor = j.color || 'var(--wire)';
    if (currentColor.startsWith('var(')) {
      // Use default black for var() colors in the picker
      currentColor = '#000000';
    }
    const initialHex = ctx.colorToHex(currentColor);
    colorIn.value = initialHex;
    
    // Opacity slider
    const opacityIn = document.createElement('input');
    opacityIn.type = 'range';
    opacityIn.min = '0';
    opacityIn.max = '1';
    opacityIn.step = '0.05';
    opacityIn.style.flex = '0 0 120px';
    opacityIn.style.maxWidth = '140px';
    
    // Extract current opacity from color
    let currentOpacity = 1;
    if (j.color && j.color.includes('rgba')) {
      const match = j.color.match(/rgba?\(.*?,\s*(\d*\.?\d+)\s*\)/);
      if (match) currentOpacity = parseFloat(match[1]);
    }
    opacityIn.value = String(currentOpacity);
    
    let hasColorUndo = false;
    const ensureColorUndo = () => {
      if (!hasColorUndo) {
        ctx.pushUndo();
        hasColorUndo = true;
      }
    };
    
    const applyColor = () => {
      const hex = colorIn.value || '#000000';
      const m = hex.replace('#', '');
      const r = parseInt(m.slice(0, 2), 16);
      const g = parseInt(m.slice(2, 4), 16);
      const b = parseInt(m.slice(4, 6), 16);
      const a = parseFloat(opacityIn.value) || 1;
      j.color = `rgba(${r},${g},${b},${a})`;
      ctx.redrawCanvasOnly();
    };
    
    colorIn.onfocus = ensureColorUndo;
    opacityIn.onfocus = ensureColorUndo;
    colorIn.oninput = () => {
      ensureColorUndo();
      applyColor();
    };
    opacityIn.oninput = () => {
      ensureColorUndo();
      applyColor();
    };
    
    colorRow.appendChild(colorLbl);
    colorRow.appendChild(colorIn);
    colorRow.appendChild(opacityIn);
    wrap.appendChild(colorRow);
    
    // Color swatches (reuse wire inspector pattern)
    const swatchRow = document.createElement('div');
    swatchRow.className = 'row hstack';
    swatchRow.style.marginLeft = '90px';
    swatchRow.style.gap = '4px';
    swatchRow.style.flexWrap = 'wrap';
    
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
        ensureColorUndo();
        colorIn.value = color;
        applyColor();
      };
      swatchRow.appendChild(swatch);
    });
    
    wrap.appendChild(swatchRow);
    
    // Reset to default button
    const resetColorBtn = document.createElement('button');
    resetColorBtn.textContent = 'Reset to Default';
    resetColorBtn.onclick = () => {
      ctx.pushUndo();
      delete j.size;
      delete j.color;
      ctx.redrawCanvasOnly();
      ctx.renderInspector();
    };
    wrap.appendChild(resetColorBtn);
    
    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete Junction';
    deleteBtn.onclick = () => {
      ctx.pushUndo();
      if (j.manual) {
        const jIdx = ctx.junctions.indexOf(j);
        if (jIdx !== -1) ctx.junctions.splice(jIdx, 1);
      } else {
        // Mark automatic junction as suppressed
        const jIdx = ctx.junctions.indexOf(j);
        if (jIdx !== -1) {
          ctx.junctions.splice(jIdx, 1);
          ctx.junctions.push({ id: ctx.uid('junction'), at: j.at, manual: true, suppressed: true });
        }
      }
      ctx.selection = { kind: null, id: null, segIndex: null };
      ctx.redrawCanvasOnly();
      ctx.renderInspector();
    };
    wrap.appendChild(deleteBtn);
    
    inspector.appendChild(wrap);
    return;
  }

  // WIRE INSPECTOR
  if (ctx.selection.kind === 'wire') {
    const w = ctx.wires.find(x => x.id === ctx.selection.id);
    inspectorNone.style.display = w ? 'none' : 'block';
    if (!w) return;

    renderWireInspector(ctx, w, inspector);
    return;
  }

  // nothing selected
  inspectorNone.style.display = 'block';
}

// Render wire inspector (extracted for clarity)
function renderWireInspector(ctx: InspectorContext, w: Wire, inspector: HTMLElement): void {
  const wrap = document.createElement('div');

  // Legacy selection.segIndex is deprecated. Treat the selected `wire` as the
  // segment itself (per-segment `Wire` objects). Find the SWP by wire id.
  const swp = ctx.swpForWireSegment(w.id, 0);

  // ---- Wire ID (read-only) ----
  // Prefer the SWP id (e.g. "swp3"). Fallback to the underlying polyline id if no SWP detected.
  wrap.appendChild(rowPair('Segment ID', text(w.id, true)));
  if (swp) wrap.appendChild(rowPair('SWP', text(swp.id, true)));

  // ---- Wire Endpoints (read-only) ----
  // If a specific segment is selected, show that segment's endpoints.
  // Otherwise, prefer the SWP canonical endpoints; fallback to the polyline endpoints.
  if (w && w.points && w.points.length >= 2) {
    const A = w.points[0], B = w.points[w.points.length - 1];
    wrap.appendChild(rowPair('Wire Start', text(`${ctx.formatDimForDisplay(ctx.pxToNm(A.x), ctx.globalUnits)}, ${ctx.formatDimForDisplay(ctx.pxToNm(A.y), ctx.globalUnits)}`, true)));
    wrap.appendChild(rowPair('Wire End', text(`${ctx.formatDimForDisplay(ctx.pxToNm(B.x), ctx.globalUnits)}, ${ctx.formatDimForDisplay(ctx.pxToNm(B.y), ctx.globalUnits)}`, true)));
  } else if (swp) {
    wrap.appendChild(rowPair('Wire Start', text(`${ctx.formatDimForDisplay(ctx.pxToNm(swp.start.x), ctx.globalUnits)}, ${ctx.formatDimForDisplay(ctx.pxToNm(swp.start.y), ctx.globalUnits)}`, true)));
    wrap.appendChild(rowPair('Wire End', text(`${ctx.formatDimForDisplay(ctx.pxToNm(swp.end.x), ctx.globalUnits)}, ${ctx.formatDimForDisplay(ctx.pxToNm(swp.end.y), ctx.globalUnits)}`, true)));
  } else {
    const A = w.points[0], B = w.points[w.points.length - 1];
    wrap.appendChild(rowPair('Wire Start', text(`${ctx.formatDimForDisplay(ctx.pxToNm(A.x), ctx.globalUnits)}, ${ctx.formatDimForDisplay(ctx.pxToNm(A.y), ctx.globalUnits)}`, true)));
    wrap.appendChild(rowPair('Wire End', text(`${ctx.formatDimForDisplay(ctx.pxToNm(B.x), ctx.globalUnits)}, ${ctx.formatDimForDisplay(ctx.pxToNm(B.y), ctx.globalUnits)}`, true)));
  }

  // ---- Wire Length (read-only) ----
  if (w && w.points && w.points.length >= 2) {
    let totalLength = 0;
    for (let i = 1; i < w.points.length; i++) {
      const dx = w.points[i].x - w.points[i - 1].x;
      const dy = w.points[i].y - w.points[i - 1].y;
      totalLength += Math.sqrt(dx * dx + dy * dy);
    }
    const lengthNm = ctx.pxToNm(totalLength);
    wrap.appendChild(rowPair('Wire Length', text(ctx.formatDimForDisplay(lengthNm, ctx.globalUnits), true)));
  }

  // ---- Net Assignment (includes Net Class selection) ----
  const netRow = document.createElement('div');
  netRow.className = 'row';
  const netLbl = document.createElement('label');
  netLbl.textContent = 'Net Class';
  netLbl.style.width = '90px';
  const netSel = document.createElement('select');

  // Populate with all available nets
  Array.from(ctx.nets).sort().forEach(netName => {
    const o = document.createElement('option');
    o.value = netName;
    o.textContent = netName;
    netSel.appendChild(o);
  });

  netRow.appendChild(netLbl);
  netRow.appendChild(netSel);
  wrap.appendChild(netRow);

  // Set net dropdown initial value
  netSel.value = w.netId || ctx.activeNetClass;

  // Use custom properties checkbox
  const customRow = document.createElement('div');
  customRow.className = 'row';
  const customLbl = document.createElement('label');
  customLbl.style.display = 'flex';
  customLbl.style.alignItems = 'center';
  customLbl.style.gap = '6px';
  const chkCustom = document.createElement('input');
  chkCustom.type = 'checkbox';
  const hasCustomProps = () => {
    ctx.ensureStroke(w);
    return w.stroke!.width > 0 || (w.stroke!.type !== 'default' && w.stroke!.type !== undefined);
  };
  chkCustom.checked = hasCustomProps();
  const lblCustomText = document.createElement('span');
  lblCustomText.textContent = 'Use custom properties';
  customLbl.append(chkCustom, lblCustomText);
  customRow.appendChild(customLbl);
  wrap.appendChild(customRow);

  // Build wire stroke editor
  buildWireStrokeEditor(ctx, w, swp, wrap, netSel, chkCustom);

  inspector.appendChild(wrap);
}

// Build wire stroke editor (width, style, color, preview)
function buildWireStrokeEditor(
  ctx: InspectorContext,
  w: Wire,
  swp: SWP | null,
  wrap: HTMLElement,
  netSel: HTMLSelectElement,
  chkCustom: HTMLInputElement
): void {
  ctx.ensureStroke(w);
  const holder = document.createElement('div');

  // Net selection handler - updates wire's net class assignment
  netSel.onchange = () => {
    ctx.pushUndo();
    ctx.ensureStroke(w);
    ctx.activeNetClass = netSel.value;
    ctx.renderNetList();
    w.netId = netSel.value;

    if (!chkCustom.checked) {
      // If not using custom properties, update to use net class visuals
      const netClass = ctx.NET_CLASSES[netSel.value];
      const patch: Partial<Stroke> = { width: 0, type: 'default' };
      w.stroke = { ...(w.stroke as Stroke), ...patch };
      delete (w.stroke as any).widthNm;
      w.color = ctx.rgba01ToCss(netClass.wire.color);
      ctx.updateWireDOM(w);
      ctx.redrawCanvasOnly();
    }

    ctx.selection = { kind: 'wire', id: w.id, segIndex: null };
    syncWidth();
    syncStyle();
    syncColor();
    syncPreview();
  };

  // Custom properties checkbox handler
  chkCustom.onchange = () => {
    ctx.pushUndo();
    ctx.ensureStroke(w);
    if (chkCustom.checked) {
      // Switching to custom: populate with current effective values (width/type from effectiveStroke,
      // but preserve the actual net class color, not the display-adjusted color)
      const nc = ctx.NET_CLASSES[w.netId || ctx.activeNetClass] || ctx.NET_CLASSES.default;
      const eff = ctx.effectiveStroke(w, nc, ctx.THEME);
      // Determine the raw color to use (from wire's current stroke, or from netclass if using defaults)
      const rawColor = (w.stroke && w.stroke.width > 0) ? w.stroke.color : nc.wire.color;
      const patch: Partial<Stroke> = {
        width: eff.width,
        type: (eff.type === 'default' ? 'solid' : eff.type) || 'solid',
        color: rawColor
      };
      w.stroke = { ...(w.stroke as Stroke), ...patch };
      (w.stroke as any).widthNm = Math.round(patch.width! * ctx.NM_PER_MM);
      w.color = ctx.rgba01ToCss(rawColor);
    } else {
      // Switching to net class: use defaults
      const netClass = ctx.NET_CLASSES[w.netId || ctx.activeNetClass];
      const patch: Partial<Stroke> = { width: 0, type: 'default' };
      w.stroke = { ...(w.stroke as Stroke), ...patch };
      delete (w.stroke as any).widthNm;
      w.color = ctx.rgba01ToCss(netClass.wire.color);
    }
    ctx.updateWireDOM(w);
    ctx.redrawCanvasOnly();
    ctx.selection = { kind: 'wire', id: w.id, segIndex: null };
    syncWidth();
    syncStyle();
    syncColor();
    syncPreview();
  };

  // Width (in selected units)
  const widthRow = document.createElement('div');
  widthRow.className = 'row';
  const wLbl = document.createElement('label');
  wLbl.textContent = `Width (${ctx.globalUnits})`;
  wLbl.style.width = '90px';
  const wIn = document.createElement('input');
  wIn.type = 'text';
  wIn.step = '0.05';

  const syncWidth = () => {
    const eff = ctx.effectiveStroke(w, ctx.netClassForWire(w), ctx.THEME);
    const effNm = Math.round((eff.width || 0) * ctx.NM_PER_MM);
    wIn.value = ctx.formatDimForDisplay(effNm, ctx.globalUnits);
    wIn.disabled = !chkCustom.checked;
  };

  // Live, non-destructive width updates while typing so the inspector DOM
  // isn't rebuilt on every keystroke. The final onchange will perform any
  // SWP-wide restroke and normalization.
  let hasUndoForThisEdit = false;
  wIn.onfocus = () => {
    // Push undo once when editing starts
    if (!hasUndoForThisEdit) {
      ctx.pushUndo();
      hasUndoForThisEdit = true;
    }
  };
  wIn.oninput = () => {
    try {
      const parsed = ctx.parseDimInput(wIn.value || '0');
      if (!parsed) return;
      const nm = parsed.nm;
      const valMm = nm / ctx.NM_PER_MM;
      // store both mm and nm for precision; update DOM for immediate feedback
      ctx.ensureStroke(w);
      (w.stroke as any).widthNm = nm;
      w.stroke!.width = valMm;
      w.color = ctx.rgba01ToCss(w.stroke!.color);
      ctx.updateWireDOM(w);
      syncPreview();
    } catch (err) {
      // ignore transient parse errors while typing
    }
  };

  wIn.onchange = () => {
    // pushUndo() called on focus, not here, to avoid duplicate entries
    ctx.ensureStroke(w);
    const parsed = ctx.parseDimInput(wIn.value || '0');
    const nm = parsed ? parsed.nm : 0;
    const valMm = nm / ctx.NM_PER_MM; // mm for legacy fields
    const mid = (w.points && w.points.length >= 2) ? ctx.midOfSeg(w.points, 0) : null;
    // Selected wire is the segment itself: apply directly to `w`.
    if (w.points && w.points.length === 2) {
      (w.stroke as any).widthNm = nm;
      w.stroke!.width = valMm;
      if (valMm <= 0) w.stroke!.type = 'default';
      w.color = ctx.rgba01ToCss(w.stroke!.color);
      ctx.updateWireDOM(w);
      ctx.redrawCanvasOnly();
      ctx.selection = { kind: 'wire', id: w.id, segIndex: null };
    } else if (swp) {
      ctx.restrokeSwpSegments(swp, {
        width: valMm,
        type: valMm > 0 ? (w.stroke!.type === 'default' ? 'solid' : w.stroke!.type) : 'default'
      });
      if (mid) ctx.reselectNearestAt(mid);
      else ctx.redraw();
    } else {
      (w.stroke as any).widthNm = nm;
      w.stroke!.width = valMm;
      if (valMm <= 0) w.stroke!.type = 'default'; // mirror KiCad precedence
      ctx.updateWireDOM(w);
      ctx.redrawCanvasOnly();
    }
    // Normalize displayed value to chosen units
    wIn.value = ctx.formatDimForDisplay(nm, ctx.globalUnits);
  };
  widthRow.appendChild(wLbl);
  widthRow.appendChild(wIn);
  holder.appendChild(widthRow);

  // Line style
  const styleRow = document.createElement('div');
  styleRow.className = 'row';
  const sLbl = document.createElement('label');
  sLbl.textContent = 'Line style';
  sLbl.style.width = '90px';
  const sSel = document.createElement('select');
  ['default', 'solid', 'dash', 'dot', 'dash_dot', 'dash_dot_dot'].forEach(v => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v.replace(/_/g, '·');
    sSel.appendChild(o);
  });

  const syncStyle = () => {
    const eff = ctx.effectiveStroke(w, ctx.netClassForWire(w), ctx.THEME);
    sSel.value = (!chkCustom.checked ? 'default' : w.stroke!.type);
    sSel.disabled = !chkCustom.checked;
  };

  sSel.onchange = () => {
    ctx.pushUndo();
    ctx.ensureStroke(w);
    const val = (sSel.value || 'solid') as any;
    const mid = (w.points && w.points.length >= 2) ? ctx.midOfSeg(w.points, 0) : null;
    if (w.points && w.points.length === 2) {
      ctx.ensureStroke(w);
      w.stroke!.type = val;
      ctx.updateWireDOM(w);
      ctx.redrawCanvasOnly();
      ctx.selection = { kind: 'wire', id: w.id, segIndex: null };
    } else if (swp) {
      // Only change the style; do not force width to 0 when 'default' is chosen.
      ctx.restrokeSwpSegments(swp, { type: val });
      if (mid) ctx.reselectNearestAt(mid);
      else ctx.redraw();
    } else {
      w.stroke!.type = val;
      // Selecting 'default' now only defers the style to netclass.
      // Width and color remain as-is.
      ctx.updateWireDOM(w);
      ctx.redrawCanvasOnly();
    }
    syncPreview();
  };
  styleRow.appendChild(sLbl);
  styleRow.appendChild(sSel);
  holder.appendChild(styleRow);

  // Color (RGB) + Opacity
  buildColorEditor(ctx, w, swp, holder, chkCustom, syncWidth, syncStyle, syncPreview);

  // Live preview of effective stroke
  const prevRow = document.createElement('div');
  prevRow.className = 'row';
  const pLbl = document.createElement('label');
  pLbl.textContent = 'Preview';
  pLbl.style.width = '90px';
  const pSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  pSvg.setAttribute('width', '160');
  pSvg.setAttribute('height', '24');
  const pLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  ctx.setAttrs(pLine, { x1: 10, y1: 12, x2: 150, y2: 12 });
  pLine.setAttribute('stroke-linecap', 'round');
  pSvg.appendChild(pLine);

  function syncPreview() {
    const eff = ctx.effectiveStroke(w, ctx.netClassForWire(w), ctx.THEME);
    // For the preview swatch, use the raw stored color (before black/white conversions)
    ctx.ensureStroke(w);
    const rawColor = (netSel.value !== '__none__')
      ? ctx.NET_CLASSES[netSel.value].wire.color
      : w.stroke!.color;
    pLine.setAttribute('stroke', ctx.rgba01ToCss(rawColor));
    pLine.setAttribute('stroke-width', String(ctx.mmToPx(eff.width)));
    const d = ctx.dashArrayFor(eff.type);
    if (d) pLine.setAttribute('stroke-dasharray', d);
    else pLine.removeAttribute('stroke-dasharray');
  }

  prevRow.appendChild(pLbl);
  prevRow.appendChild(pSvg);
  holder.appendChild(prevRow);

  // One-shot rebuild to wire up initial UI state
  function rebuild() {
    // refresh live stroke from model + precedence
    syncWidth();
    syncStyle();
    syncColor();
    syncPreview();
  }
  rebuild();

  // Header row: left-justified section title ("Wire Stroke")
  const wsHeader = document.createElement('div');
  wsHeader.className = 'row';
  const wsLabel = document.createElement('label');
  wsLabel.textContent = 'Wire Stroke';
  wsLabel.style.width = 'auto'; // don't reserve the 90px label column
  wsLabel.style.fontWeight = '600';
  wsHeader.appendChild(wsLabel);
  wrap.appendChild(wsHeader);

  // Then put the stroke rows directly below the header (no indent)
  wrap.appendChild(holder);

  // Closure to sync color controls
  function syncColor() {
    // Implemented in buildColorEditor
  }
}

// Build color editor with picker, opacity, and swatches
function buildColorEditor(
  ctx: InspectorContext,
  w: Wire,
  swp: SWP | null,
  holder: HTMLElement,
  chkCustom: HTMLInputElement,
  syncWidth: () => void,
  syncStyle: () => void,
  syncPreview: () => void
): void {
  const colorRow = document.createElement('div');
  colorRow.className = 'row hstack';

  const cLbl = document.createElement('label');
  cLbl.textContent = 'Color';
  cLbl.style.width = '90px';

  const cIn = document.createElement('input');
  cIn.type = 'color';
  cIn.title = 'Pick color';

  // Set initial value
  ctx.ensureStroke(w);
  const initialColor = w.stroke!.color;
  const initialHex = '#' + [initialColor.r, initialColor.g, initialColor.b]
    .map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  cIn.value = initialHex;

  const aIn = document.createElement('input');
  aIn.type = 'range';
  aIn.min = '0';
  aIn.max = '1';
  aIn.step = '0.05';
  aIn.style.flex = '0 0 120px';
  aIn.style.maxWidth = '140px';
  aIn.value = String(Math.max(0, Math.min(1, initialColor.a)));

  const syncColor = () => {
    // Use raw stored color, not effective stroke (which may convert black/white for visibility)
    ctx.ensureStroke(w);
    const rawColor = w.stroke!.color;
    // Disable first, then update values, then re-enable to force browser to refresh
    const wasDisabled = cIn.disabled;
    cIn.disabled = true;
    aIn.disabled = true;

    // If not using custom properties, show netclass color instead
    if (!chkCustom.checked) {
      const nc = ctx.NET_CLASSES[w.netId || ctx.activeNetClass];
      const rgbCss = `rgba(${Math.round(nc.wire.color.r * 255)},${Math.round(nc.wire.color.g * 255)},${Math.round(nc.wire.color.b * 255)},${nc.wire.color.a})`;
      const hex = ctx.colorToHex(rgbCss);
      cIn.value = hex;
      aIn.value = String(Math.max(0, Math.min(1, nc.wire.color.a)));
    } else {
      const rgbCss = `rgba(${Math.round(rawColor.r * 255)},${Math.round(rawColor.g * 255)},${Math.round(rawColor.b * 255)},${rawColor.a})`;
      const hex = ctx.colorToHex(rgbCss);
      cIn.value = hex;
      aIn.value = String(Math.max(0, Math.min(1, rawColor.a)));
    }

    // Re-enable after updating value to force refresh
    cIn.disabled = !chkCustom.checked;
    aIn.disabled = !chkCustom.checked;
  };

  // Live (non-destructive) updates while the user drags the color/alpha controls.
  const liveApplyColor = () => {
    try {
      const hex = cIn.value || '#ffffff';
      const m = hex.replace('#', '');
      const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
      const a = Math.max(0, Math.min(1, parseFloat(aIn.value) || 1));
      const newColor: RGBA01 = { r: r / 255, g: g / 255, b: b / 255, a };
      ctx.ensureStroke(w);
      w.stroke = { ...w.stroke!, color: newColor };
      w.color = ctx.rgba01ToCss(w.stroke.color);
      ctx.updateWireDOM(w);
      syncPreview();
    } catch (err) {
      // Ignore transient parse errors
    }
  };

  let hasColorUndo = false;
  const ensureColorUndo = () => {
    if (!hasColorUndo) {
      ctx.pushUndo();
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
  const commitColor = () => {
    ensureColorUndo();
    const hex = cIn.value || '#ffffff';
    const m = hex.replace('#', '');
    const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    const a = Math.max(0, Math.min(1, parseFloat(aIn.value) || 1));
    const newColor: RGBA01 = { r: r / 255, g: g / 255, b: b / 255, a };

    const patch: Partial<Stroke> = { color: newColor };
    const mid = (w.points && w.points.length >= 2) ? ctx.midOfSeg(w.points, 0) : null;

    if (w.points && w.points.length === 2) {
      ctx.ensureStroke(w);
      w.stroke = { ...w.stroke!, color: newColor };
      w.color = ctx.rgba01ToCss(w.stroke.color);
      ctx.updateWireDOM(w);
      ctx.redrawCanvasOnly();
      ctx.selection = { kind: 'wire', id: w.id, segIndex: null };
    } else if (swp) {
      ctx.restrokeSwpSegments(swp, patch);
      if (mid) ctx.reselectNearestAt(mid);
      else ctx.redraw();
    } else {
      ctx.ensureStroke(w);
      w.stroke = { ...w.stroke!, color: newColor };
      w.color = ctx.rgba01ToCss(w.stroke.color);
      ctx.updateWireDOM(w);
      ctx.redrawCanvasOnly();
    }
    syncWidth();
    syncStyle();
    syncColor();
    syncPreview();
  };

  cIn.onchange = commitColor;
  aIn.onchange = commitColor;

  colorRow.appendChild(cLbl);
  colorRow.appendChild(cIn);
  colorRow.appendChild(aIn);

  // Swatch toggle button
  const swatchToggle = document.createElement('button');
  swatchToggle.type = 'button';
  swatchToggle.className = 'swatch-toggle';
  swatchToggle.title = 'Show swatches';
  swatchToggle.setAttribute('aria-haspopup', 'true');
  swatchToggle.setAttribute('aria-expanded', 'false');
  swatchToggle.tabIndex = 0;
  swatchToggle.setAttribute('role', 'button');
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
  colorRow.appendChild(swatchToggle);
  holder.appendChild(colorRow);

  // Build swatch popover
  buildSwatchPopover(ctx, w, cIn, aIn, swatchToggle, ensureColorUndo, commitColor);
}

// Build swatch popover for color picker
function buildSwatchPopover(
  ctx: InspectorContext,
  w: Wire,
  cIn: HTMLInputElement,
  aIn: HTMLInputElement,
  swatchToggle: HTMLButtonElement,
  ensureColorUndo: () => void,
  commitColor: () => void
): void {
  const swatches = [
    ['black', '#000000'],
    ['red', '#FF0000'], ['green', '#00FF00'], ['blue', '#0000FF'],
    ['cyan', '#00FFFF'], ['magenta', '#FF00FF'], ['yellow', '#FFFF00']
  ];
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

  swatches.forEach(([k, col]) => {
    const b = document.createElement('button');
    b.className = 'swatch-btn';
    b.title = (k as string).toUpperCase();
    // Special handling for black: create split diagonal swatch
    if (col === '#000000') {
      b.style.background = 'linear-gradient(to bottom right, #000000 0%, #000000 49%, #ffffff 51%, #ffffff 100%)';
      b.style.border = '1px solid #666666';
      b.title = 'BLACK/WHITE';
    } else {
      b.style.background = String(col);
    }
    b.style.width = '18px';
    b.style.height = '18px';
    b.style.borderRadius = '4px';
    b.style.border = '1px solid rgba(0,0,0,0.12)';
    b.style.padding = '0';
    // Prevent blur race when user clicks a swatch
    b.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
    });
    b.addEventListener('click', () => {
      ensureColorUndo();
      cIn.value = String(col as string);
      aIn.value = '1';
      commitColor();
      hidePopover();
    });
    pal.appendChild(b);
  });
  popover.appendChild(pal);
  document.body.appendChild(popover);

  function showPopover() {
    const r = cIn.getBoundingClientRect();
    const left = Math.max(6, window.scrollX + r.left);
    let top = window.scrollY + r.bottom + 6;
    const popH = popover.offsetHeight || 120;
    const viewportBottom = window.scrollY + window.innerHeight;
    if (top + popH > viewportBottom - 8) {
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
    requestAnimationFrame(() => {
      popover.style.opacity = '1';
      popover.style.transform = 'translateY(0)';
    });
    swatchToggle.setAttribute('aria-expanded', 'true');
  }

  function hidePopover() {
    popover.style.opacity = '0';
    popover.style.transform = 'translateY(-6px)';
    swatchToggle.setAttribute('aria-expanded', 'false');
    setTimeout(() => {
      popover.style.display = 'none';
    }, 160);
  }

  // Show popover when the swatch toggle is clicked
  swatchToggle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (popover.style.display === 'block') {
      hidePopover();
    } else {
      showPopover();
    }
  });

  // keyboard accessibility: toggle on Enter/Space
  swatchToggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (popover.style.display === 'block') {
        hidePopover();
      } else {
        showPopover();
      }
    }
  });

  // If user clicks outside the popover and color input, hide it
  document.addEventListener('pointerdown', (ev) => {
    const t = ev.target as Node | null;
    if (!t) return;
    if (t === cIn || popover.contains(t)) return;
    hidePopover();
  });
}
