import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { allBalances, loadCatalog } from '../lib/ops';
import { endOfDay, fmtDate, fmtMoney, fmtNum, startOfDay, toDateInput } from '../lib/format';
import { exportXlsx } from '../lib/excel';
import { debtAging } from '../lib/stats';
import { Field, PageHeader, Tabs } from '../components/ui';
import { ChartCard, ChartEmpty, ColumnChart, fmtPct, SegmentBar, ShareBars, TrendChart, useChartColors } from '../components/charts';

type Tab = 'ventas' | 'top' | 'rotacion' | 'existencias' | 'cartera';

const DAY = 86_400_000;

const PRESETS = [
  { label: 'Hoy', days: 0 },
  { label: '7 días', days: 6 },
  { label: '30 días', days: 29 },
  { label: '90 días', days: 89 },
  { label: 'Este mes', days: -1 },
];

export default function Reports() {
  const [from, setFrom] = useState(toDateInput(Date.now() - 29 * DAY));
  const [to, setTo] = useState(toDateInput(Date.now()));
  const [tab, setTab] = useState<Tab>('ventas');
  const c = useChartColors();

  const r = useLiveQuery(async () => {
    const a = startOfDay(from);
    const b = endOfDay(to);
    const [sales, catalog, balances, customers, ledger, allLedger, lastSaleMovs] = await Promise.all([
      db.sales.where('date').between(a, b, true, true).toArray(),
      loadCatalog(),
      allBalances(),
      db.customers.toArray(),
      db.ledger.where('date').between(a, b, true, true).toArray(),
      db.ledger.toArray(),
      db.movements.where('type').equals('venta').toArray(),
    ]);
    const valid = sales.filter((s) => !s.voided);

    // Ventas por día (incluye los días sin ventas para la gráfica)
    const byDay = new Map<string, { total: number; count: number }>();
    for (const s of valid) {
      const k = toDateInput(s.date);
      const d = byDay.get(k) ?? { total: 0, count: 0 };
      d.total += s.total;
      d.count++;
      byDay.set(k, d);
    }
    const days = [...byDay.entries()].sort((x, y) => y[0].localeCompare(x[0]));
    const series: { label: string; total: number; count: number }[] = [];
    for (let t = a; t <= b; t += DAY) {
      const dt = new Date(t);
      series.push({ label: `${dt.getDate()}/${dt.getMonth() + 1}`, ...(byDay.get(toDateInput(t)) ?? { total: 0, count: 0 }) });
    }

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

    const { buckets, oldestByCustomer } = debtAging(allLedger);
    const debtors = customers
      .map((c) => ({ ...c, balance: balances.get(c.id) ?? 0, days: oldestByCustomer.get(c.id) ?? null }))
      .filter((c) => c.balance > 0)
      .sort((x, y) => y.balance - x.balance);

    const costOf = new Map(catalog.map((p) => [p.id, p.cost]));
    const total = valid.reduce((s, x) => s + x.total, 0);
    return {
      total,
      count: valid.length,
      voided: sales.length - valid.length,
      units: valid.reduce((s, x) => s + x.items.reduce((a, i) => a + i.qty, 0), 0),
      discount: valid.reduce((s, x) => s + x.discount, 0),
      contado: valid.filter((s) => s.paymentType === 'contado').reduce((a, s) => a + s.total, 0),
      credito: valid.filter((s) => s.paymentType === 'credito').reduce((a, s) => a + s.total, 0),
      cost: valid.reduce((s, x) => s + x.items.reduce((a, i) => a + i.qty * (costOf.get(i.productId) ?? 0), 0), 0),
      days,
      series,
      top,
      slow,
      byCat: [...byCat.entries()].sort((x, y) => y[1].units - x[1].units),
      debtors,
      aging: buckets,
      cartera: debtors.reduce((a, c) => a + c.balance, 0),
      abonos: ledger.filter((e) => e.type === 'abono' && !e.note.startsWith('Anulación')).reduce((a, e) => a + e.amount, 0),
    };
  }, [from, to]);

  const preset = (days: number) => {
    const now = new Date();
    setTo(toDateInput(now.getTime()));
    setFrom(days < 0 ? toDateInput(new Date(now.getFullYear(), now.getMonth(), 1).getTime()) : toDateInput(now.getTime() - days * DAY));
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
          { Concepto: 'Margen bruto %', Valor: r.total ? Math.round(((r.total - r.cost) / r.total) * 1000) / 10 : 0 },
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
      {
        name: 'Cartera',
        rows: r.debtors.map((c) => ({ Cliente: c.name, Celular: c.phone, Saldo: c.balance, DiasDeudaMasAntigua: c.days ?? '' })),
      },
      { name: 'Antiguedad cartera', rows: r.aging.map((b) => ({ Rango: b.label, Valor: b.amount })) },
    ]);
  };

  const margin = r && r.total ? ((r.total - r.cost) / r.total) * 100 : null;
  const unitsSold = r?.top.reduce((a, p) => a + p.units, 0) ?? 0;
  const invUnits = r?.byCat.reduce((a, [, x]) => a + x.units, 0) ?? 0;
  const agingTotal = r?.aging.reduce((a, b) => a + b.amount, 0) ?? 0;

  return (
    <div className="page">
      <PageHeader
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
          <div className="kpis">
            <div className="kpi">
              <span className="kpi-label">Total vendido</span>
              <div className="kpi-value">{fmtMoney(r.total)}</div>
              <div className="kpi-foot">
                {r.count} ventas · {fmtNum(r.units)} und
              </div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Ticket promedio</span>
              <div className="kpi-value">{fmtMoney(r.count ? r.total / r.count : 0)}</div>
              <div className="kpi-foot">Descuentos {fmtMoney(r.discount)}</div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Ganancia bruta</span>
              <div className="kpi-value">{fmtMoney(r.total - r.cost)}</div>
              <div className="kpi-foot">
                {margin !== null && <span className="badge no-dot badge-ok">Margen {fmtPct(margin, 1)}</span>}
                <span>Costo {fmtMoney(r.cost)}</span>
              </div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Abonos recibidos</span>
              <div className="kpi-value">{fmtMoney(r.abonos)}</div>
              <div className="kpi-foot">{r.voided ? `${r.voided} ventas anuladas` : 'Sin ventas anuladas'}</div>
            </div>
          </div>
          <div className="dash-grid">
            <ChartCard className="span-2" title="Ventas por día" subtitle="Total vendido en el periodo">
              {r.count ? <TrendChart data={r.series} /> : <ChartEmpty text="Sin ventas en el periodo." />}
            </ChartCard>
            <ChartCard title="Contado vs. crédito" subtitle="Participación en el total">
              <SegmentBar
                parts={[
                  { label: 'Contado', value: r.contado, color: c.series[0] },
                  { label: 'Crédito', value: r.credito, color: c.series[1] },
                ]}
              />
            </ChartCard>
          </div>
          {r.days.length > 0 && (
            <div className="card flush table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th className="num">Ventas</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {r.days.map(([d, x]) => (
                    <tr key={d}>
                      <td>{fmtDate(startOfDay(d))}</td>
                      <td className="num">{x.count}</td>
                      <td className="num">{fmtMoney(x.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {r && tab === 'top' && (
        <>
          <ChartCard title="Productos más vendidos" subtitle="Unidades vendidas y % del total">
            {r.top.length ? (
              <ShareBars
                fmt="units"
                data={r.top.slice(0, 10).map((p) => ({ name: p.name, value: p.units, pct: unitsSold ? (p.units / unitsSold) * 100 : 0 }))}
              />
            ) : (
              <ChartEmpty text="Sin ventas en el periodo." />
            )}
          </ChartCard>
          {r.top.length > 0 && (
            <div className="card flush table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Producto</th>
                    <th className="num">Unidades</th>
                    <th className="num">% unidades</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {r.top.map((p, i) => (
                    <tr key={p.id}>
                      <td className="muted">{i + 1}</td>
                      <td>
                        {p.name}
                        <div className="muted small">Ref {p.reference}</div>
                      </td>
                      <td className="num">{p.units}</td>
                      <td className="num">{fmtPct(unitsSold ? (p.units / unitsSold) * 100 : 0, 1)}</td>
                      <td className="num">{fmtMoney(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {r && tab === 'rotacion' && (
        <>
          <ChartCard title="Baja rotación" subtitle="Unidades en bodega de los productos que menos se vendieron">
            {r.slow.length ? (
              <ColumnChart
                data={r.slow.slice(0, 12).map((p) => ({ name: p.reference, stock: p.totalStock, sold: p.sold, full: p.name }))}
                x="name"
                y="stock"
                fmt="units"
                colorIndex={1}
                extra={(p) => `${p.full} · vendidas: ${p.sold}`}
              />
            ) : (
              <ChartEmpty icon="inventory" text="No hay productos con existencias." />
            )}
          </ChartCard>
          {r.slow.length > 0 && (
            <div className="card flush table-wrap">
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
                      <td className="num">{p.sold === 0 ? <span className="badge badge-danger">0</span> : p.sold}</td>
                      <td className="small">{p.lastSale ? fmtDate(p.lastSale) : 'Nunca'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {r && tab === 'existencias' && (
        <>
          <ChartCard title="Existencias por categoría" subtitle="Unidades en bodega y % del inventario">
            {invUnits ? (
              <ShareBars
                fmt="units"
                data={r.byCat.map(([name, x]) => ({ name, value: x.units, pct: (x.units / invUnits) * 100 }))}
              />
            ) : (
              <ChartEmpty icon="inventory" text="No hay unidades en inventario." />
            )}
          </ChartCard>
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
                {r.byCat.map(([cat, x]) => (
                  <tr key={cat}>
                    <td>
                      {cat} <span className="muted small">({x.products})</span>
                    </td>
                    <td className="num">{x.units}</td>
                    <td className="num">{fmtMoney(x.cost)}</td>
                    <td className="num">{fmtMoney(x.value)}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td>Total</td>
                  <td className="num">{invUnits}</td>
                  <td className="num">{fmtMoney(r.byCat.reduce((a, [, x]) => a + x.cost, 0))}</td>
                  <td className="num">{fmtMoney(r.byCat.reduce((a, [, x]) => a + x.value, 0))}</td>
                </tr>
              </tbody>
            </table>
            <p className="pad small" style={{ paddingBottom: 14 }}>
              <Link to="/inventario" className="link">
                Ver existencias por talla →
              </Link>
            </p>
          </section>
        </>
      )}

      {r && tab === 'cartera' && (
        <>
          <div className="kpis">
            <div className="kpi">
              <span className="kpi-label">Cartera por cobrar</span>
              <div className="kpi-value text-danger">{fmtMoney(r.cartera)}</div>
              <div className="kpi-foot">{r.debtors.length} clientes (hoy)</div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Abonos recibidos</span>
              <div className="kpi-value text-ok">{fmtMoney(r.abonos)}</div>
              <div className="kpi-foot">En el periodo</div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Vencida (+30 días)</span>
              <div className="kpi-value">{fmtMoney(agingTotal - (r.aging[0]?.amount ?? 0))}</div>
              <div className="kpi-foot">
                {agingTotal > 0 && (
                  <span className="badge no-dot badge-warn">{fmtPct(((agingTotal - r.aging[0].amount) / agingTotal) * 100)} del total</span>
                )}
              </div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Más de 90 días</span>
              <div className="kpi-value">{fmtMoney(r.aging[3]?.amount ?? 0)}</div>
              <div className="kpi-foot">
                {agingTotal > 0 && <span className="badge no-dot badge-danger">{fmtPct((r.aging[3].amount / agingTotal) * 100)} del total</span>}
              </div>
            </div>
          </div>
          <ChartCard title="Antigüedad de la cartera" subtitle="Saldo pendiente según la fecha de la deuda (los abonos pagan primero lo más viejo)">
            {agingTotal ? (
              <ColumnChart data={r.aging} x="label" y="amount" colorIndex={1} />
            ) : (
              <ChartEmpty icon="wallet" text="Ningún cliente tiene saldo pendiente." />
            )}
          </ChartCard>
          {r.debtors.length > 0 && (
            <div className="card flush">
              <ul className="list">
                {r.debtors.map((x) => (
                  <li key={x.id}>
                    <Link to={`/clientes/${x.id}`} className="list-row pick-row">
                      <div className="row-main">
                        <span className="avatar">{x.name.slice(0, 1).toUpperCase()}</span>
                        <div>
                          <strong>{x.name}</strong>
                          <div className="muted small">{x.phone}</div>
                        </div>
                      </div>
                      <div className="right">
                        <strong>{fmtMoney(x.balance)}</strong>
                        {x.days !== null && (
                          <span className={`badge ${x.days > 60 ? 'badge-danger' : x.days > 30 ? 'badge-warn' : 'badge-info'}`}>
                            {x.days} días
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
