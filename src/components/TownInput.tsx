import { useEffect, useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { knownTowns, resolveTown } from '../lib/ops';

/**
 * Campo de pueblo/ciudad con autocompletado de los pueblos ya usados.
 * Muestra cómo se guardará ("malaga" → "Málaga" si ya existe) y permite escribir uno nuevo.
 */
export default function TownInput({
  value,
  onChange,
  placeholder = 'Ej: San Gil',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const towns = useLiveQuery(knownTowns, []);
  const [hint, setHint] = useState<{ name: string; existing: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    if (!value.trim()) {
      setHint(null);
      return;
    }
    resolveTown(value).then((r) => alive && setHint(r));
    return () => {
      alive = false;
    };
  }, [value]);

  return (
    <>
      <input list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
      <datalist id={listId}>
        {towns?.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {hint && hint.name !== value && (
        <span className="field-hint dest-hint">
          {hint.existing === hint.name ? 'Ya existe: se usará ' : 'Se guardará como '}
          <b>{hint.name}</b>
        </span>
      )}
      {hint && hint.name === value && !hint.existing && towns && towns.length > 0 && (
        <span className="field-hint">Pueblo nuevo</span>
      )}
    </>
  );
}
