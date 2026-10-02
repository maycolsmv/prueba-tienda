import type { ProductWithVariants } from '../lib/ops';
import { STATUS_LABEL, stockStatus, type StockStatus } from '../lib/stats';

const BADGE: Record<StockStatus, string> = {
  disponible: 'badge-ok',
  poco: 'badge-warn',
  agotado: 'badge-danger',
};

export function StatusBadge({ status }: { status: StockStatus }) {
  return <span className={`badge ${BADGE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function ProductStatus({ p }: { p: ProductWithVariants }) {
  return <StatusBadge status={stockStatus(p)} />;
}

/**
 * Stock actual frente al mínimo: la marca vertical es el mínimo.
 * La escala llega hasta 2× el mínimo (o el stock, si es mayor) para que la marca quede visible.
 */
export function StockBar({ p }: { p: ProductWithVariants }) {
  const status = stockStatus(p);
  const owned = p.totalStock + p.totalInTrip;
  const scale = Math.max(owned, p.minStock * 2, 1);
  const color = status === 'agotado' ? 'var(--status-critical)' : status === 'poco' ? 'var(--status-warning)' : 'var(--status-good)';
  return (
    <div
      className="stockbar"
      title={`Stock ${owned}${p.totalInTrip ? ` (${p.totalInTrip} en viaje)` : ''}${p.minStock ? ` · mínimo ${p.minStock}` : ''}`}
    >
      <div className="stockbar-track">
        <span className="stockbar-fill" style={{ width: `${(owned / scale) * 100}%`, background: color }} />
        {p.minStock > 0 && <span className="stockbar-min" style={{ left: `calc(${(p.minStock / scale) * 100}% - 1px)` }} />}
      </div>
      <span className="stockbar-text">
        {owned}
        {p.minStock > 0 && <span className="muted"> / {p.minStock}</span>}
      </span>
    </div>
  );
}
