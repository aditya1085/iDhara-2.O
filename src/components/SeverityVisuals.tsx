import React from 'react';
import {
  DataProvenance,
  FloodSeverity,
  ProductMode,
  RoadStatus,
  SensorFreshnessState,
  WarningLevel,
} from '../types/idhara';

export const SENSOR_FRESHNESS_META: Record<
  SensorFreshnessState,
  {
    label: SensorFreshnessState;
    glyph: string;
    textColor: string;
    borderColor: string;
    bgTint: string;
  }
> = {
  FRESH: {
    label: 'FRESH',
    glyph: '●',
    textColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/50',
    bgTint: 'bg-emerald-950/30',
  },
  STALE: {
    label: 'STALE',
    glyph: '◷',
    textColor: 'text-amber-300',
    borderColor: 'border-amber-500/50',
    bgTint: 'bg-amber-950/30',
  },
  SUSPECT: {
    label: 'SUSPECT',
    glyph: '▲',
    textColor: 'text-orange-400',
    borderColor: 'border-orange-500/60',
    bgTint: 'bg-orange-950/35',
  },
  MISSING: {
    label: 'MISSING',
    glyph: '✖',
    textColor: 'text-rose-400',
    borderColor: 'border-rose-500/60',
    bgTint: 'bg-rose-950/35',
  },
};

export const WARNING_LEVEL_META: Record<
  WarningLevel,
  {
    level: WarningLevel;
    actionTitle: string;
    glyph: string;
    textColor: string;
    borderColor: string;
    bgTint: string;
    ruleSummary: string;
  }
> = {
  [WarningLevel.RED]: {
    level: WarningLevel.RED,
    actionTitle: 'RED — EVACUATE & BARRICADE',
    glyph: '✖',
    textColor: 'text-rose-400',
    borderColor: 'border-rose-500/70',
    bgTint: 'bg-rose-950/45',
    ruleSummary: 'Severity = CRITICAL AND Flood Probability ≥ 72%',
  },
  [WarningLevel.ORANGE]: {
    level: WarningLevel.ORANGE,
    actionTitle: 'ORANGE — PREPARE',
    glyph: '▲',
    textColor: 'text-amber-400',
    borderColor: 'border-amber-500/70',
    bgTint: 'bg-amber-950/40',
    ruleSummary: 'Severity = CRITICAL OR (Severity = HIGH AND Probability ≥ 54%)',
  },
  [WarningLevel.YELLOW]: {
    level: WarningLevel.YELLOW,
    actionTitle: 'YELLOW — WATCH',
    glyph: '◆',
    textColor: 'text-yellow-300',
    borderColor: 'border-yellow-500/60',
    bgTint: 'bg-yellow-950/35',
    ruleSummary: 'Severity = MODERATE/HIGH OR Flood Probability ≥ 30%',
  },
  [WarningLevel.GREEN]: {
    level: WarningLevel.GREEN,
    actionTitle: 'GREEN — MONITOR',
    glyph: '●',
    textColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/50',
    bgTint: 'bg-emerald-950/25',
    ruleSummary: 'Severity = LOW AND Flood Probability < 30%',
  },
};

export const WarningLevelIndicator: React.FC<{
  level: WarningLevel;
  showDirective?: boolean;
}> = ({ level, showDirective = true }) => {
  const meta = WARNING_LEVEL_META[level];
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-xs font-bold ${meta.textColor} ${
        !showDirective
          ? `px-2 py-0.5 border ${meta.borderColor} ${meta.bgTint}`
          : ''
      }`}
    >
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{showDirective ? meta.actionTitle : `${meta.level} WARNING`}</span>
    </span>
  );
};

export const SEVERITY_META: Record<
  FloodSeverity,
  {
    label: string;
    shortCode: string;
    glyph: string;
    patternId: string;
    textColor: string;
    borderColor: string;
    bgTint: string;
    svgFill: string;
    svgStroke: string;
    patternDescription: string;
  }
> = {
  [FloodSeverity.CRITICAL]: {
    label: 'CRITICAL',
    shortCode: 'CRIT',
    glyph: '✖',
    patternId: 'url(#pattern-critical-crosshatch)',
    textColor: 'text-rose-400',
    borderColor: 'border-rose-500/60',
    bgTint: 'bg-rose-950/40',
    svgFill: 'rgba(239, 68, 68, 0.34)',
    svgStroke: '#EF4444',
    patternDescription: 'Crosshatch + ✖ Critical',
  },
  [FloodSeverity.HIGH]: {
    label: 'HIGH',
    shortCode: 'HIGH',
    glyph: '▲',
    patternId: 'url(#pattern-high-diagonal)',
    textColor: 'text-amber-400',
    borderColor: 'border-amber-500/60',
    bgTint: 'bg-amber-950/40',
    svgFill: 'rgba(249, 115, 22, 0.28)',
    svgStroke: '#F97316',
    patternDescription: 'Diagonal Stripe + ▲ High',
  },
  [FloodSeverity.MODERATE]: {
    label: 'MODERATE',
    shortCode: 'MOD',
    glyph: '◆',
    patternId: 'url(#pattern-moderate-dots)',
    textColor: 'text-yellow-300',
    borderColor: 'border-yellow-500/50',
    bgTint: 'bg-yellow-950/30',
    svgFill: 'rgba(234, 179, 8, 0.20)',
    svgStroke: '#EAB308',
    patternDescription: 'Stipple Dots + ◆ Moderate',
  },
  [FloodSeverity.LOW]: {
    label: 'LOW',
    shortCode: 'LOW',
    glyph: '●',
    patternId: 'none',
    textColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/40',
    bgTint: 'bg-emerald-950/25',
    svgFill: 'rgba(16, 185, 129, 0.09)',
    svgStroke: '#10B981',
    patternDescription: 'Solid Clear + ● Low',
  },
};

export const ROAD_STATUS_META: Record<
  RoadStatus,
  {
    label: string;
    glyph: string;
    textColor: string;
    strokeColor: string;
    dashArray: string;
  }
> = {
  [RoadStatus.CLOSED]: {
    label: 'CLOSED',
    glyph: '✖',
    textColor: 'text-rose-400',
    strokeColor: '#EF4444',
    dashArray: '4 4',
  },
  [RoadStatus.LIKELY_FLOODED]: {
    label: 'LIKELY_FLOODED',
    glyph: '▲',
    textColor: 'text-amber-400',
    strokeColor: '#F97316',
    dashArray: '8 4',
  },
  [RoadStatus.AT_RISK]: {
    label: 'AT_RISK',
    glyph: '◆',
    textColor: 'text-yellow-300',
    strokeColor: '#EAB308',
    dashArray: 'none',
  },
  [RoadStatus.OPEN]: {
    label: 'OPEN',
    glyph: '●',
    textColor: 'text-emerald-400',
    strokeColor: '#10B981',
    dashArray: 'none',
  },
};

export const MODE_META: Record<
  ProductMode,
  {
    label: string;
    shortDesc: string;
    accentText: string;
    borderClass: string;
    bgClass: string;
    indicatorSymbol: string;
    watermarkLabel: string;
    chipStyle: string;
  }
> = {
  [ProductMode.LIVE]: {
    label: 'LIVE',
    shortDesc: 'Live Municipal Telemetry Stream (Synthetic Sensors Active)',
    accentText: 'text-emerald-400',
    borderClass: 'border-emerald-500/80',
    bgClass: 'bg-[#031A12]',
    indicatorSymbol: '●',
    watermarkLabel: 'LIVE TELEMETRY STREAM',
    chipStyle: 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.25)]',
  },
  [ProductMode.SIMULATED]: {
    label: 'SIMULATED',
    shortDesc: 'Hydrological-Terrain Simulation (Digital Twin Scenario)',
    accentText: 'text-cyan-300',
    borderClass: 'border-cyan-500/70',
    bgClass: 'bg-[#041424]',
    indicatorSymbol: '◈',
    watermarkLabel: 'HYDRAULIC TWIN MODEL',
    chipStyle: 'bg-cyan-950/80 text-cyan-200 border border-cyan-400/80',
  },
  [ProductMode.HISTORICAL]: {
    label: 'HISTORICAL',
    shortDesc: 'Archived Indore Cloudburst Replay (Historical Log)',
    accentText: 'text-amber-300',
    borderClass: 'border-amber-500/70',
    bgClass: 'bg-[#1C1204]',
    indicatorSymbol: '◷',
    watermarkLabel: 'ARCHIVED EVENT REPLAY',
    chipStyle: 'bg-amber-950/80 text-amber-200 border border-amber-400/80',
  },
  [ProductMode.MOCK]: {
    label: 'MOCK',
    shortDesc: 'Deterministic Stress Benchmark (Offline Stub Bench)',
    accentText: 'text-fuchsia-300',
    borderClass: 'border-fuchsia-500/70',
    bgClass: 'bg-[#180A26]',
    indicatorSymbol: '▣',
    watermarkLabel: 'SYNTHETIC TEST BENCH',
    chipStyle: 'bg-fuchsia-950/80 text-fuchsia-200 border border-fuchsia-400/80',
  },
};

export const SeverityIndicator: React.FC<{
  severity: FloodSeverity;
  showPatternNote?: boolean;
}> = ({ severity, showPatternNote = false }) => {
  const meta = SEVERITY_META[severity];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold ${meta.textColor}`}>
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{meta.label}</span>
      {showPatternNote && (
        <span className="text-slate-400 font-normal">({meta.patternDescription})</span>
      )}
    </span>
  );
};

export const RoadStateIndicator: React.FC<{ state: RoadStatus }> = ({ state }) => {
  const meta = ROAD_STATUS_META[state];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold ${meta.textColor}`}>
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{meta.label}</span>
    </span>
  );
};

/**
 * Displays mandatory iDhara provenance metadata contract:
 * mode · scope_id · generated_at · data_as_of · confidence
 * Uses clean unboxed text with typographic separators (no static pill clutter).
 */
export const ProvenanceStrip: React.FC<{
  provenance: DataProvenance;
  expiry?: string;
  freshness?: string;
  compact?: boolean;
}> = ({ provenance, expiry, freshness = 'FRESH (<60s)', compact = false }) => {
  const modeMeta = MODE_META[provenance.mode];
  const genTime = provenance.generated_at.slice(11, 19) + 'Z';
  const asOfTime = provenance.data_as_of.slice(11, 19) + 'Z';
  const expTime = expiry ? expiry.slice(11, 19) + 'Z' : null;
  const confPct = Math.round(provenance.confidence * 100);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-slate-400 tabular-nums border-t border-slate-800/80 pt-2 mt-2 break-words min-w-0">
      <span className={`font-semibold ${modeMeta.accentText} break-words`}>
        {modeMeta.indicatorSymbol} MODE: {provenance.mode}
      </span>
      <span aria-hidden="true">·</span>
      <span className="break-words">SCOPE: {provenance.scope_id}</span>
      <span aria-hidden="true">·</span>
      <span className="text-slate-300 break-words">CONF: {confPct}%</span>
      <span aria-hidden="true">·</span>
      <span className="text-emerald-400 break-words">FRESHNESS: {freshness}</span>
      {!compact && (
        <>
          <span aria-hidden="true">·</span>
          <span className="break-words">TIMESTAMP: {genTime}</span>
          <span aria-hidden="true">·</span>
          <span className="break-words">AS_OF: {asOfTime}</span>
        </>
      )}
      {expTime && (
        <>
          <span aria-hidden="true">·</span>
          <span className="text-amber-300 break-words">EXP: {expTime}</span>
        </>
      )}
    </div>
  );
};

/**
 * Mandatory Data Honesty Strip for every major screen:
 * Clearly shows mode · scope · timestamp · confidence · freshness
 */
export const ScreenHonestyHeader: React.FC<{
  screenTitle: string;
  screenSubtle?: string;
  mode: ProductMode;
  scopeId: string;
  timestamp: string;
  confidencePct: number;
  freshnessLabel: string;
}> = ({
  screenTitle,
  screenSubtle,
  mode,
  scopeId,
  timestamp,
  confidencePct,
  freshnessLabel,
}) => {
  const modeMeta = MODE_META[mode];
  const cleanTime = timestamp.includes('T')
    ? timestamp.slice(11, 19) + ' UTC'
    : timestamp;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-[#060911] border border-slate-800/90 font-mono text-[11px] tabular-nums">
      <div className="flex items-center gap-2">
        <span className="text-slate-100 font-semibold tracking-tight">{screenTitle}</span>
        {screenSubtle && (
          <>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className="text-slate-400">{screenSubtle}</span>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px]">
        <span className={`font-semibold ${modeMeta.accentText}`}>
          {modeMeta.indicatorSymbol} MODE: {mode}
        </span>
        <span className="text-slate-600" aria-hidden="true">·</span>
        <span className="text-slate-300">
          SCOPE: <strong className="text-white font-semibold">{scopeId}</strong>
        </span>
        <span className="text-slate-600" aria-hidden="true">·</span>
        <span className="text-slate-300">
          TIMESTAMP: <strong className="text-slate-100 font-normal">{cleanTime}</strong>
        </span>
        <span className="text-slate-600" aria-hidden="true">·</span>
        <span className="text-slate-300">
          CONFIDENCE: <strong className="text-cyan-300 font-semibold">{confidencePct}%</strong>
        </span>
        <span className="text-slate-600" aria-hidden="true">·</span>
        <span className="text-slate-300">
          FRESHNESS: <strong className="text-emerald-400 font-semibold">{freshnessLabel}</strong>
        </span>
      </div>
    </div>
  );
};
