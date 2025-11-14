/**
 * Types for the macro projection system
 * Based on Focus BCB projections with monthly curve generation
 */

/**
 * Individual year projection for CDI and IPCA
 */
export interface MacroYearProjection {
  year: number;        // e.g., 2025
  cdiAnnual: number;   // 0.15 = 15% p.a.
  ipcaAnnual: number;  // 0.0455 = 4.55% p.a.
}

/**
 * Complete macro scenario with multiple year projections
 */
export interface MacroScenario {
  source: 'focus' | 'custom';
  description: string;
  years: MacroYearProjection[];
}

/**
 * Monthly curves generated from annual projections
 */
export interface MacroCurves {
  cdiCurve: number[];   // Monthly rates in decimal, e.g., 0.012 = 1.2% p.m.
  ipcaCurve: number[];  // Monthly rates in decimal
}
