export const parseISODateUTC = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const toISODateUTC = (d: Date): string =>
  d.toISOString().slice(0, 10); // "YYYY-MM-DD"

export const makeUTC = (y: number, mZeroBased: number, d: number) =>
  new Date(Date.UTC(y, mZeroBased, d));

export const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Primeiro <anchorDay> estritamente após `fromUTC` */
export const firstAnchorAfter = (fromUTC: Date, anchorDay: number): Date => {
  const cand = makeUTC(fromUTC.getUTCFullYear(), fromUTC.getUTCMonth(), anchorDay);
  if (cand.getTime() > fromUTC.getTime()) return cand;
  return makeUTC(fromUTC.getUTCFullYear(), fromUTC.getUTCMonth() + 1, anchorDay);
};

/** Soma meses preservando o <anchorDay> (10, 15, etc.) sempre em UTC */
export const monthAddKeepingAnchor = (fromUTC: Date, months: number, anchorDay: number): Date =>
  makeUTC(fromUTC.getUTCFullYear(), fromUTC.getUTCMonth() + months, anchorDay);