/**
 * Single-series bar chart of program transactions per time bucket (plain SVG, no chart lib).
 * Data-viz rules applied: one hue (series-1), thin bars with a 2px gap, rounded data-end anchored
 * to the baseline, recessive grid, per-bar hover tooltip with a hit target larger than the mark,
 * and a table view for accessibility.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { type ActivityBucket, formatBucketLabel } from "./lib/solana";

interface Props {
  buckets: ActivityBucket[];
  bucketSeconds: number;
}

const H = 180;
const PAD = { top: 12, right: 8, bottom: 22, left: 32 };

function niceMax(v: number): number {
  if (v <= 4) return Math.max(1, v);
  const pow = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / pow) * pow;
}

export default function ActivityChart({ buckets, bucketSeconds }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  // Measure the real width so SVG text stays at its CSS pixel size instead of scaling with a viewBox.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable, buckets.length]);
  const max = useMemo(() => niceMax(Math.max(0, ...buckets.map((b) => b.ok + b.failed))), [buckets]);

  if (buckets.length === 0) return <p className="muted">Нет транзакций с block time для построения графика.</p>;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / buckets.length;
  const barW = Math.min(28, Math.max(2, slot - 2)); // 2px surface gap between bars, thin even when buckets are few
  const barOffset = (slot - barW) / 2;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max].map((t) => Math.round(t));
  const labelEvery = Math.ceil(buckets.length / 6);
  const hb = hover !== null ? buckets[hover] : null;

  return (
    <div className="chart">
      <div className="chart-head">
        <span className="muted small">Интервал: {bucketSeconds >= 3600 ? `${bucketSeconds / 3600} ч` : `${bucketSeconds / 60} мин`}</span>
        <button className="link" onClick={() => setAsTable((v) => !v)}>
          {asTable ? "Показать график" : "Показать таблицей"}
        </button>
      </div>

      {asTable ? (
        <table>
          <thead>
            <tr>
              <th>Начало интервала</th>
              <th className="num">Успешно</th>
              <th className="num">С ошибкой</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.start}>
                <td>{new Date(b.start * 1000).toLocaleString()}</td>
                <td className="num">{b.ok}</td>
                <td className="num">{b.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-wrap" ref={wrapRef}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Транзакции программы по времени" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
                <text className="axis" x={PAD.left - 6} y={y(t) + 3} textAnchor="end">
                  {t}
                </text>
              </g>
            ))}
            {buckets.map((b, i) => {
              const total = b.ok + b.failed;
              const x = PAD.left + i * slot + barOffset;
              const h = Math.max(0, y(0) - y(total));
              const r = Math.min(4, barW / 2, h);
              // rounded top (data end), square bottom anchored to the baseline
              const d =
                h <= 0
                  ? ""
                  : `M${x},${y(0)} V${y(total) + r} Q${x},${y(total)} ${x + r},${y(total)} H${x + barW - r} Q${x + barW},${y(total)} ${x + barW},${y(total) + r} V${y(0)} Z`;
              return (
                <g key={b.start}>
                  {d && <path d={d} className={`bar ${hover === i ? "bar-hover" : ""}`} />}
                  <rect
                    x={PAD.left + i * slot}
                    y={PAD.top}
                    width={slot}
                    height={innerH}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                  />
                  {i % labelEvery === 0 && (
                    <text className="axis" x={x + barW / 2} y={H - 6} textAnchor="middle">
                      {formatBucketLabel(b.start, bucketSeconds)}
                    </text>
                  )}
                </g>
              );
            })}
            <line className="baseline" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
          </svg>
          {hb && hover !== null && (
            <div className="tooltip" style={{ left: PAD.left + hover * slot + slot / 2 }}>
              <strong>{new Date(hb.start * 1000).toLocaleString()}</strong>
              <div>
                {hb.ok + hb.failed} tx · {hb.failed} с ошибкой
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
