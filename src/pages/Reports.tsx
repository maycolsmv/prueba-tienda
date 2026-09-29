import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { allBalances, loadCatalog } from '../lib/ops';
import { endOfDay, fmtDate, fmtMoney, startOfDay, toDateInput } from '../lib/format';
import { exportXlsx } from '../lib/excel';
import { Field, PageHeader, Tabs } from '../components/ui';

type Tab = 'ventas' | 'top' | 'rotacion' | 'existencias' | 'cartera';

const PRESETS = [
  { label: 'Hoy', days: 0 },
  { label: '7 días', days: 6 },
  { label: '30 días', days: 29 },
  { label: 'Este mes', days: -1 },
];

export default function Reports() {
  const [from, setFrom] = useState(toDateInput(Date.now() - 29 * 86_400_000));
  const [to, setTo] = useState(toDateInput(Date.now()));
  const [tab, setTab] = useState<Tab>('ventas');

  const r = useLiveQuery(async () => {
    const a = startOfDay(from);
    const b = endOfDay(to);
    const [sales, catalog, balances, customers, ledger, lastSaleMovs] = await Promise.all([
      db.sales.where('date').between(a, b, true, true).toArray(),
      loadCatalog(),
      allBalances(),
      db.customers.toArray(),
      db.ledger.where('date').between(a, b, true, true).toArray(),
      db.movements.where('type').equals('venta').toArray(),
    ]);
    const valid = sales.filter((s) => !s.voided);

    // Ventas por día
    const byDay = new Map<string, { total: number; count: number }>();
    for (const s of valid) {
      const k = toDateInput(s.date);
      const d = byDay.get(k) ?? { total: 0, count: 0 };
      d.total += s.total;
      d.count++;
      byDay.set(k, d);
    }
    const days = [...byDay.entries()].sort((x, y) => y[0].localeCompare(x[0]));

    // Por producto
    const byProduct = new Map<number, { name: string; reference: string; units: number; revenue: number }>();
    for (const s of valid)
      for (const i of s.items) {
        const d = byProduct.get(i.productId) ?? { name: i.name, reference: i.reference, units: 0, revenue: 0 };
        d.units += i.qty;
        d.revenue += i.qty * i.price;
        byProduct.set(i.productId, d);
      }
    const top = [...byProduct.entries()].map(([id, d]) => ({ id, ...d })).sort((x, y) => y.units - x.units);

    // Baja rotación: productos con existencia que se vendieron poco en el periodo
    const lastSale = new Map<number, number>();
    for (const m of lastSaleMovs) lastSale.set(m.productId, Math.max(lastSale.get(m.productId) ?? 0, m.date));
    const slow = catalog
      .filter((p) => p.totalStock > 0)
      .map((p) => ({
        ...p,
        sold: byProduct.get(p.id)?.units ?? 0,
        lastSale: lastSale.get(p.id) ?? null,
      }))
      .sort((x, y) => x.sold - y.sold || (x.lastSale ?? 0) - (y.lastSale ?? 0))
      .slice(0, 40);

    // Existencias por categoría
    const byCat = new Map<string, { units: number; value: number; cost: number; products: number }>();
    for (const p of catalog) {
      const k = p.category || 'Sin categoría';
      const d = byCat.get(k) ?? { units: 0, value: 0, cost: 0, products: 0 };
      d.units += p.totalStock;
      d.value += p.totalStock * p.price;
      d.cost += p.totalStock * p.cost;
      d.products++;
      byCat.set(k, d);
    }

    const debtors = customers
      .map((c) => ({ ...c, balance: balances.get(c.id) ?? 0 }))
      .filter((c) => c.balance > 0)
      .sort((x, y) => y.balance - x.balance);

    const total = valid.reduce((s, x) => s + x.total, 0);
    return {
      total,
      count: valid.length,
      voided: sales.length - valid.length,
      units: valid.reduce((s, x) => s + x.items.reduce((a, i) => a + i.qty, 0), 0),
      discount: valid.reduce((s, x) => s + x.discount, 0),
      contado: valid.filter((s) => s.paymentType === 'contado').reduce((a, s) => a + s.total, 0),
      credito: valid.filter((s) => s.paymentType === 'credito').reduce((a, s) => a + s.total, 0),
      cost: valid.reduce(
        (s, x) => s + x.items.reduce((a, i) => a + i.qty * (catalog.find((p) => p.id === i.productId)?.cost ?? 0), 0),
        0,
      ),
      days,
      top,
      slow,
      byCat: [...byCat.entries()].sort((x, y) => y[1].units - x[1].units),
      debtors,
      cartera: debtors.reduce((a, c) => a + c.balance, 0),
      abonos: ledger.filter((e) => e.type === 'abono' && !e.note.startsWith('Anulación')).reduce((a, e) => a + e.amount, 0),
    };
  }, [from, to]);

  const preset = (days: number) => {
    const now = new Date();
    setTo(toDateInput(now.getTime()));
    setFrom(days < 0 ? toDateInput(new Date(now.getFullYear(), now.getMonth(), 1).getTime()) : toDateInput(now.getTime() - days * 86_400_000));
  };

  const exportReport = () => {
    if (!r) return;
    exportXlsx(`reporte-${from}-a-${to}.xlsx`, [
      {
        name: 'Resumen',
        rows: [
          { Concepto: 'Periodo', Valor: `${from} a ${to}` },
          { Concepto: 'Ventas', Valor: r.count },
          { Concepto: 'Total vendido', Valor: r.total },
          { Concepto: 'Contado', Valor: r.contado },
          { Concepto: 'Crédito', Valor: r.credito },
          { Concepto: 'Descuentos', Valor: r.discount },
          { Concepto: 'Unidades vendidas', Valor: r.units },
          { Concepto: 'Costo de lo vendido', Valor: r.cost },
          { Concepto: 'Ganancia bruta', Valor: r.total - r.cost },
          { Concepto: 'Abonos recibidos', Valor: r.abonos },
          { Concepto: 'Cartera total por cobrar', Valor: r.cartera },
        ],
      },
      { name: 'Por dia', rows: r.days.map(([d, x]) => ({ Fecha: d, Ventas: x.count, Total: x.total })) },
      { name: 'Mas vendidos', rows: r.top.map((p) => ({ Referencia: p.reference, Producto: p.name, Unidades: p.units, Total: p.revenue })) },
      {
        name: 'Baja rotacion',
        rows: r.slow.map((p) => ({
          Referencia: p.reference,
          Producto: p.name,
          Existencia: p.totalStock,
          VendidasPeriodo: p.sold,
          UltimaVenta: p.lastSale ? fmtDate(p.lastSale) : 'Nunca',
        })),
      },
      {
        name: 'Existencias',
        rows: r.byCat.map(([c, x]) => ({ Categoria: c, Productos: x.products, Unidades: x.units, ValorCosto: x.cost, ValorVenta: x.value })),
      },
      { name: 'Cartera', rows: r.debtors.map((c) => ({ Cliente: c.name, Celular: c.phone, Saldo: c.balance })) },
    ]);
  };

  const maxDay = Math.max(1, ...(r?.days.map(([, d]) => d.total) ?? [1]));
  const maxTop = Math.max(1, ...(r?.top.map((p) => p.units) ?? [1]));

  return (
    <div className="page">
      <PageHeader
        title="Reportes"
        actions={
          <button className="btn btn-ghost" onClick={exportReport} disabled={!r}>
            Exportar a Excel
          </button>
        }
      />
      <div className="card filters">
        <div className="grid-2">
          <Field label="Desde">
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </Field>
          <Field label="Hasta">
            <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </Field>
        </div>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.label} className="chip" onClick={() => preset(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ventas', label: 'Ventas' },
          { value: 'top', label: 'Más vendidos' },
          { value: 'rotacion', label: 'Baja rotación' },
          { value: 'existencias', label: 'Existencias' },
          { value: 'cartera', label: 'Cartera' },
        ]}
      />

      {r && tab === 'ventas' && (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Total vendido</span>
              <span className="stat-value">{fmtMoney(r.total)}</span>
              <span className="stat-sub">
                {r.count} ventas · {r.units} und
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Ticket promedio</span>
              <span className="stat-value">{fmtMoney(r.count ? r.total / r.count : 0)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Contado / Crédito</span>
              <span className="stat-value small-value">
                {fmtMoney(r.contado)} / {fmtMoney(r.credito)}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Ganancia bruta</span>
              <span className="stat-value">{fmtMoney(r.total - r.cost)}</span>
              <span className="stat-sub">Costo {fmtMoney(r.cost)}</span>
            </div>
          </div>
          {(r.discount > 0 || r.voided > 0) && (
            <p className="muted small">
              Descuentos: {fmtMoney(r.discount)} · Ventas anuladas: {r.voided}
            </p>
          )}
          <section className="card">
            <h2>Por día</h2>
            {r.days.length === 0 ? (
              <p className="muted">Sin ventas en el periodo.</p>
            ) : (
              <ul className="bars">
                {r.days.map(([d, x]) => (
                  <li key={d}>
                    <span className="bar-label">{fmtDate(startOfDay(d))}</span>
                    <span className="bar-track">
                      <span className="bar" style={{ width: `${(x.total / maxDay) * 100}%` }} />
                    </span>
                    <span className="bar-value">{fmtMoney(x.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {r && tab === 'top' && (
        <section className="card">
          <h2>Productos más vendidos</h2>
          {r.top.length === 0 ? (
            <p className="muted">Sin ventas en el periodo.</p>
          ) : (
            <ul className="bars">
              {r.top.slice(0, 20).map((p) => (
                <li key={p.id}>
                  <span className="bar-label">
                    {p.name}
                    <span className="muted small"> · {p.reference}</span>
                  </span>
                  <span className="bar-track">
                    <span className="bar" style={{ width: `${(p.units / maxTop) * 100}%` }} />
                  </span>
                  <span className="bar-value">
                    {p.units} und · {fmtMoney(p.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {r && tab === 'rotacion' && (
        <section className="card flush table-wrap">
          <p className="muted small pad">Productos con existencia que menos se vendieron en el periodo.</p>
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Existencia</th>
                <th className="num">Vendidas</th>
                <th>Última venta</th>
              </tr>
            </thead>
            <tbody>
              {r.slow.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    <div className="muted small">Ref {p.reference}</div>
                  </td>
                  <td className="num">{p.totalStock}</td>
                  <td className={`num ${p.sold === 0 ? 'text-danger' : ''}`}>{p.sold}</td>
                  <td className="small">{p.lastSale ? fmtDate(p.lastSale) : 'Nunca'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {r && tab === 'existencias' && (
        <section className="card flush table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Unidades</th>
                <th className="num">Valor costo</th>
                <th className="num">Valor venta</th>
              </tr>
            </thead>
            <tbody>
              {r.byCat.map(([c, x]) => (
                <tr key={c}>
                  <td>
                    {c} <span className="muted small">({x.products})</span>
                  </td>
                  <td className="num">{x.units}</td>
                  <td className="num">{fmtMoney(x.cost)}</td>
                  <td className="num">{fmtMoney(x.value)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td>Total</td>
                <td className="num">{r.byCat.reduce((a, [, x]) => a + x.units, 0)}</td>
                <td className="num">{fmtMoney(r.byCat.reduce((a, [, x]) => a + x.cost, 0))}</td>
                <td className="num">{fmtMoney(r.byCat.reduce((a, [, x]) => a + x.value, 0))}</td>
              </tr>
            </tbody>
          </table>
          <p className="pad small">
            <Link to="/inventario" className="link">
              Ver existencias por talla →
            </Link>
          </p>
        </section>
      )}

      {r && tab === 'cartera' && (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Cartera por cobrar</span>
              <span className="stat-value text-danger">{fmtMoney(r.cartera)}</span>
              <span className="stat-sub">{r.debtors.length} clientes (hoy)</span>
            </div>
            <div className="stat">
              <span className="stat-label">Abonos recibidos</span>
              <span className="stat-value text-ok">{fmtMoney(r.abonos)}</span>
              <span className="stat-sub">En el periodo</span>
            </div>
          </div>
          <div className="card flush">
            <ul className="list">
              {r.debtors.map((c) => (
                <li key={c.id}>
                  <Link to={`/clientes/${c.id}`} className="list-row pick-row">
                    <span>
                      <strong>{c.name}</strong>
                      <span className="muted small"> {c.phone}</span>
                    </span>
                    <strong>{fmtMoney(c.balance)}</strong>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
