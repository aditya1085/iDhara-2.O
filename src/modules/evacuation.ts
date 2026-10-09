import {
  BASE_ROAD_SEGMENTS,
  BASE_SHELTERS,
  CRITICAL_ASSETS,
  INTERSECTION_NODES,
} from '../data/indorePilotData';
import {
  EvacuationFailureReason,
  EvacuationNearestShelterOption,
  EvacuationPlanItem,
  EvacuationZoneCriticalFacility,
  FloodRiskCell,
  FloodSeverity,
  RoadSegmentState,
  RoadStatus,
  ScenarioParameters,
  Shelter,
} from '../types/idhara';
import { createProvenance } from './dataIngestion';

export interface EvacuationConfig {
  thresholdProbability: number; // default 0.50 (50% flood probability)
  manualModeActive: boolean;
  shelterCapacityScalePct: number; // default 100%; can be lowered to test capacity saturation
  recalcVersion: number;
}

export const DEFAULT_EVACUATION_CONFIG: EvacuationConfig = {
  thresholdProbability: 0.50,
  manualModeActive: false,
  shelterCapacityScalePct: 100,
  recalcVersion: 0,
};

const SHELTER_NODE_MAP: Record<string, { nodeId: string; locationLabel: string }> = {
  'SH-01': {
    nodeId: 'NODE-CHIMANBAGH',
    locationLabel: 'Ward W-12 · Chimanbagh High Ground (551.4m MSL)',
  },
  'SH-02': {
    nodeId: 'NODE-PALASIA',
    locationLabel: 'Ward W-28 · Race Course Ridge / Palasia (558.4m MSL)',
  },
  'SH-03': {
    nodeId: 'NODE-COLLECTORATE',
    locationLabel: 'Ward W-45 · Lalbagh / Collectorate Enclave (552.0m MSL)',
  },
  'SH-04': {
    nodeId: 'NODE-NAVALAKHA',
    locationLabel: 'Ward W-64 · Holkar Science College South Ridge (557.2m MSL)',
  },
};

interface EvacRouteResult {
  nodeIds: string[];
  roadIds: string[];
  roadNames: string[];
  distanceKm: number;
  travelTimeMin: number;
  routingCost: number;
  riskScore: number;
  confidence: number;
}

/**
 * Finds the nearest intersection node in the Indore road graph for any grid cell.
 */
function findNearestNodeForCell(cell: FloodRiskCell): { id: string; name: string } {
  let best = INTERSECTION_NODES[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const node of INTERSECTION_NODES) {
    const d = Math.hypot(node.lat - cell.lat, node.lng - cell.lng);
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  return { id: best.id, name: best.name };
}

/**
 * Flood-aware Dijkstra solver specifically for Evacuation Dispatch:
 * - Strictly removes CLOSED roads.
 * - Heavily penalizes uncertain (low confidence) and high-risk (LIKELY_FLOODED / AT_RISK) roads.
 */
export function computeEvacuationRouteToShelter(
  originNodeId: string,
  shelterNodeId: string,
  roads: RoadSegmentState[]
): EvacRouteResult | null {
  if (originNodeId === shelterNodeId) {
    const incidentOpen = roads.find(
      (r) =>
        (r.fromNodeId === originNodeId || r.toNodeId === originNodeId) &&
        r.currentState !== RoadStatus.CLOSED
    );
    if (!incidentOpen) return null;
    return {
      nodeIds: [originNodeId],
      roadIds: [incidentOpen.id],
      roadNames: [incidentOpen.name],
      distanceKm: 0.45,
      travelTimeMin: 3.5,
      routingCost: 4.0,
      riskScore: Math.round(incidentOpen.floodProbability * 100),
      confidence: incidentOpen.confidence,
    };
  }

  interface Edge {
    road: RoadSegmentState;
    to: string;
    cost: number;
    etaMin: number;
  }

  const adj = new Map<string, Edge[]>();
  INTERSECTION_NODES.forEach((n) => adj.set(n.id, []));

  roads.forEach((r) => {
    // Rule 1: Remove CLOSED roads from evacuation routing
    if (r.currentState === RoadStatus.CLOSED) return;

    // Rule 2: Penalize uncertain & high-risk roads
    const uncertaintyPenalty = (1 - r.confidence) * 14;
    let riskPenalty = r.floodProbability * 5.0 + uncertaintyPenalty;
    let eta = r.baseTravelTimeMin;

    if (r.currentState === RoadStatus.LIKELY_FLOODED) {
      // If water depth is severe (>= 38 cm), do not route civilian evacuation buses through it
      if (r.estimatedWaterDepthCm >= 38) return;
      riskPenalty += r.baseTravelTimeMin * 2.5 + 18;
      eta = r.baseTravelTimeMin * 1.95;
    } else if (r.currentState === RoadStatus.AT_RISK) {
      riskPenalty += r.baseTravelTimeMin * 0.9 + 6;
      eta = r.baseTravelTimeMin * 1.35;
    }

    const totalCost = eta + riskPenalty;

    adj.get(r.fromNodeId)?.push({
      road: r,
      to: r.toNodeId,
      cost: totalCost,
      etaMin: eta,
    });
    adj.get(r.toNodeId)?.push({
      road: r,
      to: r.fromNodeId,
      cost: totalCost,
      etaMin: eta,
    });

    // Handle corridor RD-22 (AB Road BRTS South: MY Hospital ↔ Geeta Bhawan ↔ Navalakha)
    if (r.id === 'RD-22') {
      const halfEdge = {
        road: r,
        cost: totalCost / 2,
        etaMin: Number((eta / 2).toFixed(1)),
      };
      adj.get('NODE-MY-HOSPITAL')?.push({ ...halfEdge, to: 'NODE-GEETA-BHAWAN' });
      adj.get('NODE-GEETA-BHAWAN')?.push({ ...halfEdge, to: 'NODE-MY-HOSPITAL' });
      adj.get('NODE-GEETA-BHAWAN')?.push({ ...halfEdge, to: 'NODE-NAVALAKHA' });
      adj.get('NODE-NAVALAKHA')?.push({ ...halfEdge, to: 'NODE-GEETA-BHAWAN' });
    }

    // Handle corridor RD-18 (AB Road BRTS North: Palasia ↔ Geeta Bhawan ↔ MY Hospital)
    if (r.id === 'RD-18') {
      const halfEdge = {
        road: r,
        cost: totalCost / 2,
        etaMin: Number((eta / 2).toFixed(1)),
      };
      adj.get('NODE-PALASIA')?.push({ ...halfEdge, to: 'NODE-GEETA-BHAWAN' });
      adj.get('NODE-GEETA-BHAWAN')?.push({ ...halfEdge, to: 'NODE-PALASIA' });
      adj.get('NODE-GEETA-BHAWAN')?.push({ ...halfEdge, to: 'NODE-MY-HOSPITAL' });
      adj.get('NODE-MY-HOSPITAL')?.push({ ...halfEdge, to: 'NODE-GEETA-BHAWAN' });
    }
  });

  const dist = new Map<string, number>();
  const prevNode = new Map<string, string>();
  const prevEdge = new Map<string, Edge>();
  const visited = new Set<string>();

  INTERSECTION_NODES.forEach((n) => dist.set(n.id, Number.POSITIVE_INFINITY));
  dist.set(originNodeId, 0);

  while (visited.size < INTERSECTION_NODES.length) {
    let u: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const [nId, d] of dist.entries()) {
      if (!visited.has(nId) && d < best) {
        best = d;
        u = nId;
      }
    }
    if (!u || best === Number.POSITIVE_INFINITY || u === shelterNodeId) break;
    visited.add(u);

    for (const edge of adj.get(u) ?? []) {
      if (visited.has(edge.to)) continue;
      const alt = (dist.get(u) ?? Number.POSITIVE_INFINITY) + edge.cost;
      if (alt < (dist.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        dist.set(edge.to, alt);
        prevNode.set(edge.to, u);
        prevEdge.set(edge.to, edge);
      }
    }
  }

  const finalCost = dist.get(shelterNodeId) ?? Number.POSITIVE_INFINITY;
  if (finalCost === Number.POSITIVE_INFINITY) {
    return null;
  }

  const nodeIds: string[] = [];
  const roadIds: string[] = [];
  const roadNames: string[] = [];
  let distanceKm = 0;
  let travelTimeMin = 0;
  let maxProb = 0;
  let confSum = 0;

  let curr: string | undefined = shelterNodeId;
  while (curr) {
    nodeIds.unshift(curr);
    const edge = prevEdge.get(curr);
    if (edge) {
      roadIds.unshift(edge.road.id);
      roadNames.unshift(edge.road.name);
      distanceKm += edge.road.lengthKm;
      travelTimeMin += edge.etaMin;
      maxProb = Math.max(maxProb, edge.road.floodProbability);
      confSum += edge.road.confidence;
    }
    curr = prevNode.get(curr);
  }

  if (roadIds.length === 0) return null;

  return {
    nodeIds,
    roadIds,
    roadNames,
    distanceKm: Number(distanceKm.toFixed(2)),
    travelTimeMin: Math.round(travelTimeMin),
    routingCost: Number(finalCost.toFixed(1)),
    riskScore: Math.min(100, Math.round(maxProb * 100)),
    confidence: Number((confSum / roadIds.length).toFixed(2)),
  };
}

/**
 * Evaluates high-ground municipal shelters and computes capacity-aware, priority-ranked
 * flood-aware evacuation plans for all affected zones above the configured evacuation threshold.
 *
 * Never invents a solution when a zone cannot be assigned: explicitly emits
 * NO FEASIBLE EVACUATION PLAN with exact reason:
 * - No reachable shelter
 * - Shelter capacity exceeded
 * - Road network disconnected
 */
export function evaluateSheltersAndEvacuation(
  cells: FloodRiskCell[],
  params: ScenarioParameters,
  roads?: RoadSegmentState[],
  config: EvacuationConfig = DEFAULT_EVACUATION_CONFIG
): {
  shelters: Shelter[];
  evacuationPlans: EvacuationPlanItem[];
  evacuationModeActive: boolean;
  evacuationTriggerReason: string;
} {
  const cellMap = new Map(cells.map((c) => [c.id, c]));

  // Fallback synthetic road states if caller did not pass evaluated RoadSegmentState[]
  const activeRoads: RoadSegmentState[] =
    roads && roads.length > 0
      ? roads
      : BASE_ROAD_SEGMENTS.map((seg) => {
          const adjCells = seg.adjacentCellIds
            .map((id) => cellMap.get(id))
            .filter((c): c is FloodRiskCell => Boolean(c));
          const maxProb = adjCells.reduce((m, c) => Math.max(m, c.floodProbability), 0.1);
          const currentState =
            maxProb >= 0.74
              ? RoadStatus.CLOSED
              : maxProb >= 0.52
              ? RoadStatus.LIKELY_FLOODED
              : maxProb >= 0.30
              ? RoadStatus.AT_RISK
              : RoadStatus.OPEN;
          const prov = createProvenance(params.mode, 0.85, params.timelineHourOffset);
          return {
            ...seg,
            ...prov,
            currentState,
            rawState: currentState,
            isHysteresisHeld: false,
            transitionReason: 'Derived from cell risk',
            agreeingObservationsCount: 1,
            floodProbability: maxProb,
            estimatedWaterDepthCm: Math.round(maxProb * 65),
            riskPenaltyMin: Number((maxProb * 4).toFixed(1)),
            effectiveTravelTimeMin:
              currentState === RoadStatus.CLOSED
                ? Number.POSITIVE_INFINITY
                : seg.baseTravelTimeMin,
            expiry: new Date(new Date(prov.generated_at).getTime() + 15 * 60000).toISOString(),
            evidence: [],
            lastUpdate: '38 seconds ago',
            routeImpact: '',
            alternativeSummary: '',
          };
        });

  const roadMap = new Map(activeRoads.map((r) => [r.id, r]));

  // 1. Initialize Shelters (with capacity scaling, flood risk, and road reachability)
  const shelters: Shelter[] = BASE_SHELTERS.map((sh) => {
    const hostCell = cellMap.get(sh.cellId);
    const meta = SHELTER_NODE_MAP[sh.id] ?? {
      nodeId: 'NODE-CHIMANBAGH',
      locationLabel: `${sh.ward} · ${sh.elevationM}m MSL`,
    };
    const accessRoad = roadMap.get(sh.accessRoadId);
    const nodeIncidentOpen = activeRoads.some(
      (r) =>
        (r.fromNodeId === meta.nodeId || r.toNodeId === meta.nodeId) &&
        r.currentState !== RoadStatus.CLOSED
    );

    const floodRiskProbability = hostCell?.floodProbability ?? 0.08;
    const floodRiskSeverity = hostCell?.severity ?? FloodSeverity.LOW;

    const accessRoadClosed =
      !accessRoad ||
      accessRoad.currentState === RoadStatus.CLOSED ||
      !nodeIncidentOpen;
    const shelterFlooded =
      floodRiskSeverity === FloodSeverity.CRITICAL || floodRiskProbability >= 0.70;

    let accessibilityStatus: Shelter['accessibilityStatus'] = 'REACHABLE';
    let accessibilityLabel = `REACHABLE via ${sh.accessRoadId} (${
      accessRoad?.currentState ?? 'OPEN'
    })`;

    if (accessRoadClosed) {
      accessibilityStatus = 'UNREACHABLE_ROAD_CLOSED';
      accessibilityLabel = `UNREACHABLE — Access road ${sh.accessRoadId} CLOSED`;
    } else if (shelterFlooded) {
      accessibilityStatus = 'UNREACHABLE_FLOOD_RISK';
      accessibilityLabel = `UNREACHABLE — Shelter zone flood risk (${Math.round(
        floodRiskProbability * 100
      )}%)`;
    }

    const reachable = accessibilityStatus === 'REACHABLE';
    const scale = Math.max(0.25, Math.min(1.5, config.shelterCapacityScalePct / 100));
    const scaledTotalCapacity = Math.max(
      sh.baseOccupancy + 40,
      Math.round(sh.totalCapacity * scale)
    );
    const initialRemaining = Math.max(0, scaledTotalCapacity - sh.baseOccupancy);

    const sourceCells = sh.assignedSourceCellIds
      .map((id) => cellMap.get(id))
      .filter((c): c is FloodRiskCell => Boolean(c));
    const avgConf =
      sourceCells.reduce((acc, c) => acc + c.confidence, 0) /
      Math.max(1, sourceCells.length);

    const prov = createProvenance(params.mode, avgConf, params.timelineHourOffset);

    return {
      ...prov,
      id: sh.id,
      name: sh.name,
      ward: sh.ward,
      x: sh.x,
      y: sh.y,
      lat: sh.lat,
      lng: sh.lng,
      cellId: sh.cellId,
      nearestNodeId: meta.nodeId,
      locationLabel: meta.locationLabel,
      elevationM: sh.elevationM,
      totalCapacity: scaledTotalCapacity,
      baseOccupancy: sh.baseOccupancy,
      assignedEvacuees: 0,
      currentOccupancy: sh.baseOccupancy,
      remainingCapacity: initialRemaining,
      floodRiskProbability,
      floodRiskSeverity,
      reachable,
      accessibilityStatus,
      accessibilityLabel,
      status: reachable ? 'READY_OPEN' : 'UNREACHABLE',
      medicalTeamPresent: sh.medicalTeamPresent,
      drinkingWaterLiters: sh.drinkingWaterLiters,
      assignedSourceCellIds: sh.assignedSourceCellIds,
      accessRoadId: sh.accessRoadId,
    };
  });

  // 2. Identify Affected Zones above the configured evacuation threshold
  const threshold = config.thresholdProbability;
  let affectedCells = cells.filter(
    (c) =>
      c.floodProbability >= threshold ||
      c.severity === FloodSeverity.CRITICAL
  );

  // If operator manually starts evacuation mode when fewer zones exceed threshold, include top vulnerable cells
  if (config.manualModeActive && affectedCells.length < 4) {
    affectedCells = [...cells]
      .sort((a, b) => b.floodProbability - a.floodProbability)
      .slice(0, 6);
  }

  const evacuationModeActive =
    config.manualModeActive || affectedCells.length > 0;
  const evacuationTriggerReason =
    config.manualModeActive && affectedCells.some((c) => c.floodProbability >= threshold)
      ? `ACTIVE — Operator manual mode + ${
          affectedCells.filter((c) => c.floodProbability >= threshold).length
        } zones ≥ ${Math.round(threshold * 100)}% evacuation threshold`
      : config.manualModeActive
      ? 'ACTIVE — Operator manually started Evacuation Mode'
      : affectedCells.length > 0
      ? `ACTIVE — ${affectedCells.length} zones reached ≥ ${Math.round(
          threshold * 100
        )}% flood risk evacuation threshold`
      : `STANDBY — No zones currently above ${Math.round(threshold * 100)}% threshold`;

  // 3. Enrich each affected zone with Critical Facilities, Exposed Population Proxy, and Priority Score
  const enrichedZones = affectedCells.map((cell) => {
    // Match critical assets located in this cell or referenced by nearestCriticalAssetIds
    const matchedAssets = CRITICAL_ASSETS.filter(
      (a) =>
        a.cellId === cell.id ||
        (cell.nearestCriticalAssetIds.includes(a.id) &&
          Math.hypot(a.lat - cell.lat, a.lng - cell.lng) <= 0.0085)
    );

    const criticalFacilities: EvacuationZoneCriticalFacility[] = matchedAssets.map(
      (a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
        priorityLabel:
          a.category === 'HOSPITAL'
            ? 'Hospital'
            : a.category === 'SCHOOL_CIVIC'
            ? 'School / Care Facility'
            : 'Critical Infrastructure',
      })
    );

    const hasHospital = criticalFacilities.some((f) => f.category === 'HOSPITAL');
    const hasSchoolOrCare = criticalFacilities.some(
      (f) => f.category === 'SCHOOL_CIVIC'
    );

    let priorityTier: EvacuationPlanItem['priorityTier'] =
      'PRIORITY_3_VULNERABLE_ZONE';
    let priorityReason = `High-risk ${cell.landUse.toLowerCase()} zone (${Math.round(
      cell.floodProbability * 100
    )}% prob, ~${cell.predictedDepthCm}cm depth)`;
    let facilityBonus = 0;

    if (hasHospital) {
      priorityTier = 'PRIORITY_1_HOSPITAL';
      const hospNames = criticalFacilities
        .filter((f) => f.category === 'HOSPITAL')
        .map((f) => f.name)
        .join(', ');
      priorityReason = `Priority 1 Hospital / Patient Care Protection: ${hospNames}`;
      facilityBonus = 38;
    } else if (hasSchoolOrCare) {
      priorityTier = 'PRIORITY_2_SCHOOL_CARE';
      const schNames = criticalFacilities
        .filter((f) => f.category === 'SCHOOL_CIVIC')
        .map((f) => f.name)
        .join(', ');
      priorityReason = `Priority 2 School / Care & Civic Facility: ${schNames}`;
      facilityBonus = 22;
    } else if (
      cell.landUse === 'Riverfront Low-Lying' ||
      cell.landUse === 'Dense Historic Core'
    ) {
      facilityBonus = 10;
    }

    const rawScore = Math.round(
      cell.floodProbability * 55 +
        Math.min(30, (cell.predictedDepthCm / 90) * 30) +
        facilityBonus
    );
    const priorityScore = Math.min(99, rawScore);

    // Exposed population proxy requiring shelter evacuation
    const exposureRatio =
      cell.severity === FloodSeverity.CRITICAL
        ? 0.042
        : cell.severity === FloodSeverity.HIGH
        ? 0.026
        : 0.016;
    const populationAtRisk = Math.max(
      95,
      Math.round((cell.populationEstimate * exposureRatio) / 10) * 10
    );

    const originNode = findNearestNodeForCell(cell);
    const incidentRoads = activeRoads.filter(
      (r) =>
        r.adjacentCellIds.includes(cell.id) ||
        r.fromNodeId === originNode.id ||
        r.toNodeId === originNode.id
    );
    const openOrPassableCount = incidentRoads.filter(
      (r) => r.currentState !== RoadStatus.CLOSED
    ).length;
    const closedCount = incidentRoads.filter(
      (r) => r.currentState === RoadStatus.CLOSED
    ).length;
    const likelyFloodedCount = incidentRoads.filter(
      (r) => r.currentState === RoadStatus.LIKELY_FLOODED
    ).length;

    // Also check if the originNode itself has any non-CLOSED road connected in the graph
    const graphNodeHasOpenEdge = activeRoads.some(
      (r) =>
        (r.fromNodeId === originNode.id ||
          r.toNodeId === originNode.id ||
          (originNode.id === 'NODE-GEETA-BHAWAN' && (r.id === 'RD-22' || r.id === 'RD-18'))) &&
        r.currentState !== RoadStatus.CLOSED
    );

    let roadAccessibilityStatus: EvacuationPlanItem['roadAccessibilityStatus'] =
      'ACCESSIBLE';
    let roadAccessibilityLabel = `Accessible (${openOrPassableCount} open/passable corridors at ${originNode.name})`;

    if (!graphNodeHasOpenEdge) {
      roadAccessibilityStatus = 'DISCONNECTED';
      roadAccessibilityLabel = `Disconnected — All corridors at ${originNode.name} are CLOSED`;
    } else if (closedCount > 0 || likelyFloodedCount > 0) {
      roadAccessibilityStatus = 'RESTRICTED_HIGH_RISK';
      roadAccessibilityLabel = `Restricted — ${closedCount} CLOSED, ${likelyFloodedCount} LIKELY_FLOODED near ${originNode.name}`;
    }

    return {
      cell,
      criticalFacilities,
      priorityTier,
      priorityReason,
      priorityScore,
      populationAtRisk,
      originNode,
      roadAccessibilityStatus,
      roadAccessibilityLabel,
    };
  });

  // Sort affected zones by Priority Tier first, then Priority Score, then Flood Probability
  const tierRank: Record<EvacuationPlanItem['priorityTier'], number> = {
    PRIORITY_1_HOSPITAL: 1,
    PRIORITY_2_SCHOOL_CARE: 2,
    PRIORITY_3_VULNERABLE_ZONE: 3,
  };

  enrichedZones.sort((a, b) => {
    if (tierRank[a.priorityTier] !== tierRank[b.priorityTier]) {
      return tierRank[a.priorityTier] - tierRank[b.priorityTier];
    }
    if (b.priorityScore !== a.priorityScore) {
      return b.priorityScore - a.priorityScore;
    }
    return b.cell.floodProbability - a.cell.floodProbability;
  });

  // 4. Capacity-Aware Assignment & Flood-Aware Evacuation Routing
  const evacuationPlans: EvacuationPlanItem[] = enrichedZones.map((zone) => {
    const {
      cell,
      criticalFacilities,
      priorityTier,
      priorityReason,
      priorityScore,
      populationAtRisk,
      originNode,
      roadAccessibilityStatus,
      roadAccessibilityLabel,
    } = zone;

    // Evaluate route from zone's originNode to every shelter
    const shelterCandidates = shelters.map((sh) => {
      const dxKm = ((sh.x - (cell.col + 0.5) * 125) / 1000) * 5.0;
      const dyKm = ((sh.y - (cell.row + 0.5) * 125) / 1000) * 5.0;
      const crowFliesKm = Number(Math.max(0.4, Math.hypot(dxKm, dyKm)).toFixed(2));

      const route = sh.reachable
        ? computeEvacuationRouteToShelter(
            originNode.id,
            sh.nearestNodeId,
            activeRoads
          )
        : null;

      return {
        shelter: sh,
        crowFliesKm,
        route,
      };
    });

    // Sort candidates by whether route exists & lowest routing cost
    shelterCandidates.sort((a, b) => {
      const aReachable = Boolean(a.shelter.reachable && a.route);
      const bReachable = Boolean(b.shelter.reachable && b.route);
      if (aReachable !== bReachable) return aReachable ? -1 : 1;
      if (a.route && b.route) return a.route.routingCost - b.route.routingCost;
      return a.crowFliesKm - b.crowFliesKm;
    });

    const nearestShelters: EvacuationNearestShelterOption[] =
      shelterCandidates.map((cand) => ({
        shelterId: cand.shelter.id,
        shelterName: cand.shelter.name,
        distanceKm: cand.route ? cand.route.distanceKm : cand.crowFliesKm,
        travelTimeMin: cand.route ? cand.route.travelTimeMin : null,
        reachable: Boolean(cand.shelter.reachable && cand.route),
        remainingCapacityBefore: cand.shelter.remainingCapacity,
      }));

    // Filter only reachable shelters that have a valid non-CLOSED route
    const reachableWithRoute = shelterCandidates.filter(
      (c) => c.shelter.reachable && c.route !== null
    );

    // Pick the best reachable shelter that ALSO has sufficient remainingCapacity >= populationAtRisk
    const feasibleMatch = reachableWithRoute.find(
      (c) => c.shelter.remainingCapacity >= populationAtRisk
    );

    const busesAssigned = Math.max(2, Math.ceil(populationAtRisk / 50));

    if (feasibleMatch && feasibleMatch.route) {
      const chosenShelter = feasibleMatch.shelter;
      const chosenRoute = feasibleMatch.route;

      // Deduct capacity from chosenShelter (Capacity-Aware Assignment!)
      chosenShelter.assignedEvacuees += populationAtRisk;
      chosenShelter.currentOccupancy += populationAtRisk;
      chosenShelter.remainingCapacity = Math.max(
        0,
        chosenShelter.totalCapacity - chosenShelter.currentOccupancy
      );

      const loadRatio =
        chosenShelter.currentOccupancy / chosenShelter.totalCapacity;
      if (chosenShelter.remainingCapacity === 0 || loadRatio >= 0.98) {
        chosenShelter.status = 'FULL';
      } else if (loadRatio >= 0.82) {
        chosenShelter.status = 'NEAR_CAPACITY';
      } else if (loadRatio >= 0.40) {
        chosenShelter.status = 'FILLING';
      } else {
        chosenShelter.status = 'READY_OPEN';
      }

      const planConfidence = Number(
        ((cell.confidence + chosenRoute.confidence) / 2).toFixed(2)
      );
      const prov = createProvenance(
        params.mode,
        planConfidence,
        params.timelineHourOffset
      );
      const expiryDate = new Date(
        new Date(prov.generated_at).getTime() + 15 * 60 * 1000
      );

      let status: EvacuationPlanItem['status'] = 'ADVISORY_ISSUED';
      if (
        cell.severity === FloodSeverity.CRITICAL ||
        priorityTier === 'PRIORITY_1_HOSPITAL'
      ) {
        status = 'EVACUATING';
      } else if (
        cell.severity === FloodSeverity.HIGH ||
        cell.floodProbability >= 0.60
      ) {
        status = 'STAGED';
      }

      const estimatedClearanceMin = Math.round(
        chosenRoute.travelTimeMin + Math.min(25, populationAtRisk * 0.035)
      );

      return {
        ...prov,
        id: `EVAC-${cell.id}`,
        sourceCellId: cell.id,
        sourceLocality: `${cell.localityName} (${cell.wardCode})`,
        wardCode: cell.wardCode,
        floodProbability: cell.floodProbability,
        predictedDepthCm: cell.predictedDepthCm,
        populationAtRisk,
        priorityScore,
        priorityTier,
        priorityReason,
        criticalFacilities,
        nearestShelters,
        roadAccessibilityStatus,
        roadAccessibilityLabel,
        originNodeId: originNode.id,
        originNodeName: originNode.name,
        severity: cell.severity,
        assigned: true,
        assignmentSummary: `${cell.localityName} (${cell.id}) → ${chosenShelter.name}`,
        targetShelterId: chosenShelter.id,
        targetShelterName: chosenShelter.name,
        recommendedRouteId: chosenRoute.roadIds.join(' → '),
        routeRoadIds: chosenRoute.roadIds,
        routeRoadNames: chosenRoute.roadNames,
        routeNodeIds: chosenRoute.nodeIds,
        routeLabel: 'Recommended evacuation route under current data',
        routeRiskScore: chosenRoute.riskScore,
        distanceKm: chosenRoute.distanceKm,
        estimatedClearanceMin,
        busesAssigned,
        status,
        expiry: expiryDate.toISOString(),
      };
    }

    // =========================================================================
    // IMPORTANT FAILURE STATE: Zone cannot be assigned — DO NOT INVENT A SOLUTION
    // Determine exact reason:
    // - Road network disconnected
    // - No reachable shelter
    // - Shelter capacity exceeded
    // =========================================================================
    let failureReason: EvacuationFailureReason = 'Shelter capacity exceeded';
    let failureDetail = '';

    const anyShelterReachableAtAll = shelters.some((s) => s.reachable);

    if (roadAccessibilityStatus === 'DISCONNECTED') {
      failureReason = 'Road network disconnected';
      failureDetail = `All outgoing road corridors from ${originNode.name} serving ${cell.localityName} (${cell.id}) are CLOSED due to flood inundation. Evacuation buses cannot enter or exit via the surface road network.`;
    } else if (!anyShelterReachableAtAll || reachableWithRoute.length === 0) {
      failureReason = 'No reachable shelter';
      failureDetail = !anyShelterReachableAtAll
        ? `All 4 municipal shelters are currently UNREACHABLE (access roads CLOSED or shelter flood risk exceeded).`
        : `No open route exists between ${originNode.name} and any reachable municipal shelter because intervening river bridges/arterials are CLOSED.`;
    } else {
      failureReason = 'Shelter capacity exceeded';
      const maxRemaining = Math.max(
        0,
        ...reachableWithRoute.map((r) => r.shelter.remainingCapacity)
      );
      failureDetail = `${cell.localityName} (${cell.id}) requires ${populationAtRisk} shelter berths, which exceeds remaining capacity at all reachable shelters (maximum remaining berths at any reachable shelter: ${maxRemaining}). Higher-priority zones consumed available capacity.`;
    }

    const prov = createProvenance(
      params.mode,
      cell.confidence,
      params.timelineHourOffset
    );
    const expiryDate = new Date(
      new Date(prov.generated_at).getTime() + 10 * 60 * 1000
    );

    return {
      ...prov,
      id: `EVAC-${cell.id}`,
      sourceCellId: cell.id,
      sourceLocality: `${cell.localityName} (${cell.wardCode})`,
      wardCode: cell.wardCode,
      floodProbability: cell.floodProbability,
      predictedDepthCm: cell.predictedDepthCm,
      populationAtRisk,
      priorityScore,
      priorityTier,
      priorityReason,
      criticalFacilities,
      nearestShelters,
      roadAccessibilityStatus,
      roadAccessibilityLabel,
      originNodeId: originNode.id,
      originNodeName: originNode.name,
      severity: cell.severity,
      assigned: false,
      assignmentSummary: `${cell.localityName} (${cell.id}) → no feasible assignment`,
      targetShelterId: 'UNASSIGNED',
      targetShelterName: 'no feasible assignment',
      recommendedRouteId: 'NONE',
      routeRoadIds: [],
      routeRoadNames: [],
      routeNodeIds: [],
      routeLabel: 'Recommended evacuation route under current data',
      routeRiskScore: 100,
      distanceKm: 0,
      estimatedClearanceMin: 0,
      busesAssigned: 0,
      status: 'UNASSIGNED_FAILURE',
      failureBanner: 'NO FEASIBLE EVACUATION PLAN',
      failureReason,
      failureDetail,
      expiry: expiryDate.toISOString(),
    };
  });

  return {
    shelters,
    evacuationPlans,
    evacuationModeActive,
    evacuationTriggerReason,
  };
}

/**
 * Evaluates evacuation plan for a specific selected area (cell) using the existing road network,
 * high-ground shelters, and capacity metrics.
 */
export function evaluateEvacuationForSelectedCell(
  cell: FloodRiskCell,
  shelters: Shelter[],
  roads: RoadSegmentState[],
  params: ScenarioParameters,
  evacuationPlans: EvacuationPlanItem[]
): EvacuationPlanItem {
  // 1. If an existing plan for this cell is already computed, use it if assigned
  const existing = evacuationPlans.find((p) => p.sourceCellId === cell.id);
  if (existing && existing.assigned && existing.routeRoadIds.length > 0) {
    return existing;
  }

  // 2. Determine origin node and exposed population at risk proxy
  const originNode = findNearestNodeForCell(cell);
  const exposureRatio =
    cell.severity === FloodSeverity.CRITICAL
      ? 0.042
      : cell.severity === FloodSeverity.HIGH
      ? 0.026
      : 0.016;
  const populationAtRisk = Math.max(
    95,
    Math.round((cell.populationEstimate * exposureRatio) / 10) * 10
  );

  // Check if originNode itself has open incident corridors
  const originHasOpenCorridors = roads.some(
    (r) =>
      (r.fromNodeId === originNode.id ||
        r.toNodeId === originNode.id ||
        (originNode.id === 'NODE-GEETA-BHAWAN' && (r.id === 'RD-22' || r.id === 'RD-18'))) &&
      r.currentState !== RoadStatus.CLOSED
  );

  // Evaluate route from originNode to all reachable shelters
  const reachableShelters = shelters.filter((s) => s.reachable);
  const shelterRoutes = reachableShelters
    .map((sh) => {
      const route = computeEvacuationRouteToShelter(
        originNode.id,
        sh.nearestNodeId,
        roads
      );
      const dxKm = ((sh.x - (cell.col + 0.5) * 125) / 1000) * 5.0;
      const dyKm = ((sh.y - (cell.row + 0.5) * 125) / 1000) * 5.0;
      const crowFliesKm = Number(Math.max(0.4, Math.hypot(dxKm, dyKm)).toFixed(2));
      return {
        shelter: sh,
        route,
        crowFliesKm,
      };
    })
    .sort((a, b) => {
      const aOk = Boolean(a.route);
      const bOk = Boolean(b.route);
      if (aOk !== bOk) return aOk ? -1 : 1;
      if (a.route && b.route) return a.route.routingCost - b.route.routingCost;
      return a.crowFliesKm - b.crowFliesKm;
    });

  const nearestSheltersOptions: EvacuationNearestShelterOption[] = shelterRoutes.map((sr) => ({
    shelterId: sr.shelter.id,
    shelterName: sr.shelter.name,
    distanceKm: sr.route ? sr.route.distanceKm : sr.crowFliesKm,
    travelTimeMin: sr.route ? sr.route.travelTimeMin : null,
    reachable: Boolean(sr.route),
    remainingCapacityBefore: sr.shelter.remainingCapacity,
  }));

  const candidateWithRoute = shelterRoutes.filter(
    (sr): sr is { shelter: Shelter; route: EvacRouteResult; crowFliesKm: number } =>
      sr.route !== null && sr.route.roadIds.length > 0
  );

  // Preference: 1) has remaining capacity >= populationAtRisk, 2) has any remaining capacity > 0
  const feasibleMatch =
    candidateWithRoute.find((sr) => sr.shelter.remainingCapacity >= populationAtRisk) ??
    candidateWithRoute.find((sr) => sr.shelter.remainingCapacity > 0);

  if (feasibleMatch) {
    const chosenShelter = feasibleMatch.shelter;
    const chosenRoute = feasibleMatch.route;
    const planConfidence = Number(
      ((cell.confidence + chosenRoute.confidence) / 2).toFixed(2)
    );
    const prov = createProvenance(
      params.mode,
      planConfidence,
      params.timelineHourOffset
    );
    const expiryDate = new Date(Date.now() + 15 * 60000);
    const busesAssigned = Math.max(2, Math.ceil(populationAtRisk / 50));
    const estimatedClearanceMin = Math.round(
      chosenRoute.travelTimeMin + Math.min(25, populationAtRisk * 0.035)
    );

    return {
      ...prov,
      id: `EVAC-EVAL-${cell.id}-${chosenShelter.id}`,
      sourceCellId: cell.id,
      sourceLocality: `${cell.localityName} (${cell.wardCode})`,
      wardCode: cell.wardCode,
      floodProbability: cell.floodProbability,
      predictedDepthCm: cell.predictedDepthCm,
      populationAtRisk,
      priorityScore: Math.round(cell.floodProbability * 100),
      priorityTier: 'PRIORITY_3_VULNERABLE_ZONE',
      priorityReason: `Evaluated evacuation corridor to ${chosenShelter.name} via ${originNode.name}.`,
      criticalFacilities: [],
      nearestShelters: nearestSheltersOptions,
      roadAccessibilityStatus: 'ACCESSIBLE',
      roadAccessibilityLabel: `Passable corridor to ${chosenShelter.name}`,
      originNodeId: originNode.id,
      originNodeName: originNode.name,
      severity: cell.severity,
      assigned: true,
      assignmentSummary: `${cell.localityName} (${cell.id}) → ${chosenShelter.name}`,
      targetShelterId: chosenShelter.id,
      targetShelterName: chosenShelter.name,
      recommendedRouteId: chosenRoute.roadIds.join(' → '),
      routeRoadIds: chosenRoute.roadIds,
      routeRoadNames: chosenRoute.roadNames,
      routeNodeIds: chosenRoute.nodeIds,
      routeLabel: 'Recommended evacuation route under current data',
      routeRiskScore: chosenRoute.riskScore,
      distanceKm: chosenRoute.distanceKm,
      estimatedClearanceMin,
      busesAssigned,
      status: 'EVACUATING',
      expiry: expiryDate.toISOString(),
    };
  }

  // FAILURE DIAGNOSTICS: Determine accurate, evidence-based root cause
  let failureReason: EvacuationFailureReason = 'Shelter capacity exceeded';
  let failureDetail = '';

  if (!originHasOpenCorridors) {
    failureReason = 'Road network disconnected';
    failureDetail = `All outgoing road corridors from ${originNode.name} serving ${cell.localityName} (${cell.id}) are CLOSED due to flood inundation. Evacuation buses cannot enter or exit via the surface road network.`;
  } else if (candidateWithRoute.length === 0) {
    failureReason = 'No reachable shelter';
    failureDetail = `Outgoing roads from ${originNode.name} are passable, but intervening river bridges or approaches to all 4 municipal shelters are currently CLOSED or cut off by flood water.`;
  } else {
    failureReason = 'Shelter capacity exceeded';
    const names = candidateWithRoute.map((c) => c.shelter.name).join(', ');
    failureDetail = `Road corridor from ${originNode.name} to municipal shelter (${candidateWithRoute[0].shelter.name}) is open, but all reachable shelters (${names}) have reached capacity. Higher-priority low-lying riverfront zones consumed available berths.`;
  }

  const prov = createProvenance(params.mode, cell.confidence, params.timelineHourOffset);
  const expiryDate = new Date(Date.now() + 10 * 60000);

  return {
    ...prov,
    id: `EVAC-EVAL-${cell.id}`,
    sourceCellId: cell.id,
    sourceLocality: `${cell.localityName} (${cell.wardCode})`,
    wardCode: cell.wardCode,
    floodProbability: cell.floodProbability,
    predictedDepthCm: cell.predictedDepthCm,
    populationAtRisk,
    priorityScore: Math.round(cell.floodProbability * 100),
    priorityTier: 'PRIORITY_3_VULNERABLE_ZONE',
    priorityReason: `Zone evaluated: ${failureReason}`,
    criticalFacilities: [],
    nearestShelters: nearestSheltersOptions,
    roadAccessibilityStatus: originHasOpenCorridors ? 'RESTRICTED_HIGH_RISK' : 'DISCONNECTED',
    roadAccessibilityLabel: originHasOpenCorridors
      ? 'Corridors restricted / shelters at capacity'
      : 'All outgoing roads flooded or closed',
    originNodeId: originNode.id,
    originNodeName: originNode.name,
    severity: cell.severity,
    assigned: false,
    assignmentSummary: `${cell.localityName} (${cell.id}) → no feasible assignment`,
    targetShelterId: 'UNASSIGNED',
    targetShelterName: 'no feasible assignment',
    recommendedRouteId: 'NONE',
    routeRoadIds: [],
    routeRoadNames: [],
    routeNodeIds: [],
    routeLabel: 'Recommended evacuation route under current data',
    routeRiskScore: 100,
    distanceKm: 0,
    estimatedClearanceMin: 0,
    busesAssigned: 0,
    status: 'UNASSIGNED_FAILURE',
    failureBanner: 'NO FEASIBLE EVACUATION PLAN',
    failureReason,
    failureDetail,
    expiry: expiryDate.toISOString(),
  };
}
