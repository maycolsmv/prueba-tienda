import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type CountLine, type InventoryCount, type Variant } from '../lib/db';
import {
  adjustStock,
  applyCount,
  createCount,
  loadCatalog,
  registerEntry,
  type ProductWithVariants,
} from '../lib/ops';
import { fmtDateTime, fmtMoney, fmtNum, normalize } from '../lib/format';
import { inventorySummary, stockStatus, type StockStatus } from '../lib/stats';
import { Icon } from '../components/Icon';
import { fmtPct } from '../components/charts';
import { ProductStatus, StockBar } from '../components/status';
import { exportInventory, exportMovements, movementLabel } from '../lib/exports';
import { Empty, Field, Modal, NumberInput, SearchBox, Tabs, useAction, useConfirm } from '../components/ui';

type Tab = 'stock' | 'entrada' | 'conteo' | 'movimientos';

export default function Inventory() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'stock';
  return (
    <div className="page">
      <Tabs
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        options={[
          { value: 'stock', label: 'Existencias' },
          { value: 'entrada', label: 'Entrada' },
          { value: 'conteo', label: 'Conteo físico' },
          { value: 'movimientos', label: 'Movimientos' },
        ]}
      />
      {tab === 'stock' && <StockTab onlyLow={params.get('bajo') === '1'} />}
      {tab === 'entrada' && <EntryTab />}
      {tab === 'conteo' && <CountTab />}
      {tab === 'movimientos' && <MovementsTab />}
    </div>
  );
}

// ---------- Existencias ----------

function StockTab({ onlyLow }: { onlyLow: boolean }) {
  const catalog = useLiveQuery(() => loadCatalog(), []);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState<'' | StockStatus | 'reponer'>(onlyLow ? 'reponer' : '');
  const [adjust, setAdjust] = useState<{ p: ProductWithVariants; v: Variant } | null>(null);

  const categories = useMemo(() => [...new Set((catalog ?? []).map((p) => p.category).filter(Boolean))].sort(), [catalog]);
  const summary = useMemo(() => inventorySummary(catalog ?? []), [catalog]);

  const list = useMemo(() => {
    const n = normalize(q);
    return (catalog ?? []).filter((p) => {
      const st = stockStatus(p);
      if (status === 'reponer' ? st === 'disponible' : status && st !== status) return false;
      if (cat && p.category !== cat) return false;
      return !n || normalize(`${p.name} ${p.reference} ${p.category}`).includes(n);
    });
  }, [catalog, q, cat, status]);

  const pct = (n: number) => (summary.products ? fmtPct((n / summary.products) * 100) : '0%');

  if (!catalog) return null;

  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <div className="kpi-top">
            <span className="kpi-label">Total unidades</span>
            <span className="kpi-icon">
              <Icon name="box" size={18} />
            </span>
          </div>
          <div className="kpi-value">{fmtNum(summary.units)}</div>
          <div className="kpi-foot">
            Costo {fmtMoney(summary.cost)} · Venta {fmtMoney(summary.value)}
          </div>
        </div>
        {(
          [
            ['disponible', 'Disponible', 'ok', 'inventory'],
            ['poco', 'Poco stock', 'warn', 'alert'],
            ['agotado', 'Agotado', 'danger', 'alert'],
          ] as const
        ).map(([key, label, tone, icon]) => (
          <button
            key={key}
            className={`kpi kpi-filter ${status === key ? 'selected' : ''}`}
            onClick={() => setStatus(status === key ? '' : key)}
            aria-pressed={status === key}
          >
            <div className="kpi-top">
              <span className="kpi-label">{label}</span>
              <span className={`kpi-icon ${tone}`}>
                <Icon name={icon} size={18} />
              </span>
            </div>
            <div className="kpi-value">{summary.counts[key]}</div>
            <div className="kpi-foot">
              <span className={`badge no-dot badge-${tone === 'ok' ? 'ok' : tone}`}>{pct(summary.counts[key])}</span>
              <span>de {summary.products} productos</span>
            </div>
          </button>
        ))}
      </div>

      <div className="card filter-row">
        <SearchBox value={q} onChange={setQ} placeholder="Buscar producto o referencia" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Estado">
          <option value="">Todos los estados</option>
          <option value="disponible">Disponible</option>
          <option value="poco">Poco stock</option>
          <option value="agotado">Agotado</option>
          <option value="reponer">Por reponer (poco + agotado)</option>
        </select>
        <button className="btn btn-ghost" onClick={exportInventory}>
          Exportar Excel
        </button>
      </div>

      {catalog && list.length === 0 ? (
        <Empty>{catalog.length ? 'Ningún producto coincide con los filtros.' : 'No hay productos.'}</Empty>
      ) : (
        <div className="card flush table-wrap">
          <table className="table stack-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Tallas (toca para ajustar)</th>
                <th>Stock vs. mínimo</th>
                <th className="num">Valor al costo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
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
                        <button
                          key={v.id}
                          className={`size-tag clickable ${v.stock <= 0 ? 'zero' : ''}`}
                          title="Ajustar existencia"
                          onClick={() => setAdjust({ p, v })}
                        >
                          {v.size} <b>{v.stock}</b>
                        </button>
                      ))}
                    </div>
                  </td>
                  <td data-label="Stock / mín">
                    <StockBar p={p} />
                  </td>
                  <td data-label="Valor" className="num">
                    {fmtMoney(p.totalStock * p.cost)}
                  </td>
                  <td data-label="Estado">
                    <ProductStatus p={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adjust && <AdjustModal {...adjust} onClose={() => setAdjust(null)} />}
    </>
  );
}

function AdjustModal({ p, v, onClose }: { p: ProductWithVariants; v: Variant; onClose: () => void }) {
  const [stock, setStock] = useState<number | null>(v.stock);
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  const delta = (stock ?? 0) - v.stock;
  const save = async () => {
    const ok = await run(async () => {
      await adjustStock(v.id, stock ?? 0, note);
      return true;
    }, 'Existencia ajustada');
    if (ok) onClose();
  };
  return (
    <Modal
      title="Ajuste de inventario"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || delta === 0}>
            Guardar ajuste
          </button>
        </>
      }
    >
      <div className="form">
        <p>
          <strong>{p.name}</strong> · Talla {v.size} · Ref {p.reference}
        </p>
        <div className="grid-2">
          <Field label="Existencia actual">
            <input value={v.stock} disabled />
          </Field>
          <Field label="Nueva existencia">
            <NumberInput value={stock} onChange={setStock} autoFocus />
          </Field>
        </div>
        {delta !== 0 && (
          <p className={delta > 0 ? 'text-ok' : 'text-danger'}>
            {delta > 0 ? `+${delta}` : delta} unidades
          </p>
        )}
        <Field label="Motivo *">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: prenda averiada, error de registro" />
        </Field>
      </div>
    </Modal>
  );
}

// ---------- Entrada de mercancía ----------

interface EntryLine {
  variantId: number;
  label: string;
  qty: number;
}

function EntryTab() {
  const catalog = useLiveQuery(() => loadCatalog(), []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [lines, setLines] = useState<EntryLine[]>([]);
  const [note, setNote] = useState('');
  const { run, busy } = useAction();

  const results = useMemo(() => {
    const n = normalize(q);
    if (!n) return [];
    return (catalog ?? []).filter((p) => normalize(`${p.name} ${p.reference} ${p.category}`).includes(n)).slice(0, 15);
  }, [catalog, q]);

  const add = (p: ProductWithVariants, v: Variant) =>
    setLines((ls) =>
      ls.some((l) => l.variantId === v.id)
        ? ls.map((l) => (l.variantId === v.id ? { ...l, qty: l.qty + 1 } : l))
        : [...ls, { variantId: v.id, label: `${p.name} (${v.size}) · Ref ${p.reference}`, qty: 1 }],
    );

  const addAllSizes = (p: ProductWithVariants) => p.variants.forEach((v) => add(p, v));

  const save = async () => {
    const ok = await run(async () => {
      await registerEntry(lines, note.trim());
      return true;
    }, 'Entrada registrada');
    if (ok) {
      setLines([]);
      setNote('');
    }
  };

  const total = lines.reduce((a, l) => a + l.qty, 0);

  return (
    <div className="sale-layout">
      <section className="card">
        <SearchBox value={q} onChange={setQ} placeholder="Buscar producto para agregar" />
        {!q && <p className="muted small">Escribe para buscar. Si el producto no existe, créalo primero en Productos.</p>}
        <ul className="list product-pick">
          {results.map((p) => (
            <li key={p.id}>
              <button className="list-row pick-row" onClick={() => setOpen(open === p.id ? null : p.id)}>
                <div>
                  <strong>{p.name}</strong>
                  <div className="muted small">Ref {p.reference}</div>
                </div>
                <span className="muted small">{p.totalStock} und</span>
              </button>
              {open === p.id && (
                <div className="sizes">
                  {p.variants.map((v) => (
                    <button key={v.id} className="size-chip" onClick={() => add(p, v)}>
                      <strong>{v.size}</strong>
                      <span>tiene {v.stock}</span>
                    </button>
                  ))}
                  {p.variants.length > 1 && (
                    <button className="size-chip" onClick={() => addAllSizes(p)}>
                      <strong>Todas</strong>
                      <span>+1 c/u</span>
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Mercancía que entra</h2>
        {lines.length === 0 ? (
          <p className="muted">Agrega productos y tallas.</p>
        ) : (
          <ul className="list">
            {lines.map((l, i) => (
              <li key={l.variantId} className="list-row">
                <span className="grow">{l.label}</span>
                <NumberInput
                  className="input-sm num"
                  style={{ width: 80 }}
                  value={l.qty}
                  onChange={(n) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: n ?? 0 } : x)))}
                />
                <button className="icon-btn" aria-label="Quitar" onClick={() => setLines(lines.filter((_, k) => k !== i))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="form">
          <Field label="Nota (proveedor, factura de compra…)">
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="actions">
          <button className="btn btn-primary btn-lg grow" disabled={busy || total === 0} onClick={save}>
            Registrar entrada · {total} und
          </button>
        </div>
      </section>
    </div>
  );
}

// ---------- Conteo físico ----------

function CountTab() {
  const counts = useLiveQuery(() => db.counts.orderBy('date').reverse().toArray(), []);
  const catalog = useLiveQuery(() => loadCatalog(), []);
  const [category, setCategory] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const { run, busy } = useAction();
  const categories = [...new Set((catalog ?? []).map((p) => p.category).filter(Boolean))].sort();

  const start = async () => {
    const id = await run(() => createCount(category));
    if (id) setOpenId(id);
  };

  if (openId) return <CountSheet countId={openId} onBack={() => setOpenId(null)} />;

  return (
    <>
      <section className="card">
        <h2>Nuevo conteo</h2>
        <p className="muted small">
          Se toma una foto de las existencias actuales. Cuenta las prendas, registra las cantidades reales y al final aplica
          los ajustes.
        </p>
        <div className="row gap wrap">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={start} disabled={busy}>
            Iniciar conteo
          </button>
        </div>
      </section>
      {counts && counts.length > 0 && (
        <div className="card flush">
          <ul className="list">
            {counts.map((c) => {
              const done = c.lines.filter((l) => l.counted !== null).length;
              const diffs = c.lines.filter((l) => l.counted !== null && l.counted !== l.system).length;
              return (
                <li key={c.id}>
                  <button className="list-row pick-row" onClick={() => setOpenId(c.id)}>
                    <div>
                      <strong>Conteo #{c.id}</strong> {c.category && <span className="muted">· {c.category}</span>}
                      <div className="muted small">
                        {fmtDateTime(c.date)} · {done}/{c.lines.length} contadas · {diffs} diferencias
                      </div>
                    </div>
                    <span className={`badge ${c.status === 'abierto' ? 'badge-warn' : 'badge-ok'}`}>
                      {c.status === 'abierto' ? 'Abierto' : 'Aplicado'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

function CountSheet({ countId, onBack }: { countId: number; onBack: () => void }) {
  const count = useLiveQuery(() => db.counts.get(countId), [countId]);
  const [lines, setLines] = useState<CountLine[] | null>(null);
  const [q, setQ] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const { run, busy } = useAction();
  const confirm = useConfirm();

  useEffect(() => {
    if (count && !lines) setLines(count.lines);
  }, [count, lines]);

  if (!count || !lines) return null;
  const readOnly = count.status !== 'abierto';

  const setCounted = (variantId: number, counted: number | null) => {
    const next = lines.map((l) => (l.variantId === variantId ? { ...l, counted } : l));
    setLines(next);
    db.counts.update(countId, { lines: next } as Partial<InventoryCount>);
  };

  const n = normalize(q);
  const shown = lines.filter(
    (l) =>
      (!n || normalize(`${l.name} ${l.reference} ${l.size}`).includes(n)) &&
      (!onlyDiff || (l.counted !== null && l.counted !== l.system)),
  );
  const counted = lines.filter((l) => l.counted !== null);
  const diffs = counted.filter((l) => l.counted !== l.system);
  const missing = diffs.reduce((a, l) => a + Math.max(0, l.system - l.counted!), 0);
  const extra = diffs.reduce((a, l) => a + Math.max(0, l.counted! - l.system), 0);

  const apply = async () => {
    const pending = lines.length - counted.length;
    const ok = await confirm(
      `Se ajustarán ${diffs.length} tallas (faltan ${missing}, sobran ${extra} unidades).` +
        (pending ? `\n${pending} tallas sin contar NO se modificarán.` : '') +
        '\n¿Aplicar el conteo?',
      { confirmLabel: 'Aplicar conteo' },
    );
    if (!ok) return;
    run(() => applyCount(countId), 'Conteo aplicado al inventario');
  };

  return (
    <>
      <div className="row-between wrap gap">
        <button className="btn btn-ghost" onClick={onBack}>
          ← Conteos
        </button>
        <span className={`badge ${readOnly ? 'badge-ok' : 'badge-warn'}`}>{readOnly ? 'Aplicado' : 'Abierto'}</span>
      </div>
      <div className="stats small-stats">
        <div className="stat">
          <span className="stat-label">Contadas</span>
          <span className="stat-value">
            {counted.length}/{lines.length}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Con diferencia</span>
          <span className="stat-value">{diffs.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Faltantes</span>
          <span className="stat-value text-danger">{missing}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Sobrantes</span>
          <span className="stat-value text-ok">{extra}</span>
        </div>
      </div>
      <div className="card filters">
        <SearchBox value={q} onChange={setQ} placeholder="Buscar en el conteo" />
        <label className="check small">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Solo diferencias
        </label>
      </div>
      <div className="card flush table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Talla</th>
              <th className="num">Sistema</th>
              <th className="num">Contado</th>
              <th className="num">Dif.</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const d = l.counted === null ? null : l.counted - l.system;
              return (
                <tr key={l.variantId}>
                  <td>
                    {l.name}
                    <div className="muted small">Ref {l.reference}</div>
                  </td>
                  <td>{l.size}</td>
                  <td className="num">{l.system}</td>
                  <td className="num">
                    {readOnly ? (
                      (l.counted ?? '—')
                    ) : (
                      <NumberInput
                        className="input-sm num"
                        style={{ width: 70 }}
                        value={l.counted}
                        onChange={(v) => setCounted(l.variantId, v)}
                      />
                    )}
                  </td>
                  <td className={`num ${d ? (d > 0 ? 'text-ok' : 'text-danger') : ''}`}>
                    {d === null ? '' : d > 0 ? `+${d}` : d}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="actions">
          <button className="btn btn-primary btn-lg grow" onClick={apply} disabled={busy || counted.length === 0}>
            Aplicar ajustes al inventario
          </button>
        </div>
      )}
    </>
  );
}

// ---------- Movimientos ----------

function MovementsTab() {
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const data = useLiveQuery(async () => {
    const [movs, products, variants] = await Promise.all([
      db.movements.orderBy('date').reverse().limit(1500).toArray(),
      db.products.toArray(),
      db.variants.toArray(),
    ]);
    return { movs, pm: new Map(products.map((p) => [p.id, p])), vm: new Map(variants.map((v) => [v.id, v])) };
  }, []);

  const list = useMemo(() => {
    if (!data) return [];
    const n = normalize(q);
    return data.movs
      .filter((m) => {
        if (type && m.type !== type) return false;
        if (!n) return true;
        const p = data.pm.get(m.productId);
        return normalize(`${p?.name ?? ''} ${p?.reference ?? ''} ${m.note}`).includes(n);
      })
      .slice(0, 300);
  }, [data, q, type]);

  return (
    <>
      <div className="card filters">
        <SearchBox value={q} onChange={setQ} placeholder="Buscar producto o detalle" />
        <div className="row-between wrap gap">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Todos los tipos</option>
            {['entrada', 'venta', 'ajuste', 'conteo', 'anulacion', 'inicial'].map((t) => (
              <option key={t} value={t}>
                {movementLabel(t)}
              </option>
            ))}
          </select>
          <button className="btn btn-sm btn-ghost" onClick={exportMovements}>
            Exportar a Excel
          </button>
        </div>
      </div>
      {data && list.length === 0 ? (
        <Empty>No hay movimientos.</Empty>
      ) : (
        <div className="card flush table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Producto</th>
                <th>Tipo</th>
                <th className="num">Cant.</th>
                <th className="num">Queda</th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => {
                const p = data!.pm.get(m.productId);
                return (
                  <tr key={m.id}>
                    <td className="small nowrap">{fmtDateTime(m.date)}</td>
                    <td>
                      {p?.name ?? '(eliminado)'} <span className="muted">({data!.vm.get(m.variantId)?.size ?? '?'})</span>
                      <div className="muted small">{m.note}</div>
                    </td>
                    <td className="small">{movementLabel(m.type)}</td>
                    <td className={`num ${m.qty > 0 ? 'text-ok' : 'text-danger'}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                    <td className="num">{m.stockAfter}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
