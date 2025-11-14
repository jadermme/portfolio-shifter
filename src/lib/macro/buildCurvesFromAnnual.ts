import { MacroCurves, MacroYearProjection } from './types';

interface BuildCurvesParams {
  /** Year when simulation starts (e.g., 2025) */
  startYear: number;
  /** Total number of months in the simulation (e.g., 36 for 3 years) */
  totalMonths: number;
  /** List of annual projections (2025–2028) */
  years: MacroYearProjection[];
}

/**
 * Generates monthly CDI and IPCA curves from annual rates.
 * 
 * Conversion formula: monthlyRate = (1 + annualRate)^(1/12) - 1
 * 
 * Terminal Regime: For years beyond the last available year (2028),
 * maintains the rates from the last year until the end of the simulation.
 * 
 * @example
 * // 36-month simulation starting in 2025
 * const curves = buildCurvesFromAnnual({
 *   startYear: 2025,
 *   totalMonths: 36,
 *   years: focusBase2025_2028.years
 * });
 * // Result:
 * // curves.cdiCurve[0-11]  = 0.0117 (2025: 15% p.a. → 1.17% p.m.)
 * // curves.cdiCurve[12-23] = 0.0097 (2026: 12.25% p.a. → 0.97% p.m.)
 * // curves.ipcaCurve[0-11] = 0.0037 (2025: 4.55% p.a. → 0.37% p.m.)
 */
export function buildCurvesFromAnnual({
  startYear,
  totalMonths,
  years,
}: BuildCurvesParams): MacroCurves {
  const cdiCurve: number[] = [];
  const ipcaCurve: number[] = [];

  // Validation
  if (years.length === 0 || totalMonths <= 0) {
    console.warn('⚠️ buildCurvesFromAnnual: Invalid parameters');
    return { cdiCurve, ipcaCurve };
  }

  // Terminal regime: last available year will be used for future years
  const lastYearProjection = years[years.length - 1];
  console.log(`📊 Terminal regime activated: rates from ${lastYearProjection.year} will be used for subsequent years`);

  // Generate monthly rates for each month of the simulation
  for (let monthIndex = 0; monthIndex < totalMonths; monthIndex++) {
    // Calculate current year for this month
    const currentYear = startYear + Math.floor(monthIndex / 12);

    // Find year projection or use terminal regime
    const yearProjection = 
      years.find((y) => y.year === currentYear) ?? lastYearProjection;

    const { cdiAnnual, ipcaAnnual } = yearProjection;

    // Convert annual rate to monthly rate with compound capitalization
    // Formula: (1 + annual_rate)^(1/12) - 1
    const cdiMonthly = Math.pow(1 + cdiAnnual, 1 / 12) - 1;
    const ipcaMonthly = Math.pow(1 + ipcaAnnual, 1 / 12) - 1;

    cdiCurve.push(cdiMonthly);
    ipcaCurve.push(ipcaMonthly);
  }

  console.log(`✅ Curves generated: ${totalMonths} months (${Math.ceil(totalMonths/12)} years)`);
  console.log(`   Average monthly CDI: ${(cdiCurve.reduce((a, b) => a + b, 0) / totalMonths * 100).toFixed(2)}%`);
  console.log(`   Average monthly IPCA: ${(ipcaCurve.reduce((a, b) => a + b, 0) / totalMonths * 100).toFixed(2)}%`);

  return { cdiCurve, ipcaCurve };
}
