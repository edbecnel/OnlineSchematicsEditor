// ================================================================================
// COMPONENT MANAGEMENT
// ================================================================================
//
// This module handles component creation, pin calculation, and symbol rendering.
// Component drawing and interaction remain in app.ts due to heavy DOM dependencies.
//
// ================================================================================
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
    if (c.type === 'npn' || c.type === 'pnp') {
        // base at center; collector top; emitter bottom (before rotation)
        const pins = [
            { name: 'B', id: 'B', x: c.x, y: c.y, electricalType: 'input' },
            { name: 'C', id: 'C', x: c.x, y: c.y - 2 * GRID, electricalType: 'passive' },
            { name: 'E', id: 'E', x: c.x, y: c.y + 2 * GRID, electricalType: 'passive' }
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
        return [{ name: 'G', id: 'G', x: c.x, y: c.y - 2, electricalType: 'power_in' }];
    }
    else {
        // Generic 2-pin (resistor, capacitor, inductor, diode, battery, ac)
        const L = 2 * GRID;
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