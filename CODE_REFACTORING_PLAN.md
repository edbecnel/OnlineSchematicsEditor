# Code Refactoring Plan - Breaking up app.ts

## Current Status

- **app.ts**: ~7,680 lines - causing performance issues with AI tooling

## Proposed Module Structure

### 1. **state.ts** - Application State Management

- Global state variables (components, wires, junctions, selection, drawing)
- Undo/Redo system (captureState, restoreState, pushUndo, undo, redo)
- Counters and ID generation
- EditorState interface and related types

### 2. **geometry.ts** - Geometric Utilities

- Point/line math (distance, projection, intersection)
- Snap functions (snap, snapToBaseScalar, baseSnapUser)
- Segment utilities (nearestSegmentAtPoint, projectPointToSegmentWithT)
- Epsilon comparison functions (eqN, eqPt, keyPt)

### 3. **components.ts** - Component Management

- Component creation and placement
- Component pin calculations (compPinPositions)
- Component drawing (drawComponent, buildSymbolGroup)
- Diode subtypes drawing
- Component rotation and property management

### 4. **wires.ts** - Wire Management

- Wire creation and drawing
- Wire breaking and mending
- Wire color resolution
- Wire segment operations
- normalizeAllWires, unifyInlineWires

### 5. **topology.ts** - Topology & Junction Management

- rebuildTopology function
- Junction creation logic
- Node/edge/SWP detection
- Component bridge edges

### 6. **rendering.ts** - SVG Rendering

- redraw, redrawCanvasOnly
- Grid rendering (redrawGrid)
- Connection circles
- Selection outline
- Crosshair overlay
- Coordinate display

### 7. **ui.ts** - UI Controls & Event Handlers

- Mode switching (setMode)
- Toolbar button handlers
- Status bar controls
- Panel management
- Theme toggling

### 8. **input.ts** - User Input Handling

- Mouse event handlers (pointer events)
- Keyboard shortcuts
- Coordinate input boxes
- Polar coordinate input
- Pan and zoom controls

### 9. **inspector.ts** - Inspector Panel

- renderInspector function
- Component property editors
- Wire property editors
- Net assignment UI

### 10. **netlist.ts** - Net Management

- Net class definitions
- Net list rendering
- Net properties dialog
- Active net management

### 11. **fileio.ts** - File Operations

- JSON save/load
- KiCad export
- Clear operation

### 12. **move.ts** - Component & Wire Movement

- SWP-based movement
- Drag operations
- Marquee selection
- Slide helpers

## Implementation Strategy

1. Create new module files in src/
2. Move functions and state to appropriate modules
3. Export public APIs from each module
4. Import in app.ts and wire together
5. Test incrementally after each module extraction
6. Update tsconfig.json if needed

## Benefits

- Faster AI tooling response times
- Better code organization and maintainability
- Easier to understand each subsystem
- Reduced cognitive load when working on specific features
- Better testability (each module can be tested independently)

## Migration Order (Suggested)

1. geometry.ts (no dependencies)
2. state.ts (minimal dependencies)
3. components.ts (depends on geometry, state)
4. wires.ts (depends on geometry, state)
5. topology.ts (depends on wires, components, geometry)
6. rendering.ts (depends on most modules)
7. netlist.ts (depends on state)
8. inspector.ts (depends on state, netlist)
9. fileio.ts (depends on state)
10. move.ts (depends on topology, geometry, state)
11. ui.ts (depends on most modules)
12. input.ts (depends on ui, rendering, state)
