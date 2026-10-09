import React, { useState } from 'react';
import { BASE_ROAD_SEGMENTS, BASE_SENSORS } from '../data/indorePilotData';
import {
  ActivityFeedEntry,
  ObservationInjectionType,
  RoadSegmentState,
  SensorNode,
} from '../types/idhara';
import { MapInspectionTarget } from './IndoreFloodMap';

interface LiveFeedSimulatorProps {
  roads: RoadSegmentState[];
  sensors: SensorNode[];
  activityFeed: ActivityFeedEntry[];
  activeRouteRoadIds?: string[];
  onInjectObservation: (
    type: ObservationInjectionType,
    targetId: string
  ) => void;
  onResetObservations: () => void;
  onSelectMapTarget: (target: MapInspectionTarget) => void;
  compact?: boolean;
}

export const LiveFeedSimulator: React.FC<LiveFeedSimulatorProps> = ({
  roads,
  sensors,
  activityFeed,
  activeRouteRoadIds,
  onInjectObservation,
  onResetObservations,
  onSelectMapTarget,
  compact = false,
}) => {
  const [selectedRoadId, setSelectedRoadId] = useState<string>(
    activeRouteRoadIds?.[0] ?? 'RD-14'
  ); // Defaults to first passable road on active route or Patel Bridge
  const [selectedSensorId, setSelectedSensorId] = useState<string>('SEN-WL-01'); // Krishnapura Bridge Gauge

  // Keep selectedRoadId aligned if active route changes and user hasn't manually switched
  React.useEffect(() => {
    if (activeRouteRoadIds && activeRouteRoadIds.length > 0 && !activeRouteRoadIds.includes(selectedRoadId)) {
      setSelectedRoadId(activeRouteRoadIds[0]);
    }
  }, [activeRouteRoadIds]);

  return (
    <div className="bg-[#080C14] border border-slate-800/90 p-3 space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <div>
            <div className="font-mono text-[10.5px] text-cyan-400 font-semibold">
              LIVE FEED SIMULATOR & OBSERVATION INJECTOR
            </div>
            {!compact && (
              <div className="text-xs text-slate-300">
                Inject synthetic real-time observations into the prediction, road-state & routing pipeline
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onResetObservations}
          className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 font-mono text-[10.5px] text-slate-300 whitespace-nowrap transition-colors"
        >
          ↺ Reset Feed
        </button>
      </div>

      {/* Target Selectors for Road & Sensor */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px]">
        <div className="flex items-center gap-1.5">
          <label htmlFor="sim-road-select" className="text-slate-400 shrink-0">
            Target Road:
          </label>
          <select
            id="sim-road-select"
            value={selectedRoadId}
            onChange={(e) => setSelectedRoadId(e.target.value)}
            className="flex-1 min-w-0 bg-[#0D1320] border border-slate-700 text-slate-200 px-2 py-1 text-[11px] truncate"
          >
            {roads.map((r) => {
              const isOnRoute = activeRouteRoadIds?.includes(r.id);
              return (
                <option key={r.id} value={r.id}>
                  {isOnRoute ? '★ [ON ROUTE] ' : ''}
                  {r.id}: {r.name.slice(0, 24)} ({r.currentState})
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label htmlFor="sim-sensor-select" className="text-slate-400 shrink-0">
            Target Sensor:
          </label>
          <select
            id="sim-sensor-select"
            value={selectedSensorId}
            onChange={(e) => setSelectedSensorId(e.target.value)}
            className="flex-1 min-w-0 bg-[#0D1320] border border-slate-700 text-slate-200 px-2 py-1 text-[11px] truncate"
          >
            {sensors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}: {s.name.slice(0, 24)} ({s.freshnessState})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 7 Injection Action Buttons */}
      <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
        <button
          type="button"
          onClick={() => onInjectObservation('RAINFALL_INCREASE', selectedSensorId)}
          className="px-2 py-1.5 bg-sky-950/50 hover:bg-sky-900/60 border border-sky-500/50 text-sky-200 text-left text-[10.5px] leading-snug break-words min-w-0 transition-colors cursor-pointer"
        >
          + Rainfall increase
        </button>

        <button
          type="button"
          onClick={() => onInjectObservation('WATER_LEVEL_INCREASE', selectedSensorId)}
          className="px-2 py-1.5 bg-cyan-950/50 hover:bg-cyan-900/60 border border-cyan-500/50 text-cyan-200 text-left text-[10.5px] leading-snug break-words min-w-0 transition-colors cursor-pointer"
        >
          ▲ Water-level increase
        </button>

        <button
          type="button"
          onClick={() => onInjectObservation('ROAD_LIKELY_FLOODED', selectedRoadId)}
          className="px-2 py-1.5 bg-amber-950/60 hover:bg-amber-900/70 border border-amber-500/60 text-amber-200 text-left text-[10.5px] leading-snug break-words min-w-0 transition-colors cursor-pointer"
        >
          ▲ Road likely flooded
        </button>

        <button
          type="button"
          onClick={() => onInjectObservation('ROAD_CLOSURE', selectedRoadId)}
          className="px-2 py-1.5 bg-rose-950/50 hover:bg-rose-900/60 border border-rose-500/50 text-rose-200 text-left text-[10.5px] leading-snug break-words min-w-0 transition-colors cursor-pointer"
        >
          ✖ Road closure
        </button>

        <button
          type="button"
          onClick={() => onInjectObservation('ROAD_REOPENED', selectedRoadId)}
          className="px-2 py-1.5 bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-500/50 text-emerald-200 text-left text-[10.5px] leading-snug break-words min-w-0 transition-colors cursor-pointer"
        >
          ● Road reopened
        </button>

        <button
          type="button"
          onClick={() => onInjectObservation('CROWD_REPORT', selectedRoadId)}
          className="px-2 py-1.5 bg-amber-950/50 hover:bg-amber-900/60 border border-amber-500/50 text-amber-200 text-left text-[10.5px] leading-snug break-words min-w-0 transition-colors cursor-pointer"
        >
          ⚑ Crowd report
        </button>

        <button
          type="button"
          onClick={() => onInjectObservation('SENSOR_FAILURE', selectedSensorId)}
          className="col-span-2 px-2 py-1.5 bg-purple-950/50 hover:bg-purple-900/60 border border-purple-500/50 text-purple-200 text-left text-[10.5px] leading-snug break-words min-w-0 transition-colors cursor-pointer"
        >
          ⚡ Sensor failure
        </button>
      </div>

      {/* Real-Time Cascading Activity Feed */}
      <div className="bg-[#05080F] border border-slate-800/90 p-2.5">
        <div className="flex items-center justify-between font-mono text-[10px] text-slate-400 mb-1.5">
          <span>REAL-TIME OPERATIONS ACTIVITY FEED</span>
          <span className="text-emerald-400 shrink-0">● STREAMING PIPELINE</span>
        </div>
        <div className="space-y-1.5 max-h-40 overflow-y-auto overflow-x-hidden font-mono text-[11px] tabular-nums pr-1">
          {activityFeed.map((entry) => (
            <div
              key={entry.id}
              onClick={() =>
                entry.relatedTarget && onSelectMapTarget(entry.relatedTarget)
              }
              className={`px-2 py-1 border-l-2 bg-[#0A0F1A] flex items-start justify-between gap-2 ${
                entry.relatedTarget ? 'cursor-pointer hover:bg-slate-900' : ''
              } ${
                entry.severity === 'CRITICAL'
                  ? 'border-rose-500 text-rose-200'
                  : entry.severity === 'WARNING'
                  ? 'border-amber-400 text-amber-200'
                  : entry.severity === 'SUCCESS'
                  ? 'border-emerald-400 text-emerald-200'
                  : 'border-cyan-400 text-slate-200'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-400">{entry.timestamp}</span>
                  {entry.eventTypeLabel && (
                    <span className="px-1.5 py-0.2 bg-slate-900 border border-slate-700 text-cyan-300 font-bold text-[10px]">
                      {entry.eventTypeLabel}
                    </span>
                  )}
                  <span className="font-medium break-words">{entry.message}</span>
                </div>
                {entry.detail && (
                  <div className="text-[10px] text-slate-400 mt-0.5 break-words">
                    {entry.detail}
                  </div>
                )}
              </div>
              <span className="text-[9.5px] text-slate-500 shrink-0">
                {entry.category}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
