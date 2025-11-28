// ================================================================================
// APPLICATION STATE MANAGEMENT
// ================================================================================
//
// This module manages the global application state including components, wires,
// junctions, selection, undo/redo system, and counters.
//
// ================================================================================

import type { 
  Component, Wire, Junction, Selection, CounterKey, NetClass, 
  ResistorStyle, DiodeSubtype, CapacitorSubtype, Theme 
} from './types.js';

// ====== Core Model Arrays ======

export let components: Component[] = [];
export let wires: Wire[] = [];
export let junctions: Junction[] = [];

// ====== Selection State ======

export let selection: Selection = { kind: null, id: null, segIndex: null };

export function setSelection(sel: Selection) {
  selection = sel;
}

// ====== Counters & ID Generation ======

export type CounterMap = {
  resistor: number;
  capacitor: number;
  inductor: number;
  diode: number;
  npn: number;
  pnp: number;
  ground: number;
  battery: number;
  ac: number;
  wire: number;
  junction: number;
};

export let counters: CounterMap = {
  resistor: 1,
  capacitor: 1,
  inductor: 1,
  diode: 1,
  npn: 1,
  pnp: 1,
  ground: 1,
  battery: 1,
  ac: 1,
  wire: 1,
  junction: 1
};

/**
 * Generate unique ID with prefix
 */
export function uid(prefix: CounterKey): string {
  return `${prefix}${counters[prefix]++}`;
}

/**
 * Reset all counters to 1
 */
export function resetCounters() {
  for (const key in counters) {
    counters[key as CounterKey] = 1;
  }
}

// ====== Nets ======

export let nets: Set<string> = new Set(['default']);
export let activeNetClass: string = 'default';

export function setActiveNetClass(name: string) {
  activeNetClass = name;
}

export function addNetToSet(name: string) {
  nets.add(name);
}

export function deleteNetFromSet(name: string) {
  nets.delete(name);
}

// ====== Component & Wire Modification ======

export function setComponents(newComponents: Component[]) {
  components = newComponents;
}

export function setWires(newWires: Wire[]) {
  wires = newWires;
}

export function setJunctions(newJunctions: Junction[]) {
  junctions = newJunctions;
}

export function addComponent(comp: Component) {
  components.push(comp);
}

export function addWire(wire: Wire) {
  wires.push(wire);
}

export function addJunction(junction: Junction) {
  junctions.push(junction);
}

export function removeComponentById(id: string) {
  components = components.filter(c => c.id !== id);
}

export function removeWireById(id: string) {
  wires = wires.filter(w => w.id !== id);
}

export function findComponentById(id: string): Component | undefined {
  return components.find(c => c.id === id);
}

export function findWireById(id: string): Wire | undefined {
  return wires.find(w => w.id === id);
}

// ====== Palette State ======

export let diodeSubtype: DiodeSubtype = 'generic';
export let capacitorSubtype: CapacitorSubtype = 'standard';

export function setDiodeSubtype(subtype: DiodeSubtype) {
  diodeSubtype = subtype;
}

export function setCapacitorSubtype(subtype: CapacitorSubtype) {
  capacitorSubtype = subtype;
}

// ====== Undo/Redo System ======

export interface EditorState {
  components: Component[];
  wires: Wire[];
  junctions: Junction[];
  selection: Selection;
  counters: CounterMap;
  nets: Set<string>;
  netClasses: Record<string, NetClass>;
  activeNetClass: string;
  defaultResistorStyle: ResistorStyle;
}

let undoStack: EditorState[] = [];
let redoStack: EditorState[] = [];
const MAX_UNDO_STACK = 50;

export function captureState(
  netClasses: Record<string, NetClass>,
  defaultResistorStyle: ResistorStyle
): EditorState {
  return {
    components: JSON.parse(JSON.stringify(components)),
    wires: JSON.parse(JSON.stringify(wires)),
    junctions: JSON.parse(JSON.stringify(junctions)),
    selection: { ...selection },
    counters: { ...counters },
    nets: new Set(nets),
    netClasses: JSON.parse(JSON.stringify(netClasses)),
    activeNetClass: activeNetClass,
    defaultResistorStyle: defaultResistorStyle
  };
}

export function pushUndoState(state: EditorState) {
  undoStack.push(state);
  if (undoStack.length > MAX_UNDO_STACK) {
    undoStack.shift();
  }
  redoStack = [];
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export function canRedo(): boolean {
  return redoStack.length > 0;
}

export function popUndo(): EditorState | undefined {
  return undoStack.pop();
}

export function pushRedo(state: EditorState) {
  redoStack.push(state);
}

export function popRedo(): EditorState | undefined {
  return redoStack.pop();
}

export function pushCurrentToUndo(state: EditorState) {
  undoStack.push(state);
}

export function restoreStateData(state: EditorState) {
  components = JSON.parse(JSON.stringify(state.components));
  wires = JSON.parse(JSON.stringify(state.wires));
  junctions = JSON.parse(JSON.stringify(state.junctions));
  selection = { ...state.selection };
  counters = { ...state.counters };
  nets = new Set(state.nets);
  activeNetClass = state.activeNetClass;
}

export function clearUndoRedo() {
  undoStack = [];
  redoStack = [];
}

// ====== State Reset ======

export function clearAllState() {
  components = [];
  wires = [];
  junctions = [];
  selection = { kind: null, id: null, segIndex: null };
  nets = new Set(['default']);
  activeNetClass = 'default';
  resetCounters();
  clearUndoRedo();
}
