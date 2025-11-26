# Code Refactoring - Migration Guide

## Overview

This document tracks the ongoing refactoring of app.ts (7,685 lines) into modular files.

## Completed (Phase 1)

### ✅ geometry.ts (235 lines)

**Purpose:** Geometric calculations and point/line operations

**Exported Functions:**

```typescript
// Point operations
keyPt(p: Point): string
eqN(a: number, b: number, eps?: number): boolean
eqPtEps(a: Point, b: Point, eps?: number): boolean
samePt(a: Point | null, b: Point | null): boolean

// Distance & projection
dist(a: Point, b: Point): number
dist2(a: Point, b: Point): number
projectPointToSegmentWithT(p, a, b): {proj: Point, t: number}
nearestPointOnSegment(p, a, b): Point

// Array utilities
indexOfPointEps(pts: Point[], p: Point, eps?: number): number
collapseDuplicateVertices(pts: Point[]): Point[]
orderPointsEndingAt(pts: Point[], pin: Point): Point[]
orderPointsStartingAt(pts: Point[], pin: Point): Point[]

// Polyline operations
normalizedPolylineOrNull(pts: Point[] | undefined): Point[] | null
nearestSegmentIndex(pts: Point[], p: Point): {index, dist, proj} | null
midOfSeg(pts: Point[], idx: number): Point

// Intersection
axisAlignedIntersection(a1, a2, b1, b2): Point | null
```

**Usage in app.ts:**

```typescript
import * as Geometry from './geometry.js';

// Instead of: const key = keyPt(point);
const key = Geometry.keyPt(point);

// Instead of: if (eqN(a, b)) ...
if (Geometry.eqN(a, b)) ...
```

### ✅ state.ts (240 lines)

**Purpose:** Application state management, undo/redo

**Exported State Variables:**

```typescript
components: Component[]
wires: Wire[]
junctions: Junction[]
selection: Selection
counters: CounterMap
nets: Set<string>
activeNetClass: string
diodeSubtype: DiodeSubtype
capacitorSubtype: CapacitorSubtype
```

**Exported Functions:**

```typescript
// ID generation
uid(prefix: CounterKey): string
resetCounters(): void

// State accessors
setSelection(sel: Selection): void
setActiveNetClass(name: string): void
setDiodeSubtype(subtype: DiodeSubtype): void
setCapacitorSubtype(subtype: CapacitorSubtype): void

// Net management
addNetToSet(name: string): void
deleteNetFromSet(name: string): void

// Component/Wire CRUD
setComponents(newComponents: Component[]): void
setWires(newWires: Wire[]): void
setJunctions(newJunctions: Junction[]): void
addComponent(comp: Component): void
addWire(wire: Wire): void
addJunction(junction: Junction): void
removeComponentById(id: string): void
removeWireById(id: string): void
findComponentById(id: string): Component | undefined
findWireById(id: string): Wire | undefined

// Undo/Redo
captureState(netClasses, defaultResistorStyle): EditorState
restoreStateData(state: EditorState): void
pushUndoState(state: EditorState): void
pushCurrentToUndo(state: EditorState): void
pushRedo(state: EditorState): void
canUndo(): boolean
canRedo(): boolean
popUndo(): EditorState | undefined
popRedo(): EditorState | undefined
clearUndoRedo(): void

// State reset
clearAllState(): void
```

**Usage in app.ts:**

```typescript
import * as State from "./state.js";

// Access state
console.log(State.components.length);
const comp = State.findComponentById("resistor1");

// Modify state
State.addComponent(newComp);
State.setSelection({ kind: "component", id: "resistor1", segIndex: null });

// Undo/Redo
if (State.canUndo()) {
  const prevState = State.popUndo();
  State.restoreStateData(prevState);
}
```

## Migration Status

### app.ts - Current State

- **Total lines:** 7,685
- **Duplicated geometry code:** Lines 6198-6320 (can be removed after migration)
- **Duplicated state code:** Lines 412-533 (undo/redo functions need adapter)
- **Strategy:** Hybrid coexistence - new code uses modules, old code migrated incrementally

### Key Areas Not Yet Migrated

1. **Local state variables** (lines 412-419)

   - `let components`, `let wires`, `let counters` etc.
   - These shadow the State module exports
   - Need to gradually replace with State module references

2. **Undo/Redo implementation** (lines 437-533)

   - Has app-specific dependencies (NET_CLASSES, WIRE_DEFAULTS, rebuildTopology, etc.)
   - Needs wrapper functions in app.ts that call State module

3. **Geometry functions** (lines 6198-6320)
   - Duplicates Geometry module
   - Can be safely removed after verifying all calls use Geometry.\*

## Next Steps (Phase 2)

### Option A: Continue Extraction (More Modules)

Create additional modules:

- **components.ts** - Component creation, drawing, pin calculation
- **wires.ts** - Wire operations, breaking, mending
- **topology.ts** - Junction detection, SWP building
- **rendering.ts** - SVG drawing, grid, overlays

### Option B: Migrate Existing Code (Use Current Modules)

Replace app.ts implementations with module calls:

1. Replace all `keyPt(p)` → `Geometry.keyPt(p)`
2. Replace all `eqN(a, b)` → `Geometry.eqN(a, b)`
3. Create adapter functions for undo/redo
4. Remove duplicate code sections

### Option C: Hybrid (Recommended)

- Keep creating new modules for clearly separable code
- Use new modules in new features and bug fixes
- Migrate existing code opportunistically when touched
- No rush, no breaking changes

## Benefits Achieved So Far

✅ Reduced mental model - geometry and state logic externalized
✅ Improved code organization - clear separation of concerns
✅ Better for AI tooling - smaller context windows
✅ Foundation for testing - modules can be unit tested
✅ Build still passes - no regressions

## Risks & Mitigation

**Risk:** Breaking existing functionality during migration
**Mitigation:** Hybrid approach - keep both versions, migrate gradually

**Risk:** State synchronization issues between local vars and State module
**Mitigation:** Don't remove local vars yet - just add module usage for new code

**Risk:** Increased complexity during transition period
**Mitigation:** Clear documentation (this file!), consistent naming patterns

## Decision Point

The refactoring has successfully created a foundation. Now we can choose:

1. **Continue creating modules** - Extract more subsystems
2. **Migrate existing code** - Replace app.ts internals with module calls
3. **Pause and use** - Use new modules for new features, migrate opportunistically

All three approaches are valid. The hybrid/opportunistic approach (option 3) is lowest risk.
