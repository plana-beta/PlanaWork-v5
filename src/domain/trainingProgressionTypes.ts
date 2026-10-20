import { PlannedWorkout, ActualWorkout, Sport, Goal } from './models';
import { EventGoal, PmcData } from '../types';
import { WorkoutFeedback, WorkoutObservation, ConfidenceLevel } from './athleteHistoryTypes';
import { CoachProposal } from './coachTypes';
import { DataProvenanceSummary, DataUncertaintyLevel } from './adaptiveTrainingTypes';

/**
 * Statuts de progression déterministe (Phase 37)
 */
export type ProgressionStatus =
  | 'PROGRESSING'          // Amélioration soutenue par des mesures comparables
  | 'STABLE'               // Absence d'évolution significative détectable sur une période documentée
  | 'POTENTIAL_STAGNATION' // Progression insuffisante ou plateau potentiel sur une période pertinente
  | 'DECLINING'            // Baisse observée sur des mesures comparables, sans préjuger de la cause
  | 'INSUFFICIENT_DATA';   // Données insuffisantes, trop anciennes, incohérentes ou non comparables

/**
 * Types de propositions d'ajustement de progression
 */
export type ProgressionProposalType =
  | 'MAINTAIN_PLAN'       // Conserver le programme actuel
  | 'PROGRESS_VOLUME'     // Évolution prudente du volume (+5% à +10% max)
  | 'PROGRESS_INTENSITY'  // Évolution prudente de l'intensité (+2-3% cibles de travail)
  | 'REBALANCE_TRAINING'  // Réajustement de la répartition des séances (polarisation)
  | 'ADD_RECOVERY'        // Ajout d'une période de régénération/décharge
  | 'REVIEW_GOAL';        // Proposition de réévaluation réaliste de l'objectif ou de l'échéance

export type ProgressionProposalStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXECUTED'
  | 'FAILED';

export interface PerformanceMetricComparison {
  metricName: string;                     // ex: 'Puissance Normalisée (NP)', 'Allure moyenne', 'Efficience (NP/FC)'
  sport: Sport;
  unit: string;                           // 'W', 'min/km', 'W/bpm', 'km/h', 'TSS'
  referenceValue: number | null;          // Moyenne ou valeur référence début de période
  recentValue: number | null;             // Moyenne ou valeur référence fin de période
  absoluteDelta: number | null;           // recent - reference
  relativeDeltaPct: number | null;        // ((recent - reference) / reference) * 100
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INCONCLUSIVE';
  sampleCount: number;                    // Nombre de séances comparables
  provenance: 'MEASURED_OR_IMPORTED' | 'DETERMINISTICALLY_CALCULATED' | 'ESTIMATED' | 'UNAVAILABLE';
  comparabilityLimits: string[];          // Ex: "Données de terrain varié sans capteur de pente", "TSS estimé par durée"
  isDirectPerformanceMeasure: boolean;    // true pour watts/allure, false pour TSS estimé par durée
}

export interface ProgressionTrendPoint {
  date: string;                           // ISO YYYY-MM-DD
  weekNumber: number;
  measuredMetricValue?: number;
  estimatedMetricValue?: number;
  volumeMinutes: number;
  tssTotal: number;
  ctl?: number;
  atl?: number;
  tsb?: number;
  hasMeasuredData: boolean;
  notes?: string;
}

export interface GoalAlignmentAnalysis {
  goalId?: string;
  goalTitle: string;
  targetDate?: string;
  daysRemaining: number | null;
  weeksRemaining: number | null;
  isExpired: boolean;
  sportFocus?: string;
  targetMetricName?: string;
  targetMetricValue?: string | number;
  currentObservedValue?: string | number;
  progressPercent: number | null;         // null si non calculable sans modèle
  isMeasurable: boolean;
  limitsExplanation: string;
  alignmentStatus: 'ON_TRACK' | 'PROGRESS_DETECTED' | 'NEEDS_ATTENTION' | 'UNCONSTRAINED' | 'INSUFFICIENT_DATA';
  calendarConstraints: string[];
  recommendationsToAthlete: string[];
}

export interface StagnationDetectionResult {
  isStagnating: boolean;
  confidence: ConfidenceLevel;
  observedDurationWeeks: number;
  comparableSessionsCount: number;
  loadContext: 'STABLE_LOAD' | 'INCREASING_LOAD' | 'DECREASING_LOAD' | 'INSUFFICIENT_LOAD_DATA';
  factualObservations: string[];
  limitsOfAnalysis: string[];
}

export interface ProgressionProposal {
  id: string;
  athleteId: string;
  goalId?: string;
  type: ProgressionProposalType;
  title: string;
  justification: string;
  factualObservations: string[];
  metricsAndProvenance: {
    metrics: PerformanceMetricComparison[];
    provenanceSummary: DataProvenanceSummary;
  };
  currentAndProposedValues: {
    parameter: string;
    currentValue: string | number;
    proposedValue: string | number;
    unit: string;
    targetWorkoutIds?: string[];
  };
  uncertaintyLevel: DataUncertaintyLevel;
  risksAndLimits: string[];
  createdAt: string;                     // ISO
  expiresAt: string;                     // ISO
  status: ProgressionProposalStatus;
  userDecision?: 'ACCEPTED' | 'REJECTED';
  userMessage?: string;
  executedAt?: string;
  executionAudit?: {
    appliedAt: string;
    affectedWorkoutsCount: number;
    previousStateSnapshot: unknown;
    newStateSnapshot: unknown;
  };
  compatibleCoachProposal?: CoachProposal;
}

export interface TrainingProgressionAnalysis {
  id: string;
  athleteId: string;
  calculatedAt: string;                  // ISO
  observedPeriod: {
    from: string;
    to: string;
    weeksCount: number;
  };
  status: ProgressionStatus;
  goalAlignment?: GoalAlignmentAnalysis;
  metrics: PerformanceMetricComparison[];
  trendPoints: ProgressionTrendPoint[];
  stagnation: StagnationDetectionResult;
  loadTrends: {
    weeklyAverageTss: number;
    weeklyAverageHours: number;
    ctlTrend: 'RISING' | 'STABLE' | 'FALLING' | 'INSUFFICIENT_DATA';
    fatigueMarkersCount: number;
    missedSessionsCount: number;
    adherenceRatePct: number;
  };
  proposals: ProgressionProposal[];
  dataProvenance: DataProvenanceSummary;
  missingData: string[];
  uncertaintyLevel: DataUncertaintyLevel;
  interpretationLimits: string[];
  readableExplanation: string;
  isDeterministic: boolean;
}
