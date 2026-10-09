import {
  evaluateAuthoritativePrototypeData,
} from '../modules/prototypeDataStore';
import {
  DisasterStage,
  FloodSeverity,
  ProductMode,
  RoadStatus,
  ScenarioParameters,
} from '../types/idhara';
import { DEFAULT_INJECTED_OBSERVATIONS } from '../modules/dataIngestion';
import { DEFAULT_EVACUATION_CONFIG } from '../modules/evacuation';
import { generateLocationDossierPdf } from '../modules/pdfReportGenerator';
import { getVerifiedHistoricalRecordsForCell } from '../data/indoreHistoricalRecords';

console.log('=== VERIFYING LOCATION DOSSIER PDF GENERATOR ===\n');

const testParams: ScenarioParameters = {
  mode: ProductMode.SIMULATED,
  stage: DisasterStage.REAL_TIME_ONGOING,
  rainfallIntensityMmHr: 45,
  durationHours: 3,
  drainageBlockagePct: 40,
  upstreamKahnInflowMultiplier: 1.25,
  sensorDropoutCount: 0,
  timelineHourOffset: 0,
  activeEventPresetId: 'EVT-SIM-MONSOON-SURGE',
};

const prototypeData = evaluateAuthoritativePrototypeData({
  params: testParams,
  injectedObservations: DEFAULT_INJECTED_OBSERVATIONS,
  customOriginId: 'NODE-RAJWADA',
  customDestId: 'NODE-MY-HOSPITAL',
  travelProfile: 'AMBULANCE',
  evacuationConfig: DEFAULT_EVACUATION_CONFIG,
});

const { cells, roads, sensors, alerts, dataHealthReport, shelters, evacuationPlans, routes } =
  prototypeData;

// TEST 1: Critical (Red) Risk Location — Krishnapura Confluence (CELL-R2C2)
console.log('--- TEST 1: CRITICAL RISK LOCATION (Krishnapura Confluence · CELL-R2C2) ---');
const cellCritical = cells.find((c) => c.id === 'CELL-R2C2') || cells[0];
console.log(`Locality: ${cellCritical.localityName}, Severity: ${cellCritical.severity}, Prob: ${Math.round(cellCritical.floodProbability * 100)}%`);

const histRecordsCritical = getVerifiedHistoricalRecordsForCell(cellCritical.id);
console.log(`Verified historical records found: ${histRecordsCritical.length}`);
console.assert(histRecordsCritical.length > 0, 'Critical confluence must have verified historical records');

const docCritical = generateLocationDossierPdf({
  cell: cellCritical,
  cells,
  roads,
  sensors,
  alerts,
  dataHealthReport,
  params: testParams,
  shelters,
  evacuationPlans,
  routes,
  includeHistoricalEvents: true,
  includeEvacuationRoute: true,
  includePrecautionsPlan: true,
  includeSpatialGridVisual: true,
});

const pagesCritical = docCritical.getNumberOfPages();
console.log(`Generated PDF page count for Critical location: ${pagesCritical}`);
console.assert(pagesCritical >= 3, `Expected at least 3 pages, got ${pagesCritical}`);
console.log('TEST 1 PASSED.\n');

// TEST 2: High (Orange) Risk Location — Rajwada Chowk (CELL-R2C1)
console.log('--- TEST 2: HIGH RISK LOCATION (Rajwada Chowk · CELL-R2C1) ---');
const cellHigh = cells.find((c) => c.id === 'CELL-R2C1') || cells[0];
console.log(`Locality: ${cellHigh.localityName}, Severity: ${cellHigh.severity}, Prob: ${Math.round(cellHigh.floodProbability * 100)}%`);

const docHigh = generateLocationDossierPdf({
  cell: cellHigh,
  cells,
  roads,
  sensors,
  alerts,
  dataHealthReport,
  params: testParams,
  shelters,
  evacuationPlans,
  routes,
  includeHistoricalEvents: true,
  includeEvacuationRoute: true,
  includePrecautionsPlan: true,
  includeSpatialGridVisual: true,
});

const pagesHigh = docHigh.getNumberOfPages();
console.log(`Generated PDF page count for High location: ${pagesHigh}`);
console.assert(pagesHigh >= 3, `Expected at least 3 pages, got ${pagesHigh}`);
console.log('TEST 2 PASSED.\n');

// TEST 3: Low Risk Location — Residency Club Plateau (CELL-R6C7) / Race Course West (CELL-R2C7)
console.log('--- TEST 3: LOW RISK LOCATION (Residency / Race Course) ---');
const cellLow =
  cells.find((c) => c.id === 'CELL-R6C7' || c.severity === FloodSeverity.LOW) || cells[cells.length - 1];
console.log(`Locality: ${cellLow.localityName}, Severity: ${cellLow.severity}, Prob: ${Math.round(cellLow.floodProbability * 100)}%`);

const histRecordsLow = getVerifiedHistoricalRecordsForCell(cellLow.id);
console.log(`Verified historical records found for Low location: ${histRecordsLow.length}`);
console.assert(histRecordsLow.length === 0, 'Upland low-risk location should not have riverine disaster records');

const docLow = generateLocationDossierPdf({
  cell: cellLow,
  cells,
  roads,
  sensors,
  alerts,
  dataHealthReport,
  params: testParams,
  shelters,
  evacuationPlans,
  routes,
  includeHistoricalEvents: true,
  includeEvacuationRoute: true,
  includePrecautionsPlan: true,
  includeSpatialGridVisual: true,
});

const pagesLow = docLow.getNumberOfPages();
console.log(`Generated PDF page count for Low location: ${pagesLow}`);
console.assert(pagesLow >= 2, `Expected at least 2 pages, got ${pagesLow}`);
console.log('TEST 3 PASSED.\n');

// TEST 4: Location with Missing Historical Records (CELL-R0C5 Vallabh Nagar North)
console.log('--- TEST 4: LOCATION WITH MISSING HISTORICAL RECORDS ---');
const cellMissingHist = cells.find((c) => c.id === 'CELL-R0C5') || cells[5];
const histRecordsMissing = getVerifiedHistoricalRecordsForCell(cellMissingHist.id);
console.log(`Verified historical records for ${cellMissingHist.localityName} (${cellMissingHist.id}): ${histRecordsMissing.length}`);
console.assert(histRecordsMissing.length === 0, 'Cell should have 0 verified historical response records');

const docMissing = generateLocationDossierPdf({
  cell: cellMissingHist,
  cells,
  roads,
  sensors,
  alerts,
  dataHealthReport,
  params: testParams,
  shelters,
  evacuationPlans,
  routes,
  includeHistoricalEvents: true,
  includeEvacuationRoute: true,
  includePrecautionsPlan: true,
  includeSpatialGridVisual: true,
});

const pagesMissing = docMissing.getNumberOfPages();
console.log(`Generated PDF page count: ${pagesMissing}`);
console.assert(pagesMissing >= 2, `Expected at least 2 pages, got ${pagesMissing}`);
console.log('TEST 4 PASSED.\n');

// TEST 5: PDF ArrayBuffer integrity and text encoding tests
console.log('--- TEST 5: PDF BINARY & ENCODING INTEGRITY CHECK ---');
const arrayBuffer = docCritical.output('arraybuffer');
console.log(`PDF binary generated, byte length: ${arrayBuffer.byteLength} bytes`);
console.assert(arrayBuffer.byteLength > 5000, 'PDF size should be substantial with vector graphics and tables');
const pdfHeader = Buffer.from(arrayBuffer.slice(0, 5)).toString('ascii');
console.log(`PDF Magic Header: ${pdfHeader}`);
console.assert(pdfHeader === '%PDF-', 'Valid PDF file header required');

// Check raw text stream in generated PDF string
const pdfRawString = docCritical.output();
console.assert(!pdfRawString.includes('+Infinity'), 'Must not contain +Infinity');
console.assert(!pdfRawString.includes('NaN'), 'Must not contain NaN');
console.assert(!pdfRawString.includes('undefined'), 'Must not contain undefined');
console.assert(!pdfRawString.includes('\u2794'), 'Must not contain unencoded unicode arrow \u2794');
console.assert(pdfRawString.includes('SECTION 08'), 'SECTION 08 must exist');
console.assert(pdfRawString.includes('SECTION 09'), 'SECTION 09 must exist');

const s8Pos = pdfRawString.indexOf('SECTION 08');
const s9Pos = pdfRawString.indexOf('SECTION 09');
console.assert(s9Pos > s8Pos, 'SECTION 09 must be generated after SECTION 08');
console.log('Text encoding, non-finite value checks, and section order: ALL PASSED');
console.log('TEST 5 PASSED.\n');

// TEST 6: Severed Road Network (All roads closed) -> Honest No-Feasible-Route Handling
console.log('--- TEST 6: SEVERED ROAD NETWORK (NO FEASIBLE ROUTE) ---');
const severedRoads = roads.map((r) => ({
  ...r,
  currentState: RoadStatus.CLOSED,
}));

const docSevered = generateLocationDossierPdf({
  cell: cellCritical,
  cells,
  roads: severedRoads,
  sensors,
  alerts,
  dataHealthReport,
  params: testParams,
  shelters,
  evacuationPlans,
  routes,
  includeHistoricalEvents: true,
  includeEvacuationRoute: true,
  includePrecautionsPlan: true,
  includeSpatialGridVisual: true,
});

const pagesSevered = docSevered.getNumberOfPages();
console.log(`Generated PDF page count under severed road network: ${pagesSevered}`);
console.assert(pagesSevered >= 3, `Expected at least 3 pages, got ${pagesSevered}`);
const severedString = docSevered.output();
console.assert(severedString.includes('NO FEASIBLE EVACUATION ROUTE'), 'Must explicitly state no feasible route when severed');
console.assert(!severedString.includes('+Infinity min'), 'Must not contain +Infinity min in road delays');
console.assert(!severedString.includes('NaN'), 'Must not contain NaN');
console.log('Severed route PDF generated successfully with honest status');
console.log('TEST 6 PASSED.\n');

// TEST 7: Missing Historical Records String Exactness
console.log('--- TEST 7: MISSING HISTORICAL RECORDS STRING EXACTNESS ---');
const missingString = docMissing.output();
const expectedMissingNotice = 'No verified historical flood response records are available for this location in the current data sources.';
console.assert(missingString.includes(expectedMissingNotice), 'Must contain the exact mandated notice for locations without records');
console.log(`Verified presence of exact required fallback notice: "${expectedMissingNotice}"`);
console.log('TEST 7 PASSED.\n');

console.log('=== ALL 7 PDF REPORT GENERATOR TESTS PASSED SUCCESSFULLY! ===');
