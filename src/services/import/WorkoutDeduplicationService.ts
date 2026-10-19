import { ActualWorkout, PlannedWorkout } from '../../domain/models';
import { NormalizedWorkoutData, DuplicateMatch } from '../../domain/workoutImportTypes';
import { parseISO, differenceInMinutes } from 'date-fns';
import { matchToPlannedWorkout } from '../SyncService';

/**
 * WorkoutDeduplicationService
 * Détecte les doublons stricts (même source et même sourceId) et les doublons probables
 * (même date, même sport, horaires et durées très proches), sans jamais écraser silencieusement
 * les séances existantes.
 */
export class WorkoutDeduplicationService {
  /**
   * Analyse une séance candidate par rapport aux séances réelles existantes.
   */
  static checkDuplicate(
    candidate: NormalizedWorkoutData,
    existingWorkouts: ActualWorkout[]
  ): DuplicateMatch | null {
    for (const existing of existingWorkouts) {
      // 1. Doublon strict par identifiant de source
      if (candidate.sourceId && existing.sourceId && candidate.source === existing.source) {
        if (candidate.sourceId === existing.sourceId) {
          return {
            existingWorkout: existing,
            matchType: 'exact_source_id',
            reason: `Séance déjà importée avec l'identifiant '${candidate.sourceId}'.`,
            similarityScore: 1.0,
            canOverride: false
          };
        }
      }

      // 2. Détection de doublon probable par métadonnées (même date, même sport)
      if (candidate.sport === existing.sport && candidate.date === existing.date) {
        let isTimeClose = false;
        let timeDiffMin = 999;

        if (candidate.startTime && existing.startTime) {
          try {
            const t1 = parseISO(candidate.startTime);
            const t2 = parseISO(existing.startTime);
            timeDiffMin = Math.abs(differenceInMinutes(t1, t2));
            if (timeDiffMin <= 15) {
              isTimeClose = true;
            }
          } catch {
            // ignore
          }
        }

        const durationDiffMin = Math.abs(candidate.durationMin - existing.durationMin);
        const isDurationClose = durationDiffMin <= 5 || durationDiffMin <= (existing.durationMin * 0.1);

        // Si l'horaire et la durée sont proches, ou si horaire indéterminé mais même jour et durée identique
        if ((isTimeClose && isDurationClose) || (timeDiffMin > 900 && durationDiffMin <= 2)) {
          let score = 0.8;
          if (isTimeClose) score += 0.1;
          if (durationDiffMin === 0) score += 0.1;

          return {
            existingWorkout: existing,
            matchType: 'probable_match',
            reason: `Doublon probable : une séance de ${existing.sport} de ${existing.durationMin} min existe déjà le ${existing.date} (${existing.title || 'sans titre'}).`,
            similarityScore: Math.min(1.0, score),
            canOverride: true
          };
        }
      }
    }

    return null;
  }

  /**
   * Rapproche la séance importée avec une séance planifiée existante (réconciliation).
   */
  static findMatchingPlannedWorkout(
    candidate: NormalizedWorkoutData,
    plannedWorkouts: PlannedWorkout[]
  ): PlannedWorkout | undefined {
    // Créer un ActualWorkout virtuel temporaire pour appeler matchToPlannedWorkout
    const virtualActual: ActualWorkout = {
      id: candidate.id,
      sport: candidate.sport,
      date: candidate.date,
      startTime: candidate.startTime,
      durationMin: candidate.durationMin,
      distanceKm: candidate.distanceKm,
      averageHeartRate: candidate.averageHeartRate,
      normalizedPower: candidate.normalizedPower,
      tss: candidate.tss
    };

    return matchToPlannedWorkout(virtualActual, plannedWorkouts);
  }
}
