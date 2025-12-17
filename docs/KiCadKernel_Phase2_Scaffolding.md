# KiCad Kernel — Phase 2 Scaffolding

This note references the KiCad-style routing scaffolding added in Phase 2. It is self-contained and does not alter runtime behavior.

## Location

- Model/types: [src/routing/kicad/model.ts](src/routing/kicad/model.ts)
- Connectivity: [src/routing/kicad/connectivity.ts](src/routing/kicad/connectivity.ts)
- Tests: [src/routing/kicad/tests/connectivity.test.ts](src/routing/kicad/tests/connectivity.test.ts)

## What it does

- Defines basic model types (`KPoint`, `KWire`, `KJunction`, `KPinRef`, `RoutingState`).
- Implements `deriveConnectivity()` to group endpoints/pins/junctions into nets using distance tolerance rules:
  - Endpoint↔Endpoint connect within tolerance.
  - Endpoint↔Pin connect within tolerance.
  - Crossings do NOT connect by default.
  - Crossings/T-junctions DO connect only with an explicit junction at that point.

## How to run tests

```bash
npm run test:kicad
```

Expected: the test runner prints: `[kicad-connectivity-tests] All tests passed`.

## Notes

- No UI or facade wiring is included in this phase; legacy behavior remains unchanged.
