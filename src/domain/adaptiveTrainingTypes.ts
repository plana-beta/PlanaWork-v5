import { PlannedWorkout, ActualWorkout, Sport, AthleteProfile } from './models';
import { WorkoutFeedback, WorkoutObservation, ConfidenceLevel } from './athleteHistoryTypes';
import { CoachProposal, ProposedWorkoutModification } from './coachTypes';

export type AdaptiveProposalType =
  | 'REDUCE_VOLUME'     // Réduction du volume (durée) d'une séance future
  | 'REDUCE_INTENSITY'  // Réduction de l'intensité prescrite (ex: Z4 -> Z2)
  | 'REPLACE_SESSION'   // Remplacement par une séance plus facile (ex: Récupération active)
  | 'ADD_RECOVERY'      // Ajout ou proposition explicite d'un jour de repos
  | 'NO_CHANGE';        // Maintien du programme lorsque les données ne justifient pas de modification

export type AdaptiveProposalStatus =
  | 'PENDING'    // En attente de décision de l'athlète
  | 'ACCEPTED'   // Validée par l'athlète, en attente d'application transactionnelle
  | 'REJECTED'   // Refusée par l'athlète (planning strictement préservé)
  | 'EXPIRED'    // Date de validité dépassée (séance déjà passée ou dépassée)
  | 'EXECUTED'   // Appliquée avec succès au planning et auditée
  | 'FAILED';    // Échec lors de la transaction d'application

export type DataUncertaintyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'INSUFFICIENT_DATA';

export interface DataProvenanceSummary {
  measuredCount: number;
  calculatedCount: number;
  estimatedCount: number;
  unavailableCount: number;
  hasReliablePowerOrHr: boolean;
  sources: string[];
  warnings: string[];
}

export interface AdaptiveBeforeAfterItem<T = number | string> {
  before: T;
  after: T;
}

export interface AdaptiveSessionChanges {
  workoutId: string;
  originalWorkout: {
    title: string;
    date: string;
    durationMin: number;
    targetTss?: number;
    intensity?: string;
    sport: Sport;
    status?: string;
  };
  proposedWorkout: {
    title: string;
    date: string;
    durationMin: number;
    targetTss?: number;
    intensity?: string;
    sport: Sport;
    status: string;
    explanation: string;
  };
  beforeAfter: {
    durationMin?: AdaptiveBeforeAfterItem<number>;
    targetTss?: AdaptiveBeforeAfterItem<number>;
    intensity?: AdaptiveBeforeAfterItem<string>;
    sport?: AdaptiveBeforeAfterItem<string>;
    isRecoveryDay?: boolean;
  };
}

export interface AdaptiveProposal {
  id: string;
  athleteId: string;
  targetWorkoutId: string;
  affectedWorkoutIds: string[];
  type: AdaptiveProposalType;
  createdAt: string; // ISO
  expiresAt: string; // ISO
  triggerObservations: WorkoutObservation[];
  dataProvenance: DataProvenanceSummary;
  rationale: string;
  detailedExplanation: string;
  proposedChanges: AdaptiveSessionChanges;
  uncertaintyLevel: DataUncertaintyLevel;
  status: AdaptiveProposalStatus;
  userDecision?: 'ACCEPTED' | 'REJECTED';
  userMessage?: string;
  executedAt?: string;
  executionAudit?: {
    decisionId: string;
    appliedAt: string;
    previousSnapshot: Partial<PlannedWorkout>;
    finalSnapshot: Partial<PlannedWorkout>;
  };
  compatibleCoachProposal: CoachProposal;
}

export interface FatigueSignal {
  signal: string;
  source: string;
  confidence: ConfidenceLevel;
  observedAt: string;
}

export interface AdaptiveAnalysisResult {
  status: 'ANALYSIS_COMPLETE' | 'INSUFFICIENT_DATA' | 'NO_CHANGE_NEEDED';
  athleteId: string;
  analyzedPeriod: {
    from: string;
    to: string;
  };
  proposals: AdaptiveProposal[];
  fatigueSignals: FatigueSignal[];
  missingDataInfo?: string[];
  summary: string;
  dataProvenance: DataProvenanceSummary;
}
