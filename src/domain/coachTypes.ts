import { Sport } from './models';

export type CoachActionType =
  | 'ADAPT_PLAN'
  | 'MODIFY_WORKOUT'
  | 'MOVE_WORKOUT'
  | 'CANCEL_WORKOUT'
  | 'REDUCE_LOAD'
  | 'INCREASE_LOAD'
  | 'RECOVERY'
  | 'NO_CHANGE';

export interface CoachActionConstraint {
  reduceIntensity?: boolean;
  prioritizeRecovery?: boolean;
  avoidMakeupTraining?: boolean;
  autoMakeupMissedLoad?: boolean; // Tentative de rattraper/cumuler la charge d'une séance manquée
  preserveKeyWorkout?: boolean;
  maxWeeklyLoadIncrease?: number; // e.g. 0.05 for +5%
  preserveGoal?: boolean;
  preserveRestDay?: boolean;
  maxDurationMin?: number;
  targetZone?: string;
}

export type ConfidenceLevel = 'INSUFFICIENT_DATA' | 'LOW' | 'MEDIUM' | 'HIGH' | 'low' | 'medium' | 'high';

export interface ConfidenceAssessment {
  level: ConfidenceLevel;
  reasons?: string[];
  historyWeeks?: number;
  recentWorkoutsCount?: number;
  confidenceScore?: number;
  hasEnoughHistory?: boolean;
  [key: string]: unknown;
}

export interface AthleteTolerance {
  metric: string;
  value: number;
  sampleSize: number;
  confidence: ConfidenceLevel;
  period: string;
  source: string;
  disclaimer?: string;
}

export interface ProposedWorkoutModification {
  workoutId: string;
  newDate?: string;
  newSport?: Sport;
  newDurationMin?: number;
  newIntensity?: {
    type: 'zone' | 'hr' | 'power' | 'pace' | 'rpe';
    value: string;
  };
  newTargetTss?: number;
  newStatus?: 'planned' | 'completed' | 'partial' | 'missed' | 'adapted';
  cancel?: boolean;
}

export interface CoachProposalImpact {
  weeklyTssDelta: number;
  previousWeeklyLoad: number;
  newWeeklyLoad: number;
  fatigueImpact?: 'reduces_fatigue' | 'maintains' | 'slight_increase';
  summary: string;
}

export interface CoachProposal {
  id: string;
  action?: CoachActionType;
  reason?: string;
  explanation?: string; // Pourquoi cette action est recommandée
  affectedWorkoutIds?: string[];
  proposedModifications?: ProposedWorkoutModification[];
  actions?: unknown[];
  confidenceLevel?: string;
  confidenceAssessment?: ConfidenceAssessment;
  source?: string;
  impact?: CoachProposalImpact;
  constraints?: CoachActionConstraint;
  confidence?: ConfidenceLevel;
  sourceContext?: {
    currentWeeklyLoad?: number;
    proposedWeeklyLoad?: number;
    loadIncreasePercent?: number;
    fatigueLevel?: string;
    [key: string]: unknown;
  };
  proposedAt?: string;
  loadIncreasePercent?: number;
  [key: string]: unknown;
}

export interface CoachActionValidationResult {
  valid?: boolean;
  isValid?: boolean;
  errors?: string[];
  warnings?: string[];
  normalizedAction?: CoachProposal;
  blockedReason?: string;
  [key: string]: unknown;
}

export interface CoachActionExecutionResult {
  success: boolean;
  message: string;
  updatedWorkoutsCount: number;
  recalculatedWeeklyLoad: number;
  recalculatedPmcCount: number;
  error?: string;
  rolledBack?: boolean;
  isObsolete?: boolean;
  alreadyExecuted?: boolean;
  alreadyRejected?: boolean;
  loadDelta?: number;
  affectedWorkouts?: Array<{
    id: string;
    sport: string;
    date: string;
    title: string;
    durationMin?: number;
    targetTss?: number;
    status?: string;
  }>;
  appliedModifications?: ProposedWorkoutModification[];
  [key: string]: unknown;
}

export type CoachDecisionStatus =
  | 'PROPOSED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'MODIFIED'
  | 'EXECUTED'
  | 'FAILED'
  | 'OBSOLETE'
  | 'ROLLBACK';

export interface CoachDecision {
  id: string;
  createdAt: string;
  userMessage?: string;
  proposal: CoachProposal;
  validationResult: CoachActionValidationResult;
  userDecision: CoachDecisionStatus;
  appliedChanges?: ProposedWorkoutModification[];
  engineResult?: CoachActionExecutionResult;
  error?: string;
}

export * from './coachIntentTypes';
