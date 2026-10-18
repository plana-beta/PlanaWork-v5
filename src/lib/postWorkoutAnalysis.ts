import { PlannedWorkout, ActualWorkout, Sport } from '../domain/models';
import {
  WorkoutFeedback,
  WorkoutObservation,
  AthleteHabit,
  AthletePreference,
  SimilarWorkoutsStat,
  ConfidenceLevel
} from '../domain/athleteHistoryTypes';
import { parseISO, isAfter, isBefore, startOfDay, differenceInDays } from 'date-fns';

/**
 * Comparaison déterministe entre une séance planifiée, sa réalisation réelle et le ressenti athlète.
 * Ne formule AUCUN diagnostic médical ("surentraîné", "malade", etc.).
 */
export function analyzeWorkoutExecution(params: {
  plannedWorkout?: PlannedWorkout | null;
  actualWorkout: ActualWorkout;
  feedback?: WorkoutFeedback | null;
  currentDate?: Date;
}): WorkoutObservation[] {
  const { plannedWorkout, actualWorkout, feedback } = params;
  const observations: WorkoutObservation[] = [];
  const date = actualWorkout.date || new Date().toISOString().split('T')[0];
  const now = params.currentDate ? params.currentDate.toISOString() : new Date().toISOString();

  // 1. Comparaison de durée (si séance planifiée)
  if (plannedWorkout && plannedWorkout.targetDurationMin > 0) {
    const plannedDur = plannedWorkout.targetDurationMin;
    const actualDur = actualWorkout.durationMin;
    const diff = actualDur - plannedDur;
    const ratio = actualDur / plannedDur;

    if (ratio > 1.15 && diff >= 10) {
      observations.push({
        id: `obs-dur-long-${actualWorkout.id}`,
        workoutId: plannedWorkout.id,
        actualWorkoutId: actualWorkout.id,
        date,
        type: 'DURATION_LONGER_THAN_PLANNED',
        title: 'Durée supérieure à la cible',
        description: `Durée réelle de ${actualDur} min supérieure à la durée prévue (${plannedDur} min, +${diff} min).`,
        metricsComparison: {
          plannedDuration: plannedDur,
          actualDuration: actualDur,
          plannedTss: plannedWorkout.targetTss,
          actualTss: actualWorkout.tss
        },
        createdAt: now
      });
    } else if (ratio < 0.85 && Math.abs(diff) >= 10) {
      observations.push({
        id: `obs-dur-short-${actualWorkout.id}`,
        workoutId: plannedWorkout.id,
        actualWorkoutId: actualWorkout.id,
        date,
        type: 'DURATION_SHORTER_THAN_PLANNED',
        title: 'Durée inférieure à la cible',
        description: `Durée réelle de ${actualDur} min inférieure à la durée prévue (${plannedDur} min, -${Math.abs(diff)} min).`,
        metricsComparison: {
          plannedDuration: plannedDur,
          actualDuration: actualDur,
          plannedTss: plannedWorkout.targetTss,
          actualTss: actualWorkout.tss
        },
        createdAt: now
      });
    } else {
      observations.push({
        id: `obs-dur-match-${actualWorkout.id}`,
        workoutId: plannedWorkout.id,
        actualWorkoutId: actualWorkout.id,
        date,
        type: 'WORKOUT_COMPLETED_AS_PLANNED',
        title: 'Séance réalisée comme prévu',
        description: `Volume réalisé (${actualDur} min) conforme aux prévisions (${plannedDur} min).`,
        metricsComparison: {
          plannedDuration: plannedDur,
          actualDuration: actualDur,
          plannedTss: plannedWorkout.targetTss,
          actualTss: actualWorkout.tss
        },
        createdAt: now
      });
    }
  }

  // 2. Analyse du RPE et du ressenti athlète
  if (feedback && feedback.rpe) {
    const rpe = feedback.rpe;
    const targetIntensityVal = plannedWorkout?.targetIntensity?.value?.toUpperCase() || '';
    const plannedTss = plannedWorkout?.targetTss ?? 0;
    const actualTss = actualWorkout.tss ?? 0;

    const isLightTarget =
      targetIntensityVal.includes('Z1') ||
      targetIntensityVal.includes('Z2') ||
      targetIntensityVal.includes('RÉCUP') ||
      targetIntensityVal.includes('RECUP') ||
      (plannedTss > 0 && plannedTss <= 45);

    const isHardTarget =
      targetIntensityVal.includes('Z4') ||
      targetIntensityVal.includes('Z5') ||
      targetIntensityVal.includes('PMA') ||
      targetIntensityVal.includes('SEUIL') ||
      (plannedTss >= 70 || actualTss >= 70);

    // Ressenti élevé malgré charge modérée/faible
    if (rpe >= 4 && isLightTarget) {
      observations.push({
        id: `obs-rpe-high-${actualWorkout.id}`,
        workoutId: plannedWorkout?.id,
        actualWorkoutId: actualWorkout.id,
        date,
        type: 'HIGH_PERCEIVED_EFFORT',
        title: 'Ressenti élevé sur charge modérée',
        description: `Effort perçu élevé (RPE ${rpe}/5) alors que l'intensité prévue était légère/endurance (${targetIntensityVal || 'modérée'}).`,
        metricsComparison: {
          plannedDuration: plannedWorkout?.targetDurationMin,
          actualDuration: actualWorkout.durationMin,
          plannedTss: plannedWorkout?.targetTss,
          actualTss: actualWorkout.tss,
          rpe
        },
        createdAt: now
      });
    }

    // Ressenti facile malgré charge importante
    if (rpe <= 2 && isHardTarget) {
      observations.push({
        id: `obs-rpe-low-${actualWorkout.id}`,
        workoutId: plannedWorkout?.id,
        actualWorkoutId: actualWorkout.id,
        date,
        type: 'LOW_PERCEIVED_EFFORT',
        title: 'Excellente tolérance à la charge',
        description: `Ressenti facile (RPE ${rpe}/5) malgré une séance d'intensité soutenue (${targetIntensityVal || 'charge élevée'}).`,
        metricsComparison: {
          plannedDuration: plannedWorkout?.targetDurationMin,
          actualDuration: actualWorkout.durationMin,
          plannedTss: plannedWorkout?.targetTss,
          actualTss: actualWorkout.tss,
          rpe
        },
        createdAt: now
      });
    }

    // Séance très bien vécue / positive
    if (rpe <= 2 && (feedback.feeling === 'very_good' || feedback.feeling === 'good' || !feedback.feeling)) {
      observations.push({
        id: `obs-pos-${actualWorkout.id}`,
        workoutId: plannedWorkout?.id,
        actualWorkoutId: actualWorkout.id,
        date,
        type: 'POSITIVE_WORKOUT_EXPERIENCE',
        title: 'Séance bien tolérée',
        description: `Séance vécue favorablement avec un niveau d'effort perçu bas (RPE ${rpe}/5)${feedback.feeling ? ` et état post-séance: ${feedback.feeling}` : ''}.`,
        metricsComparison: { rpe },
        createdAt: now
      });
    }

    // Fatigue post-séance élevée signalée
    if (feedback.feeling === 'very_tired') {
      observations.push({
        id: `obs-fatigue-${actualWorkout.id}`,
        workoutId: plannedWorkout?.id,
        actualWorkoutId: actualWorkout.id,
        date,
        type: 'HIGH_FATIGUE_REPORTED',
        title: 'Fatigue post-séance marquée',
        description: "L'athlète a signalé se sentir très fatigué après cette séance.",
        metricsComparison: { rpe },
        createdAt: now
      });
    }
  }

  // 3. Température réelle (uniquement si réellement disponible, aucune invention)
  const temp = actualWorkout.temperature ?? feedback?.temperature;
  if (typeof temp === 'number' && !isNaN(temp)) {
    observations.push({
      id: `obs-temp-${actualWorkout.id}`,
      workoutId: plannedWorkout?.id,
      actualWorkoutId: actualWorkout.id,
      date,
      type: 'TEMPERATURE_CONTEXT',
      title: 'Contexte thermique',
      description: `Séance enregistrée sous une température ambiante mesurée de ${temp}°C.`,
      metricsComparison: { temperature: temp },
      createdAt: now
    });
  }

  return observations;
}

/**
 * Détection des habitudes observées.
 * RÈGLE STRICTE : Une observation isolée (1 seule séance) n'est JAMAIS une habitude.
 * Nécessite au minimum 2 occurrences distinctes pour initier une habitude (confiance LOW),
 * et 3 ou plus pour une confiance MEDIUM/HIGH.
 */
export function detectAthleteHabits(
  observations: WorkoutObservation[],
  feedbacks: WorkoutFeedback[] = [],
  actualWorkouts: ActualWorkout[] = []
): AthleteHabit[] {
  const habits: AthleteHabit[] = [];
  const now = new Date().toISOString();

  // 1. RPE élevé récurrent sur intensités
  const highRpeObs = observations.filter(o => o.type === 'HIGH_PERCEIVED_EFFORT');
  if (highRpeObs.length >= 2) {
    const dates = Array.from(new Set(highRpeObs.map(o => o.date)));
    if (dates.length >= 2) {
      habits.push({
        id: 'habit-high-rpe-intensity',
        type: 'HIGH_RPE_ON_INTENSITY',
        description: "RPE souvent élevé constaté lors des séances d'intensité.",
        occurrenceCount: highRpeObs.length,
        period: `${dates.length} séances observées`,
        confidence: highRpeObs.length >= 3 ? 'HIGH' : 'MEDIUM',
        sources: highRpeObs.map(o => o.actualWorkoutId || o.id),
        lastObservedAt: highRpeObs[highRpeObs.length - 1].date || now
      });
    }
  }

  // 2. Tendance récurrente à raccourcir les séances
  const shortDurObs = observations.filter(o => o.type === 'DURATION_SHORTER_THAN_PLANNED');
  if (shortDurObs.length >= 2) {
    const dates = Array.from(new Set(shortDurObs.map(o => o.date)));
    if (dates.length >= 2) {
      habits.push({
        id: 'habit-shortening-sessions',
        type: 'SESSION_SHORTENING_TREND',
        description: 'Tendance récurrente à écourter la durée de certaines séances planifiées.',
        occurrenceCount: shortDurObs.length,
        period: `${dates.length} séances observées`,
        confidence: shortDurObs.length >= 3 ? 'HIGH' : 'LOW',
        sources: shortDurObs.map(o => o.actualWorkoutId || o.id),
        lastObservedAt: shortDurObs[shortDurObs.length - 1].date || now
      });
    }
  }

  // 3. Difficulté / fatigue après plusieurs jours consécutifs d'entraînement
  // On recherche si des feedbacks avec RPE >= 4 ou feeling 'very_tired' surviennent après >= 2 jours consécutifs d'entraînement
  const consecutiveFatigueSources: string[] = [];
  feedbacks.forEach(fb => {
    if (fb.rpe >= 4 || fb.feeling === 'very_tired') {
      try {
        const fbDate = parseISO(fb.date);
        const dayBefore1 = startOfDay(fbDate);
        dayBefore1.setDate(dayBefore1.getDate() - 1);
        const dayBefore2 = startOfDay(fbDate);
        dayBefore2.setDate(dayBefore2.getDate() - 2);

        const d1Str = dayBefore1.toISOString().split('T')[0];
        const d2Str = dayBefore2.toISOString().split('T')[0];

        const hadWorkoutDay1 = actualWorkouts.some(w => w.date === d1Str);
        const hadWorkoutDay2 = actualWorkouts.some(w => w.date === d2Str);

        if (hadWorkoutDay1 && hadWorkoutDay2) {
          consecutiveFatigueSources.push(fb.actualWorkoutId || fb.id);
        }
      } catch {
        // ignore date error
      }
    }
  });

  if (consecutiveFatigueSources.length >= 2) {
    habits.push({
      id: 'habit-consecutive-fatigue',
      type: 'FATIGUE_AFTER_CONSECUTIVE_DAYS',
      description: "Baisse de tolérance observée après 3 jours ou plus consécutifs d'entraînement.",
      occurrenceCount: consecutiveFatigueSources.length,
      period: 'Historique récent',
      confidence: consecutiveFatigueSources.length >= 3 ? 'HIGH' : 'MEDIUM',
      sources: consecutiveFatigueSources,
      lastObservedAt: now
    });
  }

  return habits;
}

/**
 * Enregistrement d'une préférence explicite de l'athlète.
 */
export function registerPreference(params: {
  id?: string;
  category: AthletePreference['category'];
  statement: string;
  isConfirmed: boolean;
  type?: AthletePreference['type'];
  startDate?: string;
  endDate?: string;
  source?: AthletePreference['source'];
}): AthletePreference {
  return {
    id: params.id || `pref-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    category: params.category,
    statement: params.statement,
    isConfirmed: params.isConfirmed,
    type: params.type || 'PERSISTENT',
    startDate: params.startDate,
    endDate: params.endDate,
    source: params.source || 'user_explicit',
    createdAt: new Date().toISOString()
  };
}

/**
 * Enregistrement d'une préférence négative (Dislike).
 * RÈGLE PRODUIT : Une préférence négative persistante ne doit être mémorisée
 * qu'après confirmation explicite de l'athlète.
 * Sans confirmation -> retourne null (aucun enregistrement permanent).
 */
export function registerDislikePreference(params: {
  statement: string;
  isConfirmed: boolean;
  source?: AthletePreference['source'];
}): AthletePreference | null {
  if (!params.isConfirmed) {
    // Sans confirmation : ne crée pas de préférence persistante
    return null;
  }

  return registerPreference({
    category: 'dislike',
    statement: params.statement,
    isConfirmed: true,
    type: 'PERSISTENT',
    source: params.source || 'coach_confirmed'
  });
}

/**
 * Filtre les préférences actives, en excluant les préférences temporaires expirées.
 */
export function filterActivePreferences(
  preferences: AthletePreference[],
  currentDate: Date = new Date()
): AthletePreference[] {
  const today = startOfDay(currentDate);

  return preferences.filter(pref => {
    if (!pref.isConfirmed) return false;
    if (pref.type === 'TEMPORARY' && pref.endDate) {
      try {
        const end = startOfDay(parseISO(pref.endDate));
        // Si la date de fin est passée, la préférence a expiré
        if (isBefore(end, today)) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  });
}

/**
 * Recherche de séances similaires passées.
 * Critères : même sport, durée approchante (±25%), et intensité comparable.
 */
export function findSimilarWorkouts(
  target: { sport: Sport; durationMin: number; intensity?: unknown },
  actualWorkouts: ActualWorkout[],
  feedbacks: WorkoutFeedback[]
): {
  matchedWorkouts: ActualWorkout[];
  matchedFeedbacks: WorkoutFeedback[];
} {
  const matchedWorkouts: ActualWorkout[] = [];
  const matchedFeedbacks: WorkoutFeedback[] = [];

  const targetSport = target.sport;
  const targetDuration = target.durationMin || 60;
  const minDur = targetDuration * 0.75;
  const maxDur = targetDuration * 1.25;

  actualWorkouts.forEach(workout => {
    if (workout.sport === targetSport && workout.durationMin >= minDur && workout.durationMin <= maxDur) {
      matchedWorkouts.push(workout);
      const fb = feedbacks.find(
        f => (f.actualWorkoutId && f.actualWorkoutId === workout.id) ||
             (f.workoutId && f.workoutId === workout.plannedWorkoutId) ||
             (f.date === workout.date && f.sport === workout.sport)
      );
      if (fb) {
        matchedFeedbacks.push(fb);
      }
    }
  });

  return { matchedWorkouts, matchedFeedbacks };
}

/**
 * Calcul des statistiques sur les séances similaires.
 * RÈGLE STRICTE : Ne créer cette statistique que si au moins 3 séances similaires existent.
 * Sinon : INSUFFICIENT_DATA. Ne jamais inventer une comparaison.
 */
export function calculateSimilarWorkoutsStat(
  target: { sport: Sport; durationMin: number; intensity?: unknown },
  actualWorkouts: ActualWorkout[],
  feedbacks: WorkoutFeedback[]
): SimilarWorkoutsStat {
  const { matchedWorkouts, matchedFeedbacks } = findSimilarWorkouts(target, actualWorkouts, feedbacks);

  // Exigence : au moins 3 séances comparables avec retour ou données objectives
  if (matchedWorkouts.length < 3) {
    return {
      status: 'INSUFFICIENT_DATA',
      sport: target.sport,
      sampleSize: matchedWorkouts.length,
      summary: "Données insuffisantes pour établir des statistiques sur les séances similaires (moins de 3 séances comparables observées)."
    };
  }

  const totalDur = matchedWorkouts.reduce((sum, w) => sum + w.durationMin, 0);
  const avgDur = Math.round(totalDur / matchedWorkouts.length);

  const tssList = matchedWorkouts.map(w => w.tss).filter((t): t is number => typeof t === 'number' && t > 0);
  const avgTss = tssList.length > 0 ? Math.round(tssList.reduce((a, b) => a + b, 0) / tssList.length) : undefined;

  let avgRpe: number | undefined;
  if (matchedFeedbacks.length >= 2) {
    const totalRpe = matchedFeedbacks.reduce((sum, f) => sum + f.rpe, 0);
    avgRpe = Number((totalRpe / matchedFeedbacks.length).toFixed(1));
  }

  const summary = avgRpe
    ? `Sur tes ${matchedWorkouts.length} dernières séances similaires en ${target.sport}, le RPE moyen était de ${avgRpe}/5.`
    : `Sur tes ${matchedWorkouts.length} dernières séances similaires en ${target.sport}, la durée moyenne était de ${avgDur} min.`;

  return {
    status: 'AVAILABLE',
    sport: target.sport,
    sampleSize: matchedWorkouts.length,
    averageRpe: avgRpe,
    averageDurationMin: avgDur,
    averageTss: avgTss,
    summary
  };
}
