import { Sport, AthleteProfile, Goal, PlannedWorkout, ActualWorkout } from './models';
import { ConfidenceLevel, CoachProposal, CoachActionValidationResult, CoachDecisionStatus } from './coachTypes';
import {
  WorkoutFeedback,
  WorkoutObservation,
  AthleteHabit,
  AthletePreference,
  SimilarWorkoutsStat
} from './athleteHistoryTypes';

export type { ConfidenceLevel };

/**
 * Catégories fondamentales de mémoire dans Plana.
 * RÈGLE STRICTE: Ne jamais mélanger ces catégories.
 */
export type MemoryCategory =
  | 'RAW_DATA'
  | 'DERIVED_OBSERVATION'
  | 'HABIT'
  | 'PREFERENCE'
  | 'TOLERANCE'
  | 'COACH_DECISION';

/**
 * Sources possibles d'une information mémorisée.
 */
export type MemorySource =
  | 'user_explicit'       // Déclaration directe de l'athlète
  | 'observed_pattern'   // Pattern statistique détecté par Plana
  | 'plana_derived'      // Calcul déterministe (TrainingEngine, PMC, etc.)
  | 'plana_analysis'
  | 'coach_confirmed'    // Validé/confirmé suite à un échange avec le Coach
  | 'device_sync'        // Synchronisation capteur / appareil
  | 'manual_entry'       // Saisie manuelle
  | 'strava_webhook'
  | 'plana_habit_detector'
  | 'training_engine_stats'
  | 'coach_audit'
  | string;

/**
 * Métadonnées complètes d'un élément de mémoire.
 * RÈGLE: La mémoire ne doit pas être un simple texte libre.
 */
export interface AthleteMemoryItem<T = unknown> {
  id: string;
  category: MemoryCategory;
  type: string;
  value: T;
  source: MemorySource;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  confidence: ConfidenceLevel;
  sampleSize?: number;
  firstObservedAt?: string;
  lastObservedAt?: string;
  expiresAt?: string; // Si mémoire temporaire
  isOverridden?: boolean; // Remplacée par une préférence/information plus récente sans suppression
  supersededById?: string;
  tags?: string[];
}

/**
 * Disponibilité athlète : distinction stricte entre permanente et temporaire.
 */
export interface PermanentAvailability {
  weeklyHours: number;
  availableDays: string[]; // e.g. ['monday', 'wednesday', 'saturday']
  preferredTimeOfDay?: 'morning' | 'lunch' | 'evening' | 'flexible';
}

export interface TemporaryAvailability {
  id: string;
  type?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  extraAvailableDates?: string[]; // Jours exceptionnellement disponibles
  blockedDates?: string[];        // Jours exceptionnellement indisponibles
  weeklyHoursOverride?: number;
  reason?: string;
  createdAt: string;
  [key: string]: unknown;
}

/**
 * Historique des maladies déclarées par l'athlète.
 * RÈGLE STRICTE: AUCUN DIAGNOSTIC MÉDICAL.
 * Conserve uniquement ce que l'athlète a déclaré et l'impact constaté sur l'entraînement.
 */
export interface IllnessEpisode {
  id: string;
  startDate?: string; // YYYY-MM-DD
  declaredDate?: string; // YYYY-MM-DD
  endDate?: string;  // YYYY-MM-DD
  resolvedDate?: string; // YYYY-MM-DD
  declaredSymptoms?: string[]; // Ce que l'utilisateur a déclaré (ex: rhume, maux de tête)
  impactOnTraining: 'complete_rest' | 'light_active_recovery' | 'reduced_volume' | 'none' | string;
  interruptionDurationDays?: number;
  returnDate?: string;
  returnFeedback?: string; // Comment s'est passée la reprise
  status: 'active' | 'resolved';
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/**
 * Historique des blessures / gênes déclarées par l'athlète.
 * RÈGLE STRICTE: AUCUN DIAGNOSTIC MÉDICAL.
 * Conserve uniquement la déclaration de l'athlète et les adaptations d'entraînement.
 */
export interface InjuryEpisode {
  id: string;
  startDate?: string; // YYYY-MM-DD
  declaredDate?: string; // YYYY-MM-DD
  endDate?: string;  // YYYY-MM-DD
  resolvedDate?: string; // YYYY-MM-DD
  sport?: Sport;
  declaredIssue: string; // Ce que l'utilisateur a déclaré (ex: douleur tendon d'Achille droit)
  impactOnTraining: 'cross_training_only' | 'no_running' | 'reduced_intensity' | 'complete_rest' | 'adapted' | string;
  adaptationsApplied?: string[];
  returnDate?: string;
  status: 'active' | 'resolved';
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/**
 * Données brutes de récupération (sommeil, fréquence cardiaque au repos, fatigue matinale).
 */
export interface RecoveryLog {
  id: string;
  date: string; // YYYY-MM-DD
  sleepHours?: number;
  sleepQuality?: 'poor' | 'fair' | 'good' | 'excellent' | number | string;
  restingHeartRate?: number;
  morningFatigue?: number; // 1 = très frais, 5 = épuisé
  muscleSoreness?: number;
  notes?: string;
  createdAt?: string;
  [key: string]: unknown;
}

/**
 * Erreurs et rejets de propositions du Coach IA (Audit technique).
 * Ne jamais envoyer toutes les erreurs en vrac à Gemini.
 */
export interface CoachProposalError {
  id: string;
  date: string;
  proposalId?: string;
  proposalAction?: string;
  category: 'VALIDATION_FAILED' | 'EXECUTION_FAILED' | 'CONSTRAINT_VIOLATION' | 'UNSUPPORTED_PROPOSAL';
  errorReason: string;
  contextSnapshot?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Représentation logique complète de la mémoire de l'athlète dans Plana.
 * Architecture logique:
 * athlete/
 * ├── profile/
 * ├── goals/
 * ├── availability/
 * ├── history/
 * │   ├── workouts/
 * │   ├── feedback/
 * │   ├── observations/
 * │   ├── recovery/
 * │   ├── illnesses/
 * │   └── performance/
 * ├── habits/
 * ├── preferences/
 * ├── tolerance/
 * ├── plans/
 * ├── files/
 * └── coach/
 *     ├── decisions/
 *     ├── proposals/
 *     └── errors/
 */
export interface AthleteLogicalMemory {
  profile: AthleteProfile | null;
  goals: Goal[];
  availability: {
    permanent: PermanentAvailability | null;
    temporary: TemporaryAvailability[];
  };
  history: {
    workouts: {
      planned: PlannedWorkout[];
      actual: ActualWorkout[];
    };
    feedback: WorkoutFeedback[];
    observations: WorkoutObservation[];
    recovery: RecoveryLog[];
    illnesses: IllnessEpisode[];
    injuries: InjuryEpisode[];
    performance: Array<{
      date: string;
      metric: string;
      value: number;
    }>;
  };
  habits: AthleteHabit[];
  preferences: AthletePreference[];
  tolerance: {
    weeklyTssMedian?: number;
    confidence: ConfidenceLevel;
    sampleWeeks: number;
    description: string;
  } | null;
  plans: Array<{
    id: string;
    name: string;
    status: 'active' | 'archived' | 'draft';
  }>;
  files: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  coach: {
    decisions: Array<{
      id: string;
      proposal: CoachProposal;
      userDecision: CoachDecisionStatus;
      date: string;
      outcomeObserved?: string;
    }>;
    proposals: CoachProposal[];
    errors: CoachProposalError[];
  };
}
