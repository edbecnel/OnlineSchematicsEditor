// topology.ts - Topology building and junction detection
// Handles node/edge graph construction, SWP (Straight Wire Path) detection, and junction management
import { keyPt, eqN } from './geometry.js';
// ========================================================================================
// ===== TOPOLOGY BUILDING =====
// ========================================================================================
/**
 * Rebuild the complete topology: nodes, edges, SWPs, component mappings, and junctions.
 * This is the main entry point for topology analysis.
 */
export function rebuildTopology(wires, components, junctions, compPinPositions, findWireEndpointNear, defaultWireColor, NET_CLASSES, rgba01ToCss) {
    const nodes = new Map();
    const edges = [];
    const axisOf = (a, b) => (a.y === b.y) ? 'x' : (a.x === b.x) ? 'y' : null;
    function addNode(p) {
        const k = keyPt(p);
        if (!nodes.has(k)) {
            nodes.set(k, {
                x: Math.round(p.x),
                y: Math.round(p.y),
                edges: new Set(),
                axDeg: { x: 0, y: 0 }
            });
        }
        return k;
    }
    // Step 1: Collect all segment endpoints
    let segmentPoints = [];
    let segments = [];
    for (const w of wires) {
        const pts = w.points || [];
        for (let i = 0; i < pts.length - 1; i++) {
            const a = { x: Math.round(pts[i].x), y: Math.round(pts[i].y) };
            const b = { x: Math.round(pts[i + 1].x), y: Math.round(pts[i + 1].y) };
            segments.push({ w, i, a, b });
            segmentPoints.push(keyPt(a));
            segmentPoints.push(keyPt(b));
        }
    }
    // Step 2: Find all T-junctions (endpoint-to-segment)
    function isEndpoint(pt, seg) {
        return (pt.x === seg.a.x && pt.y === seg.a.y) || (pt.x === seg.b.x && pt.y === seg.b.y);
    }
    let intersectionPoints = [];
    for (let i = 0; i < segments.length; i++) {
        const s1 = segments[i];
        for (let j = 0; j < segments.length; j++) {
            if (i === j)
                continue;
            const s2 = segments[j];
            if (s1.w.id === s2.w.id)
                continue;
            // Check s1.a (start point)
            if (!isEndpoint(s1.a, s2)) {
                // Is s1.a on s2 (interior)?
                if ((s2.a.x === s2.b.x && s1.a.x === s2.a.x &&
                    Math.min(s2.a.y, s2.b.y) < s1.a.y && s1.a.y < Math.max(s2.a.y, s2.b.y)) ||
                    (s2.a.y === s2.b.y && s1.a.y === s2.a.y &&
                        Math.min(s2.a.x, s2.b.x) < s1.a.x && s1.a.x < Math.max(s2.a.x, s2.b.x))) {
                    intersectionPoints.push(keyPt(s1.a));
                }
            }
            // Check s1.b (end point)
            if (!isEndpoint(s1.b, s2)) {
                if ((s2.a.x === s2.b.x && s1.b.x === s2.a.x &&
                    Math.min(s2.a.y, s2.b.y) < s1.b.y && s1.b.y < Math.max(s2.a.y, s2.b.y)) ||
                    (s2.a.y === s2.b.y && s1.b.y === s2.a.y &&
                        Math.min(s2.a.x, s2.b.x) < s1.b.x && s1.b.x < Math.max(s2.a.x, s2.b.x))) {
                    intersectionPoints.push(keyPt(s1.b));
                }
            }
        }
    }
    // Remove duplicates
    intersectionPoints = Array.from(new Set(intersectionPoints));
    // Step 3: Split wire polylines at all intersection points
    const insertMap = new Map();
    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        for (const k of intersectionPoints) {
            const [ix, iy] = k.split(',').map(Number);
            // Is this intersection on this segment?
            if (((s.a.x === s.b.x && s.a.x === ix &&
                Math.min(s.a.y, s.b.y) < iy && iy < Math.max(s.a.y, s.b.y)) ||
                (s.a.y === s.b.y && s.a.y === iy &&
                    Math.min(s.a.x, s.b.x) < ix && ix < Math.max(s.a.x, s.b.x)))) {
                if (!insertMap.has(s.w.id))
                    insertMap.set(s.w.id, []);
                insertMap.get(s.w.id).push({ x: ix, y: iy });
            }
        }
    }
    // For each wire, insert all intersection points into its polyline
    for (const [wid, ptsToInsert] of insertMap.entries()) {
        const w = wires.find(w => w.id === wid);
        if (!w || !ptsToInsert.length)
            continue;
        let newPts = [w.points[0]];
        for (let i = 1; i < w.points.length; i++) {
            const a = w.points[i - 1], b = w.points[i];
            // Find all intersection points on this segment
            let segPts = ptsToInsert.filter(pt => {
                if (a.x === b.x && pt.x === a.x &&
                    Math.min(a.y, b.y) < pt.y && pt.y < Math.max(a.y, b.y))
                    return true;
                if (a.y === b.y && pt.y === a.y &&
                    Math.min(a.x, b.x) < pt.x && pt.x < Math.max(a.x, b.x))
                    return true;
                return false;
            });
            // Sort along the segment
            segPts.sort((p1, p2) => (a.x === b.x) ? (p1.y - p2.y) : (p1.x - p2.x));
            for (const p of segPts)
                newPts.push(p);
            newPts.push(b);
        }
        // Remove duplicates
        w.points = newPts.filter((pt, idx, arr) => idx === 0 || pt.x !== arr[idx - 1].x || pt.y !== arr[idx - 1].y);
    }
    // Rebuild segment points from updated wires
    segmentPoints = [];
    for (const w of wires) {
        const pts = w.points || [];
        for (let i = 0; i < pts.length - 1; i++) {
            const a = { x: Math.round(pts[i].x), y: Math.round(pts[i].y) };
            const b = { x: Math.round(pts[i + 1].x), y: Math.round(pts[i + 1].y) };
            segmentPoints.push(keyPt(a));
            segmentPoints.push(keyPt(b));
        }
    }
    // Step 4: Add nodes for all unique points
    for (const k of new Set(segmentPoints)) {
        const [x, y] = k.split(',').map(Number);
        addNode({ x, y });
    }
    // Step 5: Build edges from wire segments
    for (const w of wires) {
        const pts = w.points || [];
        let segPts = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
            const a = { x: Math.round(pts[i - 1].x), y: Math.round(pts[i - 1].y) };
            const b = { x: Math.round(pts[i].x), y: Math.round(pts[i].y) };
            // Find all intersection points on this segment (excluding endpoints)
            let segIntersections = [];
            for (const k of intersectionPoints) {
                const [ix, iy] = k.split(',').map(Number);
                if (((a.x === b.x && a.x === ix &&
                    Math.min(a.y, b.y) < iy && iy < Math.max(a.y, b.y)) ||
                    (a.y === b.y && a.y === iy &&
                        Math.min(a.x, b.x) < ix && ix < Math.max(a.x, b.x)))) {
                    segIntersections.push({ x: ix, y: iy });
                }
            }
            // Sort intersections along the segment
            segIntersections.sort((p1, p2) => (a.x === b.x) ? (p1.y - p2.y) : (p1.x - p2.x));
            // Insert intersection points
            for (const p of segIntersections)
                segPts.push(p);
            segPts.push(b);
        }
        // Build edges between consecutive points
        for (let i = 0; i < segPts.length - 1; i++) {
            const a = { x: segPts[i].x, y: segPts[i].y };
            const b = { x: segPts[i + 1].x, y: segPts[i + 1].y };
            const ax = axisOf(a, b);
            const akey = addNode(a), bkey = addNode(b);
            const id = `${w.id}:${i}`;
            edges.push({ id, wireId: w.id, i, a, b, axis: ax, akey, bkey });
            const na = nodes.get(akey), nb = nodes.get(bkey);
            na.edges.add(id);
            nb.edges.add(id);
            if (ax) {
                na.axDeg[ax]++;
                nb.axDeg[ax]++;
            }
        }
    }
    // Step 6: Add synthetic "component bridge" edges for 2-pin components
    const twoPinForBridge = ['resistor', 'capacitor', 'inductor', 'diode', 'battery', 'ac'];
    for (const c of components) {
        if (!twoPinForBridge.includes(c.type))
            continue;
        const pins = compPinPositions(c).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
        if (pins.length !== 2)
            continue;
        let axis = null;
        if (pins[0].y === pins[1].y)
            axis = 'x';
        else if (pins[0].x === pins[1].x)
            axis = 'y';
        if (!axis)
            continue;
        // Only bridge when the component is actually embedded
        const hitA = findWireEndpointNear(pins[0], wires, 0.9);
        const hitB = findWireEndpointNear(pins[1], wires, 0.9);
        if (!(hitA && hitB))
            continue;
        const akey = addNode(pins[0]), bkey = addNode(pins[1]);
        const id = `comp:${c.id}`;
        edges.push({ id, wireId: null, i: -1, a: pins[0], b: pins[1], axis, akey, bkey });
        const na = nodes.get(akey), nb = nodes.get(bkey);
        na.edges.add(id);
        nb.edges.add(id);
        na.axDeg[axis]++;
        nb.axDeg[axis]++;
    }
    // Step 7: Build SWPs (Straight Wire Paths)
    const swps = buildSWPs(edges, nodes, wires, defaultWireColor);
    // Step 8: Map components to SWPs
    const compToSwp = mapComponentsToSWPs(components, compPinPositions, swps);
    // Step 9: Detect and create junctions
    const updatedJunctions = detectJunctions(nodes, edges, wires, components, compPinPositions, junctions, NET_CLASSES, rgba01ToCss);
    const topology = {
        nodes: [...nodes.values()],
        edges,
        swps,
        compToSwp
    };
    return { topology, wires, junctions: updatedJunctions };
}
// ========================================================================================
// ===== SWP (STRAIGHT WIRE PATH) DETECTION =====
// ========================================================================================
/**
 * Build Straight Wire Paths (SWPs) from the edge graph.
 * SWPs are maximal straight runs where interior nodes have axis-degree==2.
 */
function buildSWPs(edges, nodes, wires, defaultWireColor) {
    const visited = new Set();
    const swps = [];
    const edgeById = new Map(edges.map(e => [e.id, e]));
    function otherEdgeWithSameAxis(nodeKey, fromEdge) {
        const n = nodes.get(nodeKey);
        if (!n)
            return null;
        if (!fromEdge.axis)
            return null;
        if (n.axDeg[fromEdge.axis] !== 2)
            return null; // branch or dead-end
        for (const eid of n.edges) {
            if (eid === fromEdge.id)
                continue;
            const e = edgeById.get(eid);
            if (e && e.axis === fromEdge.axis) {
                // ensure this edge actually touches this node
                if (e.akey === nodeKey || e.bkey === nodeKey)
                    return e;
            }
        }
        return null;
    }
    for (const e0 of edges) {
        if (!e0.axis)
            continue;
        if (visited.has(e0.id))
            continue;
        // Walk both directions along the same axis
        const chainSet = new Set();
        function walkDir(cur, enterNodeKey) {
            while (cur && !chainSet.has(cur.id)) {
                chainSet.add(cur.id);
                const nextNodeKey = (cur.akey === enterNodeKey) ? cur.bkey : cur.akey;
                const nxt = otherEdgeWithSameAxis(nextNodeKey, cur);
                if (!nxt)
                    break;
                enterNodeKey = nextNodeKey;
                cur = nxt;
            }
        }
        walkDir(e0, e0.akey);
        walkDir(e0, e0.bkey);
        const chain = [...chainSet].map(id => edgeById.get(id));
        chain.forEach(ed => visited.add(ed.id));
        // Determine endpoints (min/max along axis)
        const allNodes = new Set();
        chain.forEach(ed => {
            allNodes.add(ed.akey);
            allNodes.add(ed.bkey);
        });
        const pts = [...allNodes].map(k => nodes.get(k));
        let start, end;
        const axis = e0.axis;
        if (axis === 'x') {
            pts.sort((u, v) => u.x - v.x);
            start = pts[0];
            end = pts[pts.length - 1];
        }
        else {
            pts.sort((u, v) => u.y - v.y);
            start = pts[0];
            end = pts[pts.length - 1];
        }
        // Pick color: "left/top" edge's source wire color
        let leadEdge = chain[0];
        if (axis === 'x') {
            leadEdge = chain.reduce((m, e) => Math.min(e.a.x, e.b.x) < Math.min(m.a.x, m.b.x) ? e : m, chain[0]);
        }
        else {
            leadEdge = chain.reduce((m, e) => Math.min(e.a.y, e.b.y) < Math.min(m.a.y, m.b.y) ? e : m, chain[0]);
        }
        // If all contributing wire segments share the same color, use it
        const segColors = [...new Set(chain
                .map(e => e.wireId)
                .filter(Boolean)
                .map(id => (wires.find(w => w.id === id)?.color) || defaultWireColor))];
        const swpColor = (segColors.length === 1) ? segColors[0] : '#FFFFFF';
        // Track wire IDs and segment indices
        const edgeWireIds = [...new Set(chain.map(e => e.wireId).filter(Boolean))];
        const edgeIndicesByWire = {};
        for (const e of chain) {
            if (!e.wireId)
                continue;
            if (!edgeIndicesByWire[e.wireId])
                edgeIndicesByWire[e.wireId] = [];
            edgeIndicesByWire[e.wireId].push(e.i);
        }
        // Normalize & sort indices per wire
        for (const k in edgeIndicesByWire) {
            edgeIndicesByWire[k] = [...new Set(edgeIndicesByWire[k])].sort((a, b) => a - b);
        }
        swps.push({
            id: `swp${swps.length + 1}`,
            axis,
            start: { x: start.x, y: start.y },
            end: { x: end.x, y: end.y },
            color: swpColor,
            edgeWireIds,
            edgeIndicesByWire
        });
    }
    return swps;
}
// ========================================================================================
// ===== COMPONENT TO SWP MAPPING =====
// ========================================================================================
/**
 * Map 2-pin components onto their containing SWPs.
 */
function mapComponentsToSWPs(components, compPinPositions, swps) {
    const compToSwp = new Map();
    const twoPin = ['resistor', 'capacitor', 'inductor', 'diode', 'battery', 'ac'];
    for (const c of components) {
        if (!twoPin.includes(c.type))
            continue;
        const pins = compPinPositions(c).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
        if (pins.length !== 2)
            continue;
        for (const s of swps) {
            if (s.axis === 'x') {
                const y = s.start.y;
                const minx = Math.min(s.start.x, s.end.x), maxx = Math.max(s.start.x, s.end.x);
                if (eqN(pins[0].y, y) && eqN(pins[1].y, y) &&
                    Math.min(pins[0].x, pins[1].x) >= minx - 0.5 &&
                    Math.max(pins[0].x, pins[1].x) <= maxx + 0.5) {
                    compToSwp.set(c.id, s.id);
                    break;
                }
            }
            else if (s.axis === 'y') {
                const x = s.start.x;
                const miny = Math.min(s.start.y, s.end.y), maxy = Math.max(s.start.y, s.end.y);
                if (eqN(pins[0].x, x) && eqN(pins[1].x, x) &&
                    Math.min(pins[0].y, pins[1].y) >= miny - 0.5 &&
                    Math.max(pins[0].y, pins[1].y) <= maxy + 0.5) {
                    compToSwp.set(c.id, s.id);
                    break;
                }
            }
        }
    }
    return compToSwp;
}
// ========================================================================================
// ===== JUNCTION DETECTION =====
// ========================================================================================
/**
 * Detect and create junction dots at wire-to-wire T-junctions and component pins.
 * Preserves manually placed junctions, clears auto-generated ones.
 */
function detectJunctions(nodes, edges, wires, components, compPinPositions, existingJunctions, NET_CLASSES, rgba01ToCss) {
    // Preserve manually placed junctions, clear auto-generated ones
    const manualJunctions = existingJunctions.filter(j => j.manual);
    const newJunctions = [...manualJunctions];
    // Build a set of all component pin positions (rounded)
    const pinKeys = new Set();
    for (const c of components) {
        const pins = compPinPositions(c).map(p => `${Math.round(p.x)},${Math.round(p.y)}`);
        for (const k of pins)
            pinKeys.add(k);
    }
    // For each node in the topology, check if it is a valid wire-to-wire intersection
    for (const node of nodes.values()) {
        const k = `${node.x},${node.y}`;
        // Gather all wires touching this node
        const wireIds = new Set();
        let hasMidSegment = false;
        for (const eid of node.edges) {
            const edge = edges.find(e => e.id === eid);
            if (edge && edge.wireId) {
                wireIds.add(edge.wireId);
                const w = wires.find(w => w.id === edge.wireId);
                if (w) {
                    // Check if node is NOT an endpoint for this wire
                    const isStart = (Math.round(w.points[0].x) === node.x &&
                        Math.round(w.points[0].y) === node.y);
                    const isEnd = (Math.round(w.points[w.points.length - 1].x) === node.x &&
                        Math.round(w.points[w.points.length - 1].y) === node.y);
                    if (!isStart && !isEnd)
                        hasMidSegment = true;
                }
            }
        }
        // Add a junction if:
        // 1. Two or more wires meet and at least one passes through (T-junction), OR
        // 2. Two or more wires meet at a component pin (even if all are endpoints)
        const isComponentPin = pinKeys.has(k);
        const shouldCreateJunction = wireIds.size >= 2 && (hasMidSegment || isComponentPin);
        if (shouldCreateJunction) {
            // Check if this location has been manually suppressed
            const isSuppressed = manualJunctions.some(j => j.suppressed && Math.abs(j.at.x - node.x) < 1e-3 && Math.abs(j.at.y - node.y) < 1e-3);
            if (!isSuppressed) {
                // Use the netId of the first wire found, or 'default'
                let netId = 'default';
                for (const wid of wireIds) {
                    const w = wires.find(w => w.id === wid);
                    if (w && w.netId) {
                        netId = w.netId;
                        break;
                    }
                }
                // Use the default size/color from the net class
                const nc = NET_CLASSES[netId] || NET_CLASSES.default;
                newJunctions.push({
                    at: { x: node.x, y: node.y },
                    netId,
                    size: nc.junction.size,
                    color: rgba01ToCss(nc.junction.color)
                });
            }
        }
    }
    return newJunctions;
}
// ========================================================================================
// ===== SWP QUERY HELPERS =====
// ========================================================================================
/**
 * Find SWP by ID.
 */
export function findSwpById(topology, id) {
    return topology.swps.find(s => s.id === id);
}
/**
 * Get the SWP ID for a component (if it lies on one).
 */
export function swpIdForComponent(topology, componentId) {
    return topology.compToSwp.get(componentId) || null;
}
/**
 * Find the SWP that contains a wire segment.
 */
export function swpForWireSegment(topology, wireId) {
    for (const s of topology.swps) {
        if (s.edgeWireIds && s.edgeWireIds.includes(wireId))
            return s;
    }
    return null;
}
//# sourceMappingURL=topology.js.map