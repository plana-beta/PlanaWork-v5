import { RawExtractedWorkoutData } from '../../../domain/workoutImportTypes';

export interface JsonParseResult {
  success: boolean;
  workouts: RawExtractedWorkoutData[];
  errors: string[];
  warnings: string[];
}

/**
 * JsonParser
 * Parseur JSON universel pour exports d'activités sportives (Strava, Garmin, Plana ou exports personnalisés).
 */
export class JsonParser {
  static parse(content: string): JsonParseResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return {
        success: false,
        workouts: [],
        errors: ["Le contenu JSON est vide."],
        warnings: []
      };
    }

    let parsedJson: any;
    try {
      parsedJson = JSON.parse(content);
    } catch (e: any) {
      return {
        success: false,
        workouts: [],
        errors: [`Syntaxe JSON invalide : ${e.message}`],
        warnings: []
      };
    }

    if (!parsedJson || (typeof parsedJson !== 'object' && !Array.isArray(parsedJson))) {
      return {
        success: false,
        workouts: [],
        errors: ["Le fichier JSON ne contient pas d'objet ou de tableau valide."],
        warnings: []
      };
    }

    // Normaliser en tableau d'activités
    let rawItems: any[] = [];
    if (Array.isArray(parsedJson)) {
      rawItems = parsedJson;
    } else if (Array.isArray(parsedJson.activities)) {
      rawItems = parsedJson.activities;
    } else if (Array.isArray(parsedJson.workouts)) {
      rawItems = parsedJson.workouts;
    } else if (Array.isArray(parsedJson.data)) {
      rawItems = parsedJson.data;
    } else {
      // Objet d'activité unique
      rawItems = [parsedJson];
    }

    const workouts: RawExtractedWorkoutData[] = [];

    for (let index = 0; index < rawItems.length; index++) {
      const item = rawItems[index];
      if (!item || typeof item !== 'object') continue;

      const extracted = this.extractFromJsonObject(item, index);
      if (extracted) {
        workouts.push(extracted);
      }
    }

    if (workouts.length === 0) {
      return {
        success: false,
        workouts: [],
        errors: ["Aucune donnée d'entraînement exploitable trouvée dans la structure JSON."],
        warnings
      };
    }

    return {
      success: true,
      workouts,
      errors,
      warnings
    };
  }

  private static extractFromJsonObject(item: any, index: number): RawExtractedWorkoutData | null {
    // 1. Sport
    const sportRaw =
      item.sport ||
      item.type ||
      item.activityType?.typeKey ||
      item.activityType ||
      item.discipline ||
      item.sportType ||
      item.name ||
      'Other';

    // 2. Date / Start Time
    const startTimeRaw =
      item.startTime ||
      item.startTimeRaw ||
      item.startTimeLocal ||
      item.start_date_local ||
      item.start_date ||
      item.date ||
      new Date().toISOString();

    // 3. Durée (secondes ou minutes)
    let durationSec = 0;
    if (typeof item.durationSeconds === 'number') {
      durationSec = item.durationSeconds;
    } else if (typeof item.moving_time === 'number') {
      durationSec = item.moving_time;
    } else if (typeof item.elapsed_time === 'number') {
      durationSec = item.elapsed_time;
    } else if (typeof item.duration === 'number') {
      // Si > 300 = secondes, sinon = minutes
      durationSec = item.duration > 300 ? item.duration : Math.round(item.duration * 60);
    } else if (typeof item.durationMin === 'number') {
      durationSec = Math.round(item.durationMin * 60);
    }

    // 4. Distance
    let distanceMeters: number | undefined;
    if (typeof item.distance === 'number') {
      // Si > 500 = mètres, sinon = kilomètres
      distanceMeters = item.distance > 500 ? Math.round(item.distance) : Math.round(item.distance * 1000);
    } else if (typeof item.distanceKm === 'number') {
      distanceMeters = Math.round(item.distanceKm * 1000);
    } else if (typeof item.distanceMeters === 'number') {
      distanceMeters = Math.round(item.distanceMeters);
    }

    // 5. Fréquence Cardiaque
    const avgHr = item.averageHeartRate || item.average_heartrate || item.avgHr || item.avg_hr || item.averageHR;
    const maxHr = item.maxHeartRate || item.max_heartrate || item.maxHr || item.max_hr || item.maxHR;

    // 6. Puissance
    const avgPower = item.averagePower || item.average_watts || item.avgPower || item.avg_power;
    const maxPower = item.maxPower || item.max_watts || item.maxPower;
    const np = item.normalizedPower || item.normPower || item.np;

    // 7. TSS
    const providedTss = item.tss || item.training_stress_score || item.trainingStressScore;

    // 8. Dénivelé
    const elevationGain = item.total_elevation_gain || item.elevationGain || item.elevation || item.ascent;

    // 9. Calories
    const calories = item.calories || item.kilojoules ? (item.kilojoules ? Math.round(item.kilojoules * 0.239) : item.calories) : undefined;

    // 10. Séries temporelles éventuelles
    const powerSeries = Array.isArray(item.powerSeries) ? item.powerSeries : undefined;
    const hrSeries = Array.isArray(item.hrSeries) ? item.hrSeries : undefined;

    const missingFields: string[] = [];
    if (!distanceMeters) missingFields.push('distance');
    if (!avgHr) missingFields.push('averageHeartRate');
    if (!avgPower && !np) missingFields.push('power');

    return {
      sportRaw: String(sportRaw),
      startTimeRaw: String(startTimeRaw),
      durationSecondsRaw: Math.round(durationSec),
      distanceMetersRaw: distanceMeters,
      averageHeartRateRaw: typeof avgHr === 'number' && avgHr > 0 ? Math.round(avgHr) : undefined,
      maxHeartRateRaw: typeof maxHr === 'number' && maxHr > 0 ? Math.round(maxHr) : undefined,
      averagePowerRaw: typeof avgPower === 'number' && avgPower > 0 ? Math.round(avgPower) : undefined,
      maxPowerRaw: typeof maxPower === 'number' && maxPower > 0 ? Math.round(maxPower) : undefined,
      normalizedPowerRaw: typeof np === 'number' && np > 0 ? Math.round(np) : undefined,
      elevationGainMetersRaw: typeof elevationGain === 'number' ? Math.round(elevationGain) : undefined,
      caloriesRaw: typeof calories === 'number' ? Math.round(calories) : undefined,
      providedTssRaw: typeof providedTss === 'number' && providedTss > 0 ? Math.round(providedTss) : undefined,
      powerSeries,
      hrSeries,
      externalIdRaw: item.id ? String(item.id) : undefined,
      confidence: durationSec > 0 ? 'high' : 'medium',
      uncertainFields: [],
      missingFields,
      extractionNotes: [`Élément JSON #${index + 1} extrait`]
    };
  }
}
