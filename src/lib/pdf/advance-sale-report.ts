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

const fmtBRL = (v: Money) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function setFill(doc: jsPDF, rgb: number[]) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
function setText(doc: jsPDF, rgb: number[]) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

function roundRect(doc: jsPDF, x: number, y: number, w: number, h: number, r = 4, draw = true, fill = true) {
  (doc as any).roundedRect(x, y, w, h, r, r, draw && fill ? "DF" : fill ? "F" : "S");
}

// ———————————————————————————————— desenho de blocos

function drawHeaderBar(doc: jsPDF, yTopMm: number, titulo: string) {
  const x = mm(18), y = mm(yTopMm), h = mm(14), w = doc.internal.pageSize.getWidth() - mm(36);
  setFill(doc, BLUE); roundRect(doc, x, y - h, w, h, 3, false, true);
  setText(doc, [255, 255, 255]); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text(titulo, x + mm(6), y - mm(9.5));
  setText(doc, TEXT);
}

function drawInfoPair(doc: jsPDF, yStartMm: number, header: AssetInfo) {
  const xL = mm(24), colLabelW = mm(45), colGap = mm(12);
  let y = mm(yStartMm);
  const lh = mm(5);

  doc.setFontSize(9);

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

  // Esquerda (duas colunas de label/valor)
  rows.forEach(([label, value], i) => {
    const isRightColumn = i >= 5;
    const x = isRightColumn ? xL + colLabelW + mm(75) : xL;
    const yRow = y + lh * (isRightColumn ? i - 5 : i);

    doc.setFont("helvetica", "bold");
    setText(doc, TEXT);
    doc.text(label, x, yRow);

    doc.setFont("helvetica", "normal"); setText(doc, BLUE);
    doc.text(value, x + colLabelW + colGap, yRow);
  });

  // Cartão à direita
  const cardW = mm(70), cardH = mm(32);
  const xR = doc.internal.pageSize.getWidth() - mm(18) - cardW - mm(6);
  const yR = y - mm(10);
  setFill(doc, CARD_BG); roundRect(doc, xR, yR, cardW, cardH, 3, false, true);

  // textos do cartão
  doc.setFont("helvetica", "normal"); setText(doc, TEXT); doc.setFontSize(9);
  doc.text(header.resultadoTituloBox, xR + cardW / 2, yR + mm(6.5), { align: "center" });

  doc.setFont("helvetica", "bold"); doc.setFontSize(14); setText(doc, BLUE);
  doc.text(header.resultadoValorBox, xR + cardW / 2, yR + cardH / 2, { align: "center" });

  doc.setFont("helvetica", "normal"); doc.setFontSize(8); setText(doc, GREEN);
  doc.text(header.resultadoSubBox, xR + cardW / 2, yR + cardH - mm(6), { align: "center" });

  setText(doc, TEXT);
}

function drawSubheader(doc: jsPDF, yTopMm: number, titulo: string) {
  const x = mm(18), y = mm(yTopMm), h = mm(10), w = doc.internal.pageSize.getWidth() - mm(36);
  setFill(doc, BLUE_LIGHT); roundRect(doc, x, y - h, w, h, 3, false, true);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); setText(doc, [255, 255, 255]);
  doc.text(titulo, x + mm(6), y - mm(6.5));
  setText(doc, TEXT);
}

function drawAtivo2Resumo(doc: jsPDF, yTopMm: number, ativo2: Ativo2Resumo) {
  const xL = mm(24); const xR = xL + mm(85);
  const lh = mm(5.5); let yl = mm(yTopMm) - mm(6); let yr = yl;

  const left: [string, string][] = [
    ["Tipo de Ativo:", ativo2.tipoAtivo],
    ["Distribuição:", ativo2.distribuicao],
    ["Vencimento:", ativo2.vencimento],
  ];
  const right: [string, string][] = [
    ["Valor de Compra:", fmtBRL(ativo2.valorCompra)],
    ["Tributação IR:", ativo2.tributacaoIR],
    ["Taxa:", ativo2.taxa],
  ];

  doc.setFontSize(9);
  left.forEach(([l,v]) => {
    doc.setFont("helvetica", "bold"); setText(doc, TEXT); doc.text(l, xL, yl);
    doc.setFont("helvetica", "normal"); setText(doc, BLUE); doc.text(v, xL + mm(65), yl);
    yl += lh;
  });
  right.forEach(([l,v]) => {
    doc.setFont("helvetica", "bold"); setText(doc, TEXT); doc.text(l, xR, yr);
    doc.setFont("helvetica", "normal"); setText(doc, BLUE); doc.text(v, xR + mm(65), yr);
    yr += lh;
  });
  setText(doc, TEXT);
}

function drawDecompColumns(doc: jsPDF, yTopMm: number, left: DecompColuna, right: DecompColuna) {
  const x1 = mm(24);
  const totalW = doc.internal.pageSize.getWidth() - mm(48);
  const colW = (totalW - mm(20)) / 2;
  const x2 = x1 + colW + mm(8);

  const titleY = mm(yTopMm) - mm(10);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  setText(doc, TEXT); doc.text(left.titulo, x1, titleY);
  doc.text(right.titulo, x2, titleY);

  const drawStack = (x: number, startMm: number, w: number, col: DecompColuna) => {
    const rowH = mm(9);
    let y = mm(startMm) - mm(15);

    const box = (label: string, value: string, tone: "blue"|"red"|"plain" = "plain") => {
      let fill: number[]; let stroke: number[];
      if (tone === "blue")      { fill = [235, 246, 255]; stroke = [179, 220, 255]; }
      else if (tone === "red")  { fill = [255, 240, 240]; stroke = [255, 204, 204]; }
      else                      { fill = [245, 245, 245]; stroke = [230, 230, 230]; }
      setFill(doc, fill); doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
      roundRect(doc, x, y, w, rowH, 3, true, true);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); setText(doc, TEXT);
      doc.text(label, x + mm(5), y + rowH - mm(3.4));
      doc.setFont("helvetica", "bold");
      doc.text(value, x + w - mm(5), y + rowH - mm(3.4), { align: "right" });
      y += rowH + mm(3);
    };

    col.linhas.forEach(l => box(l.label, l.valor, l.tom ?? "plain"));

    // footer (valor final)
    setFill(doc, [224, 234, 246]); doc.setDrawColor(160, 190, 220);
    const fh = mm(11); roundRect(doc, x, y, w, fh, 3, true, true);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); setText(doc, TEXT);
    doc.text("VALOR FINAL:", x + mm(5), y + fh - mm(3.8));
    doc.text(col.valorFinal, x + w - mm(5), y + fh - mm(3.8), { align: "right" });
  };

  drawStack(x1, yTopMm, colW, left);
  drawStack(x2, yTopMm, colW, right);
}

// ———————————————————————————————— página inteira

function drawPage(doc: jsPDF, p: PageData) {
  drawHeaderBar(doc, 25, p.header.titulo);
  drawInfoPair(doc, 35, p.header);
  drawSubheader(doc, 78, "Informações - Ativo 2");
  drawAtivo2Resumo(doc, 78, p.ativo2);
  drawSubheader(doc, 110, "Decomposição Detalhada dos Valores Finais");
  drawDecompColumns(doc, 110, p.colunaEsq, p.colunaDir);
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
