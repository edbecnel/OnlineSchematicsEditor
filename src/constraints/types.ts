/**
 * Constraint-based movement system
 * Declarative rules for component, wire, and junction movement
 */

import type { Point as PointType } from '../types.js';

// Re-export Point for use in this module
export type Point = PointType;

// ====== Entity Types ======

export type EntityType = 
  | 'component'
  | 'wire-point'      // Individual point in a wire's points array
  | 'wire-segment'    // Segment between two points
  | 'junction'
  | 'wire-endpoint';  // Special case for free endpoints

export interface Entity {
  id: string;                    // Unique identifier (e.g., "R1", "wire_5:point2")
  type: EntityType;
  position: Point;
  constraints: Set<string>;      // IDs of constraints affecting this entity
  metadata: Record<string, any>; // Type-specific data
}

// ====== Constraint Types ======

export type ConstraintType = 
  | 'fixed-position'      // Point cannot move (e.g., manual junction)
  | 'fixed-axis'         // Movement restricted to one axis (e.g., SWP movement)
  | 'coincident'         // Multiple points must stay together (e.g., wire connections)
  | 'connected'          // Maintain connection (e.g., component pin to wire)
  | 'orthogonal'         // Wire segment must stay horizontal or vertical
  | 'min-distance'       // Minimum separation between entities
  | 'no-overlap'         // Entities cannot overlap
  | 'on-grid'            // Must snap to grid
  | 'rubber-band'        // Connected wires stretch together (perpendicular only)
  | 'align'              // Alignment constraint (e.g., horizontal/vertical alignment)
  | 'maintain-topology'; // Preserve connection topology when moving

export interface Constraint {
  id: string;
  type: ConstraintType;
  priority: number;              // Higher = more important (0-1000)
  entities: string[];            // Entity IDs affected by this constraint
  params: ConstraintParams;
  enabled: boolean;
  metadata?: {
    createdBy?: string;          // What created this constraint (for debugging)
    reason?: string;             // Human-readable explanation
    temporary?: boolean;         // Removed after operation completes
  };
}

// Type-specific constraint parameters
export type ConstraintParams = 
  | FixedPositionParams
  | FixedAxisParams
  | CoincidentParams
  | ConnectedParams
  | OrthogonalParams
  | MinDistanceParams
  | NoOverlapParams
  | OnGridParams
  | RubberBandParams
  | AlignParams
  | MaintainTopologyParams;

export interface FixedPositionParams {
  position: Point;
  reason?: string;               // e.g., "manual junction", "component pin"
}

export interface FixedAxisParams {
  axis: 'x' | 'y';
  fixedValue: number;            // The coordinate value that's fixed
  minValue?: number;             // Optional bounds along the free axis
  maxValue?: number;
}

export interface CoincidentParams {
  point: Point;                  // The point where entities must coincide
  tolerance?: number;            // Allowed deviation (default 0.1)
}

export interface ConnectedParams {
  connectionType: 'pin-to-wire' | 'wire-to-wire' | 'wire-to-junction';
  maintainConnection: boolean;   // If true, entities move together
  allowSplit?: boolean;          // If true, can split at junctions
  pinIndex?: number;             // For component connections
}

export interface OrthogonalParams {
  axis?: 'x' | 'y';             // If specified, must be this axis
}

export interface MinDistanceParams {
  distance: number;
  measureFrom: 'center' | 'edge';
}

export interface NoOverlapParams {
  padding?: number;              // Extra separation required
}

export interface OnGridParams {
  gridSize: number;
  snapFunction?: (v: number) => number;
}

export interface RubberBandParams {
  connectionPoint: Point;        // Where the wires connect
  stretchAxis: 'x' | 'y';       // Which axis stretches
}

export interface AlignParams {
  axis: 'x' | 'y';
  alignValue: number;            // The coordinate to align to
}

export interface MaintainTopologyParams {
  connectedEntities: string[];   // Entities that must remain connected
  connectionPoints: Point[];     // Where connections exist
}

// ====== Solver Types ======

export interface SolveResult {
  allowed: boolean;
  finalPosition: Point;
  affectedEntities: EntityUpdate[];
  violatedConstraints: ConstraintViolation[];
  closestValid?: Point;          // Nearest valid position if move not allowed
  createdEntities?: Entity[];    // New entities created (e.g., split wires)
  deletedEntities?: string[];    // Entity IDs to remove
}

export interface EntityUpdate {
  id: string;
  newPosition: Point;
  reason?: string;               // Why this entity moved
}

export interface ConstraintViolation {
  constraintId: string;
  constraint: Constraint;
  reason: string;
  severity: 'error' | 'warning';
}

// ====== Constraint Validation Function Type ======

export interface ConstraintValidator {
  /**
   * Validate if a proposed entity position satisfies this constraint
   * @param entity The entity being moved
   * @param proposedPosition Where the entity wants to move
   * @param affectedEntities Other entities that would move as a result
   * @param context Additional context (all entities, other constraints, etc.)
   * @returns Validation result
   */
  validate(
    entity: Entity,
    proposedPosition: Point,
    affectedEntities: EntityUpdate[],
    context: ValidationContext
  ): ValidationResult;

  /**
   * Suggest adjustments to satisfy this constraint
   * @param entity The entity being moved
   * @param proposedPosition Desired position
   * @param context Validation context
   * @returns Suggested position or affected entities
   */
  suggest?(
    entity: Entity,
    proposedPosition: Point,
    context: ValidationContext
  ): SuggestionResult;
}

export interface ValidationContext {
  allEntities: Map<string, Entity>;
  allConstraints: Map<string, Constraint>;
  snapToGrid: (v: number) => number;
  snapToBaseScalar: (v: number) => number;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  adjustedPosition?: Point;      // Constraint can suggest adjustment
  requiredUpdates?: EntityUpdate[]; // Other entities that must move
}

export interface SuggestionResult {
  suggestedPosition?: Point;
  requiredUpdates?: EntityUpdate[];
  createEntities?: Partial<Entity>[];
  deleteEntities?: string[];
}

// ====== Priority Levels (Standard Values) ======

export const PRIORITY = {
  MANUAL_JUNCTION: 200,          // User-placed junctions cannot move
  COMPONENT_CONNECTION: 150,     // Component pins stay connected to wires
  AUTO_JUNCTION: 120,            // Automatic T-junctions
  TOPOLOGY: 100,                 // Maintain wire topology
  RUBBER_BAND: 90,               // Perpendicular wires stretch together
  ORTHOGONAL: 80,                // Wires stay horizontal/vertical
  NO_OVERLAP: 70,                // Prevent component overlap
  MIN_DISTANCE: 60,              // Minimum separation
  GRID_SNAP: 50,                 // Snap to grid (lowest priority)
  ALIGN: 40                      // Alignment hints
} as const;
