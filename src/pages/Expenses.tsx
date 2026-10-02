import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { categoryLabel, db, EXPENSE_CATEGORIES, methodLabel, type Expense, type ExpenseCategory } from '../lib/db';
import { destinationKey, destinationNames, endOfDay, fmtDate, fmtMoney, startOfDay, toDateInput } from '../lib/format';
import { exportXlsx } from '../lib/excel';
import { Empty, Field, PageHeader } from '../components/ui';
import { ChartCard, ChartEmpty, fmtPct, ShareBars } from '../components/charts';
import ExpenseForm from '../components/ExpenseForm';

const DAY = 86_400_000;

export default function Expenses() {
  const [from, setFrom] = useState(toDateInput(Date.now() - 89 * DAY));
  const [to, setTo] = useState(toDateInput(Date.now()));
  const [cat, setCat] = useState<'' | ExpenseCategory>('');
  // '' = todos, 'general' = sin viaje, número = un viaje, 'dest:<clave>' = todos los viajes a un destino
  const [trip, setTrip] = useState<string>('');
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);

  const data = useLiveQuery(async () => {
    const [expenses, trips] = await Promise.all([
      db.expenses.where('date').between(startOfDay(from), endOfDay(to), true, true).reverse().sortBy('date'),
      db.trips.orderBy('startDate').reverse().toArray(),
    ]);
    const names = destinationNames(trips.map((t) => t.destination));
    const destCount = new Map<string, number>();
    for (const t of trips) destCount.set(destinationKey(t.destination), (destCount.get(destinationKey(t.destination)) ?? 0) + 1);
    return {
      expenses,
      trips,
      tripName: new Map(trips.map((t) => [t.id, names.get(destinationKey(t.destination)) ?? t.destination])),
      tripKey: new Map(trips.map((t) => [t.id, destinationKey(t.destination)])),
      destinations: [...names.entries()].map(([key, name]) => ({ key, name, trips: destCount.get(key) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [from, to]);

  const list = useMemo(
    () =>
      (data?.expenses ?? []).filter(
        (e) =>
          (!cat || e.category === cat) &&
          (trip === '' ||
            (trip === 'general'
              ? e.tripId === null
              : trip.startsWith('dest:')
                ? e.tripId !== null && data?.tripKey.get(e.tripId) === trip.slice(5)
                : e.tripId === Number(trip))),
      ),
    [data, cat, trip],
  );

  const total = list.reduce((a, e) => a + e.amount, 0);
  const inTrips = list.filter((e) => e.tripId !== null).reduce((a, e) => a + e.amount, 0);
  const byCat = EXPENSE_CATEGORIES.map((c) => ({ name: c.label, value: list.filter((e) => e.category === c.value).reduce((a, e) => a + e.amount, 0) }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((c) => ({ ...c, pct: total ? (c.value / total) * 100 : 0 }));
  const cash = list.filter((e) => e.method === 'efectivo').reduce((a, e) => a + e.amount, 0);

  const exportList = () =>
    exportXlsx(`gastos-${from}-a-${to}.xlsx`, [
      {
        name: 'Gastos',
        rows: list.map((e) => ({
          Fecha: fmtDate(e.date),
          Categoria: categoryLabel(e.category),
          Valor: e.amount,
          Medio: methodLabel(e.method),
          Viaje: e.tripId ? (data?.tripName.get(e.tripId) ?? '') : 'General',
          Nota: e.note,
        })),
      },
    ]);

  return (
    <div className="page">
      <PageHeader
        actions={
          <>
            <button className="btn btn-ghost" onClick={exportList} disabled={!list.length}>
              Exportar Excel
            </button>
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              + Registrar gasto
            </button>
          </>
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
        <div className="filter-row">
          <select value={cat} onChange={(e) => setCat(e.target.value as typeof cat)} aria-label="Categoría">
            <option value="">Todas las categorías</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select value={trip} onChange={(e) => setTrip(e.target.value)} aria-label="Viaje o destino">
            <option value="">Todos (viajes y generales)</option>
            <option value="general">Solo gastos generales</option>
            {!!data?.destinations.length && (
              <optgroup label="Por destino">
                {data.destinations.map((d) => (
                  <option key={d.key} value={`dest:${d.key}`}>
                    {d.name} ({d.trips} {d.trips === 1 ? 'viaje' : 'viajes'})
                  </option>
                ))}
              </optgroup>
            )}
            {!!data?.trips.length && (
              <optgroup label="Por viaje">
                {data.trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {data.tripName.get(t.id)} · {fmtDate(t.startDate)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Total gastos</span>
          <div className="kpi-value">{fmtMoney(total)}</div>
          <div className="kpi-foot">{list.length} registros</div>
        </div>
        <div className="kpi">
          <span className="kpi-label">En viajes</span>
          <div className="kpi-value">{fmtMoney(inTrips)}</div>
          <div className="kpi-foot">{total > 0 && <span className="badge no-dot badge-info">{fmtPct((inTrips / total) * 100)}</span>}</div>
        </div>
        <div className="kpi">
          <span className="kpi-label">Generales</span>
          <div className="kpi-value">{fmtMoney(total - inTrips)}</div>
          <div className="kpi-foot">Envíos, empaques, otros</div>
        </div>
        <div className="kpi">
          <span className="kpi-label">Pagado en efectivo</span>
          <div className="kpi-value">{fmtMoney(cash)}</div>
          <div className="kpi-foot">{total > 0 && <span>{fmtPct((cash / total) * 100)} del total</span>}</div>
        </div>
      </div>

      <ChartCard title="Gastos por categoría" subtitle="% del total en el periodo">
        {byCat.length ? <ShareBars data={byCat} /> : <ChartEmpty icon="wallet" text="No hay gastos en este periodo." />}
      </ChartCard>

      {data && list.length === 0 ? (
        <Empty>No hay gastos con estos filtros.</Empty>
      ) : (
        <div className="card flush table-wrap">
          <table className="table stack-table">
            <thead>
              <tr>
                <th>Gasto</th>
                <th>Fecha</th>
                <th>Viaje</th>
                <th>Medio</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="clickable-row" onClick={() => setEditing(e)} onKeyDown={(k) => k.key === 'Enter' && setEditing(e)} tabIndex={0}>
                  <td data-label="Gasto">
                    <strong>{categoryLabel(e.category)}</strong>
                    {e.note && <div className="muted small">{e.note}</div>}
                  </td>
                  <td data-label="Fecha">{fmtDate(e.date)}</td>
                  <td data-label="Viaje">
                    {e.tripId ? <span className="badge badge-info">{data?.tripName.get(e.tripId) ?? '—'}</span> : <span className="muted">General</span>}
                  </td>
                  <td data-label="Medio">{methodLabel(e.method)}</td>
                  <td data-label="Valor" className="num">
                    <strong>{fmtMoney(e.amount)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ExpenseForm expense={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
