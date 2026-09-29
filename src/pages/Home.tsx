import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { allBalances, isLowStock, loadCatalog } from '../lib/ops';
import { fmtDate, fmtMoney } from '../lib/format';
import { useSettings } from '../lib/settings';
import { Icon } from '../components/Layout';

export default function Home() {
  const s = useSettings();
  const data = useLiveQuery(async () => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthSales = (await db.sales.where('date').aboveOrEqual(monthStart).toArray()).filter((x) => !x.voided);
    const today = monthSales.filter((x) => x.date >= dayStart);
    const catalog = await loadCatalog();
    const balances = await allBalances();
    let cartera = 0;
    let debtors = 0;
    for (const b of balances.values())
      if (b > 0) {
        cartera += b;
        debtors++;
      }
    return {
      todayTotal: today.reduce((a, x) => a + x.total, 0),
      todayCount: today.length,
      monthTotal: monthSales.reduce((a, x) => a + x.total, 0),
      monthCount: monthSales.length,
      low: catalog.filter(isLowStock),
      units: catalog.reduce((a, p) => a + p.totalStock, 0),
      products: catalog.length,
      cartera,
      debtors,
    };
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <h1>{s?.storeName ?? 'Inicio'}</h1>
      </div>

      <Link to="/vender" className="cta">
        <Icon name="sell" size={26} />
        <span>Nueva venta</span>
      </Link>

      {data && (
        <>
          <div className="stats">
            <Link to="/ventas" className="stat">
              <span className="stat-label">Ventas de hoy</span>
              <span className="stat-value">{fmtMoney(data.todayTotal)}</span>
              <span className="stat-sub">{data.todayCount} ventas</span>
            </Link>
            <Link to="/reportes" className="stat">
              <span className="stat-label">Ventas del mes</span>
              <span className="stat-value">{fmtMoney(data.monthTotal)}</span>
              <span className="stat-sub">{data.monthCount} ventas</span>
            </Link>
            <Link to="/clientes?filtro=deben" className="stat">
              <span className="stat-label">Cartera por cobrar</span>
              <span className="stat-value">{fmtMoney(data.cartera)}</span>
              <span className="stat-sub">{data.debtors} clientes</span>
            </Link>
            <Link to="/inventario" className="stat">
              <span className="stat-label">Unidades en inventario</span>
              <span className="stat-value">{data.units}</span>
              <span className="stat-sub">{data.products} productos</span>
            </Link>
          </div>

          <section className="card">
            <div className="card-head">
              <h2>Poco stock</h2>
              <Link to="/inventario?tab=stock&bajo=1" className="link">
                Ver todo
              </Link>
            </div>
            {data.low.length === 0 ? (
              <p className="muted">Ningún producto está por debajo del mínimo.</p>
            ) : (
              <ul className="list">
                {data.low.slice(0, 8).map((p) => (
                  <li key={p.id} className="list-row">
                    <div>
                      <strong>{p.name}</strong>
                      <div className="muted small">
                        Ref {p.reference} · {p.variants.map((v) => `${v.size}: ${v.stock}`).join(' · ')}
                      </div>
                    </div>
                    <span className="badge badge-warn">{p.totalStock} / mín {p.minStock}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {s && (
            <p className="muted small center">
              Último respaldo: {s.lastBackupAt ? fmtDate(s.lastBackupAt) : 'nunca'} ·{' '}
              <Link to="/ajustes" className="link">
                Respaldo y exportación
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
