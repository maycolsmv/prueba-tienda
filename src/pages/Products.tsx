import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { loadCatalog, type ProductWithVariants } from '../lib/ops';
import { fmtPct } from '../components/charts';
import { ProductStatus, StockBar } from '../components/status';
import { fmtMoney, normalize } from '../lib/format';
import { Empty, PageHeader, SearchBox } from '../components/ui';
import ProductForm from '../components/ProductForm';
import ImportCatalog from '../components/ImportCatalog';

export default function Products() {
  const catalog = useLiveQuery(() => loadCatalog(true), []);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<ProductWithVariants | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  const categories = useMemo(
    () => [...new Set((catalog ?? []).map((p) => p.category).filter(Boolean))].sort(),
    [catalog],
  );

  const list = useMemo(() => {
    const n = normalize(q);
    return (catalog ?? []).filter(
      (p) =>
        (showInactive || p.active) &&
        (!cat || p.category === cat) &&
        (!n || normalize(`${p.name} ${p.reference} ${p.category} ${p.variants.map((v) => v.size).join(' ')}`).includes(n)),
    );
  }, [catalog, q, cat, showInactive]);

  return (
    <div className="page">
      <PageHeader
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setImporting(true)}>
              Cargar Excel
            </button>
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              + Nuevo
            </button>
          </>
        }
      />
      <div className="card filters">
        <SearchBox value={q} onChange={setQ} placeholder="Buscar por nombre, referencia, categoría o talla" />
        <div className="chips">
          <button className={`chip ${cat === '' ? 'active' : ''}`} onClick={() => setCat('')}>
            Todas
          </button>
          {categories.map((c) => (
            <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(cat === c ? '' : c)}>
              {c}
            </button>
          ))}
        </div>
        <label className="check small">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar inactivos
        </label>
      </div>

      {!catalog ? null : list.length === 0 ? (
        <Empty>
          {catalog.length === 0 ? (
            <>
              Aún no hay productos. Crea el primero o carga tu catálogo desde Excel.
            </>
          ) : (
            'Ningún producto coincide con la búsqueda.'
          )}
        </Empty>
      ) : (
        <div className="card flush table-wrap">
          <table className="table stack-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Tallas</th>
                <th className="num">Precio</th>
                <th className="num">Margen</th>
                <th>Stock vs. mínimo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr
                  key={p.id}
                  className={`clickable-row ${p.active ? '' : 'voided'}`}
                  onClick={() => setEditing(p)}
                  onKeyDown={(e) => e.key === 'Enter' && setEditing(p)}
                  tabIndex={0}
                >
                  <td data-label="Producto">
                    <strong>{p.name}</strong>
                    <div className="muted small">
                      Ref {p.reference}
                      {p.category && ` · ${p.category}`}
                    </div>
                  </td>
                  <td data-label="Tallas">
                    <div className="size-line" style={{ marginTop: 0 }}>
                      {p.variants.map((v) => (
                        <span key={v.id} className={`size-tag ${v.stock <= 0 ? 'zero' : ''}`}>
                          {v.size} <b>{v.stock}</b>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td data-label="Precio" className="num">
                    {fmtMoney(p.price)}
                  </td>
                  <td data-label="Margen" className="num">
                    {p.price > 0 && p.cost > 0 ? fmtPct(((p.price - p.cost) / p.price) * 100) : <span className="muted">—</span>}
                  </td>
                  <td data-label="Stock / mín">
                    <StockBar p={p} />
                  </td>
                  <td data-label="Estado">
                    {p.active ? <ProductStatus p={p} /> : <span className="badge badge-neutral">Inactivo</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ProductForm
          key={editing === 'new' ? 'new' : editing.id}
          product={editing === 'new' ? undefined : editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && <ImportCatalog onClose={() => setImporting(false)} />}
    </div>
  );
}
