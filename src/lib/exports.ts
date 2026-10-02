import { categoryLabel, db, methodLabel, type Sale } from './db';
import { tripSummary } from './trips';
import { exportXlsx, type Sheet } from './excel';
import { allBalances, loadCatalog } from './ops';
import { destinationKey, destinationNames, fmtDate, fmtDateTime, toDateInput } from './format';

const stamp = () => toDateInput(Date.now());

const MOVEMENT_LABEL: Record<string, string> = {
  entrada: 'Entrada',
  venta: 'Venta',
  ajuste: 'Ajuste',
  conteo: 'Conteo físico',
  anulacion: 'Anulación',
  inicial: 'Existencia inicial',
  carga_viaje: 'Carga a viaje',
  regreso_viaje: 'Regreso de viaje',
  devolucion: 'Devolución de cliente',
  cambio: 'Cambio (sale)',
};
export const movementLabel = (t: string) => MOVEMENT_LABEL[t] ?? t;

function salesSheets(sales: Sale[], tripNames: Map<number, string>): Sheet[] {
  return [
    {
      name: 'Ventas',
      rows: sales.map((s) => ({
        Numero: s.number,
        Fecha: fmtDateTime(s.date),
        Cliente: s.customerName,
        Pueblo: s.town ?? '',
        Pago: s.paymentType === 'credito' ? 'Crédito' : 'Contado',
        Unidades: s.items.reduce((a, i) => a + i.qty, 0),
        Subtotal: s.subtotal,
        Descuento: s.discount,
        Total: s.total,
        Pagado: s.paid,
        Efectivo: s.payments.filter((p) => p.method === 'efectivo').reduce((a, p) => a + p.amount, 0),
        Nequi: s.payments.filter((p) => p.method === 'nequi').reduce((a, p) => a + p.amount, 0),
        Transferencia: s.payments.filter((p) => p.method === 'transferencia').reduce((a, p) => a + p.amount, 0),
        OtroMedio: s.payments.filter((p) => p.method === 'otro').reduce((a, p) => a + p.amount, 0),
        Viaje: s.tripId ? (tripNames.get(s.tripId) ?? '') : '',
        Estado: s.voided ? 'Anulada' : s.adjustments?.length ? 'Con cambios/devoluciones' : 'Activa',
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

/** Viaje → nombre del destino (agrupando mayúsculas y tildes). */
async function tripNameMap() {
  const trips = await db.trips.toArray();
  const display = destinationNames(trips.map((t) => t.destination));
  return new Map(trips.map((t) => [t.id, display.get(destinationKey(t.destination)) ?? t.destination]));
}

export async function exportSales(sales: Sale[], from: string, to: string) {
  exportXlsx(`ventas-${from}-a-${to}.xlsx`, salesSheets(sales, await tripNameMap()));
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
        Pueblo: c.town ?? '',
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
          Pueblo: e.town ?? '',
          Tipo: e.type === 'cargo' ? 'Deuda' : 'Abono',
          Valor: e.amount,
          Medio: e.type === 'abono' ? methodLabel(e.method) : '',
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
    ...salesSheets(sales, await tripNameMap()),
    ...(await customerSheets()),
    ...(await movementSheets()),
    ...(await expenseAndTripSheets()),
  ]);
}

async function expenseAndTripSheets(): Promise<Sheet[]> {
  const [expenses, names] = await Promise.all([db.expenses.orderBy('date').toArray(), tripNameMap()]);
  const trips = await db.trips.orderBy('startDate').toArray();
  const display = destinationNames(trips.map((t) => t.destination));
  const nameOf = (d: string) => display.get(destinationKey(d)) ?? d;
  const rows = [];
  const byDest = new Map<string, { Destino: string; Viajes: number; Llevadas: number; Vendidas: number; TotalVendido: number; Gastos: number; Utilidad: number; CarteraPendiente: number }>();
  for (const t of trips) {
    const sm = await tripSummary(t.id);
    if (!sm) continue;
    const g = byDest.get(destinationKey(t.destination)) ?? { Destino: nameOf(t.destination), Viajes: 0, Llevadas: 0, Vendidas: 0, TotalVendido: 0, Gastos: 0, Utilidad: 0, CarteraPendiente: 0 };
    g.Viajes++;
    g.Llevadas += sm.units.loaded;
    g.Vendidas += sm.units.sold;
    g.TotalVendido += sm.total;
    g.Gastos += sm.expenses;
    g.Utilidad += sm.profit;
    g.CarteraPendiente += sm.carteraOpen;
    byDest.set(destinationKey(t.destination), g);
    rows.push({
      Destino: nameOf(t.destination),
      Salida: fmtDate(t.startDate),
      Regreso: t.endDate ? fmtDate(t.endDate) : '',
      Estado: t.status === 'abierto' ? 'En curso' : 'Cerrado',
      Llevadas: sm.units.loaded,
      Vendidas: sm.units.sold,
      Devueltas: sm.units.returned,
      TotalVendido: sm.total,
      CostoVendido: sm.cost,
      Gastos: sm.expenses,
      Utilidad: sm.profit,
      Efectivo: sm.methods.efectivo,
      Nequi: sm.methods.nequi,
      Transferencia: sm.methods.transferencia,
      CarteraPendiente: sm.carteraOpen,
    });
  }
  return [
    { name: 'Viajes', rows },
    { name: 'Por destino', rows: [...byDest.values()].sort((a, b) => b.TotalVendido - a.TotalVendido) },
    {
      name: 'Gastos',
      rows: expenses.map((e) => ({
        Fecha: fmtDate(e.date),
        Categoria: categoryLabel(e.category),
        Valor: e.amount,
        Medio: methodLabel(e.method),
        Viaje: e.tripId ? nameOf(names.get(e.tripId) ?? '') : 'General',
        Nota: e.note,
      })),
    },
  ];
}
