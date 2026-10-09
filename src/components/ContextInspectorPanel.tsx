import React, { useEffect, useMemo, useState } from 'react';
import { CRITICAL_ASSETS } from '../data/indorePilotData';
import { createProvenance } from '../modules/dataIngestion';
import { defaultPredictionEngine } from '../modules/prediction';
import {
  ActivityFeedEntry,
  AlertItem,
  EvacuationPlanItem,
  FloodRiskCell,
  FloodSeverity,
  NavigationTab,
  ObservationInjectionType,
  RoadSegmentState,
  RoadStatus,
  RouteRecommendation,
  RouteUpdateNotification,
  ScenarioParameters,
  SensorNode,
  Shelter,
  UserRole,
  WarningLevel,
  isAnalystOrModelOperator,
} from '../types/idhara';
import { MapInspectionTarget } from './IndoreFloodMap';
import { LiveFeedSimulator } from './LiveFeedSimulator';
import {
  ProvenanceStrip,
  RoadStateIndicator,
  SENSOR_FRESHNESS_META,
  SeverityIndicator,
  WARNING_LEVEL_META,
  WarningLevelIndicator,
} from './SeverityVisuals';

interface ContextInspectorPanelProps {
  selectedTarget: MapInspectionTarget | null;
  onSelectTarget: (target: MapInspectionTarget | null) => void;
  cells: FloodRiskCell[];
  roads: RoadSegmentState[];
  sensors: SensorNode[];
  shelters: Shelter[];
  evacuationPlans: EvacuationPlanItem[];
  alerts: AlertItem[];
  params: ScenarioParameters;
  activeRoute: RouteRecommendation | null;
  routeUpdateNotification?: RouteUpdateNotification | null;
  onTriggerDemoIncident?: () => void;
  activeRole: UserRole;
  onNavigateTab: (tab: NavigationTab) => void;
  stableTicksElapsed: number;
  onStepStableTick: () => void;
  activityFeed: ActivityFeedEntry[];
  onInjectObservation: (type: ObservationInjectionType, targetId: string) => void;
  onResetObservations: () => void;
}

export const ContextInspectorPanel: React.FC<ContextInspectorPanelProps> = ({
  selectedTarget,
  onSelectTarget,
  cells,
  roads,
  sensors,
  shelters,
  evacuationPlans,
  alerts,
  params,
  activeRoute,
  routeUpdateNotification,
  onTriggerDemoIncident,
  activeRole,
  onNavigateTab,
  stableTicksElapsed,
  onStepStableTick,
  activityFeed,
  onInjectObservation,
  onResetObservations,
}) => {
  const [panelTab, setPanelTab] = useState<'SITUATION' | 'INSPECTOR' | 'LIVE_FEED'>('SITUATION');
  const [expandedWhyIds, setExpandedWhyIds] = useState<Set<string>>(
    new Set(['CARD-PRIMARY'])
  );

  // Automatically open the Inspector tab when the operator clicks a cell, road, sensor, shelter, or asset on the map
  const isFirstRenderRef = React.useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    if (selectedTarget) {
      setPanelTab('INSPECTOR');
    }
  }, [selectedTarget?.type, selectedTarget?.id]);

  const toggleWhyWarning = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedWhyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // High-risk zones & At-risk roads computation for "Situation Overview"
  const highRiskZones = useMemo(
    () =>
      [...cells]
        .filter(
          (c) =>
            c.severity === FloodSeverity.CRITICAL ||
            c.severity === FloodSeverity.HIGH
        )
        .sort((a, b) => b.floodProbability - a.floodProbability),
    [cells]
  );

  const atRiskRoads = useMemo(
    () =>
      roads
        .filter(
          (r) =>
            r.currentState === RoadStatus.CLOSED ||
            r.currentState === RoadStatus.LIKELY_FLOODED ||
            r.currentState === RoadStatus.AT_RISK
        )
        .sort((a, b) => b.floodProbability - a.floodProbability),
    [roads]
  );

  const affectedPopulation = useMemo(
    () => evacuationPlans.reduce((sum, p) => sum + p.populationAtRisk, 0),
    [evacuationPlans]
  );

  const affectedAssets = useMemo(() => {
    const cellMap = new Map<string, FloodRiskCell>(cells.map((c) => [c.id, c]));
    return CRITICAL_ASSETS.filter((a) => {
      const host = cellMap.get(a.cellId);
      return (
        host &&
        (host.severity === FloodSeverity.CRITICAL ||
          host.severity === FloodSeverity.HIGH ||
          host.severity === FloodSeverity.MODERATE)
      );
    });
  }, [cells]);

  // Action Cards built from the top representative warning clusters across the city
  const actionCards = useMemo(() => {
    const sortedByProb = [...cells].sort(
      (a, b) => b.floodProbability - a.floodProbability
    );
    const primaryHotspot = sortedByProb[0] ?? cells[18];
    const secondaryCell =
      cells.find((c) => c.id === 'CELL-R3C4') ?? // Sarwate Bus Stand
      sortedByProb[3] ??
      cells[28];
    const mthHospitalCell =
      cells.find((c) => c.id === 'CELL-R2C3') ?? cells[19];

    const buildCard = (id: string, cell: FloodRiskCell, customActions: string[]) => {
      const prov = createProvenance(
        params.mode,
        cell.confidence,
        params.timelineHourOffset
      );
      const expiryIso = new Date(
        new Date(prov.generated_at).getTime() + 18 * 60 * 1000
      ).toISOString();

      return {
        id,
        cell,
        warningLevel: cell.warningLevel,
        directive: WARNING_LEVEL_META[cell.warningLevel].actionTitle,
        floodProbabilityPct: Math.round(cell.floodProbability * 100),
        confidencePct: Math.round(cell.confidence * 100),
        leadTimeMin: cell.leadTimeMin,
        actions: customActions,
        generated_at: prov.generated_at,
        expiry: expiryIso,
        confidence: cell.confidence,
      };
    };

    return [
      buildCard('CARD-PRIMARY', primaryHotspot, [
        `Monitor affected roads (${
          atRiskRoads[0]?.name ?? 'MG Road / Krishnapura Bridge'
        })`,
        `Verify nearby water-level sensor (${
          primaryHotspot.verifiedBySensorId ?? 'SEN-WL-01'
        })`,
        'Prepare alternate hospital route via Regal–Palasia elevated corridor',
        `Review evacuation readiness for ${primaryHotspot.localityName} (${primaryHotspot.wardCode})`,
      ]),
      buildCard('CARD-SARWATE', secondaryCell, [
        'Monitor Sarwate Underpass & Patel Bridge approach for curb ponding',
        'Verify water-level sensor SEN-WL-04 & activate sump pumps',
        'Prepare AICTSL bus diversion away from low-lying transit bays',
        'Review evacuation readiness at Holkar Science College shelter (SH-04)',
      ]),
      buildCard('CARD-HOSPITAL', mthHospitalCell, [
        'Monitor MTH Hospital eastern ambulance gate waterlogging',
        'Verify ultrasonic stage at Krishnapura Bridge (SEN-WL-01)',
        'Prepare alternate neonatal ambulance route via Regal Square',
        'Review standby dewatering pump readiness with Chimanbagh SDRF',
      ]),
    ];
  }, [cells, atRiskRoads, params.mode, params.timelineHourOffset]);

  const inspectedCell =
    selectedTarget?.type === 'CELL'
      ? cells.find((c) => c.id === selectedTarget.id) ?? null
      : null;

  const inspectedRoad =
    selectedTarget?.type === 'ROAD'
      ? roads.find((r) => r.id === selectedTarget.id) ?? null
      : null;

  const inspectedSensor =
    selectedTarget?.type === 'SENSOR'
      ? sensors.find((s) => s.id === selectedTarget.id) ?? null
      : null;

  const inspectedShelter =
    selectedTarget?.type === 'SHELTER'
      ? shelters.find((sh) => sh.id === selectedTarget.id) ?? null
      : null;

  const inspectedAsset =
    selectedTarget?.type === 'ASSET'
      ? CRITICAL_ASSETS.find((a) => a.id === selectedTarget.id) ?? null
      : null;

  const handleSelectAndInspect = (target: MapInspectionTarget) => {
    onSelectTarget(target);
    setPanelTab('INSPECTOR');
  };

  return (
    <aside className="w-80 lg:w-[330px] xl:w-[350px] shrink-0 bg-[#090D16] border-l border-slate-800/90 flex flex-col h-full min-h-0 overflow-hidden select-none">
      {/* Right Panel Mode Switcher */}
      <div className="px-3.5 py-2.5 border-b border-slate-800/90 bg-[#0B101B] flex flex-col gap-1.5 shrink-0 min-w-0">
        <div className="flex items-center justify-between font-mono text-[10.5px] gap-2 min-w-0">
          <span className="text-cyan-400 font-semibold truncate min-w-0">
            WHAT SHOULD THE CITY DO NEXT?
          </span>
        </div>

        <div className="flex items-center gap-1 bg-[#060911] p-0.5 border border-slate-800 w-full min-w-0">
          <button
            type="button"
            onClick={() => setPanelTab('SITUATION')}
            className={`flex-1 min-w-0 py-1.5 px-1.5 text-[11px] font-mono transition-colors text-center truncate cursor-pointer ${
              panelTab === 'SITUATION'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Action Cards
          </button>
          <button
            type="button"
            onClick={() => setPanelTab('INSPECTOR')}
            className={`flex-1 min-w-0 py-1.5 px-1.5 text-[11px] font-mono transition-colors text-center truncate cursor-pointer ${
              panelTab === 'INSPECTOR'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title={`Inspector (${selectedTarget ? selectedTarget.id.replace('CELL-', '') : 'None'})`}
          >
            Inspector ({selectedTarget ? selectedTarget.id.replace('CELL-', '') : '—'})
          </button>
          <button
            type="button"
            onClick={() => setPanelTab('LIVE_FEED')}
            className={`flex-1 min-w-0 py-1.5 px-1.5 text-[11px] font-mono transition-colors text-center truncate cursor-pointer ${
              panelTab === 'LIVE_FEED'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold'
                : 'text-emerald-400/90 hover:text-emerald-200'
            }`}
          >
            ● Live Feed Sim
          </button>
        </div>
      </div>

      {/* Main Unified Vertical Scroll Container: Entire Inspector is fully vertically scrollable! */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">
        {/* ==================================================
            VIEW 3: DEDICATED LIVE FEED SIMULATOR & PIPELINE
            ================================================== */}
        {panelTab === 'LIVE_FEED' && (
          <div className="p-3.5 space-y-3 min-w-0">
            <LiveFeedSimulator
              roads={roads}
              sensors={sensors}
              activityFeed={activityFeed}
              activeRouteRoadIds={activeRoute?.recommendedRoadIds}
              onInjectObservation={onInjectObservation}
              onResetObservations={onResetObservations}
              onSelectMapTarget={handleSelectAndInspect}
            />
          </div>
        )}

        {/* ==================================================
            VIEW 1: ACTION CARDS + SITUATION OVERVIEW
            ================================================== */}
        {panelTab === 'SITUATION' && (
          <div className="p-4 space-y-4 min-w-0">
          {/* SECTION A: EARLY-WARNING ACTION CARDS + "WHY THIS WARNING?" */}
          <section aria-label="Action Cards" className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div>
                <div className="font-mono text-[10px] text-amber-400 font-semibold tracking-wider">
                  ACTION DIRECTIVES
                </div>
                <h2 className="text-sm font-bold text-white tracking-tight">
                  Early-Warning Directives
                </h2>
              </div>
              <span className="font-mono text-[10px] text-slate-400 bg-[#060911] px-1.5 py-0.5 border border-slate-800">
                Hysteresis Active
              </span>
            </div>

            {isAnalystOrModelOperator(activeRole) && (
              <div className="p-2 bg-cyan-950/60 border border-cyan-500/50 text-[11px] font-mono text-cyan-200">
                <span className="font-bold text-cyan-300">● ANALYST / MODEL OPERATOR LENS:</span> Physical run-off accumulation, Manning roughness coefficient, and 64-cell predictive feature vectors prioritized.
              </div>
            )}

            {actionCards.map((card) => {
              const wMeta = WARNING_LEVEL_META[card.warningLevel];
              const isWhyOpen = expandedWhyIds.has(card.id);
              const inp = card.cell.predictionInput;

              return (
                <div
                  key={card.id}
                  className={`p-3 border ${wMeta.borderColor} ${wMeta.bgTint} space-y-2.5 transition-colors overflow-hidden`}
                >
                  {/* 1. LOCATION & RISK LEVEL HEADER */}
                  <div className="flex items-start justify-between gap-2 border-b border-slate-800/80 pb-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10px] text-slate-400">
                        Ward {card.cell.wardCode}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleSelectAndInspect({ type: 'CELL', id: card.cell.id })
                        }
                        className="text-left font-sans text-sm font-bold text-white hover:text-cyan-300 transition-colors break-words"
                      >
                        {card.cell.localityName}
                      </button>
                    </div>
                    <div className="shrink-0">
                      <WarningLevelIndicator level={card.warningLevel} showDirective={false} />
                    </div>
                  </div>

                  {/* 2. THE CORE METRICS (RISK · RAINFALL · CONFIDENCE) */}
                  <div className="grid grid-cols-3 gap-1.5 font-mono text-center">
                    <div className="p-1.5 bg-[#070B14] border border-slate-800 min-w-0 overflow-hidden">
                      <div className="text-[9.5px] text-slate-400 truncate">RISK</div>
                      <div className="text-sm font-bold text-white tabular-nums break-words">
                        {card.floodProbabilityPct}%
                      </div>
                    </div>
                    <div className="p-1.5 bg-[#070B14] border border-slate-800 min-w-0 overflow-hidden">
                      <div className="text-[9.5px] text-slate-400 truncate">RAINFALL</div>
                      <div className="text-sm font-bold text-sky-300 tabular-nums break-words">
                        {inp.rainfall_1h} <span className="text-[10px] text-slate-400 font-normal">mm/h</span>
                      </div>
                    </div>
                    <div className="p-1.5 bg-[#070B14] border border-slate-800 min-w-0 overflow-hidden">
                      <div className="text-[9.5px] text-slate-400 truncate">CONFIDENCE</div>
                      <div className="text-sm font-bold text-cyan-300 tabular-nums break-words">
                        {card.confidencePct}%
                      </div>
                    </div>
                  </div>

                  {/* Expected Onset Time */}
                  <div className="flex items-center justify-between font-mono text-[10.5px] px-2 py-1 bg-[#070B14]/70 border border-slate-800/80 gap-2 min-w-0">
                    <span className="text-slate-400 truncate">Expected flood onset:</span>
                    <span className="text-amber-300 font-bold tabular-nums shrink-0">~{card.leadTimeMin} min</span>
                  </div>

                  {/* Hysteresis Hold Notice (when de-escalating) */}
                  {card.cell.warningHysteresis.isHoldingDeescalation && (
                    <div className="px-2 py-1.5 bg-amber-950/60 border border-amber-500/50 flex items-center justify-between gap-2 font-mono text-[10.5px] text-amber-200 min-w-0">
                      <span className="break-words min-w-0">
                        ⧖ De-escalation hold ({stableTicksElapsed}/3 ticks)
                      </span>
                      <button
                        type="button"
                        onClick={onStepStableTick}
                        className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        +1 Tick
                      </button>
                    </div>
                  )}

                  {/* 3. RECOMMENDED ACTION (HIGH-CONTRAST PRIMARY FOCUS) */}
                  <div className="p-2.5 bg-[#060A14] border border-cyan-500/30 space-y-1.5 min-w-0">
                    <div className="font-mono text-[10px] text-cyan-400 font-bold tracking-wider">
                      RECOMMENDED ACTION:
                    </div>
                    <ul className="space-y-1 text-xs text-slate-200">
                      {card.actions.map((act, i) => (
                        <li key={i} className="flex items-start gap-1.5 leading-snug">
                          <span className="text-cyan-400 font-mono text-[11px] font-bold shrink-0">›</span>
                          <span className="break-words min-w-0">{act}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* 4. SECONDARY INFORMATION COLLAPSIBLE ("Why this warning?") */}
                  <details className="group border border-slate-800 bg-[#060912]">
                    <summary className="p-2 font-mono text-[11px] text-slate-300 hover:text-white cursor-pointer flex items-center justify-between select-none">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-cyan-400 text-[10px] shrink-0">▶</span>
                        <span className="truncate">Forensic Drivers & Rule</span>
                      </span>
                      <span className="text-slate-500 text-[10px] shrink-0 ml-1">Model details</span>
                    </summary>

                    <div className="p-2.5 border-t border-slate-800 space-y-2 text-[11px] font-mono bg-[#05080E]">
                      <div className="text-slate-300 break-words">
                        <span className="text-slate-400">Trigger Rule: </span>
                        <span className={`${wMeta.textColor} break-words`}>{wMeta.ruleSummary}</span>
                      </div>
                      <div className="text-slate-300 break-words">
                        <span className="text-slate-400">Hysteresis: </span>
                        <span className="break-words">{card.cell.warningHysteresis.rationale}</span>
                      </div>

                      <div className="border-t border-slate-800/80 pt-1.5">
                        <div className="text-slate-400 mb-1 text-[10.5px]">
                          Top Model Drivers:
                        </div>
                        <div className="space-y-1">
                          {card.cell.topDrivers.map((drv) => (
                            <div
                              key={drv.factor}
                              className="flex items-center justify-between text-slate-200 gap-2 min-w-0"
                            >
                              <span className="break-words min-w-0">{drv.factor}</span>
                              <span className="text-cyan-300 tabular-nums shrink-0">
                                {drv.weight}% wt
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="border-t border-slate-800/80 pt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-slate-400 tabular-nums">
                        <span className="min-w-0 break-words">rain_1h: {inp.rainfall_1h}mm</span>
                        <span className="min-w-0 break-words">rain_3h: {inp.rainfall_3h}mm</span>
                        <span className="min-w-0 break-words">rain_6h: {inp.rainfall_6h}mm</span>
                        <span className="min-w-0 break-words">rain_24h: {inp.rainfall_24h}mm</span>
                        <span className="min-w-0 break-words">elev: {inp.elevation}m</span>
                        <span className="min-w-0 break-words">slope: {inp.slope}°</span>
                        <span className="min-w-0 break-words">flow_acc: {Math.round(inp.flow_accumulation * 100)}%</span>
                        <span className="min-w-0 break-words">drain_proxy: {inp.drainage_proxy}</span>
                      </div>
                    </div>
                  </details>

                  {/* Mandatory Card Provenance: generated time, expiry, data confidence */}
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-slate-400 tabular-nums pt-1 border-t border-slate-800/80">
                    <span>
                      AS OF {card.generated_at.slice(11, 19)}Z
                    </span>
                    <span className="text-cyan-300">
                      CONF: {card.confidencePct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </section>

          {/* SECTION B: COMMAND CENTER — CURRENT SITUATION */}
          <section aria-label="Current Situation" className="space-y-2.5 pt-2 border-t border-slate-800 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
              <h2 className="text-xs font-mono font-bold text-cyan-300 uppercase truncate">
                CURRENT SITUATION
              </h2>
              <button
                type="button"
                onClick={() => onNavigateTab('alerts')}
                className="font-mono text-[10.5px] text-amber-300 hover:underline cursor-pointer break-words"
              >
                {alerts.filter((a) => a.lifecycleState === 'PENDING REVIEW').length} Pending Review →
              </button>
            </div>

            {(() => {
              const critCount = cells.filter(
                (c) => c.severity === FloodSeverity.CRITICAL
              ).length;
              const overallRisk =
                critCount >= 4
                  ? 'CRITICAL'
                  : highRiskZones.length >= 4
                  ? 'HIGH'
                  : highRiskZones.length >= 1
                  ? 'MODERATE'
                  : 'LOW';
              const trend =
                params.rainfallIntensityMmHr >= 38 ||
                params.timelineHourOffset >= 0
                  ? 'WORSENING'
                  : 'STABLE';
              const closedRoadsCount = roads.filter(
                (r) => r.currentState === RoadStatus.CLOSED
              ).length;
              const availableSheltersCount = shelters.filter(
                (s) => s.reachable && s.remainingCapacity > 0
              ).length;
              const avgConfPct = Math.round(
                (cells.reduce((s, c) => s + c.confidence, 0) /
                  Math.max(1, cells.length)) *
                  100
              );

              return (
                <div className="p-3 bg-[#0D1320] border border-slate-800 space-y-2 font-mono text-xs tabular-nums min-w-0">
                  <div className="grid grid-cols-2 gap-2 pb-2 border-b border-slate-800/80">
                    <div className="min-w-0 overflow-hidden">
                      <div className="text-[10px] text-slate-400 truncate">Risk:</div>
                      <div
                        className={`text-base font-bold break-words ${
                          overallRisk === 'CRITICAL' || overallRisk === 'HIGH'
                            ? 'text-rose-400'
                            : 'text-amber-300'
                        }`}
                      >
                        {overallRisk}
                      </div>
                    </div>
                    <div className="min-w-0 overflow-hidden">
                      <div className="text-[10px] text-slate-400 truncate">Trend:</div>
                      <div
                        className={`text-base font-bold break-words ${
                          trend === 'WORSENING'
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {trend === 'WORSENING' ? '▲ WORSENING' : '● STABLE'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px]">
                    <div
                      onClick={() =>
                        highRiskZones[0] &&
                        handleSelectAndInspect({
                          type: 'CELL',
                          id: highRiskZones[0].id,
                        })
                      }
                      className="flex items-center justify-between cursor-pointer hover:text-white min-w-0 gap-1"
                    >
                      <span className="text-slate-400 font-sans text-xs">High-Risk Zones</span>
                      <span className="font-bold text-rose-400 shrink-0 tabular-nums">
                        {highRiskZones.length}
                      </span>
                    </div>

                    <div
                      onClick={() =>
                        atRiskRoads[0] &&
                        handleSelectAndInspect({
                          type: 'ROAD',
                          id: atRiskRoads[0].id,
                        })
                      }
                      className="flex items-center justify-between cursor-pointer hover:text-white min-w-0 gap-1"
                    >
                      <span className="text-slate-400 font-sans text-xs">At-Risk Roads</span>
                      <span className="font-bold text-amber-300 shrink-0 tabular-nums">
                        {atRiskRoads.length}
                      </span>
                    </div>

                    <div
                      onClick={() => onNavigateTab('roads-routing')}
                      className="flex items-center justify-between cursor-pointer hover:text-white min-w-0 gap-1"
                    >
                      <span className="text-slate-400 font-sans text-xs">Closed Roads</span>
                      <span className="font-bold text-rose-400 shrink-0 tabular-nums">
                        {closedRoadsCount}
                      </span>
                    </div>

                    <div
                      onClick={() => onNavigateTab('evacuation')}
                      className="flex items-center justify-between cursor-pointer hover:text-white min-w-0 gap-1"
                    >
                      <span className="text-slate-400 font-sans text-xs">Open Shelters</span>
                      <span className="font-bold text-emerald-300 shrink-0 tabular-nums">
                        {availableSheltersCount}
                      </span>
                    </div>

                    <div
                      onClick={() => onNavigateTab('data-health')}
                      className="col-span-2 flex items-center justify-between pt-1.5 border-t border-slate-800/80 cursor-pointer hover:text-white min-w-0 gap-1"
                    >
                      <span className="text-slate-400 font-sans text-xs">Data Confidence</span>
                      <span className="font-bold text-cyan-300 shrink-0 tabular-nums">
                        {avgConfPct}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>

          {/* SECTION C: LIVE FEED SIMULATOR & REAL-TIME ACTIVITY FEED */}
          <section aria-label="Live Feed Simulator" className="pt-2 border-t border-slate-800">
            <LiveFeedSimulator
              roads={roads}
              sensors={sensors}
              activityFeed={activityFeed}
              activeRouteRoadIds={activeRoute?.recommendedRoadIds}
              onInjectObservation={onInjectObservation}
              onResetObservations={onResetObservations}
              onSelectMapTarget={handleSelectAndInspect}
              compact
            />
          </section>
        </div>
      )}

      {/* ==================================================
          VIEW 2: CELL PREDICTION DISPLAY & ENTITY INSPECTOR
          ================================================== */}
      {panelTab === 'INSPECTOR' && (
        <div className="flex flex-col min-w-0">
          {/* Quick Entity Switcher Bar: wraps cleanly, stays sticky at top */}
          <div className="sticky top-0 z-10 px-3 py-2 bg-[#070B12] border-b border-slate-800/80 flex flex-wrap items-center gap-1.5 text-[11px] font-mono shrink-0 min-w-0">
            <button
              type="button"
              onClick={() => onSelectTarget({ type: 'CELL', id: 'CELL-R2C2' })}
              className={`px-2 py-1 border transition-colors cursor-pointer text-center break-words ${
                selectedTarget?.type === 'CELL'
                  ? 'bg-cyan-950/60 border-cyan-500/60 text-cyan-300'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Cell: Krishnapura
            </button>
            <button
              type="button"
              onClick={() => onSelectTarget({ type: 'ROAD', id: 'RD-05' })}
              className={`px-2 py-1 border transition-colors cursor-pointer text-center break-words ${
                selectedTarget?.type === 'ROAD'
                  ? 'bg-cyan-950/60 border-cyan-500/60 text-cyan-300'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Road: MG Bridge
            </button>
            <button
              type="button"
              onClick={() => onSelectTarget({ type: 'SENSOR', id: 'SEN-WL-01' })}
              className={`px-2 py-1 border transition-colors cursor-pointer text-center break-words ${
                selectedTarget?.type === 'SENSOR'
                  ? 'bg-cyan-950/60 border-cyan-500/60 text-cyan-300'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Sensor: WL-01
            </button>
            <button
              type="button"
              onClick={() => onSelectTarget({ type: 'SHELTER', id: 'SH-01' })}
              className={`px-2 py-1 border transition-colors cursor-pointer text-center break-words ${
                selectedTarget?.type === 'SHELTER'
                  ? 'bg-cyan-950/60 border-cyan-500/60 text-cyan-300'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Shelter: SH-01
            </button>
          </div>

          {/* Empty State when no entity is inspected */}
          {!inspectedCell && !inspectedRoad && !inspectedSensor && !inspectedShelter && !inspectedAsset && (
            <div className="p-8 text-center font-mono text-xs text-slate-400 space-y-2">
              <div className="text-cyan-400 font-bold">NO ENTITY SELECTED</div>
              <p className="text-slate-500 text-[11px] leading-relaxed">
                Click any study area cell, road corridor, gauge sensor, shelter, or critical asset on the map to inspect live telemetry and model diagnostics.
              </p>
            </div>
          )}

          {/* 1. FLOOD-RISK CELL PREDICTION DISPLAY */}
          {inspectedCell && (
            <div className="p-3.5 space-y-3.5 min-w-0">
              {/* PRIMARY HEADER: LOCATION & RISK */}
              <div className="border-b border-slate-800 pb-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] text-slate-400 break-words">
                      LOCATION: WARD {inspectedCell.wardCode} · {inspectedCell.id}
                    </div>
                    <h3 className="text-base font-bold text-white mt-0.5 break-words">
                      {inspectedCell.localityName}
                    </h3>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <WarningLevelIndicator level={inspectedCell.warningLevel} showDirective={false} />
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTarget(null);
                        setPanelTab('SITUATION');
                      }}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-mono cursor-pointer"
                      title="Close inspection details"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between font-mono text-[10.5px] text-slate-400 tabular-nums gap-1">
                  <span className="break-words">
                    Elev {inspectedCell.elevationM}m MSL · Slope {inspectedCell.slopeDeg}° · {inspectedCell.landUse}
                  </span>
                </div>
              </div>

              {/* PRIMARY READOUT GRID: RISK · RAINFALL · CONFIDENCE · ONSET */}
              <div className="grid grid-cols-2 gap-2">
                {/* 1. RISK */}
                <div className="p-2.5 bg-[#070B14] border border-slate-800 min-w-0 overflow-hidden">
                  <div className="text-[10px] font-mono text-slate-400 truncate">RISK (PROBABILITY)</div>
                  <div className="text-2xl font-mono font-bold text-white tabular-nums mt-0.5 break-words">
                    {Math.round(inspectedCell.floodProbability * 100)}%
                    <span className="text-xs text-slate-400 font-normal ml-1">
                      ±{Math.round(inspectedCell.uncertaintyBand * 100)}%
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5 flex flex-wrap items-center justify-between gap-1">
                    <span className="shrink-0">Est. Depth:</span>
                    <span className="text-slate-200 font-semibold break-words">{inspectedCell.predictedDepthCm} cm</span>
                  </div>
                </div>

                {/* 2. RAINFALL */}
                <div className="p-2.5 bg-[#070B14] border border-slate-800 min-w-0 overflow-hidden">
                  <div className="text-[10px] font-mono text-slate-400 truncate">RAINFALL (1H RATE)</div>
                  <div className="text-2xl font-mono font-bold text-sky-300 tabular-nums mt-0.5 break-words">
                    {inspectedCell.predictionInput.rainfall_1h} <span className="text-xs text-slate-400 font-normal">mm/h</span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5 flex flex-wrap items-center justify-between gap-1">
                    <span className="shrink-0">3h Accum:</span>
                    <span className="text-sky-200 font-semibold break-words">{inspectedCell.predictionInput.rainfall_3h} mm</span>
                  </div>
                </div>

                {/* 3. CONFIDENCE */}
                <div className="p-2.5 bg-[#070B14] border border-slate-800 min-w-0 overflow-hidden">
                  <div className="text-[10px] font-mono text-slate-400 truncate">DATA CONFIDENCE</div>
                  <div className="text-xl font-mono font-bold text-cyan-300 tabular-nums mt-0.5 break-words">
                    {Math.round(inspectedCell.confidence * 100)}%
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5 flex flex-wrap items-center justify-between gap-1">
                    <span className="shrink-0">Freshness:</span>
                    <span className="text-emerald-400 font-semibold break-words">{inspectedCell.freshnessLabel}</span>
                  </div>
                </div>

                {/* 4. ONSET & SEVERITY */}
                <div className="p-2.5 bg-[#070B14] border border-slate-800 min-w-0 overflow-hidden">
                  <div className="text-[10px] font-mono text-slate-400 truncate">EXPECTED ONSET</div>
                  <div className="text-xl font-mono font-bold text-amber-300 tabular-nums mt-0.5 break-words">
                    {inspectedCell.expectedOnsetLabel}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5 flex flex-wrap items-center justify-between gap-1">
                    <span className="shrink-0">Severity:</span>
                    <SeverityIndicator severity={inspectedCell.severity} />
                  </div>
                </div>
              </div>

              {/* 5. RECOMMENDED ACTION DIRECTIVE BLOCK (PRIMARY FOCUS) */}
              <div className="p-2.5 bg-[#060A14] border border-cyan-500/40 space-y-1 min-w-0">
                <div className="font-mono text-[10px] text-cyan-400 font-bold tracking-wider">
                  RECOMMENDED ACTION:
                </div>
                <div className="text-xs text-slate-200 font-medium leading-relaxed break-words">
                  {inspectedCell.warningHysteresis.actionDirective}
                </div>
              </div>

              {/* Hysteresis Status if active */}
              {inspectedCell.warningHysteresis.isHoldingDeescalation && (
                <div className="p-2 bg-amber-950/50 border border-amber-500/50 flex items-center justify-between gap-2 font-mono text-[10.5px] text-amber-200 min-w-0">
                  <span className="break-words min-w-0">⧖ De-escalation hold ({stableTicksElapsed}/3 ticks)</span>
                  <button
                    type="button"
                    onClick={onStepStableTick}
                    className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 text-[10.5px] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    +1 Tick
                  </button>
                </div>
              )}

              {/* COLLAPSIBLE SECONDARY SECTION 1: TOP MODEL DRIVERS */}
              <details open className="group border border-slate-800 bg-[#070B14]">
                <summary className="p-2 font-mono text-xs text-slate-300 font-semibold cursor-pointer hover:text-white flex items-center justify-between select-none">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-cyan-400 text-[10px] shrink-0">▼</span>
                    <span className="truncate">Top Model Drivers ({inspectedCell.topDrivers.length})</span>
                  </span>
                  <span className="text-[10px] text-slate-500 shrink-0 ml-1">Relative impact</span>
                </summary>
                <div className="p-2 border-t border-slate-800 space-y-1.5 text-xs bg-[#05080E]">
                  {inspectedCell.topDrivers.map((d) => (
                    <div
                      key={d.factor}
                      className="p-1.5 bg-[#090D16] border border-slate-800/80 text-[11px] min-w-0"
                    >
                      <div className="flex items-center justify-between font-mono gap-2 min-w-0">
                        <span
                          className={`break-words min-w-0 ${
                            d.direction === 'aggravating'
                              ? 'text-amber-300 font-semibold'
                              : 'text-emerald-300 font-semibold'
                          }`}
                        >
                          {d.factor}
                        </span>
                        <span className="text-slate-400 tabular-nums shrink-0">{d.weight}% wt</span>
                      </div>
                      <p className="text-slate-400 text-[10.5px] mt-0.5 leading-snug break-words">
                        {d.description}
                      </p>
                    </div>
                  ))}
                </div>
              </details>

              {/* COLLAPSIBLE SECONDARY SECTION 2: FORENSIC FEATURE VECTOR */}
              <details
                open={isAnalystOrModelOperator(activeRole)}
                className="group border border-slate-800 bg-[#070B14]"
              >
                <summary className="p-2 font-mono text-xs text-slate-300 font-semibold cursor-pointer hover:text-white flex items-center justify-between select-none">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-cyan-400 text-[10px] shrink-0">▶</span>
                    <span className="truncate">Hydrological Feature Vectors & Inputs</span>
                  </span>
                  <span className="text-[10px] text-slate-500 shrink-0 ml-1">12 attributes</span>
                </summary>
                <div className="p-2.5 border-t border-slate-800 bg-[#05080E] space-y-2 font-mono text-[10.5px]">
                  <div className="text-slate-300 break-words">
                    <span className="text-slate-400">Trigger Rule: </span>
                    <span className="text-amber-300 break-words">{WARNING_LEVEL_META[inspectedCell.warningLevel].ruleSummary}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-slate-400 tabular-nums border-t border-slate-800/80 pt-1.5">
                    <div className="min-w-0 break-words">rain_1h: <span className="text-slate-200">{inspectedCell.predictionInput.rainfall_1h} mm</span></div>
                    <div className="min-w-0 break-words">rain_3h: <span className="text-slate-200">{inspectedCell.predictionInput.rainfall_3h} mm</span></div>
                    <div className="min-w-0 break-words">rain_6h: <span className="text-slate-200">{inspectedCell.predictionInput.rainfall_6h} mm</span></div>
                    <div className="min-w-0 break-words">rain_24h: <span className="text-slate-200">{inspectedCell.predictionInput.rainfall_24h} mm</span></div>
                    <div className="min-w-0 break-words">elevation: <span className="text-slate-200">{inspectedCell.predictionInput.elevation} m</span></div>
                    <div className="min-w-0 break-words">slope: <span className="text-slate-200">{inspectedCell.predictionInput.slope}°</span></div>
                    <div className="min-w-0 break-words">flow_accum: <span className="text-slate-200">{inspectedCell.predictionInput.flow_accumulation}</span></div>
                    <div className="min-w-0 break-words">drain_proxy: <span className="text-slate-200">{inspectedCell.predictionInput.drainage_proxy}</span></div>
                    <div className="min-w-0 break-words">impervious: <span className="text-slate-200">{inspectedCell.predictionInput.imperviousness}</span></div>
                    <div className="min-w-0 break-words">hist_score: <span className="text-slate-200">{inspectedCell.predictionInput.historical_flood_score}</span></div>
                    <div className="min-w-0 break-words">road_expos: <span className="text-slate-200">{inspectedCell.predictionInput.road_exposure}</span></div>
                    <div className="min-w-0 break-words">lead_time: <span className="text-slate-200">{inspectedCell.leadTimeMin} min</span></div>
                  </div>
                </div>
              </details>

                {/* Nearest Critical Assets & Designated Shelter */}
                <div className="space-y-1.5">
                  <div className="font-mono text-[10px] text-slate-400 font-semibold tracking-wider">
                    NEAREST CRITICAL ASSETS & DESIGNATED SHELTER
                  </div>

                  {inspectedCell.nearestCriticalAssetIds.map((assetId) => {
                    const asset = CRITICAL_ASSETS.find((a) => a.id === assetId);
                    if (!asset) return null;
                    return (
                      <div
                        key={asset.id}
                        className="flex items-center justify-between p-2 bg-[#070B14] border border-slate-800 text-xs gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-slate-200 font-medium break-words">✚ {asset.name}</div>
                          <div className="font-mono text-[10px] text-slate-400 break-words">
                            {asset.category} · Elev {asset.elevationM}m MSL
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectTarget({ type: 'ASSET', id: asset.id })}
                          className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-mono text-[10.5px] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Inspect
                        </button>
                      </div>
                    );
                  })}

                  {(() => {
                    const shelter = shelters.find((s) => s.id === inspectedCell.nearestShelterId);
                    if (!shelter) return null;
                    return (
                      <div className="flex items-center justify-between p-2 bg-emerald-950/20 border border-emerald-500/30 text-xs gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-emerald-300 font-medium break-words">
                            ▲ Designated Shelter: {shelter.name}
                          </div>
                          <div className="font-mono text-[10px] text-slate-300 tabular-nums mt-0.5 break-words">
                            Capacity: {shelter.currentOccupancy}/{shelter.totalCapacity} ({shelter.remainingCapacity} free) · Elev {shelter.elevationM}m
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onNavigateTab('evacuation')}
                          className="px-2 py-0.5 bg-emerald-900/60 hover:bg-emerald-800/70 border border-emerald-500/50 text-emerald-200 font-mono text-[10.5px] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Evac Plan
                        </button>
                      </div>
                    );
                  })()}
                </div>

                <ProvenanceStrip provenance={inspectedCell} compact />
              </div>
            )}

            {/* 2. ROAD SEGMENT INSPECTION */}
            {inspectedRoad && (
              <div className="p-3.5 space-y-3.5 min-w-0">
                {/* PRIMARY HEADER: LOCATION & STATE */}
                <div className="border-b border-slate-800 pb-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10px] text-slate-400 break-words">
                        CORRIDOR: {inspectedRoad.id} · {inspectedRoad.corridorType} · {inspectedRoad.lengthKm} km
                      </div>
                      <h3 className="text-base font-bold text-white mt-0.5 break-words">
                        {inspectedRoad.name}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTarget(null);
                        setPanelTab('SITUATION');
                      }}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-mono cursor-pointer shrink-0"
                      title="Close inspection details"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-slate-400">STATE:</span>
                      <RoadStateIndicator state={inspectedRoad.currentState} />
                    </div>
                    <span className="font-mono text-[10px] text-slate-400 break-words">
                      {inspectedRoad.agreeingObservationsCount} agreeing source(s)
                    </span>
                  </div>
                </div>

                {/* PRIMARY ROAD METRICS */}
                <div className="grid grid-cols-3 gap-1.5 font-mono text-center">
                  <div className="p-2 bg-[#070B14] border border-slate-800 min-w-0 overflow-hidden">
                    <div className="text-[9.5px] text-slate-400 truncate">RISK</div>
                    <div className="text-base font-bold text-white tabular-nums break-words">
                      {Math.round(inspectedRoad.floodProbability * 100)}%
                    </div>
                    <div className="text-[9.5px] text-slate-400 mt-0.5 break-words">
                      Depth: ~{inspectedRoad.estimatedWaterDepthCm}cm
                    </div>
                  </div>

                  <div className="p-2 bg-[#070B14] border border-slate-800 min-w-0 overflow-hidden">
                    <div className="text-[9.5px] text-slate-400 truncate">CONFIDENCE</div>
                    <div className="text-base font-bold text-cyan-300 tabular-nums break-words">
                      {Math.round(inspectedRoad.confidence * 100)}%
                    </div>
                    <div className="text-[9.5px] text-slate-400 mt-0.5 break-words">
                      {inspectedRoad.isHysteresisHeld ? 'Hold' : 'Verified'}
                    </div>
                  </div>

                  <div className="p-2 bg-[#070B14] border border-slate-800 min-w-0 overflow-hidden">
                    <div className="text-[9.5px] text-slate-400 truncate">LAST UPDATE</div>
                    <div className="text-xs font-semibold text-emerald-300 tabular-nums mt-0.5 break-words leading-tight">
                      {inspectedRoad.lastUpdate}
                    </div>
                    <div className="text-[9.5px] text-slate-400 mt-0.5 truncate">
                      Real-time fusion
                    </div>
                  </div>
                </div>

                {/* RECOMMENDED ACTION DIRECTIVE FOR THIS CORRIDOR */}
                <div className="p-2.5 bg-[#060A14] border border-cyan-500/40 space-y-1 min-w-0">
                  <div className="font-mono text-[10px] text-cyan-400 font-bold tracking-wider">
                    RECOMMENDED ACTION:
                  </div>
                  <div className="text-xs text-slate-200 font-medium leading-relaxed break-words">
                    {inspectedRoad.currentState === RoadStatus.CLOSED
                      ? 'CORRIDOR CLOSED: Barricade ramps immediately. Divert emergency transit via Regal Square / Palasia corridor.'
                      : inspectedRoad.currentState === RoadStatus.LIKELY_FLOODED
                      ? 'POST FLOOD WARNING: Water accumulation detected. Reduce corridor speed limit and verify ultrasonic stage gauge.'
                      : inspectedRoad.currentState === RoadStatus.AT_RISK
                      ? 'PRE-DISASTER STANDBY: Monitor rainfall accumulation and notify field ward warden.'
                      : 'CORRIDOR OPEN: All transit profiles permitted without penalty.'}
                  </div>
                </div>

                {/* COLLAPSIBLE EVIDENCE LOG */}
                <details className="group border border-slate-800 bg-[#070B14]">
                  <summary className="p-2 font-mono text-xs text-slate-300 font-semibold cursor-pointer hover:text-white flex items-center justify-between select-none">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-cyan-400 text-[10px] shrink-0">▶</span>
                      <span className="truncate">Observation Evidence ({inspectedRoad.evidence.length})</span>
                    </span>
                    <span className="text-[10px] text-slate-500 shrink-0 ml-1">Multi-source</span>
                  </summary>
                  <div className="p-2.5 border-t border-slate-800 bg-[#05080E] text-[11px] space-y-1.5">
                    <ul className="space-y-1 text-slate-300 list-disc pl-4">
                      {inspectedRoad.evidence.map((ev, i) => (
                        <li key={i} className="leading-relaxed break-words">
                          {ev}
                        </li>
                      ))}
                    </ul>
                    <div className="pt-1.5 border-t border-slate-800/80 text-[10.5px] text-slate-400 break-words">
                      Reason: {inspectedRoad.transitionReason}
                    </div>
                  </div>
                </details>

                {/* Transit Impact */}
                <div className="p-2.5 bg-[#070B14] border border-slate-800 text-xs space-y-1 min-w-0">
                  <div className="font-mono text-[10px] text-slate-400 font-semibold">
                    TRANSIT NETWORK IMPACT:
                  </div>
                  <p className="text-slate-200 text-[11px] leading-snug break-words">
                    {inspectedRoad.routeImpact}
                  </p>
                  <div className="pt-1 border-t border-slate-800/80 text-[10.5px] text-cyan-300 font-mono break-words">
                    Alt corridor: {inspectedRoad.alternativeSummary}
                  </div>
                </div>

                {/* Direct Live Feed Injection Controls for this Road */}
                <div className="p-2.5 bg-[#080C14] border border-slate-800 space-y-1.5 font-mono text-[11px] min-w-0">
                  <div className="text-slate-400 text-[10px] break-words">
                    INJECT OBSERVATION ON {inspectedRoad.id}:
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onInjectObservation('ROAD_LIKELY_FLOODED', inspectedRoad.id)}
                      className="px-2 py-1.5 bg-amber-950/60 hover:bg-amber-900/70 border border-amber-500/60 text-amber-200 text-center text-[10.5px] leading-tight break-words min-w-0 transition-colors cursor-pointer"
                    >
                      ▲ Likely flooded
                    </button>
                    <button
                      type="button"
                      onClick={() => onInjectObservation('ROAD_CLOSURE', inspectedRoad.id)}
                      className="px-2 py-1.5 bg-rose-950/60 hover:bg-rose-900/70 border border-rose-500/50 text-rose-200 text-center text-[10.5px] leading-tight break-words min-w-0 transition-colors cursor-pointer"
                    >
                      ✖ Road closure
                    </button>
                    <button
                      type="button"
                      onClick={() => onInjectObservation('ROAD_REOPENED', inspectedRoad.id)}
                      className="px-2 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-500/50 text-emerald-200 text-center text-[10.5px] leading-tight break-words min-w-0 transition-colors cursor-pointer"
                    >
                      ● Road reopened
                    </button>
                    <button
                      type="button"
                      onClick={() => onInjectObservation('CROWD_REPORT', inspectedRoad.id)}
                      className="px-2 py-1.5 bg-amber-950/50 hover:bg-amber-900/60 border border-amber-500/50 text-amber-200 text-center text-[10.5px] leading-tight break-words min-w-0 transition-colors cursor-pointer"
                    >
                      ⚑ Crowd report
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigateTab('roads-routing')}
                    className="flex-1 py-2 px-3 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-500/50 text-cyan-200 font-mono text-xs transition-colors text-center break-words cursor-pointer"
                  >
                    Open Dynamic Reroute Solver
                  </button>
                </div>

                <ProvenanceStrip provenance={inspectedRoad} />
              </div>
            )}

            {/* 3. SENSOR NODE INSPECTION */}
            {inspectedSensor && (
              <div className="p-4 space-y-4 min-w-0">
                <div className="border-b border-slate-800/80 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs text-slate-400 break-words">
                        {inspectedSensor.id} · {inspectedSensor.type} · Host Cell {inspectedSensor.cellId}
                      </div>
                      <h3 className="text-base font-semibold text-white mt-0.5 break-words">
                        {inspectedSensor.name}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTarget(null);
                        setPanelTab('SITUATION');
                      }}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-mono cursor-pointer shrink-0"
                      title="Close inspection details"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                    <span className={`${SENSOR_FRESHNESS_META[inspectedSensor.freshnessState].textColor} break-words`}>
                      {SENSOR_FRESHNESS_META[inspectedSensor.freshnessState].glyph} Freshness:{' '}
                      <strong>{inspectedSensor.freshnessState}</strong>
                    </span>
                    <span className="text-slate-300 shrink-0 break-words">
                      Last seen: <strong>{inspectedSensor.lastSeenLabel}</strong>
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-amber-200 break-words">
                    Diagnostic: {inspectedSensor.diagnosticNote}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 font-mono">
                  <div className="p-2.5 bg-[#0D1320] border border-slate-800/90 min-w-0 overflow-hidden">
                    <div className="text-[10px] text-slate-400 truncate">READING</div>
                    <div className="text-base font-semibold text-white tabular-nums mt-0.5 break-words">
                      {inspectedSensor.currentValue}{' '}
                      <span className="text-xs text-slate-400 font-normal">{inspectedSensor.unit}</span>
                    </div>
                    <div className="text-[9.5px] text-slate-400 mt-0.5 break-words">
                      Crit: {inspectedSensor.criticalThreshold}
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#0D1320] border border-slate-800/90 min-w-0 overflow-hidden">
                    <div className="text-[10px] text-slate-400 truncate">CONFIDENCE</div>
                    <div className="text-base font-semibold text-cyan-300 tabular-nums mt-0.5 break-words">
                      {Math.round(inspectedSensor.confidence * 100)}%
                    </div>
                    <div className="text-[9.5px] text-slate-400 mt-0.5 break-words">
                      {inspectedSensor.status}
                    </div>
                  </div>

                  <div className="p-2.5 bg-[#0D1320] border border-slate-800/90 min-w-0 overflow-hidden">
                    <div className="text-[10px] text-slate-400 truncate">PACKETS</div>
                    <div className="text-base font-semibold text-emerald-300 tabular-nums mt-0.5 break-words">
                      {inspectedSensor.packetSuccessRatePct}%
                    </div>
                    <div className="text-[9.5px] text-slate-400 mt-0.5 break-words">
                      Bat: {inspectedSensor.batteryPct}%
                    </div>
                  </div>
                </div>

                <div className="p-2.5 bg-[#080C14] border border-slate-800 space-y-1.5 font-mono text-[11px] min-w-0">
                  <div className="text-slate-400 text-[10px] break-words">
                    INJECT SENSOR OBSERVATION ({inspectedSensor.id}):
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onInjectObservation('WATER_LEVEL_INCREASE', inspectedSensor.id)}
                      className="px-2 py-1.5 bg-cyan-950/60 hover:bg-cyan-900/70 border border-cyan-500/50 text-cyan-200 text-center text-[10.5px] leading-tight break-words min-w-0 transition-colors cursor-pointer"
                    >
                      ▲ Water-level increase
                    </button>
                    <button
                      type="button"
                      onClick={() => onInjectObservation('SENSOR_FAILURE', inspectedSensor.id)}
                      className="px-2 py-1.5 bg-purple-950/60 hover:bg-purple-900/70 border border-purple-500/50 text-purple-200 text-center text-[10.5px] leading-tight break-words min-w-0 transition-colors cursor-pointer"
                    >
                      ⚡ Sensor failure
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectTarget({ type: 'CELL', id: inspectedSensor.cellId })}
                  className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs text-center break-words cursor-pointer"
                >
                  Inspect Host Grid Cell ({inspectedSensor.cellId})
                </button>

                <ProvenanceStrip provenance={inspectedSensor} />
              </div>
            )}

            {/* 4. SHELTER INSPECTION */}
            {inspectedShelter && (
              <div className="p-4 space-y-4 min-w-0">
                <div className="border-b border-slate-800/80 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs text-slate-400 break-words">
                        {inspectedShelter.id} · {inspectedShelter.locationLabel}
                      </div>
                      <h3 className="text-base font-semibold text-white mt-0.5 break-words">
                        {inspectedShelter.name}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTarget(null);
                        setPanelTab('SITUATION');
                      }}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-mono cursor-pointer shrink-0"
                      title="Close inspection details"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                    <span
                      className={`break-words ${
                        inspectedShelter.reachable
                          ? 'text-emerald-300 font-semibold'
                          : 'text-rose-400 font-bold'
                      }`}
                    >
                      {inspectedShelter.reachable ? '● ' : '✖ '}
                      {inspectedShelter.accessibilityLabel}
                    </span>
                    <span className="text-cyan-300 shrink-0 break-words">Status: {inspectedShelter.status}</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 font-mono">
                  <div className="p-2.5 bg-[#0D1320] border border-slate-800/90 min-w-0 overflow-hidden">
                    <div className="text-[10px] text-slate-400 truncate">CAPACITY</div>
                    <div className="text-base font-bold text-white tabular-nums mt-0.5 break-words">
                      {inspectedShelter.totalCapacity}
                    </div>
                    <div className="text-[9.5px] text-slate-400 mt-0.5 break-words">
                      Base: {inspectedShelter.baseOccupancy}
                    </div>
                  </div>
                  <div className="p-2.5 bg-[#0D1320] border border-slate-800/90 min-w-0 overflow-hidden">
                    <div className="text-[10px] text-slate-400 truncate">EST. OCCUPANCY</div>
                    <div className="text-base font-bold text-amber-300 tabular-nums mt-0.5 break-words">
                      {inspectedShelter.currentOccupancy}
                    </div>
                    <div className="text-[9.5px] text-slate-400 mt-0.5 break-words">
                      +{inspectedShelter.assignedEvacuees} evac
                    </div>
                  </div>
                  <div className="p-2.5 bg-[#0D1320] border border-slate-800/90 min-w-0 overflow-hidden">
                    <div className="text-[10px] text-slate-400 truncate">REMAINING CAP</div>
                    <div
                      className={`text-base font-bold tabular-nums mt-0.5 break-words ${
                        inspectedShelter.remainingCapacity > 0
                          ? 'text-emerald-300'
                          : 'text-rose-400'
                      }`}
                    >
                      {inspectedShelter.remainingCapacity}
                    </div>
                    <div className="text-[9.5px] text-slate-400 mt-0.5 break-words">
                      Free berths
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-[#0D1320] border border-slate-800/90 text-xs space-y-1.5 font-mono min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-slate-400 shrink-0">Shelter Flood Risk:</span>
                    <span className="text-slate-200 break-words text-right">
                      {Math.round(inspectedShelter.floodRiskProbability * 100)}% ({inspectedShelter.floodRiskSeverity})
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-slate-400 shrink-0">Accessibility:</span>
                    <span
                      className={`break-words text-right ${
                        inspectedShelter.reachable ? 'text-emerald-300' : 'text-rose-400'
                      }`}
                    >
                      {inspectedShelter.accessibilityLabel}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-slate-400 shrink-0">Water & Medical:</span>
                    <span className="text-cyan-300 break-words text-right">
                      {((inspectedShelter.drinkingWaterLiters || 0) / 1000).toFixed(1)}k L ·{' '}
                      {inspectedShelter.medicalTeamPresent ? 'Team On-Site' : 'Standby'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigateTab('evacuation')}
                  className="w-full py-2 px-3 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/50 text-emerald-200 font-mono text-xs text-center break-words cursor-pointer"
                >
                  Open Evacuation Planning Dashboard →
                </button>

                <ProvenanceStrip provenance={inspectedShelter} />
              </div>
            )}

            {/* 5. CRITICAL ASSET INSPECTION */}
            {inspectedAsset && (
              <div className="p-4 space-y-4 min-w-0">
                <div className="border-b border-slate-800/80 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs text-slate-400 break-words">
                        {inspectedAsset.id} · {inspectedAsset.category} · {inspectedAsset.criticalityLevel}
                      </div>
                      <h3 className="text-base font-semibold text-white mt-0.5 break-words">
                        {inspectedAsset.name}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTarget(null);
                        setPanelTab('SITUATION');
                      }}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-mono cursor-pointer shrink-0"
                      title="Close inspection details"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-1 font-mono text-xs text-slate-300 break-words">
                    Elevation: {inspectedAsset.elevationM}m MSL · Backup Power: {inspectedAsset.backupPowerHours}h
                  </div>
                </div>
                <div className="p-3 bg-[#0D1320] border border-slate-800 text-xs space-y-1 min-w-0">
                  <div className="font-mono text-slate-400">EMERGENCY CONTACT DESK</div>
                  <div className="text-slate-200 break-words">{inspectedAsset.contactRole}</div>
                  <div className="font-mono text-slate-400 pt-2">LINKED ACCESS ROADS</div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {inspectedAsset.accessRoadIds.map((rId) => (
                      <button
                        key={rId}
                        type="button"
                        onClick={() => onSelectTarget({ type: 'ROAD', id: rId })}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-mono text-[11px] cursor-pointer break-words"
                      >
                        {rId}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Active Route Recommendation Summary: sits at bottom of the scrollable content */}
        {activeRoute && (
          <div className="p-3 bg-[#070B12] border-t border-slate-800/90 text-xs space-y-1.5 mt-auto min-w-0 shrink-0">
            {routeUpdateNotification && (
              <div className="px-2 py-1 bg-amber-950/80 border border-amber-400/70 font-mono text-[10.5px] text-amber-200 flex flex-wrap items-center justify-between gap-2 min-w-0">
                <span className="min-w-0 flex-1 break-words">
                  <strong>ROUTE UPDATED:</strong> “{routeUpdateNotification.reason}”
                </span>
                <button
                  type="button"
                  onClick={() => onNavigateTab('roads-routing')}
                  className="text-cyan-300 underline shrink-0 cursor-pointer"
                >
                  Details →
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] min-w-0">
              <span
                className={`break-words ${
                  activeRoute.feasible
                    ? 'text-cyan-300 font-semibold'
                    : 'text-rose-400 font-bold'
                }`}
              >
                {activeRoute.feasible
                  ? `● ${activeRoute.recommendationStatusLabel}`
                  : '✖ NO FEASIBLE ROUTE'}
              </span>
              {activeRoute.feasible ? (
                <span className="text-slate-300 tabular-nums shrink-0 break-words">
                  {activeRoute.recommendedEtaMin} min · Risk {activeRoute.riskScore}/100
                </span>
              ) : (
                <span className="text-emerald-300 text-[10.5px] break-words">
                  Safe pt: {activeRoute.noRouteInfo?.nearestReachableSafePoint?.nodeName ?? 'Local high ground'}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
              <div className="text-slate-200 font-medium break-words min-w-0 flex-1">
                {activeRoute.originName} → {activeRoute.destinationName}
              </div>
              {onTriggerDemoIncident && (
                <button
                  type="button"
                  onClick={onTriggerDemoIncident}
                  className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/60 font-mono text-[10.5px] text-amber-200 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  ⚡ Demo incident
                </button>
              )}
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed break-words">
              {activeRoute.safetyAdvisory}
            </p>
            <ProvenanceStrip
              provenance={activeRoute}
              expiry={activeRoute.expiry}
              compact
            />
          </div>
        )}
      </div>
    </aside>
  );
};
