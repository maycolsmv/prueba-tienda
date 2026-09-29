import * as XLSX from 'xlsx';
import { db, type Product, type Variant } from './db';
import { normalize, parseMoney } from './format';
import { UserError } from './ops';

export interface Sheet {
  name: string;
  rows: Record<string, string | number | null>[];
}

export function exportXlsx(fileName: string, sheets: Sheet[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ '(sin datos)': '' }]);
    const keys = Object.keys(s.rows[0] ?? {});
    ws['!cols'] = keys.map((k) => ({
      wch: Math.min(40, Math.max(k.length, ...s.rows.slice(0, 200).map((r) => String(r[k] ?? '').length)) + 2),
    }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName);
}

const COLS = ['Referencia', 'Nombre', 'Categoria', 'Precio', 'Costo', 'StockMinimo', 'Talla', 'Cantidad'];

export function downloadTemplate() {
  const rows = [
    { Referencia: 'CAM-001', Nombre: 'Camiseta básica', Categoria: 'Camisetas', Precio: 35000, Costo: 18000, StockMinimo: 5, Talla: 'S', Cantidad: 10 },
    { Referencia: 'CAM-001', Nombre: 'Camiseta básica', Categoria: 'Camisetas', Precio: 35000, Costo: 18000, StockMinimo: 5, Talla: 'M', Cantidad: 12 },
    { Referencia: 'JEA-010', Nombre: 'Jean clásico', Categoria: 'Pantalones', Precio: 89000, Costo: 45000, StockMinimo: 3, Talla: '30', Cantidad: 4 },
  ];
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLS });
  ws['!cols'] = COLS.map((c) => ({ wch: c === 'Nombre' ? 28 : 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  XLSX.writeFile(wb, 'plantilla-catalogo.xlsx');
}

export interface ImportRow {
  line: number;
  reference: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  minStock: number;
  size: string;
  qty: number;
}

export interface ImportPlan {
  rows: ImportRow[];
  errors: string[];
  newProducts: number;
  updatedProducts: number;
  newSizes: number;
  unitsAdded: number;
}

/** Busca una columna aceptando variaciones de nombre (tildes, mayúsculas, espacios). */
function pick(row: Record<string, unknown>, ...names: string[]) {
  const keys = Object.keys(row);
  for (const n of names) {
    const k = keys.find((k) => normalize(k).replace(/\s|_/g, '') === n);
    if (k !== undefined) return row[k];
  }
  return undefined;
}

export async function readCatalogFile(file: File): Promise<ImportPlan> {
  const wb = XLSX.read(await file.arrayBuffer());
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const rows: ImportRow[] = [];
  const errors: string[] = [];
  raw.forEach((r, i) => {
    const line = i + 2;
    const reference = String(pick(r, 'referencia', 'ref', 'codigo') ?? '').trim();
    const name = String(pick(r, 'nombre', 'producto', 'descripcion') ?? '').trim();
    if (!reference && !name) return;
    if (!reference) return errors.push(`Fila ${line}: falta la referencia.`);
    if (!name) return errors.push(`Fila ${line}: falta el nombre.`);
    const size = String(pick(r, 'talla', 'size') ?? '').trim().toUpperCase() || 'U';
    const qty = parseMoney(String(pick(r, 'cantidad', 'stock', 'existencia', 'unidades') ?? '0'));
    if (qty < 0) return errors.push(`Fila ${line}: cantidad negativa.`);
    rows.push({
      line,
      reference,
      name,
      category: String(pick(r, 'categoria') ?? '').trim(),
      price: parseMoney(String(pick(r, 'precio', 'precioventa', 'valor') ?? '0')),
      cost: parseMoney(String(pick(r, 'costo', 'preciocompra') ?? '0')),
      minStock: parseMoney(String(pick(r, 'stockminimo', 'minimo') ?? '0')),
      size,
      qty,
    });
  });
  if (!rows.length && !errors.length) errors.push('El archivo no tiene filas con datos.');

  const products = await db.products.toArray();
  const variants = await db.variants.toArray();
  const byRef = new Map(products.map((p) => [p.reference.toUpperCase(), p]));
  const refs = new Set(rows.map((r) => r.reference.toUpperCase()));
  let newProducts = 0;
  let updatedProducts = 0;
  for (const ref of refs) (byRef.has(ref) ? updatedProducts++ : newProducts++);
  let newSizes = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.reference.toUpperCase()}|${r.size}`;
    if (seen.has(key)) {
      errors.push(`Fila ${r.line}: la talla ${r.size} de ${r.reference} está repetida.`);
      continue;
    }
    seen.add(key);
    const p = byRef.get(r.reference.toUpperCase());
    if (!p || !variants.some((v) => v.productId === p.id && v.size === r.size)) newSizes++;
  }
  return {
    rows,
    errors,
    newProducts,
    updatedProducts,
    newSizes,
    unitsAdded: rows.reduce((s, r) => s + r.qty, 0),
  };
}

/**
 * Crea o actualiza productos por referencia. Las cantidades se SUMAN a la existencia
 * (en productos nuevos quedan como existencia inicial; en existentes, como entrada de mercancía).
 */
export async function applyCatalogImport(plan: ImportPlan) {
  if (plan.errors.length) throw new UserError('Corrige los errores del archivo antes de importar.');
  await db.transaction('rw', db.products, db.variants, db.movements, async () => {
    const date = Date.now();
    for (const r of plan.rows) {
      let p = await db.products.where('reference').equalsIgnoreCase(r.reference).first();
      const data = { name: r.name, category: r.category, price: r.price, cost: r.cost, minStock: r.minStock };
      if (p) {
        await db.products.update(p.id, { ...data, active: true });
      } else {
        const id = (await db.products.add({ ...data, reference: r.reference, active: true, createdAt: date } as Product)) as number;
        p = (await db.products.get(id))!;
      }
      let v = await db.variants.where({ productId: p.id, size: r.size }).first();
      const isNew = !v;
      if (!v) {
        const vid = (await db.variants.add({ productId: p.id, size: r.size, stock: 0 } as Variant)) as number;
        v = (await db.variants.get(vid))!;
      }
      if (r.qty > 0) {
        const stockAfter = v.stock + r.qty;
        await db.variants.update(v.id, { stock: stockAfter });
        await db.movements.add({
          date,
          productId: p.id,
          variantId: v.id,
          type: isNew ? 'inicial' : 'entrada',
          qty: r.qty,
          stockAfter,
          note: 'Carga desde Excel',
          refId: null,
        } as never);
      }
    }
  });
}
