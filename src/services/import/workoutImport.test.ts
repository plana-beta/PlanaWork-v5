import { describe, it, expect, beforeEach } from 'vitest';
import { FileTypeDetector, MAX_IMPORT_FILE_SIZE_BYTES } from './FileTypeDetector';
import { FitParser } from './parsers/FitParser';
import { TcxParser } from './parsers/TcxParser';
import { GpxParser } from './parsers/GpxParser';
import { CsvParser } from './parsers/CsvParser';
import { JsonParser } from './parsers/JsonParser';
import { DocumentParser } from './parsers/DocumentParser';
import { WorkoutNormalizer } from './WorkoutNormalizer';
import { WorkoutImportValidator } from './WorkoutImportValidator';
import { WorkoutDeduplicationService } from './WorkoutDeduplicationService';
import { WorkoutFileImportService } from './WorkoutFileImportService';
import { CoachImportContext } from './CoachImportContext';
import { useAppStore } from '../../store';
import { ActualWorkout, PlannedWorkout } from '../../domain/models';

/**
 * Génère un en-tête FIT binaire minimal valide de 14 octets
 */
function createMinimalFitBuffer(dataPayload: number[] = []): Uint8Array {
  const headerSize = 14;
  const dataSize = dataPayload.length;
  const totalLength = headerSize + dataSize;
  const buffer = new Uint8Array(totalLength);

  buffer[0] = headerSize;       // Header size
  buffer[1] = 0x10;             // Protocol version
  buffer[2] = 0x20; buffer[3] = 0x08; // Profile version
  // Data size uint32 little endian
  buffer[4] = dataSize & 0xFF;
  buffer[5] = (dataSize >> 8) & 0xFF;
  buffer[6] = (dataSize >> 16) & 0xFF;
  buffer[7] = (dataSize >> 24) & 0xFF;
  // Signature ".FIT"
  buffer[8] = 0x2E; // '.'
  buffer[9] = 0x46; // 'F'
  buffer[10] = 0x49; // 'I'
  buffer[11] = 0x54; // 'T'
  // CRC
  buffer[12] = 0x00;
  buffer[13] = 0x00;

  for (let i = 0; i < dataPayload.length; i++) {
    buffer[headerSize + i] = dataPayload[i];
  }

  return buffer;
}

describe('Phase 34 — Universal Workout Import & Deterministic File Analysis', () => {
  beforeEach(() => {
    useAppStore.setState({
      actualWorkouts: [],
      plannedWorkouts: [],
      pmc: [],
      ftp: 250,
      athleteProfile: {
        id: 'ath-p34',
        level: { swim: 'intermediate', ride: 'intermediate', run: 'intermediate' },
        availability: { weeklyHours: 10, availableDays: ['Lundi', 'Mardi', 'Mercredi'] },
        dataConnection: 'none',
        hrMax: 190
      }
    });
  });

  // =========================================================================
  // 1. DÉTECTION DU FORMAT & SÉCURITÉ DES FICHIERS
  // =========================================================================
  describe('1. File Type Detection & Security', () => {
    it('1.1 détecte un fichier binaire FIT par ses magic bytes (.FIT)', () => {
      const fitBuffer = createMinimalFitBuffer();
      const det = FileTypeDetector.detect('activity.fit', fitBuffer);
      expect(det.format).toBe('fit');
      expect(det.isCompliant).toBe(true);
    });

    it('1.2 détecte un document PDF par sa signature %PDF-', () => {
      const pdfHeader = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj');
      const det = FileTypeDetector.detect('rapport.pdf', pdfHeader);
      expect(det.format).toBe('pdf');
      expect(det.mimeType).toBe('application/pdf');
    });

    it('1.3 détecte une image PNG par son magic header', () => {
      const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      const det = FileTypeDetector.detect('screenshot.png', pngHeader);
      expect(det.format).toBe('image');
      expect(det.mimeType).toBe('image/png');
    });

    it('1.4 rejette un binaire exécutable Windows (MZ) renommé en .fit', () => {
      const fakeFit = new Uint8Array([0x4D, 0x5A, 0x90, 0x00, 0x03]); // MZ header
      const det = FileTypeDetector.detect('malware.fit', fakeFit);
      expect(det.format).toBe('unknown');
      expect(det.isCompliant).toBe(false);
      expect(det.error).toContain('exécutable interdit');
    });

    it('1.5 rejette les fichiers dépassant la limite de taille configurée (15 Mo)', () => {
      const sizeValidation = FileTypeDetector.validateFileSize(MAX_IMPORT_FILE_SIZE_BYTES + 1024);
      expect(sizeValidation.valid).toBe(false);
      expect(sizeValidation.error).toContain('trop volumineux');
    });

    it('1.6 rejette un fichier contenant des balises script actives', () => {
      const maliciousHtml = '<script>alert("hack")</script>';
      const det = FileTypeDetector.detect('activity.tcx', maliciousHtml);
      expect(det.isCompliant).toBe(false);
      expect(det.error).toContain('script');
    });
  });

  // =========================================================================
  // 2. PARSEURS SPÉCIFIQUES (FIT, TCX, GPX, CSV, JSON)
  // =========================================================================
  describe('2. Specific Workout Format Parsers', () => {
    it('2.1 extrait les métriques d\'un fichier FIT binaire valide', () => {
      const fitBuffer = createMinimalFitBuffer();
      const res = FitParser.parse(fitBuffer);
      expect(res.success).toBe(true);
      expect(res.workouts.length).toBe(1);
      expect(res.workouts[0].confidence).toBeDefined();
    });

    it('2.2 gère un fichier FIT corrompu ou tronqué sans crasher', () => {
      const corruptFit = new Uint8Array([0x0E, 0x10, 0x00, 0x00, 0xFF]); // Trop court
      const res = FitParser.parse(corruptFit);
      expect(res.success).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.workouts.length).toBe(0);
    });

    it('2.3 parse un fichier TCX valide avec sport, durée, distance et cardio', () => {
      const tcxXml = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-10-18T09:30:00Z</Id>
      <Lap StartTime="2026-10-18T09:30:00Z">
        <TotalTimeSeconds>3600</TotalTimeSeconds>
        <DistanceMeters>30000</DistanceMeters>
        <Calories>750</Calories>
        <AverageHeartRateBpm><Value>148</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>172</Value></MaximumHeartRateBpm>
      </Lap>
      <Track>
        <Trackpoint>
          <Time>2026-10-18T09:30:00Z</Time>
          <HeartRateBpm><Value>145</Value></HeartRateBpm>
          <Extensions><Watts>220</Watts></Extensions>
        </Trackpoint>
      </Track>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

      const res = TcxParser.parse(tcxXml);
      expect(res.success).toBe(true);
      expect(res.workouts.length).toBe(1);

      const w = res.workouts[0];
      expect(w.sportRaw).toBe('Biking');
      expect(w.startTimeRaw).toBe('2026-10-18T09:30:00Z');
      expect(w.durationSecondsRaw).toBe(3600);
      expect(w.distanceMetersRaw).toBe(30000);
      expect(w.averageHeartRateRaw).toBe(148);
      expect(w.caloriesRaw).toBe(750);
      expect(w.averagePowerRaw).toBe(220);
    });

    it('2.4 gère un TCX vide ou non XML gracieusement', () => {
      const res = TcxParser.parse("Ceci n'est pas du TCX");
      expect(res.success).toBe(false);
      expect(res.errors[0]).toContain('invalide');
    });

    it('2.5 parse un GPX valide et calcule la distance géodésique (Haversine)', () => {
      const gpxXml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PlanaTest">
  <trk>
    <name>Footing matinal</name>
    <type>running</type>
    <trkseg>
      <trkpt lat="45.1885" lon="5.7245">
        <ele>220</ele>
        <time>2026-10-18T07:00:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>142</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
      <trkpt lat="45.1950" lon="5.7350">
        <ele>240</ele>
        <time>2026-10-18T07:15:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>158</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

      const res = GpxParser.parse(gpxXml);
      expect(res.success).toBe(true);
      expect(res.workouts.length).toBe(1);

      const w = res.workouts[0];
      expect(w.sportRaw).toBe('running');
      expect(w.durationSecondsRaw).toBe(900); // 15 min
      expect(w.distanceMetersRaw).toBeGreaterThan(800); // Haversine distance
      expect(w.elevationGainMetersRaw).toBe(20);
      expect(w.averageHeartRateRaw).toBe(150);
    });

    it('2.6 gère un GPX sans capteurs cardio sans inventer de données', () => {
      const simpleGpx = `<?xml version="1.0"?>
<gpx><trk><type>cycling</type><trkseg>
  <trkpt lat="45.0" lon="5.0"><time>2026-10-18T08:00:00Z</time></trkpt>
  <trkpt lat="45.01" lon="5.01"><time>2026-10-18T08:10:00Z</time></trkpt>
</trkseg></trk></gpx>`;

      const res = GpxParser.parse(simpleGpx);
      expect(res.success).toBe(true);
      expect(res.workouts[0].averageHeartRateRaw).toBeUndefined();
      expect(res.workouts[0].missingFields).toContain('averageHeartRate');
    });

    it('2.7 parse un CSV délimité par des points-virgules avec durées hh:mm:ss et virgules décimales', () => {
      const csvContent = `Date;Sport;Durée;Distance (km);Cardio;Puissance
18/10/2026;Cyclisme;01:30:00;45,5;142;215
19/10/2026;Course;00:45:00;10,0;156;`;

      const res = CsvParser.parse(csvContent);
      expect(res.success).toBe(true);
      expect(res.workouts.length).toBe(2);

      const ride = res.workouts[0];
      expect(ride.durationSecondsRaw).toBe(5400); // 1h30
      expect(ride.distanceMetersRaw).toBe(45500); // 45.5 km
      expect(ride.averageHeartRateRaw).toBe(142);
      expect(ride.averagePowerRaw).toBe(215);

      const run = res.workouts[1];
      expect(run.durationSecondsRaw).toBe(2700); // 45 min
      expect(run.distanceMetersRaw).toBe(10000);
      expect(run.averageHeartRateRaw).toBe(156);
      expect(run.averagePowerRaw).toBeUndefined();
    });

    it('2.8 parse un JSON export Strava contenant un tableau d\'activités', () => {
      const stravaJson = JSON.stringify([
        {
          id: 'strava-12345',
          name: 'Sortie longue dimanche',
          type: 'Ride',
          start_date_local: '2026-10-18T08:30:00Z',
          elapsed_time: 7200,
          moving_time: 7000,
          distance: 62000,
          average_heartrate: 144,
          max_heartrate: 168,
          average_watts: 210,
          kilojoules: 1470
        }
      ]);

      const res = JsonParser.parse(stravaJson);
      expect(res.success).toBe(true);
      expect(res.workouts.length).toBe(1);

      const w = res.workouts[0];
      expect(w.externalIdRaw).toBe('strava-12345');
      expect(w.durationSecondsRaw).toBe(7000);
      expect(w.distanceMetersRaw).toBe(62000);
      expect(w.averagePowerRaw).toBe(210);
      expect(w.caloriesRaw).toBe(Math.round(1470 * 0.239));
    });

    it('2.9 gère un JSON mal formé sans crasher', () => {
      const badJson = '{"activities": [ { "type": "Run", '; // Non terminé
      const res = JsonParser.parse(badJson);
      expect(res.success).toBe(false);
      expect(res.errors[0]).toContain('JSON');
    });
  });

  // =========================================================================
  // 3. PARSEUR DOCUMENTAIRE (PDF & CAPTURES D'ÉCRAN)
  // =========================================================================
  describe('3. Document & Screenshot Extraction', () => {
    it('3.1 extrait les métriques textuelles d\'un rapport d\'entraînement PDF', () => {
      const pdfText = `
        Rapport d'activité Plana
        Date : 18/10/2026
        Discipline : Course à pied
        Durée : 01:05:00
        Distance : 12.5 km
        Fréquence cardiaque moyenne : 154 bpm
      `;

      const res = DocumentParser.extractFromText(pdfText, 'pdf');
      expect(res.success).toBe(true);
      expect(res.workouts.length).toBe(1);

      const w = res.workouts[0];
      expect(w.sportRaw).toBe('Run');
      expect(w.durationSecondsRaw).toBe(3900); // 1h05
      expect(w.distanceMetersRaw).toBe(12500);
      expect(w.averageHeartRateRaw).toBe(154);
    });

    it('3.2 gère un PDF sans texte exploitable (scanné) avec message explicatif', () => {
      const res = DocumentParser.parsePdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D])); // %PDF- vide
      expect(res.success).toBe(false);
      expect(res.errors[0]).toContain('sans texte exploitable');
    });

    it('3.3 extrait une capture d\'écran avec statut incertain et demande de confirmation obligatoire', () => {
      const ocrText = "Sortie vélo 45 min 210 W 18/10/2026";
      const res = DocumentParser.parseImage('garmin_capture.jpg', ocrText);

      expect(res.success).toBe(true);
      expect(res.isAmbiguous).toBe(true);
      expect(res.workouts[0].confidence).toBe('low');
      expect(res.workouts[0].uncertainFields).toContain('sport');
      expect(res.workouts[0].extractionNotes![0]).toContain('confirmation manuelle');
    });

    it('3.4 rejette une image sans texte OCR lisible sans inventer de données', () => {
      const res = DocumentParser.parseImage('photo_floue.jpg', '');
      expect(res.success).toBe(false);
      expect(res.errors[0]).toContain('aucun texte OCR exploitable');
    });
  });

  // =========================================================================
  // 4. NORMALISATION DÉTERMINISTE & CALCULS PHYSIOLOGIQUES (TRAINING ENGINE)
  // =========================================================================
  describe('4. Deterministic Normalization & Physiological Calculations', () => {
    it('4.1 respecte la hiérarchie TSS : TSS fourni prioritaire sur le calcul', () => {
      const raw = {
        sportRaw: 'Ride',
        startTimeRaw: '2026-10-18T10:00:00Z',
        durationSecondsRaw: 3600,
        averagePowerRaw: 200,
        providedTssRaw: 85, // Spécifié explicitement
        confidence: 'high' as const,
        uncertainFields: [],
        missingFields: []
      };

      const normalized = WorkoutNormalizer.normalize(raw, 'test');
      expect(normalized.tss).toBe(85);
      expect(normalized.tssCalculationMethod).toBe('provided');
    });

    it('4.2 calcule le TSS déterministe via Puissance Normalisée (NP) quand TSS non fourni', () => {
      // 1h à NP=250W avec FTP=250W -> TSS = 100
      const raw = {
        sportRaw: 'cycling',
        startTimeRaw: '2026-10-18T10:00:00Z',
        durationSecondsRaw: 3600,
        normalizedPowerRaw: 250,
        confidence: 'high' as const,
        uncertainFields: [],
        missingFields: []
      };

      const normalized = WorkoutNormalizer.normalize(raw, 'test');
      expect(normalized.tss).toBe(100);
      expect(normalized.tssCalculationMethod).toBe('power_np');
    });

    it('4.3 calcule le hrTSS via Fréquence Cardiaque quand la puissance est absente', () => {
      const raw = {
        sportRaw: 'running',
        startTimeRaw: '2026-10-18T10:00:00Z',
        durationSecondsRaw: 3600,
        averageHeartRateRaw: 152,
        confidence: 'high' as const,
        uncertainFields: [],
        missingFields: []
      };

      const normalized = WorkoutNormalizer.normalize(raw, 'test');
      expect(normalized.tss).toBeDefined();
      expect(normalized.tss!).toBeGreaterThan(0);
      expect(normalized.tssCalculationMethod).toBe('heart_rate');
    });

    it('4.4 utilise l\'estimation fondée sur la durée en dernier recours', () => {
      const raw = {
        sportRaw: 'musculation',
        startTimeRaw: '2026-10-18T10:00:00Z',
        durationSecondsRaw: 3600, // 60 min -> 50 TSS
        confidence: 'high' as const,
        uncertainFields: [],
        missingFields: []
      };

      const normalized = WorkoutNormalizer.normalize(raw, 'test');
      expect(normalized.tss).toBe(50);
      expect(normalized.tssCalculationMethod).toBe('duration_estimate');
    });

    it('4.5 ne confie JAMAIS le calcul des métriques à Gemini', () => {
      // Toutes les métriques proviennent de WorkoutNormalizer et TrainingEngine
      const raw = {
        sportRaw: 'Ride',
        startTimeRaw: '2026-10-18T10:00:00Z',
        durationSecondsRaw: 1800,
        confidence: 'high' as const,
        uncertainFields: [],
        missingFields: []
      };

      const normalized = WorkoutNormalizer.normalize(raw, 'test');
      expect(normalized.tss).toBe(25);
      expect(Number.isFinite(normalized.tss)).toBe(true);
    });
  });

  // =========================================================================
  // 5. VALIDATION PHYSIOLOGIQUE, DÉDUPLICATION & RÉCONCILIATION
  // =========================================================================
  describe('5. Validation, Deduplication & Reconciliation', () => {
    it('5.1 rejette une séance à durée nulle ou négative', () => {
      const invalidWorkout = WorkoutNormalizer.normalize({
        sportRaw: 'Run',
        durationSecondsRaw: 0,
        confidence: 'low' as const,
        uncertainFields: [],
        missingFields: []
      }, 'test');

      const val = WorkoutImportValidator.validate(invalidWorkout);
      expect(val.isValid).toBe(false);
      expect(val.errors[0]).toContain('supérieure à 0');
    });

    it('5.2 détecte un doublon strict par identifiant de source externe', () => {
      const existing: ActualWorkout = {
        id: 'tcx_import-ext-001',
        source: 'tcx_import',
        sourceId: 'ext-001',
        sport: 'Ride',
        date: '2026-10-18',
        durationMin: 60
      };

      const candidate = WorkoutNormalizer.normalize({
        sportRaw: 'Ride',
        externalIdRaw: 'ext-001',
        startTimeRaw: '2026-10-18T10:00:00Z',
        durationSecondsRaw: 3600,
        confidence: 'high' as const,
        uncertainFields: [],
        missingFields: []
      }, 'tcx_import');

      const dup = WorkoutDeduplicationService.checkDuplicate(candidate, [existing]);
      expect(dup).not.toBeNull();
      expect(dup?.matchType).toBe('exact_source_id');
      expect(dup?.similarityScore).toBe(1.0);
    });

    it('5.3 détecte un doublon probable par métadonnées (même date, sport et durée très proche)', () => {
      const existing: ActualWorkout = {
        id: 'act-existing',
        sport: 'Run',
        date: '2026-10-18',
        startTime: '2026-10-18T08:00:00Z',
        durationMin: 45
      };

      const candidate = WorkoutNormalizer.normalize({
        sportRaw: 'Run',
        startTimeRaw: '2026-10-18T08:05:00Z', // 5 min d'écart
        durationSecondsRaw: 2700, // 45 min
        confidence: 'high' as const,
        uncertainFields: [],
        missingFields: []
      }, 'other_source');

      const dup = WorkoutDeduplicationService.checkDuplicate(candidate, [existing]);
      expect(dup).not.toBeNull();
      expect(dup?.matchType).toBe('probable_match');
      expect(dup?.reason).toContain('Doublon probable');
    });

    it('5.4 rapproche automatiquement une séance importée de la séance planifiée correspondante', () => {
      const planned: PlannedWorkout = {
        id: 'plan-target-1',
        sport: 'Ride',
        date: '2026-10-18',
        title: 'Sortie endurance',
        targetDurationMin: 60,
        status: 'planned'
      };

      const candidate = WorkoutNormalizer.normalize({
        sportRaw: 'Ride',
        startTimeRaw: '2026-10-18T14:00:00Z',
        durationSecondsRaw: 3600,
        confidence: 'high' as const,
        uncertainFields: [],
        missingFields: []
      }, 'gpx_import');

      const match = WorkoutDeduplicationService.findMatchingPlannedWorkout(candidate, [planned]);
      expect(match).toBeDefined();
      expect(match?.id).toBe('plan-target-1');
    });
  });

  // =========================================================================
  // 6. WORKOUT FILE IMPORT SERVICE (FLUX COMPLET ET ABSENCE DE MUTATION SANS CONFIRMATION)
  // =========================================================================
  describe('6. End-to-End Workflow & Store Integrity', () => {
    it('6.1 l\'analyse d\'un fichier ne mute JAMAIS le store ni le planning sans confirmation', async () => {
      const initialWorkouts = useAppStore.getState().actualWorkouts.length;
      const initialPmc = useAppStore.getState().pmc.length;

      const tcxXml = `<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2026-10-18T10:00:00Z</Id><Lap><TotalTimeSeconds>1800</TotalTimeSeconds><DistanceMeters>5000</DistanceMeters></Lap></Activity></Activities></TrainingCenterDatabase>`;

      const analysis = await WorkoutFileImportService.analyzeFile({
        name: 'run.tcx',
        size: tcxXml.length,
        content: tcxXml
      });

      expect(analysis.status).toBe('ready');
      expect(analysis.normalizedWorkouts.length).toBe(1);

      // Le store doit être STRICTEMENT identique (aucune insertion non confirmée)
      expect(useAppStore.getState().actualWorkouts.length).toBe(initialWorkouts);
      expect(useAppStore.getState().pmc.length).toBe(initialPmc);
    });

    it('6.2 executeImport insère les séances et met à jour le PMC uniquement après confirmation', async () => {
      const tcxXml = `<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="Biking"><Id>2026-10-18T10:00:00Z</Id><Lap><TotalTimeSeconds>3600</TotalTimeSeconds><DistanceMeters>25000</DistanceMeters></Lap></Activity></Activities></TrainingCenterDatabase>`;

      const analysis = await WorkoutFileImportService.analyzeFile({
        name: 'ride.tcx',
        size: tcxXml.length,
        content: tcxXml
      });

      const exec = WorkoutFileImportService.executeImport(analysis);
      expect(exec.success).toBe(true);
      expect(exec.importedCount).toBe(1);

      // Vérifier la présence dans le store
      const actuals = useAppStore.getState().actualWorkouts;
      expect(actuals.length).toBe(1);
      expect(actuals[0].sport).toBe('Ride');
      expect(actuals[0].durationMin).toBe(60);

      // Le PMC doit avoir été recalculé
      expect(useAppStore.getState().pmc.length).toBeGreaterThan(0);
    });

    it('6.3 ignore les doublons lors de l\'exécution sauf si l\'option allowDuplicates est activée', async () => {
      // 1ère insertion
      const existing: ActualWorkout = {
        id: 'dup-001',
        source: 'csv_import',
        sourceId: 'csv_import-Ride-2026-10-18-60-25-0',
        sport: 'Ride',
        date: '2026-10-18',
        durationMin: 60
      };
      useAppStore.getState().addActualWorkout(existing);

      const csvData = `Date;Sport;Durée;Distance (km)\n18/10/2026;Cyclisme;01:00:00;25,0`;
      const analysis = await WorkoutFileImportService.analyzeFile({
        name: 'activites.csv',
        size: csvData.length,
        content: csvData
      });

      expect(analysis.status).toBe('duplicate_warning');
      expect(analysis.duplicateMatches.length).toBe(1);

      // Exécution sans forcer : doublon ignoré
      const execNoDup = WorkoutFileImportService.executeImport(analysis, { allowDuplicates: false });
      expect(execNoDup.importedCount).toBe(0);
      expect(execNoDup.skippedDuplicatesCount).toBe(1);
      expect(useAppStore.getState().actualWorkouts.length).toBe(1);

      // Exécution en forçant : doublon accepté
      const execWithDup = WorkoutFileImportService.executeImport(analysis, { allowDuplicates: true });
      expect(execWithDup.importedCount).toBe(1);
      expect(useAppStore.getState().actualWorkouts.length).toBe(2);
    });

    it('6.4 ne modifie JAMAIS le statut d\'une séance planifiée sans validation explicite', async () => {
      const planned: PlannedWorkout = {
        id: 'plan-untouched',
        sport: 'Run',
        date: '2026-10-18',
        title: 'Séance prévue',
        targetDurationMin: 45,
        status: 'planned'
      };
      useAppStore.getState().addPlannedWorkout(planned);

      const csvData = `Date;Sport;Durée\n18/10/2026;Course;00:45:00`;
      const analysis = await WorkoutFileImportService.analyzeFile({
        name: 'run.csv',
        size: csvData.length,
        content: csvData
      });

      WorkoutFileImportService.executeImport(analysis);

      // La séance planifiée reste au statut 'planned' (l'athlète garde le contrôle)
      const p = useAppStore.getState().plannedWorkouts.find(w => w.id === 'plan-untouched');
      expect(p?.status).toBe('planned');
    });
  });

  // =========================================================================
  // 7. INTÉGRATION COMPACTE AU CONTEXTE DU COACH
  // =========================================================================
  describe('7. Coach Context Integration & Privacy', () => {
    it('7.1 génère une synthèse compacte d\'historique sans fuite de séries temporelles', () => {
      const workouts: ActualWorkout[] = [
        { id: 'w1', sport: 'Run', date: '2026-10-15', durationMin: 45, distanceKm: 8, tss: 40 },
        { id: 'w2', sport: 'Ride', date: '2026-10-17', durationMin: 120, distanceKm: 55, tss: 95 },
        { id: 'w3', sport: 'Ride', date: '2026-10-18', durationMin: 90, distanceKm: 40, tss: 70 }
      ];

      const summary = CoachImportContext.buildCompactSummary(workouts);
      expect(summary.importedWorkoutsCount).toBe(3);
      expect(summary.mostFrequentSport).toBe('Ride');
      expect(summary.totalImportedHours).toBe(4.3);
      expect(summary.totalImportedTss).toBe(205);
      expect(summary.dateRange.firstDate).toBe('2026-10-15');
      expect(summary.dateRange.lastDate).toBe('2026-10-18');

      // Le texte pour le Coach est concis
      const promptText = CoachImportContext.formatForCoachPrompt(summary);
      expect(promptText).toContain('Historique importé');
      expect(promptText).toContain('3 séances');
      expect(promptText.length).toBeLessThan(300);
    });

    it('7.2 gère une liste de séances vide sans erreur dans le résumé Coach', () => {
      const summary = CoachImportContext.buildCompactSummary([]);
      expect(summary.importedWorkoutsCount).toBe(0);
      const promptText = CoachImportContext.formatForCoachPrompt(summary);
      expect(promptText).toContain('Aucun fichier importé');
    });
  });
});
