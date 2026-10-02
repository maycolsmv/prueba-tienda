import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { PAYMENT_METHODS, type Payment, type PaymentMethod, type Sale, type SaleItem, type Settlement } from '../lib/db';
import { adjustSale, getActiveTrip, loadCatalog, returnValue, type ProductWithVariants } from '../lib/ops';
import { fmtMoney, normalize } from '../lib/format';
import { Empty, Field, Modal, MoneyInput, SearchBox, useAction } from './ui';
import PaymentsEditor, { effectivePayments } from './PaymentsEditor';

/** Cambio de talla/producto o devolución parcial de una venta (aunque sea de días atrás). */
export default function AdjustSale({ sale, type, onClose }: { sale: Sale; type: 'cambio' | 'devolucion'; onClose: () => void }) {
  const catalog = useLiveQuery(() => loadCatalog(), []);
  const trip = useLiveQuery(async () => (await getActiveTrip()) ?? null, []);
  const [ret, setRet] = useState<Record<number, number>>(() =>
    // Si la venta tiene una sola prenda, ya viene marcada
    sale.items.length === 1 && sale.items[0].qty === 1 ? { [sale.items[0].variantId]: 1 } : {},
  );
  const [added, setAdded] = useState<SaleItem[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [payments, setPayments] = useState<Payment[]>([{ method: 'efectivo', amount: 0 }]);
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('efectivo');
  const [note, setNote] = useState('');
  const { run, busy } = useAction();

  const returned = Object.entries(ret).map(([variantId, qty]) => ({ variantId: Number(variantId), qty }));
  const returnedValue = returnValue(sale, returned);
  const addedValue = added.reduce((a, i) => a + i.qty * i.price, 0);
  const difference = addedValue - returnedValue;
  const factor = sale.subtotal > 0 ? sale.total / sale.subtotal : 1;

  // La prenda nueva sale del mismo lugar que la venta: del viaje abierto si la venta es de ese viaje; si no, de bodega
  const fromTrip = !!trip && sale.tripId === trip.id;
  const avail = (v: { stock: number; inTrip: number }) => (fromTrip ? v.inTrip : v.stock);
  const inAdded = (variantId: number) => added.filter((a) => a.variantId === variantId).reduce((s, a) => s + a.qty, 0);
  const results = useMemo(() => {
    const n = normalize(q);
    return (catalog ?? [])
      .filter((p) => (fromTrip ? p.totalInTrip : p.totalStock) > 0 && (!n || normalize(`${p.name} ${p.reference} ${p.category}`).includes(n)))
      .slice(0, 25);
  }, [catalog, q, fromTrip]);

  const add = (p: ProductWithVariants, variantId: number) => {
    const v = p.variants.find((x) => x.id === variantId)!;
    setAdded((list) => {
      const i = list.findIndex((a) => a.variantId === variantId);
      if (i >= 0) return list.map((a, k) => (k === i ? { ...a, qty: a.qty + 1 } : a));
      return [...list, { productId: p.id, variantId, reference: p.reference, name: p.name, size: v.size, qty: 1, price: p.price }];
    });
  };

  // Resolución de la diferencia (por defecto: si la venta fue a crédito, va a la cuenta del cliente)
  const owesCustomer = difference > 0;
  const options: { value: Settlement; label: string; needsCustomer?: boolean }[] =
    difference > 0
      ? [
          { value: 'pago', label: 'Paga ahora' },
          { value: 'deuda', label: 'Queda debiendo', needsCustomer: true },
        ]
      : difference < 0
        ? [
            { value: 'reembolso', label: 'Devolver dinero' },
            { value: 'descuento_deuda', label: sale.paymentType === 'credito' ? 'Descontar de su deuda' : 'Dejar saldo a favor', needsCustomer: true },
          ]
        : [];
  const defaultSettlement: Settlement =
    difference === 0 ? 'ninguno' : difference > 0 ? 'pago' : sale.paymentType === 'credito' && sale.customerId ? 'descuento_deuda' : 'reembolso';
  const chosen = settlement && options.some((o) => o.value === settlement) ? settlement : defaultSettlement;

  const finalPayments =
    chosen === 'pago'
      ? effectivePayments(payments, 'contado', difference)
      : chosen === 'reembolso'
        ? [{ method: refundMethod, amount: -difference }]
        : [];

  const save = async () => {
    const ok = await run(async () => {
      await adjustSale(sale.id, { type, returned, added, settlement: chosen, payments: finalPayments, note });
      return true;
    }, type === 'cambio' ? 'Cambio registrado' : 'Devolución registrada');
    if (ok) onClose();
  };

  const totalReturned = returned.reduce((a, r) => a + r.qty, 0);
  const canSave = totalReturned > 0 && (type === 'devolucion' || added.length > 0);

  return (
    <Modal
      title={`${type === 'cambio' ? 'Cambio' : 'Devolución'} · venta #${sale.number}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !canSave}>
            Registrar {type === 'cambio' ? 'cambio' : 'devolución'}
          </button>
        </>
      }
    >
      <div className="form">
        <section>
          <h3 className="adj-title">1. ¿Qué devuelve el cliente?</h3>
          <ul className="list">
            {sale.items.map((i) => {
              const n = ret[i.variantId] ?? 0;
              return (
                <li key={i.variantId} className="list-row adj-row">
                  <div>
                    <strong>
                      {i.name} <span className="muted">({i.size})</span>
                    </strong>
                    <div className="muted small">
                      Compró {i.qty} · {fmtMoney(i.price * factor)} c/u{factor < 1 ? ' (con descuento)' : ''}
                    </div>
                  </div>
                  <div className="qty">
                    <button className="icon-btn" disabled={n <= 0} onClick={() => setRet({ ...ret, [i.variantId]: n - 1 })} aria-label="Menos">
                      −
                    </button>
                    <span>{n}</span>
                    <button className="icon-btn" disabled={n >= i.qty} onClick={() => setRet({ ...ret, [i.variantId]: n + 1 })} aria-label="Más">
                      +
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="muted small">
            Vuelve {fromTrip ? 'a la mercancía del viaje' : 'a bodega'}. Valor: <strong>{fmtMoney(returnedValue)}</strong>
          </p>
        </section>

        {type === 'cambio' && (
          <section>
            <h3 className="adj-title">2. ¿Qué se lleva a cambio?</h3>
            <p className="muted small">Sale {fromTrip ? `de la mercancía del viaje a ${trip!.destination}` : 'de bodega'}.</p>
            {added.length > 0 && (
              <ul className="list">
                {added.map((a, k) => (
                  <li key={a.variantId} className="cart-row">
                    <div className="cart-info">
                      <strong>
                        {a.name} <span className="muted">({a.size})</span>
                      </strong>
                      <MoneyInput value={a.price} onChange={(price) => setAdded(added.map((x, j) => (j === k ? { ...x, price } : x)))} aria-label="Precio" />
                    </div>
                    <div className="qty">
                      <button
                        className="icon-btn"
                        onClick={() => setAdded(added.map((x, j) => (j === k ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0))}
                        aria-label="Menos"
                      >
                        −
                      </button>
                      <span>{a.qty}</span>
                      <button className="icon-btn" onClick={() => setAdded(added.map((x, j) => (j === k ? { ...x, qty: x.qty + 1 } : x)))} aria-label="Más">
                        +
                      </button>
                    </div>
                    <div className="num line-total">{fmtMoney(a.qty * a.price)}</div>
                  </li>
                ))}
              </ul>
            )}
            <SearchBox value={q} onChange={setQ} placeholder="Buscar la prenda nueva (otra talla u otro producto)" />
            {catalog && results.length === 0 && <Empty>No hay productos con existencias.</Empty>}
            <ul className="list product-pick adj-pick">
              {results.map((p) => (
                <li key={p.id}>
                  <button className="list-row pick-row" onClick={() => setOpen(open === p.id ? null : p.id)}>
                    <div>
                      <strong>{p.name}</strong>
                      <div className="muted small">Ref {p.reference}</div>
                    </div>
                    <div className="right">
                      <div>{fmtMoney(p.price)}</div>
                    </div>
                  </button>
                  {open === p.id && (
                    <div className="sizes">
                      {p.variants.map((v) => {
                        const left = avail(v) - inAdded(v.id);
                        return (
                          <button key={v.id} className="size-chip" disabled={left <= 0} onClick={() => add(p, v.id)}>
                            <strong>{v.size}</strong>
                            <span>{left} disp.</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {canSave && (
          <section className="adj-summary">
            <div className="row-between">
              <span>Devuelve</span>
              <span>− {fmtMoney(returnedValue)}</span>
            </div>
            {type === 'cambio' && (
              <div className="row-between">
                <span>Se lleva</span>
                <span>+ {fmtMoney(addedValue)}</span>
              </div>
            )}
            <div className="row-between total">
              <span>{difference > 0 ? 'Debe pagar' : difference < 0 ? 'A favor del cliente' : 'Sin diferencia'}</span>
              <span>{fmtMoney(Math.abs(difference))}</span>
            </div>

            {options.length > 0 && (
              <Field label={owesCustomer ? '¿Cómo paga la diferencia?' : '¿Qué se hace con el saldo a favor?'}>
                <div className="segmented">
                  {options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      className={chosen === o.value ? 'active' : ''}
                      disabled={o.needsCustomer && !sale.customerId}
                      title={o.needsCustomer && !sale.customerId ? 'La venta no tiene cliente' : undefined}
                      onClick={() => setSettlement(o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            {chosen === 'pago' && <PaymentsEditor mode="contado" total={difference} value={payments} onChange={setPayments} />}
            {chosen === 'reembolso' && (
              <Field label="Se le devuelve por">
                <div className="segmented method-pick">
                  {PAYMENT_METHODS.map((m) => (
                    <button key={m.value} type="button" className={refundMethod === m.value ? 'active' : ''} onClick={() => setRefundMethod(m.value)}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            {chosen === 'deuda' && <p className="muted small">Se suma {fmtMoney(difference)} a la cuenta de {sale.customerName}.</p>}
            {chosen === 'descuento_deuda' && (
              <p className="muted small">
                Se descuentan {fmtMoney(-difference)} de la cuenta de {sale.customerName} (si no debe, queda como saldo a favor).
              </p>
            )}
          </section>
        )}

        <Field label="Motivo / nota">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'cambio' ? 'Ej: le quedó pequeña' : 'Ej: no le gustó el color'} />
        </Field>
      </div>
    </Modal>
  );
}
