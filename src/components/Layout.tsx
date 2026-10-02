import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useSettings } from '../lib/settings';
import { useLiveQuery } from 'dexie-react-hooks';
import { getActiveTrip } from '../lib/ops';
import { createBackup } from '../lib/backup';
import { useAction } from './ui';
import { Icon, type IconName } from './Icon';

export { Icon };

const NAV: { to: string; label: string; icon: IconName; end?: boolean; section?: string }[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true, section: 'General' },
  { to: '/vender', label: 'Vender', icon: 'sell' },
  { to: '/ventas', label: 'Ventas', icon: 'sales' },
  { to: '/viajes', label: 'Viajes', icon: 'plane' },
  { to: '/productos', label: 'Productos', icon: 'products', section: 'Bodega' },
  { to: '/inventario', label: 'Inventario', icon: 'inventory' },
  { to: '/clientes', label: 'Clientes', icon: 'customers', section: 'Negocio' },
  { to: '/reportes', label: 'Reportes', icon: 'reports' },
  { to: '/ajustes', label: 'Ajustes', icon: 'settings' },
];

/** Título y subtítulo de la barra superior según la ruta. */
const TITLES: { match: RegExp; title: string; sub: string }[] = [
  { match: /^\/$/, title: 'Dashboard', sub: 'Resumen de ventas, inventario y cartera' },
  { match: /^\/vender/, title: 'Nueva venta', sub: 'Busca el producto, elige la talla y registra la venta' },
  { match: /^\/ventas/, title: 'Ventas', sub: 'Historial de ventas y comprobantes' },
  { match: /^\/viajes\/\d+/, title: 'Detalle del viaje', sub: 'Mercancía, ventas y resultado del viaje' },
  { match: /^\/viajes/, title: 'Viajes', sub: 'Mercancía que llevas, ventas y utilidad por destino' },
  { match: /^\/productos/, title: 'Productos', sub: 'Catálogo, tallas, precios y stock mínimo' },
  { match: /^\/inventario/, title: 'Inventario y bodega', sub: 'Existencias, entradas, conteos y movimientos' },
  { match: /^\/clientes\/\d+/, title: 'Detalle del cliente', sub: 'Compras, deudas y abonos' },
  { match: /^\/clientes/, title: 'Clientes y cartera', sub: 'Clientes registrados y saldos pendientes' },
  { match: /^\/reportes/, title: 'Reportes', sub: 'Análisis por periodo, exportable a Excel' },
  { match: /^\/ajustes/, title: 'Ajustes', sub: 'Datos del negocio, respaldo y exportaciones' },
];

// En la barra inferior del celular solo caben 5; el resto va en "Más".
const MOBILE_MAIN = ['/', '/vender', '/viajes', '/clientes'];

const COLLAPSE_KEY = 'tienda.sidebarCollapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function BackupBanner() {
  const s = useSettings();
  const { run, busy } = useAction();
  const [hidden, setHidden] = useState(false);
  if (!s || hidden) return null;
  const days = s.lastBackupAt ? Math.floor((Date.now() - s.lastBackupAt) / 86_400_000) : null;
  if (days !== null && days < s.backupReminderDays) return null;
  return (
    <div className="banner">
      <span>
        {days === null ? 'Aún no has hecho ningún respaldo.' : `Tu último respaldo fue hace ${days} días.`} Guarda una copia
        de la información fuera de este dispositivo.
      </span>
      <div className="banner-actions">
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(createBackup, 'Respaldo generado')}>
          Hacer respaldo
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setHidden(true)}>
          Después
        </button>
      </div>
    </div>
  );
}

function DemoBanner() {
  const s = useSettings();
  if (!s?.demoLoadedAt) return null;
  return (
    <div className="banner info">
      <span>
        Estás viendo <strong>datos de demostración</strong>. Bórralos desde Ajustes antes de empezar a usar la app con datos
        reales.
      </span>
      <Link to="/ajustes" className="btn btn-sm btn-ghost">
        Ir a Ajustes
      </Link>
    </div>
  );
}

export default function Layout() {
  const s = useSettings();
  const [more, setMore] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const meta = TITLES.find((t) => t.match.test(pathname)) ?? TITLES[0];
  const trip = useLiveQuery(getActiveTrip, []);

  useEffect(() => {
    document.title = `${meta.title} · ${s?.storeName ?? 'Tienda'}`;
  }, [meta.title, s?.storeName]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* sin almacenamiento: solo dura esta sesión */
      }
      return !c;
    });
  };

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand" title={s?.storeName}>
          <div className="brand-logo">
            <Icon name="products" size={20} />
          </div>
          <div className="brand-text">
            <div className="brand-name">{s?.storeName ?? ''}</div>
            <div className="brand-sub">Sistema de gestión</div>
          </div>
        </div>
        <nav>
          {NAV.map((n) => (
            <div key={n.to}>
              {n.section && <div className="nav-section">{n.section}</div>}
              <NavLink to={n.to} end={n.end} className="nav-link" title={collapsed ? n.label : undefined}>
                <Icon name={n.icon} />
                <span>{n.label}</span>
              </NavLink>
            </div>
          ))}
        </nav>
        <button className="collapse-btn" onClick={toggle} aria-expanded={!collapsed}>
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} />
          <span>Ocultar menú</span>
        </button>
      </aside>

      <div className="main-wrap">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{meta.title}</h1>
            <p className="topbar-sub">{meta.sub}</p>
          </div>
          {trip && (
            <Link to={`/viajes/${trip.id}`} className="trip-chip" title="Viaje abierto: las ventas salen de la mercancía del viaje">
              <Icon name="plane" size={16} />
              <span>{trip.destination}</span>
            </Link>
          )}
          {pathname !== '/vender' && (
            <Link to="/vender" className="btn btn-primary" aria-label="Nueva venta">
              <Icon name="plus" size={18} />
              <span className="btn-label">Nueva venta</span>
            </Link>
          )}
        </header>
        <main className="main">
          <DemoBanner />
          <BackupBanner />
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav">
        {NAV.filter((n) => MOBILE_MAIN.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="bnav-link" onClick={() => setMore(false)}>
            <Icon name={n.icon} size={22} />
            <span>{n.to === '/' ? 'Inicio' : n.label}</span>
          </NavLink>
        ))}
        <button className={`bnav-link ${more ? 'active' : ''}`} onClick={() => setMore((m) => !m)}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="currentColor">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
          <span>Más</span>
        </button>
      </nav>
      {more && (
        <div className="more-sheet" onClick={() => setMore(false)}>
          <div className="more-panel" onClick={(e) => e.stopPropagation()}>
            {NAV.filter((n) => !MOBILE_MAIN.includes(n.to)).map((n) => (
              <button
                key={n.to}
                className="more-item"
                onClick={() => {
                  setMore(false);
                  navigate(n.to);
                }}
              >
                <Icon name={n.icon} />
                <span>{n.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
