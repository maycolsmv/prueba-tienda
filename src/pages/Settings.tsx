import { useEffect, useState } from 'react';
import { createBackup, readBackup, restoreBackup } from '../lib/backup';
import { exportCustomers, exportEverything, exportInventory, exportMovements } from '../lib/exports';
import { fmtDateTime } from '../lib/format';
import { loadDemoData, realDataCounts, removeDemoData } from '../lib/demo';
import { Icon } from '../components/Icon';
import { saveSettings, useSettings, type StoreSettings } from '../lib/settings';
import { Field, NumberInput, pickFile, useAction, useConfirm, useToast } from '../components/ui';

export default function Settings() {
  const s = useSettings();
  const [d, setD] = useState<StoreSettings | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const toastDemo = useToast();

  useEffect(() => {
    if (s && !d) setD(s);
  }, [s, d]);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  if (!s || !d) return null;

  const set = (k: keyof StoreSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setD({ ...d, [k]: e.target.value });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    run(
      () =>
        saveSettings({
          storeName: d.storeName.trim() || 'Mi Tienda',
          nit: d.nit.trim(),
          phone: d.phone.trim(),
          address: d.address.trim(),
          receiptFooter: d.receiptFooter.trim(),
          backupReminderDays: Math.max(1, d.backupReminderDays || 7),
        }),
      'Datos guardados',
    );
  };

  const restore = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    const b = await run(() => readBackup(f));
    if (!b) return;
    const msg =
      `Respaldo del ${b.createdAt ? fmtDateTime(b.createdAt) : 'fecha desconocida'}:\n` +
      `${b.counts.products} productos, ${b.counts.sales} ventas, ${b.counts.customers} clientes.\n\n` +
      'Se REEMPLAZARÁ toda la información actual de este dispositivo. ¿Continuar?';
    if (!(await confirm(msg, { confirmLabel: 'Restaurar', danger: true }))) return;
    const ok = await run(async () => {
      await restoreBackup(b.data);
      return true;
    }, 'Respaldo restaurado');
    if (ok) setTimeout(() => location.reload(), 800);
  };

  const loadDemo = async () => {
    const real = await realDataCounts();
    const hasReal = real.products + real.customers + real.sales > 0;
    const msg = hasReal
      ? `⚠ Ya tienes datos REALES en este dispositivo (${real.products} productos, ${real.customers} clientes, ${real.sales} ventas).\n\n` +
        'Los datos de demostración se van a MEZCLAR con ellos en el dashboard, reportes e inventario. ' +
        'Luego puedes borrar solo los de demostración, pero te recomendamos hacer un respaldo antes.\n\n¿Cargar de todas formas?'
      : 'Se van a crear unos 20 productos de ropa, 15 clientes y cerca de 3 meses de ventas (contado y crédito) para que veas el dashboard lleno.\n\nLuego los puedes borrar con un clic.';
    if (!(await confirm(msg, { confirmLabel: hasReal ? 'Sí, mezclar con mis datos' : 'Cargar demostración', danger: hasReal }))) return;
    const r = await run(loadDemoData);
    if (r) toastDemo(`Demostración cargada: ${r.products} productos, ${r.customers} clientes y ${r.sales} ventas`);
  };

  const clearDemo = async () => {
    const ok = await confirm(
      'Se borrarán SOLO los productos, clientes, ventas, abonos y movimientos de demostración. Tus datos reales no se tocan.\n\n¿Borrar la demostración?',
      { confirmLabel: 'Borrar demostración', danger: true },
    );
    if (ok) await run(removeDemoData, 'Datos de demostración borrados');
  };

  const days = s.lastBackupAt ? Math.floor((Date.now() - s.lastBackupAt) / 86_400_000) : null;

  return (
    <div className="page">
      <section className="card">
        <div className="row-between wrap gap">
          <div>
            <h2 className="row gap">
              <Icon name="database" size={18} /> Datos de demostración
            </h2>
            <p className="muted small" style={{ marginBottom: 0 }}>
              {s.demoLoadedAt
                ? `Cargados el ${fmtDateTime(s.demoLoadedAt)}. Bórralos antes de empezar a usar la app con datos reales.`
                : 'Llena la app con productos, clientes y 3 meses de ventas de ejemplo para ver el dashboard y los reportes.'}
            </p>
          </div>
          {s.demoLoadedAt ? (
            <button className="btn btn-danger-ghost" disabled={busy} onClick={clearDemo}>
              <Icon name="trash" size={18} /> Borrar demostración
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={loadDemo}>
              Cargar datos de demostración
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Respaldo de información</h2>
        <p className="muted small">
          La información se guarda solo en este dispositivo. Haz respaldos seguido y guarda el archivo en otro lugar
          (computador, USB, Google Drive, correo). <strong>El respaldo es responsabilidad del usuario.</strong>
        </p>
        <p>
          Último respaldo:{' '}
          <strong className={days === null || days >= s.backupReminderDays ? 'text-danger' : 'text-ok'}>
            {s.lastBackupAt ? `${fmtDateTime(s.lastBackupAt)} (hace ${days} días)` : 'nunca'}
          </strong>
        </p>
        <div className="row gap wrap">
          <button className="btn btn-primary" disabled={busy} onClick={() => run(createBackup, 'Respaldo generado')}>
            Generar respaldo
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={restore}>
            Restaurar desde archivo
          </button>
        </div>
        {persisted === false && (
          <p className="muted small">
            Consejo: instala la app en la pantalla de inicio para que el navegador no borre los datos si falta espacio.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Exportar a Excel</h2>
        <div className="row gap wrap">
          <button className="btn btn-ghost" onClick={() => run(exportEverything)}>
            Todo en un archivo
          </button>
          <button className="btn btn-ghost" onClick={() => run(exportInventory)}>
            Inventario
          </button>
          <button className="btn btn-ghost" onClick={() => run(exportCustomers)}>
            Clientes y cartera
          </button>
          <button className="btn btn-ghost" onClick={() => run(exportMovements)}>
            Movimientos
          </button>
        </div>
        <p className="muted small">Las ventas por fechas se exportan desde Ventas o Reportes.</p>
      </section>

      <section className="card">
        <h2>Datos del negocio</h2>
        <p className="muted small">Aparecen en el comprobante de venta.</p>
        <form className="form" onSubmit={save}>
          <Field label="Nombre de la tienda">
            <input value={d.storeName} onChange={set('storeName')} />
          </Field>
          <div className="grid-2">
            <Field label="NIT / Cédula">
              <input value={d.nit} onChange={set('nit')} />
            </Field>
            <Field label="Teléfono">
              <input value={d.phone} onChange={set('phone')} inputMode="tel" />
            </Field>
          </div>
          <Field label="Dirección">
            <input value={d.address} onChange={set('address')} />
          </Field>
          <Field label="Mensaje al pie del comprobante">
            <textarea rows={2} value={d.receiptFooter} onChange={set('receiptFooter')} />
          </Field>
          <Field label="Recordar respaldo cada (días)">
            <NumberInput min={1} value={d.backupReminderDays} onChange={(n) => setD({ ...d, backupReminderDays: n ?? 7 })} />
          </Field>
          <div className="actions">
            <button className="btn btn-primary" disabled={busy}>
              Guardar
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
