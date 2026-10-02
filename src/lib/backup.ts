import { db, migrateDataV5, migrateLedgerV2, migrateSaleV2, TABLES, type LedgerEntry, type Sale } from './db';
import { saveSettings } from './settings';
import { formatDestination } from './format';
import { UserError } from './ops';

const FORMAT = 'tienda-ropa-respaldo';

export async function createBackup() {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  const payload = { format: FORMAT, version: 5, createdAt: Date.now(), data };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const name = `respaldo-tienda-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  const file = new File([blob], name, { type: 'application/json' });

  // En celular permite guardarlo directo en Drive, WhatsApp, correo, etc.
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  let shared = false;
  if (nav.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ files: [file], title: name });
      shared = true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
    }
  }
  if (!shared) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  await saveSettings({ lastBackupAt: Date.now() });
  return true;
}

export async function readBackup(file: File) {
  let payload: { format?: string; createdAt?: number; data?: Record<string, unknown[]> };
  try {
    payload = JSON.parse(await file.text());
  } catch {
    throw new UserError('El archivo no es un respaldo válido.');
  }
  if (payload.format !== FORMAT || !payload.data) throw new UserError('El archivo no es un respaldo de esta aplicación.');
  const counts = Object.fromEntries(TABLES.map((t) => [t, payload.data![t]?.length ?? 0]));
  return { createdAt: payload.createdAt ?? 0, counts, data: payload.data };
}

/** Reemplaza TODA la información actual por la del respaldo. */
export async function restoreBackup(data: Record<string, unknown[]>) {
  // Respaldos anteriores a la versión 2 (sin viajes ni medios de pago) se completan igual que en la migración.
  data.sales = (data.sales ?? []).map((x) => migrateSaleV2(x as Partial<Sale>));
  data.ledger = (data.ledger ?? []).map((x) => migrateLedgerV2(x as Partial<LedgerEntry>));
  data.trips = (data.trips ?? []).map((x) => {
    const t = x as { destination?: string };
    return { ...t, destination: formatDestination(t.destination ?? '') };
  });
  data.customers = data.customers ?? [];
  migrateDataV5(data as never);
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      if (data[t]?.length) await db.table(t).bulkAdd(data[t]);
    }
  });
}
