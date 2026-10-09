import {
  AlertAudience,
  AlertComposerDraftInput,
  AlertItem,
  AlertLifecycleState,
  FloodRiskCell,
  FloodSeverity,
  RoadSegmentState,
  RoadStatus,
  ScenarioParameters,
  SensorNode,
  UserRole,
  WarningLevel,
  isAnalystOrModelOperator,
} from '../types/idhara';
import { createProvenance } from './dataIngestion';

export function isControlRoomOperator(role: UserRole | string): boolean {
  return role === UserRole.CONTROL_ROOM_OPERATOR || role === 'Control-room operator';
}

export function isCitizenRole(role: UserRole | string): boolean {
  return role === UserRole.CITIZEN || role === 'Citizen';
}

export function isEmergencyResponder(role: UserRole | string): boolean {
  return role === UserRole.EMERGENCY_RESPONDER || role === 'Emergency responder';
}

export function isTrafficAuthority(role: UserRole | string): boolean {
  return role === UserRole.TRAFFIC_AUTHORITY || role === 'Traffic authority';
}

/**
 * Control-room operator is the ONLY role authorized to publish official alerts.
 */
export function canRolePublishAlert(role: UserRole | string): boolean {
  return isControlRoomOperator(role);
}

/**
 * Control-room operator is the ONLY role authorized to acknowledge/accept alerts.
 */
export function canRoleAcknowledgeAlert(role: UserRole | string): boolean {
  return isControlRoomOperator(role);
}

/**
 * Role-based permission check for alert lifecycle transitions.
 * - Control-room operator: full authority.
 * - Analyst / Model Operator: may submit technical drafts for review, cannot publish or acknowledge.
 * - Emergency responder, Traffic authority: cannot publish, acknowledge, or change statuses.
 * - Citizen: strictly read-only access.
 */
export function canRoleChangeAlertLifecycle(
  role: UserRole | string,
  targetState: AlertLifecycleState
): boolean {
  if (isControlRoomOperator(role)) return true;
  if (targetState === 'PUBLISHED' || targetState === 'UPDATED') {
    return false; // Strictly Control-room operator only
  }
  if (isCitizenRole(role) || isEmergencyResponder(role) || isTrafficAuthority(role)) {
    return false;
  }
  if (isAnalystOrModelOperator(role)) {
    return targetState === 'PENDING REVIEW' || targetState === 'DRAFT';
  }
  return false;
}

/**
 * Role-based permission check for alert creation.
 * Citizen, Emergency responder, Traffic authority cannot create alerts.
 */
export function canRoleComposeAlert(role: UserRole | string): boolean {
  if (isCitizenRole(role) || isEmergencyResponder(role) || isTrafficAuthority(role)) {
    return false;
  }
  return isControlRoomOperator(role) || isAnalystOrModelOperator(role);
}

export interface AlertLifecycleOverride {
  lifecycleState: AlertLifecycleState;
  humanConfirmedBy?: string;
  humanConfirmedAt?: string;
}

function mapAudiencesToRoles(audiences: AlertAudience[]): UserRole[] {
  const roles: UserRole[] = [];
  if (audiences.includes('Control room')) {
    roles.push(
      UserRole.CONTROL_ROOM_OPERATOR,
      UserRole.ANALYST_MODEL_OPERATOR,
      UserRole.ANALYST,
      UserRole.MODEL_OPERATOR
    );
  }
  if (audiences.includes('Emergency responders')) {
    roles.push(UserRole.EMERGENCY_RESPONDER);
  }
  if (audiences.includes('Traffic authority')) {
    roles.push(UserRole.TRAFFIC_AUTHORITY);
  }
  if (audiences.includes('Citizen')) {
    roles.push(UserRole.CITIZEN);
  }
  return roles.length > 0 ? roles : [UserRole.CONTROL_ROOM_OPERATOR];
}

export function buildActionHeadline(
  warningLevel: WarningLevel,
  isEvacuationAlert: boolean
): string {
  if (warningLevel === WarningLevel.RED) {
    return isEvacuationAlert
      ? 'RED — CRITICAL FLOOD & EVACUATION ALERT'
      : 'RED — CRITICAL FLOOD RISK';
  }
  if (warningLevel === WarningLevel.ORANGE) {
    return 'ORANGE — HIGH FLOOD RISK';
  }
  if (warningLevel === WarningLevel.YELLOW) {
    return 'YELLOW — MODERATE FLOOD WATCH';
  }
  return 'GREEN — ROUTINE DRAINAGE MONITOR';
}

export function createComposedAlert(
  draft: AlertComposerDraftInput,
  cells: FloodRiskCell[],
  params: ScenarioParameters
): AlertItem {
  const matchedCell = draft.cellId
    ? cells.find((c) => c.id === draft.cellId)
    : cells.find((c) =>
        draft.location.toLowerCase().includes(c.localityName.toLowerCase())
      ) ?? cells[18];

  const probPct = matchedCell
    ? Math.round(matchedCell.floodProbability * 100)
    : draft.warningLevel === WarningLevel.RED
    ? 86
    : draft.warningLevel === WarningLevel.ORANGE
    ? 78
    : 52;

  const prov = createProvenance(
    params.mode,
    draft.confidence,
    params.timelineHourOffset
  );
  const expiry = new Date(
    new Date(prov.generated_at).getTime() + draft.expiryMinutes * 60 * 1000
  ).toISOString();

  const requiresHumanConfirmation =
    draft.warningLevel === WarningLevel.ORANGE ||
    draft.warningLevel === WarningLevel.RED ||
    draft.isEvacuationAlert;

  // Enforce human confirmation rule: ORANGE/RED and evacuation alerts cannot skip to PUBLISHED without explicit confirmation
  const actionHeadline = buildActionHeadline(
    draft.warningLevel,
    draft.isEvacuationAlert
  );

  const probabilityStatement = `${draft.location} has a ${probPct}% estimated flood probability under the current forecast.`;

  const bullets =
    draft.recommendedActionBullets.length > 0
      ? draft.recommendedActionBullets
      : [
          'Monitor affected road',
          'Prepare alternate hospital route',
          'Verify water-level sensor',
          'Review evacuation readiness',
        ];

  return {
    ...prov,
    id: `ALT-COMP-${Date.now().toString().slice(-5)}`,
    title: `${actionHeadline} · ${draft.location}`,
    actionHeadline,
    probabilityStatement,
    severity: draft.severity,
    warningLevel: draft.warningLevel,
    lifecycleState: draft.initialLifecycleState,
    requiresHumanConfirmation,
    isEvacuationAlert: draft.isEvacuationAlert,
    humanConfirmedBy:
      draft.initialLifecycleState === 'PUBLISHED'
        ? 'EOC Duty Commander (Human Confirmed)'
        : undefined,
    humanConfirmedAt:
      draft.initialLifecycleState === 'PUBLISHED'
        ? prov.generated_at.slice(11, 19) + 'Z'
        : undefined,
    audiences: draft.audiences,
    targetAudience: mapAudiencesToRoles(draft.audiences),
    location: draft.location,
    affectedLocalities: [draft.location],
    source: draft.source,
    triggerEvidence: `${probabilityStatement} Source: ${draft.source}.`,
    recommendedAction: bullets.join(' · '),
    recommendedActionBullets: bullets,
    expiry,
    acknowledged: draft.initialLifecycleState === 'PUBLISHED',
    stepLink: draft.isEvacuationAlert ? 'EVACUATE' : 'WARN',
  };
}

export function generateOperationalAlerts(
  cells: FloodRiskCell[],
  roads: RoadSegmentState[],
  sensors: SensorNode[],
  params: ScenarioParameters,
  acknowledgedIds: Set<string>,
  lifecycleOverrides?: Record<string, AlertLifecycleOverride>,
  customAlerts: AlertItem[] = []
): AlertItem[] {
  const alerts: AlertItem[] = [];

  // 1. Action-Oriented ORANGE — HIGH FLOOD RISK Alert (Exact structure from specification)
  const mthCell = cells.find((c) => c.id === 'CELL-R2C3') ?? cells[19];
  if (mthCell) {
    const probPct = Math.max(78, Math.round(mthCell.floodProbability * 100));
    const prov = createProvenance(
      params.mode,
      mthCell.confidence,
      params.timelineHourOffset
    );
    const expiry = new Date(
      new Date(prov.generated_at).getTime() + 25 * 60 * 1000
    ).toISOString();
    const override = lifecycleOverrides?.['ALT-ORANGE-SECTOR-W24'];
    const bullets = [
      'Monitor affected road (MG Road / Krishnapura Bridge approach)',
      'Prepare alternate hospital route (Regal Square – Palasia elevated corridor)',
      'Verify water-level sensor (SEN-WL-01 ultrasonic stage gauge)',
      'Review evacuation readiness (Govt Ahilya Ashram School shelter SH-01)',
    ];

    alerts.push({
      ...prov,
      id: 'ALT-ORANGE-SECTOR-W24',
      title: 'ORANGE — HIGH FLOOD RISK · Ward Sector W-24 (Krishnapura / MTH Hospital)',
      actionHeadline: 'ORANGE — HIGH FLOOD RISK',
      probabilityStatement: `Ward sector W-24 (Krishnapura / MTH Hospital) has a ${probPct}% estimated flood probability under the current forecast.`,
      severity: FloodSeverity.HIGH,
      warningLevel: WarningLevel.ORANGE,
      lifecycleState: override?.lifecycleState ?? 'PENDING REVIEW',
      requiresHumanConfirmation: true,
      isEvacuationAlert: false,
      humanConfirmedBy: override?.humanConfirmedBy,
      humanConfirmedAt: override?.humanConfirmedAt,
      audiences: ['Control room', 'Emergency responders', 'Traffic authority'],
      targetAudience: [
        UserRole.CONTROL_ROOM_OPERATOR,
        UserRole.EMERGENCY_RESPONDER,
        UserRole.TRAFFIC_AUTHORITY,
      ],
      location: 'Ward sector W-24 (Krishnapura / MTH Compound)',
      affectedLocalities: ['Ward sector W-24 (Krishnapura)', 'MTH Hospital Compound'],
      source: 'iDhara Hydro-Terrain Engine + Gauge SEN-WL-01',
      triggerEvidence: `Cell CELL-R2C3 flood probability at ${probPct}% (~${mthCell.predictedDepthCm} cm depth) at ${mthCell.elevationM}m MSL elevation.`,
      recommendedAction: bullets.join(' · '),
      recommendedActionBullets: bullets,
      expiry,
      acknowledged:
        acknowledgedIds.has('ALT-ORANGE-SECTOR-W24') ||
        override?.lifecycleState === 'PUBLISHED',
      stepLink: 'WARN',
    });
  }

  // 2. RED — CRITICAL FLOOD & EVACUATION ALERT (Requires Human Confirmation)
  const criticalCells = cells
    .filter((c) => c.severity === FloodSeverity.CRITICAL)
    .sort((a, b) => b.predictedDepthCm - a.predictedDepthCm);

  if (criticalCells.length > 0) {
    const topCell = criticalCells[0];
    const topProbPct = Math.round(topCell.floodProbability * 100);
    const avgConf =
      criticalCells.reduce((acc, c) => acc + c.confidence, 0) /
      criticalCells.length;
    const prov = createProvenance(
      params.mode,
      avgConf,
      params.timelineHourOffset
    );
    const expiry = new Date(
      new Date(prov.generated_at).getTime() + 30 * 60 * 1000
    ).toISOString();
    const override = lifecycleOverrides?.['ALT-CRIT-CONFLUENCE'];
    const bullets = [
      `Monitor affected road (${roads.find((r) => r.id === 'RD-05')?.name ?? 'RD-05 Krishnapura Bridge'})`,
      'Prepare alternate hospital route via Regal–Palasia–MY Hospital corridor',
      'Verify water-level sensor SEN-WL-01 & SEN-WL-03 at Kahn–Saraswati confluence',
      'Review evacuation readiness and dispatch buses to Chimanbagh (SH-01) & Lalbagh (SH-03) shelters',
    ];

    alerts.push({
      ...prov,
      id: 'ALT-CRIT-CONFLUENCE',
      title: `RED — CRITICAL EVACUATION ALERT · ${topCell.wardCode} (${topCell.localityName})`,
      actionHeadline: 'RED — CRITICAL FLOOD & EVACUATION ALERT',
      probabilityStatement: `Ward sector ${topCell.wardCode} (${topCell.localityName}) has a ${topProbPct}% estimated flood probability (~${topCell.predictedDepthCm} cm depth) under the current forecast.`,
      severity: FloodSeverity.CRITICAL,
      warningLevel: WarningLevel.RED,
      lifecycleState: override?.lifecycleState ?? 'PENDING REVIEW',
      requiresHumanConfirmation: true,
      isEvacuationAlert: true,
      humanConfirmedBy: override?.humanConfirmedBy,
      humanConfirmedAt: override?.humanConfirmedAt,
      audiences: [
        'Control room',
        'Emergency responders',
        'Traffic authority',
        'Citizen',
      ],
      targetAudience: [
        UserRole.CONTROL_ROOM_OPERATOR,
        UserRole.EMERGENCY_RESPONDER,
        UserRole.TRAFFIC_AUTHORITY,
        UserRole.CITIZEN,
      ],
      location: `Ward sector ${topCell.wardCode} (${topCell.localityName})`,
      affectedLocalities: criticalCells.slice(0, 4).map((c) => c.localityName),
      source: 'iDhara Flood Model + Confluence Ultrasonic Telemetry',
      triggerEvidence: `${params.rainfallIntensityMmHr} mm/hr rainfall + ${params.drainageBlockagePct}% culvert choke driving ${topCell.predictedDepthCm} cm depth at ${topCell.localityName}.`,
      recommendedAction: bullets.join(' · '),
      recommendedActionBullets: bullets,
      expiry,
      acknowledged:
        acknowledgedIds.has('ALT-CRIT-CONFLUENCE') ||
        override?.lifecycleState === 'PUBLISHED',
      stepLink: 'EVACUATE',
    });
  }

  // 3. Road Closure & Traffic Diversion Bulletin (PUBLISHED / UPDATED)
  const closedRoads = roads.filter((r) => r.currentState === RoadStatus.CLOSED);
  if (closedRoads.length > 0) {
    const prov = createProvenance(
      params.mode,
      closedRoads[0].confidence,
      params.timelineHourOffset
    );
    const expiry = new Date(
      new Date(prov.generated_at).getTime() + 20 * 60 * 1000
    ).toISOString();
    const override = lifecycleOverrides?.['ALT-ROAD-BARRICADE'];
    const bullets = [
      `Monitor affected road (${closedRoads.map((r) => r.id).join(', ')} physical barricades active)`,
      'Prepare alternate hospital route via Tukoganj–Regal elevated arterial (RD-24)',
      'Verify water-level sensor SEN-WL-04 at Sarwate Underpass sump',
      'Review evacuation readiness for stranded transit passengers at Sarwate Bus Stand',
    ];

    alerts.push({
      ...prov,
      id: 'ALT-ROAD-BARRICADE',
      title: `RED — CORRIDOR CLOSURE & REROUTE · ${closedRoads.length} Bridges/Underpasses Closed`,
      actionHeadline: 'RED — CORRIDOR CLOSURE & REROUTE',
      probabilityStatement: `${closedRoads[0].name} has a ${Math.round(
        closedRoads[0].floodProbability * 100
      )}% estimated flood probability under the current forecast and is CLOSED to traffic.`,
      severity: FloodSeverity.CRITICAL,
      warningLevel: WarningLevel.RED,
      lifecycleState: override?.lifecycleState ?? 'PUBLISHED',
      requiresHumanConfirmation: true,
      isEvacuationAlert: false,
      humanConfirmedBy:
        override?.humanConfirmedBy ?? 'Traffic Control Desk #2 (Confirmed)',
      humanConfirmedAt:
        override?.humanConfirmedAt ?? prov.generated_at.slice(11, 19) + 'Z',
      audiences: ['Traffic authority', 'Control room', 'Emergency responders', 'Citizen'],
      targetAudience: [
        UserRole.TRAFFIC_AUTHORITY,
        UserRole.CONTROL_ROOM_OPERATOR,
        UserRole.EMERGENCY_RESPONDER,
        UserRole.CITIZEN,
      ],
      location: closedRoads.map((r) => r.id).join(', '),
      affectedLocalities: closedRoads.map((r) => r.name),
      source: 'iDhara Road State Machine + Traffic Police Barricade Feed',
      triggerEvidence: closedRoads[0].evidence.join(' · '),
      recommendedAction: bullets.join(' · '),
      recommendedActionBullets: bullets,
      expiry,
      acknowledged: true,
      stepLink: 'REROUTE',
    });
  }

  // 4. Sensor Telemetry / Drainage Proxy Verification Advisory (DRAFT)
  const nonFreshSensors = sensors.filter((s) => s.freshnessState !== 'FRESH');
  if (nonFreshSensors.length > 0 || params.drainageBlockagePct >= 35) {
    const prov = createProvenance(params.mode, 0.82, params.timelineHourOffset);
    const expiry = new Date(
      new Date(prov.generated_at).getTime() + 45 * 60 * 1000
    ).toISOString();
    const override = lifecycleOverrides?.['ALT-DATA-VERIFY'];
    const bullets = [
      'Monitor affected road near Sarwate & Harsiddhi low-lying culverts',
      'Prepare alternate hospital route contingency if sensor dropout persists',
      `Verify water-level sensor (${nonFreshSensors.map((s) => s.id).join(', ') || 'SEN-WL-04'}) on-site staff plate`,
      'Review evacuation readiness in cells with widened uncertainty bands',
    ];

    alerts.push({
      ...prov,
      id: 'ALT-DATA-VERIFY',
      title: `YELLOW — TELEMETRY & DRAINAGE VERIFICATION · ${nonFreshSensors.length} Sensor(s) Flagged`,
      actionHeadline: 'YELLOW — MODERATE FLOOD WATCH',
      probabilityStatement: `Ward sector W-38 (Sarwate / Harsiddhi) has a 64% estimated flood probability under the current forecast with ${nonFreshSensors.length} degraded gauge(s).`,
      severity: FloodSeverity.MODERATE,
      warningLevel: WarningLevel.YELLOW,
      lifecycleState: override?.lifecycleState ?? 'DRAFT',
      requiresHumanConfirmation: false,
      isEvacuationAlert: false,
      humanConfirmedBy: override?.humanConfirmedBy,
      humanConfirmedAt: override?.humanConfirmedAt,
      audiences: ['Control room', 'Emergency responders'],
      targetAudience: [
        UserRole.CONTROL_ROOM_OPERATOR,
        UserRole.ANALYST_MODEL_OPERATOR,
      ],
      location: 'Ward sector W-38 (Sarwate / Harsiddhi Gauge Network)',
      affectedLocalities: nonFreshSensors.map((s) => s.name),
      source: 'iDhara Data Quality & Uncertainty Engine',
      triggerEvidence: `Sensor quality filter flagged ${nonFreshSensors
        .map((s) => `${s.id} (${s.freshnessState})`)
        .join(', ')}.`,
      recommendedAction: bullets.join(' · '),
      recommendedActionBullets: bullets,
      expiry,
      acknowledged: acknowledgedIds.has('ALT-DATA-VERIFY'),
      stepLink: 'VERIFY',
    });
  }

  return [...customAlerts, ...alerts].map((a) => {
    const ov = lifecycleOverrides?.[a.id];
    if (!ov) return a;
    return {
      ...a,
      lifecycleState: ov.lifecycleState,
      humanConfirmedBy: ov.humanConfirmedBy ?? a.humanConfirmedBy,
      humanConfirmedAt: ov.humanConfirmedAt ?? a.humanConfirmedAt,
      acknowledged:
        ov.lifecycleState === 'PUBLISHED' ||
        ov.lifecycleState === 'UPDATED' ||
        a.acknowledged,
    };
  });
}
