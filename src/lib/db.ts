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
  /** Pueblo o ciudad donde vive / se le vende (null = sin pueblo). */
  town?: string | null;
}

export interface SaleItem {
  productId: number;
  variantId: number;
  reference: string;
  name: string;
  size: string;
  qty: number;
  price: number;
  /**
   * De dónde salió la prenda. Sin valor: del viaje de la venta (si tiene) o de bodega.
   * Se marca en prendas que entran por un cambio, para devolverlas al mismo lugar.
   */
  source?: 'viaje' | 'bodega';
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
  /** Pueblo o ciudad donde se hizo la venta (null = sin pueblo). */
  town?: string | null;
  /** Correcciones del pueblo hechas después de la venta. */
  townChanges?: { date: number; from: string | null; to: string | null }[];
  /**
   * Cambios y devoluciones hechos después. `items`, `subtotal`, `discount` y `total`
   * reflejan la venta ya ajustada; aquí queda el historial.
   */
  adjustments?: SaleAdjustment[];
}

/**
 * Cómo se resolvió la diferencia de un cambio o devolución:
 * pago = el cliente pagó; deuda = quedó debiendo; reembolso = se le devolvió dinero;
 * descuento_deuda = se descontó de su deuda (o quedó saldo a favor); ninguno = no hubo diferencia.
 */
export type Settlement = 'pago' | 'deuda' | 'reembolso' | 'descuento_deuda' | 'ninguno';

export interface SaleAdjustment {
  date: number;
  type: 'cambio' | 'devolucion';
  /** Prendas que el cliente devolvió (con el precio al que se vendieron). */
  returned: SaleItem[];
  /** Prendas nuevas que se llevó en el cambio. */
  added: SaleItem[];
  /** Valor de lo devuelto, ya con el descuento proporcional de la venta. */
  returnedValue: number;
  addedValue: number;
  /** addedValue − returnedValue: positivo = paga el cliente; negativo = a favor del cliente. */
  difference: number;
  settlement: Settlement;
  /** Dinero cobrado (pago) o devuelto (reembolso), por medio. */
  payments: Payment[];
  note: string;
  tripId: number | null;
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
  /** Pueblo de la deuda o donde se recibió el abono. */
  town?: string | null;
}

export type MovementType =
  | 'entrada'
  | 'venta'
  | 'ajuste'
  | 'conteo'
  | 'anulacion'
  | 'inicial'
  | 'carga_viaje'
  | 'regreso_viaje'
  | 'devolucion'
  | 'cambio';

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
  /**
   * Nombre del viaje o ruta (ej. "Ruta Santander"). Antes de la versión 5 era el destino;
   * se conserva el nombre del campo para no mover datos.
   */
  destination: string;
  /** Pueblos de la ruta (en el orden que se visitan). */
  towns?: string[];
  /** Pueblo donde se está vendiendo ahora (queda por defecto en las siguientes ventas). */
  currentTown?: string | null;
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

/**
 * Versión 5: pueblo en ventas, abonos y clientes; los viajes pasan a ser rutas con varios pueblos.
 * - El destino de cada viaje queda como su nombre y como primer pueblo de la ruta.
 * - Las ventas de un viaje quedan en ese pueblo; las ventas sin viaje, sin pueblo.
 * - La cartera toma el pueblo de su venta (o del viaje en que se cobró).
 * - Cada cliente toma el pueblo de su última venta con pueblo.
 * No se borra ni se cambia ningún otro dato.
 */
db.version(5)
  .stores({
    sales: '++id, &number, date, customerId, tripId, town',
    ledger: '++id, customerId, date, saleId, tripId, town',
    customers: '++id, name, phone, document, town',
  })
  .upgrade(async (tx) => {
    const data = {
      trips: (await tx.table('trips').toArray()) as Partial<Trip>[],
      sales: (await tx.table('sales').toArray()) as Partial<Sale>[],
      ledger: (await tx.table('ledger').toArray()) as Partial<LedgerEntry>[],
      customers: (await tx.table('customers').toArray()) as Partial<Customer>[],
    };
    migrateDataV5(data);
    await tx.table('trips').bulkPut(data.trips);
    await tx.table('sales').bulkPut(data.sales);
    await tx.table('ledger').bulkPut(data.ledger);
    await tx.table('customers').bulkPut(data.customers);
  });

/** Completa los datos de antes de la versión 5 (también se usa al restaurar respaldos viejos). */
export function migrateDataV5(data: {
  trips: Partial<Trip>[];
  sales: Partial<Sale>[];
  ledger: Partial<LedgerEntry>[];
  customers: Partial<Customer>[];
}) {
  const tripTown = new Map(data.trips.map((t) => [t.id, formatDestination(t.destination ?? '') || null]));
  for (const t of data.trips) {
    if (!Array.isArray(t.towns)) t.towns = t.destination ? [formatDestination(t.destination)] : [];
    if (t.currentTown === undefined) t.currentTown = null;
  }
  const saleTown = new Map<number, string | null>();
  const lastTown = new Map<number, { date: number; town: string }>();
  for (const x of data.sales) {
    if (x.town === undefined) x.town = x.tripId ? (tripTown.get(x.tripId) ?? null) : null;
    if (!Array.isArray(x.townChanges)) x.townChanges = [];
    saleTown.set(x.id!, x.town ?? null);
    if (x.customerId && x.town) {
      const prev = lastTown.get(x.customerId);
      if (!prev || (x.date ?? 0) > prev.date) lastTown.set(x.customerId, { date: x.date ?? 0, town: x.town });
    }
  }
  for (const e of data.ledger)
    if (e.town === undefined) e.town = e.saleId ? (saleTown.get(e.saleId) ?? null) : e.tripId ? (tripTown.get(e.tripId) ?? null) : null;
  for (const c of data.customers) if (c.town === undefined) c.town = lastTown.get(c.id!)?.town ?? null;
  return data;
}

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
