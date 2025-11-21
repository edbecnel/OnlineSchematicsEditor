"use strict";
// ================================================================================
// CONSTANTS MODULE
// Application-wide constants and configuration values
// ================================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.WIRE_COLOR_OPTIONS = exports.UNIT_OPTIONS = exports.HINT_UNLOCK_THRESHOLD_PX = exports.HINT_SNAP_TOLERANCE_PX = exports.BASE_H = exports.BASE_W = exports.SNAP_NM = exports.SNAP_MILS = exports.NM_PER_MIL = exports.NM_PER_IN = exports.NM_PER_MM = exports.GRID = void 0;
// ====== Grid and Snapping ======
exports.GRID = 25; // px; 2*GRID = 50 px = exactly 10 snap units (500 mils)
// ====== Unit Conversions ======
// Nanometer resolution constants (internal units)
exports.NM_PER_MM = 1000000; // 1 mm == 1,000,000 nm
exports.NM_PER_IN = 25400000; // 25.4 mm == 1 inch
exports.NM_PER_MIL = exports.NM_PER_IN / 1000; // 0.001 in
// Snapping resolution: 50 mils (0.05 in) internal nm value
exports.SNAP_MILS = 50;
exports.SNAP_NM = Math.round(exports.NM_PER_MIL * exports.SNAP_MILS);
// ====== Viewport ======
exports.BASE_W = 1600;
exports.BASE_H = 1000;
// ====== Connection Hints ======
exports.HINT_SNAP_TOLERANCE_PX = 5;
exports.HINT_UNLOCK_THRESHOLD_PX = 5;
// ====== Component Value Units ======
exports.UNIT_OPTIONS = {
    resistor: ['Ω', 'kΩ', 'MΩ'],
    capacitor: ['pF', 'nF', 'µF', 'mF'],
    inductor: ['nH', 'µH', 'mH', 'H'],
    default: ['']
};
// ====== Wire Color Options ======
exports.WIRE_COLOR_OPTIONS = [
    ['auto', 'Auto (Black/White)'],
    ['black', 'Black/White'],
    ['red', 'Red'],
    ['green', 'Green'],
    ['blue', 'Blue'],
    ['yellow', 'Yellow'],
    ['magenta', 'Magenta'],
    ['cyan', 'Cyan']
];
//# sourceMappingURL=constants.js.map