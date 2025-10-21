// src/lib/pdf/advance-sale-report.ts
// deps: npm i jspdf
import jsPDF from "jspdf";

export type Money = number; // informe em reais (ex.: 158777.07)

export type AssetInfo = {
  titulo: string;                    // "DEBÊNTURES SUZANO - Análise de Venda Antecipada"
  tipoAtivo: string;                 // "Debênture Incentivada"
  indexador: string;                 // "IPCA + Taxa Pré"
  taxa: string;                      // "IPCA + 5,48%"
  vencimento: string;                // "14/09/2038"
  tributacaoIR: string;              // "Isento"
  valorCompra: Money;                // 149143.46
  valorCurva: Money;                 // 158777.07
  cuponsRecebidos: Money;            // 17609.85
  valorVenda: Money;                 // 140619.90
  resultadoTituloBox: string;        // "Resultado da Venda Antecipada"
  resultadoValorBox: string;         // "R$ 9.086,29"
  resultadoSubBox: string;           // "+6,09% sobre o valor investido"
};

export type Ativo2Resumo = {
  tipoAtivo: string;                 // "Fundo Cetipado (FII)"
  distribuicao: string;              // "Fundo/mês"
  vencimento: string;                // "29/04/2030"
  valorCompra: Money;                // 140619.90
  tributacaoIR: string;              // "Isento (Distribuições)"
  taxa: string;                      // "CDI + 2.5%"
};

export type DecompColuna = {
  titulo: string;                    // "DEBÊNTURES SUZANO" | "BTDI11"
  linhas: Array<{ label: string; valor: string; tom?: "blue"|"red"|"plain" }>;
  valorFinal: string;                // "R$ 207.444,00"
};

export type PageData = {
  header: AssetInfo;
  ativo2: Ativo2Resumo;
  colunaEsq: DecompColuna;
  colunaDir: DecompColuna;
};

export type ReportData = {
  pages: PageData[]; // uma ou mais páginas no mesmo layout
  filename?: string; // opcional; default "Analise_Venda_Antecipada.pdf"
};

// ———————————————————————————————— helpers

const mm = (n: number) => (n * 72) / 25.4; // mm -> points (jsPDF usa pt)
const BLUE = [13, 82, 179];                // #0D52B3 aprox (barras)
const BLUE_LIGHT = [26, 115, 217];         // subheader
const CARD_BG = [237, 245, 255];           // azul clarinho
const GREEN = [46, 139, 87];
const TEXT = [20, 20, 20];

// Constantes de layout e ritmo vertical
const PAGE = { MT: mm(20), MB: mm(20), ML: mm(18), MR: mm(18) };
const VR = { section: mm(8), line: mm(5.4), cardGap: mm(3) };

function topX(doc: jsPDF) { return PAGE.ML; }
function fullW(doc: jsPDF) { return doc.internal.pageSize.getWidth() - PAGE.ML - PAGE.MR; }

const fmtBRL = (v: Money) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function setFill(doc: jsPDF, rgb: number[]) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
function setText(doc: jsPDF, rgb: number[]) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

function roundRect(doc: jsPDF, x: number, y: number, w: number, h: number, r = 4, draw = true, fill = true) {
  (doc as any).roundedRect(x, y, w, h, r, r, draw && fill ? "DF" : fill ? "F" : "S");
}

// ———————————————————————————————— desenho de blocos

function drawHeaderBar(doc: jsPDF, yTop: number, titulo: string): number {
  const h = mm(14), w = fullW(doc), x = topX(doc), y = yTop + h;
  setFill(doc, BLUE); 
  roundRect(doc, x, yTop, w, h, 3, false, true);
  setText(doc, [255, 255, 255]); 
  doc.setFont("helvetica", "bold"); 
  doc.setFontSize(12);
  // Baseline corrigida: yTop + altura - padding
  doc.text(titulo, x + mm(6), yTop + h - mm(4));
  setText(doc, TEXT);
  return y + VR.section; // Retorna próximo Y
}

function drawInfoPair(doc: jsPDF, yStart: number, header: AssetInfo): number {
  const xL = PAGE.ML + mm(6), colLabelW = mm(40), colGap = mm(6);
  const rows: [string, string][] = [
    ["Tipo de Ativo:", header.tipoAtivo],
    ["Indexador:", header.indexador],
    ["Taxa:", header.taxa],
    ["Vencimento:", header.vencimento],
    ["Tributação IR:", header.tributacaoIR],
    ["Valor de Compra:", fmtBRL(header.valorCompra)],
    ["Valor de Curva:", fmtBRL(header.valorCurva)],
    ["Cupons Recebidos:", fmtBRL(header.cuponsRecebidos)],
    ["Valor de Venda:", fmtBRL(header.valorVenda)],
  ];

  doc.setFontSize(9);
  let yL = yStart, yR = yStart;
  const xRcol = xL + mm(75); // Coluna direita dos labels

  // Desenhar duas colunas de info
  rows.forEach(([label, value], i) => {
    const isRight = i >= 5;
    const x = isRight ? xRcol : xL;
    const y = isRight ? (yR += (i === 5 ? 0 : VR.line)) : (yL += (i === 0 ? 0 : VR.line));

    doc.setFont("helvetica", "bold"); 
    setText(doc, TEXT); 
    doc.text(label, x, y);
    doc.setFont("helvetica", "normal"); 
    setText(doc, BLUE); 
    doc.text(value, x + colLabelW + colGap, y);
  });

  // Cartão à direita (ancorado no topo do bloco)
  const cardW = mm(70), cardH = mm(32);
  const xCard = PAGE.ML + fullW(doc) - cardW - mm(6);
  const yCard = yStart - mm(6); // Pequeno offset visual
  setFill(doc, CARD_BG); 
  roundRect(doc, xCard, yCard, cardW, cardH, 3, false, true);

  // Textos do cartão (baseline corrigida)
  doc.setFont("helvetica", "normal"); 
  setText(doc, TEXT); 
  doc.setFontSize(9);
  doc.text(header.resultadoTituloBox, xCard + cardW / 2, yCard + mm(9), { align: "center" });

  doc.setFont("helvetica", "bold"); 
  doc.setFontSize(14); 
  setText(doc, BLUE);
  doc.text(header.resultadoValorBox, xCard + cardW / 2, yCard + cardH / 2 + mm(2), { align: "center" });

  doc.setFont("helvetica", "normal"); 
  doc.setFontSize(8); 
  setText(doc, GREEN);
  doc.text(header.resultadoSubBox, xCard + cardW / 2, yCard + cardH - mm(6), { align: "center" });

  setText(doc, TEXT);
  
  // Calcular Y final: máximo entre colunas de texto e cartão
  const yBottomTextCols = Math.max(yL, yR);
  const yBottom = Math.max(yBottomTextCols, yCard + cardH);
  return yBottom + VR.section; // Retorna próximo Y
}

function drawSubheader(doc: jsPDF, yStart: number, titulo: string): number {
  const h = mm(10), w = fullW(doc), x = topX(doc);
  setFill(doc, BLUE_LIGHT); 
  roundRect(doc, x, yStart, w, h, 3, false, true);
  doc.setFont("helvetica", "bold"); 
  doc.setFontSize(10); 
  setText(doc, [255, 255, 255]);
  // Baseline corrigida
  doc.text(titulo, x + mm(6), yStart + h - mm(3.5));
  setText(doc, TEXT);
  return yStart + h + VR.section; // Retorna próximo Y
}

function drawAtivo2Resumo(doc: jsPDF, yStart: number, ativo2: Ativo2Resumo): number {
  const xL = PAGE.ML + mm(6); 
  const xR = xL + mm(85);
  const pairsL: [string, string][] = [
    ["Tipo de Ativo:", ativo2.tipoAtivo],
    ["Distribuição:", ativo2.distribuicao],
    ["Vencimento:", ativo2.vencimento],
  ];
  const pairsR: [string, string][] = [
    ["Valor de Compra:", fmtBRL(ativo2.valorCompra)],
    ["Tributação IR:", ativo2.tributacaoIR],
    ["Taxa:", ativo2.taxa],
  ];

  doc.setFontSize(9);
  let yL = yStart, yR = yStart;
  
  pairsL.forEach(([l, v], i) => {
    if (i) yL += VR.line; // Incrementa apenas após primeira linha
    doc.setFont("helvetica", "bold"); 
    setText(doc, TEXT); 
    doc.text(l, xL, yL);
    doc.setFont("helvetica", "normal"); 
    setText(doc, BLUE); 
    doc.text(v, xL + mm(65), yL);
  });
  
  pairsR.forEach(([l, v], i) => {
    if (i) yR += VR.line;
    doc.setFont("helvetica", "bold"); 
    setText(doc, TEXT); 
    doc.text(l, xR, yR);
    doc.setFont("helvetica", "normal"); 
    setText(doc, BLUE); 
    doc.text(v, xR + mm(65), yR);
  });
  
  setText(doc, TEXT);
  return Math.max(yL, yR) + VR.section; // Retorna próximo Y
}

function drawDecompColumns(doc: jsPDF, yStart: number, left: DecompColuna, right: DecompColuna): number {
  const x1 = PAGE.ML + mm(6);
  const totalW = fullW(doc) - mm(12);
  const colW = (totalW - mm(10)) / 2;
  const x2 = x1 + colW + mm(10);

  // Títulos das colunas
  doc.setFont("helvetica", "bold"); 
  doc.setFontSize(10); 
  setText(doc, TEXT);
  const titleY = yStart;
  doc.text(left.titulo, x1, titleY);
  doc.text(right.titulo, x2, titleY);

  // Função interna para desenhar stack de cards
  const drawStack = (x: number, y0: number, w: number, col: DecompColuna): number => {
    let y = y0 + VR.cardGap; // Começa após título
    const rowH = mm(9);
    
    const box = (label: string, value: string, tone: "blue" | "red" | "plain" = "plain") => {
      let fill: number[], stroke: number[];
      if (tone === "blue") { fill = [235, 246, 255]; stroke = [179, 220, 255]; }
      else if (tone === "red") { fill = [255, 240, 240]; stroke = [255, 204, 204]; }
      else { fill = [245, 245, 245]; stroke = [230, 230, 230]; }
      
      setFill(doc, fill); 
      doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
      roundRect(doc, x, y, w, rowH, 3, true, true);
      
      doc.setFont("helvetica", "normal"); 
      doc.setFontSize(9); 
      setText(doc, TEXT);
      doc.text(label, x + mm(5), y + rowH - mm(3.2)); // Baseline corrigida
      
      doc.setFont("helvetica", "bold");
      doc.text(value, x + w - mm(5), y + rowH - mm(3.2), { align: "right" });
      
      y += rowH + VR.cardGap; // Ritmo consistente
    };

    col.linhas.forEach(l => box(l.label, l.valor, l.tom ?? "plain"));

    // Footer (valor final)
    setFill(doc, [224, 234, 246]); 
    doc.setDrawColor(160, 190, 220);
    const fh = mm(11); 
    roundRect(doc, x, y, w, fh, 3, true, true);
    
    doc.setFont("helvetica", "bold"); 
    doc.setFontSize(10); 
    setText(doc, TEXT);
    doc.text("VALOR FINAL:", x + mm(5), y + fh - mm(3.6));
    doc.text(col.valorFinal, x + w - mm(5), y + fh - mm(3.6), { align: "right" });
    
    return y + fh; // Retorna Y final desta coluna
  };

  // Desenhar ambas as colunas
  const yLeftEnd = drawStack(x1, titleY, colW, left);
  const yRightEnd = drawStack(x2, titleY, colW, right);
  
  return Math.max(yLeftEnd, yRightEnd) + VR.section; // Retorna próximo Y
}

// ———————————————————————————————— página inteira

function drawPage(doc: jsPDF, p: PageData) {
  let y = PAGE.MT; // Margem superior
  
  // Cada função retorna o próximo Y
  y = drawHeaderBar(doc, y, p.header.titulo);
  y = drawInfoPair(doc, y, p.header);
  y = drawSubheader(doc, y, "Informações - Ativo 2");
  y = drawAtivo2Resumo(doc, y, p.ativo2);
  y = drawSubheader(doc, y, "Decomposição Detalhada dos Valores Finais");
  y = drawDecompColumns(doc, y, p.colunaEsq, p.colunaDir);

  // (Opcional) Validação se passou do limite da página
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y > pageHeight - PAGE.MB) {
    console.warn('Conteúdo pode ter ultrapassado margem inferior');
  }
}

// ———————————————————————————————— API pública

export async function buildPdf(data: ReportData): Promise<Blob> {
  const doc = new jsPDF({ unit: "pt", format: "a4" }); // portrait A4
  data.pages.forEach((pg, i) => {
    if (i > 0) doc.addPage();
    drawPage(doc, pg);
  });
  const blob = doc.output("blob");
  // também dispara download, se quiser:
  // doc.save(data.filename ?? "Analise_Venda_Antecipada.pdf");
  return blob;
}
