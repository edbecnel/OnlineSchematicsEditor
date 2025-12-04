/**
 * Constraint Validator Registry
 * Registers validation functions for each constraint type
 */

import type {
  ConstraintType,
  ConstraintValidator,
  ValidationResult,
  ValidationContext,
  Entity,
  Constraint,
  Point
} from './types.js';

export class ConstraintRegistry {
  private validators: Map<ConstraintType, ConstraintValidator> = new Map();

  /**
   * Register a validator for a constraint type
   */
  register(type: ConstraintType, validator: ConstraintValidator): void {
    this.validators.set(type, validator);
  }

  /**
   * Get validator for a constraint type
   */
  getValidator(type: ConstraintType): ConstraintValidator | undefined {
    return this.validators.get(type);
  }

  /**
   * Check if a constraint type is registered
   */
  hasValidator(type: ConstraintType): boolean {
    return this.validators.has(type);
  }

  /**
   * Get all registered constraint types
   */
  getRegisteredTypes(): ConstraintType[] {
    return Array.from(this.validators.keys());
  }
}

// ====== Built-in Validators ======

/**
 * Create default constraint validators
 */
export function createDefaultValidators(): Map<ConstraintType, ConstraintValidator> {
  const validators = new Map<ConstraintType, ConstraintValidator>();

  // Fixed Position Validator
  validators.set('fixed-position', {
    validate: (entity, proposedPosition, affectedEntities, context, constraint) => {
      // Entity cannot move from its fixed position
      if (!constraint || !constraint.params) {
        return { valid: true };
      }
      
      const fixedPos = (constraint.params as any).position;
      const tolerance = 0.1;
      
      const atFixedPosition = 
        Math.abs(proposedPosition.x - fixedPos.x) < tolerance &&
        Math.abs(proposedPosition.y - fixedPos.y) < tolerance;
      
      if (!atFixedPosition) {
        return {
          valid: false,
          reason: `Entity must stay at fixed position (${fixedPos.x}, ${fixedPos.y})`,
          adjustedPosition: fixedPos
        };
      }
      
      return { valid: true };
    }
  });

  // Fixed Axis Validator
  validators.set('fixed-axis', {
    validate: (entity, proposedPosition, affectedEntities, context, constraint) => {
      if (!constraint || !constraint.params) {
        return { valid: true };
      }
      
      const params = constraint.params as any;
      const axis = params.axis;
      const fixedValue = params.fixedValue;
      const tolerance = 0.1;
      
      if (axis === 'x') {
        // X is fixed, can only move in Y
        if (Math.abs(proposedPosition.x - fixedValue) > tolerance) {
          return {
            valid: false,
            reason: `Movement restricted to Y axis (X must be ${fixedValue})`,
            adjustedPosition: { x: fixedValue, y: proposedPosition.y }
          };
        }
        
        // Check bounds on Y if specified
        if (params.minValue !== undefined && proposedPosition.y < params.minValue) {
          return {
            valid: false,
            reason: `Below minimum Y value (${params.minValue})`,
            adjustedPosition: { x: fixedValue, y: params.minValue }
          };
        }
        if (params.maxValue !== undefined && proposedPosition.y > params.maxValue) {
          return {
            valid: false,
            reason: `Above maximum Y value (${params.maxValue})`,
            adjustedPosition: { x: fixedValue, y: params.maxValue }
          };
        }
      } else if (axis === 'y') {
        // Y is fixed, can only move in X
        if (Math.abs(proposedPosition.y - fixedValue) > tolerance) {
          return {
            valid: false,
            reason: `Movement restricted to X axis (Y must be ${fixedValue})`,
            adjustedPosition: { x: proposedPosition.x, y: fixedValue }
          };
        }
        
        // Check bounds on X if specified
        if (params.minValue !== undefined && proposedPosition.x < params.minValue) {
          return {
            valid: false,
            reason: `Below minimum X value (${params.minValue})`,
            adjustedPosition: { x: params.minValue, y: fixedValue }
          };
        }
        if (params.maxValue !== undefined && proposedPosition.x > params.maxValue) {
          return {
            valid: false,
            reason: `Above maximum X value (${params.maxValue})`,
            adjustedPosition: { x: params.maxValue, y: fixedValue }
          };
        }
      }
      
      return { valid: true };
    }
  });

  // Orthogonal Validator (for wire segments)
  validators.set('orthogonal', {
    validate: (entity, proposedPosition, affectedEntities, context, constraint) => {
      // Wire segments must remain horizontal or vertical
      // This is more complex - requires checking connected points
      // For now, simplified implementation
      return { valid: true };
    }
  });

  // Min Distance Validator (AABB collision detection)
  validators.set('min-distance', {
    validate: (entity, proposedPosition, affectedEntities, context, constraint) => {
      if (!constraint || !constraint.params) {
        return { valid: true };
      }
      
      // Find the other entity in the constraint
      const otherEntityId = constraint.entities.find(id => id !== entity.id);
      if (!otherEntityId) {
        return { valid: true };
      }
      
      const otherEntity = context.allEntities.get(otherEntityId);
      if (!otherEntity) {
        return { valid: true };
      }
      
      // Get rotations for both entities
      const rot1 = (entity.metadata as any)?.rot || 0;
      const rot2 = (otherEntity.metadata as any)?.rot || 0;
      const normalizedRot1 = ((rot1 % 360) + 360) % 360;
      const normalizedRot2 = ((rot2 % 360) + 360) % 360;
      
      const isHoriz1 = (normalizedRot1 === 0 || normalizedRot1 === 180);
      const isHoriz2 = (normalizedRot2 === 0 || normalizedRot2 === 180);
      const isPerpendicular = isHoriz1 !== isHoriz2;
      
      // Get bounding box parameters from constraint params
      // bodyExtent/bodyWidth are for entities[0], bodyExtent2/bodyWidth2 are for entities[1]
      const params = constraint.params as any;
      const bodyExtent_forEntity0 = params.bodyExtent || 50;
      const bodyWidth_forEntity0 = params.bodyWidth || 12;
      const bodyExtent_forEntity1 = params.bodyExtent2 || params.bodyExtent || 50;
      const bodyWidth_forEntity1 = params.bodyWidth2 || params.bodyWidth || 12;
      
      // Determine which entity is the moving one and which is the other
      const isEntity1MovingEntity = constraint.entities[0] === entity.id;
      const movingEntityExtent = isEntity1MovingEntity ? bodyExtent_forEntity0 : bodyExtent_forEntity1;
      const movingEntityWidth = isEntity1MovingEntity ? bodyWidth_forEntity0 : bodyWidth_forEntity1;
      const otherEntityExtent = isEntity1MovingEntity ? bodyExtent_forEntity1 : bodyExtent_forEntity0;
      const otherEntityWidth = isEntity1MovingEntity ? bodyWidth_forEntity1 : bodyWidth_forEntity0;
      
      // Calculate bounding boxes using each component's actual dimensions and rotation
      let bbox1, bbox2;
      
      if (isHoriz1) {
        // Horizontal: wide in X, narrow in Y
        bbox1 = {
          minX: proposedPosition.x - movingEntityExtent,
          maxX: proposedPosition.x + movingEntityExtent,
          minY: proposedPosition.y - movingEntityWidth,
          maxY: proposedPosition.y + movingEntityWidth
        };
      } else {
        // Vertical: narrow in X, wide in Y
        bbox1 = {
          minX: proposedPosition.x - movingEntityWidth,
          maxX: proposedPosition.x + movingEntityWidth,
          minY: proposedPosition.y - movingEntityExtent,
          maxY: proposedPosition.y + movingEntityExtent
        };
      }
      
      if (isHoriz2) {
        bbox2 = {
          minX: otherEntity.position.x - otherEntityExtent,
          maxX: otherEntity.position.x + otherEntityExtent,
          minY: otherEntity.position.y - otherEntityWidth,
          maxY: otherEntity.position.y + otherEntityWidth
        };
      } else {
        bbox2 = {
          minX: otherEntity.position.x - otherEntityWidth,
          maxX: otherEntity.position.x + otherEntityWidth,
          minY: otherEntity.position.y - otherEntityExtent,
          maxY: otherEntity.position.y + otherEntityExtent
        };
      }
      
      // Check for bounding box overlap (AABB collision)
      // Use <= instead of < to allow touching (flush boundaries) but prevent overlap
      const overlaps = !(bbox1.maxX <= bbox2.minX || 
                        bbox1.minX >= bbox2.maxX || 
                        bbox1.maxY <= bbox2.minY || 
                        bbox1.minY >= bbox2.maxY);
      
      console.log(`🔍 Bounding box check: ${entity.id} -> (${proposedPosition.x}, ${proposedPosition.y})`);
      console.log(`   BBox1: [${bbox1.minX.toFixed(1)}, ${bbox1.minY.toFixed(1)}] to [${bbox1.maxX.toFixed(1)}, ${bbox1.maxY.toFixed(1)}]`);
      console.log(`   BBox2: [${bbox2.minX.toFixed(1)}, ${bbox2.minY.toFixed(1)}] to [${bbox2.maxX.toFixed(1)}, ${bbox2.maxY.toFixed(1)}]`);
      console.log(`   Overlap: ${overlaps}`);
      
      if (overlaps) {
        return {
          valid: false,
          reason: `Bounding box overlap with ${otherEntityId}`
        };
      }
      
      return { valid: true };
    }
  });

  // On Grid Validator
  validators.set('on-grid', {
    validate: (entity, proposedPosition, affectedEntities, context, constraint) => {
      if (!constraint || !constraint.params) {
        return { valid: true };
      }
      
      const params = constraint.params as any;
      const gridSize = params.gridSize;
      
      // Check if position is on grid
      const onGridX = Math.abs(proposedPosition.x % gridSize) < 0.1 ||
                      Math.abs(proposedPosition.x % gridSize - gridSize) < 0.1;
      const onGridY = Math.abs(proposedPosition.y % gridSize) < 0.1 ||
                      Math.abs(proposedPosition.y % gridSize - gridSize) < 0.1;
      
      if (!onGridX || !onGridY) {
        // Snap to grid
        const snappedX = Math.round(proposedPosition.x / gridSize) * gridSize;
        const snappedY = Math.round(proposedPosition.y / gridSize) * gridSize;
        
        return {
          valid: true, // Auto-fix by snapping
          adjustedPosition: { x: snappedX, y: snappedY }
        };
      }
      
      return { valid: true };
    }
  });

  // Placeholder validators for other types (to be implemented)
  const placeholderTypes: ConstraintType[] = [
    'coincident',
    'connected',
    'no-overlap',
    'rubber-band',
    'align',
    'maintain-topology'
  ];

  placeholderTypes.forEach(type => {
    validators.set(type, {
      validate: () => ({ valid: true }) // Placeholder - always valid
    });
  });

  return validators;
}
