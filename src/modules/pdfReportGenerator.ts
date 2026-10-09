import { jsPDF } from 'jspdf';
import {
  BASE_ROAD_SEGMENTS,
  BASE_SHELTERS,
  INTERSECTION_NODES,
  PILOT_BOUNDS,
  PILOT_SCOPE_ID,
} from '../data/indorePilotData';
import {
  getVerifiedHistoricalRecordsForCell,
  HistoricalResponseRecord,
} from '../data/indoreHistoricalRecords';
import {
  AlertItem,
  DataHealthReport,
  DisasterStage,
  EvacuationPlanItem,
  FloodRiskCell,
  FloodSeverity,
  ProductMode,
  RoadSegmentState,
  RoadStatus,
  RouteRecommendation,
  ScenarioParameters,
  SensorNode,
  Shelter,
  WarningLevel,
} from '../types/idhara';
import {
  computeSingleRoute,
  findNearestNodeForCell,
} from './routing';

export type ReportingPeriod =
  | 'CURRENT_6H'
  | 'PAST_24H'
  | 'NEXT_12H_FORECAST'
  | 'FULL_INCIDENT';

export interface LocationPdfOptions {
  cell: FloodRiskCell;
  cells: FloodRiskCell[];
  roads: RoadSegmentState[];
  sensors: SensorNode[];
  alerts: AlertItem[];
  dataHealthReport: DataHealthReport;
  params?: ScenarioParameters;
  shelters?: Shelter[];
  evacuationPlans?: EvacuationPlanItem[];
  routes?: RouteRecommendation[];
  reportingPeriod?: ReportingPeriod;
  includeSensorAudit?: boolean;
  includeRoadDisruptions?: boolean;
  includeAlertsSummary?: boolean;
  includeEvacuationRoute?: boolean;
  includeHistoricalEvents?: boolean;
  includePrecautionsPlan?: boolean;
  includeSpatialGridVisual?: boolean;
}

export const REPORTING_PERIOD_LABELS: Record<ReportingPeriod, string> = {
  CURRENT_6H: 'Current Active Window (Past 6 Hours)',
  PAST_24H: 'Historical 24-Hour Cumulative Runoff',
  NEXT_12H_FORECAST: 'Predictive 12-Hour Inundation Outlook',
  FULL_INCIDENT: 'Comprehensive Incident Lifecycle Log',
};

// Exact risk color mapping
export const RISK_COLORS: Record<
  FloodSeverity,
  { bg: [number, number, number]; text: [number, number, number]; hex: string; label: string }
> = {
  [FloodSeverity.LOW]: {
    bg: [22, 163, 74],
    text: [255, 255, 255],
    hex: '#16A34A',
    label: 'LOW RISK (GREEN)',
  },
  [FloodSeverity.MODERATE]: {
    bg: [202, 138, 4],
    text: [255, 255, 255],
    hex: '#CA8A04',
    label: 'MODERATE RISK (YELLOW)',
  },
  [FloodSeverity.HIGH]: {
    bg: [234, 88, 12],
    text: [255, 255, 255],
    hex: '#EA580C',
    label: 'HIGH RISK (ORANGE)',
  },
  [FloodSeverity.CRITICAL]: {
    bg: [220, 38, 38],
    text: [255, 255, 255],
    hex: '#DC2626',
    label: 'CRITICAL RISK (RED)',
  },
};

/**
 * Generates an executive-grade, publication-ready Flood Risk & Resilience Assessment Report
 * for a specific Indore pilot catchment cell.
 */
export function generateLocationDossierPdf(options: LocationPdfOptions): jsPDF {
  const {
    cell,
    cells,
    roads,
    sensors,
    alerts,
    dataHealthReport,
    params,
    shelters = [],
    routes = [],
    reportingPeriod = 'CURRENT_6H',
    includeSensorAudit = true,
    includeRoadDisruptions = true,
    includeAlertsSummary = true,
    includeEvacuationRoute = true,
    includeHistoricalEvents = true,
    includePrecautionsPlan = true,
    includeSpatialGridVisual = true,
  } = options;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2; // 182mm
  const bottomThreshold = pageHeight - margin - 12; // 271mm
  let currentY = margin;

  const runTimestamp = new Date();
  const runTimestampIso = runTimestamp.toISOString();
  const runTimestampFormatted = runTimestamp.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }) + ' IST';

  // Surrounding context lookups
  const localRoads = roads.filter(
    (r) =>
      r.adjacentCellIds.includes(cell.id) ||
      r.name.toLowerCase().includes(cell.localityName.toLowerCase())
  );
  const roadsToAudit = localRoads.length > 0 ? localRoads : roads.slice(0, 4);

  const localSensors = sensors.filter(
    (s) =>
      s.cellId === cell.id ||
      (Math.abs(s.lat - cell.lat) < 0.018 && Math.abs(s.lng - cell.lng) < 0.018)
  );
  const sensorsToAudit = localSensors.length > 0 ? localSensors : sensors.slice(0, 4);

  const locLower = cell.localityName.toLowerCase();
  const cellIdLower = cell.id.toLowerCase();
  const localAlerts = alerts.filter(
    (a) =>
      a.location?.toLowerCase().includes(locLower) ||
      a.location?.toLowerCase().includes(cellIdLower) ||
      a.title?.toLowerCase().includes(locLower) ||
      a.affectedLocalities?.some((loc) => loc.toLowerCase().includes(locLower))
  );

  // Evacuation routing calculation
  const originNode = findNearestNodeForCell(cell);
  const targetShelterId = cell.nearestShelterId || 'SH-01';
  const assignedShelter =
    shelters.find((s) => s.id === targetShelterId) ||
    BASE_SHELTERS.find((s) => s.id === targetShelterId) ||
    BASE_SHELTERS[0];

  const shelterNodeId =
    assignedShelter && 'nearestNodeId' in assignedShelter && assignedShelter.nearestNodeId
      ? (assignedShelter as any).nearestNodeId
      : targetShelterId === 'SH-01'
      ? 'NODE-CHIMANBAGH'
      : targetShelterId === 'SH-02'
      ? 'NODE-PALASIA'
      : targetShelterId === 'SH-03'
      ? 'NODE-COLLECTORATE'
      : 'NODE-NAVALAKHA';

  const routeScenarioParams: ScenarioParameters = params || {
    mode: ProductMode.SIMULATED,
    stage: DisasterStage.REAL_TIME_ONGOING,
    rainfallIntensityMmHr: cell.rainfallMmHr,
    durationHours: 3,
    drainageBlockagePct: 40,
    upstreamKahnInflowMultiplier: 1.25,
    sensorDropoutCount: 0,
    timelineHourOffset: 0,
    activeEventPresetId: 'EVT-SIM-MONSOON-SURGE',
  };

  const calculatedRouteRecommendation = computeSingleRoute(
    originNode.id,
    shelterNodeId,
    roads,
    routeScenarioParams,
    'AMBULANCE'
  );

  // Verified historical response records (if any exist for this specific cell)
  const verifiedHistRecords = getVerifiedHistoricalRecordsForCell(cell.id);

  // Helper: check space and add page if needed
  const ensureSpace = (heightNeeded: number) => {
    if (currentY + heightNeeded > bottomThreshold) {
      doc.addPage();
      currentY = margin + 14; // Leave room for running header on subsequent pages
    }
  };

  // Helper: draw section banner
  const drawSectionHeader = (categoryTag: string, title: string) => {
    ensureSpace(14);
    doc.setFillColor(15, 23, 42); // Slate 900
    doc.rect(margin, currentY, contentWidth, 7, 'F');

    doc.setFillColor(6, 182, 212); // Cyan accent bar
    doc.rect(margin, currentY, 2.5, 7, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(34, 211, 238); // Cyan
    doc.text(categoryTag.toUpperCase(), margin + 5, currentY + 4.8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(248, 250, 252);
    doc.text(title.toUpperCase(), margin + 58, currentY + 4.8);

    currentY += 10;
  };

  // =========================================================================
  // PAGE 1: COVER PAGE & EXECUTIVE SUMMARY
  // =========================================================================

  // Dark Mission Top Header
  doc.setFillColor(8, 14, 28);
  doc.rect(0, 0, pageWidth, 32, 'F');

  // Vector Logo Emblem
  doc.setFillColor(6, 182, 212);
  doc.roundedRect(margin, 7, 10, 10, 2, 2, 'F');
  doc.setFillColor(8, 14, 28);
  doc.triangle(margin + 2.5, 15, margin + 5, 9, margin + 7.5, 15, 'F');
  doc.setFillColor(34, 211, 238);
  doc.circle(margin + 5, 11.5, 1.3, 'F');

  // Brand Name & Program Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text('iDhara', margin + 13, 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184); // Slate 400
  doc.text('URBAN FLOOD EARLY WARNING & RESILIENCE TWIN', margin + 30, 13);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(34, 211, 238);
  doc.text(
    'FLOOD RISK & RESILIENCE ASSESSMENT REPORT',
    margin,
    23
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `PILOT BASIN: CENTRAL INDORE 5×5 KM ZONE · DOSSIER RUN: ${runTimestampFormatted}`,
    margin,
    28
  );

  currentY = 38;

  // Locality Identification Card
  doc.setFillColor(248, 250, 252); // Off white
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, currentY, contentWidth, 26, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `${cell.localityName} (${cell.wardCode} · ${cell.id})`,
    margin + 5,
    currentY + 7
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Geographic Location: ${cell.lat.toFixed(4)}° N, ${cell.lng.toFixed(4)}° E | Basin Grid: Row ${cell.row}, Col ${cell.col} | Elevation: ${cell.elevationM}m MSL`,
    margin + 5,
    currentY + 13
  );
  doc.text(
    `Catchment Soil & Land Use: ${cell.landUse} | Impervious Cover: ${(cell.imperviousness * 100).toFixed(0)}% | Drainage Capacity Proxy: ${(cell.drainageProxyScore * 100).toFixed(0)}%`,
    margin + 5,
    currentY + 18
  );
  doc.text(
    `Reporting Window: ${REPORTING_PERIOD_LABELS[reportingPeriod]} | Scope ID: ${PILOT_SCOPE_ID} | Mode: ${cell.mode}`,
    margin + 5,
    currentY + 23
  );

  currentY += 30;

  // Hero Risk Category & Score Block
  const riskMeta = RISK_COLORS[cell.severity];
  doc.setFillColor(riskMeta.bg[0], riskMeta.bg[1], riskMeta.bg[2]);
  doc.roundedRect(margin, currentY, contentWidth, 19, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text(
    `OVERALL RISK CLASSIFICATION: ${riskMeta.label}`,
    margin + 5,
    currentY + 7
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  const probPercent = Math.round(cell.floodProbability * 100);
  doc.text(`${probPercent}%`, margin + contentWidth - 25, currentY + 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    `Flood Probability Score: ${probPercent}/100 | Warning Level: ${cell.warningLevel} | Directive: ${
      cell.warningHysteresis?.actionDirective || 'MONITOR & MAINTAIN SURVEILLANCE'
    }`,
    margin + 5,
    currentY + 14
  );

  currentY += 23;

  // Executive Summary Narrative Box
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, currentY, contentWidth, 34, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('EXECUTIVE RISK SUMMARY & STRATEGIC OVERVIEW', margin + 4, currentY + 6);

  const forecastLeadText =
    cell.leadTimeMin > 0
      ? `Forecast horizon indicates potential peak crest within ~${cell.leadTimeMin} minutes (${cell.expectedOnsetLabel}).`
      : 'Immediate flood inundation risk active; rapid surface accumulation underway.';

  const execSummaryLines = [
    `• RECORDED OBSERVATIONS: Current local rainfall stands at ${cell.rainfallMmHr} mm/h (cumulative ${cell.cumulativeRainfallMm} mm). Drainage proxy indicates ${(cell.drainageProxyScore * 100).toFixed(0)}% capacity. Catchment imperviousness is ${(cell.imperviousness * 100).toFixed(0)}%.`,
    `• MODEL PREDICTIONS: iDhara hydrodynamic model forecasts a flood probability of ${probPercent}% (Severity: ${cell.severity}, uncertainty ±${Math.round(cell.uncertaintyBand * 100)}%). Estimated peak inundation depth: ${cell.predictedDepthCm} cm. ${forecastLeadText}`,
    `• PRIORITY ACTION: ${
      cell.severity === FloodSeverity.CRITICAL || cell.severity === FloodSeverity.HIGH
        ? 'ACTIVATE EMERGENCY RESPONSE: Restrict transit across low-level culverts/bridges, mobilize dewatering units, alert residents, and stage designated high-ground shelters.'
        : 'CONTINUOUS MONITORING: Maintain automated telemetry watch, inspect storm grates, and ensure clear runoff discharge paths.'
    }`,
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  let summaryLineY = currentY + 12;
  execSummaryLines.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, contentWidth - 8);
    doc.text(wrapped, margin + 4, summaryLineY);
    summaryLineY += wrapped.length * 4.2;
  });

  currentY += 38;

  // Four Core KPI Metric Cards
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('KEY HAZARD & OPERATIONAL TELEMETRY INDICATORS', margin, currentY);
  currentY += 4;

  const kpiWidth = (contentWidth - 9) / 4;
  const kpiCards = [
    {
      title: 'FLOOD PROBABILITY',
      value: `${probPercent}%`,
      subtitle: `Predicted: ${cell.predictedDepthCm} cm depth`,
      color: riskMeta.bg,
    },
    {
      title: 'RAINFALL INTENSITY',
      value: `${cell.rainfallMmHr} mm/h`,
      subtitle: `Cumulative: ${cell.cumulativeRainfallMm} mm`,
      color: [2, 132, 199] as [number, number, number],
    },
    {
      title: 'POPULATION AT RISK',
      value: `~${cell.populationEstimate.toLocaleString()}`,
      subtitle: `Historical 10-Yr: ${cell.historicalFloodCount10Yr} events`,
      color: [79, 70, 229] as [number, number, number],
    },
    {
      title: 'TELEMETRY HEALTH',
      value: `${dataHealthReport.overallHealthPct}%`,
      subtitle: `Model Conf: ${Math.round(cell.confidence * 100)}%`,
      color:
        dataHealthReport.overallHealthPct >= 80
          ? ([22, 163, 74] as [number, number, number])
          : ([217, 119, 6] as [number, number, number]),
    },
  ];

  kpiCards.forEach((kpi, idx) => {
    const xPos = margin + idx * (kpiWidth + 3);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(xPos, currentY, kpiWidth, 21, 1.5, 1.5, 'FD');

    // Colored top border stripe
    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.rect(xPos, currentY, kpiWidth, 1.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.title, xPos + 3, currentY + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.value, xPos + 3, currentY + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(71, 85, 105);
    doc.text(kpi.subtitle, xPos + 3, currentY + 18);
  });

  currentY += 27;

  // Primary Hydrological Drivers (Top Drivers Table)
  drawSectionHeader(
    'Section 01 · Hydrological Drivers',
    'Primary Flood Inundation Contributing Factors'
  );

  // Table header
  doc.setFillColor(226, 232, 240);
  doc.rect(margin, currentY, contentWidth, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);
  doc.text('Factor / Mechanism', margin + 3, currentY + 4.2);
  doc.text('Influence Weight', margin + 55, currentY + 4.2);
  doc.text('Status', margin + 90, currentY + 4.2);
  doc.text('Hydrological Explanation & Impact', margin + 125, currentY + 4.2);
  currentY += 7;

  cell.topDrivers.slice(0, 3).forEach((driver, idx) => {
    ensureSpace(8);
    doc.setFillColor(idx % 2 === 0 ? 255 : 248, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
    doc.rect(margin, currentY, contentWidth, 7.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(driver.factor, margin + 3, currentY + 5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(2, 132, 199);
    doc.text(`${driver.weight}% Impact`, margin + 55, currentY + 5);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(driver.direction === 'aggravating' ? 220 : 22, driver.direction === 'aggravating' ? 38 : 163, driver.direction === 'aggravating' ? 38 : 74);
    doc.text(driver.direction === 'aggravating' ? 'AGGRAVATING' : 'MITIGATING', margin + 90, currentY + 5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    const descWrapped = doc.splitTextToSize(driver.description, contentWidth - 128);
    doc.text(descWrapped[0] || driver.description, margin + 125, currentY + 5);

    currentY += 8;
  });

  // End of Page 1 footer mark
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    'Continued on Page 2: Spatial Risk-Grid Visual, Connected Corridors & Telemetry Audit →',
    margin,
    pageHeight - margin - 3
  );

  // =========================================================================
  // PAGE 2: SPATIAL RISK GRID VISUAL & LOCAL SENSOR TELEMETRY AUDIT
  // =========================================================================
  doc.addPage();
  currentY = margin + 14;

  if (includeSpatialGridVisual) {
    drawSectionHeader(
      'Section 02 · Geospatial Intelligence',
      'Indore Basin 8×8 Catchment Risk-Grid Mini-Map'
    );

    // Grid layout coordinates
    const gridOriginX = margin + 4;
    const gridOriginY = currentY + 2;
    const cellSize = 10.5; // 8 * 10.5 = 84mm width & height
    const gridWidth = cellSize * 8;
    const gridHeight = cellSize * 8;

    // Grid background
    doc.setFillColor(10, 15, 26); // Dark geospatial background
    doc.roundedRect(gridOriginX - 2, gridOriginY - 2, gridWidth + 4, gridHeight + 4, 1.5, 1.5, 'F');

    // Draw all 64 cells
    cells.forEach((c) => {
      const cellX = gridOriginX + c.col * cellSize;
      const cellY = gridOriginY + c.row * cellSize;
      const isTarget = c.id === cell.id;

      // Fill color by severity
      let cellColor: [number, number, number] = [30, 41, 59]; // Low: slate
      if (c.severity === FloodSeverity.CRITICAL) cellColor = [220, 38, 38];
      else if (c.severity === FloodSeverity.HIGH) cellColor = [234, 88, 12];
      else if (c.severity === FloodSeverity.MODERATE) cellColor = [202, 138, 4];

      doc.setFillColor(cellColor[0], cellColor[1], cellColor[2]);
      doc.rect(cellX + 0.4, cellY + 0.4, cellSize - 0.8, cellSize - 0.8, 'F');

      // Grid line
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.2);
      doc.rect(cellX + 0.4, cellY + 0.4, cellSize - 0.8, cellSize - 0.8, 'D');

      // If target cell: draw bold cyan highlight border & marker
      if (isTarget) {
        doc.setDrawColor(34, 211, 238); // Cyan
        doc.setLineWidth(0.8);
        doc.rect(cellX, cellY, cellSize, cellSize, 'D');
        doc.setFillColor(255, 255, 255);
        doc.circle(cellX + cellSize / 2, cellY + cellSize / 2, 1.2, 'F');
      }

      // Small text: ID & Prob
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(4.5);
      doc.setTextColor(255, 255, 255);
      doc.text(`R${c.row}C${c.col}`, cellX + 1.2, cellY + 3.8);
      doc.setFont('helvetica', 'bold');
      doc.text(`${Math.round(c.floodProbability * 100)}%`, cellX + 1.2, cellY + 7.8);
    });

    // River flow vector lines across grid
    // Kahn River: Col 4, Row 7 -> Col 3, Row 5 -> Col 2, Row 2 -> Col 2, Row 0
    doc.setDrawColor(56, 189, 248); // Sky blue
    doc.setLineWidth(0.7);
    const kahnPoints = [
      { x: gridOriginX + 4.5 * cellSize, y: gridOriginY + 7.8 * cellSize },
      { x: gridOriginX + 4.2 * cellSize, y: gridOriginY + 6.2 * cellSize },
      { x: gridOriginX + 3.6 * cellSize, y: gridOriginY + 4.5 * cellSize },
      { x: gridOriginX + 2.5 * cellSize, y: gridOriginY + 2.5 * cellSize },
      { x: gridOriginX + 2.5 * cellSize, y: gridOriginY + 0.2 * cellSize },
    ];
    for (let i = 0; i < kahnPoints.length - 1; i++) {
      doc.line(kahnPoints[i].x, kahnPoints[i].y, kahnPoints[i + 1].x, kahnPoints[i + 1].y);
    }

    // Saraswati River: Col 1, Row 7 -> Col 1.5, Row 4 -> Col 2.5, Row 2.5 (Confluence)
    doc.setDrawColor(96, 165, 250);
    doc.setLineWidth(0.5);
    const saraPoints = [
      { x: gridOriginX + 1.5 * cellSize, y: gridOriginY + 7.6 * cellSize },
      { x: gridOriginX + 1.6 * cellSize, y: gridOriginY + 5.5 * cellSize },
      { x: gridOriginX + 2.0 * cellSize, y: gridOriginY + 3.5 * cellSize },
      { x: gridOriginX + 2.5 * cellSize, y: gridOriginY + 2.5 * cellSize },
    ];
    for (let i = 0; i < saraPoints.length - 1; i++) {
      doc.line(saraPoints[i].x, saraPoints[i].y, saraPoints[i + 1].x, saraPoints[i + 1].y);
    }

    // Side details panel next to grid
    const sideX = gridOriginX + gridWidth + 8;
    const sideWidth = contentWidth - (gridWidth + 12);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('GEOSPATIAL CATCHMENT CONTEXT', sideX, gridOriginY + 4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    const sideText = [
      `Target Sector: ${cell.localityName} (${cell.wardCode})`,
      `Grid Index: Row ${cell.row}, Column ${cell.col} (Cell ${cell.id})`,
      `Basin Bounds: ${PILOT_BOUNDS.minLat}°N to ${PILOT_BOUNDS.maxLat}°N, ${PILOT_BOUNDS.minLng}°E to ${PILOT_BOUNDS.maxLng}°E (~25 km² area).`,
      `Distance to River Channel: ~${cell.distanceToRiverM} meters`,
      `River Confluence: Saraswati meets Kahn River at Krishnapura (R2, C2).`,
      `Topographic Gradient: High ridge in East (Palasia, 558m) slopes toward Central Confluence (544m MSL).`,
    ];

    let sideTextY = gridOriginY + 10;
    sideText.forEach((st) => {
      const wrapped = doc.splitTextToSize(`• ${st}`, sideWidth);
      doc.text(wrapped, sideX, sideTextY);
      sideTextY += wrapped.length * 3.8 + 1;
    });

    // Mini Legend below the grid
    const legY = gridOriginY + gridHeight + 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(71, 85, 105);
    doc.text('MAP LEGEND:', margin + 4, legY);

    const legendItems = [
      { label: 'Low (<25%)', color: [30, 41, 59] },
      { label: 'Moderate (25-45%)', color: [202, 138, 4] },
      { label: 'High (45-70%)', color: [234, 88, 12] },
      { label: 'Critical (≥70%)', color: [220, 38, 38] },
      { label: 'Target Cell', color: [34, 211, 238] },
    ];

    legendItems.forEach((item, lIdx) => {
      const lx = margin + 26 + lIdx * 30;
      doc.setFillColor(item.color[0], item.color[1], item.color[2]);
      doc.rect(lx, legY - 2.5, 3.5, 3.5, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(51, 65, 85);
      doc.text(item.label, lx + 5, legY);
    });

    currentY = legY + 8;
  }

  // Local Sensor Telemetry & Freshness Audit
  if (includeSensorAudit) {
    drawSectionHeader(
      'Section 03 · Telemetry & Freshness',
      'Local IoT Sensor Freshness & Calibration Audit'
    );

    // Table Header
    doc.setFillColor(226, 232, 240);
    doc.rect(margin, currentY, contentWidth, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text('Sensor Node / Station Name', margin + 3, currentY + 4.2);
    doc.text('Type', margin + 55, currentY + 4.2);
    doc.text('Freshness State', margin + 85, currentY + 4.2);
    doc.text('Current Reading', margin + 115, currentY + 4.2);
    doc.text('Diagnostic Status / Confidence', margin + 145, currentY + 4.2);
    currentY += 7;

    sensorsToAudit.forEach((s, idx) => {
      ensureSpace(7.5);
      doc.setFillColor(idx % 2 === 0 ? 255 : 248, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
      doc.rect(margin, currentY, contentWidth, 7, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(15, 23, 42);
      doc.text(`${s.id} — ${s.name.substring(0, 24)}`, margin + 3, currentY + 4.8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text(s.type.replace('_', ' '), margin + 55, currentY + 4.8);

      // Freshness label with color
      if (s.freshnessState === 'FRESH') doc.setTextColor(22, 163, 74);
      else if (s.freshnessState === 'STALE') doc.setTextColor(202, 138, 4);
      else doc.setTextColor(220, 38, 38);
      doc.setFont('helvetica', 'bold');
      doc.text(s.freshnessState, margin + 85, currentY + 4.8);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(`${s.currentValue} ${s.unit}`, margin + 115, currentY + 4.8);

      doc.setTextColor(71, 85, 105);
      doc.text(`${s.diagnosticNote.substring(0, 20)} (${Math.round(s.confidence * 100)}%)`, margin + 145, currentY + 4.8);

      currentY += 7.5;
    });

    currentY += 2;
  }

  // Active Directives & Emergency Alerts
  if (includeAlertsSummary) {
    drawSectionHeader(
      'Section 04 · Operational Directives',
      'Active Command Alerts & Public Warning Dispatches'
    );

    if (localAlerts.length === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, currentY, contentWidth, 10, 'F');
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        'No active critical emergency alerts published specifically for this grid cell at this timestamp.',
        margin + 4,
        currentY + 6.5
      );
      currentY += 13;
    } else {
      localAlerts.slice(0, 2).forEach((al) => {
        ensureSpace(14);
        doc.setFillColor(254, 242, 242); // Red tint
        doc.setDrawColor(252, 165, 165);
        doc.roundedRect(margin, currentY, contentWidth, 13, 1.5, 1.5, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.8);
        doc.setTextColor(185, 28, 28);
        doc.text(`[${al.warningLevel}] ${al.id}: ${al.title}`, margin + 4, currentY + 4.5);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.2);
        doc.setTextColor(51, 65, 85);
        const actionLines = doc.splitTextToSize(
          `Directive: ${al.recommendedAction} (Confirmed by ${al.humanConfirmedBy || al.source || 'EOC Duty Officer'})`,
          contentWidth - 8
        );
        doc.text(actionLines, margin + 4, currentY + 9);

        currentY += 15;
      });
    }
  }

  // =========================================================================
  // PAGE 3: EVACUATION ROUTE ASSESSMENT & ROAD NETWORK MOBILITY
  // =========================================================================
  doc.addPage();
  currentY = margin + 14;

  if (includeEvacuationRoute) {
    drawSectionHeader(
      'Section 05 · Evacuation Routes',
      'Evacuation Route Assessment (Historical, Current & Alternative)'
    );

    // Evacuation destination banner
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, currentY, contentWidth, 18, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `ASSIGNED REFUGE DESTINATION: ${assignedShelter.name}`,
      margin + 4,
      currentY + 5.5
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Shelter ID: ${assignedShelter.id} | Location: Ward ${assignedShelter.ward} | Elevation: ${assignedShelter.elevationM}m MSL (High Ground)`,
      margin + 4,
      currentY + 10.5
    );
    doc.text(
      `Capacity: ${assignedShelter.totalCapacity} berths | Drinking Water: ${(assignedShelter as any).drinkingWaterLiters?.toLocaleString() || 15000}L | Medical Team: ${(assignedShelter as any).medicalTeamPresent ? 'PRESENT ON-SITE' : 'ON-CALL'}`,
      margin + 4,
      currentY + 15
    );

    currentY += 22;

    // --- CATEGORY A: HISTORICAL ROUTE USED ---
    ensureSpace(24);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, contentWidth, 22, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text('A. HISTORICAL EVACUATION ROUTE USED [HISTORICAL RECORD]', margin + 4, currentY + 5);

    const histRecWithRoute = verifiedHistRecords.find((r) => r.routesActuallyUsed);
    if (histRecWithRoute) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(51, 65, 85);
      const histRouteText = [
        `• Documented Incident: ${histRecWithRoute.eventTitle} (${histRecWithRoute.eventDate})`,
        `• Route Path Used: ${histRecWithRoute.routesActuallyUsed}`,
        `• Shelter Destination: ${histRecWithRoute.sheltersOrDestinationsUsed}`,
        `• Source Reference: ${histRecWithRoute.sourceReference} (Record ID: ${histRecWithRoute.recordId})`,
      ];
      let hy = currentY + 9.5;
      histRouteText.forEach((hrt) => {
        const wrp = doc.splitTextToSize(hrt, contentWidth - 8);
        doc.text(wrp, margin + 4, hy);
        hy += wrp.length * 3.5;
      });
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.2);
      doc.setTextColor(100, 116, 139);
      doc.text(
        'No verified historical evacuation route records exist for this location.',
        margin + 4,
        currentY + 12
      );
    }

    currentY += 26;

    // --- CATEGORY B: CURRENT RECOMMENDED ROUTE ---
    ensureSpace(32);
    const isRouteFeasible = calculatedRouteRecommendation.feasible;
    doc.setFillColor(isRouteFeasible ? 240 : 254, isRouteFeasible ? 253 : 242, isRouteFeasible ? 250 : 242);
    doc.setDrawColor(isRouteFeasible ? 187 : 252, isRouteFeasible ? 247 : 165, isRouteFeasible ? 208 : 165);
    doc.roundedRect(margin, currentY, contentWidth, 30, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(isRouteFeasible ? 22 : 185, isRouteFeasible ? 101 : 28, isRouteFeasible ? 52 : 28);
    doc.text(
      isRouteFeasible
        ? 'B. CURRENT RECOMMENDED EVACUATION ROUTE [CALCULATED ROUTE]'
        : 'B. NO FEASIBLE EVACUATION ROUTE AVAILABLE [ROUTE SEVERED]',
      margin + 4,
      currentY + 5
    );

    if (isRouteFeasible && calculatedRouteRecommendation.primaryRoute) {
      const pr = calculatedRouteRecommendation.primaryRoute;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(30, 41, 59);

      const routeLines = [
        `• Start Point: ${originNode.name} (${originNode.elevationM}m MSL) ➔ Destination: ${assignedShelter.name}`,
        `• Calculated Distance: ${pr.distanceKm} km | Estimated Transit Time: ${pr.travelTimeMin} minutes (includes flood risk penalty)`,
        `• Corridor Path: ${pr.roadNames.join(' ➔ ')}`,
        `• Hazard Avoidance: Diverted around CLOSED or submerged corridors under ${calculatedRouteRecommendation.travelProfile} safety policy.`,
        `• Limitations & Validity: Generated via Dijkstra shortest-path solver. Expiry: ${calculatedRouteRecommendation.expiry} (Conf: ${Math.round(calculatedRouteRecommendation.confidence * 100)}%).`,
      ];

      let ry = currentY + 9.5;
      routeLines.forEach((rl) => {
        const wrp = doc.splitTextToSize(rl, contentWidth - 8);
        doc.text(wrp, margin + 4, ry);
        ry += wrp.length * 3.6;
      });
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(185, 28, 28);
      const noRouteInfo = calculatedRouteRecommendation.noRouteInfo;
      const noRouteLines = [
        `• Reason: ${noRouteInfo?.reason || 'All egress corridors from origin are blocked by CLOSED or flooded road segments.'}`,
        `• Blocked Corridors: ${noRouteInfo?.blockingRoadNames?.slice(0, 3).join(', ') || 'Corridors impassable'}`,
        `• Safety Directive: Seek refuge on the highest local reinforced concrete structure or upper floors immediately.`,
        `• Verification Requirement: Do NOT attempt to wade or drive across flooded roads. Await instructions from authorized emergency responders.`,
      ];
      let nry = currentY + 9.5;
      noRouteLines.forEach((nrl) => {
        const wrp = doc.splitTextToSize(nrl, contentWidth - 8);
        doc.text(wrp, margin + 4, nry);
        nry += wrp.length * 3.6;
      });
    }

    currentY += 34;

    // --- CATEGORY C: ALTERNATIVE ROUTE ---
    ensureSpace(22);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, contentWidth, 20, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text('C. ALTERNATIVE EVACUATION ROUTE [CALCULATED ROUTE]', margin + 4, currentY + 5);

    if (calculatedRouteRecommendation.alternativeRoute) {
      const alt = calculatedRouteRecommendation.alternativeRoute;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(51, 65, 85);
      const altLines = [
        `• Secondary Bypass Path: ${alt.roadNames.join(' ➔ ')}`,
        `• Alternative Distance: ${alt.distanceKm} km | ETA: ${alt.travelTimeMin} min (+${alt.totalRiskPenaltyMin}m risk delay)`,
        `• Safety Notice: Use only if the primary recommended corridor is obstructed on the ground.`,
      ];
      let ay = currentY + 9.5;
      altLines.forEach((al) => {
        const wrp = doc.splitTextToSize(al, contentWidth - 8);
        doc.text(wrp, margin + 4, ay);
        ay += wrp.length * 3.5;
      });
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.2);
      doc.setTextColor(100, 116, 139);
      doc.text(
        'No viable alternative bypass route exists without traversing high-hazard or closed road segments.',
        margin + 4,
        currentY + 11
      );
    }

    currentY += 24;

    // Route Uncertainty & Safety Disclaimer Box
    ensureSpace(13);
    doc.setFillColor(254, 243, 199); // Amber tint
    doc.setDrawColor(245, 158, 11);
    doc.roundedRect(margin, currentY, contentWidth, 11, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(180, 83, 9);
    doc.text('ROUTE SAFETY NOTICE & UNCERTAINTY ADVISORY', margin + 4, currentY + 4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(120, 53, 15);
    doc.text(
      'Calculated routes reflect model predictions and available sensor telemetry. Never guarantee route safety during active monsoons. Moving water over 15cm can stall vehicles. Always follow real-time instructions from traffic police and emergency personnel.',
      margin + 4,
      currentY + 8
    );

    currentY += 15;
  }

  // Connected Road Corridors Impact Table
  if (includeRoadDisruptions) {
    drawSectionHeader(
      'Section 06 · Road Mobility',
      'Connected Road Network & Corridor Inundation Status'
    );

    doc.setFillColor(226, 232, 240);
    doc.rect(margin, currentY, contentWidth, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text('Road Corridor / Street Segment', margin + 3, currentY + 4.2);
    doc.text('Corridor Type', margin + 65, currentY + 4.2);
    doc.text('Mobility Status', margin + 105, currentY + 4.2);
    doc.text('Est. Depth', margin + 135, currentY + 4.2);
    doc.text('Delay / Penalty', margin + 158, currentY + 4.2);
    currentY += 7;

    roadsToAudit.forEach((r, idx) => {
      ensureSpace(7);
      doc.setFillColor(idx % 2 === 0 ? 255 : 248, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
      doc.rect(margin, currentY, contentWidth, 6.5, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(15, 23, 42);
      doc.text(`${r.id} — ${r.name.substring(0, 28)}`, margin + 3, currentY + 4.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text(r.corridorType, margin + 65, currentY + 4.5);

      // Status color
      if (r.currentState === RoadStatus.CLOSED) doc.setTextColor(220, 38, 38);
      else if (r.currentState === RoadStatus.LIKELY_FLOODED) doc.setTextColor(234, 88, 12);
      else if (r.currentState === RoadStatus.AT_RISK) doc.setTextColor(202, 138, 4);
      else doc.setTextColor(22, 163, 74);
      doc.setFont('helvetica', 'bold');
      doc.text(r.currentState, margin + 105, currentY + 4.5);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(`${r.estimatedWaterDepthCm} cm`, margin + 135, currentY + 4.5);
      doc.text(`+${r.riskPenaltyMin} min`, margin + 158, currentY + 4.5);

      currentY += 7.2;
    });
  }

  // =========================================================================
  // PAGE 4: HISTORICAL FLOOD EVENTS & RECOMMENDED PRECAUTIONS
  // =========================================================================
  const isHighOrCritical =
    cell.severity === FloodSeverity.HIGH || cell.severity === FloodSeverity.CRITICAL;

  if (isHighOrCritical || includeHistoricalEvents || includePrecautionsPlan) {
    doc.addPage();
    currentY = margin + 14;

    // SECTION 7: HISTORICAL FLOOD EVENTS & RESPONSE ACTIONS
    if (includeHistoricalEvents) {
      drawSectionHeader(
        'Section 07 · Historical Intelligence',
        'Historical Flood Events & Response Actions'
      );

      if (verifiedHistRecords.length > 0) {
        verifiedHistRecords.forEach((hist) => {
          ensureSpace(42);
          doc.setFillColor(248, 250, 252);
          doc.setDrawColor(203, 213, 225);
          doc.roundedRect(margin, currentY, contentWidth, 38, 1.5, 1.5, 'FD');

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.2);
          doc.setTextColor(15, 23, 42);
          doc.text(`RECORD: ${hist.eventTitle} [HISTORICAL RECORD]`, margin + 4, currentY + 5);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(51, 65, 85);
          const histDetails = [
            `• Date & Rainfall: ${hist.eventDate} | ${hist.rainfallMetric}`,
            `• Recorded Inundation Conditions: ${hist.recordedFloodConditions}`,
            `• Precautions Taken: ${hist.precautionsTaken}`,
            `• Official Actions Performed: ${hist.actionsPerformedByAuthorities}`,
            `• Evacuation Measures: ${hist.evacuationMeasuresTaken}`,
            `• Routes Actually Used: ${hist.routesActuallyUsed} | Shelters: ${hist.sheltersOrDestinationsUsed}`,
            `• Source / Record ID: ${hist.sourceReference} (Archived: ${hist.timestamp})`,
          ];

          let hdy = currentY + 9;
          histDetails.forEach((hd) => {
            const wrp = doc.splitTextToSize(hd, contentWidth - 8);
            doc.text(wrp, margin + 4, hdy);
            hdy += wrp.length * 3.6;
          });

          currentY += 42;
        });
      } else {
        ensureSpace(22);
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(margin, currentY, contentWidth, 20, 1.5, 1.5, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.8);
        doc.setTextColor(71, 85, 105);
        doc.text(
          'No verified historical flood response records are available for this location in the current data sources.',
          margin + 4,
          currentY + 6
        );

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        const fallbackText = [
          `• 10-Year Catchment Flood Count: ${cell.historicalFloodCount10Yr} events catalogued in Indore municipal records.`,
          `• Local Terrain Context: ${cell.historicalContext || 'Standard urban watershed.'}`,
          `• Note: Multi-agency response action dossiers are maintained primarily for major confluence corridors (e.g. Krishnapura, Sarwate, Chandrabhaga).`,
        ];
        let fby = currentY + 10.5;
        fallbackText.forEach((ft) => {
          doc.text(ft, margin + 4, fby);
          fby += 3.8;
        });

        currentY += 24;
      }
    }

    // SECTION 8: RECOMMENDED PRECAUTIONS AND RESPONSE PLAN
    if (includePrecautionsPlan) {
      drawSectionHeader(
        'Section 08 · Action Plan',
        'Recommended Precautions & Response Plan'
      );

      ensureSpace(42);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(margin, currentY, contentWidth, 40, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(
        'ACTION PLAN MATRIX (PAST COMPLETED VS. FUTURE PREPAREDNESS)',
        margin + 4,
        currentY + 5
      );

      const planLines = [
        `• 1. SENSOR & WATERWAY MONITORING [RECOMMENDED ACTION]: Continuous telemetry monitoring of ultrasonic river stage gauge and AWS rain rates. Inspect roadside storm grates and culvert grates for solid waste throttles.`,
        `• 2. OFFICIAL WARNING DISSEMINATION [RECOMMENDED ACTION]: Broadcast targeted public advisories via Indore 311 app, SMS cellular cell-broadcast, and local public address systems in Ward ${cell.wardCode}.`,
        `• 3. VULNERABLE POPULATION SUPPORT [RECOMMENDED ACTION]: Identify elderly, non-ambulatory, and basement-dwelling residents (~${Math.round(cell.populationEstimate * 0.03)} estimated high-vulnerability individuals) for priority assistance.`,
        `• 4. EVACUATION DESTINATION READINESS [RECOMMENDED ACTION]: Verify readiness and supplies at ${assignedShelter.name} (${assignedShelter.elevationM}m MSL); confirm generator fuel and potability testing.`,
        `• 5. MOBILITY BARRICADES & DIVERSIONS [RECOMMENDED ACTION]: Close and barricade low-level underpasses and bridges if water depth exceeds 15cm; enforce traffic diversions via elevated bypass arteries.`,
        `• 6. EMERGENCY RESPONDER COORDINATION [RECOMMENDED ACTION]: Establish dedicated medical transit green corridors to MY Hospital and coordinate with SDRF rescue units at District EOC.`,
      ];

      let ply = currentY + 9.5;
      planLines.forEach((pl) => {
        const wrp = doc.splitTextToSize(pl, contentWidth - 8);
        doc.text(wrp, margin + 4, ply);
        ply += wrp.length * 3.6;
      });

      currentY += 44;
    }

    // SECTION 9: SOURCES, METHODOLOGY, AND DATA QUALITY
    drawSectionHeader(
      'Section 09 · Provenance & Methodology',
      'Sources, Methodology, Limitations & Verification'
    );

    ensureSpace(34);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, contentWidth, 32, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(15, 23, 42);
    doc.text('DATA SOURCES CATALOG & STATUS CLASSIFICATION', margin + 4, currentY + 5);

    const provLines = [
      `• IoT Sensor Telemetry [CURRENT OBSERVATION]: Real-time ultrasonic level sensors & tipping-bucket gauges provided by ISCDL & CEG Telemetry Mesh.`,
      `• Hydrodynamic Risk Model [MODEL PREDICTION]: Multi-factor empirical runoff & flood probability formulation incorporating DEM elevation, slope, imperviousness, and drainage proxy scores.`,
      `• Road Network & Routing Graph [CALCULATED ROUTE]: Flood-penalized Dijkstra pathfinding engine over Indore urban graph.`,
      `• Historical Incidents Archive [HISTORICAL RECORD]: Indore Municipal Corporation (IMC) Monsoon Incident Register & DDMA Post-Event Reports.`,
      `• Limitations & Operational Boundary: This report constitutes advisory decision support for emergency managers. Field observations supersede computational estimates.`,
    ];

    let pry = currentY + 9;
    provLines.forEach((prl) => {
      const wrp = doc.splitTextToSize(prl, contentWidth - 8);
      doc.text(wrp, margin + 4, pry);
      pry += wrp.length * 3.5;
    });

    currentY += 36;
  }

  // =========================================================================
  // TWO-PASS PAGE NUMBERING, RUNNING HEADERS & FOOTERS
  // =========================================================================
  const totalPages = doc.getNumberOfPages();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Running Header on Pages 2..N
    if (i > 1) {
      doc.setFillColor(8, 14, 28);
      doc.rect(0, 0, pageWidth, 10, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(34, 211, 238);
      doc.text('iDhara FLOOD RISK INTELLIGENCE DOSSIER', margin, 6.8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(203, 213, 225);
      doc.text(
        `SECTOR: ${cell.localityName.toUpperCase()} (${cell.wardCode}) | DATE: ${runTimestampFormatted}`,
        margin + 62,
        6.8
      );
    }

    // Running Footer on ALL Pages
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - margin + 2, pageWidth - margin, pageHeight - margin + 2);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `iDhara Urban Early Warning System · Indore 5×5 km Pilot · Generated: ${runTimestampIso.substring(0, 19)}Z`,
      margin,
      pageHeight - margin + 6.5
    );

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(
      `Page ${i} of ${totalPages}`,
      pageWidth - margin - 18,
      pageHeight - margin + 6.5
    );
  }

  return doc;
}
