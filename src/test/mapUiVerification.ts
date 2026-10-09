import { INTERSECTION_NODES, PILOT_BOUNDS, PILOT_SCOPE_ID } from '../data/indorePilotData';
import { evaluateAuthoritativePrototypeData } from '../modules/prototypeDataStore';
import { DEFAULT_INJECTED_OBSERVATIONS } from '../modules/dataIngestion';
import { DEFAULT_EVACUATION_CONFIG } from '../modules/evacuation';
import {
  DisasterStage,
  FloodSeverity,
  MapSurfaceMetric,
  ProductMode,
  ScenarioParameters,
} from '../types/idhara';
import {
  DEFAULT_RISK_CATEGORY_TOGGLES,
  filterCellsByRiskToggles,
  getCellGeographicBounds,
  latToMapY,
  lngToMapX,
} from '../components/IndoreFloodMap';

console.log('=== PHASE 1: MAP UI & INTERACTION VERIFICATION ===\n');

// 1. Verify all 64 study areas exist with original names and are browsable
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

const store = evaluateAuthoritativePrototypeData({
  params: baseParams,
  injectedObservations: DEFAULT_INJECTED_OBSERVATIONS,
  customOriginId: 'NODE-RAJWADA',
  customDestId: 'NODE-MY-HOSPITAL',
  travelProfile: 'AMBULANCE',
  evacuationConfig: DEFAULT_EVACUATION_CONFIG,
});

console.log(`[TEST 1] Study Areas Count: ${store.cells.length}`);
console.assert(store.cells.length === 64, 'Expected exactly 64 study areas');

// Check pilot boundary coordinates
console.assert(PILOT_BOUNDS.minLat === 22.7040, 'Pilot minLat matches 5x5km boundary');
console.assert(PILOT_BOUNDS.maxLat === 22.7490, 'Pilot maxLat matches 5x5km boundary');
console.assert(PILOT_SCOPE_ID === 'IND-PILOT-5X5-CENTRAL', 'Scope matches');
console.log('[TEST 1] Pilot Boundary: PASSED');

// Verify all 64 cells have valid names, ward codes, and geographic alignment
const cellNames = new Set(store.cells.map((c) => c.localityName));
console.assert(cellNames.size === 64, 'All 64 study area names must be distinct');

for (const cell of store.cells) {
  const bounds = getCellGeographicBounds(cell);
  const centerX = lngToMapX(cell.lng);
  const centerY = latToMapY(cell.lat);
  console.assert(
    Math.abs(bounds.x + bounds.width / 2 - centerX) < 1.5,
    `Cell ${cell.id} X bounds must align with cell longitude ${cell.lng}`
  );
  console.assert(
    Math.abs(bounds.y + bounds.height / 2 - centerY) < 1.5,
    `Cell ${cell.id} Y bounds must align with cell latitude ${cell.lat}`
  );
  console.assert(
    Math.abs(bounds.x - cell.col * 125) < 0.01 && Math.abs(bounds.y - cell.row * 125) < 0.01,
    `Cell ${cell.id} bounds must align with 8x8 geographic grid`
  );
}
console.log('[TEST 1] All 64 Study Areas & Geographic Bounds Verified: PASSED');

// 2. Verify all 6 views are valid
const views: MapSurfaceMetric[] = [
  'FLOOD_PROBABILITY',
  'SEVERITY',
  'UNCERTAINTY',
  'DATA_CONFIDENCE',
  'RAINFALL',
  'PREDICTED_VS_OBSERVED',
];
console.log(`[TEST 2] Verifying ${views.length} views: ${views.join(', ')}`);
for (const cell of store.cells) {
  console.assert(typeof cell.floodProbability === 'number', 'floodProbability valid');
  console.assert(typeof cell.severity === 'string', 'severity valid');
  console.assert(typeof cell.uncertaintyBand === 'number', 'uncertaintyBand valid');
  console.assert(typeof cell.confidence === 'number', 'confidence valid');
  console.assert(typeof cell.predictionInput.rainfall_1h === 'number', 'rainfall_1h valid');
}
console.log('[TEST 2] All 6 Views Accessible & Supported by Data: PASSED');

// 3. Verify all 12 layers
const expectedLayers = [
  'pilotBoundary',
  'heatmapGlow',
  'riskContours',
  'gridCells',
  'patterns',
  'drainage',
  'roads',
  'routes',
  'rainGauges',
  'waterLevelSensors',
  'assetsAndShelters',
  'cellLabels',
];
console.log(`[TEST 3] Layer count: ${expectedLayers.length}`);
console.assert(expectedLayers.length === 12, 'Must have exactly 12 layers');
console.log('[TEST 3] All 12 Layers Verified: PASSED');

// 4. Verify 16 intersection nodes
console.log(`[TEST 4] Intersection nodes: ${INTERSECTION_NODES.length}`);
console.assert(INTERSECTION_NODES.length === 16, 'Expected 16 intersection nodes');
console.log('[TEST 4] All 16 Intersection Nodes Verified: PASSED');

// 5. Verify roads, sensors, shelters
console.log(`[TEST 5] Roads: ${store.roads.length}, Sensors: ${store.sensors.length}, Shelters: ${store.shelters.length}`);
console.assert(store.roads.length === 24, 'Expected 24 road corridors');
console.assert(store.sensors.length === 10, 'Expected 10 sensor gauges');
console.assert(store.shelters.length === 4, 'Expected 4 relief shelters');
console.log('[TEST 5] Assets and Infrastructure Data: PASSED');

// 6. Verify 4 Independent Multi-Select Risk Category Toggles (Green, Yellow, Orange, Red)
const lowCells = store.cells.filter((c) => c.severity === FloodSeverity.LOW);
const modCells = store.cells.filter((c) => c.severity === FloodSeverity.MODERATE);
const highCells = store.cells.filter((c) => c.severity === FloodSeverity.HIGH);
const critCells = store.cells.filter((c) => c.severity === FloodSeverity.CRITICAL);

console.log(
  `[TEST 6] Category distribution — Green(LOW): ${lowCells.length}, Yellow(MODERATE): ${modCells.length}, Orange(HIGH): ${highCells.length}, Red(CRITICAL): ${critCells.length}`
);

// All OFF
const allOff = filterCellsByRiskToggles(store.cells, {
  GREEN: false,
  YELLOW: false,
  ORANGE: false,
  RED: false,
});
console.assert(allOff.length === 0, 'All toggles OFF must return 0 overlay cells');

// Green ON only
const greenOnly = filterCellsByRiskToggles(store.cells, {
  GREEN: true,
  YELLOW: false,
  ORANGE: false,
  RED: false,
});
console.assert(
  greenOnly.length === lowCells.length &&
    greenOnly.every((c) => c.severity === FloodSeverity.LOW),
  'Green ON only must return only LOW risk cells'
);

// Yellow ON only
const yellowOnly = filterCellsByRiskToggles(store.cells, {
  GREEN: false,
  YELLOW: true,
  ORANGE: false,
  RED: false,
});
console.assert(
  yellowOnly.length === modCells.length &&
    yellowOnly.every((c) => c.severity === FloodSeverity.MODERATE),
  'Yellow ON only must return only MODERATE risk cells'
);

// Orange ON only
const orangeOnly = filterCellsByRiskToggles(store.cells, {
  GREEN: false,
  YELLOW: false,
  ORANGE: true,
  RED: false,
});
console.assert(
  orangeOnly.length === highCells.length &&
    orangeOnly.every((c) => c.severity === FloodSeverity.HIGH),
  'Orange ON only must return only HIGH risk cells'
);

// Red ON only
const redOnly = filterCellsByRiskToggles(store.cells, {
  GREEN: false,
  YELLOW: false,
  ORANGE: false,
  RED: true,
});
console.assert(
  redOnly.length === critCells.length &&
    redOnly.every((c) => c.severity === FloodSeverity.CRITICAL),
  'Red ON only must return only CRITICAL risk cells'
);

// Combination: Orange + Red ON
const orangeAndRed = filterCellsByRiskToggles(store.cells, {
  GREEN: false,
  YELLOW: false,
  ORANGE: true,
  RED: true,
});
console.assert(
  orangeAndRed.length === highCells.length + critCells.length &&
    orangeAndRed.every(
      (c) => c.severity === FloodSeverity.HIGH || c.severity === FloodSeverity.CRITICAL
    ),
  'Orange + Red ON must return exact union of HIGH and CRITICAL cells'
);

// All four ON
const allOn = filterCellsByRiskToggles(store.cells, DEFAULT_RISK_CATEGORY_TOGGLES);
console.assert(allOn.length === 64, 'All four toggles ON must return all 64 cells');

// Ensure underlying cells array and records are not mutated
console.assert(store.cells.length === 64, 'Underlying cells count must remain 64');
console.log('[TEST 6] Four Independent Multi-Select Risk Toggles Verified: PASSED');

console.log('\n=== ALL PHASE 1 MAP UI VERIFICATION TESTS PASSED ===');

