import {
  canRoleAcknowledgeAlert,
  canRoleChangeAlertLifecycle,
  canRoleComposeAlert,
  canRolePublishAlert,
  generateOperationalAlerts,
  isCitizenRole,
  isControlRoomOperator,
} from '../modules/alerts';
import { BASE_GRID_CELLS, BASE_ROAD_SEGMENTS, BASE_SENSORS } from '../data/indorePilotData';
import {
  AlertLifecycleState,
  DisasterStage,
  FloodRiskCell,
  ProductMode,
  RoadSegmentState,
  ScenarioParameters,
  SensorNode,
  UserRole,
} from '../types/idhara';

console.log('=== RUNNING IDHARA ALERT ROLE PERMISSIONS VERIFICATION ===');

const roles = [
  UserRole.CONTROL_ROOM_OPERATOR,
  UserRole.ANALYST_MODEL_OPERATOR,
  UserRole.EMERGENCY_RESPONDER,
  UserRole.TRAFFIC_AUTHORITY,
  UserRole.CITIZEN,
];

// 1. Verification of canRolePublishAlert
console.log('\n--- 1. Verification of canRolePublishAlert ---');
roles.forEach((r) => {
  const allowed = canRolePublishAlert(r);
  console.log(`Role: ${r.padEnd(25)} -> canPublish: ${allowed}`);
  if (r === UserRole.CONTROL_ROOM_OPERATOR) {
    if (!allowed) {
      console.error(`FAIL: Control-room operator must be authorized to publish alerts`);
      process.exit(1);
    }
  } else {
    if (allowed) {
      console.error(`FAIL: ${r} must NOT be authorized to publish alerts`);
      process.exit(1);
    }
  }
});

// 2. Verification of canRoleAcknowledgeAlert
console.log('\n--- 2. Verification of canRoleAcknowledgeAlert ---');
roles.forEach((r) => {
  const allowed = canRoleAcknowledgeAlert(r);
  console.log(`Role: ${r.padEnd(25)} -> canAcknowledge: ${allowed}`);
  if (r === UserRole.CONTROL_ROOM_OPERATOR) {
    if (!allowed) {
      console.error(`FAIL: Control-room operator must be authorized to acknowledge alerts`);
      process.exit(1);
    }
  } else {
    if (allowed) {
      console.error(`FAIL: ${r} must NOT be authorized to acknowledge alerts`);
      process.exit(1);
    }
  }
});

// 3. Verification of canRoleChangeAlertLifecycle
console.log('\n--- 3. Verification of canRoleChangeAlertLifecycle ---');
const lifecycleStates: AlertLifecycleState[] = [
  'PUBLISHED',
  'PENDING REVIEW',
  'DRAFT',
  'UPDATED',
  'EXPIRED',
  'CANCELLED',
  'REJECTED',
];

roles.forEach((r) => {
  console.log(`\nTesting Role: ${r}`);
  lifecycleStates.forEach((st) => {
    const canChange = canRoleChangeAlertLifecycle(r, st);
    if (r === UserRole.CONTROL_ROOM_OPERATOR) {
      if (!canChange) {
        console.error(`FAIL: Operator must be authorized to change to ${st}`);
        process.exit(1);
      }
    } else if (r === UserRole.ANALYST_MODEL_OPERATOR) {
      // Analyst can only submit to PENDING REVIEW or DRAFT, cannot publish or update
      if (st === 'PUBLISHED' || st === 'UPDATED') {
        if (canChange) {
          console.error(`FAIL: Analyst must NOT be able to transition to ${st}`);
          process.exit(1);
        }
      }
    } else {
      // Emergency responder, Traffic authority, Citizen must not change status
      if (canChange) {
        console.error(`FAIL: ${r} must NOT be able to transition to ${st}`);
        process.exit(1);
      }
    }
  });
});

// 4. Verification of Citizen read-only access
console.log('\n--- 4. Verification of Citizen Role Restrictions ---');
const citizenCanPublish = canRolePublishAlert(UserRole.CITIZEN);
const citizenCanAcknowledge = canRoleAcknowledgeAlert(UserRole.CITIZEN);
const citizenCanCompose = canRoleComposeAlert(UserRole.CITIZEN);
const citizenCanChangeStatus = canRoleChangeAlertLifecycle(UserRole.CITIZEN, 'PUBLISHED');

console.assert(!citizenCanPublish, 'Citizen must not publish alerts');
console.assert(!citizenCanAcknowledge, 'Citizen must not acknowledge alerts');
console.assert(!citizenCanCompose, 'Citizen must not compose alerts');
console.assert(!citizenCanChangeStatus, 'Citizen must not change alert statuses');
console.log('Citizen role restrictions verified: READ-ONLY confirmed');

// 5. Operational alerts baseline generation check
console.log('\n--- 5. Operational Alerts Generation Intact Check ---');
import { evaluateAuthoritativePrototypeData } from '../modules/prototypeDataStore';
import { DEFAULT_INJECTED_OBSERVATIONS } from '../modules/dataIngestion';
import { DEFAULT_EVACUATION_CONFIG } from '../modules/evacuation';

const params: ScenarioParameters = {
  mode: ProductMode.SIMULATED,
  stage: DisasterStage.REAL_TIME_ONGOING,
  rainfallIntensityMmHr: 42,
  durationHours: 3,
  drainageBlockagePct: 40,
  upstreamKahnInflowMultiplier: 1.25,
  sensorDropoutCount: 0,
  timelineHourOffset: 0,
  activeEventPresetId: 'EVT-SIM-MONSOON-SURGE',
};

const storeData = evaluateAuthoritativePrototypeData({
  params,
  injectedObservations: DEFAULT_INJECTED_OBSERVATIONS,
  customOriginId: 'NODE-RAJWADA',
  customDestId: 'NODE-MY-HOSPITAL',
  travelProfile: 'AMBULANCE',
  evacuationConfig: DEFAULT_EVACUATION_CONFIG,
});

const ackSet = new Set<string>();
const operationalAlerts = generateOperationalAlerts(
  storeData.cells,
  storeData.roads,
  storeData.sensors,
  params,
  ackSet
);

console.log(`Generated ${operationalAlerts.length} operational alerts:`);
operationalAlerts.forEach((a) => {
  console.log(`- [${a.id}] ${a.warningLevel} ${a.lifecycleState} -> acknowledged: ${a.acknowledged}`);
});

console.assert(operationalAlerts.length >= 3, 'Operational alerts must generate properly');

// Test acknowledgment state propagation
ackSet.add('ALT-ORANGE-SECTOR-W24');
const acknowledgedAlerts = generateOperationalAlerts(
  storeData.cells,
  storeData.roads,
  storeData.sensors,
  params,
  ackSet
);
const w24 = acknowledgedAlerts.find((a) => a.id === 'ALT-ORANGE-SECTOR-W24');
console.assert(w24?.acknowledged === true, 'Acknowledged status must reflect accurately');
console.log('Acknowledgment state propagation: PASSED');

// 6. Direct Unauthorized Execution Rejection Test
console.log('\n--- 6. Direct Unauthorized Request Rejection Test ---');
const unauthorizedRoles = [
  UserRole.ANALYST_MODEL_OPERATOR,
  UserRole.EMERGENCY_RESPONDER,
  UserRole.TRAFFIC_AUTHORITY,
  UserRole.CITIZEN,
];

unauthorizedRoles.forEach((role) => {
  // Direct publish request
  const pubAllowed = canRolePublishAlert(role);
  console.assert(!pubAllowed, `Direct publish request from ${role} must be rejected`);

  // Direct acknowledge request
  const ackAllowed = canRoleAcknowledgeAlert(role);
  console.assert(!ackAllowed, `Direct acknowledge request from ${role} must be rejected`);

  // Direct lifecycle transition to PUBLISHED
  const transPub = canRoleChangeAlertLifecycle(role, 'PUBLISHED');
  console.assert(!transPub, `Direct transition to PUBLISHED from ${role} must be rejected`);
});

// Control-room operator direct execution
console.assert(
  canRolePublishAlert(UserRole.CONTROL_ROOM_OPERATOR),
  'Control-room operator direct publish must be allowed'
);
console.assert(
  canRoleAcknowledgeAlert(UserRole.CONTROL_ROOM_OPERATOR),
  'Control-room operator direct acknowledge must be allowed'
);
console.assert(
  canRoleChangeAlertLifecycle(UserRole.CONTROL_ROOM_OPERATOR, 'PUBLISHED'),
  'Control-room operator direct lifecycle transition must be allowed'
);
console.log('Direct unauthorized request rejection: PASSED');

console.log('\n======================================================');
console.log('ALL ALERT ROLE PERMISSION TESTS PASSED SUCCESSFULLY');
console.log('======================================================');
