import { KiCadRoutingKernel } from '../../kicadKernel.js';
import type { RoutingState, KWire } from '../model.js';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function makeWire(id: string, pts: Array<[number, number]>): KWire {
  return { id, points: pts.map(([x, y]) => ({ x, y })) };
}

function findNetOfWireEndpoint(connectivity: ReturnType<KiCadRoutingKernel['getConnectivity']>, wireId: string, endpointIndex: 0 | 1): string | null {
  for (const net of connectivity.nets) {
    if (net.members.some(m => m.kind === 'wire-endpoint' && m.wireId === wireId && m.endpointIndex === endpointIndex)) return net.id;
  }
  return null;
}

function isOrthogonal(points: Array<{ x: number; y: number }>): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!(a.x === b.x || a.y === b.y)) return false;
  }
  return true;
}

// Test 1: endpoint move + connectivity update
(function testEndpointMoveConnectivityUpdate() {
  const kernel = new KiCadRoutingKernel();
  const state: RoutingState = {
    wires: [
      makeWire('w1', [[0, 0], [10, 0]]),
      makeWire('w2', [[20, 0], [30, 0]])
    ],
    junctions: [],
    pins: [],
    tolerance: 0.5
  };
  kernel.setState(state);

  const before = kernel.getConnectivity();
  const netW1EndBefore = findNetOfWireEndpoint(before, 'w1', 1);
  const netW2StartBefore = findNetOfWireEndpoint(before, 'w2', 0);
  assert(netW1EndBefore && netW2StartBefore && netW1EndBefore !== netW2StartBefore, 'Before move: endpoints should be in different nets');

  kernel.moveWireEndpoint('w2', 0, { x: 10, y: 0 });

  const after = kernel.getConnectivity();
  const netW1EndAfter = findNetOfWireEndpoint(after, 'w1', 1);
  const netW2StartAfter = findNetOfWireEndpoint(after, 'w2', 0);
  assert(netW1EndAfter && netW2StartAfter && netW1EndAfter === netW2StartAfter, 'After move: endpoints should connect and be in same net');
})();

// Test 2: segment drag preserves orthogonality
(function testSegmentDragOrthogonality() {
  const kernel = new KiCadRoutingKernel();
  const state: RoutingState = {
    wires: [makeWire('w1', [[0, 0], [10, 0], [10, 10]])],
    junctions: [],
    pins: [],
    tolerance: 0.5
  };
  kernel.setState(state);

  const res = kernel.dragWireSegment('w1', 0, { x: 5, y: 5 }); // drag horizontal segment upward
  assert(isOrthogonal(res.points), 'After segment drag: polyline must remain orthogonal');
  assert(res.points[0].y === res.points[1].y, 'Dragged segment must remain horizontal');
})();

// Test 3: corner insert/remove determinism
(function testCornerInsertRemoveDeterminism() {
  const kernel = new KiCadRoutingKernel();
  const state: RoutingState = {
    wires: [makeWire('w1', [[0, 0], [20, 0], [20, 10]])],
    junctions: [],
    pins: [],
    tolerance: 0.5
  };
  kernel.setState(state);

  const before = kernel.getState().wires[0].points.map(p => ({ x: p.x, y: p.y }));

  const ins = kernel.insertCorner('w1', 0, { x: 7, y: 3 });
  assert(ins.inserted, 'Insert corner should report inserted=true');
  assert(ins.points.length === before.length + 1, 'Insert corner should add exactly one vertex');
  assert(ins.points[1].x === 7 && ins.points[1].y === 0, 'Inserted vertex should lie on the horizontal segment (clamped)');

  const rem = kernel.removeCorner('w1', 1);
  assert(rem.removed, 'Remove corner should report removed=true');
  assert(rem.points.length === before.length, 'Remove corner should return to original vertex count');
  assert(JSON.stringify(rem.points) === JSON.stringify(before), 'Insert then remove should be deterministic and return to original polyline');
})();

console.log('[kicad-wire-editing-tests] All tests passed');
