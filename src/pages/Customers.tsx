import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { allBalances } from '../lib/ops';
import { fmtMoney, normalize } from '../lib/format';
import { exportCustomers } from '../lib/exports';
import { Empty, PageHeader, SearchBox, Tabs } from '../components/ui';
import CustomerForm from '../components/CustomerForm';

export default function Customers() {
  const [params, setParams] = useSearchParams();
  const filter = params.get('filtro') === 'deben' ? 'deben' : 'todos';
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const data = useLiveQuery(async () => {
    const [customers, balances] = await Promise.all([db.customers.orderBy('name').toArray(), allBalances()]);
    return { customers, balances };
  }, []);

  const list = useMemo(() => {
    if (!data) return [];
    const n = normalize(q);
    return data.customers
      .map((c) => ({ ...c, balance: data.balances.get(c.id) ?? 0 }))
      .filter((c) => (filter === 'todos' || c.balance > 0) && (!n || normalize(`${c.name} ${c.phone} ${c.document}`).includes(n)))
      .sort((a, b) => (filter === 'deben' ? b.balance - a.balance : 0));
  }, [data, q, filter]);

  const cartera = list.reduce((a, c) => a + Math.max(0, c.balance), 0);

  return (
    <div className="page">
      <PageHeader
        title="Clientes y cartera"
        actions={
          <>
            <button className="btn btn-ghost" onClick={exportCustomers}>
              Exportar
            </button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              + Nuevo
            </button>
          </>
        }
      />
      <Tabs
        value={filter}
        onChange={(f) => setParams(f === 'deben' ? { filtro: 'deben' } : {}, { replace: true })}
        options={[
          { value: 'todos', label: 'Todos' },
          { value: 'deben', label: 'Con saldo pendiente' },
        ]}
      />
      <div className="card filters">
        <SearchBox value={q} onChange={setQ} placeholder="Buscar por nombre, celular o documento" />
      </div>
      {filter === 'deben' && (
        <div className="summary-bar">
          <span>{list.length} clientes deben</span>
          <strong>{fmtMoney(cartera)}</strong>
        </div>
      )}
      {data && list.length === 0 ? (
        <Empty>{filter === 'deben' ? 'Ningún cliente tiene saldo pendiente.' : 'No hay clientes registrados.'}</Empty>
      ) : (
        <div className="card flush">
          <ul className="list">
            {list.map((c) => (
              <li key={c.id}>
                <Link to={`/clientes/${c.id}`} className="list-row pick-row">
                  <div>
                    <strong>{c.name}</strong>
                    <div className="muted small">{[c.phone, c.document].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</div>
                  </div>
                  <div className="right">
                    {c.balance > 0 ? (
                      <span className="badge badge-warn">Debe {fmtMoney(c.balance)}</span>
                    ) : c.balance < 0 ? (
                      <span className="badge badge-ok">A favor {fmtMoney(-c.balance)}</span>
                    ) : (
                      <span className="muted small">Al día</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {creating && <CustomerForm onClose={() => setCreating(false)} />}
    </div>
  );
}
