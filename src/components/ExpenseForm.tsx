import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, EXPENSE_CATEGORIES, PAYMENT_METHODS, type Expense, type ExpenseCategory, type PaymentMethod } from '../lib/db';
import { deleteExpense, getActiveTrip, saveExpense } from '../lib/ops';
import { fmtDate, startOfDay, toDateInput } from '../lib/format';
import { Field, Modal, MoneyInput, useAction, useConfirm } from './ui';

export default function ExpenseForm({
  expense,
  tripId,
  onClose,
}: {
  expense?: Expense;
  /** Viaje sugerido. Sin valor: el viaje abierto, si hay. */
  tripId?: number | null;
  onClose: () => void;
}) {
  const trips = useLiveQuery(() => db.trips.orderBy('startDate').reverse().toArray(), []);
  const [amount, setAmount] = useState(expense?.amount ?? 0);
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? 'comida');
  const [method, setMethod] = useState<PaymentMethod>(expense?.method ?? 'efectivo');
  const [date, setDate] = useState(toDateInput(expense?.date ?? Date.now()));
  const [trip, setTrip] = useState<number | null>(expense ? expense.tripId : (tripId ?? null));
  const [note, setNote] = useState(expense?.note ?? '');
  const { run, busy } = useAction();
  const confirm = useConfirm();

  // Gasto nuevo sin viaje indicado: se asocia al viaje abierto.
  useEffect(() => {
    if (expense || tripId !== undefined) return;
    getActiveTrip().then((t) => t && setTrip(t.id));
  }, [expense, tripId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Hoy guarda la hora actual; otro día, el mediodía de ese día.
    const today = toDateInput(Date.now()) === date;
    const when = today ? (expense && toDateInput(expense.date) === date ? expense.date : Date.now()) : startOfDay(date) + 12 * 3_600_000;
    const id = await run(
      () => saveExpense({ id: expense?.id, date: when, category, amount, method, tripId: trip, note }),
      expense ? 'Gasto actualizado' : 'Gasto registrado',
    );
    if (id) onClose();
  };

  const remove = async () => {
    if (!expense || !(await confirm('¿Eliminar este gasto?', { confirmLabel: 'Eliminar', danger: true }))) return;
    const ok = await run(async () => {
      await deleteExpense(expense.id);
      return true;
    }, 'Gasto eliminado');
    if (ok) onClose();
  };

  return (
    <Modal
      title={expense ? 'Editar gasto' : 'Registrar gasto'}
      onClose={onClose}
      footer={
        <>
          {expense && (
            <button className="btn btn-danger-ghost" onClick={remove} disabled={busy}>
              Eliminar
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" form="expense-form" disabled={busy || amount <= 0}>
            Guardar
          </button>
        </>
      }
    >
      <form id="expense-form" className="form" onSubmit={submit}>
        <Field label="Valor *">
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <Field label="Categoría">
          <div className="choice-grid">
            {EXPENSE_CATEGORIES.map((c) => (
              <button key={c.value} type="button" className={`choice ${category === c.value ? 'active' : ''}`} onClick={() => setCategory(c.value)}>
                {c.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Medio de pago">
          <div className="segmented method-pick">
            {PAYMENT_METHODS.map((m) => (
              <button key={m.value} type="button" className={method === m.value ? 'active' : ''} onClick={() => setMethod(m.value)}>
                {m.label}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid-2">
          <Field label="Fecha">
            <input type="date" value={date} max={toDateInput(Date.now())} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <Field label="Viaje">
            <select value={trip ?? ''} onChange={(e) => setTrip(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Gasto general (sin viaje)</option>
              {trips?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.destination} · {fmtDate(t.startDate)}
                  {t.status === 'abierto' ? ' (en curso)' : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Nota">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: bus ida, hotel 2 noches, almuerzo" />
        </Field>
      </form>
    </Modal>
  );
}
