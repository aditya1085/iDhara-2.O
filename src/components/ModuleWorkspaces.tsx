import React, { useState } from 'react';
import { INTERSECTION_NODES } from '../data/indorePilotData';
import {
   getDisasterTwinStages,
  OPERATIONAL_CHAIN,
} from '../modules/disasterTwin';
import { getEventPresets } from '../modules/historicalReplay';
import { TRAVEL_PROFILE_POLICIES } from '../modules/routing';
import {
  ActivityFeedEntry,
  AlertItem,
  AlertLifecycleState,
  DataHealthReport,
  DisasterStage,
  EvacuationPlanItem,
  FloodRiskCell,
  FloodSeverity,
  NavigationTab,
  ObservationInjectionType,
  ProductMode,
  ReplaySpeed,
  RoadSegmentState,
  RoadStatus,
  RouteRecommendation,
  RouteUpdateNotification,
  ScenarioParameters,
  SensorNode,
  Shelter,
  TravelProfile,
  UserRole,
  ValidationReport,
  isAnalystOrModelOperator,
} from '../types/idhara';
import { AlertCommandWorkspace } from './AlertCommandWorkspace';
import { LocationReportModal } from './LocationReportModal';
import { MapInspectionTarget } from './IndoreFloodMap';
import { LiveFeedSimulator } from './LiveFeedSimulator';
import { PostDisasterLearningWorkspace } from './PostDisasterLearningWorkspace';
import {
  ProvenanceStrip,
  RoadStateIndicator,
  SENSOR_FRESHNESS_META,
  SeverityIndicator,
} from './SeverityVisuals';

interface ModuleWorkspaceProps {
  activeTab: NavigationTab;
  params: ScenarioParameters;
  onUpdateParams: (updater: (prev: ScenarioParameters) => ScenarioParameters) => void;
  cells: FloodRiskCell[];
  roads: RoadSegmentState[];
  sensors: SensorNode[];
  shelters: Shelter[];
  evacuationPlans: EvacuationPlanItem[];
  evacuationModeActive: boolean;
  evacuationTriggerReason: string;
  evacuationThreshold: number;
  manualEvacuationActive: boolean;
  shelterCapacityScalePct: number;
  lastEvacAutoRefreshNote: string | null;
  onToggleManualEvacuation: () => void;
  onChangeEvacuationThreshold: (threshold: number) => void;
  onChangeShelterCapacityScale: (scalePct: number) => void;
  onRecalculateEvacuationPlan: () => void;
  onSimulateEvacFailureState: (
    scenario: 'CAPACITY_EXCEEDED' | 'ROAD_DISCONNECTED' | 'NO_REACHABLE_SHELTER' | 'RESET'
  ) => void;
  routes: RouteRecommendation[];
  activeRouteId: string;
  onSelectRouteId: (id: string) => void;
  customOriginId: string;
  customDestId: string;
  travelProfile: TravelProfile;
  onChangeCustomRoute: (originId: string, destId: string) => void;
  onChangeTravelProfile: (profile: TravelProfile) => void;
  routeUpdateNotification: RouteUpdateNotification | null;
  onDismissRouteUpdate: () => void;
  onTriggerDemoIncident: () => void;
  onTriggerNoFeasibleRouteDemo: () => void;
  alerts: AlertItem[];
  onAcknowledgeAlert: (id: string) => void;
  onTransitionAlertLifecycle: (
    alertId: string,
    nextState: AlertLifecycleState
  ) => void;
  validationReport: ValidationReport;
  isPlayingTimeline: boolean;
  onTogglePlayTimeline: () => void;
  replaySpeed: ReplaySpeed;
  onChangeReplaySpeed: (speed: ReplaySpeed) => void;
  onStepTimeline: (deltaHours: number) => void;
  activeModelVersionId: string;
  onChangeModelVersionId: (versionId: string) => void;
  dataHealthReport: DataHealthReport;
  activeRole: UserRole;
  onSelectMapTarget: (target: MapInspectionTarget) => void;
  onNavigateTab: (tab: NavigationTab) => void;
  activityFeed: ActivityFeedEntry[];
  onInjectObservation: (type: ObservationInjectionType, targetId: string) => void;
  onResetObservations: () => void;
}

export const ModuleWorkspace: React.FC<ModuleWorkspaceProps> = ({
  activeTab,
  params,
  onUpdateParams,
  cells,
  roads,
  sensors,
  shelters,
  evacuationPlans,
  evacuationModeActive,
  evacuationTriggerReason,
  evacuationThreshold,
  manualEvacuationActive,
  shelterCapacityScalePct,
  lastEvacAutoRefreshNote,
  onToggleManualEvacuation,
  onChangeEvacuationThreshold,
  onChangeShelterCapacityScale,
  onRecalculateEvacuationPlan,
  onSimulateEvacFailureState,
  routes,
  activeRouteId,
  onSelectRouteId,
  customOriginId,
  customDestId,
  travelProfile,
  onChangeCustomRoute,
  onChangeTravelProfile,
  routeUpdateNotification,
  onDismissRouteUpdate,
  onTriggerDemoIncident,
  onTriggerNoFeasibleRouteDemo,
  alerts,
  onAcknowledgeAlert,
  onTransitionAlertLifecycle,
  validationReport,
  isPlayingTimeline,
  onTogglePlayTimeline,
  replaySpeed,
  onChangeReplaySpeed,
  onStepTimeline,
  activeModelVersionId,
  onChangeModelVersionId,
  dataHealthReport,
  activeRole,
  onSelectMapTarget,
  onNavigateTab,
  activityFeed,
  onInjectObservation,
  onResetObservations,
}) => {
  const criticalCells = cells.filter((c) => c.severity === FloodSeverity.CRITICAL);
  const highCells = cells.filter((c) => c.severity === FloodSeverity.HIGH);
  const closedRoads = roads.filter((r) => r.currentState === RoadStatus.CLOSED);
  const likelyFloodedRoads = roads.filter(
    (r) => r.currentState === RoadStatus.LIKELY_FLOODED
  );
  const activeRouteObj =
    routes.find((r) => r.id === activeRouteId) ?? routes[0] ?? null;

  const [isLocationReportOpen, setIsLocationReportOpen] = useState<boolean>(false);

  // 1. OVERVIEW / COMMAND CENTER SITUATION & ACTIVITY FEED STRIP
  if (activeTab === 'overview') {
    const highRiskZonesCount = criticalCells.length + highCells.length;
    const atRiskRoadsCount = roads.filter(
      (r) =>
        r.currentState === RoadStatus.AT_RISK ||
        r.currentState === RoadStatus.LIKELY_FLOODED ||
        r.currentState === RoadStatus.CLOSED
    ).length;
    const availableSheltersCount = shelters.filter(
      (s) => s.reachable && s.remainingCapacity > 0
    ).length;
    const overallRiskLabel =
      criticalCells.length >= 4
        ? 'CRITICAL'
        : highRiskZonesCount >= 4
        ? 'HIGH'
        : highRiskZonesCount >= 1
        ? 'MODERATE'
        : 'LOW';
    const trendLabel =
      params.rainfallIntensityMmHr >= 38 || params.timelineHourOffset >= 0
        ? 'WORSENING'
        : 'STABLE';

    return (
      <div className="bg-[#080C14] border-b border-slate-800/90 px-4 py-3 space-y-3">
        {/* COMMAND CENTER: CURRENT SITUATION + CHRONOLOGICAL ACTIVITY FEED */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 min-w-0">
          {/* Left 7 Cols: CURRENT SITUATION */}
          <div className="xl:col-span-7 p-3 bg-[#0C121E] border border-slate-800/90 space-y-2.5 min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] min-w-0">
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="w-1.5 h-3 bg-cyan-400 inline-block" />
                <span className="text-cyan-300 font-bold font-mono tracking-wider">
                  CURRENT SITUATION
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('alerts')}
                className="text-amber-300 hover:underline text-[10.5px] cursor-pointer truncate max-w-full font-mono"
                title="Review alerts pending human confirmation"
              >
                {alerts.filter((a) => a.lifecycleState === 'PENDING REVIEW').length} Pending Human Review →
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs min-w-0">
              <button
                type="button"
                onClick={() => onNavigateTab('risk-map')}
                className="p-2 bg-[#070B12] border border-slate-800 hover:border-rose-500/60 cursor-pointer text-left transition-colors min-w-0 overflow-hidden flex flex-col justify-between"
                title="View overall pilot risk map"
              >
                <div className="text-[10px] font-sans font-medium text-slate-400 uppercase tracking-wider">
                  Risk Level
                </div>
                <div className="text-sm font-bold font-mono text-rose-400 mt-1">
                  {overallRiskLabel}
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('disaster-twin')}
                className="p-2 bg-[#070B12] border border-slate-800 hover:border-amber-500/60 cursor-pointer text-left transition-colors min-w-0 overflow-hidden flex flex-col justify-between"
                title="Open Disaster Twin to simulate trend and forecast"
              >
                <div className="text-[10px] font-sans font-medium text-slate-400 uppercase tracking-wider">
                  Trend
                </div>
                <div className="text-sm font-bold font-mono text-amber-400 mt-1">
                  {trendLabel}
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('risk-map')}
                className="p-2 bg-[#070B12] border border-slate-800 hover:border-rose-500/60 cursor-pointer text-left transition-colors min-w-0 overflow-hidden flex flex-col justify-between"
                title="Inspect High-risk zones on Risk Map"
              >
                <div className="text-[10px] font-sans font-medium text-slate-400 uppercase tracking-wider">
                  High-Risk Zones
                </div>
                <div className="text-sm font-bold font-mono text-white mt-1">
                  {highRiskZonesCount}
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('roads-routing')}
                className="p-2 bg-[#070B12] border border-slate-800 hover:border-amber-500/60 cursor-pointer text-left transition-colors min-w-0 overflow-hidden flex flex-col justify-between"
                title="Inspect at-risk corridors in Roads & Routing"
              >
                <div className="text-[10px] font-sans font-medium text-slate-400 uppercase tracking-wider">
                  At-Risk Roads
                </div>
                <div className="text-sm font-bold font-mono text-amber-300 mt-1">
                  {atRiskRoadsCount}
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('roads-routing')}
                className="p-2 bg-[#070B12] border border-slate-800 hover:border-rose-500/60 cursor-pointer text-left transition-colors min-w-0 overflow-hidden flex flex-col justify-between"
                title="Inspect closed bridges and barricaded roads"
              >
                <div className="text-[10px] font-sans font-medium text-slate-400 uppercase tracking-wider">
                  Closed Roads
                </div>
                <div className="text-sm font-bold font-mono text-rose-400 mt-1">
                  {closedRoads.length}
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('evacuation')}
                className="p-2 bg-[#070B12] border border-slate-800 hover:border-emerald-500/60 cursor-pointer text-left transition-colors min-w-0 overflow-hidden flex flex-col justify-between"
                title="Inspect reachable emergency shelters"
              >
                <div className="text-[10px] font-sans font-medium text-slate-400 uppercase tracking-wider">
                  Open Shelters
                </div>
                <div className="text-sm font-bold font-mono text-emerald-300 mt-1">
                  {availableSheltersCount}
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('data-health')}
                className="p-2 bg-[#070B12] border border-slate-800 hover:border-cyan-500/60 cursor-pointer text-left transition-colors min-w-0 overflow-hidden flex flex-col justify-between"
                title="Inspect data telemetry and model confidence"
              >
                <div className="text-[10px] font-sans font-medium text-slate-400 uppercase tracking-wider">
                  Confidence
                </div>
                <div className="text-sm font-bold font-mono text-cyan-300 mt-1">
                  {Math.round(dataHealthReport.confidence * 100)}%
                </div>
              </button>
            </div>
          </div>

          {/* Right 5 Cols: Chronological Operational Activity Feed */}
          <div className="xl:col-span-5 p-3 bg-[#0C121E] border border-slate-800/90 space-y-2 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between text-[11px] min-w-0">
              <span className="text-emerald-400 font-bold font-mono tracking-wider truncate">
                ● ACTIVITY FEED (CHRONOLOGICAL)
              </span>
              <span className="text-slate-400 text-[10px] font-sans shrink-0 hidden sm:inline">
                Click entry to focus
              </span>
            </div>
            <div className="space-y-1 text-[11px] tabular-nums font-mono min-w-0">
              {activityFeed.slice(0, 5).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    if (entry.relatedTarget) {
                      onSelectMapTarget(entry.relatedTarget);
                      if (entry.relatedTarget.type === 'CELL') onNavigateTab('risk-map');
                      else if (entry.relatedTarget.type === 'ROAD') onNavigateTab('roads-routing');
                    } else if (entry.category === 'ALERT') {
                      onNavigateTab('alerts');
                    } else if (entry.category === 'ROUTING') {
                      onNavigateTab('roads-routing');
                    }
                  }}
                  className="w-full text-left px-2 py-1.5 bg-[#070B12] border-l-2 border-cyan-400 flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-900 transition-colors min-w-0 overflow-hidden"
                >
                  <div className="truncate min-w-0 flex-1">
                    <span className="text-slate-400 mr-1.5 shrink-0">{entry.timestamp}</span>
                    {entry.eventTypeLabel && (
                      <span className="text-cyan-300 font-bold mr-1.5 shrink-0">
                        [{entry.eventTypeLabel}]
                      </span>
                    )}
                    <span className="text-slate-200">{entry.message}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. RISK MAP
  if (activeTab === 'risk-map') {
    return null;
  }

  // 4. ROADS & ROUTING WORKSPACE (Dynamic Flood-Aware Route Planner + Live Rerouting + Demo Incident)
  if (activeTab === 'roads-routing') {
    const activePolicy = TRAVEL_PROFILE_POLICIES[travelProfile];

    return (
      <div className="flex-1 min-h-0 p-4 bg-[#080C14] space-y-4 overflow-y-auto">
        {/* Top Header + "Demo incident" & "Test No Feasible Route" Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="text-cyan-400 font-semibold">
                ROUTE PLANNER
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-400">
                ● SUBSCRIPTION ACTIVE
              </span>
            </div>
            <h2 className="text-base font-semibold text-white mt-0.5">
              Roads & Routing
            </h2>
          </div>

          {/* Major Demo Moment Buttons */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <button
              type="button"
              onClick={onTriggerDemoIncident}
              className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400 text-amber-200 font-bold whitespace-nowrap transition-colors shadow-sm"
            >
              ⚡ Demo incident (Close Road & Reroute)
            </button>
            <button
              type="button"
              onClick={onTriggerNoFeasibleRouteDemo}
              className="px-2.5 py-1.5 bg-rose-950/60 hover:bg-rose-900/70 border border-rose-500/60 text-rose-200 whitespace-nowrap transition-colors"
              title="Simulate total corridor cut-off to verify NO FEASIBLE ROUTE behavior"
            >
              ✖ Test No Feasible Route
            </button>
            <button
              type="button"
              onClick={onResetObservations}
              className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 whitespace-nowrap transition-colors"
            >
              ↺ Reset Roads
            </button>
          </div>
        </div>

        {/* ROUTE PLANNER INPUTS: Origin | Destination | Travel Profile (Citizen, Pedestrian, Emergency responder, Ambulance) */}
        <div className="p-3 bg-[#0C121E] border border-slate-800 space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
            {/* Origin */}
            <div className="lg:col-span-3 space-y-1 font-mono text-xs">
              <label htmlFor="planner-origin" className="block text-[11px] text-slate-400">
                ORIGIN
              </label>
              <select
                id="planner-origin"
                aria-label="Route Origin Node"
                value={customOriginId}
                onChange={(e) => onChangeCustomRoute(e.target.value, customDestId)}
                className="w-full bg-[#070B12] border border-slate-700 text-slate-100 px-2.5 py-1.5 text-xs"
              >
                {INTERSECTION_NODES.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.elevationM}m MSL)
                  </option>
                ))}
              </select>
            </div>

            {/* Destination */}
            <div className="lg:col-span-3 space-y-1 font-mono text-xs">
              <label htmlFor="planner-dest" className="block text-[11px] text-slate-400">
                DESTINATION
              </label>
              <select
                id="planner-dest"
                aria-label="Route Destination Node"
                value={customDestId}
                onChange={(e) => onChangeCustomRoute(customOriginId, e.target.value)}
                className="w-full bg-[#070B12] border border-slate-700 text-slate-100 px-2.5 py-1.5 text-xs"
              >
                {INTERSECTION_NODES.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.elevationM}m MSL)
                  </option>
                ))}
              </select>
            </div>

            {/* Travel Profile Selector */}
            <div className="lg:col-span-6 space-y-1 font-mono text-xs">
              <span className="block text-[11px] text-slate-400">
                TRAVEL PROFILE ({activePolicy.badge})
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {(
                  [
                    'CITIZEN',
                    'PEDESTRIAN',
                    'EMERGENCY_RESPONDER',
                    'AMBULANCE',
                  ] as TravelProfile[]
                ).map((prof) => {
                  const pMeta = TRAVEL_PROFILE_POLICIES[prof];
                  const isActive = travelProfile === prof;
                  return (
                    <button
                      key={prof}
                      type="button"
                      onClick={() => onChangeTravelProfile(prof)}
                      className={`px-2.5 py-1.5 text-xs border transition-colors whitespace-nowrap ${
                        isActive
                          ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 font-bold'
                          : 'bg-[#070B12] border-slate-700 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {pMeta.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Profile Routing Policy Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 font-mono text-[11px] text-slate-300">
            <div>
              <span className="text-cyan-400 font-semibold">Profile Policy: </span>
              <span>{activePolicy.policySummary}</span>
            </div>
            <div className="text-amber-300 font-semibold">
              Label Policy: Always “Recommended under current data” · Never “Guaranteed safe”
            </div>
          </div>
        </div>

        {/* LIVE REROUTING SUBSCRIPTION NOTIFICATION BANNER ("ROUTE UPDATED") */}
        {routeUpdateNotification && (
          <div className="p-3.5 bg-amber-950/40 border-2 border-amber-400/80 space-y-2 font-mono text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-amber-400 text-slate-950 font-bold text-xs">
                  ROUTE UPDATED
                </span>
                <span className="text-amber-200 font-bold">
                  {routeUpdateNotification.bannerTitle}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-300">{routeUpdateNotification.timestamp}</span>
                <button
                  type="button"
                  onClick={onDismissRouteUpdate}
                  className="text-slate-400 hover:text-white text-xs"
                >
                  Dismiss ×
                </button>
              </div>
            </div>

            <div className="text-sm font-sans font-semibold text-white">
              Reason: “{routeUpdateNotification.reason}”
            </div>

            {/* 5-Step Demo Incident / Live Rerouting Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1 text-[11px]">
              <div className="p-2 bg-[#070A12] border border-rose-500/40">
                <div className="text-rose-400 font-semibold">
                  1–2. INVALIDATED ROUTE (ON MAP IN RED)
                </div>
                <div className="text-slate-200 mt-0.5">
                  {routeUpdateNotification.previousRouteSummary}
                </div>
                <div className="text-slate-400 mt-0.5">
                  Trigger: {routeUpdateNotification.affectedRoadId} ({routeUpdateNotification.affectedRoadName}) →{' '}
                  <strong className="text-rose-300">{routeUpdateNotification.newRoadState}</strong>
                </div>
              </div>

              <div className="p-2 bg-[#070A12] border border-cyan-500/40">
                <div className="text-cyan-300 font-semibold">
                  3–4. RECALCULATED ALTERNATE ROUTE
                </div>
                <div className="text-white mt-0.5">
                  {routeUpdateNotification.newRouteSummary}
                </div>
                <div className="text-emerald-300 mt-0.5">
                  {routeUpdateNotification.newEtaMin !== null
                    ? `New Travel Time: ${routeUpdateNotification.newEtaMin} min (was ${routeUpdateNotification.previousEtaMin} min)`
                    : 'No feasible path remaining — see Safe Point below'}
                </div>
              </div>

              <div className="p-2 bg-[#070A12] border border-amber-500/40">
                <div className="text-amber-300 font-semibold">
                  5. WHY THE ROUTE CHANGED
                </div>
                <div className="text-slate-200 mt-0.5 font-sans leading-relaxed">
                  {routeUpdateNotification.explanation}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ROUTE RESULT: PRIMARY ROUTE + ALTERNATIVE ROUTE OR "NO FEASIBLE ROUTE" */}
        {!activeRouteObj ? (
          <div className="p-6 bg-[#070A12] border border-slate-800 text-center text-slate-400 font-mono text-xs">
            No route currently selected. Choose an origin and destination node above to evaluate emergency corridors.
          </div>
        ) : activeRouteObj.feasible && activeRouteObj.primaryRoute ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* PRIMARY ROUTE CARD */}
            <div className="p-3.5 bg-cyan-950/25 border border-cyan-400/70 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                <span className="text-cyan-300 font-bold">
                  ★ PRIMARY ROUTE — Recommended under current data
                </span>
                <span className="text-slate-300">
                  Profile: {TRAVEL_PROFILE_POLICIES[activeRouteObj.travelProfile].label}
                </span>
              </div>

              <div className="text-base font-semibold text-white">
                {activeRouteObj.originName} → {activeRouteObj.destinationName}
              </div>

              {/* Key Route Metrics: Travel time, Risk score, Confidence, Generated time, Expiry */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-2 bg-[#070B12] border border-slate-800 font-mono text-xs tabular-nums">
                <div>
                  <div className="text-[10px] text-slate-400">Travel time</div>
                  <div className="text-sm font-bold text-white">
                    {activeRouteObj.primaryRoute.travelTimeMin} min
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {activeRouteObj.primaryRoute.distanceKm} km
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Risk score</div>
                  <div
                    className={`text-sm font-bold ${
                      activeRouteObj.primaryRoute.riskScore >= 50
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {activeRouteObj.primaryRoute.riskScore}/100
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Max {Math.round(activeRouteObj.primaryRoute.maxFloodProbability * 100)}% prob
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Confidence</div>
                  <div className="text-sm font-bold text-cyan-300">
                    {Math.round(activeRouteObj.primaryRoute.confidence * 100)}%
                  </div>
                  <div className="text-[10px] text-slate-500">
                    +{activeRouteObj.primaryRoute.totalRiskPenaltyMin}m risk pen
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Generated time</div>
                  <div className="text-xs font-semibold text-slate-200 mt-0.5">
                    {activeRouteObj.primaryRoute.generated_at.slice(11, 19)}Z
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Expiry</div>
                  <div className="text-xs font-semibold text-amber-300 mt-0.5">
                    {activeRouteObj.primaryRoute.expiry.slice(11, 19)}Z
                  </div>
                </div>
              </div>

              <div className="font-mono text-[11px] text-slate-300">
                <span className="text-slate-400">Corridor Sequence: </span>
                {activeRouteObj.primaryRoute.roadIds
                  .map((rId, idx) => `${rId} (${activeRouteObj.primaryRoute?.roadNames[idx]})`)
                  .join(' → ')}
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {activeRouteObj.safetyAdvisory}
              </p>

              <ProvenanceStrip
                provenance={activeRouteObj}
                expiry={activeRouteObj.primaryRoute.expiry}
                compact
              />
            </div>

            {/* ALTERNATIVE ROUTE CARD */}
            {activeRouteObj.alternativeRoute ? (
              <div className="p-3.5 bg-[#0C121E] border border-emerald-500/50 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                  <span className="text-emerald-300 font-bold">
                    ◆ ALTERNATIVE ROUTE — Recommended under current data
                  </span>
                  <span className="text-slate-400">Secondary Distinct Corridor</span>
                </div>

                <div className="text-base font-semibold text-white">
                  {activeRouteObj.originName} → {activeRouteObj.destinationName} (Alt Bypass)
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-2 bg-[#070B12] border border-slate-800 font-mono text-xs tabular-nums">
                  <div>
                    <div className="text-[10px] text-slate-400">Travel time</div>
                    <div className="text-sm font-bold text-white">
                      {activeRouteObj.alternativeRoute.travelTimeMin} min
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {activeRouteObj.alternativeRoute.distanceKm} km
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">Risk score</div>
                    <div
                      className={`text-sm font-bold ${
                        activeRouteObj.alternativeRoute.riskScore >= 50
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {activeRouteObj.alternativeRoute.riskScore}/100
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Max {Math.round(activeRouteObj.alternativeRoute.maxFloodProbability * 100)}% prob
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">Confidence</div>
                    <div className="text-sm font-bold text-cyan-300">
                      {Math.round(activeRouteObj.alternativeRoute.confidence * 100)}%
                    </div>
                    <div className="text-[10px] text-slate-500">
                      +{activeRouteObj.alternativeRoute.totalRiskPenaltyMin}m risk pen
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">Generated time</div>
                    <div className="text-xs font-semibold text-slate-200 mt-0.5">
                      {activeRouteObj.alternativeRoute.generated_at.slice(11, 19)}Z
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">Expiry</div>
                    <div className="text-xs font-semibold text-amber-300 mt-0.5">
                      {activeRouteObj.alternativeRoute.expiry.slice(11, 19)}Z
                    </div>
                  </div>
                </div>

                <div className="font-mono text-[11px] text-slate-300">
                  <span className="text-slate-400">Corridor Sequence: </span>
                  {activeRouteObj.alternativeRoute.roadIds
                    .map(
                      (rId, idx) =>
                        `${rId} (${activeRouteObj.alternativeRoute?.roadNames[idx]})`
                    )
                    .join(' → ')}
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  Recommended under current data as secondary backup corridor (shown in dashed emerald on map). Never guaranteed safe.
                </p>

                <ProvenanceStrip
                  provenance={activeRouteObj}
                  expiry={activeRouteObj.alternativeRoute.expiry}
                  compact
                />
              </div>
            ) : (
              <div className="p-3.5 bg-[#0C121E] border border-slate-800 flex flex-col justify-between">
                <div className="space-y-1.5">
                  <div className="font-mono text-xs text-amber-300 font-semibold">
                    SINGLE FEASIBLE CORRIDOR REMAINING
                  </div>
                  <div className="text-sm font-semibold text-white">
                    No Secondary Distinct Alternative Route Available
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Under {activePolicy.label} policy, all other parallel bridges/connectors between{' '}
                    {activeRouteObj.originName} and {activeRouteObj.destinationName} are currently{' '}
                    <span className="text-rose-400 font-mono">CLOSED</span> or{' '}
                    <span className="text-amber-400 font-mono">LIKELY_FLOODED</span>. Only the Primary Route remains passable.
                  </p>
                </div>
                <ProvenanceStrip provenance={activeRouteObj} compact />
              </div>
            )}
          </div>
        ) : (
          /* NO FEASIBLE ROUTE DISPLAY — Never fabricate a route! */
          <div className="p-4 bg-rose-950/35 border-2 border-rose-500/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 bg-rose-500 text-white font-bold text-xs">
                  NO FEASIBLE ROUTE
                </span>
                <span className="text-rose-200 text-xs font-semibold">
                  {activeRouteObj?.originName} → {activeRouteObj?.destinationName} (Profile: {activePolicy.label})
                </span>
              </div>
              <span className="text-xs text-slate-300">
                iDhara Safety Rule: Do not fabricate impassable routes
              </span>
            </div>

            <div className="p-2.5 bg-[#070A12] border border-rose-500/40 text-xs text-slate-200">
              <strong className="text-rose-300 font-mono">Reason: </strong>
              {activeRouteObj.noRouteInfo?.reason ??
                'All currently available corridors are closed or above the configured safety threshold for this profile.'}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
              {/* Nearest Reachable Safe Point */}
              <div className="p-3 bg-[#090E18] border border-emerald-500/50 space-y-1">
                <div className="text-emerald-400 font-bold text-[11px]">
                  ● NEAREST REACHABLE SAFE POINT
                </div>
                {activeRouteObj?.noRouteInfo?.nearestReachableSafePoint ? (
                  <>
                    <div className="text-sm font-sans font-semibold text-white">
                      {activeRouteObj.noRouteInfo.nearestReachableSafePoint.nodeName}
                    </div>
                    <div className="text-slate-300">
                      Elevation:{' '}
                      <strong className="text-emerald-300">
                        {activeRouteObj.noRouteInfo.nearestReachableSafePoint.elevationM}m MSL
                      </strong>{' '}
                      · Distance: {activeRouteObj.noRouteInfo.nearestReachableSafePoint.distanceKm} km · Est.{' '}
                      {activeRouteObj.noRouteInfo.nearestReachableSafePoint.travelTimeMin} min
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Recommended under current data for immediate high-ground staging.
                    </div>
                  </>
                ) : (
                  <div className="text-slate-300">
                    Remain at local high-ground structure; await high-clearance SDRF boat/truck extraction.
                  </div>
                )}
              </div>

              {/* Nearest Available Shelter */}
              <div className="p-3 bg-[#090E18] border border-cyan-500/50 space-y-1">
                <div className="text-cyan-400 font-bold text-[11px]">
                  ▲ NEAREST AVAILABLE SHELTER
                </div>
                {activeRouteObj?.noRouteInfo?.nearestAvailableShelter ? (
                  <>
                    <div className="text-sm font-sans font-semibold text-white">
                      {activeRouteObj.noRouteInfo.nearestAvailableShelter.shelterName} (
                      {activeRouteObj.noRouteInfo.nearestAvailableShelter.shelterId})
                    </div>
                    <div className="text-slate-300">
                      Ward {activeRouteObj.noRouteInfo.nearestAvailableShelter.ward} · Elev{' '}
                      {activeRouteObj.noRouteInfo.nearestAvailableShelter.elevationM}m MSL ·{' '}
                      <strong className="text-emerald-300">
                        {activeRouteObj.noRouteInfo.nearestAvailableShelter.availableBerths} berths available
                      </strong>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Distance: ~{activeRouteObj.noRouteInfo.nearestAvailableShelter.distanceKm} km ·{' '}
                      <button
                        type="button"
                        onClick={() =>
                          onSelectMapTarget({
                            type: 'SHELTER',
                            id:
                              activeRouteObj.noRouteInfo?.nearestAvailableShelter
                                ?.shelterId ?? 'SH-01',
                          })
                        }
                        className="text-cyan-300 underline"
                      >
                        Inspect Shelter on Map →
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-300 text-xs font-sans">
                    No directly reachable shelter with open road access. Coordinate with Control Room for high-clearance SDRF staging.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Preset Corridor Quick Selector */}
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
          <span className="text-slate-400 text-[11px] mr-1">PRESET CORRIDORS:</span>
          {routes.map((rt) => {
            const isSelected = rt.id === (activeRouteObj?.id ?? activeRouteId);
            return (
              <button
                key={rt.id}
                type="button"
                onClick={() => {
                  onSelectRouteId(rt.id);
                  onChangeCustomRoute(rt.originNodeId, rt.destinationNodeId);
                }}
                className={`px-2.5 py-1 border text-[11px] transition-colors whitespace-nowrap ${
                  isSelected
                    ? 'bg-cyan-950/70 border-cyan-400 text-cyan-200 font-semibold'
                    : 'bg-[#0C121E] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {rt.originName} → {rt.destinationName}{' '}
                {rt.feasible ? `(${rt.recommendedEtaMin}m)` : '(NO ROUTE)'}
              </button>
            );
          })}
        </div>

        {/* Live Feed Simulator embedded for manual road state testing */}
        <LiveFeedSimulator
          roads={roads}
          sensors={sensors}
          activityFeed={activityFeed}
          activeRouteRoadIds={activeRouteObj?.recommendedRoadIds}
          onInjectObservation={onInjectObservation}
          onResetObservations={onResetObservations}
          onSelectMapTarget={onSelectMapTarget}
          compact
        />

        {/* ROUTING GRAPH TABLE: base travel time, risk penalty, road state, confidence, expiry */}
        <div className="overflow-x-auto border border-slate-800">
          <table className="w-full text-left border-collapse font-mono text-xs">
            <thead>
              <tr className="bg-[#0C121E] text-slate-400 border-b border-slate-800">
                <th className="py-2 px-3">Road Segment</th>
                <th className="py-2 px-3">Road State</th>
                <th className="py-2 px-3 text-right">Base Travel Time</th>
                <th className="py-2 px-3 text-right">Risk Penalty ({activePolicy.label})</th>
                <th className="py-2 px-3 text-right">Flood Prob</th>
                <th className="py-2 px-3 text-right">Confidence</th>
                <th className="py-2 px-3 text-right">Expiry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {roads.map((r) => {
                const isRemovedForProfile =
                  r.currentState === RoadStatus.CLOSED ||
                  (r.currentState === RoadStatus.LIKELY_FLOODED &&
                    activePolicy.likelyFloodedPolicy === 'REMOVED');
                const isOnPrimary =
                  activeRouteObj?.primaryRoute?.roadIds.includes(r.id) ?? false;

                return (
                  <tr
                    key={r.id}
                    onClick={() => onSelectMapTarget({ type: 'ROAD', id: r.id })}
                    className={`hover:bg-slate-900/80 cursor-pointer ${
                      isOnPrimary ? 'bg-cyan-950/20' : ''
                    }`}
                  >
                    <td className="py-2 px-3 text-slate-200 font-sans font-medium">
                      <span className="font-mono text-cyan-400 mr-1.5">{r.id}</span>
                      {r.name}
                      {isOnPrimary && (
                        <span className="ml-2 font-mono text-[10px] text-cyan-300">
                          [ON PRIMARY ROUTE]
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <RoadStateIndicator state={r.currentState} />
                      {r.isHysteresisHeld && (
                        <span className="ml-1.5 text-[10px] text-amber-300">(Hold)</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-300">
                      {r.baseTravelTimeMin} min
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {isRemovedForProfile ? (
                        <span className="text-rose-400 font-semibold">
                          REMOVED FROM GRAPH
                        </span>
                      ) : (
                        <span className="text-amber-300">
                          +{r.riskPenaltyMin} min
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-200">
                      {Math.round(r.floodProbability * 100)}%
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-cyan-300">
                      {Math.round(r.confidence * 100)}%
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-400">
                      {r.expiry.slice(11, 19)}Z
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 5. EVACUATION & SHELTERS WORKSPACE (Capacity-Aware Evacuation Planning Module)
  if (activeTab === 'evacuation') {
    const assignedPlans = evacuationPlans.filter((p) => p.assigned);
    const unassignedPlans = evacuationPlans.filter((p) => !p.assigned);
    const totalPeopleProxy = evacuationPlans.reduce(
      (sum, p) => sum + p.populationAtRisk,
      0
    );
    const assignedPeopleProxy = assignedPlans.reduce(
      (sum, p) => sum + p.populationAtRisk,
      0
    );
    const unassignedPeopleProxy = unassignedPlans.reduce(
      (sum, p) => sum + p.populationAtRisk,
      0
    );
    const totalShelterCapacity = shelters.reduce(
      (sum, s) => sum + s.totalCapacity,
      0
    );
    const totalShelterOccupancy = shelters.reduce(
      (sum, s) => sum + s.currentOccupancy,
      0
    );
    const totalRemainingCapacity = shelters.reduce(
      (sum, s) => sum + (s.reachable ? s.remainingCapacity : 0),
      0
    );
    const shelterLoadPct = Math.round(
      (totalShelterOccupancy / Math.max(1, totalShelterCapacity)) * 100
    );

    const allCriticalFacilities = evacuationPlans.flatMap((p) =>
      p.criticalFacilities.map((f) => ({
        ...f,
        zoneId: p.sourceCellId,
        zoneLocality: p.sourceLocality,
        assigned: p.assigned,
        targetShelterName: p.targetShelterName,
      }))
    );

    return (
      <div className="flex-1 min-h-0 p-4 bg-[#080C14] space-y-4 overflow-y-auto">
        {/* Top Bar: Evacuation Mode Status + Trigger Controls + Recalculate Button */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <span
                className={`px-2 py-0.5 font-bold ${
                  evacuationModeActive
                    ? 'bg-rose-500 text-white'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {evacuationModeActive
                  ? '● EVACUATION MODE ACTIVE'
                  : '○ EVACUATION MODE STANDBY'}
              </span>
              <span className="text-emerald-300 font-semibold">
                {evacuationTriggerReason}
              </span>
            </div>
            <h2 className="text-base font-semibold text-white mt-1">
              Capacity-Aware Evacuation Planning
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <button
              type="button"
              onClick={onToggleManualEvacuation}
              className={`px-3 py-1.5 border font-semibold whitespace-nowrap transition-colors ${
                manualEvacuationActive
                  ? 'bg-rose-950/80 border-rose-400 text-rose-200'
                  : 'bg-[#0D1320] hover:bg-slate-800 border-slate-700 text-slate-200'
              }`}
            >
              {manualEvacuationActive
                ? '■ Stop Manual Evacuation Override'
                : '▶ Start Evacuation Mode (Operator Trigger)'}
            </button>

            <button
              type="button"
              onClick={onRecalculateEvacuationPlan}
              className="px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400 text-cyan-200 font-bold whitespace-nowrap transition-colors"
            >
              ↻ Recalculate evacuation plan
            </button>
          </div>
        </div>

        {/* Auto-Refresh Notification when a Major Road Changes */}
        {lastEvacAutoRefreshNote && (
          <div className="p-2.5 bg-cyan-950/40 border border-cyan-400/70 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-cyan-400 text-slate-950 font-bold text-[11px]">
                AUTO-REFRESHED
              </span>
              <span className="text-cyan-100">{lastEvacAutoRefreshNote}</span>
            </div>
            <span className="text-slate-400 text-[11px]">
              CLOSED roads removed · Uncertain/high-risk roads penalized
            </span>
          </div>
        )}

        {/* Controls Strip: Evacuation Threshold + Failure-State Stress Tests */}
        <div className="p-3 bg-[#0C121E] border border-slate-800 flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-[11px]">
                EVACUATION THRESHOLD:
              </span>
              {[0.45, 0.50, 0.60, 0.70].map((th) => (
                <button
                  key={th}
                  type="button"
                  onClick={() => onChangeEvacuationThreshold(th)}
                  className={`px-2 py-1 border text-[11px] ${
                    Math.abs(evacuationThreshold - th) < 0.01
                      ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 font-bold'
                      : 'bg-[#070B12] border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ≥ {Math.round(th * 100)}% Risk
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="shelter-cap-scale" className="text-slate-400 text-[11px]">
                SHELTER CAPACITY CAP:
              </label>
              <input
                id="shelter-cap-scale"
                type="range"
                min={35}
                max={100}
                step={5}
                value={shelterCapacityScalePct}
                onChange={(e) => onChangeShelterCapacityScale(Number(e.target.value))}
                className="w-24 accent-emerald-400 cursor-pointer"
              />
              <span className="text-emerald-300 font-semibold tabular-nums">
                {shelterCapacityScalePct}%
              </span>
            </div>
          </div>

          {/* Interactive Failure-State Verification Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-slate-400 mr-1">VERIFY FAILURE STATES:</span>
            <button
              type="button"
              onClick={() => onSimulateEvacFailureState('CAPACITY_EXCEEDED')}
              className="px-2 py-1 bg-amber-950/60 hover:bg-amber-900/70 border border-amber-500/60 text-amber-200 whitespace-nowrap"
            >
              ⚡ Shelter capacity exceeded
            </button>
            <button
              type="button"
              onClick={() => onSimulateEvacFailureState('ROAD_DISCONNECTED')}
              className="px-2 py-1 bg-rose-950/60 hover:bg-rose-900/70 border border-rose-500/60 text-rose-200 whitespace-nowrap"
            >
              ⚡ Road network disconnected
            </button>
            <button
              type="button"
              onClick={() => onSimulateEvacFailureState('NO_REACHABLE_SHELTER')}
              className="px-2 py-1 bg-purple-950/60 hover:bg-purple-900/70 border border-purple-500/60 text-purple-200 whitespace-nowrap"
            >
              ⚡ No reachable shelter
            </button>
            <button
              type="button"
              onClick={() => onSimulateEvacFailureState('RESET')}
              className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 whitespace-nowrap"
            >
              ↺ Reset
            </button>
          </div>
        </div>

        {/* EVACUATION DASHBOARD METRICS: Affected zones, People proxy, Shelter capacity, Shelter load, Routes, Unassigned zones, Critical facilities */}
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2.5 font-mono">
          <div className="p-2.5 bg-[#0C121E] border border-slate-800">
            <div className="text-[10.5px] text-slate-400">Affected zones</div>
            <div className="text-xl font-bold text-white tabular-nums mt-0.5">
              {evacuationPlans.length}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Above ≥{Math.round(evacuationThreshold * 100)}% threshold
            </div>
          </div>

          <div className="p-2.5 bg-[#0C121E] border border-slate-800">
            <div className="text-[10.5px] text-slate-400">People proxy</div>
            <div className="text-xl font-bold text-cyan-300 tabular-nums mt-0.5">
              {totalPeopleProxy.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {assignedPeopleProxy.toLocaleString()} assigned
            </div>
          </div>

          <div className="p-2.5 bg-[#0C121E] border border-slate-800">
            <div className="text-[10.5px] text-slate-400">Shelter capacity</div>
            <div className="text-xl font-bold text-emerald-300 tabular-nums mt-0.5">
              {totalShelterCapacity.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {totalRemainingCapacity.toLocaleString()} reachable berths left
            </div>
          </div>

          <div className="p-2.5 bg-[#0C121E] border border-slate-800">
            <div className="text-[10.5px] text-slate-400">Shelter load</div>
            <div
              className={`text-xl font-bold tabular-nums mt-0.5 ${
                shelterLoadPct >= 85 ? 'text-amber-300' : 'text-white'
              }`}
            >
              {shelterLoadPct}%
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {totalShelterOccupancy.toLocaleString()} occupied
            </div>
          </div>

          <div className="p-2.5 bg-[#0C121E] border border-slate-800">
            <div className="text-[10.5px] text-slate-400">Routes</div>
            <div className="text-xl font-bold text-cyan-300 tabular-nums mt-0.5">
              {assignedPlans.length}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {closedRoads.length} CLOSED roads removed
            </div>
          </div>

          <div
            className={`p-2.5 border ${
              unassignedPlans.length > 0
                ? 'bg-rose-950/40 border-rose-500/80'
                : 'bg-[#0C121E] border-slate-800'
            }`}
          >
            <div className="text-[10.5px] text-slate-300">Unassigned zones</div>
            <div
              className={`text-xl font-bold tabular-nums mt-0.5 ${
                unassignedPlans.length > 0 ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {unassignedPlans.length}
            </div>
            <div className="text-[10px] text-slate-300 mt-0.5">
              {unassignedPeopleProxy.toLocaleString()} people unallocated
            </div>
          </div>

          <div className="p-2.5 bg-[#0C121E] border border-slate-800">
            <div className="text-[10.5px] text-slate-400">Critical facilities</div>
            <div className="text-xl font-bold text-amber-300 tabular-nums mt-0.5">
              {allCriticalFacilities.length}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Hospitals · Schools · Care
            </div>
          </div>
        </div>

        {/* IMPORTANT FAILURE STATE BANNER: NO FEASIBLE EVACUATION PLAN */}
        {unassignedPlans.length > 0 && (
          <div className="p-3.5 bg-rose-950/45 border-2 border-rose-500/90 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 bg-rose-500 text-white font-bold text-xs">
                  NO FEASIBLE EVACUATION PLAN
                </span>
                <span className="text-rose-200 font-semibold text-xs">
                  {unassignedPlans.length} Affected Zone(s) Cannot Be Assigned ({unassignedPeopleProxy.toLocaleString()} exposed population proxy)
                </span>
              </div>
              <span className="text-xs text-slate-300">
                iDhara Rule: Do not invent a solution when capacity or reachability fails
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {unassignedPlans.map((uPlan) => (
                <div
                  key={uPlan.id}
                  onClick={() =>
                    onSelectMapTarget({ type: 'CELL', id: uPlan.sourceCellId })
                  }
                  className="p-2.5 bg-[#070A12] border border-rose-500/50 cursor-pointer hover:border-rose-400 space-y-1 font-mono text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white font-bold">
                      {uPlan.assignmentSummary}
                    </span>
                    <span className="px-1.5 py-0.5 bg-rose-900/80 text-rose-200 text-[10.5px]">
                      Reason: {uPlan.failureReason}
                    </span>
                  </div>
                  <p className="text-[11px] font-sans text-slate-300 leading-relaxed">
                    {uPlan.failureDetail}
                  </p>
                  <div className="text-[10.5px] text-slate-400 flex items-center justify-between pt-1">
                    <span>
                      People proxy: {uPlan.populationAtRisk} · Road: {uPlan.roadAccessibilityStatus}
                    </span>
                    <span>
                      Conf {Math.round(uPlan.confidence * 100)}% · Gen {uPlan.generated_at.slice(11, 19)}Z · Exp {uPlan.expiry.slice(11, 19)}Z
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CAPACITY-AWARE ASSIGNMENT STRIP (Zone A -> Shelter 1, Zone B -> Shelter 2, Zone C -> no feasible assignment) */}
        <div className="p-3 bg-[#0C121E] border border-slate-800 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
            <span className="text-cyan-300 font-semibold">
              CAPACITY-AWARE ZONE → SHELTER ASSIGNMENT SUMMARY (PRIORITY ORDER)
            </span>
            <span className="text-slate-400 text-[11px]">
              Prioritizes: 1. Hospitals → 2. Schools & Care Facilities → 3. High-Risk Vulnerable Zones
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 font-mono text-xs">
            {evacuationPlans.map((plan, idx) => (
              <div
                key={plan.id}
                onClick={() => {
                  onSelectMapTarget({ type: 'CELL', id: plan.sourceCellId });
                  if (plan.assigned) {
                    const targetSh = shelters.find(
                      (s) => s.id === plan.targetShelterId
                    );
                    if (targetSh) {
                      onChangeCustomRoute(plan.originNodeId, targetSh.nearestNodeId);
                    }
                  }
                }}
                className={`p-2 border cursor-pointer flex items-center justify-between gap-2 ${
                  plan.assigned
                    ? 'bg-[#080C15] border-emerald-500/40 hover:border-emerald-400'
                    : 'bg-rose-950/30 border-rose-500/70 hover:border-rose-400'
                }`}
              >
                <div className="truncate">
                  <span className="text-slate-400 mr-1.5">#{idx + 1}</span>
                  <span
                    className={
                      plan.assigned
                        ? 'text-slate-100 font-semibold'
                        : 'text-rose-300 font-bold'
                    }
                  >
                    {plan.assignmentSummary}
                  </span>
                </div>
                <span
                  className={`shrink-0 text-[11px] px-1.5 py-0.5 ${
                    plan.assigned
                      ? 'bg-emerald-950/70 text-emerald-300'
                      : 'bg-rose-900/80 text-rose-200 font-semibold'
                  }`}
                >
                  {plan.assigned
                    ? `${plan.populationAtRisk} ppl`
                    : plan.failureReason}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* SHELTERS: name, capacity, current estimated occupancy, remaining capacity, location, flood risk, accessibility */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 font-mono text-xs">
            <span className="text-emerald-400 font-semibold">
              MUNICIPAL SHELTERS (ONLY REACHABLE SHELTERS CONSIDERED FOR ASSIGNMENT)
            </span>
            <span className="text-slate-400 text-[11px]">
              Click any shelter to inspect on map
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {shelters.map((sh) => {
              const pct = Math.round(
                (sh.currentOccupancy / Math.max(1, sh.totalCapacity)) * 100
              );
              return (
                <div
                  key={sh.id}
                  onClick={() => onSelectMapTarget({ type: 'SHELTER', id: sh.id })}
                  className={`p-3 border cursor-pointer space-y-2 ${
                    !sh.reachable
                      ? 'bg-rose-950/20 border-rose-500/60'
                      : sh.remainingCapacity === 0
                      ? 'bg-amber-950/20 border-amber-500/60'
                      : 'bg-[#0C121E] border-slate-800 hover:border-emerald-500/50'
                  }`}
                >
                  <div className="flex items-center justify-between font-mono text-xs">
                    <span className="text-emerald-300 font-semibold">
                      ▲ {sh.id} · {sh.ward}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 text-[10.5px] font-bold ${
                        sh.reachable
                          ? 'bg-emerald-950/80 text-emerald-300'
                          : 'bg-rose-950/80 text-rose-300'
                      }`}
                    >
                      {sh.reachable ? 'REACHABLE' : 'UNREACHABLE'}
                    </span>
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-white truncate">
                      {sh.name}
                    </div>
                    <div className="font-mono text-[10.5px] text-slate-400 truncate mt-0.5">
                      Location: {sh.locationLabel}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 p-2 bg-[#070B12] border border-slate-800/90 font-mono text-[11px] tabular-nums">
                    <div>
                      <div className="text-[9.5px] text-slate-400">Capacity</div>
                      <div className="font-bold text-white">{sh.totalCapacity}</div>
                    </div>
                    <div>
                      <div className="text-[9.5px] text-slate-400">Est. Occ</div>
                      <div className="font-bold text-amber-300">
                        {sh.currentOccupancy}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9.5px] text-slate-400">Remaining</div>
                      <div
                        className={`font-bold ${
                          sh.remainingCapacity > 0
                            ? 'text-emerald-300'
                            : 'text-rose-400'
                        }`}
                      >
                        {sh.remainingCapacity}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1 font-mono text-[10.5px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Flood risk:</span>
                      <span className="text-slate-200">
                        {Math.round(sh.floodRiskProbability * 100)}% ({sh.floodRiskSeverity})
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Accessibility:</span>
                      <span
                        className={
                          sh.reachable ? 'text-emerald-300' : 'text-rose-300'
                        }
                      >
                        {sh.accessibilityLabel}
                      </span>
                    </div>
                  </div>

                  <div className="w-full h-1.5 bg-slate-900 overflow-hidden">
                    <div
                      className={`h-full ${
                        !sh.reachable
                          ? 'bg-rose-500'
                          : pct >= 90
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                      }`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <ProvenanceStrip provenance={sh} compact />
                </div>
              );
            })}
          </div>
        </div>

        {/* AFFECTED ZONES, CRITICAL FACILITIES, SHELTER ASSIGNMENTS & EVACUATION ROUTES TABLE */}
        <div className="overflow-x-auto border border-slate-800">
          <table className="w-full text-left border-collapse font-mono text-xs">
            <thead>
              <tr className="bg-[#0C121E] text-slate-400 border-b border-slate-800">
                <th className="py-2 px-3">Affected Zone & Priority</th>
                <th className="py-2 px-3">Flood Risk</th>
                <th className="py-2 px-3 text-right">Exposed Pop. Proxy</th>
                <th className="py-2 px-3">Critical Assets & Nearest Shelters</th>
                <th className="py-2 px-3">Road Accessibility</th>
                <th className="py-2 px-3">Capacity-Aware Shelter & Evacuation Route</th>
                <th className="py-2 px-3 text-right">Confidence · Gen · Expiry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {evacuationPlans.map((plan) => {
                const targetSh = shelters.find(
                  (s) => s.id === plan.targetShelterId
                );
                return (
                  <tr
                    key={plan.id}
                    onClick={() => {
                      onSelectMapTarget({ type: 'CELL', id: plan.sourceCellId });
                      if (plan.assigned && targetSh) {
                        onChangeCustomRoute(
                          plan.originNodeId,
                          targetSh.nearestNodeId
                        );
                      }
                    }}
                    className={`hover:bg-slate-900/80 cursor-pointer ${
                      !plan.assigned ? 'bg-rose-950/20' : ''
                    }`}
                  >
                    {/* Zone & Priority */}
                    <td className="py-2.5 px-3 align-top">
                      <div className="text-slate-100 font-sans font-semibold">
                        {plan.sourceLocality}{' '}
                        <span className="font-mono text-xs text-cyan-400">
                          ({plan.sourceCellId})
                        </span>
                      </div>
                      <div className="mt-1">
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-bold ${
                            plan.priorityTier === 'PRIORITY_1_HOSPITAL'
                              ? 'bg-rose-500/25 border border-rose-400 text-rose-200'
                              : plan.priorityTier === 'PRIORITY_2_SCHOOL_CARE'
                              ? 'bg-amber-500/25 border border-amber-400 text-amber-200'
                              : 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-200'
                          }`}
                        >
                          {plan.priorityTier.replace(/_/g, ' ')} (Score {plan.priorityScore})
                        </span>
                      </div>
                      <div className="text-[10.5px] text-slate-400 mt-1 max-w-xs">
                        {plan.priorityReason}
                      </div>
                    </td>

                    {/* Risk */}
                    <td className="py-2.5 px-3 align-top">
                      <SeverityIndicator severity={plan.severity} />
                      <div className="text-[11px] text-slate-200 mt-1 tabular-nums">
                        Prob: <strong>{Math.round(plan.floodProbability * 100)}%</strong> · Depth: ~
                        {plan.predictedDepthCm}cm
                      </div>
                    </td>

                    {/* Exposed Population Proxy */}
                    <td className="py-2.5 px-3 text-right align-top tabular-nums">
                      <div className="text-sm font-bold text-white">
                        {plan.populationAtRisk.toLocaleString()}
                      </div>
                      <div className="text-[10.5px] text-slate-400">
                        {plan.assigned ? `${plan.busesAssigned} buses` : 'Unallocated'}
                      </div>
                    </td>

                    {/* Critical Assets & Nearest Shelters */}
                    <td className="py-2.5 px-3 align-top space-y-1">
                      {plan.criticalFacilities.length > 0 ? (
                        <div className="space-y-0.5">
                          {plan.criticalFacilities.map((fac) => (
                            <div
                              key={fac.id}
                              className="text-[11px] text-amber-200 font-medium"
                            >
                              ✚ {fac.name} ({fac.priorityLabel})
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400">
                          Dense Residential / Bazaar Pocket
                        </div>
                      )}
                      <div className="text-[10.5px] text-slate-400 pt-1 border-t border-slate-800/70">
                        Nearest Shelters:{' '}
                        {plan.nearestShelters
                          .slice(0, 2)
                          .map(
                            (ns) =>
                              `${ns.shelterId} (${ns.distanceKm}km, ${
                                ns.reachable ? 'Reachable' : 'Blocked'
                              })`
                          )
                          .join(' · ')}
                      </div>
                    </td>

                    {/* Road Accessibility */}
                    <td className="py-2.5 px-3 align-top">
                      <span
                        className={`px-1.5 py-0.5 text-[10.5px] font-bold ${
                          plan.roadAccessibilityStatus === 'ACCESSIBLE'
                            ? 'bg-emerald-950/70 text-emerald-300'
                            : plan.roadAccessibilityStatus === 'RESTRICTED_HIGH_RISK'
                            ? 'bg-amber-950/70 text-amber-300'
                            : 'bg-rose-950/80 text-rose-300'
                        }`}
                      >
                        {plan.roadAccessibilityStatus}
                      </span>
                      <div className="text-[10.5px] text-slate-400 mt-1 max-w-[180px]">
                        {plan.roadAccessibilityLabel}
                      </div>
                    </td>

                    {/* Capacity-Aware Assignment & Evacuation Route */}
                    <td className="py-2.5 px-3 align-top">
                      {plan.assigned ? (
                        <div className="space-y-1">
                          <div className="text-emerald-300 font-bold">
                            ✓ {plan.assignmentSummary}
                          </div>
                          <div className="text-[11px] text-cyan-200">
                            Route: {plan.routeRoadIds.join(' → ')} ({plan.distanceKm} km · ~
                            {plan.estimatedClearanceMin} min)
                          </div>
                          <div className="text-[10.5px] text-amber-300 font-semibold">
                            “{plan.routeLabel}”
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="px-2 py-0.5 bg-rose-500 text-white font-bold text-[11px] inline-block">
                            {plan.failureBanner}
                          </div>
                          <div className="text-rose-300 font-bold text-xs">
                            {plan.assignmentSummary}
                          </div>
                          <div className="text-[11px] text-rose-200">
                            Reason: <strong>{plan.failureReason}</strong>
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Confidence, Generated Time, Expiry */}
                    <td className="py-2.5 px-3 text-right align-top tabular-nums text-[11px]">
                      <div className="text-cyan-300 font-bold">
                        Conf: {Math.round(plan.confidence * 100)}%
                      </div>
                      <div className="text-slate-300 mt-0.5">
                        Gen: {plan.generated_at.slice(11, 19)}Z
                      </div>
                      <div className="text-amber-300 mt-0.5">
                        Exp: {plan.expiry.slice(11, 19)}Z
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 6. ALERTS & COMMAND CENTER WORKSPACE (7-State Lifecycle)
  if (activeTab === 'alerts') {
    return (
      <AlertCommandWorkspace
        alerts={alerts}
        cells={cells}
        roads={roads}
        shelters={shelters}
        params={params}
        activeRole={activeRole}
        activityFeed={activityFeed}
        onTransitionAlertLifecycle={onTransitionAlertLifecycle}
        onSelectMapTarget={onSelectMapTarget}
        onAcknowledgeAlert={onAcknowledgeAlert}
      />
    );
  }

  // 7 & 8. EVENT REPLAY & POST-DISASTER LEARNING / VALIDATION WORKSPACE
  if (activeTab === 'event-replay' || activeTab === 'validation') {
    return (
      <PostDisasterLearningWorkspace
        activeTab={activeTab}
        params={params}
        onUpdateParams={onUpdateParams}
        cells={cells}
        roads={roads}
        sensors={sensors}
        routes={routes}
        validationReport={validationReport}
        isPlayingTimeline={isPlayingTimeline}
        onTogglePlayTimeline={onTogglePlayTimeline}
        replaySpeed={replaySpeed}
        onChangeReplaySpeed={onChangeReplaySpeed}
        onStepTimeline={onStepTimeline}
        activeModelVersionId={activeModelVersionId}
        onChangeModelVersionId={onChangeModelVersionId}
        onSelectMapTarget={onSelectMapTarget}
      />
    );
  }

  // 9. DATA HEALTH & SENSOR TELEMETRY WORKSPACE (FRESH | STALE | SUSPECT | MISSING)
  if (activeTab === 'data-health') {
    const rainGaugeA = sensors.find((s) => s.id === 'SEN-RG-01') ?? sensors[6];
    const waterSensorB = sensors.find((s) => s.id === 'SEN-WL-05') ?? sensors[4];
    const waterSensorC = sensors.find((s) => s.id === 'SEN-WL-04') ?? sensors[3];

    return (
      <div className="flex-1 min-h-0 p-4 bg-[#080C14] space-y-4 overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0C1220] p-3 border border-slate-800 rounded">
          <div>
            <div className="font-mono text-[11px] text-cyan-400">
              DATA QUALITY & SENSOR FRESHNESS
            </div>
            <h2 className="text-base font-semibold text-white">
              Data Health & Telemetry ({dataHealthReport.overallHealthPct}%)
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsLocationReportOpen(true)}
              className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-black font-semibold text-xs rounded shadow-md transition-all flex items-center gap-2 cursor-pointer border border-cyan-300/40"
              title="Generate a high-fidelity PDF report for any ward, catchment, or sensor zone"
            >
              <span>📄</span>
              <span>Generate Location PDF Report</span>
            </button>
            <ProvenanceStrip provenance={dataHealthReport} compact />
          </div>
        </div>

        {/* Highlighted Sensor State Examples (Rain Gauge A: FRESH, Water Sensor B: STALE, Water Sensor C: SUSPECT) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono">
          {[
            { label: 'Rain Gauge A (Rajwada)', sensor: rainGaugeA },
            { label: 'Water Sensor B (Harsiddhi)', sensor: waterSensorB },
            { label: 'Water Sensor C (Sarwate Sump)', sensor: waterSensorC },
          ].map((item) => {
            const fMeta = SENSOR_FRESHNESS_META[item.sensor.freshnessState];
            return (
              <div
                key={item.sensor.id}
                onClick={() => onSelectMapTarget({ type: 'SENSOR', id: item.sensor.id })}
                className={`p-3 border ${fMeta.borderColor} ${fMeta.bgTint} cursor-pointer space-y-1`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-sans font-semibold text-white">{item.label}</span>
                  <span className={`font-bold ${fMeta.textColor}`}>
                    {fMeta.glyph} {item.sensor.freshnessState}
                  </span>
                </div>
                <div className="text-xs text-slate-200">
                  Last seen: <strong>{item.sensor.lastSeenLabel}</strong>
                </div>
                <div className="text-[11px] text-slate-300">
                  Note: <span className="text-amber-200">{item.sensor.diagnosticNote}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/80 tabular-nums">
                  <span>
                    Reading: {item.sensor.currentValue} {item.sensor.unit}
                  </span>
                  <span className="text-cyan-300">
                    Conf: {Math.round(item.sensor.confidence * 100)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Live Feed Simulator embedded for injecting Sensor Failures / Water-Level Spikes */}
        <LiveFeedSimulator
          roads={roads}
          sensors={sensors}
          activityFeed={activityFeed}
          activeRouteRoadIds={activeRouteObj?.recommendedRoadIds}
          onInjectObservation={onInjectObservation}
          onResetObservations={onResetObservations}
          onSelectMapTarget={onSelectMapTarget}
          compact
        />

        {/* 10 Sensors Full Telemetry Quality Table */}
        <div className="overflow-x-auto border border-slate-800">
          <table className="w-full text-left border-collapse font-mono text-xs">
            <thead>
              <tr className="bg-[#0C121E] text-slate-400 border-b border-slate-800">
                <th className="py-2 px-3">Sensor ID & Name</th>
                <th className="py-2 px-3">Freshness State</th>
                <th className="py-2 px-3">Last Seen</th>
                <th className="py-2 px-3 text-right">Reading</th>
                <th className="py-2 px-3">Diagnostic / Quality Note</th>
                <th className="py-2 px-3 text-right">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {sensors.map((s) => {
                const fMeta = SENSOR_FRESHNESS_META[s.freshnessState];
                return (
                  <tr
                    key={s.id}
                    onClick={() => onSelectMapTarget({ type: 'SENSOR', id: s.id })}
                    className="hover:bg-slate-900/80 cursor-pointer"
                  >
                    <td className="py-2 px-3 text-slate-200 font-sans font-medium">
                      <span className="font-mono text-cyan-300 mr-1.5">{s.id}</span>
                      {s.name}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`font-bold ${fMeta.textColor}`}>
                        {fMeta.glyph} {s.freshnessState}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-300 tabular-nums">
                      {s.lastSeenLabel}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-white">
                      {s.currentValue} {s.unit}
                    </td>
                    <td className="py-2 px-3 text-slate-400">
                      {s.diagnosticNote}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-cyan-300">
                      {Math.round(s.confidence * 100)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Location PDF Report Workflow */}
        <LocationReportModal
          isOpen={isLocationReportOpen}
          onClose={() => setIsLocationReportOpen(false)}
          cells={cells}
          roads={roads}
          sensors={sensors}
          alerts={alerts}
          dataHealthReport={dataHealthReport}
          activeRole={activeRole}
        />
      </div>
    );
  }

  return null;
};
