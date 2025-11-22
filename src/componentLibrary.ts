/**
 * Component Library Support
 * 
 * Provides utilities for defining custom components with arbitrary pin counts
 * and rendering custom graphics. This serves as the foundation for importing
 * KiCad symbol libraries.
 */

import type { Component, Pin, GraphicElement, PinElectricalType } from './types.js';
import { GRID } from './constants.js';

// ====== Pin Builder Helpers ======

/**
 * Create a pin definition
 */
export function createPin(
  id: string,
  x: number,
  y: number,
  options?: {
    rotation?: number;
    electricalType?: PinElectricalType;
    name?: string;
    visible?: boolean;
  }
): Pin {
  return {
    id,
    x,
    y,
    rotation: options?.rotation ?? 0,
    electricalType: options?.electricalType ?? 'passive',
    name: options?.name,
    visible: options?.visible ?? true
  };
}

// ====== Built-in Component Templates ======

/**
 * Create a basic IC component with DIP-style pins
 * @param pinCount Total number of pins (must be even)
 * @param pinSpacing Spacing between pins in user units (default: 2*GRID = 20)
 */
export function createDIPComponent(pinCount: number, pinSpacing = 2 * GRID): {
  pins: Pin[];
  graphics: GraphicElement[];
  width: number;
  height: number;
} {
  if (pinCount % 2 !== 0) {
    throw new Error('DIP component must have even number of pins');
  }
  
  const pinsPerSide = pinCount / 2;
  const bodyHeight = (pinsPerSide - 1) * pinSpacing + 3 * GRID;
  const bodyWidth = 6 * GRID;
  const pinLength = 2 * GRID;
  
  const pins: Pin[] = [];
  const graphics: GraphicElement[] = [];
  
  // Left side pins (top to bottom)
  for (let i = 0; i < pinsPerSide; i++) {
    const y = (-bodyHeight / 2) + (i * pinSpacing) + (1.5 * GRID);
    pins.push(createPin(
      String(i + 1),
      -bodyWidth / 2 - pinLength,
      y,
      { electricalType: 'passive', name: String(i + 1) }
    ));
  }
  
  // Right side pins (bottom to top)
  for (let i = 0; i < pinsPerSide; i++) {
    const y = (bodyHeight / 2) - (i * pinSpacing) - (1.5 * GRID);
    pins.push(createPin(
      String(pinsPerSide + i + 1),
      bodyWidth / 2 + pinLength,
      y,
      { electricalType: 'passive', name: String(pinsPerSide + i + 1) }
    ));
  }
  
  // Body rectangle
  graphics.push({
    type: 'rectangle',
    x: -bodyWidth / 2,
    y: -bodyHeight / 2,
    width: bodyWidth,
    height: bodyHeight,
    fill: 'none',
    stroke: 'var(--component)',
    strokeWidth: 2
  });
  
  // Pin indicator (notch at top)
  const notchSize = GRID;
  graphics.push({
    type: 'arc',
    cx: 0,
    cy: -bodyHeight / 2,
    r: notchSize,
    startAngle: 0,
    endAngle: 180,
    stroke: 'var(--component)',
    strokeWidth: 2
  });
  
  // Pin lines (leads)
  pins.forEach(pin => {
    if (pin.x < 0) {
      // Left side
      graphics.push({
        type: 'line',
        x1: pin.x,
        y1: pin.y,
        x2: -bodyWidth / 2,
        y2: pin.y,
        stroke: 'var(--component)',
        strokeWidth: 2
      });
    } else {
      // Right side
      graphics.push({
        type: 'line',
        x1: bodyWidth / 2,
        y1: pin.y,
        x2: pin.x,
        y2: pin.y,
        stroke: 'var(--component)',
        strokeWidth: 2
      });
    }
  });
  
  return { pins, graphics, width: bodyWidth + 2 * pinLength, height: bodyHeight };
}

/**
 * Create a quad op-amp component (4 op-amps in one package)
 */
export function createQuadOpAmp(): {
  pins: Pin[];
  graphics: GraphicElement[];
  width: number;
  height: number;
} {
  const bodyWidth = 8 * GRID;
  const bodyHeight = 10 * GRID;
  const pinLength = 2 * GRID;
  const pinSpacing = 2 * GRID;
  
  const pins: Pin[] = [
    // Left side (inputs)
    createPin('1', -bodyWidth/2 - pinLength, -3*pinSpacing, { electricalType: 'output', name: 'OUT1' }),
    createPin('2', -bodyWidth/2 - pinLength, -2*pinSpacing, { electricalType: 'input', name: 'IN1-' }),
    createPin('3', -bodyWidth/2 - pinLength, -1*pinSpacing, { electricalType: 'input', name: 'IN1+' }),
    createPin('4', -bodyWidth/2 - pinLength, 0, { electricalType: 'power_in', name: 'V-' }),
    createPin('5', -bodyWidth/2 - pinLength, 1*pinSpacing, { electricalType: 'input', name: 'IN2+' }),
    createPin('6', -bodyWidth/2 - pinLength, 2*pinSpacing, { electricalType: 'input', name: 'IN2-' }),
    createPin('7', -bodyWidth/2 - pinLength, 3*pinSpacing, { electricalType: 'output', name: 'OUT2' }),
    
    // Right side (outputs)
    createPin('8', bodyWidth/2 + pinLength, 3*pinSpacing, { electricalType: 'power_in', name: 'V+' }),
    createPin('9', bodyWidth/2 + pinLength, 2*pinSpacing, { electricalType: 'output', name: 'OUT3' }),
    createPin('10', bodyWidth/2 + pinLength, 1*pinSpacing, { electricalType: 'input', name: 'IN3-' }),
    createPin('11', bodyWidth/2 + pinLength, 0, { electricalType: 'input', name: 'IN3+' }),
    createPin('12', bodyWidth/2 + pinLength, -1*pinSpacing, { electricalType: 'input', name: 'IN4+' }),
    createPin('13', bodyWidth/2 + pinLength, -2*pinSpacing, { electricalType: 'input', name: 'IN4-' }),
    createPin('14', bodyWidth/2 + pinLength, -3*pinSpacing, { electricalType: 'output', name: 'OUT4' }),
  ];
  
  const graphics: GraphicElement[] = [
    // Body rectangle
    {
      type: 'rectangle',
      x: -bodyWidth / 2,
      y: -bodyHeight / 2,
      width: bodyWidth,
      height: bodyHeight,
      fill: 'none',
      stroke: 'var(--component)',
      strokeWidth: 2
    },
    // Pin lines
    ...pins.map(pin => ({
      type: 'line' as const,
      x1: pin.x,
      y1: pin.y,
      x2: pin.x < 0 ? -bodyWidth/2 : bodyWidth/2,
      y2: pin.y,
      stroke: 'var(--component)',
      strokeWidth: 2
    }))
  ];
  
  return { pins, graphics, width: bodyWidth + 2 * pinLength, height: bodyHeight };
}

// ====== Example: Create a custom component instance ======

/**
 * Helper to create a component with custom pins and graphics
 */
export function createCustomComponent(
  id: string,
  type: string,
  x: number,
  y: number,
  template: { pins: Pin[]; graphics: GraphicElement[] },
  options?: {
    label?: string;
    value?: string;
    rotation?: number;
    libraryId?: string;
    symbolName?: string;
  }
): Component {
  return {
    id,
    type: 'resistor', // Use existing type for now, will be ignored when pins/graphics defined
    x,
    y,
    rot: options?.rotation ?? 0,
    label: options?.label ?? id,
    value: options?.value,
    pins: template.pins,
    graphics: template.graphics,
    libraryId: options?.libraryId,
    symbolName: options?.symbolName,
    props: {}
  };
}
