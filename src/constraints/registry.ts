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
      
      const paramsAll = constraint.params as any;
      // If scoped to a specific pair and this move matches, allow relaxation
      const between = paramsAll.betweenIds as [string, string] | undefined;
      if (between && between.length === 2) {
        const [a, b] = between;
        const isPair = (entity.id === a && constraint.entities.includes(b)) ||
                       (entity.id === b && constraint.entities.includes(a));
        if (isPair && constraint.metadata?.temporary === true) {
          return { valid: true };
        }
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
      const clearanceOverride = params.clearanceOverridePx;
      const bodyExtent_forEntity0 = (params.bodyExtent ?? 50);
      const bodyWidth_forEntity0 = (params.bodyWidth ?? 12);
      const bodyExtent_forEntity1 = (params.bodyExtent2 ?? params.bodyExtent ?? 50);
      const bodyWidth_forEntity1 = (params.bodyWidth2 ?? params.bodyWidth ?? 12);
      
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
      
      // Optional clearance override: if provided, expand boxes before checking
      if (!overlaps && typeof clearanceOverride === 'number' && clearanceOverride > 0) {
        const c = clearanceOverride;
        const expanded1 = { minX: bbox1.minX - c, maxX: bbox1.maxX + c, minY: bbox1.minY - c, maxY: bbox1.maxY + c };
        const expanded2 = { minX: bbox2.minX - c, maxX: bbox2.maxX + c, minY: bbox2.minY - c, maxY: bbox2.maxY + c };
        const violatesClearance = !(expanded1.maxX <= expanded2.minX ||
                                   expanded1.minX >= expanded2.maxX ||
                                   expanded1.maxY <= expanded2.minY ||
                                   expanded1.minY >= expanded2.maxY);
        if (violatesClearance) {
          return {
            valid: false,
            reason: `Minimum clearance not satisfied with ${otherEntityId}`
          };
        }
      }
      
      if (overlaps) {
        return {
          valid: false,
          reason: `Bounding box overlap with ${otherEntityId}`
        };
      }
      
      return { valid: true };
    }
  });

  // Pin Touch Validator: ensure a specific component pin coincides with target
  validators.set('pin-touch', {
    validate: (entity, proposedPosition, affectedEntities, context, constraint) => {
      if (!constraint || !constraint.params) {
        return { valid: true };
      }

      const params = constraint.params as any;
      const epsilon: number = typeof params.epsilon === 'number' ? params.epsilon : 0.1;
      const gridOnly: boolean = !!params.gridOnly;
      const pinIndex: number = typeof params.pinIndex === 'number' ? params.pinIndex : 0;
      const targetId: string = params.targetEntityId;
      const targetPinIndex: number | undefined = typeof params.targetPinIndex === 'number' ? params.targetPinIndex : undefined;
      const target = context.allEntities.get(targetId);

      if (!target) {
        return { valid: true };
      }

      // If gridOnly, snap proposed to grid for evaluation
      const basePos = gridOnly ? { x: context.snapToGrid(proposedPosition.x), y: context.snapToGrid(proposedPosition.y) } : proposedPosition;

      // Compute moving pin position using metadata pinOffsets if available
      const pinOffsets: Array<{ x: number, y: number }> | undefined = (entity.metadata as any)?.pinOffsets;
      const movingPinPos = pinOffsets && pinOffsets[pinIndex]
        ? { x: basePos.x + pinOffsets[pinIndex].x, y: basePos.y + pinOffsets[pinIndex].y }
        : basePos;

      // Compute target pin/point position
      const targetPinOffsets: Array<{ x: number, y: number }> | undefined = (target.metadata as any)?.pinOffsets;
      const targetPos = (typeof targetPinIndex === 'number' && targetPinOffsets && targetPinOffsets[targetPinIndex])
        ? { x: target.position.x + targetPinOffsets[targetPinIndex].x, y: target.position.y + targetPinOffsets[targetPinIndex].y }
        : target.position;

      const dx = Math.abs(movingPinPos.x - targetPos.x);
      const dy = Math.abs(movingPinPos.y - targetPos.y);
      const touches = dx <= epsilon && dy <= epsilon;

      if (!touches) {
        // Suggest snapping to target when close
        if (dx <= epsilon * 2 && dy <= epsilon * 2) {
          // Suggest adjusted base position that would align moving pin to target
          const suggested = pinOffsets && pinOffsets[pinIndex]
            ? { x: targetPos.x - pinOffsets[pinIndex].x, y: targetPos.y - pinOffsets[pinIndex].y }
            : targetPos;
          return { valid: true, adjustedPosition: suggested };
        }
        return { valid: false, reason: `Pin not coincident with target ${targetId}` };
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
    'pin-touch',
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
