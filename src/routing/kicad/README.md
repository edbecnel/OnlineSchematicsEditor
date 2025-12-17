# KiCad Routing Kernel — Phase 2 Scaffolding

This folder contains the self-contained model and connectivity logic for the future KiCad-style routing kernel. Phase 2 focuses on data types and a pure connectivity derivation with unit tests. There is NO runtime wiring to the app and NO behavior changes to legacy routing.

## Scope (Phase 2)

- Types: `KPoint`, `KWire`, `KJunction`, `KPinRef`, `RoutingState`.
- Connectivity builder: `deriveConnectivity(state)`.
- Unit tests validating connection rules.

## Connection Rules

- Wire endpoints of the same wire are electrically continuous.
- Endpoints within tolerance connect (endpoint ↔ endpoint).
- Endpoints within tolerance connect to pins (endpoint ↔ pin).
- Crossings do NOT connect by default.
- Crossings or T-junctions DO connect only when an explicit junction exists at the crossing point (within tolerance).

## Files

- Model/types: [model.ts](./model.ts)
- Connectivity: [connectivity.ts](./connectivity.ts)
- Tests: [tests/connectivity.test.ts](./tests/connectivity.test.ts)

## Run Tests

```
npm run test:kicad
```

Expected output includes: `[kicad-connectivity-tests] All tests passed`.

## Notes

- This phase is isolated under this folder. Do not modify UI/tools or routing facade here.
- Tolerance is a Euclidean distance in the same units as coordinates.
