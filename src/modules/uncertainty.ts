import {
  BaseGridCell,
  ProductMode,
  ScenarioParameters,
  SensorNode,
} from '../types/idhara';

export interface CellUncertaintyResult {
  confidence: number;
  uncertaintyBand: number; // +/- probability spread
  freshnessSec: number;
  freshnessLabel: string;
  verifiedBySensorId?: string;
}

/**
 * Evaluates epistemic and telemetry uncertainty for a specific grid cell
 * given nearby sensor health, mode, and storm severity.
 */
export function computeCellUncertainty(
  cell: BaseGridCell,
  sensors: SensorNode[],
  params: ScenarioParameters
): CellUncertaintyResult {
  const directSensor = sensors.find((s) => s.cellId === cell.id);
  const activeSensors = sensors.filter((s) => s.status !== 'STALE');
  const sensorCoverageRatio = activeSensors.length / Math.max(1, sensors.length);

  let baseConfidence = 0.84;

  // Direct ultrasonic or rain gauge in the cell increases local confidence
  if (directSensor && directSensor.status !== 'STALE') {
    baseConfidence += 0.09;
  } else if (directSensor && directSensor.status === 'STALE') {
    baseConfidence -= 0.18;
  }

  // Degrade confidence when sensors drop out across the pilot grid
  baseConfidence -= (1 - sensorCoverageRatio) * 0.25;

  // High drainage blockage increases model epistemic uncertainty (subsurface choke variance)
  if (params.drainageBlockagePct > 50) {
    baseConfidence -= 0.06;
  }

  // Mode adjustments
  if (params.mode === ProductMode.MOCK) {
    baseConfidence = Math.min(baseConfidence, 0.78);
  } else if (params.mode === ProductMode.HISTORICAL) {
    baseConfidence = Math.min(0.95, baseConfidence + 0.05);
  }

  const clampedConfidence = Number(Math.max(0.35, Math.min(0.96, baseConfidence)).toFixed(2));
  const uncertaintyBand = Number(((1 - clampedConfidence) * 0.45).toFixed(2));

  const freshnessSec = directSensor
    ? directSensor.lastHeartbeatSecAgo
    : 45 + ((cell.row * 8 + cell.col) * 9) % 75;

  const freshnessLabel =
    freshnessSec > 600
      ? `Stale (${Math.round(freshnessSec / 60)}m ago)`
      : `${freshnessSec}s ago`;

  return {
    confidence: clampedConfidence,
    uncertaintyBand,
    freshnessSec,
    freshnessLabel,
    verifiedBySensorId: directSensor && directSensor.status !== 'STALE' ? directSensor.id : undefined,
  };
}

/**
 * Computes aggregate system-wide confidence score across the 5x5 km pilot area.
 */
export function computeSystemConfidence(
  sensors: SensorNode[],
  params: ScenarioParameters
): number {
  const staleCount = sensors.filter((s) => s.status === 'STALE').length;
  const driftingCount = sensors.filter((s) => s.status === 'DRIFTING').length;

  let sysConf = 0.91 - staleCount * 0.065 - driftingCount * 0.025;
  if (params.drainageBlockagePct > 55) sysConf -= 0.04;
  if (params.mode === ProductMode.MOCK) sysConf -= 0.05;

  return Number(Math.max(0.45, Math.min(0.96, sysConf)).toFixed(2));
}
