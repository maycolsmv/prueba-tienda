import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Trip } from '../lib/db';
import { saveTrip } from '../lib/ops';
import { tripList } from '../lib/trips';
import { fmtDate, fmtMoney, startOfDay, toDateInput } from '../lib/format';
import { Empty, Field, Modal, PageHeader, useAction } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtPct } from '../components/charts';

export function tripDates(t: Pick<Trip, 'startDate' | 'endDate'>) {
  return t.endDate ? `${fmtDate(t.startDate)} → ${fmtDate(t.endDate)}` : `Desde ${fmtDate(t.startDate)}`;
}

export default function Trips() {
  const trips = useLiveQuery(tripList, []);
  const [creating, setCreating] = useState(false);
  const open = trips?.find((t) => t.status === 'abierto');

  return (
    <div className="page">
      <PageHeader
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={!!open} title={open ? 'Cierra el viaje abierto para crear otro' : undefined}>
            + Nuevo viaje
          </button>
        }
      />

      {open && (
        <Link to={`/viajes/${open.id}`} className="card trip-hero">
          <span className="trip-hero-icon">
            <Icon name="plane" size={24} />
          </span>
          <div className="grow">
            <div className="row gap wrap">
              <strong className="trip-hero-title">{open.destination}</strong>
              <span className="badge badge-info">En curso</span>
            </div>
            <div className="muted small">{tripDates(open)}</div>
            <div className="trip-hero-stats">
              <span>
                <b>{open.loaded}</b> llevadas
              </span>
              <span>
                <b>{open.sold}</b> vendidas
              </span>
              <span>
                <b>{open.onHand}</b> por vender
              </span>
              <span>
                <b>{fmtMoney(open.total)}</b> vendido
              </span>
            </div>
          </div>
          <Icon name="chevronRight" />
        </Link>
      )}

      {trips && trips.length === 0 ? (
        <Empty>
          Aún no has registrado viajes. Crea uno, carga la mercancía que llevas y las ventas quedarán asociadas a ese destino.
        </Empty>
      ) : (
        <div className="card flush table-wrap">
          <table className="table stack-table">
            <thead>
              <tr>
                <th>Destino</th>
                <th>Fechas</th>
                <th className="num">Llevadas</th>
                <th className="num">Vendidas</th>
                <th className="num">Total vendido</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {trips?.map((t) => (
                <TripRow key={t.id} t={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <TripForm onClose={() => setCreating(false)} />}
    </div>
  );
}

function TripRow({ t }: { t: Awaited<ReturnType<typeof tripList>>[number] }) {
  const navigate = useNavigate();
  const go = () => navigate(`/viajes/${t.id}`);
  return (
    <tr className="clickable-row" onClick={go} onKeyDown={(e) => e.key === 'Enter' && go()} tabIndex={0}>
      <td data-label="Destino">
        <strong>{t.destination}</strong>
        <div className="muted small">{t.saleCount} ventas</div>
      </td>
      <td data-label="Fechas" className="nowrap">
        {tripDates(t)}
      </td>
      <td data-label="Llevadas" className="num">
        {t.loaded}
      </td>
      <td data-label="Vendidas" className="num">
        <span>
          {t.sold} {t.loaded > 0 && <span className="muted small">({fmtPct((t.sold / t.loaded) * 100)})</span>}
        </span>
      </td>
      <td data-label="Total" className="num">
        <strong>{fmtMoney(t.total)}</strong>
      </td>
      <td data-label="Estado">
        {t.status === 'abierto' ? <span className="badge badge-info">En curso</span> : <span className="badge badge-neutral">Cerrado</span>}
      </td>
    </tr>
  );
}

export function TripForm({ trip, onClose }: { trip?: Trip; onClose: () => void }) {
  const navigate = useNavigate();
  const [destination, setDestination] = useState(trip?.destination ?? '');
  const [start, setStart] = useState(toDateInput(trip?.startDate ?? Date.now()));
  const [end, setEnd] = useState(trip?.endDate ? toDateInput(trip.endDate) : '');
  const [notes, setNotes] = useState(trip?.notes ?? '');
  const { run, busy } = useAction();
  const destinations = useLiveQuery(async () => [...new Set((await db.trips.toArray()).map((t) => t.destination))].sort(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = await run(
      () => saveTrip({ id: trip?.id, destination, startDate: startOfDay(start), endDate: end ? startOfDay(end) : null, notes }),
      trip ? 'Viaje actualizado' : 'Viaje creado',
    );
    if (id) {
      onClose();
      if (!trip) navigate(`/viajes/${id}`);
    }
  };

  return (
    <Modal
      title={trip ? 'Editar viaje' : 'Nuevo viaje'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" form="trip-form" disabled={busy}>
            {trip ? 'Guardar' : 'Crear viaje'}
          </button>
        </>
      }
    >
      <form id="trip-form" className="form" onSubmit={submit}>
        <Field label="Destino *">
          <input list="dest-list" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Ej: Medellín" autoFocus required />
          <datalist id="dest-list">
            {destinations?.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Field>
        <div className="grid-2">
          <Field label="Fecha de salida">
            <input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
          </Field>
          <Field label="Fecha de regreso" hint="Opcional">
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Notas">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Hotel, contactos, feria…" />
        </Field>
        {!trip && (
          <p className="muted small">
            Mientras el viaje esté abierto, las ventas se descuentan de la mercancía que cargues en él (no de bodega).
          </p>
        )}
      </form>
    </Modal>
  );
}
