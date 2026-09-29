import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';

export interface StoreSettings {
  storeName: string;
  nit: string;
  phone: string;
  address: string;
  receiptFooter: string;
  /** Cada cuántos días recordar el respaldo. */
  backupReminderDays: number;
  lastBackupAt: number | null;
  nextSaleNumber: number;
}

export const DEFAULT_SETTINGS: StoreSettings = {
  storeName: 'Mi Tienda',
  nit: '',
  phone: '',
  address: '',
  receiptFooter: 'Gracias por su compra. Este documento es un comprobante interno, no es factura electrónica.',
  backupReminderDays: 7,
  lastBackupAt: null,
  nextSaleNumber: 1,
};

export async function getSettings(): Promise<StoreSettings> {
  const rows = await db.settings.toArray();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as StoreSettings;
}

export async function saveSettings(patch: Partial<StoreSettings>) {
  await db.settings.bulkPut(Object.entries(patch).map(([key, value]) => ({ key, value })));
}

export function useSettings(): StoreSettings | undefined {
  return useLiveQuery(getSettings, []);
}
