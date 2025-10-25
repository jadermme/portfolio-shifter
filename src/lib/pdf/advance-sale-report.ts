// src/lib/pdf/advance-sale-report.ts
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

const resetGraphicsState = (doc: jsPDF) => {
  doc.setLineWidth(0);
  doc.setDrawColor(0, 0, 0);
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
};

function roundRect(doc: jsPDF, x: number, y: number, w: number, h: number, r = 4, draw = false, fill = true) {
  (doc as any).roundedRect(x, y, w, h, r, r, fill ? "F" : "S");
}

// ———————————————————————————————— desenho de blocos

function drawHeaderBar(doc: jsPDF, yTop: number, titulo: string): number {
  const h = mm(14), w = fullW(doc), x = topX(doc), y = yTop + h;
  
  setFill(doc, BLUE); 
  roundRect(doc, x, yTop, w, h, 3, false, true);
  
  doc.setLineWidth(0);
  setText(doc, [255, 255, 255]); 
  doc.setFont("helvetica", "bold"); 
  doc.setFontSize(12);
  doc.text(titulo, x + mm(6), yTop + h - mm(4));
  
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

  const padX   = mm(4);  // Reduzido para ganhar espaço
  const colGap = mm(8);  // Reduzido para redistribuir espaço
  const colW   = (leftW - padX*2 - colGap) / 2;
  const xColL  = xLeft + padX;
  const xColR  = xColL + colW + colGap;

  const rowH   = mm(8.8);
  const yTop   = yStart + mm(2);

  // 🔑 Mesma lógica do Ativo 2: largura fixa para labels
  const labelW = mm(38);  // Reduzido para dar mais espaço aos valores
  const labelValueGap = mm(12);  // Aumentado para evitar sobreposição
  const valueW = colW - labelW - labelValueGap;

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

  // 🔑 Copiando exatamente a lógica que funciona no drawAtivo2Resumo
  const drawRow = (x: number, y: number, label: string, value: string) => {
    doc.setLineWidth(0);
    
    // Label (negrito, preto)
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(9);
    doc.text(label, x, y);
    
    // Valor alinhado à direita (igual linha 282-293 do drawAtivo2Resumo)
    const xValEnd = x + labelW + labelValueGap + valueW;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(13, 82, 179);
    doc.setFontSize(9);
    
    // Ajustar fonte se necessário
    let fs = 9;
    let w = doc.getTextWidth(value);
    while (w > valueW && fs > 6.5) {  // Limite mais agressivo
      fs -= 0.2;
      doc.setFontSize(fs);
      w = doc.getTextWidth(value);
    }
    
    // 🎯 A LINHA MÁGICA - igual ao drawAtivo2Resumo linha 293
    doc.text(value, xValEnd, y, { align: "right" });
    doc.setFontSize(9);
  };

  // Desenhar coluna esquerda
  for (let i = 0; i < leftRows.length; i++) {
    const y = yTop + i * rowH;
    const [lab, val] = leftRows[i];
    drawRow(xColL, y, lab, val);
  }

  // Desenhar coluna direita
  for (let i = 0; i < rightRows.length; i++) {
    const y = yTop + i * rowH;
    const [lab, val] = rightRows[i];
    drawRow(xColR, y, lab, val);
  }

  // Cartão de resultado
  setFill(doc, CARD_BG);
  (doc as any).roundedRect(xCard, yStart, cardW, cardH, 3, 3, "F");
  
  doc.setLineWidth(0);
  doc.setFont("helvetica","normal");
  doc.setTextColor(20,20,20);
  doc.setFontSize(9);
  doc.text(h.resultadoTituloBox, xCard + cardW/2, yStart + mm(9), { align:"center" });
  
  doc.setFont("helvetica","bold");
  doc.setTextColor(13,82,179);
  doc.setFontSize(14);
  doc.text(h.resultadoValorBox, xCard + cardW/2, yStart + cardH/2 + mm(2), { align:"center" });
  
  doc.setFont("helvetica","normal");
  doc.setTextColor(46,139,87);
  doc.setFontSize(8);
  doc.text(h.resultadoSubBox, xCard + cardW/2, yStart + cardH - mm(6), { align:"center" });

  const yGridBottom = yTop + (leftRows.length - 1) * rowH;
  return Math.max(yGridBottom, yStart + cardH) + VR.after;
}

function drawSubheader(doc: jsPDF, yStart: number, titulo: string): number {
  const h = mm(10), w = fullW(doc), x = topX(doc);
  
  setFill(doc, BLUE_LIGHT); 
  roundRect(doc, x, yStart, w, h, 3, false, true);
  
  doc.setLineWidth(0);
  doc.setFont("helvetica", "bold"); 
  doc.setFontSize(10); 
  setText(doc, [255, 255, 255]);
  doc.text(titulo, x + mm(6), yStart + h - mm(3.5));
  
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

      doc.setLineWidth(0);
      
      // Label
      doc.setFont("helvetica","bold");
      setText(doc, TEXT);
      const ll = wrap(label, labelW); 
      doc.text(ll, x, y);
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
      
      doc.text(value, xValEnd, y, { align:"right" });
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
  doc.setLineWidth(0);
  doc.setFont("helvetica", "bold"); 
  doc.setFontSize(10); 
  setText(doc, TEXT);
  const titleY = yStart;
  doc.text(left.titulo, x1, titleY);
  doc.text(right.titulo, x2, titleY);

  const drawStack = (x: number, y0: number, w: number, col: DecompColuna): number => {
    let y = y0 + VR.titleToContent;
    
    const box = (label: string, value: string, tone: "blue" | "red" | "plain" = "plain") => {
      let fill: number[], stroke: number[];
      if (tone === "blue") { fill = [235, 246, 255]; stroke = [179, 220, 255]; }
      else if (tone === "red") { fill = [255, 240, 240]; stroke = [255, 204, 204]; }
      else { fill = [245, 245, 245]; stroke = [230, 230, 230]; }

      const labelMaxW = w * 0.60;
      const valueMaxW = w * 0.35;

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

      // Borda
      doc.setDrawColor(stroke[0],stroke[1],stroke[2]);
      doc.setLineWidth(0.5);
      (doc as any).roundedRect(x,y,w,rowH,3,3,"S");
      
      // Preenchimento
      doc.setLineWidth(0);
      setFill(doc, fill); 
      doc.rect(x,y,w,rowH,"F");

      // Textos
      doc.setLineWidth(0);
      doc.setFont("helvetica","normal"); 
      setText(doc, TEXT); 
      doc.setFontSize(9);
      doc.text(ll, x + mm(5), y + mm(6));

      doc.setFont("helvetica","bold"); 
      doc.setFontSize(fs);
      doc.text(value, x + w - mm(5), y + mm(6.5), { align:"right" });
      
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
    doc.text("VALOR FINAL:", x + mm(5), y + fh - mm(3.6));
    doc.text(col.valorFinal, x + w - mm(5), y + fh - mm(3.6), { align: "right" });
    
    return y + fh;
  };

  const yLeftEnd = drawStack(x1, titleY + VR.titleHeight, colW, left);
  const yRightEnd = drawStack(x2, titleY + VR.titleHeight, colW, right);
  
  return Math.max(yLeftEnd, yRightEnd) + VR.after;
}

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
