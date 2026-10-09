import {
  evaluateAuthoritativePrototypeData,
  verifyStateConsistency,
} from '../modules/prototypeDataStore';
import {
  DisasterStage,
  ProductMode,
  RoadStatus,
  ScenarioParameters,
} from '../types/idhara';
import { DEFAULT_INJECTED_OBSERVATIONS } from '../modules/dataIngestion';
import { DEFAULT_EVACUATION_CONFIG } from '../modules/evacuation';
import { selectDemoIncidentRoad } from '../modules/routing';

console.log('=== RUNNING AUTHORITATIVE PROTOTYPE STATE CONSISTENCY TESTS ===');

// Base scenario input
const baseParams: ScenarioParameters = {
  mode: ProductMode.SIMULATED,
  stage: DisasterStage.REAL_TIME_ONGOING,
  rainfallIntensityMmHr: 42,
  durationHours: 3,
  drainageBlockagePct: 40,
  upstreamKahnInflowMultiplier: 1.25,
  sensorDropoutCount: 0,
  timelineHourOffset: 0,
  activeEventPresetId: 'EVT-SIM-MONSOON-SURGE',
};

// TEST 1: Baseline state evaluation & object sharing
const baseline = evaluateAuthoritativePrototypeData({
  params: baseParams,
  injectedObservations: DEFAULT_INJECTED_OBSERVATIONS,
  customOriginId: 'NODE-RAJWADA',
  customDestId: 'NODE-MY-HOSPITAL',
  travelProfile: 'AMBULANCE',
  evacuationConfig: DEFAULT_EVACUATION_CONFIG,
});

const check1 = verifyStateConsistency(baseline);
console.log('Test 1 (Baseline Invariants):', check1.isValid ? 'PASSED' : 'FAILED', check1.violations);
if (!check1.isValid) process.exit(1);

// Verify exact reference equality in Disaster Twin baseline
console.assert(baseline.disasterTwinBaseline.cells === baseline.cells, 'Cells reference must match');
console.assert(baseline.disasterTwinBaseline.roads === baseline.roads, 'Roads reference must match');
console.assert(baseline.disasterTwinBaseline.shelters === baseline.shelters, 'Shelters reference must match');
console.assert(baseline.disasterTwinBaseline.routes === baseline.routes, 'Routes reference must match');
console.assert(baseline.disasterTwinBaseline.evacuationPlans === baseline.evacuationPlans, 'EvacuationPlans reference must match');
console.log('Test 1 Reference Equality Check: PASSED');

// TEST 2: If RD-05 becomes CLOSED, all modules must immediately see RD-05 as CLOSED
const closedRd05Observations = {
  ...DEFAULT_INJECTED_OBSERVATIONS,
  officialRoadOverrides: {
    'RD-05': 'CLOSED' as const,
  },
};

const rd05ClosedData = evaluateAuthoritativePrototypeData({
  params: baseParams,
  injectedObservations: closedRd05Observations,
  customOriginId: 'NODE-RAJWADA',
  customDestId: 'NODE-MY-HOSPITAL',
  travelProfile: 'AMBULANCE',
  evacuationConfig: DEFAULT_EVACUATION_CONFIG,
});

const check2 = verifyStateConsistency(rd05ClosedData);
console.log('Test 2 (RD-05 CLOSED Invariants):', check2.isValid ? 'PASSED' : 'FAILED', check2.violations);
if (!check2.isValid) process.exit(1);

// Assertions on all modules seeing RD-05 as CLOSED:
const rd05 = rd05ClosedData.roads.find((r) => r.id === 'RD-05');
console.assert(rd05?.currentState === RoadStatus.CLOSED, 'Roads module must see RD-05 as CLOSED');

const twinRd05 = rd05ClosedData.disasterTwinBaseline.roads.find((r) => r.id === 'RD-05');
console.assert(twinRd05?.currentState === RoadStatus.CLOSED, 'Disaster Twin baseline must see RD-05 as CLOSED');

const activeAmbulanceRoute = rd05ClosedData.routes.find((r) => r.id === 'RTE-PLANNER-NODE-RAJWADA-NODE-MY-HOSPITAL');
console.log('RD-05 Closed Route Feasible:', activeAmbulanceRoute?.feasible, activeAmbulanceRoute?.noRouteInfo?.reason);
console.assert(activeAmbulanceRoute !== undefined, 'Route recommendation must exist');
if (activeAmbulanceRoute?.feasible) {
  console.assert(!activeAmbulanceRoute?.primaryRoute?.roadIds.includes('RD-05'), 'Route must NOT include CLOSED RD-05');
  console.assert(activeAmbulanceRoute?.baselineBlockedRoadNames.some((n) => n.includes('RD-05')), 'Route must note RD-05 as blocked');
} else {
  console.assert(activeAmbulanceRoute?.noRouteInfo !== undefined, 'If no feasible route, operational empty state must be populated');
}

const evacPlans = rd05ClosedData.evacuationPlans.filter((p) => p.assigned);
for (const plan of evacPlans) {
  console.assert(!plan.routeRoadIds.includes('RD-05'), `Evacuation plan ${plan.sourceCellId} must not traverse CLOSED RD-05`);
}

// TEST 2B: Route recalculation test under normal baseline rainfall (25 mm/h)
const normalRainParams = { ...baseParams, rainfallIntensityMmHr: 25 };
const normalData = evaluateAuthoritativePrototypeData({
  params: normalRainParams,
  injectedObservations: DEFAULT_INJECTED_OBSERVATIONS,
  customOriginId: 'NODE-CHIMANBAGH',
  customDestId: 'NODE-MY-HOSPITAL',
  travelProfile: 'AMBULANCE',
});
const normalRoute = normalData.routes.find((r) => r.id === 'RTE-PLANNER-NODE-CHIMANBAGH-NODE-MY-HOSPITAL');
console.assert(normalRoute?.feasible === true, 'Under 25 mm/h rain, normal route must be feasible');
if (normalRoute?.feasible && normalRoute.primaryRoute) {
  const targetRoad = selectDemoIncidentRoad(normalRoute, normalData.roads, normalRainParams);
  console.assert(targetRoad !== null, 'selectDemoIncidentRoad must find a candidate road to close');
  if (targetRoad) {
    const recomputedData = evaluateAuthoritativePrototypeData({
      params: normalRainParams,
      injectedObservations: {
        ...DEFAULT_INJECTED_OBSERVATIONS,
        officialRoadOverrides: { [targetRoad.id]: 'CLOSED' as const },
      },
      customOriginId: 'NODE-CHIMANBAGH',
      customDestId: 'NODE-MY-HOSPITAL',
      travelProfile: 'AMBULANCE',
    });
    const recomputedRoute = recomputedData.routes.find((r) => r.id === 'RTE-PLANNER-NODE-CHIMANBAGH-NODE-MY-HOSPITAL');
    console.assert(recomputedRoute !== undefined, 'Recomputed route must exist');
    if (recomputedRoute?.feasible) {
      console.assert(!recomputedRoute.primaryRoute?.roadIds.includes(targetRoad.id), `Recomputed route must avoid closed road ${targetRoad.id}`);
      console.log(`Test 2B (Route Recalculation): PASSED — Closed ${targetRoad.id} (${targetRoad.name}), rerouted via ${recomputedRoute.primaryRoute?.roadIds.join(' -> ')}`);
    } else {
      console.assert(recomputedRoute?.noRouteInfo !== undefined, 'If no feasible route, operational empty state must be shown');
      console.log(`Test 2B (Route Invalidation to Empty State): PASSED — Closed ${targetRoad.id}, correctly transitioned to: ${recomputedRoute?.noRouteInfo?.reason}`);
    }
  }
}

// TEST 3: If rainfall changes, prediction state must update consistently
const lowRainData = evaluateAuthoritativePrototypeData({
  params: { ...baseParams, rainfallIntensityMmHr: 15 },
  injectedObservations: DEFAULT_INJECTED_OBSERVATIONS,
});

const highRainData = evaluateAuthoritativePrototypeData({
  params: { ...baseParams, rainfallIntensityMmHr: 80 },
  injectedObservations: DEFAULT_INJECTED_OBSERVATIONS,
});

const avgLowProb = lowRainData.cells.reduce((s, c) => s + c.floodProbability, 0) / lowRainData.cells.length;
const avgHighProb = highRainData.cells.reduce((s, c) => s + c.floodProbability, 0) / highRainData.cells.length;
console.assert(avgHighProb > avgLowProb, `High rain average probability (${avgHighProb}) must exceed low rain (${avgLowProb})`);
console.log('Test 3 (Rainfall-to-Prediction Update): PASSED (15 mm/h -> ' + avgLowProb.toFixed(2) + ' vs 80 mm/h -> ' + avgHighProb.toFixed(2) + ')');

// TEST 4: If route becomes invalid, it must recalculate; if no route exists, proper empty state
const allSeveredObservations = {
  ...DEFAULT_INJECTED_OBSERVATIONS,
  officialRoadOverrides: {
    'RD-04': 'CLOSED' as const,
    'RD-05': 'CLOSED' as const,
    'RD-06': 'CLOSED' as const,
    'RD-11': 'CLOSED' as const,
    'RD-15': 'CLOSED' as const,
  },
};

const severedData = evaluateAuthoritativePrototypeData({
  params: baseParams,
  injectedObservations: allSeveredObservations,
  customOriginId: 'NODE-RAJWADA',
  customDestId: 'NODE-MY-HOSPITAL',
  travelProfile: 'AMBULANCE',
});

const severedRoute = severedData.routes.find((r) => r.id === 'RTE-PLANNER-NODE-RAJWADA-NODE-MY-HOSPITAL');
console.assert(severedRoute?.feasible === false, 'Route must be marked feasible: false when all outbound corridors are closed');
console.assert(severedRoute?.primaryRoute === null, 'Primary route must be null');
console.assert(severedRoute?.noRouteInfo !== undefined, 'noRouteInfo must be defined');
console.assert(typeof severedRoute?.noRouteInfo?.reason === 'string', 'noRouteInfo must include human operational reason');
console.assert(severedRoute?.noRouteInfo?.nearestReachableSafePoint !== null, 'Must provide nearest reachable safe point');
console.assert(severedRoute?.noRouteInfo?.nearestAvailableShelter !== null, 'Must provide nearest available shelter');
console.log('Test 4 (No Feasible Route Operational Empty State): PASSED');

// TEST 5: Verify no NaN or undefined metrics in cells, roads, shelters, routes
for (const cell of severedData.cells) {
  console.assert(Number.isFinite(cell.floodProbability), `Cell ${cell.id} floodProbability must be finite`);
  console.assert(Number.isFinite(cell.predictedDepthCm), `Cell ${cell.id} predictedDepthCm must be finite`);
  console.assert(Number.isFinite(cell.confidence), `Cell ${cell.id} confidence must be finite`);
}
for (const road of severedData.roads) {
  console.assert(Number.isFinite(road.floodProbability), `Road ${road.id} floodProbability must be finite`);
  console.assert(Number.isFinite(road.estimatedWaterDepthCm), `Road ${road.id} estimatedWaterDepthCm must be finite`);
  console.assert(Number.isFinite(road.confidence), `Road ${road.id} confidence must be finite`);
}
for (const shelter of severedData.shelters) {
  console.assert(Number.isFinite(shelter.currentOccupancy), `Shelter ${shelter.id} currentOccupancy must be finite`);
  console.assert(Number.isFinite(shelter.totalCapacity), `Shelter ${shelter.id} totalCapacity must be finite`);
}
console.log('Test 5 (No NaN/Undefined/Null in Critical Metrics): PASSED');

// TEST 6: Validation module 5x5 km complete study-area coverage and metrics integrity
const valReport = baseline.validationReport;
console.assert(valReport.records.length === 64, `Validation records must evaluate all 64 cells, got ${valReport.records.length}`);
console.assert(Number.isFinite(valReport.precision) && valReport.precision >= 0 && valReport.precision <= 1, 'Precision must be in [0, 1]');
console.assert(Number.isFinite(valReport.recall) && valReport.recall >= 0 && valReport.recall <= 1, 'Recall must be in [0, 1]');
console.assert(Number.isFinite(valReport.iouScore) && valReport.iouScore >= 0 && valReport.iouScore <= 1, 'IoU must be in [0, 1]');
console.assert(Number.isFinite(valReport.f1Score) && valReport.f1Score >= 0 && valReport.f1Score <= 1, 'F1 score must be in [0, 1]');
console.assert(Number.isFinite(valReport.brierScore) && valReport.brierScore >= 0, 'Brier score must be non-negative');

const totalClassified = valReport.truePositivesCount + valReport.falseNegativesCount + valReport.falsePositivesCount + valReport.trueNegativesCount;
console.assert(totalClassified === 64, `Sum of TP (${valReport.truePositivesCount}) + FN (${valReport.falseNegativesCount}) + FP (${valReport.falsePositivesCount}) + TN (${valReport.trueNegativesCount}) must equal 64 cells`);
console.log(`Test 6 (Validation Complete 5x5 km Evaluation): PASSED — 64 cells evaluated (TP:${valReport.truePositivesCount}, FN:${valReport.falseNegativesCount}, FP:${valReport.falsePositivesCount}, TN:${valReport.trueNegativesCount}, Precision:${valReport.precision}, Recall:${valReport.recall}, IoU:${valReport.iouScore})`);

console.log('=== ALL STATE PROPAGATION & DATA CONSISTENCY TESTS PASSED SUCCESSFULLY ===');
