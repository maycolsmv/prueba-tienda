import { db, type Sale } from './db';
import { exportXlsx, type Sheet } from './excel';
import { allBalances, loadCatalog } from './ops';
import { fmtDate, fmtDateTime, toDateInput } from './format';

const stamp = () => toDateInput(Date.now());

const MOVEMENT_LABEL: Record<string, string> = {
  entrada: 'Entrada',
  venta: 'Venta',
  ajuste: 'Ajuste',
  conteo: 'Conteo físico',
  anulacion: 'Anulación',
  inicial: 'Existencia inicial',
};
export const movementLabel = (t: string) => MOVEMENT_LABEL[t] ?? t;

function salesSheets(sales: Sale[]): Sheet[] {
  return [
    {
      name: 'Ventas',
      rows: sales.map((s) => ({
        Numero: s.number,
        Fecha: fmtDateTime(s.date),
        Cliente: s.customerName,
        Pago: s.paymentType === 'credito' ? 'Crédito' : 'Contado',
        Unidades: s.items.reduce((a, i) => a + i.qty, 0),
        Subtotal: s.subtotal,
        Descuento: s.discount,
        Total: s.total,
        Pagado: s.paid,
        Estado: s.voided ? 'Anulada' : 'Activa',
        Nota: s.notes,
      })),
    },
    {
      name: 'Detalle',
      rows: sales.flatMap((s) =>
        s.items.map((i) => ({
          Numero: s.number,
          Fecha: fmtDate(s.date),
          Referencia: i.reference,
          Producto: i.name,
          Talla: i.size,
          Cantidad: i.qty,
          PrecioUnit: i.price,
          Total: i.qty * i.price,
          Estado: s.voided ? 'Anulada' : 'Activa',
        })),
      ),
    },
  ];
}

export function exportSales(sales: Sale[], from: string, to: string) {
  exportXlsx(`ventas-${from}-a-${to}.xlsx`, salesSheets(sales));
}

async function inventorySheets(): Promise<Sheet[]> {
  const catalog = await loadCatalog(true);
  return [
    {
      name: 'Existencias',
      rows: catalog.flatMap((p) =>
        p.variants.map((v) => ({
          Referencia: p.reference,
          Nombre: p.name,
          Categoria: p.category,
          Talla: v.size,
          Cantidad: v.stock,
          Precio: p.price,
          Costo: p.cost,
          StockMinimo: p.minStock,
          ValorVenta: v.stock * p.price,
          ValorCosto: v.stock * p.cost,
          Activo: p.active ? 'Sí' : 'No',
        })),
      ),
    },
  ];
}

export async function exportInventory() {
  exportXlsx(`inventario-${stamp()}.xlsx`, await inventorySheets());
}

async function customerSheets(): Promise<Sheet[]> {
  const [customers, balances, ledger] = await Promise.all([db.customers.orderBy('name').toArray(), allBalances(), db.ledger.toArray()]);
  const names = new Map(customers.map((c) => [c.id, c.name]));
  return [
    {
      name: 'Clientes',
      rows: customers.map((c) => ({
        Nombre: c.name,
        Celular: c.phone,
        Documento: c.document,
        Direccion: c.address,
        Saldo: balances.get(c.id) ?? 0,
        Notas: c.notes,
      })),
    },
    {
      name: 'Cartera',
      rows: ledger
        .sort((a, b) => a.date - b.date)
        .map((e) => ({
          Fecha: fmtDateTime(e.date),
          Cliente: names.get(e.customerId) ?? '',
          Tipo: e.type === 'cargo' ? 'Deuda' : 'Abono',
          Valor: e.amount,
          Detalle: e.note,
        })),
    },
  ];
}

export async function exportCustomers() {
  exportXlsx(`clientes-cartera-${stamp()}.xlsx`, await customerSheets());
}

async function movementSheets(): Promise<Sheet[]> {
  const [movs, products, variants] = await Promise.all([db.movements.orderBy('date').toArray(), db.products.toArray(), db.variants.toArray()]);
  const pm = new Map(products.map((p) => [p.id, p]));
  const vm = new Map(variants.map((v) => [v.id, v]));
  return [
    {
      name: 'Movimientos',
      rows: movs.map((m) => ({
        Fecha: fmtDateTime(m.date),
        Referencia: pm.get(m.productId)?.reference ?? '',
        Producto: pm.get(m.productId)?.name ?? '(eliminado)',
        Talla: vm.get(m.variantId)?.size ?? '',
        Tipo: movementLabel(m.type),
        Cantidad: m.qty,
        ExistenciaFinal: m.stockAfter,
        Detalle: m.note,
      })),
    },
  ];
}

export async function exportMovements() {
  exportXlsx(`movimientos-${stamp()}.xlsx`, await movementSheets());
}

/** Todo en un solo libro de Excel, legible por el usuario. */
export async function exportEverything() {
  const sales = await db.sales.orderBy('date').toArray();
  exportXlsx(`tienda-completo-${stamp()}.xlsx`, [
    ...(await inventorySheets()),
    ...salesSheets(sales),
    ...(await customerSheets()),
    ...(await movementSheets()),
  ]);
}
