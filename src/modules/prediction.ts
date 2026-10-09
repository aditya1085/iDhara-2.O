import { BASE_GRID_CELLS, BASE_ROAD_SEGMENTS } from '../data/indorePilotData';
import {
  CellPredictionInput,
  CellPredictionOutput,
  FloodDriver,
  FloodRiskCell,
  FloodSeverity,
  InjectedObservationState,
  ScenarioParameters,
  SensorNode,
  WarningHysteresisState,
  WarningLevel,
} from '../types/idhara';
import {
  createProvenance,
  DEFAULT_INJECTED_OBSERVATIONS,
} from './dataIngestion';
import { computeCellUncertainty } from './uncertainty';

/**
 * Pluggable Prediction Model Contract.
 * Currently backed by DeterministicWeightedModelAdapter; replaceable by
 * RandomForestModelAdapter or GradientBoostingModelAdapter without UI changes.
 */
export interface PredictionModelAdapter {
  readonly modelName: string;
  readonly modelVersion: string;
  evaluateCell(
    input: CellPredictionInput,
    uncertainty: number,
    dataConfidence: number
  ): CellPredictionOutput;
}

const WARNING_ORDER: WarningLevel[] = [
  WarningLevel.GREEN,
  WarningLevel.YELLOW,
  WarningLevel.ORANGE,
  WarningLevel.RED,
];

export const WARNING_DIRECTIVES: Record<WarningLevel, string> = {
  [WarningLevel.RED]: 'RED — EVACUATE & BARRICADE',
  [WarningLevel.ORANGE]: 'ORANGE — PREPARE & REROUTE',
  [WarningLevel.YELLOW]: 'YELLOW — WATCH & VERIFY',
  [WarningLevel.GREEN]: 'GREEN — ROUTINE MONITOR',
};

/**
 * Computes raw WarningLevel from BOTH flood_probability and severity.
 */
export function computeRawWarningLevel(
  probability: number,
  severity: FloodSeverity
): WarningLevel {
  if (
    severity === FloodSeverity.CRITICAL &&
    probability >= 0.72
  ) {
    return WarningLevel.RED;
  }
  if (
    severity === FloodSeverity.CRITICAL ||
    (severity === FloodSeverity.HIGH && probability >= 0.54)
  ) {
    return WarningLevel.ORANGE;
  }
  if (
    severity === FloodSeverity.HIGH ||
    severity === FloodSeverity.MODERATE ||
    probability >= 0.30
  ) {
    return WarningLevel.YELLOW;
  }
  return WarningLevel.GREEN;
}

/**
 * Applies hysteresis state machine:
 * - Escalation happens immediately (1 tick).
 * - De-escalation requires `requiredStableTicks` (3 consecutive stable lower-risk ticks).
 */
export function evaluateWarningWithHysteresis(
  rawLevel: WarningLevel,
  previousPeakLevel: WarningLevel | undefined,
  stableTicksElapsed: number,
  requiredStableTicks: number = 3
): WarningHysteresisState {
  const rawIdx = WARNING_ORDER.indexOf(rawLevel);
  const prevIdx = previousPeakLevel ? WARNING_ORDER.indexOf(previousPeakLevel) : rawIdx;

  // Immediate escalation or steady state
  if (rawIdx >= prevIdx) {
    return {
      rawLevel,
      effectiveLevel: rawLevel,
      actionDirective: WARNING_DIRECTIVES[rawLevel],
      isHoldingDeescalation: false,
      stableTicksCount: 0,
      requiredStableTicks,
      rationale:
        rawIdx > prevIdx
          ? `Immediate escalation to ${rawLevel} triggered by probability & severity threshold crossing.`
          : `Active at ${rawLevel} based on current probability and severity thresholds.`,
    };
  }

  // De-escalation hysteresis hold if stable ticks < requiredStableTicks
  if (stableTicksElapsed < requiredStableTicks) {
    const heldLevel = WARNING_ORDER[prevIdx];
    return {
      rawLevel,
      effectiveLevel: heldLevel,
      actionDirective: WARNING_DIRECTIVES[heldLevel],
      isHoldingDeescalation: true,
      stableTicksCount: stableTicksElapsed,
      requiredStableTicks,
      rationale: `Hysteresis Hold: Raw risk dropped to ${rawLevel}, but holding ${heldLevel} until ${requiredStableTicks} stable ticks confirm recession (${stableTicksElapsed}/${requiredStableTicks} verified).`,
    };
  }

  return {
    rawLevel,
    effectiveLevel: rawLevel,
    actionDirective: WARNING_DIRECTIVES[rawLevel],
    isHoldingDeescalation: false,
    stableTicksCount: stableTicksElapsed,
    requiredStableTicks,
    rationale: `De-escalated to ${rawLevel} after ${requiredStableTicks}/${requiredStableTicks} consecutive stable recession ticks.`,
  };
}

/**
 * Deterministic Weighted Hydrological-Terrain Model Adapter.
 */
export class DeterministicWeightedModelAdapter implements PredictionModelAdapter {
  readonly modelName = 'iDhara Deterministic Weighted Hydro-Terrain Ensemble (Prototype)';
  readonly modelVersion = 'v1.4-indore-pilot';

  evaluateCell(
    input: CellPredictionInput,
    uncertainty: number,
    dataConfidence: number
  ): CellPredictionOutput {
    const minElev = 544.0;
    const maxElev = 562.0;

    // Normalize 11 spatial features to [0, 1] vulnerability contributions
    const rain1hScore = Math.min(1.35, input.rainfall_1h / 60);
    const rain3hScore = Math.min(1.35, input.rainfall_3h / 135);
    const rain6hScore = Math.min(1.25, input.rainfall_6h / 180);
    const rain24hScore = Math.min(1.2, input.rainfall_24h / 240);

    const rainfallComposite =
      rain1hScore * 0.45 +
      rain3hScore * 0.30 +
      rain6hScore * 0.15 +
      rain24hScore * 0.10;

    const lowElevationScore = Math.max(
      0,
      Math.min(1, (maxElev - input.elevation) / (maxElev - minElev))
    );
    const flatSlopeScore = Math.max(0, Math.min(1, (2.8 - input.slope) / 2.6));
    const poorDrainageScore = Math.max(0, Math.min(1, 1 - input.drainage_proxy));

    // Weighted susceptibility index combining terrain, drainage, runoff, history, and road exposure
    const susceptibility =
      lowElevationScore * 0.23 +
      input.flow_accumulation * 0.21 +
      poorDrainageScore * 0.20 +
      input.imperviousness * 0.12 +
      input.historical_flood_score * 0.11 +
      flatSlopeScore * 0.07 +
      input.road_exposure * 0.06;

    const rawProb = Math.min(
      0.99,
      Math.max(0.02, susceptibility * (0.38 + 0.92 * rainfallComposite))
    );
    const flood_probability = Number(rawProb.toFixed(2));

    // Classify Severity
    let severity: FloodSeverity = FloodSeverity.LOW;
    if (flood_probability >= 0.74) {
      severity = FloodSeverity.CRITICAL;
    } else if (flood_probability >= 0.52) {
      severity = FloodSeverity.HIGH;
    } else if (flood_probability >= 0.30) {
      severity = FloodSeverity.MODERATE;
    }

    // Expected onset lead time in minutes (faster onset when rainfall is intense and slope/elevation collect flow)
    const baseLeadMin =
      95 -
      Math.round(
        rain1hScore * 32 +
          input.flow_accumulation * 26 +
          poorDrainageScore * 16 +
          input.imperviousness * 8
      );
    const lead_time = Math.max(8, Math.min(90, baseLeadMin));

    // Build candidate drivers from the 11 input features, then return top 4–5
    const candidateDrivers: FloodDriver[] = [
      {
        factor:
          input.rainfall_3h >= 90
            ? '+ High 3h rainfall'
            : input.rainfall_1h >= 38
            ? '+ High 1h rainfall burst'
            : 'Moderate rainfall forcing',
        weight: Math.round(rainfallComposite * 28),
        description: `1h: ${input.rainfall_1h} mm · 3h: ${input.rainfall_3h} mm · 6h: ${input.rainfall_6h} mm · 24h: ${input.rainfall_24h} mm.`,
        direction: rainfallComposite >= 0.55 ? 'aggravating' : 'mitigating',
      },
      {
        factor:
          lowElevationScore >= 0.65
            ? '+ Low elevation'
            : lowElevationScore <= 0.3
            ? '- Elevated ridge terrain'
            : '+ Mid-basin elevation',
        weight: Math.round(lowElevationScore * 25 + flatSlopeScore * 6),
        description: `${input.elevation}m MSL elevation with ${input.slope}° slope gradient.`,
        direction: lowElevationScore >= 0.5 ? 'aggravating' : 'mitigating',
      },
      {
        factor:
          input.flow_accumulation >= 0.6
            ? '+ High runoff accumulation'
            : '- Low upstream flow accumulation',
        weight: Math.round(input.flow_accumulation * 24),
        description: `Catchment flow accumulation index ${(
          input.flow_accumulation * 100
        ).toFixed(0)}% from Kahn/Saraswati & tributary drains.`,
        direction: input.flow_accumulation >= 0.5 ? 'aggravating' : 'mitigating',
      },
      {
        factor:
          poorDrainageScore >= 0.52
            ? '+ Constrained drainage proxy'
            : '- Adequate storm drain capacity',
        weight: Math.round(poorDrainageScore * 23),
        description: `Effective drainage capacity score ${input.drainage_proxy.toFixed(
          2
        )} after culvert silt/blockage adjustment.`,
        direction: poorDrainageScore >= 0.48 ? 'aggravating' : 'mitigating',
      },
      {
        factor:
          input.imperviousness >= 0.8
            ? '+ High imperviousness'
            : '- Pervious surface infiltration',
        weight: Math.round(input.imperviousness * 16),
        description: `${Math.round(
          input.imperviousness * 100
        )}% built/paved impervious surface cover.`,
        direction: input.imperviousness >= 0.78 ? 'aggravating' : 'mitigating',
      },
      {
        factor:
          input.historical_flood_score >= 0.6
            ? '+ High historical flood score'
            : 'Low historical inundation frequency',
        weight: Math.round(input.historical_flood_score * 15),
        description: `Historical flood recurrence score ${(
          input.historical_flood_score * 100
        ).toFixed(0)}% over 10-year municipal log.`,
        direction: input.historical_flood_score >= 0.5 ? 'aggravating' : 'mitigating',
      },
      {
        factor:
          input.road_exposure >= 0.6
            ? '+ High road & bridge exposure'
            : 'Standard street exposure',
        weight: Math.round(input.road_exposure * 12),
        description: `Road/underpass exposure index ${(
          input.road_exposure * 100
        ).toFixed(0)}%.`,
        direction: input.road_exposure >= 0.55 ? 'aggravating' : 'mitigating',
      },
    ];

    const top_drivers = candidateDrivers
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4);

    return {
      flood_probability,
      severity,
      uncertainty,
      data_confidence: dataConfidence,
      top_drivers,
      lead_time,
    };
  }
}

export const defaultPredictionEngine: PredictionModelAdapter =
  new DeterministicWeightedModelAdapter();

/**
 * Predicts flood risk across all 64 Indore pilot cells using the modular PredictionModelAdapter.
 */
export function predictFloodRiskGrid(
  params: ScenarioParameters,
  sensors: SensorNode[],
  previousCellWarnings?: Map<string, WarningLevel>,
  stableTicksElapsed: number = 0,
  injected: InjectedObservationState = DEFAULT_INJECTED_OBSERVATIONS,
  engine: PredictionModelAdapter = defaultPredictionEngine
): FloodRiskCell[] {
  const effectiveRainIntensity =
    params.rainfallIntensityMmHr + injected.extraRainfallMmHr;

  return BASE_GRID_CELLS.map((cell) => {
    // Spatial micro-variation in rainfall across 5x5 km catchment
    const spatialRainVar = 0.94 + (((cell.row * 3 + cell.col * 5) % 7) * 0.02);
    const rainfall_1h = Number(
      (effectiveRainIntensity * spatialRainVar).toFixed(1)
    );
    const rainfall_3h = Number(
      (rainfall_1h * Math.min(3, Math.max(1.4, params.durationHours * 0.82))).toFixed(1)
    );
    const rainfall_6h = Number((rainfall_3h * 1.28).toFixed(1));
    const rainfall_24h = Number((rainfall_6h * 1.35).toFixed(1));

    // Check if a nearby ultrasonic sensor has an injected water-level surge
    const directSensor = sensors.find((s) => s.cellId === cell.id);
    const sensorSurgeM = directSensor
      ? injected.sensorWaterLevelBoostM[directSensor.id] ?? 0
      : 0;

    // Compute flow_accumulation from proximity to Kahn/Saraswati rivers, upstream multiplier, and depression
    const riverProxNorm =
      cell.distanceToRiverM < 100
        ? 0.92
        : cell.distanceToRiverM < 320
        ? 0.68
        : cell.distanceToRiverM < 700
        ? 0.38
        : 0.16;
    const elevNorm = Math.max(0, Math.min(1, (562 - cell.elevationM) / 18));
    const flow_accumulation = Number(
      Math.min(
        1,
        (riverProxNorm * 0.6 + elevNorm * 0.4) *
          Math.min(1.25, params.upstreamKahnInflowMultiplier * 0.9) +
          sensorSurgeM * 0.28
      ).toFixed(2)
    );

    // Effective drainage proxy adjusted for active culvert blockage %
    const drainage_proxy = Number(
      Math.max(
        0.05,
        cell.drainageProxyScore * (1 - (params.drainageBlockagePct / 100) * 0.65)
      ).toFixed(2)
    );

    const historical_flood_score = Number(
      Math.min(1, cell.historicalFloodCount10Yr / 10).toFixed(2)
    );

    const adjacentRoads = BASE_ROAD_SEGMENTS.filter((r) =>
      r.adjacentCellIds.includes(cell.id)
    );
    const hasBridgeOrUnderpass = adjacentRoads.some((r) => r.hasUnderpassOrBridge);
    const road_exposure = Number(
      Math.min(
        1,
        0.25 +
          adjacentRoads.length * 0.18 +
          (hasBridgeOrUnderpass ? 0.28 : 0)
      ).toFixed(2)
    );

    const predictionInput: CellPredictionInput = {
      rainfall_1h,
      rainfall_3h,
      rainfall_6h,
      rainfall_24h,
      elevation: cell.elevationM,
      slope: cell.slopeDeg,
      flow_accumulation,
      drainage_proxy,
      imperviousness: cell.imperviousness,
      historical_flood_score,
      road_exposure,
    };

    const uncertaintyResult = computeCellUncertainty(cell, sensors, params);

    const output = engine.evaluateCell(
      predictionInput,
      uncertaintyResult.uncertaintyBand,
      uncertaintyResult.confidence
    );

    // Predicted inundation depth in cm
    const rainForcing = Math.min(1.45, rainfall_1h / 60);
    const rawDepthCm =
      output.flood_probability < 0.22
        ? output.flood_probability * 18
        : Math.pow(output.flood_probability, 1.65) * 115 * (0.7 + 0.35 * rainForcing);
    const predictedDepthCm = Math.round(rawDepthCm);

    // Warning Level + Hysteresis evaluation
    const rawWarn = computeRawWarningLevel(
      output.flood_probability,
      output.severity
    );
    const prevWarn = previousCellWarnings?.get(cell.id);
    const warningHysteresis = evaluateWarningWithHysteresis(
      rawWarn,
      prevWarn,
      stableTicksElapsed,
      3
    );

    const prov = createProvenance(
      params.mode,
      output.data_confidence,
      params.timelineHourOffset
    );

    const biasDirection = (cell.row + cell.col) % 2 === 0 ? 1 : -1;
    const residualCm = Math.round(
      biasDirection * (2 + ((cell.row * 5 + cell.col * 3) % 7))
    );
    const observedDepthCm = Math.max(0, predictedDepthCm + residualCm);

    return {
      ...cell,
      ...prov,
      rainfallMmHr: rainfall_1h,
      cumulativeRainfallMm: rainfall_3h,
      predictionInput,
      floodProbability: output.flood_probability,
      predictedDepthCm,
      observedDepthCm,
      severity: output.severity,
      warningLevel: warningHysteresis.effectiveLevel,
      warningHysteresis,
      leadTimeMin: output.lead_time,
      expectedOnsetLabel: `~${output.lead_time} min`,
      uncertaintyBand: output.uncertainty,
      topDrivers: output.top_drivers,
      dataFreshnessSec: uncertaintyResult.freshnessSec,
      freshnessLabel: uncertaintyResult.freshnessLabel,
      verifiedBySensorId: uncertaintyResult.verifiedBySensorId,
    };
  });
}
