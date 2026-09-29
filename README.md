# Tienda – Gestión (Opción 2 · Completa)

App web instalable (PWA) para tienda de ropa: ventas, comprobantes PDF, clientes y cartera, inventario por tallas,
conteo físico, reportes y exportación a Excel. Funciona **sin internet** y guarda todo **en el dispositivo** (IndexedDB).

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # genera dist/ listo para publicar
npm run preview    # prueba local del build (incluye modo offline)
```

## Publicar e instalar en el celular

1. Sube la carpeta `dist/` a cualquier hosting estático con HTTPS (Netlify, Vercel, Cloudflare Pages, GitHub Pages).
   Configura que todas las rutas respondan `index.html` (SPA).
2. Abre la URL en el celular (Chrome en Android / Safari en iPhone) → menú → **Agregar a pantalla de inicio**.
3. Desde ese momento abre como app y funciona sin conexión.

> Los datos quedan en ese navegador de ese dispositivo. Si se borran los datos del navegador o se desinstala la app,
> se pierde la información: por eso la app recuerda hacer respaldos (Ajustes → Generar respaldo).

## Módulos

| Módulo | Qué incluye |
|---|---|
| Vender | Búsqueda rápida, selección por talla, contado/crédito con abono inicial, descuento, cliente rápido |
| Ventas | Historial por fechas, comprobante PDF, envío por WhatsApp, anulación (devuelve inventario y reversa cartera) |
| Productos | Referencias, categorías, tallas, stock mínimo, carga masiva desde Excel (con plantilla y vista previa) |
| Inventario | Existencias por talla, alertas de poco stock, entradas de mercancía, ajustes con motivo, conteo físico con comparación, movimientos |
| Clientes | Registro, historial de compras, deudas, abonos, saldo, recordatorio por WhatsApp |
| Reportes | Ventas, más vendidos, baja rotación, existencias por categoría, cartera; exportables a Excel |
| Ajustes | Datos del negocio (salen en el comprobante), respaldo/restauración, exportaciones, aviso de respaldo |

## Estructura

- `src/lib/db.ts` – esquema de la base local (Dexie)
- `src/lib/ops.ts` – reglas de negocio (ventas, inventario, cartera, conteos); todo en transacciones
- `src/lib/receipt.ts` – comprobante PDF (tiquete 80 mm) y envío por WhatsApp
- `src/lib/excel.ts`, `src/lib/exports.ts` – importación de catálogo y exportaciones
- `src/lib/backup.ts` – respaldo y restauración (JSON)
- `src/pages/*` – pantallas

## Notas

- El comprobante es interno; **no es factura electrónica** (lo indica el pie del PDF).
- En celular, "Enviar por WhatsApp" abre el menú de compartir con el PDF adjunto. En computador descarga el PDF
  y abre WhatsApp con el resumen de la venta para adjuntarlo.
- Importar Excel: una fila por talla. Si la referencia existe, se actualizan datos y la cantidad **se suma**.
