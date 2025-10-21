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

// ===== Clip desativado (rollback seguro)
const USE_CLIP = false;

// Constantes de layout e ritmo vertical
const PAGE = { MT: mm(20), MB: mm(20), ML: mm(18), MR: mm(18) };
const VR = { after: mm(8), line: mm(5.2), cardGap: mm(3) };

function topX(doc: jsPDF) { return PAGE.ML; }
function fullW(doc: jsPDF) { return doc.internal.pageSize.getWidth() - PAGE.ML - PAGE.MR; }

const fmtBRL = (v: Money) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function setFill(doc: jsPDF, rgb: number[]) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
function setText(doc: jsPDF, rgb: number[]) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

function roundRect(doc: jsPDF, x: number, y: number, w: number, h: number, r = 4, draw = true, fill = true) {
  (doc as any).roundedRect(x, y, w, h, r, r, draw && fill ? "DF" : fill ? "F" : "S");
}

/** Reduz a fonte até caber no box (sem quebrar), mantém no mínimo 7.2pt */
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

/** Garante que qualquer texto desenhado fique 100% dentro do retângulo */
function withClipRect(doc: jsPDF, x: number, y: number, w: number, h: number, draw: () => void) {
  // Rollback seguro: desativa clipping temporariamente
  if (!USE_CLIP) { 
    draw(); 
    return; 
  }
  
  // Validar que valores não são negativos ou NaN
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || isNaN(x) || isNaN(y) || isNaN(w) || isNaN(h)) {
    console.warn('withClipRect: valores inválidos detectados, pulando clipping', {x, y, w, h});
    draw(); // Executa sem clipping
    return;
  }
  
  // Implementação correta: save → path → clip → beginPath → draw → restore
  (doc as any).saveGraphicsState?.();
  doc.rect(x, y, w, h);               // define o path
  (doc as any).clip?.();              // aplica o clip
  (doc as any).beginPath?.();         // limpa o path atual (CRÍTICO)
  
  try {
    draw();
  } finally {
    (doc as any).restoreGraphicsState?.(); // SEMPRE restaurar, mesmo se draw() falhar
  }
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
  return y + VR.after; // Retorna próximo Y
}

function drawInfoPair(doc: jsPDF, yStart: number, h: AssetInfo): number {
  // ——— layout base
  const gutter = mm(12);
  const cardW  = mm(70), cardH = mm(32);
  const leftW  = fullW(doc) - cardW - gutter;
  const xLeft  = PAGE.ML;
  const xCard  = PAGE.ML + leftW + gutter;

  // grid interno (duas colunas)
  const padX   = mm(6);
  const colGap = mm(12);
  const colW   = (leftW - padX*2 - colGap) / 2;
  const xColL  = xLeft + padX;
  const xColR  = xColL + colW + colGap;

  // células
  const labelW = mm(36);
  const valueW = colW - labelW - mm(8);
  const rowH   = mm(7);
  const yTop   = yStart + mm(2);

  // reset seguro de state gráfico (evita "modo stroke" herdado)
  doc.setTextColor(20,20,20);
  doc.setDrawColor(0); doc.setLineWidth(0.2);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);

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

  const drawRow = (x: number, y: number, label: string, value: string) => {
    // label (1 chamada, 1 linha)
    doc.setFont("helvetica","bold"); doc.setTextColor(20,20,20);
    doc.text(label, x, y, { baseline: "alphabetic" });

    // valor (1 chamada, 1 linha, shrink até caber)
    const xValEnd = x + labelW + mm(4) + valueW;
    doc.setFont("helvetica","normal"); doc.setTextColor(13,82,179);
    let fs = 9, w = doc.getTextWidth(value);
    while (w > valueW && fs > 7.2) { fs -= 0.2; doc.setFontSize(fs); w = doc.getTextWidth(value); }
    doc.text(value, xValEnd, y, { align: "right", baseline: "alphabetic" });
    doc.setFontSize(9); // reset
  };

  // coluna esquerda: 5 linhas
  for (let i = 0; i < leftRows.length; i++) {
    const y = yTop + i * rowH;
    const [lab, val] = leftRows[i];
    drawRow(xColL, y, lab, val);
  }

  // coluna direita: 4 linhas (sem reaproveitar lógica antiga!)
  for (let i = 0; i < rightRows.length; i++) {
    const y = yTop + i * rowH;
    const [lab, val] = rightRows[i];
    drawRow(xColR, y, lab, val);
  }

  // cartão
  setFill(doc, CARD_BG);
  (doc as any).roundedRect(xCard, yStart, cardW, cardH, 3, 3, "F");
  doc.setFont("helvetica","normal"); doc.setTextColor(20,20,20); doc.setFontSize(9);
  doc.text(h.resultadoTituloBox, xCard + cardW/2, yStart + mm(9), { align:"center" });
  doc.setFont("helvetica","bold"); doc.setTextColor(13,82,179); doc.setFontSize(14);
  doc.text(h.resultadoValorBox,  xCard + cardW/2, yStart + cardH/2 + mm(2), { align:"center" });
  doc.setFont("helvetica","normal"); doc.setTextColor(46,139,87); doc.setFontSize(8);
  doc.text(h.resultadoSubBox,    xCard + cardW/2, yStart + cardH - mm(6), { align:"center" });

  // y final da seção
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
  // Baseline corrigida
  doc.text(titulo, x + mm(6), yStart + h - mm(3.5));
  setText(doc, TEXT);
  return yStart + h + VR.after; // Retorna próximo Y
}

function drawAtivo2Resumo(doc: jsPDF, yStart: number, ativo2: Ativo2Resumo): number {
  doc.setFontSize(9);

  // Duas meias-larguras simétricas (não posições absolutas)
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

      // label (wrap)
      doc.setFont("helvetica","bold"); setText(doc, TEXT);
      const ll = wrap(label, labelW); 
      doc.text(ll, x, y);
      const hLabel = (ll.length-1)*(VR.line*0.95);

      // valor (1 linha + shrink inline + alinhado à direita)
      const xValEnd = x + labelW + mm(4) + valueW;
      doc.setFont("helvetica","normal"); setText(doc, BLUE);
      
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
    setText(doc, TEXT);
    return y;
  };

  const yL = drawCol(xColL, yStart + mm(3), left);
  const yR = drawCol(xColR, yStart + mm(3), right);
  return Math.max(yL, yR) + VR.after;
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
    
    const box = (label: string, value: string, tone: "blue" | "red" | "plain" = "plain") => {
      let fill: number[], stroke: number[];
      if (tone === "blue") { fill = [235, 246, 255]; stroke = [179, 220, 255]; }
      else if (tone === "red") { fill = [255, 240, 240]; stroke = [255, 204, 204]; }
      else { fill = [245, 245, 245]; stroke = [230, 230, 230]; }

      const labelMaxW = w * 0.60;  // Redistribui espaço
      const valueMaxW = w * 0.34;

      const ll = doc.splitTextToSize(label, labelMaxW);
      
      // Shrink inline para valor
      let fs=9, tw=doc.getTextWidth(value);
      while (tw>valueMaxW && fs>7.2){ 
        fs-=0.2; 
        doc.setFontSize(fs); 
        tw=doc.getTextWidth(value); 
      }

      // Altura calculada pela quantidade de linhas do label (valor sempre 1 linha)
      const rowH = Math.max(mm(9), mm(6) + (ll.length-1)*(VR.line*0.95));

      // Borda e preenchimento
      doc.setDrawColor(stroke[0],stroke[1],stroke[2]);
      (doc as any).roundedRect(x,y,w,rowH,3,3,"S");
      setFill(doc, fill); 
      doc.rect(x,y,w,rowH,"F");

      // LABEL (múltiplas linhas permitidas)
      doc.setFont("helvetica","normal"); 
      setText(doc, TEXT); 
      doc.setFontSize(9);
      doc.text(ll, x + mm(5), y + mm(6));

      // VALUE (sempre 1 linha, alinhado à direita, fonte já ajustada)
      doc.setFont("helvetica","bold"); 
      doc.setFontSize(fs);  // Usa a fonte já calculada pelo shrink
      doc.text(value, x + w - mm(5), y + mm(6), { align:"right" });
      doc.setFontSize(9);  // Reset

      y += rowH + VR.cardGap;
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
  
  return Math.max(yLeftEnd, yRightEnd) + VR.after; // Retorna próximo Y
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
