import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { endOfDay, fmtDateTime, fmtMoney, normalize, startOfDay, toDateInput } from '../lib/format';
import { Empty, Field, PageHeader, SearchBox } from '../components/ui';
import SaleView from '../components/SaleView';
import { exportSales } from '../lib/exports';

export default function Sales() {
  const today = toDateInput(Date.now());
  const [from, setFrom] = useState(toDateInput(Date.now() - 6 * 86_400_000));
  const [to, setTo] = useState(today);
  const [q, setQ] = useState('');
  const [pay, setPay] = useState<'' | 'contado' | 'credito'>('');
  const [openId, setOpenId] = useState<number | null>(null);

  const sales = useLiveQuery(
    () => db.sales.where('date').between(startOfDay(from), endOfDay(to), true, true).reverse().sortBy('date'),
    [from, to],
  );

  const list = useMemo(() => {
    if (!sales) return [];
    const n = normalize(q);
    return sales.filter(
      (s) =>
        (!pay || s.paymentType === pay) &&
        (!n ||
          String(s.number).includes(n) ||
          normalize(s.customerName).includes(n) ||
          normalize(s.town ?? '').includes(n) ||
          s.items.some((i) => normalize(`${i.name} ${i.reference}`).includes(n))),
    );
  }, [sales, q, pay]);

  const valid = list.filter((s) => !s.voided);
  const total = valid.reduce((a, s) => a + s.total, 0);
  const contado = valid.filter((s) => s.paymentType === 'contado').reduce((a, s) => a + s.total, 0);

  return (
    <div className="page">
      <PageHeader
        actions={
          <button className="btn btn-ghost" onClick={() => exportSales(list, from, to)} disabled={!list.length}>
            Exportar a Excel
          </button>
        }
      />
      <div className="card filters">
        <div className="grid-3">
          <Field label="Desde">
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </Field>
          <Field label="Hasta">
            <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </Field>
          <Field label="Pago">
            <select value={pay} onChange={(e) => setPay(e.target.value as typeof pay)}>
              <option value="">Todos</option>
              <option value="contado">Contado</option>
              <option value="credito">Crédito</option>
            </select>
          </Field>
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Buscar por número, cliente, pueblo o producto" />
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Total vendido</span>
          <div className="kpi-value">{fmtMoney(total)}</div>
          <div className="kpi-foot">{valid.length} ventas</div>
        </div>
        <div className="kpi">
          <span className="kpi-label">Ticket promedio</span>
          <div className="kpi-value">{fmtMoney(valid.length ? total / valid.length : 0)}</div>
          <div className="kpi-foot">{valid.reduce((a, s) => a + s.items.reduce((b, i) => b + i.qty, 0), 0)} unidades</div>
        </div>
        <div className="kpi">
          <span className="kpi-label">Contado</span>
          <div className="kpi-value">{fmtMoney(contado)}</div>
          <div className="kpi-foot">
            <span className="badge no-dot badge-ok">{total ? Math.round((contado / total) * 100) : 0}%</span>
          </div>
        </div>
        <div className="kpi">
          <span className="kpi-label">Crédito</span>
          <div className="kpi-value">{fmtMoney(total - contado)}</div>
          <div className="kpi-foot">
            <span className="badge no-dot badge-warn">{total ? Math.round(((total - contado) / total) * 100) : 0}%</span>
            {list.length - valid.length > 0 && <span>{list.length - valid.length} anuladas</span>}
          </div>
        </div>
      </div>

      {!sales ? null : list.length === 0 ? (
        <Empty>No hay ventas en este periodo.</Empty>
      ) : (
        <div className="card flush table-wrap">
          <table className="table stack-table">
            <thead>
              <tr>
                <th>Venta</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Pueblo</th>
                <th className="num">Und</th>
                <th>Pago</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr
                  key={s.id}
                  className={`clickable-row ${s.voided ? 'voided' : ''}`}
                  onClick={() => setOpenId(s.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpenId(s.id)}
                  tabIndex={0}
                >
                  <td data-label="Venta">
                    <strong>#{String(s.number).padStart(5, '0')}</strong>
                  </td>
                  <td data-label="Fecha" className="nowrap">
                    {fmtDateTime(s.date)}
                  </td>
                  <td data-label="Cliente">{s.customerName || <span className="muted">Sin cliente</span>}</td>
                  <td data-label="Pueblo">{s.town ?? <span className="muted">—</span>}</td>
                  <td data-label="Unidades" className="num">
                    {s.items.reduce((a, i) => a + i.qty, 0)}
                  </td>
                  <td data-label="Pago">
                    {s.voided ? (
                      <span className="badge badge-danger">Anulada</span>
                    ) : (
                      <span className={`badge ${s.paymentType === 'credito' ? 'badge-warn' : 'badge-ok'}`}>
                        {s.paymentType === 'credito' ? 'Crédito' : 'Contado'}
                      </span>
                    )}
                  </td>
                  <td data-label="Total" className="num">
                    <strong className={s.voided ? 'strike' : ''}>{fmtMoney(s.total)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId && <SaleView saleId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
