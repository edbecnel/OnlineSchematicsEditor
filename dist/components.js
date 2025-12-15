// ================================================================================
// COMPONENT MANAGEMENT
// ================================================================================
//
// This module handles component creation, pin calculation, and symbol rendering.
// Component drawing and interaction remain in app.ts due to heavy DOM dependencies.
//
// ================================================================================
import { BUILTIN_SYMBOL_SCALE, BUILTIN_PIN_OFFSET_PX } from './symbolScale.js';
// Grid constant (from app.ts, should eventually be imported from constants or config)
const GRID = 25;
// ====== Component Pin Calculations ======
/**
 * Rotate a point around an origin by a given angle
 */
function rotatePoint(p, origin, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    return {
        x: origin.x + dx * cos - dy * sin,
        y: origin.y + dx * sin + dy * cos
    };
}
/**
 * Calculate absolute pin positions for a component
 * Returns array of {x, y, name, id, electricalType}
 */
export function compPinPositions(c) {
    // NEW: If component has explicit pin definitions, use those
    if (c.pins && c.pins.length > 0) {
        const r = ((c.rot % 360) + 360) % 360;
        return c.pins.map(pin => {
            // Transform pin position from component-relative to absolute coordinates
            const rotated = rotatePoint({ x: c.x + pin.x, y: c.y + pin.y }, { x: c.x, y: c.y }, r);
            return {
                x: rotated.x,
                y: rotated.y,
                name: pin.name || pin.id,
                id: pin.id,
                electricalType: pin.electricalType
            };
        });
    }
    // LEGACY: Calculate pin positions from component type (backward compatible)
    const r = ((c.rot % 360) + 360) % 360;
    const scale = c.graphics && c.graphics.length > 0 ? 1 : BUILTIN_SYMBOL_SCALE;
    const pinOffset = 2 * GRID * scale;
    if (c.type === 'npn' || c.type === 'pnp') {
        // Snap all connection points to 50 mil grid
        // base at left (x-50); collector/emitter on right at nearest 50 mil (round 16 to 0 or 50)
        const pins = [
            { name: 'B', id: 'B', x: c.x - pinOffset, y: c.y, electricalType: 'input' },
            { name: 'C', id: 'C', x: c.x, y: c.y - pinOffset, electricalType: 'passive' },
            { name: 'E', id: 'E', x: c.x, y: c.y + pinOffset, electricalType: 'passive' }
        ];
        return pins.map(p => ({
            ...rotatePoint(p, { x: c.x, y: c.y }, r),
            name: p.name,
            id: p.id,
            electricalType: p.electricalType
        }));
    }
    else if (c.type === 'ground') {
        // single pin at top of ground symbol
        return [{ name: 'G', id: 'G', x: c.x, y: c.y, electricalType: 'power_in' }];
    }
    else {
        // Generic 2-pin (resistor, capacitor, inductor, diode, battery, ac)
        const L = pinOffset;
        const rad = (r * Math.PI) / 180;
        const ux = Math.cos(rad), uy = Math.sin(rad);
        const a = {
            x: c.x - L * ux,
            y: c.y - L * uy,
            name: '1',
            id: '1',
            electricalType: 'passive'
        };
        const b = {
            x: c.x + L * ux,
            y: c.y + L * uy,
            name: '2',
            id: '2',
            electricalType: 'passive'
        };
        return [a, b];
    }
}
// ====== Component Value Formatting ======
/**
 * Format component value for display (handles units, etc.)
 */
export function formatValue(c) {
    if (!c.value)
        return '';
    const v = String(c.value).trim();
    if (!v)
        return '';
    // If component has a unit prop, append it
    if (c.props && c.props.unit) {
        // Check if value already has unit
        const hasUnit = /[a-zA-ZΩ]$/.test(v);
        return hasUnit ? v : `${v}${c.props.unit}`;
    }
    return v;
}
// ====== Component Type Utilities ======
/**
 * Check if component type is a two-pin component
 */
export function isTwoPinType(type) {
    return ['resistor', 'capacitor', 'inductor', 'diode', 'battery', 'ac'].includes(type);
}
/**
 * Check if component at position overlaps with other components
 * (This is a placeholder - actual implementation in app.ts uses component array)
 */
export function wouldOverlap(c, x, y, otherComponents) {
    const threshold = 30; // minimum distance between component centers
    for (const other of otherComponents) {
        if (other.id === c.id)
            continue;
        const dx = other.x - x;
        const dy = other.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < threshold)
            return true;
    }
    return false;
}
function includePointAccumulator(c, rotRad, cosR, sinR, accumulator, x, y) {
    const rx = x * cosR - y * sinR;
    const ry = x * sinR + y * cosR;
    const worldX = c.x + rx;
    const worldY = c.y + ry;
    accumulator.minX = Math.min(accumulator.minX, worldX);
    accumulator.maxX = Math.max(accumulator.maxX, worldX);
    accumulator.minY = Math.min(accumulator.minY, worldY);
    accumulator.maxY = Math.max(accumulator.maxY, worldY);
}
function includeRectPoints(c, rotRad, cosR, sinR, accumulator, x0, y0, x1, y1) {
    includePointAccumulator(c, rotRad, cosR, sinR, accumulator, x0, y0);
    includePointAccumulator(c, rotRad, cosR, sinR, accumulator, x0, y1);
    includePointAccumulator(c, rotRad, cosR, sinR, accumulator, x1, y0);
    includePointAccumulator(c, rotRad, cosR, sinR, accumulator, x1, y1);
}
export function getComponentBounds(c) {
    const rot = ((c.rot % 360) + 360) % 360;
    const rotRad = (rot * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);
    const acc = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    const includePoint = (x, y) => {
        includePointAccumulator(c, rotRad, cosR, sinR, acc, x, y);
    };
    const includeRect = (x, y, width, height) => {
        includeRectPoints(c, rotRad, cosR, sinR, acc, x, y, x + width, y + height);
    };
    let captured = false;
    if (Array.isArray(c.graphics) && c.graphics.length > 0) {
        for (const gfx of c.graphics) {
            switch (gfx.type) {
                case 'line':
                    includePoint(gfx.x1, gfx.y1);
                    includePoint(gfx.x2, gfx.y2);
                    captured = true;
                    break;
                case 'polyline':
                case 'polygon':
                    for (const pt of gfx.points) {
                        includePoint(pt.x, pt.y);
                    }
                    if (gfx.points.length > 0)
                        captured = true;
                    break;
                case 'rectangle':
                    includeRect(gfx.x, gfx.y, gfx.width, gfx.height);
                    captured = true;
                    break;
                case 'circle':
                    includePoint(gfx.cx + gfx.r, gfx.cy);
                    includePoint(gfx.cx - gfx.r, gfx.cy);
                    includePoint(gfx.cx, gfx.cy + gfx.r);
                    includePoint(gfx.cx, gfx.cy - gfx.r);
                    captured = true;
                    break;
                case 'path': {
                    const tokens = gfx.d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi);
                    if (tokens && tokens.length >= 2) {
                        for (let i = 0; i < tokens.length - 1; i += 2) {
                            const x = Number.parseFloat(tokens[i]);
                            const y = Number.parseFloat(tokens[i + 1]);
                            if (Number.isFinite(x) && Number.isFinite(y)) {
                                includePoint(x, y);
                                captured = true;
                            }
                        }
                    }
                    break;
                }
                case 'text':
                    includePoint(gfx.x, gfx.y);
                    captured = true;
                    break;
                default:
                    break;
            }
        }
    }
    if (Array.isArray(c.pins) && c.pins.length > 0) {
        for (const pin of c.pins) {
            includePoint(pin.x, pin.y);
            const length = pin.length ?? GRID * 2;
            const rad = (pin.rotation * Math.PI) / 180;
            const dx = Math.cos(rad);
            const dy = -Math.sin(rad);
            includePoint(pin.x + dx * length, pin.y + dy * length);
            captured = true;
        }
    }
    if (!captured) {
        const scale = BUILTIN_SYMBOL_SCALE;
        const halfPinExtent = BUILTIN_PIN_OFFSET_PX;
        let bodyHalfLength = 30;
        let bodyHalfWidth = 12;
        switch (c.type) {
            case 'resistor': {
                const style = c.props?.resistorStyle;
                bodyHalfLength = style === 'ansi' ? 39 : 30;
                bodyHalfWidth = 12;
                break;
            }
            case 'capacitor':
                bodyHalfLength = 26;
                bodyHalfWidth = 16;
                break;
            case 'inductor':
                bodyHalfLength = 32;
                bodyHalfWidth = 16;
                break;
            case 'diode':
                bodyHalfLength = 24;
                bodyHalfWidth = 16;
                break;
            case 'battery':
                bodyHalfLength = 22;
                bodyHalfWidth = 20;
                break;
            case 'ac':
                bodyHalfLength = 20;
                bodyHalfWidth = 20;
                break;
            case 'npn':
            case 'pnp':
                bodyHalfLength = 28;
                bodyHalfWidth = 32;
                break;
            case 'ground':
                bodyHalfLength = 20;
                bodyHalfWidth = 12;
                break;
            default:
                bodyHalfLength = 30;
                bodyHalfWidth = 12;
                break;
        }
        const scaledHalfLength = Math.max(bodyHalfLength * scale, halfPinExtent);
        const scaledHalfWidth = bodyHalfWidth * scale;
        includeRect(-scaledHalfLength, -scaledHalfWidth, scaledHalfLength * 2, scaledHalfWidth * 2);
    }
    if (acc.minX === Infinity) {
        includePoint(0, 0);
    }
    return acc;
}
// ====== Component Creation Helpers ======
/**
 * Get default label for component type
 */
export function getDefaultLabel(type, counter) {
    const prefixes = {
        resistor: 'R',
        capacitor: 'C',
        inductor: 'L',
        diode: 'D',
        npn: 'Q',
        pnp: 'Q',
        ground: 'GND',
        battery: 'BAT',
        ac: 'AC'
    };
    const prefix = prefixes[type] || '?';
    return type === 'ground' ? 'GND' : `${prefix}${counter}`;
}
/**
 * Get default value for component type
 */
export function getDefaultValue(type) {
    const defaults = {
        resistor: '10k',
        capacitor: '100n',
        inductor: '1u',
        diode: '',
        npn: '',
        pnp: '',
        ground: '',
        battery: '9',
        ac: '120'
    };
    return defaults[type] || '';
}
/**
 * Get default unit for component type
 */
export function getDefaultUnit(type) {
    const units = {
        resistor: 'Ω',
        capacitor: 'F',
        inductor: 'H',
        battery: 'V',
        ac: 'V'
    };
    return units[type] || '';
}
// ====== Diode Subtype Information ======
/**
 * Get display name for diode subtype
 */
export function getDiodeSubtypeName(subtype) {
    const names = {
        generic: 'Generic Diode',
        schottky: 'Schottky Diode',
        zener: 'Zener Diode',
        led: 'LED',
        photo: 'Photodiode',
        tunnel: 'Tunnel Diode',
        varactor: 'Varactor Diode',
        laser: 'Laser Diode',
        tvs_uni: 'TVS (Unidirectional)',
        tvs_bi: 'TVS (Bidirectional)'
    };
    return names[subtype] || 'Diode';
}
/**
 * Get all available diode subtypes
 */
export function getDiodeSubtypes() {
    return [
        'generic',
        'schottky',
        'zener',
        'led',
        'photo',
        'tunnel',
        'varactor',
        'laser',
        'tvs_uni',
        'tvs_bi'
    ];
}
//# sourceMappingURL=components.js.map