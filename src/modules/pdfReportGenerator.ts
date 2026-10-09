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
 * Sanitizes text to standard ASCII/WinAnsi compatible characters.
 * Replaces Unicode arrows, superscripts, degree signs, smart quotes, and dashes
 * so that default PDF fonts never render broken glyphs, question marks, or corrupted characters.
 */
export function sanitizePdfText(str: string | undefined | null): string {
  if (!str) return '';
  return String(str)
    .replace(/[➔→➜]/g, ' -> ')
    .replace(/[←◄]/g, ' <- ')
    .replace(/•/g, '-')
    .replace(/km²/g, 'sq km')
    .replace(/m²/g, 'sq m')
    .replace(/m³/g, 'cu m')
    .replace(/°/g, ' deg ')
    .replace(/±/g, '+/-')
    .replace(/–/g, '-')
    .replace(/—/g, ' -- ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

/**
 * Safely formats delay/penalty in minutes.
 * Replaces non-finite or extreme values (e.g. +Infinity min) with human-readable status.
 */
export function formatPenaltyMin(penaltyMin: number | undefined | null, roadState?: string): string {
  if (roadState === 'CLOSED') return 'Closed / Impasse';
  if (penaltyMin === undefined || penaltyMin === null || !Number.isFinite(penaltyMin)) {
    return 'N/A';
  }
  if (penaltyMin <= 0) return '0 min';
  return `+${penaltyMin.toFixed(1)} min`;
}

/**
 * Safely formats water depth in centimeters.
 */
export function formatDepthCm(depthCm: number | undefined | null): string {
  if (depthCm === undefined || depthCm === null || !Number.isFinite(depthCm)) {
    return 'N/A';
  }
  return `${Math.round(depthCm)} cm`;
}

/**
 * Safely formats transit travel times in minutes.
 */
export function formatTransitTime(timeMin: number | undefined | null): string {
  if (timeMin === undefined || timeMin === null || !Number.isFinite(timeMin) || timeMin >= 9999) {
    return 'Unavailable';
  }
  return `${Math.round(timeMin)} min`;
}

interface TableColumnDef {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

interface TableRowDef {
  cells: string[];
  textColor?: [number, number, number];
  isBold?: boolean;
}

/**
 * Generates an executive-grade, publication-ready Flood Risk & Resilience Assessment Report
 * for a specific Indore pilot catchment cell with dynamic flow layout, wrapped tables,
 * robust pagination, and zero section collisions.
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
    compress: false,
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2; // 182mm
  const topContentY = 16; // Content start on pages > 1 (below running header)
  const bottomThreshold = pageHeight - margin - 8; // 275mm (above running footer)
  let currentY = margin;

  const runTimestamp = new Date();
  const runTimestampIso = runTimestamp.toISOString();
  const runTimestampFormatted =
    runTimestamp.toLocaleString('en-IN', {
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
      (Math.abs(s.lat - cell.lat) < 0.02 && Math.abs(s.lng - cell.lng) < 0.02)
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

  // Verified historical response records
  const verifiedHistRecords = getVerifiedHistoricalRecordsForCell(cell.id);

  // -------------------------------------------------------------------------
  // CORE FLOW LAYOUT HELPERS
  // -------------------------------------------------------------------------

  /**
   * Checks if required space is available before drawing.
   * If not, adds a new page, resets currentY, and invokes onPageBreak callback.
   */
  const ensureSpace = (requiredHeight: number, onPageBreak?: () => void): boolean => {
    if (currentY + requiredHeight > bottomThreshold) {
      doc.addPage();
      currentY = topContentY;
      if (onPageBreak) {
        onPageBreak();
      }
      return true;
    }
    return false;
  };

  /**
   * Draws a unified tactical section header.
   * Enforces that at least minSpaceBelow remains on the page to prevent orphan headers.
   */
  const drawSectionHeader = (categoryTag: string, title: string, minSpaceBelow = 32) => {
    ensureSpace(10 + minSpaceBelow);

    doc.setFillColor(15, 23, 42); // Slate 900
    doc.rect(margin, currentY, contentWidth, 7, 'F');

    doc.setFillColor(6, 182, 212); // Cyan accent bar
    doc.rect(margin, currentY, 2.5, 7, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(34, 211, 238); // Cyan
    doc.text(sanitizePdfText(categoryTag).toUpperCase(), margin + 5, currentY + 4.8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(248, 250, 252);
    doc.text(sanitizePdfText(title).toUpperCase(), margin + 58, currentY + 4.8);

    currentY += 10;
  };

  /**
   * Renders a fully wrapped, robust table with dynamic row height, cell padding,
   * and clean pagination with automatic header repetition.
   */
  const renderTable = (
    columns: TableColumnDef[],
    rows: TableRowDef[],
    tableTitle?: string
  ) => {
    const drawHeader = () => {
      doc.setFillColor(226, 232, 240); // Slate 200
      doc.rect(margin, currentY, contentWidth, 6, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(30, 41, 59);

      let colX = margin;
      columns.forEach((col) => {
        const textX =
          col.align === 'right'
            ? colX + col.width - 2.5
            : col.align === 'center'
            ? colX + col.width / 2
            : colX + 2.5;
        doc.text(sanitizePdfText(col.header), textX, currentY + 4.2, {
          align: col.align || 'left',
        });
        colX += col.width;
      });
      currentY += 6.5;
    };

    if (tableTitle) {
      ensureSpace(12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(sanitizePdfText(tableTitle), margin, currentY + 4);
      currentY += 6;
    }

    ensureSpace(15);
    drawHeader();

    rows.forEach((row, rowIdx) => {
      // Calculate wrapped lines for every cell in this row
      const cellLines = row.cells.map((cellText, cIdx) => {
        const col = columns[cIdx];
        const maxTextW = Math.max(8, col.width - 5);
        return doc.splitTextToSize(sanitizePdfText(cellText), maxTextW);
      });

      const maxLines = Math.max(1, ...cellLines.map((l) => l.length));
      const rowHeight = Math.max(6.5, maxLines * 3.6 + 2.5);

      ensureSpace(rowHeight, () => {
        drawHeader();
      });

      // Background striping
      const isEven = rowIdx % 2 === 0;
      doc.setFillColor(isEven ? 255 : 248, isEven ? 255 : 250, isEven ? 255 : 252);
      doc.rect(margin, currentY, contentWidth, rowHeight, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.15);
      doc.line(margin, currentY + rowHeight, margin + contentWidth, currentY + rowHeight);

      // Render cell texts
      let cellX = margin;
      columns.forEach((col, cIdx) => {
        const lines = cellLines[cIdx];
        doc.setFont('helvetica', row.isBold || cIdx === 0 ? 'bold' : 'normal');
        doc.setFontSize(7);

        if (row.textColor) {
          doc.setTextColor(row.textColor[0], row.textColor[1], row.textColor[2]);
        } else {
          doc.setTextColor(cIdx === 0 ? 15 : 71, cIdx === 0 ? 23 : 85, cIdx === 0 ? 42 : 105);
        }

        const align = col.align || 'left';
        let textX = cellX + 2.5;
        if (align === 'right') textX = cellX + col.width - 2.5;
        else if (align === 'center') textX = cellX + col.width / 2;

        let lineY = currentY + 3.8;
        lines.forEach((l) => {
          doc.text(l, textX, lineY, { align });
          lineY += 3.4;
        });

        cellX += col.width;
      });

      currentY += rowHeight;
    });

    currentY += 4;
  };

  /**
   * Renders a dynamically measured content card box with guaranteed exact height.
   * Eliminates hardcoded heights and prevents box overruns.
   */
  const renderCardBox = (
    title: string,
    bulletItems: Array<{ label?: string; text: string }>,
    options: {
      bgColor?: [number, number, number];
      borderColor?: [number, number, number];
      titleColor?: [number, number, number];
      bodyColor?: [number, number, number];
      minHeight?: number;
    } = {}
  ) => {
    const {
      bgColor = [248, 250, 252],
      borderColor = [203, 213, 225],
      titleColor = [15, 23, 42],
      bodyColor = [51, 65, 85],
      minHeight = 18,
    } = options;

    const innerWidth = contentWidth - 8;
    const itemWrappedLines = bulletItems.map((item) => {
      const fullText = item.label ? `${item.label}: ${item.text}` : item.text;
      return doc.splitTextToSize(sanitizePdfText(fullText), innerWidth);
    });

    const totalTextLines = itemWrappedLines.reduce((acc, lines) => acc + lines.length, 0);
    const measuredHeight = Math.max(minHeight, 8 + totalTextLines * 3.7 + bulletItems.length * 1.5 + 4);

    ensureSpace(measuredHeight + 2);

    doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
    doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, currentY, contentWidth, measuredHeight, 1.5, 1.5, 'FD');

    let textY = currentY + 5.2;
    if (title) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(titleColor[0], titleColor[1], titleColor[2]);
      doc.text(sanitizePdfText(title), margin + 4, textY);
      textY += 4.5;
    }

    bulletItems.forEach((item, idx) => {
      const lines = itemWrappedLines[idx];
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(bodyColor[0], bodyColor[1], bodyColor[2]);

      lines.forEach((line) => {
        doc.text(line, margin + 4, textY);
        textY += 3.6;
      });
      textY += 1.2;
    });

    currentY += measuredHeight + 3.5;
  };

  // =========================================================================
  // PAGE 1: COVER PAGE & EXECUTIVE SUMMARY
  // =========================================================================

  // Dark Mission Top Header
  doc.setFillColor(8, 14, 28);
  doc.rect(0, 0, pageWidth, 32, 'F');

  // Vector Emblem
  doc.setFillColor(6, 182, 212);
  doc.roundedRect(margin, 7, 10, 10, 2, 2, 'F');
  doc.setFillColor(8, 14, 28);
  doc.triangle(margin + 2.5, 15, margin + 5, 9, margin + 7.5, 15, 'F');
  doc.setFillColor(34, 211, 238);
  doc.circle(margin + 5, 11.5, 1.3, 'F');

  // Brand Name & Program Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text('iDhara', margin + 13, 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('URBAN FLOOD EARLY WARNING & RESILIENCE TWIN', margin + 30, 13);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(34, 211, 238);
  doc.text('FLOOD RISK & RESILIENCE ASSESSMENT REPORT', margin, 23);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `PILOT BASIN: CENTRAL INDORE 5x5 KM ZONE -- DOSSIER RUN: ${sanitizePdfText(runTimestampFormatted)}`,
    margin,
    28
  );

  currentY = 37;

  // Locality Identification Card (Dynamic height)
  renderCardBox(
    `${cell.localityName} (${cell.wardCode} -- ${cell.id})`,
    [
      {
        label: 'Geographic Location',
        text: `${cell.lat.toFixed(4)} N, ${cell.lng.toFixed(4)} E | Basin Grid: Row ${cell.row}, Col ${cell.col} | Elevation: ${cell.elevationM}m MSL`,
      },
      {
        label: 'Catchment Soil & Land Use',
        text: `${cell.landUse} | Impervious Cover: ${(cell.imperviousness * 100).toFixed(0)}% | Drainage Capacity Proxy: ${(cell.drainageProxyScore * 100).toFixed(0)}%`,
      },
      {
        label: 'Reporting Window',
        text: `${REPORTING_PERIOD_LABELS[reportingPeriod]} | Scope ID: ${PILOT_SCOPE_ID} | Mode: ${cell.mode}`,
      },
    ],
    {
      bgColor: [248, 250, 252],
      borderColor: [203, 213, 225],
      titleColor: [15, 23, 42],
      bodyColor: [71, 85, 105],
      minHeight: 25,
    }
  );

  // Hero Risk Category & Score Block
  const riskMeta = RISK_COLORS[cell.severity];
  doc.setFillColor(riskMeta.bg[0], riskMeta.bg[1], riskMeta.bg[2]);
  doc.roundedRect(margin, currentY, contentWidth, 19, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(255, 255, 255);
  doc.text(`OVERALL RISK CLASSIFICATION: ${riskMeta.label}`, margin + 5, currentY + 7);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  const probPercent = Math.round(cell.floodProbability * 100);
  doc.text(`${probPercent}%`, margin + contentWidth - 24, currentY + 13);

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

  // Executive Summary Narrative Card
  const forecastLeadText =
    cell.leadTimeMin > 0
      ? `Forecast horizon indicates potential peak crest within ~${cell.leadTimeMin} minutes (${cell.expectedOnsetLabel}).`
      : 'Immediate flood inundation risk active; rapid surface accumulation underway.';

  renderCardBox(
    'EXECUTIVE RISK SUMMARY & STRATEGIC OVERVIEW',
    [
      {
        label: '- RECORDED OBSERVATIONS',
        text: `Current local rainfall stands at ${cell.rainfallMmHr} mm/h (cumulative ${cell.cumulativeRainfallMm} mm). Drainage proxy indicates ${(cell.drainageProxyScore * 100).toFixed(0)}% capacity. Catchment imperviousness is ${(cell.imperviousness * 100).toFixed(0)}%.`,
      },
      {
        label: '- MODEL PREDICTIONS',
        text: `Hydrodynamic model forecasts a flood probability of ${probPercent}% (Severity: ${cell.severity}, uncertainty +/-${Math.round(cell.uncertaintyBand * 100)}%). Estimated peak inundation depth: ${formatDepthCm(cell.predictedDepthCm)}. ${forecastLeadText}`,
      },
      {
        label: '- PRIORITY ACTION',
        text:
          cell.severity === FloodSeverity.CRITICAL || cell.severity === FloodSeverity.HIGH
            ? 'ACTIVATE EMERGENCY RESPONSE: Restrict transit across low-level culverts/bridges, mobilize dewatering units, alert residents, and stage designated high-ground shelters.'
            : 'CONTINUOUS MONITORING: Maintain automated telemetry watch, inspect storm grates, and ensure clear runoff discharge paths.',
      },
    ],
    {
      bgColor: [241, 245, 249],
      borderColor: [203, 213, 225],
      titleColor: [15, 23, 42],
      bodyColor: [51, 65, 85],
      minHeight: 32,
    }
  );

  // Four Core KPI Metric Cards
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('KEY HAZARD & OPERATIONAL TELEMETRY INDICATORS', margin, currentY + 3);
  currentY += 5;

  const kpiWidth = (contentWidth - 9) / 4;
  const kpiCards = [
    {
      title: 'FLOOD PROBABILITY',
      value: `${probPercent}%`,
      subtitle: `Predicted: ${formatDepthCm(cell.predictedDepthCm)}`,
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
      subtitle: `Historical: ${cell.historicalFloodCount10Yr} events`,
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

    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.rect(xPos, currentY, kpiWidth, 1.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.title, xPos + 3, currentY + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.value, xPos + 3, currentY + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(71, 85, 105);
    doc.text(kpi.subtitle, xPos + 3, currentY + 18);
  });

  currentY += 26;

  // Section 01: Hydrological Drivers Table (Widths sum = 182mm)
  drawSectionHeader(
    'Section 01 -- Hydrological Drivers',
    'Primary Flood Inundation Contributing Factors'
  );

  const driverColumns: TableColumnDef[] = [
    { header: 'Factor / Mechanism', width: 45 },
    { header: 'Influence', width: 26, align: 'center' },
    { header: 'Status', width: 26, align: 'center' },
    { header: 'Hydrological Explanation & Impact', width: 85 },
  ];

  const driverRows: TableRowDef[] = cell.topDrivers.slice(0, 3).map((driver) => ({
    cells: [
      driver.factor,
      `${driver.weight}% Impact`,
      driver.direction === 'aggravating' ? 'AGGRAVATING' : 'MITIGATING',
      driver.description,
    ],
    textColor: driver.direction === 'aggravating' ? [185, 28, 28] : [22, 101, 52],
  }));

  renderTable(driverColumns, driverRows);

  // =========================================================================
  // PAGE 2: GEOSPATIAL MINI-MAP & SENSOR TELEMETRY AUDIT
  // =========================================================================
  doc.addPage();
  currentY = topContentY;

  if (includeSpatialGridVisual) {
    drawSectionHeader(
      'Section 02 -- Geospatial Intelligence',
      'Indore Basin 8x8 Catchment Risk-Grid Mini-Map'
    );

    const gridOriginX = margin + 2;
    const gridOriginY = currentY + 2;
    const cellSize = 9.5; // 8 * 9.5 = 76mm width & height
    const gridWidth = cellSize * 8;
    const gridHeight = cellSize * 8;

    // Dark grid container background
    doc.setFillColor(10, 15, 26);
    doc.roundedRect(gridOriginX - 2, gridOriginY - 2, gridWidth + 4, gridHeight + 4, 1.5, 1.5, 'F');

    // Draw all 64 cells with crisp, readable labels
    cells.forEach((c) => {
      const cellX = gridOriginX + c.col * cellSize;
      const cellY = gridOriginY + c.row * cellSize;
      const isTarget = c.id === cell.id;

      let cellColor: [number, number, number] = [30, 41, 59];
      if (c.severity === FloodSeverity.CRITICAL) cellColor = [220, 38, 38];
      else if (c.severity === FloodSeverity.HIGH) cellColor = [234, 88, 12];
      else if (c.severity === FloodSeverity.MODERATE) cellColor = [202, 138, 4];

      doc.setFillColor(cellColor[0], cellColor[1], cellColor[2]);
      doc.rect(cellX + 0.3, cellY + 0.3, cellSize - 0.6, cellSize - 0.6, 'F');

      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.2);
      doc.rect(cellX + 0.3, cellY + 0.3, cellSize - 0.6, cellSize - 0.6, 'D');

      if (isTarget) {
        doc.setDrawColor(34, 211, 238); // Cyan
        doc.setLineWidth(0.8);
        doc.rect(cellX, cellY, cellSize, cellSize, 'D');
        doc.setFillColor(255, 255, 255);
        doc.circle(cellX + cellSize / 2, cellY + cellSize / 2, 1.1, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(4.5);
      doc.setTextColor(255, 255, 255);
      doc.text(`R${c.row}C${c.col}`, cellX + 1.2, cellY + 3.4);
      doc.setFont('helvetica', 'bold');
      doc.text(`${Math.round(c.floodProbability * 100)}%`, cellX + 1.2, cellY + 7.2);
    });

    // Kahn River vector flow
    doc.setDrawColor(56, 189, 248);
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

    // Saraswati River vector flow
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

    // Side context card
    const sideX = gridOriginX + gridWidth + 8;
    const sideWidth = contentWidth - (gridWidth + 12);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('GEOSPATIAL CATCHMENT CONTEXT', sideX, gridOriginY + 4);

    const sideTextItems = [
      `Target Sector: ${cell.localityName} (${cell.wardCode})`,
      `Grid Index: Row ${cell.row}, Column ${cell.col} (Cell ${cell.id})`,
      `Basin Bounds: ${PILOT_BOUNDS.minLat} N to ${PILOT_BOUNDS.maxLat} N, ${PILOT_BOUNDS.minLng} E to ${PILOT_BOUNDS.maxLng} E (~25 sq km).`,
      `Distance to River: ~${cell.distanceToRiverM} meters`,
      `Confluence: Saraswati merges into Kahn River at Krishnapura (R2, C2).`,
      `Topography: Eastern ridge (Palasia 558m) slopes toward central basin (544m MSL).`,
    ];

    let sideTextY = gridOriginY + 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(71, 85, 105);
    sideTextItems.forEach((st) => {
      const wrapped = doc.splitTextToSize(sanitizePdfText(`- ${st}`), sideWidth);
      doc.text(wrapped, sideX, sideTextY);
      sideTextY += wrapped.length * 3.6 + 1.2;
    });

    // Map Legend below the grid
    const legY = gridOriginY + gridHeight + 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(71, 85, 105);
    doc.text('MAP LEGEND:', margin + 2, legY);

    const legendItems = [
      { label: 'Low (<25%)', color: [30, 41, 59] },
      { label: 'Moderate (25-45%)', color: [202, 138, 4] },
      { label: 'High (45-70%)', color: [234, 88, 12] },
      { label: 'Critical (>=70%)', color: [220, 38, 38] },
      { label: 'Target Cell', color: [34, 211, 238] },
    ];

    legendItems.forEach((item, lIdx) => {
      const lx = margin + 24 + lIdx * 31;
      doc.setFillColor(item.color[0], item.color[1], item.color[2]);
      doc.rect(lx, legY - 2.5, 3.5, 3.5, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(51, 65, 85);
      doc.text(item.label, lx + 5, legY);
    });

    currentY = legY + 8;
  }

  // Section 03: Sensor Telemetry Audit Table (Sum = 182mm)
  if (includeSensorAudit) {
    drawSectionHeader(
      'Section 03 -- Telemetry & Freshness',
      'Local IoT Sensor Freshness & Calibration Audit'
    );

    const sensorColumns: TableColumnDef[] = [
      { header: 'Sensor Node / Station', width: 50 },
      { header: 'Type', width: 30 },
      { header: 'Freshness', width: 26, align: 'center' },
      { header: 'Reading', width: 28, align: 'center' },
      { header: 'Diagnostic Status & Confidence', width: 48 },
    ];

    const sensorRows: TableRowDef[] = sensorsToAudit.map((s) => ({
      cells: [
        `${s.id} -- ${s.name}`,
        s.type.replace(/_/g, ' '),
        s.freshnessState,
        `${s.currentValue} ${s.unit}`,
        `${s.diagnosticNote} (${Math.round(s.confidence * 100)}% conf)`,
      ],
      textColor:
        s.freshnessState === 'FRESH'
          ? [22, 101, 52]
          : s.freshnessState === 'STALE'
          ? [180, 83, 9]
          : [185, 28, 28],
    }));

    renderTable(sensorColumns, sensorRows);
  }

  // Section 04: Active Alerts Summary
  if (includeAlertsSummary) {
    drawSectionHeader(
      'Section 04 -- Operational Directives',
      'Active Command Alerts & Public Warning Dispatches'
    );

    if (localAlerts.length === 0) {
      renderCardBox(
        'LOCAL ALERT STATUS: NOMINAL',
        [
          {
            text: 'No active critical emergency alerts published specifically for this grid cell at this timestamp. Continuous automated telemetry watch remains active.',
          },
        ],
        {
          bgColor: [248, 250, 252],
          borderColor: [226, 232, 240],
          titleColor: [71, 85, 105],
          bodyColor: [100, 116, 139],
          minHeight: 16,
        }
      );
    } else {
      localAlerts.slice(0, 2).forEach((al) => {
        renderCardBox(
          `[${al.warningLevel}] ${al.id}: ${al.title}`,
          [
            {
              label: 'Directive',
              text: `${al.recommendedAction} (Confirmed by ${al.humanConfirmedBy || al.source || 'EOC Duty Officer'})`,
            },
            {
              label: 'Target Audience',
              text: al.targetAudience?.join(', ') || 'All Municipal Responders',
            },
          ],
          {
            bgColor: [254, 242, 242],
            borderColor: [252, 165, 165],
            titleColor: [185, 28, 28],
            bodyColor: [51, 65, 85],
            minHeight: 20,
          }
        );
      });
    }
  }

  // =========================================================================
  // PAGE 3: EVACUATION ROUTE ASSESSMENT & ROAD MOBILITY
  // =========================================================================
  doc.addPage();
  currentY = topContentY;

  if (includeEvacuationRoute) {
    drawSectionHeader(
      'Section 05 -- Evacuation Routes',
      'Evacuation Route Assessment (Historical, Current & Alternative)'
    );

    // Designated Shelter Refuge Card
    renderCardBox(
      `ASSIGNED REFUGE DESTINATION: ${assignedShelter.name}`,
      [
        {
          label: 'Facility Details',
          text: `Shelter ID: ${assignedShelter.id} | Location: Ward ${assignedShelter.ward} | Elevation: ${assignedShelter.elevationM}m MSL (Elevated Safe Ground)`,
        },
        {
          label: 'Capacity & Readiness',
          text: `Total Capacity: ${assignedShelter.totalCapacity} berths | Drinking Water: ${(assignedShelter as any).drinkingWaterLiters?.toLocaleString() || '15,000'}L | Medical Unit: ${(assignedShelter as any).medicalTeamPresent ? 'Present On-Site' : 'On-Call Mobile Team'}`,
        },
      ],
      {
        bgColor: [241, 245, 249],
        borderColor: [203, 213, 225],
        titleColor: [15, 23, 42],
        bodyColor: [71, 85, 105],
        minHeight: 22,
      }
    );

    // CATEGORY A: HISTORICAL ROUTE USED
    const histRecWithRoute = verifiedHistRecords.find((r) => r.routesActuallyUsed);
    if (histRecWithRoute) {
      renderCardBox(
        'A. HISTORICAL EVACUATION ROUTE USED [HISTORICAL RECORD]',
        [
          { label: 'Documented Incident', text: `${histRecWithRoute.eventTitle} (${histRecWithRoute.eventDate})` },
          { label: 'Route Path Used', text: histRecWithRoute.routesActuallyUsed },
          { label: 'Destination Refuge', text: histRecWithRoute.sheltersOrDestinationsUsed },
          { label: 'Archive Reference', text: `${histRecWithRoute.sourceReference} (Record ID: ${histRecWithRoute.recordId})` },
        ],
        {
          bgColor: [248, 250, 252],
          borderColor: [226, 232, 240],
          titleColor: [15, 23, 42],
          bodyColor: [51, 65, 85],
        }
      );
    } else {
      renderCardBox(
        'A. HISTORICAL EVACUATION ROUTE USED [HISTORICAL RECORD]',
        [
          {
            text: 'No verified historical evacuation route records exist for this location.',
          },
        ],
        {
          bgColor: [248, 250, 252],
          borderColor: [226, 232, 240],
          titleColor: [100, 116, 139],
          bodyColor: [100, 116, 139],
          minHeight: 15,
        }
      );
    }

    // CATEGORY B: CURRENT RECOMMENDED ROUTE
    const isRouteFeasible = calculatedRouteRecommendation.feasible;
    if (isRouteFeasible && calculatedRouteRecommendation.primaryRoute) {
      const pr = calculatedRouteRecommendation.primaryRoute;
      const cleanPathStr = pr.roadNames.map((n) => sanitizePdfText(n)).join(' -> ');

      renderCardBox(
        'B. CURRENT RECOMMENDED EVACUATION ROUTE [CALCULATED ROUTE]',
        [
          {
            label: 'Transit Origin & Refuge',
            text: `Start: ${originNode.name} (${originNode.elevationM}m MSL) -> Destination: ${assignedShelter.name}`,
          },
          {
            label: 'Distance & Travel Time',
            text: `Calculated Distance: ${pr.distanceKm} km | Estimated ETA: ${formatTransitTime(pr.travelTimeMin)} (includes flood risk penalty)`,
          },
          {
            label: 'Corridor Sequence',
            text: cleanPathStr,
          },
          {
            label: 'Corridor Safety Policy',
            text: `Diverted around CLOSED and submerged segments under ${calculatedRouteRecommendation.travelProfile} safety protocol.`,
          },
          {
            label: 'Model Provenance',
            text: `Shortest-path Dijkstra graph solver. Expiry: ${calculatedRouteRecommendation.expiry} (Confidence: ${Math.round(calculatedRouteRecommendation.confidence * 100)}%).`,
          },
        ],
        {
          bgColor: [240, 253, 250], // Emerald / Teal light
          borderColor: [187, 247, 208],
          titleColor: [22, 101, 52],
          bodyColor: [30, 41, 59],
        }
      );
    } else {
      const noRouteInfo = calculatedRouteRecommendation.noRouteInfo;
      renderCardBox(
        'B. NO FEASIBLE EVACUATION ROUTE AVAILABLE [ROUTE SEVERED]',
        [
          {
            label: 'Disconnection Reason',
            text: noRouteInfo?.reason || 'All egress corridors from origin are blocked by CLOSED or flooded road segments.',
          },
          {
            label: 'Severed Corridors',
            text: noRouteInfo?.blockingRoadNames?.slice(0, 3).join('; ') || 'All egress corridors closed',
          },
          {
            label: 'Life Safety Directive',
            text: 'Seek immediate refuge on the highest local reinforced concrete structure or upper floors. Do NOT attempt to wade or drive across flooded roads.',
          },
          {
            label: 'Responders Coordination',
            text: 'Await instructions from authorized local emergency rescue units.',
          },
        ],
        {
          bgColor: [254, 242, 242],
          borderColor: [252, 165, 165],
          titleColor: [185, 28, 28],
          bodyColor: [185, 28, 28],
        }
      );
    }

    // CATEGORY C: ALTERNATIVE ROUTE
    if (calculatedRouteRecommendation.alternativeRoute) {
      const alt = calculatedRouteRecommendation.alternativeRoute;
      const cleanAltPathStr = alt.roadNames.map((n) => sanitizePdfText(n)).join(' -> ');
      renderCardBox(
        'C. ALTERNATIVE EVACUATION ROUTE [CALCULATED ROUTE]',
        [
          { label: 'Secondary Bypass Corridor', text: cleanAltPathStr },
          { label: 'Distance & ETA', text: `Distance: ${alt.distanceKm} km | ETA: ${formatTransitTime(alt.travelTimeMin)} (+${alt.totalRiskPenaltyMin}m risk delay)` },
          { label: 'Usage Notice', text: 'Use only if the primary recommended corridor is obstructed on the ground.' },
        ],
        {
          bgColor: [248, 250, 252],
          borderColor: [226, 232, 240],
          titleColor: [15, 23, 42],
          bodyColor: [51, 65, 85],
        }
      );
    } else {
      renderCardBox(
        'C. ALTERNATIVE EVACUATION ROUTE [CALCULATED ROUTE]',
        [
          {
            text: 'No viable alternative bypass route exists without traversing high-hazard or closed road segments.',
          },
        ],
        {
          bgColor: [248, 250, 252],
          borderColor: [226, 232, 240],
          titleColor: [100, 116, 139],
          bodyColor: [100, 116, 139],
          minHeight: 15,
        }
      );
    }

    // Route Uncertainty & Safety Advisory
    renderCardBox(
      'ROUTE SAFETY NOTICE & UNCERTAINTY ADVISORY',
      [
        {
          text: 'Calculated routes reflect model predictions and available sensor telemetry. Never guarantee route safety during active monsoons. Moving water over 15cm can stall vehicles. Always follow real-time instructions from traffic police and emergency personnel.',
        },
      ],
      {
        bgColor: [254, 243, 199], // Amber tint
        borderColor: [245, 158, 11],
        titleColor: [180, 83, 9],
        bodyColor: [120, 53, 15],
        minHeight: 15,
      }
    );
  }

  // Section 06: Connected Road Mobility Impact Table (Sum = 182mm)
  if (includeRoadDisruptions) {
    drawSectionHeader(
      'Section 06 -- Road Mobility',
      'Connected Road Network & Corridor Inundation Status'
    );

    const roadColumns: TableColumnDef[] = [
      { header: 'Road Corridor / Street Segment', width: 58 },
      { header: 'Corridor Type', width: 40 },
      { header: 'Mobility Status', width: 32, align: 'center' },
      { header: 'Est. Depth', width: 26, align: 'center' },
      { header: 'Delay / Penalty', width: 26, align: 'center' },
    ];

    const roadRows: TableRowDef[] = roadsToAudit.map((r) => ({
      cells: [
        `${r.id} -- ${r.name}`,
        r.corridorType,
        r.currentState,
        formatDepthCm(r.estimatedWaterDepthCm),
        formatPenaltyMin(r.riskPenaltyMin, r.currentState),
      ],
      textColor:
        r.currentState === RoadStatus.CLOSED
          ? [185, 28, 28]
          : r.currentState === RoadStatus.LIKELY_FLOODED
          ? [194, 65, 12]
          : r.currentState === RoadStatus.AT_RISK
          ? [180, 83, 9]
          : [22, 101, 52],
    }));

    renderTable(roadColumns, roadRows);
  }

  // =========================================================================
  // PAGE 4: HISTORICAL FLOOD EVENTS & RECOMMENDED PRECAUTIONS & PROVENANCE
  // =========================================================================
  const isHighOrCritical =
    cell.severity === FloodSeverity.HIGH || cell.severity === FloodSeverity.CRITICAL;

  if (isHighOrCritical || includeHistoricalEvents || includePrecautionsPlan) {
    doc.addPage();
    currentY = topContentY;

    // SECTION 07: HISTORICAL FLOOD EVENTS & RESPONSE ACTIONS
    if (includeHistoricalEvents) {
      drawSectionHeader(
        'Section 07 -- Historical Intelligence',
        'Historical Flood Events & Response Actions'
      );

      if (verifiedHistRecords.length > 0) {
        verifiedHistRecords.forEach((hist) => {
          renderCardBox(
            `RECORD: ${hist.eventTitle} [HISTORICAL RECORD]`,
            [
              { label: 'Date & Rainfall', text: `${hist.eventDate} | ${hist.rainfallMetric}` },
              { label: 'Recorded Inundation Conditions', text: hist.recordedFloodConditions },
              { label: 'Precautions Taken', text: hist.precautionsTaken },
              { label: 'Official Actions Performed', text: hist.actionsPerformedByAuthorities },
              { label: 'Evacuation Measures', text: hist.evacuationMeasuresTaken },
              { label: 'Routes & Shelters Used', text: `${hist.routesActuallyUsed} | Shelters: ${hist.sheltersOrDestinationsUsed}` },
              { label: 'Source / Record ID', text: `${hist.sourceReference} (Archived: ${hist.timestamp})` },
            ],
            {
              bgColor: [248, 250, 252],
              borderColor: [203, 213, 225],
              titleColor: [15, 23, 42],
              bodyColor: [51, 65, 85],
            }
          );
        });
      } else {
        renderCardBox(
          'HISTORICAL RESPONSE RECORD STATUS',
          [
            {
              text: 'No verified historical flood response records are available for this location in the current data sources.',
            },
            {
              label: '10-Year Municipal Frequency',
              text: `${cell.historicalFloodCount10Yr} inundation events catalogued in Indore municipal records.`,
            },
            {
              label: 'Local Catchment Terrain',
              text: cell.historicalContext || 'Standard urban catchment terrain.',
            },
            {
              label: 'Catalog Boundary',
              text: 'Multi-agency response action dossiers are maintained primarily for major confluence corridors (e.g. Krishnapura, Sarwate, Chandrabhaga).',
            },
          ],
          {
            bgColor: [248, 250, 252],
            borderColor: [226, 232, 240],
            titleColor: [71, 85, 105],
            bodyColor: [100, 116, 139],
            minHeight: 22,
          }
        );
      }
    }

    // SECTION 08: RECOMMENDED PRECAUTIONS AND RESPONSE PLAN
    if (includePrecautionsPlan) {
      drawSectionHeader(
        'Section 08 -- Action Plan',
        'Recommended Precautions & Response Plan'
      );

      renderCardBox(
        'ACTION PLAN MATRIX (PAST COMPLETED VS. FUTURE PREPAREDNESS)',
        [
          {
            label: '1. SENSOR & WATERWAY SURVEILLANCE [RECOMMENDED ACTION]',
            text: 'Continuous telemetry monitoring of ultrasonic river stage gauge and AWS rain rates. Inspect roadside storm grates and culvert inlets for solid waste throttles.',
          },
          {
            label: '2. OFFICIAL WARNING DISSEMINATION [RECOMMENDED ACTION]',
            text: `Broadcast targeted public advisories via Indore 311 app, SMS cellular cell-broadcast, and local public address systems in Ward ${cell.wardCode}.`,
          },
          {
            label: '3. VULNERABLE POPULATION SUPPORT [RECOMMENDED ACTION]',
            text: `Identify elderly, non-ambulatory, and basement-dwelling residents (~${Math.round(cell.populationEstimate * 0.03)} estimated high-vulnerability individuals) for priority assistance.`,
          },
          {
            label: '4. EVACUATION DESTINATION READINESS [RECOMMENDED ACTION]',
            text: `Verify readiness and supplies at ${assignedShelter.name} (${assignedShelter.elevationM}m MSL); confirm generator fuel and potability testing.`,
          },
          {
            label: '5. MOBILITY BARRICADES & DIVERSIONS [RECOMMENDED ACTION]',
            text: 'Close and barricade low-level underpasses and bridges if water depth exceeds 15cm; enforce traffic diversions via elevated bypass arteries.',
          },
          {
            label: '6. EMERGENCY RESPONDER COORDINATION [RECOMMENDED ACTION]',
            text: 'Establish dedicated medical transit green corridors to MY Hospital and coordinate with SDRF rescue units at District EOC.',
          },
        ],
        {
          bgColor: [248, 250, 252],
          borderColor: [203, 213, 225],
          titleColor: [15, 23, 42],
          bodyColor: [51, 65, 85],
          minHeight: 45,
        }
      );
    }

    // SECTION 09: SOURCES, METHODOLOGY, AND DATA QUALITY
    drawSectionHeader(
      'Section 09 -- Provenance & Methodology',
      'Sources, Methodology, Limitations & Verification'
    );

    renderCardBox(
      'DATA SOURCES CATALOG & STATUS CLASSIFICATION',
      [
        {
          label: 'IoT Sensor Telemetry [CURRENT OBSERVATION]',
          text: 'Real-time ultrasonic level sensors and tipping-bucket rain gauges provided by ISCDL and CEG Telemetry Mesh.',
        },
        {
          label: 'Hydrodynamic Risk Model [MODEL PREDICTION]',
          text: 'Multi-factor empirical runoff and flood probability formulation incorporating DEM elevation, slope, imperviousness, and drainage proxy scores.',
        },
        {
          label: 'Road Network & Routing Graph [CALCULATED ROUTE]',
          text: 'Flood-penalized Dijkstra pathfinding engine over Indore urban graph.',
        },
        {
          label: 'Historical Incidents Archive [HISTORICAL RECORD]',
          text: 'Indore Municipal Corporation (IMC) Monsoon Incident Register and DDMA Post-Event Reports.',
        },
        {
          label: 'Operational Boundary & Limitations',
          text: 'This report constitutes advisory decision support for emergency managers. Field observations supersede computational estimates.',
        },
      ],
      {
        bgColor: [248, 250, 252],
        borderColor: [226, 232, 240],
        titleColor: [15, 23, 42],
        bodyColor: [71, 85, 105],
        minHeight: 32,
      }
    );
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
        `SECTOR: ${sanitizePdfText(cell.localityName).toUpperCase()} (${cell.wardCode}) | DATE: ${sanitizePdfText(runTimestampFormatted)}`,
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
      `iDhara Urban Early Warning System -- Indore 5x5 km Pilot -- Generated: ${runTimestampIso.substring(0, 19)}Z`,
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
