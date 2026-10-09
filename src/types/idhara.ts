export enum ProductMode {
  LIVE = 'LIVE',
  HISTORICAL = 'HISTORICAL',
  SIMULATED = 'SIMULATED',
  MOCK = 'MOCK',
}

export enum DisasterStage {
  EARLY_WARNING = 'EARLY_WARNING',
  PRE_DISASTER_SCENARIO = 'PRE_DISASTER_SCENARIO',
  REAL_TIME_ONGOING = 'REAL_TIME_ONGOING',
  POST_DISASTER_LEARNING = 'POST_DISASTER_LEARNING',
}

export enum UserRole {
  CONTROL_ROOM_OPERATOR = 'Control-room operator',
  EMERGENCY_RESPONDER = 'Emergency responder',
  TRAFFIC_AUTHORITY = 'Traffic authority',
  CITIZEN = 'Citizen',
  ANALYST_MODEL_OPERATOR = 'Analyst/model operator',
  ANALYST = 'Analyst',
  MODEL_OPERATOR = 'Model Operator',
}

export function isAnalystOrModelOperator(role: UserRole | string): boolean {
  if (!role) return false;
  const str = String(role).toLowerCase();
  return str.includes('analyst') || str.includes('model operator');
}

export type NavigationTab =
  | 'overview'
  | 'risk-map'
  | 'disaster-twin'
  | 'roads-routing'
  | 'evacuation'
  | 'alerts'
  | 'event-replay'
  | 'validation'
  | 'data-health';

export enum FloodSeverity {
  LOW = 'LOW',
  MODERATE = 'MODERATE',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum WarningLevel {
  GREEN = 'GREEN',
  YELLOW = 'YELLOW',
  ORANGE = 'ORANGE',
  RED = 'RED',
}

export type MapSurfaceMetric =
  | 'FLOOD_PROBABILITY'
  | 'SEVERITY'
  | 'UNCERTAINTY'
  | 'DATA_CONFIDENCE'
  | 'RAINFALL'
  | 'PREDICTED_VS_OBSERVED';

export type ReplaySpeed = 1 | 2 | 5;

export interface CellPredictionInput {
  rainfall_1h: number;
  rainfall_3h: number;
  rainfall_6h: number;
  rainfall_24h: number;
  elevation: number; // m MSL
  slope: number; // degrees
  flow_accumulation: number; // 0.0 - 1.0
  drainage_proxy: number; // 0.0 - 1.0
  imperviousness: number; // 0.0 - 1.0
  historical_flood_score: number; // 0.0 - 1.0
  road_exposure: number; // 0.0 - 1.0
}

export interface CellPredictionOutput {
  flood_probability: number; // 0.0 - 1.0
  severity: FloodSeverity;
  uncertainty: number; // 0.0 - 1.0 spread
  data_confidence: number; // 0.0 - 1.0
  top_drivers: FloodDriver[];
  lead_time: number; // expected onset in minutes
}

export interface WarningHysteresisState {
  rawLevel: WarningLevel;
  effectiveLevel: WarningLevel;
  actionDirective: string; // e.g. 'RED — ACTIVATE & EVACUATE', 'ORANGE — PREPARE'
  isHoldingDeescalation: boolean;
  stableTicksCount: number;
  requiredStableTicks: number;
  rationale: string;
}

export enum RoadStatus {
  OPEN = 'OPEN',
  AT_RISK = 'AT_RISK',
  LIKELY_FLOODED = 'LIKELY_FLOODED',
  CLOSED = 'CLOSED',
  // Backwards-compatible aliases pointing to the 4 canonical states
  CAUTION_WATERLOGGING = 'AT_RISK',
  RESTRICTED_SHALLOW = 'LIKELY_FLOODED',
  CLOSED_INUNDATED = 'CLOSED',
}

export type TravelProfile =
  | 'CITIZEN'
  | 'PEDESTRIAN'
  | 'EMERGENCY_RESPONDER'
  | 'AMBULANCE';

export type SensorFreshnessState = 'FRESH' | 'STALE' | 'SUSPECT' | 'MISSING';

export type ObservationInjectionType =
  | 'RAINFALL_INCREASE'
  | 'WATER_LEVEL_INCREASE'
  | 'ROAD_CLOSURE'
  | 'ROAD_LIKELY_FLOODED'
  | 'ROAD_REOPENED'
  | 'CROWD_REPORT'
  | 'SENSOR_FAILURE';

export interface InjectedObservationState {
  extraRainfallMmHr: number;
  sensorWaterLevelBoostM: Record<string, number>;
  sensorFailureState: Record<string, 'STALE' | 'SUSPECT' | 'MISSING'>;
  officialRoadOverrides: Record<string, 'CLOSED' | 'LIKELY_FLOODED' | 'OPEN'>;
  crowdReportsByRoad: Record<string, { count: number; lastReportText: string; timestamp: string }>;
}

export type ActivityEventTypeLabel =
  | 'Prediction changed'
  | 'Sensor updated'
  | 'Road changed'
  | 'Route recalculated'
  | 'Alert drafted'
  | 'Operator approved alert'
  | 'Mode changed'
  | 'Operator lens changed';

export interface ActivityFeedEntry {
  id: string;
  timestamp: string; // e.g. '18:42:10'
  category: 'SENSOR' | 'PREDICTION' | 'ROAD_STATE' | 'ROUTING' | 'CROWD' | 'ALERT' | 'SYSTEM';
  eventTypeLabel?: ActivityEventTypeLabel;
  message: string;
  detail?: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';
  relatedTarget?: {
    type: 'CELL' | 'ROAD' | 'SENSOR' | 'SHELTER' | 'ASSET';
    id: string;
  };
}

export type OperationalStep =
  | 'PREDICT'
  | 'EXPLAIN'
  | 'WARN'
  | 'SIMULATE'
  | 'VERIFY'
  | 'REROUTE'
  | 'EVACUATE'
  | 'LEARN'
  | 'RAIN';

/**
 * Mandatory metadata contract carried by every prediction, map, route, alert,
 * scenario, API response, and dataset in iDhara.
 */
export interface DataProvenance {
  mode: ProductMode;
  scope_id: string;
  generated_at: string;
  data_as_of: string;
  confidence: number; // 0.00 to 1.00
}

export interface DataEnvelope<T> extends DataProvenance {
  payload: T;
  disclaimer: string;
}

export interface FloodDriver {
  factor: string;
  weight: number; // percentage contribution 0-100
  description: string;
  direction: 'aggravating' | 'mitigating';
}

export interface BaseGridCell {
  id: string;
  row: number;
  col: number;
  wardCode: string;
  localityName: string;
  lat: number;
  lng: number;
  elevationM: number; // meters above MSL (Indore ~543m - 562m)
  slopeDeg: number;
  imperviousness: number; // 0.0 - 1.0
  drainageProxyScore: number; // 0.0 (poor/choked nallah) - 1.0 (modern storm drain)
  landUse: 'Dense Historic Core' | 'Commercial Corridor' | 'Riverfront Low-Lying' | 'Mixed Residential' | 'Institutional / Medical' | 'Industrial / Transport';
  historicalFloodCount10Yr: number;
  historicalContext: string;
  populationEstimate: number;
  nearestCriticalAssetIds: string[];
  nearestShelterId: string;
  distanceToRiverM: number;
}

export interface FloodRiskCell extends BaseGridCell, DataProvenance {
  rainfallMmHr: number;
  cumulativeRainfallMm: number;
  predictionInput: CellPredictionInput;
  floodProbability: number; // 0.0 - 1.0
  predictedDepthCm: number;
  observedDepthCm?: number; // available in historical / validation or sensor-adjacent cells
  severity: FloodSeverity;
  warningLevel: WarningLevel;
  warningHysteresis: WarningHysteresisState;
  leadTimeMin: number;
  expectedOnsetLabel: string;
  uncertaintyBand: number; // +/- probability spread
  topDrivers: FloodDriver[];
  dataFreshnessSec: number;
  freshnessLabel: string;
  verifiedBySensorId?: string;
}

export interface IntersectionNode {
  id: string;
  name: string;
  x: number; // 0 - 1000 map canvas coordinate
  y: number; // 0 - 1000 map canvas coordinate
  lat: number;
  lng: number;
  elevationM: number;
}

export interface BaseRoadSegment {
  id: string;
  name: string;
  corridorType: 'Arterial / BRTS' | 'River Bridge' | 'Urban Collector' | 'Historic Underpass / Bazaar';
  fromNodeId: string;
  toNodeId: string;
  lengthKm: number;
  baseTravelTimeMin: number;
  adjacentCellIds: string[];
  lowPointElevationM: number;
  hasUnderpassOrBridge: boolean;
  monitoringSensorId?: string;
}

export interface RoadSegmentState extends BaseRoadSegment, DataProvenance {
  currentState: RoadStatus;
  rawState: RoadStatus;
  isHysteresisHeld: boolean;
  transitionReason: string;
  agreeingObservationsCount: number;
  floodProbability: number;
  estimatedWaterDepthCm: number;
  riskPenaltyMin: number; // explicit routing risk penalty in minutes
  effectiveTravelTimeMin: number; // Infinity if CLOSED
  expiry: string; // ISO timestamp for road state validity
  evidence: string[];
  lastUpdate: string;
  routeImpact: string;
  alternativeSummary: string;
}

export interface SensorNode extends DataProvenance {
  id: string;
  name: string;
  type: 'RAIN_GAUGE' | 'WATER_LEVEL_ULTRASONIC' | 'FLOW_DISCHARGE';
  x: number;
  y: number;
  lat: number;
  lng: number;
  cellId: string;
  currentValue: number;
  unit: string;
  warningThreshold: number;
  criticalThreshold: number;
  status: 'NOMINAL' | 'DRIFTING' | 'STALE' | 'CRITICAL_THRESHOLD';
  freshnessState: SensorFreshnessState; // FRESH | STALE | SUSPECT | MISSING
  lastSeenLabel: string; // e.g. '42 seconds ago', '8 minutes ago'
  diagnosticNote: string; // e.g. 'Normal telemetry', 'abnormal spike'
  lastHeartbeatSecAgo: number;
  batteryPct: number;
  packetSuccessRatePct: number;
}

export interface CriticalAsset {
  id: string;
  name: string;
  category: 'HOSPITAL' | 'FIRE_EMERGENCY' | 'POWER_SUBSTATION' | 'TRANSIT_HUB' | 'SCHOOL_CIVIC';
  x: number;
  y: number;
  lat: number;
  lng: number;
  cellId: string;
  elevationM: number;
  criticalityLevel: 'TIER_1_LIFE_SAFETY' | 'TIER_2_INFRASTRUCTURE' | 'TIER_3_COMMUNITY';
  backupPowerHours: number;
  accessRoadIds: string[];
  contactRole: string;
}

export interface Shelter extends DataProvenance {
  id: string;
  name: string;
  ward: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
  cellId: string;
  nearestNodeId: string;
  locationLabel: string;
  elevationM: number;
  totalCapacity: number;
  baseOccupancy: number;
  assignedEvacuees: number;
  currentOccupancy: number;
  remainingCapacity: number;
  floodRiskProbability: number;
  floodRiskSeverity: FloodSeverity;
  reachable: boolean;
  accessibilityStatus: 'REACHABLE' | 'UNREACHABLE_ROAD_CLOSED' | 'UNREACHABLE_FLOOD_RISK';
  accessibilityLabel: string;
  status: 'READY_OPEN' | 'FILLING' | 'NEAR_CAPACITY' | 'FULL' | 'UNREACHABLE' | 'STANDBY';
  medicalTeamPresent: boolean;
  drinkingWaterLiters: number;
  assignedSourceCellIds: string[];
  accessRoadId: string;
}

export interface DrainageProxyFeature {
  id: string;
  name: string;
  type: 'RIVER_CHANNEL' | 'PRIMARY_NALLAH' | 'STORM_CULVERT_CHOKEPOINT';
  points: Array<{ x: number; y: number }>;
  designCapacityCms: number;
  currentLoadPct: number;
  blockageRiskFactor: number;
  notes: string;
}

export interface ComputedPathDetail {
  label: string;
  nodeIds: string[];
  roadIds: string[];
  roadNames: string[];
  distanceKm: number;
  travelTimeMin: number;
  baseTravelTimeMin: number;
  totalRiskPenaltyMin: number;
  riskScore: number; // 0 to 100 composite risk score
  maxFloodProbability: number;
  confidence: number; // 0.0 to 1.0
  generated_at: string;
  expiry: string;
  statusBanner: 'Recommended under current data';
}

export interface NoFeasibleRouteInfo {
  reason: string;
  blockingRoadIds: string[];
  blockingRoadNames: string[];
  nearestReachableSafePoint: {
    nodeId: string;
    nodeName: string;
    elevationM: number;
    distanceKm: number;
    travelTimeMin: number;
    pathRoadIds: string[];
  } | null;
  nearestAvailableShelter: {
    shelterId: string;
    shelterName: string;
    ward: string;
    elevationM: number;
    availableBerths: number;
    distanceKm: number;
    reachable: boolean;
  } | null;
}

export interface RouteUpdateNotification {
  id: string;
  timestamp: string;
  bannerTitle: 'ROUTE UPDATED' | 'DEMO INCIDENT — ROUTE RECALCULATED' | 'NO FEASIBLE ROUTE';
  reason: string;
  affectedRoadId: string;
  affectedRoadName: string;
  newRoadState: RoadStatus;
  previousRouteRoadIds: string[];
  previousRouteSummary: string;
  previousEtaMin: number;
  newRouteRoadIds: string[];
  newRouteSummary: string;
  newEtaMin: number | null;
  explanation: string;
}

export interface RouteRecommendation extends DataProvenance {
  id: string;
  originNodeId: string;
  originName: string;
  destinationNodeId: string;
  destinationName: string;
  travelProfile: TravelProfile;
  purpose: 'EMERGENCY_AMBULANCE' | 'EVACUATION_BUS' | 'MUNICIPAL_RESPONSE' | 'CITIZEN_TRANSIT';
  expiry: string;
  recommendationStatusLabel: 'Recommended under current data' | 'High-caution corridor under current data';
  feasible: boolean;
  primaryRoute: ComputedPathDetail | null;
  alternativeRoute: ComputedPathDetail | null;
  riskScore: number; // 0 to 100
  noRouteInfo?: NoFeasibleRouteInfo;
  recommendedPathNodeIds: string[];
  recommendedRoadIds: string[];
  recommendedDistanceKm: number;
  recommendedEtaMin: number;
  maxEncounteredFloodProb: number;
  baselineShortestRoadIds: string[];
  baselineDistanceKm: number;
  baselineBlockedRoadNames: string[];
  avoidedHazardCount: number;
  safetyAdvisory: string;
}

export type EvacuationFailureReason =
  | 'No reachable shelter'
  | 'Shelter capacity exceeded'
  | 'Road network disconnected';

export interface EvacuationZoneCriticalFacility {
  id: string;
  name: string;
  category: CriticalAsset['category'];
  priorityLabel: 'Hospital' | 'School / Care Facility' | 'Critical Infrastructure';
}

export interface EvacuationNearestShelterOption {
  shelterId: string;
  shelterName: string;
  distanceKm: number;
  travelTimeMin: number | null;
  reachable: boolean;
  remainingCapacityBefore: number;
}

export interface EvacuationPlanItem extends DataProvenance {
  id: string;
  sourceCellId: string;
  sourceLocality: string;
  wardCode: string;
  floodProbability: number;
  predictedDepthCm: number;
  populationAtRisk: number;
  priorityScore: number;
  priorityTier: 'PRIORITY_1_HOSPITAL' | 'PRIORITY_2_SCHOOL_CARE' | 'PRIORITY_3_VULNERABLE_ZONE';
  priorityReason: string;
  criticalFacilities: EvacuationZoneCriticalFacility[];
  nearestShelters: EvacuationNearestShelterOption[];
  roadAccessibilityStatus: 'ACCESSIBLE' | 'RESTRICTED_HIGH_RISK' | 'DISCONNECTED';
  roadAccessibilityLabel: string;
  originNodeId: string;
  originNodeName: string;
  severity: FloodSeverity;
  assigned: boolean;
  assignmentSummary: string;
  targetShelterId: string;
  targetShelterName: string;
  recommendedRouteId: string;
  routeRoadIds: string[];
  routeRoadNames: string[];
  routeNodeIds: string[];
  routeLabel: 'Recommended evacuation route under current data';
  routeRiskScore: number;
  distanceKm: number;
  estimatedClearanceMin: number;
  busesAssigned: number;
  status: 'EVACUATING' | 'STAGED' | 'ADVISORY_ISSUED' | 'UNASSIGNED_FAILURE' | 'STANDBY';
  failureBanner?: 'NO FEASIBLE EVACUATION PLAN';
  failureReason?: EvacuationFailureReason;
  failureDetail?: string;
  expiry: string;
}

export type AlertLifecycleState =
  | 'DRAFT'
  | 'PENDING REVIEW'
  | 'PUBLISHED'
  | 'UPDATED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REJECTED';

export type AlertAudience =
  | 'Control room'
  | 'Emergency responders'
  | 'Traffic authority'
  | 'Citizen';

export interface AlertComposerDraftInput {
  audiences: AlertAudience[];
  location: string;
  cellId?: string;
  severity: FloodSeverity;
  warningLevel: WarningLevel;
  isEvacuationAlert: boolean;
  recommendedActionBullets: string[];
  expiryMinutes: number;
  confidence: number; // 0.0 to 1.0
  source: string;
  initialLifecycleState: 'DRAFT' | 'PENDING REVIEW' | 'PUBLISHED';
}

export interface AlertItem extends DataProvenance {
  id: string;
  title: string;
  actionHeadline: string; // e.g. "ORANGE — HIGH FLOOD RISK"
  probabilityStatement: string; // e.g. "Ward sector W-24 (Krishnapura) has a 78% estimated flood probability under the current forecast."
  severity: FloodSeverity;
  warningLevel: WarningLevel;
  lifecycleState: AlertLifecycleState;
  requiresHumanConfirmation: boolean; // true for ORANGE/RED and evacuation alerts
  isEvacuationAlert: boolean;
  humanConfirmedBy?: string;
  humanConfirmedAt?: string;
  audiences: AlertAudience[];
  targetAudience: UserRole[];
  location: string;
  affectedLocalities: string[];
  source: string;
  triggerEvidence: string;
  recommendedAction: string;
  recommendedActionBullets: string[];
  expiry: string;
  acknowledged: boolean;
  stepLink: OperationalStep;
}

export interface ScenarioParameters {
  mode: ProductMode;
  stage: DisasterStage;
  rainfallIntensityMmHr: number;
  durationHours: number;
  drainageBlockagePct: number; // e.g., 10% to 75% silt/solid-waste blockage proxy
  upstreamKahnInflowMultiplier: number; // 0.8x to 1.8x
  sensorDropoutCount: number; // 0 to 4 offline sensors to test uncertainty
  timelineHourOffset: number; // -3 to +6 hours
  activeEventPresetId: string;
}

export interface HistoricalEventPreset {
  id: string;
  title: string;
  dateLabel: string;
  mode: ProductMode;
  peakRainfallMmHr: number;
  cumulativeMm: number;
  drainageBlockagePct: number;
  upstreamMultiplier: number;
  summary: string;
  hourlyRainProfile: Array<{
    hourOffset: number;
    label: string;
    mmHr: number;
    stage: DisasterStage;
  }>;
}

export type ValidationOutcomeCategory =
  | 'TRUE_POSITIVE'
  | 'FALSE_NEGATIVE'
  | 'FALSE_POSITIVE'
  | 'TRUE_NEGATIVE';

export interface CellValidationRecord {
  cellId: string;
  wardCode: string;
  localityName: string;
  predictedProbability: number; // 0.0 - 1.0
  predictedFloodLabel: boolean;
  observedFloodLabel: boolean;
  outcomeCategory: ValidationOutcomeCategory;
  predictedDepthCm: number;
  observedDepthCm: number;
  errorCm: number;
  predictedLeadTimeMin: number;
  observedOnsetMin: number;
  leadTimeErrorMin: number;
  predictedSeverity: FloodSeverity;
  observedSeverity: FloodSeverity;
  classificationMatch: 'EXACT_MATCH' | 'UNDER_PREDICTED' | 'OVER_PREDICTED';
  learningNote: string;
  rootCauseDriver: string;
}

export interface CalibrationBin {
  binLabel: string;
  midpointProbPct: number;
  meanPredictedPct: number;
  observedFrequencyPct: number;
  cellCount: number;
  floodedCount: number;
  calibrationGapPct: number;
}

export interface ModelVersionMetadata {
  id: string;
  currentModel: string;
  version: string;
  trainingSnapshot: string;
  validationScore: string;
  releaseDate: string;
  decisionThresholdProb: number;
  drainageProxyBoost: number;
  statusLabel: string;
}

export interface ValidationReport extends DataProvenance {
  eventTitle: string;
  precision: number; // 0-1
  recall: number; // 0-1
  f1Score: number; // 0-1
  prAuc: number; // 0-1
  iouScore: number; // 0-1 (Intersection over Union)
  brierScore: number; // lower is better, e.g., 0.068
  leadTimeErrorMin: number; // mean absolute lead-time error in minutes
  leadTimeBiasMin: number; // signed lead-time error in minutes
  criticalSuccessIndex: number; // CSI 0-1
  probabilityOfDetection: number; // POD 0-1
  falseAlarmRatio: number; // FAR 0-1
  meanAbsoluteDepthErrorCm: number;
  truePositivesCount: number;
  falseNegativesCount: number;
  falsePositivesCount: number;
  trueNegativesCount: number;
  records: CellValidationRecord[];
  falseNegativeRecords: CellValidationRecord[];
  calibrationBins: CalibrationBin[];
  seventyPercentBinExplanation: string;
  hourlyComparisonTimeline: Array<{
    hourOffset: number;
    label: string;
    mmHr: number;
    predictedRiskZones: number;
    observedFloodZones: number;
    roadClosuresCount: number;
    routeChangesCount: number;
    falseNegativesAtStep: number;
    observationsSummary: string;
    roadStatesSummary: string;
    routeChangeSummary: string;
  }>;
  modelVersion: ModelVersionMetadata;
  candidateModelVersion: ModelVersionMetadata;
  learningLoopSteps: Array<{
    stepNumber: number;
    stage:
      | 'Event'
      | 'Ground truth'
      | 'Validation'
      | 'Error analysis'
      | 'Threshold/model improvement';
    title: string;
    summary: string;
    keyArtifact: string;
  }>;
  calibrationRecommendations: Array<{
    id: string;
    parameter: string;
    currentSetting: string;
    proposedAdjustment: string;
    expectedGain: string;
  }>;
}

export interface DataHealthReport extends DataProvenance {
  overallHealthPct: number;
  activeSensorsCount: number;
  totalSensorsCount: number;
  staleFeedsCount: number;
  driftingSensorsCount: number;
  meanLatencySec: number;
  spatialCoveragePct: number;
  subsystems: Array<{
    name: string;
    sourceType: string;
    freshnessSec: number;
    completenessPct: number;
    confidenceImpact: string;
    status: 'HEALTHY' | 'DEGRADED' | 'SIMULATED_SYNTHETIC';
  }>;
}

export interface DisasterStageMeta {
  num: number;
  id: DisasterStage;
  label: string;
  shortLabel: string;
  tag: string;
  subtitle: string;
  focus: string;
}

export const DISASTER_STAGE_INFO: Record<DisasterStage, DisasterStageMeta> = {
  [DisasterStage.EARLY_WARNING]: {
    num: 1,
    id: DisasterStage.EARLY_WARNING,
    label: '1. Early Warning',
    shortLabel: 'Early Warning',
    tag: 'ADVISORY & RUNOFF FORECAST',
    subtitle: 'Pre-storm rainfall forecast, soil saturation index, and catchment runoff accumulation',
    focus: 'Issuing proactive hydrologic advisories prior to water pooling on roads.',
  },
  [DisasterStage.PRE_DISASTER_SCENARIO]: {
    num: 2,
    id: DisasterStage.PRE_DISASTER_SCENARIO,
    label: '2. Pre-Disaster Sim',
    shortLabel: 'Pre-Disaster Sim',
    tag: 'STRESS-TEST & SCENARIOS',
    subtitle: 'Stress-testing city infrastructure against extreme precipitation bursts (+20%, +50%) and culvert blockages',
    focus: 'Stress-testing city infrastructure and corridor safety thresholds before storm onset.',
  },
  [DisasterStage.REAL_TIME_ONGOING]: {
    num: 3,
    id: DisasterStage.REAL_TIME_ONGOING,
    label: '3. Real-Time Ongoing',
    shortLabel: 'Real-Time Ongoing',
    tag: 'LIVE SENSOR TELEMETRY & DISPATCH',
    subtitle: 'Live ultrasonic gauge surge ingestion, road inundation, and emergency vehicle rerouting',
    focus: 'Monitoring live sensor telemetry and routing emergency response around flooded roads.',
  },
  [DisasterStage.POST_DISASTER_LEARNING]: {
    num: 4,
    id: DisasterStage.POST_DISASTER_LEARNING,
    label: '4. Post-Disaster Learn',
    shortLabel: 'Post-Disaster Learn',
    tag: 'EVENT REPLAY & VALIDATION',
    subtitle: 'Historical monsoon archive replay, false-negative verification, and model calibration',
    focus: 'Replaying past cloudbursts to audit prediction accuracy and calibrate models.',
  },
};


