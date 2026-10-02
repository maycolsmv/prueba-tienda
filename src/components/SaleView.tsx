import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, methodLabel, type Sale, type SaleAdjustment } from '../lib/db';
import { customerBalance, setSaleTown, voidSale } from '../lib/ops';
import { buildReceiptPdf, receiptFileName, shareReceipt } from '../lib/receipt';
import { getSettings, useSettings } from '../lib/settings';
import { fmtDateTime, fmtMoney } from '../lib/format';
import { Modal, Tabs, useAction, useConfirm } from './ui';
import ReceiptPreview from './ReceiptPreview';
import AdjustSale from './AdjustSale';
import TownInput from './TownInput';
import { Icon } from './Icon';

export default function SaleView({ saleId, onClose, justCreated }: { saleId: number; onClose: () => void; justCreated?: boolean }) {
  const sale = useLiveQuery(() => db.sales.get(saleId), [saleId]);
  const trip = useLiveQuery(async () => (sale?.tripId ? db.trips.get(sale.tripId) : undefined), [sale?.tripId]);
  const customer = useLiveQuery(async () => (sale?.customerId ? db.customers.get(sale.customerId) : undefined), [sale?.customerId]);
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [adjusting, setAdjusting] = useState<'cambio' | 'devolucion' | null>(null);
  const [editTown, setEditTown] = useState<string | null>(null);
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
            <>
              <button className="btn btn-danger-ghost" onClick={doVoid} disabled={busy} title="Anula la venta completa">
                Anular
              </button>
              {sale.items.length > 0 && (
                <>
                  <button className="btn btn-ghost" onClick={() => setAdjusting('cambio')} disabled={busy}>
                    Cambio
                  </button>
                  <button className="btn btn-ghost" onClick={() => setAdjusting('devolucion')} disabled={busy}>
                    Devolución
                  </button>
                </>
              )}
            </>
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
          <span>Pueblo</span>
          {editTown !== null ? (
            <div className="row gap town-edit">
              <div className="field grow">
                <TownInput value={editTown} onChange={setEditTown} autoFocus />
              </div>
              <button
                className="btn btn-sm btn-primary"
                onClick={async () => {
                  const ok = await run(async () => {
                    await setSaleTown(sale.id, editTown);
                    return true;
                  }, 'Pueblo actualizado');
                  if (ok) setEditTown(null);
                }}
              >
                Guardar
              </button>
            </div>
          ) : (
            <span>
              {sale.town ?? <span className="muted">Sin pueblo</span>}{' '}
              {!sale.voided && (
                <button className="link-btn small" onClick={() => setEditTown(sale.town ?? '')}>
                  {sale.town ? 'cambiar' : 'agregar'}
                </button>
              )}
            </span>
          )}
        </div>
        <div className="row-between">
          <span>Pago</span>
          <span className={`badge ${sale.paymentType === 'credito' ? 'badge-warn' : 'badge-ok'}`}>
            {sale.paymentType === 'credito' ? 'Crédito' : 'Contado'}
          </span>
        </div>
        {sale.payments.length > 0 && (
          <div className="row-between">
            <span>{sale.paymentType === 'credito' ? 'Abono inicial' : 'Medio de pago'}</span>
            <span className="small right-inline">{sale.payments.map((p) => `${methodLabel(p.method)} ${fmtMoney(p.amount)}`).join(' · ')}</span>
          </div>
        )}
        {trip && (
          <div className="row-between">
            <span>Viaje</span>
            <Link to={`/viajes/${trip.id}`} className="link" onClick={onClose}>
              {trip.destination}
            </Link>
          </div>
        )}
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
        {!!sale.townChanges?.length && (
          <p className="muted small">
            {sale.townChanges.map((c, k) => (
              <span key={k}>
                Pueblo cambiado el {fmtDateTime(c.date)}: {c.from ?? 'sin pueblo'} → {c.to ?? 'sin pueblo'}
                <br />
              </span>
            ))}
          </p>
        )}
        {!!sale.adjustments?.length && (
          <div className="adj-history">
            <h3 className="adj-title">Cambios y devoluciones</h3>
            <ul className="list">
              {sale.adjustments.map((a, k) => (
                <li key={k} className="adj-entry">
                  <div className="row-between">
                    <span className={`badge ${a.type === 'cambio' ? 'badge-info' : 'badge-warn'}`}>
                      <Icon name={a.type === 'cambio' ? 'sales' : 'arrowDown'} size={12} /> {a.type === 'cambio' ? 'Cambio' : 'Devolución'}
                    </span>
                    <span className="muted small">{fmtDateTime(a.date)}</span>
                  </div>
                  <div className="small">
                    Devolvió: {a.returned.map((i) => `${i.qty}× ${i.name} (${i.size})`).join(', ')} · {fmtMoney(a.returnedValue)}
                  </div>
                  {a.added.length > 0 && (
                    <div className="small">
                      Se llevó: {a.added.map((i) => `${i.qty}× ${i.name} (${i.size})`).join(', ')} · {fmtMoney(a.addedValue)}
                    </div>
                  )}
                  <div className="small">
                    <strong>{settlementText(a)}</strong>
                    {a.note && <span className="muted"> · {a.note}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {justCreated && !customer?.phone && (
          <p className="muted small">Sin celular del cliente: WhatsApp te pedirá elegir el contacto.</p>
        )}
      </div>
      )}
      {adjusting && <AdjustSale sale={sale} type={adjusting} onClose={() => setAdjusting(null)} />}
    </Modal>
  );
}

function settlementText(a: SaleAdjustment) {
  const money = a.payments.map((p) => `${methodLabel(p.method)} ${fmtMoney(p.amount)}`).join(' + ');
  switch (a.settlement) {
    case 'pago':
      return `Pagó la diferencia: ${money}`;
    case 'deuda':
      return `Quedó debiendo ${fmtMoney(a.difference)}`;
    case 'reembolso':
      return `Se le devolvió ${money}`;
    case 'descuento_deuda':
      return `Se descontaron ${fmtMoney(-a.difference)} de su cuenta`;
    default:
      return 'Sin diferencia de precio';
  }
}
