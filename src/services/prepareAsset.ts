import { parseISODateUTC, toISODateUTC, firstAnchorAfter } from "@/utils/dateUtc";

export function normalizeAssetConfig(a: {
  ticker?: string; 
  nome?: string; 
  codigo?: string;
  tipoAtivo: string; 
  freq?: string;
  settlementDateISO?: string; 
  earningsStartDate?: string;
  maturityDateISO: string;
}) {
  const freq = (a.freq || "").toUpperCase().trim();
  const tipo = (a.tipoAtivo || "").toUpperCase();
  const anchorDay = tipo === "FUNDO-CETIPADO" || tipo === "FUNDO_CETIPADO" ? 10 : 15;

  const baseStartISO =
    a.earningsStartDate ||
    a.settlementDateISO ||
    new Date().toISOString().slice(0, 10);

  const baseStartUTC = parseISODateUTC(baseStartISO);
  const firstAutoCouponUTC = firstAnchorAfter(baseStartUTC, anchorDay);

  const ticker =
    (a.ticker ?? a.codigo ?? a.nome ?? "").toString().trim().toUpperCase();

  return {
    ...a,
    ticker,
    freq,
    anchorDay,
    autoStartISO: toISODateUTC(firstAutoCouponUTC),
  };
}