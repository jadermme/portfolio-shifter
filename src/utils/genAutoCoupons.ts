import { parseISODateUTC, toISODateUTC, monthAddKeepingAnchor } from "@/utils/dateUtc";

type Freq = "MONTHLY" | "BIMONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL";

const STEP: Record<Freq, number> = { 
  MONTHLY: 1, 
  BIMONTHLY: 2, 
  QUARTERLY: 3, 
  SEMIANNUAL: 6, 
  ANNUAL: 12 
};

export function genAutoCoupons(p: {
  freq: Freq; 
  firstISO: string; 
  endISO: string; 
  anchorDay: number; 
  windowStartISO?: string;
}): string[] {
  const step = STEP[p.freq];
  if (!step) throw new Error(`Frequência inválida: ${p.freq}`);

  const end = parseISODateUTC(p.endISO);
  const winStart = p.windowStartISO ? parseISODateUTC(p.windowStartISO) : null;
  let d = parseISODateUTC(p.firstISO);

  const out: string[] = [];
  while (d.getTime() <= end.getTime()) {
    if (!winStart || d.getTime() >= winStart.getTime()) {
      out.push(toISODateUTC(d));
    }
    d = monthAddKeepingAnchor(d, step, p.anchorDay);
  }
  return out;
}