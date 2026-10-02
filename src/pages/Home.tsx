import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardData, PERIODS, type PeriodKey } from '../lib/stats';
import { fmtMoney, fmtNum } from '../lib/format';
import { Icon, type IconName } from '../components/Icon';
import { ChartCard, ChartEmpty, ColumnChart, fmtPct, SegmentBar, ShareBars, TrendChart, useChartColors } from '../components/charts';

const PERIOD_KEY = 'tienda.dashboardPeriod';

function readPeriod(): PeriodKey {
  try {
    const v = localStorage.getItem(PERIOD_KEY) as PeriodKey | null;
    return v && PERIODS.some((p) => p.value === v) ? v : '30d';
  } catch {
    return '30d';
  }
}

function Delta({ change, suffix = '%' }: { change: number | null; suffix?: string }) {
  if (change === null) return <span className="delta flat">Nuevo</span>;
  const r = Math.round(change * 10) / 10;
  if (r === 0) return <span className="delta flat">0{suffix}</span>;
  const up = r > 0;
  return (
    <span className={`delta ${up ? 'up' : 'down'}`}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={14} />
      {Math.abs(r).toLocaleString('es-CO', { maximumFractionDigits: 1 })}
      {suffix}
    </span>
  );
}

function Kpi({
  label,
  value,
  icon,
  tone,
  foot,
  to,
}: {
  label: string;
  value: string;
  icon: IconName;
  tone?: 'ok' | 'warn' | 'danger';
  foot?: React.ReactNode;
  to?: string;
}) {
  const body = (
    <>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className={`kpi-icon ${tone ?? ''}`}>
          <Icon name={icon} size={18} />
        </span>
      </div>
      <div className="kpi-value">{value}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="kpi">
      {body}
    </Link>
  ) : (
    <div className="kpi">{body}</div>
  );
}

export default function Home() {
  const [period, setPeriod] = useState<PeriodKey>(readPeriod);
  const d = useLiveQuery(() => dashboardData(period), [period]);
  const c = useChartColors();

  const choose = (p: PeriodKey) => {
    setPeriod(p);
    try {
      localStorage.setItem(PERIOD_KEY, p);
    } catch {
      /* preferencia solo de esta sesión */
    }
  };

  const periodLabel = PERIODS.find((p) => p.value === period)!.label.toLowerCase();

  return (
    <div className="page">
      <div className="period-bar">
        <div className="segmented" role="tablist" aria-label="Periodo">
          {PERIODS.map((p) => (
            <button key={p.value} role="tab" aria-selected={period === p.value} className={period === p.value ? 'active' : ''} onClick={() => choose(p.value)}>
              {p.label}
            </button>
          ))}
        </div>
        {d && <span className="muted small">Variación {d.compareLabel}</span>}
      </div>

      {d && (
        <>
          <div className="kpis">
            <Kpi label="Ventas totales" value={fmtMoney(d.kpi.total.value)} icon="money" foot={<Delta change={d.kpi.total.change} />} to="/ventas" />
            <Kpi label="Número de ventas" value={fmtNum(d.kpi.count.value)} icon="receipt" foot={<Delta change={d.kpi.count.change} />} to="/ventas" />
            <Kpi label="Ticket promedio" value={fmtMoney(d.kpi.ticket.value)} icon="ticket" foot={<Delta change={d.kpi.ticket.change} />} />
            <Kpi label="Unidades vendidas" value={fmtNum(d.kpi.units.value)} icon="box" foot={<Delta change={d.kpi.units.change} />} />
            <Kpi
              label="Margen bruto"
              value={d.kpi.margin.value === null ? '—' : fmtPct(d.kpi.margin.value, 1)}
              icon="percent"
              tone="ok"
              foot={
                d.kpi.margin.diff === null ? (
                  <span>Precio de venta vs. costo</span>
                ) : (
                  <>
                    <Delta change={d.kpi.margin.diff} suffix=" pts" />
                    <span>vs. costo</span>
                  </>
                )
              }
            />
            <Kpi
              label="Cartera por cobrar"
              value={fmtMoney(d.kpi.cartera.value)}
              icon="wallet"
              tone={d.kpi.cartera.value > 0 ? 'warn' : undefined}
              foot={<span>{d.kpi.cartera.debtors} {d.kpi.cartera.debtors === 1 ? 'cliente debe' : 'clientes deben'}</span>}
              to="/clientes?filtro=deben"
            />
            <Kpi
              label="Inventario al costo"
              value={fmtMoney(d.kpi.inventory.cost)}
              icon="warehouse"
              foot={<span>Venta: {fmtMoney(d.kpi.inventory.value)} · {fmtNum(d.kpi.inventory.units)} und</span>}
              to="/inventario"
            />
            <Kpi
              label="Poco stock / agotados"
              value={`${d.kpi.stock.low} / ${d.kpi.stock.out}`}
              icon="alert"
              tone={d.kpi.stock.out > 0 ? 'danger' : d.kpi.stock.low > 0 ? 'warn' : 'ok'}
              foot={<span>de {d.kpi.stock.products} productos</span>}
              to="/inventario?tab=stock&bajo=1"
            />
          </div>

          <div className="dash-grid">
            <ChartCard
              className="span-2"
              title={period === 'hoy' ? 'Ventas por hora' : period === 'ano' ? 'Ventas por mes' : 'Ventas por día'}
              subtitle={`Total vendido · ${periodLabel}`}
            >
              {d.hasSales ? <TrendChart data={d.series} height={260} /> : <ChartEmpty text="No hay ventas en este periodo." />}
            </ChartCard>

            <ChartCard title="Contado vs. crédito" subtitle="Participación en el total vendido">
              <SegmentBar
                parts={[
                  { label: 'Contado', value: d.payment.contado, color: c.series[0] },
                  { label: 'Crédito', value: d.payment.credito, color: c.series[1] },
                ]}
              />
            </ChartCard>

            <ChartCard title="Ventas por categoría" subtitle="% de participación en ventas">
              {d.categories.length ? (
                <ShareBars data={d.categories.slice(0, 6).map((x) => ({ name: x.name, value: x.total, pct: x.pct }))} />
              ) : (
                <ChartEmpty />
              )}
            </ChartCard>

            <ChartCard title="Top 5 productos" subtitle="Por unidades vendidas">
              {d.top.length ? (
                <ol className="top-list">
                  {d.top.map((p, i) => (
                    <li key={p.id} className="top-item">
                      <span className="top-rank">{i + 1}</span>
                      <div title={`${p.name}: ${p.units} und · ${fmtMoney(p.revenue)}`}>
                        <div className="share-row">
                          <span className="share-name">{p.name}</span>
                          <span className="share-value">
                            {p.units} und <span className="share-pct">{fmtPct(p.pct)}</span>
                          </span>
                        </div>
                        <div className="progress">
                          <span style={{ width: `${(p.units / d.top[0].units) * 100}%` }} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <ChartEmpty icon="products" />
              )}
            </ChartCard>

            <ChartCard title="Estado del inventario" subtitle={`${d.inventory.products} productos activos`}>
              {d.inventory.products ? (
                <SegmentBar
                  fmt="number"
                  parts={[
                    { label: 'Disponible', value: d.inventory.counts.disponible, color: c.good },
                    { label: 'Poco stock', value: d.inventory.counts.poco, color: c.warning },
                    { label: 'Agotado', value: d.inventory.counts.agotado, color: c.critical },
                  ]}
                />
              ) : (
                <ChartEmpty icon="inventory" text="Aún no hay productos." />
              )}
            </ChartCard>

            <ChartCard className="span-2" title="Ventas por día de la semana" subtitle="Qué días se vende más">
              {d.hasSales ? (
                <ColumnChart data={d.weekday} x="label" y="total" extra={(p) => `${p.count} ventas`} />
              ) : (
                <ChartEmpty />
              )}
            </ChartCard>

            <ChartCard title="Ventas por talla" subtitle="Unidades vendidas">
              {d.sizes.length ? <ColumnChart data={d.sizes} x="size" y="units" fmt="units" /> : <ChartEmpty />}
            </ChartCard>

            <ChartCard
              title="Poco stock"
              subtitle="Productos por reponer"
              action={
                <Link to="/inventario?tab=stock&bajo=1" className="link small">
                  Ver todo
                </Link>
              }
            >
              {d.low.length ? (
                <ul className="list">
                  {d.low.map((p) => (
                    <li key={p.id} className="list-row">
                      <div>
                        <strong>{p.name}</strong>
                        <div className="muted small">Ref {p.reference}</div>
                      </div>
                      {p.totalStock <= 0 ? (
                        <span className="badge badge-danger">Agotado</span>
                      ) : (
                        <span className="badge badge-warn">
                          {p.totalStock} / mín {p.minStock}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <ChartEmpty icon="inventory" text="Todo el inventario está por encima del mínimo." />
              )}
            </ChartCard>

            <ChartCard
              className="span-2"
              title="Clientes que más deben"
              subtitle="Saldo pendiente actual"
              action={
                <Link to="/clientes?filtro=deben" className="link small">
                  Ver cartera
                </Link>
              }
            >
              {d.debtors.length ? (
                <ul className="list">
                  {d.debtors.map((x) => (
                    <li key={x.id}>
                      <Link to={`/clientes/${x.id}`} className="list-row pick-row">
                        <div className="row-main">
                          <span className="avatar">{x.name.slice(0, 1).toUpperCase()}</span>
                          <div>
                            <strong>{x.name}</strong>
                            <div className="muted small">{x.phone || 'Sin celular'}</div>
                          </div>
                        </div>
                        <div className="right">
                          <strong>{fmtMoney(x.balance)}</strong>
                          {x.days !== null && (
                            <span className={`badge ${x.days > 60 ? 'badge-danger' : x.days > 30 ? 'badge-warn' : 'badge-info'}`}>
                              {x.days} días
                            </span>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <ChartEmpty icon="wallet" text="Ningún cliente tiene saldo pendiente." />
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
