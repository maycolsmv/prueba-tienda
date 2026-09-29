import Dexie, { type EntityTable } from 'dexie';

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
  /** Valor pagado en el momento de la venta (en crédito puede ser un abono inicial). */
  paid: number;
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
}

export type MovementType = 'entrada' | 'venta' | 'ajuste' | 'conteo' | 'anulacion' | 'inicial';

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

export const TABLES = [
  'products',
  'variants',
  'customers',
  'sales',
  'ledger',
  'movements',
  'counts',
  'settings',
] as const;
