/**
 * Constraint Solver
 * Resolves constraints when entities move
 */

import type {
  SolveResult,
  Entity,
  Constraint,
  EntityUpdate,
  ConstraintViolation,
  ValidationContext,
  Point
} from './types.js';
import { ConstraintGraph } from './graph.js';
import { ConstraintRegistry, createDefaultValidators } from './registry.js';

export class ConstraintSolver {
  private graph: ConstraintGraph;
  private registry: ConstraintRegistry;

  constructor(
    private snapToGrid: (v: number) => number,
    private snapToBaseScalar: (v: number) => number
  ) {
    this.graph = new ConstraintGraph();
    this.registry = new ConstraintRegistry();
    
    // Register default validators
    const defaultValidators = createDefaultValidators();
    for (const [type, validator] of defaultValidators) {
      this.registry.register(type, validator);
    }
  }

  // ====== Graph Access ======

  getGraph(): ConstraintGraph {
    return this.graph;
  }

  getRegistry(): ConstraintRegistry {
    return this.registry;
  }

  // ====== Entity Management ======

  addEntity(entity: Entity): void {
    this.graph.addEntity(entity);
  }

  getEntity(id: string): Entity | undefined {
    return this.graph.getEntity(id);
  }

  removeEntity(id: string): void {
    this.graph.removeEntity(id);
  }

  // ====== Constraint Management ======

  addConstraint(constraint: Constraint): void {
    this.graph.addConstraint(constraint);
  }

  getConstraint(id: string): Constraint | undefined {
    return this.graph.getConstraint(id);
  }

  removeConstraint(id: string): void {
    this.graph.removeConstraint(id);
  }

  getConstraintsFor(entityId: string): Constraint[] {
    return this.graph.getConstraintsForEntity(entityId);
  }

  // ====== Core Solver ======

  /**
   * Attempt to move an entity to a new position
   * Returns what would happen if the move is executed
   */
  solve(entityId: string, proposedPosition: Point): SolveResult {
    const entity = this.graph.getEntity(entityId);
    
    if (!entity) {
      return {
        allowed: false,
        finalPosition: proposedPosition,
        affectedEntities: [],
        violatedConstraints: [{
          constraintId: 'none',
          constraint: null as any,
          reason: `Entity ${entityId} not found`,
          severity: 'error'
        }]
      };
    }

    // Get all constraints affecting this entity
    const constraints = this.graph.getConstraintsForEntity(entityId)
      .sort((a, b) => b.priority - a.priority); // Higher priority first

    // Build validation context
    const context: ValidationContext = {
      allEntities: new Map(
        this.graph.getAllEntities().map(e => [e.id, e])
      ),
      allConstraints: new Map(
        this.graph.getAllConstraints().map(c => [c.id, c])
      ),
      snapToGrid: this.snapToGrid,
      snapToBaseScalar: this.snapToBaseScalar
    };

    // Track affected entities and violations
    const affectedEntities: EntityUpdate[] = [
      { id: entityId, newPosition: proposedPosition, reason: 'primary move' }
    ];
    const violations: ConstraintViolation[] = [];
    let currentPosition = { ...proposedPosition };
    let allowed = true;

    // Validate against each constraint
    for (const constraint of constraints) {
      const validator = this.registry.getValidator(constraint.type);
      
      if (!validator) {
        // No validator registered - skip
        continue;
      }

      const result = validator.validate(
        entity,
        currentPosition,
        affectedEntities,
        context,
        constraint
      );

      if (!result.valid) {
        allowed = false;
        violations.push({
          constraintId: constraint.id,
          constraint,
          reason: result.reason || 'Constraint violation',
          severity: 'error'
        });

        // Use adjusted position if provided
        if (result.adjustedPosition) {
          currentPosition = result.adjustedPosition;
        }
      } else if (result.adjustedPosition) {
        // Constraint passed but suggested adjustment
        currentPosition = result.adjustedPosition;
      }

      // Add required updates from this constraint
      if (result.requiredUpdates) {
        for (const update of result.requiredUpdates) {
          // Don't duplicate the primary entity
          if (update.id !== entityId) {
            affectedEntities.push(update);
          }
        }
      }
    }

    // Update the primary entity's position to the final resolved position
    affectedEntities[0].newPosition = currentPosition;

    return {
      allowed,
      finalPosition: currentPosition,
      affectedEntities,
      violatedConstraints: violations,
      closestValid: allowed ? undefined : currentPosition
    };
  }

  /**
   * Apply a solve result (actually move the entities)
   */
  applyResult(result: SolveResult): void {
    if (!result.allowed) {
      console.warn('Attempting to apply disallowed move result');
      return;
    }

    for (const update of result.affectedEntities) {
      this.graph.updateEntityPosition(update.id, update.newPosition);
    }

    // Handle created/deleted entities
    if (result.createdEntities) {
      for (const entity of result.createdEntities) {
        this.graph.addEntity(entity);
      }
    }

    if (result.deletedEntities) {
      for (const entityId of result.deletedEntities) {
        this.graph.removeEntity(entityId);
      }
    }
  }

  // ====== Batch Operations ======

  /**
   * Temporarily disable specific constraint types
   */
  disableConstraints(types: string[]): void {
    const typeSet = new Set(types);
    for (const constraint of this.graph.getAllConstraints()) {
      if (typeSet.has(constraint.type)) {
        this.graph.disableConstraint(constraint.id);
      }
    }
  }

  /**
   * Re-enable specific constraint types
   */
  enableConstraints(types: string[]): void {
    const typeSet = new Set(types);
    for (const constraint of this.graph.getAllConstraints()) {
      if (typeSet.has(constraint.type)) {
        this.graph.enableConstraint(constraint.id);
      }
    }
  }

  /**
   * Clear all temporary constraints
   */
  clearTemporaryConstraints(): void {
    this.graph.clearTemporaryConstraints();
  }

  /**
   * Rebuild entire constraint system (e.g., after topology change)
   */
  rebuild(): void {
    // This would be implemented to recreate constraints from current state
    // For now, placeholder
    console.log('Rebuild called - constraints would be regenerated');
  }

  // ====== Debugging ======

  /**
   * Explain why an entity cannot move to a position
   */
  explainViolations(entityId: string, proposedPosition: Point): string[] {
    const result = this.solve(entityId, proposedPosition);
    
    if (result.allowed) {
      return ['Move is allowed'];
    }

    return result.violatedConstraints.map(v => 
      `[${v.constraint.type}] ${v.reason} (priority: ${v.constraint.priority})`
    );
  }

  /**
   * Get statistics about the constraint system
   */
  getStats() {
    return this.graph.getStats();
  }

  /**
   * Export current state for debugging
   */
  exportState(): any {
    return {
      entities: this.graph.getAllEntities().map(e => ({
        id: e.id,
        type: e.type,
        position: e.position,
        constraintCount: e.constraints.size
      })),
      constraints: this.graph.getAllConstraints().map(c => ({
        id: c.id,
        type: c.type,
        priority: c.priority,
        enabled: c.enabled,
        entityCount: c.entities.length
      })),
      stats: this.getStats()
    };
  }
}
