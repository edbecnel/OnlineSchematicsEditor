import { unifyInlineWires } from '../../../wires.js';
import type { Wire } from '../../../types.js';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function approxEq(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return approxEq(a.x, b.x) && approxEq(a.y, b.y);
}

(function testUnifyDiagonalCollinearSegments() {
  const wires: Wire[] = [
    { id: 'w1', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#000', netId: 'n1' } as any,
    { id: 'w2', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], color: '#000', netId: 'n1' } as any,
  ];

  let idCounter = 0;
  const uid = (prefix: string) => `${prefix}${++idCounter}`;

  const out = unifyInlineWires(
    wires,
    [],
    () => [],
    (v: number) => v,
    uid,
    '#000'
  );

  assert(out.length === 1, 'Expected diagonal collinear wires to unify into 1 segment');
  assert(out[0].points.length === 2, 'Unified wire should be a single 2-point segment');
  assert(samePoint(out[0].points[0], { x: 0, y: 0 }), 'Unified wire should start at (0,0)');
  assert(samePoint(out[0].points[1], { x: 20, y: 20 }), 'Unified wire should end at (20,20)');
  assert((out[0] as any).netId === 'n1', 'Unified wire should preserve netId');
})();

(function testDoesNotUnifyAcrossDifferentNets() {
  const wires: Wire[] = [
    { id: 'w1', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#000', netId: 'n1' } as any,
    { id: 'w2', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], color: '#000', netId: 'n2' } as any,
  ];

  let idCounter = 0;
  const uid = (prefix: string) => `${prefix}${++idCounter}`;

  const out = unifyInlineWires(
    wires,
    [],
    () => [],
    (v: number) => v,
    uid,
    '#000'
  );

  assert(out.length === 2, 'Expected different-net wires not to unify');
})();
