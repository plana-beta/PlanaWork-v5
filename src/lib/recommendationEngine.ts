import { AthleteProfile, PlannedWorkout, ActualWorkout, Recommendation } from '../domain/models';
import { PmcData } from '../types';
import { format, startOfDay, differenceInDays, parseISO } from 'date-fns';

export function generateRecommendations(
  profile: AthleteProfile | null,
  plannedWorkouts: PlannedWorkout[],
  actualWorkouts: ActualWorkout[],
  pmc: PmcData[],
  currentDate: Date = new Date()
): Recommendation[] {
  if (!profile) return [];

  const recommendations: Recommendation[] = [];
  const todayStart = startOfDay(currentDate);
  const todayStr = format(todayStart, 'yyyy-MM-dd');
  const nowIso = currentDate.toISOString();

  let idCounter = 1;
  const genId = (type: string) => `${todayStr}-${type}-${idCounter++}`;

  const todayPmc = pmc.find(p => p.date === todayStr);
  const currentPmc = todayPmc || (pmc.length > 0 ? pmc[pmc.length - 1] : null);
  
  if (currentPmc && (currentPmc.tsb < -20 || currentPmc.atl > 80)) {
    recommendations.push({
      id: genId('RECOVERY'),
      type: 'RECOVERY',
      priority: 'HIGH',
      title: "Privilégie la récupération",
      message: "Ta fatigue est élevée aujourd'hui. Tu gagnerais à récupérer avant ta prochaine séance intense.",
      createdAt: nowIso
    });
  }

  const todayWorkout = plannedWorkouts.find(w => w.date === todayStr);
  if (todayWorkout && todayWorkout.status !== 'completed' && todayWorkout.status !== 'missed') {
    recommendations.push({
      id: genId('TODAY_WORKOUT'),
      type: 'TODAY_WORKOUT',
      priority: 'HIGH',
      title: "Ta séance du jour",
      message: `${todayWorkout.targetDurationMin} min de ${todayWorkout.sport === 'Run' ? 'course' : todayWorkout.sport === 'Ride' ? 'vélo' : todayWorkout.sport === 'Swim' ? 'natation' : 'renforcement'}.`,
      reason: todayWorkout.explanation || "Cette séance développe tes capacités.",
      relatedWorkoutId: todayWorkout.id,
      createdAt: nowIso
    });
  }

  if (todayWorkout && todayWorkout.status === 'adapted') {
    recommendations.push({
      id: genId('PLAN_ADAPTED'),
      type: 'PLAN_ADAPTED',
      priority: 'MEDIUM',
      title: "Ton plan a été ajusté",
      message: "La séance d'aujourd'hui a été modifiée.",
      reason: todayWorkout.explanation || "Cette adaptation tient compte de ta récupération.",
      relatedWorkoutId: todayWorkout.id,
      createdAt: nowIso
    });
  }

  const recentMissed = plannedWorkouts.filter(w => 
    w.status === 'missed' && 
    differenceInDays(todayStart, parseISO(w.date)) <= 7 &&
    differenceInDays(todayStart, parseISO(w.date)) > 0
  );

  if (recentMissed.length > 0) {
    recommendations.push({
      id: genId('MISSED_WORKOUT'),
      type: 'MISSED_WORKOUT',
      priority: 'MEDIUM',
      title: "Séance manquée",
      message: "Une séance manquée n'annule pas ta progression. Ton planning reste équilibré, inutile de tout rattraper.",
      createdAt: nowIso
    });
  }

  if (pmc.length >= 14) {
    const pmc14DaysAgo = pmc[pmc.length - 14];
    const latestPmc = pmc[pmc.length - 1];
    if (latestPmc.ctl > pmc14DaysAgo.ctl + 2) {
      recommendations.push({
        id: genId('PROGRESS'),
        type: 'PROGRESS',
        priority: 'MEDIUM',
        title: "Ta régularité porte ses fruits",
        message: "Ta charge d'entraînement évolue de manière cohérente ces dernières semaines.",
        createdAt: nowIso
      });
    }
  }

  if (profile.goal && profile.goal.date) {
    const goalDate = parseISO(profile.goal.date);
    const daysToGoal = differenceInDays(goalDate, todayStart);
    
    if (daysToGoal >= 0) {
      let msg = "";
      if (daysToGoal > 30) {
        msg = "Continue à construire ta base foncière. L'objectif est encore loin, la régularité est clé.";
      } else if (daysToGoal >= 15) {
        msg = "Dernier cycle de préparation avant l'affûtage. Reste concentré sur la qualité de tes séances.";
      } else if (daysToGoal >= 8) {
        msg = "Tu entres progressivement dans la période d'affûtage. Garde de l'intensité mais réduis la fatigue.";
      } else {
        msg = "Semaine de course ! Repose-toi, fais du jus, le travail est déjà fait.";
      }
      recommendations.push({
        id: genId('GOAL'),
        type: 'GOAL',
        priority: 'MEDIUM',
        title: `Objectif : ${profile.goal.title}`,
        message: msg,
        createdAt: nowIso
      });
    }
  }

  if (!todayWorkout) {
    recommendations.push({
      id: genId('INFO'),
      type: 'INFO',
      priority: 'LOW',
      title: "Repos aujourd'hui",
      message: "La récupération fait partie intégrante de ta progression.",
      createdAt: nowIso
    });
  }

  if (profile.dataConnection !== 'none' && actualWorkouts.length > 0) {
    const sortedActuals = [...actualWorkouts].sort((a, b) => b.date.localeCompare(a.date));
    const latestActualDate = parseISO(sortedActuals[0].date);
    const daysSinceSync = differenceInDays(todayStart, latestActualDate);
    if (daysSinceSync >= 3) {
      recommendations.push({
        id: genId('HEALTH_SYNC'),
        type: 'HEALTH_SYNC',
        priority: 'LOW',
        title: "Pense à synchroniser tes activités",
        message: `Aucune nouvelle donnée depuis ${daysSinceSync} jours.`,
        createdAt: nowIso
      });
    }
  }

  const typeOrder: Record<string, number> = {
    'RECOVERY': 1,
    'TODAY_WORKOUT': 2,
    'PLAN_ADAPTED': 3,
    'MISSED_WORKOUT': 4,
    'GOAL': 5,
    'PROGRESS': 6,
    'HEALTH_SYNC': 7,
    'INFO': 8,
    'WARNING': 9
  };

  recommendations.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);

  return recommendations;
}
