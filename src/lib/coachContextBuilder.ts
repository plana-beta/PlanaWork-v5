import { ActualWorkout, PlannedWorkout, AthleteProfile } from '../domain/models';
import { PmcData } from '../types';
import { ConfidenceAssessment, ConfidenceLevel, AthleteTolerance } from '../domain/coachTypes';
import {
  WorkoutFeedback,
  WorkoutObservation,
  AthleteHabit,
  AthletePreference,
  SimilarWorkoutsStat
} from '../domain/athleteHistoryTypes';
import {
  TemporaryAvailability,
  IllnessEpisode,
  InjuryEpisode,
  RecoveryLog,
  PermanentAvailability
} from '../domain/athleteMemoryTypes';
import { calculateSimilarWorkoutsStat, filterActivePreferences } from './postWorkoutAnalysis';
import {
  filterActiveAndUnconflictedPreferences,
  isTemporaryAvailabilityActive
} from './athleteMemoryManager';
import { getFatigueLevel } from './adaptationEngine';
import { calculateDurationTSS } from './trainingEngine';
import { parseISO, differenceInDays, startOfDay, startOfWeek, endOfWeek, isWithinInterval, format } from 'date-fns';

/**
 * Évalue le niveau de confiance statistique des données athlète.
 * Si l'historique est < 4 semaines (28 jours), le statut DOIT être INSUFFICIENT_DATA.
 */
export function buildConfidenceAssessment(
  actualWorkouts: ActualWorkout[],
  currentDate: Date = new Date()
): ConfidenceAssessment {
  if (!actualWorkouts || actualWorkouts.length === 0) {
    return {
      level: 'INSUFFICIENT_DATA',
      reasons: ["Aucun historique d'entraînement enregistré."],
      historyWeeks: 0,
      recentWorkoutsCount: 0
    };
  }

  const today = startOfDay(currentDate);

  // Trouver la date la plus ancienne
  const validDates = actualWorkouts
    .map(w => {
      try {
        return parseISO(w.date);
      } catch {
        return null;
      }
    })
    .filter((d): d is Date => d !== null && !isNaN(d.getTime()));

  if (validDates.length === 0) {
    return {
      level: 'INSUFFICIENT_DATA',
      reasons: ["Dates d'entraînement invalides."],
      historyWeeks: 0,
      recentWorkoutsCount: 0
    };
  }

  validDates.sort((a, b) => a.getTime() - b.getTime());
  const earliestDate = startOfDay(validDates[0]);
  const totalDays = Math.max(0, differenceInDays(today, earliestDate));
  const historyWeeks = Math.floor(totalDays / 7);

  // Compter les séances récentes (14 derniers jours)
  const recentWorkouts = actualWorkouts.filter(w => {
    try {
      const d = startOfDay(parseISO(w.date));
      const diff = differenceInDays(today, d);
      return diff >= 0 && diff <= 14;
    } catch {
      return false;
    }
  });

  const recentCount = recentWorkouts.length;

  // RÈGLE STRICTE: < 4 semaines = INSUFFICIENT_DATA
  if (historyWeeks < 4) {
    return {
      level: 'INSUFFICIENT_DATA',
      reasons: [
        `Historique inférieur à 4 semaines (${historyWeeks} semaine(s) observée(s), ${totalDays} jours). Données insuffisantes pour établir une tolérance statistique.`
      ],
      historyWeeks,
      recentWorkoutsCount: recentCount
    };
  }

  // Historique >= 4 semaines : évaluation de la régularité récente
  if (recentCount < 3) {
    return {
      level: 'LOW',
      reasons: [
        `Historique suffisant en durée (${historyWeeks} sem.), mais faible volume récent (${recentCount} séance(s) sur les 14 derniers jours).`
      ],
      historyWeeks,
      recentWorkoutsCount: recentCount
    };
  }

  if (recentCount < 6) {
    return {
      level: 'MEDIUM',
      reasons: [
        `Historique régulier (${historyWeeks} sem., ${recentCount} séances récentes).`
      ],
      historyWeeks,
      recentWorkoutsCount: recentCount
    };
  }

  return {
    level: 'HIGH',
    reasons: [
      `Historique complet et cohérent (${historyWeeks} sem., ${recentCount} séances sur les 14 derniers jours).`
    ],
    historyWeeks,
    recentWorkoutsCount: recentCount
  };
}

/**
 * Dérive la tolérance statistique observée depuis l'historique Plana.
 * Si le niveau de confiance est INSUFFICIENT_DATA, retourne null.
 */
export function calculateObservedTolerance(
  actualWorkouts: ActualWorkout[],
  confidence: ConfidenceAssessment
): AthleteTolerance | null {
  if (confidence.level === 'INSUFFICIENT_DATA' || actualWorkouts.length === 0) {
    return null;
  }

  // Grouper les TSS par semaine (clé YYYY-WW)
  const weekTssMap = new Map<string, number>();

  actualWorkouts.forEach(w => {
    try {
      const d = parseISO(w.date);
      const weekStart = startOfWeek(d, { weekStartsOn: 1 });
      const weekKey = weekStart.toISOString().split('T')[0];
      const tss = w.tss || (w.durationMin ? calculateDurationTSS(w.durationMin) : 0);
      weekTssMap.set(weekKey, (weekTssMap.get(weekKey) || 0) + tss);
    } catch {
      // ignore
    }
  });

  const weeklyTotals = Array.from(weekTssMap.values()).filter(t => t > 0);
  if (weeklyTotals.length === 0) return null;

  weeklyTotals.sort((a, b) => a - b);
  const mid = Math.floor(weeklyTotals.length / 2);
  const medianWeeklyTss = weeklyTotals.length % 2 !== 0
    ? weeklyTotals[mid]
    : Math.round((weeklyTotals[mid - 1] + weeklyTotals[mid]) / 2);

  return {
    metric: 'weekly_tss',
    value: medianWeeklyTss,
    sampleSize: weeklyTotals.length,
    confidence: confidence.level,
    period: `${confidence.historyWeeks} semaines`,
    source: 'Plana TrainingEngine ActualWorkouts',
    disclaimer: "Historically observed tolerance: observation statistique d'après l'historique, ne constitue en aucun cas une garantie de sécurité."
  };
}

/**
 * Calcule la charge hebdomadaire totale prévue pour la semaine d'une date cible.
 * Utilise la semaine calendaire (lundi au dimanche).
 */
export function calculateWeeklyPlannedLoad(
  plannedWorkouts: PlannedWorkout[],
  targetDate: Date = new Date()
): number {
  const weekStart = startOfWeek(targetDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(targetDate, { weekStartsOn: 1 });

  return plannedWorkouts
    .filter(p => {
      try {
        const d = parseISO(p.date);
        return isWithinInterval(d, { start: weekStart, end: weekEnd });
      } catch {
        return false;
      }
    })
    .reduce((sum, p) => {
      const tss = p.targetTss != null && p.targetTss > 0
        ? p.targetTss
        : calculateDurationTSS(p.targetDurationMin);
      return sum + tss;
    }, 0);
}

/**
 * Contexte consolidé pour le Coach IA
 */
export interface BuiltCoachContext {
  profile: {
    level: AthleteProfile['level'];
    goal?: AthleteProfile['goal'];
    availability: AthleteProfile['availability'];
  } | null;
  todayWorkout: {
    id: string;
    sport: string;
    durationMin?: number;
    intensity?: unknown;
    targetDurationMin?: number;
    targetIntensity?: unknown;
    targetTss?: number;
    title?: string;
    date?: string;
    status?: string;
    explanation?: string;
    [key: string]: unknown;
  } | null;
  upcomingWorkouts?: Array<any>;
  recentWorkouts: Array<{
    date: string;
    sport: string;
    durationMin: number;
    tss?: number;
  }>;
  recentActuals?: any[];
  pmcStatus: {
    ctl: number;
    atl: number;
    tsb: number;
    fatigueLevel: 'normal' | 'high' | 'extreme' | 'optimal';
  } | null;
  weeklyPlannedLoad: number;
  confidence: ConfidenceAssessment;
  tolerance?: AthleteTolerance | null;
  historySummary?: {
    completedWorkoutsCount?: number;
    missedWorkoutsCount?: number;
    complianceRate?: number;
    lastCoachDecisions?: any[];
  };
  availability?: {
    availableDays: string[];
    temporaryBlockedDates?: string[];
  };
  // Phase 29: Post-Workout Feedback & Athlete History
  recentFeedbacks?: Array<{
    date: string;
    sport: string;
    rpe: number;
    feeling?: string;
    comment?: string;
  }>;
  recentObservations?: Array<{
    date: string;
    type: string;
    description: string;
  }>;
  habits?: Array<{
    type: string;
    description: string;
    confidence: string;
  }>;
  activePreferences?: Array<{
    statement: string;
    category: string;
  }>;
  similarWorkoutsStat?: SimilarWorkoutsStat;
  // Phase 30: Adaptive Coach Context & Athlete Memory
  currentAvailability?: {
    permanent: PermanentAvailability | null;
    temporaryActive?: TemporaryAvailability;
    isAvailableToday: boolean;
    note?: string;
  };
  healthStatus?: {
    activeIllness?: { declaredSymptoms?: string[]; impactOnTraining: string };
    activeInjury?: { declaredIssue: string; impactOnTraining: string };
  };
  todayQueryAnalysis?: {
    flowStepsCompleted: string[];
    missingCriticalDataQuestions: string[];
    recommendationContextSummary: string;
  };
}

export interface BuildCoachContextHistoryOptions {
  feedbacks?: WorkoutFeedback[];
  observations?: WorkoutObservation[];
  habits?: AthleteHabit[];
  preferences?: AthletePreference[];
  temporaryAvailabilities?: TemporaryAvailability[];
  illnessEpisodes?: IllnessEpisode[];
  injuryEpisodes?: InjuryEpisode[];
  recoveryLogs?: RecoveryLog[];
}

export function buildCoachContext(
  profile: AthleteProfile | null,
  plannedWorkouts: PlannedWorkout[],
  actualWorkouts: ActualWorkout[],
  pmc: PmcData[],
  currentDate: Date = new Date(),
  historyOptions?: BuildCoachContextHistoryOptions
): BuiltCoachContext {
  const todayStr = startOfDay(currentDate).toISOString().split('T')[0];

  const confidence = buildConfidenceAssessment(actualWorkouts, currentDate);
  const tolerance = calculateObservedTolerance(actualWorkouts, confidence);
  const weeklyPlannedLoad = calculateWeeklyPlannedLoad(plannedWorkouts, currentDate);

  const todayWorkout = plannedWorkouts.find(p => p.date === todayStr);

  const sortedActuals = [...actualWorkouts].sort((a, b) => b.date.localeCompare(a.date));
  const recentWorkouts = sortedActuals.slice(0, 5).map(w => ({
    date: w.date,
    sport: w.sport,
    durationMin: w.durationMin,
    tss: w.tss
  }));

  const currentPmc = pmc.find(p => p.date === todayStr) || (pmc.length > 0 ? pmc[pmc.length - 1] : null);
  const fatigueLevel = getFatigueLevel(currentPmc);

  // Phase 29 & 30: History and Memory enrichment
  const feedbacks = historyOptions?.feedbacks || [];
  const sortedFeedbacks = [...feedbacks].sort((a, b) => b.date.localeCompare(a.date));
  const recentFeedbacks = sortedFeedbacks.slice(0, 3).map(f => ({
    date: f.date,
    sport: f.sport,
    rpe: f.rpe,
    feeling: f.feeling,
    comment: f.comment
  }));

  const observations = historyOptions?.observations || [];
  const sortedObs = [...observations].sort((a, b) => b.date.localeCompare(a.date));
  const recentObservations = sortedObs.slice(0, 4).map(o => ({
    date: o.date,
    type: o.type,
    description: o.description
  }));

  const rawHabits = historyOptions?.habits || [];
  const habits = rawHabits.map(h => ({
    type: h.type,
    description: h.description,
    confidence: h.confidence
  }));

  // Résolution déterministe des conflits et filtrage d'expiration
  const rawPrefs = historyOptions?.preferences || [];
  const activePrefs = filterActiveAndUnconflictedPreferences(rawPrefs, currentDate);
  const activePreferences = activePrefs.map(p => ({
    statement: p.statement,
    category: p.category
  }));

  let similarWorkoutsStat: SimilarWorkoutsStat | undefined;
  if (todayWorkout) {
    similarWorkoutsStat = calculateSimilarWorkoutsStat(
      { sport: todayWorkout.sport, durationMin: todayWorkout.targetDurationMin, intensity: todayWorkout.targetIntensity },
      actualWorkouts,
      feedbacks
    );
  } else if (recentWorkouts.length > 0) {
    similarWorkoutsStat = calculateSimilarWorkoutsStat(
      { sport: recentWorkouts[0].sport as any, durationMin: recentWorkouts[0].durationMin },
      actualWorkouts,
      feedbacks
    );
  }

  // Phase 30: Disponibilité actuelle (permanente vs temporaire)
  let currentAvailability: BuiltCoachContext['currentAvailability'];
  const dayOfWeek = format(currentDate, 'EEEE').toLowerCase(); // e.g. 'monday'
  const tempAvails = historyOptions?.temporaryAvailabilities || [];
  const activeTempAvail = tempAvails.find(t => isTemporaryAvailabilityActive(t, currentDate));

  let isAvailableToday = true;
  let availNote: string | undefined;

  if (activeTempAvail) {
    if (activeTempAvail.blockedDates?.includes(todayStr)) {
      isAvailableToday = false;
      availNote = `Indisponibilité temporaire déclarée aujourd'hui: ${activeTempAvail.reason || 'bloqué'}`;
    } else if (activeTempAvail.extraAvailableDates?.includes(todayStr)) {
      isAvailableToday = true;
      availNote = `Disponibilité temporaire exceptionnelle aujourd'hui: ${activeTempAvail.reason || 'disponible'}`;
    }
  } else if (profile?.availability?.availableDays) {
    const days = profile.availability.availableDays.map(d => d.toLowerCase());
    isAvailableToday = days.includes(dayOfWeek) || days.length === 0;
  }

  currentAvailability = {
    permanent: profile?.availability ? {
      weeklyHours: profile.availability.weeklyHours,
      availableDays: profile.availability.availableDays
    } : null,
    temporaryActive: activeTempAvail,
    isAvailableToday,
    note: availNote
  };

  // Phase 30: Statut de santé (Maladies et Blessures déclarées - aucun diagnostic)
  let healthStatus: BuiltCoachContext['healthStatus'];
  const illnesses = historyOptions?.illnessEpisodes || [];
  const injuries = historyOptions?.injuryEpisodes || [];

  const activeIllness = illnesses.find(i => i.status === 'active');
  const activeInjury = injuries.find(i => i.status === 'active');

  if (activeIllness || activeInjury) {
    healthStatus = {
      activeIllness: activeIllness ? {
        declaredSymptoms: activeIllness.declaredSymptoms,
        impactOnTraining: activeIllness.impactOnTraining
      } : undefined,
      activeInjury: activeInjury ? {
        declaredIssue: activeInjury.declaredIssue,
        impactOnTraining: activeInjury.impactOnTraining
      } : undefined
    };
  }

  return {
    profile: profile ? {
      level: profile.level,
      goal: profile.goal,
      availability: profile.availability
    } : null,
    todayWorkout: todayWorkout ? {
      id: todayWorkout.id,
      sport: todayWorkout.sport,
      durationMin: todayWorkout.targetDurationMin,
      intensity: todayWorkout.targetIntensity,
      status: todayWorkout.status,
      explanation: todayWorkout.explanation
    } : null,
    recentWorkouts,
    pmcStatus: currentPmc ? {
      ctl: Math.round(currentPmc.ctl),
      atl: Math.round(currentPmc.atl),
      tsb: Math.round(currentPmc.tsb),
      fatigueLevel
    } : null,
    weeklyPlannedLoad,
    confidence,
    tolerance,
    recentFeedbacks: recentFeedbacks.length > 0 ? recentFeedbacks : undefined,
    recentObservations: recentObservations.length > 0 ? recentObservations : undefined,
    habits: habits.length > 0 ? habits : undefined,
    activePreferences: activePreferences.length > 0 ? activePreferences : undefined,
    similarWorkoutsStat,
    currentAvailability,
    healthStatus
  };
}

/**
 * Phase 30: Requête "Que dois-je faire aujourd'hui ?"
 * Exécute les 10 étapes déterministes d'analyse Plana.
 * Si une information essentielle manque, formule au maximum 1 à 2 questions ciblées.
 * Si les données suffisent, ne formule aucune question.
 */
export function buildTodayWorkoutQueryContext(params: {
  profile: AthleteProfile | null;
  plannedWorkouts: PlannedWorkout[];
  actualWorkouts: ActualWorkout[];
  pmc: PmcData[];
  currentDate?: Date;
  historyOptions?: BuildCoachContextHistoryOptions;
}): {
  coachContext: BuiltCoachContext;
  stepsCompleted: string[];
  missingQuestions: string[];
  recommendationSummary: string;
} {
  const currentDate = params.currentDate || new Date();
  const todayStr = startOfDay(currentDate).toISOString().split('T')[0];

  const baseContext = buildCoachContext(
    params.profile,
    params.plannedWorkouts,
    params.actualWorkouts,
    params.pmc,
    currentDate,
    params.historyOptions
  );

  const stepsCompleted: string[] = [
    '1. Consultation de la séance prévue aujourd’hui',
    '2. Analyse des séances récentes réalisées',
    '3. Analyse de la charge et du volume hebdomadaire',
    '4. Analyse du niveau de fatigue aigu (PMC)',
    '5. Analyse de la récupération disponible',
    '6. Analyse du feedback récent de l’athlète',
    '7. Analyse des habitudes récurrentes pertinentes',
    '8. Analyse des préférences actives de l’athlète',
    '9. Analyse de l’objectif cible',
    '10. Évaluation des données manquantes critiques'
  ];

  const missingQuestions: string[] = [];

  // Vérification de récupération / fatigue du matin
  const recoveryLogs = params.historyOptions?.recoveryLogs || [];
  const todayRecovery = recoveryLogs.find(r => r.date === todayStr);

  if (baseContext.todayWorkout && !todayRecovery) {
    // Si la séance du jour existe et qu'aucun état de forme matinal n'a été saisi
    if (baseContext.pmcStatus?.fatigueLevel === 'high' || baseContext.pmcStatus?.fatigueLevel === 'extreme') {
      missingQuestions.push('Comment te sens-tu ce matin de 1 à 5 ?');
    }
  }

  // Vérification de la disponibilité temporelle si séance longue (> 60 min)
  if (baseContext.todayWorkout && baseContext.todayWorkout.durationMin >= 90) {
    const isExplicitlyKnown = baseContext.currentAvailability?.note != null;
    if (!isExplicitlyKnown && missingQuestions.length < 2) {
      missingQuestions.push(`As-tu bien ${Math.floor(baseContext.todayWorkout.durationMin / 60)}h${baseContext.todayWorkout.durationMin % 60 ? (baseContext.todayWorkout.durationMin % 60).toString().padStart(2, '0') : '00'} disponible aujourd'hui ?`);
    }
  }

  let recommendationSummary = '';
  if (baseContext.healthStatus?.activeIllness) {
    recommendationSummary = "Épisode de maladie déclaré en cours : repos complet ou reprise très prudente recommandé.";
  } else if (baseContext.healthStatus?.activeInjury) {
    recommendationSummary = `Gêne déclarée en cours (${baseContext.healthStatus.activeInjury.declaredIssue}) : adaptation requise.`;
  } else if (!baseContext.todayWorkout) {
    recommendationSummary = "Aucune séance planifiée aujourd'hui : journée de repos ou récupération active libre.";
  } else if (baseContext.todayWorkout) {
    recommendationSummary = `Séance prévue : ${baseContext.todayWorkout.sport} de ${baseContext.todayWorkout.durationMin} min. Charge hebdomadaire prévue : ${baseContext.weeklyPlannedLoad} TSS.`;
  }

  return {
    coachContext: {
      ...baseContext,
      todayQueryAnalysis: {
        flowStepsCompleted: stepsCompleted,
        missingCriticalDataQuestions: missingQuestions.slice(0, 2), // Maximum 1 à 2 questions
        recommendationContextSummary: recommendationSummary
      }
    },
    stepsCompleted,
    missingQuestions: missingQuestions.slice(0, 2),
    recommendationSummary
  };
}
