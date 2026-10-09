import React, { useEffect, useRef, useState } from 'react';
import { PILOT_BOUNDS, PILOT_SCOPE_ID } from '../data/indorePilotData';
import { getEventPresets } from '../modules/historicalReplay';
import {
  MODEL_VERSIONS,
  VALIDATION_WORKFLOW_STAGES,
  ValidationExecutionState,
} from '../modules/validation';
import {
  DISASTER_STAGE_INFO,
  DisasterStage,
  FloodRiskCell,
  FloodSeverity,
  NavigationTab,
  ReplaySpeed,
  RoadSegmentState,
  RoadStatus,
  RouteRecommendation,
  ScenarioParameters,
  SensorNode,
  ValidationReport,
} from '../types/idhara';
import { MapInspectionTarget } from './IndoreFloodMap';
import { ProvenanceStrip, SeverityIndicator } from './SeverityVisuals';

interface PostDisasterLearningWorkspaceProps {
  activeTab: NavigationTab;
  params: ScenarioParameters;
  onUpdateParams: (
    updater: (prev: ScenarioParameters) => ScenarioParameters
  ) => void;
  cells: FloodRiskCell[];
  roads: RoadSegmentState[];
  sensors: SensorNode[];
  routes: RouteRecommendation[];
  validationReport: ValidationReport;
  isPlayingTimeline: boolean;
  onTogglePlayTimeline: () => void;
  replaySpeed: ReplaySpeed;
  onChangeReplaySpeed: (speed: ReplaySpeed) => void;
  onStepTimeline: (deltaHours: number) => void;
  activeModelVersionId: string;
  onChangeModelVersionId: (versionId: string) => void;
  onSelectMapTarget: (target: MapInspectionTarget) => void;
}

export const PostDisasterLearningWorkspace: React.FC<
  PostDisasterLearningWorkspaceProps
> = ({
  activeTab,
  params,
  onUpdateParams,
  cells,
  roads,
  sensors,
  routes,
  validationReport,
  isPlayingTimeline,
  onTogglePlayTimeline,
  replaySpeed,
  onChangeReplaySpeed,
  onStepTimeline,
  activeModelVersionId,
  onChangeModelVersionId,
  onSelectMapTarget,
}) => {
  const presets = getEventPresets();
  const activePreset =
    presets.find((p) => p.id === params.activeEventPresetId) ?? presets[0];

  // Validation State Machine (Finite Lifecycle: IDLE -> STARTING_LOADING -> RUNNING -> COMPLETED; allow STOPPED and restart)
  const [validationState, setValidationState] =
    useState<ValidationExecutionState>('IDLE');
  const [validationStageIndex, setValidationStageIndex] = useState<number>(0);
  const [validationProgressPct, setValidationProgressPct] = useState<number>(0);

  const activeRunIdRef = useRef<number>(0);
  const validationTimerRef = useRef<number | null>(null);

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      if (validationTimerRef.current !== null) {
        window.clearTimeout(validationTimerRef.current);
        validationTimerRef.current = null;
      }
    };
  }, []);

  // Clean up timers and stop validation if user leaves the validation tab
  useEffect(() => {
    if (activeTab !== 'validation') {
      if (validationTimerRef.current !== null) {
        window.clearTimeout(validationTimerRef.current);
        validationTimerRef.current = null;
      }
      activeRunIdRef.current += 1;
      if (validationState === 'RUNNING' || validationState === 'STARTING_LOADING') {
        setValidationState('STOPPED');
      }
    }
  }, [activeTab]);

  const handleStartValidation = () => {
    // PREVENT DUPLICATE RUNS: If already running, do nothing
    if (validationState === 'RUNNING' || validationState === 'STARTING_LOADING') {
      return;
    }

    if (validationTimerRef.current !== null) {
      window.clearTimeout(validationTimerRef.current);
      validationTimerRef.current = null;
    }

    const runId = ++activeRunIdRef.current;
    setValidationState('STARTING_LOADING');
    setValidationStageIndex(0);
    setValidationProgressPct(VALIDATION_WORKFLOW_STAGES[0].progressPct);

    // Finite sequential execution delays per stage
    const stageDelays = [380, 380, 400, 450, 400, 420, 380, 350];

    const runStage = (stageIdx: number) => {
      // If cancelled or superseded by another run, abort
      if (activeRunIdRef.current !== runId) return;

      if (stageIdx >= VALIDATION_WORKFLOW_STAGES.length - 1) {
        // Complete the validation process
        setValidationStageIndex(VALIDATION_WORKFLOW_STAGES.length - 1);
        setValidationProgressPct(100);
        setValidationState('COMPLETED');
        validationTimerRef.current = null;
        return;
      }

      setValidationState('RUNNING');
      setValidationStageIndex(stageIdx);
      setValidationProgressPct(VALIDATION_WORKFLOW_STAGES[stageIdx].progressPct);

      validationTimerRef.current = window.setTimeout(() => {
        runStage(stageIdx + 1);
      }, stageDelays[stageIdx] ?? 400);
    };

    validationTimerRef.current = window.setTimeout(() => {
      runStage(1);
    }, stageDelays[0]);
  };

  const handleStopValidation = () => {
    activeRunIdRef.current += 1;
    if (validationTimerRef.current !== null) {
      window.clearTimeout(validationTimerRef.current);
      validationTimerRef.current = null;
    }
    setValidationState('STOPPED');
  };

  const handleResetValidation = () => {
    activeRunIdRef.current += 1;
    if (validationTimerRef.current !== null) {
      window.clearTimeout(validationTimerRef.current);
      validationTimerRef.current = null;
    }
    setValidationState('IDLE');
    setValidationStageIndex(0);
    setValidationProgressPct(0);
  };

  // PREDICTED VS OBSERVED comparison view mode
  const [comparisonView, setComparisonView] = useState<
    'MAP_VIEW' | 'TIMELINE_VIEW' | 'METRICS_VIEW'
  >(activeTab === 'event-replay' ? 'TIMELINE_VIEW' : 'MAP_VIEW');

  const [outcomeFilter, setOutcomeFilter] = useState<
    'ALL' | 'FALSE_NEGATIVE' | 'TRUE_POSITIVE' | 'FALSE_POSITIVE'
  >('ALL');

  const currentStepEntry =
    validationReport.hourlyComparisonTimeline.find(
      (s) => s.hourOffset === params.timelineHourOffset
    ) ?? validationReport.hourlyComparisonTimeline[3];

  const closedRoads = roads.filter((r) => r.currentState === RoadStatus.CLOSED);
  const atRiskRoads = roads.filter(
    (r) =>
      r.currentState === RoadStatus.AT_RISK ||
      r.currentState === RoadStatus.LIKELY_FLOODED
  );
  const divertedRoutes = routes.filter(
    (r) => r.baselineBlockedRoadNames.length > 0 || r.avoidedHazardCount > 0
  );

  const filteredRecords = validationReport.records.filter((r) => {
    if (outcomeFilter === 'ALL') return true;
    return r.outcomeCategory === outcomeFilter;
  });

  return (
    <div className="flex-1 min-h-0 p-4 bg-[#080C14] border-b border-slate-800/90 space-y-4 overflow-y-auto">
      {/* =====================================================================
          TOP BANNER: CORE LEARNING THESIS + PROVENANCE
         ===================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span className="text-cyan-400 font-bold">
              {activeTab === 'event-replay'
                ? `EVENT REPLAY — STAGE ${DISASTER_STAGE_INFO[params.stage]?.num ?? 4}: ${DISASTER_STAGE_INFO[params.stage]?.shortLabel.toUpperCase() ?? 'POST-DISASTER LEARN'}`
                : `VALIDATION — COMPLETE 5×5 KM STUDY AREA`}
            </span>
            <span className="text-slate-600">·</span>
            {activeTab === 'validation' ? (
              <span className="px-2 py-0.5 bg-amber-500/20 border border-amber-400/80 text-amber-300 font-semibold text-[10.5px]">
                DEMO / MOCK VALIDATION (PROTOTYPE BENCHMARK)
              </span>
            ) : (
              <span className="text-emerald-300 font-semibold">
                “iDhara does not stop after predicting a flood. It learns from what actually happened.”
              </span>
            )}
          </div>
          <h2 className="text-base font-semibold text-white mt-0.5">
            {validationReport.eventTitle}
          </h2>
          {activeTab === 'validation' && (
            <div className="font-mono text-[11px] text-slate-400 mt-1 flex flex-wrap items-center gap-2">
              <span className="text-cyan-300 font-semibold">Study Boundary:</span>
              <span>Complete 5×5 km Study Area ({PILOT_BOUNDS.widthKm}×{PILOT_BOUNDS.heightKm} km · 64 grid cells · 25.0 km² · Boundary ID: {PILOT_SCOPE_ID})</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">All 64 cells evaluated simultaneously (independent of locality selection)</span>
            </div>
          )}
        </div>

        <ProvenanceStrip provenance={validationReport} compact />
      </div>

      {/* =====================================================================
          1A. FINITE VALIDATION WORKFLOW CONTROLLER (activeTab === 'validation')
         ===================================================================== */}
      {activeTab === 'validation' && (
        <div className="p-3 bg-[#0C121E] border border-slate-800 space-y-3 font-mono">
          {/* Top Bar: Title, State Badge, Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
            <div>
              <div className="text-xs text-amber-300 font-bold">
                FINITE VALIDATION PROCESS — COMPLETE 5×5 KM STUDY AREA
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {validationState === 'IDLE' && (
                  <span className="px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 text-[10.5px] font-semibold">
                    ● IDLE — READY TO VALIDATE
                  </span>
                )}
                {validationState === 'STARTING_LOADING' && (
                  <span className="px-2 py-0.5 bg-sky-950/80 border border-sky-400 text-sky-200 text-[10.5px] font-bold animate-pulse">
                    ⚙ STARTING / LOADING INPUTS...
                  </span>
                )}
                {validationState === 'RUNNING' && (
                  <span className="px-2 py-0.5 bg-cyan-950/80 border border-cyan-400 text-cyan-200 text-[10.5px] font-bold animate-pulse">
                    ▶ RUNNING — STAGE {validationStageIndex + 1}/8: {VALIDATION_WORKFLOW_STAGES[validationStageIndex].label.toUpperCase()}
                  </span>
                )}
                {validationState === 'COMPLETED' && (
                  <span className="px-2 py-0.5 bg-emerald-950/80 border border-emerald-400 text-emerald-200 text-[10.5px] font-bold">
                    ✓ VALIDATION COMPLETED (100%)
                  </span>
                )}
                {validationState === 'STOPPED' && (
                  <span className="px-2 py-0.5 bg-rose-950/80 border border-rose-400 text-rose-200 text-[10.5px] font-bold">
                    ⏹ STOPPED AT STAGE {validationStageIndex + 1}/8
                  </span>
                )}
                <span className="px-1.5 py-0.5 bg-[#070B12] border border-slate-800 text-slate-400 text-[10px]">
                  Boundary: 5×5 km (64 Cells)
                </span>
                <span className="px-1.5 py-0.5 bg-[#070B12] border border-slate-800 text-amber-300/90 text-[10px]">
                  Demo Validation
                </span>
              </div>
            </div>

            {/* Workflow Control Buttons */}
            <div className="flex items-center gap-2">
              {validationState === 'IDLE' && (
                <button
                  type="button"
                  onClick={handleStartValidation}
                  className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs border border-cyan-400 flex items-center gap-1.5 transition-colors cursor-pointer shadow-[0_0_10px_rgba(6,182,212,0.3)]"
                >
                  ▶ Start Validation
                </button>
              )}
              {(validationState === 'STARTING_LOADING' || validationState === 'RUNNING') && (
                <button
                  type="button"
                  onClick={handleStopValidation}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs border border-rose-400 flex items-center gap-1.5 transition-colors cursor-pointer shadow-[0_0_10px_rgba(244,63,94,0.3)]"
                >
                  ⏹ Stop Validation
                </button>
              )}
              {validationState === 'COMPLETED' && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleStartValidation}
                    className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs border border-cyan-400 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    ↻ Start Again
                  </button>
                  <button
                    type="button"
                    onClick={handleResetValidation}
                    className="px-2.5 py-1 bg-[#070B12] hover:bg-slate-800 text-slate-300 text-xs border border-slate-700 transition-colors cursor-pointer"
                  >
                    ↺ Reset to Idle
                  </button>
                </div>
              )}
              {validationState === 'STOPPED' && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleStartValidation}
                    className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs border border-cyan-400 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    ▶ Start Again
                  </button>
                  <button
                    type="button"
                    onClick={handleResetValidation}
                    className="px-2.5 py-1 bg-[#070B12] hover:bg-slate-800 text-slate-300 text-xs border border-slate-700 transition-colors cursor-pointer"
                  >
                    ↺ Reset to Idle
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 1. SELECT HISTORICAL FLOOD EVENT */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-300">
              <span className="font-bold text-cyan-300">1. HISTORICAL FLOOD EVENT SELECTION</span>
              <span className="text-[10px] text-slate-500">
                {validationState === 'RUNNING' || validationState === 'STARTING_LOADING'
                  ? 'Locked during active validation run'
                  : 'Select past event to evaluate against'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
              {presets.map((preset) => {
                const isSelected = preset.id === params.activeEventPresetId;
                const isLocked =
                  validationState === 'RUNNING' ||
                  validationState === 'STARTING_LOADING';
                return (
                  <div
                    key={preset.id}
                    onClick={() => {
                      if (isLocked) return;
                      onUpdateParams((prev) => ({
                        ...prev,
                        activeEventPresetId: preset.id,
                        mode: preset.mode,
                        rainfallIntensityMmHr: preset.peakRainfallMmHr,
                        drainageBlockagePct: preset.drainageBlockagePct,
                        upstreamKahnInflowMultiplier: preset.upstreamMultiplier,
                        timelineHourOffset: 0,
                      }));
                      if (validationState === 'COMPLETED' || validationState === 'STOPPED') {
                        setValidationState('IDLE');
                        setValidationStageIndex(0);
                        setValidationProgressPct(0);
                      }
                    }}
                    className={`p-2.5 border transition-colors ${
                      isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                    } ${
                      isSelected
                        ? 'bg-amber-950/30 border-amber-400'
                        : 'bg-[#070B12] border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10.5px]">
                      <span className="text-amber-300 font-bold">
                        {preset.mode} EVENT
                      </span>
                      <span className="text-sky-300 tabular-nums font-semibold">
                        Peak {preset.peakRainfallMmHr} mm/h · {preset.cumulativeMm} mm
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-white mt-1 line-clamp-1 font-sans">
                      {preset.title}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                      {preset.summary}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2-8. FINITE PROGRESS BAR & STAGE STEPPER */}
          <div className="p-2.5 bg-[#070B12] border border-slate-800/90 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">
                WORKFLOW PROGRESS: <strong className="text-cyan-300">{validationProgressPct}%</strong>
                {validationState !== 'IDLE' && (
                  <span className="ml-2 text-slate-400 font-normal">
                    — Stage {validationStageIndex + 1} of 8: <span className="text-white font-semibold">{VALIDATION_WORKFLOW_STAGES[validationStageIndex].label}</span>
                  </span>
                )}
              </span>
              <span className="text-slate-500 text-[10px]">
                {validationState === 'IDLE'
                  ? 'Click "Start Validation" to begin finite run'
                  : validationState === 'COMPLETED'
                  ? 'Run completed successfully · Timers stopped'
                  : validationState === 'STOPPED'
                  ? 'Run stopped by operator'
                  : 'Finite sequential execution'}
              </span>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-2 bg-slate-950 border border-slate-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  validationState === 'COMPLETED'
                    ? 'bg-emerald-400'
                    : validationState === 'STOPPED'
                    ? 'bg-rose-500'
                    : 'bg-gradient-to-r from-sky-500 to-cyan-400'
                }`}
                style={{ width: `${validationProgressPct}%` }}
              />
            </div>

            {/* Stepper Grid (8 Stages) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-1 pt-1 text-[10px]">
              {VALIDATION_WORKFLOW_STAGES.map((stg, sIdx) => {
                const isCurrent =
                  validationState !== 'IDLE' && validationStageIndex === sIdx;
                const isDone =
                  validationState === 'COMPLETED' ||
                  (validationState !== 'IDLE' && validationStageIndex > sIdx);
                return (
                  <div
                    key={stg.id}
                    className={`p-1.5 border transition-colors ${
                      isCurrent
                        ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200 font-bold'
                        : isDone
                        ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-300'
                        : 'bg-[#0A0E18] border-slate-800/80 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[9px]">
                      <span>STEP {stg.stepNumber}</span>
                      <span>{isDone ? '✓' : isCurrent ? '▶' : '·'}</span>
                    </div>
                    <div className="truncate font-semibold mt-0.5">
                      {stg.label}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Stage Description & Status Callout */}
            <div className="p-2 bg-[#0C121E] border border-slate-800 text-[11px] flex flex-wrap items-center justify-between gap-2">
              <div className="text-slate-300">
                <span className="text-slate-500 font-semibold mr-1">Current Action:</span>
                {validationState === 'IDLE'
                  ? 'Ready to execute validation across complete 5×5 km study area (64 cells). Click "Start Validation" above.'
                  : VALIDATION_WORKFLOW_STAGES[validationStageIndex].description}
              </div>
              <div className="text-[10.5px] text-slate-400 font-sans">
                {validationState === 'COMPLETED' ? (
                  <span className="text-emerald-300 font-mono font-semibold">
                    ✓ Complete 5×5 km Study Area Validated.
                  </span>
                ) : validationState === 'STOPPED' ? (
                  <span className="text-rose-300 font-mono font-semibold">
                    ⏹ Stopped at Step {validationStageIndex + 1}.
                  </span>
                ) : validationState === 'RUNNING' || validationState === 'STARTING_LOADING' ? (
                  <span className="text-cyan-300 font-mono">
                    Evaluating 64 grid cells...
                  </span>
                ) : (
                  <span className="text-slate-500">
                    64 Cells · 5×5 km Pilot Grid
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Validation Boundary & Integrity Declaration */}
          <div className="p-2 bg-[#070B12] border border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-slate-400">
            <div>
              <strong className="text-cyan-300">Boundary Guarantee:</strong> The validation process validates the model over the COMPLETE existing 5×5 km study area (all 64 grid cells · 25 km²). It does NOT validate only a selected locality.
            </div>
            <div>
              <strong className="text-amber-300">Data Integrity:</strong> Demo Validation evaluated using existing hydro-terrain inputs & synthetic HWM observations without fabricated accuracy claims.
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          1B. EVENT REPLAY SELECTOR & TRANSPORT CONTROLS
          (Play / Pause / Step backward / Step forward / Speed 1x · 2x · 5x)
         ===================================================================== */}
      {activeTab === 'event-replay' && (
        <div className="p-3 bg-[#0C121E] border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono text-xs text-amber-300 font-bold">
            SYNTHETIC HISTORICAL & MONSOON EVENT REPLAY ARCHIVE
          </div>

          {/* Transport Controls: Play, Pause, Step Backward, Step Forward, Speed 1x / 2x / 5x */}
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
            <button
              type="button"
              onClick={() => onStepTimeline(-1)}
              className="px-2.5 py-1 bg-[#070B12] hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold whitespace-nowrap"
              title="Step backward 1 hour"
            >
              ⏮ Step Backward
            </button>

            <button
              type="button"
              onClick={onTogglePlayTimeline}
              className={`px-3 py-1 border font-bold whitespace-nowrap transition-colors ${
                isPlayingTimeline
                  ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                  : 'bg-cyan-500/25 hover:bg-cyan-500/35 border-cyan-400 text-cyan-200'
              }`}
            >
              {isPlayingTimeline ? '❚❚ Pause' : '▶ Play'}
            </button>

            <button
              type="button"
              onClick={() => onStepTimeline(1)}
              className="px-2.5 py-1 bg-[#070B12] hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold whitespace-nowrap"
              title="Step forward 1 hour"
            >
              Step Forward ⏭
            </button>

            <span className="text-slate-600 mx-1">|</span>

            <span className="text-[11px] text-slate-400">Speed:</span>
            {([1, 2, 5] as ReplaySpeed[]).map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => onChangeReplaySpeed(spd)}
                className={`px-2 py-1 border text-[11px] font-bold ${
                  replaySpeed === spd
                    ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                    : 'bg-[#070B12] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        {/* Event Presets Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
          {presets.map((preset) => {
            const isSelected = preset.id === params.activeEventPresetId;
            return (
              <div
                key={preset.id}
                onClick={() =>
                  onUpdateParams((prev) => ({
                    ...prev,
                    activeEventPresetId: preset.id,
                    mode: preset.mode,
                    rainfallIntensityMmHr: preset.peakRainfallMmHr,
                    drainageBlockagePct: preset.drainageBlockagePct,
                    upstreamKahnInflowMultiplier: preset.upstreamMultiplier,
                    timelineHourOffset: 0,
                  }))
                }
                className={`p-2.5 border cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-amber-950/30 border-amber-400'
                    : 'bg-[#070B12] border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between font-mono text-[10.5px]">
                  <span className="text-amber-300 font-bold">
                    {preset.mode} EVENT
                  </span>
                  <span className="text-sky-300 tabular-nums font-semibold">
                    Peak {preset.peakRainfallMmHr} mm/h · {preset.cumulativeMm} mm
                  </span>
                </div>
                <div className="text-xs font-semibold text-white mt-1 line-clamp-1">
                  {preset.title}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                  {preset.summary}
                </p>
              </div>
            );
          })}
        </div>

        {/* Hourly Hydrograph Scrubber + Live Map Evolution Strip (Predicted Risk, Observed Flood, Road Closures, Route Changes) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-1">
          {/* Left 7 Cols: Rainfall Timeline Scrubber */}
          <div className="lg:col-span-7 p-2.5 bg-[#070B12] border border-slate-800/90 flex flex-col justify-between">
            <div className="flex items-center justify-between font-mono text-[11px] text-slate-300 mb-2">
              <span>
                RAINFALL TIMELINE ({activePreset.dateLabel}) — Step:{' '}
                <strong className="text-cyan-300">{currentStepEntry.label}</strong>
              </span>
              <span className="text-sky-300 font-bold">
                {params.rainfallIntensityMmHr} mm/hr
              </span>
            </div>

            <div className="grid grid-cols-8 gap-1.5 items-end h-20 pt-2 px-1">
              {activePreset.hourlyRainProfile.map((step) => {
                const isCurrent = params.timelineHourOffset === step.hourOffset;
                const heightPct = Math.max(
                  14,
                  Math.round((step.mmHr / 95) * 100)
                );
                return (
                  <button
                    key={step.hourOffset}
                    type="button"
                    onClick={() =>
                      onUpdateParams((prev) => ({
                        ...prev,
                        mode: activePreset.mode,
                        stage: step.stage,
                        rainfallIntensityMmHr: step.mmHr,
                        timelineHourOffset: step.hourOffset,
                      }))
                    }
                    className="flex flex-col items-center justify-end h-full group cursor-pointer"
                  >
                    <span className="font-mono text-[9.5px] text-slate-300 tabular-nums mb-0.5">
                      {step.mmHr}m
                    </span>
                    <div
                      className={`w-full transition-all ${
                        isCurrent
                          ? 'bg-cyan-400 border border-white'
                          : step.mmHr >= 55
                          ? 'bg-rose-500/70 group-hover:bg-rose-400'
                          : step.mmHr >= 30
                          ? 'bg-amber-500/70 group-hover:bg-amber-400'
                          : 'bg-sky-500/60 group-hover:bg-sky-400'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span
                      className={`font-mono text-[9.5px] mt-1 truncate max-w-full ${
                        isCurrent
                          ? 'text-cyan-300 font-bold'
                          : 'text-slate-400'
                      }`}
                    >
                      {step.hourOffset >= 0
                        ? `T+${step.hourOffset}h`
                        : `T${step.hourOffset}h`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right 5 Cols: Evolving Event State (Predicted Risk, Observed Flood, Road Closures, Route Changes, Observations) */}
          <div className="lg:col-span-5 p-2.5 bg-[#070B12] border border-slate-800/90 space-y-2 font-mono text-xs">
            <div className="flex items-center justify-between text-[11px] border-b border-slate-800 pb-1">
              <span className="text-cyan-300 font-bold">
                EVOLVING EVENT SNAPSHOT ({currentStepEntry.label})
              </span>
              <span className="text-slate-400 text-[10px]">
                {sensors.filter((s) => s.freshnessState === 'FRESH').length}/
                {sensors.length} Sensors Fresh
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-center tabular-nums">
              <div className="p-1.5 bg-[#0C121E] border border-slate-800">
                <div className="text-[9.5px] text-slate-400">Predicted risk</div>
                <div className="text-sm font-bold text-amber-300">
                  {validationReport.truePositivesCount +
                    validationReport.falsePositivesCount}{' '}
                  zones
                </div>
              </div>

              <div className="p-1.5 bg-[#0C121E] border border-slate-800">
                <div className="text-[9.5px] text-slate-400">Observed flood</div>
                <div className="text-sm font-bold text-rose-400">
                  {validationReport.truePositivesCount +
                    validationReport.falseNegativesCount}{' '}
                  zones
                </div>
              </div>

              <div className="p-1.5 bg-[#0C121E] border border-slate-800">
                <div className="text-[9.5px] text-slate-400">Road closures</div>
                <div className="text-sm font-bold text-rose-300">
                  {closedRoads.length} closed ({atRiskRoads.length} risk)
                </div>
              </div>

              <div className="p-1.5 bg-[#0C121E] border border-slate-800">
                <div className="text-[9.5px] text-slate-400">Route changes</div>
                <div className="text-sm font-bold text-cyan-300">
                  {Math.max(
                    currentStepEntry.routeChangesCount,
                    divertedRoutes.length
                  )}{' '}
                  reroutes
                </div>
              </div>
            </div>

            <div className="text-[10.5px] text-slate-300 space-y-0.5 leading-snug">
              <div className="truncate">
                <span className="text-slate-500">Observations: </span>
                {currentStepEntry.observationsSummary}
              </div>
              <div className="truncate">
                <span className="text-slate-500">Road states: </span>
                {currentStepEntry.roadStatesSummary}
              </div>
              <div className="truncate text-cyan-200">
                <span className="text-slate-500">Route changes: </span>
                {currentStepEntry.routeChangeSummary}
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* =====================================================================
          2. METRICS BAR + VISUALLY PROMINENT FALSE NEGATIVES BANNER
          (Precision, Recall, F1, PR-AUC, IoU, Brier score, Lead-time error + False Negatives)
         ===================================================================== */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2 font-mono">
        {/* VISUALLY PROMINENT FALSE NEGATIVES CARD */}
        <div
          onClick={() => {
            setComparisonView('METRICS_VIEW');
            setOutcomeFilter(
              outcomeFilter === 'FALSE_NEGATIVE' ? 'ALL' : 'FALSE_NEGATIVE'
            );
          }}
          className="p-2.5 bg-rose-950/60 border-2 border-rose-500 cursor-pointer hover:bg-rose-950/80 transition-colors"
          title="Click to filter False Negatives (Missed Floods)"
        >
          <div className="flex items-center justify-between text-[10px] text-rose-200 font-bold">
            <span>⚠ FALSE NEGATIVES</span>
            <span className="px-1 bg-rose-500 text-white text-[9px]">
              CRITICAL
            </span>
          </div>
          <div className="text-2xl font-bold text-rose-300 tabular-nums mt-0.5">
            {validationReport.falseNegativesCount}
          </div>
          <div className="text-[10px] text-rose-200">
            Missed flood cells (Click)
          </div>
        </div>

        <div className="p-2.5 bg-[#0C121E] border border-slate-800">
          <div className="text-[10px] text-slate-400">PRECISION</div>
          <div className="text-xl font-bold text-emerald-300 tabular-nums mt-0.5">
            {(validationReport.precision * 100).toFixed(0)}%
          </div>
          <div className="text-[10px] text-slate-500">
            TP / (TP + FP) = {validationReport. precision.toFixed(2)}
          </div>
        </div>

        <div className="p-2.5 bg-[#0C121E] border border-slate-800">
          <div className="text-[10px] text-slate-400">RECALL (POD)</div>
          <div className="text-xl font-bold text-cyan-300 tabular-nums mt-0.5">
            {(validationReport.recall * 100).toFixed(0)}%
          </div>
          <div className="text-[10px] text-slate-500">
            TP / (TP + FN) = {validationReport.recall.toFixed(2)}
          </div>
        </div>

        <div className="p-2.5 bg-[#0C121E] border border-slate-800">
          <div className="text-[10px] text-slate-400">F1 SCORE</div>
          <div className="text-xl font-bold text-white tabular-nums mt-0.5">
            {validationReport.f1Score.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-500">Harmonic Mean</div>
        </div>

        <div className="p-2.5 bg-[#0C121E] border border-slate-800">
          <div className="text-[10px] text-slate-400">PR-AUC</div>
          <div className="text-xl font-bold text-sky-300 tabular-nums mt-0.5">
            {validationReport.prAuc.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-500">Precision-Recall AUC</div>
        </div>

        <div className="p-2.5 bg-[#0C121E] border border-slate-800">
          <div className="text-[10px] text-slate-400">IoU (CSI)</div>
          <div className="text-xl font-bold text-emerald-300 tabular-nums mt-0.5">
            {validationReport.iouScore.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-500">
            Intersection over Union
          </div>
        </div>

        <div className="p-2.5 bg-[#0C121E] border border-slate-800">
          <div className="text-[10px] text-slate-400">BRIER SCORE</div>
          <div className="text-xl font-bold text-amber-300 tabular-nums mt-0.5">
            {validationReport.brierScore.toFixed(3)}
          </div>
          <div className="text-[10px] text-slate-500">Lower is better</div>
        </div>

        <div className="p-2.5 bg-[#0C121E] border border-slate-800">
          <div className="text-[10px] text-slate-400">LEAD-TIME ERROR</div>
          <div className="text-xl font-bold text-purple-300 tabular-nums mt-0.5">
            ±{validationReport.leadTimeErrorMin}m
          </div>
          <div className="text-[10px] text-slate-500">
            Bias: {validationReport.leadTimeBiasMin > 0 ? '+' : ''}
            {validationReport.leadTimeBiasMin} min
          </div>
        </div>
      </div>

      {/* =====================================================================
          VISUALLY PROMINENT FALSE NEGATIVES CALLOUT STRIP
         ===================================================================== */}
      {validationReport.falseNegativeRecords.length > 0 ? (
        <div className="p-3 bg-rose-950/40 border-2 border-rose-500/80 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-rose-500 text-white font-bold text-[11px]">
                FALSE NEGATIVE AUDIT ({validationReport.falseNegativeRecords.length}{' '}
                ZONES MISSED)
              </span>
              <span className="text-rose-200 font-semibold">
                High-priority post-disaster learning targets: Observed flooding exceeded threshold where model predicted safe/moderate
              </span>
            </div>
            {activeModelVersionId !== 'v2.5.0-calibrated-candidate' && (
              <button
                type="button"
                onClick={() =>
                  onChangeModelVersionId('v2.5.0-calibrated-candidate')
                }
                className="px-2.5 py-1 bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-400 text-emerald-200 font-mono text-[11px] font-bold whitespace-nowrap"
              >
                ⚡ Apply v2.5.0 Calibrated Model to Resolve False Negatives
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 font-mono text-xs">
            {validationReport.falseNegativeRecords.map((fnRec) => (
              <div
                key={fnRec.cellId}
                onClick={() =>
                  onSelectMapTarget({ type: 'CELL', id: fnRec.cellId })
                }
                className="p-2.5 bg-[#090D16] border border-rose-500/70 hover:border-rose-300 cursor-pointer space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-sans font-bold text-white">
                    {fnRec.localityName}
                  </span>
                  <span className="px-1.5 py-0.5 bg-rose-500/30 text-rose-200 text-[10px] font-bold">
                    FALSE NEGATIVE
                  </span>
                </div>
                <div className="text-[11px] text-slate-200 tabular-nums">
                  Pred: <strong>{fnRec.predictedDepthCm}cm</strong> (
                  {Math.round(fnRec.predictedProbability * 100)}%) vs Obs HWM:{' '}
                  <strong className="text-rose-300">
                    {fnRec.observedDepthCm}cm
                  </strong>{' '}
                  (Error {fnRec.errorCm}cm)
                </div>
                <div className="text-[10.5px] text-rose-200/90 leading-snug">
                  Root cause: {fnRec.rootCauseDriver}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-2.5 bg-emerald-950/30 border border-emerald-500/60 font-mono text-xs text-emerald-200 flex items-center justify-between">
          <span>
            ✓ ZERO FALSE NEGATIVES under{' '}
            <strong>{validationReport.modelVersion.version}</strong> — All
            flooded pockets captured within operational lead-time threshold.
          </span>
          <button
            type="button"
            onClick={() => onChangeModelVersionId('v2.4.2-indore-pilot')}
            className="px-2 py-0.5 bg-slate-900 border border-slate-700 text-slate-300 text-[11px]"
          >
            Compare vs v2.4.2 Baseline
          </button>
        </div>
      )}

      {/* =====================================================================
          3. PREDICTED VS OBSERVED COMPARISON (Map View · Timeline View · Metrics View)
             + CALIBRATION VISUALIZATION
         ===================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left 7 Cols: PREDICTED VS OBSERVED (Map view / Timeline view / Metrics view) */}
        <div className="xl:col-span-7 p-3 bg-[#0C121E] border border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <div className="font-mono text-xs font-bold text-cyan-300">
                PREDICTED VS OBSERVED COMPARISON
              </div>
              <div className="font-mono text-[10.5px] text-slate-400">
                TP: {validationReport.truePositivesCount} ·{' '}
                <strong className="text-rose-400">
                  FN: {validationReport.falseNegativesCount}
                </strong>{' '}
                · FP: {validationReport.falsePositivesCount} · TN:{' '}
                {validationReport.trueNegativesCount}
              </div>
            </div>

            <div className="flex items-center gap-1 font-mono text-xs">
              {(
                [
                  { id: 'MAP_VIEW', label: 'Map view' },
                  { id: 'TIMELINE_VIEW', label: 'Timeline view' },
                  { id: 'METRICS_VIEW', label: 'Metrics view' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setComparisonView(tab.id)}
                  className={`px-2.5 py-1 border text-[11px] font-bold transition-colors ${
                    comparisonView === tab.id
                      ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                      : 'bg-[#070B12] border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* VIEW A: MAP VIEW (8x8 Spatial Predicted vs Observed Matrix) */}
          {comparisonView === 'MAP_VIEW' && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                <span className="text-slate-300">
                  8×8 Spatial Predicted vs Observed Grid (Click any cell to inspect on main map):
                </span>
                <div className="flex items-center gap-2 text-[10.5px]">
                  <span className="px-1.5 py-0.5 bg-rose-500/40 border border-rose-400 text-rose-200 font-bold">
                    ■ FALSE NEGATIVE ({validationReport.falseNegativesCount})
                  </span>
                  <span className="px-1.5 py-0.5 bg-emerald-500/30 border border-emerald-400 text-emerald-200">
                    ■ TRUE POSITIVE ({validationReport.truePositivesCount})
                  </span>
                  <span className="px-1.5 py-0.5 bg-amber-500/30 border border-amber-400 text-amber-200">
                    ■ FALSE POSITIVE ({validationReport.falsePositivesCount})
                  </span>
                  <span className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 text-slate-400">
                    ■ TRUE NEGATIVE ({validationReport.trueNegativesCount})
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-8 gap-1 p-2 bg-[#070B12] border border-slate-800 font-mono text-[10px]">
                {cells.map((cell) => {
                  const rec = validationReport.records.find(
                    (r) => r.cellId === cell.id
                  );
                  const outcome = rec?.outcomeCategory ?? 'TRUE_NEGATIVE';
                  const cellClass =
                    outcome === 'FALSE_NEGATIVE'
                      ? 'bg-rose-600/45 border-2 border-rose-400 text-white font-bold'
                      : outcome === 'TRUE_POSITIVE'
                      ? 'bg-emerald-600/30 border border-emerald-500/70 text-emerald-200'
                      : outcome === 'FALSE_POSITIVE'
                      ? 'bg-amber-500/25 border border-amber-400/70 text-amber-200'
                      : 'bg-[#0B101B] border border-slate-800/80 text-slate-500';

                  return (
                    <button
                      key={cell.id}
                      type="button"
                      onClick={() =>
                        onSelectMapTarget({ type: 'CELL', id: cell.id })
                      }
                      className={`p-1.5 text-left transition-transform hover:scale-105 cursor-pointer ${cellClass}`}
                      title={`${cell.localityName} (${cell.wardCode}) · ${outcome} · Pred ${rec?.predictedDepthCm}cm vs Obs ${rec?.observedDepthCm}cm`}
                    >
                      <div className="flex items-center justify-between">
                        <span>{cell.wardCode}</span>
                        <span>
                          {outcome === 'FALSE_NEGATIVE'
                            ? '⚠FN'
                            : outcome === 'TRUE_POSITIVE'
                            ? 'TP'
                            : outcome === 'FALSE_POSITIVE'
                            ? 'FP'
                            : 'TN'}
                        </span>
                      </div>
                      <div className="truncate text-[9px] opacity-90">
                        P:{rec?.predictedDepthCm} O:{rec?.observedDepthCm}cm
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* VIEW B: TIMELINE VIEW (Predicted vs Observed across Hourly Steps) */}
          {comparisonView === 'TIMELINE_VIEW' && (
            <div className="overflow-x-auto border border-slate-800">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead>
                  <tr className="bg-[#070B12] text-slate-400 border-b border-slate-800">
                    <th className="py-1.5 px-2.5">Timeline Step</th>
                    <th className="py-1.5 px-2.5 text-right">Rainfall</th>
                    <th className="py-1.5 px-2.5 text-right">Predicted Risk</th>
                    <th className="py-1.5 px-2.5 text-right">Observed Flood</th>
                    <th className="py-1.5 px-2.5 text-right">⚠ False Neg</th>
                    <th className="py-1.5 px-2.5 text-right">Road Closures</th>
                    <th className="py-1.5 px-2.5 text-right">Route Changes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {validationReport.hourlyComparisonTimeline.map((step) => {
                    const isCurrent =
                      params.timelineHourOffset === step.hourOffset;
                    return (
                      <tr
                        key={step.hourOffset}
                        onClick={() =>
                          onUpdateParams((prev) => ({
                            ...prev,
                            timelineHourOffset: step.hourOffset,
                            rainfallIntensityMmHr: step.mmHr,
                          }))
                        }
                        className={`cursor-pointer hover:bg-slate-900/80 ${
                          isCurrent ? 'bg-cyan-950/30' : ''
                        }`}
                      >
                        <td className="py-1.5 px-2.5 text-slate-200 font-semibold">
                          {isCurrent ? '▶ ' : ''}
                          {step.label}
                        </td>
                        <td className="py-1.5 px-2.5 text-right text-sky-300 tabular-nums">
                          {step.mmHr} mm/h
                        </td>
                        <td className="py-1.5 px-2.5 text-right text-amber-300 tabular-nums">
                          {step.predictedRiskZones} zones
                        </td>
                        <td className="py-1.5 px-2.5 text-right text-rose-300 font-semibold tabular-nums">
                          {step.observedFloodZones} zones
                        </td>
                        <td className="py-1.5 px-2.5 text-right tabular-nums">
                          {step.falseNegativesAtStep > 0 ? (
                            <span className="px-1.5 py-0.5 bg-rose-500/30 border border-rose-500 text-rose-200 font-bold">
                              {step.falseNegativesAtStep} FN
                            </span>
                          ) : (
                            <span className="text-emerald-400">0</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2.5 text-right text-slate-200 tabular-nums">
                          {step.roadClosuresCount} closed
                        </td>
                        <td className="py-1.5 px-2.5 text-right text-cyan-300 tabular-nums">
                          {step.routeChangesCount} reroutes
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* VIEW C: METRICS VIEW (Detailed Cell-by-Cell Predicted vs Observed Table) */}
          {comparisonView === 'METRICS_VIEW' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                <span className="text-slate-400">Filter Outcome:</span>
                {(
                  [
                    { id: 'ALL', label: `All (${validationReport.records.length})` },
                    {
                      id: 'FALSE_NEGATIVE',
                      label: `⚠ False Negatives (${validationReport.falseNegativesCount})`,
                    },
                    {
                      id: 'TRUE_POSITIVE',
                      label: `True Positives (${validationReport.truePositivesCount})`,
                    },
                    {
                      id: 'FALSE_POSITIVE',
                      label: `False Positives (${validationReport.falsePositivesCount})`,
                    },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setOutcomeFilter(f.id)}
                    className={`px-2 py-0.5 border ${
                      outcomeFilter === f.id
                        ? f.id === 'FALSE_NEGATIVE'
                          ? 'bg-rose-500 text-white border-rose-400 font-bold'
                          : 'bg-cyan-500/25 border-cyan-400 text-cyan-200 font-bold'
                        : 'bg-[#070B12] border-slate-800 text-slate-400'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto border border-slate-800 max-h-52 overflow-y-auto">
                <table className="w-full text-left border-collapse font-mono text-xs">
                  <thead>
                    <tr className="bg-[#070B12] text-slate-400 border-b border-slate-800 sticky top-0">
                      <th className="py-1.5 px-2.5">Cell Locality</th>
                      <th className="py-1.5 px-2.5">Outcome</th>
                      <th className="py-1.5 px-2.5 text-right">Pred Prob</th>
                      <th className="py-1.5 px-2.5 text-right">Pred / Obs HWM</th>
                      <th className="py-1.5 px-2.5 text-right">Lead Err</th>
                      <th className="py-1.5 px-2.5">Diagnosis</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {filteredRecords.slice(0, 16).map((rec) => (
                      <tr
                        key={rec.cellId}
                        onClick={() =>
                          onSelectMapTarget({ type: 'CELL', id: rec.cellId })
                        }
                        className={`hover:bg-slate-900/80 cursor-pointer ${
                          rec.outcomeCategory === 'FALSE_NEGATIVE'
                            ? 'bg-rose-950/35'
                            : ''
                        }`}
                      >
                        <td className="py-1.5 px-2.5 text-slate-200 font-sans font-medium">
                          {rec.localityName}
                        </td>
                        <td className="py-1.5 px-2.5">
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-bold ${
                              rec.outcomeCategory === 'FALSE_NEGATIVE'
                                ? 'bg-rose-500 text-white'
                                : rec.outcomeCategory === 'TRUE_POSITIVE'
                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/50'
                                : rec.outcomeCategory === 'FALSE_POSITIVE'
                                ? 'bg-amber-950/80 text-amber-300 border border-amber-500/50'
                                : 'bg-slate-900 text-slate-400'
                            }`}
                          >
                            {rec.outcomeCategory}
                          </span>
                        </td>
                        <td className="py-1.5 px-2.5 text-right tabular-nums text-cyan-300">
                          {Math.round(rec.predictedProbability * 100)}%
                        </td>
                        <td className="py-1.5 px-2.5 text-right tabular-nums text-white">
                          {rec.predictedDepthCm}cm /{' '}
                          <strong className="text-sky-300">
                            {rec.observedDepthCm}cm
                          </strong>
                        </td>
                        <td className="py-1.5 px-2.5 text-right tabular-nums text-purple-300">
                          {rec.leadTimeErrorMin > 0
                            ? `+${rec.leadTimeErrorMin}m`
                            : `${rec.leadTimeErrorMin}m`}
                        </td>
                        <td className="py-1.5 px-2.5 text-slate-300 truncate max-w-[200px]">
                          {rec.learningNote}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right 5 Cols: CALIBRATION VISUALIZATION (Predicted Probability vs Observed Frequency) */}
        <div className="xl:col-span-5 p-3 bg-[#0C121E] border border-slate-800 space-y-2.5 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="border-b border-slate-800 pb-2">
              <div className="font-mono text-xs font-bold text-cyan-300">
                CALIBRATION: PREDICTED PROBABILITY VS OBSERVED FREQUENCY
              </div>
              <div className="text-xs font-semibold text-amber-200 mt-0.5">
                “Are 70% predictions actually flooding approximately 70% of the time?”
              </div>
            </div>

            {/* Calibration Binned Reliability Chart */}
            <div className="p-2.5 bg-[#070B12] border border-slate-800 space-y-2 font-mono text-[11px]">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>PROBABILITY COHORT BIN</span>
                <div className="flex items-center gap-3">
                  <span className="text-cyan-300">■ Predicted Prob</span>
                  <span className="text-emerald-400">■ Observed Freq</span>
                </div>
              </div>

              {validationReport.calibrationBins.map((bin) => {
                const is70Bin = bin.midpointProbPct === 70;
                return (
                  <div
                    key={bin.binLabel}
                    className={`p-1.5 border ${
                      is70Bin
                        ? 'bg-amber-950/25 border-amber-400/70'
                        : 'bg-[#0B101B] border-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10.5px] mb-1">
                      <span
                        className={
                          is70Bin ? 'text-amber-300 font-bold' : 'text-slate-300'
                        }
                      >
                        {is70Bin ? '★ ' : ''}
                        {bin.binLabel} ({bin.cellCount} cells)
                      </span>
                      <span className="tabular-nums text-slate-200">
                        Pred <strong>{bin.meanPredictedPct}%</strong> vs Obs{' '}
                        <strong className="text-emerald-300">
                          {bin.observedFrequencyPct}%
                        </strong>{' '}
                        (Gap {bin.calibrationGapPct >= 0 ? '+' : ''}
                        {bin.calibrationGapPct}%)
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="w-full h-1.5 bg-slate-900 overflow-hidden">
                        <div
                          className="h-full bg-cyan-400"
                          style={{ width: `${bin.meanPredictedPct}%` }}
                        />
                      </div>
                      <div className="w-full h-1.5 bg-slate-900 overflow-hidden">
                        <div
                          className="h-full bg-emerald-400"
                          style={{ width: `${bin.observedFrequencyPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Explicit 70% Calibration Explanation */}
          <div className="p-2.5 bg-cyan-950/30 border border-cyan-500/50 text-[11px] text-slate-200 leading-relaxed">
            <span className="font-mono font-bold text-cyan-300 mr-1.5">
              70% CALIBRATION AUDIT:
            </span>
            {validationReport.seventyPercentBinExplanation}
          </div>
        </div>
      </div>

      {/* =====================================================================
          4. LEARNING LOOP PIPELINE & MODEL VERSION PANEL
          (Event → Ground truth → Validation → Error analysis → Threshold/model improvement)
         ===================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left 7 Cols: 5-Stage Learning Loop */}
        <div className="xl:col-span-7 p-3 bg-[#0C121E] border border-slate-800 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2 font-mono text-xs">
            <span className="text-cyan-300 font-bold">
              CONTINUOUS POST-DISASTER LEARNING LOOP
            </span>
            <span className="text-amber-300 text-[11px]">
              Event → Ground truth → Validation → Error analysis → Threshold/model improvement
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            {validationReport.learningLoopSteps.map((step, idx) => (
              <div
                key={step.stepNumber}
                className="p-2.5 bg-[#070B12] border border-slate-800 flex flex-col justify-between space-y-2"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span className="px-1.5 py-0.5 bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 font-bold">
                      {step.stage}
                    </span>
                    {idx < 4 && (
                      <span className="text-slate-500 font-bold">→</span>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-white">
                    {step.title}
                  </div>
                  <p className="text-[10.5px] text-slate-400 leading-snug">
                    {step.summary}
                  </p>
                </div>
                <div className="pt-1.5 border-t border-slate-800/80 font-mono text-[10px] text-emerald-300">
                  {step.keyArtifact}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right 5 Cols: MODEL VERSION PANEL (Current model, Version, Training snapshot, Validation score, Release date) */}
        <div className="xl:col-span-5 p-3 bg-[#0C121E] border border-emerald-500/50 space-y-2.5 flex flex-col justify-between font-mono">
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div>
                <div className="text-xs font-bold text-emerald-300">
                  MODEL VERSION GOVERNANCE PANEL
                </div>
                <div className="text-[10.5px] text-slate-400">
                  Compare pre-event baseline vs post-disaster calibrated model
                </div>
              </div>
              <span className="px-2 py-0.5 bg-emerald-500/20 border border-emerald-400 text-emerald-200 text-[10.5px] font-bold">
                {validationReport.modelVersion.statusLabel}
              </span>
            </div>

            {/* Model Version Switcher Buttons */}
            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              {Object.values(MODEL_VERSIONS).map((mv) => {
                const active = activeModelVersionId === mv.id;
                return (
                  <button
                    key={mv.id}
                    type="button"
                    onClick={() => onChangeModelVersionId(mv.id)}
                    className={`p-1.5 border text-left transition-colors ${
                      active
                        ? 'bg-emerald-950/60 border-emerald-400 text-emerald-200 font-bold'
                        : 'bg-[#070B12] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="truncate">{mv.version}</div>
                    <div className="text-[9.5px] text-slate-400 truncate">
                      Thresh {(mv.decisionThresholdProb * 100).toFixed(0)}%
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Required Model Version Fields */}
            <div className="p-2.5 bg-[#070B12] border border-slate-800 space-y-1.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <span className="text-slate-400 shrink-0">Current model:</span>
                <span className="text-white font-semibold text-right">
                  {validationReport.modelVersion.currentModel}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Version:</span>
                <span className="text-cyan-300 font-bold">
                  {validationReport.modelVersion.version}
                </span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="text-slate-400 shrink-0">
                  Training snapshot:
                </span>
                <span className="text-slate-200 text-right text-[11px]">
                  {validationReport.modelVersion.trainingSnapshot}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Validation score:</span>
                <span className="text-emerald-300 font-bold">
                  {validationReport.modelVersion.validationScore}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Release date:</span>
                <span className="text-amber-300 font-semibold">
                  {validationReport.modelVersion.releaseDate}
                </span>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-emerald-300 font-sans font-semibold pt-1 border-t border-slate-800">
            iDhara does not stop after predicting a flood. It learns from what
            actually happened.
          </div>
        </div>
      </div>
    </div>
  );
};
