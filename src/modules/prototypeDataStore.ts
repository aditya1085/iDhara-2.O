import {
  BASE_GRID_CELLS,
  BASE_ROAD_SEGMENTS,
  BASE_SENSORS,
  BASE_SHELTERS,
  INTERSECTION_NODES,
} from '../data/indorePilotData';
import {
  AlertItem,
  DataHealthReport,
  DisasterStage,
  EvacuationPlanItem,
  FloodRiskCell,
  FloodSeverity,
  InjectedObservationState,
  ProductMode,
  RoadSegmentState,
  RoadStatus,
  RouteRecommendation,
  ScenarioParameters,
  SensorNode,
  Shelter,
  TravelProfile,
  ValidationReport,
  WarningLevel,
} from '../types/idhara';
import { generateOperationalAlerts } from './alerts';
import { ingestSensorTelemetry } from './dataIngestion';
import { evaluateDataHealth } from './dataQuality';
import { buildCurrentTwinSnapshot, IsolatedTwinSnapshot } from './disasterTwin';
import {
  evaluateSheltersAndEvacuation,
  EvacuationConfig,
} from './evacuation';
import { predictFloodRiskGrid } from './prediction';
import { evaluateRoadNetworkState } from './roadState';
import { computeRouteRecommendations } from './routing';
import { generateValidationReport } from './validation';

/**
 * Authoritative Prototype Data Source
 *
 * Ensures the EXACT SAME road, sensor, shelter, rainfall, and risk-cell objects
 * are shared deterministically across:
 * 1. Risk Map
 * 2. Disaster Twin
 * 3. Roads & Routing
 * 4. Evacuation
 * 5. Alerts
 * 6. Validation
 */
export interface AuthoritativePrototypeData {
  rainfall: {
    baseMmHr: number;
    effectiveMmHr: number;
    injectedBurstMmHr: number;
  };
  sensors: SensorNode[];
  cells: FloodRiskCell[];
  roads: RoadSegmentState[];
  shelters: Shelter[];
  evacuationPlans: EvacuationPlanItem[];
  evacuationModeActive: boolean;
  evacuationTriggerReason: string;
  routes: RouteRecommendation[];
  alerts: AlertItem[];
  validationReport: ValidationReport;
  dataHealthReport: DataHealthReport;
  overallPilotRisk: FloodSeverity;
  overallWarningLevel: WarningLevel;
  disasterTwinBaseline: IsolatedTwinSnapshot;
}

export interface PrototypePipelineInput {
  params: ScenarioParameters;
  injectedObservations: InjectedObservationState;
  previousWarnings?: Map<string, WarningLevel>;
  previousRoadStates?: Map<string, RoadStatus>;
  stableTicksElapsed?: number;
  customOriginId?: string;
  customDestId?: string;
  travelProfile?: TravelProfile;
  evacuationConfig?: EvacuationConfig;
  acknowledgedAlerts?: Set<string>;
  alertLifecycleOverrides?: Record<string, any>;
  customAlerts?: AlertItem[];
  activeModelVersionId?: string;
}

/**
 * Evaluates the single authoritative prototype data source deterministically.
 */
export function evaluateAuthoritativePrototypeData(
  input: PrototypePipelineInput
): AuthoritativePrototypeData {
  const {
    params,
    injectedObservations,
    previousWarnings,
    previousRoadStates,
    stableTicksElapsed = 3,
    customOriginId = 'NODE-RAJWADA',
    customDestId = 'NODE-MY-HOSPITAL',
    travelProfile = 'AMBULANCE',
    evacuationConfig,
    acknowledgedAlerts = new Set(),
    alertLifecycleOverrides = {},
    customAlerts = [],
    activeModelVersionId = 'v2.4.2-indore-pilot',
  } = input;

  const baseRain = Number.isFinite(params.rainfallIntensityMmHr)
    ? params.rainfallIntensityMmHr
    : 38;
  const burstRain = Number.isFinite(injectedObservations.extraRainfallMmHr)
    ? injectedObservations.extraRainfallMmHr
    : 0;
  const effectiveRain = baseRain + burstRain;

  // 1. Telemetry Ingestion (deterministic sensor nodes)
  const sensors = ingestSensorTelemetry(params, injectedObservations);

  // 2. Risk Prediction Grid (deterministic 64 cells)
  const cells = predictFloodRiskGrid(
    params,
    sensors,
    previousWarnings,
    stableTicksElapsed,
    injectedObservations
  );

  // 3. Road State Machine (deterministic 24 corridors, strictly honoring overrides like RD-05 CLOSED)
  const roads = evaluateRoadNetworkState(
    cells,
    sensors,
    params,
    injectedObservations,
    previousRoadStates,
    stableTicksElapsed
  );

  // 4. Emergency Routing Engine (recalculates Dijkstra corridors avoiding closed segments)
  const routes = computeRouteRecommendations(
    roads,
    params,
    customOriginId,
    customDestId,
    travelProfile
  );

  // 5. Evacuation & Shelter Logistics (allocates civilian bus routing around closed corridors)
  const {
    shelters,
    evacuationPlans,
    evacuationModeActive,
    evacuationTriggerReason,
  } = evaluateSheltersAndEvacuation(
    cells,
    params,
    roads,
    evacuationConfig
  );

  // 6. Operational Alerts Engine (emits barricade, evacuation, and sensor failure warnings)
  const alerts = generateOperationalAlerts(
    cells,
    roads,
    sensors,
    params,
    acknowledgedAlerts,
    alertLifecycleOverrides,
    customAlerts
  );

  // 7. Post-Disaster Validation Report (compares model forecast vs ground-truth HWM)
  const validationReport = generateValidationReport(
    cells,
    params,
    activeModelVersionId
  );

  // 8. Disaster Twin Baseline Snapshot (strictly shares the EXACT same entities above)
  const disasterTwinBaseline = buildCurrentTwinSnapshot(
    params,
    cells,
    roads,
    shelters,
    evacuationPlans,
    routes
  );

  // 9. Telemetry Data Health
  const dataHealthReport = evaluateDataHealth(sensors, params);

  // 10. Overall Area Risk & Warning Rollups
  const critCount = cells.filter((c) => c.severity === FloodSeverity.CRITICAL).length;
  const highCount = cells.filter((c) => c.severity === FloodSeverity.HIGH).length;
  const redCount = cells.filter((c) => c.warningLevel === WarningLevel.RED).length;
  const orangeCount = cells.filter((c) => c.warningLevel === WarningLevel.ORANGE).length;

  let risk = FloodSeverity.LOW;
  if (critCount >= 4) risk = FloodSeverity.CRITICAL;
  else if (critCount >= 1 || highCount >= 4) risk = FloodSeverity.HIGH;
  else if (highCount >= 1) risk = FloodSeverity.MODERATE;

  let warn = WarningLevel.GREEN;
  if (redCount >= 2) warn = WarningLevel.RED;
  else if (redCount >= 1 || orangeCount >= 2) warn = WarningLevel.ORANGE;
  else if (orangeCount >= 1 || highCount >= 1) warn = WarningLevel.YELLOW;

  return {
    rainfall: {
      baseMmHr: baseRain,
      effectiveMmHr: effectiveRain,
      injectedBurstMmHr: burstRain,
    },
    sensors,
    cells,
    roads,
    shelters,
    evacuationPlans,
    evacuationModeActive,
    evacuationTriggerReason,
    routes,
    alerts,
    validationReport,
    dataHealthReport,
    overallPilotRisk: risk,
    overallWarningLevel: warn,
    disasterTwinBaseline,
  };
}

/**
 * Validates complete state propagation and data consistency across all 6 modules.
 * Returns true if all consistency invariants hold.
 */
export function verifyStateConsistency(data: AuthoritativePrototypeData): {
  isValid: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // Check 1: Exactly 64 risk cells and 24 roads
  if (data.cells.length !== 64) {
    violations.push(`Expected 64 cells, found ${data.cells.length}`);
  }
  if (data.roads.length !== 24) {
    violations.push(`Expected 24 roads, found ${data.roads.length}`);
  }
  if (data.shelters.length !== 4) {
    violations.push(`Expected 4 shelters, found ${data.shelters.length}`);
  }

  // Check 2: Disaster Twin baseline shares exact road references
  if (data.disasterTwinBaseline.roads !== data.roads) {
    violations.push('Disaster Twin baseline roads does not match authoritative roads array');
  }
  if (data.disasterTwinBaseline.cells !== data.cells) {
    violations.push('Disaster Twin baseline cells does not match authoritative cells array');
  }
  if (data.disasterTwinBaseline.shelters !== data.shelters) {
    violations.push('Disaster Twin baseline shelters does not match authoritative shelters array');
  }
  if (data.disasterTwinBaseline.evacuationPlans !== data.evacuationPlans) {
    violations.push('Disaster Twin baseline evacuationPlans does not match authoritative evacuationPlans array');
  }
  if (data.disasterTwinBaseline.routes !== data.routes) {
    violations.push('Disaster Twin baseline routes does not match authoritative routes array');
  }

  // Check 3: If RD-05 is CLOSED, verify all downstream modules reflect it
  const rd05 = data.roads.find((r) => r.id === 'RD-05');
  if (rd05 && rd05.currentState === RoadStatus.CLOSED) {
    // 3a. Disaster Twin baseline must show RD-05 as CLOSED
    const twinRd05 = data.disasterTwinBaseline.roads.find((r) => r.id === 'RD-05');
    if (!twinRd05 || twinRd05.currentState !== RoadStatus.CLOSED) {
      violations.push('RD-05 is CLOSED in roads but not CLOSED in Disaster Twin baseline');
    }

    // 3b. Active routes must not route through RD-05
    data.routes.forEach((rt) => {
      if (rt.feasible && rt.primaryRoute?.roadIds.includes('RD-05')) {
        violations.push(`Route ${rt.id} routes through CLOSED road RD-05`);
      }
    });

    // 3c. Evacuation plans must not route through RD-05
    data.evacuationPlans.forEach((plan) => {
      if (plan.assigned && plan.routeRoadIds.includes('RD-05')) {
        violations.push(`Evacuation plan for ${plan.sourceCellId} routes through CLOSED road RD-05`);
      }
    });

    // 3d. Operational alerts must include barricade advisory for RD-05
    const roadBarricadeAlert = data.alerts.find(
      (a) => a.id === 'ALT-ROAD-BARRICADE' || a.id.startsWith('ALT-RD-')
    );
    if (!roadBarricadeAlert) {
      violations.push('No barricade alert found while RD-05 is CLOSED');
    }
  }

  // Check 4: No undefined or NaN values in critical numeric metrics
  data.cells.forEach((c) => {
    if (!Number.isFinite(c.floodProbability) || !Number.isFinite(c.predictedDepthCm)) {
      violations.push(`Cell ${c.id} contains NaN or non-finite flood metrics`);
    }
  });

  data.roads.forEach((r) => {
    if (!Number.isFinite(r.floodProbability) || !Number.isFinite(r.estimatedWaterDepthCm)) {
      violations.push(`Road ${r.id} contains NaN or non-finite flood metrics`);
    }
  });

  data.shelters.forEach((s) => {
    if (!Number.isFinite(s.currentOccupancy) || !Number.isFinite(s.totalCapacity)) {
      violations.push(`Shelter ${s.id} contains NaN or non-finite occupancy metrics`);
    }
  });

  return {
    isValid: violations.length === 0,
    violations,
  };
}
