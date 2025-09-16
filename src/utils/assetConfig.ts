import { parseISODateUTC, firstAnchorAfter, toISODateUTC } from "./dateUtc";

export type AssetType = "debenture-incentivada" | "cri-cra" | "lci-lca" | "cdb" | "fundo-cetipado" | "tesouro-direto";

export interface AssetInput {
  ticker?: string;
  nome?: string;
  tipoAtivo?: AssetType;
  freq?: string;
  settlementDateISO?: string;
  maturityDateISO?: string;
  earningsStartDate?: string;
  vencimento?: string;
  liquidacao?: string;
}

export function normalizeAssetConfig(a: AssetInput): AssetInput & { anchorDay: number } {
  const out = { ...a };
  
  // Normalize freq
  out.freq = (out.freq || "").toUpperCase().trim();
  
  // Determine anchor day by asset type
  const anchorDay = out.tipoAtivo === "fundo-cetipado" ? 10 : 15;
  
  // Auto-configure known assets
  const ticker = (out.ticker || out.nome || "").toUpperCase().trim();
  if (ticker === "BTDI11") {
    out.tipoAtivo = "fundo-cetipado";
    out.freq = "MONTHLY";
  }
  
  // Generate earningsStartDate if missing
  const settlementDate = out.settlementDateISO || out.liquidacao || out.vencimento;
  if (!out.earningsStartDate && settlementDate) {
    const liq = parseISODateUTC(settlementDate);
    out.earningsStartDate = toISODateUTC(firstAnchorAfter(liq, anchorDay));
  }
  
  return { ...out, anchorDay };
}