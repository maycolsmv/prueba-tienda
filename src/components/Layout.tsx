import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useSettings } from '../lib/settings';
import { createBackup } from '../lib/backup';
import { useAction } from './ui';

const icons: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
  sell: 'M4 5h2l2.4 10.2a1 1 0 001 .8h8.2a1 1 0 001-.8L20 8H7 M10 20a1 1 0 100-2 1 1 0 000 2z M17 20a1 1 0 100-2 1 1 0 000 2z',
  sales: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',
  products: 'M8 4l-5 3 2 5 2-1v9h10v-9l2 1 2-5-5-3c-.5 2-2 3-4 3s-3.5-1-4-3z',
  inventory: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  customers: 'M9 11a4 4 0 100-8 4 4 0 000 8z M2 21v-1a6 6 0 0112 0v1 M16 3.5a4 4 0 010 7 M18 14a6 6 0 014 6v1',
  reports: 'M4 20V10 M10 20V4 M16 20v-8 M22 20H2',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003 15H3a2 2 0 110-4h.1a1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 009 4.6V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1A1.7 1.7 0 0021 9h.1a2 2 0 110 4H21a1.7 1.7 0 00-1.6 2z',
};

export function Icon({ name, size = 22 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={icons[name]} />
    </svg>
  );
}

const NAV = [
  { to: '/', label: 'Inicio', icon: 'home', end: true },
  { to: '/vender', label: 'Vender', icon: 'sell' },
  { to: '/ventas', label: 'Ventas', icon: 'sales' },
  { to: '/productos', label: 'Productos', icon: 'products' },
  { to: '/inventario', label: 'Inventario', icon: 'inventory' },
  { to: '/clientes', label: 'Clientes', icon: 'customers' },
  { to: '/reportes', label: 'Reportes', icon: 'reports' },
  { to: '/ajustes', label: 'Ajustes', icon: 'settings' },
] as const;

// En la barra inferior del celular solo caben 5; el resto va en "Más".
const MOBILE_MAIN = ['/', '/vender', '/productos', '/clientes'];

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

export default function Layout() {
  const s = useSettings();
  const [more, setMore] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">{s?.storeName ?? ''}</div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={'end' in n} className="nav-link">
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <BackupBanner />
        <Outlet />
      </main>
      <nav className="bottom-nav">
        {NAV.filter((n) => MOBILE_MAIN.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={'end' in n} className="bnav-link" onClick={() => setMore(false)}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
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
