// Resumen de viajes (solo lectura).
import { db, type Expense, type ExpenseCategory, type PaymentMethod, type Trip } from './db';
import { compareSizes } from './format';
import { moneyByMethod, openCharges } from './stats';

export interface TripLine {
  productId: number;
  variantId: number;
  reference: string;
  name: string;
  category: string;
  size: string;
  price: number;
  loaded: number;
  sold: number;
  onHand: number;
  returned: number;
}

export interface TripSummary {
  trip: Trip;
  lines: TripLine[];
  units: { loaded: number; sold: number; returned: number; onHand: number };
  total: number;
  saleCount: number;
  cost: number;
  expenses: number;
  expenseList: Expense[];
  expensesByCategory: { category: ExpenseCategory; amount: number }[];
  /** Efectivo recibido menos gastos pagados en efectivo: lo que debería tener en mano. */
  cashOnHand: number;
  profit: number;
  methods: Record<PaymentMethod, number>;
  /** Vendido a crédito en el viaje que todavía no se ha cobrado. */
  carteraOpen: number;
  carteraCustomers: number;
  credit: number;
}

export async function tripSummary(tripId: number): Promise<TripSummary | null> {
  const trip = await db.trips.get(tripId);
  if (!trip) return null;
  const [items, sales, ledger, products, variants, expenseList] = await Promise.all([
    db.tripItems.where('tripId').equals(tripId).toArray(),
    db.sales.where('tripId').equals(tripId).toArray(),
    db.ledger.toArray(),
    db.products.toArray(),
    db.variants.toArray(),
    db.expenses.where('tripId').equals(tripId).toArray(),
  ]);
  const pm = new Map(products.map((p) => [p.id, p]));
  const vm = new Map(variants.map((v) => [v.id, v]));
  const valid = sales.filter((s) => !s.voided);

  let cost = 0;
  for (const s of valid) for (const i of s.items) cost += i.qty * (pm.get(i.productId)?.cost ?? 0);

  const lines: TripLine[] = items
    .map((it) => {
      const p = pm.get(it.productId);
      return {
        productId: it.productId,
        variantId: it.variantId,
        reference: p?.reference ?? '',
        name: p?.name ?? '(eliminado)',
        category: p?.category ?? '',
        size: vm.get(it.variantId)?.size ?? '?',
        price: p?.price ?? 0,
        loaded: it.loaded,
        // Vendido = lo que salió y no volvió (cuadra con anulaciones, cambios y devoluciones)
        sold: it.loaded - it.returned - it.onHand,
        onHand: it.onHand,
        returned: it.returned,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || compareSizes(a.size, b.size));

  const units = lines.reduce(
    (a, l) => ({ loaded: a.loaded + l.loaded, sold: a.sold + l.sold, returned: a.returned + l.returned, onHand: a.onHand + l.onHand }),
    { loaded: 0, sold: 0, returned: 0, onHand: 0 },
  );

  const total = valid.reduce((a, s) => a + s.total, 0);
  const tripSaleIds = new Set(sales.map((s) => s.id));
  // Cobros hechos durante el viaje (abonos de cartera, de cualquier venta)
  const tripLedger = ledger.filter((e) => e.tripId === tripId);
  const methods = moneyByMethod(valid, tripLedger);

  const open = openCharges(ledger).filter((c) => c.entry.saleId !== null && tripSaleIds.has(c.entry.saleId));
  const expenses = expenseList.reduce((a, e) => a + e.amount, 0);
  const byCat = new Map<ExpenseCategory, number>();
  for (const e of expenseList) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  const cashSpent = expenseList.filter((e) => e.method === 'efectivo').reduce((a, e) => a + e.amount, 0);

  return {
    trip,
    lines,
    units,
    total,
    saleCount: valid.length,
    cost,
    expenses,
    expenseList: expenseList.sort((a, b) => b.date - a.date),
    expensesByCategory: [...byCat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    cashOnHand: methods.efectivo - cashSpent,
    profit: total - cost - expenses,
    methods,
    carteraOpen: open.reduce((a, c) => a + c.open, 0),
    carteraCustomers: new Set(open.map((c) => c.entry.customerId)).size,
    credit: valid.filter((s) => s.paymentType === 'credito').reduce((a, s) => a + Math.max(0, s.total - s.paid), 0),
  };
}

/** Lista de viajes con sus números principales (más reciente primero). */
export async function tripList() {
  const trips = await db.trips.orderBy('startDate').reverse().toArray();
  const [items, sales, expenses] = await Promise.all([
    db.tripItems.toArray(),
    db.sales.where('tripId').above(0).toArray(),
    db.expenses.where('tripId').above(0).toArray(),
  ]);
  return trips.map((t) => {
    const its = items.filter((i) => i.tripId === t.id);
    const ss = sales.filter((s) => s.tripId === t.id && !s.voided);
    return {
      ...t,
      loaded: its.reduce((a, i) => a + i.loaded, 0),
      onHand: its.reduce((a, i) => a + i.onHand, 0),
      sold: its.reduce((a, i) => a + i.loaded - i.returned - i.onHand, 0),
      total: ss.reduce((a, s) => a + s.total, 0),
      saleCount: ss.length,
      expenses: expenses.filter((e) => e.tripId === t.id).reduce((a, e) => a + e.amount, 0),
    };
  });
}
