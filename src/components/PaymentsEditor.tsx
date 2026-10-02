import { PAYMENT_METHODS, type Payment, type PaymentMethod } from '../lib/db';
import { fmtMoney } from '../lib/format';
import { MoneyInput } from './ui';

/**
 * Pagos de una venta.
 * - Contado: el último medio se completa solo con lo que falta, así siempre suma el total.
 * - Crédito: son abonos iniciales (opcionales), cada uno con su medio.
 */
export function effectivePayments(lines: Payment[], mode: 'contado' | 'credito', total: number): Payment[] {
  if (mode === 'credito' || !lines.length) return lines;
  const others = lines.slice(0, -1).reduce((s, p) => s + (p.amount || 0), 0);
  return [...lines.slice(0, -1), { ...lines[lines.length - 1], amount: Math.max(0, total - others) }];
}

export default function PaymentsEditor({
  mode,
  total,
  value,
  onChange,
}: {
  mode: 'contado' | 'credito';
  total: number;
  value: Payment[];
  onChange: (p: Payment[]) => void;
}) {
  const lines = effectivePayments(value, mode, total);
  const sum = lines.reduce((s, p) => s + (p.amount || 0), 0);
  const othersOver = mode === 'contado' && lines.slice(0, -1).reduce((s, p) => s + (p.amount || 0), 0) > total;
  const used = new Set(lines.map((l) => l.method));
  const nextMethod = PAYMENT_METHODS.find((m) => !used.has(m.value))?.value;

  const set = (i: number, patch: Partial<Payment>) => onChange(value.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  return (
    <div className="payments">
      {lines.map((p, i) => {
        const auto = mode === 'contado' && i === lines.length - 1;
        return (
          <div key={i} className="payment-row">
            <select
              value={p.method}
              onChange={(e) => set(i, { method: e.target.value as PaymentMethod })}
              aria-label="Medio de pago"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value} disabled={m.value !== p.method && used.has(m.value)}>
                  {m.label}
                </option>
              ))}
            </select>
            {auto ? (
              <div className="payment-auto" title="Se completa solo con lo que falta">
                {fmtMoney(p.amount)}
              </div>
            ) : (
              <MoneyInput value={p.amount} onChange={(amount) => set(i, { amount })} aria-label="Valor" />
            )}
            {(lines.length > 1 || mode === 'credito') && (
              <button type="button" className="icon-btn" aria-label="Quitar medio de pago" onClick={() => onChange(value.filter((_, k) => k !== i))}>
                ✕
              </button>
            )}
          </div>
        );
      })}
      {nextMethod && (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          // Los pagos actuales quedan fijos con su valor; el nuevo (último) se completa solo con lo que falte.
          onClick={() => onChange([...lines, { method: nextMethod, amount: 0 }])}
        >
          {mode === 'credito' ? (lines.length ? '+ Otro medio' : '+ Agregar abono inicial') : '+ Pagar con otro medio'}
        </button>
      )}
      {othersOver && <p className="small text-danger">Los pagos superan el total de la venta.</p>}
      {mode === 'credito' && sum > total && <p className="small text-danger">El abono no puede ser mayor que el total.</p>}
    </div>
  );
}
