import React, { useState, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import {
  FloodRiskCell,
  RoadSegmentState,
  SensorNode,
  AlertItem,
  DataHealthReport,
  FloodSeverity,
  WarningLevel,
  UserRole,
} from '../types/idhara';

interface LocationReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  cells: FloodRiskCell[];
  roads: RoadSegmentState[];
  sensors: SensorNode[];
  alerts: AlertItem[];
  dataHealthReport: DataHealthReport;
  activeRole?: UserRole;
}

export type ReportingPeriod = 'CURRENT_6H' | 'PAST_24H' | 'NEXT_12H_FORECAST' | 'FULL_INCIDENT';

export const LocationReportModal: React.FC<LocationReportModalProps> = ({
  isOpen,
  onClose,
  cells,
  roads,
  sensors,
  alerts,
  dataHealthReport,
}) => {
  // 1. Selection states
  const [selectedCellId, setSelectedCellId] = useState<string>(cells[0]?.id || 'C-2-2');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [reportingPeriod, setReportingPeriod] = useState<ReportingPeriod>('CURRENT_6H');
  const [includeSensorAudit, setIncludeSensorAudit] = useState<boolean>(true);
  const [includeRoadDisruptions, setIncludeRoadDisruptions] = useState<boolean>(true);
  const [includeAlertsSummary, setIncludeAlertsSummary] = useState<boolean>(true);

  // 2. Report Generation states
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatedReportReady, setGeneratedReportReady] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);

  // Selected cell & surrounding context
  const targetCell = useMemo(() => {
    return cells.find((c) => c.id === selectedCellId) || cells[0];
  }, [cells, selectedCellId]);

  // Filtered dropdown options
  const filteredCells = useMemo(() => {
    if (!searchFilter.trim()) return cells;
    const q = searchFilter.toLowerCase();
    return cells.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.localityName.toLowerCase().includes(q) ||
        c.wardCode.toLowerCase().includes(q)
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
        Math.abs(s.lat - targetCell.lat) < 0.02 && Math.abs(s.lng - targetCell.lng) < 0.02
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

  // Period label helper
  const periodLabelMap: Record<ReportingPeriod, string> = {
    CURRENT_6H: 'Current Active Window (Past 6 Hours)',
    PAST_24H: 'Historical 24-Hour Cumulative Runoff',
    NEXT_12H_FORECAST: 'Predictive 12-Hour Inundation Outlook',
    FULL_INCIDENT: 'Comprehensive Incident Lifecycle Log',
  };

  const handleGeneratePreview = () => {
    setIsGenerating(true);
    setDownloadSuccess(false);
    setTimeout(() => {
      setIsGenerating(false);
      setGeneratedReportReady(true);
    }, 450);
  };

  const handleDownloadPDF = () => {
    if (!targetCell) return;
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 14;
      let y = 16;

      // Dark Mission Header Bar
      doc.setFillColor(8, 14, 26);
      doc.rect(0, 0, pageWidth, 28, 'F');

      // Header branding
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(34, 211, 238); // Cyan
      doc.text('iDhara — URBAN FLOOD EARLY WARNING & INTELLIGENCE SYSTEM', margin, y);

      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(203, 213, 225); // Slate 300
      doc.text(
        `OFFICIAL HYDROMETRIC & HAZARD REPORT | ISO 8601 DATA RUN: ${new Date().toISOString()}`,
        margin,
        y
      );

      y = 35;

      // Executive Summary Box
      doc.setFillColor(248, 250, 252); // Light background
      doc.setDrawColor(203, 213, 225);
      doc.rect(margin, y, pageWidth - margin * 2, 38, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42); // Slate 900
      doc.text(`Location: ${targetCell.localityName} (${targetCell.wardCode} · ${targetCell.id})`, margin + 4, y + 7);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`Reporting Window: ${periodLabelMap[reportingPeriod]}`, margin + 4, y + 13);
      doc.text(
        `Geographical Coordinates: ${targetCell.lat.toFixed(4)}° N, ${targetCell.lng.toFixed(4)}° E | Elevation: ${targetCell.elevationM}m MSL`,
        margin + 4,
        y + 19
      );
      doc.text(
        `Drainage Proxy: ${(targetCell.drainageProxyScore * 100).toFixed(0)}% Capacity | Impervious Surface: ${(targetCell.imperviousness * 100).toFixed(0)}%`,
        margin + 4,
        y + 25
      );
      doc.text(
        `Population At Risk (Est.): ~${targetCell.populationEstimate.toLocaleString()} residents | Historical 10-Yr Inundations: ${targetCell.historicalFloodCount10Yr} events`,
        margin + 4,
        y + 31
      );

      y += 45;

      // Key Metrics Row
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text('KEY HAZARD & TELEMETRY INDICATORS', margin, y);
      y += 5;

      const colW = (pageWidth - margin * 2 - 9) / 4;
      const kpis = [
        {
          label: 'Flood Probability',
          val: `${Math.round(targetCell.floodProbability * 100)}%`,
          sub: `Severity: ${targetCell.severity}`,
          color: targetCell.floodProbability >= 0.7 ? [220, 38, 38] : [217, 119, 6],
        },
        {
          label: 'Rainfall (1h / Cum)',
          val: `${targetCell.rainfallMmHr} mm/h`,
          sub: `Cum: ${targetCell.cumulativeRainfallMm} mm`,
          color: [2, 132, 199],
        },
        {
          label: 'Warning Hysteresis',
          val: targetCell.warningLevel,
          sub: `State: ${targetCell.warningHysteresis?.actionDirective || 'MONITOR'}`,
          color: targetCell.warningLevel === WarningLevel.RED ? [220, 38, 38] : [202, 138, 4],
        },
        {
          label: 'Sensor Health / Data',
          val: `${dataHealthReport.overallHealthPct}% Quality`,
          sub: `Confidence: ${Math.round(targetCell.confidence * 100)}%`,
          color: dataHealthReport.overallHealthPct >= 80 ? [22, 163, 74] : [217, 119, 6],
        },
      ];

      kpis.forEach((kpi, idx) => {
        const xPos = margin + idx * (colW + 3);
        doc.setFillColor(241, 245, 249);
        doc.rect(xPos, y, colW, 20, 'F');
        doc.setDrawColor(226, 232, 240);
        doc.rect(xPos, y, colW, 20, 'D');

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text(kpi.label, xPos + 3, y + 5);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
        doc.text(kpi.val, xPos + 3, y + 12);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(71, 85, 105);
        doc.text(kpi.sub.substring(0, 22), xPos + 3, y + 17);
      });

      y += 27;

      // Primary Hydrological Drivers
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text('PRIMARY FLOOD INUNDATION DRIVERS', margin, y);
      y += 5;

      targetCell.topDrivers.slice(0, 3).forEach((d) => {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, pageWidth - margin * 2, 9, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(30, 41, 59);
        doc.text(`• ${d.factor} (${d.weight}% influence):`, margin + 3, y + 5.5);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text(d.description.substring(0, 85), margin + 48, y + 5.5);
        y += 10;
      });

      y += 3;

      // Section: Local Telemetry & Sensor Availability
      if (includeSensorAudit) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(15, 23, 42);
        doc.text('LOCAL SENSOR TELEMETRY & FRESHNESS AUDIT', margin, y);
        y += 5;

        // Table Header
        doc.setFillColor(226, 232, 240);
        doc.rect(margin, y, pageWidth - margin * 2, 6, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(51, 65, 85);
        doc.text('Sensor ID / Name', margin + 3, y + 4.2);
        doc.text('Freshness State', margin + 55, y + 4.2);
        doc.text('Current Reading', margin + 95, y + 4.2);
        doc.text('Telemetry Diagnostics', margin + 130, y + 4.2);
        y += 7;

        const sensorsToPrint = localSensors.length > 0 ? localSensors : sensors.slice(0, 4);
        sensorsToPrint.forEach((s) => {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(30, 41, 59);
          doc.text(`${s.id} — ${s.name.substring(0, 22)}`, margin + 3, y + 4);

          // State styling
          if (s.freshnessState === 'FRESH') doc.setTextColor(22, 163, 74);
          else if (s.freshnessState === 'STALE') doc.setTextColor(202, 138, 4);
          else doc.setTextColor(220, 38, 38);
          doc.text(s.freshnessState, margin + 55, y + 4);

          doc.setTextColor(30, 41, 59);
          doc.text(`${s.currentValue} ${s.unit}`, margin + 95, y + 4);
          doc.text(`${s.diagnosticNote.substring(0, 35)} (${Math.round(s.confidence * 100)}% conf)`, margin + 130, y + 4);

          y += 5.5;
        });

        y += 3;
      }

      // Section: Connected Road Corridors & Mobility
      if (includeRoadDisruptions && y < 240) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(15, 23, 42);
        doc.text('CONNECTED ROAD NETWORK & MOBILITY IMPACT', margin, y);
        y += 5;

        const roadsToPrint = localRoads.length > 0 ? localRoads : roads.slice(0, 3);
        roadsToPrint.forEach((r) => {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(15, 23, 42);

          let statusColor: [number, number, number] = [22, 163, 74];
          if (r.currentState === 'CLOSED') statusColor = [220, 38, 38];
          else if (r.currentState === 'LIKELY_FLOODED') statusColor = [234, 88, 12];
          else if (r.currentState === 'AT_RISK') statusColor = [202, 138, 4];

          doc.text(`• ${r.name} (${r.corridorType})`, margin + 2, y + 4);
          doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
          doc.setFont('helvetica', 'bold');
          doc.text(`[${r.currentState}]`, margin + 85, y + 4);

          doc.setFont('helvetica', 'normal');
          doc.setTextColor(71, 85, 105);
          doc.text(`Est. Depth: ${r.estimatedWaterDepthCm}cm | Delay: +${r.riskPenaltyMin} min`, margin + 115, y + 4);
          y += 5;
        });

        y += 3;
      }

      // Section: Active Emergency Alerts Summary
      if (includeAlertsSummary && y < 260) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(15, 23, 42);
        doc.text('LOCAL OPERATIONAL ALERTS & DISPATCH DIRECTIVES', margin, y);
        y += 5;

        if (localAlerts.length === 0) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text('No active critical warnings published specifically for this grid cell.', margin + 3, y + 4);
          y += 6;
        } else {
          localAlerts.slice(0, 2).forEach((al) => {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(220, 38, 38);
            doc.text(`[${al.warningLevel}] ${al.id}: ${al.title.substring(0, 48)}`, margin + 3, y + 4);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(71, 85, 105);
            doc.text(`Directive: ${al.recommendedAction.substring(0, 85)}`, margin + 3, y + 8);
            y += 10;
          });
        }
      }

      // Footer disclaimer & Provenance
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, 282, pageWidth - margin, 282);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Generated by iDhara Command Console. Data Provenance: Mode LIVE, Confidence ${(targetCell.confidence * 100).toFixed(0)}%. Page 1 of 1`,
        margin,
        286
      );

      // Save document
      const fileName = `iDhara_Report_${targetCell.localityName.replace(/\s+/g, '_')}_${targetCell.id}_${Date.now()}.pdf`;
      doc.save(fileName);
      setDownloadSuccess(true);
    } catch (err) {
      console.error('Failed to generate PDF', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#090E1A] border border-cyan-500/30 rounded-lg shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden text-slate-100">
        {/* Top Header */}
        <div className="shrink-0 px-4 py-3.5 bg-[#0C1222] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <div>
              <h3 className="text-sm sm:text-base font-semibold text-white tracking-wide">
                Location PDF Report Generator
              </h3>
              <p className="text-[11px] text-cyan-300 font-mono">
                DATA HEALTH & RESILIENCE → HYDROMETRIC DOSSIER
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer text-sm font-mono"
            aria-label="Close Report Modal"
          >
            ✕ Close
          </button>
        </div>

        {/* Scrollable Workspace Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5 custom-scrollbar">
          {/* 1. Setup Controls: Map Grid Selector & Searchable Dropdown */}
          <div className="bg-[#0F172A]/70 border border-slate-800 rounded-md p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-xs font-mono text-cyan-300 font-semibold uppercase tracking-wider">
                1. Target Location Selection
              </span>
              <span className="text-[11px] text-slate-400">
                Interactive Grid or Search Dropdown
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Searchable Dropdown */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-medium">Search & Select Locality</label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Filter locality (e.g. Rajwada, Sarafa, C-2-2)..."
                    className="w-full bg-[#070B14] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                  {searchFilter && (
                    <button
                      type="button"
                      onClick={() => setSearchFilter('')}
                      className="absolute right-2 top-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <select
                  value={selectedCellId}
                  onChange={(e) => {
                    setSelectedCellId(e.target.value);
                    setGeneratedReportReady(false);
                  }}
                  className="w-full mt-1.5 bg-[#070B14] border border-slate-700 rounded px-2.5 py-2 text-xs text-cyan-300 focus:outline-none focus:border-cyan-400 font-mono cursor-pointer"
                  size={5}
                >
                  {filteredCells.map((c) => (
                    <option key={c.id} value={c.id} className="py-1">
                      {c.id} — {c.localityName} ({c.wardCode}) [{c.severity}]
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500">
                  Showing {filteredCells.length} of {cells.length} available wards. Click to choose.
                </p>
              </div>

              {/* Map-based Grid Selector */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-300 font-medium">Interactive Spatial Grid (Indore Basin)</label>
                  <span className="text-[10px] font-mono text-cyan-400">
                    Selected: {targetCell.id}
                  </span>
                </div>
                <div className="bg-[#070B14] border border-slate-800 p-2 rounded grid grid-cols-5 gap-1.5 aspect-video flex items-center justify-center">
                  {cells.map((c) => {
                    const isSelected = c.id === targetCell.id;
                    let bgColor = 'bg-slate-800/60 hover:bg-slate-700/80 border-slate-700';
                    if (c.severity === FloodSeverity.CRITICAL) {
                      bgColor = isSelected
                        ? 'bg-red-600 border-white text-white font-bold ring-2 ring-red-400'
                        : 'bg-red-950/70 border-red-800 text-red-200 hover:bg-red-900';
                    } else if (c.severity === FloodSeverity.HIGH) {
                      bgColor = isSelected
                        ? 'bg-amber-600 border-white text-white font-bold ring-2 ring-amber-400'
                        : 'bg-amber-950/70 border-amber-800 text-amber-200 hover:bg-amber-900';
                    } else if (isSelected) {
                      bgColor = 'bg-cyan-600 border-white text-white font-bold ring-2 ring-cyan-400';
                    }

                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedCellId(c.id);
                          setGeneratedReportReady(false);
                        }}
                        className={`text-[9.5px] font-mono p-1 rounded border transition-all truncate flex flex-col items-center justify-center cursor-pointer ${bgColor}`}
                        title={`${c.localityName} (${c.id}) — Prob: ${Math.round(c.floodProbability * 100)}%`}
                      >
                        <span className="truncate w-full text-center">{c.id}</span>
                        <span className="text-[8px] opacity-80">{Math.round(c.floodProbability * 100)}%</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10.5px] text-slate-400 italic">
                  Tap any grid cell to focus report generation on that catchment sector.
                </p>
              </div>
            </div>

            {/* Reporting Period & Scope Options */}
            <div className="pt-2 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <label className="text-slate-300 font-medium">Reporting Temporal Window</label>
                <select
                  value={reportingPeriod}
                  onChange={(e) => {
                    setReportingPeriod(e.target.value as ReportingPeriod);
                    setGeneratedReportReady(false);
                  }}
                  className="w-full bg-[#070B14] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-400 font-sans cursor-pointer"
                >
                  <option value="CURRENT_6H">Current Active Window (Past 6 Hours)</option>
                  <option value="PAST_24H">Historical 24-Hour Cumulative Runoff</option>
                  <option value="NEXT_12H_FORECAST">Predictive 12-Hour Inundation Outlook</option>
                  <option value="FULL_INCIDENT">Comprehensive Incident Lifecycle Log</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-medium">Included Telemetry Sections</label>
                <div className="flex flex-wrap gap-3 pt-1">
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={includeSensorAudit}
                      onChange={(e) => setIncludeSensorAudit(e.target.checked)}
                      className="accent-cyan-400"
                    />
                    Sensor Freshness Audit
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={includeRoadDisruptions}
                      onChange={(e) => setIncludeRoadDisruptions(e.target.checked)}
                      className="accent-cyan-400"
                    />
                    Road Mobility Status
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={includeAlertsSummary}
                      onChange={(e) => setIncludeAlertsSummary(e.target.checked)}
                      className="accent-cyan-400"
                    />
                    Active Alerts
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleGeneratePreview}
                disabled={isGenerating}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-black font-semibold text-xs rounded transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    Compiling Data Health Dossier...
                  </>
                ) : (
                  <>⚡ Generate & Preview Report</>
                )}
              </button>
            </div>
          </div>

          {/* 2. Compact Report Preview Box */}
          {generatedReportReady && (
            <div className="bg-[#0C1220] border-2 border-cyan-500/40 rounded-md p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                    REPORT READY FOR EXPORT
                  </span>
                  <h4 className="text-sm sm:text-base font-bold text-white mt-1">
                    Dossier Preview: {targetCell.localityName} ({targetCell.wardCode})
                  </h4>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Window: {periodLabelMap[reportingPeriod]} • Scope ID: {targetCell.id}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadPDF}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                  >
                    📥 Download PDF
                  </button>
                </div>
              </div>

              {downloadSuccess && (
                <div className="p-2.5 bg-emerald-950/60 border border-emerald-700/60 rounded text-xs text-emerald-300 font-mono flex items-center gap-2">
                  <span>✓</span>
                  <span>PDF successfully created and downloaded to your workstation!</span>
                </div>
              )}

              {/* Preview Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
                <div className="p-2.5 bg-[#070B14] border border-slate-800 rounded">
                  <div className="text-[10px] text-slate-400">Flood Inundation Risk</div>
                  <div className="text-base font-bold text-red-400">
                    {Math.round(targetCell.floodProbability * 100)}%
                  </div>
                  <div className="text-[10px] text-slate-400">Severity: {targetCell.severity}</div>
                </div>

                <div className="p-2.5 bg-[#070B14] border border-slate-800 rounded">
                  <div className="text-[10px] text-slate-400">Rainfall / Runoff</div>
                  <div className="text-base font-bold text-cyan-300">
                    {targetCell.rainfallMmHr} mm/h
                  </div>
                  <div className="text-[10px] text-slate-400">Cum: {targetCell.cumulativeRainfallMm} mm</div>
                </div>

                <div className="p-2.5 bg-[#070B14] border border-slate-800 rounded">
                  <div className="text-[10px] text-slate-400">Telemetry Health</div>
                  <div className="text-base font-bold text-emerald-400">
                    {dataHealthReport.overallHealthPct}%
                  </div>
                  <div className="text-[10px] text-slate-400">Confidence: {Math.round(targetCell.confidence * 100)}%</div>
                </div>

                <div className="p-2.5 bg-[#070B14] border border-slate-800 rounded">
                  <div className="text-[10px] text-slate-400">Warning Hysteresis</div>
                  <div className="text-base font-bold text-amber-300">
                    {targetCell.warningLevel}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {targetCell.warningHysteresis?.actionDirective || 'ACTIVE'}
                  </div>
                </div>
              </div>

              {/* Inundation Driver Breakdown */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-200">Key Contributing Drivers</div>
                <div className="space-y-1">
                  {targetCell.topDrivers.map((d, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 bg-[#070B14] border border-slate-800/80 rounded text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        <span className="font-medium text-slate-200">{d.factor}</span>
                        <span className="text-slate-400 text-[11px]">({d.description})</span>
                      </div>
                      <span className="font-mono text-cyan-300 font-semibold">{d.weight}% impact</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Data Availability & Sensor Audit Summary */}
              {includeSensorAudit && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-slate-200 flex items-center justify-between">
                    <span>Associated Sensor Health & Availability</span>
                    <span className="text-[10px] font-mono text-cyan-400">
                      {localSensors.length > 0 ? `${localSensors.length} Stations in Basin` : 'Regional Mesh'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(localSensors.length > 0 ? localSensors : sensors.slice(0, 4)).map((s) => (
                      <div
                        key={s.id}
                        className="p-2 bg-[#070B14] border border-slate-800 rounded text-xs flex items-center justify-between font-mono"
                      >
                        <div>
                          <div className="text-slate-200 font-semibold text-[11px] truncate">{s.name}</div>
                          <div className="text-[10px] text-slate-400">
                            Reading: {s.currentValue} {s.unit} • Last seen: {s.lastSeenLabel}
                          </div>
                        </div>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            s.freshnessState === 'FRESH'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                              : s.freshnessState === 'STALE'
                              ? 'bg-amber-950 text-amber-400 border border-amber-800'
                              : 'bg-red-950 text-red-400 border border-red-800'
                          }`}
                        >
                          {s.freshnessState}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Local Road Disruptions & Alerts Count */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                {includeRoadDisruptions && (
                  <div className="p-2.5 bg-[#070B14] border border-slate-800 rounded space-y-1">
                    <div className="font-semibold text-slate-300">Corridor Mobility</div>
                    <div className="text-[11px] text-slate-400">
                      {localRoads.length} arterial/collector roads surveyed.
                      {localRoads.some((r) => r.currentState === 'CLOSED') ? (
                        <span className="text-red-400 font-medium ml-1">Critical closures active.</span>
                      ) : (
                        <span className="text-emerald-400 font-medium ml-1">Transit passages passable.</span>
                      )}
                    </div>
                  </div>
                )}

                {includeAlertsSummary && (
                  <div className="p-2.5 bg-[#070B14] border border-slate-800 rounded space-y-1">
                    <div className="font-semibold text-slate-300">Directives & Alerts</div>
                    <div className="text-[11px] text-slate-400">
                      {localAlerts.length > 0 ? (
                        <span className="text-amber-300 font-medium">
                          {localAlerts.length} active emergency alert(s) logged for this catchment.
                        </span>
                      ) : (
                        <span className="text-slate-400">No active localized evacuation order.</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="shrink-0 px-4 py-3 bg-[#0C1222] border-t border-slate-800 flex items-center justify-between">
          <div className="text-[11px] text-slate-400 font-mono">
            Location: <span className="text-cyan-300 font-semibold">{targetCell.localityName}</span> ({targetCell.id})
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs transition-colors cursor-pointer"
            >
              Close
            </button>
            {generatedReportReady && (
              <button
                type="button"
                onClick={handleDownloadPDF}
                className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-black font-semibold rounded text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                📥 Download PDF
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
