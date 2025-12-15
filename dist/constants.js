// ================================================================================
// CONSTANTS MODULE
// Application-wide constants and configuration values
// ================================================================================
// ====== Grid and Snapping ======
export const GRID = 25; // px; 2*GRID = 50 px = exactly 10 snap units (500 mils)
// ====== Unit Conversions ======
// Nanometer resolution constants (internal units)
export const NM_PER_MM = 1000000; // 1 mm == 1,000,000 nm
export const NM_PER_IN = 25400000; // 25.4 mm == 1 inch
export const NM_PER_MIL = NM_PER_IN / 1000; // 0.001 in
// Snapping resolution: 50 mils (0.05 in) internal nm value
export const SNAP_MILS = 50;
export const SNAP_NM = Math.round(NM_PER_MIL * SNAP_MILS);
// ====== Viewport ======
export const BASE_W = 1600;
export const BASE_H = 1000;
// Zoom calibration
export const ZOOM_DEFAULT = 2;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 40;
// ====== Connection Hints ======
export const HINT_SNAP_TOLERANCE_PX = 5;
export const HINT_UNLOCK_THRESHOLD_PX = 5;
// ====== Component Value Units ======
export const UNIT_OPTIONS = {
    resistor: ['Ω', 'kΩ', 'MΩ'],
    capacitor: ['pF', 'nF', 'µF', 'mF'],
    inductor: ['nH', 'µH', 'mH', 'H'],
    default: ['']
};
// ====== Wire Color Options ======
export const WIRE_COLOR_OPTIONS = [
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