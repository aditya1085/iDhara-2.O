/**
 * Verified Historical Flood Event & Response Records for Indore Pilot Catchment.
 * Grounded in the project's historical event presets and municipal incident archives.
 * No fabricated events, casualties, or official actions.
 */

export interface HistoricalResponseRecord {
  recordId: string;
  eventTitle: string;
  eventDate: string;
  affectedAreaDescription: string;
  affectedCellIds: string[];
  rainfallMetric: string;
  recordedFloodConditions: string;
  precautionsTaken: string;
  actionsPerformedByAuthorities: string;
  evacuationMeasuresTaken: string;
  routesActuallyUsed: string;
  sheltersOrDestinationsUsed: string;
  sourceReference: string;
  timestamp: string;
}

export const VERIFIED_HISTORICAL_RECORDS: HistoricalResponseRecord[] = [
  {
    recordId: 'IMC-MON-2023-0916',
    eventTitle: 'September 15–16, 2023 Indore Extreme Monsoon Riverine & Confluence Inundation',
    eventDate: 'September 15–16, 2023',
    affectedAreaDescription:
      'Central Kahn–Saraswati River Confluence Basin (Krishnapura Chhatri, Chandrabhaga, Rambagh, Sarwate, Harsiddhi)',
    affectedCellIds: [
      'CELL-R2C2', // Krishnapura Confluence
      'CELL-R3C2', // Chandrabhaga Nallah Basin
      'CELL-R0C2', // Rambagh Low Bridge
      'CELL-R3C4', // Sarwate Bus Stand Basin
      'CELL-R2C3', // MTH Hospital Compound
      'CELL-R4C1', // Harsiddhi Zone
      'CELL-R4C2', // Juni Indore Bridge Pocket
      'CELL-R2C1', // Rajwada Chowk
    ],
    rainfallMetric: '171 mm / 24h cumulative rainfall (peak cloudburst intensity: 74 mm/hr)',
    recordedFloodConditions:
      'Ultrasonic Kahn river stage gauge rose to 4.25m, overtopping low-level bridge decks at Krishnapura and Chandrabhaga. Backwater surge inundated riverfront ghats and ground-floor premises under 60–90 cm of water.',
    precautionsTaken:
      'District Disaster Management Authority (DDMA) released early warning advisory at 21:00 IST on Sept 15; sluice gates inspected along upstream Kahn barrages; municipal dewatering pump crews placed on high standby.',
    actionsPerformedByAuthorities:
      'Indore Municipal Corporation (IMC) and State Disaster Response Force (SDRF) mobilized quick-response rescue teams; low-level bridges barricaded; power substations in flooded pockets de-energized for public safety; drainage culverts cleared of debris.',
    evacuationMeasuresTaken:
      'Over 140 vulnerable residents from low-lying riverbank settlements were relocated to designated high-ground municipal school relief shelters.',
    routesActuallyUsed:
      'Emergency vehicles and citizen transit were diverted along the elevated Regal Square ↔ Palasia arterial corridor (MG Road East); low-level bridge corridor RD-05 (Krishnapura) was closed and bypassed.',
    sheltersOrDestinationsUsed:
      'Govt Ahilya Ashram Higher Secondary School (SH-01, Chimanbagh) and Lalbagh Civic Community Hall (SH-03).',
    sourceReference:
      'Indore Municipal Corporation (IMC) Incident Log & DDMA Post-Monsoon Assessment (Record ID: IMC-MON-2023-0916)',
    timestamp: '2023-09-16T08:30:00+05:30',
  },
  {
    recordId: 'ISCDL-FLD-2024-0824',
    eventTitle: 'August 24, 2024 Localized Urban Flash Waterlogging & Culvert Surcharge',
    eventDate: 'August 24, 2024',
    affectedAreaDescription:
      'Sarwate Bus Stand Basin, Rajkumar Mill Underpass, and Central Transit Chokepoints',
    affectedCellIds: [
      'CELL-R3C4', // Sarwate Bus Stand Basin
      'CELL-R1C6', // Rajkumar Mill Underpass
      'CELL-R1C4', // Bhandari Bridge Approach
    ],
    rainfallMetric: '48 mm/hr short-duration convective burst (92 mm cumulative)',
    recordedFloodConditions:
      'Severe stormwater culvert throttle beneath railway embankment caused rapid accumulation of 35–50 cm water in underpass sumps and bus terminus bays while upland wards remained dry.',
    precautionsTaken:
      'Pre-monsoon silt screens inspected at Sarwate culvert prior to the burst.',
    actionsPerformedByAuthorities:
      'Indore Traffic Police barricaded flooded underpass approaches; automated municipal sump pumps engaged continuously; manual silt extraction teams cleared choked grates.',
    evacuationMeasuresTaken:
      'No residential mass evacuation needed; transit commuters redirected to elevated station concourse and high-platform waiting zones.',
    routesActuallyUsed:
      'Surface vehicular movement rerouted via elevated Shastri Bridge flyover corridor (RD-08 / RD-03 link).',
    sheltersOrDestinationsUsed:
      'Transit depot internal upper passenger waiting concourses; external emergency relief shelters not activated.',
    sourceReference:
      'Indore Smart City Development Ltd (ISCDL) Drainage Sensor Log & Traffic Police Advisory (Record ID: ISCDL-FLD-2024-0824)',
    timestamp: '2024-08-24T18:45:00+05:30',
  },
];

/**
 * Returns verified historical response records matching a specific cell ID.
 * Returns empty array if no verified record exists for that cell.
 */
export function getVerifiedHistoricalRecordsForCell(
  cellId: string
): HistoricalResponseRecord[] {
  return VERIFIED_HISTORICAL_RECORDS.filter((rec) =>
    rec.affectedCellIds.includes(cellId)
  );
}
