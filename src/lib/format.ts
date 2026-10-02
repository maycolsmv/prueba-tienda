const money = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

export const fmtMoney = (n: number) => money.format(Math.round(n || 0));

export const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });

export const fmtDateTime = (t: number) =>
  new Date(t).toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export const fmtNum = (n: number) => new Intl.NumberFormat('es-CO').format(n);

/** Convierte "45.000", "45,000" o "45000" a número. */
export function parseMoney(v: string | number): number {
  if (typeof v === 'number') return v;
  const clean = v.replace(/[^\d-]/g, '');
  return clean ? Number(clean) : 0;
}

/** yyyy-mm-dd en hora local, para inputs de tipo date. */
export function toDateInput(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function startOfDay(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function endOfDay(s: string) {
  return startOfDay(s) + 86_400_000 - 1;
}

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

export const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'U', 'UNICA'];

export function compareSizes(a: string, b: string) {
  const ia = SIZE_ORDER.indexOf(a.toUpperCase());
  const ib = SIZE_ORDER.indexOf(b.toUpperCase());
  if (ia >= 0 && ib >= 0) return ia - ib;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return a.localeCompare(b);
}

// ---------- Destinos de viaje ----------

/** Conectores que van en minúscula dentro de un nombre (salvo al inicio). */
const CONNECTORS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e']);

/**
 * Limpia un destino: espacios de sobra fuera y mayúscula inicial en cada palabra,
 * con los conectores en minúscula. No agrega ni quita tildes.
 * "  san   juan de pasto " → "San Juan de Pasto"
 */
export function formatDestination(s: string) {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w, i) => {
      const lower = w.toLocaleLowerCase('es-CO');
      if (i > 0 && CONNECTORS.has(lower)) return lower;
      // También después de guion o punto: "villa-rica" → "Villa-Rica", "d.c." → "D.C."
      return lower.replace(/(^|[-.])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toLocaleUpperCase('es-CO'));
    })
    .join(' ');
}

/** Clave para comparar destinos sin importar mayúsculas, tildes ni espacios. */
export const destinationKey = (s: string) => normalize(s).replace(/\s+/g, ' ');

const accents = (s: string) => s.normalize('NFD').replace(/[^\u0300-\u036f]/g, '').length;

/**
 * Nombre a mostrar para un grupo de escrituras del mismo destino:
 * la que tiene tildes y, si empatan, la más usada.
 */
export function canonicalDestination(spellings: string[]) {
  const count = new Map<string, number>();
  for (const s of spellings) count.set(s, (count.get(s) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => accents(b[0]) - accents(a[0]) || b[1] - a[1])[0]?.[0] ?? '';
}

/** Agrupa nombres de destino por su clave normalizada → nombre a mostrar. */
export function destinationNames(spellings: string[]) {
  const groups = new Map<string, string[]>();
  for (const s of spellings) {
    const k = destinationKey(s);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return new Map([...groups.entries()].map(([k, v]) => [k, canonicalDestination(v)]));
}
