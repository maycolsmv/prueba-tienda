import { useState } from 'react';
import { applyCatalogImport, downloadTemplate, readCatalogFile, type ImportPlan } from '../lib/excel';
import { fmtMoney } from '../lib/format';
import { Modal, pickFile, useAction } from './ui';

export default function ImportCatalog({ onClose }: { onClose: () => void }) {
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const { run, busy } = useAction();

  const choose = async () => {
    const f = await pickFile('.xlsx,.xls,.csv');
    if (!f) return;
    setFileName(f.name);
    const p = await run(() => readCatalogFile(f));
    if (p) setPlan(p);
  };

  const apply = async () => {
    if (!plan) return;
    const ok = await run(async () => {
      await applyCatalogImport(plan);
      return true;
    }, 'Catálogo importado');
    if (ok) onClose();
  };

  return (
    <Modal
      title="Cargar catálogo desde Excel"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={apply} disabled={busy || !plan || plan.errors.length > 0 || !plan.rows.length}>
            Importar {plan ? `${plan.rows.length} filas` : ''}
          </button>
        </>
      }
    >
      <ol className="steps">
        <li>
          Descarga la plantilla y llénala: <strong>una fila por cada talla</strong> de cada producto.{' '}
          <button className="btn btn-sm btn-ghost" onClick={downloadTemplate}>
            Descargar plantilla
          </button>
        </li>
        <li>
          Columnas: Referencia, Nombre, Categoria, Precio, Costo, StockMinimo, Talla, Cantidad.
        </li>
        <li>
          Si la referencia ya existe, se actualizan sus datos y la <strong>cantidad se suma</strong> a la existencia actual.
        </li>
      </ol>
      <button className="btn btn-primary" onClick={choose} disabled={busy}>
        {fileName ? 'Elegir otro archivo' : 'Elegir archivo Excel'}
      </button>
      {fileName && <span className="muted small"> {fileName}</span>}

      {plan && (
        <div className="import-preview">
          <div className="stats small-stats">
            <div className="stat">
              <span className="stat-label">Productos nuevos</span>
              <span className="stat-value">{plan.newProducts}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Productos a actualizar</span>
              <span className="stat-value">{plan.updatedProducts}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Tallas nuevas</span>
              <span className="stat-value">{plan.newSizes}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Unidades a sumar</span>
              <span className="stat-value">{plan.unitsAdded}</span>
            </div>
          </div>
          {plan.errors.length > 0 && (
            <div className="alert alert-error">
              <strong>Corrige estos errores y vuelve a cargar el archivo:</strong>
              <ul>
                {plan.errors.slice(0, 20).map((e) => (
                  <li key={e}>{e}</li>
                ))}
                {plan.errors.length > 20 && <li>… y {plan.errors.length - 20} más</li>}
              </ul>
            </div>
          )}
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Nombre</th>
                  <th>Categoría</th>
                  <th>Talla</th>
                  <th className="num">Cant</th>
                  <th className="num">Precio</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.slice(0, 100).map((r) => (
                  <tr key={r.line}>
                    <td>{r.reference}</td>
                    <td>{r.name}</td>
                    <td>{r.category}</td>
                    <td>{r.size}</td>
                    <td className="num">{r.qty}</td>
                    <td className="num">{fmtMoney(r.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.rows.length > 100 && <p className="muted small">Mostrando 100 de {plan.rows.length} filas.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
