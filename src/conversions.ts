// ================================================================================
// UNIT CONVERSION & DIMENSION PARSING
// ================================================================================
//
// This module provides utilities for converting between different unit systems
// (px, nm, mm, in, mils) and parsing/formatting dimensional input.
//
// ================================================================================

import { NM_PER_MM, NM_PER_IN, NM_PER_MIL } from './constants.js';

// px rendering constant: exactly 100 px per inch (50 mils = 5 px)
export const PX_PER_MM = 100 / 25.4;

// ====== px ↔ nm Conversions ======

/**
 * Convert pixels to nanometers
 */
export function pxToNm(px: number): number {
  return Math.round(px * (NM_PER_MM / PX_PER_MM));
}

/**
 * Convert nanometers to pixels
 */
export function nmToPx(nm: number): number {
  return (nm * PX_PER_MM) / NM_PER_MM;
}

/**
 * Convert millimeters to pixels (minimum 1px)
 */
export function mmToPx(mm: number): number {
  return Math.max(1, Math.round(Math.max(0, mm) * PX_PER_MM));
}

// ====== nm ↔ Display Units ======

/**
 * Convert nanometers to requested display unit (mm, in, or mils)
 */
export function nmToUnit(nm: number, u: 'mm' | 'in' | 'mils'): number {
  if (u === 'mm') return nm / NM_PER_MM;
  if (u === 'in') return nm / NM_PER_IN;
  return nm / NM_PER_MIL; // mils
}

/**
 * Convert value in display unit to nanometers
 */
export function unitToNm(val: number, u: 'mm' | 'in' | 'mils'): number {
  if (u === 'mm') return Math.round(val * NM_PER_MM);
  if (u === 'in') return Math.round(val * NM_PER_IN);
  return Math.round(val * NM_PER_MIL);
}

// ====== Dimension Parsing & Formatting ======

/**
 * Parse a user-typed dimension like "1 mm", "0.0254 in", "39.37 mils" (case-insensitive)
 * Returns { nm, unit } or null if parse failed.
 */
export function parseDimInput(
  str: string,
  assumeUnit: 'mm' | 'in' | 'mils' = 'mm'
): { nm: number; unit: 'mm' | 'in' | 'mils' } | null {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/^([0-9.+\-eE]+)\s*([a-zA-Z]*)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const suf = (m[2] || '').toLowerCase();
  if (!suf) return { nm: unitToNm(n, assumeUnit), unit: assumeUnit };
  if (suf === 'mm') return { nm: unitToNm(n, 'mm'), unit: 'mm' };
  if (suf === 'in' || suf === 'inch' || suf === 'inches')
    return { nm: unitToNm(n, 'in'), unit: 'in' };
  if (suf === 'mil' || suf === 'mils')
    return { nm: unitToNm(n, 'mils'), unit: 'mils' };
  // Unknown suffix: treat as assumeUnit
  return { nm: unitToNm(n, assumeUnit), unit: assumeUnit };
}

/**
 * Format a nanometer value for display in the specified unit system.
 * Returns string like "12.34 mm" or "39.37 mils".
 */
export function formatDimForDisplay(nm: number, u: 'mm' | 'in' | 'mils'): string {
  const v = nmToUnit(nm, u);
  if (u === 'mm') return `${(Math.round(v * 100) / 100).toFixed(2)} mm`;
  if (u === 'in') return `${(Math.round(v * 10000) / 10000).toFixed(4)} in`;
  // mils
  return `${(Math.round(v * 100) / 100).toFixed(2)} mils`;
}
