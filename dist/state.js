// ================================================================================
// APPLICATION STATE MANAGEMENT
// ================================================================================
//
// This module manages the global application state including components, wires,
// junctions, selection, undo/redo system, and counters.
//
// ================================================================================
// ====== Core Model Arrays ======
export let components = [];
export let wires = [];
export let junctions = [];
// ====== Selection State ======
export let selection = { kind: null, id: null, segIndex: null };
export function setSelection(sel) {
    selection = sel;
}
export let counters = {
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
export function uid(prefix) {
    return `${prefix}${counters[prefix]++}`;
}
/**
 * Reset all counters to 1
 */
export function resetCounters() {
    for (const key in counters) {
        counters[key] = 1;
    }
}
// ====== Nets ======
export let nets = new Set(['default']);
export let activeNetClass = 'default';
export function setActiveNetClass(name) {
    activeNetClass = name;
}
export function addNetToSet(name) {
    nets.add(name);
}
export function deleteNetFromSet(name) {
    nets.delete(name);
}
// ====== Component & Wire Modification ======
export function setComponents(newComponents) {
    components = newComponents;
}
export function setWires(newWires) {
    wires = newWires;
}
export function setJunctions(newJunctions) {
    junctions = newJunctions;
}
export function addComponent(comp) {
    components.push(comp);
}
export function addWire(wire) {
    wires.push(wire);
}
export function addJunction(junction) {
    junctions.push(junction);
}
export function removeComponentById(id) {
    components = components.filter(c => c.id !== id);
}
export function removeWireById(id) {
    wires = wires.filter(w => w.id !== id);
}
export function findComponentById(id) {
    return components.find(c => c.id === id);
}
export function findWireById(id) {
    return wires.find(w => w.id === id);
}
// ====== Palette State ======
export let diodeSubtype = 'generic';
export let capacitorSubtype = 'standard';
export function setDiodeSubtype(subtype) {
    diodeSubtype = subtype;
}
export function setCapacitorSubtype(subtype) {
    capacitorSubtype = subtype;
}
let undoStack = [];
let redoStack = [];
const MAX_UNDO_STACK = 50;
export function captureState(netClasses, defaultResistorStyle) {
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
export function pushUndoState(state) {
    undoStack.push(state);
    if (undoStack.length > MAX_UNDO_STACK) {
        undoStack.shift();
    }
    redoStack = [];
}
export function canUndo() {
    return undoStack.length > 0;
}
export function canRedo() {
    return redoStack.length > 0;
}
export function popUndo() {
    return undoStack.pop();
}
export function pushRedo(state) {
    redoStack.push(state);
}
export function popRedo() {
    return redoStack.pop();
}
export function pushCurrentToUndo(state) {
    undoStack.push(state);
}
export function restoreStateData(state) {
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
//# sourceMappingURL=state.js.map