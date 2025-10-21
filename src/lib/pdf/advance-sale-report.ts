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
  doc.setFontSize(9);

  const gutter = mm(10);
  const cardW  = mm(70), cardH = mm(32);
  const xLeft  = PAGE.ML;
  const leftBlockW = fullW(doc) - cardW - gutter;
  const xCard  = xLeft + leftBlockW + gutter;
  const yCard  = yStart;

  // sub-colunas dentro do bloco esquerdo
  const colGap = mm(8);
  const colW   = (leftBlockW - colGap - mm(6) /* padding interno */) / 2;
  const xColL  = xLeft + mm(6);
  const xColR  = xColL + colW + colGap;

  // cada coluna terá labelWidth fixo; o valor ocupa o resto
  const labelW = mm(32); // ~32 mm é suficiente para "Tributação IR:"
  const valueW = colW - labelW - mm(4); // pequeno gap

  const L: [string,string][] = [
    ["Tipo de Ativo:",   header.tipoAtivo],
    ["Indexador:",       header.indexador],
    ["Taxa:",            header.taxa],
    ["Vencimento:",      header.vencimento],
    ["Tributação IR:",   header.tributacaoIR],
  ];
  const R: [string,string][] = [
    ["Valor de Compra:", fmtBRL(header.valorCompra)],
    ["Valor de Curva:",  fmtBRL(header.valorCurva)],
    ["Cupons Recebidos:",fmtBRL(header.cuponsRecebidos)],
    ["Valor de Venda:",  fmtBRL(header.valorVenda)],
  ];

  const wrap = (txt: string, maxW: number) => doc.splitTextToSize(txt, maxW);

  const drawColumn = (x: number, y0: number, rows: [string,string][]) => {
    let y = y0;
    rows.forEach(([label, value], i) => {
      if (i) y += VR.line;

      // LABEL (wrap permitido)
      doc.setFont("helvetica","bold"); setText(doc, TEXT);
      const labelLines = wrap(label, labelW);
      doc.text(labelLines, x, y);

      // calcula altura consumida pelo label
      const labelLinesH = (labelLines.length - 1) * (VR.line * 0.95);

      // VALUE (NÃO quebrar números): alinhado à direita do box do value
      const xValBoxStart = x + labelW + mm(4);
      const xValBoxEnd   = xValBoxStart + valueW;
      doc.setFont("helvetica","normal"); setText(doc, BLUE);

      // se o valor for longo, reduzimos levemente a fonte ao invés de quebrar
      const val = value;
      let fs = 9;
      let w = doc.getTextWidth(val);
      while (w > valueW && fs > 7.4) {
        fs -= 0.2; doc.setFontSize(fs); w = doc.getTextWidth(val);
      }
      doc.text(val, xValBoxEnd, y, { align: "right" });
      doc.setFontSize(9);

      // avança y pelo maior bloco
      y += Math.max(labelLinesH, 0);
    });
    setText(doc, TEXT);
    return y;
  };

  const yTextTop = yStart + mm(2);
  const yEndL = drawColumn(xColL, yTextTop, L);
  const yEndR = drawColumn(xColR, yTextTop, R);
  const yTextBottom = Math.max(yEndL, yEndR);

  // CARTÃO à direita (sempre no espaço reservado)
  setFill(doc, CARD_BG); roundRect(doc, xCard, yCard, cardW, cardH, 3, false, true);
  doc.setFont("helvetica","normal"); setText(doc, TEXT); doc.setFontSize(9);
  doc.text(header.resultadoTituloBox, xCard + cardW/2, yCard + mm(9), { align: "center" });
  doc.setFont("helvetica","bold"); doc.setFontSize(14); setText(doc, BLUE);
  doc.text(header.resultadoValorBox, xCard + cardW/2, yCard + cardH/2 + mm(2), { align: "center" });
  doc.setFont("helvetica","normal"); doc.setFontSize(8); setText(doc, GREEN);
  doc.text(header.resultadoSubBox,   xCard + cardW/2, yCard + cardH - mm(6), { align: "center" });

  setText(doc, TEXT);
  return Math.max(yTextBottom, yCard + cardH) + VR.section;
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
  doc.setFontSize(9);

  const xL = PAGE.ML + mm(6);
  const xR = xL + mm(92); // um pouco mais largo que antes para caber textos
  const labelW = mm(34);
  const valueW = mm(62);

  const L: [string,string][] = [
    ["Tipo de Ativo:", ativo2.tipoAtivo],
    ["Distribuição:",  ativo2.distribuicao],
    ["Vencimento:",    ativo2.vencimento],
  ];
  const R: [string,string][] = [
    ["Valor de Compra:", fmtBRL(ativo2.valorCompra)],
    ["Tributação IR:",   ativo2.tributacaoIR],
    ["Taxa:",            ativo2.taxa],
  ];

  const wrap = (txt: string, maxW: number) => doc.splitTextToSize(txt, maxW);
  const drawPairCol = (x: number, y0: number, rows: [string,string][]) => {
    let y = y0;
    rows.forEach(([label, value], i) => {
      if (i) y += VR.line;
      // label
      doc.setFont("helvetica","bold"); setText(doc, TEXT);
      const lbl = wrap(label, labelW);
      doc.text(lbl, x, y);
      const lblH = (lbl.length - 1) * (VR.line * 0.95);

      // value
      doc.setFont("helvetica","normal"); setText(doc, BLUE);
      const xValStart = x + labelW + mm(4), xValEnd = xValStart + valueW;
      // Não quebrar números/valores
      let fs = 9; let w = doc.getTextWidth(value);
      while (w > valueW && fs > 7.4) { fs -= 0.2; doc.setFontSize(fs); w = doc.getTextWidth(value); }
      doc.text(value, xValEnd, y, { align: "right" });
      doc.setFontSize(9);

      y += Math.max(lblH, 0);
    });
    setText(doc, TEXT);
    return y;
  };

  const yL = drawPairCol(xL, yStart + mm(2), L);
  const yR = drawPairCol(xR, yStart + mm(2), R);
  return Math.max(yL, yR) + VR.section;
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

      // Medir e permitir wrap apenas no LABEL; o VALUE é alinhado à direita sem quebrar
      const labelMaxW = w * 0.62; // dá espaço para o valor
      const valueMaxW = w * 0.32;

      const lblLines = doc.splitTextToSize(label, labelMaxW);
      let fs = 9; let vw = doc.getTextWidth(value);
      while (vw > valueMaxW && fs > 7.4) { fs -= 0.2; doc.setFontSize(fs); vw = doc.getTextWidth(value); }

      // Altura dinâmica: linhas do label vs uma linha do valor
      const rowH = Math.max(mm(9), mm(6) + (lblLines.length - 1) * (VR.line * 0.95));

      setFill(doc, fill); doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
      roundRect(doc, x, y, w, rowH, 3, true, true);

      // label (esq)
      doc.setFont("helvetica","normal"); doc.setFontSize(9); setText(doc, TEXT);
      doc.text(lblLines, x + mm(5), y + mm(6));

      // value (dir, sem quebra)
      doc.setFont("helvetica","bold"); doc.setFontSize(fs);
      const xVal = x + w - mm(5);
      doc.text(value, xVal, y + mm(6), { align: "right" });

      // avança y
      y += rowH + VR.cardGap;
      // reset fonte
      doc.setFontSize(9);
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
