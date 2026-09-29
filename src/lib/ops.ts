import {
  db,
  type CountLine,
  type Customer,
  type MovementType,
  type PaymentType,
  type Product,
  type Sale,
  type SaleItem,
  type Variant,
} from './db';
import { getSettings, saveSettings } from './settings';
import { compareSizes } from './format';

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

export interface ProductWithVariants extends Product {
  variants: Variant[];
  totalStock: number;
}

export async function loadCatalog(includeInactive = false): Promise<ProductWithVariants[]> {
  const [products, variants] = await Promise.all([db.products.toArray(), db.variants.toArray()]);
  const byProduct = new Map<number, Variant[]>();
  for (const v of variants) {
    const list = byProduct.get(v.productId) ?? [];
    list.push(v);
    byProduct.set(v.productId, list);
  }
  return products
    .filter((p) => includeInactive || p.active)
    .map((p) => {
      const vs = (byProduct.get(p.id) ?? []).sort((a, b) => compareSizes(a.size, b.size));
      return { ...p, variants: vs, totalStock: vs.reduce((s, v) => s + v.stock, 0) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const isLowStock = (p: ProductWithVariants) => p.minStock > 0 && p.totalStock <= p.minStock;

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
  };
  if (draft.id) {
    await db.customers.update(draft.id, data);
    return draft.id;
  }
  return (await db.customers.add({ ...data, createdAt: Date.now() } as Customer)) as number;
}

export async function addLedgerEntry(customerId: number, type: 'cargo' | 'abono', amount: number, note: string) {
  if (!(amount > 0)) throw new UserError('El valor debe ser mayor a cero.');
  if (type === 'abono') {
    const bal = await customerBalance(customerId);
    if (amount > bal) throw new UserError(`El abono supera el saldo pendiente.`);
  }
  await db.ledger.add({ customerId, date: Date.now(), type, amount, saleId: null, note: note.trim() } as never);
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
  paid: number;
  notes: string;
}

export async function createSale(input: SaleInput): Promise<Sale> {
  const items = input.items.filter((i) => i.qty > 0);
  if (!items.length) throw new UserError('La venta no tiene productos.');
  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const discount = Math.min(Math.max(0, input.discount || 0), subtotal);
  const total = subtotal - discount;
  if (input.paymentType === 'credito' && !input.customerId)
    throw new UserError('Para vender a crédito selecciona un cliente.');
  const paid = input.paymentType === 'contado' ? total : Math.min(Math.max(0, input.paid || 0), total);

  return db.transaction('rw', [db.sales, db.variants, db.movements, db.ledger, db.customers, db.settings], async () => {
    // Validar existencias (sumando cantidades de la misma talla).
    const need = new Map<number, number>();
    for (const i of items) need.set(i.variantId, (need.get(i.variantId) ?? 0) + i.qty);
    for (const [variantId, qty] of need) {
      const v = await db.variants.get(variantId);
      if (!v) throw new UserError('Una de las tallas ya no existe.');
      if (v.stock < qty) {
        const it = items.find((i) => i.variantId === variantId)!;
        throw new UserError(`Sin existencias suficientes de ${it.name} talla ${it.size} (disponible: ${v.stock}).`);
      }
    }

    const settings = await getSettings();
    const customer = input.customerId ? await db.customers.get(input.customerId) : undefined;
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
      notes: input.notes.trim(),
      voided: false,
    };
    const id = (await db.sales.add(sale as Sale)) as number;
    await saveSettings({ nextSaleNumber: settings.nextSaleNumber + 1 });

    for (const i of items) await moveStock(i.variantId, -i.qty, 'venta', `Venta #${sale.number}`, id, date);

    if (input.paymentType === 'credito' && customer) {
      await db.ledger.add({
        customerId: customer.id,
        date,
        type: 'cargo',
        amount: total,
        saleId: id,
        note: `Venta a crédito #${sale.number}`,
      } as never);
      if (paid > 0)
        await db.ledger.add({
          customerId: customer.id,
          date,
          type: 'abono',
          amount: paid,
          saleId: id,
          note: `Abono inicial venta #${sale.number}`,
        } as never);
    }
    return { ...sale, id };
  });
}

/** Anula la venta: devuelve las unidades al inventario y reversa la cartera asociada. */
export async function voidSale(saleId: number) {
  await db.transaction('rw', [db.sales, db.variants, db.movements, db.ledger], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale || sale.voided) throw new UserError('La venta ya está anulada.');
    const date = Date.now();
    for (const i of sale.items) {
      const v = await db.variants.get(i.variantId);
      if (v) await moveStock(i.variantId, i.qty, 'anulacion', `Anulación venta #${sale.number}`, saleId, date);
    }
    if (sale.customerId && sale.paymentType === 'credito') {
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
        } as never);
    }
    await db.sales.update(saleId, { voided: true });
  });
}
