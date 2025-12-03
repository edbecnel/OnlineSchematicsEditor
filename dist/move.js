// move.ts - Component and wire movement logic
// Handles SWP-based component movement, slide contexts, and collision detection
// Helper to check if a component is embedded (both pins connected to single wires)
export function isEmbedded(ctx, c) {
    const pins = ctx.compPinPositions(c).map(p => ({
        x: ctx.snapToBaseScalar(p.x),
        y: ctx.snapToBaseScalar(p.y)
    }));
    if (pins.length < 2)
        return false;
    return ctx.wiresEndingAt(pins[0]).length === 1 && ctx.wiresEndingAt(pins[1]).length === 1;
}
// Helper to check if a component overlaps any other component
export function overlapsAnyOther(ctx, c) {
    const R = 56; // same as selection outline radius
    for (const o of ctx.components) {
        if (o.id === c.id)
            continue;
        const dx = o.x - c.x, dy = o.y - c.y;
        if ((dx * dx + dy * dy) < (R * R))
            return true;
    }
    return false;
}
// Test overlap if 'c' were at (x,y) without committing the move
export function overlapsAnyOtherAt(ctx, c, x, y) {
    const R = 56;
    for (const o of ctx.components) {
        if (o.id === c.id)
            continue;
        const dx = o.x - x, dy = o.y - y;
        if ((dx * dx + dy * dy) < (R * R))
            return true;
    }
    return false;
}
// Prevent a component's pins from landing exactly on another component's pins
export function pinsCoincideAnyAt(ctx, c, x, y, eps = 0.75) {
    // Compute THIS component's pins if its center were at (x,y)
    const ghost = { ...c, x, y };
    const myPins = ctx.compPinPositions(ghost).map(p => ({
        x: ctx.snap(p.x),
        y: ctx.snap(p.y)
    }));
    for (const o of ctx.components) {
        if (o.id === c.id)
            continue;
        const oPins = ctx.compPinPositions(o).map(p => ({
            x: ctx.snap(p.x),
            y: ctx.snap(p.y)
        }));
        for (const mp of myPins) {
            for (const op of oPins) {
                if (ctx.eqPtEps(mp, op, eps))
                    return true;
            }
        }
    }
    return false;
}
// Determine axis from a 2-pin part's pin positions ('x' = horizontal, 'y' = vertical)
export function axisFromPins(pins) {
    if (!pins || pins.length < 2)
        return null;
    if (pins[0].y === pins[1].y)
        return 'x';
    if (pins[0].x === pins[1].x)
        return 'y';
    return null;
}
// Pick the wire at 'pt' that runs along the given axis (ignores branches at junctions)
export function wireAlongAxisAt(ctx, pt, axis) {
    const ws = ctx.wiresEndingAt(pt);
    for (const w of ws) {
        const adj = ctx.adjacentOther(w, pt);
        if (!adj)
            continue;
        if (axis === 'x' && adj.y === pt.y)
            return w; // horizontal wire
        if (axis === 'y' && adj.x === pt.x)
            return w; // vertical wire
    }
    return null;
}
// Build a slide context for constrained component movement along wires
export function buildSlideContext(ctx, c) {
    // only for simple 2-pin parts
    if (!['resistor', 'capacitor', 'inductor', 'diode', 'battery', 'ac'].includes(c.type))
        return null;
    const pins = ctx.compPinPositions(c).map(p => ({
        x: ctx.snapToBaseScalar(p.x),
        y: ctx.snapToBaseScalar(p.y)
    }));
    if (pins.length !== 2)
        return null;
    const axis = axisFromPins(pins);
    if (!axis)
        return null;
    const wA = wireAlongAxisAt(ctx, pins[0], axis);
    const wB = wireAlongAxisAt(ctx, pins[1], axis);
    if (!wA || !wB)
        return null;
    const aAdj = ctx.adjacentOther(wA, pins[0]);
    const bAdj = ctx.adjacentOther(wB, pins[1]);
    if (!aAdj || !bAdj)
        return null;
    if (axis === 'x') {
        const fixed = pins[0].y;
        const min = Math.min(aAdj.x, bAdj.x);
        const max = Math.max(aAdj.x, bAdj.x);
        return { axis: 'x', fixed, min, max, wA, wB, pinAStart: pins[0], pinBStart: pins[1] };
    }
    else {
        const fixed = pins[0].x;
        const min = Math.min(aAdj.y, bAdj.y);
        const max = Math.max(aAdj.y, bAdj.y);
        return { axis: 'y', fixed, min, max, wA, wB, pinAStart: pins[0], pinBStart: pins[1] };
    }
}
// Adjust wire endpoint from old position to new position
export function adjustWireEnd(ctx, w, oldEnd, newEnd) {
    // replace whichever endpoint equals oldEnd with newEnd
    if (ctx.eqPt(w.points[0], oldEnd))
        w.points[0] = { ...newEnd };
    else if (ctx.eqPt(w.points[w.points.length - 1], oldEnd))
        w.points[w.points.length - 1] = { ...newEnd };
}
// Replace a matching endpoint in w with newEnd, preserving all other vertices
export function replaceEndpoint(ctx, w, oldEnd, newEnd) {
    if (ctx.eqPt(w.points[0], oldEnd)) {
        w.points[0] = { ...newEnd };
        // collapse duplicate vertex if needed
        if (w.points.length > 1 && ctx.eqPt(w.points[0], w.points[1]))
            w.points.shift();
    }
    else if (ctx.eqPt(w.points[w.points.length - 1], oldEnd)) {
        w.points[w.points.length - 1] = { ...newEnd };
        if (w.points.length > 1 && ctx.eqPt(w.points[w.points.length - 1], w.points[w.points.length - 2]))
            w.points.pop();
    }
}
// Move selected component by dx, dy (handles arrow keys & clamping)
export function moveSelectedBy(ctx, dx, dy) {
    ctx.pushUndo();
    const c = ctx.components.find(x => x.id === ctx.selection.id);
    if (!c)
        return;
    // If an SWP is collapsed for THIS component, move along that SWP with proper clamps
    if (ctx.moveCollapseCtx && ctx.moveCollapseCtx.kind === 'swp' && ctx.swpIdForComponent(c) === ctx.moveCollapseCtx.sid) {
        const mc = ctx.moveCollapseCtx;
        if (mc.axis === 'x') {
            let nx = ctx.snap(c.x + dx);
            nx = Math.max(mc.minCenter, Math.min(mc.maxCenter, nx));
            if (!overlapsAnyOtherAt(ctx, c, nx, mc.fixed) && !pinsCoincideAnyAt(ctx, c, nx, mc.fixed)) {
                c.x = nx;
                c.y = mc.fixed;
                mc.lastCenter = nx;
            }
        }
        else {
            let ny = ctx.snap(c.y + dy);
            ny = Math.max(mc.minCenter, Math.min(mc.maxCenter, ny));
            if (!overlapsAnyOtherAt(ctx, c, mc.fixed, ny) && !pinsCoincideAnyAt(ctx, c, mc.fixed, ny)) {
                c.y = ny;
                c.x = mc.fixed;
                mc.lastCenter = ny;
            }
        }
        ctx.redrawCanvasOnly();
        return;
    }
    const slideCtx = buildSlideContext(ctx, c);
    if (slideCtx) {
        // slide along constrained axis
        if (slideCtx.axis === 'x') {
            let nx = ctx.snap(c.x + dx);
            nx = Math.max(Math.min(slideCtx.max, nx), slideCtx.min);
            if (!overlapsAnyOtherAt(ctx, c, nx, slideCtx.fixed) && !pinsCoincideAnyAt(ctx, c, nx, slideCtx.fixed)) {
                c.x = nx;
                c.y = slideCtx.fixed;
            }
        }
        else {
            let ny = ctx.snap(c.y + dy);
            ny = Math.max(Math.min(slideCtx.max, ny), slideCtx.min);
            if (!overlapsAnyOtherAt(ctx, c, slideCtx.fixed, ny) && !pinsCoincideAnyAt(ctx, c, slideCtx.fixed, ny)) {
                c.y = ny;
                c.x = slideCtx.fixed;
            }
        }
        const pins = ctx.compPinPositions(c).map(p => ({
            x: ctx.snapToBaseScalar(p.x),
            y: ctx.snapToBaseScalar(p.y)
        }));
        adjustWireEnd(ctx, slideCtx.wA, slideCtx.pinAStart, pins[0]);
        adjustWireEnd(ctx, slideCtx.wB, slideCtx.pinBStart, pins[1]);
        slideCtx.pinAStart = pins[0];
        slideCtx.pinBStart = pins[1];
        ctx.redraw();
    }
    else {
        // For keyboard movements, dx and dy are already snapped values, so don't snap again
        const nx = c.x + dx;
        const ny = c.y + dy;
        if (!overlapsAnyOtherAt(ctx, c, nx, ny) && !pinsCoincideAnyAt(ctx, c, nx, ny)) {
            c.x = nx;
            c.y = ny;
        }
        ctx.redrawCanvasOnly();
    }
}
// Update component DOM elements during drag (lightweight, no full redraw)
export function updateComponentDOM(ctx, c, gComps) {
    const g = gComps.querySelector(`g.comp[data-id="${c.id}"]`);
    if (!g)
        return;
    // selection outline & hit rect
    const outline = g.querySelector('[data-outline]');
    if (outline) {
        outline.setAttribute('cx', String(c.x));
        outline.setAttribute('cy', String(c.y));
    }
    const hit = g.querySelector('rect');
    if (hit) {
        ctx.setAttr(hit, 'x', c.x - 60);
        ctx.setAttr(hit, 'y', c.y - 60);
    }
    // pins
    const pins = ctx.compPinPositions(c);
    const pinEls = g.querySelectorAll('circle[data-pin]');
    for (let i = 0; i < Math.min(pinEls.length, pins.length); i++) {
        ctx.setAttr(pinEls[i], 'cx', pins[i].x);
        ctx.setAttr(pinEls[i], 'cy', pins[i].y);
    }
    // Rebuild the inner symbol group so absolute geometry (lines/paths) follows new x/y
    rebuildSymbolGroup(ctx, c, g);
}
// Replace the first-level symbol <g> inside a component with a fresh one
export function rebuildSymbolGroup(ctx, c, g) {
    const old = g.querySelector(':scope > g'); // the inner symbol group we appended in drawComponent
    const fresh = ctx.buildSymbolGroup(c);
    if (old)
        g.replaceChild(fresh, old);
    else
        g.appendChild(fresh);
}
// Helper functions for SWP-based movement
export function compCenterAlongAxis(c, axis) {
    return axis === 'x' ? c.x : c.y;
}
export function halfPinSpan(ctx, c, axis) {
    const pins = ctx.compPinPositions(c);
    if (pins.length < 2)
        return 0;
    const span = axis === 'x' ? Math.abs(pins[1].x - pins[0].x) : Math.abs(pins[1].y - pins[0].y);
    return span / 2;
}
export function pinSpanAlongAxis(ctx, c, axis) {
    const pins = ctx.compPinPositions(c);
    if (pins.length < 2)
        return { lo: 0, hi: 0 };
    const vals = axis === 'x' ? [pins[0].x, pins[1].x] : [pins[0].y, pins[1].y];
    return { lo: Math.min(...vals), hi: Math.max(...vals) };
}
// Begin SWP-based move: collapse SWP to single straight wire
export function beginSwpMove(ctx, c) {
    const sid = ctx.swpIdForComponent(c);
    if (!sid)
        return null;
    // Already collapsed for this SWP? Keep it; just remember which component we're moving
    if (ctx.moveCollapseCtx && ctx.moveCollapseCtx.kind === 'swp' && ctx.moveCollapseCtx.sid === sid) {
        ctx.lastMoveCompId = c.id;
        return ctx.moveCollapseCtx;
    }
    // Capture undo state before beginning move
    ctx.pushUndo();
    const swp = ctx.findSwpById(sid);
    if (!swp)
        return null;
    // Collapse the SWP: remove only the SWP's segments from their host wires (preserve perpendicular legs),
    // then add one straight polyline for the collapsed SWP
    const originalWires = JSON.parse(JSON.stringify(ctx.wires));
    const rebuilt = [];
    // Collect original segment strokes for the SWP so we can reassign them after move
    const originalSegments = [];
    // Also capture a snapshot of the full wires that contributed to this SWP
    const origWireSnapshot = [];
    // With per-segment wires, originalWires already contains 2-point wires
    for (const w of originalWires) {
        if (swp.edgeWireIds && swp.edgeWireIds.includes(w.id)) {
            // This segment is part of the SWP: remove it from the collapsed set and
            // record its axis-aligned extent + stroke for later remapping
            const p0 = w.points[0];
            const p1 = w.points[1];
            if (p0 && p1) {
                const lo = (swp.axis === 'x') ? Math.min(p0.x, p1.x) : Math.min(p0.y, p1.y);
                const hi = (swp.axis === 'x') ? Math.max(p0.x, p1.x) : Math.max(p0.y, p1.y);
                const mid = (lo + hi) / 2;
                originalSegments.push({ wireId: w.id, index: 0, lo, hi, mid, stroke: w.stroke });
            }
            origWireSnapshot.push({ id: w.id, points: w.points.map(p => ({ x: p.x, y: p.y })), stroke: w.stroke });
        }
        else {
            // untouched wire (preserve full object including stroke)
            rebuilt.push(w);
        }
    }
    // sort original segments along axis (by midpoint)
    originalSegments.sort((a, b) => a.mid - b.mid);
    const p0 = swp.start, p1 = swp.end;
    const collapsed = {
        id: ctx.uid('wire'),
        points: [{ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }],
        color: swp.color
    };
    ctx.wires.length = 0;
    ctx.wires.push(...rebuilt, collapsed);
    // Compute allowed span for c (no overlap with other components in this SWP)
    const axis = swp.axis;
    const myHalf = halfPinSpan(ctx, c, axis);
    const fixed = (axis === 'x') ? p0.y : p0.x;
    const endLo = (axis === 'x') ? Math.min(p0.x, p1.x) : Math.min(p0.y, p1.y);
    const endHi = (axis === 'x') ? Math.max(p0.x, p1.x) : Math.max(p0.y, p1.y);
    // Other components on this SWP, build neighbor-based exclusion using real half-spans
    const others = ctx.components.filter(o => o.id !== c.id && ctx.swpIdForComponent(o) === sid)
        .map(o => ({ center: compCenterAlongAxis(o, axis), half: halfPinSpan(ctx, o, axis) }))
        .sort((a, b) => a.center - b.center);
    const t0 = compCenterAlongAxis(c, axis);
    let leftBound = endLo + myHalf, rightBound = endHi - myHalf;
    for (const o of others) {
        const gap = myHalf + o.half; // centers must be ≥ this far apart
        if (o.center <= t0)
            leftBound = Math.max(leftBound, o.center + gap);
        if (o.center >= t0)
            rightBound = Math.min(rightBound, o.center - gap);
    }
    // Clamp current component to the fixed line (orthogonal coordinate)
    if (axis === 'x') {
        c.y = fixed;
    }
    else {
        c.x = fixed;
    }
    ctx.redrawCanvasOnly(); // reflect the collapsed wire visually
    const moveCtx = {
        kind: 'swp',
        sid,
        axis,
        fixed,
        minCenter: leftBound,
        maxCenter: rightBound,
        ends: { lo: endLo, hi: endHi },
        color: swp.color,
        collapsedId: collapsed.id,
        lastCenter: t0,
        // attached metadata: original SWP contributing segments (lo/hi in axis coords + stroke)
        originalSegments,
        origWireSnapshot
    };
    ctx.lastMoveCompId = c.id;
    return moveCtx;
}
// Finish SWP-based move: rebuild wire segments with proper stroke assignment
export function finishSwpMove(ctx, c, skipRedraw = false) {
    if (!ctx.moveCollapseCtx || ctx.moveCollapseCtx.kind !== 'swp')
        return;
    const mc = ctx.moveCollapseCtx;
    const axis = mc.axis;
    // Component is at its current position
    const pins = ctx.compPinPositions(c).map(p => ({ x: ctx.snapToBaseScalar(p.x), y: ctx.snapToBaseScalar(p.y) }));
    const onSwpLine = axis === 'x' ?
        (ctx.eqN(pins[0].y, mc.fixed) && ctx.eqN(pins[1].y, mc.fixed)) :
        (ctx.eqN(pins[0].x, mc.fixed) && ctx.eqN(pins[1].x, mc.fixed));
    const lo = mc.ends.lo, hi = mc.ends.hi;
    const EPS = 0.5;
    // Calculate the component's through-line axis
    const compAxis = Math.abs(pins[1].x - pins[0].x) > Math.abs(pins[1].y - pins[0].y) ? 'x' : 'y';
    // Original SWP endpoints (where perpendicular wires are connected)
    const oldSwpStart = axis === 'x' ? { x: lo, y: mc.fixed } : { x: mc.fixed, y: lo };
    const oldSwpEnd = axis === 'x' ? { x: hi, y: mc.fixed } : { x: mc.fixed, y: hi };
    // Calculate new through-line endpoints (extend to intersect perpendiculars from original SWP endpoints)
    let newSwpStart, newSwpEnd;
    if (compAxis === 'x') {
        // Component is horizontal - through-line extends at constant Y
        newSwpStart = { x: oldSwpStart.x, y: pins[0].y };
        newSwpEnd = { x: oldSwpEnd.x, y: pins[1].y };
    }
    else {
        // Component is vertical - through-line extends at constant X
        newSwpStart = { x: pins[0].x, y: oldSwpStart.y };
        newSwpEnd = { x: pins[1].x, y: oldSwpEnd.y };
    }
    // Create two wire segments: newSwpStart -> pins[0] and pins[1] -> newSwpEnd (gap through component)
    const newSegs = [];
    const chosenStroke = mc.origWireSnapshot?.[0]?.stroke;
    // Segment from new SWP start to component first pin
    newSegs.push({
        id: ctx.uid('wire'),
        points: [newSwpStart, pins[0]],
        color: mc.color,
        stroke: chosenStroke
    });
    // NO segment through component - this creates the gap
    // Segment from component second pin to new SWP end
    newSegs.push({
        id: ctx.uid('wire'),
        points: [pins[1], newSwpEnd],
        color: mc.color,
        stroke: chosenStroke
    });
    // Replace collapsed wire with new segments
    ctx.wires = ctx.wires.filter(w => w.id !== mc.collapsedId).concat(newSegs);
    // Update perpendicular wires to connect to the NEW through-line endpoints
    const endpointMapping = [
        { old: oldSwpStart, new: newSwpStart },
        { old: oldSwpEnd, new: newSwpEnd }
    ];
    for (const mapping of endpointMapping) {
        const connectedWires = ctx.wiresEndingAt(mapping.old).filter(w => w.id !== mc.collapsedId);
        for (const wire of connectedWires) {
            // Determine which endpoint of this wire is connected to the old SWP endpoint
            const matchStart = ctx.eqPtEps(wire.points[0], mapping.old, 1);
            const endpointIndex = matchStart ? 0 : wire.points.length - 1;
            // Update this endpoint to the new through-line endpoint
            wire.points[endpointIndex] = { x: mapping.new.x, y: mapping.new.y };
        }
    }
    // Update any junction dots that were on the moved SWP line
    // Calculate the delta for the SWP movement perpendicular to its axis
    const delta = axis === 'x'
        ? (newSwpStart.y - oldSwpStart.y) // Horizontal SWP moved vertically
        : (newSwpStart.x - oldSwpStart.x); // Vertical SWP moved horizontally
    if (Math.abs(delta) > 0.1) {
        const tolerance = 1.0;
        for (const junction of ctx.junctions) {
            // Skip suppressed junctions
            if (junction.suppressed)
                continue;
            // Check if this junction was on the original SWP line
            const onOriginalSwpLine = axis === 'x'
                ? (Math.abs(junction.at.y - mc.fixed) < tolerance &&
                    junction.at.x >= lo - tolerance && junction.at.x <= hi + tolerance)
                : (Math.abs(junction.at.x - mc.fixed) < tolerance &&
                    junction.at.y >= lo - tolerance && junction.at.y <= hi + tolerance);
            if (onOriginalSwpLine) {
                // Move the junction perpendicular to the SWP axis
                if (axis === 'x') {
                    junction.at.y += delta;
                }
                else {
                    junction.at.x += delta;
                }
            }
        }
    }
    ctx.moveCollapseCtx = null;
    ctx.lastMoveCompId = null;
    ctx.rebuildTopology();
    if (!skipRedraw) {
        ctx.redraw();
    }
}
// Helper to find the best stroke for a wire segment based on original segments
function findBestStroke(ctx, mc, a, b, axis) {
    const segMidPt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let chosenStroke = undefined;
    if (mc.origWireSnapshot && mc.origWireSnapshot.length) {
        let bestD = Infinity;
        for (const ow of mc.origWireSnapshot) {
            const pts = ow.points || [];
            for (let i = 0; i < pts.length - 1; i++) {
                const d = ctx.pointToSegmentDistance(segMidPt, pts[i], pts[i + 1]);
                if (d < bestD) {
                    bestD = d;
                    chosenStroke = ow.stroke;
                }
            }
        }
        // If closest distance is too large, attempt overlap-based match as fallback
        if (bestD > 12 && mc.originalSegments && mc.originalSegments.length) {
            let bestOverlap = 0;
            const segStart = axis === 'x' ? a.x : a.y;
            const segEnd = axis === 'x' ? b.x : b.y;
            const segLo = Math.min(segStart, segEnd), segHi = Math.max(segStart, segEnd);
            for (const os of mc.originalSegments) {
                const ov = Math.max(0, Math.min(segHi, os.hi) - Math.max(segLo, os.lo));
                if (ov > bestOverlap) {
                    bestOverlap = ov;
                    chosenStroke = os.stroke;
                }
            }
            // if still none, choose nearest by midpoint
            if (!chosenStroke) {
                const segMid = (segStart + segEnd) / 2;
                let bestDist = Infinity;
                for (const os of mc.originalSegments) {
                    const osMid = (os.lo + os.hi) / 2;
                    const d = Math.abs(segMid - osMid);
                    if (d < bestDist) {
                        bestDist = d;
                        chosenStroke = os.stroke;
                    }
                }
            }
        }
    }
    else if (mc.originalSegments && mc.originalSegments.length) {
        // fallback if no snapshot present
        let bestOverlap = 0;
        const segStart = axis === 'x' ? a.x : a.y;
        const segEnd = axis === 'x' ? b.x : b.y;
        const segLo = Math.min(segStart, segEnd), segHi = Math.max(segStart, segEnd);
        for (const os of mc.originalSegments) {
            const ov = Math.max(0, Math.min(segHi, os.hi) - Math.max(segLo, os.lo));
            if (ov > bestOverlap) {
                bestOverlap = ov;
                chosenStroke = os.stroke;
            }
        }
    }
    return chosenStroke;
}
// Ensure SWP move is finished (cleanup function)
export function ensureFinishSwpMove(ctx) {
    if (!ctx.moveCollapseCtx || ctx.moveCollapseCtx.kind !== 'swp')
        return;
    if (!ctx.lastMoveCompId)
        return;
    const c = ctx.components.find(x => x.id === ctx.lastMoveCompId);
    if (c)
        finishSwpMove(ctx, c);
}
//# sourceMappingURL=move.js.map