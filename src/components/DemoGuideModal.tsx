import React, { useState } from 'react';
import { Logo } from './Logo';
import {
  DisasterStage,
  NavigationTab,
  ObservationInjectionType,
  ProductMode,
  RoadSegmentState,
  RouteRecommendation,
  ScenarioParameters,
} from '../types/idhara';
import { MapInspectionTarget } from './IndoreFloodMap';

interface DemoGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: NavigationTab;
  onNavigateTab: (tab: NavigationTab) => void;
  onSelectTarget: (target: MapInspectionTarget) => void;
  onUpdateParams: (updater: (prev: ScenarioParameters) => ScenarioParameters) => void;
  onInjectObservation: (type: ObservationInjectionType, targetId: string) => void;
  onResetObservations: () => void;
  onTriggerDemoIncident: () => void;
  activeRoute: RouteRecommendation | null;
  roads: RoadSegmentState[];
}

interface DemoStepGroup {
  id: string;
  stageName: string;
  stepRange: string;
  title: string;
  description: string;
  items: Array<{ num: number; text: string }>;
  actionLabel: string;
  action: () => void;
}

export const DemoGuideModal: React.FC<DemoGuideModalProps> = ({
  isOpen,
  onClose,
  activeTab,
  onNavigateTab,
  onSelectTarget,
  onUpdateParams,
  onInjectObservation,
  onResetObservations,
  onTriggerDemoIncident,
  activeRoute,
  roads,
}) => {
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);

  if (!isOpen) return null;

  const demoGroups: DemoStepGroup[] = [
    {
      id: 'GROUP-1',
      stageName: 'PREDICT & MONITOR',
      stepRange: 'Steps 1 – 3',
      title: 'Current Pilot State & Telemetry',
      description: 'Establish situational awareness across the 5×5 km pilot scope.',
      items: [
        { num: 1, text: 'Open Overview' },
        { num: 2, text: 'Show current Indore pilot state (5×5 km scope, situation metrics)' },
        { num: 3, text: 'Show rainfall intensity (42 mm/h) and data confidence (~88%)' },
      ],
      actionLabel: '1. Go to Overview',
      action: () => {
        onNavigateTab('overview');
      },
    },
    {
      id: 'GROUP-2',
      stageName: 'EXPLAIN & INSPECT',
      stepRange: 'Steps 4 – 6',
      title: 'Risk Map & High-Risk Hotspot Inspection',
      description: 'Inspect localized hydrological risk and explain physical drivers.',
      items: [
        { num: 4, text: 'Open Risk Map' },
        { num: 5, text: 'Click high-risk cell (CELL-R2C2: Krishnapura Confluence)' },
        { num: 6, text: 'Show: probability (78%), severity (HIGH), confidence (88%), top drivers' },
      ],
      actionLabel: '2. Inspect High-Risk Cell',
      action: () => {
        onNavigateTab('risk-map');
        onSelectTarget({ type: 'CELL', id: 'CELL-R2C2' });
      },
    },
    {
      id: 'GROUP-3',
      stageName: 'SIMULATE & STRESS TEST',
      stepRange: 'Steps 7 – 10',
      title: 'Disaster Twin (+20% Storm Surge)',
      description: 'Run what-if scenario to forecast expansion without mutating live state.',
      items: [
        { num: 7, text: 'Open Disaster Twin' },
        { num: 8, text: 'Increase rainfall by +20% (click +20% Rainfall Burst preset)' },
        { num: 9, text: 'Show affected area expanding (+2.34 km² to 8.59 km²)' },
        { num: 10, text: 'Show additional roads becoming at risk (+4 roads at risk)' },
      ],
      actionLabel: '3. Open Disaster Twin (+20%)',
      action: () => {
        onNavigateTab('disaster-twin');
      },
    },
    {
      id: 'GROUP-4',
      stageName: 'VERIFY & RETURN',
      stepRange: 'Step 11',
      title: 'Return to LIVE Operational Stream',
      description: 'Transition seamlessly from isolated simulation back to live monitoring.',
      items: [
        { num: 11, text: 'Return to LIVE state (confirm mode badge changes to LIVE)' },
      ],
      actionLabel: '4. Return to LIVE State',
      action: () => {
        onUpdateParams((prev) => ({
          ...prev,
          mode: ProductMode.LIVE,
          timelineHourOffset: 0,
        }));
        onNavigateTab('overview');
      },
    },
    {
      id: 'GROUP-5',
      stageName: 'INJECT & REROUTE',
      stepRange: 'Steps 12 – 15',
      title: 'Live Ingestion, Road Flooding & Dynamic Rerouting',
      description: 'Feed ultrasonic surge and road inundation to trigger real-time rerouting.',
      items: [
        { num: 12, text: 'Inject a water-level observation (+0.45m ultrasonic surge at SEN-WL-01)' },
        { num: 13, text: 'Change road to LIKELY FLOODED (invalidates current corridor)' },
        { num: 14, text: 'Trigger automatic rerouting (Dijkstra removes flooded segment)' },
        { num: 15, text: 'Show route changing (red dashed blocked path & cyan recommended path)' },
      ],
      actionLabel: '5. Inject Inundation & Trigger Reroute',
      action: () => {
        onNavigateTab('roads-routing');
        onInjectObservation('WATER_LEVEL_INCREASE', 'SEN-WL-01');
        const targetRoadId =
          activeRoute?.primaryRoute?.roadIds[0] ??
          roads.find((r) => r.currentState === 'OPEN')?.id ??
          'RD-11';
        onInjectObservation('ROAD_LIKELY_FLOODED', targetRoadId);
      },
    },
    {
      id: 'GROUP-6',
      stageName: 'EVACUATE & DISPATCH',
      stepRange: 'Steps 16 – 19',
      title: 'Evacuation Mode & Capacity-Aware Shelter Allocation',
      description: 'Evaluate high-risk zones, allocate reachable shelters, avoid saturation.',
      items: [
        { num: 16, text: 'Enter Evacuation Mode' },
        { num: 17, text: 'Show affected zones (localities above ≥50% threshold)' },
        { num: 18, text: 'Assign shelters (hospitals → schools → vulnerable zones priority)' },
        { num: 19, text: 'Show shelter capacity (occupancy, remaining berths, no negative capacity)' },
      ],
      actionLabel: '6. Open Evacuation Mode',
      action: () => {
        onNavigateTab('evacuation');
      },
    },
    {
      id: 'GROUP-7',
      stageName: 'REPLAY & LEARN',
      stepRange: 'Steps 20 – 23',
      title: 'Historical Event Replay & Model Validation',
      description: 'Reconstruct past cloudburst, evaluate predicted vs observed, review metrics.',
      items: [
        { num: 20, text: 'Open Event Replay' },
        { num: 21, text: 'Replay a historical event (monsoon cloudburst archive)' },
        { num: 22, text: 'Show predicted vs observed (8×8 matrix, hourly timeline)' },
        { num: 23, text: 'Show validation metrics (False Negatives audit, precision, recall)' },
      ],
      actionLabel: '7. Open Event Replay & Validation',
      action: () => {
        onNavigateTab('event-replay');
        onUpdateParams((prev) => ({
          ...prev,
          mode: ProductMode.HISTORICAL,
          activeEventPresetId: 'EVT-HIST-SEP-2023',
          stage: DisasterStage.POST_DISASTER_LEARNING,
          timelineHourOffset: 0,
        }));
      },
    },
    {
      id: 'GROUP-8',
      stageName: 'DATA HEALTH & RESILIENCE',
      stepRange: 'Steps 24 – 26',
      title: 'Data Health & Telemetry Degradation Test',
      description: 'Test graceful degradation under packet loss or gauge failure.',
      items: [
        { num: 24, text: 'Open Data Health' },
        { num: 25, text: 'Simulate sensor failure (inject SEN-RG-01 → MISSING)' },
        { num: 26, text: 'Show confidence decreasing (health drops, uncertainty widens)' },
      ],
      actionLabel: '8. Open Data Health & Simulate Failure',
      action: () => {
        onNavigateTab('data-health');
        onInjectObservation('SENSOR_FAILURE', 'SEN-RG-01');
      },
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-guide-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl bg-[#080C14] border border-cyan-500/60 shadow-[0_0_30px_rgba(6,182,212,0.15)] overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="px-5 py-3.5 bg-[#0A0F1D] border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Logo size="sm" showText={false} />
            <div>
              <h2 id="demo-guide-title" className="text-sm font-bold text-white tracking-wide font-mono">
                iDhara Demo Walkthrough — 26-Step Verification Path
              </h2>
              <div className="text-[11px] text-cyan-300 font-mono">
                From Prediction to Protection · Seamless End-to-End Control Room Sequence
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onResetObservations}
              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 transition-colors"
              title="Reset all injected observations to clean baseline state"
            >
              ↺ Reset Telemetry
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white font-mono text-xs transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Sub-Banner */}
        <div className="px-5 py-2 bg-[#060A12] border-b border-slate-800/80 font-mono text-xs flex flex-wrap items-center justify-between text-slate-400">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-emerald-400 font-semibold">● FULL CHAIN:</span>
            <span>PREDICT → EXPLAIN → WARN → SIMULATE → VERIFY → REROUTE → EVACUATE → LEARN</span>
          </div>
          <span className="text-[11px] text-slate-400">
            Prototype — simulated operational data
          </span>
        </div>

        {/* Main Content Area */}
        <div className="p-5 overflow-y-auto space-y-3.5 flex-1 font-mono text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {demoGroups.map((group, idx) => {
              const isSelected = activeStepIndex === idx;
              return (
                <div
                  key={group.id}
                  className={`p-3.5 border transition-all ${
                    isSelected
                      ? 'bg-cyan-950/30 border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.1)]'
                      : 'bg-[#0B101C] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 text-[10px] font-bold text-cyan-300">
                      {group.stepRange}
                    </span>
                    <span className="text-[10px] text-slate-400 tracking-wider">
                      {group.stageName}
                    </span>
                  </div>

                  <h3 className="text-sm font-semibold text-white font-sans">
                    {group.title}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5 mb-2.5 font-sans leading-relaxed">
                    {group.description}
                  </p>

                  {/* Checklist Items */}
                  <div className="space-y-1 mb-3 pt-2 border-t border-slate-800/80 text-[11px]">
                    {group.items.map((item) => (
                      <div key={item.num} className="flex items-start gap-1.5 text-slate-300">
                        <span className="text-emerald-400 font-bold shrink-0">✓</span>
                        <span className="leading-snug">
                          <strong className="text-slate-200">#{item.num}:</strong> {item.text}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Direct Action Button */}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveStepIndex(idx);
                      group.action();
                      onClose();
                    }}
                    className={`w-full py-2 px-3 border font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                      isSelected
                        ? 'bg-cyan-500 text-slate-950 border-cyan-300 hover:bg-cyan-400'
                        : 'bg-cyan-950/60 hover:bg-cyan-900/80 border-cyan-500/60 text-cyan-200'
                    }`}
                  >
                    <span>▶ Execute Action: {group.actionLabel}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#0A0F1D] border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 font-mono text-xs shrink-0">
          <div className="text-slate-400 text-[11px]">
            Click any action above to automatically jump to the screen and setup the demonstration state.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-semibold"
          >
            Close Guide (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
