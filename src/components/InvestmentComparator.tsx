import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Calculator, Trash2, Printer, TrendingUp, BarChart3, ArrowRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ===================== NEW CASH FLOW SYSTEM TYPES =====================
type RateKind = "PRE" | "IPCA+PRE" | "%CDI" | "CDI+PRE";
type Freq = "MONTHLY" | "SEMIANNUAL";

interface CDIPoint { 
  date: string; 
  cdiAA: number; // a.a. em %
}

interface IPCAPoint { 
  date: string; 
  ipcaAA: number; // opcional, se IPCA+PRE
}

interface CouponResult {
  couponDate: string;
  gross: number;
  net: number;
  reinvestFactor: number;
  reinvested: number;
}

interface CouponEngineInput {
  principal: number;
  startISO: string;
  endISO: string;
  freq: Freq;
  rateKind: RateKind;
  // parâmetros da taxa:
  taxaPreAA?: number; 
  taxaRealAA?: number; 
  spreadPreAA?: number;
  percCDI?: number; 
  cdiAABase?: number;
  // curvas:
  cdiCurve: CDIPoint[];
  ipcaCurve?: IPCAPoint[];
  // custos/IR
  feesAA?: number;
  irRegressivo?: boolean;
  use252?: boolean;
  // NEW: earnings start date
  earningsStartDate?: string;
}

// ===================== EXPANDED EXISTING INTERFACES =====================
interface AssetData {
  nome: string;
  codigo: string;
  tipoTaxa: 'pre-fixada' | 'percentual-cdi' | 'cdi-mais' | 'ipca-mais';
  taxa: number;
  vencimento: string;
  valorInvestido: number;
  cupons: number;
  valorCurva: number;
  valorVenda?: number;
  tipoCupom: string;
  mesesCupons: string;
  tipoIR: 'isento' | 'renda-fixa' | 'fixo-15';
  aliquotaIR: number;
  // NEW FIELDS FOR CASH FLOW SYSTEM
  rateKind?: RateKind;
  freq?: Freq;
  feesAA?: number;
  use252?: boolean;
  // NEW FIELDS FOR EARNINGS PERIODS
  earningsStartDate?: string; // ISO date when earnings begin (e.g., "2025-11-01" for BTDI11)
  activePeriods?: { year: number, months: number[] }[]; // Specific months when asset generates earnings
}

interface Projecoes {
  cdi: { [key: number]: number };
  ipca: { [key: number]: number };
  // NEW FIELDS FOR DETAILED CURVES
  cdiCurve?: CDIPoint[];
  ipcaCurve?: IPCAPoint[];
}

interface CalculationResult {
  ativo1: number[];
  ativo2: number[];
  impostoAtivo1: number;
  impostoAtivo2: number;
  anosProjecao: number;
  reinvestimento?: {
    ativoReinvestido: 'ativo1' | 'ativo2';
    valorResgatado: number;
    periodosReinvestimento: number;
    taxaReinvestimento: number;
    valorFinalReinvestimento: number;
  };
  // NEW FIELDS FOR CASH FLOW DETAILS
  couponDetails?: {
    ativo1?: CouponResult[];
    ativo2?: CouponResult[];
  };
}

// ===================== CASH FLOW CALCULATION FUNCTIONS =====================
const irAliquotaRegressivo = (dias: number) =>
  dias <= 180 ? 0.225 : dias <= 360 ? 0.20 : dias <= 720 ? 0.175 : 0.15;

const aaToMonthly = (aaPct: number) => Math.pow(1 + aaPct/100, 1/12) - 1;
const aaToDaily252 = (aaPct: number) => Math.pow(1 + aaPct/100, 1/252) - 1;

function monthlyRateFromCDI(cdiAA: number, use252: boolean, duPerMonth=21) {
  if (use252) return Math.pow(1 + aaToDaily252(cdiAA), duPerMonth) - 1;
  return aaToMonthly(cdiAA);
}

function rateOfAssetForPeriod(kind: RateKind, p: {
  taxaPreAA?: number; taxaRealAA?: number; ipcaAA?: number;
  percCDI?: number; cdiAA?: number; spreadPreAA?: number;
  use252?: boolean;
}, monthlyIndex?: number): number {
  const { taxaPreAA=0, taxaRealAA=0, ipcaAA=0, percCDI=0, cdiAA=0, spreadPreAA=0, use252=false } = p;
  switch (kind) {
    case "PRE":      return aaToMonthly(taxaPreAA);
    case "IPCA+PRE": return ((1+aaToMonthly(taxaRealAA))*(1+aaToMonthly(ipcaAA)) - 1);
    case "%CDI":     return monthlyRateFromCDI(cdiAA, use252) * (percCDI/100);
    case "CDI+PRE":  return monthlyRateFromCDI(cdiAA, use252) + aaToMonthly(spreadPreAA);
  }
}

function addMonths(dateISO: string, n: number) {
  const d = new Date(dateISO);
  d.setMonth(d.getMonth()+n);
  return d.toISOString().slice(0,10);
}

function daysBetween(aISO: string, bISO: string) {
  const a = new Date(aISO).getTime(), b = new Date(bISO).getTime();
  return Math.max(0, Math.floor((b-a)/(1000*60*60*24)));
}

function genCouponDates(startISO: string, endISO: string, freq: Freq, earningsStartDate?: string): string[] {
  const step = freq === "MONTHLY" ? 1 : 6;
  const out: string[] = [];
  
  // Use earnings start date if provided, otherwise use start date
  if (earningsStartDate) {
    console.log(`📅 Usando data de início dos rendimentos: ${earningsStartDate}`);
    // First coupon on the earnings start date itself
    let d = earningsStartDate;
    
    while (new Date(d) <= new Date(endISO)) {
      console.log(`📅 Data de cupom gerada: ${d}`);
      out.push(d);
      d = addMonths(d, step);
    }
  } else {
    // Standard logic - first coupon after one period
    let d = addMonths(startISO, step);
    
    while (new Date(d) <= new Date(endISO)) {
      console.log(`📅 Data de cupom gerada: ${d}`);
      out.push(d);
      d = addMonths(d, step);
    }
  }
  
  console.log(`✅ Datas de cupom finais:`, out);
  return out;
}

// Fator CDI acumulado entre duas datas, usando curva mensal
function cdiFactor(curve: CDIPoint[], fromISO: string, toISO: string, use252=false): number {
  if (new Date(fromISO) >= new Date(toISO)) return 1;
  let factor = 1;
  let cursor = new Date(fromISO);
  cursor.setDate(1); // normaliza para início do mês
  const to = new Date(toISO);
  to.setDate(1);
  while (cursor <= to) {
    // acha o ponto CDI do mês de 'cursor'
    const key = cursor.toISOString().slice(0,7); // YYYY-MM
    const pt = curve.find(p => p.date.slice(0,7) === key) ?? curve[curve.length-1];
    const rm = monthlyRateFromCDI(pt.cdiAA, use252);
    factor *= (1 + rm);
    cursor.setMonth(cursor.getMonth()+1);
  }
  return factor;
}

// Get CDI rate for a specific month from curve
function getCDIRateForMonth(curve: CDIPoint[], dateISO: string): number {
  const key = dateISO.slice(0,7); // YYYY-MM
  const pt = curve.find(p => p.date.slice(0,7) === key);
  return pt ? pt.cdiAA : curve[curve.length-1]?.cdiAA || 10;
}

function projectWithReinvestCDI(x: CouponEngineInput) {
  // No administrative fees for direct securities
  const couponDates = genCouponDates(x.startISO, x.endISO, x.freq);

  const coupons: CouponResult[] = [];
  let basePrincipal = x.principal;

  // percorre cada período
  let last = x.startISO;
  for (const dt of couponDates) {
    const months = x.freq === "MONTHLY" ? 1 : 6;
    
    // Get CDI rate specific for this coupon period
    const couponMonth = dt.slice(0,7); // YYYY-MM
    const cdiAA = getCDIRateForMonth(x.cdiCurve, dt);
    
    const rAssetMonthly = rateOfAssetForPeriod(x.rateKind, {
      taxaPreAA: x.taxaPreAA, taxaRealAA: x.taxaRealAA, 
      ipcaAA: x.ipcaCurve?.[0]?.ipcaAA ?? 0,
      percCDI: x.percCDI, cdiAA, spreadPreAA: x.spreadPreAA, use252: false
    });
    
    const rPeriodGross = Math.pow(1 + rAssetMonthly, months) - 1;

    const couponGross = Math.max(0, basePrincipal * rPeriodGross);

    // IR regressivo sobre o cupom pelo tempo desde a aplicação
    const dias = daysBetween(x.startISO, dt);
    const aliq = x.irRegressivo !== false ? irAliquotaRegressivo(dias) : 0;
    const couponNet = couponGross * (1 - aliq);

    // fator de reinvestimento CDI do pagamento até o fim
    const fReinv = cdiFactor(x.cdiCurve, dt, x.endISO, false);
    const couponReinv = couponNet * fReinv;

    coupons.push({ 
      couponDate: dt, 
      gross: couponGross, 
      net: couponNet, 
      reinvestFactor: fReinv, 
      reinvested: couponReinv 
    });

    last = dt;
  }

  // principal no fim (resgate a par)
  const principalGrossFinal = basePrincipal;
  const diasTotal = daysBetween(x.startISO, x.endISO);
  const aliqFinal = x.irRegressivo !== false ? irAliquotaRegressivo(diasTotal) : 0;
  const gainPrincipal = Math.max(0, principalGrossFinal - x.principal);
  const irPrincipal = gainPrincipal * aliqFinal;
  const principalNetFinal = principalGrossFinal - irPrincipal;

  const totalVF = principalNetFinal + coupons.reduce((s,c)=>s + c.reinvested, 0);
  return { coupons, principalNetFinal, totalVF };
}

// ===================== LEGACY COMPATIBILITY MAPPING =====================
function mapLegacyToNewFormat(asset: AssetData): RateKind {
  switch (asset.tipoTaxa) {
    case 'pre-fixada': return 'PRE';
    case 'percentual-cdi': return '%CDI';
    case 'cdi-mais': return 'CDI+PRE';
    case 'ipca-mais': return 'IPCA+PRE';
    default: return 'PRE';
  }
}

function mapCoupomFreq(tipoCupom: string): Freq {
  if (tipoCupom?.toLowerCase().includes('mensal')) return 'MONTHLY';
  return 'SEMIANNUAL'; // Default to semiannual
}

// Generate monthly CDI curve from annual projections
function generateCDICurve(projecoes: Projecoes): CDIPoint[] {
  const curve: CDIPoint[] = [];
  const currentYear = new Date().getFullYear();
  
  for (let year = currentYear; year <= currentYear + 10; year++) {
    const cdiAA = projecoes.cdi[year] || projecoes.cdi[Object.keys(projecoes.cdi).pop() as any] || 10;
    for (let month = 1; month <= 12; month++) {
      const date = `${year}-${month.toString().padStart(2, '0')}-01`;
      curve.push({ date, cdiAA });
    }
  }
  return curve;
}

const InvestmentComparator = () => {
  const { toast } = useToast();
  
  const [ativo1, setAtivo1] = useState<AssetData>({
    nome: 'CRA ZAMP',
    codigo: 'CRA024001Q9',
    tipoTaxa: 'pre-fixada',
    taxa: 12.03,
    vencimento: '2029-02-15',
    valorInvestido: 236792,
    cupons: 41194,
    valorCurva: 231039,
    valorVenda: 216268,
    tipoCupom: 'semestral',
    mesesCupons: '2,8', // Fevereiro e Agosto
    tipoIR: 'isento',
    aliquotaIR: 0,
    rateKind: 'PRE',
    freq: 'SEMIANNUAL',
    // CRA ZAMP specific: earnings from September to December 2025 (after August payment)
    earningsStartDate: '2025-09-01',
    activePeriods: [
      { year: 2025, months: [8, 9, 10, 11, 12] }, // Aug-Dec 2025 for accrual (including August payment)
      { year: 2026, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, // Full years after 2025
      { year: 2027, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
      { year: 2028, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
      { year: 2029, months: [1, 2] } // Jan-Feb 2029 until maturity (including February payment)
    ]
  });

  const [ativo2, setAtivo2] = useState<AssetData>({
    nome: 'BTDI11',
    codigo: 'BTDI11',
    tipoTaxa: 'cdi-mais', // Changed to cdi-mais for CDI+2.50%
    taxa: 2.50, // 2.50% above CDI
    vencimento: '2029-02-15',
    valorInvestido: 216268, // Mesmo valor da venda do ativo1
    cupons: 0,
    valorCurva: 216268,
    tipoCupom: 'mensal', // Monthly payments starting Nov 2025
    mesesCupons: '',
    tipoIR: 'isento',
    aliquotaIR: 0,
    // BTDI11 specific: earnings start in November 2025
    earningsStartDate: '2025-11-01',
    activePeriods: [
      { year: 2025, months: [11, 12] }, // Nov-Dec 2025
      { year: 2026, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, // Full years
      { year: 2027, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
      { year: 2028, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
      { year: 2029, months: [1, 2] } // Jan-Feb 2029 until maturity
    ]
  });

  const [projecoes, setProjecoes] = useState<Projecoes>({
    cdi: {
      2025: 10.5,
      2026: 13.3,
      2027: 9.0,
      2028: 9.0,
      2029: 9.0,
      2030: 9.0
    },
    ipca: {
      2025: 4.0,
      2026: 3.5,
      2027: 3.25,
      2028: 3.25,
      2029: 3.25,
      2030: 3.25
    }
  });

  const [results, setResults] = useState<CalculationResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastCalculationHash, setLastCalculationHash] = useState<string>('');
  const [calculationTimestamp, setCalculationTimestamp] = useState<number>(0);

  // Function to invalidate results when data changes
  const invalidateResults = () => {
    setHasUnsavedChanges(true);
    if (results) {
      setShowResults(false);
      setResults(null);
    }
  };

  // Function to generate hash of current data for consistency checking
  const generateDataHash = () => {
    const dataString = JSON.stringify({
      ativo1,
      ativo2,
      projecoes
    });
    return btoa(dataString).slice(0, 20); // Simple hash for validation
  };

  const handleAssetChange = (asset: 'ativo1' | 'ativo2', field: keyof AssetData, value: string | number | boolean) => {
    if (asset === 'ativo1') {
      setAtivo1(prev => ({ ...prev, [field]: value }));
      // Se mudou o valor de venda do ativo1, atualiza o valor investido do ativo2
      if (field === 'valorVenda') {
        setAtivo2(prev => ({ 
          ...prev, 
          valorInvestido: Number(value),
          valorCurva: Number(value), // Para aplicação nova, valor de curva = valor investido
          cupons: 0 // Aplicação nova não tem cupons recebidos
        }));
      }
    } else {
      // Para ativo2, valor de curva sempre igual ao valor investido e cupons sempre zero (aplicação nova)
      if (field === 'valorInvestido') {
        setAtivo2(prev => ({ 
          ...prev, 
          valorInvestido: Number(value),
          valorCurva: Number(value),
          cupons: 0
        }));
      } else if (field !== 'cupons' && field !== 'valorCurva') { // Impede alteração de cupons e valorCurva
        setAtivo2(prev => ({ ...prev, [field]: value }));
      }
    }
    
    // Invalidate results whenever asset data changes
    invalidateResults();
  };

  const handleProjecaoChange = (tipo: 'cdi' | 'ipca', ano: number, valor: number) => {
    setProjecoes(prev => ({
      ...prev,
      [tipo]: {
        ...prev[tipo],
        [ano]: valor
      }
    }));
    
    // Invalidate results whenever projections change
    invalidateResults();
  };

  const calcularAliquotaIR = (dados: AssetData, anosInvestimento: number): number => {
    switch (dados.tipoIR) {
      case 'isento':
        return 0;
      case 'fixo-15':
        return 15;
      case 'renda-fixa':
        // Tabela regressiva de renda fixa
        if (anosInvestimento >= 2) return 15; // Mais de 2 anos: 15%
        if (anosInvestimento >= 1) return 17.5; // 1 a 2 anos: 17,5%
        if (anosInvestimento >= 0.5) return 20; // 6 meses a 1 ano: 20%
        return 22.5; // Até 6 meses: 22,5%
      default:
        return dados.aliquotaIR;
    }
  };

  const calcularTaxaReal = (dados: AssetData, ano: number): number => {
    const anoKey = new Date().getFullYear() + ano;
    
    // Check if asset has earnings start date and hasn't started yet
    if (dados.earningsStartDate) {
      const startDate = new Date(dados.earningsStartDate);
      const checkDate = new Date(anoKey, 0, 1); // January 1st of the year
      if (checkDate < startDate) {
        return 0; // No earnings before start date
      }
    }
    
    switch (dados.tipoTaxa) {
      case 'pre-fixada':
        return dados.taxa / 100;
      
      case 'percentual-cdi':
        const cdiAno = (projecoes.cdi[anoKey] || projecoes.cdi[Object.keys(projecoes.cdi).pop() as any]) / 100;
        return cdiAno * (dados.taxa / 100);
      
      case 'cdi-mais':
        const cdiBase = (projecoes.cdi[anoKey] || projecoes.cdi[Object.keys(projecoes.cdi).pop() as any]) / 100;
        return cdiBase + (dados.taxa / 100);
      
      case 'ipca-mais':
        const ipcaAno = (projecoes.ipca[anoKey] || projecoes.ipca[Object.keys(projecoes.ipca).pop() as any]) / 100;
        return ipcaAno + (dados.taxa / 100);
      
      default:
        return dados.taxa / 100;
    }
  };

  const calcularAtivo = (dados: AssetData, anosProjecao: number, vencimentoReal?: number): { valores: number[]; imposto: number; couponDetails?: CouponResult[] } => {
    const periodosAtivo = vencimentoReal || anosProjecao;
    
    // Always use cash flow system when asset has coupons
    if (dados.tipoCupom !== 'nenhum') {
      return calcularAtivoComFluxoCaixa(dados, periodosAtivo);
    }
    
    // Legacy calculation for backward compatibility
    const valores = [Math.round(dados.valorCurva)];
    let valorCuponsAcumulado = 0;
    
    // Calcular apenas até o vencimento real do ativo
    for (let ano = 1; ano <= periodosAtivo; ano++) {
      const taxaAno = calcularTaxaReal(dados, ano);
      const principalProjetado = dados.valorCurva * Math.pow(1 + taxaAno, ano);
      
      // Calcular cupons do ano atual se houver
      let cupomAnoAtual = 0;
      if (dados.tipoCupom !== 'nenhum') {
        // Usar valor investido como base para cálculo dos cupons
        const taxaBaseCupom = calcularTaxaReal(dados, 1);
        cupomAnoAtual = dados.valorInvestido * taxaBaseCupom;
      }
      
      // Reinvestir cupons acumulados dos anos anteriores na taxa CDI (Selic)
      if (valorCuponsAcumulado > 0) {
        const anoKey = new Date().getFullYear() + ano;
        const taxaCDI = (projecoes.cdi[anoKey] || projecoes.cdi[Object.keys(projecoes.cdi).pop() as any]) / 100;
        valorCuponsAcumulado = valorCuponsAcumulado * (1 + taxaCDI);
      }
      
      // Adicionar cupom do ano atual
      valorCuponsAcumulado += cupomAnoAtual;
      
      const valorTotalAno = principalProjetado + valorCuponsAcumulado;
      valores.push(Math.round(valorTotalAno));
    }

    // Calcular IR sobre o lucro até o vencimento real
    const valorFinal = valores[valores.length - 1];
    const valorInicial = dados.valorCurva;
    const lucro = valorFinal - valorInicial;
    const aliquotaFinal = calcularAliquotaIR(dados, periodosAtivo);
    const imposto = lucro > 0 && aliquotaFinal > 0 ? lucro * (aliquotaFinal / 100) : 0;
    
    // Ajustar valor final para líquido de IR
    valores[valores.length - 1] = Math.round(valorFinal - imposto);
    
    return { valores, imposto: Math.round(imposto) };
  };

  // New cash flow calculation method
  const calcularAtivoComFluxoCaixa = (dados: AssetData, anosProjecao: number): { valores: number[]; imposto: number; couponDetails: CouponResult[] } => {
    const hoje = new Date();
    const startISO = hoje.toISOString().slice(0, 10);
    const endDate = new Date(dados.vencimento);
    const endISO = endDate.toISOString().slice(0, 10);
    
    // Generate CDI curve from projections
    const cdiCurve = projecoes.cdiCurve || generateCDICurve(projecoes);
    
    // Map legacy data to new format
    const rateKind = mapLegacyToNewFormat(dados);
    const freq = mapCoupomFreq(dados.tipoCupom);
    
    // Setup cash flow input
    const cashFlowInput: CouponEngineInput = {
      principal: dados.valorCurva,
      startISO,
      endISO,
      freq,
      rateKind,
      taxaPreAA: rateKind === 'PRE' ? dados.taxa : undefined,
      taxaRealAA: rateKind === 'IPCA+PRE' ? dados.taxa : undefined,
      spreadPreAA: rateKind === 'CDI+PRE' ? dados.taxa : undefined,
      percCDI: rateKind === '%CDI' ? dados.taxa : undefined,
      cdiAABase: projecoes.cdi[new Date().getFullYear()] || 10,
      cdiCurve,
      ipcaCurve: projecoes.ipcaCurve,
      feesAA: 0, // Removed - not applicable for direct securities
      irRegressivo: dados.tipoIR === 'renda-fixa',
      use252: false, // Removed - not applicable for direct securities
      earningsStartDate: dados.earningsStartDate // Add earnings start date
    };
    
    // Calculate cash flows
    const result = projectWithReinvestCDI(cashFlowInput);
    
    // Build annual values array for compatibility
    const valores = [Math.round(dados.valorCurva)];
    const valorPorAno = result.totalVF / anosProjecao;
    
    for (let ano = 1; ano <= anosProjecao; ano++) {
      const valorProjetado = dados.valorCurva + (valorPorAno * ano);
      valores.push(Math.round(valorProjetado));
    }
    
    // Final value adjustment
    valores[valores.length - 1] = Math.round(result.totalVF);
    
    // Calculate total IR from coupons and principal
    const totalIR = result.coupons.reduce((sum, c) => sum + (c.gross - c.net), 0) + 
                   Math.max(0, result.principalNetFinal - dados.valorCurva) * 
                   (dados.tipoIR === 'renda-fixa' ? irAliquotaRegressivo(daysBetween(startISO, endISO)) : 0);
    
    return { 
      valores, 
      imposto: Math.round(totalIR),
      couponDetails: result.coupons 
    };
  };

  const calcularReinvestimento = (valorInicial: number, periodosReinvestimento: number, anoInicial: number): { valores: number[]; imposto: number } => {
    const valores = [];
    let valorAtual = valorInicial;
    
    for (let periodo = 1; periodo <= periodosReinvestimento; periodo++) {
      const anoKey = new Date().getFullYear() + anoInicial + periodo;
      const taxaCDI = (projecoes.cdi[anoKey] || projecoes.cdi[Object.keys(projecoes.cdi).pop() as any]) / 100;
      valorAtual = valorAtual * (1 + taxaCDI);
      valores.push(Math.round(valorAtual));
    }
    
    // Calcular IR sobre o lucro do reinvestimento (tabela regressiva de renda fixa)
    const lucroReinvestimento = valorAtual - valorInicial;
    const aliquotaReinvestimento = periodosReinvestimento >= 2 ? 15 : 
                                  periodosReinvestimento >= 1 ? 17.5 : 
                                  periodosReinvestimento >= 0.5 ? 20 : 22.5;
    const impostoReinvestimento = lucroReinvestimento > 0 ? lucroReinvestimento * (aliquotaReinvestimento / 100) : 0;
    
    // Ajustar valor final para líquido de IR
    if (valores.length > 0) {
      valores[valores.length - 1] = Math.round(valorAtual - impostoReinvestimento);
    }
    
    return { valores, imposto: Math.round(impostoReinvestimento) };
  };

  // Validation function to check if data is complete
  const validateDataForCalculation = (): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];

    // Validate Ativo1
    if (!ativo1.nome.trim()) errors.push('Nome do Ativo 1 é obrigatório');
    if (!ativo1.vencimento) errors.push('Data de vencimento do Ativo 1 é obrigatória');
    if (ativo1.valorInvestido <= 0) errors.push('Valor investido do Ativo 1 deve ser maior que zero');
    if (ativo1.taxa <= 0) errors.push('Taxa do Ativo 1 deve ser maior que zero');

    // Validate Ativo2
    if (!ativo2.nome.trim()) errors.push('Nome do Ativo 2 é obrigatório');
    if (!ativo2.vencimento) errors.push('Data de vencimento do Ativo 2 é obrigatória');
    if (ativo2.valorInvestido <= 0) errors.push('Valor investido do Ativo 2 deve ser maior que zero');
    if (ativo2.taxa <= 0) errors.push('Taxa do Ativo 2 deve ser maior que zero');

    // Validate dates are in the future
    const hoje = new Date();
    const venc1 = new Date(ativo1.vencimento);
    const venc2 = new Date(ativo2.vencimento);
    
    if (venc1 <= hoje) errors.push('Data de vencimento do Ativo 1 deve ser no futuro');
    if (venc2 <= hoje) errors.push('Data de vencimento do Ativo 2 deve ser no futuro');

    // Validate projections cover necessary years
    const maxYear = Math.max(venc1.getFullYear(), venc2.getFullYear());
    const currentYear = hoje.getFullYear();
    
    for (let year = currentYear; year <= maxYear; year++) {
      if (!projecoes.cdi[year]) errors.push(`Projeção CDI para ${year} é necessária`);
      if (!projecoes.ipca[year]) errors.push(`Projeção IPCA para ${year} é necessária`);
    }

    return { isValid: errors.length === 0, errors };
  };

  const calcular = () => {
    try {
      // Validate data before calculation
      const validation = validateDataForCalculation();
      if (!validation.isValid) {
        alert('Dados incompletos:\n' + validation.errors.join('\n'));
        return;
      }
      const hoje = new Date();
      
      const vencimento1 = new Date(ativo1.vencimento);
      const vencimento2 = new Date(ativo2.vencimento);
      
      // Calcular anos até cada vencimento
      const anosAtivo1 = Math.ceil((vencimento1.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
      const anosAtivo2 = Math.ceil((vencimento2.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24 * 365.25));

      if (anosAtivo1 <= 0 || anosAtivo2 <= 0) {
        toast({
          title: "Erro",
          description: "As datas de vencimento devem ser no futuro.",
          variant: "destructive"
        });
        return;
      }

      let resultAtivo1, resultAtivo2, reinvestimentoInfo;
      
      if (anosAtivo1 < anosAtivo2) {
        // Ativo 1 vence antes do Ativo 2 - reinvestir Ativo 1
        resultAtivo1 = calcularAtivo(ativo1, anosAtivo1, anosAtivo1);
        resultAtivo2 = calcularAtivo(ativo2, anosAtivo2, anosAtivo2);
        
        // Calcular reinvestimento do Ativo 1
        const valorResgatado = resultAtivo1.valores[resultAtivo1.valores.length - 1];
        const periodosReinvestimento = anosAtivo2 - anosAtivo1;
        const reinvestimento = calcularReinvestimento(valorResgatado, periodosReinvestimento, anosAtivo1);
        
        // Completar array do Ativo 1 com valores de reinvestimento
        resultAtivo1.valores = [...resultAtivo1.valores, ...reinvestimento.valores];
        resultAtivo1.imposto += reinvestimento.imposto;
        
        reinvestimentoInfo = {
          ativoReinvestido: 'ativo1' as const,
          valorResgatado,
          periodosReinvestimento,
          taxaReinvestimento: projecoes.cdi[Object.keys(projecoes.cdi).pop() as any],
          valorFinalReinvestimento: reinvestimento.valores[reinvestimento.valores.length - 1] || valorResgatado
        };
        
      } else if (anosAtivo2 < anosAtivo1) {
        // Ativo 2 vence antes do Ativo 1 - comparar apenas até vencimento do Ativo 2
        resultAtivo1 = calcularAtivo(ativo1, anosAtivo2, anosAtivo2);
        resultAtivo2 = calcularAtivo(ativo2, anosAtivo2, anosAtivo2);
        
      } else {
        // Ambos vencem na mesma data
        resultAtivo1 = calcularAtivo(ativo1, anosAtivo1, anosAtivo1);
        resultAtivo2 = calcularAtivo(ativo2, anosAtivo2, anosAtivo2);
      }
      
      const anosProjecao = Math.max(anosAtivo1, anosAtivo2);
      
      setResults({
        ativo1: resultAtivo1.valores,
        ativo2: resultAtivo2.valores,
        impostoAtivo1: resultAtivo1.imposto,
        impostoAtivo2: resultAtivo2.imposto,
        anosProjecao,
        reinvestimento: reinvestimentoInfo,
        couponDetails: {
          ativo1: resultAtivo1.couponDetails,
          ativo2: resultAtivo2.couponDetails
        }
      });
      setShowResults(true);
      
      // Update calculation state tracking
      setHasUnsavedChanges(false);
      setLastCalculationHash(generateDataHash());
      setCalculationTimestamp(Date.now());
      
      toast({
        title: "Cálculo concluído",
        description: "Comparação gerada com sucesso!"
      });
    } catch (error) {
      toast({
        title: "Erro no cálculo",
        description: "Verifique os dados inseridos e tente novamente.",
        variant: "destructive"
      });
    }
  };

  const limparDados = () => {
    setAtivo1({
      nome: '',
      codigo: '',
      tipoTaxa: 'pre-fixada',
      taxa: 0,
      vencimento: '',
      valorInvestido: 0,
      cupons: 0,
      valorCurva: 0,
      valorVenda: 0,
      tipoCupom: 'semestral',
      mesesCupons: '',
      tipoIR: 'isento',
      aliquotaIR: 0
    });
    setAtivo2({
      nome: '',
      codigo: '',
      tipoTaxa: 'pre-fixada',
      taxa: 0,
      vencimento: '',
      valorInvestido: 0,
      cupons: 0,
      valorCurva: 0,
      tipoCupom: 'semestral',
      mesesCupons: '',
      tipoIR: 'isento',
      aliquotaIR: 0
    });
    setShowResults(false);
    setResults(null);
    
    // Reset calculation state tracking
    setHasUnsavedChanges(false);
    setLastCalculationHash('');
    setCalculationTimestamp(0);
  };

  // Enhanced function to calculate annual yields considering specific periods and accrual
  const calcularRendimentosAnuais = (valores: number[], valorInicial: number, asset: AssetData) => {
    console.log('🔍 Calculando rendimentos anuais para:', asset.nome);
    console.log('📊 Valores recebidos:', valores);
    console.log('💰 Valor inicial:', valorInicial);
    console.log('📅 Períodos ativos:', asset.activePeriods);
    console.log('🎯 Data início rendimentos:', asset.earningsStartDate);
    
    const rendimentos: number[] = [];
    const anoAtual = new Date().getFullYear();
    
    for (let i = 0; i < valores.length; i++) {
      const anoRendimento = anoAtual + i;
      console.log(`\n📅 Processando ano ${anoRendimento} (índice ${i})`);
      
      // Check if asset has defined active periods
      if (asset.activePeriods) {
        const periodForYear = asset.activePeriods.find(p => p.year === anoRendimento);
        console.log(`🔍 Período para ${anoRendimento}:`, periodForYear);
        
        if (periodForYear) {
          // Calculate proportional yield based on active months
          const mesesAtivos = periodForYear.months.length;
          const proporcao = mesesAtivos / 12;
          console.log(`📊 Meses ativos: ${mesesAtivos}, Proporção: ${proporcao}`);
          
          if (anoRendimento === 2025) {
            // CRA ZAMP: special calculation for Sept-Dec 2025
            const taxaAnual = calcularTaxaReal(asset, i);
            const rendimentoAcruado = valorInicial * taxaAnual * proporcao;
            console.log(`💰 CRA ZAMP 2025 - Taxa: ${taxaAnual}, Rendimento: ${rendimentoAcruado}`);
            rendimentos.push(Math.max(0, rendimentoAcruado));
          } else if (asset.earningsStartDate) {
            // BTDI11: earnings start from specific date
            const startDate = new Date(asset.earningsStartDate);
            const yearStart = new Date(anoRendimento, 0, 1);
            console.log(`📅 BTDI11 - Data início: ${startDate}, Início do ano: ${yearStart}`);
            
            if (startDate <= yearStart || anoRendimento > startDate.getFullYear()) {
              // Full year or after start year
              if (i > 0) {
                const crescimentoAnual = valores[i] - valores[i - 1];
                const rendimentoCalculado = crescimentoAnual * proporcao;
                console.log(`📈 Crescimento anual: ${crescimentoAnual}, Rendimento: ${rendimentoCalculado}`);
                rendimentos.push(rendimentoCalculado);
              } else {
                const crescimentoTotal = valores[i] - valorInicial;
                const rendimentoCalculado = crescimentoTotal * proporcao;
                console.log(`📈 Crescimento total: ${crescimentoTotal}, Rendimento: ${rendimentoCalculado}`);
                rendimentos.push(rendimentoCalculado);
              }
            } else if (anoRendimento === startDate.getFullYear()) {
              // Partial year from start date
              const startMonth = startDate.getMonth() + 1; // 1-based
              const mesesAposInicio = periodForYear.months.filter(m => m >= startMonth).length;
              const proporcaoAjustada = mesesAposInicio / 12;
              console.log(`📅 Ano parcial - Mês início: ${startMonth}, Meses após início: ${mesesAposInicio}, Proporção ajustada: ${proporcaoAjustada}`);
              
              if (i > 0) {
                const crescimentoAnual = valores[i] - valores[i - 1];
                const rendimentoCalculado = crescimentoAnual * proporcaoAjustada;
                console.log(`📈 Crescimento anual: ${crescimentoAnual}, Rendimento: ${rendimentoCalculado}`);
                rendimentos.push(rendimentoCalculado);
              } else {
                const crescimentoTotal = valores[i] - valorInicial;
                const rendimentoCalculado = crescimentoTotal * proporcaoAjustada;
                console.log(`📈 Crescimento total: ${crescimentoTotal}, Rendimento: ${rendimentoCalculado}`);
                rendimentos.push(rendimentoCalculado);
              }
            } else {
              // Before start date - no earnings
              console.log(`❌ Antes da data de início - sem rendimentos`);
              rendimentos.push(0);
            }
          } else {
            // Standard proportional calculation
            if (i > 0) {
              const crescimentoAnual = valores[i] - valores[i - 1];
              const rendimentoCalculado = crescimentoAnual * proporcao;
              console.log(`📊 Cálculo padrão - Crescimento: ${crescimentoAnual}, Rendimento: ${rendimentoCalculado}`);
              rendimentos.push(rendimentoCalculado);
            } else {
              const crescimentoTotal = valores[i] - valorInicial;
              const rendimentoCalculado = crescimentoTotal * proporcao;
              console.log(`📊 Cálculo padrão total - Crescimento: ${crescimentoTotal}, Rendimento: ${rendimentoCalculado}`);
              rendimentos.push(crescimentoTotal * proporcao);
            }
          }
        } else {
          // Year not defined in active periods - no earnings
          console.log(`❌ Ano não definido nos períodos ativos - sem rendimentos`);
          rendimentos.push(0);
        }
      } else {
        // Legacy calculation for assets without active periods defined
        console.log(`🔄 Cálculo legado sem períodos definidos`);
        if (i > 0) {
          const rendimentoLegacy = valores[i] - valores[i - 1];
          console.log(`📊 Rendimento legacy: ${rendimentoLegacy}`);
          rendimentos.push(rendimentoLegacy);
        } else {
          const rendimentoLegacy = valores[i] - valorInicial;
          console.log(`📊 Rendimento legacy inicial: ${rendimentoLegacy}`);
          rendimentos.push(rendimentoLegacy);
        }
      }
    }
    
    console.log('✅ Rendimentos finais calculados:', rendimentos);
    return rendimentos;
  };

  const getTaxaLabel = (tipoTaxa: string) => {
    switch (tipoTaxa) {
      case 'pre-fixada': return 'Taxa Anual (%)';
      case 'percentual-cdi': return '% do CDI';
      case 'cdi-mais': return 'Taxa + CDI (%)';
      case 'ipca-mais': return 'Taxa + IPCA (%)';
      default: return 'Taxa (%)';
    }
  };

  const getTaxaPlaceholder = (tipoTaxa: string) => {
    switch (tipoTaxa) {
      case 'pre-fixada': return '12.03';
      case 'percentual-cdi': return '102.5';
      case 'cdi-mais': return '2.5';
      case 'ipca-mais': return '5.0';
      default: return '12.03';
    }
  };

  const getTaxaDisplay = (asset: AssetData) => {
    switch (asset.tipoTaxa) {
      case 'pre-fixada': return `${asset.taxa.toFixed(2)}% a.a.`;
      case 'percentual-cdi': return `${asset.taxa.toFixed(2)}% do CDI`;
      case 'cdi-mais': return `CDI + ${asset.taxa.toFixed(2)}%`;
      case 'ipca-mais': return `IPCA + ${asset.taxa.toFixed(2)}%`;
      default: return `${asset.taxa.toFixed(2)}%`;
    }
  };

  const getTipoTaxaDisplay = (tipoTaxa: string) => {
    switch (tipoTaxa) {
      case 'pre-fixada': return 'Pré-fixada';
      case 'percentual-cdi': return '% CDI';
      case 'cdi-mais': return 'CDI + Taxa';
      case 'ipca-mais': return 'IPCA + Taxa';
      default: return tipoTaxa;
    }
  };

  const getIRDisplay = (asset: AssetData, anosProjecao: number) => {
    switch (asset.tipoIR) {
      case 'isento': return 'Isento';
      case 'fixo-15': return '15%';
      case 'renda-fixa': return `${calcularAliquotaIR(asset, anosProjecao)}% (Tabela)`;
      default: return `${asset.aliquotaIR}%`;
    }
  };

  const renderAssetForm = (asset: AssetData, assetKey: 'ativo1' | 'ativo2', title: string, color: string) => (
    <Card className={`border-${color}/20 shadow-lg`}>
      <CardHeader className={`bg-gradient-to-r from-${color} to-financial-secondary text-white rounded-t-lg`}>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-nome`}>Nome do Ativo</Label>
            <Input
              id={`${assetKey}-nome`}
              value={asset.nome}
              onChange={(e) => handleAssetChange(assetKey, 'nome', e.target.value)}
              placeholder="Ex: CRA ZAMP"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-codigo`}>Código</Label>
            <Input
              id={`${assetKey}-codigo`}
              value={asset.codigo}
              onChange={(e) => handleAssetChange(assetKey, 'codigo', e.target.value)}
              placeholder="Ex: CRA024001Q9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-tipoTaxa`}>Tipo de Taxa</Label>
            <Select value={asset.tipoTaxa} onValueChange={(value) => handleAssetChange(assetKey, 'tipoTaxa', value)}>
              <SelectTrigger className="bg-background border-border z-50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-border shadow-lg z-50">
                <SelectItem value="pre-fixada">Pré-fixada</SelectItem>
                <SelectItem value="percentual-cdi">% CDI</SelectItem>
                <SelectItem value="cdi-mais">CDI + Taxa Pré</SelectItem>
                <SelectItem value="ipca-mais">IPCA + Taxa Pré</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-taxa`}>{getTaxaLabel(asset.tipoTaxa)}</Label>
            <Input
              id={`${assetKey}-taxa`}
              type="number"
              step="0.01"
              value={asset.taxa}
              onChange={(e) => handleAssetChange(assetKey, 'taxa', parseFloat(e.target.value) || 0)}
              placeholder={getTaxaPlaceholder(asset.tipoTaxa)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-vencimento`}>Data Vencimento</Label>
            <Input
              id={`${assetKey}-vencimento`}
              type="date"
              value={asset.vencimento}
              onChange={(e) => handleAssetChange(assetKey, 'vencimento', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-valorInvestido`}>
              {assetKey === 'ativo2' ? 'Valor Investido (R$) - Valor da Venda do Ativo 1' : 'Valor Investido (R$)'}
            </Label>
            <Input
              id={`${assetKey}-valorInvestido`}
              type="number"
              step="0.01"
              value={asset.valorInvestido}
              onChange={(e) => handleAssetChange(assetKey, 'valorInvestido', parseFloat(e.target.value) || 0)}
              disabled={assetKey === 'ativo2'}
              className={assetKey === 'ativo2' ? 'bg-muted/50 cursor-not-allowed' : ''}
            />
          </div>
          {assetKey === 'ativo1' && (
            <>
              <div className="space-y-2">
                <Label htmlFor={`${assetKey}-cupons`}>Cupons Recebidos (R$)</Label>
                <Input
                  id={`${assetKey}-cupons`}
                  type="number"
                  step="0.01"
                  value={asset.cupons}
                  onChange={(e) => handleAssetChange(assetKey, 'cupons', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${assetKey}-valorCurva`}>Valor de Curva (R$)</Label>
                <Input
                  id={`${assetKey}-valorCurva`}
                  type="number"
                  step="0.01"
                  value={asset.valorCurva}
                  onChange={(e) => handleAssetChange(assetKey, 'valorCurva', parseFloat(e.target.value) || 0)}
                />
              </div>
            </>
          )}
          {assetKey === 'ativo1' && (
            <div className="space-y-2">
              <Label htmlFor={`${assetKey}-valorVenda`}>Valor de Venda (R$)</Label>
              <Input
                id={`${assetKey}-valorVenda`}
                type="number"
                step="0.01"
                value={asset.valorVenda || 0}
                onChange={(e) => handleAssetChange(assetKey, 'valorVenda', parseFloat(e.target.value) || 0)}
                placeholder="Valor recebido na venda"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-tipoCupom`}>Tipo de Cupom</Label>
            <Select value={asset.tipoCupom} onValueChange={(value) => handleAssetChange(assetKey, 'tipoCupom', value)}>
              <SelectTrigger className="bg-background border-border z-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-border shadow-lg z-40">
                <SelectItem value="mensal">Mensal</SelectItem>
                <SelectItem value="semestral">Semestral</SelectItem>
                <SelectItem value="anual">Anual</SelectItem>
                <SelectItem value="nenhum">Sem Cupons</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-mesesCupons`}>Meses Cupons</Label>
            {asset.tipoCupom === 'nenhum' ? (
              <Input
                id={`${assetKey}-mesesCupons`}
                value=""
                disabled
                placeholder="Não aplicável"
                className="bg-muted/50 cursor-not-allowed"
              />
            ) : asset.tipoCupom === 'semestral' ? (
              <Select 
                value={asset.mesesCupons} 
                onValueChange={(value) => handleAssetChange(assetKey, 'mesesCupons', value)}
              >
                <SelectTrigger className="bg-background border-border z-30">
                  <SelectValue placeholder="Selecione os meses" />
                </SelectTrigger>
                <SelectContent className="bg-background border-border shadow-lg z-30">
                  <SelectItem value="1,7">Janeiro e Julho</SelectItem>
                  <SelectItem value="2,8">Fevereiro e Agosto</SelectItem>
                  <SelectItem value="3,9">Março e Setembro</SelectItem>
                  <SelectItem value="4,10">Abril e Outubro</SelectItem>
                  <SelectItem value="5,11">Maio e Novembro</SelectItem>
                  <SelectItem value="6,12">Junho e Dezembro</SelectItem>
                </SelectContent>
              </Select>
            ) : asset.tipoCupom === 'anual' ? (
              <Select 
                value={asset.mesesCupons} 
                onValueChange={(value) => handleAssetChange(assetKey, 'mesesCupons', value)}
              >
                <SelectTrigger className="bg-background border-border z-30">
                  <SelectValue placeholder="Selecione o mês" />
                </SelectTrigger>
                <SelectContent className="bg-background border-border shadow-lg z-30">
                  <SelectItem value="1">Janeiro</SelectItem>
                  <SelectItem value="2">Fevereiro</SelectItem>
                  <SelectItem value="3">Março</SelectItem>
                  <SelectItem value="4">Abril</SelectItem>
                  <SelectItem value="5">Maio</SelectItem>
                  <SelectItem value="6">Junho</SelectItem>
                  <SelectItem value="7">Julho</SelectItem>
                  <SelectItem value="8">Agosto</SelectItem>
                  <SelectItem value="9">Setembro</SelectItem>
                  <SelectItem value="10">Outubro</SelectItem>
                  <SelectItem value="11">Novembro</SelectItem>
                  <SelectItem value="12">Dezembro</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              // Mensal - todos os meses
              <Input
                id={`${assetKey}-mesesCupons`}
                value="1,2,3,4,5,6,7,8,9,10,11,12"
                disabled
                className="bg-muted/50 cursor-not-allowed"
                placeholder="Todos os meses"
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-tipoIR`}>Tipo de Tributação</Label>
            <Select value={asset.tipoIR} onValueChange={(value) => handleAssetChange(assetKey, 'tipoIR', value)}>
              <SelectTrigger className="bg-background border-border z-30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-border shadow-lg z-30">
                <SelectItem value="isento">Isento de IR</SelectItem>
                <SelectItem value="renda-fixa">Tabela Renda Fixa (22,5% a 15%)</SelectItem>
                <SelectItem value="fixo-15">Fixo 15% (ETFs/Ações)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Earnings Period Configuration */}
          <div className="col-span-full">
            <div className="bg-muted/30 p-4 rounded-lg border border-dashed">
              <h4 className="text-sm font-medium mb-3">⚙️ Configurações Especiais</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`${assetKey}-earningsStartDate`} className="text-sm">
                    📅 Data de Início dos Rendimentos
                  </Label>
                  <Input
                    id={`${assetKey}-earningsStartDate`}
                    type="date"
                    value={asset.earningsStartDate || ''}
                    onChange={(e) => handleAssetChange(assetKey, 'earningsStartDate', e.target.value)}
                    placeholder="YYYY-MM-DD"
                    className="text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Quando o ativo começará a gerar rendimentos (ex: BTDI11)
                  </p>
                </div>
                
              </div>
              
              {asset.earningsStartDate && (
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-sm text-blue-800">
                      <strong>Sistema automático:</strong> Cupons sempre reinvestidos à taxa CDI projetada 
                      do momento do pagamento até o vencimento.
                    </p>
                    <p className="text-sm text-blue-700 mt-2">
                      📅 <strong>Período especial:</strong> Rendimentos iniciando em {new Date(asset.earningsStartDate + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const anoAtual = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="container mx-auto max-w-7xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="p-3 bg-gradient-to-br from-financial-primary to-financial-secondary rounded-xl">
              <TrendingUp className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-financial-primary to-financial-secondary bg-clip-text text-transparent">
              COMPARADOR UNIVERSAL DE INVESTIMENTOS
            </h1>
          </div>
          <p className="text-lg text-muted-foreground">Compare qualquer ativo com outro ativo</p>
          <Separator className="mt-6" />
        </div>

        {/* Asset Forms */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          {renderAssetForm(ativo1, 'ativo1', '📊 Ativo 1', 'financial-primary')}
          
          <div className="flex items-center justify-center xl:hidden">
            <div className="p-3 bg-gradient-to-r from-financial-primary to-financial-secondary rounded-full">
              <ArrowRight className="h-6 w-6 text-white rotate-90 xl:rotate-0" />
            </div>
          </div>
          
          {renderAssetForm(ativo2, 'ativo2', '📈 Ativo 2', 'financial-secondary')}
        </div>

        {/* Projections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* CDI Projections */}
          <Card className="border-financial-secondary/20 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-financial-secondary to-financial-primary text-white rounded-t-lg">
              <CardTitle>📈 Projeção CDI (%)</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {Object.entries(projecoes.cdi).map(([year, value]) => (
                  <div key={year} className="space-y-2">
                    <Label htmlFor={`cdi${year}`}>{year}</Label>
                    <Input
                      id={`cdi${year}`}
                      type="number"
                      step="0.1"
                      value={value}
                      onChange={(e) => handleProjecaoChange('cdi', parseInt(year), parseFloat(e.target.value) || 0)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* IPCA Projections */}
          <Card className="border-financial-primary/20 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-financial-primary to-financial-secondary text-white rounded-t-lg">
              <CardTitle>📊 Projeção IPCA (%)</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {Object.entries(projecoes.ipca).map(([year, value]) => (
                  <div key={year} className="space-y-2">
                    <Label htmlFor={`ipca${year}`}>{year}</Label>
                    <Input
                      id={`ipca${year}`}
                      type="number"
                      step="0.1"
                      value={value}
                      onChange={(e) => handleProjecaoChange('ipca', parseInt(year), parseFloat(e.target.value) || 0)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

         {/* Action Buttons */}
        <div className="flex flex-wrap justify-center gap-4 mb-8">
          <Button
            onClick={calcular}
            size="lg"
            className="bg-gradient-to-r from-financial-primary to-financial-secondary hover:from-financial-secondary hover:to-financial-primary text-white font-bold shadow-lg transform transition-all duration-300 hover:scale-105"
          >
            <Calculator className="h-5 w-5 mr-2" />
            🔄 Calcular Comparação
            {hasUnsavedChanges && (
              <span className="ml-2 text-yellow-300 animate-pulse">●</span>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={limparDados}
            size="lg"
            className="border-financial-danger text-financial-danger hover:bg-financial-danger hover:text-white"
          >
            <Trash2 className="h-5 w-5 mr-2" />
            🗑️ Limpar Dados
          </Button>
          <Button
            variant="outline"
            onClick={() => window.print()}
            size="lg"
            className="border-financial-primary text-financial-primary hover:bg-financial-primary hover:text-white"
          >
            <Printer className="h-5 w-5 mr-2" />
            🖨️ Gerar PDF
          </Button>
        </div>

        {/* Warning for unsaved changes */}
        {hasUnsavedChanges && (
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <span className="text-yellow-400 text-xl">⚠️</span>
              </div>
              <div className="ml-3">
                <p className="text-sm text-yellow-700">
                  <strong>Dados alterados!</strong> Os resultados mostrados podem estar desatualizados. 
                  Clique em "Calcular Comparação" para atualizar com os dados mais recentes.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {showResults && results && (
          <div className="space-y-6">
            {/* Executive Summary */}
            <Card className="border-financial-primary/30 shadow-xl">
              <CardHeader className="bg-gradient-to-r from-financial-primary to-financial-secondary text-white rounded-t-lg">
                <CardTitle>Resumo Executivo - {ativo1.nome} vs {ativo2.nome}</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gradient-to-r from-financial-secondary to-financial-primary text-white">
                        <th className="p-3 text-left border">Ativo</th>
                        <th className="p-3 text-left border">Tipo Taxa</th>
                        <th className="p-3 text-left border">Taxa</th>
                        <th className="p-3 text-left border">Vencimento</th>
                        <th className="p-3 text-left border">Valor Investido</th>
                        <th className="p-3 text-left border">Valor de Curva</th>
                        <th className="p-3 text-left border">Cupons Recebidos</th>
                        <th className="p-3 text-left border">Tributação IR</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="even:bg-muted/50">
                        <td className="p-3 border font-semibold">{ativo1.nome}</td>
                        <td className="p-3 border font-mono">{getTipoTaxaDisplay(ativo1.tipoTaxa)}</td>
                        <td className="p-3 border font-mono">{getTaxaDisplay(ativo1)}</td>
                        <td className="p-3 border font-mono">{new Date(ativo1.vencimento).toLocaleDateString('pt-BR')}</td>
                        <td className="p-3 border font-mono">R$ {ativo1.valorInvestido.toLocaleString('pt-BR')}</td>
                        <td className="p-3 border font-mono">R$ {ativo1.valorCurva.toLocaleString('pt-BR')}</td>
                        <td className="p-3 border font-mono">R$ {ativo1.cupons.toLocaleString('pt-BR')}</td>
                        <td className="p-3 border font-mono">{getIRDisplay(ativo1, results.anosProjecao)}</td>
                      </tr>
                      <tr className="even:bg-muted/50">
                        <td className="p-3 border font-semibold">{ativo2.nome}</td>
                        <td className="p-3 border font-mono">{getTipoTaxaDisplay(ativo2.tipoTaxa)}</td>
                        <td className="p-3 border font-mono">{getTaxaDisplay(ativo2)}</td>
                        <td className="p-3 border font-mono">{new Date(ativo2.vencimento).toLocaleDateString('pt-BR')}</td>
                        <td className="p-3 border font-mono">R$ {ativo2.valorInvestido.toLocaleString('pt-BR')}</td>
                        <td className="p-3 border font-mono">R$ {ativo2.valorCurva.toLocaleString('pt-BR')}</td>
                        <td className="p-3 border font-mono">R$ {ativo2.cupons.toLocaleString('pt-BR')}</td>
                        <td className="p-3 border font-mono">{getIRDisplay(ativo2, results.anosProjecao)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Reinvestment Information */}
            {results.reinvestimento && (
              <Card className="border-financial-warning/30 shadow-xl bg-gradient-to-br from-yellow-50 to-orange-50">
                <CardHeader className="bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Informações de Reinvestimento
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="space-y-3 text-sm">
                    <div className="p-4 bg-yellow-100 rounded-lg">
                      <p className="font-medium text-yellow-800">
                        <strong>Estratégia aplicada:</strong> O {results.reinvestimento.ativoReinvestido === 'ativo1' ? ativo1.nome : ativo2.nome} vence antes, 
                        então seu valor resgatado foi reinvestido na taxa CDI/Selic até o vencimento do outro ativo.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="font-medium">Valor Resgatado:</span>
                          <span className="font-mono font-bold">R$ {results.reinvestimento.valorResgatado.toLocaleString('pt-BR')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-medium">Período de Reinvestimento:</span>
                          <span className="font-mono font-bold">{results.reinvestimento.periodosReinvestimento} {results.reinvestimento.periodosReinvestimento === 1 ? 'ano' : 'anos'}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="font-medium">Taxa de Reinvestimento:</span>
                          <span className="font-mono font-bold">{results.reinvestimento.taxaReinvestimento.toFixed(2)}% a.a. (CDI)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-medium">Valor Final Reinvestimento:</span>
                          <span className="font-mono font-bold">R$ {results.reinvestimento.valorFinalReinvestimento.toLocaleString('pt-BR')}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Comparison Table */}
            <Card className="border-financial-secondary/30 shadow-xl">
              <CardHeader className="bg-gradient-to-r from-financial-secondary to-financial-primary text-white rounded-t-lg">
                <CardTitle>Comparação Ano a Ano</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                 <div className="overflow-x-auto">
                   <table className="w-full border-collapse">
                     <thead>
                       <tr className="bg-gradient-to-r from-financial-primary to-financial-secondary text-white">
                         <th className="p-3 text-left border">Ano</th>
                         <th className="p-3 text-left border">Rendimentos {ativo1.nome}</th>
                         <th className="p-3 text-left border">Rendimentos {ativo2.nome}</th>
                         <th className="p-3 text-left border">Diferença</th>
                         <th className="p-3 text-left border">Vantagem</th>
                       </tr>
                     </thead>
                     <tbody>
                       {(() => {
                         const rendimentosAtivo1 = calcularRendimentosAnuais(results.ativo1, ativo1.valorInvestido, ativo1);
                         const rendimentosAtivo2 = calcularRendimentosAnuais(results.ativo2, ativo2.valorInvestido, ativo2);
                         
                         return rendimentosAtivo1.map((rendimento1, index) => {
                           const rendimento2 = rendimentosAtivo2[index];
                           const diferenca = rendimento1 - rendimento2;
                           const vantagem = diferenca >= 0 ? ativo1.nome : ativo2.nome;
                           const isUltimoAno = index === rendimentosAtivo1.length - 1;
                           
                           return (
                             <tr key={index} className={`even:bg-muted/50 ${isUltimoAno ? 'bg-gradient-to-r from-financial-light/30 to-financial-light/10 font-bold' : ''}`}>
                               <td className="p-3 border font-semibold">{anoAtual + index}</td>
                               <td className={`p-3 border font-mono ${rendimento1 >= 0 ? 'text-financial-success' : 'text-financial-danger'}`}>
                                 {rendimento1 >= 0 ? '+' : ''}R$ {rendimento1.toLocaleString('pt-BR')}
                               </td>
                               <td className={`p-3 border font-mono ${rendimento2 >= 0 ? 'text-financial-success' : 'text-financial-danger'}`}>
                                 {rendimento2 >= 0 ? '+' : ''}R$ {rendimento2.toLocaleString('pt-BR')}
                               </td>
                               <td className={`p-3 border font-mono font-bold ${diferenca >= 0 ? 'text-financial-success' : 'text-financial-danger'}`}>
                                 {diferenca >= 0 ? '+' : ''}R$ {diferenca.toLocaleString('pt-BR')}
                               </td>
                               <td className="p-3 border font-semibold">{vantagem}</td>
                             </tr>
                           );
                         });
                       })()}
                     </tbody>
                   </table>
                 </div>
              </CardContent>
            </Card>

            {/* Final Analysis */}
            <Card className="border-financial-success/30 shadow-xl bg-gradient-to-br from-financial-light/50 to-white">
              <CardContent className="p-6">
                <h3 className="text-xl font-bold text-financial-primary mb-4">
                  Análise Final da Comparação:
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">Valor Final Líquido ({ativo1.nome}):</span>
                    <span className="font-mono font-bold">R$ {results.ativo1[results.ativo1.length - 1].toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>(Após IR de R$ {results.impostoAtivo1.toLocaleString('pt-BR')})</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Valor Final Líquido ({ativo2.nome}):</span>
                    <span className="font-mono font-bold">R$ {results.ativo2[results.ativo2.length - 1].toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>(Após IR de R$ {results.impostoAtivo2.toLocaleString('pt-BR')})</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-lg">Vantagem Final:</span>
                    <div className="text-right">
                      {(() => {
                        const diferenca = results.ativo1[results.ativo1.length - 1] - results.ativo2[results.ativo2.length - 1];
                        const melhorOpcao = diferenca >= 0 ? ativo1.nome : ativo2.nome;
                        return (
                          <div>
                            <span className={`font-mono font-bold text-lg ${diferenca >= 0 ? 'text-financial-success' : 'text-financial-danger'}`}>
                              R$ {Math.abs(diferenca).toLocaleString('pt-BR')}
                            </span>
                            <div className="text-sm font-medium">a favor de <span className="font-bold">{melhorOpcao}</span></div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="mt-4 p-4 bg-gradient-to-r from-financial-primary/10 to-financial-secondary/10 rounded-lg">
                    <span className="font-bold">Conclusão:</span>
                    <span className="ml-2">
                      {(() => {
                        const diferenca = results.ativo1[results.ativo1.length - 1] - results.ativo2[results.ativo2.length - 1];
                        return diferenca >= 0
                          ? `O ${ativo1.nome} é projetado para ser financeiramente superior neste horizonte de investimento.`
                          : `O ${ativo2.nome} oferece um retorno líquido potencialmente maior neste horizonte de investimento.`;
                      })()}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Coupon Details Section - New Cash Flow System */}
            {(results.couponDetails?.ativo1?.length || results.couponDetails?.ativo2?.length) && (
              <Card className="border-blue-500/30 shadow-xl">
                <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Detalhamento dos Cupons e Reinvestimentos
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    
                    {/* Ativo 1 Coupons */}
                    {results.couponDetails?.ativo1?.length > 0 && (
                      <div>
                        <h4 className="font-bold text-lg mb-3 text-financial-primary">
                          {ativo1.nome} - Fluxo de Cupons
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-sm">
                            <thead>
                              <tr className="bg-financial-primary/10">
                                <th className="p-2 text-left border text-xs">Data Pagto</th>
                                <th className="p-2 text-right border text-xs">Cupom Bruto</th>
                                <th className="p-2 text-right border text-xs">Cupom Líq.</th>
                                <th className="p-2 text-right border text-xs">Fator CDI</th>
                                <th className="p-2 text-right border text-xs">Reinvestido</th>
                              </tr>
                            </thead>
                            <tbody>
                              {results.couponDetails.ativo1.map((coupon, index) => (
                                <tr key={index} className="even:bg-muted/50">
                                  <td className="p-2 border text-xs">
                                    {new Date(coupon.couponDate).toLocaleDateString('pt-BR')}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs">
                                    R$ {coupon.gross.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs text-financial-success">
                                    R$ {coupon.net.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs">
                                    {coupon.reinvestFactor.toFixed(4)}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs font-bold text-blue-600">
                                    R$ {coupon.reinvested.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              ))}
                              <tr className="bg-financial-primary/20 font-bold">
                                <td className="p-2 border text-xs">TOTAL</td>
                                <td className="p-2 border text-right font-mono text-xs">
                                  R$ {results.couponDetails.ativo1.reduce((sum, c) => sum + c.gross, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </td>
                                <td className="p-2 border text-right font-mono text-xs">
                                  R$ {results.couponDetails.ativo1.reduce((sum, c) => sum + c.net, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </td>
                                <td className="p-2 border text-right font-mono text-xs">-</td>
                                <td className="p-2 border text-right font-mono text-xs">
                                  R$ {results.couponDetails.ativo1.reduce((sum, c) => sum + c.reinvested, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    
                    {/* Ativo 2 Coupons */}
                    {results.couponDetails?.ativo2?.length > 0 && (
                      <div>
                        <h4 className="font-bold text-lg mb-3 text-financial-secondary">
                          {ativo2.nome} - Fluxo de Cupons
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-sm">
                            <thead>
                              <tr className="bg-financial-secondary/10">
                                <th className="p-2 text-left border text-xs">Data Pagto</th>
                                <th className="p-2 text-right border text-xs">Cupom Bruto</th>
                                <th className="p-2 text-right border text-xs">Cupom Líq.</th>
                                <th className="p-2 text-right border text-xs">Fator CDI</th>
                                <th className="p-2 text-right border text-xs">Reinvestido</th>
                              </tr>
                            </thead>
                            <tbody>
                              {results.couponDetails.ativo2.map((coupon, index) => (
                                <tr key={index} className="even:bg-muted/50">
                                  <td className="p-2 border text-xs">
                                    {new Date(coupon.couponDate).toLocaleDateString('pt-BR')}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs">
                                    R$ {coupon.gross.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs text-financial-success">
                                    R$ {coupon.net.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs">
                                    {coupon.reinvestFactor.toFixed(4)}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs font-bold text-blue-600">
                                    R$ {coupon.reinvested.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              ))}
                              <tr className="bg-financial-secondary/20 font-bold">
                                <td className="p-2 border text-xs">TOTAL</td>
                                <td className="p-2 border text-right font-mono text-xs">
                                  R$ {results.couponDetails.ativo2.reduce((sum, c) => sum + c.gross, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </td>
                                <td className="p-2 border text-right font-mono text-xs">
                                  R$ {results.couponDetails.ativo2.reduce((sum, c) => sum + c.net, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </td>
                                <td className="p-2 border text-right font-mono text-xs">-</td>
                                <td className="p-2 border text-right font-mono text-xs">
                                  R$ {results.couponDetails.ativo2.reduce((sum, c) => sum + c.reinvested, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-sm text-blue-800">
                      <strong>Sistema de Fluxo de Caixa:</strong> Os cupons são calculados com IR regressivo baseado no tempo de aplicação 
                      e reinvestidos pela curva CDI projetada do momento do pagamento até o vencimento. Otimizado para títulos diretos.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default InvestmentComparator;