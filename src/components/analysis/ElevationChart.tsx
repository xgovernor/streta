import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ElevationProfileResult, ElevationSample } from "../../lib/gis/tiledBackend";
import { flyToCoordinate, setProfileHoverCoord } from "../../map/mapController";
import { ArrowDownRight, ArrowUpRight, Mountain, Ruler, TrendingUp } from "lucide-react";

interface ElevationChartProps {
  data: ElevationProfileResult;
}

export function ElevationChart({ data }: ElevationChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Clean up map hover indicator on unmount
  useEffect(() => {
    return () => {
      setProfileHoverCoord(null);
    };
  }, []);

  const samples = data.samples;
  const count = samples.length;

  const width = 360;
  const height = 140;
  const margin = { top: 16, right: 14, bottom: 24, left: 42 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  const { minElev, maxElev, totalDist } = useMemo(() => {
    let minE = data.min_elevation_m;
    let maxE = data.max_elevation_m;
    if (minE === maxE) {
      minE -= 5;
      maxE += 5;
    }
    // Add 10% breathing room to elevation range
    const pad = (maxE - minE) * 0.1 || 2;
    return {
      minElev: Math.floor(minE - pad),
      maxElev: Math.ceil(maxE + pad),
      totalDist: data.total_distance_m || 1,
    };
  }, [data]);

  const netElevation = useMemo(() => {
    if (data.net_elevation_m != null) return data.net_elevation_m;
    if (count > 1) {
      return Math.round((samples[count - 1].elevation_m - samples[0].elevation_m) * 10) / 10;
    }
    return 0;
  }, [data.net_elevation_m, samples, count]);

  const avgElevation = useMemo(() => {
    if (data.avg_elevation_m != null) return data.avg_elevation_m;
    if (count > 0) {
      return Math.round(samples.reduce((acc, s) => acc + s.elevation_m, 0) / count);
    }
    return 0;
  }, [data.avg_elevation_m, samples, count]);

  const maxSlope = useMemo(() => {
    if (data.max_slope_pct != null) return data.max_slope_pct;
    let max = 0;
    for (let i = 1; i < count; i++) {
      const dd = samples[i].distance_m - samples[i - 1].distance_m;
      const dz = samples[i].elevation_m - samples[i - 1].elevation_m;
      if (dd > 0.1) {
        max = Math.max(max, Math.abs((dz / dd) * 100));
      }
    }
    return Math.round(max * 10) / 10;
  }, [data.max_slope_pct, samples, count]);

  const svgPaths = useMemo<{ linePath: string; areaPath: string }>((): { linePath: string; areaPath: string } => {
    if (!count) return { linePath: "", areaPath: "" };

    const points = samples.map((s, idx) => {
      const frac = count > 1 ? idx / (count - 1) : 0;
      const x = margin.left + frac * chartW;
      const yFrac = (s.elevation_m - minElev) / (maxElev - minElev);
      const y = margin.top + chartH - yFrac * chartH;
      return { x, y };
    });

    let line = "";
    let area = "";

    points.forEach((p, idx) => {
      if (idx === 0) {
        line += `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        area += `M ${p.x.toFixed(1)} ${margin.top + chartH} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      } else {
        line += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        area += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      }
    });

    const bottomY = margin.top + chartH;
    const lastX = points[points.length - 1].x;
    const firstX = points[0].x;
    area += ` L ${lastX.toFixed(1)} ${bottomY} L ${firstX.toFixed(1)} ${bottomY} Z`;

    return { linePath: line, areaPath: area };
  }, [samples, count, minElev, maxElev, chartW, chartH, margin]);

  const { linePath, areaPath } = svgPaths;

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || !count) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const scaleX = width / rect.width;
    const clientX = (e.clientX - rect.left) * scaleX;
    const relX = clientX - margin.left;

    if (relX < 0 || relX > chartW) {
      setHoverIndex(null);
      setProfileHoverCoord(null);
      return;
    }

    const frac = Math.max(0, Math.min(1, relX / chartW));
    const idx = Math.min(Math.round(frac * (count - 1)), count - 1);
    setHoverIndex(idx);

    const s = samples[idx];
    if (s) {
      setProfileHoverCoord([s.lon, s.lat], s.elevation_m, s.slope_pct);
    }
  };

  const handlePointerLeave = () => {
    setHoverIndex(null);
    setProfileHoverCoord(null);
  };

  const handleClick = () => {
    if (activeSample) {
      flyToCoordinate(activeSample.lon, activeSample.lat, 14);
    }
  };

  const activeSample: ElevationSample | null =
    hoverIndex !== null && samples[hoverIndex] ? samples[hoverIndex] : null;

  const activeX =
    hoverIndex !== null && count > 1
      ? margin.left + (hoverIndex / (count - 1)) * chartW
      : 0;

  const activeY =
    activeSample
      ? margin.top + chartH - ((activeSample.elevation_m - minElev) / (maxElev - minElev)) * chartH
      : 0;

  return (
    <div className="flex flex-col gap-2 rounded-[2px] border border-line bg-tint p-2.5">
      {/* Metric summary banner */}
      <div className="grid grid-cols-4 gap-1 rounded-[2px] bg-solid p-1.5 text-[10px]">
        <div className="flex flex-col items-center">
          <span className="text-[8.5px] uppercase tracking-wider text-ink-muted">Min</span>
          <span className="font-mono font-semibold text-ink">
            {Math.round(data.min_elevation_m)}m
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[8.5px] uppercase tracking-wider text-ink-muted">Max</span>
          <span className="font-mono font-semibold text-ink">
            {Math.round(data.max_elevation_m)}m
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="flex items-center gap-0.5 text-[8.5px] uppercase tracking-wider text-ink-muted">
            <ArrowUpRight size={10} className="text-ok" /> Gain
          </span>
          <span className="font-mono font-semibold text-ok">
            +{Math.round(data.elevation_gain_m)}m
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="flex items-center gap-0.5 text-[8.5px] uppercase tracking-wider text-ink-muted">
            <ArrowDownRight size={10} className="text-critical" /> Loss
          </span>
          <span className="font-mono font-semibold text-critical">
            -{Math.round(data.elevation_loss_m)}m
          </span>
        </div>
      </div>

      {/* Secondary Topographic Stats */}
      <div className="grid grid-cols-4 gap-1 rounded-[2px] border border-line/60 bg-solid/50 px-1.5 py-1 text-[9.5px]">
        <div className="flex flex-col items-center">
          <span className="text-[9.5px] uppercase tracking-wider text-ink-muted">Net Δ</span>
          <span className="font-mono font-semibold text-ink">
            {netElevation >= 0 ? "+" : ""}
            {Math.round(netElevation)}m
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[9.5px] uppercase tracking-wider text-ink-muted">Avg Elev</span>
          <span className="font-mono font-semibold text-ink">
            {Math.round(avgElevation)}m
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[9.5px] uppercase tracking-wider text-ink-muted">Max Slope</span>
          <span className="font-mono font-semibold text-ink">
            {maxSlope != null ? `${maxSlope}%` : "—"}
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[9.5px] uppercase tracking-wider text-ink-muted">Peak Dist</span>
          <span className="font-mono font-semibold text-ink">
            {data.peak_distance_m != null
              ? `${(data.peak_distance_m / 1000).toFixed(1)} km`
              : "—"}
          </span>
        </div>
      </div>

      {/* SVG Elevation Cross-Section */}
      <div className="relative overflow-hidden rounded-[2px] border border-line bg-solid/80">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full cursor-crosshair select-none"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onClick={handleClick}
        >
          <defs>
            <linearGradient id="strata-elev-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--accent)", stopOpacity: 0.45 }} />
              <stop offset="60%" style={{ stopColor: "var(--accent)", stopOpacity: 0.12 }} />
              <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>

          {/* Gridlines */}
          <line
            x1={margin.left}
            y1={margin.top}
            x2={margin.left + chartW}
            y2={margin.top}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="2 3"
          />
          <line
            x1={margin.left}
            y1={margin.top + chartH / 2}
            x2={margin.left + chartW}
            y2={margin.top + chartH / 2}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="2 3"
          />
          <line
            x1={margin.left}
            y1={margin.top + chartH}
            x2={margin.left + chartW}
            y2={margin.top + chartH}
            stroke="rgba(255,255,255,0.18)"
          />

          {/* Y Axis Labels */}
          <text
            x={margin.left - 5}
            y={margin.top + 3}
            fontSize="8.5"
            textAnchor="end"
            style={{ fill: "var(--text-muted)" }}
            fontFamily="monospace"
          >
            {maxElev}m
          </text>
          <text
            x={margin.left - 5}
            y={margin.top + chartH + 3}
            fontSize="8.5"
            textAnchor="end"
            style={{ fill: "var(--text-muted)" }}
            fontFamily="monospace"
          >
            {minElev}m
          </text>

          {/* X Axis Labels */}
          <text
            x={margin.left}
            y={margin.top + chartH + 15}
            fontSize="8.5"
            textAnchor="start"
            style={{ fill: "var(--text-muted)" }}
            fontFamily="monospace"
          >
            0 km
          </text>
          <text
            x={margin.left + chartW}
            y={margin.top + chartH + 15}
            fontSize="8.5"
            textAnchor="end"
            style={{ fill: "var(--text-muted)" }}
            fontFamily="monospace"
          >
            {(totalDist / 1000).toFixed(1)} km
          </text>

          {/* Shaded Area and Profile Line */}
          <path d={areaPath} fill="url(#strata-elev-grad)" />
          <path d={linePath} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Hover Crosshair and Cursor */}
          {activeSample && (
            <g>
              <line
                x1={activeX}
                y1={margin.top}
                x2={activeX}
                y2={margin.top + chartH}
                style={{
                  stroke: "var(--accent)",
                  strokeWidth: 1.2,
                  strokeDasharray: "3 3",
                }}
              />
              <circle
                cx={activeX}
                cy={activeY}
                r={4}
                style={{
                  fill: "var(--surface)",
                  stroke: "var(--accent)",
                  strokeWidth: 2,
                }}
              />
            </g>
          )}
        </svg>
      </div>

      {/* Live readout / inspection note */}
      <div className="flex h-5 items-center justify-between px-1 text-[11px]">
        {activeSample ? (
          <>
            <span className="flex items-center gap-1 text-ink-muted">
              <Ruler size={11} className="text-ink-soft" />
              <span>Dist:</span>
              <strong className="font-mono text-ink">
                {(activeSample.distance_m / 1000).toFixed(2)} km
              </strong>
            </span>
            <span className="flex items-center gap-1 text-ink-muted">
              <Mountain size={11} className="text-ink-soft" />
              <span>Elev:</span>
              <strong className="font-mono text-ink">
                {Math.round(activeSample.elevation_m)} m
              </strong>
            </span>
            {activeSample.slope_pct != null && (
              <span className="flex items-center gap-1 text-ink-muted">
                <TrendingUp size={11} className="text-ink-soft" />
                <span>Grade:</span>
                <strong
                  className={
                    Math.abs(activeSample.slope_pct) > 15
                      ? "font-mono font-semibold text-critical"
                      : Math.abs(activeSample.slope_pct) > 8
                        ? "font-mono font-semibold text-amber-400"
                        : "font-mono font-semibold text-ok"
                  }
                >
                  {activeSample.slope_pct > 0 ? "+" : ""}
                  {activeSample.slope_pct.toFixed(1)}%
                </strong>
              </span>
            )}
          </>
        ) : (
          <span className="text-[10px] text-ink-muted/80">
            Hover to trace &amp; synchronize map pin · Click to fly map to point.
          </span>
        )}
      </div>
    </div>
  );
}
