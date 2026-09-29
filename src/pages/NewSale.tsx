import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type PaymentType, type SaleItem } from '../lib/db';
import { createSale, customerBalance, loadCatalog, type ProductWithVariants } from '../lib/ops';
import { fmtMoney, normalize } from '../lib/format';
import { Empty, Field, MoneyInput, PageHeader, SearchBox, useAction, useConfirm } from '../components/ui';
import CustomerForm from '../components/CustomerForm';
import SaleView from '../components/SaleView';

function matches(p: ProductWithVariants, q: string) {
  const n = normalize(q);
  return normalize(`${p.name} ${p.reference} ${p.category}`).includes(n);
}

export default function NewSale() {
  const catalog = useLiveQuery(() => loadCatalog(), []);
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [custQ, setCustQ] = useState('');
  const [newCustomer, setNewCustomer] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [payment, setPayment] = useState<PaymentType>('contado');
  const [paid, setPaid] = useState(0);
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

  const results = useMemo(() => {
    if (!catalog) return [];
    const list = q.trim() ? catalog.filter((p) => matches(p, q)) : catalog;
    return list.slice(0, 30);
  }, [catalog, q]);

  const custResults = useMemo(() => {
    if (!customers || !custQ.trim()) return [];
    const n = normalize(custQ);
    return customers.filter((c) => normalize(`${c.name} ${c.phone} ${c.document}`).includes(n)).slice(0, 6);
  }, [customers, custQ]);

  const inCart = (variantId: number) => cart.filter((i) => i.variantId === variantId).reduce((s, i) => s + i.qty, 0);
  const stockOf = (variantId: number) => {
    for (const p of catalog ?? []) for (const v of p.variants) if (v.id === variantId) return v.stock;
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

  const reset = () => {
    setCart([]);
    setCustomerId(null);
    setCustQ('');
    setDiscount(0);
    setPayment('contado');
    setPaid(0);
    setNotes('');
    setQ('');
    setOpen(null);
  };

  const submit = async () => {
    const sale = await run(() =>
      createSale({ customerId, items: cart, discount, paymentType: payment, paid, notes }),
    );
    if (sale) {
      reset();
      setDoneId(sale.id);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Nueva venta" />
      <div className="sale-layout">
        <section className="card">
          <SearchBox value={q} onChange={setQ} placeholder="Buscar producto por nombre, referencia o categoría" />
          {catalog && catalog.length === 0 && <Empty>No hay productos. Créalos en Productos.</Empty>}
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
                    <div className={`small ${p.totalStock ? 'muted' : 'text-danger'}`}>{p.totalStock} und</div>
                  </div>
                </button>
                {open === p.id && (
                  <div className="sizes">
                    {p.variants.map((v) => {
                      const left = v.stock - inCart(v.id);
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
                  <button className={payment === 'contado' ? 'active' : ''} onClick={() => setPayment('contado')}>
                    Contado
                  </button>
                  <button className={payment === 'credito' ? 'active' : ''} onClick={() => setPayment('credito')}>
                    Crédito
                  </button>
                </div>
              </Field>
              <Field label="Descuento">
                <MoneyInput value={discount} onChange={setDiscount} />
              </Field>
            </div>
            {payment === 'credito' && (
              <Field label="Abono inicial" hint={customer ? undefined : 'Selecciona un cliente para vender a crédito.'}>
                <MoneyInput value={paid} onChange={(n) => setPaid(Math.min(n, total))} />
              </Field>
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
                <span>{fmtMoney(total - paid)}</span>
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
              disabled={busy || !cart.length || overStock || (payment === 'credito' && !customerId)}
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
