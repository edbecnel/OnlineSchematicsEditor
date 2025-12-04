/**
 * Constraint Builders
 * Convenience functions for creating constraints from existing entities
 */

import type { Component, Wire, Junction, Point } from '../types.js';
import type { Constraint, Entity } from './types.js';
import { PRIORITY } from './types.js';

let constraintIdCounter = 0;
function uid(prefix: string): string {
  return `${prefix}_${constraintIdCounter++}`;
}

/**
 * Create entity from component
 */
export function createComponentEntity(component: Component): Entity {
  return {
    id: component.id,
    type: 'component',
    position: { x: component.x, y: component.y },
    constraints: new Set(),
    metadata: {
      componentType: component.type,
      rotation: component.rot,
      label: component.label
    }
  };
}

/**
 * Create entity from wire point
 */
export function createWirePointEntity(
  wireId: string, 
  pointIndex: number, 
  point: Point
): Entity {
  return {
    id: `${wireId}:point${pointIndex}`,
    type: 'wire-point',
    position: { ...point },
    constraints: new Set(),
    metadata: {
      wireId,
      pointIndex
    }
  };
}

/**
 * Create entity from junction
 */
export function createJunctionEntity(junction: Junction): Entity {
  return {
    id: junction.id,
    type: 'junction',
    position: { ...junction.at },
    constraints: new Set(),
    metadata: {
      manual: junction.manual,
      suppressed: junction.suppressed,
      netId: junction.netId
    }
  };
}

/**
 * Build constraints for a component
 */
export function buildComponentConstraints(
  component: Component,
  getPinPositions: (c: Component) => Point[],
  findWireAt: (pt: Point, wires: Wire[]) => Wire | null,
  wires: Wire[]
): Constraint[] {
  const constraints: Constraint[] = [];
  const pins = getPinPositions(component);

  // Check each pin for wire connections
  pins.forEach((pin, pinIndex) => {
    const wire = findWireAt(pin, wires);
    
    if (wire) {
      // Component pin connected to wire
      constraints.push({
        id: uid('constraint'),
        type: 'connected',
        priority: PRIORITY.COMPONENT_CONNECTION,
        entities: [component.id, wire.id],
        params: {
          connectionType: 'pin-to-wire',
          maintainConnection: true,
          pinIndex
        },
        enabled: true,
        metadata: {
          createdBy: 'buildComponentConstraints',
          reason: `Pin ${pinIndex} connected to ${wire.id}`
        }
      });
    }
  });

  // Prevent overlap with other components
  // This would need a list of other components, simplified here
  constraints.push({
    id: uid('constraint'),
    type: 'no-overlap',
    priority: PRIORITY.NO_OVERLAP,
    entities: [component.id],
    params: { padding: 5 },
    enabled: true,
    metadata: {
      createdBy: 'buildComponentConstraints',
      reason: 'Prevent component overlap'
    }
  });

  return constraints;
}

/**
 * Build constraints for a wire
 */
export function buildWireConstraints(wire: Wire): Constraint[] {
  const constraints: Constraint[] = [];

  // Each segment must stay orthogonal
  for (let i = 0; i < wire.points.length - 1; i++) {
    const p0 = wire.points[i];
    const p1 = wire.points[i + 1];
    
    // Determine current axis
    const isHorizontal = Math.abs(p0.y - p1.y) < 1;
    const isVertical = Math.abs(p0.x - p1.x) < 1;
    
    if (isHorizontal || isVertical) {
      constraints.push({
        id: uid('constraint'),
        type: 'orthogonal',
        priority: PRIORITY.ORTHOGONAL,
        entities: [`${wire.id}:point${i}`, `${wire.id}:point${i + 1}`],
        params: {
          axis: isHorizontal ? 'x' : isVertical ? 'y' : undefined
        },
        enabled: true,
        metadata: {
          createdBy: 'buildWireConstraints',
          reason: `Segment ${i} must stay ${isHorizontal ? 'horizontal' : 'vertical'}`
        }
      });
    }
  }

  return constraints;
}

/**
 * Build constraints for a junction
 */
export function buildJunctionConstraints(
  junction: Junction,
  findWiresAt: (pt: Point, wires: Wire[]) => Wire[],
  wires: Wire[]
): Constraint[] {
  const constraints: Constraint[] = [];
  const connectedWires = findWiresAt(junction.at, wires);

  if (junction.manual) {
    // Manual junctions are fixed in position
    constraints.push({
      id: uid('constraint'),
      type: 'fixed-position',
      priority: PRIORITY.MANUAL_JUNCTION,
      entities: [junction.id, ...connectedWires.map(w => w.id)],
      params: {
        position: junction.at,
        reason: 'Manual junction'
      },
      enabled: true,
      metadata: {
        createdBy: 'buildJunctionConstraints',
        reason: 'Manual junction cannot move'
      }
    });
  } else if (!junction.suppressed) {
    // Automatic junctions create coincident constraints
    constraints.push({
      id: uid('constraint'),
      type: 'coincident',
      priority: PRIORITY.AUTO_JUNCTION,
      entities: [junction.id, ...connectedWires.map(w => w.id)],
      params: {
        point: junction.at,
        tolerance: 1.0
      },
      enabled: true,
      metadata: {
        createdBy: 'buildJunctionConstraints',
        reason: 'Automatic T-junction'
      }
    });
  }

  return constraints;
}

/**
 * Build constraints for SWP (Straight Wire Path) movement
 */
export function buildSwpConstraints(
  componentId: string,
  axis: 'x' | 'y',
  fixedCoord: number,
  minValue: number,
  maxValue: number
): Constraint[] {
  return [{
    id: uid('constraint'),
    type: 'fixed-axis',
    priority: PRIORITY.TOPOLOGY,
    entities: [componentId],
    params: {
      axis,
      fixedValue: fixedCoord,
      minValue,
      maxValue
    },
    enabled: true,
    metadata: {
      createdBy: 'buildSwpConstraints',
      reason: 'Component moving along SWP',
      temporary: true // Remove after move completes
    }
  }];
}

/**
 * Build rubber-band constraints for wire stretching
 */
export function buildRubberBandConstraints(
  wireId: string,
  connectedWires: Array<{ wire: Wire; connectionPoint: Point }>,
  stretchAxis: 'x' | 'y'
): Constraint[] {
  return connectedWires.map(({ wire, connectionPoint }) => ({
    id: uid('constraint'),
    type: 'rubber-band',
    priority: PRIORITY.RUBBER_BAND,
    entities: [wireId, wire.id],
    params: {
      connectionPoint,
      stretchAxis
    },
    enabled: true,
    metadata: {
      createdBy: 'buildRubberBandConstraints',
      reason: 'Perpendicular wires stretch together',
      temporary: true
    }
  }));
}

/**
 * Rebuild all constraints from current state
 */
export function rebuildAllConstraints(
  components: Component[],
  wires: Wire[],
  junctions: Junction[],
  getPinPositions: (c: Component) => Point[],
  findWireAt: (pt: Point, wires: Wire[]) => Wire | null,
  findWiresAt: (pt: Point, wires: Wire[]) => Wire[]
): Constraint[] {
  const allConstraints: Constraint[] = [];

  // Build component constraints
  for (const component of components) {
    const constraints = buildComponentConstraints(
      component,
      getPinPositions,
      findWireAt,
      wires
    );
    allConstraints.push(...constraints);
  }

  // Build wire constraints
  for (const wire of wires) {
    const constraints = buildWireConstraints(wire);
    allConstraints.push(...constraints);
  }

  // Build junction constraints
  for (const junction of junctions) {
    const constraints = buildJunctionConstraints(
      junction,
      findWiresAt,
      wires
    );
    allConstraints.push(...constraints);
  }

  return allConstraints;
}
