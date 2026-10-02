import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { allBalances } from '../lib/ops';
import { fmtMoney, normalize } from '../lib/format';
import { exportCustomers } from '../lib/exports';
import { Empty, PageHeader, SearchBox, Tabs } from '../components/ui';
import CustomerForm from '../components/CustomerForm';
import { Icon } from '../components/Icon';

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
      .filter((c) => (filter === 'todos' || c.balance > 0) && (!n || normalize(`${c.name} ${c.phone} ${c.document} ${c.town ?? ''}`).includes(n)))
      .sort((a, b) => (filter === 'deben' ? b.balance - a.balance : 0));
  }, [data, q, filter]);

  const summary = useMemo(() => {
    const bal = [...(data?.balances.values() ?? [])].filter((b) => b > 0);
    return { total: data?.customers.length ?? 0, debtors: bal.length, cartera: bal.reduce((a, b) => a + b, 0) };
  }, [data]);

  return (
    <div className="page">
      <PageHeader
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
      {data && (
        <div className="kpis kpis-3">
          <div className="kpi">
            <div className="kpi-top">
              <span className="kpi-label">Total clientes</span>
              <span className="kpi-icon">
                <Icon name="customers" size={18} />
              </span>
            </div>
            <div className="kpi-value">{summary.total}</div>
          </div>
          <div className="kpi">
            <div className="kpi-top">
              <span className="kpi-label">Con deuda</span>
              <span className="kpi-icon warn">
                <Icon name="alert" size={18} />
              </span>
            </div>
            <div className="kpi-value">{summary.debtors}</div>
            <div className="kpi-foot">
              <span className="badge no-dot badge-warn">{summary.total ? Math.round((summary.debtors / summary.total) * 100) : 0}%</span>
              <span>de los clientes</span>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-top">
              <span className="kpi-label">Cartera total</span>
              <span className="kpi-icon danger">
                <Icon name="wallet" size={18} />
              </span>
            </div>
            <div className="kpi-value">{fmtMoney(summary.cartera)}</div>
          </div>
        </div>
      )}
      <Tabs
        value={filter}
        onChange={(f) => setParams(f === 'deben' ? { filtro: 'deben' } : {}, { replace: true })}
        options={[
          { value: 'todos', label: 'Todos' },
          { value: 'deben', label: 'Con saldo pendiente' },
        ]}
      />
      <div className="card filters">
        <SearchBox value={q} onChange={setQ} placeholder="Buscar por nombre, pueblo, celular o documento" />
      </div>
      {data && list.length === 0 ? (
        <Empty>{filter === 'deben' ? 'Ningún cliente tiene saldo pendiente.' : 'No hay clientes registrados.'}</Empty>
      ) : (
        <div className="card flush">
          <ul className="list">
            {list.map((c) => (
              <li key={c.id}>
                <Link to={`/clientes/${c.id}`} className="list-row pick-row">
                  <div className="row-main">
                    <span className="avatar">{c.name.slice(0, 1).toUpperCase()}</span>
                    <div>
                      <strong>{c.name}</strong>
                      <div className="muted small">{[c.town, c.phone, c.document].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</div>
                    </div>
                  </div>
                  <div className="right">
                    {c.balance > 0 ? (
                      <span className="badge badge-warn">Debe {fmtMoney(c.balance)}</span>
                    ) : c.balance < 0 ? (
                      <span className="badge badge-info">A favor {fmtMoney(-c.balance)}</span>
                    ) : (
                      <span className="badge badge-ok">Al día</span>
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
