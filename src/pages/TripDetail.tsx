import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { closeTrip, deleteTrip, loadCatalog, loadTripStock, returnTripStock, type ProductWithVariants } from '../lib/ops';
import { tripSummary, type TripLine } from '../lib/trips';
import { createBackup } from '../lib/backup';
import { fmtDateTime, fmtMoney, fmtNum, normalize } from '../lib/format';
import { Empty, Modal, NumberInput, SearchBox, Tabs, useAction, useConfirm, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtPct, MethodsBar, SegmentBar, useChartColors } from '../components/charts';
import SaleView from '../components/SaleView';
import { TripForm, tripDates } from './Trips';

type Tab = 'resumen' | 'mercancia' | 'ventas';

export default function TripDetail() {
  const id = Number(useParams().id);
  const s = useLiveQuery(() => tripSummary(id), [id]);
  const sales = useLiveQuery(() => db.sales.where('tripId').equals(id).reverse().sortBy('date'), [id]);
  const [tab, setTab] = useState<Tab>('resumen');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saleId, setSaleId] = useState<number | null>(null);
  const [giveBack, setGiveBack] = useState<TripLine | null>(null);
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const c = useChartColors();

  if (s === undefined) return null;
  if (s === null)
    return (
      <div className="page">
        <Empty>
          Viaje no encontrado. <Link to="/viajes">Volver</Link>
        </Empty>
      </div>
    );

  const { trip, units } = s;
  const isOpen = trip.status === 'abierto';
  const pct = (n: number) => (units.loaded ? fmtPct((n / units.loaded) * 100) : '0%');
  const margin = s.total ? (s.profit / s.total) * 100 : null;

  const close = async () => {
    const ok = await confirm(
      `¿Cerrar el viaje a ${trip.destination}?\n\n` +
        `• Vendiste ${units.sold} de ${units.loaded} unidades (${pct(units.sold)}).\n` +
        `• ${units.onHand} unidades sin vender vuelven a bodega.\n\n` +
        'Después de cerrarlo, las ventas nuevas se descuentan otra vez de bodega.',
      { confirmLabel: 'Cerrar viaje' },
    );
    if (!ok) return;
    const done = await run(async () => {
      await closeTrip(trip.id);
      return true;
    }, 'Viaje cerrado: la mercancía volvió a bodega');
    if (!done) return;
    if (
      await confirm(
        'Te recomendamos hacer un respaldo ahora: guarda el archivo en Drive, correo o WhatsApp para no perder la información del viaje.',
        { confirmLabel: 'Hacer respaldo' },
      )
    )
      await run(createBackup, 'Respaldo generado');
  };

  const remove = async () => {
    if (!(await confirm(`¿Eliminar el viaje a ${trip.destination}? La mercancía cargada vuelve a bodega.`, { confirmLabel: 'Eliminar', danger: true })))
      return;
    const ok = await run(async () => {
      await deleteTrip(trip.id);
      return true;
    }, 'Viaje eliminado');
    if (ok) navigate('/viajes');
  };

  const methods = s.methods;

  return (
    <div className="page">
      <Link to="/viajes" className="link small">
        ← Viajes
      </Link>
      <div className="card trip-head">
        <span className="trip-hero-icon">
          <Icon name="plane" size={24} />
        </span>
        <div className="grow">
          <div className="row gap wrap">
            <h2 className="trip-hero-title" style={{ margin: 0 }}>
              {trip.destination}
            </h2>
            {isOpen ? <span className="badge badge-info">En curso</span> : <span className="badge badge-neutral">Cerrado</span>}
          </div>
          <div className="muted small">
            {tripDates(trip)}
            {trip.notes && ` · ${trip.notes}`}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            Editar
          </button>
          {isOpen && s.saleCount === 0 && (
            <button className="btn btn-danger-ghost btn-sm" onClick={remove} disabled={busy}>
              Eliminar
            </button>
          )}
          {isOpen && (
            <>
              <button className="btn btn-ghost" onClick={() => setLoading(true)}>
                <Icon name="luggage" size={18} /> Cargar mercancía
              </button>
              <button className="btn btn-primary" onClick={close} disabled={busy}>
                Cerrar viaje
              </button>
            </>
          )}
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'resumen', label: 'Resumen' },
          { value: 'mercancia', label: `Mercancía (${units.loaded})` },
          { value: 'ventas', label: `Ventas (${s.saleCount})` },
        ]}
      />

      {tab === 'resumen' && (
        <>
          {units.loaded === 0 && isOpen && (
            <div className="banner info">
              <span>Aún no has cargado mercancía. Carga lo que llevas para que las ventas se descuenten del viaje.</span>
              <button className="btn btn-sm btn-primary" onClick={() => setLoading(true)}>
                Cargar mercancía
              </button>
            </div>
          )}
          <div className="kpis">
            <div className="kpi">
              <span className="kpi-label">Unidades llevadas</span>
              <div className="kpi-value">{fmtNum(units.loaded)}</div>
              <div className="kpi-foot">{s.lines.length} tallas</div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Vendidas</span>
              <div className="kpi-value">{fmtNum(units.sold)}</div>
              <div className="kpi-foot">
                <span className="badge no-dot badge-ok">{pct(units.sold)}</span> de lo llevado
              </div>
            </div>
            <div className="kpi">
              <span className="kpi-label">{isOpen ? 'Por vender (en viaje)' : 'Devueltas a bodega'}</span>
              <div className="kpi-value">{fmtNum(isOpen ? units.onHand : units.returned)}</div>
              <div className="kpi-foot">
                <span className="badge no-dot badge-warn">{pct(isOpen ? units.onHand : units.returned)}</span>
                {isOpen && units.returned > 0 && <span>{units.returned} ya devueltas</span>}
              </div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Total vendido</span>
              <div className="kpi-value">{fmtMoney(s.total)}</div>
              <div className="kpi-foot">{s.saleCount} ventas</div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Costo de lo vendido</span>
              <div className="kpi-value">{fmtMoney(s.cost)}</div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Gastos del viaje</span>
              <div className="kpi-value">{fmtMoney(s.expenses)}</div>
              <div className="kpi-foot">Pasajes, hospedaje, comida…</div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Utilidad real</span>
              <div className={`kpi-value ${s.profit < 0 ? 'text-danger' : ''}`}>{fmtMoney(s.profit)}</div>
              <div className="kpi-foot">
                {margin !== null && <span className={`badge no-dot ${s.profit >= 0 ? 'badge-ok' : 'badge-danger'}`}>{fmtPct(margin, 1)}</span>}
                <span>ventas − costo − gastos</span>
              </div>
            </div>
            <div className="kpi">
              <span className="kpi-label">Cartera que quedó</span>
              <div className="kpi-value">{fmtMoney(s.carteraOpen)}</div>
              <div className="kpi-foot">
                {s.carteraCustomers} {s.carteraCustomers === 1 ? 'cliente' : 'clientes'} en {trip.destination}
              </div>
            </div>
          </div>

          <div className="dash-grid">
            <section className="card chart-card">
              <header className="chart-head">
                <div>
                  <h2>Dinero recibido por medio de pago</h2>
                  <p className="chart-sub">Ventas y abonos cobrados durante el viaje</p>
                </div>
              </header>
              <MethodsBar methods={methods} />
              {s.credit > 0 && (
                <p className="muted small" style={{ margin: 0 }}>
                  Además se vendieron {fmtMoney(s.credit)} a crédito sin abono en el momento.
                </p>
              )}
            </section>
            <section className="card chart-card">
              <header className="chart-head">
                <div>
                  <h2>Mercancía del viaje</h2>
                  <p className="chart-sub">De {units.loaded} unidades llevadas</p>
                </div>
              </header>
              <SegmentBar
                fmt="units"
                parts={[
                  { label: 'Vendidas', value: units.sold, color: c.good },
                  { label: isOpen ? 'Por vender' : 'Sin vender', value: units.onHand, color: c.warning },
                  { label: 'Devueltas a bodega', value: units.returned, color: c.series[6] },
                ]}
              />
            </section>
          </div>
        </>
      )}

      {tab === 'mercancia' &&
        (s.lines.length === 0 ? (
          <Empty>
            No se ha cargado mercancía.{' '}
            {isOpen && (
              <button className="btn btn-sm btn-primary" onClick={() => setLoading(true)}>
                Cargar mercancía
              </button>
            )}
          </Empty>
        ) : (
          <div className="card flush table-wrap">
            <table className="table stack-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Talla</th>
                  <th className="num">Llevadas</th>
                  <th className="num">Vendidas</th>
                  <th className="num">{isOpen ? 'En viaje' : 'Devueltas'}</th>
                  {isOpen && <th />}
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.variantId}>
                    <td data-label="Producto">
                      <strong>{l.name}</strong>
                      <div className="muted small">Ref {l.reference}</div>
                    </td>
                    <td data-label="Talla">{l.size}</td>
                    <td data-label="Llevadas" className="num">
                      {l.loaded}
                    </td>
                    <td data-label="Vendidas" className="num">
                      {l.sold > 0 ? <span className="badge no-dot badge-ok">{l.sold}</span> : <span className="muted">0</span>}
                    </td>
                    <td data-label={isOpen ? 'En viaje' : 'Devueltas'} className="num">
                      {isOpen ? l.onHand : l.returned}
                      {isOpen && l.returned > 0 && <div className="muted small">{l.returned} devueltas</div>}
                    </td>
                    {isOpen && (
                      <td data-label="">
                        {l.onHand > 0 && (
                          <button className="btn btn-sm btn-ghost" onClick={() => setGiveBack(l)}>
                            Devolver a bodega
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'ventas' &&
        (!sales?.length ? (
          <Empty>Aún no hay ventas en este viaje.</Empty>
        ) : (
          <div className="card flush">
            <ul className="list">
              {sales.map((x) => (
                <li key={x.id}>
                  <button className={`list-row pick-row ${x.voided ? 'voided' : ''}`} onClick={() => setSaleId(x.id)}>
                    <div>
                      <strong>#{x.number}</strong> {x.customerName && <span>· {x.customerName}</span>}
                      <div className="muted small">
                        {fmtDateTime(x.date)} · {x.items.reduce((a, i) => a + i.qty, 0)} und
                      </div>
                    </div>
                    <div className="right">
                      <strong className={x.voided ? 'strike' : ''}>{fmtMoney(x.total)}</strong>
                      <span className={`badge ${x.voided ? 'badge-danger' : x.paymentType === 'credito' ? 'badge-warn' : 'badge-ok'}`}>
                        {x.voided ? 'Anulada' : x.paymentType === 'credito' ? 'Crédito' : 'Contado'}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

      {loading && <LoadModal tripId={trip.id} destination={trip.destination} onClose={() => setLoading(false)} />}
      {editing && <TripForm trip={trip} onClose={() => setEditing(false)} />}
      {saleId && <SaleView saleId={saleId} onClose={() => setSaleId(null)} />}
      {giveBack && (
        <GiveBackModal
          line={giveBack}
          onClose={() => setGiveBack(null)}
          onSave={async (qty) => {
            const ok = await run(async () => {
              await returnTripStock(trip.id, giveBack.variantId, qty);
              return true;
            });
            if (ok) {
              toast(`${qty} und devueltas a bodega`);
              setGiveBack(null);
            }
          }}
        />
      )}
    </div>
  );
}

function GiveBackModal({ line, onClose, onSave }: { line: TripLine; onClose: () => void; onSave: (qty: number) => void }) {
  const [qty, setQty] = useState<number | null>(line.onHand);
  return (
    <Modal
      title="Devolver a bodega"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={!qty || qty > line.onHand} onClick={() => qty && onSave(qty)}>
            Devolver
          </button>
        </>
      }
    >
      <p>
        <strong>{line.name}</strong> · Talla {line.size} · llevas {line.onHand}
      </p>
      <NumberInput min={1} value={qty} onChange={setQty} autoFocus />
    </Modal>
  );
}

/** Elegir productos y tallas que se llevan al viaje (salen de bodega). */
function LoadModal({ tripId, destination, onClose }: { tripId: number; destination: string; onClose: () => void }) {
  const catalog = useLiveQuery(() => loadCatalog(), []);
  const [q, setQ] = useState('');
  const [qty, setQty] = useState<Record<number, number>>({});
  const { run, busy } = useAction();

  const list = useMemo(() => {
    const n = normalize(q);
    return (catalog ?? []).filter((p) => p.totalStock > 0 && (!n || normalize(`${p.name} ${p.reference} ${p.category}`).includes(n)));
  }, [catalog, q]);

  const total = Object.values(qty).reduce((a, b) => a + (b || 0), 0);
  const value = (catalog ?? []).reduce((a, p) => a + p.variants.reduce((b, v) => b + (qty[v.id] || 0) * p.price, 0), 0);
  const setAll = (p: ProductWithVariants, all: boolean) =>
    setQty((m) => {
      const next = { ...m };
      for (const v of p.variants) next[v.id] = all ? v.stock : 0;
      return next;
    });

  const save = async () => {
    const ok = await run(async () => {
      await loadTripStock(
        tripId,
        Object.entries(qty).map(([variantId, n]) => ({ variantId: Number(variantId), qty: n || 0 })),
      );
      return true;
    }, `${total} unidades cargadas al viaje`);
    if (ok) onClose();
  };

  return (
    <Modal
      title={`Cargar mercancía · ${destination}`}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">
            {total} und · {fmtMoney(value)} a precio de venta
          </span>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || total === 0}>
            Cargar {total} und
          </button>
        </>
      }
    >
      <p className="muted small">Las unidades salen de bodega y quedan "en viaje". Al cerrar el viaje, lo que no vendas vuelve a bodega.</p>
      <SearchBox value={q} onChange={setQ} placeholder="Buscar producto" />
      {catalog && list.length === 0 && <Empty>No hay productos con existencias en bodega.</Empty>}
      <ul className="list load-list">
        {list.map((p) => {
          const chosen = p.variants.reduce((a, v) => a + (qty[v.id] || 0), 0);
          return (
            <li key={p.id} className="load-item">
              <div className="row-between wrap gap">
                <div>
                  <strong>{p.name}</strong>
                  <div className="muted small">
                    Ref {p.reference} · bodega {p.totalStock}
                    {p.totalInTrip > 0 && ` · ya en viaje ${p.totalInTrip}`}
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAll(p, chosen === 0)}>
                  {chosen === 0 ? 'Llevar todo' : 'Quitar'}
                </button>
              </div>
              <div className="load-sizes">
                {p.variants
                  .filter((v) => v.stock > 0)
                  .map((v) => (
                    <label key={v.id} className="load-size">
                      <span>
                        <b>{v.size}</b> <span className="muted">/ {v.stock}</span>
                      </span>
                      <NumberInput
                        className="input-sm num"
                        value={qty[v.id] || null}
                        placeholder="0"
                        onChange={(n) => setQty((m) => ({ ...m, [v.id]: Math.min(n ?? 0, v.stock) }))}
                      />
                    </label>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
