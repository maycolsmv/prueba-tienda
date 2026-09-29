import { useState } from 'react';
import { deleteProduct, saveProduct, type ProductDraft, type ProductWithVariants, type VariantDraft } from '../lib/ops';
import { Field, Modal, MoneyInput, NumberInput, useAction, useConfirm, useToast } from './ui';

const QUICK_SIZES = [
  ['XS', 'S', 'M', 'L', 'XL'],
  ['28', '30', '32', '34', '36'],
  ['U'],
];

export default function ProductForm({
  product,
  categories,
  onClose,
}: {
  product?: ProductWithVariants;
  categories: string[];
  onClose: () => void;
}) {
  const [d, setD] = useState<ProductDraft>(
    product ?? { reference: '', name: '', category: '', price: 0, cost: 0, minStock: 0 },
  );
  const [variants, setVariants] = useState<VariantDraft[]>(
    product?.variants.map((v) => ({ id: v.id, size: v.size, stock: v.stock })) ?? [],
  );
  const [newSize, setNewSize] = useState('');
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const toast = useToast();

  const addSizes = (sizes: string[]) =>
    setVariants((vs) => [
      ...vs,
      ...sizes.filter((s) => s && !vs.some((v) => v.size.toUpperCase() === s.toUpperCase())).map((size) => ({ size, stock: 0 })),
    ]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => saveProduct(d, variants), product ? 'Producto actualizado' : 'Producto creado');
    if (ok) onClose();
  };

  const remove = async () => {
    if (!product) return;
    const ok = await confirm(
      `¿Eliminar "${product.name}"?\n\nSi ya tiene ventas no se borra: se desactiva para conservar el historial (puedes verlo con "Mostrar inactivos").`,
      { confirmLabel: 'Eliminar', danger: true },
    );
    if (!ok) return;
    const r = await run(() => deleteProduct(product.id));
    if (!r) return;
    toast(r === 'eliminado' ? 'Producto eliminado' : 'El producto tiene ventas: quedó desactivado');
    onClose();
  };

  return (
    <Modal
      title={product ? 'Editar producto' : 'Nuevo producto'}
      onClose={onClose}
      footer={
        <>
          {product && (
            <button className="btn btn-danger-ghost" onClick={remove} disabled={busy}>
              Eliminar
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" form="product-form" disabled={busy}>
            Guardar
          </button>
        </>
      }
    >
      <form id="product-form" className="form" onSubmit={submit}>
        <div className="grid-2">
          <Field label="Referencia *">
            <input value={d.reference} onChange={(e) => setD({ ...d, reference: e.target.value })} required autoFocus={!product} />
          </Field>
          <Field label="Categoría">
            <input list="cat-list" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} />
            <datalist id="cat-list">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label="Nombre *">
          <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} required />
        </Field>
        <div className="grid-3">
          <Field label="Precio de venta">
            <MoneyInput value={d.price} onChange={(price) => setD({ ...d, price })} />
          </Field>
          <Field label="Costo">
            <MoneyInput value={d.cost} onChange={(cost) => setD({ ...d, cost })} />
          </Field>
          <Field label="Stock mínimo" hint="Alerta de poco stock">
            <NumberInput value={d.minStock} onChange={(n) => setD({ ...d, minStock: n ?? 0 })} />
          </Field>
        </div>
        {product && (
          <label className="check">
            <input type="checkbox" checked={d.active ?? true} onChange={(e) => setD({ ...d, active: e.target.checked })} />
            Producto activo (visible para vender)
          </label>
        )}

        <fieldset className="fieldset">
          <legend>Tallas</legend>
          {variants.length > 0 && (
            <table className="table compact">
              <thead>
                <tr>
                  <th>Talla</th>
                  <th className="num">{product ? 'Existencia' : 'Existencia inicial'}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {variants.map((v, i) => (
                  <tr key={v.id ?? `n${i}`}>
                    <td>
                      <input
                        className="input-sm"
                        value={v.size}
                        onChange={(e) => setVariants(variants.map((x, k) => (k === i ? { ...x, size: e.target.value } : x)))}
                      />
                    </td>
                    <td className="num">
                      {v.id ? (
                        <span title="Para cambiarla usa Inventario → Entrada o Ajuste">{v.stock}</span>
                      ) : (
                        <NumberInput
                          className="input-sm num"
                          value={v.stock}
                          onChange={(n) => setVariants(variants.map((x, k) => (k === i ? { ...x, stock: n ?? 0 } : x)))}
                        />
                      )}
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Quitar talla ${v.size}`}
                        onClick={() => setVariants(variants.filter((_, k) => k !== i))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row gap wrap">
            <input
              className="input-sm"
              style={{ width: 90 }}
              placeholder="Talla"
              value={newSize}
              onChange={(e) => setNewSize(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSizes([newSize.trim()]);
                  setNewSize('');
                }
              }}
            />
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                addSizes([newSize.trim()]);
                setNewSize('');
              }}
            >
              + Agregar
            </button>
            {QUICK_SIZES.map((set) => (
              <button type="button" key={set.join()} className="btn btn-sm btn-ghost" onClick={() => addSizes(set)}>
                {set.join(' ')}
              </button>
            ))}
          </div>
          {product && <p className="muted small">Para cambiar existencias usa Inventario → Entrada o Ajuste.</p>}
        </fieldset>
      </form>
    </Modal>
  );
}
