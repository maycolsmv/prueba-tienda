// Cálculos de solo lectura para el dashboard y los reportes. No modifica datos.
import { db, type LedgerEntry, type Sale } from './db';
import { allBalances, isLowStock, loadCatalog, type ProductWithVariants } from './ops';
import { compareSizes, toDateInput } from './format';

const DAY = 86_400_000;

export type PeriodKey = 'hoy' | '7d' | '30d' | 'mes' | 'ano';

export const PERIODS: { value: PeriodKey; label: string }[] = [
  { value: 'hoy', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
  { value: 'mes', label: 'Este mes' },
  { value: 'ano', label: 'Este año' },
];

export interface Range {
  from: number;
  to: number;
}

const startOfToday = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Periodo actual y el periodo anterior equivalente con el que se compara. */
export function periodRanges(key: PeriodKey): { current: Range; previous: Range; label: string } {
  const now = Date.now();
  const today = startOfToday();
  const d = new Date();
  switch (key) {
    case 'hoy':
      return { current: { from: today, to: now }, previous: { from: today - DAY, to: now - DAY }, label: 'vs. ayer' };
    case '7d':
      return { current: { from: today - 6 * DAY, to: now }, previous: { from: today - 13 * DAY, to: today - 6 * DAY - 1 }, label: 'vs. 7 días anteriores' };
    case '30d':
      return { current: { from: today - 29 * DAY, to: now }, previous: { from: today - 59 * DAY, to: today - 29 * DAY - 1 }, label: 'vs. 30 días anteriores' };
    case 'mes': {
      const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      const pFrom = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
      // Mismo avance del mes anterior (sin pasarse de su último día).
      const pTo = Math.min(pFrom + (now - from), from - 1);
      return { current: { from, to: now }, previous: { from: pFrom, to: pTo }, label: 'vs. mes anterior' };
    }
    case 'ano': {
      const from = new Date(d.getFullYear(), 0, 1).getTime();
      const pFrom = new Date(d.getFullYear() - 1, 0, 1).getTime();
      return { current: { from, to: now }, previous: { from: pFrom, to: Math.min(pFrom + (now - from), from - 1) }, label: 'vs. año anterior' };
    }
  }
}

/** % de cambio; null cuando no hay base para comparar. */
export const pctChange = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? null : 0);

export type StockStatus = 'disponible' | 'poco' | 'agotado';

export function stockStatus(p: ProductWithVariants): StockStatus {
  if (p.totalStock <= 0) return 'agotado';
  if (isLowStock(p)) return 'poco';
  return 'disponible';
}

export const STATUS_LABEL: Record<StockStatus, string> = {
  disponible: 'Disponible',
  poco: 'Poco stock',
  agotado: 'Agotado',
};

export function inventorySummary(catalog: ProductWithVariants[]) {
  const counts = { disponible: 0, poco: 0, agotado: 0 };
  let units = 0;
  let value = 0;
  let cost = 0;
  for (const p of catalog) {
    counts[stockStatus(p)]++;
    units += p.totalStock;
    value += p.totalStock * p.price;
    cost += p.totalStock * p.cost;
  }
  return { counts, products: catalog.length, units, value, cost };
}

interface SalesAgg {
  total: number;
  count: number;
  units: number;
  cost: number;
  contado: number;
  credito: number;
  discount: number;
}

function aggregate(sales: Sale[], costOf: (productId: number) => number): SalesAgg {
  const a: SalesAgg = { total: 0, count: 0, units: 0, cost: 0, contado: 0, credito: 0, discount: 0 };
  for (const s of sales) {
    a.total += s.total;
    a.count++;
    a.discount += s.discount;
    if (s.paymentType === 'contado') a.contado += s.total;
    else a.credito += s.total;
    for (const i of s.items) {
      a.units += i.qty;
      a.cost += i.qty * costOf(i.productId);
    }
  }
  return a;
}

/** Valor de cada línea descontando proporcionalmente el descuento de la venta. */
const lineValue = (s: Sale, qty: number, price: number) => (s.subtotal > 0 ? Math.round((qty * price * s.total) / s.subtotal) : 0);

/**
 * Antigüedad de la cartera: los abonos pagan primero las deudas más viejas (FIFO);
 * lo que queda pendiente de cada deuda se clasifica por su fecha.
 */
export function debtAging(ledger: LedgerEntry[], now = Date.now()) {
  const buckets = [
    { label: '0–30 días', amount: 0 },
    { label: '31–60 días', amount: 0 },
    { label: '61–90 días', amount: 0 },
    { label: 'Más de 90 días', amount: 0 },
  ];
  const byCustomer = new Map<number, LedgerEntry[]>();
  for (const e of ledger) {
    const l = byCustomer.get(e.customerId) ?? [];
    l.push(e);
    byCustomer.set(e.customerId, l);
  }
  const oldestByCustomer = new Map<number, number>();
  for (const [cid, entries] of byCustomer) {
    entries.sort((a, b) => a.date - b.date || a.id - b.id);
    let paid = entries.filter((e) => e.type === 'abono').reduce((s, e) => s + e.amount, 0);
    for (const c of entries.filter((e) => e.type === 'cargo')) {
      const covered = Math.min(paid, c.amount);
      paid -= covered;
      const open = c.amount - covered;
      if (open <= 0) continue;
      const days = Math.floor((now - c.date) / DAY);
      buckets[days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3].amount += open;
      if (!oldestByCustomer.has(cid)) oldestByCustomer.set(cid, days);
    }
  }
  return { buckets, oldestByCustomer };
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export async function dashboardData(key: PeriodKey) {
  const { current, previous, label } = periodRanges(key);
  const [catalog, allSales, balances, customers, ledger] = await Promise.all([
    loadCatalog(true),
    db.sales.where('date').between(previous.from, current.to, true, true).toArray(),
    allBalances(),
    db.customers.toArray(),
    db.ledger.toArray(),
  ]);
  const productMap = new Map(catalog.map((p) => [p.id, p]));
  const costOf = (id: number) => productMap.get(id)?.cost ?? 0;
  const valid = allSales.filter((s) => !s.voided);
  const cur = valid.filter((s) => s.date >= current.from && s.date <= current.to);
  const prev = valid.filter((s) => s.date >= previous.from && s.date <= previous.to);
  const a = aggregate(cur, costOf);
  const b = aggregate(prev, costOf);
  const margin = a.total > 0 ? ((a.total - a.cost) / a.total) * 100 : null;
  const prevMargin = b.total > 0 ? ((b.total - b.cost) / b.total) * 100 : null;

  // Serie diaria (o por hora si es "hoy")
  const series: { label: string; total: number; count: number }[] = [];
  if (key === 'hoy') {
    const hours = new Map<number, { total: number; count: number }>();
    for (const s of cur) {
      const h = new Date(s.date).getHours();
      const x = hours.get(h) ?? { total: 0, count: 0 };
      x.total += s.total;
      x.count++;
      hours.set(h, x);
    }
    const last = new Date().getHours();
    for (let h = Math.min(8, last); h <= Math.max(last, 20); h++)
      series.push({ label: `${h}:00`, ...(hours.get(h) ?? { total: 0, count: 0 }) });
  } else {
    const days = new Map<string, { total: number; count: number }>();
    for (const s of cur) {
      const k = toDateInput(s.date);
      const x = days.get(k) ?? { total: 0, count: 0 };
      x.total += s.total;
      x.count++;
      days.set(k, x);
    }
    const monthly = key === 'ano';
    if (monthly) {
      const months = new Map<string, { total: number; count: number }>();
      for (const [k, v] of days) {
        const m = k.slice(0, 7);
        const x = months.get(m) ?? { total: 0, count: 0 };
        x.total += v.total;
        x.count += v.count;
        months.set(m, x);
      }
      const y = new Date().getFullYear();
      for (let m = 0; m <= new Date().getMonth(); m++) {
        const k = `${y}-${String(m + 1).padStart(2, '0')}`;
        series.push({
          label: new Date(y, m, 1).toLocaleDateString('es-CO', { month: 'short' }),
          ...(months.get(k) ?? { total: 0, count: 0 }),
        });
      }
    } else {
      for (let t = current.from; t <= current.to; t += DAY) {
        const k = toDateInput(t);
        const dt = new Date(t);
        series.push({ label: `${dt.getDate()}/${dt.getMonth() + 1}`, ...(days.get(k) ?? { total: 0, count: 0 }) });
      }
    }
  }

  // Por categoría, producto y talla
  const byCat = new Map<string, number>();
  const byProduct = new Map<number, { name: string; reference: string; units: number; revenue: number }>();
  const bySize = new Map<string, number>();
  const weekday = WEEKDAYS.map((d) => ({ label: d, total: 0, count: 0 }));
  for (const s of cur) {
    const wd = (new Date(s.date).getDay() + 6) % 7;
    weekday[wd].total += s.total;
    weekday[wd].count++;
    for (const i of s.items) {
      const v = lineValue(s, i.qty, i.price);
      const cat = productMap.get(i.productId)?.category || 'Sin categoría';
      byCat.set(cat, (byCat.get(cat) ?? 0) + v);
      const p = byProduct.get(i.productId) ?? { name: i.name, reference: i.reference, units: 0, revenue: 0 };
      p.units += i.qty;
      p.revenue += v;
      byProduct.set(i.productId, p);
      bySize.set(i.size, (bySize.get(i.size) ?? 0) + i.qty);
    }
  }
  const catTotal = [...byCat.values()].reduce((x, y) => x + y, 0);
  const categories = [...byCat.entries()]
    .map(([name, total]) => ({ name, total, pct: catTotal ? (total / catTotal) * 100 : 0 }))
    .sort((x, y) => y.total - x.total);
  const unitsTotal = [...byProduct.values()].reduce((x, y) => x + y.units, 0);
  const top = [...byProduct.entries()]
    .map(([id, p]) => ({ id, ...p, pct: unitsTotal ? (p.units / unitsTotal) * 100 : 0 }))
    .sort((x, y) => y.units - x.units)
    .slice(0, 5);
  const sizes = [...bySize.entries()]
    .map(([size, units]) => ({ size, units }))
    .sort((x, y) => compareSizes(x.size, y.size));

  const active = catalog.filter((p) => p.active);
  const inv = inventorySummary(active);
  const low = active.filter((p) => stockStatus(p) !== 'disponible').sort((x, y) => x.totalStock - y.totalStock);

  const names = new Map(customers.map((c) => [c.id, c]));
  const debtors = [...balances.entries()]
    .filter(([, b]) => b > 0)
    .map(([id, balance]) => ({ id, balance, name: names.get(id)?.name ?? '—', phone: names.get(id)?.phone ?? '' }))
    .sort((x, y) => y.balance - x.balance);
  const { oldestByCustomer } = debtAging(ledger);

  return {
    compareLabel: label,
    kpi: {
      total: { value: a.total, change: pctChange(a.total, b.total) },
      count: { value: a.count, change: pctChange(a.count, b.count) },
      ticket: { value: a.count ? a.total / a.count : 0, change: pctChange(a.count ? a.total / a.count : 0, b.count ? b.total / b.count : 0) },
      units: { value: a.units, change: pctChange(a.units, b.units) },
      margin: { value: margin, diff: margin !== null && prevMargin !== null ? margin - prevMargin : null },
      cartera: { value: debtors.reduce((s, d) => s + d.balance, 0), debtors: debtors.length },
      inventory: { cost: inv.cost, value: inv.value, units: inv.units },
      stock: { low: inv.counts.poco, out: inv.counts.agotado, products: inv.products },
    },
    series,
    categories,
    top,
    sizes,
    payment: { contado: a.contado, credito: a.credito },
    inventory: inv,
    weekday,
    low: low.slice(0, 6),
    debtors: debtors.slice(0, 6).map((d) => ({ ...d, days: oldestByCustomer.get(d.id) ?? null })),
    hasSales: cur.length > 0,
  };
}

export type DashboardData = Awaited<ReturnType<typeof dashboardData>>;
