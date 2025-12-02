/**
 * Wire stretching and segment movement operations.
 * Handles dragging wire segments while maintaining connections to components and other wires.
 */
/**
 * Determine if a point is a junction (has multiple wires meeting)
 */
function isJunctionPoint(ctx, pt) {
    const wires = ctx.wiresEndingAt(pt);
    return wires.length > 2; // Junction if 3+ wires meet
}
/**
 * Determine if a point is connected to a component pin
 */
function isComponentPin(ctx, pt) {
    // Check if any component has a pin at this point
    // This is a simplified check - you may need to use compPinPositions function
    for (const c of ctx.components) {
        // Approximate check - needs proper pin position calculation
        const pinRadius = 50; // Typical pin offset
        if (Math.abs(c.x - pt.x) < 5 && (Math.abs(c.y - pinRadius - pt.y) < 5 || Math.abs(c.y + pinRadius - pt.y) < 5)) {
            return true;
        }
        if (Math.abs(c.y - pt.y) < 5 && (Math.abs(c.x - pinRadius - pt.x) < 5 || Math.abs(c.x + pinRadius - pt.x) < 5)) {
            return true;
        }
    }
    return false;
}
/**
 * Find explicit junction dot at a point
 */
function hasJunctionDot(ctx, pt) {
    return ctx.junctions.some(j => !j.suppressed && Math.hypot(j.at.x - pt.x, j.at.y - pt.y) < 5);
}
/**
 * Initialize wire stretch state when user starts dragging a wire segment
 */
export function beginWireStretch(ctx, wire, segmentIndex, startMousePos) {
    if (segmentIndex < 0 || segmentIndex >= wire.points.length - 1) {
        return null; // Invalid segment index
    }
    const p0 = wire.points[segmentIndex];
    const p1 = wire.points[segmentIndex + 1];
    // Determine axis
    let axis;
    if (Math.abs(p0.x - p1.x) < 1) {
        axis = 'y'; // Vertical segment
    }
    else if (Math.abs(p0.y - p1.y) < 1) {
        axis = 'x'; // Horizontal segment
    }
    else {
        return null; // Non-orthogonal segment can't be stretched
    }
    // Determine anchor points (junctions, component pins, or segment endpoints)
    // Junction dots serve as anchor points that can't be moved
    const anchorStart = { ...p0 };
    const anchorEnd = { ...p1 };
    // Check if endpoints are anchored by junctions or components
    const startIsJunction = hasJunctionDot(ctx, p0) || isJunctionPoint(ctx, p0);
    const endIsJunction = hasJunctionDot(ctx, p1) || isJunctionPoint(ctx, p1);
    const startIsComponent = isComponentPin(ctx, p0);
    const endIsComponent = isComponentPin(ctx, p1);
    // For now, both ends can move unless they're at a junction dot or component
    const movingEdgeStart = !startIsJunction && !startIsComponent;
    const movingEdgeEnd = !endIsJunction && !endIsComponent;
    return {
        wireId: wire.id,
        draggedSegmentIndex: segmentIndex,
        startPos: { ...startMousePos },
        axis,
        originalPoints: wire.points.map(p => ({ ...p })),
        anchorStart,
        anchorEnd,
        movingEdgeStart,
        movingEdgeEnd
    };
}
/**
 * Update wire geometry during drag
 */
export function updateWireStretch(ctx, state, currentMousePos, wire) {
    const delta = state.axis === 'x'
        ? currentMousePos.y - state.startPos.y
        : currentMousePos.x - state.startPos.x;
    const snappedDelta = ctx.snap(delta);
    // Simple case: single segment wire
    if (wire.points.length === 2) {
        // Move the dragged segment perpendicular to its axis
        if (state.axis === 'x') {
            // Horizontal segment - move vertically
            const newY = ctx.snap(state.originalPoints[0].y + snappedDelta);
            wire.points[0].y = newY;
            wire.points[1].y = newY;
        }
        else {
            // Vertical segment - move horizontally
            const newX = ctx.snap(state.originalPoints[0].x + snappedDelta);
            wire.points[0].x = newX;
            wire.points[1].x = newX;
        }
    }
    else {
        // Multi-segment wire: need to add/modify connecting segments
        // This is more complex and will be implemented in the next iteration
        // For now, just move the segment if it's interior
        const seg = state.draggedSegmentIndex;
        if (state.axis === 'x') {
            // Horizontal segment - move vertically
            const newY = ctx.snap(state.originalPoints[seg].y + snappedDelta);
            wire.points[seg].y = newY;
            wire.points[seg + 1].y = newY;
        }
        else {
            // Vertical segment - move horizontally
            const newX = ctx.snap(state.originalPoints[seg].x + snappedDelta);
            wire.points[seg].x = newX;
            wire.points[seg + 1].x = newX;
        }
    }
}
/**
 * Finalize wire stretch when drag ends
 */
export function finishWireStretch(ctx, state, wire) {
    // Normalize wire (remove redundant points, etc.)
    // This will be called after updateWireStretch
    // TODO: Add logic to:
    // 1. Create new wire segments if needed to maintain connections
    // 2. Update adjacent wires
    // 3. Normalize/clean up geometry
}
//# sourceMappingURL=wireStretch.js.map