import { KiCadRoutingKernel } from '../../kicadKernel.js';
import type { RoutingState } from '../model.js';
import { deriveConnectivity } from '../connectivity.js';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// Setup kernel with empty state
const kernel = new KiCadRoutingKernel();
const state: RoutingState = { wires: [], junctions: [], pins: [], tolerance: 0.5 };
kernel.setState(state);

// Preview (orthogonal): begin at (0,0), update to (10,10) with HV should produce [A, (10,0), (10,10)]
kernel.setLineDrawingMode?.('orthogonal');
kernel.beginPlacement({ x: 0, y: 0 }, 'HV');
let { preview } = kernel.updatePlacement({ x: 10, y: 10 });
assert(preview.length === 3, 'Preview should include 3 points for HV bend');
assert(preview[1].x === 10 && preview[1].y === 0, 'Intermediate bend should be (10,0) for HV');
assert(preview[2].x === 10 && preview[2].y === 10, 'End should be (10,10)');

// Commit corner at current location
let commitRes = kernel.commitCorner();
assert(commitRes.points.length >= 2, 'Committed points should include at least start and last');

// Finish and check wire committed into state
const finishRes = kernel.finishPlacement();
assert(finishRes.points.length === preview.length, 'Finish points should match preview');
assert(state.wires.length === 1, 'One wire should be committed to state');

// Preview (free-angle): straight segment from last committed to cursor
kernel.setLineDrawingMode?.('free');
kernel.beginPlacement({ x: 0, y: 0 }, 'HV');
({ preview } = kernel.updatePlacement({ x: 10, y: 10 }));
assert(preview.length === 2, 'Free-angle preview should include 2 points (start, end)');
assert(preview[0].x === 0 && preview[0].y === 0, 'Free-angle preview start should be (0,0)');
assert(preview[1].x === 10 && preview[1].y === 10, 'Free-angle preview end should be (10,10)');
kernel.finishPlacement();
assert(state.wires.length === 2, 'Second wire should be committed to state');

// Connectivity (no pins/junctions, single wire -> one net with its endpoints at least in same conductor)
const connectivity = deriveConnectivity(state);
assert(connectivity.nets.length >= 1, 'Connectivity should produce at least one net');

console.log('[kicad-wire-placement-tests] All tests passed');
