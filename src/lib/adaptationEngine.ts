import { AthleteProfile, PlannedWorkout, ActualWorkout } from '../domain/models';
import { PmcData } from '../types';
import { isBefore, startOfDay, format, parseISO, differenceInDays } from 'date-fns';

export interface AdaptationChange {
  workoutId: string;
  originalDate: string;
  newDate?: string;
  originalDuration: number;
  newDuration?: number;
  originalIntensity?: string;
  newIntensity?: string;
  reason: string;
  type: 'missed' | 'reduced' | 'cancelled' | 'status_updated';
}

export interface AdaptationResult {
  changed: boolean;
  reason: string;
  changes: AdaptationChange[];
  updatedPlannedWorkouts: PlannedWorkout[];
  generatedAt: string;
}

export type FatigueLevel = 'normal' | 'high' | 'extreme';

export function getFatigueLevel(pmc: { tsb: number; atl: number } | null | undefined): FatigueLevel {
  if (!pmc) return 'normal';
  if (pmc.tsb < -30) return 'extreme';
  if (pmc.tsb < -20 || pmc.atl > 80) return 'high';
  return 'normal';
}

export function adaptPlan(
  profile: AthleteProfile,
  plannedWorkouts: PlannedWorkout[],
  actualWorkouts: ActualWorkout[],
  pmc: PmcData[],
  currentDate: Date = new Date()
): AdaptationResult {
  const result: AdaptationResult = {
    changed: false,
    reason: "Aucune adaptation nécessaire.",
    changes: [],
    updatedPlannedWorkouts: JSON.parse(JSON.stringify(plannedWorkouts)), // Deep copy
    generatedAt: currentDate.toISOString()
  };

  if (!profile || result.updatedPlannedWorkouts.length === 0) {
    return result;
  }

  const todayStart = startOfDay(currentDate);
  const todayStr = format(todayStart, 'yyyy-MM-dd');
  
  // Try to get today's PMC, or the last available one
  const todayPmc = pmc.find(p => p.date === todayStr);
  const currentPmc = todayPmc || (pmc.length > 0 ? pmc[pmc.length - 1] : { tsb: 0, atl: 0, ctl: 0, tss: 0, date: todayStr });

  const fatigueLevel = getFatigueLevel(currentPmc);

  // Let's sort to iterate chronologically
  result.updatedPlannedWorkouts.sort((a, b) => a.date.localeCompare(b.date));

  for (let i = 0; i < result.updatedPlannedWorkouts.length; i++) {
    const planned = result.updatedPlannedWorkouts[i];
    const plannedDate = startOfDay(parseISO(planned.date));
    
    // Find matching actual workout
    const matchedActuals = actualWorkouts.filter(a => 
      a.plannedWorkoutId === planned.id || 
      (!a.plannedWorkoutId && a.date === planned.date && a.sport === planned.sport)
    );

    const isPast = isBefore(plannedDate, todayStart);
    
    if (isPast) {
      if (matchedActuals.length === 0) {
         if (planned.status !== 'missed' && planned.status !== 'completed' && planned.status !== 'adapted') {
            planned.status = 'missed';
            result.changes.push({
               workoutId: planned.id,
               originalDate: planned.date,
               originalDuration: planned.targetDurationMin,
               type: 'missed',
               reason: 'Séance non réalisée.'
            });
            result.changed = true;
         }
      } else {
         if (planned.status !== 'completed') {
             planned.status = 'completed';
             result.changed = true;
         }
         
         // Too hard detection
         const actualDuration = matchedActuals.reduce((acc, a) => acc + (a.durationMin || 0), 0);
         if (actualDuration > planned.targetDurationMin * 1.3) {
            const nextPlannedIdx = result.updatedPlannedWorkouts.findIndex((p, idx) => idx > i && (p.status === 'planned' || p.status === 'adapted'));
            if (nextPlannedIdx !== -1) {
               const nextP = result.updatedPlannedWorkouts[nextPlannedIdx];
               if (differenceInDays(parseISO(nextP.date), plannedDate) <= 2) {
                  if (nextP.status !== 'adapted' && nextP.targetDurationMin > 30) {
                     const newDuration = Math.max(20, Math.round(nextP.targetDurationMin * 0.75));
                     result.changes.push({
                        workoutId: nextP.id,
                        originalDate: nextP.date,
                        originalDuration: nextP.targetDurationMin,
                        newDuration: newDuration,
                        type: 'reduced',
                        reason: 'Volume réduit suite à un dépassement important lors de la séance précédente.'
                     });
                     nextP.targetDurationMin = newDuration;
                     nextP.status = 'adapted';
                     nextP.explanation = 'Volume réduit suite à un dépassement important lors de la séance précédente.';
                     result.changed = true;
                  }
               }
            }
         }
      }
    } else {
      // Future or Today
      if (planned.status === 'planned' || planned.status === 'adapted') {
         if (fatigueLevel === 'high' || fatigueLevel === 'extreme') {
            // Downgrade intensity
            if (planned.targetIntensity.value === 'Z4' || planned.targetIntensity.value === 'Z5' || planned.title.toLowerCase().includes('interval')) {
               result.changes.push({
                  workoutId: planned.id,
                  originalDate: planned.date,
                  originalDuration: planned.targetDurationMin,
                  originalIntensity: planned.targetIntensity.value,
                  newIntensity: 'Z2',
                  type: 'reduced',
                  reason: "Mise au repos / Allègement en raison d'une fatigue élevée."
               });
               
               planned.targetIntensity.value = 'Z2';
               planned.title = planned.title.replace('Intervalles', 'Endurance');
               planned.explanation = "Séance allégée en raison d'une fatigue élevée. On favorise la récupération.";
               planned.status = 'adapted';
               result.changed = true;
            } else if (fatigueLevel === 'extreme' && planned.targetDurationMin > 45 && !planned.explanation?.includes('Volume réduit')) {
               // Reduce volume
               const newDuration = Math.max(30, Math.round(planned.targetDurationMin * 0.6));
               result.changes.push({
                  workoutId: planned.id,
                  originalDate: planned.date,
                  originalDuration: planned.targetDurationMin,
                  newDuration: newDuration,
                  type: 'reduced',
                  reason: "Volume réduit pour préserver la récupération (fatigue extrême)."
               });
               planned.targetDurationMin = newDuration;
               planned.explanation = "Volume réduit pour préserver la récupération.";
               planned.status = 'adapted';
               result.changed = true;
            }
         }
      }
    }
  }

  if (result.changed) {
     if (result.changes.some(c => c.type === 'reduced')) {
        result.reason = "Ton plan a été allégé pour favoriser ta récupération.";
     } else if (result.changes.some(c => c.type === 'missed')) {
        result.reason = "Mise à jour suite aux séances non réalisées.";
     } else {
        result.reason = "Ton plan a été adapté à ta réalité.";
     }
  }

  return result;
}
