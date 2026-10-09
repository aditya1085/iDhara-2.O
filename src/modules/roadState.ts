import { BASE_ROAD_SEGMENTS } from '../data/indorePilotData';
import {
  FloodRiskCell,
  InjectedObservationState,
  RoadSegmentState,
  RoadStatus,
  ScenarioParameters,
  SensorNode,
} from '../types/idhara';
import {
  createProvenance,
  DEFAULT_INJECTED_OBSERVATIONS,
} from './dataIngestion';

const ROAD_STATE_ORDER: RoadStatus[] = [
  RoadStatus.OPEN,
  RoadStatus.AT_RISK,
  RoadStatus.LIKELY_FLOODED,
  RoadStatus.CLOSED,
];

/**
 * Evaluates the 4-state Road State Machine (OPEN -> AT_RISK -> LIKELY_FLOODED -> CLOSED)
 * across the 24 Indore pilot corridors by fusing:
 * 1. Prediction (adjacent cell flood probability & depth)
 * 2. Water level (ultrasonic sensor reading)
 * 3. Official closure / reopen directives
 * 4. Multiple agreeing observations (including crowd reports)
 * Includes hysteresis to prevent rapid state flipping.
 */
export function evaluateRoadNetworkState(
  cells: FloodRiskCell[],
  sensors: SensorNode[],
  params: ScenarioParameters,
  injected: InjectedObservationState = DEFAULT_INJECTED_OBSERVATIONS,
  previousRoadStates?: Map<string, RoadStatus>,
  stableTicksElapsed: number = 3
): RoadSegmentState[] {
  const cellMap = new Map<string, FloodRiskCell>(cells.map((c) => [c.id, c]));
  const sensorMap = new Map<string, SensorNode>(sensors.map((s) => [s.id, s]));

  return BASE_ROAD_SEGMENTS.map((seg) => {
    const adjacentCells = seg.adjacentCellIds
      .map((id) => cellMap.get(id))
      .filter((c): c is FloodRiskCell => Boolean(c));

    const maxAdjProb = adjacentCells.reduce(
      (max, c) => Math.max(max, c.floodProbability),
      0.08
    );
    const maxAdjDepth = adjacentCells.reduce(
      (max, c) => Math.max(max, c.predictedDepthCm),
      0
    );

    const linkedSensor = seg.monitoringSensorId
      ? sensorMap.get(seg.monitoringSensorId)
      : undefined;

    const crowdReport = injected.crowdReportsByRoad[seg.id];
    const officialOverride = injected.officialRoadOverrides[seg.id];

    // Boost probability if sensor water level is elevated or crowd reports exist
    let sensorBoostProb = 0;
    if (
      linkedSensor &&
      linkedSensor.freshnessState !== 'MISSING' &&
      linkedSensor.currentValue >= linkedSensor.warningThreshold
    ) {
      sensorBoostProb =
        linkedSensor.currentValue >= linkedSensor.criticalThreshold
          ? 0.24
          : 0.14;
    }

    const crowdBoostProb = crowdReport ? Math.min(0.22, crowdReport.count * 0.11) : 0;
    const structureAmplifier = seg.hasUnderpassOrBridge ? 1.12 : 0.94;
    const elevDamping = Math.max(
      0.20,
      Math.min(1.0, 1 - (seg.lowPointElevationM - 544.0) * 0.07)
    );

    let floodProbability = Number(
      Math.min(
        0.99,
        maxAdjProb * structureAmplifier * Math.sqrt(elevDamping) +
          sensorBoostProb +
          crowdBoostProb
      ).toFixed(2)
    );

    if (officialOverride === 'OPEN') {
      floodProbability = Number(Math.min(0.22, floodProbability * 0.4).toFixed(2));
    } else if (officialOverride === 'CLOSED') {
      floodProbability = Math.max(0.88, floodProbability);
    } else if (officialOverride === 'LIKELY_FLOODED') {
      floodProbability = Math.max(0.68, floodProbability);
    }

    const estimatedWaterDepthCm =
      officialOverride === 'OPEN'
        ? Math.min(8, Math.round(maxAdjDepth * 0.25))
        : officialOverride === 'LIKELY_FLOODED'
        ? Math.max(32, Math.round(maxAdjDepth * structureAmplifier * elevDamping + 18))
        : Math.round(
            maxAdjDepth * structureAmplifier * elevDamping +
              sensorBoostProb * 85 +
              crowdBoostProb * 60
          );

    // Count independent agreeing flood observations
    let agreeingObservationsCount = 0;
    if (maxAdjProb >= 0.48) agreeingObservationsCount++;
    if (
      linkedSensor &&
      linkedSensor.freshnessState !== 'MISSING' &&
      linkedSensor.currentValue >= linkedSensor.warningThreshold
    ) {
      agreeingObservationsCount++;
    }
    if (crowdReport && crowdReport.count > 0) agreeingObservationsCount++;
    if (officialOverride === 'CLOSED') agreeingObservationsCount += 2;
    if (officialOverride === 'LIKELY_FLOODED') agreeingObservationsCount += 2;

    // Raw State Machine Evaluation: OPEN | AT_RISK | LIKELY_FLOODED | CLOSED
    let rawState: RoadStatus = RoadStatus.OPEN;
    let transitionReason = 'Standard passable flow; below flood thresholds.';

    if (officialOverride === 'CLOSED') {
      rawState = RoadStatus.CLOSED;
      transitionReason =
        'Official Traffic Police / EOC Barricade Closure active.';
    } else if (officialOverride === 'LIKELY_FLOODED') {
      rawState = RoadStatus.LIKELY_FLOODED;
      transitionReason =
        'Field patrol observation verified corridor as LIKELY FLOODED (~32cm depth).';
    } else if (officialOverride === 'OPEN') {
      rawState = RoadStatus.OPEN;
      transitionReason =
        'Official field inspection cleared & reopened corridor.';
    } else if (
      floodProbability >= 0.74 ||
      estimatedWaterDepthCm >= 45 ||
      (agreeingObservationsCount >= 3 && floodProbability >= 0.62)
    ) {
      rawState = RoadStatus.CLOSED;
      transitionReason =
        agreeingObservationsCount >= 2
          ? `Multiple agreeing observations (${agreeingObservationsCount} sources) + ${Math.round(
              floodProbability * 100
            )}% probability exceed safe axle clearance.`
          : `Predicted depth (${estimatedWaterDepthCm} cm) & ${Math.round(
              floodProbability * 100
            )}% probability trigger automatic closure threshold.`;
    } else if (
      floodProbability >= 0.52 ||
      estimatedWaterDepthCm >= 25 ||
      agreeingObservationsCount >= 2
    ) {
      rawState = RoadStatus.LIKELY_FLOODED;
      transitionReason =
        agreeingObservationsCount >= 2
          ? `Transitioned to LIKELY_FLOODED via ${agreeingObservationsCount} agreeing observations (model + gauge/crowd).`
          : `High flood probability (${Math.round(
              floodProbability * 100
            )}%) and ~${estimatedWaterDepthCm} cm standing water.`;
    } else if (floodProbability >= 0.30 || estimatedWaterDepthCm >= 12) {
      rawState = RoadStatus.AT_RISK;
      transitionReason = `Elevated runoff (${Math.round(
        floodProbability * 100
      )}% probability); curb waterlogging risk.`;
    }

    // Apply Hysteresis to avoid rapid state flipping on de-escalation
    const prevState = previousRoadStates?.get(seg.id);
    const rawIdx = ROAD_STATE_ORDER.indexOf(rawState);
    const prevIdx = prevState ? ROAD_STATE_ORDER.indexOf(prevState) : rawIdx;

    let currentState = rawState;
    let isHysteresisHeld = false;

    if (
      officialOverride !== 'OPEN' &&
      rawIdx < prevIdx &&
      stableTicksElapsed < 3
    ) {
      currentState = ROAD_STATE_ORDER[prevIdx];
      isHysteresisHeld = true;
      transitionReason = `Hysteresis Hold: Maintaining ${currentState} (${stableTicksElapsed}/3 stable ticks) to prevent rapid state flipping.`;
    }

    // Effective travel time penalty & explicit riskPenaltyMin for routing graph
    let riskPenaltyMin = Number((floodProbability * 1.8).toFixed(1));
    let effectiveTravelTimeMin = Number((seg.baseTravelTimeMin + riskPenaltyMin).toFixed(1));

    if (currentState === RoadStatus.CLOSED) {
      riskPenaltyMin = Number.POSITIVE_INFINITY;
      effectiveTravelTimeMin = Number.POSITIVE_INFINITY;
    } else if (currentState === RoadStatus.LIKELY_FLOODED) {
      riskPenaltyMin = Number(
        (seg.baseTravelTimeMin * 2.2 + floodProbability * 12).toFixed(1)
      );
      effectiveTravelTimeMin = Number((seg.baseTravelTimeMin + riskPenaltyMin).toFixed(1));
    } else if (currentState === RoadStatus.AT_RISK) {
      riskPenaltyMin = Number(
        (seg.baseTravelTimeMin * 0.65 + floodProbability * 4.5).toFixed(1)
      );
      effectiveTravelTimeMin = Number((seg.baseTravelTimeMin + riskPenaltyMin).toFixed(1));
    }

    // Assemble transparent evidence chain
    const evidence: string[] = [];
    if (officialOverride === 'CLOSED') {
      evidence.push(
        'OFFICIAL CLOSURE: Traffic Authority barricade active on segment'
      );
    } else if (officialOverride === 'OPEN') {
      evidence.push(
        'OFFICIAL CLEARANCE: Field engineering unit verified passable deck & reopened road'
      );
    }

    const worstCell = [...adjacentCells].sort(
      (a, b) => b.floodProbability - a.floodProbability
    )[0];
    if (worstCell) {
      evidence.push(
        `Model Prediction: Adjacent cell ${worstCell.localityName} (${worstCell.id}) at ${Math.round(
          worstCell.floodProbability * 100
        )}% probability (~${worstCell.predictedDepthCm} cm depth)`
      );
    }

    if (linkedSensor) {
      evidence.push(
        `Sensor ${linkedSensor.id} (${linkedSensor.freshnessState}): ${linkedSensor.currentValue} ${linkedSensor.unit} · seen ${linkedSensor.lastSeenLabel}`
      );
    }

    if (crowdReport && crowdReport.count > 0) {
      evidence.push(
        `Crowd Report (${crowdReport.count} verified): "${crowdReport.lastReportText}" at ${crowdReport.timestamp}`
      );
    }

    let routeImpact =
      'OPEN: Corridor included in active routing graph for all emergency and transit vehicles.';
    let alternativeSummary = 'Primary corridor operational under current data.';

    if (currentState === RoadStatus.CLOSED) {
      routeImpact = `CLOSED: Removed from routing graph (~${estimatedWaterDepthCm} cm depth). Active routes automatically recalculated around this segment.`;
      alternativeSummary =
        'Rerouted via elevated BRTS (Regal–Palasia–Geeta Bhawan) or VIP Sadar Bazaar bypass under current data.';
    } else if (currentState === RoadStatus.LIKELY_FLOODED) {
      routeImpact = `LIKELY_FLOODED: Heavy routing penalty applied (~${estimatedWaterDepthCm} cm water). Standard vehicles & ambulances diverted; high-clearance SDRF trucks only.`;
      alternativeSummary =
        'Diverting standard & emergency medical traffic to higher-elevation connectors under current data.';
    } else if (currentState === RoadStatus.AT_RISK) {
      routeImpact = `AT_RISK: Moderate routing delay penalty (+50% travel time, ~${estimatedWaterDepthCm} cm sheet ponding).`;
      alternativeSummary = 'Passable with caution (20 km/h speed limit).';
    }

    const avgCellConf =
      adjacentCells.reduce((acc, c) => acc + c.confidence, 0) /
      Math.max(1, adjacentCells.length);

    let roadConf = avgCellConf;
    if (linkedSensor) {
      if (linkedSensor.freshnessState === 'FRESH') roadConf = Math.min(0.96, roadConf + 0.07);
      else if (linkedSensor.freshnessState === 'MISSING') roadConf = Math.max(0.42, roadConf - 0.16);
      else if (linkedSensor.freshnessState === 'SUSPECT') roadConf = Math.max(0.55, roadConf - 0.10);
    }
    if (agreeingObservationsCount >= 2) {
      roadConf = Math.min(0.96, roadConf + 0.05);
    }

    const prov = createProvenance(params.mode, roadConf, params.timelineHourOffset);
    const expiry = new Date(
      new Date(prov.generated_at).getTime() + 12 * 60 * 1000
    ).toISOString();

    return {
      ...seg,
      ...prov,
      currentState,
      rawState,
      isHysteresisHeld,
      transitionReason,
      agreeingObservationsCount,
      floodProbability,
      estimatedWaterDepthCm,
      riskPenaltyMin,
      effectiveTravelTimeMin,
      expiry,
      evidence,
      lastUpdate:
        officialOverride || crowdReport
          ? 'Just now (Live Feed)'
          : linkedSensor
          ? linkedSensor.lastSeenLabel
          : '38 seconds ago',
      routeImpact,
      alternativeSummary,
    };
  });
}
