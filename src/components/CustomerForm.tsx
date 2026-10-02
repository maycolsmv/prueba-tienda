import { useState } from 'react';
import type { Customer } from '../lib/db';
import { saveCustomer, type CustomerDraft } from '../lib/ops';
import { Field, Modal, useAction } from './ui';
import TownInput from './TownInput';

export default function CustomerForm({
  customer,
  initialName = '',
  initialTown = '',
  onClose,
  onSaved,
}: {
  customer?: Customer;
  initialName?: string;
  /** Pueblo sugerido (el de la venta desde la que se crea). */
  initialTown?: string;
  onClose: () => void;
  onSaved?: (id: number) => void;
}) {
  const [d, setD] = useState<CustomerDraft>(
    customer ? { ...customer, town: customer.town ?? '' } : { name: initialName, phone: '', document: '', address: '', notes: '', town: initialTown },
  );
  const { run, busy } = useAction();
  const set = (k: keyof CustomerDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setD({ ...d, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = await run(() => saveCustomer(d), customer ? 'Cliente actualizado' : 'Cliente creado');
    if (id) {
      onSaved?.(id);
      onClose();
    }
  };

  return (
    <Modal
      title={customer ? 'Editar cliente' : 'Nuevo cliente'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" form="customer-form" disabled={busy}>
            Guardar
          </button>
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} className="form">
        <Field label="Nombre *">
          <input value={d.name} onChange={set('name')} autoFocus required />
        </Field>
        <div className="grid-2">
          <Field label="Celular / WhatsApp">
            <input value={d.phone} onChange={set('phone')} inputMode="tel" placeholder="3001234567" />
          </Field>
          <Field label="Cédula / NIT">
            <input value={d.document} onChange={set('document')} />
          </Field>
        </div>
        <Field label="Pueblo / ciudad">
          <TownInput value={d.town ?? ''} onChange={(town) => setD({ ...d, town })} />
        </Field>
        <Field label="Dirección">
          <input value={d.address} onChange={set('address')} />
        </Field>
        <Field label="Notas">
          <textarea value={d.notes} onChange={set('notes')} rows={2} />
        </Field>
      </form>
    </Modal>
  );
}
