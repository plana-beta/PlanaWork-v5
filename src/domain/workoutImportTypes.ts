import { Sport, ActualWorkout, PlannedWorkout } from './models';

export type SupportedFileFormat =
  | 'fit'
  | 'tcx'
  | 'gpx'
  | 'csv'
  | 'json'
  | 'pdf'
  | 'image'
  | 'unknown';

export type ImportConfidence = 'high' | 'medium' | 'low' | 'uncertain';

export type TssCalculationMethod =
  | 'provided'          // TSS déjà fourni dans le fichier
  | 'power_np'          // Calculé via Puissance Normalisée (TrainingEngine)
  | 'heart_rate'        // Calculé via Fréquence Cardiaque hrTSS (TrainingEngine)
  | 'duration_estimate' // Estimé via Durée (TrainingEngine)
  | 'none';

/**
 * 1. Données brutes extraites du fichier par le parseur spécifique.
 */
export interface RawExtractedWorkoutData {
  sportRaw?: string;
  startTimeRaw?: string;
  endTimeRaw?: string;
  durationSecondsRaw?: number;
  distanceMetersRaw?: number;
  averageHeartRateRaw?: number;
  maxHeartRateRaw?: number;
  averagePowerRaw?: number;
  maxPowerRaw?: number;
  normalizedPowerRaw?: number;
  averageCadenceRaw?: number;
  elevationGainMetersRaw?: number;
  caloriesRaw?: number;
  temperatureRaw?: number;
  providedTssRaw?: number;
  powerSeries?: number[];
  hrSeries?: number[];
  externalIdRaw?: string;
  metadata?: Record<string, unknown>;
  confidence: ImportConfidence;
  uncertainFields: string[];
  missingFields: string[];
  extractionNotes?: string[];
}

/**
 * 2. Données d'entraînement normalisées prêtes à être converties en ActualWorkout.
 */
export interface NormalizedWorkoutData {
  id: string;
  source: string;
  sourceId: string;
  sport: Sport;
  date: string; // YYYY-MM-DD
  startTime: string; // ISO 8601
  durationMin: number;
  distanceKm?: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
  averagePower?: number;
  normalizedPower?: number;
  averageCadence?: number;
  elevationGain?: number;
  calories?: number;
  temperature?: number;
  tss?: number;
  tssCalculationMethod: TssCalculationMethod;
  title: string;
  confidence: ImportConfidence;
  uncertainFields: string[];
  matchedPlannedWorkoutId?: string;
}

/**
 * Information sur un doublon potentiel détecté.
 */
export interface DuplicateMatch {
  existingWorkout: ActualWorkout;
  matchType: 'exact_source_id' | 'probable_match';
  reason: string;
  similarityScore: number; // 0 to 1
  canOverride: boolean;
}

/**
 * 3. Résultat complet de l'analyse préalable d'un fichier (avant confirmation athlète).
 */
export interface ImportAnalysisResult {
  fileInfo: {
    name: string;
    sizeBytes: number;
    detectedFormat: SupportedFileFormat;
    mimeType: string;
    isSecurityCompliant: boolean;
  };
  status:
    | 'ready'                  // Prêt à être importé
    | 'needs_confirmation'     // Prêt mais champs incertains ou format documentaire
    | 'duplicate_warning'      // Doublon probable détecté
    | 'unsupported'            // Format non pris en charge
    | 'invalid';               // Fichier corrompu ou illisible
  extractedWorkouts: RawExtractedWorkoutData[];
  normalizedWorkouts: NormalizedWorkoutData[];
  duplicateMatches: DuplicateMatch[];
  validationErrors: string[];
  validationWarnings: string[];
  summaryText: string;
  metricsSummary: {
    totalWorkoutsCount: number;
    totalDurationMin: number;
    totalDistanceKm: number;
    totalEstimatedTss: number;
  };
}

/**
 * 4. État de confirmation d'import.
 */
export interface ImportExecutionResult {
  success: boolean;
  importedCount: number;
  skippedDuplicatesCount: number;
  matchedPlannedCount: number;
  recalculatedPmcDays: number;
  message: string;
  importedWorkoutIds: string[];
}
