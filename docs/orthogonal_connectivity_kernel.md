# Orthogonal Connectivity Kernel Plan

## 1. Overall Goals

- Replace the fragile constraint engine with a predictable, KiCad-style orthogonal connectivity model.
- Centralize responsibility for electrical connectivity in a dedicated kernel that other systems query.
- Simplify wire behavior to improve maintainability and reduce bugs during editing operations.

## 2. Data Model

- **Node**
  - `id`: unique identifier.
  - `x`, `y`: world coordinates.
  - `pinRef?`: optional `{ componentId, pinId }` linking to a component pin.
- **Segment**
  - `id`: unique identifier.
  - `fromNodeId`, `toNodeId`: endpoints (must reference existing nodes).
  - `netId`: identifier of the net the segment belongs to.
- **Net**
  - `id`: unique identifier.
  - `name?`: optional human-friendly label.
  - `color?`: optional display hint.

## 3. Core Kernel Operations

- `createNode(x, y, pinRef?)`: add a node; returns node id.
- `moveNode(nodeId, newX, newY)`: relocate a node; updates attached segments.
- `createSegment(fromNodeId, toNodeId)`: add an orthogonal segment; validates endpoints.
- `splitSegment(segmentId, atX, atY)`: insert a node on a segment, replacing it with two segments.
- `mergeNodes(nodeA, nodeB)`: reconcile duplicates, unify attached segments, update nets.
- `deleteSegment(segmentId)`: remove a segment; cleans up orphaned nets.
- `deleteNode(nodeId)`: remove a node when free of segments/pins.
- `addPinNode(componentId, pinId, x, y)`: create or register a node tied to a component pin.
- `removePinNode(componentId, pinId)`: detach the pin node during component removal.
- `rebuildNets()`: recompute connected components and net ids, applying names/colors where available.

## 4. Desired Editing Behavior

- Orthogonal wire placement with dynamic HV/VH L-shaped previews for user feedback.
- Automatic segment splitting and junction node creation when finishing on an existing segment.
- Rubber-banding by updating pin node positions when components move so connected wires follow.

## 5. Migration Strategy

- Implement the new connectivity kernel alongside the existing constraint engine.
- Route newly created documents through the kernel while legacy documents continue using the current system.
- Gradually port editing tools to kernel-backed implementations, retiring legacy logic once feature parity is achieved.
