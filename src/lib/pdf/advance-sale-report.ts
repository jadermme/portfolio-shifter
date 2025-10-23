// src/lib/pdf/advance-sale-report.ts
// deps: npm i jspdf
import jsPDF from "jspdf";

export type Money = number;

export type AssetInfo = {
  titulo: string;
  tipoAtivo: string;
  indexador: string;
  taxa: string;
  vencimento: string;
  tributacaoIR: string;
  valorCompra: Money;
  valorCurva: Money;
  cuponsRecebidos: Money;
  valorVenda: Money;
  resultadoTituloBox: string;
  resultadoValorBox: string;
  resultadoSubBox: string;
};

export type Ativo2Resumo = {
  tipoAtivo: string;
  distribuicao: string;
  vencimento: string;
  valorCompra: Money;
  tributacaoIR: string;
  taxa: string;
};

export type DecompColuna = {
  titulo: string;
  linhas: Array<{ label: string; valor: string; tom?: "blue"|"red"|"plain" }>;
  valorFinal: string;
};

export type PageData = {
  header: AssetInfo;
  ativo2: Ativo2Resumo;
  colunaEsq: DecompColuna;
  colunaDir: DecompColuna;
};

export type ReportData = {
  pages: PageData[];
  filename?: string;
};

// ———————————————————————————————— helpers

let __HEADER_DRAW_COUNT = 0;

const mm = (n: number) => (n * 72) / 25.4;
const BLUE = [13, 82, 179];
const BLUE_LIGHT = [26, 115, 217];
const CARD_BG = [237, 245, 255];
const GREEN = [46, 139, 87];
const TEXT = [20, 20, 20];

const USE_CLIP = false;

const PAGE = { MT: mm(20), MB: mm(22), ML: mm(18), MR: mm(18) };
const VR = { 
  after: mm(10), 
  line: mm(6.0), 
  cardGap: mm(3.6),
  titleToContent: mm(8),
  titleHeight: mm(4.5)
};

function topX(doc: jsPDF) { return PAGE.ML; }
function fullW(doc: jsPDF) { return doc.internal.pageSize.getWidth() - PAGE.ML - PAGE.MR; }

const fmtBRL = (v: Money) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function setFill(doc: jsPDF, rgb: number[]) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
function setText(doc: jsPDF, rgb: number[]) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

/**
 * 🔒 CRÍTICO: Desenha texto com estado gráfico 100% isolado
 * Previne herança de stroke/lineWidth que causa duplicação
 */
function drawTextIsolated(
  doc: jsPDF, 
  text: string | string[], 
  x: number, 
  y: number, 
  options?: any
) {
  // Salva estado atual
  (doc as any).saveGraphicsState?.();
  
  // Garante estado limpo para texto
  doc.setLineWidth(0);              // CRÍTICO: sem stroke
  doc.setDrawColor(0, 0, 0);        // Reset draw color
  
  // Desenha o texto
  doc.text(text, x, y, options);
  
  // Restaura estado anterior
  (doc as any).restoreGraphicsState?.();
}

const resetFont = (doc: jsPDF) => { 
  doc.setFont("helvetica","normal"); 
  doc.setFontSize(9); 
  setText(doc, TEXT); 
  doc.setLineWidth(0);
  doc.setDrawColor(0, 0, 0);
};

const resetGraphicsState = (doc: jsPDF) => {
  doc.setLineWidth(0);
  doc.setDrawColor(0, 0, 0);
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
};

function roundRect(doc: jsPDF, x: number, y: number, w: number, h: number, r = 4, draw = false, fill = true) {
  // 🔒 SEMPRE use apenas "F" (fill) para evitar stroke no texto
  (doc as any).roundedRect(x, y, w, h, r, r, fill ? "F" : "S");
}

function textShrinkToFit(doc: jsPDF, text: string, maxW: number, base = 9, min = 7.2): number {
  let fs = base; 
  let w = doc.getTextWidth(text);
  while (w > maxW && fs > min) { 
    fs -= 0.2; 
    doc.setFontSize(fs); 
    w = doc.getTextWidth(text); 
  }
  return fs;
}

function measureMaxLabelWidth(doc: jsPDF, pairs: [string, string][], fontSize = 9, padRight = mm(2)): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(fontSize);
  let maxW = 0;
  for (const [label] of pairs) {
    const w = doc.getTextWidth(label);
    if (w > maxW) maxW = w;
  }
  return maxW + padRight;
}

function withClipRect(doc: jsPDF, x: number, y: number, w: number, h: number, draw: () => void) {
  if (!USE_CLIP) { 
    draw(); 
    return; 
  }
  
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || isNaN(x) || isNaN(y) || isNaN(w) || isNaN(h)) {
    console.warn('withClipRect: valores inválidos detectados, pulando clipping', {x, y, w, h});
    draw();
    return;
  }
  
  (doc as any).saveGraphicsState?.();
  doc.rect(x, y, w, h);
  (doc as any).clip?.();
  (doc as any).beginPath?.();
  
  try {
    draw();
  } finally {
    (doc as any).restoreGraphicsState?.();
  }
}

// ———————————————————————————————— desenho de blocos

function drawHeaderBar(doc: jsPDF, yTop: number, titulo: string): number {
  const h = mm(14), w = fullW(doc), x = topX(doc), y = yTop + h;
  
  setFill(doc, BLUE); 
  roundRect(doc, x, yTop, w, h, 3, false, true);
  
  // Texto isolado
  setText(doc, [255, 255, 255]); 
  doc.setFont("helvetica", "bold"); 
  doc.setFontSize(12);
  drawTextIsolated(doc, titulo, x + mm(6), yTop + h - mm(4));
  
  resetGraphicsState(doc);
  return y + VR.after;
}

function drawInfoPair(doc: jsPDF, yStart: number, h: AssetInfo): number {
  if (__HEADER_DRAW_COUNT > 0) {
    console.warn('⚠️ drawInfoPair called multiple times on same page');
    return yStart;
  }
  __HEADER_DRAW_COUNT++;

  const gutter = mm(12);
  const cardW  = mm(70), cardH = mm(32);
  const leftW  = fullW(doc) - cardW - gutter;
  const xLeft  = PAGE.ML;
  const xCard  = PAGE.ML + leftW + gutter;

  const padX   = mm(6);
  const colGap = mm(12);
  const colW   = (leftW - padX*2 - colGap) / 2;
  const xColL  = xLeft + padX;
  const xColR  = xColL + colW + colGap;

  const rowH   = mm(8.8);
  const yTop   = yStart + mm(2);
  const gap    = mm(6);

  const leftRows:  [string,string][] = [
    ["Tipo de Ativo:", h.tipoAtivo],
    ["Indexador:",     h.indexador],
    ["Taxa:",          h.taxa],
    ["Vencimento:",    h.vencimento],
    ["Tributação IR:", h.tributacaoIR],
  ];
  const rightRows: [string,string][] = [
    ["Valor de Compra:",   fmtBRL(h.valorCompra)],
    ["Valor de Curva:",    fmtBRL(h.valorCurva)],
    ["Cupons Recebidos:",  fmtBRL(h.cuponsRecebidos)],
    ["Valor de Venda:",    fmtBRL(h.valorVenda)],
  ];

  const labelWLeft  = measureMaxLabelWidth(doc, leftRows, 9, mm(2));
  const labelWRight = measureMaxLabelWidth(doc, rightRows, 9, mm(2));

  const valueWLeft  = colW - labelWLeft - gap;
  const valueWRight = colW - labelWRight - gap;

  const drawRow = (x: number, y: number, label: string, value: string, labelW: number, valueW: number) => {
    // Label
    doc.setFont("helvetica","bold");
    doc.setTextColor(20,20,20);
    drawTextIsolated(doc, label, x, y, { baseline: "alphabetic" });

    // Valor
    const xValStart = x + labelW + gap;
    const xValEnd = xValStart + valueW;
    
    doc.setFont("helvetica","normal");
    doc.setTextColor(13,82,179);
    
    let fs = 9, w = doc.getTextWidth(value);
    while (w > valueW && fs > 7.2) {
      fs -= 0.2;
      doc.setFontSize(fs);
      w = doc.getTextWidth(value);
    }
    
    drawTextIsolated(doc, value, xValEnd, y, { align: "right", baseline: "alphabetic" });
    doc.setFontSize(9);
  };

  // Colunas
  for (let i = 0; i < leftRows.length; i++) {
    const y = yTop + i * rowH;
    const [lab, val] = leftRows[i];
    drawRow(xColL, y, lab, val, labelWLeft, valueWLeft);
  }

  for (let i = 0; i < rightRows.length; i++) {
    const y = yTop + i * rowH;
    const [lab, val] = rightRows[i];
    drawRow(xColR, y, lab, val, labelWRight, valueWRight);
  }

  // Cartão
  setFill(doc, CARD_BG);
  (doc as any).roundedRect(xCard, yStart, cardW, cardH, 3, 3, "F");
  
  doc.setFont("helvetica","normal");
  doc.setTextColor(20,20,20);
  doc.setFontSize(9);
  drawTextIsolated(doc, h.resultadoTituloBox, xCard + cardW/2, yStart + mm(9), { align:"center" });
  
  doc.setFont("helvetica","bold");
  doc.setTextColor(13,82,179);
  doc.setFontSize(14);
  drawTextIsolated(doc, h.resultadoValorBox, xCard + cardW/2, yStart + cardH/2 + mm(2), { align:"center" });
  
  doc.setFont("helvetica","normal");
  doc.setTextColor(46,139,87);
  doc.setFontSize(8);
  drawTextIsolated(doc, h.resultadoSubBox, xCard + cardW/2, yStart + cardH - mm(6), { align:"center" });

  const yGridBottom = yTop + (leftRows.length - 1) * rowH;
  return Math.max(yGridBottom, yStart + cardH) + VR.after;
}

function drawSubheader(doc: jsPDF, yStart: number, titulo: string): number {
  const h = mm(10), w = fullW(doc), x = topX(doc);
  
  setFill(doc, BLUE_LIGHT); 
  roundRect(doc, x, yStart, w, h, 3, false, true);
  
  doc.setFont("helvetica", "bold"); 
  doc.setFontSize(10); 
  setText(doc, [255, 255, 255]);
  drawTextIsolated(doc, titulo, x + mm(6), yStart + h - mm(3.5));
  
  resetGraphicsState(doc);
  return yStart + h + VR.after;
}

function drawAtivo2Resumo(doc: jsPDF, yStart: number, ativo2: Ativo2Resumo): number {
  doc.setFontSize(9);

  const padX = mm(8);
  const gap  = mm(14);
  const colW = (fullW(doc) - padX*2 - gap) / 2;
  const xColL = PAGE.ML + padX;
  const xColR = xColL + colW + gap;

  const labelW = mm(38);
  const valueW = colW - labelW - mm(8);

  const left: [string,string][] = [
    ["Tipo de Ativo:", ativo2.tipoAtivo],
    ["Distribuição:",  ativo2.distribuicao],
    ["Vencimento:",    ativo2.vencimento],
  ];
  const right: [string,string][] = [
    ["Valor de Compra:", fmtBRL(ativo2.valorCompra)],
    ["Tributação IR:",   ativo2.tributacaoIR],
    ["Taxa:",            ativo2.taxa],
  ];

  const wrap = (t:string,w:number)=>doc.splitTextToSize(t,w);

  const drawCol = (x:number, y0:number, rows:[string,string][])=>{
    let y = y0;
    rows.forEach(([label,value],i)=>{
      if(i) y += VR.line;

      // Label
      doc.setFont("helvetica","bold");
      setText(doc, TEXT);
      const ll = wrap(label, labelW); 
      drawTextIsolated(doc, ll, x, y);
      const hLabel = (ll.length-1)*(VR.line*0.95);

      // Valor
      const xValEnd = x + labelW + mm(4) + valueW;
      doc.setFont("helvetica","normal");
      setText(doc, BLUE);
      
      let fs=9, w=doc.getTextWidth(value);
      while (w>valueW && fs>7.2){ 
        fs-=0.2; 
        doc.setFontSize(fs); 
        w=doc.getTextWidth(value); 
      }
      
      drawTextIsolated(doc, value, xValEnd, y, { align:"right" });
      doc.setFontSize(9);

      y += Math.max(hLabel, 0);
    });
    return y;
  };

  const yL = drawCol(xColL, yStart, left);
  const yR = drawCol(xColR, yStart, right);
  
  return Math.max(yL, yR) + VR.after;
}

function drawDecompColumns(doc: jsPDF, yStart: number, left: DecompColuna, right: DecompColuna): number {
  const x1 = PAGE.ML + mm(6);
  const totalW = fullW(doc) - mm(12);
  const colW = (totalW - mm(10)) / 2;
  const x2 = x1 + colW + mm(10);

  // Títulos
  doc.setFont("helvetica", "bold"); 
  doc.setFontSize(10); 
  setText(doc, TEXT);
  const titleY = yStart;
  drawTextIsolated(doc, left.titulo, x1, titleY);
  drawTextIsolated(doc, right.titulo, x2, titleY);

  const drawStack = (x: number, y0: number, w: number, col: DecompColuna): number => {
    let y = y0 + VR.titleToContent;
    
    const box = (label: string, value: string, tone: "blue" | "red" | "plain" = "plain") => {
      let fill: number[], stroke: number[];
      if (tone === "blue") { fill = [235, 246, 255]; stroke = [179, 220, 255]; }
      else if (tone === "red") { fill = [255, 240, 240]; stroke = [255, 204, 204]; }
      else { fill = [245, 245, 245]; stroke = [230, 230, 230]; }

      const labelMaxW = w * 0.62;
      const valueMaxW = w * 0.33;

      const ll = doc.splitTextToSize(label, labelMaxW);
      
      doc.setFontSize(9);
      let fs = 9; 
      let tw = doc.getTextWidth(value);
      while (tw > valueMaxW && fs > 7.2) {
        fs -= 0.2; 
        doc.setFontSize(fs); 
        tw = doc.getTextWidth(value);
      }

      const rowH = Math.max(mm(11), mm(7) + (ll.length - 1) * VR.line);

      // Borda separada
      doc.setDrawColor(stroke[0],stroke[1],stroke[2]);
      doc.setLineWidth(0.5);
      (doc as any).roundedRect(x,y,w,rowH,3,3,"S");
      
      // Preenchimento separado
      doc.setLineWidth(0);
      setFill(doc, fill); 
      doc.rect(x,y,w,rowH,"F");

      // Textos isolados
      doc.setFont("helvetica","normal"); 
      setText(doc, TEXT); 
      doc.setFontSize(9);
      drawTextIsolated(doc, ll, x + mm(5), y + mm(6));

      doc.setFont("helvetica","bold"); 
      doc.setFontSize(fs);
      drawTextIsolated(doc, value, x + w - mm(5), y + mm(6.5), { align:"right" });
      
      doc.setFontSize(9);
      y += rowH + VR.cardGap;
    };

    col.linhas.forEach(l => box(l.label, l.valor, l.tom ?? "plain"));

    // Footer
    setFill(doc, [224, 234, 246]); 
    doc.setDrawColor(160, 190, 220);
    doc.setLineWidth(0.5);
    const fh = mm(11); 
    roundRect(doc, x, y, w, fh, 3, true, true);
    
    doc.setLineWidth(0);
    doc.setFont("helvetica", "bold"); 
    doc.setFontSize(10); 
    setText(doc, TEXT);
    drawTextIsolated(doc, "VALOR FINAL:", x + mm(5), y + fh - mm(3.6));
    drawTextIsolated(doc, col.valorFinal, x + w - mm(5), y + fh - mm(3.6), { align: "right" });
    
    return y + fh;
  };

  const yLeftEnd = drawStack(x1, titleY + VR.titleHeight, colW, left);
  const yRightEnd = drawStack(x2, titleY + VR.titleHeight, colW, right);
  
  return Math.max(yLeftEnd, yRightEnd) + VR.after;
}

// ———————————————————————————————— página inteira

function drawPage(doc: jsPDF, p: PageData) {
  resetGraphicsState(doc);
  
  let y = PAGE.MT;
  
  y = drawHeaderBar(doc, y, p.header.titulo);
  y = drawInfoPair(doc, y, p.header);
  y = drawSubheader(doc, y, "Informações - Ativo 2");
  y = drawAtivo2Resumo(doc, y, p.ativo2);
  y = drawSubheader(doc, y, "Decomposição Detalhada dos Valores Finais");
  y = drawDecompColumns(doc, y, p.colunaEsq, p.colunaDir);

  const pageHeight = doc.internal.pageSize.getHeight();
  if (y > pageHeight - PAGE.MB) {
    console.warn('Conteúdo pode ter ultrapassado margem inferior');
  }
}

// ———————————————————————————————— API pública

export async function buildPdf(data: ReportData): Promise<Blob> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  
  resetGraphicsState(doc);
  __HEADER_DRAW_COUNT = 0;
  
  data.pages.forEach((pg, i) => {
    if (i > 0) {
      doc.addPage();
      resetGraphicsState(doc);
      __HEADER_DRAW_COUNT = 0;
    }
    drawPage(doc, pg);
  });
  
  const blob = doc.output("blob");
  return blob;
}
