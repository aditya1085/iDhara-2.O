import React, { useState, useMemo, useEffect } from 'react';
import {
  FloodRiskCell,
  RoadSegmentState,
  SensorNode,
  AlertItem,
  DataHealthReport,
  FloodSeverity,
  WarningLevel,
  UserRole,
  ScenarioParameters,
  Shelter,
  EvacuationPlanItem,
  RouteRecommendation,
  DisasterStage,
} from '../types/idhara';
import {
  generateLocationDossierPdf,
  ReportingPeriod,
  REPORTING_PERIOD_LABELS,
  RISK_COLORS,
} from '../modules/pdfReportGenerator';
import { getVerifiedHistoricalRecordsForCell } from '../data/indoreHistoricalRecords';
import { findNearestNodeForCell, computeSingleRoute } from '../modules/routing';

interface LocationReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  cells: FloodRiskCell[];
  roads: RoadSegmentState[];
  sensors: SensorNode[];
  alerts: AlertItem[];
  dataHealthReport: DataHealthReport;
  activeRole?: UserRole;
  params?: ScenarioParameters;
  shelters?: Shelter[];
  evacuationPlans?: EvacuationPlanItem[];
  routes?: RouteRecommendation[];
  initialSelectedCellId?: string;
}

export const LocationReportModal: React.FC<LocationReportModalProps> = ({
  isOpen,
  onClose,
  cells,
  roads,
  sensors,
  alerts,
  dataHealthReport,
  params,
  shelters = [],
  evacuationPlans = [],
  routes = [],
  initialSelectedCellId,
}) => {
  // 1. Selection & search states
  const [selectedCellId, setSelectedCellId] = useState<string>(
    initialSelectedCellId || cells[0]?.id || 'CELL-R2C2'
  );
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [reportingPeriod, setReportingPeriod] = useState<ReportingPeriod>('CURRENT_6H');

  // 2. Sections to include
  const [includeSpatialGridVisual, setIncludeSpatialGridVisual] = useState<boolean>(true);
  const [includeSensorAudit, setIncludeSensorAudit] = useState<boolean>(true);
  const [includeRoadDisruptions, setIncludeRoadDisruptions] = useState<boolean>(true);
  const [includeAlertsSummary, setIncludeAlertsSummary] = useState<boolean>(true);
  const [includeEvacuationRoute, setIncludeEvacuationRoute] = useState<boolean>(true);
  const [includeHistoricalEvents, setIncludeHistoricalEvents] = useState<boolean>(true);
  const [includePrecautionsPlan, setIncludePrecautionsPlan] = useState<boolean>(true);

  // 3. Execution states
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatedReportReady, setGeneratedReportReady] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);
  const [activePreviewTab, setActivePreviewTab] = useState<
    'summary' | 'evacuation' | 'historical' | 'precautions' | 'telemetry'
  >('summary');

  // Sync initialSelectedCellId when modal opens
  useEffect(() => {
    if (initialSelectedCellId && cells.some((c) => c.id === initialSelectedCellId)) {
      setSelectedCellId(initialSelectedCellId);
    }
  }, [initialSelectedCellId, cells]);

  // Selected cell & surrounding context
  const targetCell = useMemo(() => {
    return cells.find((c) => c.id === selectedCellId) || cells[0];
  }, [cells, selectedCellId]);

  // Filtered dropdown options
  const filteredCells = useMemo(() => {
    if (!searchFilter.trim()) return cells;
    const q = searchFilter.toLowerCase().trim();
    return cells.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.localityName.toLowerCase().includes(q) ||
        c.wardCode.toLowerCase().includes(q) ||
        c.severity.toLowerCase().includes(q)
    );
  }, [cells, searchFilter]);

  // Nearby / associated roads
  const localRoads = useMemo(() => {
    if (!targetCell) return [];
    return roads.filter(
      (r) =>
        r.adjacentCellIds.includes(targetCell.id) ||
        r.name.toLowerCase().includes(targetCell.localityName.toLowerCase())
    );
  }, [roads, targetCell]);

  // Nearby sensors
  const localSensors = useMemo(() => {
    if (!targetCell) return [];
    return sensors.filter(
      (s) =>
        s.cellId === targetCell.id ||
        (Math.abs(s.lat - targetCell.lat) < 0.02 && Math.abs(s.lng - targetCell.lng) < 0.02)
    );
  }, [sensors, targetCell]);

  // Relevant alerts for this locality
  const localAlerts = useMemo(() => {
    if (!targetCell) return [];
    const locLower = targetCell.localityName.toLowerCase();
    const cellIdLower = targetCell.id.toLowerCase();
    return alerts.filter(
      (a) =>
        a.location?.toLowerCase().includes(locLower) ||
        a.location?.toLowerCase().includes(cellIdLower) ||
        a.title?.toLowerCase().includes(locLower) ||
        a.affectedLocalities?.some((loc) => loc.toLowerCase().includes(locLower))
    );
  }, [alerts, targetCell]);

  // Verified historical records
  const verifiedHistRecords = useMemo(() => {
    if (!targetCell) return [];
    return getVerifiedHistoricalRecordsForCell(targetCell.id);
  }, [targetCell]);

  // Evacuation route calculation for live preview
  const previewEvacRoute = useMemo(() => {
    if (!targetCell) return null;
    const originNode = findNearestNodeForCell(targetCell);
    const assignedShelter =
      shelters.find((s) => s.id === targetCell.nearestShelterId) ||
      shelters[0];
    const shelterNodeId =
      assignedShelter && 'nearestNodeId' in assignedShelter && (assignedShelter as any).nearestNodeId
        ? (assignedShelter as any).nearestNodeId
        : targetCell.nearestShelterId === 'SH-01'
        ? 'NODE-CHIMANBAGH'
        : targetCell.nearestShelterId === 'SH-02'
        ? 'NODE-PALASIA'
        : targetCell.nearestShelterId === 'SH-03'
        ? 'NODE-COLLECTORATE'
        : 'NODE-NAVALAKHA';

    return computeSingleRoute(
      originNode.id,
      shelterNodeId,
      roads,
      params || {
        mode: targetCell.mode,
        stage: DisasterStage.REAL_TIME_ONGOING,
        rainfallIntensityMmHr: targetCell.rainfallMmHr,
        durationHours: 3,
        drainageBlockagePct: 40,
        upstreamKahnInflowMultiplier: 1.25,
        sensorDropoutCount: 0,
        timelineHourOffset: 0,
        activeEventPresetId: 'EVT-SIM-MONSOON-SURGE',
      },
      'AMBULANCE'
    );
  }, [targetCell, shelters, roads, params]);

  const handleGeneratePreview = () => {
    setIsGenerating(true);
    setDownloadSuccess(false);
    setTimeout(() => {
      setIsGenerating(false);
      setGeneratedReportReady(true);
    }, 350);
  };

  const handleDownloadPDF = () => {
    if (!targetCell) return;
    try {
      const doc = generateLocationDossierPdf({
        cell: targetCell,
        cells,
        roads,
        sensors,
        alerts,
        dataHealthReport,
        params,
        shelters,
        evacuationPlans,
        routes,
        reportingPeriod,
        includeSensorAudit,
        includeRoadDisruptions,
        includeAlertsSummary,
        includeEvacuationRoute,
        includeHistoricalEvents,
        includePrecautionsPlan,
        includeSpatialGridVisual,
      });

      const dateStr = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const safeLocName = targetCell.localityName.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `iDhara_Flood_Intelligence_Dossier_${safeLocName}_${targetCell.id}_${dateStr}.pdf`;

      doc.save(fileName);
      setDownloadSuccess(true);
    } catch (err) {
      console.error('Failed to generate publication PDF', err);
    }
  };

  if (!isOpen || !targetCell) return null;

  const riskColor = RISK_COLORS[targetCell.severity];
  const isHighOrCritical =
    targetCell.severity === FloodSeverity.HIGH ||
    targetCell.severity === FloodSeverity.CRITICAL;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-150"
    >
      <div className="bg-[#090E1A] border border-cyan-500/40 rounded-lg shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-slate-100">
        {/* Top Header */}
        <div className="shrink-0 px-4 py-3 bg-[#0C1222] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-cyan-950 border border-cyan-500/50 flex items-center justify-center text-cyan-400 font-bold text-sm shadow-inner">
              iD
            </div>
            <div>
              <h3
                id="report-modal-title"
                className="text-sm sm:text-base font-semibold text-white tracking-wide flex items-center gap-2"
              >
                <span>Flood Risk & Resilience Assessment Dossier</span>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-700/60 text-cyan-300">
                  A4 Publication Engine
                </span>
              </h3>
              <p className="text-[11px] text-slate-400 font-mono">
                CENTRAL INDORE 5×5 KM PILOT ZONE · MULTI-FACTOR CATCHMENT INTELLIGENCE
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 px-2.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer text-xs font-mono border border-slate-700/60"
            aria-label="Close Report Modal"
          >
            ✕ Close
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-5 custom-scrollbar">
          {/* SECTION 1: TARGET LOCATION SELECTION */}
          <div className="bg-[#0C1222]/90 border border-slate-800 rounded-lg p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span className="text-xs font-mono text-cyan-300 font-bold uppercase tracking-wider">
                  1. Target Locality Selection
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                Target: <strong className="text-white">{targetCell.localityName}</strong> ({targetCell.wardCode} · {targetCell.id})
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Left Column: Search & Filtered List (5 cols) */}
              <div className="lg:col-span-5 space-y-2">
                <label className="text-xs text-slate-300 font-medium block">
                  Search & Filter Catchment Wards
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Filter locality, ward, or cell ID..."
                    className="w-full bg-[#070B14] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono pr-7"
                  />
                  {searchFilter && (
                    <button
                      type="button"
                      onClick={() => setSearchFilter('')}
                      className="absolute right-2 top-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
                      title="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Locality items list */}
                <div className="bg-[#070B14] border border-slate-800 rounded p-1 max-h-56 overflow-y-auto custom-scrollbar space-y-1">
                  {filteredCells.map((c) => {
                    const isSelected = c.id === targetCell.id;
                    const cProb = Math.round(c.floodProbability * 100);
                    let badgeBg = 'bg-slate-800 text-slate-300 border-slate-700';
                    if (c.severity === FloodSeverity.CRITICAL) {
                      badgeBg = 'bg-red-950/80 text-red-300 border-red-800';
                    } else if (c.severity === FloodSeverity.HIGH) {
                      badgeBg = 'bg-amber-950/80 text-amber-300 border-amber-800';
                    } else if (c.severity === FloodSeverity.MODERATE) {
                      badgeBg = 'bg-yellow-950/80 text-yellow-300 border-yellow-800';
                    }

                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedCellId(c.id);
                          setGeneratedReportReady(false);
                          setDownloadSuccess(false);
                        }}
                        className={`w-full text-left p-2 rounded transition-all flex items-center justify-between text-xs cursor-pointer border ${
                          isSelected
                            ? 'bg-cyan-950/70 border-cyan-400 text-white shadow'
                            : 'hover:bg-slate-800/60 border-transparent text-slate-300'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-medium truncate text-[11.5px] text-white">
                            {c.localityName}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {c.wardCode} · {c.id} · {c.elevationM}m MSL
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-1.5 font-mono">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${badgeBg}`}>
                            {cProb}%
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  {filteredCells.length === 0 && (
                    <div className="p-3 text-center text-xs text-slate-500 italic">
                      No wards match “{searchFilter}”
                    </div>
                  )}
                </div>
                <p className="text-[10.5px] text-slate-400 font-mono">
                  Showing {filteredCells.length} of {cells.length} catchment wards. Click any item to select.
                </p>
              </div>

              {/* Right Column: 8x8 Spatial Catchment Grid (7 cols) */}
              <div className="lg:col-span-7 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-300 font-medium">
                    Indore 8×8 Spatial Catchment Grid (Geographic Alignment)
                  </label>
                  <span className="text-[10px] font-mono text-cyan-400">
                    Row {targetCell.row}, Col {targetCell.col}
                  </span>
                </div>

                <div className="bg-[#070B14] border border-slate-800 p-2.5 rounded-lg space-y-2">
                  <div className="grid grid-cols-8 gap-1 aspect-auto">
                    {cells.map((c) => {
                      const isSelected = c.id === targetCell.id;
                      const prob = Math.round(c.floodProbability * 100);

                      let bgClass = 'bg-slate-900/90 text-slate-300 border-slate-800 hover:border-slate-600';
                      if (c.severity === FloodSeverity.CRITICAL) {
                        bgClass = isSelected
                          ? 'bg-red-600 border-white text-white font-bold ring-2 ring-red-400'
                          : 'bg-red-950/70 border-red-800/80 text-red-200 hover:bg-red-900';
                      } else if (c.severity === FloodSeverity.HIGH) {
                        bgClass = isSelected
                          ? 'bg-amber-600 border-white text-white font-bold ring-2 ring-amber-400'
                          : 'bg-amber-950/70 border-amber-800/80 text-amber-200 hover:bg-amber-900';
                      } else if (c.severity === FloodSeverity.MODERATE) {
                        bgClass = isSelected
                          ? 'bg-yellow-600 border-white text-white font-bold ring-2 ring-yellow-400'
                          : 'bg-yellow-950/60 border-yellow-800/80 text-yellow-200 hover:bg-yellow-900';
                      } else if (isSelected) {
                        bgClass = 'bg-cyan-600 border-white text-white font-bold ring-2 ring-cyan-400';
                      }

                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedCellId(c.id);
                            setGeneratedReportReady(false);
                            setDownloadSuccess(false);
                          }}
                          title={`${c.localityName} (${c.wardCode} · ${c.id})\nElevation: ${c.elevationM}m MSL\nFlood Prob: ${prob}%\nSeverity: ${c.severity}`}
                          className={`h-9 rounded p-0.5 border text-center flex flex-col items-center justify-center transition-all cursor-pointer ${bgClass}`}
                        >
                          <span className="text-[8px] font-mono leading-none opacity-80">
                            R{c.row}C{c.col}
                          </span>
                          <span className="text-[9px] font-mono font-bold leading-tight">
                            {prob}%
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Grid Legend & River Notes */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-400">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-sm bg-red-900 border border-red-600" />
                        Critical (≥70%)
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-sm bg-amber-900 border border-amber-600" />
                        High (45-70%)
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-sm bg-yellow-900 border border-yellow-600" />
                        Mod (25-45%)
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-sm bg-slate-800 border border-slate-700" />
                        Low (&lt;25%)
                      </span>
                    </div>
                    <span className="text-cyan-400">
                      ★ Active: {targetCell.id}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION 2: REPORT CONFIGURATION OPTIONS */}
            <div className="pt-3 border-t border-slate-800/80 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span className="text-xs font-mono text-cyan-300 font-bold uppercase tracking-wider">
                  2. Reporting Scope & Dossier Parameters
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Reporting Temporal Window</label>
                  <select
                    value={reportingPeriod}
                    onChange={(e) => {
                      setReportingPeriod(e.target.value as ReportingPeriod);
                      setGeneratedReportReady(false);
                    }}
                    className="w-full bg-[#070B14] border border-slate-700 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400 font-sans cursor-pointer"
                  >
                    <option value="CURRENT_6H">Current Active Window (Past 6 Hours)</option>
                    <option value="PAST_24H">Historical 24-Hour Cumulative Runoff</option>
                    <option value="NEXT_12H_FORECAST">Predictive 12-Hour Inundation Outlook</option>
                    <option value="FULL_INCIDENT">Comprehensive Incident Lifecycle Log</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Included Intelligence Sections</label>
                  <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-300">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeSpatialGridVisual}
                        onChange={(e) => setIncludeSpatialGridVisual(e.target.checked)}
                        className="accent-cyan-400"
                      />
                      Spatial Risk-Grid Mini-Map
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeSensorAudit}
                        onChange={(e) => setIncludeSensorAudit(e.target.checked)}
                        className="accent-cyan-400"
                      />
                      IoT Sensor Freshness Audit
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeRoadDisruptions}
                        onChange={(e) => setIncludeRoadDisruptions(e.target.checked)}
                        className="accent-cyan-400"
                      />
                      Road Network Mobility Status
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeEvacuationRoute}
                        onChange={(e) => setIncludeEvacuationRoute(e.target.checked)}
                        className="accent-cyan-400"
                      />
                      Evacuation Route Assessment
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeHistoricalEvents}
                        onChange={(e) => setIncludeHistoricalEvents(e.target.checked)}
                        className="accent-cyan-400"
                      />
                      Historical Flood Event Records
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includePrecautionsPlan}
                        onChange={(e) => setIncludePrecautionsPlan(e.target.checked)}
                        className="accent-cyan-400"
                      />
                      Precautions & Response Plan
                    </label>
                  </div>
                </div>
              </div>

              {/* Action trigger button */}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleGeneratePreview}
                  disabled={isGenerating}
                  className="px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-black font-semibold text-xs rounded transition-all flex items-center gap-2 cursor-pointer shadow-lg disabled:opacity-50"
                >
                  {isGenerating ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                      <span>Synthesizing Catchment Dossier...</span>
                    </>
                  ) : (
                    <>
                      <span>⚡</span>
                      <span>Generate & Review Dossier Preview</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* SECTION 3: LIVE DOSSIER PREVIEW & DOWNLOAD */}
          {generatedReportReady && (
            <div className="bg-[#0C1220] border-2 border-cyan-500/40 rounded-lg p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-700">
                      DOSSIER COMPILED & READY FOR EXPORT
                    </span>
                    <span
                      className="text-[10px] font-mono font-bold px-2 py-0.5 rounded text-white"
                      style={{ backgroundColor: riskColor.hex }}
                    >
                      {riskColor.label}
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-white mt-1">
                    {targetCell.localityName} ({targetCell.wardCode} · {targetCell.id})
                  </h4>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Window: {REPORTING_PERIOD_LABELS[reportingPeriod]} • Elevation: {targetCell.elevationM}m MSL
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleDownloadPDF}
                    className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-semibold text-xs rounded shadow-lg transition-all flex items-center gap-2 cursor-pointer border border-emerald-400/30"
                  >
                    <span>📥</span>
                    <span>Download Official PDF (A4)</span>
                  </button>
                </div>
              </div>

              {downloadSuccess && (
                <div className="p-3 bg-emerald-950/70 border border-emerald-600/70 rounded text-xs text-emerald-300 font-mono flex items-center gap-2 animate-in fade-in">
                  <span className="text-base">✓</span>
                  <div>
                    <strong>PDF Dossier Downloaded Successfully!</strong> Saved to your local workstation. Includes publication header, risk cards, spatial mini-map, evacuation routing, and municipal history.
                  </div>
                </div>
              )}

              {/* Sub-tabs for Preview */}
              <div className="flex flex-wrap gap-1.5 border-b border-slate-800/80 pb-2 text-xs font-mono">
                {[
                  { id: 'summary', label: '1. Executive Summary' },
                  { id: 'evacuation', label: '2. Evacuation Routes' },
                  { id: 'historical', label: `3. Historical Events (${verifiedHistRecords.length})` },
                  { id: 'precautions', label: '4. Response Plan' },
                  { id: 'telemetry', label: '5. Telemetry & Roads' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActivePreviewTab(tab.id as any)}
                    className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                      activePreviewTab === tab.id
                        ? 'bg-cyan-600 text-black font-semibold'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Sub-tab 1: Summary */}
              {activePreviewTab === 'summary' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
                    <div className="p-3 bg-[#070B14] border border-slate-800 rounded">
                      <div className="text-[10px] text-slate-400">Flood Inundation Probability</div>
                      <div className="text-xl font-bold text-red-400">
                        {Math.round(targetCell.floodProbability * 100)}%
                      </div>
                      <div className="text-[10px] text-slate-400">Predicted Depth: {targetCell.predictedDepthCm} cm</div>
                    </div>

                    <div className="p-3 bg-[#070B14] border border-slate-800 rounded">
                      <div className="text-[10px] text-slate-400">Rainfall Intensity / Cum</div>
                      <div className="text-xl font-bold text-cyan-300">
                        {targetCell.rainfallMmHr} mm/h
                      </div>
                      <div className="text-[10px] text-slate-400">Cumulative: {targetCell.cumulativeRainfallMm} mm</div>
                    </div>

                    <div className="p-3 bg-[#070B14] border border-slate-800 rounded">
                      <div className="text-[10px] text-slate-400">Vulnerable Population (Est.)</div>
                      <div className="text-xl font-bold text-indigo-300">
                        ~{targetCell.populationEstimate.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-slate-400">10-Yr Flood Count: {targetCell.historicalFloodCount10Yr} events</div>
                    </div>

                    <div className="p-3 bg-[#070B14] border border-slate-800 rounded">
                      <div className="text-[10px] text-slate-400">Telemetry Health / Quality</div>
                      <div className="text-xl font-bold text-emerald-400">
                        {dataHealthReport.overallHealthPct}%
                      </div>
                      <div className="text-[10px] text-slate-400">Model Conf: {Math.round(targetCell.confidence * 100)}%</div>
                    </div>
                  </div>

                  <div className="p-3 bg-[#070B14] border border-slate-800 rounded space-y-1.5 text-xs">
                    <div className="font-semibold text-slate-200">Contributing Hydrological Drivers</div>
                    <div className="space-y-1">
                      {targetCell.topDrivers.map((d, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2 bg-[#0A0F1D] rounded text-slate-300"
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                            <span className="font-medium text-white">{d.factor}</span>
                            <span className="text-slate-400 text-[11px]">({d.description})</span>
                          </div>
                          <span className="font-mono text-cyan-300 font-bold">{d.weight}% influence</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-tab 2: Evacuation */}
              {activePreviewTab === 'evacuation' && (
                <div className="space-y-3 text-xs">
                  <div className="p-3 bg-[#070B14] border border-slate-800 rounded space-y-2">
                    <div className="font-semibold text-cyan-300 font-mono flex items-center justify-between">
                      <span>B. Current Recommended Route [Calculated Route]</span>
                      <span className="text-[10px] text-slate-400">
                        Assigned Shelter: {targetCell.nearestShelterId}
                      </span>
                    </div>

                    {previewEvacRoute && previewEvacRoute.feasible && previewEvacRoute.primaryRoute ? (
                      <div className="space-y-1 text-slate-300">
                        <div>
                          <strong>Route Path:</strong> {previewEvacRoute.primaryRoute.roadNames.join(' ➔ ')}
                        </div>
                        <div className="font-mono text-cyan-200">
                          Distance: {previewEvacRoute.primaryRoute.distanceKm} km · ETA: {previewEvacRoute.primaryRoute.travelTimeMin} min (includes flood risk penalty)
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Safety Policy: Avoids CLOSED and submerged segments for patient/emergency safety.
                        </div>
                      </div>
                    ) : (
                      <div className="text-red-400 font-medium">
                        NO FEASIBLE ROUTE AVAILABLE: All corridors severed by CLOSED or flooded road segments.
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-[#070B14] border border-slate-800 rounded space-y-1">
                    <div className="font-semibold text-slate-200 font-mono">
                      A. Historical Evacuation Route Used [Historical Record]
                    </div>
                    {verifiedHistRecords.some((r) => r.routesActuallyUsed) ? (
                      <div className="text-slate-300 space-y-0.5">
                        {verifiedHistRecords
                          .filter((r) => r.routesActuallyUsed)
                          .map((r) => (
                            <div key={r.recordId} className="text-[11px]">
                              • {r.eventDate}: {r.routesActuallyUsed} (Dest: {r.sheltersOrDestinationsUsed})
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="text-slate-400 italic text-[11px]">
                        No verified historical evacuation route records exist for this location.
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-[#070B14] border border-slate-800 rounded space-y-1">
                    <div className="font-semibold text-slate-200 font-mono">
                      C. Alternative Evacuation Route [Calculated Route]
                    </div>
                    {previewEvacRoute?.alternativeRoute ? (
                      <div className="text-slate-300 text-[11px] space-y-0.5">
                        <div>Path: {previewEvacRoute.alternativeRoute.roadNames.join(' ➔ ')}</div>
                        <div className="text-cyan-300 font-mono">
                          Distance: {previewEvacRoute.alternativeRoute.distanceKm} km · ETA: {previewEvacRoute.alternativeRoute.travelTimeMin} min
                        </div>
                      </div>
                    ) : (
                      <div className="text-slate-400 italic text-[11px]">
                        No viable alternative bypass route exists without traversing high-hazard or closed road segments.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sub-tab 3: Historical Events */}
              {activePreviewTab === 'historical' && (
                <div className="space-y-3 text-xs">
                  {verifiedHistRecords.length > 0 ? (
                    verifiedHistRecords.map((rec) => (
                      <div key={rec.recordId} className="p-3 bg-[#070B14] border border-slate-800 rounded space-y-2">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                          <span className="font-semibold text-amber-300 font-mono">
                            {rec.eventTitle}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {rec.recordId} · {rec.eventDate}
                          </span>
                        </div>
                        <div className="space-y-1 text-slate-300 text-[11.5px]">
                          <div><strong>Conditions & Impact:</strong> {rec.recordedFloodConditions}</div>
                          <div><strong>Precautions Taken:</strong> {rec.precautionsTaken}</div>
                          <div><strong>Actions Performed:</strong> {rec.actionsPerformedByAuthorities}</div>
                          <div><strong>Evacuation Measures:</strong> {rec.evacuationMeasuresTaken}</div>
                          <div><strong>Routes & Shelters:</strong> {rec.routesActuallyUsed} (Dest: {rec.sheltersOrDestinationsUsed})</div>
                          <div className="text-[10px] text-slate-400 font-mono pt-1">
                            Source: {rec.sourceReference}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 bg-[#070B14] border border-slate-800 rounded space-y-2">
                      <div className="text-slate-300 font-semibold">
                        No verified historical flood response records are available for this location in the current data sources.
                      </div>
                      <div className="text-slate-400 text-xs">
                        • 10-Year Municipal Inundation Frequency: {targetCell.historicalFloodCount10Yr} events catalogued.<br />
                        • Local Terrain Context: {targetCell.historicalContext || 'Standard urban catchment terrain.'}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Sub-tab 4: Precautions Plan */}
              {activePreviewTab === 'precautions' && (
                <div className="p-3 bg-[#070B14] border border-slate-800 rounded space-y-2 text-xs">
                  <div className="font-semibold text-cyan-300 font-mono">
                    Recommended Precautions & Response Plan (Dossier Preview)
                  </div>
                  <ul className="space-y-1.5 text-slate-300 text-[11.5px]">
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 font-bold">1.</span>
                      <span><strong>Waterway & Telemetry Surveillance:</strong> Continuous monitoring of upstream river stage gauges and rainfall rates.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 font-bold">2.</span>
                      <span><strong>Official Public Alerts:</strong> Disseminate alerts via Indore 311 app, public sirens, and SMS cell-broadcast to Ward {targetCell.wardCode}.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 font-bold">3.</span>
                      <span><strong>Vulnerable Population Register:</strong> Pre-identify basement and ground-floor dwellers requiring special transport assistance.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 font-bold">4.</span>
                      <span><strong>Refuge Shelter Readiness:</strong> Confirm readiness and supplies at {targetCell.nearestShelterId} on elevated ground.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 font-bold">5.</span>
                      <span><strong>Corridor Barricading:</strong> Enforce complete traffic barricades at low-level bridge and underpass approaches.</span>
                    </li>
                  </ul>
                </div>
              )}

              {/* Sub-tab 5: Telemetry & Roads */}
              {activePreviewTab === 'telemetry' && (
                <div className="space-y-3 text-xs">
                  {/* Nearby Sensors */}
                  <div className="p-3 bg-[#070B14] border border-slate-800 rounded space-y-1.5">
                    <div className="font-semibold text-slate-200">Associated Sensor Telemetry ({localSensors.length} Stations)</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono">
                      {(localSensors.length > 0 ? localSensors : sensors.slice(0, 4)).map((s) => (
                        <div key={s.id} className="p-2 bg-[#0A0F1D] rounded flex items-center justify-between">
                          <div>
                            <div className="text-white font-medium text-[11px] truncate">{s.name}</div>
                            <div className="text-slate-400 text-[10px]">
                              {s.currentValue} {s.unit} · {s.diagnosticNote}
                            </div>
                          </div>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            s.freshnessState === 'FRESH'
                              ? 'text-emerald-400 bg-emerald-950/80 border border-emerald-800'
                              : 'text-amber-400 bg-amber-950/80 border border-amber-800'
                          }`}>
                            {s.freshnessState}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Connected Roads */}
                  <div className="p-3 bg-[#070B14] border border-slate-800 rounded space-y-1.5">
                    <div className="font-semibold text-slate-200">Connected Road Network ({localRoads.length} Corridors)</div>
                    <div className="space-y-1 text-[11px] font-mono">
                      {(localRoads.length > 0 ? localRoads : roads.slice(0, 3)).map((r) => (
                        <div key={r.id} className="p-2 bg-[#0A0F1D] rounded flex items-center justify-between">
                          <div>
                            <span className="text-white font-medium">{r.name}</span>
                            <span className="text-slate-400 text-[10px] ml-2">({r.corridorType})</span>
                          </div>
                          <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                            r.currentState === 'CLOSED'
                              ? 'text-red-400 bg-red-950/80'
                              : r.currentState === 'LIKELY_FLOODED'
                              ? 'text-orange-400 bg-orange-950/80'
                              : r.currentState === 'AT_RISK'
                              ? 'text-amber-400 bg-amber-950/80'
                              : 'text-emerald-400 bg-emerald-950/80'
                          }`}>
                            {r.currentState}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Sticky Footer */}
        <div className="shrink-0 px-4 py-3 bg-[#0C1222] border-t border-slate-800 flex items-center justify-between">
          <div className="text-[11px] text-slate-400 font-mono">
            Selected: <span className="text-cyan-300 font-semibold">{targetCell.localityName}</span> ({targetCell.wardCode} · {targetCell.id})
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs transition-colors cursor-pointer border border-slate-700"
            >
              Close
            </button>
            {generatedReportReady && (
              <button
                type="button"
                onClick={handleDownloadPDF}
                className="px-4 py-1.5 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-black font-semibold rounded text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <span>📥</span>
                <span>Download PDF</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
