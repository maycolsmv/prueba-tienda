import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { addLedgerEntry } from '../lib/ops';
import { fmtDateTime, fmtMoney } from '../lib/format';
import { waNumber } from '../lib/receipt';
import { useSettings } from '../lib/settings';
import { Empty, Field, Modal, MoneyInput, Tabs, useAction } from '../components/ui';
import CustomerForm from '../components/CustomerForm';
import SaleView from '../components/SaleView';

export default function CustomerDetail() {
  const id = Number(useParams().id);
  const settings = useSettings();
  const data = useLiveQuery(async () => {
    const [customer, sales, ledger] = await Promise.all([
      db.customers.get(id),
      db.sales.where('customerId').equals(id).reverse().sortBy('date'),
      db.ledger.where('customerId').equals(id).sortBy('date'),
    ]);
    let running = 0;
    const withBalance = ledger.map((e) => {
      running += e.type === 'cargo' ? e.amount : -e.amount;
      return { ...e, balance: running };
    });
    return { customer, sales, ledger: withBalance.reverse(), balance: running };
  }, [id]);
  const [tab, setTab] = useState<'cartera' | 'compras'>('cartera');
  const [entry, setEntry] = useState<'cargo' | 'abono' | null>(null);
  const [editing, setEditing] = useState(false);
  const [saleId, setSaleId] = useState<number | null>(null);

  if (!data) return null;
  const { customer, sales, ledger, balance } = data;
  if (!customer)
    return (
      <div className="page">
        <Empty>
          Cliente no encontrado. <Link to="/clientes">Volver</Link>
        </Empty>
      </div>
    );

  const validSales = sales.filter((s) => !s.voided);
  const totalBought = validSales.reduce((a, s) => a + s.total, 0);

  const remind = () => {
    const text = `Hola ${customer.name}, te saludamos de ${settings?.storeName ?? 'la tienda'}. Te recordamos que tienes un saldo pendiente de ${fmtMoney(balance)}. ¡Gracias!`;
    window.open(`https://wa.me/${waNumber(customer.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  return (
    <div className="page">
      <Link to="/clientes" className="link small">
        ← Clientes
      </Link>
      <div className="page-head">
        <div>
          <h1>{customer.name}</h1>
          <div className="muted small">
            {[customer.phone, customer.document, customer.address].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => setEditing(true)}>
            Editar
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-label">{balance < 0 ? 'Saldo a favor del cliente' : 'Saldo pendiente'}</span>
          <span className={`stat-value ${balance > 0 ? 'text-danger' : balance < 0 ? 'text-ok' : ''}`}>
            {fmtMoney(Math.abs(balance))}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Total comprado</span>
          <span className="stat-value">{fmtMoney(totalBought)}</span>
          <span className="stat-sub">{validSales.length} compras</span>
        </div>
      </div>

      <div className="row gap wrap">
        <button className="btn btn-primary" onClick={() => setEntry('abono')} disabled={balance <= 0}>
          Registrar abono
        </button>
        <button className="btn btn-ghost" onClick={() => setEntry('cargo')}>
          Registrar deuda
        </button>
        {balance > 0 && customer.phone && (
          <button className="btn btn-whatsapp" onClick={remind}>
            Recordar por WhatsApp
          </button>
        )}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'cartera', label: 'Deudas y abonos' },
          { value: 'compras', label: 'Historial de compras' },
        ]}
      />

      {tab === 'cartera' &&
        (ledger.length === 0 ? (
          <Empty>Sin movimientos de cartera.</Empty>
        ) : (
          <div className="card flush table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Detalle</th>
                  <th className="num">Deuda</th>
                  <th className="num">Abono</th>
                  <th className="num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.id}>
                    <td className="small nowrap">{fmtDateTime(e.date)}</td>
                    <td className="small">{e.note || (e.type === 'cargo' ? 'Deuda' : 'Abono')}</td>
                    <td className="num">{e.type === 'cargo' ? fmtMoney(e.amount) : ''}</td>
                    <td className="num text-ok">{e.type === 'abono' ? fmtMoney(e.amount) : ''}</td>
                    <td className="num">{fmtMoney(e.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'compras' &&
        (sales.length === 0 ? (
          <Empty>Este cliente no tiene compras.</Empty>
        ) : (
          <div className="card flush">
            <ul className="list">
              {sales.map((s) => (
                <li key={s.id}>
                  <button className={`list-row pick-row ${s.voided ? 'voided' : ''}`} onClick={() => setSaleId(s.id)}>
                    <div>
                      <strong>#{s.number}</strong>
                      <div className="muted small">
                        {fmtDateTime(s.date)} · {s.items.map((i) => `${i.qty}× ${i.name} (${i.size})`).join(', ')}
                      </div>
                    </div>
                    <div className="right">
                      <div className={s.voided ? 'strike' : ''}>{fmtMoney(s.total)}</div>
                      <span className={`badge ${s.voided ? 'badge-danger' : s.paymentType === 'credito' ? 'badge-warn' : 'badge-ok'}`}>
                        {s.voided ? 'Anulada' : s.paymentType === 'credito' ? 'Crédito' : 'Contado'}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

      {entry && <LedgerModal customerId={id} type={entry} balance={balance} onClose={() => setEntry(null)} />}
      {editing && <CustomerForm customer={customer} onClose={() => setEditing(false)} />}
      {saleId && <SaleView saleId={saleId} onClose={() => setSaleId(null)} />}
    </div>
  );
}

function LedgerModal({
  customerId,
  type,
  balance,
  onClose,
}: {
  customerId: number;
  type: 'cargo' | 'abono';
  balance: number;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  const save = async () => {
    const ok = await run(async () => {
      await addLedgerEntry(customerId, type, amount, note);
      return true;
    }, type === 'abono' ? 'Abono registrado' : 'Deuda registrada');
    if (ok) onClose();
  };
  return (
    <Modal
      title={type === 'abono' ? 'Registrar abono' : 'Registrar deuda'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || amount <= 0}>
            Guardar
          </button>
        </>
      }
    >
      <div className="form">
        {type === 'abono' && (
          <p className="row-between">
            <span>Saldo pendiente</span>
            <strong>{fmtMoney(balance)}</strong>
          </p>
        )}
        <Field label="Valor">
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        {type === 'abono' && amount > 0 && (
          <p className="muted">Nuevo saldo: {fmtMoney(balance - amount)}</p>
        )}
        {type === 'abono' && balance > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAmount(balance)}>
            Pagar todo ({fmtMoney(balance)})
          </button>
        )}
        <Field label={type === 'abono' ? 'Nota (efectivo, transferencia…)' : 'Concepto'}>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
