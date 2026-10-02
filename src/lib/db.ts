import Dexie, { type EntityTable } from 'dexie';
import { formatDestination } from './format';

export interface Product {
  id: number;
  reference: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  minStock: number;
  active: boolean;
  createdAt: number;
}

/** Talla de un producto con su propia existencia. */
export interface Variant {
  id: number;
  productId: number;
  size: string;
  stock: number;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  document: string;
  address: string;
  notes: string;
  createdAt: number;
}

export interface SaleItem {
  productId: number;
  variantId: number;
  reference: string;
  name: string;
  size: string;
  qty: number;
  price: number;
}

export type PaymentType = 'contado' | 'credito';

export type PaymentMethod = 'efectivo' | 'nequi' | 'transferencia' | 'otro';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'nequi', label: 'Nequi' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'otro', label: 'Otro' },
];

export const methodLabel = (m: PaymentMethod | null | undefined) =>
  PAYMENT_METHODS.find((x) => x.value === m)?.label ?? 'Sin especificar';

export interface Payment {
  method: PaymentMethod;
  amount: number;
}

export interface Sale {
  id: number;
  number: number;
  date: number;
  customerId: number | null;
  customerName: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentType: PaymentType;
  /** Valor pagado en el momento de la venta (en crédito puede ser un abono inicial). Igual a la suma de `payments`. */
  paid: number;
  /** Cómo se pagó lo que se recibió en el momento de la venta (puede ser más de un medio). */
  payments: Payment[];
  /** Viaje en el que se hizo la venta (null = venta desde bodega). */
  tripId: number | null;
  notes: string;
  voided: boolean;
}

/** Movimiento de cartera: cargo (deuda) o abono. */
export interface LedgerEntry {
  id: number;
  customerId: number;
  date: number;
  type: 'cargo' | 'abono';
  amount: number;
  saleId: number | null;
  note: string;
  /** Medio de pago de un abono (null en deudas o registros anteriores a la versión 2). */
  method?: PaymentMethod | null;
  /** Viaje activo cuando se registró (para saber qué se cobró en cada destino). */
  tripId?: number | null;
}

export type MovementType =
  | 'entrada'
  | 'venta'
  | 'ajuste'
  | 'conteo'
  | 'anulacion'
  | 'inicial'
  | 'carga_viaje'
  | 'regreso_viaje';

export interface Movement {
  id: number;
  date: number;
  productId: number;
  variantId: number;
  type: MovementType;
  /** Cantidad con signo: positiva suma, negativa resta. */
  qty: number;
  stockAfter: number;
  note: string;
  refId: number | null;
  /**
   * Si tiene valor, el movimiento es sobre la mercancía que va en ese viaje
   * (y `stockAfter` es lo que queda en el viaje). Sin valor = bodega.
   */
  tripId?: number | null;
}

export interface Trip {
  id: number;
  destination: string;
  startDate: number;
  /** Regreso planeado (o real, al cerrar). */
  endDate: number | null;
  notes: string;
  status: 'abierto' | 'cerrado';
  createdAt: number;
  closedAt: number | null;
}

/** Mercancía de una talla que va en un viaje. */
export interface TripItem {
  id: number;
  tripId: number;
  productId: number;
  variantId: number;
  /** Unidades cargadas en total (se puede cargar varias veces). */
  loaded: number;
  /** Unidades que todavía lleva en el viaje. */
  onHand: number;
  /** Unidades devueltas a bodega (al cerrar o antes). */
  returned: number;
}

export interface CountLine {
  productId: number;
  variantId: number;
  reference: string;
  name: string;
  size: string;
  system: number;
  counted: number | null;
}

export interface InventoryCount {
  id: number;
  date: number;
  status: 'abierto' | 'aplicado';
  category: string;
  lines: CountLine[];
  appliedAt: number | null;
}

export interface Setting {
  key: string;
  value: unknown;
}

export const db = new Dexie('tienda-ropa') as Dexie & {
  products: EntityTable<Product, 'id'>;
  variants: EntityTable<Variant, 'id'>;
  customers: EntityTable<Customer, 'id'>;
  sales: EntityTable<Sale, 'id'>;
  ledger: EntityTable<LedgerEntry, 'id'>;
  movements: EntityTable<Movement, 'id'>;
  counts: EntityTable<InventoryCount, 'id'>;
  settings: EntityTable<Setting, 'key'>;
  trips: EntityTable<Trip, 'id'>;
  expenses: EntityTable<Expense, 'id'>;
  tripItems: EntityTable<TripItem, 'id'>;
};

db.version(1).stores({
  products: '++id, reference, name, category, active',
  variants: '++id, productId, [productId+size]',
  customers: '++id, name, phone, document',
  sales: '++id, &number, date, customerId',
  ledger: '++id, customerId, date, saleId',
  movements: '++id, date, productId, variantId, type',
  counts: '++id, date, status',
  settings: 'key',
});

/**
 * Completa una venta guardada antes de la versión 2 (sin medios de pago ni viaje).
 * Lo pagado en el momento se toma como efectivo. Se usa en la migración y al restaurar respaldos viejos.
 */
export function migrateSaleV2(s: Partial<Sale>) {
  if (!Array.isArray(s.payments)) s.payments = (s.paid ?? 0) > 0 ? [{ method: 'efectivo', amount: s.paid! }] : [];
  if (s.tripId === undefined) s.tripId = null;
  return s;
}

/** Abonos anteriores a la versión 2: se asumen en efectivo. */
export function migrateLedgerV2(e: Partial<LedgerEntry>) {
  if (e.method === undefined) e.method = e.type === 'abono' && !e.note?.startsWith('Anulación') ? 'efectivo' : null;
  if (e.tripId === undefined) e.tripId = null;
  return e;
}

// Versión 2: viajes y medios de pago. Los datos existentes se conservan y se completan.
db.version(2)
  .stores({
    sales: '++id, &number, date, customerId, tripId',
    ledger: '++id, customerId, date, saleId, tripId',
    movements: '++id, date, productId, variantId, type, tripId',
    trips: '++id, status, startDate, destination',
    tripItems: '++id, tripId, variantId, [tripId+variantId]',
  })
  .upgrade(async (tx) => {
    await tx.table('sales').toCollection().modify((s: Sale) => {
      migrateSaleV2(s);
    });
    await tx.table('ledger').toCollection().modify((e: LedgerEntry) => {
      migrateLedgerV2(e);
    });
  });

export type ExpenseCategory = 'pasajes' | 'hospedaje' | 'comida' | 'envios' | 'empaques' | 'otros';

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'pasajes', label: 'Pasajes' },
  { value: 'hospedaje', label: 'Hospedaje' },
  { value: 'comida', label: 'Comida' },
  { value: 'envios', label: 'Envíos' },
  { value: 'empaques', label: 'Bolsas y empaques' },
  { value: 'otros', label: 'Otros' },
];

export const categoryLabel = (c: ExpenseCategory) => EXPENSE_CATEGORIES.find((x) => x.value === c)?.label ?? c;

export interface Expense {
  id: number;
  date: number;
  category: ExpenseCategory;
  amount: number;
  method: PaymentMethod;
  /** Viaje al que pertenece el gasto (null = gasto general). */
  tripId: number | null;
  note: string;
  createdAt: number;
}

// Versión 3: gastos. Solo agrega una tabla; no cambia los datos existentes.
db.version(3).stores({
  expenses: '++id, date, category, tripId',
});

// Versión 4: destinos de viaje con mayúsculas y espacios normalizados ("malaga" → "Malaga").
// Solo cambia el texto del destino; no toca tildes ni ningún otro dato.
db.version(4)
  .stores({})
  .upgrade(async (tx) => {
    await tx.table('trips').toCollection().modify((t: Trip) => {
      t.destination = formatDestination(t.destination ?? '');
    });
  });

export const TABLES = [
  'products',
  'variants',
  'customers',
  'sales',
  'ledger',
  'movements',
  'counts',
  'settings',
  'trips',
  'tripItems',
  'expenses',
] as const;
