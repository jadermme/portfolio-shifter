export function getAssetKey(a: any, fallbackIndex?: number): string {
  const key =
    (a?.id && String(a.id).trim()) ||
    (a?.ticker && String(a.ticker).trim().toUpperCase()) ||
    (a?.codigo && String(a.codigo).trim().toUpperCase()) ||
    (a?.nome && String(a.nome).trim().toUpperCase());
  return key && key.length > 0 ? key : `ASSET_${fallbackIndex ?? 0}`;
}