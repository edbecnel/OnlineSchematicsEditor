/**
 * Constraint-based movement system
 * Declarative rules for component, wire, and junction movement
 */
// ====== Priority Levels (Standard Values) ======
export const PRIORITY = {
    MANUAL_JUNCTION: 200, // User-placed junctions cannot move
    COMPONENT_CONNECTION: 150, // Component pins stay connected to wires
    AUTO_JUNCTION: 120, // Automatic T-junctions
    TOPOLOGY: 100, // Maintain wire topology
    RUBBER_BAND: 90, // Perpendicular wires stretch together
    ORTHOGONAL: 80, // Wires stay horizontal/vertical
    NO_OVERLAP: 70, // Prevent component overlap
    MIN_DISTANCE: 60, // Minimum separation
    GRID_SNAP: 50, // Snap to grid (lowest priority)
    ALIGN: 40 // Alignment hints
};
//# sourceMappingURL=types.js.map