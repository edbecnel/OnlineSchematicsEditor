/**
 * Constraint System Usage Examples
 *
 * This file demonstrates how to use the constraint system
 * and can be used for testing the implementation.
 */
import { ConstraintSolver, createComponentEntity, createJunctionEntity, PRIORITY } from './index.js';
// ====== Example 1: Basic Component Movement ======
export function example1_BasicComponentMovement() {
    console.log('=== Example 1: Basic Component Movement ===');
    // Create solver
    const snap = (v) => Math.round(v / 10) * 10;
    const snapToBaseScalar = (v) => v;
    const solver = new ConstraintSolver(snap, snapToBaseScalar);
    // Create a component entity
    const component = {
        id: 'R1',
        type: 'resistor',
        x: 100,
        y: 100,
        rot: 0,
        label: 'R1',
        value: '10k'
    };
    const entity = createComponentEntity(component);
    solver.addEntity(entity);
    // Add a grid snap constraint
    solver.addConstraint({
        id: 'grid_snap_R1',
        type: 'on-grid',
        priority: PRIORITY.GRID_SNAP,
        entities: ['R1'],
        params: { gridSize: 10 },
        enabled: true
    });
    // Attempt to move component
    const result = solver.solve('R1', { x: 123, y: 147 });
    console.log('Move result:', {
        allowed: result.allowed,
        finalPosition: result.finalPosition, // Should be snapped: (120, 150)
        violations: result.violatedConstraints.length
    });
    if (result.allowed) {
        solver.applyResult(result);
        console.log('Component moved to:', solver.getEntity('R1')?.position);
    }
}
// ====== Example 2: Fixed Axis Movement (SWP) ======
export function example2_FixedAxisMovement() {
    console.log('\n=== Example 2: Fixed Axis Movement (SWP) ===');
    const snap = (v) => Math.round(v / 10) * 10;
    const solver = new ConstraintSolver(snap, snap);
    const component = {
        id: 'R2',
        type: 'resistor',
        x: 100,
        y: 200,
        rot: 0,
        label: 'R2'
    };
    const entity = createComponentEntity(component);
    solver.addEntity(entity);
    // Component can only move horizontally (Y is fixed)
    solver.addConstraint({
        id: 'swp_R2',
        type: 'fixed-axis',
        priority: PRIORITY.TOPOLOGY,
        entities: ['R2'],
        params: {
            axis: 'y',
            fixedValue: 200,
            minValue: 50,
            maxValue: 500
        },
        enabled: true
    });
    // Try to move diagonally - should constrain to horizontal
    const result = solver.solve('R2', { x: 250, y: 300 });
    console.log('Diagonal move result:', {
        allowed: result.allowed,
        requestedPosition: { x: 250, y: 300 },
        finalPosition: result.finalPosition, // Should be (250, 200) - Y fixed
        violations: result.violatedConstraints.map(v => v.reason)
    });
}
// ====== Example 3: Manual Junction (Fixed Position) ======
export function example3_ManualJunction() {
    console.log('\n=== Example 3: Manual Junction (Fixed Position) ===');
    const snap = (v) => v;
    const solver = new ConstraintSolver(snap, snap);
    const junction = {
        id: 'J1',
        at: { x: 150, y: 150 },
        manual: true
    };
    const entity = createJunctionEntity(junction);
    solver.addEntity(entity);
    // Manual junctions cannot move
    solver.addConstraint({
        id: 'fixed_J1',
        type: 'fixed-position',
        priority: PRIORITY.MANUAL_JUNCTION,
        entities: ['J1'],
        params: {
            position: { x: 150, y: 150 },
            reason: 'Manual junction'
        },
        enabled: true
    });
    // Try to move junction - should be blocked
    const result = solver.solve('J1', { x: 200, y: 200 });
    console.log('Junction move result:', {
        allowed: result.allowed,
        violations: result.violatedConstraints.map(v => v.reason),
        closestValid: result.closestValid // Should suggest staying at (150, 150)
    });
}
// ====== Example 4: Query Constraints ======
export function example4_QueryConstraints() {
    console.log('\n=== Example 4: Query Constraints ===');
    const snap = (v) => v;
    const solver = new ConstraintSolver(snap, snap);
    const component = {
        id: 'R3',
        type: 'resistor',
        x: 100,
        y: 100,
        rot: 0,
        label: 'R3'
    };
    const entity = createComponentEntity(component);
    solver.addEntity(entity);
    // Add multiple constraints
    solver.addConstraint({
        id: 'grid_R3',
        type: 'on-grid',
        priority: PRIORITY.GRID_SNAP,
        entities: ['R3'],
        params: { gridSize: 10 },
        enabled: true,
        metadata: { reason: 'Snap to 10px grid' }
    });
    solver.addConstraint({
        id: 'bounds_R3',
        type: 'fixed-axis',
        priority: PRIORITY.TOPOLOGY,
        entities: ['R3'],
        params: {
            axis: 'x',
            fixedValue: 100,
            minValue: 0,
            maxValue: 500
        },
        enabled: true,
        metadata: { reason: 'Constrain to vertical line' }
    });
    // Query constraints for this entity
    const constraints = solver.getConstraintsFor('R3');
    console.log(`Component R3 has ${constraints.length} constraints:`);
    constraints.forEach(c => {
        console.log(`  - ${c.type} (priority: ${c.priority}): ${c.metadata?.reason}`);
    });
    // Try a move and explain violations
    const explanations = solver.explainViolations('R3', { x: 250, y: 120 });
    console.log('\nMove to (250, 120) explanation:', explanations);
}
// ====== Example 5: Performance Test ======
export function example5_PerformanceTest() {
    console.log('\n=== Example 5: Performance Test ===');
    const snap = (v) => v;
    const solver = new ConstraintSolver(snap, snap);
    // Add many entities and constraints
    const entityCount = 100;
    const constraintCount = 200;
    console.time('Add entities');
    for (let i = 0; i < entityCount; i++) {
        solver.addEntity({
            id: `entity_${i}`,
            type: 'component',
            position: { x: Math.random() * 1000, y: Math.random() * 1000 },
            constraints: new Set(),
            metadata: {}
        });
    }
    console.timeEnd('Add entities');
    console.time('Add constraints');
    for (let i = 0; i < constraintCount; i++) {
        const entityIds = [
            `entity_${Math.floor(Math.random() * entityCount)}`,
            `entity_${Math.floor(Math.random() * entityCount)}`
        ];
        solver.addConstraint({
            id: `constraint_${i}`,
            type: 'min-distance',
            priority: 50,
            entities: entityIds,
            params: { distance: 20, measureFrom: 'center' },
            enabled: true
        });
    }
    console.timeEnd('Add constraints');
    // Test solve performance
    console.time('Solve (cold)');
    const result1 = solver.solve('entity_0', { x: 500, y: 500 });
    console.timeEnd('Solve (cold)');
    console.time('Solve (warm)');
    const result2 = solver.solve('entity_1', { x: 600, y: 600 });
    console.timeEnd('Solve (warm)');
    // Get statistics
    const stats = solver.getStats();
    console.log('Constraint graph statistics:', stats);
}
// ====== Example 6: Debugging Export ======
export function example6_DebuggingExport() {
    console.log('\n=== Example 6: Debugging Export ===');
    const snap = (v) => v;
    const solver = new ConstraintSolver(snap, snap);
    // Add some entities and constraints
    solver.addEntity({
        id: 'R4',
        type: 'component',
        position: { x: 100, y: 100 },
        constraints: new Set(),
        metadata: { type: 'resistor' }
    });
    solver.addConstraint({
        id: 'grid_R4',
        type: 'on-grid',
        priority: 50,
        entities: ['R4'],
        params: { gridSize: 10 },
        enabled: true
    });
    // Export state for debugging
    const state = solver.exportState();
    console.log('Exported state:', JSON.stringify(state, null, 2));
}
// ====== Run All Examples ======
export function runAllExamples() {
    example1_BasicComponentMovement();
    example2_FixedAxisMovement();
    example3_ManualJunction();
    example4_QueryConstraints();
    example5_PerformanceTest();
    example6_DebuggingExport();
    console.log('\n=== All examples complete ===');
}
// For browser console testing:
// import { runAllExamples } from './constraints/examples.js';
// runAllExamples();
//# sourceMappingURL=examples.js.map