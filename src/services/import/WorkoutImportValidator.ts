import { NormalizedWorkoutData } from '../../domain/workoutImportTypes';
import { parseISO, isAfter, addDays } from 'date-fns';

export interface ValidationReport {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * WorkoutImportValidator
 * Contrôle la validité des données d'entraînement normalisées et prévient l'injection
 * de valeurs physiologiquement aberrantes ou corrompues.
 */
export class WorkoutImportValidator {
  static validate(workout: NormalizedWorkoutData): ValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Validation de la date
    if (!workout.date || !/^\d{4}-\d{2}-\d{2}$/.test(workout.date)) {
      errors.push(`Date invalide ou absente (${workout.date}). Format attendu : YYYY-MM-DD.`);
    } else {
      try {
        const d = parseISO(workout.date);
        if (isNaN(d.getTime())) {
          errors.push(`Date invalide : ${workout.date}.`);
        } else if (isAfter(d, addDays(new Date(), 1))) {
          warnings.push(`La date de la séance (${workout.date}) est située dans le futur.`);
        }
      } catch {
        errors.push(`Erreur de parsing de date (${workout.date}).`);
      }
    }

    // 2. Validation de la durée
    if (workout.durationMin <= 0) {
      errors.push("La durée de la séance doit être strictement supérieure à 0 minute.");
    } else if (workout.durationMin > 1440) {
      errors.push(`Durée aberrante (${workout.durationMin} min > 24 heures).`);
    } else if (workout.durationMin > 360) {
      warnings.push(`Durée très élevée (${Math.round(workout.durationMin / 60)}h) : vérifiez qu'il ne s'agit pas d'un oubli d'arrêt du compteur.`);
    }

    // 3. Validation de la distance
    if (workout.distanceKm != null) {
      if (workout.distanceKm < 0) {
        errors.push("La distance ne peut pas être négative.");
      } else if (workout.distanceKm > 600) {
        warnings.push(`Distance inhabituellement élevée (${workout.distanceKm} km).`);
      }
    }

    // 4. Validation de la Fréquence Cardiaque
    if (workout.averageHeartRate != null) {
      if (workout.averageHeartRate < 35 || workout.averageHeartRate > 235) {
        warnings.push(`Fréquence cardiaque moyenne suspecte (${workout.averageHeartRate} bpm).`);
      }
    }
    if (workout.maxHeartRate != null) {
      if (workout.maxHeartRate < 40 || workout.maxHeartRate > 245) {
        warnings.push(`Fréquence cardiaque maximale suspecte (${workout.maxHeartRate} bpm).`);
      }
    }

    // 5. Validation de la Puissance
    if (workout.normalizedPower != null && workout.normalizedPower > 2000) {
      warnings.push(`Puissance normalisée très élevée (${workout.normalizedPower} W).`);
    }

    // 6. Validation du TSS
    if (workout.tss != null && workout.tss > 800) {
      warnings.push(`TSS très élevé (${workout.tss}).`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
}
