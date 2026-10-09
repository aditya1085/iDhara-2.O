import {
  DataHealthReport,
  ScenarioParameters,
  SensorNode,
} from '../types/idhara';
import { createProvenance } from './dataIngestion';
import { computeSystemConfidence } from './uncertainty';

/**
 * Evaluates telemetry completeness, sensor freshness, latency, and subsystem readiness.
 */
export function evaluateDataHealth(
  sensors: SensorNode[],
  params: ScenarioParameters
): DataHealthReport {
  const sysConf = computeSystemConfidence(sensors, params);
  const prov = createProvenance(params.mode, sysConf, params.timelineHourOffset);

  const staleSensors = sensors.filter((s) => s.status === 'STALE');
  const driftingSensors = sensors.filter((s) => s.status === 'DRIFTING');
  const activeCount = sensors.length - staleSensors.length;

  const meanLatencySec = Math.round(
    sensors.reduce((acc, s) => acc + (s.status === 'STALE' ? 180 : s.lastHeartbeatSecAgo), 0) /
      sensors.length
  );

  const overallHealthPct = Math.round(
    (activeCount / sensors.length) * 100 - driftingSensors.length * 4
  );

  const spatialCoveragePct = Math.round((activeCount / sensors.length) * 94);

  return {
    ...prov,
    overallHealthPct: Math.max(40, Math.min(100, overallHealthPct)),
    activeSensorsCount: activeCount,
    totalSensorsCount: sensors.length,
    staleFeedsCount: staleSensors.length,
    driftingSensorsCount: driftingSensors.length,
    meanLatencySec,
    spatialCoveragePct,
    subsystems: [
      {
        name: 'Ultrasonic River & Underpass Level Network (6 Nodes)',
        sourceType: 'IoT Ultrasonic Telemetry Proxy',
        freshnessSec: 24,
        completenessPct: staleSensors.length > 0 ? Math.round((activeCount / sensors.length) * 100) : 99.2,
        confidenceImpact:
          staleSensors.length > 0
            ? `-${staleSensors.length * 6}% confidence in unmonitored bridge cells`
            : '+9% local cell verification boost',
        status: staleSensors.length > 1 ? 'DEGRADED' : 'HEALTHY',
      },
      {
        name: 'Automated Pluviometer Rain Gauge Array (4 Nodes)',
        sourceType: 'Tipping Bucket AWS Proxy',
        freshnessSec: 32,
        completenessPct: 98.8,
        confidenceImpact: 'Primary forcing for 64-cell catchment runoff model',
        status: staleSensors.length > 2 ? 'DEGRADED' : 'HEALTHY',
      },
      {
        name: 'Indore 5×5 km DEM & Drainage Culvert Proxy Layer',
        sourceType: 'Static LiDAR Proxy + Municipal Blockage Factor',
        freshnessSec: 0,
        completenessPct: 100,
        confidenceImpact: `Calibrated for ${params.drainageBlockagePct}% solid-waste/silt choke factor`,
        status: 'SIMULATED_SYNTHETIC',
      },
      {
        name: 'AICTSL Road State & Traffic Corridor Feed',
        sourceType: 'Synthetic Road-Sensor Fusion',
        freshnessSec: 45,
        completenessPct: 96.5,
        confidenceImpact: 'Feeds dynamic Dijkstra/A* emergency route solver',
        status: params.drainageBlockagePct > 55 ? 'DEGRADED' : 'SIMULATED_SYNTHETIC',
      },
    ],
  };
}
