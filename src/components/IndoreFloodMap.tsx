import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CRITICAL_ASSETS,
  DRAINAGE_PROXIES,
  INTERSECTION_NODES,
  PILOT_BOUNDS,
  PILOT_SCOPE_ID,
} from '../data/indorePilotData';
import {
  EvacuationPlanItem,
  FloodRiskCell,
  FloodSeverity,
  MapSurfaceMetric,
  NavigationTab,
  ProductMode,
  RoadSegmentState,
  RoadStatus,
  RouteRecommendation,
  RouteUpdateNotification,
  SensorNode,
  Shelter,
} from '../types/idhara';
import { findNearestNodeForCell } from '../modules/routing';
import { MODE_META, ROAD_STATUS_META, SEVERITY_META } from './SeverityVisuals';

export type MapInspectionTarget =
  | { type: 'CELL'; id: string }
  | { type: 'ROAD'; id: string }
  | { type: 'SENSOR'; id: string }
  | { type: 'SHELTER'; id: string }
  | { type: 'ASSET'; id: string };

interface IndoreFloodMapProps {
  mode: ProductMode;
  cells: FloodRiskCell[];
  roads: RoadSegmentState[];
  sensors: SensorNode[];
  shelters: Shelter[];
  selectedArea: FloodRiskCell | null;
  selectedTarget: MapInspectionTarget | null;
  onSelectTarget: (target: MapInspectionTarget | null) => void;
  onSelectArea: (area: FloodRiskCell) => void;
  onDeselectArea?: () => void;
  activeRoute: RouteRecommendation | null;
  evacuationRoute: EvacuationPlanItem | null;
  routeStatus?: 'IDLE' | 'FEASIBLE' | 'NO_FEASIBLE_ROUTE';
  evacuationStatus?: 'IDLE' | 'FEASIBLE' | 'NO_FEASIBLE_EVACUATION';
  onRequestRoute?: () => void;
  onRequestEvacuation?: () => void;
  onClearRoute?: () => void;
  onDismissRouteUpdate?: () => void;
  routeUpdateNotification?: RouteUpdateNotification | null;
  activeTab?: NavigationTab;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  panOffset?: { x: number; y: number };
  onPanOffsetChange?: (pan: { x: number; y: number }) => void;
  metricOverlay?: MapSurfaceMetric;
  onMetricOverlayChange?: (metric: MapSurfaceMetric) => void;
  layers?: Record<string, boolean>;
  onLayersChange?: (layers: Record<string, boolean>) => void;
  isLegendCollapsed?: boolean;
  onLegendCollapsedChange?: (collapsed: boolean) => void;
}

const MAP_METRIC_OPTIONS: Array<{ id: MapSurfaceMetric; label: string }> = [
  { id: 'FLOOD_PROBABILITY', label: 'Flood probability' },
  { id: 'SEVERITY', label: 'Severity' },
  { id: 'UNCERTAINTY', label: 'Uncertainty' },
  { id: 'DATA_CONFIDENCE', label: 'Data confidence' },
  { id: 'RAINFALL', label: 'Rainfall' },
  { id: 'PREDICTED_VS_OBSERVED', label: 'Pred vs Obs (FN)' },
];

export const IndoreFloodMap: React.FC<IndoreFloodMapProps> = ({
  mode,
  cells,
  roads,
  sensors,
  shelters,
  selectedArea,
  selectedTarget,
  onSelectTarget,
  onSelectArea,
  onDeselectArea,
  activeRoute,
  evacuationRoute,
  routeStatus = 'IDLE',
  evacuationStatus = 'IDLE',
  onRequestRoute,
  onRequestEvacuation,
  onClearRoute,
  onDismissRouteUpdate,
  routeUpdateNotification,
  activeTab,
  zoom: controlledZoom,
  onZoomChange,
  panOffset: controlledPan,
  onPanOffsetChange,
  metricOverlay: controlledMetric,
  onMetricOverlayChange,
  layers: controlledLayers,
  onLayersChange,
  isLegendCollapsed: controlledLegendCollapsed,
  onLegendCollapsedChange,
}) => {
  const [internalLayers, setInternalLayers] = useState<Record<string, boolean>>({
    pilotBoundary: true,
    heatmapGlow: true,
    riskContours: true,
    gridCells: true,
    patterns: true,
    drainage: true,
    roads: true,
    routes: true,
    rainGauges: true,
    waterLevelSensors: true,
    assetsAndShelters: true,
    cellLabels: true,
  });
  const layers = controlledLayers ?? internalLayers;
  const setLayers = (
    updater:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => {
    const nextVal = typeof updater === 'function' ? updater(layers) : updater;
    if (onLayersChange) onLayersChange(nextVal);
    else setInternalLayers(nextVal);
  };

  const [internalMetric, setInternalMetric] =
    useState<MapSurfaceMetric>('FLOOD_PROBABILITY');
  const metricOverlay = controlledMetric ?? internalMetric;
  const setMetricOverlay = (m: MapSurfaceMetric) => {
    if (onMetricOverlayChange) onMetricOverlayChange(m);
    else setInternalMetric(m);
  };

  const [internalZoom, setInternalZoom] = useState<number>(1);
  const zoom = controlledZoom ?? internalZoom;
  const setZoom = (updater: number | ((prev: number) => number)) => {
    const nextVal = typeof updater === 'function' ? updater(zoom) : updater;
    if (onZoomChange) onZoomChange(nextVal);
    else setInternalZoom(nextVal);
  };

  const [internalPan, setInternalPan] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const panOffset = controlledPan ?? internalPan;
  const setPanOffset = (
    updater:
      | { x: number; y: number }
      | ((prev: { x: number; y: number }) => { x: number; y: number })
  ) => {
    const nextVal = typeof updater === 'function' ? updater(panOffset) : updater;
    if (onPanOffsetChange) onPanOffsetChange(nextVal);
    else setInternalPan(nextVal);
  };

  const [internalLegendCollapsed, setInternalLegendCollapsed] =
    useState<boolean>(false);
  const isLegendCollapsed =
    controlledLegendCollapsed ?? internalLegendCollapsed;
  const setIsLegendCollapsed = (
    updater: boolean | ((prev: boolean) => boolean)
  ) => {
    const nextVal =
      typeof updater === 'function' ? updater(isLegendCollapsed) : updater;
    if (onLegendCollapsedChange) onLegendCollapsedChange(nextVal);
    else setInternalLegendCollapsed(nextVal);
  };

  const [hoveredInfo, setHoveredInfo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [showLayerMenu, setShowLayerMenu] = useState<boolean>(false);
  const layerMenuRef = useRef<HTMLDivElement>(null);
  const [isRouteErrorDismissed, setIsRouteErrorDismissed] =
    useState<boolean>(false);
  const [isScaleVisible, setIsScaleVisible] = useState<boolean>(false);

  // Map panning via mouse drag
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
    moved: boolean;
  }>({
    x: 0,
    y: 0,
    panX: 0,
    panY: 0,
    moved: false,
  });

  const handleViewportMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('.interactive-panel')
    ) {
      return;
    }
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: panOffset.x,
      panY: panOffset.y,
      moved: false,
    };
  };

  const handleViewportMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = (e.clientX - dragStartRef.current.x) / (zoom || 1);
    const dy = (e.clientY - dragStartRef.current.y) / (zoom || 1);
    if (Math.hypot(dx, dy) > 4) {
      dragStartRef.current.moved = true;
    }
    const nextPanX = Math.max(
      -480,
      Math.min(480, Math.round(dragStartRef.current.panX + dx))
    );
    const nextPanY = Math.max(
      -480,
      Math.min(480, Math.round(dragStartRef.current.panY + dy))
    );
    setPanOffset({ x: nextPanX, y: nextPanY });
  };

  const handleViewportMouseUp = () => {
    setIsDragging(false);
  };

  // Close search dropdown and layer dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(target)
      ) {
        setIsSearchOpen(false);
      }
      if (
        layerMenuRef.current &&
        !layerMenuRef.current.contains(target)
      ) {
        setShowLayerMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const nodeMap = new Map(INTERSECTION_NODES.map((n) => [n.id, n]));
  const modeMeta = MODE_META[mode];
  const cellSize = 1000 / 8; // 125 units per cell in 1000x1000 SVG space

  // Reset dismiss state whenever active route changes
  useEffect(() => {
    setIsRouteErrorDismissed(false);
  }, [activeRoute?.id, activeRoute?.feasible]);

  // Center and focus map only when a NEW selectedArea is chosen
  const prevSelectedAreaIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedArea && selectedArea.id !== prevSelectedAreaIdRef.current) {
      prevSelectedAreaIdRef.current = selectedArea.id;
      const cellCenterX = (selectedArea.col + 0.5) * cellSize;
      const cellCenterY = (selectedArea.row + 0.5) * cellSize;
      const offsetX = Math.max(-320, Math.min(320, 500 - cellCenterX));
      const offsetY = Math.max(-320, Math.min(320, 500 - cellCenterY));
      setPanOffset({ x: Math.round(offsetX), y: Math.round(offsetY) });
      setZoom((z) => (z < 1.3 ? 1.35 : z));
    } else if (!selectedArea) {
      prevSelectedAreaIdRef.current = null;
    }
  }, [selectedArea?.id, cellSize]);

  const selectedAreaOriginNodeId = useMemo(() => {
    if (!selectedArea) return null;
    return findNearestNodeForCell(selectedArea).id;
  }, [selectedArea]);

  const toggleLayer = (key: string) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Search index across all 64 study-area localities, plus roads, sensors, shelters, and critical assets
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    // Map all 64 cells from current 5x5 km pilot study area
    const areaMatches: Array<{
      label: string;
      subLabel: string;
      target: MapInspectionTarget;
      cell?: FloodRiskCell;
      x: number;
      y: number;
      category: 'AREA' | 'ROAD' | 'SENSOR' | 'SHELTER' | 'ASSET';
    }> = [];

    cells.forEach((c) => {
      const matches =
        !q ||
        c.localityName.toLowerCase().includes(q) ||
        c.wardCode.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q);

      if (matches) {
        areaMatches.push({
          label: `${c.localityName} (${c.wardCode})`,
          subLabel: `Study Area · ${Math.round(c.floodProbability * 100)}% flood prob · ${c.severity} · ${c.elevationM}m MSL`,
          target: { type: 'CELL', id: c.id },
          cell: c,
          x: (c.col + 0.5) * cellSize,
          y: (c.row + 0.5) * cellSize,
          category: 'AREA',
        });
      }
    });

    const otherMatches: Array<{
      label: string;
      subLabel: string;
      target: MapInspectionTarget;
      cell?: FloodRiskCell;
      x: number;
      y: number;
      category: 'AREA' | 'ROAD' | 'SENSOR' | 'SHELTER' | 'ASSET';
    }> = [];

    if (q) {
      roads.forEach((r) => {
        if (r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)) {
          const f = nodeMap.get(r.fromNodeId);
          const t = nodeMap.get(r.toNodeId);
          otherMatches.push({
            label: r.name,
            subLabel: `Road Corridor (${r.id}) · ${r.currentState}`,
            target: { type: 'ROAD', id: r.id },
            x: f && t ? (f.x + t.x) / 2 : 500,
            y: f && t ? (f.y + t.y) / 2 : 500,
            category: 'ROAD',
          });
        }
      });

      sensors.forEach((s) => {
        if (s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) {
          otherMatches.push({
            label: `${s.name} (${s.id})`,
            subLabel: `Sensor Gauge · ${s.currentValue} ${s.unit}`,
            target: { type: 'SENSOR', id: s.id },
            x: s.x,
            y: s.y,
            category: 'SENSOR',
          });
        }
      });

      shelters.forEach((sh) => {
        if (sh.name.toLowerCase().includes(q) || sh.id.toLowerCase().includes(q)) {
          otherMatches.push({
            label: sh.name,
            subLabel: `Relief Shelter (${sh.id}) · Capacity ${sh.totalCapacity}`,
            target: { type: 'SHELTER', id: sh.id },
            x: sh.x,
            y: sh.y,
            category: 'SHELTER',
          });
        }
      });

      CRITICAL_ASSETS.forEach((a) => {
        if (a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)) {
          otherMatches.push({
            label: a.name,
            subLabel: `Critical Asset (${a.category})`,
            target: { type: 'ASSET', id: a.id },
            x: a.x,
            y: a.y,
            category: 'ASSET',
          });
        }
      });
    }

    return [...areaMatches, ...otherMatches];
  }, [searchQuery, cells, roads, sensors, shelters, nodeMap, cellSize]);

  const handleResetPilotOverview = () => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setSearchQuery('');
    setIsSearchOpen(false);
  };

  const handleFocusTarget = (
    target: MapInspectionTarget,
    x: number,
    y: number,
    name?: string,
    cell?: FloodRiskCell
  ) => {
    onSelectTarget(target);
    if (cell) {
      onSelectArea(cell);
    } else if (target.type === 'CELL') {
      const found = cells.find((c) => c.id === target.id);
      if (found) onSelectArea(found);
    }
    setZoom(1.4);
    const offsetX = Math.max(-320, Math.min(320, 500 - x));
    const offsetY = Math.max(-320, Math.min(320, 500 - y));
    setPanOffset({ x: Math.round(offsetX), y: Math.round(offsetY) });
    setIsSearchOpen(false);
    if (name) {
      setSearchQuery(name);
    }
  };

  return (
    <div className="relative flex flex-col w-full h-full bg-[#05080E] border border-slate-800/90 select-none overflow-hidden">
      {/* Top Map Toolbar: Search, Pilot Overview Button, 6-Metric Surface Switcher, Layer & Zoom Controls */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-between gap-1.5 sm:gap-2 px-2.5 sm:px-3 h-10 min-h-[40px] bg-[#0A0F1A] border-b border-slate-800/90 z-30 shrink-0 relative overflow-visible"
      >
        {/* Left: Map Search Input + Pilot Overview Reset */}
        <div ref={searchContainerRef} className="flex items-center gap-1.5 relative shrink-0">
          <div className="relative w-36 sm:w-52 md:w-60">
            <input
              type="text"
              value={searchQuery}
              onFocus={() => setIsSearchOpen(true)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              placeholder="Search all 64 study areas…"
              aria-label="Search all 64 Indore 5x5 km pilot areas"
              className="w-full bg-[#060911] border border-slate-700/90 focus:border-cyan-400 text-xs font-mono text-slate-100 pl-2 pr-12 py-1 outline-none placeholder:text-slate-500"
            />
            <div className="absolute right-1 top-1 flex items-center gap-0.5">
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setIsSearchOpen(true);
                  }}
                  className="px-1 text-xs font-mono text-slate-400 hover:text-white cursor-pointer"
                  title="Clear search"
                >
                  ×
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsSearchOpen((prev) => !prev)}
                className="px-1 text-[10px] font-mono text-slate-400 hover:text-cyan-300 cursor-pointer"
                title="Browse all 64 study areas"
              >
                {isSearchOpen ? '▲' : '▼'}
              </button>
            </div>

            {isSearchOpen && (
              <div
                className="absolute left-0 top-full mt-1 w-80 sm:w-96 bg-[#0B101B] border border-slate-700 shadow-2xl z-50 max-h-72 overflow-y-auto overscroll-contain"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="sticky top-0 bg-[#0E1524] px-3 py-1.5 border-b border-slate-800 text-[10.5px] font-mono text-cyan-300 flex items-center justify-between z-10">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate">
                      {searchQuery.trim()
                        ? `MATCHING ENTITIES (${searchResults.length})`
                        : `ALL 5×5 KM STUDY AREAS (${searchResults.length})`}
                    </span>
                    {searchQuery.trim() && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="text-[9.5px] text-cyan-400 underline hover:text-cyan-200 cursor-pointer shrink-0"
                      >
                        Show all 64
                      </button>
                    )}
                  </div>
                  <span className="text-[9.5px] text-slate-400 shrink-0">Click to focus</span>
                </div>

                {searchResults.length === 0 ? (
                  <div className="p-3 text-xs text-slate-400 font-mono text-center">
                    No areas found matching “{searchQuery}”
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/80">
                    {searchResults.map((item, idx) => {
                      const isCurrentlySelected =
                        selectedTarget !== null &&
                        selectedTarget.type === item.target.type &&
                        selectedTarget.id === item.target.id;
                      return (
                        <button
                          key={`${item.target.type}-${item.target.id}-${idx}`}
                          type="button"
                          onClick={() => handleFocusTarget(item.target, item.x, item.y, item.label, item.cell)}
                          className={`w-full text-left px-3 py-2 transition-colors block cursor-pointer ${
                            isCurrentlySelected
                              ? 'bg-cyan-950/60 border-l-2 border-cyan-400'
                              : 'hover:bg-slate-800/90'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-xs font-medium text-white truncate">
                              {item.label}
                            </span>
                            {item.category === 'AREA' && (
                              <span className="text-[9.5px] font-mono px-1 py-0.2 bg-slate-800 text-slate-300 shrink-0">
                                Area
                              </span>
                            )}
                          </div>
                          <div className="text-[10.5px] font-mono text-cyan-300 truncate mt-0.5">
                            {item.subLabel}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleResetPilotOverview}
            className="px-2.5 py-1 bg-[#0D1422] hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-cyan-300 whitespace-nowrap transition-colors cursor-pointer"
            title="Reset viewport to full 5km × 5km Indore Pilot Overview"
          >
            ⌖ Overview
          </button>
        </div>

        {/* Center: 6-Way Map Surface Switcher (Flood probability | Severity | Uncertainty | Data confidence | Rainfall | Pred vs Obs) */}
        <div className="flex items-center gap-1 bg-[#060911] p-0.5 border border-slate-800 overflow-x-auto min-w-0 shrink">
          {MAP_METRIC_OPTIONS.map((opt) => {
            const active = metricOverlay === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMetricOverlay(opt.id)}
                className={`px-2 py-0.5 text-[10.5px] font-mono transition-colors whitespace-nowrap cursor-pointer border ${
                  active
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-semibold'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Right: Layer Control Dropdown & Zoom Controls */}
        <div ref={layerMenuRef} className="flex items-center gap-1.5 sm:gap-2 font-mono text-xs relative shrink-0">
          <button
            type="button"
            onClick={() => setShowLayerMenu((v) => !v)}
            className={`px-2 sm:px-2.5 py-1 border text-[11px] whitespace-nowrap transition-colors cursor-pointer ${
              showLayerMenu
                ? 'bg-cyan-950/60 border-cyan-500/60 text-cyan-300'
                : 'bg-[#0D1422] border-slate-700 text-slate-200 hover:bg-slate-800'
            }`}
          >
            ≡ Layers ({Object.values(layers).filter(Boolean).length}/{Object.keys(layers).length})
          </button>

          {showLayerMenu && (
            <div
              className="absolute right-0 top-full mt-1 w-72 sm:w-80 bg-[#0B101B] border border-slate-700 shadow-2xl p-2.5 z-50 text-[11px] max-h-[min(75vh,480px)] flex flex-col overscroll-contain interactive-panel"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between text-slate-300 pb-2 mb-1 border-b border-slate-800 font-mono shrink-0">
                <span className="font-bold text-cyan-300 text-[10.5px]">
                  GEOSPATIAL LAYERS ({Object.values(layers).filter(Boolean).length}/{Object.keys(layers).length})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setLayers((prev) =>
                        Object.fromEntries(Object.keys(prev).map((k) => [k, true]))
                      )
                    }
                    className="text-[9.5px] px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 cursor-pointer"
                    title="Enable all layers"
                  >
                    All ON
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLayerMenu(false)}
                    className="text-slate-400 hover:text-white px-1.5 py-0.5 hover:bg-slate-800 font-mono text-xs cursor-pointer"
                    title="Close Layers Panel"
                  >
                    ✕ Close
                  </button>
                </div>
              </div>
              <div className="overflow-y-auto space-y-1 pr-1 flex-1 min-h-0">
                {[
                  { key: 'pilotBoundary', label: '5×5 km Pilot Boundary', desc: 'Study area spatial boundary' },
                  { key: 'heatmapGlow', label: 'Continuous Flood Heatmap', desc: 'Hydraulic intensity glow' },
                  { key: 'riskContours', label: 'Iso-Risk Contours (74% / 52%)', desc: 'Critical risk isolines' },
                  { key: 'gridCells', label: '64-Cell Risk Matrix', desc: 'Hydrological grid cells' },
                  { key: 'patterns', label: 'Non-Hue Hatch Patterns', desc: 'Accessible pattern fill' },
                  { key: 'drainage', label: 'Kahn & Saraswati Rivers', desc: 'Natural drainage channels' },
                  { key: 'roads', label: 'Road Network & Barricades', desc: '18 road corridors & bridges' },
                  { key: 'routes', label: 'Route & Evacuation Corridors', desc: 'Dispatched emergency & shelter transit' },
                  { key: 'rainGauges', label: 'Rain Gauges (4 AWS)', desc: 'Automated weather stations' },
                  { key: 'waterLevelSensors', label: 'Water-Level Sensors (6)', desc: 'Ultrasonic river stage gauges' },
                  { key: 'assetsAndShelters', label: 'Hospitals & Relief Shelters', desc: 'Critical infrastructure' },
                  { key: 'cellLabels', label: 'Ward & Metric Readouts', desc: 'Ward codes & risk metrics' },
                ].map((item) => {
                  const active = layers[item.key as keyof typeof layers];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => toggleLayer(item.key)}
                      className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-slate-800/80 text-left transition-colors cursor-pointer rounded-xs"
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <span className={`truncate text-xs font-medium ${active ? 'text-slate-100' : 'text-slate-500'}`}>
                          {active ? '■' : '□'} {item.label}
                        </span>
                        <span className="text-[9.5px] text-slate-500 truncate">
                          {item.desc}
                        </span>
                      </div>
                      <span className={`shrink-0 font-mono text-[10px] font-bold px-1.5 py-0.5 ${
                        active
                          ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/60'
                          : 'bg-slate-900 text-slate-500 border border-slate-800'
                      }`}>
                        {active ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Zoom Controls: +, − and Zoom Percentage */}
          <div className="flex items-center bg-[#060911] border border-slate-700">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.8, Number((z - 0.2).toFixed(2))))}
              className="px-2 py-1 text-slate-300 hover:bg-slate-800 whitespace-nowrap cursor-pointer text-xs"
              title="Zoom Out (Min 80%)"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setPanOffset({ x: 0, y: 0 });
              }}
              className="px-2 py-1 text-[11px] text-slate-300 tabular-nums border-x border-slate-800 hover:text-cyan-300 cursor-pointer"
              title="Click to reset zoom to 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.2).toFixed(2))))}
              className="px-2 py-1 text-slate-300 hover:bg-slate-800 whitespace-nowrap cursor-pointer text-xs"
              title="Zoom In (Max 220%)"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Main Interactive SVG Geospatial Viewport with Click & Drag to Pan */}
      <div
        onMouseDown={handleViewportMouseDown}
        onMouseMove={handleViewportMouseMove}
        onMouseUp={handleViewportMouseUp}
        onMouseLeave={handleViewportMouseUp}
        className={`relative flex-1 w-full h-full overflow-hidden flex items-center justify-center bg-[#04070D] geospatial-grid-bg select-none ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        {/* Top-Left: Selected Area Operational Directive & Action Card, or Pilot Bounds Indicator */}
        {selectedArea ? (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-2.5 left-2.5 z-20 flex flex-wrap items-center gap-2.5 bg-[#090F1C]/95 border border-cyan-500/80 px-3 py-2 font-mono text-[11px] shadow-2xl backdrop-blur-xs max-w-[calc(100%-1.25rem)] sm:max-w-xl interactive-panel"
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shrink-0" />
              <div className="flex flex-col">
                <span className="text-white font-bold text-xs">
                  {selectedArea.localityName}{' '}
                  <span className="text-cyan-300 font-normal">({selectedArea.wardCode})</span>
                </span>
                <span className="text-[10px] text-slate-300">
                  Flood Risk: <strong className={selectedArea.floodProbability >= 0.52 ? 'text-amber-300' : 'text-emerald-300'}>{Math.round(selectedArea.floodProbability * 100)}%</strong> · Elev: {selectedArea.elevationM}m · Node: <span className="text-cyan-200">{nodeMap.get(selectedAreaOriginNodeId ?? '')?.name ?? selectedAreaOriginNodeId}</span>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                type="button"
                onClick={onRequestRoute}
                className="px-2.5 py-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-[10.5px] transition-colors cursor-pointer whitespace-nowrap"
                title="Run flood-aware routing for this selected area"
              >
                ⚡ Calculate Route
              </button>
              <button
                type="button"
                onClick={onRequestEvacuation}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10.5px] transition-colors cursor-pointer whitespace-nowrap"
                title="Calculate evacuation corridor to nearest reachable shelter"
              >
                ▲ Evacuate Area
              </button>
              {(activeRoute || evacuationRoute) && (
                <button
                  type="button"
                  onClick={onClearRoute}
                  className="px-1.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] transition-colors cursor-pointer"
                  title="Clear active route/evacuation overlays"
                >
                  ✕ Clear
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeselectArea?.();
                }}
                className="px-2 py-1 bg-[#0D1422] hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-white text-xs font-mono transition-colors cursor-pointer ml-1"
                title="Close area inspection and return to normal map view"
                aria-label="Close Area Inspection"
              >
                ✕
              </button>
            </div>
          </div>
        ) : null}

        {/* Top-Right Live Route Subscription / Rerouting Status Banner */}
        {routeUpdateNotification && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-2.5 right-2.5 z-20 max-w-sm bg-[#160B08]/95 border border-amber-400 px-3 py-2 font-mono text-[11px] shadow-2xl interactive-panel"
          >
            <div className="flex items-center justify-between gap-2 text-amber-300 font-bold border-b border-amber-900/60 pb-1 mb-1">
              <span>⚡ {routeUpdateNotification.bannerTitle}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-amber-200">{routeUpdateNotification.timestamp}</span>
                <button
                  type="button"
                  onClick={onDismissRouteUpdate}
                  className="text-slate-400 hover:text-white text-xs px-1 cursor-pointer"
                  title="Close route notification"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="text-white font-semibold mt-0.5">
              Reason: “{routeUpdateNotification.reason}”
            </div>
            <div className="text-[10.5px] text-slate-200 mt-0.5">
              {routeUpdateNotification.explanation}
            </div>
          </div>
        )}

        {/* Operational No Feasible Route State (shown ONLY after area selected, route calculated, and infeasible) */}
        {!routeUpdateNotification &&
          routeStatus === 'NO_FEASIBLE_ROUTE' &&
          activeRoute &&
          !activeRoute.feasible &&
          !isRouteErrorDismissed && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="absolute top-2.5 right-2.5 z-20 max-w-[calc(100vw-1.5rem)] sm:max-w-sm bg-[#16080B]/95 border border-rose-500/80 shadow-2xl p-3 font-mono text-[11px] backdrop-blur-xs max-h-[min(80vh,520px)] overflow-y-auto overscroll-contain interactive-panel"
          >
            <div className="flex items-center justify-between gap-2 border-b border-rose-900/60 pb-1 mb-1.5">
              <div className="flex items-center gap-1.5 text-rose-300 font-bold">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span>NO FEASIBLE ROUTE</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsRouteErrorDismissed(true);
                  onClearRoute?.();
                }}
                className="text-slate-400 hover:text-white text-xs px-1 cursor-pointer"
                title="Dismiss route error notification"
              >
                ✕
              </button>
            </div>

            <div className="text-slate-200 text-xs font-sans mb-1.5 leading-snug">
              {activeRoute.travelProfile === 'AMBULANCE' ? 'Ambulance' : activeRoute.travelProfile} routing is currently unavailable between:
              <div className="font-semibold text-white mt-0.5 font-mono text-[11.5px]">
                {activeRoute.originName} → {activeRoute.destinationName}
              </div>
            </div>

            <div className="text-[10.5px] text-rose-200/90 bg-rose-950/60 p-1.5 border border-rose-900/60 mb-2">
              <strong className="text-rose-300">Reason:</strong> All currently available corridors are closed or above the configured safety threshold.
            </div>

            <div className="text-[10.5px] space-y-0.5 mb-2 font-sans">
              <div className="text-amber-300 font-semibold font-mono text-[11px]">Recommended action:</div>
              <div className="text-slate-300 pl-1.5 space-y-0.5">
                <div>• Wait for road-state update</div>
                <div>• Select another destination</div>
                {activeRoute.noRouteInfo?.nearestReachableSafePoint && (
                  <div>
                    • Nearest reachable safe point:{' '}
                    <strong className="text-emerald-300 font-mono">
                      {activeRoute.noRouteInfo.nearestReachableSafePoint.nodeName} ({activeRoute.noRouteInfo.nearestReachableSafePoint.elevationM}m MSL)
                    </strong>
                  </div>
                )}
                {activeRoute.noRouteInfo?.nearestAvailableShelter && (
                  <div>
                    • Nearest available shelter:{' '}
                    <strong className="text-cyan-300 font-mono">
                      {activeRoute.noRouteInfo.nearestAvailableShelter.shelterName} ({activeRoute.noRouteInfo.nearestAvailableShelter.distanceKm} km)
                    </strong>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-rose-900/60 font-sans">
              <button
                type="button"
                onClick={() => {
                  const targetRoadId = activeRoute.noRouteInfo?.blockingRoadIds?.[0] ?? 'RD-05';
                  onSelectTarget({ type: 'ROAD', id: targetRoadId });
                }}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10.5px] text-cyan-300 font-mono transition-colors cursor-pointer"
              >
                View affected roads
              </button>
              <button
                type="button"
                onClick={() => onSelectTarget({ type: 'ASSET', id: 'AST-HOSP-02' })}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10.5px] text-slate-300 hover:text-white font-mono transition-colors cursor-pointer"
              >
                Try another destination
              </button>
            </div>

            <details className="mt-1.5 text-[9.5px] text-slate-400">
              <summary className="cursor-pointer hover:text-slate-200 font-mono">
                Technical Details (Corridor Diagnostics)
              </summary>
              <div className="mt-1 p-1.5 bg-black/70 border border-slate-800 text-slate-300 font-mono break-words leading-tight max-h-24 overflow-y-auto">
                {activeRoute.noRouteInfo?.reason}
              </div>
            </details>
          </div>
        )}

        {/* Active Feasible Route Banner */}
        {!routeUpdateNotification &&
          routeStatus === 'FEASIBLE' &&
          activeRoute &&
          activeRoute.feasible && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="absolute top-2.5 right-2.5 z-20 max-w-[calc(100vw-1.5rem)] sm:max-w-sm bg-[#091524]/95 border border-cyan-400/80 shadow-2xl p-2.5 font-mono text-[11px] backdrop-blur-xs interactive-panel"
          >
            <div className="flex items-center justify-between gap-2 border-b border-cyan-900/60 pb-1 mb-1">
              <span className="text-cyan-300 font-bold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span>ROUTE ACTIVE</span>
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-cyan-200">
                  {activeRoute.recommendedDistanceKm} km · {activeRoute.recommendedEtaMin} min
                </span>
                <button
                  type="button"
                  onClick={onClearRoute}
                  className="text-slate-400 hover:text-white text-xs px-1 cursor-pointer"
                  title="Close route result"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="text-slate-100 text-xs font-sans">
              Corridor: <strong className="font-mono text-cyan-200">{activeRoute.originName} → {activeRoute.destinationName}</strong>
            </div>
            <div className="text-[10px] text-emerald-300 mt-0.5">
              ✓ {activeRoute.recommendationStatusLabel}
            </div>
          </div>
        )}

        {/* Active Evacuation Route Banner */}
        {!routeUpdateNotification &&
          evacuationStatus === 'FEASIBLE' &&
          evacuationRoute &&
          evacuationRoute.assigned && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="absolute top-2.5 right-2.5 z-20 max-w-[calc(100vw-1.5rem)] sm:max-w-sm bg-[#061814]/95 border border-emerald-400/80 shadow-2xl p-2.5 font-mono text-[11px] backdrop-blur-xs interactive-panel"
          >
            <div className="flex items-center justify-between gap-2 border-b border-emerald-900/60 pb-1 mb-1">
              <span className="text-emerald-300 font-bold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>EVACUATION ROUTE ACTIVE</span>
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-emerald-200">
                  {evacuationRoute.distanceKm} km · ~{evacuationRoute.estimatedClearanceMin} min
                </span>
                <button
                  type="button"
                  onClick={onClearRoute}
                  className="text-slate-400 hover:text-white text-xs px-1 cursor-pointer"
                  title="Close evacuation result"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="text-slate-100 text-xs font-sans">
              To: <strong className="font-mono text-emerald-200">{evacuationRoute.targetShelterName}</strong>
            </div>
            <div className="text-[10px] text-emerald-300 mt-0.5">
              Buses Assigned: {evacuationRoute.busesAssigned} · {evacuationRoute.routeRoadNames.join(' → ')}
            </div>
          </div>
        )}

        {/* Infeasible Evacuation Plan Banner */}
        {!routeUpdateNotification &&
          evacuationStatus === 'NO_FEASIBLE_EVACUATION' &&
          evacuationRoute && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="absolute top-2.5 right-2.5 z-20 max-w-[calc(100vw-1.5rem)] sm:max-w-sm bg-[#16080B]/95 border border-rose-500/80 shadow-2xl p-3 font-mono text-[11px] backdrop-blur-xs max-h-[min(80vh,520px)] overflow-y-auto overscroll-contain interactive-panel"
          >
            <div className="flex items-center justify-between gap-2 border-b border-rose-900/60 pb-1 mb-1.5">
              <div className="flex items-center gap-1.5 text-rose-300 font-bold">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span>NO FEASIBLE EVACUATION PLAN</span>
              </div>
              <button
                type="button"
                onClick={onClearRoute}
                className="text-slate-400 hover:text-white text-xs px-1 cursor-pointer"
                title="Close evacuation result"
              >
                ✕
              </button>
            </div>
            <div className="text-slate-200 text-xs font-sans mb-1.5 leading-snug">
              Evacuation unavailable for {evacuationRoute.sourceLocality}
            </div>
            <div className="text-[10.5px] text-rose-200/90 bg-rose-950/60 p-1.5 border border-rose-900/60 mb-1.5">
              <strong className="text-rose-300">Reason:</strong> {evacuationRoute.failureReason ?? 'All shelter corridors disconnected'}.
            </div>
            {evacuationRoute.failureDetail && (
              <div className="text-[10px] text-slate-300 font-sans leading-relaxed">
                {evacuationRoute.failureDetail}
              </div>
            )}
          </div>
        )}

        <svg
          viewBox="-25 -25 1050 1050"
          className="w-full h-full max-h-full cursor-crosshair"
          style={{
            transform: `scale(${zoom}) translate(${panOffset.x}px, ${panOffset.y}px)`,
            transformOrigin: 'center center',
          }}
          role="img"
          aria-label="Indore 5 by 5 kilometer interactive flood prediction heatmap and disaster twin map"
        >
          <defs>
            <pattern
              id="pattern-critical-crosshatch"
              width="16"
              height="16"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 0,16 L 16,0 M 0,0 L 16,16"
                stroke="rgba(248, 113, 113, 0.55)"
                strokeWidth="1.5"
              />
            </pattern>

            <pattern
              id="pattern-high-diagonal"
              width="14"
              height="14"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M -2,14 L 14,-2 M 6,16 L 16,6"
                stroke="rgba(251, 146, 60, 0.55)"
                strokeWidth="1.5"
              />
            </pattern>

            <pattern
              id="pattern-moderate-dots"
              width="12"
              height="12"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="4" cy="4" r="1.5" fill="rgba(250, 204, 21, 0.55)" />
              <circle cx="10" cy="10" r="1.5" fill="rgba(250, 204, 21, 0.55)" />
            </pattern>

            <radialGradient id="heatmap-critical" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#EF4444" stopOpacity="0.72" />
              <stop offset="35%" stopColor="#DC2626" stopOpacity="0.55" />
              <stop offset="65%" stopColor="#F97316" stopOpacity="0.25" />
              <stop offset="90%" stopColor="#0EA5E9" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
            </radialGradient>

            <radialGradient id="heatmap-high" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#F97316" stopOpacity="0.55" />
              <stop offset="45%" stopColor="#EA580C" stopOpacity="0.35" />
              <stop offset="75%" stopColor="#EAB308" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
            </radialGradient>

            <filter id="route-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#22D3EE" floodOpacity="0.85" />
            </filter>

            {/* Directional Chevrons for Route and Evacuation Flow */}
            <marker
              id="arrow-route"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#22D3EE" />
            </marker>

            <marker
              id="arrow-evac"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 2 L 7 5 L 0 8 z" fill="#34D399" />
            </marker>
          </defs>

          {/* 0. Continuous Flood-Risk Heatmap Glow Underlay */}
          {layers.heatmapGlow &&
            (metricOverlay === 'FLOOD_PROBABILITY' || metricOverlay === 'SEVERITY') &&
            cells
              .filter(
                (c) =>
                  c.severity === FloodSeverity.CRITICAL ||
                  c.severity === FloodSeverity.HIGH
              )
              .map((c) => {
                const cx = (c.col + 0.5) * cellSize;
                const cy = (c.row + 0.5) * cellSize;
                const radius = c.severity === FloodSeverity.CRITICAL ? 168 : 128;
                return (
                  <circle
                    key={`heat-${c.id}`}
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill={
                      c.severity === FloodSeverity.CRITICAL
                        ? 'url(#heatmap-critical)'
                        : 'url(#heatmap-high)'
                    }
                    pointerEvents="none"
                  />
                );
              })}

          {/* 0B. Signature Iso-Risk Topographic Contours (74% CRITICAL & 52% HIGH Iso-Lines) */}
          {layers.riskContours &&
            (metricOverlay === 'FLOOD_PROBABILITY' || metricOverlay === 'SEVERITY') && (
              <g pointerEvents="none">
                {cells
                  .filter((c) => c.floodProbability >= 0.52)
                  .map((c) => {
                    const cx = (c.col + 0.5) * cellSize;
                    const cy = (c.row + 0.5) * cellSize;
                    const isCrit = c.floodProbability >= 0.74;
                    return (
                      <g key={`contour-${c.id}`}>
                        {/* Outer 52% HIGH Iso-Risk Contour Ring */}
                        <ellipse
                          cx={cx}
                          cy={cy}
                          rx={isCrit ? 84 : 68}
                          ry={isCrit ? 74 : 60}
                          fill="none"
                          stroke={isCrit ? 'rgba(251, 146, 60, 0.50)' : 'rgba(234, 179, 8, 0.45)'}
                          strokeWidth="1.2"
                          strokeDasharray="6 3"
                        />
                        {/* Inner 74% CRITICAL Iso-Risk Contour Ring */}
                        {isCrit && (
                          <>
                            <ellipse
                              cx={cx}
                              cy={cy}
                              rx={56}
                              ry={48}
                              fill="none"
                              stroke="rgba(248, 113, 113, 0.80)"
                              strokeWidth="1.6"
                            />
                            <text
                              x={cx + 38}
                              y={cy - 34}
                              fill="#FCA5A5"
                              fontSize="8.5"
                              fontFamily="IBM Plex Mono, monospace"
                              fontWeight="600"
                            >
                              74% ISO
                            </text>
                          </>
                        )}
                      </g>
                    );
                  })}
              </g>
            )}

          {/* 1. 64-Cell Hydrological Risk Grid */}
          {layers.gridCells &&
            cells.map((cell) => {
              const x = cell.col * cellSize;
              const y = cell.row * cellSize;
              const isSelected =
                (selectedTarget?.type === 'CELL' && selectedTarget?.id === cell.id) ||
                selectedArea?.id === cell.id;
              const sevMeta = SEVERITY_META[cell.severity];

              // Compute fill based on active 5-metric overlay
              let fillStyle = sevMeta.svgFill;
              if (metricOverlay === 'FLOOD_PROBABILITY') {
                const p = cell.floodProbability;
                fillStyle =
                  p >= 0.74
                    ? 'rgba(239, 68, 68, 0.36)'
                    : p >= 0.52
                    ? 'rgba(249, 115, 22, 0.28)'
                    : p >= 0.30
                    ? 'rgba(234, 179, 8, 0.20)'
                    : 'rgba(16, 185, 129, 0.09)';
              } else if (metricOverlay === 'SEVERITY') {
                fillStyle = sevMeta.svgFill;
              } else if (metricOverlay === 'UNCERTAINTY') {
                const u = cell.uncertaintyBand;
                fillStyle =
                  u >= 0.12
                    ? 'rgba(168, 85, 247, 0.36)'
                    : u >= 0.08
                    ? 'rgba(245, 158, 11, 0.25)'
                    : 'rgba(14, 165, 233, 0.14)';
              } else if (metricOverlay === 'DATA_CONFIDENCE') {
                const conf = cell.confidence;
                fillStyle =
                  conf >= 0.85
                    ? 'rgba(16, 185, 129, 0.26)'
                    : conf >= 0.72
                    ? 'rgba(56, 189, 248, 0.20)'
                    : 'rgba(244, 63, 94, 0.28)';
              } else if (metricOverlay === 'RAINFALL') {
                const r = cell.predictionInput.rainfall_1h;
                fillStyle =
                  r >= 55
                    ? 'rgba(14, 165, 233, 0.42)'
                    : r >= 35
                    ? 'rgba(56, 189, 248, 0.26)'
                    : 'rgba(125, 211, 252, 0.12)';
              } else if (metricOverlay === 'PREDICTED_VS_OBSERVED') {
                const isFnPocket =
                  cell.id === 'CELL-R3C1' ||
                  cell.id === 'CELL-R4C2' ||
                  cell.id === 'CELL-R5C2' ||
                  cell.id === 'CELL-R2C4';
                const predFlood =
                  cell.floodProbability >= 0.5 || cell.predictedDepthCm >= 26;
                const obsFlood =
                  (cell.observedDepthCm ?? cell.predictedDepthCm) >= 25 ||
                  (isFnPocket && cell.floodProbability >= 0.41);

                if (!predFlood && obsFlood) {
                  // FALSE NEGATIVE — Visually Prominent Crimson
                  fillStyle = 'rgba(244, 63, 94, 0.52)';
                } else if (predFlood && obsFlood) {
                  // TRUE POSITIVE — Verified Emerald
                  fillStyle = 'rgba(16, 185, 129, 0.34)';
                } else if (predFlood && !obsFlood) {
                  // FALSE POSITIVE — Over-warn Amber
                  fillStyle = 'rgba(245, 158, 11, 0.30)';
                } else {
                  fillStyle = 'rgba(15, 23, 42, 0.45)';
                }
              }

              return (
                <g
                  key={cell.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dragStartRef.current.moved) return;
                    onSelectTarget({ type: 'CELL', id: cell.id });
                    onSelectArea(cell);
                  }}
                  onMouseEnter={() =>
                    setHoveredInfo(
                      `${cell.id} · ${cell.localityName} (${cell.wardCode}) · Prob ${Math.round(
                        cell.floodProbability * 100
                      )}% · Sev ${sevMeta.label} · Warn ${cell.warningLevel} · Conf ${Math.round(
                        cell.confidence * 100
                      )}% · Onset ${cell.expectedOnsetLabel}`
                    )
                  }
                  onMouseLeave={() => setHoveredInfo(null)}
                  className="cursor-pointer"
                >
                  <rect
                    x={x}
                    y={y}
                    width={cellSize}
                    height={cellSize}
                    fill={fillStyle}
                    stroke={isSelected ? '#38BDF8' : 'rgba(51, 65, 85, 0.5)'}
                    strokeWidth={isSelected ? 3 : 1}
                  />

                  {layers.patterns &&
                    (metricOverlay === 'SEVERITY' || metricOverlay === 'FLOOD_PROBABILITY') &&
                    sevMeta.patternId !== 'none' && (
                      <rect
                        x={x}
                        y={y}
                        width={cellSize}
                        height={cellSize}
                        fill={sevMeta.patternId}
                        pointerEvents="none"
                      />
                    )}

                  {isSelected && (
                    <rect
                      x={x + 3}
                      y={y + 3}
                      width={cellSize - 6}
                      height={cellSize - 6}
                      fill="none"
                      stroke="#E0F2FE"
                      strokeWidth="1.5"
                      strokeDasharray="4 2"
                      pointerEvents="none"
                    />
                  )}

                  {layers.cellLabels && (
                    <g pointerEvents="none">
                      <text
                        x={x + 7}
                        y={y + 16}
                        fill={
                          cell.warningLevel === 'RED'
                            ? '#FCA5A5'
                            : cell.warningLevel === 'ORANGE'
                            ? '#FDBA74'
                            : cell.warningLevel === 'YELLOW'
                            ? '#FDE047'
                            : '#6EE7B7'
                        }
                        fontSize="10.5"
                        fontFamily="IBM Plex Mono, monospace"
                        fontWeight="600"
                      >
                        {sevMeta.glyph} {cell.warningLevel} · {cell.wardCode}
                      </text>

                      <text
                        x={x + 7}
                        y={y + 31}
                        fill="#E2E8F0"
                        fontSize="10"
                        fontFamily="Plus Jakarta Sans, sans-serif"
                        fontWeight="500"
                      >
                        {cell.localityName.length > 18
                          ? cell.localityName.slice(0, 17) + '…'
                          : cell.localityName}
                      </text>

                      <text
                        x={x + 7}
                        y={y + cellSize - 9}
                        fill="#CBD5E1"
                        fontSize="10.5"
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {metricOverlay === 'FLOOD_PROBABILITY' &&
                          `Prob ${Math.round(cell.floodProbability * 100)}% · ${cell.expectedOnsetLabel}`}
                        {metricOverlay === 'SEVERITY' &&
                          `${sevMeta.label} · ${cell.predictedDepthCm}cm`}
                        {metricOverlay === 'UNCERTAINTY' &&
                          `Spread ±${Math.round(cell.uncertaintyBand * 100)}%`}
                        {metricOverlay === 'DATA_CONFIDENCE' &&
                          `Conf ${Math.round(cell.confidence * 100)}% · ${cell.freshnessLabel}`}
                        {metricOverlay === 'RAINFALL' &&
                          `1h: ${cell.predictionInput.rainfall_1h}mm · 3h: ${cell.predictionInput.rainfall_3h}mm`}
                        {metricOverlay === 'PREDICTED_VS_OBSERVED' &&
                          `Pred ${cell.predictedDepthCm}cm vs Obs ${
                            cell.observedDepthCm ?? cell.predictedDepthCm
                          }cm`}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

          {/* 2. Explicit 5km × 5km Pilot Boundary Frame & Precision Geospatial Reticles */}
          {layers.pilotBoundary && (
            <g pointerEvents="none">
              <rect
                x="0"
                y="0"
                width="1000"
                height="1000"
                fill="none"
                stroke="#0284C7"
                strokeWidth="2"
                strokeDasharray="12 6"
              />
              <text
                x="6"
                y="-8"
                fill="#38BDF8"
                fontSize="11"
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="600"
              >
                INDORE PILOT BOUNDARY ({PILOT_SCOPE_ID} · 5.0 km × 5.0 km · NW {PILOT_BOUNDS.maxLat}°N, {PILOT_BOUNDS.minLng}°E)
              </text>
              <text
                x="994"
                y="1016"
                textAnchor="end"
                fill="#38BDF8"
                fontSize="11"
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="600"
              >
                SE BOUNDARY ({PILOT_BOUNDS.minLat}°N, {PILOT_BOUNDS.maxLng}°E)
              </text>

              {/* Four Corner Reticles (+) & Geographic Coordinates */}
              <g stroke="#38BDF8" strokeWidth="1.2" opacity="0.8">
                {/* NW Reticle */}
                <path d="M 6,18 L 30,18 M 18,6 L 18,30" />
                <text x="34" y="22" fill="#7DD3FC" fontSize="9" fontFamily="IBM Plex Mono, monospace" stroke="none">
                  22.7500°N · 75.8450°E
                </text>

                {/* NE Reticle */}
                <path d="M 970,18 L 994,18 M 982,6 L 982,30" />
                <text x="965" y="22" textAnchor="end" fill="#7DD3FC" fontSize="9" fontFamily="IBM Plex Mono, monospace" stroke="none">
                  22.7500°N · 75.8950°E
                </text>

                {/* SW Reticle */}
                <path d="M 6,982 L 30,982 M 18,970 L 18,994" />
                <text x="34" y="986" fill="#7DD3FC" fontSize="9" fontFamily="IBM Plex Mono, monospace" stroke="none">
                  22.7050°N · 75.8450°E
                </text>

                {/* SE Reticle */}
                <path d="M 970,982 L 994,982 M 982,970 L 982,994" />
                <text x="965" y="986" textAnchor="end" fill="#7DD3FC" fontSize="9" fontFamily="IBM Plex Mono, monospace" stroke="none">
                  22.7050°N · 75.8950°E
                </text>
              </g>

              {/* Tactical North Arrow Indicator */}
              <g transform="translate(950, 60)">
                <circle cx="0" cy="0" r="14" fill="#0A0F1A" stroke="#38BDF8" strokeWidth="1.2" />
                <path d="M 0,-10 L 5,3 L 0,0 L -5,3 Z" fill="#38BDF8" />
                <path d="M 0,0 L 5,3 L 0,8 L -5,3 Z" fill="#1E293B" />
                <text x="0" y="-13" textAnchor="middle" fill="#BAE6FD" fontSize="8" fontFamily="IBM Plex Mono, monospace" fontWeight="700">
                  N
                </text>
              </g>
            </g>
          )}

          {/* 3. Kahn River, Saraswati River & Primary Nallah Drainage Proxies */}
          {layers.drainage &&
            DRAINAGE_PROXIES.map((d) => {
              const pathPoints = d.points.map((p) => `${p.x},${p.y}`).join(' ');
              const isRiver = d.type === 'RIVER_CHANNEL';
              const isCulvert = d.type === 'STORM_CULVERT_CHOKEPOINT';
              return (
                <g key={d.id} pointerEvents="none">
                  <polyline
                    points={pathPoints}
                    fill="none"
                    stroke={
                      isCulvert
                        ? 'rgba(244, 63, 94, 0.35)'
                        : 'rgba(14, 165, 233, 0.30)'
                    }
                    strokeWidth={isRiver ? 18 : 10}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polyline
                    points={pathPoints}
                    fill="none"
                    stroke={isCulvert ? '#FB7185' : isRiver ? '#0284C7' : '#38BDF8'}
                    strokeWidth={isRiver ? 6 : 3.5}
                    strokeDasharray={isCulvert ? '6 4' : isRiver ? 'none' : '10 4'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}

          {/* 4. Road Network & Flood State Segments */}
          {layers.roads &&
            roads.map((road) => {
              const fromNode = nodeMap.get(road.fromNodeId);
              const toNode = nodeMap.get(road.toNodeId);
              if (!fromNode || !toNode) return null;

              const isSelected =
                selectedTarget?.type === 'ROAD' && selectedTarget?.id === road.id;
              const statusMeta = ROAD_STATUS_META[road.currentState];
              const midX = (fromNode.x + toNode.x) / 2;
              const midY = (fromNode.y + toNode.y) / 2;

              return (
                <g
                  key={road.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dragStartRef.current.moved) return;
                    onSelectTarget({ type: 'ROAD', id: road.id });
                  }}
                  onMouseEnter={() =>
                    setHoveredInfo(
                      `${road.id}: ${road.name} · ${statusMeta.glyph} ${statusMeta.label} · Flood Prob ${Math.round(
                        road.floodProbability * 100
                      )}% (~${road.estimatedWaterDepthCm}cm)`
                    )
                  }
                  onMouseLeave={() => setHoveredInfo(null)}
                  className="cursor-pointer"
                >
                  <line
                    x1={fromNode.x}
                    y1={fromNode.y}
                    x2={toNode.x}
                    y2={toNode.y}
                    stroke="transparent"
                    strokeWidth="16"
                  />
                  <line
                    x1={fromNode.x}
                    y1={fromNode.y}
                    x2={toNode.x}
                    y2={toNode.y}
                    stroke="#090D16"
                    strokeWidth={isSelected ? 9 : 6.5}
                    strokeLinecap="round"
                  />
                  <line
                    x1={fromNode.x}
                    y1={fromNode.y}
                    x2={toNode.x}
                    y2={toNode.y}
                    stroke={isSelected ? '#38BDF8' : statusMeta.strokeColor}
                    strokeWidth={isSelected ? 5.5 : 3.5}
                    strokeDasharray={statusMeta.dashArray}
                    strokeLinecap="round"
                  />

                  {(road.currentState === RoadStatus.CLOSED ||
                    road.currentState === RoadStatus.LIKELY_FLOODED ||
                    road.currentState === RoadStatus.AT_RISK) && (
                    <g transform={`translate(${midX}, ${midY})`}>
                      <rect
                        x="-24"
                        y="-8"
                        width="48"
                        height="16"
                        rx="1"
                        fill="#060911"
                        stroke={statusMeta.strokeColor}
                        strokeWidth="1.2"
                      />
                      <text
                        x="0"
                        y="3.5"
                        textAnchor="middle"
                        fill={statusMeta.strokeColor}
                        fontSize="8.5"
                        fontFamily="IBM Plex Mono, monospace"
                        fontWeight="700"
                      >
                        {road.currentState === RoadStatus.CLOSED
                          ? '✖ CLOSED'
                          : road.currentState === RoadStatus.LIKELY_FLOODED
                          ? '▲ FLOODED'
                          : '◆ AT RISK'}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

          {/* 5. Active Recommended Route Overlay ("Recommended under current data") */}
          {layers.routes && activeRoute && (
            <g pointerEvents="none">
              {/* Invalidated Previous Route or Blocked Dry Baseline */}
              {(routeUpdateNotification?.previousRouteRoadIds?.length
                ? routeUpdateNotification.previousRouteRoadIds
                : activeRoute.avoidedHazardCount > 0
                ? activeRoute.baselineShortestRoadIds
                : []
              ).map((rId, idx) => {
                const r = roads.find((item) => item.id === rId);
                if (!r) return null;
                const f = nodeMap.get(r.fromNodeId);
                const t = nodeMap.get(r.toNodeId);
                if (!f || !t) return null;
                const midX = (f.x + t.x) / 2;
                const midY = (f.y + t.y) / 2;
                return (
                  <g key={`base-${rId}`}>
                    <line
                      x1={f.x}
                      y1={f.y}
                      x2={t.x}
                      y2={t.y}
                      stroke="#991B1B"
                      strokeWidth="8"
                      strokeLinecap="round"
                      opacity="0.45"
                    />
                    <line
                      x1={f.x}
                      y1={f.y}
                      x2={t.x}
                      y2={t.y}
                      stroke="#F43F5E"
                      strokeWidth="4"
                      strokeDasharray="5 5"
                      opacity="0.95"
                    />
                    {idx === 1 && (
                      <g transform={`translate(${midX}, ${midY - 16})`}>
                        <rect
                          x="-52"
                          y="-9"
                          width="104"
                          height="16"
                          rx="2"
                          fill="#450A0A"
                          stroke="#F43F5E"
                          strokeWidth="1.2"
                        />
                        <text
                          x="0"
                          y="2.5"
                          textAnchor="middle"
                          fill="#FECDD3"
                          fontSize="8.5"
                          fontFamily="IBM Plex Mono, monospace"
                          fontWeight="700"
                        >
                          ✖ BLOCKED CORRIDOR
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Alternative Route (if distinct feasible alternative exists) */}
              {activeRoute.alternativeRoute &&
                activeRoute.alternativeRoute.roadIds.map((rId) => {
                  const r = roads.find((item) => item.id === rId);
                  if (!r) return null;
                  const f = nodeMap.get(r.fromNodeId);
                  const t = nodeMap.get(r.toNodeId);
                  if (!f || !t) return null;
                  return (
                    <line
                      key={`alt-${rId}`}
                      x1={f.x}
                      y1={f.y}
                      x2={t.x}
                      y2={t.y}
                      stroke="#34D399"
                      strokeWidth="3.5"
                      strokeDasharray="8 5"
                      strokeLinecap="round"
                      opacity="0.8"
                    />
                  );
                })}

              {/* Primary Route (Calibrated Cyan Corridor + Safe Route Callout) */}
              {activeRoute.feasible &&
                activeRoute.recommendedRoadIds.map((rId, idx) => {
                  const r = roads.find((item) => item.id === rId);
                  if (!r) return null;
                  const f = nodeMap.get(r.fromNodeId);
                  const t = nodeMap.get(r.toNodeId);
                  if (!f || !t) return null;
                  const midX = (f.x + t.x) / 2;
                  const midY = (f.y + t.y) / 2;
                  return (
                    <g key={`rec-${rId}-${activeRoute.recommendedRoadIds.join('-')}`}>
                      <line
                        x1={f.x}
                        y1={f.y}
                        x2={t.x}
                        y2={t.y}
                        stroke="#0891B2"
                        strokeWidth="8"
                        strokeLinecap="round"
                        opacity="0.6"
                      />
                      <line
                        x1={f.x}
                        y1={f.y}
                        x2={t.x}
                        y2={t.y}
                        stroke="#22D3EE"
                        strokeWidth="4.5"
                        strokeDasharray="12 6"
                        strokeLinecap="round"
                        markerEnd="url(#arrow-route)"
                        filter="url(#route-glow)"
                      >
                        <animate
                          attributeName="stroke-dashoffset"
                          from="36"
                          to="0"
                          dur="1.1s"
                          repeatCount="indefinite"
                        />
                      </line>
                      {idx === 1 && (
                        <g transform={`translate(${midX}, ${midY + 16})`}>
                          <rect
                            x="-62"
                            y="-9"
                            width="124"
                            height="16"
                            rx="2"
                            fill="#083344"
                            stroke="#22D3EE"
                            strokeWidth="1.2"
                          />
                          <text
                            x="0"
                            y="2.5"
                            textAnchor="middle"
                            fill="#A5F3FC"
                            fontSize="8.5"
                            fontFamily="IBM Plex Mono, monospace"
                            fontWeight="700"
                          >
                            ✓ RECOMMENDED ROUTE
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

              {/* No Route Remaining: Highlight safe staging point connection if available */}
              {!activeRoute.feasible &&
                activeRoute.noRouteInfo?.nearestReachableSafePoint?.pathRoadIds.map(
                  (rId, idx) => {
                    const r = roads.find((item) => item.id === rId);
                    if (!r) return null;
                    const f = nodeMap.get(r.fromNodeId);
                    const t = nodeMap.get(r.toNodeId);
                    if (!f || !t) return null;
                    const midX = (f.x + t.x) / 2;
                    const midY = (f.y + t.y) / 2;
                    return (
                      <g key={`safepath-${rId}`}>
                        <line
                          x1={f.x}
                          y1={f.y}
                          x2={t.x}
                          y2={t.y}
                          stroke="#10B981"
                          strokeWidth="4"
                          strokeDasharray="6 4"
                          strokeLinecap="round"
                          opacity="0.85"
                        />
                        {idx === 0 && (
                          <g transform={`translate(${midX}, ${midY + 16})`}>
                            <rect
                              x="-68"
                              y="-9"
                              width="136"
                              height="16"
                              rx="2"
                              fill="#064E3B"
                              stroke="#10B981"
                              strokeWidth="1.2"
                            />
                            <text
                              x="0"
                              y="2.5"
                              textAnchor="middle"
                              fill="#A7F3D0"
                              fontSize="8"
                              fontFamily="IBM Plex Mono, monospace"
                              fontWeight="700"
                            >
                              ● PATH TO SAFE POINT
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  }
                )}
            </g>
          )}

          {/* 5b. Evacuation Route Corridor Overlay (Distinct Emerald Corridor along road network) */}
          {layers.routes && evacuationRoute && evacuationRoute.routeRoadIds.length > 0 && (
            <g pointerEvents="none">
              {evacuationRoute.routeRoadIds.map((rId, idx) => {
                const r = roads.find((item) => item.id === rId);
                if (!r) return null;
                const f = nodeMap.get(r.fromNodeId);
                const t = nodeMap.get(r.toNodeId);
                if (!f || !t) return null;
                const midX = (f.x + t.x) / 2;
                const midY = (f.y + t.y) / 2;
                return (
                  <g key={`evac-corridor-${rId}-${idx}`}>
                    {/* Base wider green glow */}
                    <line
                      x1={f.x}
                      y1={f.y}
                      x2={t.x}
                      y2={t.y}
                      stroke="#064E3B"
                      strokeWidth="9"
                      strokeLinecap="round"
                      opacity="0.75"
                    />
                    {/* Vibrant pulsing emerald line */}
                    <line
                      x1={f.x}
                      y1={f.y}
                      x2={t.x}
                      y2={t.y}
                      stroke="#10B981"
                      strokeWidth="5"
                      strokeDasharray="14 6"
                      strokeLinecap="round"
                      markerEnd="url(#arrow-evac)"
                    >
                      <animate
                        attributeName="stroke-dashoffset"
                        from="40"
                        to="0"
                        dur="1.2s"
                        repeatCount="indefinite"
                      />
                    </line>
                    {idx === 0 && (
                      <g transform={`translate(${midX}, ${midY + 18})`}>
                        <rect
                          x="-64"
                          y="-9"
                          width="128"
                          height="16"
                          rx="2"
                          fill="#064E3B"
                          stroke="#10B981"
                          strokeWidth="1.2"
                        />
                        <text
                          x="0"
                          y="2.5"
                          textAnchor="middle"
                          fill="#A7F3D0"
                          fontSize="8.5"
                          fontFamily="IBM Plex Mono, monospace"
                          fontWeight="700"
                        >
                          ▲ EVACUATION CORRIDOR
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* 6. Intersection Nodes */}
          {layers.roads &&
            INTERSECTION_NODES.map((node) => {
              const isOrigin = activeRoute?.originNodeId === node.id;
              const isDest = activeRoute?.destinationNodeId === node.id;
              return (
                <g key={node.id} pointerEvents="none">
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={isOrigin || isDest ? 7 : 4}
                    fill={isOrigin ? '#22D3EE' : isDest ? '#10B981' : '#1E293B'}
                    stroke="#E2E8F0"
                    strokeWidth={isOrigin || isDest ? 2 : 1.2}
                  />
                  <text
                    x={node.x + 8}
                    y={node.y + 4}
                    fill="#E2E8F0"
                    fontSize="10"
                    fontFamily="Plus Jakarta Sans, sans-serif"
                    fontWeight="600"
                    stroke="#05080E"
                    strokeWidth="2.5"
                    paintOrder="stroke"
                  >
                    {node.name}
                  </text>
                </g>
              );
            })}

          {/* 7. Critical Assets & Evacuation Shelters */}
          {layers.assetsAndShelters && (
            <>
              {CRITICAL_ASSETS.map((asset) => {
                const isSelected =
                  selectedTarget?.type === 'ASSET' && selectedTarget?.id === asset.id;
                const glyph =
                  asset.category === 'HOSPITAL'
                    ? '✚'
                    : asset.category === 'FIRE_EMERGENCY'
                    ? '★'
                    : asset.category === 'POWER_SUBSTATION'
                    ? '⚡'
                    : '■';
                return (
                  <g
                    key={asset.id}
                    transform={`translate(${asset.x}, ${asset.y})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (dragStartRef.current.moved) return;
                      onSelectTarget({ type: 'ASSET', id: asset.id });
                    }}
                    onMouseEnter={() =>
                      setHoveredInfo(
                        `CRITICAL ASSET: ${asset.name} (${asset.category}) · Elev ${asset.elevationM}m MSL`
                      )
                    }
                    onMouseLeave={() => setHoveredInfo(null)}
                    className="cursor-pointer"
                  >
                    <rect
                      x="-11"
                      y="-11"
                      width="22"
                      height="22"
                      rx="4"
                      fill="#0F172A"
                      stroke={isSelected ? '#38BDF8' : '#F8FAFC'}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                    />
                    <text
                      x="0"
                      y="4"
                      textAnchor="middle"
                      fill={asset.category === 'HOSPITAL' ? '#38BDF8' : '#FBBF24'}
                      fontSize="11"
                      fontFamily="IBM Plex Mono, monospace"
                      fontWeight="700"
                    >
                      {glyph}
                    </text>
                  </g>
                );
              })}

              {/* Evacuation Flow Vectors from Critical Hotspots to Reachable Shelters */}
              {cells
                .filter((c) => c.severity === FloodSeverity.CRITICAL && c.floodProbability >= 0.72)
                .map((critCell) => {
                  const cellCenterX = (critCell.col + 0.5) * cellSize;
                  const cellCenterY = (critCell.row + 0.5) * cellSize;
                  const nearestReachableShelter = shelters.find(
                    (s) => s.reachable && s.remainingCapacity > 0
                  );
                  if (!nearestReachableShelter) return null;

                  return (
                    <g key={`evac-flow-${critCell.id}`} pointerEvents="none">
                      <line
                        x1={cellCenterX}
                        y1={cellCenterY}
                        x2={nearestReachableShelter.x}
                        y2={nearestReachableShelter.y}
                        stroke="#059669"
                        strokeWidth="2"
                        strokeDasharray="6 4"
                        opacity="0.65"
                        markerEnd="url(#arrow-evac)"
                      />
                    </g>
                  );
                })}

              {shelters.map((sh) => {
                const isSelected =
                  selectedTarget?.type === 'SHELTER' && selectedTarget?.id === sh.id;
                const occPct = Math.round((sh.currentOccupancy / Math.max(1, sh.totalCapacity)) * 100);
                return (
                  <g
                    key={sh.id}
                    transform={`translate(${sh.x}, ${sh.y})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (dragStartRef.current.moved) return;
                      onSelectTarget({ type: 'SHELTER', id: sh.id });
                    }}
                    onMouseEnter={() =>
                      setHoveredInfo(
                        `SHELTER ${sh.id}: ${sh.name} · Occupancy ${sh.currentOccupancy}/${sh.totalCapacity} (${occPct}%) · Elev ${sh.elevationM}m MSL`
                      )
                    }
                    onMouseLeave={() => setHoveredInfo(null)}
                    className="cursor-pointer"
                  >
                    <polygon
                      points="0,-14 13,9 -13,9"
                      fill="#064E3B"
                      stroke={isSelected ? '#38BDF8' : '#34D399'}
                      strokeWidth={isSelected ? 2.5 : 1.8}
                    />
                    <text
                      x="0"
                      y="6"
                      textAnchor="middle"
                      fill="#A7F3D0"
                      fontSize="9"
                      fontFamily="IBM Plex Mono, monospace"
                      fontWeight="700"
                    >
                      ▲
                    </text>
                    <rect
                      x="-22"
                      y="12"
                      width="44"
                      height="12"
                      fill="#060911"
                      stroke="#059669"
                      strokeWidth="0.8"
                    />
                    <text
                      x="0"
                      y="21"
                      textAnchor="middle"
                      fill="#A7F3D0"
                      fontSize="8"
                      fontFamily="IBM Plex Mono, monospace"
                      fontWeight="600"
                    >
                      {sh.currentOccupancy}/{sh.totalCapacity}
                    </text>
                  </g>
                );
              })}
            </>
          )}

          {/* 8. Rain Gauges & Water-Level Sensors */}
          {sensors
            .filter(
              (s) =>
                (s.type === 'RAIN_GAUGE' && layers.rainGauges) ||
                (s.type !== 'RAIN_GAUGE' && layers.waterLevelSensors)
            )
            .map((s) => {
              const isSelected =
                selectedTarget?.type === 'SENSOR' && selectedTarget?.id === s.id;
              const ringColor =
                s.freshnessState === 'MISSING'
                  ? '#F43F5E'
                  : s.freshnessState === 'SUSPECT'
                  ? '#F97316'
                  : s.freshnessState === 'STALE'
                  ? '#EAB308'
                  : '#22D3EE';

              return (
                <g
                  key={s.id}
                  transform={`translate(${s.x}, ${s.y - 18})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dragStartRef.current.moved) return;
                    onSelectTarget({ type: 'SENSOR', id: s.id });
                  }}
                  onMouseEnter={() =>
                    setHoveredInfo(
                      `SENSOR ${s.id}: ${s.name} · ${s.currentValue} ${s.unit} · Quality: ${s.freshnessState} (${s.lastSeenLabel}) · Conf ${Math.round(
                        s.confidence * 100
                      )}%`
                    )
                  }
                  onMouseLeave={() => setHoveredInfo(null)}
                  className="cursor-pointer"
                >
                  <circle
                    cx="0"
                    cy="0"
                    r={isSelected ? 10.5 : 8.5}
                    fill="#090D16"
                    stroke={ringColor}
                    strokeWidth={isSelected ? 2.5 : 1.8}
                  />
                  <text
                    x="0"
                    y="3.5"
                    textAnchor="middle"
                    fill={ringColor}
                    fontSize="8.5"
                    fontFamily="IBM Plex Mono, monospace"
                    fontWeight="700"
                  >
                    {s.type === 'RAIN_GAUGE' ? 'RG' : 'WL'}
                  </text>
                </g>
              );
            })}

          {/* 9. Area Selection / Highlight Overlay (Prominent, High-Contrast Reticle & Focus Frame) */}
          {selectedArea && (
            <g pointerEvents="none">
              <rect
                x={selectedArea.col * cellSize}
                y={selectedArea.row * cellSize}
                width={cellSize}
                height={cellSize}
                fill="rgba(34, 211, 238, 0.08)"
                stroke="#22D3EE"
                strokeWidth="2.5"
                strokeDasharray="6 3"
              >
                <animate
                  attributeName="stroke-opacity"
                  values="1;0.4;1"
                  dur="2s"
                  repeatCount="indefinite"
                />
              </rect>
              {/* Corner bracket accents */}
              <path
                d={`M ${selectedArea.col * cellSize},${selectedArea.row * cellSize + 14} L ${selectedArea.col * cellSize},${selectedArea.row * cellSize} L ${selectedArea.col * cellSize + 14},${selectedArea.row * cellSize}`}
                stroke="#38BDF8"
                strokeWidth="3.5"
                fill="none"
              />
              <path
                d={`M ${selectedArea.col * cellSize + cellSize - 14},${selectedArea.row * cellSize} L ${selectedArea.col * cellSize + cellSize},${selectedArea.row * cellSize} L ${selectedArea.col * cellSize + cellSize},${selectedArea.row * cellSize + 14}`}
                stroke="#38BDF8"
                strokeWidth="3.5"
                fill="none"
              />
              <path
                d={`M ${selectedArea.col * cellSize},${selectedArea.row * cellSize + cellSize - 14} L ${selectedArea.col * cellSize},${selectedArea.row * cellSize + cellSize} L ${selectedArea.col * cellSize + 14},${selectedArea.row * cellSize + cellSize}`}
                stroke="#38BDF8"
                strokeWidth="3.5"
                fill="none"
              />
              <path
                d={`M ${selectedArea.col * cellSize + cellSize - 14},${selectedArea.row * cellSize + cellSize} L ${selectedArea.col * cellSize + cellSize},${selectedArea.row * cellSize + cellSize} L ${selectedArea.col * cellSize + cellSize},${selectedArea.row * cellSize + cellSize - 14}`}
                stroke="#38BDF8"
                strokeWidth="3.5"
                fill="none"
              />
            </g>
          )}
        </svg>

        {/* Floating Bottom-Left Clean Context-Aware Legend */}
        {isLegendCollapsed ? (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-3 left-3 z-10 interactive-panel"
          >
            <button
              type="button"
              onClick={() => setIsLegendCollapsed(false)}
              className="px-2.5 py-1 bg-[#090D16]/90 hover:bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10.5px] shadow-lg flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Expand Map Legend"
            >
              <span>▤</span>
              <span>Legend</span>
            </button>
          </div>
        ) : (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-3 left-3 z-10 bg-[#090D16]/95 border border-slate-800 px-3 py-2 text-[11px] font-mono text-slate-300 max-w-sm sm:max-w-md shadow-xl max-h-[min(50vh,320px)] overflow-y-auto overscroll-contain interactive-panel"
          >
            <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1 font-semibold pb-1 border-b border-slate-800">
              <span className="truncate mr-2">
                {metricOverlay === 'FLOOD_PROBABILITY' && 'FLOOD PROBABILITY & WARNING LEVEL'}
                {metricOverlay === 'SEVERITY' && 'MULTI-MODAL FLOOD SEVERITY'}
                {metricOverlay === 'UNCERTAINTY' && 'UNCERTAINTY SPREAD'}
                {metricOverlay === 'DATA_CONFIDENCE' && 'DATA CONFIDENCE & FRESHNESS'}
                {metricOverlay === 'RAINFALL' && 'SPATIAL RAINFALL ACCUMULATION'}
                {metricOverlay === 'PREDICTED_VS_OBSERVED' && 'PREDICTED VS OBSERVED'}
              </span>
              <button
                type="button"
                onClick={() => setIsLegendCollapsed(true)}
                className="text-slate-400 hover:text-white px-1 text-[10px] whitespace-nowrap cursor-pointer"
                title="Minimize Legend"
              >
                − Minimize
              </button>
            </div>

            {(metricOverlay === 'FLOOD_PROBABILITY' || metricOverlay === 'SEVERITY') && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-1.5">
                <div className="flex items-center gap-1 text-rose-400">
                  <span>✖ RED / CRIT</span>
                  <span className="text-[10px] text-slate-400">(≥74%)</span>
                </div>
                <div className="flex items-center gap-1 text-amber-400">
                  <span>▲ ORANGE / HIGH</span>
                  <span className="text-[10px] text-slate-400">(52–73%)</span>
                </div>
                <div className="flex items-center gap-1 text-yellow-300">
                  <span>◆ YELLOW / MOD</span>
                  <span className="text-[10px] text-slate-400">(30–51%)</span>
                </div>
                <div className="flex items-center gap-1 text-emerald-400">
                  <span>● GREEN / LOW</span>
                  <span className="text-[10px] text-slate-400">(&lt;30%)</span>
                </div>
              </div>
            )}

            {metricOverlay === 'UNCERTAINTY' && (
              <div className="flex items-center gap-4 mb-1.5 text-[10.5px]">
                <span className="text-sky-300">● Low Spread (≤±7%)</span>
                <span className="text-amber-300">▲ Moderate Spread (±8–11%)</span>
                <span className="text-purple-300">✖ High Epistemic Spread (≥±12%)</span>
              </div>
            )}

            {metricOverlay === 'DATA_CONFIDENCE' && (
              <div className="flex items-center gap-4 mb-1.5 text-[10.5px]">
                <span className="text-emerald-300">● High Conf (≥85%)</span>
                <span className="text-sky-300">◆ Moderate Conf (72–84%)</span>
                <span className="text-rose-300">▲ Degraded / Stale (&lt;72%)</span>
              </div>
            )}

            {metricOverlay === 'RAINFALL' && (
              <div className="flex items-center gap-4 mb-1.5 text-[10.5px]">
                <span className="text-sky-200">● Moderate (&lt;35 mm/h)</span>
                <span className="text-sky-400">◆ Heavy (35–54 mm/h)</span>
                <span className="text-cyan-300 font-semibold">▲ Cloudburst (≥55 mm/h)</span>
              </div>
            )}

            {metricOverlay === 'PREDICTED_VS_OBSERVED' && (
              <div className="flex flex-wrap items-center gap-3 mb-1.5 text-[10.5px]">
                <span className="text-rose-400 font-bold">✖ FALSE NEGATIVE (Missed Flood)</span>
                <span className="text-emerald-300">● TRUE POSITIVE (Hit)</span>
                <span className="text-amber-300">▲ FALSE POSITIVE (Over-warned)</span>
                <span className="text-slate-400">○ TRUE NEGATIVE</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400 border-t border-slate-800/80 pt-1">
              <span className="text-sky-400">┅┅ 5×5km Pilot</span>
              <span className="text-orange-300">◌ Iso-Risk</span>
              <span className="text-cyan-300">━ Route</span>
              <span className="text-rose-400">┅✖┅ Blocked</span>
              <span className="text-cyan-300">◉WL / ◉RG Sensors</span>
              <span className="text-emerald-300">▲S Shelter</span>
              <span className="text-sky-300">✚ Hospital</span>
            </div>
          </div>
        )}

        {/* Floating Bottom-Right Scale Bar (Hidden by default) */}
        {isScaleVisible && (
          <div className="absolute bottom-3 right-3 bg-[#090D16]/95 border border-slate-800 px-3 py-1.5 text-[11px] font-mono text-slate-300 pointer-events-none flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">SCALE:</span>
              <div className="w-20 h-1.5 border-x border-b border-slate-300 relative">
                <span className="absolute -top-3.5 left-0 text-[9px]">0</span>
                <span className="absolute -top-3.5 right-0 text-[9px]">1.0 km</span>
              </div>
            </div>
            <div className="text-[10px] text-slate-400 tabular-nums">
              Indore Pilot · {PILOT_BOUNDS.minLat}°N–{PILOT_BOUNDS.maxLat}°N
            </div>
          </div>
        )}
      </div>

      {/* Bottom Live Crosshair Probe Bar */}
      <div className="h-7 min-h-[28px] max-h-[28px] px-3 bg-[#090D16] border-t border-slate-800/90 font-mono text-[11px] text-slate-300 flex items-center justify-between gap-2 overflow-hidden shrink-0">
        <span className="truncate min-w-0 flex-1">
          {hoveredInfo
            ? `PROBE: ${hoveredInfo}`
            : 'EOC MAP READY: Click any cell to inspect Flood Probability, Severity, Confidence, Expected Onset, and Top Drivers.'}
        </span>
        <span className="text-slate-500 shrink-0 text-[10.5px]">Deterministic Weighted Model</span>
      </div>
    </div>
  );
};
