import { useEffect, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtMoney, fmtNum } from '../lib/format';
import { Icon, type IconName } from './Icon';

// ---------- Colores (leídos de los tokens CSS para respetar modo claro/oscuro) ----------

interface ChartColors {
  series: string[];
  grid: string;
  axis: string;
  muted: string;
  surface: string;
  good: string;
  warning: string;
  critical: string;
}

function readColors(): ChartColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--series-${i}`)),
    grid: v('--chart-grid'),
    axis: v('--chart-axis'),
    muted: v('--muted'),
    surface: v('--surface'),
    good: v('--status-good'),
    warning: v('--status-warning'),
    critical: v('--status-critical'),
  };
}

export function useChartColors() {
  const [c, setC] = useState(readColors);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setC(readColors());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return c;
}

/** Abrevia montos para los ejes: 1.250.000 → 1,3 M */
export function shortMoney(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  if (a >= 1_000) return `$${Math.round(n / 1_000)} mil`;
  return `$${n}`;
}

export const fmtPct = (n: number, digits = 0) => `${n.toLocaleString('es-CO', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;

// ---------- Contenedores ----------

export function ChartCard({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card chart-card ${className}`}>
      <header className="chart-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="chart-sub">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function ChartEmpty({ icon = 'chart', text = 'Aún no hay datos en este periodo.' }: { icon?: IconName; text?: string }) {
  return (
    <div className="chart-empty">
      <span className="chart-empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <p>{text}</p>
    </div>
  );
}

// ---------- Tooltip ----------

type Fmt = 'money' | 'units' | 'number';
const format = (v: number, f: Fmt) => (f === 'money' ? fmtMoney(v) : f === 'units' ? `${fmtNum(v)} und` : fmtNum(v));

interface TipProps {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ value?: unknown; color?: string; payload?: unknown }>;
}

function makeTooltip(fmt: Fmt, extra?: (payload: Record<string, unknown>) => string | null) {
  return function ChartTooltip({ active, payload, label }: TipProps) {
    if (!active || !payload?.length) return null;
    const p = payload[0];
    const more = extra?.(p.payload as Record<string, unknown>);
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-label">{label}</div>
        <div className="chart-tooltip-value">
          <span className="swatch" style={{ background: p.color }} />
          {format(Number(p.value), fmt)}
        </div>
        {more && <div className="chart-tooltip-extra">{more}</div>}
      </div>
    );
  };
}

// ---------- Gráficas ----------

/** Tendencia en el tiempo (área). Una sola serie: el título de la tarjeta la nombra. */
export function TrendChart({ data, height = 240 }: { data: { label: string; total: number; count: number }[]; height?: number }) {
  const c = useChartColors();
  const color = c.series[0];
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: c.axis }} tick={{ fill: c.muted, fontSize: 11 }} minTickGap={18} />
          <YAxis tickFormatter={shortMoney} tickLine={false} axisLine={false} tick={{ fill: c.muted, fontSize: 11 }} width={64} />
          <Tooltip
            content={makeTooltip('money', (p) => `${p.count} ${p.count === 1 ? 'venta' : 'ventas'}`)}
            cursor={{ stroke: c.axis, strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke={color}
            strokeWidth={2}
            fill="url(#trend-fill)"
            activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2, fill: color }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barras verticales de una serie (tallas, días de la semana, antigüedad). */
export function ColumnChart<T extends Record<string, unknown>>({
  data,
  x,
  y,
  fmt = 'money',
  height = 220,
  colorIndex = 0,
  extra,
}: {
  data: T[];
  x: keyof T & string;
  y: keyof T & string;
  fmt?: Fmt;
  height?: number;
  colorIndex?: number;
  extra?: (p: Record<string, unknown>) => string | null;
}) {
  const c = useChartColors();
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey={x as string} tickLine={false} axisLine={{ stroke: c.axis }} tick={{ fill: c.muted, fontSize: 11 }} interval={0} />
          <YAxis
            tickFormatter={fmt === 'money' ? shortMoney : (n: number) => fmtNum(n)}
            tickLine={false}
            axisLine={false}
            tick={{ fill: c.muted, fontSize: 11 }}
            width={fmt === 'money' ? 64 : 36}
            allowDecimals={false}
          />
          <Tooltip content={makeTooltip(fmt, extra)} cursor={{ fill: c.grid, opacity: 0.5 }} />
          <Bar dataKey={y as string} fill={c.series[colorIndex]} radius={[4, 4, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barras horizontales con etiqueta de % de participación. */
export function ShareBars({
  data,
  fmt = 'money',
}: {
  data: { name: string; value: number; pct: number }[];
  fmt?: Fmt;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="share-bars">
      {data.map((d) => (
        <li key={d.name} title={`${d.name}: ${format(d.value, fmt)} (${fmtPct(d.pct, 1)})`}>
          <div className="share-row">
            <span className="share-name">{d.name}</span>
            <span className="share-value">
              {format(d.value, fmt)} <span className="share-pct">{fmtPct(d.pct)}</span>
            </span>
          </div>
          <div className="progress">
            <span style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Dinero recibido por medio de pago (efectivo, Nequi, transferencia, otro). */
export function MethodsBar({ methods }: { methods: Record<'efectivo' | 'nequi' | 'transferencia' | 'otro', number> }) {
  const c = useChartColors();
  return (
    <SegmentBar
      parts={[
        { label: 'Efectivo', value: methods.efectivo, color: c.series[0] },
        { label: 'Nequi', value: methods.nequi, color: c.series[1] },
        { label: 'Transferencia', value: methods.transferencia, color: c.series[2] },
        { label: 'Otro', value: methods.otro, color: c.series[3] },
      ]}
    />
  );
}

/** Barra segmentada (partes de un total) con leyenda y %; hover muestra el valor. */
export function SegmentBar({
  parts,
  fmt = 'money',
}: {
  parts: { label: string; value: number; color: string }[];
  fmt?: Fmt;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <ChartEmpty />;
  return (
    <div className="segment">
      <div className="segment-bar" role="img" aria-label={parts.map((p) => `${p.label} ${fmtPct((p.value / total) * 100)}`).join(', ')}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span
              key={p.label}
              style={{ flexGrow: p.value, background: p.color }}
              title={`${p.label}: ${format(p.value, fmt)} (${fmtPct((p.value / total) * 100, 1)})`}
            />
          ))}
      </div>
      <ul className="segment-legend">
        {parts.map((p) => (
          <li key={p.label}>
            <span className="swatch" style={{ background: p.color }} />
            <span className="segment-label">{p.label}</span>
            <strong>{fmtPct((p.value / total) * 100)}</strong>
            <span className="muted small">{format(p.value, fmt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
