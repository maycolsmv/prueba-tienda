// Datos de demostración: ~20 productos, 15 clientes, ~3 meses de ventas y 4 viajes.
// Se registran los IDs creados para poder borrarlos sin tocar datos reales.
import {
  db,
  type Customer,
  type Expense,
  type LedgerEntry,
  type Movement,
  type Payment,
  type PaymentMethod,
  type Product,
  type Sale,
  type SaleItem,
  type Trip,
  type TripItem,
  type Variant,
} from './db';
import { getSettings, saveSettings } from './settings';
import { UserError } from './ops';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const DEMO_KEY = 'demo';

type IdKey = 'products' | 'variants' | 'customers' | 'sales' | 'ledger' | 'movements' | 'trips' | 'tripItems' | 'expenses';

export interface DemoInfo {
  loadedAt: number;
  prevNextSaleNumber: number;
  firstSaleNumber: number;
  lastSaleNumber: number;
  ids: Record<IdKey, number[]>;
}

export async function getDemoInfo(): Promise<DemoInfo | null> {
  return ((await db.settings.get(DEMO_KEY))?.value as DemoInfo | undefined) ?? null;
}

/** Cuántos registros reales (no de demostración) hay. */
export async function realDataCounts() {
  const info = await getDemoInfo();
  const ids = (k: IdKey) => new Set(info?.ids[k] ?? []);
  const [p, c, s] = await Promise.all([db.products.toArray(), db.customers.toArray(), db.sales.toArray()]);
  const dp = ids('products');
  const dc = ids('customers');
  const ds = ids('sales');
  return {
    products: p.filter((x) => !dp.has(x.id)).length,
    customers: c.filter((x) => !dc.has(x.id)).length,
    sales: s.filter((x) => !ds.has(x.id)).length,
  };
}

// Generador pseudoaleatorio con semilla: los datos salen igual cada vez.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOPS = ['XS', 'S', 'M', 'L', 'XL'];
const PANTS = ['28', '30', '32', '34', '36'];
const SIZE_WEIGHT: Record<string, number> = { XS: 0.5, S: 1.2, M: 2, L: 1.6, XL: 0.8, '28': 0.6, '30': 1.4, '32': 1.8, '34': 1.2, '36': 0.6, U: 1 };

// [ref, nombre, categoría, precio, costo, tallas, stock inicial por talla, mínimo, popularidad]
const PRODUCTS: [string, string, string, number, number, string[], number, number, number][] = [
  ['DEMO-CAM01', 'Camiseta básica algodón', 'Camisetas', 35000, 16000, TOPS, 14, 15, 10],
  ['DEMO-CAM02', 'Camiseta estampada', 'Camisetas', 42000, 19000, TOPS, 10, 10, 8],
  ['DEMO-CAM03', 'Camiseta oversize', 'Camisetas', 48000, 22000, TOPS, 6, 8, 6],
  ['DEMO-POL01', 'Polo piqué', 'Camisetas', 59000, 28000, TOPS, 6, 6, 4],
  ['DEMO-CMS01', 'Camisa manga larga', 'Camisas', 79000, 38000, TOPS, 5, 6, 4],
  ['DEMO-CMS02', 'Camisa de lino', 'Camisas', 89000, 45000, TOPS, 2, 6, 3],
  ['DEMO-BLU01', 'Blusa de tiras', 'Blusas', 45000, 20000, TOPS, 8, 8, 7],
  ['DEMO-BLU02', 'Blusa manga bombacha', 'Blusas', 62000, 29000, TOPS, 5, 18, 4],
  ['DEMO-JEA01', 'Jean slim fit', 'Pantalones', 98000, 48000, PANTS, 8, 10, 8],
  ['DEMO-JEA02', 'Jean clásico', 'Pantalones', 89000, 44000, PANTS, 6, 8, 6],
  ['DEMO-PAN01', 'Pantalón drill', 'Pantalones', 85000, 41000, PANTS, 4, 14, 3],
  ['DEMO-SHO01', 'Short de jean', 'Shorts y faldas', 55000, 25000, PANTS, 5, 6, 5],
  ['DEMO-FAL01', 'Falda plisada', 'Shorts y faldas', 58000, 26000, TOPS, 4, 4, 3],
  ['DEMO-VES01', 'Vestido casual', 'Vestidos', 95000, 45000, TOPS, 4, 5, 5],
  ['DEMO-VES02', 'Vestido de fiesta', 'Vestidos', 165000, 80000, TOPS, 1, 3, 4],
  ['DEMO-CHA01', 'Chaqueta de jean', 'Chaquetas', 139000, 70000, TOPS, 1, 4, 4],
  ['DEMO-BUZ01', 'Buzo con capota', 'Buzos', 99000, 47000, TOPS, 5, 6, 4],
  ['DEMO-LEG01', 'Leggings deportivos', 'Deportivo', 52000, 23000, TOPS, 8, 8, 6],
  ['DEMO-PIJ01', 'Pijama de algodón', 'Pijamas', 68000, 31000, TOPS, 2, 6, 3],
  ['DEMO-ACC01', 'Gorra bordada', 'Accesorios', 32000, 13000, ['U'], 25, 8, 4],
  ['DEMO-ACC02', 'Correa de cuero', 'Accesorios', 45000, 19000, ['U'], 12, 5, 1],
];

// Productos que no se reponen en la demostración (terminan agotados o con poco stock).
const NO_RESTOCK = ['DEMO-VES02', 'DEMO-CHA01', 'DEMO-PIJ01', 'DEMO-CMS02'];

// [nombre, celular, ciudad]
const CUSTOMERS: [string, string, string][] = [
  ['Laura Gómez', '3001234567', 'Medellín'],
  ['Andrés Restrepo', '3109876543', 'Medellín'],
  ['Carolina Pérez', '3157654321', 'Medellín'],
  ['Juan David Rojas', '3204567890', 'Medellín'],
  ['María Fernanda López', '3012345678', 'Medellín'],
  ['Sebastián Torres', '3123456789', 'Cali'],
  ['Valentina Castro', '3165432198', 'Cali'],
  ['Daniela Morales', '3176543210', 'Cali'],
  ['Camilo Herrera', '3008765432', 'Cali'],
  ['Natalia Vargas', '3187654321', 'Bucaramanga'],
  ['Felipe Ramírez', '3198765432', 'Bucaramanga'],
  ['Paula Andrea Ruiz', '3112345678', 'Bucaramanga'],
  ['Santiago Jiménez', '3145678901', 'Local'],
  ['Isabella Ortiz', '3056789012', 'Local'],
  ['Alejandra Mejía', '3134567890', 'Local'],
];

// Viajes: [destino, día de salida (desde el inicio), días de duración, notas]. El último queda abierto.
export type DemoTrip = [destino: string, diaSalida: number, dias: number, notas: string];

const DEFAULT_TRIPS: DemoTrip[] = [
  ['Medellín', 8, 6, 'Feria de El Poblado y ventas a domicilio'],
  ['Cali', 33, 5, 'Hotel en Granada'],
  ['Medellín', 60, 6, 'Segunda visita: llevar más jeans'],
  ['Bucaramanga', 97, 6, 'Primera vez en la ciudad'],
];

const METHODS: [PaymentMethod, number][] = [
  ['efectivo', 0.45],
  ['nequi', 0.32],
  ['transferencia', 0.18],
  ['otro', 0.05],
];

export interface DemoOptions {
  trips?: DemoTrip[];
  /** Días de historia hacia atrás desde hoy. */
  days?: number;
  /** Si el último viaje queda en curso. */
  lastOpen?: boolean;
  seed?: number;
  /** false = no marcar como demostración (para generar respaldos de prueba). */
  markAsDemo?: boolean;
}

export async function loadDemoData(opts: DemoOptions = {}) {
  const TRIPS = opts.trips ?? DEFAULT_TRIPS;
  const lastOpen = opts.lastOpen ?? true;
  const markAsDemo = opts.markAsDemo ?? true;
  if (markAsDemo && (await getDemoInfo())) throw new UserError('Los datos de demostración ya están cargados.');
  if (lastOpen && (await db.trips.where('status').equals('abierto').count()))
    throw new UserError('Tienes un viaje abierto. Ciérralo antes de cargar la demostración (la demo incluye un viaje en curso).');
  const settings = await getSettings();
  const r = rng(opts.seed ?? 20261001);
  const pick = <T,>(arr: T[], w: (x: T) => number) => {
    const total = arr.reduce((s, x) => s + w(x), 0);
    let t = r() * total;
    for (const x of arr) if ((t -= w(x)) <= 0) return x;
    return arr[arr.length - 1];
  };
  const method = () => pick(METHODS, (m) => m[1])[0];
  const now = Date.now();
  const today = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const DAYS = opts.days ?? 100;
  const start = today - DAYS * DAY;
  const dayAt = (i: number) => start + i * DAY;

  const tables = [db.products, db.variants, db.customers, db.sales, db.ledger, db.movements, db.settings, db.trips, db.tripItems, db.expenses];
  return db.transaction('rw', tables, async () => {
    // ---------- Productos y tallas ----------
    const productIds = (await db.products.bulkAdd(
      PRODUCTS.map(([reference, name, category, price, cost, , , minStock]) => ({
        reference,
        name,
        category,
        price,
        cost,
        minStock,
        active: true,
        createdAt: start - 3 * DAY,
      })) as Product[],
      { allKeys: true },
    )) as number[];
    const variantDefs: { productId: number; size: string; stock: number; p: number }[] = [];
    PRODUCTS.forEach(([, , , , , sizes, perSize], i) =>
      sizes.forEach((size) =>
        variantDefs.push({
          productId: productIds[i],
          size,
          stock: Math.max(1, Math.round(perSize * (0.6 + 0.5 * (SIZE_WEIGHT[size] ?? 1)))),
          p: i,
        }),
      ),
    );
    const variantIds = (await db.variants.bulkAdd(
      variantDefs.map(({ productId, size }) => ({ productId, size, stock: 0 })) as Variant[],
      { allKeys: true },
    )) as number[];
    const vIndex = new Map(variantIds.map((id, i) => [id, i]));

    // ---------- Viajes ----------
    const tripRows = TRIPS.map(([destination, d, len, notes], i) => {
      const isLast = lastOpen && i === TRIPS.length - 1;
      return {
        destination,
        startDate: dayAt(d),
        endDate: dayAt(d + len - 1),
        notes,
        status: isLast ? 'abierto' : 'cerrado',
        createdAt: dayAt(d - 2),
        closedAt: isLast ? null : dayAt(d + len - 1) + 21 * HOUR,
      } as Trip;
    });
    const tripIds = (await db.trips.bulkAdd(tripRows, { allKeys: true })) as number[];

    // ---------- Simulación ----------
    const bodega = new Map<number, number>();
    const tripStock = new Map<string, number>(); // `${tripIndex}|${variantId}`
    const tripItems = new Map<string, Omit<TripItem, 'id'>>();
    const movements: Omit<Movement, 'id'>[] = [];
    const moveBodega = (vi: number, qty: number, type: Movement['type'], note: string, date: number, ref: number | null = null) => {
      const id = variantIds[vi];
      const after = (bodega.get(id) ?? 0) + qty;
      bodega.set(id, after);
      movements.push({ date, productId: variantDefs[vi].productId, variantId: id, type, qty, stockAfter: after, note, refId: ref, tripId: null });
    };
    const moveTrip = (ti: number, vi: number, qty: number, type: Movement['type'], note: string, date: number, ref: number | null) => {
      const id = variantIds[vi];
      const key = `${ti}|${id}`;
      const after = (tripStock.get(key) ?? 0) + qty;
      tripStock.set(key, after);
      tripItems.get(key)!.onHand = after;
      movements.push({ date, productId: variantDefs[vi].productId, variantId: id, type, qty, stockAfter: after, note, refId: ref, tripId: -1 - ti });
    };
    variantDefs.forEach((v, vi) => moveBodega(vi, v.stock, 'inicial', 'Existencia inicial (demo)', start - 2 * DAY));

    // ---------- Clientes ----------
    const customerIds = (await db.customers.bulkAdd(
      CUSTOMERS.map(([name, phone, city], i) => ({
        name,
        phone,
        document: String(1_000_000_000 + Math.floor(r() * 99_999_999)),
        address: city === 'Local' ? '' : city,
        notes: `Cliente de demostración${city === 'Local' ? '' : ` · ${city}`}`,
        createdAt: start - (10 - (i % 10)) * DAY,
      })) as Customer[],
      { allKeys: true },
    )) as number[];
    const payer = customerIds.map(() => (r() < 0.45 ? 'cumplido' : r() < 0.5 ? 'lento' : 'moroso'));
    const customersIn = (city: string) => CUSTOMERS.map((c, i) => (c[2] === city ? i : -1)).filter((i) => i >= 0);

    const sales: Omit<Sale, 'id'>[] = [];
    const saleTrip: (number | null)[] = [];
    const ledger: (Omit<LedgerEntry, 'id' | 'saleId' | 'tripId'> & { saleIndex: number | null; tripIndex: number | null })[] = [];
    let number = settings.nextSaleNumber;
    const firstSaleNumber = number;

    const tripOn = (day: number) => TRIPS.findIndex(([, d, len]) => day >= d && day < d + len);
    const tripAtDate = (t: number) => tripOn(Math.floor((t - start) / DAY));

    for (let day = 0; day <= DAYS; day++) {
      const dayStart = dayAt(day);
      const ti = tripOn(day);
      const trip = ti >= 0 ? TRIPS[ti] : null;

      // Reposición de bodega unos días antes de cada viaje (menos el primero)
      if (TRIPS.slice(1).some(([, d]) => day === d - 3))
        variantDefs.forEach((v, vi) => {
          if (NO_RESTOCK.includes(PRODUCTS[v.p][0])) return;
          const cur = bodega.get(variantIds[vi]) ?? 0;
          if (cur <= 3 && r() < 0.85) moveBodega(vi, Math.round(v.stock * (0.7 + r() * 0.6)), 'entrada', 'Pedido a proveedor (demo)', dayStart + 9 * HOUR);
        });

      // Salida del viaje: cargar mercancía (más de lo que más se vende)
      if (trip && day === trip[1]) {
        variantDefs.forEach((v, vi) => {
          const id = variantIds[vi];
          const have = bodega.get(id) ?? 0;
          const pop = PRODUCTS[v.p][8];
          const qty = Math.min(have, Math.max(pop >= 4 && have >= 2 ? 1 : 0, Math.round(have * (0.12 + pop * 0.016))));
          if (qty <= 0) return;
          tripItems.set(`${ti}|${id}`, { tripId: -1 - ti, productId: v.productId, variantId: id, loaded: qty, onHand: 0, returned: 0 });
          moveBodega(vi, -qty, 'carga_viaje', `Carga para viaje a ${trip[0]}`, dayStart + 6 * HOUR, -1 - ti);
          moveTrip(ti, vi, qty, 'carga_viaje', `Carga para viaje a ${trip[0]}`, dayStart + 6 * HOUR, null);
        });
        // El movimiento del lado del viaje solo sirve para la simulación; el historial real registra la salida de bodega.
        for (let k = movements.length - 1; k >= 0; k--) if (movements[k].tripId === -1 - ti && movements[k].type === 'carga_viaje') movements.splice(k, 1);
      }

      // Ventas del día: muchas en viaje, pocas en casa
      const wd = new Date(dayStart).getDay();
      const base = trip ? 7 + r() * 4 : [0.4, 0.5, 0.5, 0.6, 0.9, 1.3, 0.8][wd];
      const count = Math.max(0, Math.round(base + (r() - 0.5) * 2));
      const times = Array.from({ length: count }, () => dayStart + (9 + Math.floor(r() * 11)) * HOUR + (1 + Math.floor(r() * 58)) * 60_000).sort(
        (a, b) => a - b,
      );
      for (const date of times) {
        if (date > now) continue;
        const avail = (vi: number) => (trip ? (tripStock.get(`${ti}|${variantIds[vi]}`) ?? 0) : (bodega.get(variantIds[vi]) ?? 0));
        const items: SaleItem[] = [];
        const nItems = r() < 0.55 ? 1 : r() < 0.75 ? 2 : 3;
        for (let n = 0; n < nItems; n++) {
          const pi = PRODUCTS.indexOf(pick(PRODUCTS, (p) => p[8]));
          const options = variantDefs.map((v, vi) => ({ v, vi })).filter((x) => x.v.p === pi && avail(x.vi) > 0);
          if (!options.length) continue;
          const { v, vi } = pick(options, (x) => SIZE_WEIGHT[x.v.size] ?? 1);
          const vid = variantIds[vi];
          if (items.some((i) => i.variantId === vid)) continue;
          const qty = Math.min(avail(vi), r() < 0.85 ? 1 : 2);
          const [reference, name, , price] = PRODUCTS[pi];
          items.push({ productId: v.productId, variantId: vid, reference, name, size: v.size, qty, price });
        }
        if (!items.length) continue;
        const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
        const discount = r() < 0.12 ? Math.round((subtotal * (r() < 0.5 ? 0.05 : 0.1)) / 1000) * 1000 : 0;
        const total = subtotal - discount;
        const credit = r() < (trip ? 0.3 : 0.2);
        const pool = customersIn(trip ? trip[0] : 'Local');
        const ci = credit || r() < 0.4 ? pool[Math.floor(r() * pool.length)] : -1;

        let payments: Payment[];
        if (credit) {
          const initial = r() < 0.5 ? Math.round((total * (0.2 + r() * 0.3)) / 1000) * 1000 : 0;
          payments = initial ? [{ method: method(), amount: initial }] : [];
        } else if (r() < 0.12) {
          const part = Math.round((total * (0.3 + r() * 0.4)) / 1000) * 1000;
          payments = [
            { method: 'efectivo', amount: part },
            { method: 'nequi', amount: total - part },
          ];
        } else payments = [{ method: method(), amount: total }];
        const paid = payments.reduce((a, p) => a + p.amount, 0);

        const saleIndex = sales.length;
        const num = number++;
        sales.push({
          number: num,
          date,
          customerId: ci >= 0 ? customerIds[ci] : null,
          customerName: ci >= 0 ? CUSTOMERS[ci][0] : '',
          items,
          subtotal,
          discount,
          total,
          paymentType: credit ? 'credito' : 'contado',
          paid,
          payments,
          tripId: null,
          notes: '',
          voided: false,
        });
        saleTrip.push(trip ? ti : null);
        const label = trip ? `Venta #${num} (${trip[0]})` : `Venta #${num}`;
        for (const i of items) {
          const vi = vIndex.get(i.variantId)!;
          if (trip) moveTrip(ti, vi, -i.qty, 'venta', label, date, saleIndex);
          else moveBodega(vi, -i.qty, 'venta', label, date, saleIndex);
        }
        // De vez en cuando una venta de contado se anula
        if (!credit && r() < 0.012) {
          sales[saleIndex].voided = true;
          for (const i of items) {
            const vi = vIndex.get(i.variantId)!;
            if (trip) moveTrip(ti, vi, i.qty, 'anulacion', `Anulación venta #${num}`, date + 30_000, saleIndex);
            else moveBodega(vi, i.qty, 'anulacion', `Anulación venta #${num}`, date + 30_000, saleIndex);
          }
          continue;
        }

        if (credit) {
          const cid = customerIds[ci];
          ledger.push({ customerId: cid, date, type: 'cargo', amount: total, saleIndex, tripIndex: trip ? ti : null, note: `Venta a crédito #${num}`, method: null });
          for (const p of payments)
            ledger.push({ customerId: cid, date, type: 'abono', amount: p.amount, saleIndex, tripIndex: trip ? ti : null, note: `Abono inicial venta #${num}`, method: p.method });
          // Abonos posteriores según el tipo de cliente (los de otras ciudades pagan por Nequi o transferencia)
          let owed = total - paid;
          const style = payer[ci];
          const plan = style === 'cumplido' ? [12, 25] : style === 'lento' ? [45, 70] : [];
          for (const after of plan) {
            const when = date + after * DAY + Math.floor(r() * 5) * DAY;
            if (when > now || owed <= 0) break;
            const amount = after === plan[plan.length - 1] ? owed : Math.round((owed * 0.5) / 1000) * 1000;
            if (amount <= 0) continue;
            owed -= amount;
            const at = tripAtDate(when);
            const m: PaymentMethod = at >= 0 && TRIPS[at][0] === CUSTOMERS[ci][2] ? 'efectivo' : r() < 0.65 ? 'nequi' : 'transferencia';
            ledger.push({ customerId: cid, date: when, type: 'abono', amount, saleIndex: null, tripIndex: at >= 0 ? at : null, note: '', method: m });
          }
        }
      }

      // Regreso: lo que no se vendió vuelve a bodega (el último viaje sigue abierto)
      if (trip && (ti < TRIPS.length - 1 || !lastOpen) && day === trip[1] + trip[2] - 1) {
        const closeAt = dayStart + 21 * HOUR;
        variantDefs.forEach((_, vi) => {
          const key = `${ti}|${variantIds[vi]}`;
          const left = tripStock.get(key) ?? 0;
          if (left <= 0) return;
          tripStock.set(key, 0);
          const it = tripItems.get(key)!;
          it.onHand = 0;
          it.returned += left;
          moveBodega(vi, left, 'regreso_viaje', `Regreso del viaje a ${trip[0]}`, closeAt, -1 - ti);
        });
      }
    }

    // ---------- Gastos ----------
    const round = (n: number) => Math.round(n / 1000) * 1000;
    const expenses: (Omit<Expense, 'id' | 'tripId'> & { tripIndex: number | null })[] = [];
    const spend = (date: number, category: Expense['category'], amount: number, m: PaymentMethod, tripIndex: number | null, note: string) => {
      if (date <= now) expenses.push({ date, category, amount: round(amount), method: m, tripIndex, note, createdAt: date });
    };
    TRIPS.forEach(([destination, d, len], ti) => {
      const out = dayAt(d) + 5 * HOUR;
      const back = dayAt(d + len - 1) + 18 * HOUR;
      const fare = 70000 + r() * 70000;
      spend(dayAt(d - 1) + 19 * HOUR, 'empaques', 35000 + r() * 30000, 'efectivo', ti, 'Bolsas y papel de seda');
      spend(out, 'pasajes', fare, r() < 0.6 ? 'transferencia' : 'efectivo', ti, `Bus a ${destination}`);
      spend(dayAt(d) + 15 * HOUR, 'hospedaje', (len - 1) * (65000 + r() * 45000), r() < 0.5 ? 'transferencia' : 'nequi', ti, `Hotel ${len - 1} noches`);
      for (let k = 0; k < len; k++) spend(dayAt(d + k) + 13 * HOUR, 'comida', 22000 + r() * 25000, r() < 0.8 ? 'efectivo' : 'nequi', ti, 'Almuerzo y comida');
      if (r() < 0.7) spend(dayAt(d + Math.floor(len / 2)) + 17 * HOUR, 'envios', 15000 + r() * 15000, 'efectivo', ti, 'Envío a clienta');
      spend(back, 'pasajes', fare, r() < 0.6 ? 'transferencia' : 'efectivo', ti, 'Bus de regreso');
    });
    // Gastos generales: envíos y empaques cada cierto tiempo
    for (let day = 5; day <= DAYS; day += 9 + Math.floor(r() * 6)) {
      if (tripOn(day) >= 0) continue;
      spend(dayAt(day) + 16 * HOUR, r() < 0.6 ? 'envios' : 'empaques', 14000 + r() * 22000, r() < 0.5 ? 'efectivo' : 'nequi', null, r() < 0.6 ? 'Envío por transportadora' : 'Bolsas');
    }

    // ---------- Guardar ----------
    const mapTrip = (t: number | null | undefined) => (t === null || t === undefined ? null : tripIds[t]);
    const saleIds = (await db.sales.bulkAdd(
      sales.map((s, i) => ({ ...s, tripId: mapTrip(saleTrip[i]) })) as Sale[],
      { allKeys: true },
    )) as number[];
    const ledgerIds = (await db.ledger.bulkAdd(
      ledger.map(({ saleIndex, tripIndex, ...e }) => ({ ...e, saleId: saleIndex === null ? null : saleIds[saleIndex], tripId: mapTrip(tripIndex) })) as LedgerEntry[],
      { allKeys: true },
    )) as number[];
    // tripId y refId negativos son índices temporales de viaje; refId de venta es el índice de la venta.
    const movementIds = (await db.movements.bulkAdd(
      movements.map((m) => {
        const tripId = m.tripId !== null && m.tripId !== undefined && m.tripId < 0 ? tripIds[-1 - m.tripId] : null;
        let refId = m.refId;
        if (refId !== null && refId < 0) refId = tripIds[-1 - refId];
        else if (refId !== null && (m.type === 'venta' || m.type === 'anulacion')) refId = saleIds[refId];
        return { ...m, tripId, refId };
      }) as Movement[],
      { allKeys: true },
    )) as number[];
    const tripItemIds = (await db.tripItems.bulkAdd(
      [...tripItems.values()].map((it) => ({ ...it, tripId: tripIds[-1 - it.tripId] })) as TripItem[],
      { allKeys: true },
    )) as number[];
    await Promise.all(variantIds.map((id) => db.variants.update(id, { stock: bodega.get(id) ?? 0 })));
    const expenseIds = (await db.expenses.bulkAdd(
      expenses.map(({ tripIndex, ...e }) => ({ ...e, tripId: mapTrip(tripIndex) })) as Expense[],
      { allKeys: true },
    )) as number[];

    const info: DemoInfo = {
      loadedAt: Date.now(),
      prevNextSaleNumber: settings.nextSaleNumber,
      firstSaleNumber,
      lastSaleNumber: number - 1,
      ids: {
        products: productIds,
        variants: variantIds,
        customers: customerIds,
        sales: saleIds,
        ledger: ledgerIds,
        movements: movementIds,
        trips: tripIds,
        tripItems: tripItemIds,
        expenses: expenseIds,
      },
    };
    if (markAsDemo) {
      await db.settings.put({ key: DEMO_KEY, value: info });
      await saveSettings({ nextSaleNumber: number, demoLoadedAt: info.loadedAt });
    } else await saveSettings({ nextSaleNumber: number });
    return { products: productIds.length, customers: customerIds.length, sales: saleIds.length, trips: tripIds.length };
  });
}

/**
 * Borra solo lo que creó la demostración. También quita los movimientos y la cartera
 * que se hayan registrado después sobre productos, clientes o viajes de demostración.
 */
export async function removeDemoData() {
  const info = await getDemoInfo();
  if (!info) throw new UserError('No hay datos de demostración cargados.');
  const tables = [db.products, db.variants, db.customers, db.sales, db.ledger, db.movements, db.settings, db.trips, db.tripItems, db.expenses];
  await db.transaction('rw', tables, async () => {
    const products = new Set(info.ids.products);
    const customers = new Set(info.ids.customers);
    const trips = new Set(info.ids.trips ?? []);
    await db.movements.bulkDelete(info.ids.movements);
    await db.movements.filter((m) => products.has(m.productId)).delete();
    await db.ledger.bulkDelete(info.ids.ledger);
    await db.ledger.filter((e) => customers.has(e.customerId)).delete();
    await db.sales.bulkDelete(info.ids.sales);
    // Ventas reales hechas dentro de un viaje de demostración quedan como ventas sin viaje.
    await db.sales.filter((s) => s.tripId !== null && trips.has(s.tripId)).modify({ tripId: null });
    await db.tripItems.filter((i) => trips.has(i.tripId)).delete();
    await db.expenses.bulkDelete(info.ids.expenses ?? []);
    await db.expenses.filter((e) => e.tripId !== null && trips.has(e.tripId)).delete();
    await db.trips.bulkDelete([...trips]);
    await db.variants.bulkDelete(info.ids.variants);
    await db.products.bulkDelete(info.ids.products);
    await db.customers.bulkDelete(info.ids.customers);
    // Si después no se hicieron ventas reales, la numeración vuelve a donde estaba.
    const later = await db.sales.where('number').above(info.lastSaleNumber).count();
    const settings = await getSettings();
    if (!later && settings.nextSaleNumber === info.lastSaleNumber + 1) await saveSettings({ nextSaleNumber: info.prevNextSaleNumber });
    await db.settings.delete(DEMO_KEY);
    await saveSettings({ demoLoadedAt: null });
  });
}
