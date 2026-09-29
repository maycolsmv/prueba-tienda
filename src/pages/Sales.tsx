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
          s.items.some((i) => normalize(`${i.name} ${i.reference}`).includes(n))),
    );
  }, [sales, q, pay]);

  const valid = list.filter((s) => !s.voided);
  const total = valid.reduce((a, s) => a + s.total, 0);

  return (
    <div className="page">
      <PageHeader
        title="Historial de ventas"
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
        <SearchBox value={q} onChange={setQ} placeholder="Buscar por número, cliente o producto" />
      </div>

      <div className="summary-bar">
        <span>{valid.length} ventas</span>
        <strong>{fmtMoney(total)}</strong>
      </div>

      {sales && list.length === 0 ? (
        <Empty>No hay ventas en este periodo.</Empty>
      ) : (
        <div className="card flush">
          <ul className="list">
            {list.map((s) => (
              <li key={s.id}>
                <button className={`list-row pick-row ${s.voided ? 'voided' : ''}`} onClick={() => setOpenId(s.id)}>
                  <div>
                    <strong>#{s.number}</strong> {s.customerName && <span>· {s.customerName}</span>}
                    <div className="muted small">
                      {fmtDateTime(s.date)} · {s.items.reduce((a, i) => a + i.qty, 0)} und
                    </div>
                  </div>
                  <div className="right">
                    <div className={s.voided ? 'strike' : ''}>{fmtMoney(s.total)}</div>
                    {s.voided ? (
                      <span className="badge badge-danger">Anulada</span>
                    ) : (
                      <span className={`badge ${s.paymentType === 'credito' ? 'badge-warn' : 'badge-ok'}`}>
                        {s.paymentType === 'credito' ? 'Crédito' : 'Contado'}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {openId && <SaleView saleId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
