import { PlannedWorkout, ActualWorkout, Sport } from './models';
import { WorkoutFeedback, WorkoutObservation, ConfidenceLevel } from './athleteHistoryTypes';
import { CoachProposal } from './coachTypes';

export type ReconciliationMatchStatus =
  | 'MATCH_CONFIRMED'   // Rapprochement certain (identifiant explicite ou unicité parfaite date/sport/durée)
  | 'MATCH_PROBABLE'    // Rapprochement très probable (date/sport identiques, durée cohérente, sans conflit)
  | 'MATCH_AMBIGUOUS'   // Plusieurs séances planifiées candidates en concurrence -> AUCUNE association automatique
  | 'NO_MATCH';         // Aucune séance planifiée correspondante trouvée

export type TssProvenanceStatus =
  | 'MEASURED_OR_IMPORTED'         // TSS fourni directement par la montre/compteur (Garmin, Wahoo, Strava)
  | 'DETERMINISTICALLY_CALCULATED' // Calculé par le moteur Plana via Puissance Normalisée (NP) ou Cardio (hrTSS)
  | 'ESTIMATED'                    // Estimation fondée sur la durée uniquement (non équivalente à une mesure de puissance)
  | 'UNAVAILABLE';                 // Données insuffisantes pour établir une charge

export type TssMethod =
  | 'device_provided'
  | 'power_np'
  | 'heart_rate'
  | 'duration_estimate'
  | 'none';

export interface MetricComparisonItem {
  metric: 'duration' | 'distance' | 'power' | 'heart_rate' | 'tss' | 'rpe' | 'cadence';
  label: string;
  unit: string;
  plannedValue?: number | string;
  actualValue?: number | string;
  deltaAbsolute?: number;
  deltaPercentage?: number;
  plannedSource?: string;
  actualSource?: string;
  confidence: ConfidenceLevel;
  isSignificantDiscrepancy: boolean;
  explanation?: string;
}

export interface TssProvenanceInfo {
  plannedTss?: number;
  actualTss?: number;
  status: TssProvenanceStatus;
  method: TssMethod;
  sourceDescription: string;
  isEstimatedOnly: boolean;
  reliabilityWarning?: string;
}

export interface PostWorkoutContextInfo {
  hasTemperature: boolean;
  temperature?: number;
  temperatureSource?: string;
  timestamp?: string;
  indeterminateReasons: string[];
}

export interface WorkoutReconciliationResult {
  actualWorkout: ActualWorkout;
  plannedWorkout?: PlannedWorkout;
  status: ReconciliationMatchStatus;
  matchConfidence: number; // 0 à 1
  matchReason: string;
  comparison: MetricComparisonItem[];
  tssInfo: TssProvenanceInfo;
  feedback?: WorkoutFeedback;
  observations: WorkoutObservation[];
  proposedAdaptation?: CoachProposal;
  context: PostWorkoutContextInfo;
  requiresAthleteDecision: boolean;
}
