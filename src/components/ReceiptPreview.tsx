import type { Sale } from '../lib/db';
import type { StoreSettings } from '../lib/settings';
import { fmtDateTime, fmtMoney } from '../lib/format';

/** Vista en pantalla del comprobante; replica el contenido del PDF (receipt.ts). */
export default function ReceiptPreview({ sale, settings: s, balance }: { sale: Sale; settings: StoreSettings; balance: number | null }) {
  return (
    <div className="ticket" aria-label="Vista previa del comprobante">
      <div className="ticket-center">
        <div className="ticket-store">{s.storeName || 'Tienda'}</div>
        {s.nit && <div>NIT/CC: {s.nit}</div>}
        {s.address && <div>{s.address}</div>}
        {s.phone && <div>Tel: {s.phone}</div>}
        <div className="ticket-title">COMPROBANTE DE VENTA</div>
      </div>
      <div className="ticket-row">
        <span>No. {String(sale.number).padStart(5, '0')}</span>
        <span>{fmtDateTime(sale.date)}</span>
      </div>
      {sale.customerName && <div>Cliente: {sale.customerName}</div>}
      <div>Pago: {sale.paymentType === 'contado' ? 'Contado' : 'Crédito'}</div>

      <table className="ticket-table">
        <thead>
          <tr>
            <th>Cant</th>
            <th>Producto</th>
            <th className="num">Valor</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((i, k) => (
            <tr key={k}>
              <td className="ticket-qty">{i.qty}</td>
              <td>
                {i.name} ({i.size})
                <div className="ticket-sub">
                  Ref {i.reference} · {fmtMoney(i.price)} c/u
                </div>
              </td>
              <td className="num">{fmtMoney(i.qty * i.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ticket-totals">
        {sale.discount > 0 && (
          <>
            <div className="ticket-row">
              <span>Subtotal</span>
              <span>{fmtMoney(sale.subtotal)}</span>
            </div>
            <div className="ticket-row">
              <span>Descuento</span>
              <span>- {fmtMoney(sale.discount)}</span>
            </div>
          </>
        )}
        <div className="ticket-row ticket-total">
          <span>TOTAL</span>
          <span>{fmtMoney(sale.total)}</span>
        </div>
        {sale.paymentType === 'credito' && (
          <>
            <div className="ticket-row">
              <span>Abonado</span>
              <span>{fmtMoney(sale.paid)}</span>
            </div>
            <div className="ticket-row">
              <span>Pendiente de esta venta</span>
              <span>{fmtMoney(sale.total - sale.paid)}</span>
            </div>
            {balance !== null && (
              <div className="ticket-row">
                <span>Saldo total del cliente</span>
                <span>{fmtMoney(balance)}</span>
              </div>
            )}
          </>
        )}
      </div>
      {sale.voided && <div className="ticket-void">ANULADA</div>}
      {sale.notes && <div className="ticket-note">Nota: {sale.notes}</div>}
      <div className="ticket-footer">{s.receiptFooter}</div>
    </div>
  );
}
