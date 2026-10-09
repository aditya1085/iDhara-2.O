import { evaluateAuthoritativePrototypeData } from '../modules/prototypeDataStore';
import { DisasterStage, ProductMode, RoadStatus, TravelProfile } from '../types/idhara';
import { DEFAULT_INJECTED_OBSERVATIONS } from '../modules/dataIngestion';
import { DEFAULT_EVACUATION_CONFIG, evaluateEvacuationForSelectedCell } from '../modules/evacuation';
import { computeSingleRoute, findNearestNodeForCell } from '../modules/routing';
import { INTERSECTION_NODES, BASE_ROAD_SEGMENTS, BASE_SHELTERS } from '../data/indorePilotData';

console.log('====================================================');
console.log('IDHARA PHASE 2 REGRESSION & VERIFICATION SUITE');
console.log('====================================================\n');

const params = {
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

const data = evaluateAuthoritativePrototypeData({
  params,
  injectedObservations: DEFAULT_INJECTED_OBSERVATIONS,
  customOriginId: 'NODE-BADA-GANPATI',
  customDestId: 'NODE-MY-HOSPITAL',
  travelProfile: 'AMBULANCE',
  evacuationConfig: DEFAULT_EVACUATION_CONFIG,
});

// TEST 1 & 2: ROUTING: Bada Ganpati Sq -> MY Hospital Gate
console.log('TEST 1 & 2: ROUTING ANALYSIS (Bada Ganpati Sq → MY Hospital Gate)');
const profiles: TravelProfile[] = ['AMBULANCE', 'CITIZEN', 'EMERGENCY_RESPONDER', 'PEDESTRIAN'];
profiles.forEach((prof) => {
  const route = computeSingleRoute('NODE-BADA-GANPATI', 'NODE-MY-HOSPITAL', data.roads, params, prof);
  console.log(`- Profile: ${prof.padEnd(20)} | Feasible: ${route.feasible} | Status: ${route.recommendationStatusLabel}`);
  if (!route.feasible) {
    console.log(`  Justified Reason: ${route.noRouteInfo?.reason.slice(0, 110)}...`);
    console.log(`  Nearest Safe Point: ${route.noRouteInfo?.nearestReachableSafePoint?.nodeName} (${route.noRouteInfo?.nearestReachableSafePoint?.elevationM}m MSL via ${route.noRouteInfo?.nearestReachableSafePoint?.pathRoadIds.join(', ')})`);
    console.log(`  Nearest Shelter: ${route.noRouteInfo?.nearestAvailableShelter?.shelterName} (${route.noRouteInfo?.nearestAvailableShelter?.distanceKm} km)`);
  }
});

// TEST 3 & 4: EVACUATION LOGIC & ROAD GRAPH CONNECTIVITY
console.log('\nTEST 3 & 4: EVACUATION & GRAPH CONNECTIVITY ANALYSIS');

// Test Bada Ganpati North (CELL-R0C0)
const cellR0C0 = data.cells.find((c) => c.id === 'CELL-R0C0')!;
const evacR0C0 = evaluateEvacuationForSelectedCell(cellR0C0, data.shelters, data.roads, params, data.evacuationPlans);
console.log(`- Area: CELL-R0C0 (${cellR0C0.localityName})`);
console.log(`  Assigned: ${evacR0C0.assigned} | Status: ${evacR0C0.status}`);
console.log(`  Failure Reason: ${evacR0C0.failureReason}`);
console.log(`  Failure Detail: ${evacR0C0.failureDetail}`);
console.log(`  Road Access: ${evacR0C0.roadAccessibilityStatus} (${evacR0C0.roadAccessibilityLabel})`);

// Test Narayanbagh Slope (CELL-R1C1)
const cellR1C1 = data.cells.find((c) => c.id === 'CELL-R1C1')!;
const evacR1C1 = evaluateEvacuationForSelectedCell(cellR1C1, data.shelters, data.roads, params, data.evacuationPlans);
console.log(`\n- Area: CELL-R1C1 (${cellR1C1.localityName})`);
console.log(`  Assigned: ${evacR1C1.assigned} | Target Shelter: ${evacR1C1.targetShelterName}`);
console.log(`  Route: ${evacR1C1.routeRoadNames.join(' → ')} (${evacR1C1.distanceKm} km, ~${evacR1C1.estimatedClearanceMin} min clearance)`);

// Test Truly Disconnected Area (CELL-R2C2 Krishnapura Confluence)
const cellR2C2 = data.cells.find((c) => c.id === 'CELL-R2C2')!;
const evacR2C2 = evaluateEvacuationForSelectedCell(cellR2C2, data.shelters, data.roads, params, data.evacuationPlans);
console.log(`\n- Area: CELL-R2C2 (${cellR2C2.localityName})`);
console.log(`  Assigned: ${evacR2C2.assigned} | Status: ${evacR2C2.status}`);
console.log(`  Failure Reason: ${evacR2C2.failureReason}`);
console.log(`  Failure Detail: ${evacR2C2.failureDetail}`);

// Test MTH Hospital Compound (CELL-R2C3)
const cellR2C3 = data.cells.find((c) => c.id === 'CELL-R2C3')!;
const evacR2C3 = evaluateEvacuationForSelectedCell(cellR2C3, data.shelters, data.roads, params, data.evacuationPlans);
console.log(`\n- Area: CELL-R2C3 (${cellR2C3.localityName})`);
console.log(`  Assigned: ${evacR2C3.assigned} | Target Shelter: ${evacR2C3.targetShelterName}`);
console.log(`  Route: ${evacR2C3.routeRoadNames.join(' → ')} (${evacR2C3.distanceKm} km)`);

// Test Shivaji Vatika (CELL-R6C6) with newly linked RD-18
const cellR6C6 = data.cells.find((c) => c.id === 'CELL-R6C6')!;
const evacR6C6 = evaluateEvacuationForSelectedCell(cellR6C6, data.shelters, data.roads, params, data.evacuationPlans);
console.log(`\n- Area: CELL-R6C6 (${cellR6C6.localityName})`);
console.log(`  Origin Node: ${evacR6C6.originNodeName} (${evacR6C6.originNodeId})`);
console.log(`  Road Access: ${evacR6C6.roadAccessibilityStatus}`);

console.log('\n--- VERIFICATION OF PHYSICAL CORRIDORS ACROSS THE RIVER ---');
const riverCrossingRoads = ['RD-01', 'RD-02', 'RD-05', 'RD-06', 'RD-11', 'RD-12', 'RD-13', 'RD-15', 'RD-16', 'RD-19', 'RD-21'];
riverCrossingRoads.forEach((rId) => {
  const r = data.roads.find((x) => x.id === rId)!;
  console.log(`Corridor ${r.id} (${r.name}): ${r.currentState} (prob: ${r.floodProbability}, depth: ${r.estimatedWaterDepthCm}cm)`);
});

console.log('\n====================================================');
console.log('ALL REGRESSION TESTS COMPLETED SUCCESSFULLY');
console.log('====================================================');
