import React, { useEffect, useMemo, useRef, useState } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { scaleSqrt } from 'd3-scale';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import worldTopo from 'world-atlas/countries-110m.json';
import { feature } from 'topojson-client';

export interface CountryData {
    countryCode: string;
    countryName: string;
    count: number;
    blocked: number;
    topDomains: { domain: string; count: number }[];
}

export type MapPoint = {
    lat: number;
    lon: number;
    count: number;
    blocked: number;
    permitted: number;
    label?: string;
    topPermittedDomains?: Array<{ domain: string; count: number }>;
    topBlockedDomains?: Array<{ domain: string; count: number }>;
};

interface WorldMapProps {
    data?: CountryData[];
    points?: MapPoint[];
}

const WorldMap: React.FC<WorldMapProps> = ({ points = [] }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);

    const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);

    const projection = useMemo(() => geoNaturalEarth1().scale(150).translate([400, 205]), []);
    const path = useMemo(() => geoPath(projection), [projection]);

    const countries = useMemo(() => {
        const topo: any = worldTopo as any;
        const obj = topo?.objects?.countries;
        if (!obj) return [] as any[];
        const geojson: any = feature(topo, obj);
        return Array.isArray(geojson?.features) ? geojson.features : [];
    }, []);

    useEffect(() => {
        if (!svgRef.current) return;
        const svg = select(svgRef.current);
        const z = zoom<SVGSVGElement, unknown>()
            .scaleExtent([1, 10])
            .on('zoom', (event) => {
                setTransform(event.transform);
            });

        svg.call(z as any);

        return () => {
            svg.on('.zoom', null);
        };
    }, []);

    const projectedPoints = useMemo(() => {
        const safe = Array.isArray(points) ? points : [];
        const mapped = safe
            .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
            .map((p) => {
                const xy = projection([p.lon, p.lat]);
                if (!xy) return null;
                return { ...p, x: xy[0], y: xy[1] };
            })
            .filter((p): p is (MapPoint & { x: number; y: number }) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y));

        const maxPointCount = mapped.reduce((acc, p) => Math.max(acc, p.count), 0);
        return { items: mapped, maxPointCount: Math.max(1, maxPointCount) };
    }, [points, projection]);

    const pointRadius = useMemo(() => {
        const max = projectedPoints.maxPointCount;
        return (count: number) => {
            const c = Math.max(0, count);
            const t = Math.sqrt(c / max);
            // Screen-space radius (px): keep a visible minimum so users don't
            // need to zoom deeply just to notice points.
            return 2.6 + t * 6.0;
        };
    }, [projectedPoints.maxPointCount]);

    return (
        <div
            ref={containerRef}
            className="relative w-full h-[350px] bg-[#09090b] overflow-hidden rounded-lg border border-[#27272a]"
            onClick={() => setSelectedPoint(null)}
        >
            <div
                className="absolute inset-0 opacity-10 pointer-events-none"
                style={{
                    backgroundImage:
                        'linear-gradient(#52525b 1px, transparent 1px), linear-gradient(90deg, #52525b 1px, transparent 1px)',
                    backgroundSize: '40px 40px'
                }}
            />

            <svg
                ref={svgRef}
                viewBox="0 0 800 400"
                className="w-full h-full"
                style={{ touchAction: 'none' }}
            >
                <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
                    {/* Basemap (non-interactive) */}
                    <g style={{ pointerEvents: 'none' }}>
                        {countries.map((geo: any, idx: number) => {
                            const d = path(geo) || undefined;
                            if (!d) return null;
                            return (
                                <path
                                    key={idx}
                                    d={d}
                                    fill="#0b0b0d"
                                    fillOpacity={0.35}
                                    stroke="#27272a"
                                    strokeOpacity={0.65}
                                    strokeWidth={0.75}
                                />
                            );
                        })}
                    </g>

                    {/* Point markers */}
                    {projectedPoints.items.map((p, idx) => {
                        // Keep marker size stable while zooming (otherwise points get huge).
                        const k = Math.max(1, transform.k || 1);
                        const minScreenR = 2.4;
                        const rPerm = p.permitted > 0 ? Math.max(minScreenR, pointRadius(p.permitted)) / k : 0;
                        const rBlock = p.blocked > 0 ? Math.max(minScreenR, pointRadius(p.blocked)) / k : 0;
                        if (rPerm <= 0 && rBlock <= 0) return null;

                        const hitR = Math.max(rPerm, rBlock, 9 / k);

                        return (
                            <g key={`${idx}:${p.lat}:${p.lon}`}>
                                {rPerm > 0 && (
                                    <circle
                                        cx={p.x}
                                        cy={p.y}
                                        r={rPerm}
                                        fill="#3b82f6"
                                        opacity={0.7}
                                        stroke="#93c5fd"
                                        strokeOpacity={0.6}
                                        strokeWidth={1.2}
                                    />
                                )}
                                {rBlock > 0 && (
                                    <circle
                                        cx={p.x}
                                        cy={p.y}
                                        r={rBlock}
                                        fill="#f43f5e"
                                        opacity={0.7}
                                        stroke="#fda4af"
                                        strokeOpacity={0.6}
                                        strokeWidth={1.2}
                                    />
                                )}

                                {/* hit target for click selection (doesn't change visuals) */}
                                <circle
                                    cx={p.x}
                                    cy={p.y}
                                    r={hitR}
                                    fill="transparent"
                                    style={{ cursor: 'pointer' }}
                                    onClick={(evt) => {
                                        evt.stopPropagation();
                                        setSelectedPoint(p);
                                    }}
                                />
                            </g>
                        );
                    })}
                </g>
            </svg>

            {selectedPoint ? (
                <div
                    className="absolute top-3 right-3 z-50 w-[320px] max-w-[calc(100%-1.5rem)] bg-[#09090b]/80 backdrop-blur-md border border-[#27272a] rounded-lg shadow-2xl overflow-hidden pointer-events-auto"
                    onClick={(evt) => evt.stopPropagation()}
                >
                    <div className="bg-[#121214]/80 border-b border-[#27272a] px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-sm font-bold text-white uppercase tracking-wider truncate">{selectedPoint.label || 'Unknown city'}</div>
                            <div className="text-xs text-zinc-400 font-mono">{selectedPoint.lat.toFixed(1)}, {selectedPoint.lon.toFixed(1)} · {selectedPoint.count} reqs</div>
                        </div>
                        <button
                            type="button"
                            className="shrink-0 text-zinc-300 hover:text-white text-xs px-2 py-1 rounded border border-[#27272a] bg-[#09090b]/60"
                            onClick={() => setSelectedPoint(null)}
                        >
                            Close
                        </button>
                    </div>

                    <div className="p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-md border border-[#27272a] bg-[#0b0b0d]/60 p-3">
                                <div className="text-xs text-zinc-400 flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-blue-500" />Permitted</div>
                                <div className="text-lg font-mono text-zinc-100 leading-tight mt-1">{selectedPoint.permitted}</div>
                            </div>
                            <div className="rounded-md border border-[#27272a] bg-[#0b0b0d]/60 p-3">
                                <div className="text-xs text-zinc-400 flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-rose-500" />Blocked</div>
                                <div className="text-lg font-mono text-zinc-100 leading-tight mt-1">{selectedPoint.blocked}</div>
                            </div>
                        </div>

                        {(selectedPoint.topPermittedDomains?.length || selectedPoint.topBlockedDomains?.length) ? (
                            <div className="space-y-3 max-h-[180px] overflow-auto pr-1">
                                {selectedPoint.topPermittedDomains && selectedPoint.topPermittedDomains.length > 0 ? (
                                    <div>
                                        <div className="text-xs font-bold text-zinc-400 uppercase mb-2 flex items-center gap-2">
                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" /> Top permitted
                                        </div>
                                        <div className="space-y-1">
                                            {selectedPoint.topPermittedDomains.slice(0, 3).map((d, i) => (
                                                <div key={`p:${i}`} className="flex justify-between items-center text-sm font-mono gap-3">
                                                    <span className="text-zinc-200 truncate">{d.domain}</span>
                                                    <span className="text-zinc-400">{d.count}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                {selectedPoint.topBlockedDomains && selectedPoint.topBlockedDomains.length > 0 ? (
                                    <div>
                                        <div className="text-xs font-bold text-zinc-400 uppercase mb-2 flex items-center gap-2">
                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500" /> Top blocked
                                        </div>
                                        <div className="space-y-1">
                                            {selectedPoint.topBlockedDomains.slice(0, 3).map((d, i) => (
                                                <div key={`b:${i}`} className="flex justify-between items-center text-sm font-mono gap-3">
                                                    <span className="text-zinc-200 truncate">{d.domain}</span>
                                                    <span className="text-zinc-400">{d.count}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <div className="text-xs text-zinc-500">No domain breakdown available for this point yet.</div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="absolute top-3 right-3 z-40 text-xs text-zinc-500 bg-[#09090b]/55 border border-[#27272a] rounded-md px-3 py-2 backdrop-blur-sm pointer-events-none">
                    Click a point to pin details
                </div>
            )}
        </div>
    );
};

export default WorldMap;