import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, type Sale } from '../lib/db';
import { customerBalance, voidSale } from '../lib/ops';
import { buildReceiptPdf, receiptFileName, shareReceipt } from '../lib/receipt';
import { getSettings, useSettings } from '../lib/settings';
import { fmtDateTime, fmtMoney } from '../lib/format';
import { Modal, Tabs, useAction, useConfirm } from './ui';
import ReceiptPreview from './ReceiptPreview';

export default function SaleView({ saleId, onClose, justCreated }: { saleId: number; onClose: () => void; justCreated?: boolean }) {
  const sale = useLiveQuery(() => db.sales.get(saleId), [saleId]);
  const customer = useLiveQuery(async () => (sale?.customerId ? db.customers.get(sale.customerId) : undefined), [sale?.customerId]);
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const settings = useSettings();
  const [view, setView] = useState<'resumen' | 'comprobante'>(justCreated ? 'comprobante' : 'resumen');
  const balance = useLiveQuery(
    async () => (sale?.customerId && sale.paymentType === 'credito' ? customerBalance(sale.customerId) : null),
    [sale?.customerId, sale?.paymentType],
  );

  if (!sale) return null;

  const context = async (s: Sale) => {
    const settings = await getSettings();
    const balance = s.customerId && s.paymentType === 'credito' ? await customerBalance(s.customerId) : null;
    return { settings, balance };
  };

  const share = () =>
    run(async () => {
      const { settings, balance } = await context(sale);
      await shareReceipt(sale, settings, balance, customer?.phone ?? '');
    });

  const download = () =>
    run(async () => {
      const { settings, balance } = await context(sale);
      buildReceiptPdf(sale, settings, balance).save(receiptFileName(sale));
    });

  const doVoid = async () => {
    const detail =
      sale.paymentType === 'credito'
        ? ' y se reversa la deuda del cliente. El abono inicial se considera devuelto; abonos posteriores quedan como saldo a favor'
        : '. El dinero se considera devuelto';
    const ok = await confirm(`¿Anular la venta #${sale.number}? Las unidades vuelven al inventario${detail}.`, {
      confirmLabel: 'Anular venta',
      danger: true,
    });
    if (!ok) return;
    run(() => voidSale(sale.id), 'Venta anulada');
  };

  return (
    <Modal
      title={justCreated ? '¡Venta registrada!' : `Venta #${sale.number}`}
      onClose={onClose}
      footer={
        <>
          {!justCreated && !sale.voided && (
            <button className="btn btn-danger-ghost" onClick={doVoid} disabled={busy}>
              Anular
            </button>
          )}
          <button className="btn btn-ghost" onClick={download} disabled={busy}>
            Descargar PDF
          </button>
          <button className="btn btn-whatsapp" onClick={share} disabled={busy}>
            Enviar por WhatsApp
          </button>
        </>
      }
    >
      <Tabs
        value={view}
        onChange={setView}
        options={[
          { value: 'resumen', label: 'Resumen' },
          { value: 'comprobante', label: 'Vista previa del comprobante' },
        ]}
      />
      {view === 'comprobante' && settings && balance !== undefined && (
        <div className="ticket-wrap">
          <ReceiptPreview sale={sale} settings={settings} balance={balance} />
        </div>
      )}
      {view === 'resumen' && (
      <div className="sale-summary">
        <div className="row-between">
          <span className="muted">No. {String(sale.number).padStart(5, '0')}</span>
          <span className="muted">{fmtDateTime(sale.date)}</span>
        </div>
        {sale.voided && <div className="badge badge-danger">ANULADA</div>}
        <div className="row-between">
          <span>Cliente</span>
          {sale.customerId ? (
            <Link to={`/clientes/${sale.customerId}`} className="link" onClick={onClose}>
              {sale.customerName}
            </Link>
          ) : (
            <span className="muted">Sin cliente</span>
          )}
        </div>
        <div className="row-between">
          <span>Pago</span>
          <span className={`badge ${sale.paymentType === 'credito' ? 'badge-warn' : 'badge-ok'}`}>
            {sale.paymentType === 'credito' ? 'Crédito' : 'Contado'}
          </span>
        </div>
        <table className="table compact">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="num">Cant</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((i, k) => (
              <tr key={k}>
                <td>
                  {i.name} <span className="muted">({i.size})</span>
                  <div className="muted small">
                    Ref {i.reference} · {fmtMoney(i.price)} c/u
                  </div>
                </td>
                <td className="num">{i.qty}</td>
                <td className="num">{fmtMoney(i.qty * i.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sale.discount > 0 && (
          <>
            <div className="row-between">
              <span>Subtotal</span>
              <span>{fmtMoney(sale.subtotal)}</span>
            </div>
            <div className="row-between">
              <span>Descuento</span>
              <span>- {fmtMoney(sale.discount)}</span>
            </div>
          </>
        )}
        <div className="row-between total">
          <span>Total</span>
          <span>{fmtMoney(sale.total)}</span>
        </div>
        {sale.paymentType === 'credito' && (
          <div className="row-between">
            <span>Abonado / pendiente</span>
            <span>
              {fmtMoney(sale.paid)} / <strong>{fmtMoney(sale.total - sale.paid)}</strong>
            </span>
          </div>
        )}
        {sale.notes && <p className="muted small">Nota: {sale.notes}</p>}
        {justCreated && !customer?.phone && (
          <p className="muted small">Sin celular del cliente: WhatsApp te pedirá elegir el contacto.</p>
        )}
      </div>
      )}
    </Modal>
  );
}
