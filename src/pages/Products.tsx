import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { isLowStock, loadCatalog, type ProductWithVariants } from '../lib/ops';
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
        title="Productos"
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

      {catalog && list.length === 0 ? (
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
        <div className="card flush">
          <ul className="list">
            {list.map((p) => (
              <li key={p.id}>
                <button className={`list-row pick-row ${p.active ? '' : 'voided'}`} onClick={() => setEditing(p)}>
                  <div>
                    <strong>{p.name}</strong>
                    <div className="muted small">
                      Ref {p.reference}
                      {p.category && ` · ${p.category}`}
                      {!p.active && ' · Inactivo'}
                    </div>
                    <div className="size-line">
                      {p.variants.map((v) => (
                        <span key={v.id} className={`size-tag ${v.stock <= 0 ? 'zero' : ''}`}>
                          {v.size} <b>{v.stock}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="right">
                    <div>{fmtMoney(p.price)}</div>
                    {isLowStock(p) ? (
                      <span className="badge badge-warn">Poco stock</span>
                    ) : (
                      <span className="muted small">{p.totalStock} und</span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
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
