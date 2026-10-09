import { BASE_SHELTERS, INTERSECTION_NODES } from '../data/indorePilotData';
import {
  ComputedPathDetail,
  IntersectionNode,
  NoFeasibleRouteInfo,
  ProductMode,
  RoadSegmentState,
  RoadStatus,
  RouteRecommendation,
  ScenarioParameters,
  TravelProfile,
} from '../types/idhara';
import { createProvenance } from './dataIngestion';

export interface TravelProfilePolicy {
  id: TravelProfile;
  label: string;
  badge: string;
  likelyFloodedPolicy: 'REMOVED' | 'HEAVY_PENALTY';
  atRiskPenaltyMultiplier: number;
  speedMultiplier: number;
  policySummary: string;
}

export const TRAVEL_PROFILE_POLICIES: Record<TravelProfile, TravelProfilePolicy> = {
  CITIZEN: {
    id: 'CITIZEN',
    label: 'Citizen',
    badge: 'Standard Vehicle / Two-Wheeler',
    likelyFloodedPolicy: 'REMOVED',
    atRiskPenaltyMultiplier: 1.65,
    speedMultiplier: 1.0,
    policySummary:
      'CLOSED and LIKELY_FLOODED roads removed from routing; AT_RISK roads receive +65% risk penalty.',
  },
  PEDESTRIAN: {
    id: 'PEDESTRIAN',
    label: 'Pedestrian',
    badge: 'Foot / High-Ground Walk',
    likelyFloodedPolicy: 'REMOVED',
    atRiskPenaltyMultiplier: 2.2,
    speedMultiplier: 2.5,
    policySummary:
      'CLOSED and LIKELY_FLOODED roads removed (wading hazard); steep penalty on AT_RISK sheet-flow streets.',
  },
  EMERGENCY_RESPONDER: {
    id: 'EMERGENCY_RESPONDER',
    label: 'Emergency responder',
    badge: 'High-Clearance SDRF / Fire Unit',
    likelyFloodedPolicy: 'HEAVY_PENALTY',
    atRiskPenaltyMultiplier: 1.25,
    speedMultiplier: 0.9,
    policySummary:
      'CLOSED roads removed; LIKELY_FLOODED carries heavy penalty (+22m risk cost, fallback only); AT_RISK +25% penalty.',
  },
  AMBULANCE: {
    id: 'AMBULANCE',
    label: 'Ambulance',
    badge: 'Critical Medical / Zero-Stall',
    likelyFloodedPolicy: 'REMOVED',
    atRiskPenaltyMultiplier: 1.9,
    speedMultiplier: 0.82,
    policySummary:
      'CLOSED and LIKELY_FLOODED strictly removed for patient safety; priority green corridor on OPEN roads.',
  },
};

interface GraphEdge {
  road: RoadSegmentState;
  toNodeId: string;
  routingCost: number;
  effectiveEtaMin: number;
  riskPenaltyMin: number;
}

/**
 * Computes the edge routing cost & effective travel time for a road segment under a given TravelProfile.
 * Returns null if the road MUST be removed from the routing graph (e.g., CLOSED, or LIKELY_FLOODED when policy = REMOVED).
 */
export function evaluateEdgeForProfile(
  road: RoadSegmentState,
  profile: TravelProfile,
  floodAware: boolean,
  penalizedRoadIds?: Set<string>
): { routingCost: number; effectiveEtaMin: number; riskPenaltyMin: number } | null {
  const policy = TRAVEL_PROFILE_POLICIES[profile];
  const baseTime = road.baseTravelTimeMin * policy.speedMultiplier;

  if (!floodAware) {
    return {
      routingCost: baseTime,
      effectiveEtaMin: Number(baseTime.toFixed(1)),
      riskPenaltyMin: 0,
    };
  }

  // Rule 1: CLOSED roads must ALWAYS be removed from routing
  if (road.currentState === RoadStatus.CLOSED) {
    return null;
  }

  // Rule 2: LIKELY_FLOODED roads are removed or heavily penalized according to profile policy
  if (road.currentState === RoadStatus.LIKELY_FLOODED) {
    if (policy.likelyFloodedPolicy === 'REMOVED') {
      return null;
    }
    // HEAVY_PENALTY for high-clearance Emergency Responder units
    const penalty = road.riskPenaltyMin * 1.8 + 18;
    const eta = baseTime * 2.1;
    const altPenalty = penalizedRoadIds?.has(road.id) ? 35 : 0;
    return {
      routingCost: eta + penalty + altPenalty,
      effectiveEtaMin: Number(eta.toFixed(1)),
      riskPenaltyMin: Number(penalty.toFixed(1)),
    };
  }

  // Rule 3: AT_RISK roads receive a risk penalty
  if (road.currentState === RoadStatus.AT_RISK) {
    const penalty = road.riskPenaltyMin * policy.atRiskPenaltyMultiplier;
    const eta = baseTime * 1.35;
    const altPenalty = penalizedRoadIds?.has(road.id) ? 25 : 0;
    return {
      routingCost: eta + penalty + altPenalty,
      effectiveEtaMin: Number((eta + penalty * 0.35).toFixed(1)),
      riskPenaltyMin: Number(penalty.toFixed(1)),
    };
  }

  // Rule 4: OPEN roads still scale cost smoothly with flood probability
  const openRiskPenalty = road.floodProbability * 2.4 * policy.atRiskPenaltyMultiplier;
  const altPenalty = penalizedRoadIds?.has(road.id) ? 22 : 0;
  return {
    routingCost: baseTime + openRiskPenalty + altPenalty,
    effectiveEtaMin: Number(baseTime.toFixed(1)),
    riskPenaltyMin: Number(openRiskPenalty.toFixed(1)),
  };
}

/**
 * Runs Dijkstra over the filtered Indore road graph.
 * Returns null if no feasible path exists between originNodeId and destinationNodeId.
 */
function runDijkstraPath(
  originNodeId: string,
  destinationNodeId: string,
  roads: RoadSegmentState[],
  profile: TravelProfile,
  floodAware: boolean,
  params: ScenarioParameters,
  label: string,
  penalizedRoadIds?: Set<string>
): ComputedPathDetail | null {
  const adj = new Map<string, GraphEdge[]>();
  INTERSECTION_NODES.forEach((n) => adj.set(n.id, []));

  roads.forEach((r) => {
    const evalResult = evaluateEdgeForProfile(r, profile, floodAware, penalizedRoadIds);
    if (!evalResult) return; // Removed from routing graph!

    adj.get(r.fromNodeId)?.push({
      road: r,
      toNodeId: r.toNodeId,
      ...evalResult,
    });
    adj.get(r.toNodeId)?.push({
      road: r,
      toNodeId: r.fromNodeId,
      ...evalResult,
    });

    // Handle corridor RD-22 (AB Road BRTS South: MY Hospital ↔ Geeta Bhawan ↔ Navalakha)
    if (r.id === 'RD-22') {
      const halfCost = {
        road: r,
        routingCost: evalResult.routingCost / 2,
        effectiveEtaMin: Number((evalResult.effectiveEtaMin / 2).toFixed(1)),
        riskPenaltyMin: Number((evalResult.riskPenaltyMin / 2).toFixed(1)),
      };
      adj.get('NODE-MY-HOSPITAL')?.push({
        ...halfCost,
        toNodeId: 'NODE-GEETA-BHAWAN',
      });
      adj.get('NODE-GEETA-BHAWAN')?.push({
        ...halfCost,
        toNodeId: 'NODE-MY-HOSPITAL',
      });
      adj.get('NODE-GEETA-BHAWAN')?.push({
        ...halfCost,
        toNodeId: 'NODE-NAVALAKHA',
      });
      adj.get('NODE-NAVALAKHA')?.push({
        ...halfCost,
        toNodeId: 'NODE-GEETA-BHAWAN',
      });
    }

    // Handle corridor RD-18 (AB Road BRTS North: Palasia ↔ Geeta Bhawan ↔ MY Hospital)
    if (r.id === 'RD-18') {
      const halfCost = {
        road: r,
        routingCost: evalResult.routingCost / 2,
        effectiveEtaMin: Number((evalResult.effectiveEtaMin / 2).toFixed(1)),
        riskPenaltyMin: Number((evalResult.riskPenaltyMin / 2).toFixed(1)),
      };
      adj.get('NODE-PALASIA')?.push({
        ...halfCost,
        toNodeId: 'NODE-GEETA-BHAWAN',
      });
      adj.get('NODE-GEETA-BHAWAN')?.push({
        ...halfCost,
        toNodeId: 'NODE-PALASIA',
      });
      adj.get('NODE-GEETA-BHAWAN')?.push({
        ...halfCost,
        toNodeId: 'NODE-MY-HOSPITAL',
      });
      adj.get('NODE-MY-HOSPITAL')?.push({
        ...halfCost,
        toNodeId: 'NODE-GEETA-BHAWAN',
      });
    }
  });

  const dist = new Map<string, number>();
  const prevNode = new Map<string, string>();
  const prevEdge = new Map<string, GraphEdge>();
  const visited = new Set<string>();

  INTERSECTION_NODES.forEach((n) => dist.set(n.id, Number.POSITIVE_INFINITY));
  dist.set(originNodeId, 0);

  while (visited.size < INTERSECTION_NODES.length) {
    let u: string | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const [nodeId, d] of dist.entries()) {
      if (!visited.has(nodeId) && d < bestD) {
        bestD = d;
        u = nodeId;
      }
    }
    if (!u || bestD === Number.POSITIVE_INFINITY || u === destinationNodeId) break;
    visited.add(u);

    const neighbors = adj.get(u) || [];
    for (const edge of neighbors) {
      if (visited.has(edge.toNodeId)) continue;
      const alt = (dist.get(u) ?? Number.POSITIVE_INFINITY) + edge.routingCost;
      if (alt < (dist.get(edge.toNodeId) ?? Number.POSITIVE_INFINITY)) {
        dist.set(edge.toNodeId, alt);
        prevNode.set(edge.toNodeId, u);
        prevEdge.set(edge.toNodeId, edge);
      }
    }
  }

  // Check if destination was actually reached
  if ((dist.get(destinationNodeId) ?? Number.POSITIVE_INFINITY) === Number.POSITIVE_INFINITY) {
    return null;
  }

  const nodeIds: string[] = [];
  const roadIds: string[] = [];
  const roadNames: string[] = [];
  let curr: string | undefined = destinationNodeId;
  let distanceKm = 0;
  let travelTimeMin = 0;
  let baseTravelTimeMin = 0;
  let totalRiskPenaltyMin = 0;
  let maxFloodProbability = 0;
  let weightedProbSum = 0;
  let confSum = 0;

  while (curr) {
    nodeIds.unshift(curr);
    const edge = prevEdge.get(curr);
    if (edge) {
      roadIds.unshift(edge.road.id);
      roadNames.unshift(edge.road.name);
      distanceKm += edge.road.lengthKm;
      travelTimeMin += edge.effectiveEtaMin;
      baseTravelTimeMin += edge.road.baseTravelTimeMin;
      totalRiskPenaltyMin += edge.riskPenaltyMin;
      maxFloodProbability = Math.max(maxFloodProbability, edge.road.floodProbability);
      weightedProbSum += edge.road.floodProbability;
      confSum += edge.road.confidence;
    }
    curr = prevNode.get(curr);
  }

  if (nodeIds[0] !== originNodeId || roadIds.length === 0) {
    return null;
  }

  const avgProb = weightedProbSum / roadIds.length;
  const riskScore = Math.min(
    100,
    Math.round((maxFloodProbability * 0.65 + avgProb * 0.35) * 100)
  );
  const confidence = Number((confSum / roadIds.length).toFixed(2));
  const prov = createProvenance(
    params?.mode ?? ProductMode.SIMULATED,
    confidence,
    params?.timelineHourOffset ?? 0
  );
  const expiry = new Date(
    new Date(prov.generated_at).getTime() + 12 * 60 * 1000
  ).toISOString();

  return {
    label,
    nodeIds,
    roadIds,
    roadNames,
    distanceKm: Number(distanceKm.toFixed(2)),
    travelTimeMin: Number(travelTimeMin.toFixed(1)),
    baseTravelTimeMin: Number(baseTravelTimeMin.toFixed(1)),
    totalRiskPenaltyMin: Number(totalRiskPenaltyMin.toFixed(1)),
    riskScore,
    maxFloodProbability: Number(maxFloodProbability.toFixed(2)),
    confidence,
    generated_at: prov.generated_at,
    expiry,
    statusBanner: 'Recommended under current data',
  };
}

/**
 * Computes diagnostics when NO FEASIBLE ROUTE exists between Origin and Destination:
 * - Nearest reachable safe point (high elevation node reachable from Origin)
 * - Nearest available shelter
 * - Reason (blocking CLOSED / LIKELY_FLOODED corridors)
 */
function computeNoFeasibleRouteDiagnostics(
  originNodeId: string,
  destinationNodeId: string,
  roads: RoadSegmentState[],
  profile: TravelProfile,
  params: ScenarioParameters,
  baselinePath: ComputedPathDetail | null
): NoFeasibleRouteInfo {
  const nodeMap = new Map(INTERSECTION_NODES.map((n) => [n.id, n]));
  const roadMap = new Map(roads.map((r) => [r.id, r]));
  const originNode = nodeMap.get(originNodeId);

  // Identify blocking roads along baseline shortest path or incident to origin/destination
  const candidateBlocking =
    baselinePath && baselinePath.roadIds.length > 0
      ? baselinePath.roadIds
          .map((id) => roadMap.get(id))
          .filter((r): r is RoadSegmentState => Boolean(r))
          .filter(
            (r) =>
              r.currentState === RoadStatus.CLOSED ||
              r.currentState === RoadStatus.LIKELY_FLOODED
          )
      : [];

  const incidentBlocking = roads.filter(
    (r) =>
      (r.fromNodeId === originNodeId ||
        r.toNodeId === originNodeId ||
        r.fromNodeId === destinationNodeId ||
        r.toNodeId === destinationNodeId) &&
      (r.currentState === RoadStatus.CLOSED ||
        r.currentState === RoadStatus.LIKELY_FLOODED)
  );

  const combinedBlockingMap = new Map<string, RoadSegmentState>();
  [...candidateBlocking, ...incidentBlocking].forEach((r) =>
    combinedBlockingMap.set(r.id, r)
  );
  if (combinedBlockingMap.size === 0) {
    roads
      .filter((r) => r.currentState === RoadStatus.CLOSED)
      .slice(0, 3)
      .forEach((r) => combinedBlockingMap.set(r.id, r));
  }

  const blockingList = Array.from(combinedBlockingMap.values());
  const blockingRoadIds = blockingList.map((r) => r.id);
  const blockingRoadNames = blockingList.map(
    (r) => `${r.id} (${r.name} — ${r.currentState})`
  );

  // Find all reachable nodes from originNodeId to pick the nearest reachable safe point
  let bestSafePoint: NoFeasibleRouteInfo['nearestReachableSafePoint'] = null;
  for (const candidateNode of INTERSECTION_NODES) {
    if (candidateNode.id === originNodeId) continue;
    const pathToNode = runDijkstraPath(
      originNodeId,
      candidateNode.id,
      roads,
      profile,
      true,
      params,
      'Safe Point'
    );
    if (pathToNode) {
      // Prefer elevated safe nodes (>= 549m MSL) or shortest time to safety
      if (
        !bestSafePoint ||
        (candidateNode.elevationM >= 549.5 && bestSafePoint.elevationM < 549.5) ||
        (candidateNode.elevationM >= 549.5 &&
          pathToNode.travelTimeMin < bestSafePoint.travelTimeMin)
      ) {
        bestSafePoint = {
          nodeId: candidateNode.id,
          nodeName: candidateNode.name,
          elevationM: candidateNode.elevationM,
          distanceKm: pathToNode.distanceKm,
          travelTimeMin: pathToNode.travelTimeMin,
          pathRoadIds: pathToNode.roadIds,
        };
      }
    }
  }

  // If origin is completely isolated (0 passable outgoing roads), use origin's local high ground
  if (!bestSafePoint && originNode) {
    bestSafePoint = {
      nodeId: originNode.id,
      nodeName: `${originNode.name} Local High-Ground Staging Point`,
      elevationM: originNode.elevationM,
      distanceKm: 0.15,
      travelTimeMin: 2.0,
      pathRoadIds: [],
    };
  }

  // Find nearest available shelter from Origin
  let nearestShelter: NoFeasibleRouteInfo['nearestAvailableShelter'] = null;
  if (originNode) {
    const sortedShelters = [...BASE_SHELTERS]
      .map((sh) => {
        const dx = ((sh.x - originNode.x) / 1000) * 5.0;
        const dy = ((sh.y - originNode.y) / 1000) * 5.0;
        const distKm = Number(Math.max(0.35, Math.hypot(dx, dy)).toFixed(2));
        const availableBerths = Math.max(40, sh.totalCapacity - sh.baseOccupancy);
        const accessRoad = roadMap.get(sh.accessRoadId);
        const reachable = accessRoad
          ? accessRoad.currentState !== RoadStatus.CLOSED
          : true;
        return {
          shelterId: sh.id,
          shelterName: sh.name,
          ward: sh.ward,
          elevationM: sh.elevationM,
          availableBerths,
          distanceKm: distKm,
          reachable,
        };
      })
      .sort((a, b) => {
        if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
        return a.distanceKm - b.distanceKm;
      });

    nearestShelter = sortedShelters[0] ?? null;
  }

  const policy = TRAVEL_PROFILE_POLICIES[profile];
  const reason =
    blockingRoadNames.length > 0
      ? `All feasible corridors between ${originNode?.name ?? originNodeId} and ${
          nodeMap.get(destinationNodeId)?.name ?? destinationNodeId
        } are severed for ${policy.label} profile due to: ${blockingRoadNames.join('; ')}.`
      : `Destination is cut off by CLOSED / LIKELY_FLOODED corridors under ${policy.label} safety policy.`;

  return {
    reason,
    blockingRoadIds,
    blockingRoadNames,
    nearestReachableSafePoint: bestSafePoint,
    nearestAvailableShelter: nearestShelter,
  };
}

export function findNearestNodeForCell(cell: { lat: number; lng: number }): IntersectionNode {
  let best = INTERSECTION_NODES[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const node of INTERSECTION_NODES) {
    const d = Math.hypot(node.lat - cell.lat, node.lng - cell.lng);
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  return best;
}

/**
 * Computes a single flood-aware route recommendation between two intersection nodes.
 * Reuses the exact same Dijkstra solver, hazard avoidance, and diagnostics as the batch engine.
 */
export function computeSingleRoute(
  originNodeId: string,
  destinationNodeId: string,
  roads: RoadSegmentState[],
  params: ScenarioParameters,
  travelProfile: TravelProfile = 'AMBULANCE'
): RouteRecommendation {
  const nodeMap = new Map(INTERSECTION_NODES.map((n) => [n.id, n]));
  const roadMap = new Map(roads.map((r) => [r.id, r]));

  const baseline = runDijkstraPath(
    originNodeId,
    destinationNodeId,
    roads,
    travelProfile,
    false,
    params,
    'Dry Baseline Path'
  );

  const primaryRoute = runDijkstraPath(
    originNodeId,
    destinationNodeId,
    roads,
    travelProfile,
    true,
    params,
    'Primary Route'
  );

  let alternativeRoute: ComputedPathDetail | null = null;
  if (primaryRoute && primaryRoute.roadIds.length > 0) {
    const penalizedSet = new Set<string>(primaryRoute.roadIds);
    const candidateAlt = runDijkstraPath(
      originNodeId,
      destinationNodeId,
      roads,
      travelProfile,
      true,
      params,
      'Alternative Route',
      penalizedSet
    );
    if (
      candidateAlt &&
      candidateAlt.roadIds.join(',') !== primaryRoute.roadIds.join(',')
    ) {
      alternativeRoute = candidateAlt;
    }
  }

  const baselineBlockedRoadNames = (baseline?.roadIds ?? [])
    .map((id) => roadMap.get(id))
    .filter((r): r is RoadSegmentState => r !== undefined)
    .filter(
      (r) =>
        r.currentState === RoadStatus.CLOSED ||
        r.currentState === RoadStatus.LIKELY_FLOODED ||
        r.currentState === RoadStatus.AT_RISK
    )
    .map((r) => `${r.id}: ${r.name} (${r.currentState})`);

  if (!primaryRoute) {
    // NO FEASIBLE ROUTE — do not fabricate one!
    const noRouteInfo = computeNoFeasibleRouteDiagnostics(
      originNodeId,
      destinationNodeId,
      roads,
      travelProfile,
      params,
      baseline
    );
    const prov = createProvenance(
      params?.mode ?? ProductMode.SIMULATED,
      0.78,
      params?.timelineHourOffset ?? 0
    );
    const expiryDate = new Date(
      new Date(prov.generated_at).getTime() + 10 * 60 * 1000
    );

    return {
      ...prov,
      id: `RTE-PLANNER-${originNodeId}-${destinationNodeId}`,
      originNodeId,
      originName: nodeMap.get(originNodeId)?.name ?? originNodeId,
      destinationNodeId,
      destinationName: nodeMap.get(destinationNodeId)?.name ?? destinationNodeId,
      travelProfile,
      purpose:
        travelProfile === 'AMBULANCE'
          ? 'EMERGENCY_AMBULANCE'
          : travelProfile === 'EMERGENCY_RESPONDER'
          ? 'MUNICIPAL_RESPONSE'
          : travelProfile === 'PEDESTRIAN'
          ? 'EVACUATION_BUS'
          : 'CITIZEN_TRANSIT',
      expiry: expiryDate.toISOString(),
      recommendationStatusLabel: 'Recommended under current data',
      feasible: false,
      primaryRoute: null,
      alternativeRoute: null,
      riskScore: 100,
      noRouteInfo,
      recommendedPathNodeIds: noRouteInfo.nearestReachableSafePoint?.pathRoadIds.length
        ? [originNodeId, noRouteInfo.nearestReachableSafePoint.nodeId]
        : [],
      recommendedRoadIds: noRouteInfo.nearestReachableSafePoint?.pathRoadIds ?? [],
      recommendedDistanceKm: 0,
      recommendedEtaMin: 0,
      maxEncounteredFloodProb: 1,
      baselineShortestRoadIds: baseline?.roadIds ?? [],
      baselineDistanceKm: baseline?.distanceKm ?? 0,
      baselineBlockedRoadNames,
      avoidedHazardCount: baselineBlockedRoadNames.length,
      safetyAdvisory: `NO FEASIBLE ROUTE: ${noRouteInfo.reason}`,
    };
  }

  const prov = createProvenance(
    params?.mode ?? ProductMode.SIMULATED,
    primaryRoute.confidence,
    params?.timelineHourOffset ?? 0
  );

  const safetyAdvisory =
    baselineBlockedRoadNames.length > 0
      ? `Recommended under current data (${TRAVEL_PROFILE_POLICIES[travelProfile].label} profile). Diverts around ${
          baselineBlockedRoadNames.length
        } hazardous segment(s) (${baselineBlockedRoadNames.join(
          ', '
        )}). Never guaranteed safe; verify field telemetry before dispatch.`
      : `Recommended under current data (${
          TRAVEL_PROFILE_POLICIES[travelProfile].label
        } profile). Route risk score ${primaryRoute.riskScore}/100 (max segment flood probability ${Math.round(
          primaryRoute.maxFloodProbability * 100
        )}%). Never guaranteed safe.`;

  return {
    ...prov,
    id: `RTE-PLANNER-${originNodeId}-${destinationNodeId}`,
    originNodeId,
    originName: nodeMap.get(originNodeId)?.name ?? originNodeId,
    destinationNodeId,
    destinationName: nodeMap.get(destinationNodeId)?.name ?? destinationNodeId,
    travelProfile,
    purpose:
      travelProfile === 'AMBULANCE'
        ? 'EMERGENCY_AMBULANCE'
        : travelProfile === 'EMERGENCY_RESPONDER'
        ? 'MUNICIPAL_RESPONSE'
        : travelProfile === 'PEDESTRIAN'
        ? 'EVACUATION_BUS'
        : 'CITIZEN_TRANSIT',
    expiry: primaryRoute.expiry,
    recommendationStatusLabel: 'Recommended under current data',
    feasible: true,
    primaryRoute,
    alternativeRoute,
    riskScore: primaryRoute.riskScore,
    recommendedPathNodeIds: primaryRoute.nodeIds,
    recommendedRoadIds: primaryRoute.roadIds,
    recommendedDistanceKm: primaryRoute.distanceKm,
    recommendedEtaMin: primaryRoute.travelTimeMin,
    maxEncounteredFloodProb: primaryRoute.maxFloodProbability,
    baselineShortestRoadIds: baseline?.roadIds ?? [],
    baselineDistanceKm: baseline?.distanceKm ?? 0,
    baselineBlockedRoadNames,
    avoidedHazardCount: baselineBlockedRoadNames.length,
    safetyAdvisory,
  };
}

/**
 * Computes flood-aware route recommendations across key Indore operational corridors.
 * Never describes any route as "Guaranteed safe" — always "Recommended under current data".
 */
export function computeRouteRecommendations(
  roads: RoadSegmentState[],
  params: ScenarioParameters,
  customOriginId: string = 'NODE-RAJWADA',
  customDestId: string = 'NODE-MY-HOSPITAL',
  travelProfile: TravelProfile = 'AMBULANCE'
): RouteRecommendation[] {
  const nodeMap = new Map(INTERSECTION_NODES.map((n) => [n.id, n]));
  const roadMap = new Map(roads.map((r) => [r.id, r]));

  const pairs: Array<{
    id: string;
    from: string;
    to: string;
    profile: TravelProfile;
    purpose: RouteRecommendation['purpose'];
  }> = [
    {
      id: `RTE-PLANNER-${customOriginId}-${customDestId}`,
      from: customOriginId,
      to: customDestId !== customOriginId ? customDestId : 'NODE-MY-HOSPITAL',
      profile: travelProfile,
      purpose:
        travelProfile === 'AMBULANCE'
          ? 'EMERGENCY_AMBULANCE'
          : travelProfile === 'EMERGENCY_RESPONDER'
          ? 'MUNICIPAL_RESPONSE'
          : travelProfile === 'PEDESTRIAN'
          ? 'EVACUATION_BUS'
          : 'CITIZEN_TRANSIT',
    },
    {
      id: 'RTE-AMB-RAJWADA-MYH',
      from: 'NODE-RAJWADA',
      to: 'NODE-MY-HOSPITAL',
      profile: travelProfile,
      purpose: 'EMERGENCY_AMBULANCE',
    },
    {
      id: 'RTE-SDRF-CHIMANBAGH-HARSIDDHI',
      from: 'NODE-CHIMANBAGH',
      to: 'NODE-HARSIDDHI',
      profile: travelProfile,
      purpose: 'MUNICIPAL_RESPONSE',
    },
    {
      id: 'RTE-EVAC-SARWATE-PALASIA',
      from: 'NODE-SARWATE',
      to: 'NODE-PALASIA',
      profile: travelProfile,
      purpose: 'EVACUATION_BUS',
    },
    {
      id: 'RTE-TRANSIT-BADA-NAVALAKHA',
      from: 'NODE-BADA-GANPATI',
      to: 'NODE-NAVALAKHA',
      profile: travelProfile,
      purpose: 'CITIZEN_TRANSIT',
    },
  ];

  // Deduplicate if customOriginId/customDestId matches one of the preset pairs
  const uniquePairs = pairs.filter(
    (p, idx, arr) =>
      idx === 0 ||
      !(p.from === arr[0].from && p.to === arr[0].to)
  );

  return uniquePairs.map((pair) => {
    const baseline = runDijkstraPath(
      pair.from,
      pair.to,
      roads,
      pair.profile,
      false,
      params,
      'Dry Baseline Path'
    );

    const primaryRoute = runDijkstraPath(
      pair.from,
      pair.to,
      roads,
      pair.profile,
      true,
      params,
      'Primary Route'
    );

    let alternativeRoute: ComputedPathDetail | null = null;
    if (primaryRoute && primaryRoute.roadIds.length > 0) {
      const penalizedSet = new Set<string>(primaryRoute.roadIds);
      const candidateAlt = runDijkstraPath(
        pair.from,
        pair.to,
        roads,
        pair.profile,
        true,
        params,
        'Alternative Route',
        penalizedSet
      );
      if (
        candidateAlt &&
        candidateAlt.roadIds.join(',') !== primaryRoute.roadIds.join(',')
      ) {
        alternativeRoute = candidateAlt;
      }
    }

    const baselineBlockedRoadNames = (baseline?.roadIds ?? [])
      .map((id) => roadMap.get(id))
      .filter((r): r is RoadSegmentState => r !== undefined)
      .filter(
        (r) =>
          r.currentState === RoadStatus.CLOSED ||
          r.currentState === RoadStatus.LIKELY_FLOODED ||
          r.currentState === RoadStatus.AT_RISK
      )
      .map((r) => `${r.id}: ${r.name} (${r.currentState})`);

    if (!primaryRoute) {
      // NO FEASIBLE ROUTE — do not fabricate one!
      const noRouteInfo = computeNoFeasibleRouteDiagnostics(
        pair.from,
        pair.to,
        roads,
        pair.profile,
        params,
        baseline
      );
      const prov = createProvenance(
        params?.mode ?? ProductMode.SIMULATED,
        0.78,
        params?.timelineHourOffset ?? 0
      );
      const expiryDate = new Date(
        new Date(prov.generated_at).getTime() + 10 * 60 * 1000
      );

      return {
        ...prov,
        id: pair.id,
        originNodeId: pair.from,
        originName: nodeMap.get(pair.from)?.name ?? pair.from,
        destinationNodeId: pair.to,
        destinationName: nodeMap.get(pair.to)?.name ?? pair.to,
        travelProfile: pair.profile,
        purpose: pair.purpose,
        expiry: expiryDate.toISOString(),
        recommendationStatusLabel: 'Recommended under current data',
        feasible: false,
        primaryRoute: null,
        alternativeRoute: null,
        riskScore: 100,
        noRouteInfo,
        recommendedPathNodeIds: noRouteInfo.nearestReachableSafePoint?.pathRoadIds.length
          ? [pair.from, noRouteInfo.nearestReachableSafePoint.nodeId]
          : [],
        recommendedRoadIds: noRouteInfo.nearestReachableSafePoint?.pathRoadIds ?? [],
        recommendedDistanceKm: 0,
        recommendedEtaMin: 0,
        maxEncounteredFloodProb: 1,
        baselineShortestRoadIds: baseline?.roadIds ?? [],
        baselineDistanceKm: baseline?.distanceKm ?? 0,
        baselineBlockedRoadNames,
        avoidedHazardCount: baselineBlockedRoadNames.length,
        safetyAdvisory: `NO FEASIBLE ROUTE: ${noRouteInfo.reason}`,
      };
    }

    const prov = createProvenance(
      params.mode,
      primaryRoute.confidence,
      params.timelineHourOffset
    );

    const safetyAdvisory =
      baselineBlockedRoadNames.length > 0
        ? `Recommended under current data (${TRAVEL_PROFILE_POLICIES[pair.profile].label} profile). Diverts around ${
            baselineBlockedRoadNames.length
          } hazardous segment(s) (${baselineBlockedRoadNames.join(
            ', '
          )}). Never guaranteed safe; verify field telemetry before dispatch.`
        : `Recommended under current data (${
            TRAVEL_PROFILE_POLICIES[pair.profile].label
          } profile). Route risk score ${primaryRoute.riskScore}/100 (max segment flood probability ${Math.round(
            primaryRoute.maxFloodProbability * 100
          )}%). Never guaranteed safe.`;

    return {
      ...prov,
      id: pair.id,
      originNodeId: pair.from,
      originName: nodeMap.get(pair.from)?.name ?? pair.from,
      destinationNodeId: pair.to,
      destinationName: nodeMap.get(pair.to)?.name ?? pair.to,
      travelProfile: pair.profile,
      purpose: pair.purpose,
      expiry: primaryRoute.expiry,
      recommendationStatusLabel: 'Recommended under current data',
      feasible: true,
      primaryRoute,
      alternativeRoute,
      riskScore: primaryRoute.riskScore,
      recommendedPathNodeIds: primaryRoute.nodeIds,
      recommendedRoadIds: primaryRoute.roadIds,
      recommendedDistanceKm: primaryRoute.distanceKm,
      recommendedEtaMin: primaryRoute.travelTimeMin,
      maxEncounteredFloodProb: primaryRoute.maxFloodProbability,
      baselineShortestRoadIds: baseline?.roadIds ?? [],
      baselineDistanceKm: baseline?.distanceKm ?? 0,
      baselineBlockedRoadNames,
      avoidedHazardCount: baselineBlockedRoadNames.length,
      safetyAdvisory,
    };
  });
}

/**
 * Selects the best road segment on the currently active Primary Route to close during the
 * "Demo incident" so that:
 * 1. The current route becomes invalid.
 * 2. An alternative feasible route exists and is automatically recalculated.
 */
export function selectDemoIncidentRoad(
  activeRoute: RouteRecommendation | null,
  roads: RoadSegmentState[],
  params: ScenarioParameters
): RoadSegmentState | null {
  const roadMap = new Map(roads.map((r) => [r.id, r]));

  if (activeRoute && activeRoute.primaryRoute && activeRoute.primaryRoute.roadIds.length > 0) {
    // Try closing each road on the primary route and see if a feasible alternative still exists
    for (const candidateRoadId of activeRoute.primaryRoute.roadIds) {
      const simulatedRoads = roads.map((r) =>
        r.id === candidateRoadId
          ? { ...r, currentState: RoadStatus.CLOSED }
          : r
      );
      const testPath = runDijkstraPath(
        activeRoute.originNodeId,
        activeRoute.destinationNodeId,
        simulatedRoads,
        activeRoute.travelProfile,
        true,
        params,
        'Test Alt'
      );
      if (testPath) {
        return roadMap.get(candidateRoadId) ?? null;
      }
    }
    // Fallback to the first road on the primary route
    return roadMap.get(activeRoute.primaryRoute.roadIds[0]) ?? null;
  }

  return roads.find((r) => r.currentState === RoadStatus.OPEN) ?? roads[0] ?? null;
}
