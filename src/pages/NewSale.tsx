import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, type Payment, type PaymentType, type SaleItem } from '../lib/db';
import { createSale, customerBalance, getActiveTrip, loadCatalog, setCurrentTown, type ProductWithVariants } from '../lib/ops';
import { fmtMoney, normalize } from '../lib/format';
import { Empty, Field, MoneyInput, PageHeader, SearchBox, useAction, useConfirm } from '../components/ui';
import CustomerForm from '../components/CustomerForm';
import SaleView from '../components/SaleView';
import PaymentsEditor, { effectivePayments } from '../components/PaymentsEditor';
import TownInput from '../components/TownInput';
import { Icon } from '../components/Icon';

function matches(p: ProductWithVariants, q: string) {
  const n = normalize(q);
  return normalize(`${p.name} ${p.reference} ${p.category}`).includes(n);
}

export default function NewSale() {
  const catalog = useLiveQuery(() => loadCatalog(), []);
  const trip = useLiveQuery(async () => (await getActiveTrip()) ?? null, []);
  // Pueblo de la venta: en viaje arranca con el "pueblo actual"; se recuerda entre ventas.
  const [town, setTown] = useState<string | null>(null);
  const [editingTown, setEditingTown] = useState(false);
  const townValue = town ?? trip?.currentTown ?? '';
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [custQ, setCustQ] = useState('');
  const [newCustomer, setNewCustomer] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [payment, setPayment] = useState<PaymentType>('contado');
  const [payments, setPayments] = useState<Payment[]>([{ method: 'efectivo', amount: 0 }]);
  const [notes, setNotes] = useState('');
  const [doneId, setDoneId] = useState<number | null>(null);
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [cartVisible, setCartVisible] = useState(false);

  useEffect(() => {
    const el = document.getElementById('cart');
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCartVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const customer = customers?.find((c) => c.id === customerId);
  const balance = useLiveQuery(async () => (customerId ? customerBalance(customerId) : 0), [customerId]);

  const avail = (v: { stock: number; inTrip: number }) => (trip ? v.inTrip : v.stock);
  const availTotal = (p: ProductWithVariants) => (trip ? p.totalInTrip : p.totalStock);

  const results = useMemo(() => {
    if (!catalog || trip === undefined) return [];
    // En viaje solo se muestra lo que se lleva.
    const base = trip ? catalog.filter((p) => p.totalInTrip > 0) : catalog;
    const list = q.trim() ? base.filter((p) => matches(p, q)) : base;
    return list.slice(0, 40);
  }, [catalog, q, trip]);

  const custResults = useMemo(() => {
    if (!customers || !custQ.trim()) return [];
    const n = normalize(custQ);
    return customers.filter((c) => normalize(`${c.name} ${c.phone} ${c.document}`).includes(n)).slice(0, 6);
  }, [customers, custQ]);

  const inCart = (variantId: number) => cart.filter((i) => i.variantId === variantId).reduce((s, i) => s + i.qty, 0);
  const stockOf = (variantId: number) => {
    for (const p of catalog ?? []) for (const v of p.variants) if (v.id === variantId) return avail(v);
    return 0;
  };

  const add = (p: ProductWithVariants, variantId: number) => {
    const v = p.variants.find((x) => x.id === variantId)!;
    setCart((c) => {
      const idx = c.findIndex((i) => i.variantId === variantId);
      if (idx >= 0) return c.map((i, k) => (k === idx ? { ...i, qty: i.qty + 1 } : i));
      return [
        ...c,
        { productId: p.id, variantId, reference: p.reference, name: p.name, size: v.size, qty: 1, price: p.price },
      ];
    });
  };

  const updateItem = (idx: number, patch: Partial<SaleItem>) =>
    setCart((c) => c.map((i, k) => (k === idx ? { ...i, ...patch } : i)).filter((i) => i.qty > 0));

  const subtotal = cart.reduce((s, i) => s + i.qty * i.price, 0);
  const total = Math.max(0, subtotal - discount);
  const overStock = cart.some((i) => inCart(i.variantId) > stockOf(i.variantId));
  const effective = effectivePayments(payments, payment, total);
  const paidNow = effective.reduce((a, p) => a + (p.amount || 0), 0);
  const paymentsOk = payment === 'contado' ? paidNow === total : paidNow <= total;

  const reset = () => {
    setCart([]);
    setCustomerId(null);
    setCustQ('');
    setDiscount(0);
    setPayment('contado');
    setPayments([{ method: 'efectivo', amount: 0 }]);
    setNotes('');
    setQ('');
    setOpen(null);
  };

  const submit = async () => {
    const sale = await run(() =>
      createSale({
        customerId,
        items: cart,
        discount,
        paymentType: payment,
        payments: effectivePayments(payments, payment, total),
        notes,
        town: townValue,
      }),
    );
    if (sale) {
      reset();
      // En viaje vuelve a tomar el pueblo actual (que ahora es el de esta venta); fuera de viaje queda vacío.
      setTown(null);
      setDoneId(sale.id);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Nueva venta" />
      {trip !== undefined && (
        <div className={`sell-source ${trip ? 'trip' : ''}`}>
          <span className="sell-source-icon">
            <Icon name={trip ? 'plane' : 'warehouse'} size={20} />
          </span>
          <div className="grow">
            {trip ? (
              <>
                <strong>Vendiendo en viaje: {trip.destination}</strong>
                <div className="small">
                  Las ventas descuentan de la mercancía que llevas ({catalog?.reduce((a, p) => a + p.totalInTrip, 0) ?? 0} und
                  disponibles).
                </div>
                <div className="current-town">
                  {editingTown ? (
                    <div className="row gap">
                      <div className="grow field">
                        <TownInput value={townValue} onChange={setTown} autoFocus placeholder="¿En qué pueblo estás?" />
                      </div>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={async () => {
                          await run(() => setCurrentTown(townValue));
                          setTown(null);
                          setEditingTown(false);
                        }}
                      >
                        Listo
                      </button>
                    </div>
                  ) : (
                    <span>
                      <Icon name="pin" size={15} /> Vendiendo en: <b>{townValue || 'sin pueblo'}</b> ·{' '}
                      <button className="link-btn" onClick={() => setEditingTown(true)}>
                        cambiar
                      </button>
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <strong>Vendiendo desde bodega</strong>
                <div className="small">No hay un viaje abierto.</div>
              </>
            )}
          </div>
          <Link to={trip ? `/viajes/${trip.id}` : '/viajes'} className="btn btn-sm btn-ghost">
            {trip ? 'Ver viaje' : 'Viajes'}
          </Link>
        </div>
      )}
      <div className="sale-layout">
        <section className="card">
          <SearchBox value={q} onChange={setQ} placeholder="Buscar producto por nombre, referencia o categoría" />
          {catalog && catalog.length === 0 && <Empty>No hay productos. Créalos en Productos.</Empty>}
          {catalog && trip && results.length === 0 && !q && (
            <Empty>
              No llevas mercancía en este viaje. <Link to={`/viajes/${trip.id}`}>Cargar mercancía</Link>
            </Empty>
          )}
          <ul className="list product-pick">
            {results.map((p) => (
              <li key={p.id}>
                <button className="list-row pick-row" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <div>
                    <strong>{p.name}</strong>
                    <div className="muted small">
                      Ref {p.reference}
                      {p.category && ` · ${p.category}`}
                    </div>
                  </div>
                  <div className="right">
                    <div>{fmtMoney(p.price)}</div>
                    <div className={`small ${availTotal(p) ? 'muted' : 'text-danger'}`}>
                      {availTotal(p)} und{trip ? ' en viaje' : ''}
                    </div>
                  </div>
                </button>
                {open === p.id && (
                  <div className="sizes">
                    {p.variants.filter((v) => !trip || v.inTrip > 0).map((v) => {
                      const left = avail(v) - inCart(v.id);
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

        {cart.length > 0 && !cartVisible && (
          <button
            className="cart-float"
            onClick={() => document.getElementById('cart')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <span>Ver venta · {cart.reduce((s, i) => s + i.qty, 0)} und</span>
            <strong>{fmtMoney(total)}</strong>
          </button>
        )}
        <section className="card cart" id="cart">
          <h2>Venta</h2>
          {cart.length === 0 ? (
            <p className="muted">Busca un producto y toca la talla para agregarlo.</p>
          ) : (
            <ul className="list">
              {cart.map((i, idx) => {
                const over = inCart(i.variantId) > stockOf(i.variantId);
                return (
                  <li key={i.variantId} className="cart-row">
                    <div className="cart-info">
                      <strong>
                        {i.name} <span className="muted">({i.size})</span>
                      </strong>
                      {over && <div className="small text-danger">Solo hay {stockOf(i.variantId)} disponibles</div>}
                      <MoneyInput value={i.price} onChange={(price) => updateItem(idx, { price })} aria-label="Precio unitario" />
                    </div>
                    <div className="qty">
                      <button className="icon-btn" onClick={() => updateItem(idx, { qty: i.qty - 1 })} aria-label="Menos">
                        −
                      </button>
                      <span>{i.qty}</span>
                      <button className="icon-btn" onClick={() => updateItem(idx, { qty: i.qty + 1 })} aria-label="Más">
                        +
                      </button>
                    </div>
                    <div className="num line-total">{fmtMoney(i.qty * i.price)}</div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="form">
            <Field label="Cliente">
              {customer ? (
                <div className="chosen">
                  <div>
                    <strong>{customer.name}</strong>
                    <div className="muted small">
                      {customer.phone || 'Sin celular'}
                      {balance ? ` · Debe ${fmtMoney(balance)}` : ''}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-ghost" onClick={() => setCustomerId(null)}>
                    Cambiar
                  </button>
                </div>
              ) : (
                <div className="combo">
                  <input value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="Buscar cliente (opcional)" />
                  {custQ.trim() && (
                    <div className="combo-list">
                      {custResults.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setCustomerId(c.id);
                            if (!trip && !townValue && c.town) setTown(c.town);
                            setCustQ('');
                          }}
                        >
                          {c.name} <span className="muted small">{c.phone}</span>
                        </button>
                      ))}
                      <button className="combo-new" onClick={() => setNewCustomer(true)}>
                        + Crear cliente “{custQ.trim()}”
                      </button>
                    </div>
                  )}
                </div>
              )}
            </Field>

            <div className="grid-2">
              <Field label="Forma de pago">
                <div className="segmented">
                  <button
                    className={payment === 'contado' ? 'active' : ''}
                    onClick={() => {
                      setPayment('contado');
                      setPayments([{ method: 'efectivo', amount: 0 }]);
                    }}
                  >
                    Contado
                  </button>
                  <button
                    className={payment === 'credito' ? 'active' : ''}
                    onClick={() => {
                      setPayment('credito');
                      setPayments([]);
                    }}
                  >
                    Crédito
                  </button>
                </div>
              </Field>
              <Field label="Descuento">
                <MoneyInput value={discount} onChange={setDiscount} />
              </Field>
            </div>
            <Field
              label={payment === 'contado' ? 'Medio de pago' : 'Abono inicial (opcional)'}
              hint={payment === 'credito' && !customer ? 'Selecciona un cliente para vender a crédito.' : undefined}
            >
              <PaymentsEditor mode={payment} total={total} value={payments} onChange={setPayments} />
            </Field>
            {!trip && (
              <Field label="Pueblo / ciudad" hint="Opcional. Sirve para saber quién te debe en cada pueblo.">
                <TownInput value={townValue} onChange={setTown} />
              </Field>
            )}
            {trip && (
              <p className="muted small town-line">
                <Icon name="pin" size={14} /> Pueblo de esta venta: <b>{townValue || 'sin pueblo'}</b>{' '}
                <button className="link-btn" onClick={() => setEditingTown(true)}>
                  cambiar
                </button>
              </p>
            )}
            <Field label="Nota">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
            </Field>
          </div>

          <div className="totals">
            {discount > 0 && (
              <div className="row-between muted">
                <span>Subtotal</span>
                <span>{fmtMoney(subtotal)}</span>
              </div>
            )}
            <div className="row-between total">
              <span>Total</span>
              <span>{fmtMoney(total)}</span>
            </div>
            {payment === 'credito' && (
              <div className="row-between muted">
                <span>Queda debiendo</span>
                <span>{fmtMoney(total - paidNow)}</span>
              </div>
            )}
          </div>
          <div className="actions">
            {cart.length > 0 && (
              <button className="btn btn-ghost" onClick={async () => (await confirm('¿Vaciar la venta?', { confirmLabel: 'Vaciar' })) && reset()}>
                Vaciar
              </button>
            )}
            <button
              className="btn btn-primary btn-lg grow"
              disabled={busy || !cart.length || overStock || !paymentsOk || (payment === 'credito' && !customerId)}
              onClick={submit}
            >
              Registrar venta · {fmtMoney(total)}
            </button>
          </div>
        </section>
      </div>

      {newCustomer && (
        <CustomerForm
          initialName={custQ.trim()}
          initialTown={townValue}
          onClose={() => setNewCustomer(false)}
          onSaved={(id) => {
            setCustomerId(id);
            setCustQ('');
          }}
        />
      )}
      {doneId && <SaleView saleId={doneId} justCreated onClose={() => setDoneId(null)} />}
    </div>
  );
}
