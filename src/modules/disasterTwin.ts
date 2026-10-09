import { CRITICAL_ASSETS } from '../data/indorePilotData';
import {
  CriticalAsset,
  DataProvenance,
  DisasterStage,
  EvacuationPlanItem,
  FloodRiskCell,
  FloodSeverity,
  InjectedObservationState,
  OperationalStep,
  ProductMode,
  RoadSegmentState,
  RoadStatus,
  RouteRecommendation,
  ScenarioParameters,
  SensorNode,
  Shelter,
} from '../types/idhara';
import { createProvenance, ingestSensorTelemetry } from './dataIngestion';
import { evaluateSheltersAndEvacuation } from './evacuation';
import { predictFloodRiskGrid } from './prediction';
import { evaluateRoadNetworkState } from './roadState';
import { computeRouteRecommendations } from './routing';

export interface TwinStageDescriptor {
  stage: DisasterStage;
  number: number;
  title: string;
  windowLabel: string;
  objective: string;
  primarySteps: OperationalStep[];
  activeReadinessChecklist: Array<{
    id: string;
    label: string;
    owner: string;
    status: 'COMPLETE' | 'ACTIVE' | 'PENDING';
  }>;
}

export type TwinPresetId =
  | 'CURRENT'
  | 'PLUS_10'
  | 'PLUS_20'
  | 'PLUS_30'
  | 'EXTREME'
  | 'CUSTOM';

export type TwinDurationMinutes = 30 | 60 | 90 | 120;

export interface TwinScenarioConfig {
  presetId: TwinPresetId;
  label: string;
  durationMinutes: TwinDurationMinutes;
  customRainfallMmHr?: number;
  drainageBlockageDeltaPct?: number;
}

export interface IsolatedTwinSnapshot extends DataProvenance {
  scenarioId: string;
  presetId: TwinPresetId;
  presetLabel: string;
  durationMinutes: TwinDurationMinutes;
  baselineRainfallMmHr: number;
  scenarioRainfallMmHr: number;
  rainfallDeltaMmHr: number;
  rainfallDeltaPct: number;
  cells: FloodRiskCell[];
  roads: RoadSegmentState[];
  shelters: Shelter[];
  evacuationPlans: EvacuationPlanItem[];
  routes: RouteRecommendation[];
  metrics: {
    highAndCriticalCellsCount: number;
    criticalCellsCount: number;
    affectedAreaKm2: number; // Each cell is 0.625km x 0.625km = 0.390625 km²
    atRiskRoadsCount: number;
    closedRoadsCount: number;
    exposedAssets: CriticalAsset[];
    exposedAssetsCount: number;
    estimatedAffectedPopProxy: number;
    shelterDemandBerths: number;
    sheltersNearCapacityCount: number;
    meanFloodProbabilityPct: number;
    recommendedPreparedness: string;
  };
}

export const TWIN_PRESET_OPTIONS: Array<{
  id: TwinPresetId;
  label: string;
  shortTag: string;
  multiplier: number;
  fixedRainMmHr?: number;
  blockageBonusPct: number;
}> = [
  { id: 'CURRENT', label: 'Current forecast', shortTag: 'Baseline', multiplier: 1.0, blockageBonusPct: 0 },
  { id: 'PLUS_10', label: '+10% Rainfall', shortTag: '+10%', multiplier: 1.1, blockageBonusPct: 2 },
  { id: 'PLUS_20', label: '+20% Rainfall', shortTag: '+20%', multiplier: 1.2, blockageBonusPct: 5 },
  { id: 'PLUS_30', label: '+30% Rainfall', shortTag: '+30%', multiplier: 1.3, blockageBonusPct: 8 },
  { id: 'EXTREME', label: 'Extreme scenario', shortTag: 'Extreme', multiplier: 1.75, fixedRainMmHr: 88, blockageBonusPct: 18 },
  { id: 'CUSTOM', label: 'Custom rainfall', shortTag: 'Custom', multiplier: 1.4, blockageBonusPct: 10 },
];

export const OPERATIONAL_CHAIN: Array<{
  step: OperationalStep;
  label: string;
  shortDesc: string;
}> = [
  { step: 'PREDICT', label: '1. PREDICT', shortDesc: '64-cell hydrological risk grid & probability' },
  { step: 'EXPLAIN', label: '2. EXPLAIN', shortDesc: 'Why this warning? Top physical drivers & trigger rules' },
  { step: 'WARN', label: '3. WARN', shortDesc: 'Ward & asset targeted operational alerts & barricades' },
  { step: 'SIMULATE', label: '4. SIMULATE', shortDesc: 'Disaster Twin what-if storm & culvert choke stress' },
  { step: 'VERIFY', label: '5. VERIFY', shortDesc: 'Sensor health, ultrasonic telemetry & field inspection' },
  { step: 'REROUTE', label: '6. REROUTE', shortDesc: 'Dynamic flood-aware emergency corridors' },
  { step: 'EVACUATE', label: '7. EVACUATE', shortDesc: 'High-ground shelter dispatch & capacity allocation' },
  { step: 'LEARN', label: '8. LEARN', shortDesc: 'Post-disaster HWM validation & model calibration' },
];

/**
 * Evaluates a completely isolated "What-If" scenario snapshot without mutating the LIVE / Current state.
 * Stamps every entity with `mode: ProductMode.SIMULATED` and `scope_id: SIMULATED / scenario-ID`.
 * Respects active official road overrides and baseline road closures so the simulation builds
 * consistently upon the authoritative prototype state.
 */
export function evaluateIsolatedTwinScenario(
  baseParams: ScenarioParameters,
  config: TwinScenarioConfig,
  injectedObservations?: InjectedObservationState,
  baselineRoads?: RoadSegmentState[]
): IsolatedTwinSnapshot {
  const presetMeta =
    TWIN_PRESET_OPTIONS.find((p) => p.id === config.presetId) ??
    TWIN_PRESET_OPTIONS[2];

  const baselineRain = baseParams.rainfallIntensityMmHr;
  let rawScenarioRain = baselineRain;

  if (config.presetId === 'CUSTOM' && config.customRainfallMmHr !== undefined) {
    rawScenarioRain = config.customRainfallMmHr;
  } else if (config.presetId === 'EXTREME') {
    rawScenarioRain = Math.max(88, Math.round(baselineRain * presetMeta.multiplier));
  } else {
    rawScenarioRain = Math.round(baselineRain * presetMeta.multiplier);
  }

  // Duration multiplier (30m = 0.86x accumulation, 60m = 1.0x, 90m = 1.14x, 120m = 1.26x)
  const durationScaling =
    config.durationMinutes === 30
      ? 0.88
      : config.durationMinutes === 60
      ? 1.0
      : config.durationMinutes === 90
      ? 1.14
      : 1.26;

  const effectiveRainForModel =
    config.presetId === 'CURRENT' && config.durationMinutes === 60
      ? baselineRain
      : Math.min(115, Number((rawScenarioRain * durationScaling).toFixed(1)));

  const scenarioBlockage = Math.min(
    80,
    baseParams.drainageBlockagePct +
      presetMeta.blockageBonusPct +
      (config.drainageBlockageDeltaPct ?? 0)
  );

  const scenarioId = `SCEN-${config.presetId}-${config.durationMinutes}M`;
  const isolatedScopeId = `SIMULATED / ${scenarioId}`;

  const isolatedParams: ScenarioParameters = {
    ...baseParams,
    mode: ProductMode.SIMULATED,
    stage: baseParams.stage,
    rainfallIntensityMmHr: effectiveRainForModel,
    durationHours: Number((config.durationMinutes / 60).toFixed(2)),
    drainageBlockagePct: scenarioBlockage,
    upstreamKahnInflowMultiplier:
      config.presetId === 'CURRENT'
        ? baseParams.upstreamKahnInflowMultiplier
        : Number(
            Math.min(
              1.95,
              baseParams.upstreamKahnInflowMultiplier *
                (1 + (effectiveRainForModel - baselineRain) / 140)
            ).toFixed(2)
          ),
  };

  const rawSensors: SensorNode[] = ingestSensorTelemetry(isolatedParams, injectedObservations);
  const rawCells = predictFloodRiskGrid(isolatedParams, rawSensors, undefined, 3, injectedObservations);
  let rawRoads = evaluateRoadNetworkState(rawCells, rawSensors, isolatedParams, injectedObservations);

  // Inherit existing closed roads from baseline so RD-05 remains CLOSED in simulated scenarios
  if (baselineRoads && baselineRoads.length > 0) {
    const closedInBaseline = new Set(
      baselineRoads
        .filter((r) => r.currentState === RoadStatus.CLOSED)
        .map((r) => r.id)
    );
    rawRoads = rawRoads.map((r) => {
      if (closedInBaseline.has(r.id) && r.currentState !== RoadStatus.CLOSED) {
        return {
          ...r,
          currentState: RoadStatus.CLOSED,
          rawState: RoadStatus.CLOSED,
          transitionReason: 'Inherited official baseline road closure into scenario simulation.',
        };
      }
      return r;
    });
  }

  const { shelters: rawShelters, evacuationPlans: rawEvac } =
    evaluateSheltersAndEvacuation(rawCells, isolatedParams, rawRoads);
  const rawRoutes = computeRouteRecommendations(rawRoads, isolatedParams);

  // Stamp isolated scope_id onto every scenario object so it never leaks into LIVE/Current scope
  const cells = rawCells.map((c) => ({
    ...c,
    mode: ProductMode.SIMULATED,
    scope_id: isolatedScopeId,
  }));
  const roads = rawRoads.map((r) => ({
    ...r,
    mode: ProductMode.SIMULATED,
    scope_id: isolatedScopeId,
  }));
  const shelters = rawShelters.map((s) => ({
    ...s,
    mode: ProductMode.SIMULATED,
    scope_id: isolatedScopeId,
  }));
  const evacuationPlans = rawEvac.map((e) => ({
    ...e,
    mode: ProductMode.SIMULATED,
    scope_id: isolatedScopeId,
  }));
  const routes = rawRoutes.map((rt) => ({
    ...rt,
    mode: ProductMode.SIMULATED,
    scope_id: isolatedScopeId,
  }));

  const highAndCritCells = cells.filter(
    (c) =>
      c.severity === FloodSeverity.CRITICAL || c.severity === FloodSeverity.HIGH
  );
  const critCells = cells.filter((c) => c.severity === FloodSeverity.CRITICAL);

  // Each cell in 8x8 grid over 5km x 5km (25 km²) is 0.390625 km²
  const affectedAreaKm2 = Number((highAndCritCells.length * 0.390625).toFixed(2));

  const atRiskRoads = roads.filter(
    (r) =>
      r.currentState === RoadStatus.CLOSED ||
      r.currentState === RoadStatus.LIKELY_FLOODED ||
      r.currentState === RoadStatus.AT_RISK
  );
  const closedRoads = roads.filter(
    (r) => r.currentState === RoadStatus.CLOSED
  );

  const cellMap = new Map(cells.map((c) => [c.id, c]));
  const exposedAssets = CRITICAL_ASSETS.filter((asset) => {
    const hostCell = cellMap.get(asset.cellId);
    return (
      hostCell &&
      (hostCell.severity === FloodSeverity.CRITICAL ||
        hostCell.severity === FloodSeverity.HIGH ||
        hostCell.floodProbability >= 0.42)
    );
  });

  const estimatedAffectedPopProxy = highAndCritCells.reduce((sum, c) => {
    const factor =
      c.severity === FloodSeverity.CRITICAL ? 0.085 : 0.04;
    return sum + Math.round(c.populationEstimate * factor);
  }, 0);

  const shelterDemandBerths = shelters.reduce(
    (sum, s) => sum + s.currentOccupancy,
    0
  );
  const sheltersNearCapacityCount = shelters.filter(
    (s) => s.currentOccupancy / s.totalCapacity >= 0.75
  ).length;

  const meanFloodProbabilityPct = Math.round(
    (cells.reduce((acc, c) => acc + c.floodProbability, 0) / Math.max(1, cells.length)) * 100
  );

  let recommendedPreparedness =
    'Level 1 Routine Watch — Monitor low-lying gauges under current assumption';
  if (critCells.length >= 10 || closedRoads.length >= 6) {
    recommendedPreparedness =
      'Level 4 Full Emergency Mobilization — Pre-barricade bridges, stage SDRF boats & open all 4 relief shelters';
  } else if (critCells.length >= 5 || closedRoads.length >= 3) {
    recommendedPreparedness =
      'Level 3 High Preparedness — Activate hospital rerouting, deploy mobile pumps & stage evacuation buses';
  } else if (highAndCritCells.length >= 6) {
    recommendedPreparedness =
      'Level 2 Elevated Readiness — Clear culvert trash screens & alert ward nodal officers';
  }

  const avgConf = Number(
    (
      cells.reduce((acc, c) => acc + c.confidence, 0) / Math.max(1, cells.length)
    ).toFixed(2)
  );
  const prov = createProvenance(
    ProductMode.SIMULATED,
    avgConf,
    baseParams.timelineHourOffset
  );

  const rainfallDeltaMmHr = Number((rawScenarioRain - baselineRain).toFixed(1));
  const rainfallDeltaPct =
    baselineRain > 0
      ? Math.round(((rawScenarioRain - baselineRain) / baselineRain) * 100)
      : 0;

  return {
    ...prov,
    scope_id: isolatedScopeId,
    scenarioId,
    presetId: config.presetId,
    presetLabel: config.label,
    durationMinutes: config.durationMinutes,
    baselineRainfallMmHr: baselineRain,
    scenarioRainfallMmHr: rawScenarioRain,
    rainfallDeltaMmHr,
    rainfallDeltaPct,
    cells,
    roads,
    shelters,
    evacuationPlans,
    routes,
    metrics: {
      highAndCriticalCellsCount: highAndCritCells.length,
      criticalCellsCount: critCells.length,
      affectedAreaKm2,
      atRiskRoadsCount: atRiskRoads.length,
      closedRoadsCount: closedRoads.length,
      exposedAssets,
      exposedAssetsCount: exposedAssets.length,
      estimatedAffectedPopProxy,
      shelterDemandBerths,
      sheltersNearCapacityCount,
      meanFloodProbabilityPct,
      recommendedPreparedness,
    },
  };
}

/**
 * Builds the authoritative Current State (Baseline) snapshot directly using the shared
 * road, sensor, shelter, rainfall, and risk-cell objects.
 * Guarantees zero divergence between Risk Map, Roads & Routing, Evacuation, Alerts, Validation,
 * and Disaster Twin baseline.
 */
export function buildCurrentTwinSnapshot(
  params: ScenarioParameters,
  cells: FloodRiskCell[],
  roads: RoadSegmentState[],
  shelters: Shelter[],
  evacuationPlans: EvacuationPlanItem[],
  routes: RouteRecommendation[]
): IsolatedTwinSnapshot {
  const highAndCritCells = cells.filter(
    (c) =>
      c.severity === FloodSeverity.CRITICAL || c.severity === FloodSeverity.HIGH
  );
  const critCells = cells.filter((c) => c.severity === FloodSeverity.CRITICAL);
  const affectedAreaKm2 = Number((highAndCritCells.length * 0.390625).toFixed(2));

  const atRiskRoads = roads.filter(
    (r) =>
      r.currentState === RoadStatus.CLOSED ||
      r.currentState === RoadStatus.LIKELY_FLOODED ||
      r.currentState === RoadStatus.AT_RISK
  );
  const closedRoads = roads.filter(
    (r) => r.currentState === RoadStatus.CLOSED
  );

  const cellMap = new Map(cells.map((c) => [c.id, c]));
  const exposedAssets = CRITICAL_ASSETS.filter((asset) => {
    const hostCell = cellMap.get(asset.cellId);
    return (
      hostCell &&
      (hostCell.severity === FloodSeverity.CRITICAL ||
        hostCell.severity === FloodSeverity.HIGH ||
        hostCell.floodProbability >= 0.42)
    );
  });

  const estimatedAffectedPopProxy = highAndCritCells.reduce((sum, c) => {
    const factor = c.severity === FloodSeverity.CRITICAL ? 0.085 : 0.04;
    return sum + Math.round(c.populationEstimate * factor);
  }, 0);

  const shelterDemandBerths = shelters.reduce(
    (sum, s) => sum + s.currentOccupancy,
    0
  );
  const sheltersNearCapacityCount = shelters.filter(
    (s) => s.currentOccupancy / Math.max(1, s.totalCapacity) >= 0.75
  ).length;

  const meanFloodProbabilityPct = Math.round(
    (cells.reduce((acc, c) => acc + c.floodProbability, 0) / Math.max(1, cells.length)) * 100
  );

  let recommendedPreparedness =
    'Level 1 Routine Watch — Monitor low-lying gauges under current assumption';
  if (critCells.length >= 10 || closedRoads.length >= 6) {
    recommendedPreparedness =
      'Level 4 Full Emergency Mobilization — Pre-barricade bridges, stage SDRF boats & open all 4 relief shelters';
  } else if (critCells.length >= 5 || closedRoads.length >= 3) {
    recommendedPreparedness =
      'Level 3 High Preparedness — Activate hospital rerouting, deploy mobile pumps & stage evacuation buses';
  } else if (highAndCritCells.length >= 6) {
    recommendedPreparedness =
      'Level 2 Elevated Readiness — Clear culvert trash screens & alert ward nodal officers';
  }

  const avgConf = Number(
    (
      cells.reduce((acc, c) => acc + c.confidence, 0) / Math.max(1, cells.length)
    ).toFixed(2)
  );
  const prov = createProvenance(
    ProductMode.SIMULATED,
    avgConf,
    params.timelineHourOffset
  );

  return {
    ...prov,
    scope_id: 'CURRENT / BASELINE',
    scenarioId: 'SCEN-CURRENT-60M',
    presetId: 'CURRENT',
    presetLabel: 'Current State (Baseline)',
    durationMinutes: 60,
    baselineRainfallMmHr: params.rainfallIntensityMmHr,
    scenarioRainfallMmHr: params.rainfallIntensityMmHr,
    rainfallDeltaMmHr: 0,
    rainfallDeltaPct: 0,
    cells,
    roads,
    shelters,
    evacuationPlans,
    routes,
    metrics: {
      highAndCriticalCellsCount: highAndCritCells.length,
      criticalCellsCount: critCells.length,
      affectedAreaKm2,
      atRiskRoadsCount: atRiskRoads.length,
      closedRoadsCount: closedRoads.length,
      exposedAssets,
      exposedAssetsCount: exposedAssets.length,
      estimatedAffectedPopProxy,
      shelterDemandBerths,
      sheltersNearCapacityCount,
      meanFloodProbabilityPct,
      recommendedPreparedness,
    },
  };
}

export function getDisasterTwinStages(
  cells: FloodRiskCell[],
  roads: RoadSegmentState[],
  params: ScenarioParameters
): TwinStageDescriptor[] {
  const critCount = cells.filter((c) => c.severity === FloodSeverity.CRITICAL).length;
  const closedCount = roads.filter(
    (r) => r.currentState === RoadStatus.CLOSED
  ).length;

  return [
    {
      stage: DisasterStage.EARLY_WARNING,
      number: 1,
      title: '1. EARLY WARNING',
      windowLabel: 'T-6h to T-1h · Pre-Monsoon / Watch',
      objective:
        'Ingest rainfall forecast & upstream Kahn inflow; identify low-elevation depressions before surface accumulation begins.',
      primarySteps: ['RAIN', 'PREDICT', 'WARN'],
      activeReadinessChecklist: [
        {
          id: 'CHK-EW-1',
          label: 'Poll 4 Indore rain gauges & Navalakha upstream discharge radar',
          owner: 'Telemetry Pipeline',
          status: 'COMPLETE',
        },
        {
          id: 'CHK-EW-2',
          label: `Flag ${critCount + 4} low-lying cells (<547m MSL) along Kahn–Saraswati confluence`,
          owner: 'Control-room operator',
          status: 'COMPLETE',
        },
        {
          id: 'CHK-EW-3',
          label: 'Issue pre-positioning advisory to Chimanbagh SDRF & MTH Hospital',
          owner: 'Emergency responder',
          status: params.stage === DisasterStage.EARLY_WARNING ? 'ACTIVE' : 'COMPLETE',
        },
      ],
    },
    {
      stage: DisasterStage.PRE_DISASTER_SCENARIO,
      number: 2,
      title: '2. PRE-DISASTER SCENARIO',
      windowLabel: 'T-1h to T+0h · What-If Stress Testing',
      objective:
        'Simulate rainfall bursts (30–95 mm/hr) and nallah blockage proxies (10–75%) to pre-stage pumps, barricades, and shelter buses.',
      primarySteps: ['SIMULATE', 'WARN', 'REROUTE'],
      activeReadinessChecklist: [
        {
          id: 'CHK-PRE-1',
          label: `Evaluate ${params.drainageBlockagePct}% culvert silt/solid-waste choke at Sarwate & Chandrabhaga`,
          owner: 'Analyst/model operator',
          status: 'COMPLETE',
        },
        {
          id: 'CHK-PRE-2',
          label: 'Pre-stage mobile dewatering pumps at Sarwate Underpass & MTH Gate',
          owner: 'Emergency responder',
          status:
            params.stage === DisasterStage.PRE_DISASTER_SCENARIO
              ? 'ACTIVE'
              : params.stage === DisasterStage.EARLY_WARNING
              ? 'PENDING'
              : 'COMPLETE',
        },
        {
          id: 'CHK-PRE-3',
          label: 'Pre-compute ambulance diversion routes avoiding low river bridges',
          owner: 'Traffic authority',
          status:
            params.stage === DisasterStage.PRE_DISASTER_SCENARIO ? 'ACTIVE' : 'COMPLETE',
        },
      ],
    },
    {
      stage: DisasterStage.REAL_TIME_ONGOING,
      number: 3,
      title: '3. REAL-TIME ONGOING',
      windowLabel: 'T+0h to T+3h · Active Incident Operations',
      objective:
        'Fuse ultrasonic water-level gauges with model depths, barricade flooded bridges, reroute emergency response, and execute shelter evacuation.',
      primarySteps: ['VERIFY', 'REROUTE', 'EVACUATE'],
      activeReadinessChecklist: [
        {
          id: 'CHK-RT-1',
          label: `Enforce road closures on ${closedCount} inundated bridge/underpass segments`,
          owner: 'Traffic authority',
          status:
            params.stage === DisasterStage.REAL_TIME_ONGOING ? 'ACTIVE' : 'PENDING',
        },
        {
          id: 'CHK-RT-2',
          label: 'Verify ultrasonic stage at Krishnapura (SEN-WL-01) & Rambagh (SEN-WL-02)',
          owner: 'Control-room operator',
          status:
            params.stage === DisasterStage.REAL_TIME_ONGOING ? 'ACTIVE' : 'PENDING',
        },
        {
          id: 'CHK-RT-3',
          label: 'Dispatch AICTSL evacuation buses from flooded pockets to 4 high-ground shelters',
          owner: 'Emergency responder',
          status:
            params.stage === DisasterStage.REAL_TIME_ONGOING ? 'ACTIVE' : 'PENDING',
        },
      ],
    },
    {
      stage: DisasterStage.POST_DISASTER_LEARNING,
      number: 4,
      title: '4. POST-DISASTER LEARNING',
      windowLabel: 'T+3h+ · Validation & Model Recalibration',
      objective:
        'Compare predicted inundation depths against observed high-water marks (HWM), audit sensor drift, and update ward drainage proxy scores.',
      primarySteps: ['VERIFY', 'LEARN'],
      activeReadinessChecklist: [
        {
          id: 'CHK-POST-1',
          label: 'Ingest field High-Water Mark (HWM) survey across 64 Indore grid cells',
          owner: 'Analyst/model operator',
          status:
            params.stage === DisasterStage.POST_DISASTER_LEARNING ? 'ACTIVE' : 'PENDING',
        },
        {
          id: 'CHK-POST-2',
          label: 'Compute Brier Score, Critical Success Index (CSI), and cell residual errors',
          owner: 'Analyst/model operator',
          status:
            params.stage === DisasterStage.POST_DISASTER_LEARNING ? 'ACTIVE' : 'PENDING',
        },
        {
          id: 'CHK-POST-3',
          label: 'Export municipal desilting priority list for IMC drainage engineering wing',
          owner: 'Control-room operator',
          status:
            params.stage === DisasterStage.POST_DISASTER_LEARNING ? 'ACTIVE' : 'PENDING',
        },
      ],
    },
  ];
}
