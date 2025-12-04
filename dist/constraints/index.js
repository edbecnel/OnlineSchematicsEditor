/**
 * Constraint System - Main Export
 *
 * A declarative constraint-based system for managing component, wire, and junction movement.
 *
 * Usage:
 * ```typescript
 * import { ConstraintSolver, createComponentEntity } from './constraints/index.js';
 *
 * const solver = new ConstraintSolver(snap, snapToBaseScalar);
 *
 * // Add entities
 * const entity = createComponentEntity(component);
 * solver.addEntity(entity);
 *
 * // Add constraints
 * const constraints = buildComponentConstraints(component, ...);
 * constraints.forEach(c => solver.addConstraint(c));
 *
 * // Attempt move
 * const result = solver.solve(component.id, newPosition);
 * if (result.allowed) {
 *   solver.applyResult(result);
 *   redraw();
 * }
 * ```
 */
export * from './types.js';
export * from './graph.js';
export * from './registry.js';
export * from './solver.js';
export * from './builders.js';
// Re-export commonly used items
export { PRIORITY } from './types.js';
export { ConstraintSolver } from './solver.js';
export { ConstraintGraph } from './graph.js';
export { ConstraintRegistry, createDefaultValidators } from './registry.js';
export { createComponentEntity, createWirePointEntity, createJunctionEntity, buildComponentConstraints, buildWireConstraints, buildJunctionConstraints, buildSwpConstraints, buildRubberBandConstraints, rebuildAllConstraints } from './builders.js';
//# sourceMappingURL=index.js.map