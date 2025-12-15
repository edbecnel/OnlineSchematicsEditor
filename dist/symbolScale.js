import { GRID } from './constants.js';
import { mmToPx } from './conversions.js';
// KiCad default spacing between a 2-pin symbol's center and its pin location (0.2 in / 5.08 mm)
export const BUILTIN_PIN_SPACING_MM = 5.08;
// KiCad default visible pin length (0.1 in / 2.54 mm)
export const BUILTIN_PIN_LENGTH_MM = 2.54;
export const BUILTIN_PIN_OFFSET_PX = mmToPx(BUILTIN_PIN_SPACING_MM);
export const BUILTIN_PIN_LENGTH_PX = mmToPx(BUILTIN_PIN_LENGTH_MM);
export const BUILTIN_SYMBOL_SCALE = BUILTIN_PIN_OFFSET_PX / (2 * GRID);
export function scaleForComponent(hasCustomGraphics) {
    return hasCustomGraphics ? 1 : BUILTIN_SYMBOL_SCALE;
}
//# sourceMappingURL=symbolScale.js.map