import {
  db,
  type CountLine,
  type Customer,
  type Expense,
  type ExpenseCategory,
  type MovementType,
  type Payment,
  type PaymentMethod,
  type PaymentType,
  type Product,
  type Sale,
  type SaleAdjustment,
  type SaleItem,
  type Settlement,
  type Trip,
  type Variant,
} from './db';
import { getSettings, saveSettings } from './settings';
import { canonicalDestination, compareSizes, destinationKey, formatDestination } from './format';

export class UserError extends Error {}

async function moveStock(
  variantId: number,
  delta: number,
  type: MovementType,
  note: string,
  refId: number | null = null,
  date = Date.now(),
) {
  const v = await db.variants.get(variantId);
  if (!v) throw new UserError('La talla ya no existe.');
  const stockAfter = v.stock + delta;
  await db.variants.update(variantId, { stock: stockAfter });
  await db.movements.add({
    date,
    productId: v.productId,
    variantId,
    type,
    qty: delta,
    stockAfter,
    note,
    refId,
  } as never);
  return stockAfter;
}

/** Mueve unidades de la mercancía que va en un viaje (no toca bodega). */
async function moveTripStock(
  tripId: number,
  variantId: number,
  delta: number,
  type: MovementType,
  note: string,
  refId: number | null = null,
  date = Date.now(),
) {
  const item = await db.tripItems.where({ tripId, variantId }).first();
  if (!item) throw new UserError('Esa talla no va en el viaje.');
  const onHand = item.onHand + delta;
  if (onHand < 0) throw new UserError('No hay suficientes unidades en el viaje.');
  await db.tripItems.update(item.id, { onHand });
  await db.movements.add({
    date,
    productId: item.productId,
    variantId,
    type,
    qty: delta,
    stockAfter: onHand,
    note,
    refId,
    tripId,
  } as never);
  return onHand;
}

// ---------- Productos ----------

export interface VariantDraft {
  id?: number;
  size: string;
  /** Solo se usa como existencia inicial al crear la talla. */
  stock: number;
}

export type ProductDraft = Omit<Product, 'id' | 'createdAt' | 'active'> & { id?: number; active?: boolean };

export async function saveProduct(draft: ProductDraft, variants: VariantDraft[]) {
  const reference = draft.reference.trim();
  const name = draft.name.trim();
  if (!name) throw new UserError('El nombre es obligatorio.');
  if (!reference) throw new UserError('La referencia es obligatoria.');
  const sizes = variants.map((v) => v.size.trim().toUpperCase()).filter(Boolean);
  if (!sizes.length) throw new UserError('Agrega al menos una talla.');
  if (new Set(sizes).size !== sizes.length) throw new UserError('Hay tallas repetidas.');

  return db.transaction('rw', db.products, db.variants, db.movements, async () => {
    const dup = await db.products.where('reference').equalsIgnoreCase(reference).first();
    if (dup && dup.id !== draft.id) throw new UserError(`Ya existe un producto con la referencia ${reference}.`);

    const data = {
      reference,
      name,
      category: draft.category.trim(),
      price: Math.max(0, draft.price || 0),
      cost: Math.max(0, draft.cost || 0),
      minStock: Math.max(0, draft.minStock || 0),
      active: draft.active ?? true,
    };
    let productId: number;
    if (draft.id) {
      productId = draft.id;
      await db.products.update(productId, data);
    } else {
      productId = (await db.products.add({ ...data, createdAt: Date.now() } as Product)) as number;
    }

    const existing = await db.variants.where('productId').equals(productId).toArray();
    const keepIds = new Set(variants.filter((v) => v.id).map((v) => v.id));
    for (const old of existing) {
      if (!keepIds.has(old.id)) {
        if (old.stock !== 0)
          throw new UserError(`No se puede quitar la talla ${old.size}: tiene ${old.stock} unidades. Ajusta a 0 primero.`);
        await db.variants.delete(old.id);
      }
    }
    for (const v of variants) {
      const size = v.size.trim().toUpperCase();
      if (!size) continue;
      if (v.id) {
        await db.variants.update(v.id, { size });
      } else {
        const id = (await db.variants.add({ productId, size, stock: 0 } as Variant)) as number;
        if (v.stock) await moveStock(id, v.stock, 'inicial', 'Existencia inicial');
      }
    }
    return productId;
  });
}

export async function deleteProduct(productId: number) {
  const hasSales = await db.movements.where('productId').equals(productId).filter((m) => m.type === 'venta').count();
  if (hasSales) {
    // Con ventas: se desactiva para conservar el historial.
    await db.products.update(productId, { active: false });
    return 'desactivado' as const;
  }
  await db.transaction('rw', db.products, db.variants, db.movements, async () => {
    await db.variants.where('productId').equals(productId).delete();
    await db.movements.where('productId').equals(productId).delete();
    await db.products.delete(productId);
  });
  return 'eliminado' as const;
}

export interface VariantWithTrip extends Variant {
  /** Unidades de esta talla que van en el viaje abierto. */
  inTrip: number;
}

export interface ProductWithVariants extends Product {
  variants: VariantWithTrip[];
  /** Unidades en bodega. */
  totalStock: number;
  /** Unidades que van en el viaje abierto. */
  totalInTrip: number;
}

export async function loadCatalog(includeInactive = false): Promise<ProductWithVariants[]> {
  const trip = await getActiveTrip();
  const [products, variants, items] = await Promise.all([
    db.products.toArray(),
    db.variants.toArray(),
    trip ? db.tripItems.where('tripId').equals(trip.id).toArray() : Promise.resolve([]),
  ]);
  const inTrip = new Map(items.map((i) => [i.variantId, i.onHand]));
  const byProduct = new Map<number, VariantWithTrip[]>();
  for (const v of variants) {
    const list = byProduct.get(v.productId) ?? [];
    list.push({ ...v, inTrip: inTrip.get(v.id) ?? 0 });
    byProduct.set(v.productId, list);
  }
  return products
    .filter((p) => includeInactive || p.active)
    .map((p) => {
      const vs = (byProduct.get(p.id) ?? []).sort((a, b) => compareSizes(a.size, b.size));
      return {
        ...p,
        variants: vs,
        totalStock: vs.reduce((s, v) => s + v.stock, 0),
        totalInTrip: vs.reduce((s, v) => s + v.inTrip, 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Poco stock según todo lo que se tiene (bodega + lo que va en el viaje). */
export const isLowStock = (p: ProductWithVariants) => p.minStock > 0 && p.totalStock + p.totalInTrip <= p.minStock;

// ---------- Inventario ----------

export async function registerEntry(lines: { variantId: number; qty: number }[], note: string) {
  const valid = lines.filter((l) => l.qty > 0);
  if (!valid.length) throw new UserError('Agrega al menos una línea con cantidad.');
  await db.transaction('rw', db.variants, db.movements, async () => {
    const date = Date.now();
    for (const l of valid) await moveStock(l.variantId, l.qty, 'entrada', note || 'Entrada de mercancía', null, date);
  });
}

export async function adjustStock(variantId: number, newStock: number, note: string) {
  if (!note.trim()) throw new UserError('Indica el motivo del ajuste.');
  await db.transaction('rw', db.variants, db.movements, async () => {
    const v = await db.variants.get(variantId);
    if (!v) throw new UserError('La talla ya no existe.');
    const delta = newStock - v.stock;
    if (delta !== 0) await moveStock(variantId, delta, 'ajuste', note.trim());
  });
}

export async function createCount(category: string) {
  const catalog = await loadCatalog();
  const lines: CountLine[] = [];
  for (const p of catalog) {
    if (category && p.category !== category) continue;
    for (const v of p.variants)
      lines.push({
        productId: p.id,
        variantId: v.id,
        reference: p.reference,
        name: p.name,
        size: v.size,
        system: v.stock,
        counted: null,
      });
  }
  if (!lines.length) throw new UserError('No hay productos para contar.');
  return db.counts.add({ date: Date.now(), status: 'abierto', category, lines, appliedAt: null } as never) as Promise<number>;
}

/** Aplica el conteo: deja la existencia igual a lo contado. Líneas sin contar se ignoran. */
export async function applyCount(countId: number) {
  await db.transaction('rw', db.counts, db.variants, db.movements, async () => {
    const c = await db.counts.get(countId);
    if (!c || c.status !== 'abierto') throw new UserError('El conteo no está abierto.');
    const date = Date.now();
    for (const l of c.lines) {
      if (l.counted === null) continue;
      const v = await db.variants.get(l.variantId);
      if (!v) continue;
      // La diferencia se calcula contra la foto tomada al iniciar el conteo,
      // así las ventas hechas mientras se contaba no se pierden.
      const delta = l.counted - l.system;
      if (delta !== 0) await moveStock(l.variantId, delta, 'conteo', `Conteo físico #${countId}`, countId, date);
    }
    await db.counts.update(countId, { status: 'aplicado', appliedAt: date });
  });
}

// ---------- Clientes y cartera ----------

export type CustomerDraft = Omit<Customer, 'id' | 'createdAt'> & { id?: number };

export async function saveCustomer(draft: CustomerDraft) {
  const name = draft.name.trim();
  if (!name) throw new UserError('El nombre es obligatorio.');
  const data = {
    name,
    phone: draft.phone.trim(),
    document: draft.document.trim(),
    address: draft.address.trim(),
    notes: draft.notes.trim(),
    town: draft.town?.trim() ? (await resolveTown(draft.town)).name : null,
  };
  if (draft.id) {
    await db.customers.update(draft.id, data);
    return draft.id;
  }
  return (await db.customers.add({ ...data, createdAt: Date.now() } as Customer)) as number;
}

export async function addLedgerEntry(
  customerId: number,
  type: 'cargo' | 'abono',
  amount: number,
  note: string,
  method: PaymentMethod | null = null,
  town: string | null = null,
) {
  if (!(amount > 0)) throw new UserError('El valor debe ser mayor a cero.');
  if (type === 'abono') {
    if (!method) throw new UserError('Indica el medio de pago del abono.');
    const bal = await customerBalance(customerId);
    if (amount > bal) throw new UserError(`El abono supera el saldo pendiente.`);
  }
  const trip = await getActiveTrip();
  await db.ledger.add({
    customerId,
    date: Date.now(),
    type,
    amount,
    saleId: null,
    note: note.trim(),
    method: type === 'abono' ? method : null,
    tripId: trip?.id ?? null,
    town: town?.trim() ? (await resolveTown(town)).name : null,
  } as never);
}

export async function customerBalance(customerId: number) {
  const entries = await db.ledger.where('customerId').equals(customerId).toArray();
  return entries.reduce((s, e) => s + (e.type === 'cargo' ? e.amount : -e.amount), 0);
}

export async function allBalances() {
  const entries = await db.ledger.toArray();
  const map = new Map<number, number>();
  for (const e of entries) map.set(e.customerId, (map.get(e.customerId) ?? 0) + (e.type === 'cargo' ? e.amount : -e.amount));
  return map;
}

// ---------- Ventas ----------

export interface SaleInput {
  customerId: number | null;
  items: SaleItem[];
  discount: number;
  paymentType: PaymentType;
  /** Lo que se recibe en el momento: en contado debe sumar el total; en crédito es el abono inicial. */
  payments: Payment[];
  notes: string;
  /** Pueblo o ciudad donde se vende. */
  town?: string | null;
}

export async function createSale(input: SaleInput): Promise<Sale> {
  const items = input.items.filter((i) => i.qty > 0);
  if (!items.length) throw new UserError('La venta no tiene productos.');
  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const discount = Math.min(Math.max(0, input.discount || 0), subtotal);
  const total = subtotal - discount;
  if (input.paymentType === 'credito' && !input.customerId)
    throw new UserError('Para vender a crédito selecciona un cliente.');
  const payments = mergePayments(input.payments);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  if (input.paymentType === 'contado' && paid !== total)
    throw new UserError(`Los pagos suman ${paid.toLocaleString('es-CO')} y el total es ${total.toLocaleString('es-CO')}.`);
  if (paid > total) throw new UserError('El abono inicial no puede ser mayor que el total.');

  return db.transaction(
    'rw',
    [db.sales, db.variants, db.movements, db.ledger, db.customers, db.settings, db.trips, db.tripItems],
    async () => {
    // Con un viaje abierto, la venta sale de la mercancía del viaje; si no, de bodega.
    const trip = await getActiveTrip();
    const need = new Map<number, number>();
    for (const i of items) need.set(i.variantId, (need.get(i.variantId) ?? 0) + i.qty);
    for (const [variantId, qty] of need) {
      const it = items.find((i) => i.variantId === variantId)!;
      const available = trip
        ? ((await db.tripItems.where({ tripId: trip.id, variantId }).first())?.onHand ?? 0)
        : ((await db.variants.get(variantId))?.stock ?? -1);
      if (available < 0) throw new UserError('Una de las tallas ya no existe.');
      if (available < qty)
        throw new UserError(
          `Sin existencias suficientes de ${it.name} talla ${it.size} ${trip ? 'en el viaje' : 'en bodega'} (disponible: ${available}).`,
        );
    }

    const settings = await getSettings();
    const customer = input.customerId ? await db.customers.get(input.customerId) : undefined;
    const town = input.town?.trim() ? (await resolveTown(input.town)).name : null;
    const date = Date.now();
    const sale: Omit<Sale, 'id'> = {
      number: settings.nextSaleNumber,
      date,
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? '',
      items,
      subtotal,
      discount,
      total,
      paymentType: input.paymentType,
      paid,
      payments,
      tripId: trip?.id ?? null,
      town,
      townChanges: [],
      notes: input.notes.trim(),
      voided: false,
    };
    const id = (await db.sales.add(sale as Sale)) as number;
    await saveSettings({ nextSaleNumber: settings.nextSaleNumber + 1 });
    // En viaje, el pueblo de esta venta queda como "pueblo actual" para las siguientes.
    if (trip && town) await rememberTripTown(trip, town);

    for (const i of items)
      if (trip) await moveTripStock(trip.id, i.variantId, -i.qty, 'venta', `Venta #${sale.number} (${trip.destination})`, id, date);
      else await moveStock(i.variantId, -i.qty, 'venta', `Venta #${sale.number}`, id, date);

    if (input.paymentType === 'credito' && customer) {
      await db.ledger.add({
        customerId: customer.id,
        date,
        type: 'cargo',
        amount: total,
        saleId: id,
        note: `Venta a crédito #${sale.number}`,
        method: null,
        tripId: trip?.id ?? null,
        town,
      } as never);
      for (const p of payments)
        await db.ledger.add({
          customerId: customer.id,
          date,
          type: 'abono',
          amount: p.amount,
          saleId: id,
          note: `Abono inicial venta #${sale.number}`,
          method: p.method,
          tripId: trip?.id ?? null,
          town,
        } as never);
    }
    return { ...sale, id };
    },
  );
}

/** Anula la venta: devuelve las unidades al inventario y reversa la cartera asociada. */
export async function voidSale(saleId: number) {
  await db.transaction('rw', [db.sales, db.variants, db.movements, db.ledger, db.trips, db.tripItems], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale || sale.voided) throw new UserError('La venta ya está anulada.');
    const date = Date.now();
    for (const i of sale.items) await returnToStock(sale, i, i.qty, 'anulacion', `Anulación venta #${sale.number}`, date);
    // Reversa lo que quede pendiente de esta venta (crédito o diferencias de cambios que quedaron como deuda).
    if (sale.customerId) {
      const related = await db.ledger.where('saleId').equals(saleId).toArray();
      const owed = related.reduce((s, e) => s + (e.type === 'cargo' ? e.amount : -e.amount), 0);
      if (owed > 0)
        await db.ledger.add({
          customerId: sale.customerId,
          date,
          type: 'abono',
          amount: owed,
          saleId,
          note: `Anulación venta #${sale.number}`,
          town: sale.town ?? null,
        } as never);
    }
    await db.sales.update(saleId, { voided: true });
  });
}

/**
 * Devuelve prendas de una venta al inventario:
 * - venta de un viaje que sigue abierto → a la mercancía del viaje;
 * - venta de un viaje ya cerrado → a bodega, y cuenta como devuelta de ese viaje (para que sus números cuadren);
 * - venta desde bodega → a bodega.
 */
async function returnToStock(sale: Sale, line: SaleItem, qty: number, type: MovementType, note: string, date: number) {
  const variantId = line.variantId;
  const fromTrip = line.source ? line.source === 'viaje' : sale.tripId !== null;
  const trip = fromTrip && sale.tripId ? await db.trips.get(sale.tripId) : undefined;
  const item = trip ? await db.tripItems.where({ tripId: trip.id, variantId }).first() : undefined;
  if (trip?.status === 'abierto' && item) return moveTripStock(trip.id, variantId, qty, type, note, sale.id, date);
  if (!(await db.variants.get(variantId))) return; // la talla se eliminó: no hay a dónde devolver
  await moveStock(variantId, qty, type, note, sale.id, date);
  if (item) await db.tripItems.update(item.id, { returned: item.returned + qty });
}

// ---------- Cambios y devoluciones ----------

export interface AdjustInput {
  type: 'cambio' | 'devolucion';
  /** Prendas que devuelve el cliente. */
  returned: { variantId: number; qty: number }[];
  /** Prendas nuevas (solo en cambio). */
  added: SaleItem[];
  settlement: Settlement;
  /** Dinero cobrado (pago) o devuelto (reembolso). */
  payments: Payment[];
  note: string;
}

/** Valor de las prendas devueltas: precio de venta con el descuento proporcional de la venta. */
export function returnValue(sale: Sale, returned: { variantId: number; qty: number }[]) {
  const factor = sale.subtotal > 0 ? sale.total / sale.subtotal : 1;
  let gross = 0;
  for (const r of returned) {
    const line = sale.items.find((i) => i.variantId === r.variantId);
    if (line) gross += r.qty * line.price;
  }
  return Math.round(gross * factor);
}

export async function adjustSale(saleId: number, input: AdjustInput) {
  const returned = input.returned.filter((r) => r.qty > 0);
  const added = input.added.filter((a) => a.qty > 0);
  if (!returned.length) throw new UserError('Elige al menos una prenda que devuelve el cliente.');
  if (input.type === 'cambio' && !added.length) throw new UserError('Agrega la prenda que se lleva a cambio.');
  if (input.type === 'devolucion' && added.length) throw new UserError('Una devolución no lleva prendas nuevas.');

  const tables = [db.sales, db.variants, db.movements, db.ledger, db.trips, db.tripItems, db.customers];
  return db.transaction('rw', tables, async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) throw new UserError('La venta no existe.');
    if (sale.voided) throw new UserError('La venta está anulada.');

    // Lo devuelto no puede superar lo que tiene la venta
    for (const r of returned) {
      const have = sale.items.filter((i) => i.variantId === r.variantId).reduce((a, i) => a + i.qty, 0);
      if (r.qty > have) throw new UserError('Se está devolviendo más de lo que tiene la venta.');
    }
    // Las prendas nuevas salen del mismo lugar que la venta: de la mercancía del viaje
    // si la venta es del viaje abierto; si no, de bodega. Así lo que entra y sale cuadra.
    const trip = await getActiveTrip();
    const fromTrip = !!trip && sale.tripId === trip.id;
    for (const a of added) {
      const have = fromTrip
        ? ((await db.tripItems.where({ tripId: trip!.id, variantId: a.variantId }).first())?.onHand ?? 0)
        : ((await db.variants.get(a.variantId))?.stock ?? 0);
      if (have < a.qty)
        throw new UserError(`No hay existencias de ${a.name} talla ${a.size} ${fromTrip ? 'en el viaje' : 'en bodega'} (disponible: ${have}).`);
    }

    const returnedValue = returnValue(sale, returned);
    const addedValue = added.reduce((t, a) => t + a.qty * a.price, 0);
    const difference = addedValue - returnedValue;
    const payments = mergePayments(input.payments);
    const paid = payments.reduce((t, p) => t + p.amount, 0);

    // Cómo se resuelve la diferencia
    let settlement = input.settlement;
    if (difference === 0) settlement = 'ninguno';
    else if (difference > 0 && !['pago', 'deuda'].includes(settlement)) settlement = 'pago';
    else if (difference < 0 && !['reembolso', 'descuento_deuda'].includes(settlement)) settlement = 'reembolso';
    if ((settlement === 'deuda' || settlement === 'descuento_deuda') && !sale.customerId)
      throw new UserError('La venta no tiene cliente: la diferencia se debe pagar o devolver en dinero.');
    if (settlement === 'pago' && paid !== difference) throw new UserError('El pago no coincide con la diferencia a pagar.');
    if (settlement === 'reembolso' && paid !== -difference) throw new UserError('El dinero devuelto no coincide con el saldo a favor.');

    const date = Date.now();
    const label = `${input.type === 'cambio' ? 'Cambio' : 'Devolución'} venta #${sale.number}`;

    // Prendas de la venta: quitar lo devuelto (línea por línea, para saber a dónde vuelve cada una)
    const items = sale.items.map((i) => ({ ...i }));
    const returnedLines: SaleItem[] = [];
    for (const r of returned) {
      let left = r.qty;
      for (const i of items) {
        if (i.variantId !== r.variantId || left <= 0) continue;
        const take = Math.min(left, i.qty);
        i.qty -= take;
        left -= take;
        returnedLines.push({ ...i, qty: take });
      }
    }
    const source: 'viaje' | 'bodega' = fromTrip ? 'viaje' : 'bodega';
    const addedLines = added.map((a) => ({ ...a, source }));
    for (const a of addedLines) {
      const same = items.find((i) => i.variantId === a.variantId && i.price === a.price && (i.source ?? (sale.tripId ? 'viaje' : 'bodega')) === source);
      if (same) same.qty += a.qty;
      else items.push({ ...a });
    }

    // Inventario
    for (const line of returnedLines) await returnToStock(sale, line, line.qty, 'devolucion', label, date);
    for (const a of addedLines) {
      if (fromTrip) await moveTripStock(trip!.id, a.variantId, -a.qty, 'cambio', label, sale.id, date);
      else await moveStock(a.variantId, -a.qty, 'cambio', label, sale.id, date);
    }
    const netItems = items.filter((i) => i.qty > 0);
    const subtotal = netItems.reduce((t, i) => t + i.qty * i.price, 0);
    const total = sale.total - returnedValue + addedValue;

    // Cartera
    if (settlement === 'deuda')
      await db.ledger.add({ customerId: sale.customerId, date, type: 'cargo', amount: difference, saleId, note: label, method: null, tripId: trip?.id ?? null, town: sale.town ?? null } as never);
    if (settlement === 'descuento_deuda')
      await db.ledger.add({ customerId: sale.customerId, date, type: 'abono', amount: -difference, saleId, note: label, method: null, tripId: trip?.id ?? null, town: sale.town ?? null } as never);

    const adjustment: SaleAdjustment = {
      date,
      type: input.type,
      returned: returnedLines,
      added: addedLines,
      returnedValue,
      addedValue,
      difference,
      settlement,
      payments: settlement === 'pago' || settlement === 'reembolso' ? payments : [],
      note: input.note.trim(),
      tripId: trip?.id ?? null,
    };
    await db.sales.update(saleId, {
      items: netItems,
      subtotal,
      discount: Math.max(0, subtotal - total),
      total,
      adjustments: [...(sale.adjustments ?? []), adjustment],
    });
    return adjustment;
  });
}

/** Une pagos del mismo medio y descarta los vacíos. */
export function mergePayments(payments: Payment[]): Payment[] {
  const map = new Map<PaymentMethod, number>();
  for (const p of payments) {
    const amount = Math.round(p.amount || 0);
    if (amount < 0) throw new UserError('Un pago no puede ser negativo.');
    if (amount > 0) map.set(p.method, (map.get(p.method) ?? 0) + amount);
  }
  return [...map.entries()].map(([method, amount]) => ({ method, amount }));
}

// ---------- Viajes ----------

export async function getActiveTrip(): Promise<Trip | undefined> {
  return db.trips.where('status').equals('abierto').first();
}

export interface TripDraft {
  id?: number;
  destination: string;
  startDate: number;
  endDate: number | null;
  notes: string;
}

const accentCount = (s: string) => s.normalize('NFD').replace(/[^\u0300-\u036f]/g, '').length;

/**
 * Decide cómo se guarda un destino:
 * - se limpia (espacios y mayúsculas),
 * - si ya existe el mismo destino (sin importar mayúsculas ni tildes) se usa el existente,
 * - salvo que lo escrito tenga más tildes: entonces esa escritura corrige a los demás viajes.
 */
export async function resolveDestination(input: string, excludeTripId?: number) {
  const formatted = formatDestination(input);
  const key = destinationKey(formatted);
  const others = (await db.trips.toArray()).filter((t) => t.id !== excludeTripId && destinationKey(t.destination) === key);
  if (!others.length) return { name: formatted, existing: null as string | null, renameIds: [] as number[] };
  const existing = canonicalDestination(others.map((t) => t.destination));
  const name = accentCount(formatted) > accentCount(existing) || (excludeTripId && accentCount(formatted) === accentCount(existing)) ? formatted : existing;
  return { name, existing, renameIds: others.filter((t) => t.destination !== name).map((t) => t.id) };
}

export async function saveTrip(d: TripDraft) {
  if (!formatDestination(d.destination)) throw new UserError('Escribe el destino del viaje.');
  if (d.endDate && d.endDate < d.startDate) throw new UserError('La fecha de regreso es antes de la salida.');
  return db.transaction('rw', db.trips, async () => {
    const { name, renameIds } = await resolveDestination(d.destination, d.id);
    const data = { destination: name, startDate: d.startDate, endDate: d.endDate, notes: d.notes.trim() };
    // La escritura corregida queda igual en todos los viajes de ese destino.
    for (const id of renameIds) await db.trips.update(id, { destination: name });
    if (d.id) {
      await db.trips.update(d.id, data);
      return d.id;
    }
    if (await getActiveTrip()) throw new UserError('Ya hay un viaje abierto. Ciérralo antes de crear otro.');
    return (await db.trips.add({ ...data, status: 'abierto', createdAt: Date.now(), closedAt: null } as Trip)) as number;
  });
}

async function openTrip(tripId: number) {
  const trip = await db.trips.get(tripId);
  if (!trip) throw new UserError('El viaje no existe.');
  if (trip.status !== 'abierto') throw new UserError('El viaje ya está cerrado.');
  return trip;
}

/** Saca mercancía de bodega y la deja "en viaje". */
export async function loadTripStock(tripId: number, lines: { variantId: number; qty: number }[]) {
  const valid = lines.filter((l) => l.qty > 0);
  if (!valid.length) throw new UserError('Agrega al menos una talla con cantidad.');
  await db.transaction('rw', [db.trips, db.tripItems, db.variants, db.movements, db.products], async () => {
    const trip = await openTrip(tripId);
    const date = Date.now();
    for (const l of valid) {
      const v = await db.variants.get(l.variantId);
      if (!v) throw new UserError('Una de las tallas ya no existe.');
      if (v.stock < l.qty) {
        const p = await db.products.get(v.productId);
        throw new UserError(`En bodega solo hay ${v.stock} de ${p?.name ?? ''} talla ${v.size}.`);
      }
      await moveStock(l.variantId, -l.qty, 'carga_viaje', `Carga para viaje a ${trip.destination}`, tripId, date);
      const item = await db.tripItems.where({ tripId, variantId: l.variantId }).first();
      if (item) await db.tripItems.update(item.id, { loaded: item.loaded + l.qty, onHand: item.onHand + l.qty });
      else
        await db.tripItems.add({
          tripId,
          productId: v.productId,
          variantId: l.variantId,
          loaded: l.qty,
          onHand: l.qty,
          returned: 0,
        } as never);
    }
  });
}

/** Devuelve a bodega unidades que van en el viaje (antes de cerrarlo o al cerrarlo). */
async function returnFromTrip(trip: Trip, variantId: number, qty: number, date: number) {
  const item = await db.tripItems.where({ tripId: trip.id, variantId }).first();
  if (!item || qty <= 0) return;
  if (qty > item.onHand) throw new UserError('No se pueden devolver más unidades de las que van en el viaje.');
  await db.tripItems.update(item.id, { onHand: item.onHand - qty, returned: item.returned + qty });
  await moveStock(variantId, qty, 'regreso_viaje', `Regreso del viaje a ${trip.destination}`, trip.id, date);
}

export async function returnTripStock(tripId: number, variantId: number, qty: number) {
  await db.transaction('rw', [db.trips, db.tripItems, db.variants, db.movements], async () => {
    const trip = await openTrip(tripId);
    await returnFromTrip(trip, variantId, qty, Date.now());
  });
}

/** Cierra el viaje: todo lo que no se vendió vuelve a bodega. */
export async function closeTrip(tripId: number) {
  await db.transaction('rw', [db.trips, db.tripItems, db.variants, db.movements], async () => {
    const trip = await openTrip(tripId);
    const date = Date.now();
    const items = await db.tripItems.where('tripId').equals(tripId).toArray();
    for (const i of items) if (i.onHand > 0) await returnFromTrip(trip, i.variantId, i.onHand, date);
    const today = new Date(new Date(date).setHours(0, 0, 0, 0)).getTime();
    await db.trips.update(tripId, {
      status: 'cerrado',
      closedAt: date,
      // Si regresó antes de lo planeado, la fecha de regreso queda en hoy.
      endDate: trip.endDate && trip.endDate < today ? trip.endDate : today,
    });
  });
}

/** Solo se puede eliminar un viaje abierto sin ventas; la mercancía vuelve a bodega. */
export async function deleteTrip(tripId: number) {
  await db.transaction('rw', [db.trips, db.tripItems, db.variants, db.movements, db.sales], async () => {
    const trip = await openTrip(tripId);
    if (await db.sales.where('tripId').equals(tripId).count())
      throw new UserError('El viaje ya tiene ventas: ciérralo en lugar de eliminarlo.');
    const date = Date.now();
    for (const i of await db.tripItems.where('tripId').equals(tripId).toArray())
      if (i.onHand > 0) await returnFromTrip(trip, i.variantId, i.onHand, date);
    await db.tripItems.where('tripId').equals(tripId).delete();
    await db.trips.delete(tripId);
  });
}

// ---------- Gastos ----------

export interface ExpenseDraft {
  id?: number;
  date: number;
  category: ExpenseCategory;
  amount: number;
  method: PaymentMethod;
  tripId: number | null;
  note: string;
}

export async function saveExpense(d: ExpenseDraft) {
  if (!(d.amount > 0)) throw new UserError('El valor del gasto debe ser mayor a cero.');
  if (d.tripId !== null && !(await db.trips.get(d.tripId))) throw new UserError('El viaje ya no existe.');
  const data = {
    date: d.date,
    category: d.category,
    amount: Math.round(d.amount),
    method: d.method,
    tripId: d.tripId,
    note: d.note.trim(),
  };
  if (d.id) {
    await db.expenses.update(d.id, data);
    return d.id;
  }
  return (await db.expenses.add({ ...data, createdAt: Date.now() } as Expense)) as number;
}

export async function deleteExpense(id: number) {
  await db.expenses.delete(id);
}

// ---------- Pueblos ----------

const accentsOf = (x: string) => x.normalize('NFD').replace(/[^\u0300-\u036f]/g, '').length;

/** Pueblos ya usados en ventas, clientes y rutas (un nombre por pueblo). */
export async function knownTowns(): Promise<string[]> {
  const [saleTowns, customers, trips] = await Promise.all([
    db.sales.orderBy('town').uniqueKeys(),
    db.customers.toArray(),
    db.trips.toArray(),
  ]);
  const all = [
    ...(saleTowns as string[]),
    ...customers.map((c) => c.town ?? ''),
    ...trips.flatMap((t) => t.towns ?? []),
  ].filter((x): x is string => !!x);
  const groups = new Map<string, string[]>();
  for (const t of all) groups.set(destinationKey(t), [...(groups.get(destinationKey(t)) ?? []), t]);
  return [...groups.values()].map((g) => canonicalDestination(g)).sort((a, b) => a.localeCompare(b));
}

/**
 * Cómo se guarda un pueblo: limpio (mayúsculas y espacios) y, si ya existe sin importar
 * mayúsculas ni tildes, con la escritura existente ("malaga" → "Málaga"). Si lo escrito
 * tiene más tildes que lo existente, se usa lo escrito.
 */
export async function resolveTown(input: string) {
  const formatted = formatDestination(input);
  if (!formatted) return { name: '', existing: null as string | null };
  const key = destinationKey(formatted);
  const existing = (await knownTowns()).find((t) => destinationKey(t) === key) ?? null;
  if (!existing) return { name: formatted, existing };
  return { name: accentsOf(formatted) > accentsOf(existing) ? formatted : existing, existing };
}

/** Deja un pueblo como "pueblo actual" del viaje y lo agrega a su ruta si no estaba. */
async function rememberTripTown(trip: Trip, town: string) {
  const towns = trip.towns ?? [];
  const has = towns.some((t) => destinationKey(t) === destinationKey(town));
  await db.trips.update(trip.id, { currentTown: town, towns: has ? towns : [...towns, town] });
}

/** Cambia el pueblo actual del viaje abierto (el que queda por defecto en Vender). */
export async function setCurrentTown(town: string | null) {
  await db.transaction('rw', [db.trips, db.sales, db.customers], async () => {
    const trip = await getActiveTrip();
    if (!trip) throw new UserError('No hay un viaje abierto.');
    if (!town?.trim()) return db.trips.update(trip.id, { currentTown: null });
    await rememberTripTown(trip, (await resolveTown(town)).name);
  });
}

/** Corrige el pueblo de una venta ya hecha; queda en su historial y se aplica a su cartera. */
export async function setSaleTown(saleId: number, town: string | null) {
  await db.transaction('rw', [db.sales, db.ledger, db.customers, db.trips], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) throw new UserError('La venta no existe.');
    const to = town?.trim() ? (await resolveTown(town)).name : null;
    const from = sale.town ?? null;
    if (to === from) return;
    await db.sales.update(saleId, { town: to, townChanges: [...(sale.townChanges ?? []), { date: Date.now(), from, to }] });
    await db.ledger.where('saleId').equals(saleId).modify({ town: to });
  });
}
