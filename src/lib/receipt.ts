import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { methodLabel, type Sale } from './db';
import type { StoreSettings } from './settings';
import { fmtDate, fmtDateTime, fmtMoney } from './format';

const W = 80; // ancho de tiquete en mm
const M = 5;

export function buildReceiptPdf(sale: Sale, s: StoreSettings, balance: number | null): jsPDF {
  const estimated = 100 + sale.payments.length * 5 + sale.items.length * 9 + (sale.notes ? 10 : 0) + (sale.adjustments?.length ? 10 : 0) + (balance !== null ? 8 : 0);
  const doc = new jsPDF({ unit: 'mm', format: [W, Math.max(140, estimated)] });
  const cx = W / 2;
  let y = 9;

  doc.setFont('helvetica', 'bold').setFontSize(13);
  doc.text(s.storeName || 'Tienda', cx, y, { align: 'center', maxWidth: W - 2 * M });
  y += 5;
  doc.setFont('helvetica', 'normal').setFontSize(8);
  for (const line of [s.nit && `NIT/CC: ${s.nit}`, s.address, s.phone && `Tel: ${s.phone}`].filter(Boolean) as string[]) {
    doc.text(line, cx, y, { align: 'center', maxWidth: W - 2 * M });
    y += 3.8;
  }
  y += 1.5;
  doc.setFont('helvetica', 'bold').setFontSize(9.5);
  doc.text('COMPROBANTE DE VENTA', cx, y, { align: 'center' });
  y += 4.5;
  doc.setFont('helvetica', 'normal').setFontSize(8.5);
  doc.text(`No. ${String(sale.number).padStart(5, '0')}`, M, y);
  doc.text(fmtDateTime(sale.date), W - M, y, { align: 'right' });
  y += 4;
  if (sale.customerName) {
    doc.text(`Cliente: ${sale.customerName}`, M, y, { maxWidth: W - 2 * M });
    y += 4;
  }
  doc.text(`Pago: ${sale.paymentType === 'contado' ? 'Contado' : 'Crédito'}`, M, y);
  y += 2;

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    theme: 'plain',
    styles: { fontSize: 7.8, cellPadding: { top: 0.9, bottom: 0.9, left: 0.5, right: 0.5 }, textColor: 20 },
    headStyles: { fontStyle: 'bold', lineWidth: { bottom: 0.2 }, lineColor: 80 },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 20, halign: 'right' },
    },
    head: [['Cant', 'Producto', 'Valor']],
    body: sale.items.map((i) => [
      String(i.qty),
      `${i.name} (${i.size})\nRef ${i.reference} · ${fmtMoney(i.price)} c/u`,
      fmtMoney(i.qty * i.price),
    ]),
  });
  // @ts-expect-error lastAutoTable lo agrega el plugin
  y = (doc.lastAutoTable.finalY as number) + 3;
  doc.setDrawColor(80).setLineWidth(0.2).line(M, y, W - M, y);
  y += 4.5;

  const row = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 10 : 8.5);
    doc.text(label, M, y);
    doc.text(value, W - M, y, { align: 'right' });
    y += bold ? 5.2 : 4.2;
  };
  if (sale.discount) {
    row('Subtotal', fmtMoney(sale.subtotal));
    row('Descuento', `- ${fmtMoney(sale.discount)}`);
  }
  row('TOTAL', fmtMoney(sale.total), true);
  if (sale.paymentType === 'contado') for (const p of sale.payments) row(methodLabel(p.method), fmtMoney(p.amount));
  if (sale.paymentType === 'credito') {
    row(`Abonado${sale.payments.length ? ` (${sale.payments.map((p) => methodLabel(p.method)).join(', ')})` : ''}`, fmtMoney(sale.paid));
    row('Pendiente de esta venta', fmtMoney(sale.total - sale.paid));
    if (balance !== null) row('Saldo total del cliente', fmtMoney(balance));
  }
  if (sale.voided) {
    y += 2;
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(180, 0, 0);
    doc.text('ANULADA', cx, y, { align: 'center' });
    doc.setTextColor(0);
    y += 5;
  }
  if (sale.adjustments?.length) {
    y += 1;
    doc.setFont('helvetica', 'italic').setFontSize(7.8);
    const lines = doc.splitTextToSize(
      `Incluye ${sale.adjustments.map((a) => `${a.type === 'cambio' ? 'cambio' : 'devolución'} del ${fmtDate(a.date)}`).join(', ')}.`,
      W - 2 * M,
    );
    doc.text(lines, M, y);
    y += lines.length * 3.4;
  }
  if (sale.notes) {
    y += 1;
    doc.setFont('helvetica', 'italic').setFontSize(7.8);
    const lines = doc.splitTextToSize(`Nota: ${sale.notes}`, W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 3.4;
  }
  y += 3;
  doc.setFont('helvetica', 'normal').setFontSize(7.2).setTextColor(90);
  doc.text(doc.splitTextToSize(s.receiptFooter, W - 2 * M), cx, y, { align: 'center' });
  return doc;
}

export const receiptFileName = (sale: Sale) => `comprobante-${String(sale.number).padStart(5, '0')}.pdf`;

export function downloadPdf(doc: jsPDF, name: string) {
  doc.save(name);
}

/** Número colombiano a formato internacional para wa.me. */
export function waNumber(phone: string) {
  const d = phone.replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 && d.startsWith('3')) return `57${d}`;
  return d;
}

export function receiptText(sale: Sale, s: StoreSettings) {
  const lines = [
    `*${s.storeName}*`,
    `Comprobante de venta No. ${String(sale.number).padStart(5, '0')}`,
    fmtDateTime(sale.date),
    '',
    ...sale.items.map((i) => `${i.qty} x ${i.name} (${i.size}) — ${fmtMoney(i.qty * i.price)}`),
    '',
    sale.discount ? `Descuento: ${fmtMoney(sale.discount)}` : '',
    `*Total: ${fmtMoney(sale.total)}*`,
    sale.paymentType === 'credito' ? `Pendiente: ${fmtMoney(sale.total - sale.paid)}` : '',
  ];
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

/**
 * Comparte el PDF. En celulares abre el menú de compartir (WhatsApp incluido).
 * Si el navegador no permite compartir archivos, descarga el PDF y abre WhatsApp con el resumen.
 */
export async function shareReceipt(sale: Sale, s: StoreSettings, balance: number | null, phone: string) {
  const doc = buildReceiptPdf(sale, s, balance);
  const name = receiptFileName(sale);
  const file = new File([doc.output('blob')], name, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name, text: `Comprobante de venta ${s.storeName}` });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  doc.save(name);
  const num = waNumber(phone);
  const url = `https://wa.me/${num}?text=${encodeURIComponent(receiptText(sale, s))}`;
  window.open(url, '_blank', 'noopener');
  return 'fallback';
}
