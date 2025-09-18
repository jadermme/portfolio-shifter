import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Calculator, Trash2, Printer, TrendingUp, BarChart3, ArrowRight, AlertTriangle, FileText } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { CouponManager } from './CouponManager';
import { CouponSummary } from '@/types/coupon';

// ===================== UTILITY FUNCTIONS =====================
const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
};

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
  // novos parâmetros para lógicas especiais
  mesesCupons?: string;
  tipoAtivo?: string;
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
  // NEW: Separate fields for Asset Type and Indexer
  tipoAtivo: 'debenture-incentivada' | 'cri-cra' | 'lci-lca' | 'cdb' | 'fundo-cetipado' | 'tesouro-direto';
  indexador: 'pre-fixada' | 'percentual-cdi' | 'cdi-mais' | 'ipca-mais';
  // Legacy field for backward compatibility
  tipoTaxa?: 'pre-fixada' | 'percentual-cdi' | 'cdi-mais' | 'ipca-mais';
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
  earningsStartDate?: string; // ISO date when earnings begin (e.g., "2025-10-01" for BTDI11)
  activePeriods?: {
    year: number;
    months: number[];
  }[]; // Specific months when asset generates earnings
  // NEW FIELDS FOR FUND DISTRIBUTIONS
  periodicidadeDistribuicao?: 'mensal' | 'trimestral'; // Distribution frequency
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
    // NEW: Enhanced reinvestment details
    dataInicioReinvestimento: string;
    dataFimReinvestimento: string;
    diasReinvestidos: number;
    rendimentoReinvestimento: number;
    irReinvestimento: number;
    valorTotalComReinvestimento: number;
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

// ===================== DYNAMIC CALCULATION RULES BY ASSET TYPE =====================
interface CalculationRules {
  use252: boolean;
  useDailyCapitalization: boolean;
  dayCountConvention: 'ACT/252' | 'ACT/365';
}

function getCalculationRules(tipoAtivo: string, indexador: string): CalculationRules {
  // Default rules
  let rules: CalculationRules = {
    use252: false,
    useDailyCapitalization: false,
    dayCountConvention: 'ACT/365'
  };

  // Apply rules based on asset type and indexer combination
  switch (tipoAtivo) {
    case 'cdb':
      if (indexador === 'percentual-cdi' || indexador === 'cdi-mais') {
        // CDB indexado ao CDI usa 252 DU com capitalização diária
        rules = {
          use252: true,
          useDailyCapitalization: true,
          dayCountConvention: 'ACT/252'
        };
      } else if (indexador === 'pre-fixada') {
        // CDB pré-fixado usa ACT/365 dias corridos
        rules = {
          use252: false,
          useDailyCapitalization: false,
          dayCountConvention: 'ACT/365'
        };
      }
      break;

    case 'cri-cra':
    case 'debenture-incentivada':
      if (indexador === 'percentual-cdi' || indexador === 'cdi-mais') {
        // CRI/CRA e Debêntures indexadas ao CDI usam 252 DU com capitalização mensal
        rules = {
          use252: true,
          useDailyCapitalization: false,
          dayCountConvention: 'ACT/252'
        };
      } else if (indexador === 'pre-fixada') {
        // CRI/CRA e Debêntures pré-fixadas usam ACT/365
        rules = {
          use252: false,
          useDailyCapitalization: false,
          dayCountConvention: 'ACT/365'
        };
      }
      break;

    case 'lci-lca':
      // LCI/LCA seguem mesmas regras do CDB
      if (indexador === 'percentual-cdi' || indexador === 'cdi-mais') {
        rules = {
          use252: true,
          useDailyCapitalization: true,
          dayCountConvention: 'ACT/252'
        };
      } else if (indexador === 'pre-fixada') {
        rules = {
          use252: false,
          useDailyCapitalization: false,
          dayCountConvention: 'ACT/365'
        };
      }
      break;

    case 'tesouro-direto':
      if (indexador === 'ipca-mais') {
        // Tesouro IPCA+ usa regras específicas do Tesouro
        rules = {
          use252: false,
          useDailyCapitalization: false,
          dayCountConvention: 'ACT/365'
        };
      } else if (indexador === 'pre-fixada') {
        // Tesouro Prefixado
        rules = {
          use252: false,
          useDailyCapitalization: false,
          dayCountConvention: 'ACT/365'
        };
      }
      break;

    case 'fundo-cetipado':
      // Fundos cetipados apenas distribuem, não valorizam
      rules = {
        use252: true,
        useDailyCapitalization: false,
        dayCountConvention: 'ACT/252'
      };
      break;
  }

  console.log(`📊 Regras de cálculo para ${tipoAtivo} + ${indexador}:`, rules);
  return rules;
}
function monthlyRateFromCDI(cdiAA: number, use252: boolean, duPerMonth = 21, useDailyCapitalization = false) {
  if (use252) {
    if (useDailyCapitalization) {
      // Para CDB indexado ao CDI: capitalização diária
      // Taxa diária CDI composta por dias úteis no mês
      const dailyRate = aaToDaily252(cdiAA);
      return Math.pow(1 + dailyRate, duPerMonth) - 1;
    } else {
      // Para CRI/CRA e Debêntures: capitalização mensal baseada em 252 DU
      return Math.pow(1 + aaToDaily252(cdiAA), duPerMonth) - 1;
    }
  }
  // Capitalização mensal tradicional (365 dias)
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
  useDailyCapitalization?: boolean;
  fromISO?: string;
  toISO?: string;
}, monthlyIndex?: number): number {
  const {
    taxaPreAA = 0,
    taxaRealAA = 0,
    ipcaAA = 0,
    percCDI = 0,
    cdiAA = 0,
    spreadPreAA = 0,
    use252 = false,
    useDailyCapitalization = false,
    fromISO,
    toISO
  } = p;
  
  console.log(`📈 Calculando taxa para ${kind}: use252=${use252}, dailyCap=${useDailyCapitalization}`);
  
  // Se temos datas do período, calculamos taxa para período específico
  if (fromISO && toISO) {
    switch (kind) {
      case "PRE":
        // Taxa pré-fixada sempre usa ACT/365
        return calculatePeriodRate(taxaPreAA, fromISO, toISO, false);
      case "IPCA+PRE":
        // IPCA + Taxa real sempre usa ACT/365 
        const ipcaPeriod = calculatePeriodRate(ipcaAA, fromISO, toISO, false);
        const realPeriod = calculatePeriodRate(taxaRealAA, fromISO, toISO, false);
        return (1 + ipcaPeriod) * (1 + realPeriod) - 1;
      case "%CDI":
        // Percentual do CDI usa regras específicas por tipo de ativo
        const cdiPeriod = calculatePeriodRate(cdiAA, fromISO, toISO, use252);
        return cdiPeriod * (percCDI / 100);
      case "CDI+PRE":
        // CDI + Spread usa regras específicas por tipo de ativo
        const cdiBasePeriod = calculatePeriodRate(cdiAA, fromISO, toISO, use252);
        const spreadPeriod = calculatePeriodRate(spreadPreAA, fromISO, toISO, use252);
        return cdiBasePeriod + spreadPeriod;
    }
  }
  
  // Fallback para cálculo mensal (compatibilidade)
  switch (kind) {
    case "PRE":
      // Taxa pré-fixada sempre usa ACT/365
      return aaToMonthly(taxaPreAA);
    case "IPCA+PRE":
      // IPCA + Taxa real sempre usa ACT/365
      return (1 + aaToMonthly(taxaRealAA)) * (1 + aaToMonthly(ipcaAA)) - 1;
    case "%CDI":
      // Percentual do CDI usa regras específicas por tipo de ativo
      const baseCDIRate = monthlyRateFromCDI(cdiAA, use252, 21, useDailyCapitalization);
      return baseCDIRate * (percCDI / 100);
    case "CDI+PRE":
      // CDI + Spread usa regras específicas por tipo de ativo
      const cdiRate = monthlyRateFromCDI(cdiAA, use252, 21, useDailyCapitalization);
      return cdiRate + aaToMonthly(spreadPreAA);
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

// Calcula dias úteis entre duas datas (base 252)
function businessDaysBetween(aISO: string, bISO: string): number {
  const start = new Date(aISO);
  const end = new Date(bISO);
  let count = 0;
  let current = new Date(start);

  while (current < end) {
    const dayOfWeek = current.getDay();
    // Monday = 1, Tuesday = 2, ..., Friday = 5, Saturday = 6, Sunday = 0
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  
  return count;
}

// Converte taxa anual para taxa diária baseada na convenção
function aaToDaily(aaPct: number, use252: boolean): number {
  return use252 ? aaToDaily252(aaPct) : Math.pow(1 + aaPct / 100, 1 / 365) - 1;
}

// Calcula taxa para um período específico baseado em dias reais
function calculatePeriodRate(annualRate: number, fromISO: string, toISO: string, use252: boolean): number {
  const days = use252 ? businessDaysBetween(fromISO, toISO) : daysBetween(fromISO, toISO);
  const dailyRate = aaToDaily(annualRate, use252);
  
  console.log(`📊 Período ${fromISO} até ${toISO}: ${days} ${use252 ? 'dias úteis' : 'dias corridos'}, taxa diária=${(dailyRate * 100).toFixed(6)}%`);
  
  return Math.pow(1 + dailyRate, days) - 1;
}
function genCouponDates(startISO: string, endISO: string, freq: Freq, earningsStartDate?: string, mesesCupons?: string, tipoAtivo?: string): string[] {
  const step = freq === "MONTHLY" ? 1 : 6;
  const out: string[] = [];

  // Use earnings start date if provided, otherwise use start date
  if (earningsStartDate) {
    console.log(`📅 Usando data de início dos rendimentos: ${earningsStartDate}`);
    
    // Special handling for CRI/CRA/Debêntures with configured coupon months
    if ((tipoAtivo === 'cri-cra' || tipoAtivo === 'debenture-incentivada') && mesesCupons) {
      console.log(`📅 ${tipoAtivo.toUpperCase()}: Gerando cupons para os meses configurados: ${mesesCupons}`);
      
      const meses = mesesCupons.split(',').map(m => parseInt(m.trim()));
      console.log(`📅 Meses dos cupons: ${meses.join(', ')}`);
      
      // Start from the year after earnings start date
      const earningsStart = new Date(earningsStartDate);
      let currentYear = earningsStart.getFullYear() + 1;
      const endYear = new Date(endISO).getFullYear();
      
      while (currentYear <= endYear) {
        for (const mes of meses) {
          // Use day 15 as default coupon payment day
          const couponDate = `${currentYear}-${mes.toString().padStart(2, '0')}-15`;
          const couponDateObj = new Date(couponDate);
          
          if (couponDateObj <= new Date(endISO) && couponDateObj > earningsStart) {
            console.log(`📅 Data de cupom gerada: ${couponDate}`);
            out.push(couponDate);
          }
        }
        
        currentYear++;
      }
      
      return out;
    } else if (earningsStartDate === '2025-10-01') {
      // Special handling for BTDI11 - monthly coupons on day 10
      console.log(`📅 BTDI11: Gerando cupons mensais no dia 10, primeiro cupom em novembro`);

      let currentDate = new Date('2025-11-10');
      const endDate = new Date(endISO);

      while (currentDate <= endDate) {
        // FORÇA o dia 10 antes de registrar o cupom
        currentDate.setDate(10);
        
        const couponDate = currentDate.toISOString().slice(0, 10);
        console.log(`📅 Data de cupom gerada: ${couponDate}`);
        out.push(couponDate);

        // Incrementa o mês
        currentDate.setMonth(currentDate.getMonth() + 1);
        
        // FORÇA dia 10 após incrementar o mês
        currentDate.setDate(10);
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
function cdiFactor(curve: CDIPoint[], fromISO: string, toISO: string, use252 = false, useDailyCapitalization = false): number {
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
    const rm = monthlyRateFromCDI(pt.cdiAA, use252, 21, useDailyCapitalization);
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
function projectWithReinvestCDI(x: CouponEngineInput, isLimitedAnalysis = false, assetType?: string, indexador?: string) {
  // Determine calculation rules based on asset type and indexer
  const rules = assetType && indexador ? getCalculationRules(assetType, indexador) : {
    use252: x.use252 || false,
    useDailyCapitalization: false,
    dayCountConvention: 'ACT/365' as const
  };
  
  console.log(`💼 Calculando cupons para ${assetType || 'ativo'} com ${indexador || 'indexador'}`);
  console.log(`📊 Regras aplicadas:`, rules);
  
  // No administrative fees for direct securities
  const couponDates = genCouponDates(x.startISO, x.endISO, x.freq, x.earningsStartDate, x.mesesCupons, x.tipoAtivo);
  const coupons: CouponResult[] = [];
  let basePrincipal = x.principal;

  // BTDI11 Debug logging
  if (assetType === 'fundo-cetipado') {
    console.log(`🔍 BTDI11 Debug - Período de análise: ${x.earningsStartDate || x.startISO} até ${x.endISO}`);
    console.log(`🔍 BTDI11 Debug - Datas de cupom:`, couponDates);
    console.log(`🔍 BTDI11 Debug - Principal inicial: R$ ${x.principal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);
  }

  // Função para calcular o período de um cupom mensal (mês anterior ao pagamento)
  const getCouponPeriod = (couponDate: string) => {
    const [year, month, day] = couponDate.split('-').map(Number);
    const couponDateObj = new Date(year, month - 1, day);
    
    // Início do mês anterior
    const startMonth = new Date(couponDateObj);
    startMonth.setMonth(startMonth.getMonth() - 1);
    startMonth.setDate(1);
    
    // Fim do mês anterior (último dia)
    const endMonth = new Date(couponDateObj);
    endMonth.setMonth(endMonth.getMonth() - 1 + 1);
    endMonth.setDate(0); // Vai para o último dia do mês anterior
    
    const periodStart = startMonth.toISOString().split('T')[0];
    const periodEnd = endMonth.toISOString().split('T')[0];
    
    return { periodStart, periodEnd };
  };

  // Função para calcular o período de um cupom semestral (6 meses de acumulação)
  const getSemestralCouponPeriod = (couponDate: string, couponIndex: number, earningsStartDate: string) => {
    const [year, month, day] = couponDate.split('-').map(Number);
    const couponDateObj = new Date(year, month - 1, day);
    
    if (couponIndex === 0) {
      // Primeiro cupom: acumula desde o earnings start date até o mês anterior ao cupom
      const startDate = new Date(earningsStartDate + 'T00:00:00');
      
      // Fim do mês anterior ao cupom
      const endMonth = new Date(couponDateObj);
      endMonth.setMonth(endMonth.getMonth() - 1 + 1);
      endMonth.setDate(0); // Último dia do mês anterior
      
      const periodStart = startDate.toISOString().split('T')[0];
      const periodEnd = endMonth.toISOString().split('T')[0];
      
      return { periodStart, periodEnd };
    } else {
      // Cupons seguintes: acumula 6 meses completos desde o cupom anterior
      const endMonth = new Date(couponDateObj);
      endMonth.setMonth(endMonth.getMonth() - 1 + 1);
      endMonth.setDate(0); // Último dia do mês anterior ao cupom
      
      const startMonth = new Date(endMonth);
      startMonth.setMonth(startMonth.getMonth() - 5); // 6 meses no total (incluindo o mês final)
      startMonth.setDate(1);
      
      const periodStart = startMonth.toISOString().split('T')[0];
      const periodEnd = endMonth.toISOString().split('T')[0];
      
      return { periodStart, periodEnd };
    }
  };

  // percorre cada período usando lógica específica por frequência
  for (let i = 0; i < couponDates.length; i++) {
    const dt = couponDates[i];
    
    // Escolhe a função de período baseada na frequência do cupom
    const { periodStart, periodEnd } = x.freq === 'MONTHLY' 
      ? getCouponPeriod(dt)
      : getSemestralCouponPeriod(dt, i, x.earningsStartDate || x.startISO);
    
    // Get CDI rate specific for this coupon period
    const couponMonth = dt.slice(0, 7); // YYYY-MM
    const cdiAA = getCDIRateForMonth(x.cdiCurve, dt);
    
    // Debug - período específico para ambos os tipos
    if (assetType === 'fundo-cetipado') {
      console.log(`\n🔍 BTDI11 Cupom ${i + 1} (${dt}) - MENSAL:`);
      console.log(`  📅 Período correto: ${periodStart} até ${periodEnd} (mês fechado)`);
      console.log(`  📊 CDI no período: ${cdiAA}% a.a.`);
      console.log(`  📝 Dias no período: ${daysBetween(periodStart, periodEnd)} dias corridos`);
    } else if (x.freq === 'SEMIANNUAL') {
      console.log(`\n🔍 CRA ZAMP Cupom ${i + 1} (${dt}) - SEMESTRAL:`);
      console.log(`  📅 Período de acumulação: ${periodStart} até ${periodEnd} (${i === 0 ? 'primeiro cupom' : '6 meses completos'})`);
      console.log(`  📊 CDI no período: ${cdiAA}% a.a.`);
      console.log(`  📝 Dias no período: ${daysBetween(periodStart, periodEnd)} dias corridos`);
      console.log(`  💡 Método: ${i === 0 ? 'Desde início dos rendimentos' : 'Acumulação de 6 meses'}`);
    }
    
    // Calculate rate for the period (monthly or semiannual)
    const rPeriodGross = rateOfAssetForPeriod(x.rateKind, {
      taxaPreAA: x.taxaPreAA,
      taxaRealAA: x.taxaRealAA,
      ipcaAA: x.ipcaCurve?.[0]?.ipcaAA ?? 0,
      percCDI: x.percCDI,
      cdiAA,
      spreadPreAA: x.spreadPreAA,
      use252: rules.use252,
      useDailyCapitalization: rules.useDailyCapitalization,
      fromISO: periodStart,
      toISO: periodEnd
    });
    
    const couponGross = Math.max(0, basePrincipal * rPeriodGross);

    // BTDI11 Debug - análise detalhada do cupom
    if (assetType === 'fundo-cetipado') {
      console.log(`  💰 Taxa período bruta: ${(rPeriodGross * 100).toFixed(6)}%`);
      console.log(`  💰 Principal base: R$ ${basePrincipal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);
      console.log(`  💰 Cupom bruto: R$ ${couponGross.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);
    }

    console.log(`📅 Cupom ${dt}: Período ${periodStart} até ${periodEnd} (mês fechado)`);
    console.log(`📊 Taxa do período=${(rPeriodGross * 100).toFixed(4)}%, Cupom=R$${couponGross.toLocaleString('pt-BR')}`);

    // IR regressivo sobre o cupom pelo tempo desde a aplicação
    const dias = daysBetween(x.startISO, dt);
    const aliq = x.irRegressivo !== false ? irAliquotaRegressivo(dias) : 0;
    const couponNet = couponGross * (1 - aliq);

    // fator de reinvestimento CDI do pagamento até o fim
    const fReinv = cdiFactor(x.cdiCurve, dt, x.endISO, rules.use252, rules.useDailyCapitalization);
    const couponReinv = couponNet * fReinv;
    coupons.push({
      couponDate: dt,
      gross: couponGross,
      net: couponNet,
      reinvestFactor: fReinv,
      reinvested: couponReinv
    });
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
      // Get asset rate for capitalization period using real days
      const cdiAA = getCDIRateForMonth(x.cdiCurve, x.endISO);
      const rPeriodCapitalization = rateOfAssetForPeriod(x.rateKind, {
        taxaPreAA: x.taxaPreAA,
        taxaRealAA: x.taxaRealAA,
        ipcaAA: x.ipcaCurve?.[0]?.ipcaAA ?? 0,
        percCDI: x.percCDI,
        cdiAA,
        spreadPreAA: x.spreadPreAA,
        use252: rules.use252,
        useDailyCapitalization: rules.useDailyCapitalization,
        fromISO: lastCouponDate,
        toISO: x.endISO
      });
      
      // Use period rate calculated with real days
      const capitalizationFactor = 1 + rPeriodCapitalization;
      principalGrossFinal = basePrincipal * capitalizationFactor;
      
      console.log(`📈 Taxa do Período (${lastCouponDate} até ${x.endISO}): ${(rPeriodCapitalization * 100).toFixed(4)}%`);
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
  const indexador = asset.indexador || asset.tipoTaxa || 'pre-fixada';
  switch (indexador) {
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
  projecoes_version: 'investment_comparator_projecoes_version',
  timestamp: 'investment_comparator_timestamp'
};

// Version for default projections - increment when changing defaults
const PROJECTIONS_VERSION = '3.0'; // Incrementado para forçar regeneração e limpar cache BTDI11

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

const loadProjectionsWithVersionCheck = (): Projecoes => {
  try {
    const savedVersion = localStorage.getItem(STORAGE_KEYS.projecoes_version);
    const savedProjections = localStorage.getItem(STORAGE_KEYS.projecoes);
    
    // If no version or version mismatch, use new defaults
    if (!savedVersion || savedVersion !== PROJECTIONS_VERSION || !savedProjections) {
      const defaultProjections = getDefaultProjecoes();
      localStorage.setItem(STORAGE_KEYS.projecoes, JSON.stringify(defaultProjections));
      localStorage.setItem(STORAGE_KEYS.projecoes_version, PROJECTIONS_VERSION);
      console.log('📈 Usando novos valores padrão das projeções');
      return defaultProjections;
    }
    
    return JSON.parse(savedProjections);
  } catch (error) {
    console.error('Erro ao carregar projeções do localStorage:', error);
    return getDefaultProjecoes();
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

// ===================== BTDI11 CACHE CLEANUP FUNCTIONS =====================
const clearBTDI11Data = () => {
  console.log("🧹 Limpando cache antigo do BTDI11...");

  const keysToClear = Object.keys(localStorage).filter(key =>
    key.includes('BTDI11') || 
    key.includes('coupon') || 
    key.includes('activePeriods') ||
    key.includes('investment_comparator_ativo') ||
    key.includes('calcularRendimentosAnuaisLegacy') ||
    key.includes('CouponResults') ||
    key.includes('projectionsCache')
  );

  for (const key of keysToClear) {
    localStorage.removeItem(key);
    console.log(`🗑 Removido: ${key}`);
  }
  
  console.log(`✅ Cache BTDI11 limpo: ${keysToClear.length} chaves removidas`);
};

const detectSuspiciousCouponDates = (couponDates: string[]): boolean => {
  const suspiciousDates = couponDates.filter(date => date.endsWith('-09'));
  if (suspiciousDates.length > 0) {
    console.warn("⚠️ Detectadas datas suspeitas (dia 09):", suspiciousDates);
    return true;
  }
  return false;
};

// ===================== DEFAULT STATE VALUES =====================
const getDefaultAtivo1 = (): AssetData => ({
  nome: '',
  codigo: '',
  tipoAtivo: 'debenture-incentivada',
  indexador: 'pre-fixada',
  tipoTaxa: 'pre-fixada', // Legacy field for backward compatibility
  taxa: 0,
  vencimento: '',
  valorInvestido: 0,
  couponData: { coupons: [], total: 0 },
  valorCurva: 0,
  valorVenda: 0,
  tipoCupom: 'nenhum',
  mesesCupons: '',
  tipoIR: 'isento',
  aliquotaIR: 15,
  rateKind: 'PRE',
  freq: 'SEMIANNUAL',
  earningsStartDate: '',
  activePeriods: [],
  periodicidadeDistribuicao: 'mensal'
});

const getDefaultAtivo2 = (): AssetData => ({
  nome: '',
  codigo: '',
  tipoAtivo: 'lci-lca',
  indexador: 'percentual-cdi',
  tipoTaxa: 'percentual-cdi', // Legacy field for backward compatibility
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

// Data migration function to handle legacy tipoTaxa field
const migrateAssetData = (asset: any): AssetData => {
  if (asset.tipoAtivo && asset.indexador) {
    // Already migrated
    return asset as AssetData;
  }
  
  // Legacy data migration
  const tipoTaxa = asset.tipoTaxa || 'pre-fixada';
  let tipoAtivo: AssetData['tipoAtivo'] = 'debenture-incentivada';
  let indexador: AssetData['indexador'] = tipoTaxa;
  
  // Try to infer asset type from existing data
  if (asset.nome?.toLowerCase().includes('lci') || asset.nome?.toLowerCase().includes('lca')) {
    tipoAtivo = 'lci-lca';
  } else if (asset.nome?.toLowerCase().includes('cdb')) {
    tipoAtivo = 'cdb';
  } else if (asset.nome?.toLowerCase().includes('cri') || asset.nome?.toLowerCase().includes('cra')) {
    tipoAtivo = 'cri-cra';
  } else if (asset.nome?.toLowerCase().includes('tesouro')) {
    tipoAtivo = 'tesouro-direto';
  } else if (asset.nome?.toLowerCase().includes('fundo') || asset.nome?.toLowerCase().includes('fii')) {
    tipoAtivo = 'fundo-cetipado';
  }
  
  return {
    ...asset,
    tipoAtivo,
    indexador,
    tipoTaxa, // Keep for backward compatibility
    periodicidadeDistribuicao: asset.periodicidadeDistribuicao || 'mensal'
  };
};

// Enhanced load function with migration
const loadAssetWithMigration = (key: string, defaultValue: AssetData): AssetData => {
  try {
    const item = localStorage.getItem(key);
    if (item) {
      const parsedItem = JSON.parse(item);
      return migrateAssetData(parsedItem);
    }
    return defaultValue;
  } catch (error) {
    console.error('Erro ao carregar e migrar dados:', error);
    return defaultValue;
  }
};

const InvestmentComparator = () => {
  const { toast } = useToast();
  const [ativo1, setAtivo1] = useState<AssetData>(() => 
    loadAssetWithMigration(STORAGE_KEYS.ativo1, getDefaultAtivo1())
  );
  const [ativo2, setAtivo2] = useState<AssetData>(() => 
    loadAssetWithMigration(STORAGE_KEYS.ativo2, getDefaultAtivo2())
  );
  const [projecoes, setProjecoes] = useState<Projecoes>(() => 
    loadProjectionsWithVersionCheck()
  );
  const [results, setResults] = useState<CalculationResult | null>(null);

  // ===================== BTDI11 CACHE CLEANUP ON MOUNT =====================
  useEffect(() => {
    console.log("🚀 Inicializando componente - verificando cache BTDI11...");
    clearBTDI11Data(); // Limpeza automática na inicialização
  }, []); // Executa apenas uma vez na montagem
  const [showResults, setShowResults] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastCalculationHash, setLastCalculationHash] = useState<string>('');
  const [calculationTimestamp, setCalculationTimestamp] = useState<number>(0);
  const [compactPdfMode, setCompactPdfMode] = useState(false);

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
      localStorage.setItem(STORAGE_KEYS.projecoes_version, PROJECTIONS_VERSION);
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

  const resetProjecoes = () => {
    const defaultProjecoes = getDefaultProjecoes();
    setProjecoes(defaultProjecoes);
    clearFromLocalStorage(STORAGE_KEYS.projecoes);
    localStorage.setItem(STORAGE_KEYS.projecoes_version, PROJECTIONS_VERSION);
    invalidateResults();
    toast({
      title: "Projeções restauradas",
      description: "Todas as projeções foram restauradas aos valores padrão.",
      variant: "default",
    });
  };

  // ===================== BTDI11 SPECIFIC RESET FUNCTION =====================
  const resetBTDI11Cache = () => {
    clearBTDI11Data();
    // Force reload of both assets to clear any cached data
    setAtivo1(loadAssetWithMigration(STORAGE_KEYS.ativo1, getDefaultAtivo1()));
    setAtivo2(loadAssetWithMigration(STORAGE_KEYS.ativo2, getDefaultAtivo2()));
    invalidateResults();
    toast({
      title: "🧼 Cache BTDI11 Limpo",
      description: "Todos os dados antigos do BTDI11 foram removidos. Os cupons agora serão gerados corretamente no dia 10.",
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
    const indexador = dados.indexador || dados.tipoTaxa || 'pre-fixada';
    switch (indexador) {
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
  const calcularAtivo = (dados: AssetData, anosProjecao: number, vencimentoReal?: number, dataLimite?: string): {
    valores: number[];
    imposto: number;
    couponDetails?: CouponResult[];
  } => {
    const periodosAtivo = vencimentoReal || anosProjecao;

    // Always use cash flow system when asset has coupons
    if (dados.tipoCupom !== 'nenhum') {
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
     
     // Etapa 1: Inferir freq e earningsStartDate baseado no nome
     let inferredEarningsStartDate = dados.earningsStartDate;
     let inferredFreq = mapCoupomFreq(dados.tipoCupom); // fallback para lógica atual

      // Detect asset type based on name for legacy compatibility, but prefer explicit tipoAtivo
      if (dados.nome?.toUpperCase().includes('CRA ZAMP') && !dados.tipoAtivo) {
        // Legacy support - but now should rely on tipoAtivo and mesesCupons fields
        console.log(`⚠️ CRA ZAMP detectado por nome - recomendado usar tipoAtivo='cri-cra' e mesesCupons='2,8'`);
        inferredEarningsStartDate = '2025-09-01';
        inferredFreq = 'SEMIANNUAL';
      } else if (dados.nome?.toUpperCase().includes('BTDI11')) {
        inferredEarningsStartDate = '2025-10-01';
        inferredFreq = 'MONTHLY';
      }

     // Etapa 3: Log para debug
     console.log(`🔧 Configurações inferidas para ${dados.nome}:`);
     console.log(`  📅 earningsStartDate: ${inferredEarningsStartDate}`);
     console.log(`  🔄 freq: ${inferredFreq}`);

      // Setup cash flow input
      const cashFlowInput: CouponEngineInput = {
        principal: dados.valorCurva,
        startISO,
        endISO,
        freq: inferredFreq,
        rateKind,
        taxaPreAA: rateKind === 'PRE' ? dados.taxa : undefined,
        taxaRealAA: rateKind === 'IPCA+PRE' ? dados.taxa : undefined,
        spreadPreAA: rateKind === 'CDI+PRE' ? dados.taxa : undefined,
        percCDI: rateKind === '%CDI' ? dados.taxa : undefined,
        cdiAABase: projecoes.cdi[new Date().getFullYear()] || 10,
        cdiCurve,
        ipcaCurve: projecoes.ipcaCurve,
        feesAA: 0,
        irRegressivo: dados.tipoIR === 'renda-fixa',
        // use252 will be determined dynamically based on asset type and indexer
        earningsStartDate: inferredEarningsStartDate,
        mesesCupons: dados.mesesCupons,
        tipoAtivo: dados.tipoAtivo
      };

     // Calculate cash flows
     // Check if this is a limited analysis (ending before asset's natural maturity)
     const isLimitedAnalysis = dataLimite && new Date(dataLimite) < new Date(dados.vencimento);
     console.log(`⚖️ Análise Limitada: ${isLimitedAnalysis ? 'SIM' : 'NÃO'}`);
     console.log(`💰 Taxa: ${dados.taxa}% a.a. (${rateKind})`);
     console.log(`🏢 Tipo de Ativo: ${dados.tipoAtivo}`);
     console.log(`📊 Indexador: ${dados.indexador || dados.tipoTaxa || 'pre-fixada'}`);
     
     const result = projectWithReinvestCDI(
       cashFlowInput, 
       isLimitedAnalysis, 
       dados.tipoAtivo, 
       dados.indexador || dados.tipoTaxa || 'pre-fixada'
     );

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
  // Função para calcular reinvestimento no CDI
  const calcularReinvestimentoCDI = (
    valorPrincipal: number, 
    dataInicio: Date, 
    dataFim: Date, 
    projecoes: Projecoes
  ): { valorFinal: number; rendimento: number; ir: number; valorLiquido: number; diasReinvestidos: number; taxaReinvestimento: number } => {
    const diasReinvestidos = Math.floor((dataFim.getTime() - dataInicio.getTime()) / (1000 * 60 * 60 * 24));
    
    // Calculate average CDI for reinvestment period
    const anoInicio = dataInicio.getFullYear();
    const anoFim = dataFim.getFullYear();
    let cdiMedio = 0;
    
    if (anoInicio === anoFim) {
      cdiMedio = projecoes.cdi[anoInicio] || 10;
    } else {
      const anosReinvestimento = [];
      for (let ano = anoInicio; ano <= anoFim; ano++) {
        anosReinvestimento.push(projecoes.cdi[ano] || 10);
      }
      cdiMedio = anosReinvestimento.reduce((a, b) => a + b, 0) / anosReinvestimento.length;
    }
    
    // CDI daily compounding (252 business days)
    const cdiDaily = Math.pow(1 + (cdiMedio / 100), 1/252) - 1;
    const diasUteis = Math.floor(diasReinvestidos * (252 / 365)); // Convert to business days
    
    const valorFinal = valorPrincipal * Math.pow(1 + cdiDaily, diasUteis);
    const rendimento = valorFinal - valorPrincipal;
    
    // IR regressivo sobre rendimento CDI
    const ir = rendimento * irAliquotaRegressivo(diasReinvestidos);
    const valorLiquido = valorFinal - ir;
    
    console.log(`💰 REINVESTIMENTO CDI:`);
    console.log(`📅 Período: ${dataInicio.toLocaleDateString()} até ${dataFim.toLocaleDateString()}`);
    console.log(`⏰ Dias: ${diasReinvestidos} (${diasUteis} dias úteis)`);
    console.log(`📈 CDI Médio: ${cdiMedio.toFixed(2)}% a.a.`);
    console.log(`💵 Principal: R$ ${valorPrincipal.toLocaleString('pt-BR')}`);
    console.log(`💸 Valor Final: R$ ${valorFinal.toLocaleString('pt-BR')}`);
    console.log(`💎 Rendimento: R$ ${rendimento.toLocaleString('pt-BR')}`);
    console.log(`🧾 IR (${(irAliquotaRegressivo(diasReinvestidos) * 100).toFixed(1)}%): R$ ${ir.toLocaleString('pt-BR')}`);
    console.log(`🏆 Valor Líquido: R$ ${valorLiquido.toLocaleString('pt-BR')}`);
    
    return { valorFinal, rendimento, ir, valorLiquido, diasReinvestidos, taxaReinvestimento: cdiMedio };
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

      // 🚀 NOVA LÓGICA DE REINVESTIMENTO INTELIGENTE
      const diferencaDias = Math.abs(vencimento1.getTime() - vencimento2.getTime()) / (1000 * 60 * 60 * 24);
      let resultAtivo1, resultAtivo2, reinvestimentoInfo;
      let anosProjecao;

      console.log(`🔍 ANÁLISE DE VENCIMENTOS:`);
      console.log(`📅 Ativo 1 (${ativo1.nome}): ${vencimento1.toLocaleDateString()} (${anosAtivo1} anos)`);
      console.log(`📅 Ativo 2 (${ativo2.nome}): ${vencimento2.toLocaleDateString()} (${anosAtivo2} anos)`);
      console.log(`⏰ Diferença: ${diferencaDias.toFixed(0)} dias`);

      // 🎯 NOVA LÓGICA: Comparar ambos os ativos até o vencimento do Ativo 2 (prazo mais curto)
      console.log(`🚀 COMPARAÇÃO ATÉ VENCIMENTO DO ATIVO 2 - PRAZO LIMITADO`);
      
      // Para CRA ZAMP (Eneva), limitar a comparação até 30/04/2029
      let dataFinal = vencimento2; // Default: usa o vencimento do ativo 2
      
      // Implementar lógica de comparação baseada nos vencimentos para todos os tipos de ativos
      console.log(`📅 Aplicando lógica de comparação por vencimentos para todos os ativos`);
      
      if (vencimento1 < vencimento2) {
        // Cenário A: Ativo 1 vence antes - reinvestir em CDI até vencimento do Ativo 2
        console.log(`💰 Ativo 1 vence antes (${vencimento1.toLocaleDateString()}) - reinvestindo em CDI até vencimento do Ativo 2 (${vencimento2.toLocaleDateString()})`);
        dataFinal = vencimento2; // Comparar até vencimento do Ativo 2
      } else {
        // Cenário B: Ativo 1 vence depois - comparar apenas até vencimento do Ativo 2
        console.log(`📊 Ativo 1 vence depois (${vencimento1.toLocaleDateString()}) - limitando comparação até vencimento do Ativo 2 (${vencimento2.toLocaleDateString()})`);
        dataFinal = vencimento2; // Limitar comparação até vencimento do Ativo 2
      }
      
      console.log(`📅 Data final da comparação: ${dataFinal.toLocaleDateString()}`);
      
      
      const anosAteDataFinal = Math.ceil((dataFinal.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
      anosProjecao = anosAteDataFinal;
      
      console.log(`📅 Data final da comparação: ${dataFinal.toISOString().slice(0, 10)} (${anosAteDataFinal.toFixed(2)} anos)`);
      
      // Calcular ambos os ativos baseado nos cenários de vencimento
      if (vencimento1 < vencimento2) {
        console.log(`💰 CENÁRIO A: Ativo 1 vence antes - calculando até vencimento natural e reinvestindo em CDI`);
        
        // Calcular Ativo 1 até seu vencimento natural
        resultAtivo1 = calcularAtivo(ativo1, anosAtivo1);
        
        // Calcular Ativo 2 até seu vencimento natural
        resultAtivo2 = calcularAtivo(ativo2, anosAtivo2);
        
        // Calcular reinvestimento do Ativo 1 em CDI até o vencimento do Ativo 2
        const valorLiquidoAtivo1 = resultAtivo1.valores[resultAtivo1.valores.length - 1] - resultAtivo1.imposto;
        const reinvestmentCDI = calcularReinvestimentoCDI(valorLiquidoAtivo1, vencimento1, vencimento2, projecoes);
        
        // Atualizar resultado do Ativo 1 com o valor final após reinvestimento
        resultAtivo1.valores[resultAtivo1.valores.length - 1] = reinvestmentCDI.valorLiquido;
        resultAtivo1.imposto += reinvestmentCDI.ir;
        
        reinvestimentoInfo = {
          ativoReinvestido: 'ativo1',
          valorResgatado: valorLiquidoAtivo1,
          periodosReinvestimento: reinvestmentCDI.diasReinvestidos,
          taxaReinvestimento: reinvestmentCDI.taxaReinvestimento,
          valorFinalReinvestimento: reinvestmentCDI.valorFinal,
          dataInicioReinvestimento: vencimento1.toISOString(),
          dataFimReinvestimento: vencimento2.toISOString(),
          diasReinvestidos: reinvestmentCDI.diasReinvestidos,
          rendimentoReinvestimento: reinvestmentCDI.rendimento,
          irReinvestimento: reinvestmentCDI.ir,
          valorTotalComReinvestimento: reinvestmentCDI.valorLiquido
        };
        
        console.log(`💰 Reinvestimento CDI: R$ ${valorLiquidoAtivo1.toLocaleString()} → R$ ${reinvestmentCDI.valorLiquido.toLocaleString()}`);
        
      } else if (vencimento1 > vencimento2) {
        console.log(`📊 CENÁRIO B: Ativo 1 vence depois - limitando comparação até vencimento do Ativo 2`);
        
        // Calcular Ativo 1 apenas até a data final (vencimento do Ativo 2) - TRUNCANDO CUPONS
        resultAtivo1 = calcularAtivo(ativo1, anosAteDataFinal, undefined, ativo2.vencimento);
        
        // Calcular Ativo 2 até seu vencimento natural
        resultAtivo2 = calcularAtivo(ativo2, anosAtivo2);
        
        reinvestimentoInfo = null;
        
      } else {
        console.log(`💎 CENÁRIO C: Ambos os ativos têm vencimentos similares`);
        
        // Calcular ambos normalmente até seus vencimentos
        resultAtivo1 = calcularAtivo(ativo1, anosAteDataFinal);
        resultAtivo2 = calcularAtivo(ativo2, anosAtivo2);
        
        reinvestimentoInfo = null;
      }

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
    setAtivo1(getDefaultAtivo1());
    setAtivo2(getDefaultAtivo2());
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
    const indexador = asset.indexador || asset.tipoTaxa || 'pre-fixada';
    
    if (asset.tipoAtivo === 'fundo-cetipado') {
      const periodicidade = asset.periodicidadeDistribuicao || 'mensal';
      return `Fundo/${periodicidade === 'mensal' ? 'mês' : 'trimestre'}`;
    }
    
    switch (indexador) {
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

  const getTipoAtivoDisplay = (tipoAtivo: string) => {
    switch (tipoAtivo) {
      case 'debenture-incentivada':
        return 'Debênture Incentivada';
      case 'cri-cra':
        return 'CRI/CRA';
      case 'lci-lca':
        return 'LCI/LCA';
      case 'cdb':
        return 'CDB';
      case 'fundo-cetipado':
        return 'Fundo Cetipado (FII)';
      case 'tesouro-direto':
        return 'Tesouro Direto';
      default:
        return tipoAtivo;
    }
  };

  const getIndexadorDisplay = (indexador: string) => {
    switch (indexador) {
      case 'pre-fixada':
        return 'Pré-fixada';
      case 'percentual-cdi':
        return '% CDI';
      case 'cdi-mais':
        return 'CDI + Taxa Pré';
      case 'ipca-mais':
        return 'IPCA + Taxa Pré';
      default:
        return indexador;
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
    // Special handling for Fundo Cetipado (FII)
    if (asset.tipoAtivo === 'fundo-cetipado') {
      return 'Isento (Distribuições)';
    }
    
    // Special handling for CDB with regressive IR
    if (asset.tipoAtivo === 'cdb') {
      const aliquota = calcularAliquotaIR(asset, anosProjecao);
      return `${aliquota}% (Tabela Regressiva)`;
    }
    
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
            <Label htmlFor={`${assetKey}-tipoAtivo`}>Tipo de Ativo</Label>
            <Select value={asset.tipoAtivo} onValueChange={value => handleAssetChange(assetKey, 'tipoAtivo', value)}>
              <SelectTrigger className="bg-background border-border z-50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-border shadow-lg z-50">
                <SelectItem value="debenture-incentivada">Debênture Incentivada</SelectItem>
                <SelectItem value="cri-cra">CRI/CRA</SelectItem>
                <SelectItem value="lci-lca">LCI/LCA</SelectItem>
                <SelectItem value="cdb">CDB</SelectItem>
                <SelectItem value="fundo-cetipado">Fundo Cetipado (FII)</SelectItem>
                <SelectItem value="tesouro-direto">Tesouro Direto</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${assetKey}-indexador`}>Indexador</Label>
            <Select value={asset.indexador} onValueChange={value => {
              handleAssetChange(assetKey, 'indexador', value);
              handleAssetChange(assetKey, 'tipoTaxa', value); // Keep legacy field in sync
            }}>
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
            <Label htmlFor={`${assetKey}-taxa`}>{getTaxaLabel(asset.indexador || asset.tipoTaxa || 'pre-fixada')}</Label>
            <Input 
              id={`${assetKey}-taxa`} 
              type="number" 
              step="0.01" 
              value={asset.taxa} 
              onChange={e => handleAssetChange(assetKey, 'taxa', parseFloat(e.target.value) || 0)} 
              placeholder={getTaxaPlaceholder(asset.indexador || asset.tipoTaxa || 'pre-fixada')} 
            />
          </div>
          {asset.tipoAtivo === 'fundo-cetipado' && (
            <div className="space-y-2">
              <Label htmlFor={`${assetKey}-periodicidade`}>Periodicidade</Label>
              <Select value={asset.periodicidadeDistribuicao || 'mensal'} onValueChange={value => handleAssetChange(assetKey, 'periodicidadeDistribuicao', value)}>
                <SelectTrigger className="bg-background border-border z-50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border-border shadow-lg z-50">
                  <SelectItem value="mensal">Mensal</SelectItem>
                  <SelectItem value="trimestral">Trimestral</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
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
  return <div className={`min-h-screen bg-background p-4 print:p-0 ${compactPdfMode ? 'compact-pdf-mode' : ''}`}>
      {/* Print Header - Hidden on screen, visible in PDF */}
      <div className="print-header hidden">
        <h1 className="print-title">RELATÓRIO DE ANÁLISE COMPARATIVA DE INVESTIMENTOS</h1>
        <p className="print-subtitle">
          Análise detalhada de ativos de renda fixa • Gerado em {new Date().toLocaleDateString('pt-BR')}
        </p>
      </div>

      <div className="container mx-auto max-w-7xl print:max-w-none">
        {/* Header */}
        <div className="text-center mb-8 print-hide">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="p-3 bg-gradient-to-br from-financial-primary to-financial-secondary rounded-xl">
              <TrendingUp className="h-8 w-8 text-white" />
            </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-financial-primary to-financial-secondary bg-clip-text text-transparent">
            Análise - Troca de Ativos
          </h1>
          </div>
          
          <Separator className="mt-6" />
        </div>

        {/* Asset Forms */}
        <div className="grid grid-cols-1 gap-6 mb-6 print:gap-3 print:mb-3 print:hidden">
          {renderAssetForm(ativo1, 'ativo1', `📊 ${ativo1.nome || 'Ativo 1'}`, 'financial-primary')}
          
          <div className="flex items-center justify-center xl:hidden">
            <div className="p-3 bg-gradient-to-r from-financial-primary to-financial-secondary rounded-full">
              <ArrowRight className="h-6 w-6 text-white rotate-90 xl:rotate-0" />
            </div>
          </div>
          
          {renderAssetForm(ativo2, 'ativo2', `📈 ${ativo2.nome || 'Ativo 2'}`, 'financial-secondary')}
        </div>

        {/* CDI Projections */}
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 print:gap-3 print:mb-3 print:hidden ${compactPdfMode ? 'compact-pdf-hide' : ''}`}>
          {/* CDI Projections */}
          <Card className="border-financial-secondary/20 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-financial-secondary to-financial-primary text-white rounded-t-lg">
              <CardTitle className="flex justify-between items-center">
                📈 Projeção CDI (%)
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetProjecoes}
                  className="bg-white/10 text-white border-white/20 hover:bg-white/20"
                >
                  Restaurar Padrões
                </Button>
              </CardTitle>
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
        <div className="flex flex-wrap justify-center gap-4 mb-8 print:hidden">
          <Button onClick={calcular} size="lg" className="bg-gradient-to-r from-financial-primary to-financial-secondary hover:from-financial-secondary hover:to-financial-primary text-white font-bold shadow-lg transform transition-all duration-300 hover:scale-105">
            <Calculator className="h-5 w-5 mr-2" />
            🔄 Calcular Comparação
            {hasUnsavedChanges && <span className="ml-2 text-yellow-300 animate-pulse">●</span>}
          </Button>
          <Button variant="outline" onClick={limparDados} size="lg" className="border-financial-danger text-financial-danger hover:bg-financial-danger hover:text-white">
            <Trash2 className="h-5 w-5 mr-2" />
            🗑️ Limpar Dados
          </Button>
          <Button variant="outline" onClick={resetBTDI11Cache} size="lg" className="border-yellow-500 text-yellow-600 hover:bg-yellow-500 hover:text-white">
            🧼 Reset BTDI11 Cache
          </Button>
          <Button variant="outline" onClick={() => window.print()} size="lg" className="border-financial-primary text-financial-primary hover:bg-financial-primary hover:text-white">
            <Printer className="h-5 w-5 mr-2" />
            🖨️ PDF Completo
          </Button>
          <Button 
            variant="outline" 
            onClick={() => {
              setCompactPdfMode(true);
              setTimeout(() => {
                window.print();
                // Wait longer for print dialog to fully process the compact styles
                setTimeout(() => {
                  setCompactPdfMode(false);
                }, 2000);
              }, 300);
            }} 
            size="lg" 
            className="border-blue-500 text-blue-600 hover:bg-blue-500 hover:text-white"
          >
            <Printer className="h-5 w-5 mr-2" />
            📄 PDF Compacto
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
            {/* Executive Summary for PDF */}
            <div className={`print-show hidden print-summary ${compactPdfMode ? 'compact-pdf-hide' : ''}`}>
              <h2 className="print-section-title">RESUMO EXECUTIVO</h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <strong>Período de Análise:</strong> {Math.round((new Date(ativo2.vencimento).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} dias
                </div>
                <div>
                  <strong>Data de Comparação:</strong> {new Date(ativo2.vencimento).toLocaleDateString('pt-BR')}
                </div>
                <div>
                  <strong>Melhor Investimento:</strong> {results.ativo1[results.ativo1.length - 1] > results.ativo2[results.ativo2.length - 1] ? 'Ativo 1' : 'Ativo 2'}
                </div>
                <div>
                  <strong>Diferença:</strong> R$ {formatCurrency(Math.abs(results.ativo1[results.ativo1.length - 1] - results.ativo2[results.ativo2.length - 1]))}
                </div>
              </div>
            </div>

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
            
            {/* Print-Only Executive Summary and Analysis - NEW */}
            <div className={`print-show hidden ${compactPdfMode ? 'compact-pdf-hide' : ''}`}>
              {/* Print Header */}
              <div className="print-header">
                <div className="print-title">ANÁLISE COMPARATIVA</div>
                <div className="print-subtitle">
                  {ativo1.nome || 'Ativo 1'} vs {ativo2.nome || 'Ativo 2'} • {new Date().toLocaleDateString('pt-BR')}
                </div>
              </div>

              {/* Executive Summary Section */}
              <div className="print-section">
                <h3 className="print-section-title">RESUMO EXECUTIVO - SITUAÇÃO ATUAL</h3>
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>Papel</th>
                      <th>Valor Investido</th>
                      <th>Valor Venda/Curva</th>
                      <th>Cupons Recebidos</th>
                      <th>Total Disponível</th>
                      <th>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{ativo1.nome || 'Ativo 1'}</td>
                      <td>{formatCurrency(ativo1.valorInvestido)}</td>
                      <td>{formatCurrency(results.ativo1[results.ativo1.length - 1])}</td>
                      <td>{formatCurrency(ativo1.couponData?.total || 0)}</td>
                      <td>{formatCurrency((results.ativo1[results.ativo1.length - 1]) + (ativo1.couponData?.total || 0))}</td>
                      <td style={{color: ((results.ativo1[results.ativo1.length - 1]) + (ativo1.couponData?.total || 0) - ativo1.valorInvestido) >= 0 ? '#22c55e' : '#ef4444'}}>
                        {formatCurrency((results.ativo1[results.ativo1.length - 1]) + (ativo1.couponData?.total || 0) - ativo1.valorInvestido)}
                      </td>
                    </tr>
                    <tr>
                      <td>{ativo2.nome || 'Ativo 2'}</td>
                      <td>{formatCurrency(ativo2.valorInvestido)}</td>
                      <td>{formatCurrency(results.ativo2[results.ativo2.length - 1])}</td>
                      <td>{formatCurrency(ativo2.couponData?.total || 0)}</td>
                      <td>{formatCurrency((results.ativo2[results.ativo2.length - 1]) + (ativo2.couponData?.total || 0))}</td>
                      <td style={{color: ((results.ativo2[results.ativo2.length - 1]) + (ativo2.couponData?.total || 0) - ativo2.valorInvestido) >= 0 ? '#22c55e' : '#ef4444'}}>
                        {formatCurrency((results.ativo2[results.ativo2.length - 1]) + (ativo2.couponData?.total || 0) - ativo2.valorInvestido)}
                      </td>
                    </tr>
                    <tr style={{fontWeight: 'bold', backgroundColor: '#f8f9fa'}}>
                      <td>TOTAL</td>
                      <td>{formatCurrency(ativo1.valorInvestido + ativo2.valorInvestido)}</td>
                      <td>{formatCurrency(results.ativo1[results.ativo1.length - 1] + results.ativo2[results.ativo2.length - 1])}</td>
                      <td>{formatCurrency((ativo1.couponData?.total || 0) + (ativo2.couponData?.total || 0))}</td>
                      <td>{formatCurrency((results.ativo1[results.ativo1.length - 1]) + (ativo1.couponData?.total || 0) + (results.ativo2[results.ativo2.length - 1]) + (ativo2.couponData?.total || 0))}</td>
                      <td style={{color: ((results.ativo1[results.ativo1.length - 1]) + (ativo1.couponData?.total || 0) + (results.ativo2[results.ativo2.length - 1]) + (ativo2.couponData?.total || 0) - ativo1.valorInvestido - ativo2.valorInvestido) >= 0 ? '#22c55e' : '#ef4444'}}>
                        {formatCurrency((results.ativo1[results.ativo1.length - 1]) + (ativo1.couponData?.total || 0) + (results.ativo2[results.ativo2.length - 1]) + (ativo2.couponData?.total || 0) - ativo1.valorInvestido - ativo2.valorInvestido)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Economic Projections Section */}
              <div className="print-section">
                <h3 className="print-section-title">PROJEÇÕES ECONÔMICAS UTILIZADAS</h3>
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
                  <div>
                    <table className="print-table">
                      <thead>
                        <tr><th colSpan={2}>CDI (%)</th></tr>
                        <tr><th>Ano</th><th>Taxa</th></tr>
                      </thead>
                      <tbody>
                        {Object.entries(projecoes.cdi).map(([ano, taxa]) => (
                          <tr key={ano}>
                            <td>{ano}</td>
                            <td>{taxa}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <table className="print-table">
                      <thead>
                        <tr><th colSpan={2}>IPCA (%)</th></tr>
                        <tr><th>Ano</th><th>Taxa</th></tr>
                      </thead>
                      <tbody>
                        {Object.entries(projecoes.ipca).map(([ano, taxa]) => (
                          <tr key={ano}>
                            <td>{ano}</td>
                            <td>{taxa}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Scenario Analysis */}
              <div className="print-section">
                <h3 className="print-section-title">ANÁLISE DE CENÁRIOS</h3>
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
                  <div>
                    <h4 style={{fontSize: '12px', fontWeight: 'bold', marginBottom: '0.5rem'}}>Cenário 1 - Manter Carteira Atual</h4>
                    <table className="print-table">
                      <thead>
                        <tr>
                          <th>Papel</th>
                          <th>Rentabilidade</th>
                          <th>Valor Final Est.</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{ativo1.nome || 'Ativo 1'}</td>
                          <td>{getTaxaLabel(ativo1.indexador || ativo1.tipoTaxa || 'pre-fixada')}</td>
                          <td>{formatCurrency((results.ativo1[results.ativo1.length - 1]) + (ativo1.couponData?.total || 0))}</td>
                        </tr>
                        <tr>
                          <td>{ativo2.nome || 'Ativo 2'}</td>
                          <td>{getTaxaLabel(ativo2.indexador || ativo2.tipoTaxa || 'pre-fixada')}</td>
                          <td>{formatCurrency((results.ativo2[results.ativo2.length - 1]) + (ativo2.couponData?.total || 0))}</td>
                        </tr>
                        <tr style={{fontWeight: 'bold'}}>
                          <td>TOTAL</td>
                          <td>-</td>
                          <td>{formatCurrency((results.ativo1[results.ativo1.length - 1]) + (ativo1.couponData?.total || 0) + (results.ativo2[results.ativo2.length - 1]) + (ativo2.couponData?.total || 0))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  
                  <div>
                    <h4 style={{fontSize: '12px', fontWeight: 'bold', marginBottom: '0.5rem'}}>Cenário 2 - Migração Total para {ativo2.nome || 'Ativo 2'}</h4>
                    <table className="print-table">
                      <thead>
                        <tr>
                          <th>Descrição</th>
                          <th>Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Valor Total Migrado</td>
                          <td>{formatCurrency(ativo1.valorInvestido + ativo2.valorInvestido)}</td>
                        </tr>
                        <tr>
                          <td>Rentabilidade</td>
                          <td>{getTaxaLabel(ativo2.indexador || ativo2.tipoTaxa || 'pre-fixada')}</td>
                        </tr>
                        <tr>
                          <td>Valor Final Estimado</td>
                          <td>{formatCurrency(((results.ativo2[results.ativo2.length - 1]) + (ativo2.couponData?.total || 0)) * (ativo1.valorInvestido + ativo2.valorInvestido) / ativo2.valorInvestido)}</td>
                        </tr>
                        <tr style={{fontWeight: 'bold', color: (((results.ativo2[results.ativo2.length - 1]) + (ativo2.couponData?.total || 0)) * (ativo1.valorInvestido + ativo2.valorInvestido) / ativo2.valorInvestido) > ((results.ativo1[results.ativo1.length - 1]) + (ativo1.couponData?.total || 0) + (results.ativo2[results.ativo2.length - 1]) + (ativo2.couponData?.total || 0)) ? '#22c55e' : '#ef4444'}}>
                          <td>Vantagem vs Cenário 1</td>
                          <td>{formatCurrency((((results.ativo2[results.ativo2.length - 1]) + (ativo2.couponData?.total || 0)) * (ativo1.valorInvestido + ativo2.valorInvestido) / ativo2.valorInvestido) - ((results.ativo1[results.ativo1.length - 1]) + (ativo1.couponData?.total || 0) + (results.ativo2[results.ativo2.length - 1]) + (ativo2.couponData?.total || 0)))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Asset Characteristics */}
              <div className="print-section">
                <h3 className="print-section-title">{ativo2.nome || 'ATIVO 2'} - CARACTERÍSTICAS PRINCIPAIS</h3>
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Rentabilidade</th>
                      <th>Tributação</th>
                      <th>Distribuição</th>
                      <th>Prazo</th>
                      <th>Gestão</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{getTipoAtivoDisplay(ativo2.tipoAtivo)}</td>
                      <td>{getTaxaLabel(ativo2.indexador || ativo2.tipoTaxa || 'pre-fixada')}</td>
                      <td>{getIRDisplay(ativo2, results?.anosProjecao || 0)}</td>
                      <td>{ativo2.periodicidadeDistribuicao || 'N/A'}</td>
                      <td>{ativo2.vencimento ? new Date(ativo2.vencimento).toLocaleDateString('pt-BR') : 'Indefinido'}</td>
                      <td>N/A</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            
            {/* Executive Summary - Restructured into Two Separate Tables (Screen View) */}
            <div className="space-y-6 print-section print:hidden">
              <div className="print-show hidden">
                <h2 className="print-section-title">ANÁLISE DETALHADA DOS INVESTIMENTOS</h2>
              </div>
              
              {/* Table 1 - CRA ZAMP with Early Sale Analysis */}
              <Card className={`border-financial-success/30 shadow-xl no-page-break ${compactPdfMode ? 'compact-pdf-only' : ''}`}>
                <CardHeader className="bg-gradient-to-r from-financial-success to-blue-600 text-white rounded-t-lg print-hide">
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    {ativo1.nome} - Análise de Venda Antecipada
                  </CardTitle>
                </CardHeader>
                
                {/* Print-optimized header */}
                <div className="print-show hidden">
                  <h3 className="print-section-title">{ativo1.nome} - ANÁLISE DE VENDA ANTECIPADA</h3>
                </div>

                <CardContent className="p-6 print:p-2">
                  {/* Screen view - existing grid layout */}
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 text-sm print-hide print:gap-2">
                    {/* ... keep existing grid content */}
                    <div className="space-y-3">
                      <div>
                        <span className="text-muted-foreground">Tipo de Ativo:</span>
                        <div className="font-mono font-semibold">{getTipoAtivoDisplay(ativo1.tipoAtivo)}</div>
                      </div>
                      {ativo1.tipoAtivo !== 'fundo-cetipado' && (
                        <div>
                          <span className="text-muted-foreground">Indexador:</span>
                          <div className="font-mono font-semibold">{getIndexadorDisplay(ativo1.indexador)}</div>
                        </div>
                      )}
              {ativo1.tipoAtivo !== 'fundo-cetipado' && (
                <div>
                  <span className="text-muted-foreground">Taxa:</span>
                  <div className="font-mono font-semibold">{getTaxaDisplay(ativo1)}</div>
                </div>
              )}
              {ativo1.tipoAtivo === 'fundo-cetipado' && (
                <div>
                  <span className="text-muted-foreground">Distribuição:</span>
                  <div className="font-mono font-semibold">{getTaxaDisplay(ativo1)}</div>
                </div>
              )}
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
                        <div className="font-mono font-semibold">R$ {formatCurrency(ativo1.valorInvestido)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Valor de Curva:</span>
                        <div className="font-mono font-semibold">R$ {formatCurrency(ativo1.valorCurva)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Cupons Recebidos:</span>
                        <div className="font-mono font-semibold text-financial-success">R$ {formatCurrency(ativo1.couponData.total)}</div>
                      </div>
                      {ativo1.valorVenda && (
                        <div>
                          <span className="text-muted-foreground">Valor de Venda:</span>
                          <div className="font-mono font-semibold text-blue-600">R$ {formatCurrency(ativo1.valorVenda)}</div>
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
                                    {isPositivo ? '+' : ''}R$ {formatCurrency(resultadoVenda)}
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
                  
                  {/* Print-optimized table */}
                  <div className="print-show hidden">
                    <table className="print-table">
                      <thead>
                        <tr>
                          <th>Tipo de Ativo</th>
                          <th>Indexador</th>
                          <th>Taxa</th>
                          <th>Valor de Compra</th>
                          <th>Valor de Curva</th>
                          <th>Cupons Recebidos</th>
                          <th>Valor de Venda</th>
                          <th>Resultado</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{getTipoAtivoDisplay(ativo1.tipoAtivo)}</td>
                          <td>{ativo1.tipoAtivo !== 'fundo-cetipado' ? getIndexadorDisplay(ativo1.indexador) : '-'}</td>
                          <td>{getTaxaDisplay(ativo1)}</td>
                          <td>R$ {formatCurrency(ativo1.valorInvestido)}</td>
                          <td>R$ {formatCurrency(ativo1.valorCurva)}</td>
                          <td>R$ {formatCurrency(ativo1.couponData.total)}</td>
                          <td>{ativo1.valorVenda ? `R$ ${formatCurrency(ativo1.valorVenda)}` : '-'}</td>
                          <td className={ativo1.valorVenda ? 'print-highlight' : ''}>
                            {ativo1.valorVenda ? 
                              `R$ ${formatCurrency(ativo1.valorVenda + ativo1.couponData.total - ativo1.valorInvestido)}` 
                              : 'Aguardando valor de venda'
                            }
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Table 2 - BTDI11 Characteristics */}
              <Card key="ativo2-btdi11-card" className={`border-financial-info/30 shadow-xl ${compactPdfMode ? 'compact-pdf-only' : ''}`}>
                <CardHeader className="bg-gradient-to-r from-financial-info to-blue-600 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2 text-lg font-bold">
                    <BarChart3 className="h-6 w-6" />
                    Informações - Ativo 2
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    {/* Coluna 1 - Características Básicas */}
                    <div className="space-y-3">
                      <div>
                        <span className="text-muted-foreground">Tipo de Ativo:</span>
                        <div className="font-mono font-semibold">{getTipoAtivoDisplay(ativo2.tipoAtivo)}</div>
                      </div>
                      {ativo2.tipoAtivo !== 'fundo-cetipado' && (
                        <div>
                          <span className="text-muted-foreground">Indexador:</span>
                          <div className="font-mono font-semibold">{getIndexadorDisplay(ativo2.indexador)}</div>
                        </div>
                      )}
                      {ativo2.tipoAtivo !== 'fundo-cetipado' && (
                        <div>
                          <span className="text-muted-foreground">Taxa:</span>
                          <div className="font-mono font-semibold">{getTaxaDisplay(ativo2) || 'N/A'}</div>
                        </div>
                      )}
                      {ativo2.tipoAtivo === 'fundo-cetipado' && (
                        <div>
                          <span className="text-muted-foreground">Distribuição:</span>
                          <div className="font-mono font-semibold">{getTaxaDisplay(ativo2) || 'N/A'}</div>
                        </div>
                      )}
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
                        <div className="font-mono font-semibold">R$ {formatCurrency(ativo2?.valorInvestido || 0)}</div>
                      </div>
                        <div>
                          <span className="text-muted-foreground">Taxa:</span>
                          <div className="font-mono font-semibold">
                            {(() => {
                              if (!ativo2) return "N/A";
                              
                              const taxa = ativo2.taxa || 0;
                              
                              // Para BTDI11, sempre mostra como CDI + X%
                              if (ativo2.nome && ativo2.nome.includes('BTDI11')) {
                                return `CDI + ${taxa.toFixed(1)}%`;
                              }
                              
                              const rateKind = ativo2.rateKind || ativo2.indexador;
                              
                              switch (rateKind) {
                                case '%CDI':
                                  return `${taxa.toFixed(1)}% do CDI`;
                                case 'CDI+PRE':
                                  return `CDI + ${taxa.toFixed(1)}%`;
                                case 'PRE':
                                  return `CDI + ${taxa.toFixed(1)}%`;
                                case 'IPCA+PRE':
                                  return `IPCA + ${taxa.toFixed(1)}%`;
                                default:
                                  return `CDI + ${taxa.toFixed(1)}%`;
                              }
                            })()}
                          </div>
                        </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>



            
            {/* Decomposição Detalhada dos Valores Finais */}
            <Card className={`border-financial-primary/30 shadow-xl ${compactPdfMode ? 'compact-pdf-only' : ''}`}>
              <CardHeader className="bg-gradient-to-r from-financial-primary to-financial-secondary text-white rounded-t-lg print:hidden">
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5" />
                  Decomposição Detalhada dos Valores Finais
                </CardTitle>
              </CardHeader>
              
              {/* Print-only compact header */}
              <div className="hidden print:block print-decomposition-section">
                <h3 className="print-section-header">DECOMPOSIÇÃO DETALHADA DOS VALORES FINAIS</h3>
              </div>
              
              <CardContent className="p-6 print:p-0">
                {(() => {
                  const currentHash = generateDataHash();
                  const isDataFresh = currentHash === lastCalculationHash;
                  
                  if (!isDataFresh || hasUnsavedChanges || !results.ativo1 || !results.ativo2) {
                    return (
                      <div className="text-center py-8 text-muted-foreground print:hidden">
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
                    <>
                      {/* Screen view - existing grid layout */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 print:hidden">
                        {/* ... keep existing screen content ... */}
                        <div className="space-y-4">
                          <h3 className="text-xl font-bold text-financial-primary border-b border-financial-primary/30 pb-2">
                            {ativo1.nome}
                          </h3>
                          
                          <div className="space-y-3">
                            <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                              <span className="font-semibold">Principal Investido:</span>
                              <span className="font-mono text-lg">R$ {formatCurrency(breakdown1.principalInvestido)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center p-3 bg-financial-success/10 rounded-lg border border-financial-success/30">
                              <span className="font-semibold text-financial-success">Cupons Brutos Recebidos:</span>
                              <span className="font-mono text-lg text-financial-success">+ R$ {formatCurrency(breakdown1.cupomsBrutos)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center p-3 bg-financial-danger/10 rounded-lg border border-financial-danger/30">
                              <span className="font-semibold text-financial-danger">IR sobre Cupons:</span>
                              <span className="font-mono text-lg text-financial-danger">- R$ {formatCurrency(breakdown1.irSobreCupons)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center p-3 bg-financial-success/10 rounded-lg border border-financial-success/30">
                              <span className="font-semibold text-financial-success">Cupons Líquidos:</span>
                              <span className="font-mono text-lg text-financial-success">= R$ {formatCurrency(breakdown1.cuponsLiquidos)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center p-3 bg-financial-info/10 rounded-lg border border-financial-info/30">
                              <span className="font-semibold text-financial-info">Rendimento sobre cupons:</span>
                              <span className="font-mono text-lg text-financial-info">R$ {formatCurrency(breakdown1.rendimentoSobreCupons)}</span>
                            </div>

                            <div className="space-y-2">
                              <div className="flex justify-between items-center p-3 bg-financial-warning/10 rounded-lg border border-financial-warning/30">
                                <span className="font-semibold text-financial-warning flex items-center gap-2">
                                  <TrendingUp className="h-4 w-4" />
                                  Valor após vencimento reaplicado no CDI:
                                </span>
                                <span className="font-mono text-lg text-financial-warning font-bold">
                                  + R$ {results.reinvestimento && results.reinvestimento.ativoReinvestido === 'ativo1' 
                                    ? formatCurrency(results.reinvestimento.valorFinalReinvestimento - results.reinvestimento.valorResgatado)
                                    : '0,00'
                                  }
                                </span>
                              </div>
                            </div>
                            
                            <div className="flex justify-between items-center p-4 bg-gradient-to-r from-financial-primary/20 to-financial-secondary/20 rounded-lg border-2 border-financial-primary/50">
                              <span className="font-bold text-financial-primary text-lg">VALOR FINAL:</span>
                              <span className="font-mono text-xl font-bold text-financial-primary">R$ {formatCurrency(breakdown1.valorFinal)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h3 className="text-xl font-bold text-financial-primary border-b border-financial-primary/30 pb-2">
                            {ativo2.nome}
                          </h3>
                          
                          <div className="space-y-3">
                            <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                              <span className="font-semibold">Principal Investido:</span>
                              <span className="font-mono text-lg">R$ {formatCurrency(breakdown2.principalInvestido)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center p-3 bg-financial-success/10 rounded-lg border border-financial-success/30">
                              <span className="font-semibold text-financial-success">Cupons Brutos Recebidos:</span>
                              <span className="font-mono text-lg text-financial-success">+ R$ {formatCurrency(breakdown2.cupomsBrutos)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center p-3 bg-financial-danger/10 rounded-lg border border-financial-danger/30">
                              <span className="font-semibold text-financial-danger">IR sobre Cupons:</span>
                              <span className="font-mono text-lg text-financial-danger">- R$ {formatCurrency(breakdown2.irSobreCupons)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center p-3 bg-financial-success/10 rounded-lg border border-financial-success/30">
                              <span className="font-semibold text-financial-success">Cupons Líquidos:</span>
                              <span className="font-mono text-lg text-financial-success">= R$ {formatCurrency(breakdown2.cuponsLiquidos)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center p-3 bg-financial-info/10 rounded-lg border border-financial-info/30">
                              <span className="font-semibold text-financial-info">Rendimento sobre cupons:</span>
                              <span className="font-mono text-lg text-financial-info">R$ {formatCurrency(breakdown2.rendimentoSobreCupons)}</span>
                            </div>

                            <div className="space-y-2">
                              <div className="flex justify-between items-center p-3 bg-financial-warning/10 rounded-lg border border-financial-warning/30">
                                <span className="font-semibold text-financial-warning flex items-center gap-2">
                                  <TrendingUp className="h-4 w-4" />
                                  Valor após vencimento reaplicado no CDI:
                                </span>
                                <span className="font-mono text-lg text-financial-warning font-bold">
                                  + R$ {results.reinvestimento && results.reinvestimento.ativoReinvestido === 'ativo2' 
                                    ? formatCurrency(results.reinvestimento.valorFinalReinvestimento - results.reinvestimento.valorResgatado)
                                    : '0'
                                  }
                                </span>
                              </div>
                            </div>
                            
                            <div className="flex justify-between items-center p-4 bg-gradient-to-r from-financial-primary/20 to-financial-secondary/20 rounded-lg border-2 border-financial-primary/50">
                              <span className="font-bold text-financial-primary text-lg">VALOR FINAL:</span>
                              <span className="font-mono text-xl font-bold text-financial-primary">R$ {formatCurrency(breakdown2.valorFinal)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Print view - Ultra-compact table layout */}
                      <div className="hidden print:block print-decomposition-section">
                        <table className="print-decomposition-table">
                          <thead>
                            <tr>
                              <th>Componente</th>
                              <th>{ativo1.nome}</th>
                              <th>{ativo2.nome}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>Principal Investido</td>
                              <td>R$ {formatCurrency(breakdown1.principalInvestido)}</td>
                              <td>R$ {formatCurrency(breakdown2.principalInvestido)}</td>
                            </tr>
                            <tr>
                              <td>+ Cupons Brutos</td>
                              <td>R$ {formatCurrency(breakdown1.cupomsBrutos)}</td>
                              <td>R$ {formatCurrency(breakdown2.cupomsBrutos)}</td>
                            </tr>
                            <tr>
                              <td>- IR sobre Cupons</td>
                              <td>R$ {formatCurrency(breakdown1.irSobreCupons)}</td>
                              <td>R$ {formatCurrency(breakdown2.irSobreCupons)}</td>
                            </tr>
                            <tr>
                              <td>= Cupons Líquidos</td>
                              <td>R$ {formatCurrency(breakdown1.cuponsLiquidos)}</td>
                              <td>R$ {formatCurrency(breakdown2.cuponsLiquidos)}</td>
                            </tr>
                            <tr>
                              <td>Rend. s/ Cupons</td>
                              <td>R$ {formatCurrency(breakdown1.rendimentoSobreCupons)}</td>
                              <td>R$ {formatCurrency(breakdown2.rendimentoSobreCupons)}</td>
                            </tr>
                            <tr>
                              <td>+ Reinvest. CDI</td>
                              <td>R$ {results.reinvestimento && results.reinvestimento.ativoReinvestido === 'ativo1' 
                                ? formatCurrency(results.reinvestimento.valorFinalReinvestimento - results.reinvestimento.valorResgatado)
                                : '0,00'
                              }</td>
                              <td>R$ {results.reinvestimento && results.reinvestimento.ativoReinvestido === 'ativo2' 
                                ? formatCurrency(results.reinvestimento.valorFinalReinvestimento - results.reinvestimento.valorResgatado)
                                : '0,00'
                              }</td>
                            </tr>
                            <tr style={{fontWeight: 'bold', borderTop: '0.5px solid #000'}}>
                              <td><strong>VALOR FINAL</strong></td>
                              <td><strong>R$ {formatCurrency(breakdown1.valorFinal)}</strong></td>
                              <td><strong>R$ {formatCurrency(breakdown2.valorFinal)}</strong></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
            
            {/* Reinvestment Details Section - NEW */}
            {results.reinvestimento && (
              <Card className={`border-financial-warning/30 shadow-xl ${compactPdfMode ? 'compact-pdf-hide' : ''}`}>
                <CardHeader className="bg-gradient-to-r from-financial-warning to-orange-500 text-white rounded-t-lg print:hidden">
                  <CardTitle className="flex items-center gap-2">
                    <ArrowRight className="h-5 w-5" />
                    Reinvestimento Inteligente - Detalhamento
                  </CardTitle>
                </CardHeader>
                
                {/* Print-only compact header */}
                <div className="hidden print:block print-section-header">
                  REINVESTIMENTO INTELIGENTE
                </div>
                
                <CardContent className="p-6 print:p-2">
                  <div className="space-y-4 print:space-y-1">
                    <div className="flex items-start gap-3 p-4 bg-financial-warning/10 rounded-lg border border-financial-warning/20 print:p-1 print:bg-transparent">
                      <AlertTriangle className="h-5 w-5 text-financial-warning mt-0.5 print:hidden" />
                      <div className="flex-1">
                        <h4 className="font-semibold text-financial-warning mb-2 print:text-xs print:mb-0">
                          Estratégia Aplicada:
                        </h4>
                        <p className="text-sm text-muted-foreground print:text-xs">
                          Como o {results.reinvestimento.ativoReinvestido === 'ativo1' ? ativo1.nome : ativo2.nome} vence 
                          antes do {results.reinvestimento.ativoReinvestido === 'ativo1' ? ativo2.nome : ativo1.nome}, 
                          seu valor foi automaticamente reaplicado no CDI pelo período restante para uma comparação equitativa.
                        </p>
                      </div>
                    </div>

                    {/* Screen view - detailed breakdown */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:hidden">
                      <div className="space-y-2">
                        <div className="flex justify-between items-center p-2 border rounded">
                          <span className="text-sm font-medium">Valor Resgatado:</span>
                          <span className="font-mono">R$ {formatCurrency(results.reinvestimento.valorResgatado)}</span>
                        </div>
                        <div className="flex justify-between items-center p-2 border rounded">
                          <span className="text-sm font-medium">Período Reinvestimento:</span>
                          <span className="font-mono">{results.reinvestimento.diasReinvestidos} dias</span>
                        </div>
                        <div className="flex justify-between items-center p-2 border rounded">
                          <span className="text-sm font-medium">De:</span>
                          <span className="font-mono">{new Date(results.reinvestimento.dataInicioReinvestimento).toLocaleDateString('pt-BR')}</span>
                        </div>
                        <div className="flex justify-between items-center p-2 border rounded">
                          <span className="text-sm font-medium">Até:</span>
                          <span className="font-mono">{new Date(results.reinvestimento.dataFimReinvestimento).toLocaleDateString('pt-BR')}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center p-2 border rounded">
                          <span className="text-sm font-medium">Rendimento Bruto CDI:</span>
                          <span className="font-mono text-financial-success">R$ {formatCurrency(results.reinvestimento.rendimentoReinvestimento)}</span>
                        </div>
                        <div className="flex justify-between items-center p-2 border rounded">
                          <span className="text-sm font-medium">IR s/ Reinvestimento:</span>
                          <span className="font-mono text-red-600">- R$ {formatCurrency(results.reinvestimento.irReinvestimento)}</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-financial-success/10 rounded border-2 border-financial-success/30">
                          <span className="font-bold text-financial-success">Valor Final Total:</span>
                          <span className="font-mono font-bold text-lg text-financial-success">R$ {formatCurrency(results.reinvestimento.valorTotalComReinvestimento)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Print view - ultra-compact table */}
                    <div className="hidden print:block">
                      <table className="print-reinvestment-table">
                        <tbody>
                          <tr>
                            <td>Valor Resgatado:</td>
                            <td>R$ {formatCurrency(results.reinvestimento.valorResgatado)}</td>
                          </tr>
                          <tr>
                            <td>Período CDI:</td>
                            <td>{results.reinvestimento.diasReinvestidos} dias ({new Date(results.reinvestimento.dataInicioReinvestimento).toLocaleDateString('pt-BR')} - {new Date(results.reinvestimento.dataFimReinvestimento).toLocaleDateString('pt-BR')})</td>
                          </tr>
                          <tr>
                            <td>Rendimento CDI:</td>
                            <td>R$ {formatCurrency(results.reinvestimento.rendimentoReinvestimento)}</td>
                          </tr>
                          <tr>
                            <td>IR Reinvestimento:</td>
                            <td>-R$ {formatCurrency(results.reinvestimento.irReinvestimento)}</td>
                          </tr>
                          <tr className="highlight-row">
                            <td><strong>Valor Final Total:</strong></td>
                            <td><strong>R$ {formatCurrency(results.reinvestimento.valorTotalComReinvestimento)}</strong></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* Final Analysis Summary */}
            <Card className={`border-financial-primary/30 shadow-xl ${compactPdfMode ? 'compact-pdf-hide' : ''}`}>
              <CardHeader className="bg-gradient-to-r from-financial-primary to-financial-secondary text-white rounded-t-lg print:hidden">
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Análise Final da Comparação
                </CardTitle>
              </CardHeader>
              
              {/* Print-only compact header */}
              <div className="hidden print:block print-section-header">
                ANÁLISE FINAL DA COMPARAÇÃO
              </div>
              
              <CardContent className="p-6 print:p-0">
                {/* Screen view - existing layout */}
                <div className="space-y-4 print:hidden">
                  <div className="flex justify-between items-center py-2 border-b border-financial-primary/20">
                    <span className="font-medium text-financial-primary">Valor Futuro ({ativo1.nome}):</span>
                    <span className="font-mono font-bold text-lg">R$ {formatCurrency(results.ativo1[results.ativo1.length - 1])}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-financial-primary/20">
                    <span className="font-medium text-financial-primary">Valor Futuro ({ativo2.nome}):</span>
                    <span className="font-mono font-bold text-lg">R$ {formatCurrency(results.ativo2[results.ativo2.length - 1])}</span>
                  </div>
                  
                  <div className="flex justify-between items-center py-3 bg-gradient-to-r from-financial-light/20 to-financial-light/10 rounded-lg px-4">
                    <span className="font-bold text-financial-primary">Vantagem Final:</span>
                    <div className="text-right">
                      {(() => {
                        const diferenca = results.ativo1[results.ativo1.length - 1] - results.ativo2[results.ativo2.length - 1];
                        const melhorOpcao = diferenca >= 0 ? ativo1.nome : ativo2.nome;
                        return (
                          <div>
                            <span className={`font-mono font-bold text-xl ${diferenca < 0 ? 'text-financial-success' : 'text-financial-danger'}`}>
                              R$ {formatCurrency(Math.abs(diferenca))}
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

                {/* Print view - Ultra-compact table layout */}
                <div className="hidden print:block">
                  <table className="print-final-analysis-table">
                    <tbody>
                      <tr>
                        <td>Valor Final {ativo1.nome}:</td>
                        <td>R$ {formatCurrency(results.ativo1[results.ativo1.length - 1])}</td>
                      </tr>
                      <tr>
                        <td>Valor Final {ativo2.nome}:</td>
                        <td>R$ {formatCurrency(results.ativo2[results.ativo2.length - 1])}</td>
                      </tr>
                      <tr className="highlight-row">
                        <td>Vantagem Final:</td>
                        <td>
                          {(() => {
                            const diferenca = results.ativo1[results.ativo1.length - 1] - results.ativo2[results.ativo2.length - 1];
                            const melhorOpcao = diferenca >= 0 ? ativo1.nome : ativo2.nome;
                            return `R$ ${formatCurrency(Math.abs(diferenca))} (${melhorOpcao})`;
                          })()}
                        </td>
                      </tr>
                      <tr>
                        <td>Conclusão:</td>
                        <td>
                          {(() => {
                            const diferenca = results.ativo1[results.ativo1.length - 1] - results.ativo2[results.ativo2.length - 1];
                            return diferenca >= 0 
                              ? `${ativo1.nome} superior` 
                              : `${ativo2.nome} superior`;
                          })()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Coupon Details Section - New Cash Flow System */}
            {(results.couponDetails?.ativo1?.length || results.couponDetails?.ativo2?.length) && <Card className={`border-blue-500/30 shadow-xl ${compactPdfMode ? 'compact-pdf-hide' : ''}`}>
                <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Detalhamento dos Cupons e Reinvestimentos
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                        <div className="space-y-6 print:space-y-2">
                     
                      {/* Ativo 1 Coupons */}
                      {results.couponDetails?.ativo1?.length > 0 && <div className="print-coupon-section">
                          <h4 className="font-bold text-lg mb-3 text-financial-primary print:hidden">
                            {ativo1.nome} - Fluxo de Cupons
                          </h4>
                          
                          {/* Print-only compact title */}
                          <div className="hidden print:block print-coupon-title">
                            {ativo1.nome} - FLUXO DE CUPONS
                          </div>
                          
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-sm print:hidden">
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
                                     R$ {formatCurrency(coupon.gross)}
                                   </td>
                                   <td className="p-2 border text-right font-mono text-xs text-financial-success">
                                     R$ {formatCurrency(coupon.net)}
                                   </td>
                                   <td className="p-2 border text-right font-mono text-xs">
                                     {coupon.reinvestFactor.toFixed(4)}
                                   </td>
                                   <td className="p-2 border text-right font-mono text-xs font-bold text-blue-600">
                                     R$ {formatCurrency(coupon.reinvested)}
                                   </td>
                                </tr>)}
                              <tr className="bg-financial-primary/20 font-bold">
                                <td className="p-2 border text-xs">TOTAL</td>
                                 <td className="p-2 border text-right font-mono text-xs">
                                   R$ {formatCurrency(results.couponDetails.ativo1.reduce((sum, c) => sum + c.gross, 0))}
                                 </td>
                                 <td className="p-2 border text-right font-mono text-xs">
                                   R$ {formatCurrency(results.couponDetails.ativo1.reduce((sum, c) => sum + c.net, 0))}
                                 </td>
                                 <td className="p-2 border text-right font-mono text-xs">-</td>
                                 <td className="p-2 border text-right font-mono text-xs">
                                   R$ {formatCurrency(results.couponDetails.ativo1.reduce((sum, c) => sum + c.reinvested, 0))}
                                 </td>
                              </tr>
                            </tbody>
                          </table>
                          
                          {/* Print-only ultra-compact table */}
                          <table className="hidden print:table print-coupon-table-ultra">
                            <thead>
                              <tr>
                                <th>Data</th>
                                <th>Bruto</th>
                                <th>Líq.</th>
                                <th>CDI</th>
                                <th>Reinv.</th>
                              </tr>
                            </thead>
                            <tbody>
                               {results.couponDetails.ativo1.map((coupon, index) => <tr key={index}>
                                 <td>{new Date(coupon.couponDate).toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'})}</td>
                                 <td>{formatCurrency(coupon.gross)}</td>
                                 <td>{formatCurrency(coupon.net)}</td>
                                 <td>{coupon.reinvestFactor.toFixed(2)}</td>
                                 <td>{formatCurrency(coupon.reinvested)}</td>
                               </tr>)}
                               <tr style={{fontWeight: 'bold', borderTop: '0.3px solid #000'}}>
                                 <td>TOT</td>
                                 <td>{formatCurrency(results.couponDetails.ativo1.reduce((sum, c) => sum + c.gross, 0))}</td>
                                 <td>{formatCurrency(results.couponDetails.ativo1.reduce((sum, c) => sum + c.net, 0))}</td>
                                 <td>-</td>
                                 <td>{formatCurrency(results.couponDetails.ativo1.reduce((sum, c) => sum + c.reinvested, 0))}</td>
                               </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>}
                    
                    {/* Ativo 2 Coupons */}
                      {results.couponDetails?.ativo2?.length > 0 && <div className="print-coupon-section">
                          <h4 className="font-bold text-lg mb-3 text-financial-secondary print:hidden">
                            {ativo2.nome} - Fluxo de Cupons
                          </h4>
                          
                          {/* Print-only compact title */}
                          <div className="hidden print:block print-coupon-title">
                            {ativo2.nome} - FLUXO DE CUPONS
                          </div>
                          
                          <div className="overflow-x-auto">
                           <table className="w-full border-collapse text-sm print:hidden">
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
                                      R$ {formatCurrency(coupon.gross)}
                                    </td>
                                    <td className="p-2 border text-right font-mono text-xs text-financial-success">
                                      R$ {formatCurrency(coupon.net)}
                                    </td>
                                    <td className="p-2 border text-right font-mono text-xs">
                                      {coupon.reinvestFactor.toFixed(4)}
                                    </td>
                                    <td className="p-2 border text-right font-mono text-xs font-bold text-blue-600">
                                      R$ {formatCurrency(coupon.reinvested)}
                                    </td>
                                 </tr>)}
                               <tr className="bg-financial-secondary/20 font-bold">
                                 <td className="p-2 border text-xs">TOTAL</td>
                                  <td className="p-2 border text-right font-mono text-xs">
                                    R$ {formatCurrency(results.couponDetails.ativo2.reduce((sum, c) => sum + c.gross, 0))}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs">
                                    R$ {formatCurrency(results.couponDetails.ativo2.reduce((sum, c) => sum + c.net, 0))}
                                  </td>
                                  <td className="p-2 border text-right font-mono text-xs">-</td>
                                  <td className="p-2 border text-right font-mono text-xs">
                                    R$ {formatCurrency(results.couponDetails.ativo2.reduce((sum, c) => sum + c.reinvested, 0))}
                                  </td>
                               </tr>
                             </tbody>
                           </table>
                           
                           {/* Print-only ultra-compact table */}
                           <table className="hidden print:table print-coupon-table-ultra">
                             <thead>
                               <tr>
                                 <th>Data</th>
                                 <th>Bruto</th>
                                 <th>Líq.</th>
                                 <th>CDI</th>
                                 <th>Reinv.</th>
                               </tr>
                             </thead>
                             <tbody>
                                {results.couponDetails.ativo2.map((coupon, index) => <tr key={index}>
                                  <td>{new Date(coupon.couponDate).toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'})}</td>
                                  <td>{formatCurrency(coupon.gross)}</td>
                                  <td>{formatCurrency(coupon.net)}</td>
                                  <td>{coupon.reinvestFactor.toFixed(2)}</td>
                                  <td>{formatCurrency(coupon.reinvested)}</td>
                                </tr>)}
                                <tr style={{fontWeight: 'bold', borderTop: '0.3px solid #000'}}>
                                  <td>TOT</td>
                                  <td>{formatCurrency(results.couponDetails.ativo2.reduce((sum, c) => sum + c.gross, 0))}</td>
                                  <td>{formatCurrency(results.couponDetails.ativo2.reduce((sum, c) => sum + c.net, 0))}</td>
                                  <td>-</td>
                                  <td>{formatCurrency(results.couponDetails.ativo2.reduce((sum, c) => sum + c.reinvested, 0))}</td>
                                </tr>
                             </tbody>
                           </table>
                         </div>
                       </div>}
                  </div>
                  
                   <div className="hidden mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                     <p className="text-sm text-blue-800">
                       <strong>Sistema de Fluxo de Caixa:</strong> Os cupons são calculados com IR regressivo baseado no tempo de aplicação 
                       e reinvestidos pela curva CDI projetada do momento do pagamento até o vencimento. Otimizado para títulos diretos.
                     </p>
                   </div>
                 </CardContent>
               </Card>}

            {/* Print Footer */}
            <div className="print-footer hidden">
              <div className="print-disclaimer">
                <h4 style={{ marginBottom: '0.5rem', fontWeight: 'bold' }}>DISCLAIMER</h4>
                <p style={{ marginBottom: '0.5rem' }}>
                  Esta análise é meramente informativa e não constitui recomendação de investimento. 
                  Os cálculos são baseados nas informações fornecidas e nas regras tributárias vigentes.
                </p>
                <p style={{ marginBottom: '0.5rem' }}>
                  <strong>Metodologia:</strong> Comparação realizada até a data de vencimento do ativo com menor prazo. 
                  Cálculos incluem impostos (IR regressivo) e consideram fluxo de caixa quando aplicável.
                </p>
                <p>
                  <strong>Importante:</strong> Rentabilidades passadas não garantem resultados futuros. 
                  Consulte sempre um assessor de investimentos qualificado.
                </p>
              </div>
              <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '10px' }}>
                Relatório gerado em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')} | 
                Comparador de Investimentos - Ferramenta de Análise Financeira
              </div>
            </div>
           </div>}
      </div>
    </div>;
};
export default InvestmentComparator;