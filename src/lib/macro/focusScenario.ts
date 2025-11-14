import { MacroScenario } from './types';

/**
 * Base scenario: Focus BCB projections (median)
 * Reference: Focus Report from October 31, 2025
 * 
 * For years beyond 2028, the rates from 2028 are maintained constant (terminal regime)
 */
export const focusBase2025_2028: MacroScenario = {
  source: 'focus',
  description: 
    'Projeções de CDI e IPCA baseadas na mediana do Relatório Focus (BCB) de 31/10/2025. ' +
    'Para anos após 2028, as taxas de 2028 são mantidas constantes (regime terminal).',
  years: [
    { year: 2025, cdiAnnual: 0.15,   ipcaAnnual: 0.0455 }, // CDI 15%, IPCA 4.55%
    { year: 2026, cdiAnnual: 0.1225, ipcaAnnual: 0.0420 }, // CDI 12.25%, IPCA 4.20%
    { year: 2027, cdiAnnual: 0.1050, ipcaAnnual: 0.0380 }, // CDI 10.50%, IPCA 3.80%
    { year: 2028, cdiAnnual: 0.10,   ipcaAnnual: 0.0350 }, // CDI 10%, IPCA 3.50%
  ],
};
