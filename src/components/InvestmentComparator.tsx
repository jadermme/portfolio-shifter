import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Calculator, Trash2, Printer, TrendingUp, BarChart3, ArrowRight, AlertTriangle } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { CouponManager } from './CouponManager';
import { CouponSummary } from '@/types/coupon';

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
  couponData: CouponSummary;
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
  activePeriods?: {
    year: number;
    months: number[];
  }[]; // Specific months when asset generates earnings
}
interface Projecoes {
  cdi: {
    [key: number]: number;
  };
  ipca: {
    [key: number]: number;
  };
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
const irAliquotaRegressivo = (dias: number) => dias <= 180 ? 0.225 : dias <= 360 ? 0.20 : dias <= 720 ? 0.175 : 0.15;
const aaToMonthly = (aaPct: number) => Math.pow(1 + aaPct / 100, 1 / 12) - 1;
const aaToDaily252 = (aaPct: number) => Math.pow(1 + aaPct / 100, 1 / 252) - 1;
function monthlyRateFromCDI(cdiAA: number, use252: boolean, duPerMonth = 21) {
  if (use252) return Math.pow(1 + aaToDaily252(cdiAA), duPerMonth) - 1;
  return aaToMonthly(cdiAA);
}
function rateOfAssetForPeriod(kind: RateKind, p: {
  taxaPreAA?: number;
  taxaRealAA?: number;
  ipcaAA?: number;
  percCDI?: number;
  cdiAA?: number;
  spreadPreAA?: number;
  use252?: boolean;
}, monthlyIndex?: number): number {
  const {
    taxaPreAA = 0,
    taxaRealAA = 0,
    ipcaAA = 0,
    percCDI = 0,
    cdiAA = 0,
    spreadPreAA = 0,
    use252 = false
  } = p;
  switch (kind) {
    case "PRE":
      return aaToMonthly(taxaPreAA);
    case "IPCA+PRE":
      return (1 + aaToMonthly(taxaRealAA)) * (1 + aaToMonthly(ipcaAA)) - 1;
    case "%CDI":
      return monthlyRateFromCDI(cdiAA, use252) * (percCDI / 100);
    case "CDI+PRE":
      return monthlyRateFromCDI(cdiAA, use252) + aaToMonthly(spreadPreAA);
  }
}
function addMonths(dateISO: string, n: number) {
  const d = new Date(dateISO);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(aISO: string, bISO: string) {
  const a = new Date(aISO).getTime(),
    b = new Date(bISO).getTime();
  return Math.max(0, Math.floor((b - a) / (1000 * 60 * 60 * 24)));
}
function genCouponDates(startISO: string, endISO: string, freq: Freq, earningsStartDate?: string): string[] {
  const step = freq === "MONTHLY" ? 1 : 6;
  const out: string[] = [];

  // Use earnings start date if provided, otherwise use start date
  if (earningsStartDate) {
    console.log(`📅 Usando data de início dos rendimentos: ${earningsStartDate}`);
    
    // Special handling for CRA ZAMP - cupons em fevereiro e agosto
    if (earningsStartDate === '2025-09-01') {
      console.log(`📅 CRA ZAMP: Gerando cupons para fev/ago, excluindo agosto de 2025 (já pago)`);
      
      // Start from February 2026 (next coupon after September 2025)
      let currentYear = 2026;
      const endYear = new Date(endISO).getFullYear();
      
      while (currentYear <= endYear) {
        // February coupon
        const febDate = `${currentYear}-02-15`;
        if (new Date(febDate) <= new Date(endISO)) {
          console.log(`📅 Data de cupom gerada: ${febDate}`);
          out.push(febDate);
        }
        
        // August coupon
        const augDate = `${currentYear}-08-15`;
        if (new Date(augDate) <= new Date(endISO)) {
          console.log(`📅 Data de cupom gerada: ${augDate}`);
          out.push(augDate);
        }
        
        currentYear++;
      }
    } else {
      // Standard logic for other assets
      let d = earningsStartDate;
      while (new Date(d) <= new Date(endISO)) {
        console.log(`📅 Data de cupom gerada: ${d}`);
        out.push(d);
        d = addMonths(d, step);
      }
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
function cdiFactor(curve: CDIPoint[], fromISO: string, toISO: string, use252 = false): number {
  if (new Date(fromISO) >= new Date(toISO)) return 1;
  let factor = 1;
  let cursor = new Date(fromISO);
  cursor.setDate(1); // normaliza para início do mês
  const to = new Date(toISO);
  to.setDate(1);
  while (cursor <= to) {
    // acha o ponto CDI do mês de 'cursor'
    const key = cursor.toISOString().slice(0, 7); // YYYY-MM
    const pt = curve.find(p => p.date.slice(0, 7) === key) ?? curve[curve.length - 1];
    const rm = monthlyRateFromCDI(pt.cdiAA, use252);
    factor *= 1 + rm;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return factor;
}

// Get CDI rate for a specific month from curve
function getCDIRateForMonth(curve: CDIPoint[], dateISO: string): number {
  const key = dateISO.slice(0, 7); // YYYY-MM
  const pt = curve.find(p => p.date.slice(0, 7) === key);
  return pt ? pt.cdiAA : curve[curve.length - 1]?.cdiAA || 10;
}
function projectWithReinvestCDI(x: CouponEngineInput, isLimitedAnalysis = false) {
  // No administrative fees for direct securities
  const couponDates = genCouponDates(x.startISO, x.endISO, x.freq, x.earningsStartDate);
  const coupons: CouponResult[] = [];
  let basePrincipal = x.principal;

  // percorre cada período
  let last = x.startISO;
  for (const dt of couponDates) {
    const months = x.freq === "MONTHLY" ? 1 : 6;

    // Get CDI rate specific for this coupon period
    const couponMonth = dt.slice(0, 7); // YYYY-MM
    const cdiAA = getCDIRateForMonth(x.cdiCurve, dt);
    const rAssetMonthly = rateOfAssetForPeriod(x.rateKind, {
      taxaPreAA: x.taxaPreAA,
      taxaRealAA: x.taxaRealAA,
      ipcaAA: x.ipcaCurve?.[0]?.ipcaAA ?? 0,
      percCDI: x.percCDI,
      cdiAA,
      spreadPreAA: x.spreadPreAA,
      use252: false
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

  // Calculate principal value at end date
  let principalGrossFinal: number;
  
  if (isLimitedAnalysis && coupons.length > 0) {
    // When analyzing until a date before natural maturity, capitalize principal
    // from last coupon date to end date using asset's rate
    const lastCouponDate = coupons[coupons.length - 1].couponDate;
    const daysFromLastCoupon = daysBetween(lastCouponDate, x.endISO);
    
    console.log(`🔄 CAPITALIZAÇÃO DO PRINCIPAL:`);
    console.log(`📅 Último Cupom: ${lastCouponDate}`);
    console.log(`📅 Data Final: ${x.endISO}`);
    console.log(`📊 Dias para Capitalizar: ${daysFromLastCoupon}`);
    console.log(`💰 Principal Base: R$ ${x.principal.toLocaleString('pt-BR')}`);
    
    if (daysFromLastCoupon > 0) {
      // Get asset rate for capitalization period
      const cdiAA = getCDIRateForMonth(x.cdiCurve, x.endISO);
      const rAssetAA = rateOfAssetForPeriod(x.rateKind, {
        taxaPreAA: x.taxaPreAA,
        taxaRealAA: x.taxaRealAA,
        ipcaAA: x.ipcaCurve?.[0]?.ipcaAA ?? 0,
        percCDI: x.percCDI,
        cdiAA,
        spreadPreAA: x.spreadPreAA,
        use252: false
      });
      
      // Capitalize from last coupon to end date
      const capitalizationFactor = Math.pow(1 + rAssetAA, daysFromLastCoupon / 365);
      principalGrossFinal = basePrincipal * capitalizationFactor;
      
      console.log(`📈 Taxa do Ativo: ${(rAssetAA * 100).toFixed(4)}% a.a.`);
      console.log(`🔢 Fator Capitalização: ${capitalizationFactor.toFixed(6)}`);
      console.log(`💵 Principal Capitalizado: R$ ${principalGrossFinal.toLocaleString('pt-BR')}`);
      console.log(`💲 Aumento: R$ ${(principalGrossFinal - x.principal).toLocaleString('pt-BR')}`);
    } else {
      principalGrossFinal = basePrincipal;
    }
  } else {
    // Normal case: redemption at par
    principalGrossFinal = basePrincipal;
    console.log(`🏦 Resgate ao Par: R$ ${principalGrossFinal.toLocaleString('pt-BR')}`);
  }

  const diasTotal = daysBetween(x.startISO, x.endISO);
  const aliqFinal = x.irRegressivo !== false ? irAliquotaRegressivo(diasTotal) : 0;
  const gainPrincipal = Math.max(0, principalGrossFinal - x.principal);
  const irPrincipal = gainPrincipal * aliqFinal;
  const principalNetFinal = principalGrossFinal - irPrincipal;
  const totalCouponsReinvested = coupons.reduce((s, c) => s + c.reinvested, 0);
  const totalVF = principalNetFinal + totalCouponsReinvested;
  
  console.log(`💰 BREAKDOWN FINAL:`);
  console.log(`🔹 Principal Bruto Final: R$ ${principalGrossFinal.toLocaleString('pt-BR')}`);
  console.log(`🔹 IR sobre Ganho Principal: R$ ${irPrincipal.toLocaleString('pt-BR')}`);
  console.log(`🔹 Principal Líquido: R$ ${principalNetFinal.toLocaleString('pt-BR')}`);
  console.log(`🔹 Cupons Reinvestidos: R$ ${totalCouponsReinvested.toLocaleString('pt-BR')}`);
  console.log(`🏆 VALOR FINAL TOTAL: R$ ${totalVF.toLocaleString('pt-BR')}`);
  console.log(`===============================================`);
  
  return {
    coupons,
    principalNetFinal,
    totalVF
  };
}

// ===================== LEGACY COMPATIBILITY MAPPING =====================
function mapLegacyToNewFormat(asset: AssetData): RateKind {
  switch (asset.tipoTaxa) {
    case 'pre-fixada':
      return 'PRE';
    case 'percentual-cdi':
      return '%CDI';
    case 'cdi-mais':
      return 'CDI+PRE';
    case 'ipca-mais':
      return 'IPCA+PRE';
    default:
      return 'PRE';
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
      curve.push({
        date,
        cdiAA
      });
    }
  }
  return curve;
}
// ===================== PERSISTENCE FUNCTIONS =====================
const STORAGE_KEYS = {
  ativo1: 'investment_comparator_ativo1',
  ativo2: 'investment_comparator_ativo2',
  projecoes: 'investment_comparator_projecoes',
  timestamp: 'investment_comparator_timestamp'
};

const saveToLocalStorage = (key: string, data: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(STORAGE_KEYS.timestamp, Date.now().toString());
  } catch (error) {
    console.error('Erro ao salvar no localStorage:', error);
  }
};

const loadFromLocalStorage = (key: string, defaultValue: any) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultValue;
  } catch (error) {
    console.error('Erro ao carregar do localStorage:', error);
    return defaultValue;
  }
};

const clearFromLocalStorage = (key: string) => {
  try {
    localStorage.removeItem(key);
    localStorage.setItem(STORAGE_KEYS.timestamp, Date.now().toString());
  } catch (error) {
    console.error('Erro ao limpar localStorage:', error);
  }
};

// ===================== DEFAULT STATE VALUES =====================
const getDefaultAtivo1 = (): AssetData => ({
  nome: '',
  codigo: '',
  tipoTaxa: 'pre-fixada',
  taxa: 0,
  vencimento: '',
  valorInvestido: 0,
  couponData: { coupons: [], total: 0 },
  valorCurva: 0,
  valorVenda: 0,
  tipoCupom: 'nenhum',
  mesesCupons: '',
  tipoIR: 'renda-fixa',
  aliquotaIR: 15,
  rateKind: 'PRE',
  freq: 'SEMIANNUAL',
  earningsStartDate: '',
  activePeriods: []
});

const getDefaultAtivo2 = (): AssetData => ({
  nome: '',
  codigo: '',
  tipoTaxa: 'percentual-cdi',
  taxa: 0,
  vencimento: '',
  valorInvestido: 0,
  couponData: { coupons: [], total: 0 },
  valorCurva: 0,
  tipoCupom: 'nenhum',
  mesesCupons: '',
  tipoIR: 'renda-fixa',
  aliquotaIR: 15,
  rateKind: 'PRE',
  freq: 'SEMIANNUAL',
  earningsStartDate: '',
  activePeriods: []
});

const getDefaultProjecoes = (): Projecoes => ({
  cdi: {
    2025: 15,
    2026: 12.50,
    2027: 11.70,
    2028: 10.50,
    2029: 10,
    2030: 10
  },
  ipca: {
    2025: 4.2,
    2026: 3.8,
    2027: 3.5,
    2028: 3.25,
    2029: 3.00,
    2030: 3.00
  }
});

const InvestmentComparator = () => {
  const { toast } = useToast();
  const [ativo1, setAtivo1] = useState<AssetData>(() => 
    loadFromLocalStorage(STORAGE_KEYS.ativo1, getDefaultAtivo1())
  );
  const [ativo2, setAtivo2] = useState<AssetData>(() => 
    loadFromLocalStorage(STORAGE_KEYS.ativo2, getDefaultAtivo2())
  );
  const [projecoes, setProjecoes] = useState<Projecoes>(() => 
    loadFromLocalStorage(STORAGE_KEYS.projecoes, getDefaultProjecoes())
  );
  const [results, setResults] = useState<CalculationResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastCalculationHash, setLastCalculationHash] = useState<string>('');
  const [calculationTimestamp, setCalculationTimestamp] = useState<number>(0);

  // Function to invalidate results when data changes
  const invalidateResults = () => {
    console.log('⚠️ Invalidando resultados - dados foram alterados');
    setHasUnsavedChanges(true);
    if (results) {
      console.log('🚫 Escondendo resultados existentes');
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

  // ===================== AUTO-SAVE FUNCTIONALITY =====================
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveToLocalStorage(STORAGE_KEYS.ativo1, ativo1);
    }, 500); // Debounce 500ms

    return () => clearTimeout(timeoutId);
  }, [ativo1]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveToLocalStorage(STORAGE_KEYS.ativo2, ativo2);
    }, 500); // Debounce 500ms

    return () => clearTimeout(timeoutId);
  }, [ativo2]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveToLocalStorage(STORAGE_KEYS.projecoes, projecoes);
    }, 500); // Debounce 500ms

    return () => clearTimeout(timeoutId);
  }, [projecoes]);

  // ===================== RESET FUNCTIONS =====================
  const resetAtivo1 = () => {
    const defaultAtivo1 = getDefaultAtivo1();
    setAtivo1(defaultAtivo1);
    clearFromLocalStorage(STORAGE_KEYS.ativo1);
    invalidateResults();
    toast({
      title: "Dados limpos",
      description: "Todos os dados do Ativo 1 foram removidos.",
      variant: "default",
    });
  };

  const resetAtivo2 = () => {
    const defaultAtivo2 = getDefaultAtivo2();
    setAtivo2(defaultAtivo2);
    clearFromLocalStorage(STORAGE_KEYS.ativo2);
    invalidateResults();
    toast({
      title: "Dados limpos",
      description: "Todos os dados do Ativo 2 foram removidos.",
      variant: "default",
    });
  };
  const handleAssetChange = (asset: 'ativo1' | 'ativo2', field: keyof AssetData, value: string | number | boolean | CouponSummary) => {
    if (asset === 'ativo1') {
      setAtivo1(prev => ({
        ...prev,
        [field]: value
      }));
      // Se mudou o valor de venda do ativo1, atualiza o valor investido do ativo2
      if (field === 'valorVenda') {
        setAtivo2(prev => ({
          ...prev,
          valorInvestido: Number(value),
          valorCurva: Number(value),
          // Para aplicação nova, valor de curva = valor investido
          couponData: { 
            coupons: [], 
            total: 0 // Aplicação nova não tem cupons recebidos
          }
        }));
      }
    } else {
      // Para ativo2, valor de curva sempre igual ao valor investido e cupons sempre zero (aplicação nova)
      if (field === 'valorInvestido') {
        setAtivo2(prev => ({
          ...prev,
          valorInvestido: Number(value),
          valorCurva: Number(value),
          couponData: { coupons: [], total: 0 }
        }));
      } else if (field !== 'couponData' && field !== 'valorCurva') {
        // Impede alteração de couponData e valorCurva
        setAtivo2(prev => ({
          ...prev,
          [field]: value
        }));
      }
    }

    // Invalidate results whenever asset data changes
    invalidateResults();
  };
  const handleProjecaoChange = (tipo: 'cdi' | 'ipca', ano: number, valor: number) => {
    console.log(`📈 Alterando projeção ${tipo.toUpperCase()} para ${ano}: ${valor}%`);
    
    setProjecoes(prev => ({
      ...prev,
      [tipo]: {
        ...prev[tipo],
        [ano]: valor
      }
    }));

    // Invalidate results whenever projections change
    invalidateResults();
    
    console.log('🔄 Resultados invalidados após mudança de projeção');
    
    // Show immediate feedback to user
    toast({
      title: "Projeção atualizada",
      description: `${tipo.toUpperCase()} ${ano} alterado para ${valor}%. Recalcule para ver os novos resultados.`,
    });
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
        return 22.5;
      // Até 6 meses: 22,5%
      default:
        return dados.aliquotaIR;
    }
  };
  const calcularTaxaReal = (dados: AssetData, ano: number): number => {
    const anoKey = new Date().getFullYear() + (ano - 1);

    console.log(`🎯 Calculando taxa real para ${dados.nome} - Ano: ${anoKey}, Taxa base: ${dados.taxa}%`);
    
    // Removed earningsStartDate check that was zeroing rates
    switch (dados.tipoTaxa) {
      case 'pre-fixada':
        const taxaPre = dados.taxa / 100;
        console.log(`💰 Taxa pré-fixada: ${taxaPre * 100}%`);
        return taxaPre;
      case 'percentual-cdi':
        const cdiAno = (projecoes.cdi[anoKey] || projecoes.cdi[Object.keys(projecoes.cdi).pop() as any]) / 100;
        const taxaPctCdi = cdiAno * (dados.taxa / 100);
        console.log(`💰 Taxa % CDI: ${taxaPctCdi * 100}% (CDI: ${cdiAno * 100}% × ${dados.taxa}%)`);
        return taxaPctCdi;
      case 'cdi-mais':
        const cdiBase = (projecoes.cdi[anoKey] || projecoes.cdi[Object.keys(projecoes.cdi).pop() as any]) / 100;
        const taxaCdiMais = cdiBase + dados.taxa / 100;
        console.log(`💰 Taxa CDI+: ${taxaCdiMais * 100}% (CDI: ${cdiBase * 100}% + ${dados.taxa}%)`);
        return taxaCdiMais;
      case 'ipca-mais':
        const ipcaAno = (projecoes.ipca[anoKey] || projecoes.ipca[Object.keys(projecoes.ipca).pop() as any]) / 100;
        const taxaIpcaMais = ipcaAno + dados.taxa / 100;
        console.log(`💰 Taxa IPCA+: ${taxaIpcaMais * 100}% (IPCA: ${ipcaAno * 100}% + ${dados.taxa}%)`);
        return taxaIpcaMais;
      default:
        const taxaDefault = dados.taxa / 100;
        console.log(`💰 Taxa default: ${taxaDefault * 100}%`);
        return taxaDefault;
    }
  };
  const calcularAtivo = (dados: AssetData, anosProjecao: number, vencimentoReal?: number): {
    valores: number[];
    imposto: number;
    couponDetails?: CouponResult[];
  } => {
    const periodosAtivo = vencimentoReal || anosProjecao;

    // Always use cash flow system when asset has coupons
    if (dados.tipoCupom !== 'nenhum') {
      // For Asset 1, when it has longer maturity than Asset 2, limit calculation to Asset 2's maturity
      const dataLimite = dados === ativo1 && new Date(ativo2.vencimento) < new Date(dados.vencimento) 
        ? ativo2.vencimento 
        : undefined;
      return calcularAtivoComFluxoCaixa(dados, periodosAtivo, dataLimite);
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
        // Usar valor de curva como base para cálculo dos cupons
        const taxaBaseCupom = calcularTaxaReal(dados, 1);
        cupomAnoAtual = dados.valorCurva * taxaBaseCupom;
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
    return {
      valores,
      imposto: Math.round(imposto)
    };
  };

  // New cash flow calculation method
  const calcularAtivoComFluxoCaixa = (dados: AssetData, anosProjecao: number, dataLimite?: string): {
    valores: number[];
    imposto: number;
    couponDetails: CouponResult[];
  } => {
    const hoje = new Date();
    const startISO = hoje.toISOString().slice(0, 10);
    // Use dataLimite when provided, otherwise use asset's original maturity
    const endDate = dataLimite ? new Date(dataLimite) : new Date(dados.vencimento);
    const endISO = endDate.toISOString().slice(0, 10);
    
    console.log(`🔍 Calculando ${dados.nome}:`);
    console.log(`📊 Valor de Curva (Principal): R$ ${dados.valorCurva.toLocaleString('pt-BR')}`);
    console.log(`📅 Data Limite: ${dataLimite || 'Sem limite (vencimento natural)'}`);
    console.log(`🎯 Data Final Análise: ${endISO}`);

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
      feesAA: 0,
      // Removed - not applicable for direct securities
      irRegressivo: dados.tipoIR === 'renda-fixa',
      use252: false,
      // Removed - not applicable for direct securities
      earningsStartDate: dados.earningsStartDate // Add earnings start date
    };

    // Calculate cash flows
    // Check if this is a limited analysis (ending before asset's natural maturity)
    const isLimitedAnalysis = dataLimite && new Date(dataLimite) < new Date(dados.vencimento);
    console.log(`⚖️ Análise Limitada: ${isLimitedAnalysis ? 'SIM' : 'NÃO'}`);
    console.log(`💰 Taxa: ${dados.taxa}% a.a. (${rateKind})`);
    
    const result = projectWithReinvestCDI(cashFlowInput, isLimitedAnalysis);

    // Build annual values array for compatibility
    const valores = [Math.round(dados.valorCurva)];
    const valorPorAno = result.totalVF / anosProjecao;
    for (let ano = 1; ano <= anosProjecao; ano++) {
      const valorProjetado = dados.valorCurva + valorPorAno * ano;
      valores.push(Math.round(valorProjetado));
    }

    // Final value adjustment
    valores[valores.length - 1] = Math.round(result.totalVF);

    // Calculate total IR from coupons and principal
    const totalIR = result.coupons.reduce((sum, c) => sum + (c.gross - c.net), 0) + Math.max(0, result.principalNetFinal - dados.valorCurva) * (dados.tipoIR === 'renda-fixa' ? irAliquotaRegressivo(daysBetween(startISO, endISO)) : 0);
    return {
      valores,
      imposto: Math.round(totalIR),
      couponDetails: result.coupons
    };
  };
  const calcularReinvestimento = (valorInicial: number, periodosReinvestimento: number, anoInicial: number): {
    valores: number[];
    imposto: number;
  } => {
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
    const aliquotaReinvestimento = periodosReinvestimento >= 2 ? 15 : periodosReinvestimento >= 1 ? 17.5 : periodosReinvestimento >= 0.5 ? 20 : 22.5;
    const impostoReinvestimento = lucroReinvestimento > 0 ? lucroReinvestimento * (aliquotaReinvestimento / 100) : 0;

    // Ajustar valor final para líquido de IR
    if (valores.length > 0) {
      valores[valores.length - 1] = Math.round(valorAtual - impostoReinvestimento);
    }
    return {
      valores,
      imposto: Math.round(impostoReinvestimento)
    };
  };

  // Validation function to check if data is complete
  const validateDataForCalculation = (): {
    isValid: boolean;
    errors: string[];
  } => {
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

    // Validate projections cover necessary years - usar apenas o menor prazo
    const minYear = Math.min(venc1.getFullYear(), venc2.getFullYear());
    const currentYear = hoje.getFullYear();
    for (let year = currentYear; year <= minYear; year++) {
      if (!projecoes.cdi[year]) errors.push(`Projeção CDI para ${year} é necessária`);
      if (!projecoes.ipca[year]) errors.push(`Projeção IPCA para ${year} é necessária`);
    }
    return {
      isValid: errors.length === 0,
      errors
    };
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
      // Usar sempre o menor prazo entre os ativos para comparação
      const menorPrazo = Math.min(anosAtivo1, anosAtivo2);
      
      let resultAtivo1, resultAtivo2, reinvestimentoInfo;
      if (anosAtivo1 < anosAtivo2) {
        // Ativo 1 vence antes do Ativo 2 - comparar até o vencimento do Ativo 1 (menor prazo)
        resultAtivo1 = calcularAtivo(ativo1, menorPrazo, menorPrazo);
        resultAtivo2 = calcularAtivo(ativo2, menorPrazo, menorPrazo);
      } else if (anosAtivo2 < anosAtivo1) {
        // Ativo 2 vence antes do Ativo 1 - comparar até o vencimento do Ativo 2 (menor prazo)
        resultAtivo1 = calcularAtivo(ativo1, menorPrazo, menorPrazo);
        resultAtivo2 = calcularAtivo(ativo2, menorPrazo, menorPrazo);
      } else {
        // Ambos vencem na mesma data
        resultAtivo1 = calcularAtivo(ativo1, anosAtivo1, anosAtivo1);
        resultAtivo2 = calcularAtivo(ativo2, anosAtivo2, anosAtivo2);
      }
      const anosProjecao = menorPrazo;
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
      couponData: { coupons: [], total: 0 },
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
      couponData: { coupons: [], total: 0 },
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


  // Enhanced function to calculate annual yields considering specific periods and accrual (LEGACY - kept for compatibility)
  const calcularRendimentosAnuais = (valores: number[], valorInicial: number, asset: AssetData) => {
    console.log('\n🔍 Calculando rendimentos anuais para:', asset.nome);
    console.log('📊 Valores recebidos:', valores);
    console.log('💰 Valor inicial:', valorInicial);
    console.log('📅 Períodos ativos:', asset.activePeriods);
    console.log('🎯 Data início rendimentos:', asset.earningsStartDate);
    const rendimentos: number[] = [];
    const anoAtual = new Date().getFullYear();
    
    for (let i = 0; i < valores.length; i++) {
      const anoRendimento = anoAtual + i;
      console.log(`\n📅 Processando ano ${anoRendimento} (índice ${i})`);

      if (anoRendimento === 2025) {
        // 2025: Calcular baseado nos períodos ativos específicos
        console.log('🎯 Processando ano 2025 - Períodos ativos específicos');
        
        if (asset.nome === 'CRA ZAMP') {
          // CRA ZAMP: 4 meses (set-dez) × 12,03% a.a.
          const mesesAtivos = 4; // setembro a dezembro
          const proporcao = mesesAtivos / 12;
          const taxaAnual = calcularTaxaReal(asset, 1); // Use year 1 rate for 2025
          const rendimentoProporcional = valorInicial * taxaAnual * proporcao;
          console.log(`💰 CRA ZAMP 2025: ${mesesAtivos} meses × ${taxaAnual * 100}% = R$ ${rendimentoProporcional.toLocaleString('pt-BR')}`);
          rendimentos.push(rendimentoProporcional);
        } else if (asset.nome === 'BTDI11') {
          // BTDI11: 2 meses (nov-dez) × taxa CDI+2.5%
          const mesesAtivos = 2; // novembro e dezembro
          const proporcao = mesesAtivos / 12;
          const taxaAnual = calcularTaxaReal(asset, 1); // Use year 1 rate for 2025
          const rendimentoProporcional = valorInicial * taxaAnual * proporcao;
          console.log(`💰 BTDI11 2025: ${mesesAtivos} meses × ${taxaAnual * 100}% = R$ ${rendimentoProporcional.toLocaleString('pt-BR')}`);
          rendimentos.push(rendimentoProporcional);
        } else {
          // Outros ativos: usar cálculo padrão
          if (i > 0) {
            const rendimentoAnual = valores[i] - valores[i - 1];
            rendimentos.push(rendimentoAnual);
          } else {
            const rendimentoTotal = valores[i] - valorInicial;
            rendimentos.push(rendimentoTotal);
          }
        }
      } else {
        // 2026 em diante: Usar taxas anuais completas
        console.log(`🎯 Processando ano ${anoRendimento} - Taxa anual completa`);
        
        if (asset.nome === 'CRA ZAMP') {
          // CRA ZAMP: 12,03% a.a. fixo até fev/2029, depois reaplicado a 100% CDI
          const taxaAnual = calcularTaxaReal(asset, i + 1);
          if (anoRendimento >= 2030) {
            // 2030: CRA ZAMP reaplicado a 100% CDI, calcular apenas 4 meses (jan-abr) para comparação justa
            const mesesAtivos = 4; // janeiro a abril
            const proporcao = mesesAtivos / 12;
            const rendimentoProporcional = valorInicial * Math.pow(1 + taxaAnual, i - 1) * taxaAnual * proporcao;
            console.log(`💰 CRA ZAMP ${anoRendimento}: reaplicado a 100% CDI, ${mesesAtivos} meses × ${taxaAnual * 100}% = R$ ${rendimentoProporcional.toLocaleString('pt-BR')}`);
            rendimentos.push(rendimentoProporcional);
          } else {
            console.log(`💰 CRA ZAMP ${anoRendimento}: ${taxaAnual * 100}% a.a. (pré-fixado)`);
            const rendimentoAnual = valorInicial * Math.pow(1 + taxaAnual, i) * taxaAnual;
            rendimentos.push(rendimentoAnual);
          }
        } else if (asset.nome === 'BTDI11') {
          // BTDI11: CDI projetado + 2.5% (deve ser ~15.8% em 2026)
          // Em 2030, calcular apenas 4 meses (jan-abr) até vencimento em abril
          const taxaAnual = calcularTaxaReal(asset, i + 1);
          if (anoRendimento === 2030) {
            const mesesAtivos = 4; // janeiro a abril
            const proporcao = mesesAtivos / 12;
            const rendimentoProporcional = valorInicial * Math.pow(1 + taxaAnual, i - 1) * taxaAnual * proporcao;
            console.log(`💰 BTDI11 ${anoRendimento}: ${mesesAtivos} meses × ${taxaAnual * 100}% = R$ ${rendimentoProporcional.toLocaleString('pt-BR')}`);
            rendimentos.push(rendimentoProporcional);
          } else {
            const rendimentoAnual = valorInicial * Math.pow(1 + taxaAnual, i) * taxaAnual;
            console.log(`💰 BTDI11 ${anoRendimento}: ${taxaAnual * 100}% a.a. (CDI+2.5%) = R$ ${rendimentoAnual.toLocaleString('pt-BR')}`);
            rendimentos.push(rendimentoAnual);
          }
        } else {
          // Outros ativos: usar diferença dos valores
          if (i > 0) {
            const rendimentoAnual = valores[i] - valores[i - 1];
            rendimentos.push(rendimentoAnual);
          } else {
            const rendimentoTotal = valores[i] - valorInicial;
            rendimentos.push(rendimentoTotal);
          }
        }
      }
    }

    console.log(`✅ Rendimentos calculados para ${asset.nome}:`, rendimentos);
    return rendimentos;
  };

  // Legacy code for compatibility (removed active periods logic)
  const calcularRendimentosAnuaisLegacy = (valores: number[], valorInicial: number, asset: AssetData) => {
    const rendimentos: number[] = [];
    const anoAtual = new Date().getFullYear();
    for (let i = 0; i < valores.length; i++) {
      const anoRendimento = anoAtual + i;

      // Check if asset has defined active periods
      if (asset.activePeriods) {
        const periodForYear = asset.activePeriods.find(p => p.year === anoRendimento);
        if (periodForYear) {
          // Calculate proportional yield based on active months
          const mesesAtivos = periodForYear.months.length;
          const proporcao = mesesAtivos / 12;
          if (asset.earningsStartDate) {
            // BTDI11: earnings start from specific date
            const startDate = new Date(asset.earningsStartDate);
            const yearStart = new Date(anoRendimento, 0, 1);
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
      case 'pre-fixada':
        return 'Taxa Anual (%)';
      case 'percentual-cdi':
        return '% do CDI';
      case 'cdi-mais':
        return 'Taxa + CDI (%)';
      case 'ipca-mais':
        return 'Taxa + IPCA (%)';
      default:
        return 'Taxa (%)';
    }
  };
  const getTaxaPlaceholder = (tipoTaxa: string) => {
    switch (tipoTaxa) {
      case 'pre-fixada':
        return '12.03';
      case 'percentual-cdi':
        return '102.5';
      case 'cdi-mais':
        return '2.5';
      case 'ipca-mais':
        return '5.0';
      default:
        return '12.03';
    }
  };
  const getTaxaDisplay = (asset: AssetData) => {
    switch (asset.tipoTaxa) {
      case 'pre-fixada':
        return `${asset.taxa.toFixed(2)}% a.a.`;
      case 'percentual-cdi':
        return `${asset.taxa.toFixed(2)}% do CDI`;
      case 'cdi-mais':
        return `CDI + ${asset.taxa.toFixed(2)}%`;
      case 'ipca-mais':
        return `IPCA + ${asset.taxa.toFixed(2)}%`;
      default:
        return `${asset.taxa.toFixed(2)}%`;
    }
  };
  const getTipoTaxaDisplay = (tipoTaxa: string) => {
    switch (tipoTaxa) {
      case 'pre-fixada':
        return 'Pré-fixada';
      case 'percentual-cdi':
        return '% CDI';
      case 'cdi-mais':
        return 'CDI + Taxa';
      case 'ipca-mais':
        return 'IPCA + Taxa';
      default:
        return tipoTaxa;
    }
  };
  const getIRDisplay = (asset: AssetData, anosProjecao: number) => {
    switch (asset.tipoIR) {
      case 'isento':
        return 'Isento';
      case 'fixo-15':
        return '15%';
      case 'renda-fixa':
        return `${calcularAliquotaIR(asset, anosProjecao)}% (Tabela)`;
      default:
        return `${asset.aliquotaIR}%`;
    }
  };
  const renderAssetForm = (asset: AssetData, assetKey: 'ativo1' | 'ativo2', title: string, color: string) => <Card className={`border-${color}/20 shadow-lg`}>
      <CardHeader className={`bg-gradient-to-r from-${color} to-financial-secondary text-white rounded-t-lg`}>
        <CardTitle className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {title}
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button 
                variant="destructive" 
                size="sm" 
                className="bg-red-600/20 hover:bg-red-600/40 text-white border-red-400/50"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Limpar {assetKey === 'ativo1' ? 'Ativo 1' : 'Ativo 2'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar Limpeza</AlertDialogTitle>
                <AlertDialogDescription>
                  Tem certeza que deseja limpar todos os dados do {assetKey === 'ativo1' ? 'Ativo 1' : 'Ativo 2'}? 
                  Esta ação não pode ser desfeita e removerá todos os campos preenchidos.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={assetKey === 'ativo1' ? resetAtivo1 : resetAtivo2}
                  className="bg-red-600 hover:bg-red-700"
                >
                  Confirmar Limpeza
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-nome`}>Nome do Ativo</Label>
            <Input id={`${assetKey}-nome`} value={asset.nome} onChange={e => handleAssetChange(assetKey, 'nome', e.target.value)} placeholder="Ex: CRA ZAMP" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-codigo`}>Código</Label>
            <Input id={`${assetKey}-codigo`} value={asset.codigo} onChange={e => handleAssetChange(assetKey, 'codigo', e.target.value)} placeholder="Ex: CRA024001Q9" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-tipoTaxa`}>Tipo de Taxa</Label>
            <Select value={asset.tipoTaxa} onValueChange={value => handleAssetChange(assetKey, 'tipoTaxa', value)}>
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
            <Input id={`${assetKey}-taxa`} type="number" step="0.01" value={asset.taxa} onChange={e => handleAssetChange(assetKey, 'taxa', parseFloat(e.target.value) || 0)} placeholder={getTaxaPlaceholder(asset.tipoTaxa)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-vencimento`}>Data Vencimento</Label>
            <Input id={`${assetKey}-vencimento`} type="date" value={asset.vencimento} onChange={e => handleAssetChange(assetKey, 'vencimento', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-valorInvestido`}>
              {assetKey === 'ativo2' ? 'Valor de Compra (R$) - Valor da Venda do Ativo 1' : 'Valor de Compra (R$)'}
            </Label>
            <Input id={`${assetKey}-valorInvestido`} type="number" step="0.01" value={asset.valorInvestido} onChange={e => handleAssetChange(assetKey, 'valorInvestido', parseFloat(e.target.value) || 0)} disabled={assetKey === 'ativo2'} className={assetKey === 'ativo2' ? 'bg-muted/50 cursor-not-allowed' : ''} />
          </div>
          {assetKey === 'ativo1' && <>
              <div className="space-y-2">
                <Label htmlFor={`${assetKey}-valorCurva`}>Valor de Curva (R$)</Label>
                <Input id={`${assetKey}-valorCurva`} type="number" step="0.01" value={asset.valorCurva} onChange={e => handleAssetChange(assetKey, 'valorCurva', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${assetKey}-valorVenda`}>Valor de Venda (R$)</Label>
                <Input id={`${assetKey}-valorVenda`} type="number" step="0.01" value={asset.valorVenda || 0} onChange={e => handleAssetChange(assetKey, 'valorVenda', parseFloat(e.target.value) || 0)} placeholder="Valor recebido na venda" />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${assetKey}-tipoCupom`}>Tipo de Cupom</Label>
                <Select value={asset.tipoCupom} onValueChange={value => handleAssetChange(assetKey, 'tipoCupom', value)}>
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
                {asset.tipoCupom === 'nenhum' ? <Input id={`${assetKey}-mesesCupons`} value="" disabled placeholder="Não aplicável" className="bg-muted/50 cursor-not-allowed" /> : asset.tipoCupom === 'semestral' ? <Select value={asset.mesesCupons} onValueChange={value => handleAssetChange(assetKey, 'mesesCupons', value)}>
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
                  </Select> : asset.tipoCupom === 'anual' ? <Select value={asset.mesesCupons} onValueChange={value => handleAssetChange(assetKey, 'mesesCupons', value)}>
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
                  </Select> :
              // Mensal - todos os meses
              <Input id={`${assetKey}-mesesCupons`} value="1,2,3,4,5,6,7,8,9,10,11,12" disabled className="bg-muted/50 cursor-not-allowed" placeholder="Todos os meses" />}
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${assetKey}-tipoIR`}>Tipo de Tributação</Label>
                <Select value={asset.tipoIR} onValueChange={value => handleAssetChange(assetKey, 'tipoIR', value)}>
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
              <div className="col-span-full">
                <CouponManager 
                  couponData={asset.couponData}
                  onChange={(couponData) => handleAssetChange(assetKey, 'couponData', couponData)}
                  assetKey={assetKey}
                />
              </div>
            </>}
          
          {/* Earnings Period Configuration - Only for Ativo 2 (new investment) */}
          {assetKey === 'ativo2' && (
            <div className="col-span-full">
              <div className="bg-muted/30 p-4 rounded-lg border border-dashed">
                <h4 className="text-sm font-medium mb-3">⚙️ Configurações Especiais</h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor={`${assetKey}-earningsStartDate`} className="text-sm">
                      📅 Data de Início dos Rendimentos
                    </Label>
                    <Input id={`${assetKey}-earningsStartDate`} type="date" value={asset.earningsStartDate || ''} onChange={e => handleAssetChange(assetKey, 'earningsStartDate', e.target.value)} placeholder="YYYY-MM-DD" className="text-sm" />
                    
                  </div>
                  
                </div>
              </div>
            </div>
          )}
          {assetKey === 'ativo2' && (
            <>
              <div className="space-y-2">
                <Label htmlFor={`${assetKey}-tipoCupom`}>Tipo de Cupom</Label>
                <Select value={asset.tipoCupom} onValueChange={value => handleAssetChange(assetKey, 'tipoCupom', value)}>
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
                {asset.tipoCupom === 'nenhum' ? <Input id={`${assetKey}-mesesCupons`} value="" disabled placeholder="Não aplicável" className="bg-muted/50 cursor-not-allowed" /> : asset.tipoCupom === 'semestral' ? <Select value={asset.mesesCupons} onValueChange={value => handleAssetChange(assetKey, 'mesesCupons', value)}>
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
                  </Select> : asset.tipoCupom === 'anual' ? <Select value={asset.mesesCupons} onValueChange={value => handleAssetChange(assetKey, 'mesesCupons', value)}>
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
                  </Select> :
              // Mensal - todos os meses
              <Input id={`${assetKey}-mesesCupons`} value="1,2,3,4,5,6,7,8,9,10,11,12" disabled className="bg-muted/50 cursor-not-allowed" placeholder="Todos os meses" />}
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${assetKey}-tipoIR`}>Tipo de Tributação</Label>
                <Select value={asset.tipoIR} onValueChange={value => handleAssetChange(assetKey, 'tipoIR', value)}>
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
            </>
          )}
        </div>
      </CardContent>
    </Card>;
  const anoAtual = new Date().getFullYear();
  return <div className="min-h-screen bg-background p-4">
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
        <div className="grid grid-cols-1 gap-6 mb-6">
          {renderAssetForm(ativo1, 'ativo1', `📊 ${ativo1.nome || 'Ativo 1'}`, 'financial-primary')}
          
          <div className="flex items-center justify-center xl:hidden">
            <div className="p-3 bg-gradient-to-r from-financial-primary to-financial-secondary rounded-full">
              <ArrowRight className="h-6 w-6 text-white rotate-90 xl:rotate-0" />
            </div>
          </div>
          
          {renderAssetForm(ativo2, 'ativo2', `📈 ${ativo2.nome || 'Ativo 2'}`, 'financial-secondary')}
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
                {Object.entries(projecoes.cdi).map(([year, value]) => <div key={year} className="space-y-2">
                    <Label htmlFor={`cdi${year}`}>{year}</Label>
                    <Input id={`cdi${year}`} type="number" step="0.1" value={value} onChange={e => handleProjecaoChange('cdi', parseInt(year), parseFloat(e.target.value) || 0)} />
                  </div>)}
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
                {Object.entries(projecoes.ipca).map(([year, value]) => <div key={year} className="space-y-2">
                    <Label htmlFor={`ipca${year}`}>{year}</Label>
                    <Input id={`ipca${year}`} type="number" step="0.1" value={value} onChange={e => handleProjecaoChange('ipca', parseInt(year), parseFloat(e.target.value) || 0)} />
                  </div>)}
              </div>
            </CardContent>
          </Card>
        </div>

         {/* Action Buttons */}
        <div className="flex flex-wrap justify-center gap-4 mb-8">
          <Button onClick={calcular} size="lg" className="bg-gradient-to-r from-financial-primary to-financial-secondary hover:from-financial-secondary hover:to-financial-primary text-white font-bold shadow-lg transform transition-all duration-300 hover:scale-105">
            <Calculator className="h-5 w-5 mr-2" />
            🔄 Calcular Comparação
            {hasUnsavedChanges && <span className="ml-2 text-yellow-300 animate-pulse">●</span>}
          </Button>
          <Button variant="outline" onClick={limparDados} size="lg" className="border-financial-danger text-financial-danger hover:bg-financial-danger hover:text-white">
            <Trash2 className="h-5 w-5 mr-2" />
            🗑️ Limpar Dados
          </Button>
          <Button variant="outline" onClick={() => window.print()} size="lg" className="border-financial-primary text-financial-primary hover:bg-financial-primary hover:text-white">
            <Printer className="h-5 w-5 mr-2" />
            🖨️ Gerar PDF
          </Button>
        </div>

        {/* Warning for unsaved changes */}
        {hasUnsavedChanges && <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
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
          </div>}

        {showResults && results && <div className="space-y-6">
            {/* Data freshness check */}
            {(() => {
              const currentHash = generateDataHash();
              const isDataFresh = currentHash === lastCalculationHash;
              console.log('🔍 Verificando freshness dos dados:', { currentHash, lastCalculationHash, isDataFresh });
              
              if (!isDataFresh) {
                console.log('⚠️ DADOS DESATUALIZADOS DETECTADOS! Forçando recálculo...');
                // Force hide results if data is stale
                setTimeout(() => {
                  setShowResults(false);
                  setResults(null);
                  setHasUnsavedChanges(true);
                }, 0);
                return null;
              }
              return null;
            })()}
            
            {/* Executive Summary - Restructured into Two Separate Tables */}
            <div className="space-y-6">
              {/* Table 1 - CRA ZAMP with Early Sale Analysis */}
              <Card className="border-financial-success/30 shadow-xl">
                <CardHeader className="bg-gradient-to-r from-financial-success to-green-600 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    {ativo1.nome} - Análise de Venda Antecipada
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                    {/* Coluna 1 - Características Básicas */}
                    <div className="space-y-3">
                      <div>
                        <span className="text-muted-foreground">Tipo Taxa:</span>
                        <div className="font-mono font-semibold">{getTipoTaxaDisplay(ativo1.tipoTaxa)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Taxa:</span>
                        <div className="font-mono font-semibold">{getTaxaDisplay(ativo1)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Vencimento:</span>
                        <div className="font-mono font-semibold">{new Date(ativo1.vencimento).toLocaleDateString('pt-BR')}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Tributação IR:</span>
                        <div className="font-mono font-semibold">{getIRDisplay(ativo1, results.anosProjecao)}</div>
                      </div>
                    </div>
                    
                    {/* Coluna 2 - Valores Financeiros */}
                    <div className="space-y-3">
                      <div>
                        <span className="text-muted-foreground">Valor de Compra:</span>
                        <div className="font-mono font-semibold">R$ {ativo1.valorInvestido.toLocaleString('pt-BR')}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Valor de Curva:</span>
                        <div className="font-mono font-semibold">R$ {ativo1.valorCurva.toLocaleString('pt-BR')}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Cupons Recebidos:</span>
                        <div className="font-mono font-semibold text-financial-success">R$ {ativo1.couponData.total.toLocaleString('pt-BR')}</div>
                      </div>
                      {ativo1.valorVenda && (
                        <div>
                          <span className="text-muted-foreground">Valor de Venda:</span>
                          <div className="font-mono font-semibold text-blue-600">R$ {ativo1.valorVenda.toLocaleString('pt-BR')}</div>
                        </div>
                      )}
                    </div>
                    
                    {/* Coluna 3 - Análise de Resultado */}
                    {ativo1.valorVenda ? (
                      <div className="col-span-2 lg:col-span-1">
                        <div className="p-4 bg-gradient-to-r from-financial-info/20 to-blue-100/20 rounded-lg border border-financial-info/30 h-full flex flex-col justify-center">
                          <div className="text-center">
                            <div className="text-sm text-muted-foreground mb-1">Resultado da Venda Antecipada</div>
                            {(() => {
                              const resultadoVenda = ativo1.valorVenda + ativo1.couponData.total - ativo1.valorInvestido;
                              const isPositivo = resultadoVenda >= 0;
                              const percentual = ((resultadoVenda / ativo1.valorInvestido) * 100);
                              return (
                                <div>
                                  <div className={`font-mono text-xl font-bold ${isPositivo ? 'text-financial-success' : 'text-financial-danger'}`}>
                                    {isPositivo ? '+' : ''}R$ {resultadoVenda.toLocaleString('pt-BR')}
                                  </div>
                                  <div className={`text-sm ${isPositivo ? 'text-financial-success' : 'text-financial-danger'}`}>
                                    {isPositivo ? '+' : ''}{percentual.toFixed(2)}% sobre o valor investido
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-2">
                                    Valor de Venda + Cupons - Valor de Compra
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="col-span-2 lg:col-span-1 flex items-center justify-center">
                        <div className="text-center text-muted-foreground text-sm">
                          Aguardando valor de venda para análise
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Table 2 - BTDI11 Characteristics */}
              <Card key="ativo2-btdi11-card" className="border-financial-info/30 shadow-xl">
                <CardHeader className="bg-gradient-to-r from-financial-info to-blue-600 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2 text-lg font-bold">
                    <BarChart3 className="h-6 w-6" />
                    ATIVO 2 - {ativo2.nome || 'BTDI11'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    {/* Coluna 1 - Características Básicas */}
                    <div className="space-y-3">
                      <div>
                        <span className="text-muted-foreground">Tipo Taxa:</span>
                        <div className="font-mono font-semibold">{getTipoTaxaDisplay(ativo2?.tipoTaxa || 'pre')}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Taxa:</span>
                        <div className="font-mono font-semibold">{getTaxaDisplay(ativo2) || 'N/A'}</div>
                      </div>
                    </div>
                    
                    {/* Coluna 2 - Datas e IR */}
                    <div className="space-y-3">
                      <div>
                        <span className="text-muted-foreground">Vencimento:</span>
                        <div className="font-mono font-semibold">
                          {ativo2?.vencimento ? new Date(ativo2.vencimento).toLocaleDateString('pt-BR') : 'N/A'}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Tributação IR:</span>
                        <div className="font-mono font-semibold">{getIRDisplay(ativo2, results?.anosProjecao || 0) || 'N/A'}</div>
                      </div>
                    </div>
                    
                    {/* Coluna 3 - Valores de Compra e Curva */}
                    <div className="space-y-3">
                      <div>
                        <span className="text-muted-foreground">Valor de Compra:</span>
                        <div className="font-mono font-semibold">R$ {(ativo2?.valorInvestido || 0).toLocaleString('pt-BR')}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Valor de Curva:</span>
                        <div className="font-mono font-semibold">R$ {(ativo2?.valorCurva || 0).toLocaleString('pt-BR')}</div>
                      </div>
                    </div>
                    
                    {/* Coluna 4 - Cupons */}
                    <div className="space-y-3">
                      <div>
                        <span className="text-muted-foreground">Cupons Recebidos:</span>
                        <div className="font-mono font-semibold text-financial-success">
                          R$ {(ativo2?.couponData?.total || 0).toLocaleString('pt-BR')}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>



            
            {/* Decomposição Detalhada dos Valores Finais */}
            <Card className="border-financial-primary/30 shadow-xl">
              <CardHeader className="bg-gradient-to-r from-financial-primary to-financial-secondary text-white rounded-t-lg">
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5" />
                  Decomposição Detalhada dos Valores Finais
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {(() => {
                  const currentHash = generateDataHash();
                  const isDataFresh = currentHash === lastCalculationHash;
                  
                  if (!isDataFresh || hasUnsavedChanges || !results.ativo1 || !results.ativo2) {
                    return (
                      <div className="text-center py-8 text-muted-foreground">
                        <AlertTriangle className="mx-auto h-12 w-12 mb-4 opacity-50" />
                        <p>Execute o cálculo para ver a decomposição detalhada dos valores finais</p>
                      </div>
                    );
                  }

                  // Calculate detailed breakdown for each asset
                  const calculateDetailedBreakdown = (ativo: any, couponDetails: any[], valorInvestido: number) => {
                    const principalInvestido = valorInvestido;
                    
                    // Sum all gross coupons
                    const cupomsBrutos = couponDetails?.reduce((sum, coupon) => sum + (coupon.gross || 0), 0) || 0;
                    
                    // Sum all IR on coupons (difference between gross and net)
                    const irSobreCupons = couponDetails?.reduce((sum, coupon) => sum + ((coupon.gross || 0) - (coupon.net || 0)), 0) || 0;
                    
                    // Net coupons
                    const cuponsLiquidos = cupomsBrutos - irSobreCupons;
                    
                    // Calculate reinvestment values
                    // Get final value from the last element of the array (corrected)
                    const valorFinalBruto = ativo.length > 0 ? ativo[ativo.length - 1] : 0;
                    const principalVencimento = principalInvestido;
                    
                    // Total reinvested amounts (coupon + yield on reinvestment)
                    const totalReinvestido = couponDetails?.reduce((sum, coupon) => sum + (coupon.reinvested || 0), 0) || 0;
                    
                    // Rendimento sobre cupons = total reinvestido - cupons líquidos originais
                    const rendimentoSobreCupons = totalReinvestido - cuponsLiquidos;
                    
                    // IR on reinvestments (estimated based on final value calculations)
                    const irSobreReinvestimentos = 0; // This needs more complex calculation
                    
                    // IR on principal (if any)
                    const irSobrePrincipal = Math.max(0, (ativo.valorFinal || 0) - valorInvestido - cuponsLiquidos - rendimentoSobreCupons);
                    
                    return {
                      principalInvestido,
                      cupomsBrutos,
                      irSobreCupons,
                      cuponsLiquidos,
                      rendimentoSobreCupons,
                      irSobreReinvestimentos,
                      principalVencimento,
                      irSobrePrincipal,
                      valorFinal: valorFinalBruto
                    };
                  };

                  const breakdown1 = calculateDetailedBreakdown(results.ativo1, results.couponDetails?.ativo1 || [], ativo1.valorCurva);
                  const breakdown2 = calculateDetailedBreakdown(results.ativo2, results.couponDetails?.ativo2 || [], ativo2.valorCurva);

                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      {/* Ativo 1 Breakdown */}
                      <div className="space-y-4">
                        <h3 className="text-xl font-bold text-financial-primary border-b border-financial-primary/30 pb-2">
                          {ativo1.nome}
                        </h3>
                        
                        <div className="space-y-3">
                          <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                            <span className="font-semibold">Principal Investido:</span>
                            <span className="font-mono text-lg">R$ {breakdown1.principalInvestido.toLocaleString('pt-BR')}</span>
                          </div>
                          
                          <div className="flex justify-between items-center p-3 bg-financial-success/10 rounded-lg border border-financial-success/30">
                            <span className="font-semibold text-financial-success">Cupons Brutos Recebidos:</span>
                            <span className="font-mono text-lg text-financial-success">+ R$ {breakdown1.cupomsBrutos.toLocaleString('pt-BR')}</span>
                          </div>
                          
                          <div className="flex justify-between items-center p-3 bg-financial-danger/10 rounded-lg border border-financial-danger/30">
                            <span className="font-semibold text-financial-danger">IR sobre Cupons:</span>
                            <span className="font-mono text-lg text-financial-danger">- R$ {breakdown1.irSobreCupons.toLocaleString('pt-BR')}</span>
                          </div>
                          
                          <div className="flex justify-between items-center p-3 bg-financial-success/10 rounded-lg border border-financial-success/30">
                            <span className="font-semibold text-financial-success">Cupons Líquidos:</span>
                            <span className="font-mono text-lg text-financial-success">= R$ {breakdown1.cuponsLiquidos.toLocaleString('pt-BR')}</span>
                          </div>
                          
                          <div className="flex justify-between items-center p-3 bg-financial-info/10 rounded-lg border border-financial-info/30">
                            <span className="font-semibold text-financial-info">Rendimento sobre cupons:</span>
                            <span className="font-mono text-lg text-financial-info">R$ {breakdown1.rendimentoSobreCupons.toLocaleString('pt-BR')}</span>
                          </div>
                          
                          {breakdown1.irSobreReinvestimentos > 0 && (
                            <div className="flex justify-between items-center p-3 bg-financial-danger/10 rounded-lg border border-financial-danger/30">
                              <span className="font-semibold text-financial-danger">IR sobre Reinvestimentos:</span>
                              <span className="font-mono text-lg text-financial-danger">- R$ {breakdown1.irSobreReinvestimentos.toLocaleString('pt-BR')}</span>
                            </div>
                          )}
                          
                          {breakdown1.irSobrePrincipal > 0 && (
                            <div className="flex justify-between items-center p-3 bg-financial-danger/10 rounded-lg border border-financial-danger/30">
                              <span className="font-semibold text-financial-danger">IR sobre Principal:</span>
                              <span className="font-mono text-lg text-financial-danger">- R$ {breakdown1.irSobrePrincipal.toLocaleString('pt-BR')}</span>
                            </div>
                          )}
                          
          {/* Reinvestment Explanation - Item 3 - Always show for layout consistency */}
          <div className="space-y-2">
            <div className="flex justify-between items-center p-3 bg-financial-warning/10 rounded-lg border border-financial-warning/30">
              <span className="font-semibold text-financial-warning flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Valor após vencimento reaplicado no CDI:
              </span>
              <span className="font-mono text-lg text-financial-warning font-bold">
                + R$ {results.reinvestimento && results.reinvestimento.ativoReinvestido === 'ativo1' 
                  ? (results.reinvestimento.valorFinalReinvestimento - results.reinvestimento.valorResgatado).toLocaleString('pt-BR')
                  : '0'
                }
              </span>
            </div>
            {results.reinvestimento && results.reinvestimento.ativoReinvestido === 'ativo1' ? (
              <div className="text-xs text-muted-foreground px-3 pb-2">
                <span className="italic">
                  Rendimento obtido aplicando R$ {results.reinvestimento.valorResgatado.toLocaleString('pt-BR')} por {results.reinvestimento.periodosReinvestimento} {results.reinvestimento.periodosReinvestimento === 1 ? 'ano' : 'anos'} à taxa CDI de {results.reinvestimento.taxaReinvestimento.toFixed(2)}% ao ano
                </span>
              </div>
            ) : (
              (() => {
                // Check if Asset 1 matures after Asset 2
                const vencimento1 = new Date(ativo1.vencimento);
                const vencimento2 = new Date(ativo2.vencimento);
                const ativo1VenceDepois = vencimento1 > vencimento2;
                
                // Hide message if Asset 1 matures after Asset 2
                if (ativo1VenceDepois) {
                  return null;
                }
                
                return (
                  <div className="text-xs text-muted-foreground px-3 pb-2">
                    <span className="italic">
                      Este ativo não foi reinvestido no CDI
                    </span>
                  </div>
                );
              })()
            )}
          </div>
                          
                          <div className="flex justify-between items-center p-4 bg-gradient-to-r from-financial-primary/20 to-financial-secondary/20 rounded-lg border-2 border-financial-primary/50">
                            <span className="font-bold text-financial-primary text-lg">VALOR FINAL:</span>
                            <span className="font-mono text-xl font-bold text-financial-primary">R$ {breakdown1.valorFinal.toLocaleString('pt-BR')}</span>
                          </div>
                        </div>
                      </div>

                      {/* Ativo 2 Breakdown */}
                      <div className="space-y-4">
                        <h3 className="text-xl font-bold text-financial-primary border-b border-financial-primary/30 pb-2">
                          {ativo2.nome}
                        </h3>
                        
                        <div className="space-y-3">
                          <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                            <span className="font-semibold">Principal Investido:</span>
                            <span className="font-mono text-lg">R$ {breakdown2.principalInvestido.toLocaleString('pt-BR')}</span>
                          </div>
                          
                          <div className="flex justify-between items-center p-3 bg-financial-success/10 rounded-lg border border-financial-success/30">
                            <span className="font-semibold text-financial-success">Cupons Brutos Recebidos:</span>
                            <span className="font-mono text-lg text-financial-success">+ R$ {breakdown2.cupomsBrutos.toLocaleString('pt-BR')}</span>
                          </div>
                          
                          <div className="flex justify-between items-center p-3 bg-financial-danger/10 rounded-lg border border-financial-danger/30">
                            <span className="font-semibold text-financial-danger">IR sobre Cupons:</span>
                            <span className="font-mono text-lg text-financial-danger">- R$ {breakdown2.irSobreCupons.toLocaleString('pt-BR')}</span>
                          </div>
                          
                          <div className="flex justify-between items-center p-3 bg-financial-success/10 rounded-lg border border-financial-success/30">
                            <span className="font-semibold text-financial-success">Cupons Líquidos:</span>
                            <span className="font-mono text-lg text-financial-success">= R$ {breakdown2.cuponsLiquidos.toLocaleString('pt-BR')}</span>
                          </div>
                          
                          <div className="flex justify-between items-center p-3 bg-financial-info/10 rounded-lg border border-financial-info/30">
                            <span className="font-semibold text-financial-info">Rendimento sobre cupons:</span>
                            <span className="font-mono text-lg text-financial-info">R$ {breakdown2.rendimentoSobreCupons.toLocaleString('pt-BR')}</span>
                          </div>
                          
                          {breakdown2.irSobreReinvestimentos > 0 && (
                            <div className="flex justify-between items-center p-3 bg-financial-danger/10 rounded-lg border border-financial-danger/30">
                              <span className="font-semibold text-financial-danger">IR sobre Reinvestimentos:</span>
                              <span className="font-mono text-lg text-financial-danger">- R$ {breakdown2.irSobreReinvestimentos.toLocaleString('pt-BR')}</span>
                            </div>
                          )}
                          
                          {breakdown2.irSobrePrincipal > 0 && (
                            <div className="flex justify-between items-center p-3 bg-financial-danger/10 rounded-lg border border-financial-danger/30">
                              <span className="font-semibold text-financial-danger">IR sobre Principal:</span>
                              <span className="font-mono text-lg text-financial-danger">- R$ {breakdown2.irSobrePrincipal.toLocaleString('pt-BR')}</span>
                            </div>
                          )}
                          
                          {/* Reinvestment Explanation - Item 3 - Always show for layout consistency */}
                          <div className="space-y-2">
                            <div className="flex justify-between items-center p-3 bg-financial-warning/10 rounded-lg border border-financial-warning/30">
                              <span className="font-semibold text-financial-warning flex items-center gap-2">
                                <TrendingUp className="h-4 w-4" />
                                Valor após vencimento reaplicado no CDI:
                              </span>
                              <span className="font-mono text-lg text-financial-warning font-bold">
                                + R$ {results.reinvestimento && results.reinvestimento.ativoReinvestido === 'ativo2' 
                                  ? (results.reinvestimento.valorFinalReinvestimento - results.reinvestimento.valorResgatado).toLocaleString('pt-BR')
                                  : '0'
                                }
                              </span>
                            </div>
                            {results.reinvestimento && results.reinvestimento.ativoReinvestido === 'ativo2' ? (
                              <div className="text-xs text-muted-foreground px-3 pb-2">
                                <span className="italic">
                                  Rendimento obtido aplicando R$ {results.reinvestimento.valorResgatado.toLocaleString('pt-BR')} por {results.reinvestimento.periodosReinvestimento} {results.reinvestimento.periodosReinvestimento === 1 ? 'ano' : 'anos'} à taxa CDI de {results.reinvestimento.taxaReinvestimento.toFixed(2)}% ao ano
                                </span>
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground px-3 pb-2">
                                <span className="italic">
                                  Este ativo não foi reinvestido no CDI
                                </span>
                              </div>
                            )}
                          </div>
                          
                          <div className="flex justify-between items-center p-4 bg-gradient-to-r from-financial-primary/20 to-financial-secondary/20 rounded-lg border-2 border-financial-primary/50">
                            <span className="font-bold text-financial-primary text-lg">VALOR FINAL:</span>
                            <span className="font-mono text-xl font-bold text-financial-primary">R$ {breakdown2.valorFinal.toLocaleString('pt-BR')}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
            
            {/* Final Analysis Summary */}
            <Card className="border-financial-primary/30 shadow-xl">
              <CardHeader className="bg-gradient-to-r from-financial-primary to-financial-secondary text-white rounded-t-lg">
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Análise Final da Comparação
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b border-financial-primary/20">
                    <span className="font-medium text-financial-primary">Valor Futuro ({ativo1.nome}):</span>
                    <span className="font-mono font-bold text-lg">R$ {results.ativo1[results.ativo1.length - 1].toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-financial-primary/20">
                    <span className="font-medium text-financial-primary">Valor Futuro ({ativo2.nome}):</span>
                    <span className="font-mono font-bold text-lg">R$ {results.ativo2[results.ativo2.length - 1].toLocaleString('pt-BR')}</span>
                  </div>
                  
                  <div className="flex justify-between items-center py-3 bg-gradient-to-r from-financial-light/20 to-financial-light/10 rounded-lg px-4">
                    <span className="font-bold text-financial-primary">Vantagem Final:</span>
                    <div className="text-right">
                      {(() => {
                        const diferenca = results.ativo1[results.ativo1.length - 1] - results.ativo2[results.ativo2.length - 1];
                        const melhorOpcao = diferenca >= 0 ? ativo1.nome : ativo2.nome;
                        return (
                          <div>
                            <span className={`font-mono font-bold text-xl ${diferenca >= 0 ? 'text-financial-success' : 'text-financial-danger'}`}>
                              R$ {Math.abs(diferenca).toLocaleString('pt-BR')}
                            </span>
                            <div className="text-sm font-medium text-muted-foreground">a favor de <span className="font-bold text-financial-primary">{melhorOpcao}</span></div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="mt-4 p-4 bg-gradient-to-r from-financial-primary/10 to-financial-secondary/10 rounded-lg border border-financial-primary/20">
                    <div className="flex items-start gap-2">
                      <div className="text-financial-primary font-bold">Conclusão:</div>
                      <div className="flex-1 text-sm">
                        {(() => {
                          const diferenca = results.ativo1[results.ativo1.length - 1] - results.ativo2[results.ativo2.length - 1];
                          return diferenca >= 0 
                            ? `O ${ativo1.nome} é projetado para ser financeiramente superior neste horizonte de investimento.` 
                            : `O ${ativo2.nome} oferece um retorno líquido potencialmente maior neste horizonte de investimento.`;
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Coupon Details Section - New Cash Flow System */}
            {(results.couponDetails?.ativo1?.length || results.couponDetails?.ativo2?.length) && <Card className="border-blue-500/30 shadow-xl">
                <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Detalhamento dos Cupons e Reinvestimentos
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="space-y-6">
                    
                    {/* Ativo 1 Coupons */}
                    {results.couponDetails?.ativo1?.length > 0 && <div>
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
                              {results.couponDetails.ativo1.map((coupon, index) => <tr key={index} className="even:bg-muted/50">
                                  <td className="p-2 border text-xs">
                                    {new Date(coupon.couponDate).toLocaleDateString('pt-BR')}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs">
                                    R$ {coupon.gross.toLocaleString('pt-BR', {
                            minimumFractionDigits: 2
                          })}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs text-financial-success">
                                    R$ {coupon.net.toLocaleString('pt-BR', {
                            minimumFractionDigits: 2
                          })}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs">
                                    {coupon.reinvestFactor.toFixed(4)}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs font-bold text-blue-600">
                                    R$ {coupon.reinvested.toLocaleString('pt-BR', {
                            minimumFractionDigits: 2
                          })}
                                  </td>
                                </tr>)}
                              <tr className="bg-financial-primary/20 font-bold">
                                <td className="p-2 border text-xs">TOTAL</td>
                                <td className="p-2 border text-right font-mono text-xs">
                                  R$ {results.couponDetails.ativo1.reduce((sum, c) => sum + c.gross, 0).toLocaleString('pt-BR', {
                            minimumFractionDigits: 2
                          })}
                                </td>
                                <td className="p-2 border text-right font-mono text-xs">
                                  R$ {results.couponDetails.ativo1.reduce((sum, c) => sum + c.net, 0).toLocaleString('pt-BR', {
                            minimumFractionDigits: 2
                          })}
                                </td>
                                <td className="p-2 border text-right font-mono text-xs">-</td>
                                <td className="p-2 border text-right font-mono text-xs">
                                  R$ {results.couponDetails.ativo1.reduce((sum, c) => sum + c.reinvested, 0).toLocaleString('pt-BR', {
                            minimumFractionDigits: 2
                          })}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>}
                    
                    {/* Ativo 2 Coupons */}
                    {results.couponDetails?.ativo2?.length > 0 && <div>
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
                              {results.couponDetails.ativo2.map((coupon, index) => <tr key={index} className="even:bg-muted/50">
                                  <td className="p-2 border text-xs">
                                    {new Date(coupon.couponDate).toLocaleDateString('pt-BR')}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs">
                                    R$ {coupon.gross.toLocaleString('pt-BR', {
                            minimumFractionDigits: 2
                          })}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs text-financial-success">
                                    R$ {coupon.net.toLocaleString('pt-BR', {
                            minimumFractionDigits: 2
                          })}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs">
                                    {coupon.reinvestFactor.toFixed(4)}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs font-bold text-blue-600">
                                    R$ {coupon.reinvested.toLocaleString('pt-BR', {
                            minimumFractionDigits: 2
                          })}
                                  </td>
                                </tr>)}
                              <tr className="bg-financial-secondary/20 font-bold">
                                <td className="p-2 border text-xs">TOTAL</td>
                                <td className="p-2 border text-right font-mono text-xs">
                                  R$ {results.couponDetails.ativo2.reduce((sum, c) => sum + c.gross, 0).toLocaleString('pt-BR', {
                            minimumFractionDigits: 2
                          })}
                                </td>
                                <td className="p-2 border text-right font-mono text-xs">
                                  R$ {results.couponDetails.ativo2.reduce((sum, c) => sum + c.net, 0).toLocaleString('pt-BR', {
                            minimumFractionDigits: 2
                          })}
                                </td>
                                <td className="p-2 border text-right font-mono text-xs">-</td>
                                <td className="p-2 border text-right font-mono text-xs">
                                  R$ {results.couponDetails.ativo2.reduce((sum, c) => sum + c.reinvested, 0).toLocaleString('pt-BR', {
                            minimumFractionDigits: 2
                          })}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>}
                  </div>
                  
                   <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                     <p className="text-sm text-blue-800">
                       <strong>Sistema de Fluxo de Caixa:</strong> Os cupons são calculados com IR regressivo baseado no tempo de aplicação 
                       e reinvestidos pela curva CDI projetada do momento do pagamento até o vencimento. Otimizado para títulos diretos.
                     </p>
                   </div>
                </CardContent>
              </Card>}
          </div>}
      </div>
    </div>;
};
export default InvestmentComparator;