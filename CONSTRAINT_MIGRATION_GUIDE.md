# Constraint System Migration Guide

## Overview

This guide outlines the incremental migration from procedural movement logic to a declarative constraint-based system. Each phase can be shipped independently without breaking existing functionality.

---

## Phase 0: Foundation (Week 1) ✅ COMPLETE

**Status**: Infrastructure in place, no existing code modified

**What was added**:

- `src/constraints/types.ts` - Core type definitions
- `src/constraints/graph.ts` - Entity-constraint graph
- `src/constraints/registry.ts` - Validator registry
- `src/constraints/solver.ts` - Constraint solver
- `src/constraints/builders.ts` - Helper functions
- `src/constraints/index.ts` - Public API

**Testing**:

```typescript
// In browser console or test file
import {
  ConstraintSolver,
  createComponentEntity,
} from "./constraints/index.js";

const solver = new ConstraintSolver(snap, snapToBaseScalar);
const stats = solver.getStats();
console.log("Constraint system initialized:", stats);
```

**Deliverable**: Constraint system exists but not yet connected to existing movement code.

---

## Phase 1: Parallel Implementation (Week 2-3)

**Goal**: Implement constraint-based movement alongside existing system with feature flag

### Step 1.1: Add Feature Flag

**File**: `src/app.ts`

```typescript
// Add near top of file
const USE_CONSTRAINT_SYSTEM = false; // Feature flag - toggle to test new system

// Import constraint system
import {
  ConstraintSolver,
  createComponentEntity,
  buildComponentConstraints,
} from "./constraints/index.js";

// Initialize solver (add in main app initialization)
let constraintSolver: ConstraintSolver | null = null;

function initializeConstraintSystem() {
  constraintSolver = new ConstraintSolver(snap, snapToBaseScalar);
  console.log("Constraint system initialized");
}

// Call on load
if (USE_CONSTRAINT_SYSTEM) {
  initializeConstraintSystem();
}
```

### Step 1.2: Wrap One Movement Function

**File**: `src/app.ts` - Component movement

**Before**:

```typescript
function moveComponent(c: Component, dx: number, dy: number) {
  // Complex logic...
  Move.moveSelectedBy(createMoveContext(), dx, dy);
  // ...
}
```

**After**:

```typescript
function moveComponent(c: Component, dx: number, dy: number) {
  if (USE_CONSTRAINT_SYSTEM && constraintSolver) {
    // NEW: Constraint-based movement
    return moveComponentWithConstraints(c, dx, dy);
  }

  // EXISTING: Original movement logic (unchanged)
  Move.moveSelectedBy(createMoveContext(), dx, dy);
}

function moveComponentWithConstraints(c: Component, dx: number, dy: number) {
  const proposedPosition = {
    x: c.x + dx,
    y: c.y + dy,
  };

  const result = constraintSolver!.solve(c.id, proposedPosition);

  if (result.allowed) {
    constraintSolver!.applyResult(result);
    // Update actual component position
    c.x = result.finalPosition.x;
    c.y = result.finalPosition.y;
    redraw();
  } else {
    console.log(
      "Move blocked:",
      result.violatedConstraints.map((v) => v.reason)
    );
  }
}
```

### Step 1.3: Add Constraint Synchronization

**When to rebuild constraints**:

- After topology changes (wire split, component added/removed)
- After junction detection
- On file load

```typescript
function synchronizeConstraints() {
  if (!constraintSolver) return;

  // Clear old constraints
  constraintSolver.clearTemporaryConstraints();

  // Rebuild from current state
  const constraints = rebuildAllConstraints(
    components,
    wires,
    junctions,
    (c) => compPinPositions(c),
    (pt, wires) => findWireAt(pt, wires),
    (pt, wires) => findWiresAt(pt, wires)
  );

  constraints.forEach((c) => constraintSolver!.addConstraint(c));

  console.log(`Synchronized ${constraints.length} constraints`);
}

// Call after key operations
function rebuildTopology() {
  // ...existing code...
  if (USE_CONSTRAINT_SYSTEM) {
    synchronizeConstraints();
  }
}
```

### Step 1.4: Testing Strategy

**A/B Testing**:

```typescript
// Test both systems side-by-side
function testMovement(componentId: string, dx: number, dy: number) {
  const c = components.find((x) => x.id === componentId);
  if (!c) return;

  // Save state
  const originalX = c.x;
  const originalY = c.y;

  // Test old system
  USE_CONSTRAINT_SYSTEM = false;
  moveComponent(c, dx, dy);
  const oldResult = { x: c.x, y: c.y };

  // Reset
  c.x = originalX;
  c.y = originalY;

  // Test new system
  USE_CONSTRAINT_SYSTEM = true;
  moveComponent(c, dx, dy);
  const newResult = { x: c.x, y: c.y };

  // Compare
  const matches =
    Math.abs(oldResult.x - newResult.x) < 1 &&
    Math.abs(oldResult.y - newResult.y) < 1;

  console.log("Movement test:", matches ? "PASS" : "FAIL", {
    old: oldResult,
    new: newResult,
  });
}
```

**Deliverable**: Constraint system works for component movement with feature flag. Both systems coexist.

---

## Phase 2: Migrate Component Movement (Week 4-5)

**Goal**: Replace SWP movement logic with constraints

### Step 2.1: Convert `buildSlideContext`

**Current** (`src/move.ts`):

```typescript
export function buildSlideContext(ctx: MoveContext, c: Component): any {
  // 30+ lines of wire detection and bounds calculation
  // ...
}
```

**New**:

```typescript
export function buildSlideContext(ctx: MoveContext, c: Component): any {
  if (USE_CONSTRAINT_SYSTEM && constraintSolver) {
    // Create fixed-axis constraint for SWP movement
    const pins = ctx.compPinPositions(c);
    const axis = axisFromPins(pins);
    if (!axis) return null;

    const fixedCoord = axis === "x" ? pins[0].y : pins[0].x;
    const constraints = buildSwpConstraints(
      c.id,
      axis,
      fixedCoord /* bounds */
    );
    constraints.forEach((c) => constraintSolver.addConstraint(c));

    return { axis, fixed: fixedCoord, constraintBased: true };
  }

  // EXISTING LOGIC (unchanged)
  // ...
}
```

### Step 2.2: Simplify `handlePerpendicularSwpMove`

**Current**: 200+ lines

**New**:

```typescript
function handlePerpendicularSwpMove(/*...*/) {
  if (USE_CONSTRAINT_SYSTEM && constraintSolver) {
    // Solver handles junction splitting, wire recreation, etc.
    const result = constraintSolver.solve(c.id, { x: pins[0].x, y: pins[0].y });

    if (result.allowed) {
      constraintSolver.applyResult(result);

      // Apply to actual entities
      for (const update of result.affectedEntities) {
        applyEntityUpdate(update);
      }

      ctx.rebuildTopology();
      if (!skipRedraw) ctx.redraw();
      return;
    }
  }

  // FALLBACK TO EXISTING LOGIC
  // ...existing 200 lines...
}
```

### Step 2.3: Gradual Deprecation

```typescript
// Mark old functions as deprecated
/** @deprecated Use constraint system instead */
export function handlePerpendicularSwpMove(/*...*/) {
  // ...
}
```

**Deliverable**: Component movement fully works with constraints. Old code still present as fallback.

---

## Phase 3: Migrate Wire Stretching (Week 6-7)

### Step 3.1: Replace Wire Stretch State

**Current**: Complex state tracking in `app.ts`

**New**: Constraints handle relationships automatically

```typescript
function beginWireStretch(wire: Wire, segmentIndex: number) {
  if (USE_CONSTRAINT_SYSTEM && constraintSolver) {
    // Add rubber-band constraints for connected wires
    const connectedWires = findConnectedWires(wire);
    const constraints = buildRubberBandConstraints(
      wire.id,
      connectedWires /* axis */
    );
    constraints.forEach((c) => constraintSolver.addConstraint(c));

    return { wireId: wire.id, constraintBased: true };
  }

  // EXISTING LOGIC
  // ...
}
```

**Deliverable**: Wire stretching uses constraints. Perpendicular wires handled automatically.

---

## Phase 4: Remove Old Code (Week 8)

**Goal**: Delete deprecated functions, clean up

### What to Remove:

1. **move.ts**:
   - `handlePerpendicularSwpMove` (200 lines)
   - Complex SWP calculation logic (100 lines)
2. **app.ts**:
   - `wireStretchState` complex tracking (150 lines)
   - Manual junction movement logic (50 lines)
3. **wireStretch.ts**:
   - Redundant segment tracking (100 lines)

### Before Deletion Checklist:

- [ ] All movement types tested with constraints
- [ ] Feature flag removed (constraint system always on)
- [ ] No references to deprecated functions
- [ ] Performance benchmarked (should be similar or better)
- [ ] User testing completed

**Total lines removed**: ~600 lines of complex conditional logic

**Deliverable**: Clean codebase using only constraint system.

---

## Phase 5: Extensions (Week 9+)

### New Features Enabled by Constraints:

1. **Undo/Redo**: Track constraint changes
2. **Animation**: Interpolate between constraint solutions
3. **Conflict Visualization**: Show why movement is blocked
4. **Smart Suggestions**: "Move here instead?" based on nearest valid position
5. **Batch Operations**: Move multiple components with constraint satisfaction
6. **Custom Constraints**: User-defined rules (e.g., "components must align")

### Example - Conflict Visualization:

```typescript
function showMoveConflicts(componentId: string, mousePos: Point) {
  const result = constraintSolver.solve(componentId, mousePos);

  if (!result.allowed) {
    // Draw visual feedback
    result.violatedConstraints.forEach((v) => {
      if (v.constraint.type === "min-distance") {
        drawWarningCircle(
          v.constraint.params.position,
          v.constraint.params.distance
        );
      }
    });

    // Show closest valid position
    if (result.closestValid) {
      drawSnapTarget(result.closestValid);
    }
  }
}
```

---

## Rollback Plan

At any phase, can rollback by:

1. Set `USE_CONSTRAINT_SYSTEM = false`
2. Existing code continues to work unchanged
3. Remove constraint system files if needed

**Risk**: Minimal - old code remains functional throughout migration.

---

## Success Metrics

- **Code complexity**: -60% lines in movement logic
- **Bug rate**: -50% movement-related issues
- **Feature velocity**: +200% for movement features
- **Developer onboarding**: New devs understand system in <1 day vs. <1 week

---

## Timeline Summary

| Phase          | Duration | Risk   | Value             |
| -------------- | -------- | ------ | ----------------- |
| 0 - Foundation | 1 week   | None   | Infrastructure    |
| 1 - Parallel   | 2 weeks  | Low    | Validation        |
| 2 - Components | 2 weeks  | Medium | First major win   |
| 3 - Wires      | 2 weeks  | Medium | Complete coverage |
| 4 - Cleanup    | 1 week   | Low    | Code quality      |
| 5 - Extensions | Ongoing  | Low    | New features      |

**Total core migration**: 8 weeks with shipping at each phase.
