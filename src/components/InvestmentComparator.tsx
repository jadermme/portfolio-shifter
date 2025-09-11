import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Calculator, Trash2, Printer, TrendingUp, BarChart3 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AssetData {
  nome: string;
  codigo: string;
  taxa: number;
  vencimento: string;
  valorInvestido: number;
  valorVenda: number;
  cupons: number;
  valorCurva: number;
  tipoCupom: string;
  mesesCupons: string;
}

interface CDIProjections {
  [key: number]: number;
}

interface CalculationResult {
  cenario1: number[];
  cenario2: { valores: number[]; imposto: number };
  anosProjecao: number;
}

const InvestmentComparator = () => {
  const { toast } = useToast();
  
  const [assetData, setAssetData] = useState<AssetData>({
    nome: 'CRA ZAMP',
    codigo: 'CRA024001Q9',
    taxa: 12.03,
    vencimento: '2029-02-15',
    valorInvestido: 236792,
    valorVenda: 216268,
    cupons: 41194,
    valorCurva: 231039,
    tipoCupom: 'semestral',
    mesesCupons: '2,8'
  });

  const [cdiProjections, setCdiProjections] = useState<CDIProjections>({
    2025: 10.5,
    2026: 9.5,
    2027: 9.0,
    2028: 9.0,
    2029: 9.0,
    2030: 9.0
  });

  const [results, setResults] = useState<CalculationResult | null>(null);
  const [showResults, setShowResults] = useState(false);

  const handleAssetChange = (field: keyof AssetData, value: string | number) => {
    setAssetData(prev => ({ ...prev, [field]: value }));
  };

  const handleCdiChange = (year: number, value: number) => {
    setCdiProjections(prev => ({ ...prev, [year]: value }));
  };

  const calcularCenario1 = (dados: AssetData, anosProjecao: number): number[] => {
    const valores = [Math.round(dados.valorCurva)];
    
    let valorTotalCuponsAno = 0;
    if (dados.tipoCupom !== 'nenhum') {
      valorTotalCuponsAno = dados.valorInvestido * (dados.taxa / 100);
    }

    for (let ano = 1; ano <= anosProjecao; ano++) {
      const principalProjetado = dados.valorCurva * Math.pow(1 + dados.taxa / 100, ano);
      const totalCuponsRecebidos = valorTotalCuponsAno * ano;
      const valorTotalAno = principalProjetado + totalCuponsRecebidos;
      valores.push(Math.round(valorTotalAno));
    }
    
    return valores;
  };

  const calcularCenario2 = (valorInicial: number, cdi: CDIProjections, anosProjecao: number) => {
    const valores = [Math.round(valorInicial)];
    let valor = valorInicial;
    const anoAtual = new Date().getFullYear();
    
    for (let ano = 1; ano <= anosProjecao; ano++) {
      const anoKey = anoAtual + ano;
      const taxaCDI = (cdi[anoKey] || cdi[Object.keys(cdi).pop() as any]) / 100;
      const taxaBTDI = taxaCDI + 0.025; // CDI + 2.5%
      valor = valor * (1 + taxaBTDI);
      valores.push(Math.round(valor));
    }

    const valorBrutoFinal = valores[valores.length - 1];
    const lucroBruto = valorBrutoFinal - valorInicial;
    const imposto = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
    
    valores[valores.length - 1] = Math.round(valorBrutoFinal - imposto);
    
    return { valores, imposto: Math.round(imposto) };
  };

  const calcular = () => {
    try {
      const hoje = new Date();
      const vencimento = new Date(assetData.vencimento);
      const vencimentoAjustado = new Date(vencimento.getTime() + (24 * 60 * 60 * 1000));
      const anosProjecao = Math.ceil((vencimentoAjustado.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24 * 365.25));

      if (anosProjecao <= 0) {
        toast({
          title: "Erro",
          description: "A data de vencimento deve ser no futuro.",
          variant: "destructive"
        });
        return;
      }

      const cenario1 = calcularCenario1(assetData, anosProjecao);
      const cenario2 = calcularCenario2(assetData.valorVenda, cdiProjections, anosProjecao);
      
      setResults({ cenario1, cenario2, anosProjecao });
      setShowResults(true);
      
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
    setAssetData({
      nome: '',
      codigo: '',
      taxa: 0,
      vencimento: '',
      valorInvestido: 0,
      valorVenda: 0,
      cupons: 0,
      valorCurva: 0,
      tipoCupom: 'semestral',
      mesesCupons: ''
    });
    setShowResults(false);
    setResults(null);
  };

  const anoAtual = new Date().getFullYear();
  const totalDisponivel = assetData.valorVenda + assetData.cupons;
  const resultado = totalDisponivel - assetData.valorInvestido;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="container mx-auto max-w-6xl">
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
          <p className="text-lg text-muted-foreground">Compare qualquer ativo vs BTDI11</p>
          <Separator className="mt-6" />
        </div>

        {/* Asset Data Input */}
        <Card className="mb-6 border-financial-primary/20 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-financial-primary to-financial-secondary text-white rounded-t-lg">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              📊 Dados do Ativo a Comparar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nome">Nome do Ativo</Label>
                <Input
                  id="nome"
                  value={assetData.nome}
                  onChange={(e) => handleAssetChange('nome', e.target.value)}
                  placeholder="Ex: CRA ZAMP"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="codigo">Código</Label>
                <Input
                  id="codigo"
                  value={assetData.codigo}
                  onChange={(e) => handleAssetChange('codigo', e.target.value)}
                  placeholder="Ex: CRA024001Q9"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxa">Taxa Anual (%)</Label>
                <Input
                  id="taxa"
                  type="number"
                  step="0.01"
                  value={assetData.taxa}
                  onChange={(e) => handleAssetChange('taxa', parseFloat(e.target.value) || 0)}
                  placeholder="12.03"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vencimento">Data Vencimento</Label>
                <Input
                  id="vencimento"
                  type="date"
                  value={assetData.vencimento}
                  onChange={(e) => handleAssetChange('vencimento', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="valorInvestido">Valor Investido (R$)</Label>
                <Input
                  id="valorInvestido"
                  type="number"
                  step="0.01"
                  value={assetData.valorInvestido}
                  onChange={(e) => handleAssetChange('valorInvestido', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="valorVenda">Valor Venda Atual (R$)</Label>
                <Input
                  id="valorVenda"
                  type="number"
                  step="0.01"
                  value={assetData.valorVenda}
                  onChange={(e) => handleAssetChange('valorVenda', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cupons">Cupons Recebidos (R$)</Label>
                <Input
                  id="cupons"
                  type="number"
                  step="0.01"
                  value={assetData.cupons}
                  onChange={(e) => handleAssetChange('cupons', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="valorCurva">Valor de Curva (R$)</Label>
                <Input
                  id="valorCurva"
                  type="number"
                  step="0.01"
                  value={assetData.valorCurva}
                  onChange={(e) => handleAssetChange('valorCurva', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tipoCupom">Tipo de Cupom</Label>
                <Select value={assetData.tipoCupom} onValueChange={(value) => handleAssetChange('tipoCupom', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="semestral">Semestral</SelectItem>
                    <SelectItem value="anual">Anual</SelectItem>
                    <SelectItem value="nenhum">Sem Cupons</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mesesCupons">Meses Cupons</Label>
                <Input
                  id="mesesCupons"
                  value={assetData.mesesCupons}
                  onChange={(e) => handleAssetChange('mesesCupons', e.target.value)}
                  placeholder="2,8 (fev,ago)"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CDI Projections */}
        <Card className="mb-6 border-financial-secondary/20 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-financial-secondary to-financial-primary text-white rounded-t-lg">
            <CardTitle>📈 Projeção CDI (%)</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {Object.entries(cdiProjections).map(([year, value]) => (
                <div key={year} className="space-y-2">
                  <Label htmlFor={`cdi${year}`}>{year}</Label>
                  <Input
                    id={`cdi${year}`}
                    type="number"
                    step="0.1"
                    value={value}
                    onChange={(e) => handleCdiChange(parseInt(year), parseFloat(e.target.value) || 0)}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-wrap justify-center gap-4 mb-8">
          <Button
            onClick={calcular}
            size="lg"
            className="bg-gradient-to-r from-financial-primary to-financial-secondary hover:from-financial-secondary hover:to-financial-primary text-white font-bold shadow-lg transform transition-all duration-300 hover:scale-105"
          >
            <Calculator className="h-5 w-5 mr-2" />
            🔄 Calcular Comparação
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

        {/* Results */}
        {showResults && results && (
          <div className="space-y-6">
            {/* Executive Summary */}
            <Card className="border-financial-primary/30 shadow-xl">
              <CardHeader className="bg-gradient-to-r from-financial-primary to-financial-secondary text-white rounded-t-lg">
                <CardTitle>Resumo Executivo - {assetData.nome}</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gradient-to-r from-financial-secondary to-financial-primary text-white">
                        <th className="p-3 text-left border">Papel</th>
                        <th className="p-3 text-left border">Taxa</th>
                        <th className="p-3 text-left border">Vencimento</th>
                        <th className="p-3 text-left border">Valor Investido</th>
                        <th className="p-3 text-left border">Valor Venda</th>
                        <th className="p-3 text-left border">Cupons Recebidos</th>
                        <th className="p-3 text-left border">Total Disponível</th>
                        <th className="p-3 text-left border">Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="even:bg-muted/50">
                        <td className="p-3 border font-semibold">{assetData.nome}</td>
                        <td className="p-3 border font-mono">{assetData.taxa.toFixed(2)}% a.a.</td>
                        <td className="p-3 border font-mono">{new Date(assetData.vencimento).toLocaleDateString('pt-BR')}</td>
                        <td className="p-3 border font-mono">R$ {assetData.valorInvestido.toLocaleString('pt-BR')}</td>
                        <td className="p-3 border font-mono">R$ {assetData.valorVenda.toLocaleString('pt-BR')}</td>
                        <td className="p-3 border font-mono">R$ {assetData.cupons.toLocaleString('pt-BR')}</td>
                        <td className="p-3 border font-mono">R$ {totalDisponivel.toLocaleString('pt-BR')}</td>
                        <td className={`p-3 border font-mono font-bold ${resultado >= 0 ? 'text-financial-success' : 'text-financial-danger'}`}>
                          {resultado >= 0 ? '+' : ''}R$ {resultado.toLocaleString('pt-BR')}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Final Analysis */}
            <Card className="border-financial-success/30 shadow-xl bg-gradient-to-br from-financial-light/50 to-white">
              <CardContent className="p-6">
                <h3 className="text-xl font-bold text-financial-primary mb-4">
                  Análise Final da Comparação ({new Date(assetData.vencimento).getFullYear()}):
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">Valor Final Líquido ({assetData.nome}):</span>
                    <span className="font-mono font-bold">R$ {results.cenario1[results.cenario1.length - 1].toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Valor Final Líquido (BTDI11):</span>
                    <span className="font-mono font-bold">R$ {results.cenario2.valores[results.cenario2.valores.length - 1].toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>(Após IR de R$ {results.cenario2.imposto.toLocaleString('pt-BR')})</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-lg">Vantagem Final:</span>
                    <div className="text-right">
                      {(() => {
                        const diferenca = results.cenario1[results.cenario1.length - 1] - results.cenario2.valores[results.cenario2.valores.length - 1];
                        const melhorOpcao = diferenca >= 0 ? assetData.nome : 'BTDI11';
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
                        const diferenca = results.cenario1[results.cenario1.length - 1] - results.cenario2.valores[results.cenario2.valores.length - 1];
                        return diferenca >= 0
                          ? `Manter o ${assetData.nome} é projetado para ser financeiramente superior.`
                          : 'Migrar para BTDI11 oferece um retorno líquido potencialmente maior.';
                      })()}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default InvestmentComparator;