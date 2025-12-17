# Online Schematics Editor - Code Organization

> See the documentation index for a curated overview and quick links: [docs/INDEX.md](INDEX.md)

## File Structure

The application is organized as a single file (`src/app.ts`) with clear section markers for navigation.

## Main Sections

### 1. UTILITIES & HELPERS (Lines ~1-200)

- DOM utilities: `$q`, `$qa`, `setAttr`, `getClientXY`
- Color conversion: `cssToRGBA01`, `rgba01ToCss`, `colorToHex`
- Geometry helpers (defined throughout, mainly in section 6)
- Unit conversion (mainly in Inspector section)

### 2. CONSTANTS & CONFIGURATION (Lines ~90-200)

- `GRID` - Grid size in pixels (25px)
- `NM_PER_MM`, `NM_PER_IN`, `NM_PER_MIL` - Nanometer conversions
- `SNAP_NM` - Snapping resolution
- `BASE_W`, `BASE_H` - Viewport dimensions
- `HINT_SNAP_TOLERANCE_PX`, `HINT_UNLOCK_THRESHOLD_PX` - Connection hints

### 3. STATE MANAGEMENT (Lines ~565-650)

- `counters` - Component ID counters
- `components`, `wires` - Core model arrays
- `nets`, `activeNetClass` - Net class system
- `THEME`, `NET_CLASSES` - Styling configuration
- `mode`, `placeType`, `selection` - Interaction state
- `zoom`, `viewX`, `viewY` - View state
- `drawing`, `marquee` - Drawing state

### 4. TYPES & INTERFACES (Lines ~200-330)

- `Mode`, `PlaceType` - Editor modes
- `Selection` - Selection state type
- `Drawing`, `Marquee` - Drawing state types
- `Topology`, `TopologyNode`, `TopologyEdge`, `WireSpan` - Connectivity types

### 5. DOM REFERENCES (Lines ~120-150)

- `svg` - Main SVG element
- `gWires`, `gComps`, `gJunctions`, `gDrawing`, `gOverlay` - SVG layers
- `inspector`, `projTitle`, `countsEl` - UI elements

### 6. CORE RENDERING (Lines ~280-2500)

- `redrawGrid()` - Grid line/dot rendering
- `drawComponent()` - Component symbol rendering
- `buildSymbolGroup()` - Component SVG construction
- `updateWireDOM()` - Wire path updates
- `renderJunctions()` - Junction dot rendering
- `redrawCanvasOnly()` - Wire/component redraw
- `redraw()` - Full canvas redraw

### 7. NET CLASSES & CONNECTIVITY (Lines ~515-530, 5500-6000)

- `netClassForWire()` - Determine wire's net class
- `effectiveStroke()` - Calculate effective stroke from net class
- `renderNetList()` - Net class UI
- `showNetPropertiesDialog()` - Net editing dialog
- `buildTopology()` - Analyze connections (SWPs, nodes, edges)
- `restrokeSwpSegments()` - Apply stroke changes

### 8. INTERACTION HANDLERS (Lines ~2500-3550)

- Mouse/pointer events: `pointerdown`, `pointermove`, `pointerup`
- Keyboard shortcuts: Arrow keys, Delete, Escape, etc.
- Pan and zoom: Middle mouse drag, wheel zoom
- Wire drawing: Click-to-place orthogonal wires
- Component placement: Drop-to-place with rotation
- Selection and move: Click-select, drag-move

### 9. UI COMPONENTS (Lines ~3550-5400)

- **Toolbar**: Mode buttons, wire stroke, grid toggle, zoom
- **Inspector**: Property editing for selected components/wires
- **Dialogs**: Net properties, wire stroke configuration
- **Panels**: Project info, nets list, component palette

### 10. SERIALIZATION (Lines ~5400-5500)

- `serializeCanvas()` - Convert to JSON
- `loadFromJson()` - Restore from JSON
- `exportKicad()` - Export to KiCad format

### 11. INITIALIZATION (Lines ~6000-6230)

- `resetCanvas()` - Clear and initialize
- Panel setup: Resizable/collapsible panels
- Event binding: Global shortcuts, UI interactions
- Initial render: `updateCounts()`, `redraw()`

## Navigation Tips

### Finding Functionality

Use your editor's search (Ctrl+F) with these patterns:

- Functions: `function functionName(`
- Section markers: `// ======` or `// ====`
- State variables: Search for the variable name
- Event handlers: Search for `.addEventListener`

### Common Patterns

- **To change rendering**: Look in section 6 (CORE RENDERING)
- **To add UI controls**: Look in section 9 (UI COMPONENTS)
- **To modify interaction**: Look in section 8 (INTERACTION HANDLERS)
- **To change net logic**: Look in section 7 (NET CLASSES & CONNECTIVITY)
- **To adjust state**: Look in section 3 (STATE MANAGEMENT)

## Code Conventions

- **Constants**: UPPER_SNAKE_CASE
- **Functions**: camelCase
- **Types**: PascalCase
- **State variables**: camelCase with `let`
- **Immutable config**: camelCase with `const`

## Future Modularization

When ready to split into modules, consider this grouping:

1. `constants.ts` - All constants from section 2
2. `types.ts` - Already exists, expand with section 4 types
3. `state.ts` - State management from section 3
4. `rendering.ts` - Section 6 functions
5. `geometry.ts` - Geometric utilities
6. `nets.ts` - Section 7 net logic
7. `interaction.ts` - Section 8 handlers
8. `ui/` folder - Section 9 components (toolbar.ts, inspector.ts, dialogs.ts)
9. `serialization.ts` - Section 10 save/load
10. `main.ts` - Section 11 initialization

\*\*\* End Patch
