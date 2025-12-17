# Online Schematics Editor — Take Back Control Plan (KiCad-Style Routing Kernel)

## Purpose

Your editor’s routing/connection logic has become hard to evolve because routing, snapping, component insertion, constraint management, and connectivity are tightly intertwined. The goal is to **introduce a new KiCad-style routing kernel** that can run **side-by-side** with the existing (legacy) routing, then migrate tools incrementally until the legacy routing can be retired.

This document is intended to be pasted into **GitHub Copilot** as the “program charter” and step-by-step work plan.

---

## Core principles (non-negotiables)

1. **No big-bang rewrite.** The app must remain usable after each step.
2. **Facade-first.** All UI/tools must call routing through a **single facade** so the routing implementation is swappable.
3. **Separate geometry from connectivity.** Wires are geometry. Nets are derived via connectivity rules.
4. **Deterministic behavior.** Routing operations must be predictable and testable (unit tests + golden tests).
5. **Incremental parity.** Migrate one tool/operation at a time; never regress legacy mode.

---

## Target end state

- A new kernel: `KiCadRoutingKernel` (orthogonal wire placement + simple edits like KiCad)
- A compatibility adapter: `LegacyRoutingKernelAdapter`
- A facade: `RoutingFacade` (UI/tools call **only** this)
- A feature flag: `routingKernelMode = "legacy" | "kicad"`
- Legacy routing internals no longer called from UI/tools; only via adapter (until retirement)

---

## Definitions / mental model

### Geometry objects (what users draw)
- **Wire**: a polyline consisting of points; consecutive points define segments (orthogonal/Manhattan).
- **Junction**: an explicit dot that causes connection at an intersection or T-joint (rule configurable).
- **Pin**: a component pin node with a point in world coordinates.

### Connectivity (what is electrically connected)
- **Net graph** is derived from geometry:
  - Endpoints that coincide (within snap tolerance) connect.
  - Endpoints that touch a pin connect.
  - Wire crossings connect **only if** a junction exists (recommended default; configurable).
- Connectivity is computed by a **builder**; the UI doesn’t “keep constraints alive” during drag; instead it updates geometry then recomputes connectivity.

---

## Non-goals (defer until after parity)

- Full auto-router
- Automatic “avoid components while dragging” (true obstacle routing)
- Intelligent reshaping that preserves arbitrary constraints across the diagram
- Multi-wire push-and-shove behavior like PCB routers

These can be added later **after** the kernel is stable and tool parity is achieved.

---

## Copilot operating procedure (how you should work)

**Rules for every change:**
- Keep each step small and shippable.
- Do not refactor unrelated files.
- Always list **exact files changed** and why.
- Add tests for new behavior (unit tests first).
- Default to adding new modules rather than editing legacy modules.

**Output expectation for each step:**
- Summary of change
- Files changed (path list)
- New/updated types/interfaces
- Tests added/updated
- Manual verification checklist

---

## Phase 0 — Safety rails (do first)

### 0.1 Add a feature flag (app config)
- `routingKernelMode: "legacy" | "kicad"` default `"legacy"`
- Add a dev UI toggle if your app has one (optional but helpful)

### 0.2 Add dev diagnostics (optional but recommended)
- A lightweight debug overlay/panel showing:
  - active kernel mode
  - last routing operation invoked
  - counts of calls per operation (helps prove legacy is no longer used)

**Acceptance:**
- No behavior change in legacy mode.
- You can switch mode without crashing (even if “kicad” does nothing yet).

---

## Phase 1 — Facade and legacy adapter (dependency inversion)

### 1.1 Introduce `IRoutingKernel`
Create a minimal interface that supports the operations your tools need *today*.

Example (TypeScript sketch — adjust naming to match the repo):
```ts
export interface IRoutingKernel {
  // Wire placement lifecycle
  beginWire(start: Point): void;
  updateWirePreview(cursor: Point, mods: ModifierState): void;
  commitWireCorner(): void;
  finishWire(): void;
  cancelWire(): void;

  // Hit testing
  hitTest(p: Point): HitResult | null;

  // Edits (initially may be unimplemented in KiCad kernel)
  moveWireEndpoint(wireId: string, endpointIndex: 0 | 1, newPoint: Point): void;
  dragWireSegment(wireId: string, segmentIndex: number, delta: Point): void;

  // Connectivity
  rebuildConnectivity(): void;
}
```

### 1.2 Create `RoutingFacade`
- Owns `activeKernel`
- Tools call `RoutingFacade.*` only
- `RoutingFacade` forwards to either:
  - `LegacyRoutingKernelAdapter`, or
  - `KiCadRoutingKernel`

### 1.3 Create `LegacyRoutingKernelAdapter`
- Wrap the existing routing code
- No behavior changes
- Adapter may internally call legacy functions exactly as before

**Acceptance:**
- In `legacy` mode, everything behaves exactly as before.
- UI/tools no longer import legacy routing modules directly (only facade).

---

## Phase 2 — New KiCad-style data model + connectivity builder (no UI integration yet)

### 2.1 Create model types
```ts
export type Point = { x: number; y: number };

export type Wire = {
  id: string;
  points: Point[]; // consecutive points define segments; enforce orthogonal later
};

export type Junction = { id: string; point: Point };

export type PinRef = {
  componentId: string;
  pinId: string;
  point: Point;
};

export type RoutingState = {
  wires: Map<string, Wire>;
  junctions: Map<string, Junction>;
  pins: Map<string, PinRef>; // or derived from component model
};
```

### 2.2 Connectivity builder (graph)
- Build adjacency between:
  - wire endpoints
  - junction points
  - pin points
- Use snap tolerance for “same node” grouping.
- Crossing segments do **not** connect unless junction rule enabled.

**Acceptance:**
- Unit tests:
  - endpoint-to-endpoint connects
  - endpoint-to-pin connects
  - crossing-without-junction does NOT connect
  - crossing-with-junction DOES connect
  - T-junction behavior matches your rule

---

## Phase 3 — KiCad wire placement tool (MVP)

### 3.1 Wire placement lifecycle
Implement in `KiCadRoutingKernel`:
- `beginWire(start)`
- `updateWirePreview(cursor, mods)` produces an orthogonal preview path:
  - default L-path from last fixed point to cursor
  - heuristic chooses H-then-V or V-then-H
  - modifier key flips orientation
- `commitWireCorner()` adds the corner point(s) from preview to the wire
- `finishWire()` commits the wire into `RoutingState`
- `cancelWire()` drops preview state

### 3.2 Snapping
- Snap cursor to:
  - pins
  - junctions
  - existing wire endpoints
- Keep snapping simple (no reroute around obstacles yet)

**Acceptance:**
- In `"kicad"` mode, user can place wires (even if edits/moves are not complete yet).
- Connectivity updates after finish.

---

## Phase 4 — Editing (endpoint moves, segment drags, corner insert/remove)

### 4.1 Hit testing
`hitTest(point)` should identify:
- wire endpoint
- wire segment index
- junction
- pin (if relevant)

### 4.2 Endpoint move
- Moving an endpoint updates its point (snapped)
- Rebuild connectivity

### 4.3 Segment drag (orthogonal preservation)
Dragging a segment should:
- shift the segment parallel to itself
- update adjacent points so the polyline remains orthogonal

### 4.4 Corner ops
- insert corner at segment
- remove a corner (merge segments where valid)

**Acceptance:**
- Basic edits work and are deterministic.
- Orthogonality preserved.
- Connectivity rebuilt after every edit.

---

## Phase 5 — Component move integration (minimal predictable rules)

### Rule
- If a wire endpoint is attached/snapped to a pin, moving the component moves that endpoint by the same delta.
- Do not auto-connect from wire crossings created by movement (only endpoints/junctions).

**Acceptance:**
- Wires attached by endpoints to a component’s pins stay attached when the component moves.
- No surprise “auto reroutes” yet.

---

## Phase 6 — Parity, migration, retirement

### 6.1 Tool-by-tool migration checklist
For each tool/operation currently using legacy routing:
1. Ensure the facade has a corresponding kernel method.
2. Implement in KiCad kernel.
3. Add unit tests.
4. Verify manual behavior.
5. Keep legacy adapter intact until parity proven.

### 6.2 Prove legacy is unused
- Add counters / logs in facade showing which kernel handles which operations.
- When all operations are supported by KiCad kernel, set default mode to `"kicad"`.
- Keep legacy mode available for a short stabilization window.

### 6.3 Retire legacy routing
- Remove legacy routing imports from adapter
- Delete dead code only after the above proof exists and tests are green

---

## Acceptance gates (definition of “done” per milestone)

### Milestone A — “Facade complete”
- UI/tools depend only on facade
- Legacy mode unchanged

### Milestone B — “Wire placement complete”
- KiCad mode can draw wires reliably with snapping
- Connectivity computed

### Milestone C — “Editing complete”
- Endpoint + segment edit parity for wires
- Component move keeps attached endpoints

### Milestone D — “Legacy retirement ready”
- KiCad mode covers all essential routing operations
- Legacy adapter sees zero calls in normal use (verified via counters/logs)

---

## Suggested next prompt to Copilot (start work)

Paste this into Copilot after you paste the full document:

```text
Implement Phase 1 (Facade + LegacyRoutingKernelAdapter) first.

Constraints:
- NO behavior changes in legacy mode.
- Tools/UI must call RoutingFacade only.
- List exact files changed and keep changes minimal.
- Add at least one small test or runtime assert proving tools no longer call legacy routing directly.

Proceed step-by-step and stop after Phase 1 is complete with build passing.
```
