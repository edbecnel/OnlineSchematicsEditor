# Constraint System Testing Guide - Step by Step

## What We Just Did (Step 1: Foundation)

✅ Added constraint system imports to `app.ts`
✅ Created `constraintSolver` instance (initialized but not yet used)
✅ Added `USE_CONSTRAINTS` feature flag (default: false)
✅ Made flag accessible from browser console for easy testing
✅ Initialized on app startup (no behavior changes yet)

**Current Status**: Constraint system is loaded but does nothing. Your app works exactly as before.

---

## Testing Step 1: Verify Initialization

1. Open `OnlineSchematicsEditor.html` in your browser
2. Open browser console (F12)
3. You should see: `✅ Constraint system initialized`
4. Try in console:

```javascript
// Check it's loaded
constraintSolver;
// Output: ConstraintSolver { ... }

// Check the flag (should be false)
USE_CONSTRAINTS;
// Output: false

// Try enabling it
USE_CONSTRAINTS = true;
// Output: "Constraint system ENABLED"

// Disable it
USE_CONSTRAINTS = false;
// Output: "Constraint system DISABLED"
```

**Expected**: Everything works normally, constraint system is idle.

---

## Next Step: Grid Snapping Constraint

Once you've verified Step 1 works, we'll add the simplest constraint:

### Step 2: Grid Snap (Coming Next)

We'll modify the `snap()` function to optionally use constraints for grid snapping. This is the safest first constraint because:

- It only affects positioning (no topology changes)
- Easy to verify visually
- Can be toggled on/off instantly
- If it fails, existing snap() still works

### Implementation Plan:

```typescript
// In snap() function
function snap(v: number): number {
  if (USE_CONSTRAINTS && constraintSolver) {
    // Use constraint-based snapping
    // (we'll add this next)
  }

  // Existing snap logic (fallback)
  const userU = /* existing code */
  // ... rest of existing code
}
```

### How to Test Step 2 (when we add it):

1. Place a component
2. Move it around
3. Check console: `USE_CONSTRAINTS = false` → old behavior
4. Enable: `USE_CONSTRAINTS = true` → should snap identically
5. Compare coordinates in inspector (should be identical)

---

## Step 3: Component Movement (IMPLEMENTED - Ready to Test)

### What We Added:

✅ `syncConstraints()` - Populates constraint graph with components
✅ `getComponentPinExtent()` - Calculates max pin distance from component center
✅ `updateConstraintPositions()` - Syncs all component positions to constraint graph during drags
✅ `moveComponentWithConstraints()` - Uses solver for keyboard movement
✅ Modified `moveSelectedBy()` to branch to constraint-based logic
✅ **Dynamic min-distance calculation** - Based on actual pin extents: `extent₁ + extent₂ - GRID`
✅ **Mouse drag constraint checking** - All 5 drag handlers update positions before solving
✅ Auto-sync when enabling `USE_CONSTRAINTS = true`
✅ Auto-sync after `rebuildTopology()`

### How to Test Step 3:

**1. Open the app in browser** (navigate to `OnlineSchematicsEditor.html`)

**2. Place 2 components:**

- Click on a component type (e.g., resistor)
- Click to place one
- Click again to place another nearby

**3. Enable constraints in console:**

```javascript
USE_CONSTRAINTS = true;
```

- Should see: `Constraint system ENABLED`
- Should see: `Synced N components with constraint solver`

**4. Test movement:**

- Select one component (click on it)
- Use **arrow keys** to move it
- Observe:
  - ✅ Component snaps to grid
  - ✅ Component cannot overlap the other component (should stop or adjust when getting too close)

**5. Check console for messages:**

- Look for: `Synced N components with constraint solver`
- Look for violation warnings if you try to overlap components

**6. Test with constraints disabled:**

```javascript
USE_CONSTRAINTS = false;
```

- Move should work normally (old behavior)

**7. Re-enable and test selection:**

```javascript
USE_CONSTRAINTS = true;
```

- Select multiple components
- Move them together - they should maintain spacing

### What's happening under the hood:

- When you enable `USE_CONSTRAINTS`, it calls `syncConstraints()` to populate the constraint graph
- Each component gets a grid-snap constraint (priority 50)
- For each component pair, the system:
  - Calculates pin extent (distance from center to furthest pin) for both components
  - Sets min-distance = extent₁ + extent₂ - GRID (allows 25-mil pin overlap)
  - Example: Two resistors with 50-mil pins → min-distance = 50 + 50 - 25 = **75 mils center-to-center**
    - This means pins at 50 mils from each center can overlap/connect
  - Example: Resistor (50-mil pins) + Ground (2-mil pin) → min-distance = 50 + 2 - 25 = **27 mils**
- Each pair of components gets a min-distance constraint (priority 70) with calculated distance
- When you move, `moveComponentWithConstraints()` calls `solver.solve()` to check/adjust the position
- Topology rebuild also syncs constraints automatically

---

## Step 4: Wire Stretching (After Step 3)

Once component movement works via constraints, we'll add:

- Fixed-axis constraint (SWP movement)
- Connected constraint (wire endpoints)
- Each tested independently

---

## Testing Philosophy

- ✅ One constraint at a time
- ✅ Feature flag lets you A/B compare
- ✅ Old code always works (fallback)
- ✅ Verify visually AND check coordinates
- ✅ Test with flag OFF first (ensure no regression)

---

## Current Testing Checklist

### Step 1: Initialization ✅

- [ ] App loads without errors
- [ ] Console shows "Constraint system initialized"
- [ ] `USE_CONSTRAINTS` flag is accessible
- [ ] Toggling flag shows messages
- [ ] `constraintSolver` object exists in console
- [ ] App works normally (flag is false by default)
- [ ] No TypeScript/console errors

### Step 3: Component Movement (Current)

- [ ] Place 2 components successfully
- [ ] Enable `USE_CONSTRAINTS = true`
- [ ] See "Synced N components" message
- [ ] Select component and move with arrow keys
- [ ] Component snaps to grid
- [ ] Component cannot overlap other component
- [ ] Disable `USE_CONSTRAINTS = false` → movement works normally
- [ ] Re-enable and test multi-select movement

Once these pass, you're ready for Step 4!

---

## Rollback

If anything breaks:

1. Set `USE_CONSTRAINTS = false` in console → app works normally
2. Or revert code: `git checkout src/app.ts`
