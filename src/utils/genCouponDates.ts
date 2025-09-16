import { parseISODateUTC, toISODateUTC, monthAddKeepingAnchor } from "./dateUtc";

type Freq = "MONTHLY" | "BIMONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL";

const FREQ_TO_MONTHS: Record<Freq, number> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

export function genCouponDates(params: {
  freq: Freq;
  earningsStartDate: string; // "YYYY-MM-DD" (já deve estar no dia-âncora)
  maturityDateISO: string;   // "YYYY-MM-DD"
  anchorDay: number;         // 10 ou 15 conforme tipo
  debugTag?: string;         // opcional para logs
}): string[] {
  const { freq, earningsStartDate, maturityDateISO, anchorDay, debugTag } = params;
  
  const monthsStep = FREQ_TO_MONTHS[freq];
  if (!monthsStep) throw new Error(`Frequência inválida: ${freq}`);

  const startUTC = parseISODateUTC(earningsStartDate);
  const maturityUTC = parseISODateUTC(maturityDateISO);

  // Debug opcional
  if (debugTag) {
    console.debug(`[${debugTag}] freq=${freq} start=${earningsStartDate} maturity=${maturityDateISO} anchor=${anchorDay}`);
  }

  // Garante que o primeiro pagamento esteja exatamente no anchorDay
  let current = new Date(Date.UTC(startUTC.getUTCFullYear(), startUTC.getUTCMonth(), anchorDay));
  const dates: string[] = [];

  while (current.getTime() <= maturityUTC.getTime()) {
    dates.push(toISODateUTC(current));
    current = monthAddKeepingAnchor(current, monthsStep, anchorDay);
  }

  return dates;
}