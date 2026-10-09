import React, { useEffect, useMemo, useState } from 'react';
import {
  CRITICAL_ASSETS,
  DRAINAGE_PROXIES,
  INTERSECTION_NODES,
} from '../data/indorePilotData';
import {
  buildCurrentTwinSnapshot,
  evaluateIsolatedTwinScenario,
  IsolatedTwinSnapshot,
  TWIN_PRESET_OPTIONS,
  TwinDurationMinutes,
  TwinPresetId,
} from '../modules/disasterTwin';
import {
  DISASTER_STAGE_INFO,
  DisasterStage,
  EvacuationPlanItem,
  FloodRiskCell,
  FloodSeverity,
  InjectedObservationState,
  RoadSegmentState,
  RoadStatus,
  RouteRecommendation,
  ScenarioParameters,
  SensorNode,
  Shelter,
} from '../types/idhara';
import { MapInspectionTarget } from './IndoreFloodMap';
import {
  ProvenanceStrip,
  ROAD_STATUS_META,
  RoadStateIndicator,
  ScreenHonestyHeader,
  SEVERITY_META,
  SeverityIndicator,
  WARNING_LEVEL_META,
} from './SeverityVisuals';

interface DisasterTwinWorkspaceProps {
  /**
   * Read-only baseline parameters from the main app.
   * CRITICAL RULE: Disaster Twin never mutates the LIVE/Current state.
   */
  baselineParams: ScenarioParameters;
  baselineCells?: FloodRiskCell[];
  baselineRoads?: RoadSegmentState[];
  baselineSensors?: SensorNode[];
  baselineShelters?: Shelter[];
  baselineRoutes?: RouteRecommendation[];
  baselineEvacuationPlans?: EvacuationPlanItem[];
  injectedObservations?: InjectedObservationState;
  selectedTarget: MapInspectionTarget;
  onSelectTarget: (target: MapInspectionTarget) => void;
  onSelectStage?: (stage: DisasterStage) => void;
  isPlayingTimeline?: boolean;
  onTogglePlayTimeline?: () => void;
  onReturnToLive?: () => void;
}

const DURATION_OPTIONS: TwinDurationMinutes[] = [30, 60, 90, 120];

export const DisasterTwinWorkspace: React.FC<DisasterTwinWorkspaceProps> = ({
  baselineParams,
  baselineCells,
  baselineRoads,
  baselineSensors,
  baselineShelters,
  baselineRoutes,
  baselineEvacuationPlans,
  injectedObservations,
  selectedTarget,
  onSelectTarget,
  onSelectStage: _onSelectStage,
  isPlayingTimeline: _isPlayingTimeline = false,
  onTogglePlayTimeline: _onTogglePlayTimeline,
  onReturnToLive,
}) => {
  // Primary interactive Scenario A controls
  const [activePreset, setActivePreset] = useState<TwinPresetId>('PLUS_20');
  const [durationMinutes, setDurationMinutes] = useState<TwinDurationMinutes>(60);
  const [customRainMmHr, setCustomRainMmHr] = useState<number>(
    Math.min(105, Math.round(baselineParams.rainfallIntensityMmHr * 1.45))
  );
  const [blockageBonusPct, setBlockageBonusPct] = useState<number>(5);

  // Comparison Scenario B selector
  const [comparePresetB, setComparePresetB] = useState<TwinPresetId>('EXTREME');

  // "Before / After" animation state
  const [viewMode, setViewMode] = useState<'SPLIT' | 'BEFORE_ONLY' | 'AFTER_ONLY'>('SPLIT');
  const [isAnimatingHorizon, setIsAnimatingHorizon] = useState<boolean>(false);

  // Synchronize scenario parameters with the authoritative Disaster Twin stage
  useEffect(() => {
    if (baselineParams.stage === DisasterStage.EARLY_WARNING) {
      setActivePreset('PLUS_10');
      setDurationMinutes(30);
    } else if (baselineParams.stage === DisasterStage.PRE_DISASTER_SCENARIO) {
      setActivePreset('PLUS_20');
      setDurationMinutes(60);
    } else if (baselineParams.stage === DisasterStage.REAL_TIME_ONGOING) {
      setActivePreset('EXTREME');
      setDurationMinutes(90);
    } else if (baselineParams.stage === DisasterStage.POST_DISASTER_LEARNING) {
      setActivePreset('PLUS_30');
      setDurationMinutes(120);
    }
  }, [baselineParams.stage]);

  // 1. Authoritative Current / Baseline Snapshot directly from shared data source
  const currentSnapshot: IsolatedTwinSnapshot = useMemo(() => {
    if (baselineCells && baselineRoads && baselineShelters && baselineRoutes) {
      return buildCurrentTwinSnapshot(
        baselineParams,
        baselineCells,
        baselineRoads,
        baselineShelters,
        baselineEvacuationPlans ?? [],
        baselineRoutes
      );
    }
    return evaluateIsolatedTwinScenario(
      baselineParams,
      {
        presetId: 'CURRENT',
        label: 'Current State (Baseline)',
        durationMinutes: 60,
        drainageBlockageDeltaPct: 0,
      },
      injectedObservations,
      baselineRoads
    );
  }, [
    baselineParams,
    baselineCells,
    baselineRoads,
    baselineShelters,
    baselineRoutes,
    baselineEvacuationPlans,
    injectedObservations,
  ]);

  // 2. Isolated Active Scenario Snapshot (SIMULATED / scenario-ID)
  const activeScenario: IsolatedTwinSnapshot = useMemo(() => {
    const presetMeta =
      TWIN_PRESET_OPTIONS.find((p) => p.id === activePreset) ??
      TWIN_PRESET_OPTIONS[2];
    return evaluateIsolatedTwinScenario(
      baselineParams,
      {
        presetId: activePreset,
        label: presetMeta.label,
        durationMinutes,
        customRainfallMmHr: customRainMmHr,
        drainageBlockageDeltaPct: blockageBonusPct,
      },
      injectedObservations,
      baselineRoads
    );
  }, [
    baselineParams,
    activePreset,
    durationMinutes,
    customRainMmHr,
    blockageBonusPct,
    injectedObservations,
    baselineRoads,
  ]);

  // 3. Comparison Scenario B Snapshot for Comparison Matrix
  const comparisonScenarioB: IsolatedTwinSnapshot = useMemo(() => {
    const presetMeta =
      TWIN_PRESET_OPTIONS.find((p) => p.id === comparePresetB) ??
      TWIN_PRESET_OPTIONS[4];
    return evaluateIsolatedTwinScenario(
      baselineParams,
      {
        presetId: comparePresetB,
        label: presetMeta.label,
        durationMinutes,
        customRainfallMmHr: Math.min(110, customRainMmHr + 18),
        drainageBlockageDeltaPct: blockageBonusPct + 10,
      },
      injectedObservations,
      baselineRoads
    );
  }, [
    baselineParams,
    comparePresetB,
    durationMinutes,
    customRainMmHr,
    blockageBonusPct,
    injectedObservations,
    baselineRoads,
  ]);

  // Animate across 30m -> 60m -> 90m -> 120m when "Animate Before -> After" is active
  useEffect(() => {
    if (!isAnimatingHorizon) return;
    const timer = window.setInterval(() => {
      setDurationMinutes((prev) => {
        const idx = DURATION_OPTIONS.indexOf(prev);
        return DURATION_OPTIONS[(idx + 1) % DURATION_OPTIONS.length];
      });
    }, 1600);
    return () => window.clearInterval(timer);
  }, [isAnimatingHorizon]);

  // Deltas between Active Scenario and Current State (strictly guarded against NaN / undefined)
  const deltaHighRiskCells =
    (activeScenario.metrics.highAndCriticalCellsCount ?? 0) -
    (currentSnapshot.metrics.highAndCriticalCellsCount ?? 0);
  const rawDeltaArea =
    (activeScenario.metrics.affectedAreaKm2 ?? 0) -
    (currentSnapshot.metrics.affectedAreaKm2 ?? 0);
  const deltaAreaKm2 = Number.isFinite(rawDeltaArea)
    ? Number(rawDeltaArea.toFixed(2))
    : 0;
  const deltaAtRiskRoads =
    (activeScenario.metrics.atRiskRoadsCount ?? 0) -
    (currentSnapshot.metrics.atRiskRoadsCount ?? 0);
  const deltaClosedRoads =
    (activeScenario.metrics.closedRoadsCount ?? 0) -
    (currentSnapshot.metrics.closedRoadsCount ?? 0);
  const deltaExposedAssets =
    (activeScenario.metrics.exposedAssetsCount ?? 0) -
    (currentSnapshot.metrics.exposedAssetsCount ?? 0);
  const deltaShelterDemand =
    (activeScenario.metrics.shelterDemandBerths ?? 0) -
    (currentSnapshot.metrics.shelterDemandBerths ?? 0);
  const deltaPopProxy =
    (activeScenario.metrics.estimatedAffectedPopProxy ?? 0) -
    (currentSnapshot.metrics.estimatedAffectedPopProxy ?? 0);

  // Identify newly transitioned cells and roads for visual emphasis
  const currentCellMap = useMemo(
    () => new Map(currentSnapshot.cells.map((c) => [c.id, c])),
    [currentSnapshot.cells]
  );
  const currentRoadMap = useMemo(
    () => new Map(currentSnapshot.roads.map((r) => [r.id, r])),
    [currentSnapshot.roads]
  );

  // Inspected Cell / Road comparison between Current vs Scenario
  const inspectedCellId =
    selectedTarget.type === 'CELL' ? selectedTarget.id : 'CELL-R2C2';
  const baseInspectedCell =
    currentCellMap.get(inspectedCellId) ?? currentSnapshot.cells[18] ?? currentSnapshot.cells[0];
  const scenInspectedCell =
    activeScenario.cells.find((c) => c.id === inspectedCellId) ??
    activeScenario.cells[18] ??
    activeScenario.cells[0];

  const renderMiniTwinMap = (
    snapshot: IsolatedTwinSnapshot,
    isScenarioPane: boolean,
    paneTitle: string,
    paneSubtitle: string
  ) => {
    const cellSize = 1000 / 8;
    const nodeMap = new Map(INTERSECTION_NODES.map((n) => [n.id, n]));
    const exposedIds = new Set(snapshot.metrics.exposedAssets.map((a) => a.id));

    return (
      <div className="flex flex-col flex-1 min-w-[300px] bg-[#05080F] border border-slate-800 overflow-hidden">
        {/* Map Pane Header */}
        <div
          className={`px-3 py-2 border-b flex items-center justify-between gap-2 font-mono text-xs ${
            isScenarioPane
              ? 'bg-amber-950/35 border-amber-500/50 text-amber-200'
              : 'bg-[#0A0F1A] border-slate-800 text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            <span className={isScenarioPane ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
              {isScenarioPane ? '◈ AFTER (SCENARIO PROJECTION)' : '● BEFORE (CURRENT SITUATION)'}
            </span>
            <span className="text-slate-500">·</span>
            <span className="truncate">{paneTitle}</span>
          </div>
          <span className="text-[11px] text-slate-300 shrink-0 tabular-nums">
            {paneSubtitle}
          </span>
        </div>

        {/* SVG Geospatial Canvas */}
        <div className="relative flex-1 min-h-[340px] flex items-center justify-center bg-[#04070C] p-1">
          <svg
            viewBox="0 0 1000 1000"
            className="w-full h-full max-h-[440px] cursor-crosshair"
            role="img"
            aria-label={paneTitle}
          >
            <defs>
              <pattern
                id={`pat-crit-${isScenarioPane ? 'scen' : 'cur'}`}
                width="16"
                height="16"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 0,16 L 16,0 M 0,0 L 16,16"
                  stroke="rgba(248, 113, 113, 0.48)"
                  strokeWidth="1.5"
                />
              </pattern>
              <pattern
                id={`pat-high-${isScenarioPane ? 'scen' : 'cur'}`}
                width="14"
                height="14"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M -2,14 L 14,-2 M 6,16 L 16,6"
                  stroke="rgba(251, 146, 60, 0.46)"
                  strokeWidth="1.5"
                />
              </pattern>
              <radialGradient id={`glow-crit-${isScenarioPane ? 'scen' : 'cur'}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#EF4444" stopOpacity="0.52" />
                <stop offset="60%" stopColor="#F97316" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Continuous Flood-Risk Heatmap Underlay + Iso-Risk Contours */}
            {snapshot.cells
              .filter(
                (c) =>
                  c.severity === FloodSeverity.CRITICAL ||
                  c.severity === FloodSeverity.HIGH
              )
              .map((c) => {
                const cx = (c.col + 0.5) * cellSize;
                const cy = (c.row + 0.5) * cellSize;
                const isCrit = c.severity === FloodSeverity.CRITICAL;
                return (
                  <g key={`glow-${c.id}`} pointerEvents="none">
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isCrit ? 155 : 115}
                      fill={`url(#glow-crit-${isScenarioPane ? 'scen' : 'cur'})`}
                    />
                    <ellipse
                      cx={cx}
                      cy={cy}
                      rx={isCrit ? 76 : 62}
                      ry={isCrit ? 66 : 54}
                      fill="none"
                      stroke={isCrit ? 'rgba(248, 113, 113, 0.72)' : 'rgba(251, 146, 60, 0.45)'}
                      strokeWidth={isCrit ? 1.5 : 1.1}
                      strokeDasharray={isCrit ? 'none' : '5 3'}
                    />
                  </g>
                );
              })}

            {/* 64 Spatial Cells */}
            {snapshot.cells.map((cell) => {
              const x = cell.col * cellSize;
              const y = cell.row * cellSize;
              const sevMeta = SEVERITY_META[cell.severity];
              const isSelected =
                selectedTarget.type === 'CELL' && selectedTarget.id === cell.id;

              const baseCell = currentCellMap.get(cell.id);
              const didEscalateSeverity =
                isScenarioPane &&
                baseCell &&
                baseCell.severity !== cell.severity &&
                (cell.severity === FloodSeverity.CRITICAL ||
                  cell.severity === FloodSeverity.HIGH);

              return (
                <g
                  key={cell.id}
                  onClick={() => onSelectTarget({ type: 'CELL', id: cell.id })}
                  className="cursor-pointer"
                >
                  <rect
                    x={x}
                    y={y}
                    width={cellSize}
                    height={cellSize}
                    fill={sevMeta.svgFill}
                    stroke={
                      isSelected
                        ? '#38BDF8'
                        : didEscalateSeverity
                        ? '#F59E0B'
                        : 'rgba(51, 65, 85, 0.5)'
                    }
                    strokeWidth={isSelected ? 3.5 : didEscalateSeverity ? 2 : 1}
                  />

                  {cell.severity === FloodSeverity.CRITICAL && (
                    <rect
                      x={x}
                      y={y}
                      width={cellSize}
                      height={cellSize}
                      fill={`url(#pat-crit-${isScenarioPane ? 'scen' : 'cur'})`}
                      pointerEvents="none"
                    />
                  )}
                  {cell.severity === FloodSeverity.HIGH && (
                    <rect
                      x={x}
                      y={y}
                      width={cellSize}
                      height={cellSize}
                      fill={`url(#pat-high-${isScenarioPane ? 'scen' : 'cur'})`}
                      pointerEvents="none"
                    />
                  )}

                  {/* Cell Label */}
                  <text
                    x={x + 6}
                    y={y + 16}
                    fill={
                      cell.severity === FloodSeverity.CRITICAL
                        ? '#FCA5A5'
                        : cell.severity === FloodSeverity.HIGH
                        ? '#FDBA74'
                        : cell.severity === FloodSeverity.MODERATE
                        ? '#FDE047'
                        : '#6EE7B7'
                    }
                    fontSize="10.5"
                    fontFamily="IBM Plex Mono, monospace"
                    fontWeight="600"
                    pointerEvents="none"
                  >
                    {sevMeta.glyph} {Math.round(cell.floodProbability * 100)}%
                    {didEscalateSeverity ? ' ▲NEW' : ''}
                  </text>

                  <text
                    x={x + 6}
                    y={y + 31}
                    fill="#E2E8F0"
                    fontSize="9.5"
                    fontFamily="Plus Jakarta Sans, sans-serif"
                    pointerEvents="none"
                  >
                    {cell.localityName.slice(0, 15)}
                  </text>

                  <text
                    x={x + 6}
                    y={y + cellSize - 8}
                    fill="#CBD5E1"
                    fontSize="10"
                    fontFamily="IBM Plex Mono, monospace"
                    pointerEvents="none"
                  >
                    {cell.predictedDepthCm}cm · {cell.wardCode}
                  </text>
                </g>
              );
            })}

            {/* Rivers & Drainage */}
            {DRAINAGE_PROXIES.map((d) => (
              <polyline
                key={d.id}
                points={d.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#0284C7"
                strokeWidth={d.type === 'RIVER_CHANNEL' ? 5 : 3}
                opacity="0.75"
                pointerEvents="none"
              />
            ))}

            {/* Road Network */}
            {snapshot.roads.map((road) => {
              const f = nodeMap.get(road.fromNodeId);
              const t = nodeMap.get(road.toNodeId);
              if (!f || !t) return null;
              const statusMeta =
                ROAD_STATUS_META[road.currentState] ?? ROAD_STATUS_META[RoadStatus.OPEN];
              const baseRoad = currentRoadMap.get(road.id);
              const wasClosedInBase =
                baseRoad?.currentState === RoadStatus.CLOSED;
              const isClosedNow =
                road.currentState === RoadStatus.CLOSED;
              const newlyClosed = isScenarioPane && !wasClosedInBase && isClosedNow;

              return (
                <g
                  key={road.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTarget({ type: 'ROAD', id: road.id });
                  }}
                  className="cursor-pointer"
                >
                  <line
                    x1={f.x}
                    y1={f.y}
                    x2={t.x}
                    y2={t.y}
                    stroke="#090D16"
                    strokeWidth="6"
                    strokeLinecap="round"
                  />
                  <line
                    x1={f.x}
                    y1={f.y}
                    x2={t.x}
                    y2={t.y}
                    stroke={statusMeta.strokeColor}
                    strokeWidth={newlyClosed ? 5 : 3.5}
                    strokeDasharray={statusMeta.dashArray}
                    strokeLinecap="round"
                  />
                </g>
              );
            })}

            {/* Critical Assets (Highlighting Exposed Assets) */}
            {CRITICAL_ASSETS.map((asset) => {
              const isExposed = exposedIds.has(asset.id);
              return (
                <g
                  key={asset.id}
                  transform={`translate(${asset.x}, ${asset.y})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTarget({ type: 'ASSET', id: asset.id });
                  }}
                  className="cursor-pointer"
                >
                  {isExposed && (
                    <circle
                      cx="0"
                      cy="0"
                      r="17"
                      fill="rgba(239, 68, 68, 0.25)"
                      stroke="#EF4444"
                      strokeWidth="2"
                      strokeDasharray="3 2"
                    />
                  )}
                  <rect
                    x="-10"
                    y="-10"
                    width="20"
                    height="20"
                    rx="3"
                    fill="#0F172A"
                    stroke={isExposed ? '#FCA5A5' : '#E2E8F0'}
                    strokeWidth="1.5"
                  />
                  <text
                    x="0"
                    y="4"
                    textAnchor="middle"
                    fill={isExposed ? '#FCA5A5' : '#38BDF8'}
                    fontSize="10.5"
                    fontFamily="IBM Plex Mono, monospace"
                    fontWeight="700"
                  >
                    {asset.category === 'HOSPITAL' ? '✚' : '★'}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Pane Footer Summary */}
        <div className="px-3 py-1.5 bg-[#080C14] border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-300 tabular-nums">
          <span>
            High/Crit Cells:{' '}
            <strong className="text-white">
              {snapshot.metrics.highAndCriticalCellsCount}
            </strong>{' '}
            ({snapshot.metrics.affectedAreaKm2} km²)
          </span>
          <span>
            At-Risk Roads:{' '}
            <strong className="text-amber-300">
              {snapshot.metrics.atRiskRoadsCount}
            </strong>{' '}
            ({snapshot.metrics.closedRoadsCount} Closed)
          </span>
          <span>
            Assets Exposed:{' '}
            <strong className="text-rose-300">
              {snapshot.metrics.exposedAssetsCount}
            </strong>
          </span>
        </div>
      </div>
    );
  };

  const stageInfo =
    DISASTER_STAGE_INFO[baselineParams.stage] ??
    DISASTER_STAGE_INFO[DisasterStage.REAL_TIME_ONGOING];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-[#060911] p-4 space-y-3">
      {/* 0. MANDATORY DATA HONESTY STRIP (mode · scope · timestamp · confidence · freshness) */}
      <ScreenHonestyHeader
        screenTitle={`DISASTER TWIN WORKSPACE — STAGE ${stageInfo.num}: ${stageInfo.shortLabel.toUpperCase()}`}
        screenSubtle={stageInfo.subtitle}
        mode={activeScenario.mode}
        scopeId={activeScenario.scope_id}
        timestamp={activeScenario.generated_at}
        confidencePct={Math.round(activeScenario.confidence * 100)}
        freshnessLabel="SYNTHETIC HORIZON (+30m..+120m)"
      />

      {/* 1. VERY PROMINENT "SIMULATION — NOT LIVE" ISOLATION BANNER */}
      <div className="p-3 bg-amber-950/50 border-2 border-amber-400/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="px-2.5 py-1 bg-amber-400 text-slate-950 font-mono text-xs font-bold tracking-wide whitespace-nowrap">
            ▲ SIMULATION — NOT LIVE
          </span>
          <div>
            <div className="text-xs sm:text-sm font-semibold text-white">
              Isolated Disaster Twin Workspace — “I can see the flood before it happens.”
            </div>
            <div className="font-mono text-[11px] text-amber-200/90">
              Active Scope: <strong>{activeScenario.scope_id}</strong> · LIVE / Current baseline state remains completely unchanged.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {onReturnToLive && (
            <button
              type="button"
              onClick={onReturnToLive}
              className="px-3 py-1.5 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-400 text-emerald-200 font-mono text-xs font-bold transition-colors whitespace-nowrap shadow-sm"
              title="Exit isolated what-if simulation and return to active Indore pilot live monitoring"
            >
              ← Return to LIVE Monitoring
            </button>
          )}
          <div className="font-mono text-xs text-right tabular-nums">
            <div className="text-amber-300 font-semibold">
              Scenario Projection · Conf {Math.round(activeScenario.confidence * 100)}%
            </div>
            <div className="text-[11px] text-slate-300">
              GEN {activeScenario.generated_at.slice(11, 19)}Z
            </div>
          </div>
        </div>
      </div>

      {/* 2. SCENARIO CONTROLS BAR (Presets + Duration Horizon + Custom Sliders) */}
      <div className="p-3.5 bg-[#0A0F1A] border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Rainfall Assumption Presets */}
          <div className="space-y-1">
            <div className="font-mono text-[10.5px] text-slate-400">
              WHAT-IF RAINFALL ASSUMPTION PRESETS (“What happens if the rainfall gets worse?”)
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {TWIN_PRESET_OPTIONS.map((p) => {
                const isSelected = activePreset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActivePreset(p.id)}
                    className={`px-3 py-1.5 font-mono text-xs border transition-colors whitespace-nowrap ${
                      isSelected
                        ? 'bg-cyan-500/25 border-cyan-400 text-white font-semibold'
                        : 'bg-[#0D1320] border-slate-700 text-slate-300 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Center: Storm Accumulation Horizon (30 min | 60 min | 90 min | 120 min) */}
          <div className="space-y-1">
            <div className="font-mono text-[10.5px] text-slate-400">
              ACCUMULATION HORIZON & BEFORE/AFTER ANIMATION
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {DURATION_OPTIONS.map((dur) => {
                const active = durationMinutes === dur;
                return (
                  <button
                    key={dur}
                    type="button"
                    onClick={() => {
                      setIsAnimatingHorizon(false);
                      setDurationMinutes(dur);
                    }}
                    className={`px-2.5 py-1.5 font-mono text-xs border tabular-nums transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-amber-500/25 border-amber-400 text-amber-200 font-semibold'
                        : 'bg-[#0D1320] border-slate-700 text-slate-300 hover:text-white'
                    }`}
                  >
                    {dur} min
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setIsAnimatingHorizon((v) => !v)}
                className={`px-3 py-1.5 font-mono text-xs border whitespace-nowrap transition-colors ${
                  isAnimatingHorizon
                    ? 'bg-rose-950/60 border-rose-400 text-rose-200 font-semibold'
                    : 'bg-cyan-950/60 border-cyan-500/60 text-cyan-200 hover:bg-cyan-900/70'
                }`}
              >
                {isAnimatingHorizon ? '❚❚ Stop Progression' : '▶ Animate 30m → 120m'}
              </button>
            </div>
          </div>

          {/* Right: Split vs Single View Toggle */}
          <div className="space-y-1">
            <div className="font-mono text-[10.5px] text-slate-400">
              COMPARISON VIEWPORT MODE
            </div>
            <div className="flex items-center gap-1 bg-[#060911] p-0.5 border border-slate-800 font-mono text-xs">
              <button
                type="button"
                onClick={() => setViewMode('SPLIT')}
                className={`px-2.5 py-1 whitespace-nowrap ${
                  viewMode === 'SPLIT'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Split (Before | After)
              </button>
              <button
                type="button"
                onClick={() => setViewMode('BEFORE_ONLY')}
                className={`px-2.5 py-1 whitespace-nowrap ${
                  viewMode === 'BEFORE_ONLY'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Before
              </button>
              <button
                type="button"
                onClick={() => setViewMode('AFTER_ONLY')}
                className={`px-2.5 py-1 whitespace-nowrap ${
                  viewMode === 'AFTER_ONLY'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                After
              </button>
            </div>
          </div>
        </div>

        {/* Custom Rainfall & Blockage Sliders (Always interactive, automatically activates Custom preset if dragged) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80 font-mono text-xs">
          <div className="flex items-center gap-3">
            <label htmlFor="custom-scen-rain" className="text-slate-400 shrink-0">
              Custom Scenario Rain:
            </label>
            <input
              id="custom-scen-rain"
              type="range"
              min={15}
              max={110}
              step={1}
              value={
                activePreset === 'CUSTOM'
                  ? customRainMmHr
                  : activeScenario.scenarioRainfallMmHr
              }
              onChange={(e) => {
                setActivePreset('CUSTOM');
                setCustomRainMmHr(Number(e.target.value));
              }}
              className="flex-1 accent-cyan-400 cursor-pointer"
            />
            <span className="text-cyan-300 font-semibold tabular-nums w-20 text-right">
              {activeScenario.scenarioRainfallMmHr} mm/h
            </span>
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="custom-scen-blockage" className="text-slate-400 shrink-0">
              Additional Culvert Stress:
            </label>
            <input
              id="custom-scen-blockage"
              type="range"
              min={0}
              max={35}
              step={5}
              value={blockageBonusPct}
              onChange={(e) => setBlockageBonusPct(Number(e.target.value))}
              className="flex-1 accent-amber-400 cursor-pointer"
            />
            <span className="text-amber-300 font-semibold tabular-nums w-20 text-right">
              +{blockageBonusPct}% choke
            </span>
          </div>
        </div>
      </div>

      {/* 3. SCENARIO DELTA TELEMETRY STRIP (8 Required Readouts) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5 font-mono">
        <div className="p-2.5 bg-[#0B101B] border border-slate-800">
          <div className="text-[10px] text-slate-400">CURRENT RAINFALL</div>
          <div className="text-lg font-bold text-slate-200 tabular-nums mt-0.5">
            {currentSnapshot.baselineRainfallMmHr} <span className="text-xs font-normal">mm/h</span>
          </div>
          <div className="text-[10px] text-slate-500">LIVE / Baseline</div>
        </div>

        <div className="p-2.5 bg-[#0B101B] border border-amber-500/40">
          <div className="text-[10px] text-amber-300">SCENARIO RAINFALL</div>
          <div className="text-lg font-bold text-amber-300 tabular-nums mt-0.5">
            {activeScenario.scenarioRainfallMmHr} <span className="text-xs font-normal">mm/h</span>
          </div>
          <div className="text-[10px] text-slate-400">Horizon: {durationMinutes} min</div>
        </div>

        <div className="p-2.5 bg-[#0B101B] border border-slate-800">
          <div className="text-[10px] text-slate-400">DIFFERENCE</div>
          <div className="text-lg font-bold text-cyan-300 tabular-nums mt-0.5">
            {activeScenario.rainfallDeltaMmHr >= 0
              ? `+${activeScenario.rainfallDeltaMmHr}`
              : activeScenario.rainfallDeltaMmHr}{' '}
            <span className="text-xs font-normal">mm/h</span>
          </div>
          <div className="text-[10px] text-cyan-400 tabular-nums">
            ({activeScenario.rainfallDeltaPct >= 0 ? `+${activeScenario.rainfallDeltaPct}%` : `${activeScenario.rainfallDeltaPct}%`})
          </div>
        </div>

        <div className="p-2.5 bg-[#0B101B] border border-slate-800">
          <div className="text-[10px] text-slate-400">AFFECTED AREA</div>
          <div className="text-lg font-bold text-white tabular-nums mt-0.5">
            {activeScenario.metrics.affectedAreaKm2} <span className="text-xs font-normal">km²</span>
          </div>
          <div className="text-[10px] text-rose-400 tabular-nums">
            {deltaAreaKm2 >= 0 ? `+${deltaAreaKm2}` : deltaAreaKm2} km² vs Current
          </div>
        </div>

        <div className="p-2.5 bg-[#0B101B] border border-slate-800">
          <div className="text-[10px] text-slate-400">RISK CHANGE (CELLS)</div>
          <div className="text-lg font-bold text-rose-400 tabular-nums mt-0.5">
            {activeScenario.metrics.highAndCriticalCellsCount}{' '}
            <span className="text-xs font-normal text-slate-400">/ 64</span>
          </div>
          <div className="text-[10px] text-rose-300 tabular-nums">
            {deltaHighRiskCells >= 0 ? `+${deltaHighRiskCells}` : deltaHighRiskCells} High/Crit cells
          </div>
        </div>

        <div className="p-2.5 bg-[#0B101B] border border-slate-800">
          <div className="text-[10px] text-slate-400">ROADS AFFECTED</div>
          <div className="text-lg font-bold text-amber-400 tabular-nums mt-0.5">
            {activeScenario.metrics.atRiskRoadsCount}{' '}
            <span className="text-xs font-normal text-slate-400">
              ({activeScenario.metrics.closedRoadsCount} closed)
            </span>
          </div>
          <div className="text-[10px] text-amber-300 tabular-nums">
            {deltaAtRiskRoads >= 0 ? `+${deltaAtRiskRoads}` : deltaAtRiskRoads} roads ({deltaClosedRoads >= 0 ? `+${deltaClosedRoads}` : deltaClosedRoads} closed)
          </div>
        </div>

        <div className="p-2.5 bg-[#0B101B] border border-slate-800">
          <div className="text-[10px] text-slate-400">ASSETS AFFECTED</div>
          <div className="text-lg font-bold text-sky-300 tabular-nums mt-0.5">
            {activeScenario.metrics.exposedAssetsCount}{' '}
            <span className="text-xs font-normal text-slate-400">/ {CRITICAL_ASSETS.length}</span>
          </div>
          <div className="text-[10px] text-sky-400 tabular-nums">
            {deltaExposedAssets >= 0 ? `+${deltaExposedAssets}` : deltaExposedAssets} exposed assets
          </div>
        </div>

        <div className="p-2.5 bg-[#0B101B] border border-slate-800">
          <div className="text-[10px] text-slate-400">SHELTERS AFFECTED</div>
          <div className="text-lg font-bold text-emerald-300 tabular-nums mt-0.5">
            {activeScenario.metrics.shelterDemandBerths}{' '}
            <span className="text-xs font-normal text-slate-400">berths</span>
          </div>
          <div className="text-[10px] text-emerald-400 tabular-nums">
            {deltaShelterDemand >= 0 ? `+${deltaShelterDemand}` : deltaShelterDemand} demand delta
          </div>
        </div>
      </div>

      {/* 4. SPLIT VISUALIZATION: LEFT (CURRENT SITUATION) vs RIGHT (SCENARIO PROJECTION) */}
      <div className="flex flex-col lg:flex-row gap-4">
        {(viewMode === 'SPLIT' || viewMode === 'BEFORE_ONLY') &&
          renderMiniTwinMap(
            currentSnapshot,
            false,
            `Current State (${currentSnapshot.baselineRainfallMmHr} mm/h)`,
            'Scope: IND-PILOT-5X5-CENTRAL'
          )}

        {(viewMode === 'SPLIT' || viewMode === 'AFTER_ONLY') &&
          renderMiniTwinMap(
            activeScenario,
            true,
            `${activeScenario.presetLabel} (${activeScenario.scenarioRainfallMmHr} mm/h · ${durationMinutes}m)`,
            `Scope: ${activeScenario.scope_id}`
          )}
      </div>

      {/* 5. SCENARIO SUMMARY & MULTI-SCENARIO COMPARISON TABLE */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left 5 Cols: Scenario Summary & Cell-Level Before/After Delta */}
        <div className="xl:col-span-5 p-4 bg-[#0A0F1A] border border-slate-800 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div>
              <div className="font-mono text-[10.5px] text-amber-400">
                SCENARIO PROJECTION SUMMARY
              </div>
              <h3 className="text-sm font-semibold text-white">
                Estimated Impact Under This Rainfall Assumption
              </h3>
            </div>
            <span className="font-mono text-[11px] text-cyan-300">
              {activeScenario.scenarioId}
            </span>
          </div>

          <div className="p-3 bg-[#0D1320] border border-amber-500/40 space-y-1.5 text-xs">
            <div className="font-mono text-[11px] text-amber-300 font-semibold">
              RECOMMENDED PREPARATION
            </div>
            <p className="text-slate-100 leading-relaxed font-medium">
              {activeScenario.metrics.recommendedPreparedness}
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Under this rainfall assumption ({activeScenario.scenarioRainfallMmHr} mm/h over {durationMinutes} min), estimated affected population proxy increases by{' '}
              <strong className="text-white">
                {deltaPopProxy >= 0 ? `+${deltaPopProxy.toLocaleString()}` : deltaPopProxy.toLocaleString()}
              </strong>{' '}
              (total {activeScenario.metrics.estimatedAffectedPopProxy.toLocaleString()} citizens in high/critical zones).
            </p>
          </div>

          {/* Inspected Cell Before vs After Comparison */}
          <div className="p-3 bg-[#0D1320] border border-slate-800 space-y-2 text-xs">
            <div className="flex items-center justify-between font-mono text-[11px] text-slate-400">
              <span>SELECTED CELL BEFORE vs. AFTER: {baseInspectedCell.localityName}</span>
              <span>{baseInspectedCell.id}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1 font-mono tabular-nums min-w-0">
              <div className="p-2.5 bg-[#080C14] border border-slate-800 min-w-0 overflow-hidden">
                <div className="text-[10px] font-sans font-medium text-slate-400 tracking-wider truncate">CURRENT SITUATION</div>
                <div className="text-sm sm:text-base font-bold text-white mt-0.5 truncate">
                  Prob: {Math.round(baseInspectedCell.floodProbability * 100)}% ·{' '}
                  {baseInspectedCell.predictedDepthCm}cm
                </div>
                <div className="mt-1">
                  <SeverityIndicator severity={baseInspectedCell.severity} />
                </div>
              </div>
              <div className="p-2.5 bg-[#080C14] border border-amber-500/40 min-w-0 overflow-hidden">
                <div className="text-[10px] font-sans font-medium text-amber-300 tracking-wider truncate">SCENARIO PROJECTION</div>
                <div className="text-sm sm:text-base font-bold text-amber-200 mt-0.5 truncate">
                  Prob: {Math.round(scenInspectedCell.floodProbability * 100)}% ·{' '}
                  {scenInspectedCell.predictedDepthCm}cm
                </div>
                <div className="mt-1">
                  <SeverityIndicator severity={scenInspectedCell.severity} />
                </div>
              </div>
            </div>
          </div>

          <ProvenanceStrip provenance={activeScenario} />
        </div>

        {/* Right 7 Cols: Scenario Comparison Table (Current vs Scenario A vs Scenario B) */}
        <div className="xl:col-span-7 p-4 bg-[#0A0F1A] border border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <div className="font-mono text-[10.5px] text-cyan-400">
                MULTI-SCENARIO COMPARISON MATRIX
              </div>
              <h3 className="text-sm font-semibold text-white">
                Compare Current State vs. Scenario A vs. Scenario B ({durationMinutes} min Horizon)
              </h3>
            </div>

            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-slate-400">Scenario B:</span>
              <select
                aria-label="Select Comparison Scenario B"
                value={comparePresetB}
                onChange={(e) => setComparePresetB(e.target.value as TwinPresetId)}
                className="bg-[#0D1320] border border-slate-700 text-slate-200 px-2 py-1 text-xs"
              >
                {TWIN_PRESET_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-800">
            <table className="w-full text-left border-collapse font-mono text-xs tabular-nums">
              <thead>
                <tr className="bg-[#0D1320] text-slate-300 border-b border-slate-800">
                  <th className="py-2.5 px-3 font-sans font-semibold">Indicator / Metric</th>
                  <th className="py-2.5 px-3 text-right text-emerald-300">
                    Current ({currentSnapshot.baselineRainfallMmHr} mm/h)
                  </th>
                  <th className="py-2.5 px-3 text-right text-cyan-300">
                    Scenario A: {activeScenario.presetLabel} ({activeScenario.scenarioRainfallMmHr} mm/h)
                  </th>
                  <th className="py-2.5 px-3 text-right text-amber-300">
                    Scenario B: {comparisonScenarioB.presetLabel} ({comparisonScenarioB.scenarioRainfallMmHr} mm/h)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                <tr className="hover:bg-slate-900/60">
                  <td className="py-2 px-3 font-sans text-slate-200">
                    High-risk cells (High + Critical)
                  </td>
                  <td className="py-2 px-3 text-right text-slate-200">
                    {currentSnapshot.metrics.highAndCriticalCellsCount}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-cyan-300">
                    {activeScenario.metrics.highAndCriticalCellsCount}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-amber-300">
                    {comparisonScenarioB.metrics.highAndCriticalCellsCount}
                  </td>
                </tr>

                <tr className="hover:bg-slate-900/60">
                  <td className="py-2 px-3 font-sans text-slate-200">
                    Critical inundation cells (≥74% prob)
                  </td>
                  <td className="py-2 px-3 text-right text-slate-200">
                    {currentSnapshot.metrics.criticalCellsCount}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-cyan-300">
                    {activeScenario.metrics.criticalCellsCount}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-rose-400">
                    {comparisonScenarioB.metrics.criticalCellsCount}
                  </td>
                </tr>

                <tr className="hover:bg-slate-900/60">
                  <td className="py-2 px-3 font-sans text-slate-200">
                    Estimated affected area (km²)
                  </td>
                  <td className="py-2 px-3 text-right text-slate-200">
                    {currentSnapshot.metrics.affectedAreaKm2} km²
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-cyan-300">
                    {activeScenario.metrics.affectedAreaKm2} km²
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-amber-300">
                    {comparisonScenarioB.metrics.affectedAreaKm2} km²
                  </td>
                </tr>

                <tr className="hover:bg-slate-900/60">
                  <td className="py-2 px-3 font-sans text-slate-200">
                    At-risk roads (Caution + Restricted + Closed)
                  </td>
                  <td className="py-2 px-3 text-right text-slate-200">
                    {currentSnapshot.metrics.atRiskRoadsCount}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-cyan-300">
                    {activeScenario.metrics.atRiskRoadsCount}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-amber-300">
                    {comparisonScenarioB.metrics.atRiskRoadsCount}
                  </td>
                </tr>

                <tr className="hover:bg-slate-900/60">
                  <td className="py-2 px-3 font-sans text-slate-200">
                    Closed / inundated bridges & underpasses
                  </td>
                  <td className="py-2 px-3 text-right text-slate-200">
                    {currentSnapshot.metrics.closedRoadsCount}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-cyan-300">
                    {activeScenario.metrics.closedRoadsCount}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-rose-400">
                    {comparisonScenarioB.metrics.closedRoadsCount}
                  </td>
                </tr>

                <tr className="hover:bg-slate-900/60">
                  <td className="py-2 px-3 font-sans text-slate-200">
                    Critical assets exposed
                  </td>
                  <td className="py-2 px-3 text-right text-slate-200">
                    {currentSnapshot.metrics.exposedAssetsCount}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-cyan-300">
                    {activeScenario.metrics.exposedAssetsCount}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-amber-300">
                    {comparisonScenarioB.metrics.exposedAssetsCount}
                  </td>
                </tr>

                <tr className="hover:bg-slate-900/60">
                  <td className="py-2 px-3 font-sans text-slate-200">
                    Estimated affected population proxy
                  </td>
                  <td className="py-2 px-3 text-right text-slate-200">
                    {currentSnapshot.metrics.estimatedAffectedPopProxy.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-cyan-300">
                    {activeScenario.metrics.estimatedAffectedPopProxy.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-amber-300">
                    {comparisonScenarioB.metrics.estimatedAffectedPopProxy.toLocaleString()}
                  </td>
                </tr>

                <tr className="hover:bg-slate-900/60">
                  <td className="py-2 px-3 font-sans text-slate-200">
                    Projected shelter berth demand
                  </td>
                  <td className="py-2 px-3 text-right text-slate-200">
                    {currentSnapshot.metrics.shelterDemandBerths.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-cyan-300">
                    {activeScenario.metrics.shelterDemandBerths.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-amber-300">
                    {comparisonScenarioB.metrics.shelterDemandBerths.toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between pt-1">
            <span>
              Note: All values represent scenario projections under specified rainfall & blockage assumptions.
            </span>
            <span className="text-amber-300">SIMULATION — NOT LIVE</span>
          </div>
        </div>
      </div>
    </div>
  );
};
