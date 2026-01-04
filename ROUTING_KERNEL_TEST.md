# Routing Kernel Usage Test

## Purpose

Determine if the legacy routing kernel is actually being used at runtime, or if all operations go through the KiCad kernel.

## Instrumentation Added

The RoutingFacade now logs every method call with:

- Method name
- Active kernel name (legacy/kicad/default)
- Running counters per method

## How to Test

### 1. Start the App

Open `OnlineSchematicsEditor.html` in your browser with DevTools console open.

### 2. Check Initial State

In the console, you should see:

```
[RoutingFacade] Instrumentation active. Use window.routingStats.get() to view usage stats.
```

### 3. Perform Wire Operations

Test each of these operations and watch the console for `[RoutingFacade]` logs:

#### A. Place Wire

1. Click "Wire" mode button
2. Click to start a wire
3. Move mouse (should log `updatePlacement`)
4. Click to add corner (should log `commitCorner`)
5. Right-click or double-click to finish (should log `finishPlacement`)

#### B. Move Endpoint

1. Switch to "Select" mode
2. Click and drag a wire endpoint
3. Release to drop

#### C. Drag Segment

1. In "Select" mode
2. Click and drag the middle of a wire segment
3. Release to drop

#### D. Add Junction

1. Click "Place Junction" button
2. Click on a wire intersection
3. Verify junction appears

#### E. Delete Wire

1. Select a wire
2. Press Delete key

#### F. Add Component

1. Place a resistor or other component
2. Note if any routing methods are called

### 4. Check Stats

In the browser console, run:

```javascript
window.routingStats.get();
```

This will display a table showing which methods were called and by which kernel.

### 5. Optional: Force KiCad Mode

Add `?routing=kicad` to the URL and repeat tests to ensure kicad kernel is used.

### 6. Optional: Strict Test

Edit `src/routing/facade.ts` and uncomment these lines in `logKernelUsage()`:

```typescript
if (kernelName === "legacy") {
  throw new Error(
    `[RoutingFacade] LEGACY kernel used in ${method}! Switch to kicad or remove legacy.`
  );
}
```

Rebuild and test. If legacy is used, the app will throw an error immediately.

## Expected Results

### If Legacy IS Used

- Console will show: `[RoutingFacade] methodName -> legacy kernel`
- Stats table will show non-zero `legacy` counts
- We need to keep legacy adapter

### If Legacy IS NOT Used

- Console will show: `[RoutingFacade] methodName -> kicad kernel` (or no logs if facade isn't called)
- Stats table will show zero `legacy` counts for all methods
- Legacy adapter can be safely removed

## Cleanup After Test

Once we determine whether legacy is used:

1. Remove instrumentation from `facade.ts` (or disable via flag)
2. If legacy is unused, remove `legacyAdapter.ts` and related code
3. Update `installRouting.ts` to only instantiate KiCad kernel
