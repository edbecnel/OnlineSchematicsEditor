import { deriveConnectivity } from '../connectivity.js';
function makeWire(id, pts) {
    return { id, points: pts.map(([x, y]) => ({ x, y })) };
}
function findNetOfPin(connectivity, pinId) {
    for (const net of connectivity.nets) {
        if (net.members.some(m => m.kind === 'pin' && m.pinId === pinId))
            return net.id;
    }
    return null;
}
function findNetOfWireEndpoint(connectivity, wireId, endpointIndex) {
    for (const net of connectivity.nets) {
        if (net.members.some(m => m.kind === 'wire-endpoint' && m.wireId === wireId && m.endpointIndex === endpointIndex))
            return net.id;
    }
    return null;
}
function assert(condition, message) {
    if (!condition)
        throw new Error(`Assertion failed: ${message}`);
}
// Test 1: endpoint-to-endpoint connects
(function testEndpointToEndpointConnects() {
    const wires = [
        makeWire('w1', [[0, 0], [10, 0]]),
        makeWire('w2', [[10, 0], [20, 0]])
    ];
    const pins = [];
    const junctions = [];
    const state = { wires, pins, junctions, tolerance: 0.5 };
    const conn = deriveConnectivity(state);
    const netW1End = findNetOfWireEndpoint(conn, 'w1', 1);
    const netW2Start = findNetOfWireEndpoint(conn, 'w2', 0);
    assert(netW1End && netW2Start && netW1End === netW2Start, 'Endpoint-to-endpoint should connect at shared point');
})();
// Test 2: endpoint-to-pin connects
(function testEndpointToPinConnects() {
    const wires = [makeWire('w1', [[0, 0], [10, 0]])];
    const pins = [{ id: 'p1', at: { x: 10, y: 0 } }];
    const junctions = [];
    const state = { wires, pins, junctions, tolerance: 0.5 };
    const conn = deriveConnectivity(state);
    const netPin = findNetOfPin(conn, 'p1');
    const netW1End = findNetOfWireEndpoint(conn, 'w1', 1);
    assert(netPin && netW1End && netPin === netW1End, 'Endpoint should connect to pin at same location');
})();
// Test 3: crossing without junction does NOT connect
(function testCrossingWithoutJunctionDoesNotConnect() {
    const wires = [
        makeWire('w1', [[0, 0], [20, 0]]),
        makeWire('w2', [[10, -10], [10, 10]])
    ];
    const pins = [];
    const junctions = [];
    const state = { wires, pins, junctions, tolerance: 0.5 };
    const conn = deriveConnectivity(state);
    const netW1End = findNetOfWireEndpoint(conn, 'w1', 1);
    const netW2Start = findNetOfWireEndpoint(conn, 'w2', 0);
    assert(netW1End !== null && netW2Start !== null && netW1End !== netW2Start, 'Crossing without junction must not connect nets');
})();
// Test 4: crossing with junction DOES connect
(function testCrossingWithJunctionDoesConnect() {
    const wires = [
        makeWire('w1', [[0, 0], [20, 0]]),
        makeWire('w2', [[10, -10], [10, 10]])
    ];
    const pins = [];
    const junctions = [{ id: 'j1', at: { x: 10, y: 0 } }];
    const state = { wires, pins, junctions, tolerance: 0.5 };
    const conn = deriveConnectivity(state);
    const netW1End = findNetOfWireEndpoint(conn, 'w1', 1);
    const netW2Start = findNetOfWireEndpoint(conn, 'w2', 0);
    assert(netW1End && netW2Start && netW1End === netW2Start, 'Crossing with explicit junction should connect nets');
})();
// Test 5: T-junction follows junction rule
(function testTJunctionRule() {
    // Without junction: do not connect
    {
        const wires = [
            makeWire('wa', [[0, 0], [20, 0]]),
            makeWire('wb', [[10, 0], [10, -10]])
        ];
        const state = { wires, pins: [], junctions: [], tolerance: 0.5 };
        const conn = deriveConnectivity(state);
        const netA = findNetOfWireEndpoint(conn, 'wa', 1);
        const netB = findNetOfWireEndpoint(conn, 'wb', 0);
        assert(netA !== null && netB !== null && netA !== netB, 'T-junction without explicit junction must not connect');
    }
    // With junction: DO connect
    {
        const wires = [
            makeWire('wa', [[0, 0], [20, 0]]),
            makeWire('wb', [[10, 0], [10, -10]])
        ];
        const state = { wires, pins: [], junctions: [{ id: 'j2', at: { x: 10, y: 0 } }], tolerance: 0.5 };
        const conn = deriveConnectivity(state);
        const netA = findNetOfWireEndpoint(conn, 'wa', 1);
        const netB = findNetOfWireEndpoint(conn, 'wb', 0);
        assert(netA && netB && netA === netB, 'T-junction with explicit junction must connect');
    }
})();
console.log('[kicad-connectivity-tests] All tests passed');
//# sourceMappingURL=connectivity.test.js.map