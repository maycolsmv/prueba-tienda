// Datos de demostración: ~20 productos, ~15 clientes y ~3 meses de ventas.
// Se registran los IDs creados para poder borrarlos sin tocar datos reales.
import { db, type Customer, type LedgerEntry, type Movement, type Product, type Sale, type SaleItem, type Variant } from './db';
import { getSettings, saveSettings } from './settings';
import { UserError } from './ops';

const DAY = 86_400_000;
const DEMO_KEY = 'demo';

export interface DemoInfo {
  loadedAt: number;
  prevNextSaleNumber: number;
  firstSaleNumber: number;
  lastSaleNumber: number;
  ids: Record<'products' | 'variants' | 'customers' | 'sales' | 'ledger' | 'movements', number[]>;
}

export async function getDemoInfo(): Promise<DemoInfo | null> {
  return ((await db.settings.get(DEMO_KEY))?.value as DemoInfo | undefined) ?? null;
}

/** Cuántos registros reales (no de demostración) hay. */
export async function realDataCounts() {
  const info = await getDemoInfo();
  const ids = (k: keyof DemoInfo['ids']) => new Set(info?.ids[k] ?? []);
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

const CUSTOMERS = [
  ['Laura Gómez', '3001234567'],
  ['Andrés Restrepo', '3109876543'],
  ['Carolina Pérez', '3157654321'],
  ['Juan David Rojas', '3204567890'],
  ['María Fernanda López', '3012345678'],
  ['Sebastián Torres', '3123456789'],
  ['Valentina Castro', '3165432198'],
  ['Daniela Morales', '3176543210'],
  ['Camilo Herrera', '3008765432'],
  ['Natalia Vargas', '3187654321'],
  ['Felipe Ramírez', '3198765432'],
  ['Paula Andrea Ruiz', '3112345678'],
  ['Santiago Jiménez', '3145678901'],
  ['Isabella Ortiz', '3056789012'],
  ['Alejandra Mejía', '3134567890'],
];

export async function loadDemoData() {
  if (await getDemoInfo()) throw new UserError('Los datos de demostración ya están cargados.');
  const settings = await getSettings();
  const r = rng(20261001);
  const pick = <T,>(arr: T[], w: (x: T) => number) => {
    const total = arr.reduce((s, x) => s + w(x), 0);
    let t = r() * total;
    for (const x of arr) if ((t -= w(x)) <= 0) return x;
    return arr[arr.length - 1];
  };
  const now = Date.now();
  const today = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const start = today - 100 * DAY;

  return db.transaction('rw', [db.products, db.variants, db.customers, db.sales, db.ledger, db.movements, db.settings], async () => {
    // Productos y tallas
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
          // Tallas centrales con más unidades
          stock: Math.max(1, Math.round(perSize * (0.6 + 0.5 * (SIZE_WEIGHT[size] ?? 1)))),
          p: i,
        }),
      ),
    );
    const variantIds = (await db.variants.bulkAdd(
      variantDefs.map(({ productId, size }) => ({ productId, size, stock: 0 })) as Variant[],
      { allKeys: true },
    )) as number[];
    const stock = new Map<number, number>();
    const movements: Omit<Movement, 'id'>[] = [];
    const move = (vi: number, qty: number, type: Movement['type'], note: string, date: number, refIndex: number | null = null) => {
      const id = variantIds[vi];
      const after = (stock.get(id) ?? 0) + qty;
      stock.set(id, after);
      movements.push({ date, productId: variantDefs[vi].productId, variantId: id, type, qty, stockAfter: after, note, refId: refIndex });
    };
    variantDefs.forEach((v, vi) => move(vi, v.stock, 'inicial', 'Existencia inicial (demo)', start - 2 * DAY));

    // Clientes
    const customerIds = (await db.customers.bulkAdd(
      CUSTOMERS.map(([name, phone], i) => ({
        name,
        phone,
        document: String(1_000_000_000 + Math.floor(r() * 99_999_999)),
        address: '',
        notes: 'Cliente de demostración',
        createdAt: start - (10 - (i % 10)) * DAY,
      })) as Customer[],
      { allKeys: true },
    )) as number[];
    // Algunos clientes pagan cumplido, otros se atrasan (para ver la antigüedad de la cartera)
    const payer = customerIds.map(() => (r() < 0.45 ? 'cumplido' : r() < 0.5 ? 'lento' : 'moroso'));

    // Ventas día a día
    const sales: Omit<Sale, 'id'>[] = [];
    const ledger: (Omit<LedgerEntry, 'id' | 'saleId'> & { saleIndex: number | null })[] = [];
    let number = settings.nextSaleNumber;
    const firstSaleNumber = number;
    for (let day = start; day < today + DAY; day += DAY) {
      const wd = new Date(day).getDay();
      // Más ventas viernes, sábado y quincenas
      const dom = new Date(day).getDate();
      const base = [1.4, 1.6, 1.7, 1.9, 2.6, 3.6, 2.2][wd] * (dom === 15 || dom === 30 || dom === 1 ? 1.5 : 1);
      const count = Math.max(0, Math.round(base + (r() - 0.5) * 3));

      // Reposición cada ~20 días de lo que está bajo. La última es hace ~3 semanas
      // y algunos productos no se reponen, para que se vean "poco stock" y "agotado".
      const dayIndex = Math.round((day - start) / DAY);
      if (dayIndex % 20 === 10 && dayIndex < 82) {
        variantDefs.forEach((v, vi) => {
          const cur = stock.get(variantIds[vi]) ?? 0;
          if (NO_RESTOCK.includes(PRODUCTS[v.p][0])) return;
          if (cur <= 2 && r() < 0.75) move(vi, Math.round(v.stock * (0.6 + r() * 0.6)), 'entrada', 'Pedido a proveedor (demo)', day + 9 * 3_600_000);
        });
      }

      // Horas del día en orden, para que la existencia de cada movimiento cuadre en el tiempo.
      const times = Array.from({ length: count }, () => day + (9 + Math.floor(r() * 11)) * 3_600_000 + (1 + Math.floor(r() * 58)) * 60_000).sort(
        (x, y) => x - y,
      );
      for (const date of times) {
        if (date > now) continue;
        const items: SaleItem[] = [];
        const nItems = r() < 0.6 ? 1 : r() < 0.75 ? 2 : 3;
        for (let n = 0; n < nItems; n++) {
          const pi = PRODUCTS.indexOf(pick(PRODUCTS, (p) => p[8]));
          const options = variantDefs.map((v, vi) => ({ v, vi })).filter((x) => x.v.p === pi && (stock.get(variantIds[x.vi]) ?? 0) > 0);
          if (!options.length) continue;
          const { v, vi } = pick(options, (x) => SIZE_WEIGHT[x.v.size] ?? 1);
          const vid = variantIds[vi];
          if (items.some((i) => i.variantId === vid)) continue;
          const qty = Math.min(stock.get(vid)!, r() < 0.85 ? 1 : 2);
          const [reference, name, , price] = PRODUCTS[pi];
          items.push({ productId: v.productId, variantId: vid, reference, name, size: v.size, qty, price });
        }
        if (!items.length) continue;
        const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
        const discount = r() < 0.12 ? Math.round((subtotal * (r() < 0.5 ? 0.05 : 0.1)) / 1000) * 1000 : 0;
        const total = subtotal - discount;
        const credit = r() < 0.28;
        const ci = credit || r() < 0.45 ? Math.floor(r() * customerIds.length) : -1;
        const paid = credit ? (r() < 0.5 ? Math.round((total * (0.2 + r() * 0.3)) / 1000) * 1000 : 0) : total;
        const saleIndex = sales.length;
        sales.push({
          number: number++,
          date,
          customerId: ci >= 0 ? customerIds[ci] : null,
          customerName: ci >= 0 ? CUSTOMERS[ci][0] : '',
          items,
          subtotal,
          discount,
          total,
          paymentType: credit ? 'credito' : 'contado',
          paid,
          notes: '',
          voided: false,
        });
        for (const i of items) move(variantIds.indexOf(i.variantId), -i.qty, 'venta', `Venta #${number - 1}`, date, saleIndex);
        // De vez en cuando una venta de contado se anula (para que el historial tenga de todo)
        if (!credit && r() < 0.012) {
          sales[saleIndex].voided = true;
          for (const i of items) move(variantIds.indexOf(i.variantId), i.qty, 'anulacion', `Anulación venta #${number - 1}`, date + 30_000, saleIndex);
          continue;
        }

        if (credit) {
          const cid = customerIds[ci];
          ledger.push({ customerId: cid, date, type: 'cargo', amount: total, saleIndex, note: `Venta a crédito #${number - 1}` });
          if (paid > 0) ledger.push({ customerId: cid, date, type: 'abono', amount: paid, saleIndex, note: `Abono inicial venta #${number - 1}` });
          // Abonos posteriores según el tipo de cliente
          let owed = total - paid;
          const style = payer[ci];
          const plan = style === 'cumplido' ? [12, 25] : style === 'lento' ? [45, 70] : [];
          for (const after of plan) {
            const when = date + after * DAY + Math.floor(r() * 5) * DAY;
            if (when > now || owed <= 0) break;
            const amount = after === plan[plan.length - 1] ? owed : Math.round((owed * 0.5) / 1000) * 1000;
            if (amount <= 0) continue;
            owed -= amount;
            ledger.push({ customerId: cid, date: when, type: 'abono', amount, saleIndex: null, note: r() < 0.5 ? 'Efectivo' : 'Nequi' });
          }
        }
      }
    }

    const saleIds = (await db.sales.bulkAdd(sales as Sale[], { allKeys: true })) as number[];
    const ledgerIds = (await db.ledger.bulkAdd(
      ledger.map(({ saleIndex, ...e }) => ({ ...e, saleId: saleIndex === null ? null : saleIds[saleIndex] })) as LedgerEntry[],
      { allKeys: true },
    )) as number[];
    const movementIds = (await db.movements.bulkAdd(
      movements.map((m) => ({ ...m, refId: m.refId === null ? null : (m.type === 'venta' || m.type === 'anulacion' ? saleIds[m.refId] : m.refId) })) as Movement[],
      { allKeys: true },
    )) as number[];
    await Promise.all(variantIds.map((id) => db.variants.update(id, { stock: stock.get(id) ?? 0 })));

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
      },
    };
    await db.settings.put({ key: DEMO_KEY, value: info });
    await saveSettings({ nextSaleNumber: number, demoLoadedAt: info.loadedAt });
    return { products: productIds.length, customers: customerIds.length, sales: saleIds.length };
  });
}

/**
 * Borra solo lo que creó la demostración. También quita los movimientos y la cartera
 * que se hayan registrado después sobre productos o clientes de demostración.
 */
export async function removeDemoData() {
  const info = await getDemoInfo();
  if (!info) throw new UserError('No hay datos de demostración cargados.');
  await db.transaction('rw', [db.products, db.variants, db.customers, db.sales, db.ledger, db.movements, db.settings], async () => {
    const products = new Set(info.ids.products);
    const customers = new Set(info.ids.customers);
    await db.movements.bulkDelete(info.ids.movements);
    await db.movements.filter((m) => products.has(m.productId)).delete();
    await db.ledger.bulkDelete(info.ids.ledger);
    await db.ledger.filter((e) => customers.has(e.customerId)).delete();
    await db.sales.bulkDelete(info.ids.sales);
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
