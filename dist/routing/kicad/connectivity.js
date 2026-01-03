class DisjointSet {
    constructor(n) {
        this.parent = Array.from({ length: n }, (_, i) => i);
        this.rank = Array.from({ length: n }, () => 0);
    }
    find(a) {
        if (this.parent[a] !== a)
            this.parent[a] = this.find(this.parent[a]);
        return this.parent[a];
    }
    union(a, b) {
        const ra = this.find(a), rb = this.find(b);
        if (ra === rb)
            return;
        const raRank = this.rank[ra], rbRank = this.rank[rb];
        if (raRank < rbRank)
            this.parent[ra] = rb;
        else if (raRank > rbRank)
            this.parent[rb] = ra;
        else {
            this.parent[rb] = ra;
            this.rank[ra]++;
        }
    }
}
function dist2(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
}
function pointToSegmentDistance(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;
    const c1 = vx * wx + vy * wy;
    const c2 = vx * vx + vy * vy;
    if (c2 <= 1e-12) {
        // a and b are the same point
        const d = Math.sqrt(dist2(p, a));
        return { distance: d, onSegment: true };
    }
    let t = c1 / c2;
    if (t < 0)
        t = 0;
    else if (t > 1)
        t = 1;
    const proj = { x: a.x + t * vx, y: a.y + t * vy };
    const d = Math.sqrt(dist2(p, proj));
    const onSegment = t >= 0 && t <= 1;
    return { distance: d, onSegment };
}
function keyPt(p) {
    // Use rounded coordinates to keep determinism and dedupe.
    return `${Math.round(p.x)},${Math.round(p.y)}`;
}
export function deriveConnectivity(state) {
    const tol = state.tolerance;
    const tol2 = tol * tol;
    // Track derived implicit T-junction points (endpoint-on-segment). Never persist these.
    const implicitJunctionsByKey = new Map();
    const nodes = [];
    const endpointNodeIndex = new Map(); // key: wireId:endIdx
    const pinNodeIndex = new Map(); // key: pinId
    const junctionNodeIndex = new Map(); // key: junctionId
    // Helper to add a node
    function addNode(id, pos, member) {
        const idx = nodes.length;
        nodes.push({ id, pos, member });
        return idx;
    }
    // Wire endpoints and per-wire unions (wire is continuous)
    for (const w of state.wires) {
        if (!w.points || w.points.length < 2)
            continue;
        const start = w.points[0];
        const end = w.points[w.points.length - 1];
        const nStart = addNode(`wire:${w.id}:end:0`, start, { kind: 'wire-endpoint', wireId: w.id, endpointIndex: 0 });
        const nEnd = addNode(`wire:${w.id}:end:1`, end, { kind: 'wire-endpoint', wireId: w.id, endpointIndex: 1 });
        endpointNodeIndex.set(`${w.id}:0`, nStart);
        endpointNodeIndex.set(`${w.id}:1`, nEnd);
    }
    // Pins
    for (const p of state.pins) {
        const np = addNode(`pin:${p.id}`, p.at, { kind: 'pin', pinId: p.id });
        pinNodeIndex.set(p.id, np);
    }
    // Junctions
    for (const j of state.junctions) {
        const nj = addNode(`junction:${j.id}`, j.at, { kind: 'junction', junctionId: j.id });
        junctionNodeIndex.set(j.id, nj);
    }
    const dsu = new DisjointSet(nodes.length);
    // Rule: within a wire, endpoints are the same conductor
    for (const w of state.wires) {
        if (!w.points || w.points.length < 2)
            continue;
        const i0 = endpointNodeIndex.get(`${w.id}:0`);
        const i1 = endpointNodeIndex.get(`${w.id}:1`);
        if (i0 !== undefined && i1 !== undefined)
            dsu.union(i0, i1);
    }
    // Rule: endpoint-to-endpoint connects within tolerance
    for (let i = 0; i < nodes.length; i++) {
        const ni = nodes[i];
        if (ni.member.kind !== 'wire-endpoint')
            continue;
        for (let j = i + 1; j < nodes.length; j++) {
            const nj = nodes[j];
            if (nj.member.kind !== 'wire-endpoint')
                continue;
            if (dist2(ni.pos, nj.pos) <= tol2)
                dsu.union(i, j);
        }
    }
    // Rule: endpoint-to-pin connects within tolerance
    for (const [pid, pIdx] of pinNodeIndex.entries()) {
        const pNode = nodes[pIdx];
        for (const [eKey, eIdx] of endpointNodeIndex.entries()) {
            const eNode = nodes[eIdx];
            if (dist2(pNode.pos, eNode.pos) <= tol2)
                dsu.union(pIdx, eIdx);
        }
    }
    // Rule: endpoint-on-segment (T-connection) connects WITHOUT needing an explicit junction.
    // IMPORTANT: this does NOT make wire crossings connect; it only checks endpoints landing on segments.
    // For connectivity, union the endpoint node with the target wire's conductor.
    for (const wEnd of state.wires) {
        if (!wEnd.points || wEnd.points.length < 2)
            continue;
        const endpoints = [
            { idx: 0, pos: wEnd.points[0] },
            { idx: 1, pos: wEnd.points[wEnd.points.length - 1] }
        ];
        for (const ep of endpoints) {
            const epNodeIdx = endpointNodeIndex.get(`${wEnd.id}:${ep.idx}`);
            if (epNodeIdx === undefined)
                continue;
            for (const w of state.wires) {
                if (!w.points || w.points.length < 2)
                    continue;
                if (w.id === wEnd.id)
                    continue;
                const pts = w.points;
                for (let s = 0; s < pts.length - 1; s++) {
                    const a = pts[s], b = pts[s + 1];
                    const { distance, onSegment } = pointToSegmentDistance(ep.pos, a, b);
                    if (!onSegment || distance > tol)
                        continue;
                    // If it's really just endpoint-to-endpoint (near the segment ends), don't treat as an implicit T-junction.
                    if (dist2(ep.pos, a) <= tol2 || dist2(ep.pos, b) <= tol2)
                        continue;
                    // Union the endpoint with the target wire's conductor.
                    const targetEndpointIdx = endpointNodeIndex.get(`${w.id}:0`);
                    if (targetEndpointIdx !== undefined)
                        dsu.union(epNodeIdx, targetEndpointIdx);
                    // Record an implicit junction point at the endpoint position (deterministic).
                    // Note: using ep.pos (not the projected point) matches the user's visual/interaction expectation.
                    implicitJunctionsByKey.set(keyPt(ep.pos), { x: ep.pos.x, y: ep.pos.y });
                    break;
                }
            }
        }
    }
    // Rule: crossings DO NOT connect unless an explicit junction exists.
    // Implementation: For each junction, if it lies on a wire segment (within tol), connect that wire to the junction.
    for (const j of state.junctions) {
        const jIdx = junctionNodeIndex.get(j.id);
        // Also connect to any endpoints within tol (redundant with above, but safe)
        for (const [_, eIdx] of endpointNodeIndex.entries()) {
            if (dist2(nodes[eIdx].pos, j.at) <= tol2)
                dsu.union(jIdx, eIdx);
        }
        for (const w of state.wires) {
            // Check each segment for on-segment proximity
            const pts = w.points;
            for (let s = 0; s < pts.length - 1; s++) {
                const a = pts[s], b = pts[s + 1];
                const { distance, onSegment } = pointToSegmentDistance(j.at, a, b);
                if (onSegment && distance <= tol) {
                    // Connect this wire to the junction by unioning the junction with one endpoint of the wire.
                    const i0 = endpointNodeIndex.get(`${w.id}:0`);
                    if (i0 !== undefined)
                        dsu.union(jIdx, i0);
                    break;
                }
            }
        }
    }
    // Build nets from DSU groups
    const groups = new Map();
    for (let i = 0; i < nodes.length; i++) {
        const r = dsu.find(i);
        let net = groups.get(r);
        if (!net) {
            net = { id: `net:${groups.size + 1}`, members: [] };
            groups.set(r, net);
        }
        net.members.push(nodes[i].member);
    }
    const implicitJunctions = Array.from(implicitJunctionsByKey.values());
    return { nets: Array.from(groups.values()), implicitJunctions };
}
//# sourceMappingURL=connectivity.js.map