import { HISTORICAL_EVENT_PRESETS } from '../data/indorePilotData';
import {
  HistoricalEventPreset,
  ScenarioParameters,
} from '../types/idhara';

export function getEventPresets(): HistoricalEventPreset[] {
  return HISTORICAL_EVENT_PRESETS;
}

export function getPresetById(id: string): HistoricalEventPreset {
  return (
    HISTORICAL_EVENT_PRESETS.find((e) => e.id === id) ??
    HISTORICAL_EVENT_PRESETS[0]
  );
}

/**
 * Computes scenario parameters when scrubbing across the hourly timeline of an event.
 */
export function resolveTimelineStepParameters(
  currentParams: ScenarioParameters,
  hourOffset: number
): ScenarioParameters {
  const preset = getPresetById(currentParams.activeEventPresetId);
  const stepEntry =
    preset.hourlyRainProfile.find((p) => p.hourOffset === hourOffset) ??
    preset.hourlyRainProfile[3];

  return {
    ...currentParams,
    mode: preset.mode,
    stage: stepEntry.stage,
    rainfallIntensityMmHr: stepEntry.mmHr,
    timelineHourOffset: hourOffset,
  };
}
