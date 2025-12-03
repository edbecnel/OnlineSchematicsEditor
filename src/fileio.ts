// fileio.ts - File operations (save/load/clear)
// Handles JSON serialization, file downloads, and canvas clearing

import type {
  Component, Wire, Junction, NetClass, Theme, ResistorStyle
} from './types.js';

// Context interface for file I/O operations
export interface FileIOContext {
  // State
  components: Component[];
  wires: Wire[];
  junctions: Junction[];
  nets: Set<string>;
  activeNetClass: string;
  NET_CLASSES: Record<string, NetClass>;
  THEME: Theme;
  defaultResistorStyle: ResistorStyle;
  counters: Record<string, number>;
  GRID: number;

  // UI elements
  projTitle: HTMLInputElement;
  defaultResistorStyleSelect: HTMLSelectElement;

  // Functions
  normalizeAllWires: () => void;
  ensureStroke: (w: Wire) => void;
  rgba01ToCss: (c: { r: number; g: number; b: number; a: number }) => string;
  cssToRGBA01: (css: string) => { r: number; g: number; b: number; a: number };
  renderNetList: () => void;
  redraw: () => void;
  keyPt: (p: { x: number; y: number }) => string;
  compPinPositions?: (c: Component) => Array<{ x: number; y: number; [key: string]: any }>;
  breakWiresForComponent?: (c: Component) => boolean;
  deleteBridgeBetweenPins?: (c: Component) => void;

  // Selection
  selection: { kind: string | null; id: string | number | null; segIndex: number | null };

  // Drawing state
  drawing: {
    active: boolean;
    points: any[];
  };
  gDrawing: SVGGElement;
}

// Clear all components and wires from the canvas
export function clearAll(ctx: FileIOContext): void {
  if (!confirm('Clear the canvas? This cannot be undone.')) return;
  
  ctx.components.length = 0;
  ctx.wires.length = 0;
  ctx.junctions.length = 0;
  ctx.selection = { kind: null, id: null, segIndex: null };
  
  // Cancel any in-progress wire drawing and clear overlay
  ctx.drawing.active = false;
  ctx.drawing.points = [];
  ctx.gDrawing.replaceChildren();
  
  // Reset ID counters
  ctx.counters = {
    resistor: 1,
    capacitor: 1,
    inductor: 1,
    diode: 1,
    npn: 1,
    pnp: 1,
    ground: 1,
    battery: 1,
    ac: 1,
    wire: 1
  };
  
  // Reset nets to default only
  ctx.nets.clear();
  ctx.nets.add('default');
  ctx.renderNetList();
  ctx.redraw();
}

// Save the current schematic to a JSON file
export function saveJSON(ctx: FileIOContext): void {
  // Clean up any accidental duplicates/zero-length segments before saving
  const SAVE_LEGACY_WIRE_COLOR = true; // back-compat flag (old format keeps {color})
  ctx.normalizeAllWires();
  
  // build a wires array that always includes KiCad-style stroke; keep {color} if flag enabled
  const wiresOut = ctx.wires.map(w => {
    ctx.ensureStroke(w);
    const base = {
      id: w.id,
      points: w.points,
      stroke: w.stroke,
      netId: w.netId || 'default'
    } as any;
    if (SAVE_LEGACY_WIRE_COLOR) {
      base.color = w.color || ctx.rgba01ToCss(w.stroke!.color);
    }
    return base;
  });
  
  const data = {
    version: 2,
    title: ctx.projTitle.value || 'Untitled',
    grid: ctx.GRID,
    components: ctx.components,
    wires: wiresOut,
    junctions: ctx.junctions,
    nets: Array.from(ctx.nets),
    activeNetClass: ctx.activeNetClass,
    netClasses: Object.fromEntries(
      Object.entries(ctx.NET_CLASSES)
        .filter(([id]) => id !== 'default')
        .map(([id, nc]) => [id, nc])
    ),
    defaultResistorStyle: ctx.defaultResistorStyle
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (ctx.projTitle.value?.trim() || 'schematic') + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Load a schematic from JSON text
export function loadFromJSON(ctx: FileIOContext, text: string): void {
  const data = JSON.parse(text);
  
  // Clear and load components
  ctx.components.length = 0;
  ctx.components.push(...(data.components || []));
  
  // Clear and load wires
  ctx.wires.length = 0;
  ctx.wires.push(...(data.wires || []));
  
  ctx.projTitle.value = data.title || '';

  // Restore default resistor style
  if (data.defaultResistorStyle && (data.defaultResistorStyle === 'ansi' || data.defaultResistorStyle === 'iec')) {
    ctx.defaultResistorStyle = data.defaultResistorStyle;
    ctx.defaultResistorStyleSelect.value = ctx.defaultResistorStyle;
    localStorage.setItem('defaultResistorStyle', ctx.defaultResistorStyle);
  }

  // Restore nets (add default if not present)
  ctx.nets.clear();
  (data.nets || ['default']).forEach((n: string) => ctx.nets.add(n));
  if (!ctx.nets.has('default')) ctx.nets.add('default');

  // Restore active net class
  if (data.activeNetClass && typeof data.activeNetClass === 'string') {
    ctx.activeNetClass = data.activeNetClass;
  } else {
    ctx.activeNetClass = 'default';
  }

  // Restore net classes (custom net properties)
  if (data.netClasses && typeof data.netClasses === 'object') {
    Object.entries(data.netClasses).forEach(([id, nc]: [string, any]) => {
      if (nc && typeof nc === 'object') {
        ctx.NET_CLASSES[id] = {
          id: nc.id || id,
          name: nc.name || id,
          wire: nc.wire || { ...ctx.THEME.wire },
          junction: nc.junction || { ...ctx.THEME.junction }
        };
      }
    });
  }

  // Backfill stroke from legacy color (and ensure presence for v2)
  ctx.wires.forEach((w: any) => {
    if (!w.stroke) {
      const css = w.color || 'rgba(0,0,0,1)'; // default wire color
      w.stroke = { width: 0, type: 'default', color: ctx.cssToRGBA01(css) };
    }
    // keep legacy color in sync so SWP heuristics & old flows remain stable
    if (!w.color) w.color = ctx.rgba01ToCss(w.stroke.color);
    // Preserve an internal nanometer resolution where possible
    if ((w.stroke as any).widthNm == null && typeof w.stroke.width === 'number') {
      (w.stroke as any).widthNm = Math.round((w.stroke.width || 0) * 1000000); // NM_PER_MM constant
    }
    if (!w.netId) w.netId = 'default';
  });

  // Load junctions
  ctx.junctions.length = 0;
  if (Array.isArray(data.junctions)) {
    ctx.junctions.push(...data.junctions);
  }

  ctx.normalizeAllWires();

  // REPAIR STEP: Validate and fix wire topology for all placed components
  // This handles cases where saved files have broken wire topology (e.g., from bugs or manual edits)
  // Check each component and ensure wires are properly broken at their pins
  for (const c of ctx.components) {
    const twoPin = ['resistor', 'capacitor', 'inductor', 'diode', 'battery', 'ac'];
    if (!twoPin.includes(c.type)) continue;
    
    // For each pin, check if there's a wire segment that should be broken but isn't
    const pins = ctx.compPinPositions?.(c);
    if (!pins || pins.length < 2) continue;
    
    // Check if wires need to be broken at component pins
    let needsRepair = false;
    for (const pin of pins) {
      // Check if there's a wire segment passing through this pin (should be broken)
      for (const w of ctx.wires) {
        if (w.points.length < 2) continue;
        
        for (let i = 0; i < w.points.length - 1; i++) {
          const a = w.points[i];
          const b = w.points[i + 1];
          
          // Check if pin is on this segment (but not at endpoints)
          const pinX = (pin as any).x;
          const pinY = (pin as any).y;
          const isVertical = Math.abs(a.x - b.x) < 0.1;
          const isHorizontal = Math.abs(a.y - b.y) < 0.1;
          
          if (isVertical && Math.abs(pinX - a.x) < 1) {
            const minY = Math.min(a.y, b.y);
            const maxY = Math.max(a.y, b.y);
            if (pinY > minY + 1 && pinY < maxY - 1) {
              needsRepair = true;
              break;
            }
          } else if (isHorizontal && Math.abs(pinY - a.y) < 1) {
            const minX = Math.min(a.x, b.x);
            const maxX = Math.max(a.x, b.x);
            if (pinX > minX + 1 && pinX < maxX - 1) {
              needsRepair = true;
              break;
            }
          }
        }
        if (needsRepair) break;
      }
      if (needsRepair) break;
    }
    
    // If repair is needed, call the break wires function if available
    if (needsRepair && ctx.breakWiresForComponent) {
      ctx.breakWiresForComponent(c);
      if (ctx.deleteBridgeBetweenPins) {
        ctx.deleteBridgeBetweenPins(c);
      }
    }
  }
  
  ctx.normalizeAllWires();

  // re-seed counters so new IDs continue incrementing nicely
  const used: Record<string, number> = {
    resistor: 0,
    capacitor: 0,
    inductor: 0,
    diode: 0,
    npn: 0,
    pnp: 0,
    ground: 0,
    battery: 0,
    ac: 0,
    wire: 0
  };
  
  for (const c of ctx.components) {
    const k = c.type;
    const num = parseInt((c.label || '').replace(/^[A-Z]+/, '').trim()) || 0;
    used[k] = Math.max(used[k], num);
  }
  
  for (const w of ctx.wires) {
    const n = parseInt((w.id || '').replace(/^wire/, '')) || 0;
    used.wire = Math.max(used.wire, n);
  }
  
  Object.keys(ctx.counters).forEach(k => {
    ctx.counters[k] = used[k] + 1;
  });
  
  ctx.selection = { kind: null, id: null, segIndex: null };
  ctx.renderNetList();
  ctx.redraw();
}

// Install file I/O event handlers
export function installFileIOHandlers(
  ctx: FileIOContext,
  saveBtn: HTMLElement,
  loadBtn: HTMLElement,
  fileInput: HTMLInputElement
): void {
  // Save button
  saveBtn.addEventListener('click', () => saveJSON(ctx));
  
  // Load button - triggers file input
  loadBtn.addEventListener('click', () => fileInput.click());
  
  // File input change handler
  fileInput.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadFromJSON(ctx, reader.result as string);
      } catch (err) {
        alert('Failed to load JSON: ' + err);
      }
    };
    reader.readAsText(f);
  });
}
