// input.ts - Mouse/keyboard input handlers, pointer events, drawing mode, marquee selection
// Handles all user input: pointer events, keyboard shortcuts, pan/zoom, marquee selection, coordinate inputs
// Marquee selection helpers
export function beginMarqueeAt(ctx, p, startedOnEmpty, preferComponents) {
    ctx.marquee.active = true;
    ctx.marquee.start = p;
    ctx.marquee.end = p;
    ctx.marquee.startedOnEmpty = !!startedOnEmpty;
    ctx.marquee.shiftPreferComponents = !!preferComponents;
    if (ctx.marquee.rectEl)
        ctx.marquee.rectEl.remove();
    ctx.marquee.rectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    ctx.marquee.rectEl.setAttribute('class', 'marquee');
    ctx.gOverlay.appendChild(ctx.marquee.rectEl);
    updateMarqueeTo(ctx, p);
}
export function updateMarqueeTo(ctx, p) {
    if (!ctx.marquee.active || !ctx.marquee.start || !ctx.marquee.rectEl)
        return;
    ctx.marquee.end = p;
    const x1 = Math.min(ctx.marquee.start.x, p.x);
    const y1 = Math.min(ctx.marquee.start.y, p.y);
    const x2 = Math.max(ctx.marquee.start.x, p.x);
    const y2 = Math.max(ctx.marquee.start.y, p.y);
    const w = x2 - x1;
    const h = y2 - y1;
    ctx.marquee.rectEl.setAttribute('x', String(x1));
    ctx.marquee.rectEl.setAttribute('y', String(y1));
    ctx.marquee.rectEl.setAttribute('width', String(w));
    ctx.marquee.rectEl.setAttribute('height', String(h));
}
export function finishMarquee(ctx) {
    if (!ctx.marquee.active || !ctx.marquee.start || !ctx.marquee.end)
        return false;
    const x1 = Math.min(ctx.marquee.start.x, ctx.marquee.end.x);
    const y1 = Math.min(ctx.marquee.start.y, ctx.marquee.end.y);
    const x2 = Math.max(ctx.marquee.start.x, ctx.marquee.end.x);
    const y2 = Math.max(ctx.marquee.start.y, ctx.marquee.end.y);
    const w = x2 - x1;
    const h = y2 - y1;
    const r = { x: x1, y: y1, w, h };
    const movedEnough = (Math.abs(w) > 2 || Math.abs(h) > 2);
    // Remove rect
    ctx.marquee.rectEl?.remove();
    ctx.marquee.rectEl = null;
    ctx.marquee.active = false;
    // If it wasn't really a drag, treat it as a normal empty click
    if (!movedEnough) {
        if (ctx.marquee.startedOnEmpty) {
            ctx.selection = { kind: null, id: null, segIndex: null };
            ctx.redraw();
        }
        return false;
    }
    // Helper: check if point is in rect
    const inRect = (p, rect) => {
        return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
    };
    // Helper: check if segment intersects rect
    const segmentIntersectsRect = (a, b, rect) => {
        if (inRect(a, rect) || inRect(b, rect))
            return true;
        const left = rect.x, right = rect.x + rect.w, top = rect.y, bottom = rect.y + rect.h;
        const lineIntersectsEdge = (p1, p2, e1, e2) => {
            const d = (e2.y - e1.y) * (p2.x - p1.x) - (e2.x - e1.x) * (p2.y - p1.y);
            if (Math.abs(d) < 1e-10)
                return false;
            const ua = ((e2.x - e1.x) * (p1.y - e1.y) - (e2.y - e1.y) * (p1.x - e1.x)) / d;
            const ub = ((p2.x - p1.x) * (p1.y - e1.y) - (p2.y - p1.y) * (p1.x - e1.x)) / d;
            return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
        };
        const edges = [
            [{ x: left, y: top }, { x: right, y: top }],
            [{ x: right, y: top }, { x: right, y: bottom }],
            [{ x: right, y: bottom }, { x: left, y: bottom }],
            [{ x: left, y: bottom }, { x: left, y: top }]
        ];
        return edges.some(([e1, e2]) => lineIntersectsEdge(a, b, e1, e2));
    };
    // Build candidates
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const segs = [];
    for (const w of ctx.wires) {
        for (let i = 0; i < w.points.length - 1; i++) {
            const a = w.points[i], b = w.points[i + 1];
            if (segmentIntersectsRect(a, b, r)) {
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                const d2 = (mx - cx) * (mx - cx) + (my - cy) * (my - cy);
                segs.push({ w, idx: i, d2 });
            }
        }
    }
    const comps = [];
    for (const c of ctx.components) {
        if (inRect({ x: c.x, y: c.y }, r)) {
            const d2 = (c.x - cx) * (c.x - cx) + (c.y - cy) * (c.y - cy);
            comps.push({ c, d2 });
        }
    }
    // Decide priority based on Shift during drag
    const preferComponents = !!ctx.marquee.shiftPreferComponents;
    if (preferComponents) {
        if (comps.length) {
            comps.sort((u, v) => u.d2 - v.d2);
            ctx.selection = { kind: 'component', id: comps[0].c.id, segIndex: null };
            ctx.redraw();
            return true;
        }
        if (segs.length) {
            segs.sort((u, v) => u.d2 - v.d2);
            const pick = segs[0];
            ctx.selection = { kind: 'wire', id: pick.w.id, segIndex: null };
            ctx.redraw();
            return true;
        }
    }
    else {
        if (segs.length) {
            segs.sort((u, v) => u.d2 - v.d2);
            const pick = segs[0];
            ctx.selection = { kind: 'wire', id: pick.w.id, segIndex: null };
            ctx.redraw();
            return true;
        }
        if (comps.length) {
            comps.sort((u, v) => u.d2 - v.d2);
            ctx.selection = { kind: 'component', id: comps[0].c.id, segIndex: null };
            ctx.redraw();
            return true;
        }
    }
    // Nothing hit: clear selection
    ctx.selection = { kind: null, id: null, segIndex: null };
    ctx.redraw();
    return false;
}
// Pan helpers
export function beginPan(ctx, e) {
    ctx.isPanning = true;
    document.body.classList.add('panning');
    ctx.panStartClient = { x: e.clientX, y: e.clientY };
    ctx.panStartView = { x: ctx.viewX, y: ctx.viewY };
    ctx.panPointerId = e.pointerId;
    // Capture pointer to receive events even if cursor leaves the element
    try {
        ctx.svg.setPointerCapture(ctx.panPointerId);
    }
    catch (err) {
        console.warn('setPointerCapture failed:', err);
    }
}
export function doPan(ctx, e) {
    if (!ctx.isPanning)
        return;
    const clientDx = e.clientX - ctx.panStartClient.x;
    const clientDy = e.clientY - ctx.panStartClient.y;
    const scale = ctx.viewW / Math.max(1, ctx.svg.clientWidth);
    const dx = clientDx * scale;
    const dy = clientDy * scale;
    ctx.pendingPanPosition = {
        x: ctx.panStartView.x - dx,
        y: ctx.panStartView.y - dy
    };
    if (ctx.panAnimationFrame === null) {
        ctx.panAnimationFrame = requestAnimationFrame(() => {
            ctx.panAnimationFrame = null;
            if (ctx.pendingPanPosition) {
                ctx.viewX = ctx.pendingPanPosition.x;
                ctx.viewY = ctx.pendingPanPosition.y;
                ctx.svg.setAttribute('viewBox', `${ctx.viewX} ${ctx.viewY} ${ctx.viewW} ${ctx.viewH}`);
            }
        });
    }
}
export function endPan(ctx) {
    if (!ctx.isPanning)
        return;
    ctx.isPanning = false;
    document.body.classList.remove('panning');
    // Release pointer capture
    if (ctx.panPointerId != null) {
        try {
            ctx.svg.releasePointerCapture(ctx.panPointerId);
        }
        catch (err) {
            // Ignore errors
        }
    }
    ctx.panPointerId = null;
    if (ctx.panAnimationFrame !== null) {
        cancelAnimationFrame(ctx.panAnimationFrame);
        ctx.panAnimationFrame = null;
    }
    ctx.applyZoom();
}
// Zoom helper
export function handleWheel(ctx, e) {
    e.preventDefault();
    const scale = (e.deltaY < 0) ? 1.1 : (1 / 1.1);
    const oldZoom = ctx.zoom;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const newZoom = clamp(oldZoom * scale, 0.25, 10);
    if (newZoom === oldZoom)
        return;
    const fp = ctx.svgPoint(e);
    const oldW = ctx.viewW, oldH = ctx.viewH;
    const vw = Math.max(1, ctx.svg.clientWidth), vh = Math.max(1, ctx.svg.clientHeight);
    const aspect = vw / vh;
    const newW = (ctx.BASE_W / newZoom);
    const newH = newW / aspect;
    ctx.viewX = fp.x - (fp.x - ctx.viewX) * (newW / oldW);
    ctx.viewY = fp.y - (fp.y - ctx.viewY) * (newH / oldH);
    ctx.zoom = newZoom;
    ctx.applyZoom();
}
// Coordinate input helpers
let coordInputActive = false;
let lastMouseX = 0, lastMouseY = 0;
export function updateCoordinateDisplay(ctx, x, y) {
    ctx.updateCoordinateDisplay(x, y);
}
export function hideCoordinateDisplay(ctx) {
    ctx.hideCoordinateDisplay();
}
export function updateCoordinateInputs(ctx, x, y) {
    lastMouseX = x;
    lastMouseY = y;
    ctx.updateCoordinateInputs(x, y);
}
export function showCoordinateInputs(ctx) {
    ctx.showCoordinateInputs();
}
export function hideCoordinateInputs(ctx) {
    ctx.hideCoordinateInputs();
    coordInputActive = false;
}
export function updatePolarInputs(ctx, x, y) {
    ctx.updatePolarInputs(x, y);
}
export function showPolarInputs(ctx) {
    ctx.showPolarInputs();
}
export function hidePolarInputs(ctx) {
    ctx.hidePolarInputs();
    coordInputActive = false;
}
// Pointer event handlers
export function handlePointerDown(ctx, e) {
    const p = ctx.svgPoint(e);
    const tgt = e.target;
    let endpointClicked = null;
    if (tgt && tgt.tagName === 'rect' && tgt.endpoint) {
        endpointClicked = tgt.endpoint;
    }
    const snapCandDown = endpointClicked
        ? endpointClicked
        : (ctx.mode === 'wire') ? ctx.snapPointPreferAnchor({ x: p.x, y: p.y }) : { x: ctx.snap(p.x), y: ctx.snap(p.y) };
    const x = snapCandDown.x, y = snapCandDown.y;
    // Handle place-junction mode
    if (ctx.mode === 'place-junction' && e.button === 0) {
        handlePlaceJunction(ctx, p, x, y);
        return;
    }
    // Handle delete-junction mode
    if (ctx.mode === 'delete-junction' && e.button === 0) {
        handleDeleteJunction(ctx, p);
        return;
    }
    // Exit move mode on empty canvas click
    try {
        const onComp = !!(tgt && tgt.closest && tgt.closest('g.comp'));
        const onWire = !!(tgt && tgt.closest && tgt.closest('#wires g'));
        if (ctx.mode === 'move' && e.button === 0 && !onComp && !onWire) {
            ctx.selection = { kind: null, id: null, segIndex: null };
            ctx.setMode('select');
            ctx.renderInspector();
            ctx.redraw();
            return;
        }
    }
    catch (_) { }
    // Middle mouse button pans (button 1 is middle click)
    if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        beginPan(ctx, e);
        return;
    }
    // Right-click ends wire placement or exits junction modes
    if (e.button === 2 && ctx.mode === 'wire' && ctx.drawing.active) {
        e.preventDefault();
        ctx.finishWire();
        return;
    }
    if (e.button === 2 && (ctx.mode === 'place-junction' || ctx.mode === 'delete-junction')) {
        e.preventDefault();
        ctx.setMode('select');
        return;
    }
    // Handle place mode
    if (ctx.mode === 'place' && ctx.placeType) {
        handlePlaceComponent(ctx, x, y, p);
        return;
    }
    // Handle wire mode
    if (ctx.mode === 'wire') {
        handleWireClick(ctx, x, y, e);
        return;
    }
    // Handle select mode marquee
    if (ctx.mode === 'select' && e.button === 0) {
        const onComp = tgt && tgt.closest('g.comp');
        const onWire = tgt && tgt.closest('#wires g');
        if (!onComp && !onWire) {
            beginMarqueeAt(ctx, ctx.svgPoint(e), true, e.shiftKey);
        }
    }
    // Handle pan mode
    if (ctx.mode === 'pan' && e.button === 0) {
        beginPan(ctx, e);
        return;
    }
}
export function handlePointerMove(ctx, e) {
    if (ctx.isPanning) {
        doPan(ctx, e);
        return;
    }
    const p = ctx.svgPoint(e);
    const snapCandMove = (ctx.mode === 'wire') ? ctx.snapPointPreferAnchor({ x: p.x, y: p.y }) : { x: ctx.snap(p.x), y: ctx.snap(p.y) };
    let x = snapCandMove.x, y = snapCandMove.y;
    // Update marquee
    if (ctx.marquee.active) {
        ctx.marquee.shiftPreferComponents = !!(e.shiftKey || ctx.globalShiftDown);
        updateMarqueeTo(ctx, ctx.svgPoint(e));
    }
    // Handle wire mode movement
    if (ctx.mode === 'wire' && ctx.drawing.active) {
        handleWireMovement(ctx, e, p, x, y);
    }
    else {
        ctx.drawing.cursor = null;
        ctx.connectionHint = null;
        ctx.renderConnectionHint();
        if (ctx.shiftOrthoVisualActive) {
            ctx.shiftOrthoVisualActive = false;
            if (ctx.updateOrthoButtonVisual)
                ctx.updateOrthoButtonVisual();
        }
    }
    // Handle place mode ghost
    if (ctx.mode === 'place' && ctx.placeType) {
        ctx.renderGhostAt({ x, y }, ctx.placeType);
    }
    else {
        ctx.clearGhost();
    }
    // Update coordinate displays
    if (ctx.mode === 'wire' || ctx.mode === 'place' || ctx.mode === 'place-junction' || ctx.mode === 'delete-junction') {
        updateCoordinateDisplay(ctx, x, y);
        updateCoordinateInputs(ctx, x, y);
        showCoordinateInputs(ctx);
        if (ctx.mode === 'wire' && ctx.drawing.active && ctx.drawing.points.length > 0) {
            updatePolarInputs(ctx, x, y);
            showPolarInputs(ctx);
        }
        else {
            hidePolarInputs(ctx);
        }
    }
    else {
        hideCoordinateDisplay(ctx);
        hideCoordinateInputs(ctx);
        hidePolarInputs(ctx);
    }
    // Crosshair in wire mode
    if (ctx.mode === 'wire') {
        ctx.renderCrosshair(p.x, p.y);
    }
    else {
        ctx.clearCrosshair();
    }
}
export function handlePointerUp(ctx, e) {
    if (ctx.marquee.active) {
        finishMarquee(ctx);
    }
    endPan(ctx);
}
export function handlePointerLeave(ctx, e) {
    endPan(ctx);
}
export function handleDoubleClick(ctx, e) {
    if (ctx.mode === 'wire' && ctx.drawing.active) {
        ctx.finishWire();
    }
}
// Keyboard event handler
export function handleKeyDown(ctx, e) {
    if (ctx.isEditingKeystrokesTarget(e)) {
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'k'))
            e.preventDefault();
        return;
    }
    // Undo/Redo
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) {
            e.preventDefault();
            ctx.undo();
            return;
        }
        if ((k === 'y') || (k === 'z' && e.shiftKey)) {
            e.preventDefault();
            ctx.redo();
            return;
        }
    }
    // Escape key
    if (e.key === 'Escape') {
        if (ctx.drawing.active) {
            ctx.drawing.active = false;
            ctx.drawing.points = [];
            ctx.gDrawing.replaceChildren();
            ctx.connectionHint = null;
            ctx.renderConnectionHint();
            if (ctx.shiftOrthoVisualActive) {
                ctx.shiftOrthoVisualActive = false;
                if (ctx.updateOrthoButtonVisual)
                    ctx.updateOrthoButtonVisual();
            }
            return;
        }
        if (ctx.mode !== 'none') {
            ctx.setMode('none');
            return;
        }
        if (ctx.selection.kind === 'component' || ctx.selection.kind === 'wire') {
            ctx.selection = { kind: null, id: null, segIndex: null };
            ctx.renderInspector();
            ctx.redraw();
        }
    }
    // Enter key
    if (e.key === 'Enter' && ctx.drawing.active) {
        ctx.finishWire();
    }
    if (e.key === 'Enter' && (ctx.mode === 'place-junction' || ctx.mode === 'delete-junction')) {
        ctx.setMode('select');
    }
    // Mode shortcuts
    if (e.key.toLowerCase() === 'w')
        ctx.setMode('wire');
    if (e.key.toLowerCase() === 'v')
        ctx.setMode('select');
    if (e.key.toLowerCase() === 'p')
        ctx.setMode('pan');
    if (e.key.toLowerCase() === 'm')
        ctx.setMode('move');
    // Rotate
    if (e.key.toLowerCase() === 'r') {
        ctx.rotateSelected();
    }
    // Delete
    if (e.key === 'Delete') {
        if (ctx.selection.kind === 'component') {
            ctx.removeComponent(ctx.selection.id);
        }
        if (ctx.selection.kind === 'wire') {
            const w = ctx.wires.find(x => x.id === ctx.selection.id);
            if (w) {
                ctx.removeJunctionsAtWireEndpoints(w);
                ctx.pushUndo();
                ctx.wires = ctx.wires.filter(x => x.id !== w.id);
                ctx.selection = { kind: null, id: null, segIndex: null };
                ctx.normalizeAllWires();
                ctx.unifyInlineWires();
                ctx.redraw();
            }
        }
    }
    // Arrow key move in Move mode
    if (ctx.mode === 'move' && ctx.selection.kind === 'component') {
        const step = ctx.GRID;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft')
            dx = -step;
        if (e.key === 'ArrowRight')
            dx = step;
        if (e.key === 'ArrowUp')
            dy = -step;
        if (e.key === 'ArrowDown')
            dy = step;
        if (dx !== 0 || dy !== 0) {
            e.preventDefault();
            ctx.moveSelectedBy(dx, dy);
        }
    }
    // Save/Clear
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        ctx.saveJSON();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ctx.clearAll();
    }
    // Coordinate input activation
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l' &&
        (ctx.mode === 'wire' || ctx.mode === 'place' || ctx.mode === 'place-junction' || ctx.mode === 'delete-junction')) {
        e.preventDefault();
        if (e.shiftKey && ctx.mode === 'wire' && ctx.drawing.active && ctx.drawing.points.length > 0 &&
            ctx.coordInputLength && ctx.polarInputGroup) {
            coordInputActive = true;
            ctx.coordInputLength.focus();
            ctx.coordInputLength.select();
        }
        else if (ctx.coordInputX && ctx.coordInputGroup) {
            coordInputActive = true;
            ctx.coordInputX.focus();
            ctx.coordInputX.select();
        }
        return;
    }
    // Component placement shortcuts
    if (e.key.toLowerCase() === 'c' && !ctx.isEditingKeystrokesTarget(e)) {
        e.preventDefault();
        if (e.altKey) {
            ctx.capacitorSubtype = 'polarized';
        }
        else {
            ctx.capacitorSubtype = 'standard';
        }
        ctx.updateCapacitorButtonIcon();
        ctx.updateCapacitorSubtypeButtons();
        ctx.placeType = 'capacitor';
        ctx.setMode('place');
    }
    // Debug dump
    if (e.key.toLowerCase() === 'd' && !ctx.isEditingKeystrokesTarget(e)) {
        e.preventDefault();
        ctx.debugDumpAnchors();
    }
}
// Helper functions for specific input scenarios
function handlePlaceJunction(ctx, p, x, y) {
    const TOL = 50;
    const tol = TOL * 0.0254 * (100 / 25.4);
    let bestPt = null;
    let bestDist = Infinity;
    // Build all segments
    const segments = [];
    for (const w of ctx.wires) {
        for (let i = 0; i < w.points.length - 1; i++) {
            segments.push({ a: w.points[i], b: w.points[i + 1], wId: w.id });
        }
    }
    // Helper functions
    const closestPointOnSegment = (a, b, click) => {
        if (a.x === b.x) {
            const y = Math.max(Math.min(a.y, b.y), Math.min(click.y, Math.max(a.y, b.y)));
            return { x: a.x, y };
        }
        else if (a.y === b.y) {
            const x = Math.max(Math.min(a.x, b.x), Math.min(click.x, Math.max(a.x, b.x)));
            return { x, y: a.y };
        }
        return a;
    };
    const segmentIntersection = (s1, s2) => {
        if (s1.a.x === s1.b.x && s2.a.y === s2.b.y) {
            const x = s1.a.x;
            const y = s2.a.y;
            if (Math.min(s1.a.y, s1.b.y) <= y && y <= Math.max(s1.a.y, s1.b.y) &&
                Math.min(s2.a.x, s2.b.x) <= x && x <= Math.max(s2.a.x, s2.b.x)) {
                return { x, y };
            }
        }
        else if (s1.a.y === s1.b.y && s2.a.x === s2.b.x) {
            const x = s2.a.x;
            const y = s1.a.y;
            if (Math.min(s1.a.x, s1.b.x) <= x && x <= Math.max(s1.a.x, s1.b.x) &&
                Math.min(s2.a.y, s2.b.y) <= y && y <= Math.max(s2.a.y, s2.b.y)) {
                return { x, y };
            }
        }
        return null;
    };
    // Check intersections
    let nearestIntersection = null;
    let nearestIntersectionDist = Infinity;
    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            if (segments[i].wId === segments[j].wId)
                continue;
            const intersection = segmentIntersection(segments[i], segments[j]);
            if (intersection) {
                const distFromClick = Math.hypot(intersection.x - p.x, intersection.y - p.y);
                if (distFromClick < nearestIntersectionDist) {
                    nearestIntersectionDist = distFromClick;
                    nearestIntersection = intersection;
                }
            }
        }
    }
    if (nearestIntersection && nearestIntersectionDist <= tol) {
        bestPt = nearestIntersection;
    }
    else {
        let closestOnWire = null;
        let closestWireDist = Infinity;
        for (const seg of segments) {
            const closest = closestPointOnSegment(seg.a, seg.b, p);
            const d = Math.hypot(closest.x - p.x, closest.y - p.y);
            if (d < closestWireDist) {
                closestWireDist = d;
                closestOnWire = closest;
            }
        }
        if (closestOnWire && closestWireDist <= tol) {
            bestPt = closestOnWire;
        }
        else {
            bestPt = { x, y };
        }
    }
    // Add junction if not already present
    if (!ctx.junctions.some(j => Math.abs(j.at.x - bestPt.x) < 1e-3 && Math.abs(j.at.y - bestPt.y) < 1e-3)) {
        ctx.pushUndo();
        ctx.junctions.push({ at: { x: bestPt.x, y: bestPt.y }, manual: true });
        ctx.redraw();
    }
}
function handleDeleteJunction(ctx, p) {
    const TOL = 50;
    const tol = TOL * 0.0254 * (100 / 25.4);
    let idx = -1;
    let minDist = Infinity;
    for (let i = 0; i < ctx.junctions.length; ++i) {
        const j = ctx.junctions[i];
        const d = Math.hypot(j.at.x - p.x, j.at.y - p.y);
        if (d <= tol && d < minDist) {
            minDist = d;
            idx = i;
        }
    }
    if (idx !== -1) {
        const junction = ctx.junctions[idx];
        ctx.pushUndo();
        if (junction.manual) {
            ctx.junctions.splice(idx, 1);
        }
        else {
            ctx.junctions.splice(idx, 1);
            ctx.junctions.push({ at: junction.at, manual: true, suppressed: true });
        }
        ctx.redraw();
    }
}
function handlePlaceComponent(ctx, x, y, p) {
    const id = ctx.uid(ctx.placeType);
    const labelPrefix = {
        resistor: 'R', capacitor: 'C', inductor: 'L', diode: 'D',
        npn: 'Q', pnp: 'Q', ground: 'GND', battery: 'BT', ac: 'AC'
    };
    const prefix = labelPrefix[ctx.placeType] || 'X';
    let at = { x, y }, rot = 0;
    if (ctx.isTwoPinType(ctx.placeType)) {
        const hit = ctx.nearestSegmentAtPoint(p, 18);
        if (hit) {
            at = hit.q;
            const normDeg = (angle) => ((angle % 360) + 360) % 360;
            rot = normDeg(hit.angle);
        }
    }
    const comp = {
        id, type: ctx.placeType, x: at.x, y: at.y, rot,
        label: `${prefix}${ctx.counters[ctx.placeType] - 1}`,
        value: '', props: {}
    };
    if (ctx.placeType === 'diode') {
        comp.props.subtype = ctx.diodeSubtype;
    }
    if (ctx.placeType === 'resistor') {
        comp.props.resistorStyle = ctx.defaultResistorStyle;
    }
    if (ctx.placeType === 'capacitor') {
        comp.props.capacitorSubtype = ctx.capacitorSubtype;
        if (ctx.capacitorSubtype === 'polarized') {
            comp.props.capacitorStyle = ctx.defaultResistorStyle;
        }
    }
    ctx.components.push(comp);
    ctx.breakWiresForComponent(comp);
    ctx.deleteBridgeBetweenPins(comp);
    ctx.setMode('select');
    ctx.placeType = null;
    ctx.selection = { kind: 'component', id, segIndex: null };
    ctx.redraw();
}
function handleWireClick(ctx, x, y, e) {
    if (!ctx.drawing.active) {
        ctx.drawing.active = true;
        ctx.drawing.points = [{ x, y }];
        ctx.drawing.cursor = { x, y };
    }
    else {
        const tgt = e.target;
        let endpointData = null;
        if (tgt && tgt.tagName === 'rect' && tgt.endpoint) {
            endpointData = tgt.endpoint;
        }
        if (!endpointData && tgt) {
            const allRects = [
                ...ctx.$qa('rect[data-endpoint]', ctx.gOverlay),
                ...ctx.$qa('rect', ctx.gDrawing)
            ];
            for (const rect of allRects) {
                if (rect.endpoint) {
                    const ep = rect.endpoint;
                    const rectBounds = rect.getBBox();
                    const pt = ctx.svgPoint(e);
                    if (pt.x >= rectBounds.x && pt.x <= rectBounds.x + rectBounds.width &&
                        pt.y >= rectBounds.y && pt.y <= rectBounds.y + rectBounds.height) {
                        endpointData = ep;
                        break;
                    }
                }
            }
        }
        let nx, ny;
        if (endpointData) {
            nx = endpointData.x;
            ny = endpointData.y;
        }
        else {
            nx = ctx.drawing.cursor ? ctx.drawing.cursor.x : x;
            ny = ctx.drawing.cursor ? ctx.drawing.cursor.y : y;
        }
        ctx.drawing.points.push({ x: nx, y: ny });
        ctx.connectionHint = null;
        ctx.drawing.cursor = { x: nx, y: ny };
    }
    ctx.renderDrawing();
}
function handleWireMovement(ctx, e, p, x, y) {
    // Check endpoint hover for ortho override
    if (ctx.drawing.points.length > 0) {
        const tgt = e.target;
        if (tgt && tgt.tagName === 'rect' && tgt.endpoint) {
            const ep = tgt.endpoint;
            const prev = ctx.drawing.points[ctx.drawing.points.length - 1];
            const dx = Math.abs(ep.x - prev.x);
            const dy = Math.abs(ep.y - prev.y);
            const isNonOrtho = (ctx.orthoMode || ctx.globalShiftDown) && dx > 0.01 && dy > 0.01;
            if (isNonOrtho && !ctx.endpointOverrideActive) {
                ctx.endpointOverrideActive = true;
                if (ctx.updateOrthoButtonVisual)
                    ctx.updateOrthoButtonVisual();
            }
            else if (!isNonOrtho && ctx.endpointOverrideActive) {
                ctx.endpointOverrideActive = false;
                if (ctx.updateOrthoButtonVisual)
                    ctx.updateOrthoButtonVisual();
            }
        }
        else if (ctx.endpointOverrideActive) {
            ctx.endpointOverrideActive = false;
            if (ctx.updateOrthoButtonVisual)
                ctx.updateOrthoButtonVisual();
        }
    }
    // Handle ortho mode and shift visual
    const isShift = e.shiftKey || ctx.globalShiftDown;
    if (!ctx.orthoMode && isShift && !ctx.shiftOrthoVisualActive) {
        ctx.shiftOrthoVisualActive = true;
        if (ctx.updateOrthoButtonVisual)
            ctx.updateOrthoButtonVisual();
    }
    else if (!ctx.orthoMode && !isShift && ctx.shiftOrthoVisualActive) {
        ctx.shiftOrthoVisualActive = false;
        if (ctx.updateOrthoButtonVisual)
            ctx.updateOrthoButtonVisual();
    }
    const forceOrtho = isShift || ctx.orthoMode;
    if (ctx.drawing.points && ctx.drawing.points.length > 0) {
        const last = ctx.drawing.points[ctx.drawing.points.length - 1];
        const dx = Math.abs(x - last.x), dy = Math.abs(y - last.y);
        // Apply ortho constraint first if no hint active
        if (!ctx.connectionHint && forceOrtho) {
            if (dx >= dy)
                y = last.y;
            else
                x = last.x;
        }
        // Connection hint logic (tracking mode)
        if (ctx.trackingMode) {
            handleConnectionHint(ctx, p, x, y, last, dx, dy, forceOrtho);
        }
        // Apply connection hint lock with ortho constraint
        if (ctx.connectionHint) {
            x = ctx.connectionHint.lockedPt.x;
            y = ctx.connectionHint.lockedPt.y;
            if (forceOrtho) {
                if (dx >= dy) {
                    y = last.y;
                }
                else {
                    x = last.x;
                }
            }
            if (!ctx.connectionHint.wasOrthoActive && !ctx.shiftOrthoVisualActive) {
                ctx.shiftOrthoVisualActive = true;
                if (ctx.updateOrthoButtonVisual)
                    ctx.updateOrthoButtonVisual();
            }
        }
    }
    ctx.drawing.cursor = { x, y };
    ctx.renderDrawing();
    ctx.renderConnectionHint();
}
function handleConnectionHint(ctx, p, x, y, last, dx, dy, forceOrtho) {
    const scale = ctx.svg.clientWidth / Math.max(1, ctx.viewW);
    const snapTol = ctx.HINT_SNAP_TOLERANCE_PX / scale;
    const unlockThresh = ctx.HINT_UNLOCK_THRESHOLD_PX / scale;
    // Collect candidates
    const candidates = [];
    const drawingStartPt = ctx.drawing.points.length > 0 ? ctx.drawing.points[0] : null;
    const isDrawingStart = (pt) => {
        return drawingStartPt && pt.x === drawingStartPt.x && pt.y === drawingStartPt.y;
    };
    ctx.wires.forEach(w => {
        if (w.points && w.points.length >= 2) {
            const firstPt = w.points[0];
            if (!isDrawingStart(firstPt))
                candidates.push(firstPt);
            const lastPt = w.points[w.points.length - 1];
            if (!isDrawingStart(lastPt))
                candidates.push(lastPt);
        }
    });
    ctx.components.forEach(c => {
        const pins = ctx.compPinPositions(c);
        pins.forEach(p => {
            if (!isDrawingStart(p))
                candidates.push({ x: p.x, y: p.y });
        });
    });
    for (let i = 0; i < ctx.drawing.points.length - 1; i++) {
        candidates.push({ x: ctx.drawing.points[i].x, y: ctx.drawing.points[i].y });
    }
    // Check unlock
    if (ctx.connectionHint) {
        const distFromTarget = Math.sqrt(Math.pow(x - ctx.connectionHint.targetPt.x, 2) +
            Math.pow(y - ctx.connectionHint.targetPt.y, 2));
        if (distFromTarget > unlockThresh) {
            ctx.connectionHint = null;
        }
    }
    if (!ctx.connectionHint && candidates.length > 0) {
        let bestCand = null;
        let bestAxisDist = Infinity;
        let bestIsHorizontalHint = true;
        const shouldExcludeCandidate = (cand, isHorizontalHint) => {
            const segmentX = x - last.x;
            const segmentY = y - last.y;
            const hintX = cand.x - x;
            const hintY = cand.y - y;
            const crossProduct = Math.abs(segmentX * hintY - segmentY * hintX);
            if (crossProduct < 0.5)
                return true;
            const isDraggingVertically = dy > dx;
            const hintIsVertical = !isHorizontalHint;
            if (isDraggingVertically && hintIsVertical)
                return true;
            if (!isDraggingVertically && !hintIsVertical)
                return true;
            return false;
        };
        candidates.forEach(cand => {
            const rawX = p.x;
            const rawY = p.y;
            const xDist = Math.abs(rawX - cand.x);
            if (xDist < snapTol && xDist < bestAxisDist && !shouldExcludeCandidate(cand, false)) {
                bestAxisDist = xDist;
                bestCand = cand;
                bestIsHorizontalHint = false;
            }
            const yDist = Math.abs(rawY - cand.y);
            if (yDist < snapTol && yDist < bestAxisDist && !shouldExcludeCandidate(cand, true)) {
                bestAxisDist = yDist;
                bestCand = cand;
                bestIsHorizontalHint = true;
            }
        });
        if (bestCand) {
            let snappedX = x;
            let snappedY = y;
            if (bestIsHorizontalHint) {
                snappedY = bestCand.y;
            }
            else {
                snappedX = bestCand.x;
            }
            ctx.connectionHint = {
                lockedPt: { x: snappedX, y: snappedY },
                targetPt: bestCand,
                wasOrthoActive: ctx.orthoMode || forceOrtho,
                lockAxis: bestIsHorizontalHint ? 'y' : 'x'
            };
        }
    }
}
// Install all input event listeners
export function installInputHandlers(ctx) {
    // Global shift tracking
    window.addEventListener('keydown', (e) => { if (e.key === 'Shift')
        ctx.globalShiftDown = true; });
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift')
        ctx.globalShiftDown = false; });
    // Pointer events
    ctx.svg.addEventListener('pointerdown', (e) => handlePointerDown(ctx, e));
    ctx.svg.addEventListener('pointermove', (e) => handlePointerMove(ctx, e));
    ctx.svg.addEventListener('pointerup', (e) => handlePointerUp(ctx, e));
    ctx.svg.addEventListener('pointerleave', (e) => handlePointerLeave(ctx, e));
    ctx.svg.addEventListener('dblclick', (e) => handleDoubleClick(ctx, e));
    // Prevent middle-click default behaviors (like autoscroll on some browsers)
    ctx.svg.addEventListener('auxclick', (e) => {
        if (e.button === 1)
            e.preventDefault();
    });
    // Context menu suppression
    ctx.svg.addEventListener('contextmenu', (e) => {
        if (ctx.mode === 'wire' && ctx.drawing.active) {
            e.preventDefault();
        }
    });
    // Wheel zoom
    ctx.svg.addEventListener('wheel', (e) => handleWheel(ctx, e), { passive: false });
    // Keyboard
    window.addEventListener('keydown', (e) => handleKeyDown(ctx, e));
    // Window resize
    window.addEventListener('resize', () => ctx.applyZoom());
}
//# sourceMappingURL=input.js.map