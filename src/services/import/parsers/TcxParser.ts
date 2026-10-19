import { RawExtractedWorkoutData } from '../../../domain/workoutImportTypes';

export interface TcxParseResult {
  success: boolean;
  workouts: RawExtractedWorkoutData[];
  errors: string[];
  warnings: string[];
}

/**
 * TcxParser
 * Parseur XML Garmin Training Center Database (.TCX).
 * Compatible navigateurs Web (DOMParser) et environnements Node/Vitest (regex scanner sécurisé).
 */
export class TcxParser {
  static parse(content: string): TcxParseResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return {
        success: false,
        workouts: [],
        errors: ["Le contenu TCX est vide."],
        warnings: []
      };
    }

    if (!content.includes('<TrainingCenterDatabase') && !content.includes('<Activity')) {
      return {
        success: false,
        workouts: [],
        errors: ["Structure TCX invalide : balise <TrainingCenterDatabase> ou <Activity> manquante."],
        warnings: []
      };
    }

    const workouts: RawExtractedWorkoutData[] = [];

    // Découpage par <Activity ...>...</Activity>
    const activityMatches = content.match(/<Activity\s+Sport="([^"]+)">([\s\S]*?)<\/Activity>/gi);

    if (!activityMatches || activityMatches.length === 0) {
      // Tentative de capture si la balise fermante est absente ou si structure tronquée
      const fallbackActivity = this.parseSingleActivity(content, 'Other', warnings);
      if (fallbackActivity) {
        workouts.push(fallbackActivity);
      } else {
        return {
          success: false,
          workouts: [],
          errors: ["Aucune activité sportive valide trouvée dans le fichier TCX."],
          warnings
        };
      }
    } else {
      for (const actXml of activityMatches) {
        const sportMatch = actXml.match(/<Activity\s+Sport="([^"]+)"/i);
        const sportRaw = sportMatch ? sportMatch[1] : 'Other';
        const parsed = this.parseSingleActivity(actXml, sportRaw, warnings);
        if (parsed) {
          workouts.push(parsed);
        }
      }
    }

    return {
      success: workouts.length > 0,
      workouts,
      errors,
      warnings
    };
  }

  private static parseSingleActivity(
    xml: string,
    sportRaw: string,
    warnings: string[]
  ): RawExtractedWorkoutData | null {
    // 1. Identifiant / Date de début <Id>2026-10-18T10:00:00Z</Id>
    let startTimeRaw: string | undefined;
    const idMatch = xml.match(/<Id>([^<]+)<\/Id>/i);
    if (idMatch) {
      startTimeRaw = idMatch[1].trim();
    }

    // 2. Cumul des Laps
    let totalDurationSec = 0;
    let totalDistanceMeters = 0;
    let calories = 0;
    let hrSum = 0;
    let hrCount = 0;
    let maxHr: number | undefined;
    let powerSum = 0;
    let powerCount = 0;
    let maxPower: number | undefined;

    const lapMatches = xml.match(/<Lap\s*[^>]*>([\s\S]*?)<\/Lap>/gi) || [xml];

    for (const lap of lapMatches) {
      // <TotalTimeSeconds>
      const timeMatch = lap.match(/<TotalTimeSeconds>([0-9.]+)<\/TotalTimeSeconds>/i);
      if (timeMatch) {
        totalDurationSec += parseFloat(timeMatch[1]);
      }

      // <DistanceMeters>
      const distMatch = lap.match(/<DistanceMeters>([0-9.]+)<\/DistanceMeters>/i);
      if (distMatch) {
        totalDistanceMeters += parseFloat(distMatch[1]);
      }

      // <Calories>
      const calMatch = lap.match(/<Calories>([0-9]+)<\/Calories>/i);
      if (calMatch) {
        calories += parseInt(calMatch[1], 10);
      }

      // <AverageHeartRateBpm><Value>
      const avgHrMatch = lap.match(/<AverageHeartRateBpm>\s*<Value>([0-9.]+)<\/Value>\s*<\/AverageHeartRateBpm>/i);
      if (avgHrMatch) {
        hrSum += parseFloat(avgHrMatch[1]);
        hrCount++;
      }

      // <MaximumHeartRateBpm><Value>
      const maxHrMatch = lap.match(/<MaximumHeartRateBpm>\s*<Value>([0-9.]+)<\/Value>\s*<\/MaximumHeartRateBpm>/i);
      if (maxHrMatch) {
        const val = parseFloat(maxHrMatch[1]);
        if (!maxHr || val > maxHr) maxHr = val;
      }
    }

    // 3. Séries temporelles et points de trace <Trackpoint>
    const powerSeries: number[] = [];
    const hrSeries: number[] = [];

    const tpMatches = xml.match(/<Trackpoint>([\s\S]*?)<\/Trackpoint>/gi) || [];
    for (const tp of tpMatches) {
      // Puissance dans <Watts>
      const wattsMatch = tp.match(/<Watts>([0-9.]+)<\/Watts>/i);
      if (wattsMatch) {
        const w = parseFloat(wattsMatch[1]);
        powerSeries.push(w);
        powerSum += w;
        powerCount++;
        if (!maxPower || w > maxPower) maxPower = w;
      }

      // Fréquence cardiaque
      const hrMatch = tp.match(/<HeartRateBpm>\s*<Value>([0-9.]+)<\/Value>/i);
      if (hrMatch) {
        const hr = parseFloat(hrMatch[1]);
        hrSeries.push(hr);
        if (hrCount === 0) {
          hrSum += hr;
          hrCount++;
        }
      }

      // Première heure si pas encore d'id
      if (!startTimeRaw) {
        const timeMatch = tp.match(/<Time>([^<]+)<\/Time>/i);
        if (timeMatch) startTimeRaw = timeMatch[1].trim();
      }
    }

    // Si la durée n'est pas dans le Lap, déduire du nombre de trackpoints
    if (totalDurationSec === 0 && tpMatches.length > 0) {
      totalDurationSec = tpMatches.length;
    }

    if (!startTimeRaw) {
      warnings.push("Date TCX non trouvée. Date du jour utilisée.");
      startTimeRaw = new Date().toISOString();
    }

    const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : undefined;
    const avgPower = powerCount > 0 ? Math.round(powerSum / powerCount) : undefined;

    const missingFields: string[] = [];
    if (totalDistanceMeters === 0) missingFields.push('distance');
    if (!avgHr) missingFields.push('averageHeartRate');
    if (!avgPower) missingFields.push('power');

    return {
      sportRaw,
      startTimeRaw,
      durationSecondsRaw: Math.round(totalDurationSec),
      distanceMetersRaw: totalDistanceMeters > 0 ? totalDistanceMeters : undefined,
      averageHeartRateRaw: avgHr,
      maxHeartRateRaw: maxHr,
      averagePowerRaw: avgPower,
      maxPowerRaw: maxPower,
      caloriesRaw: calories > 0 ? calories : undefined,
      powerSeries: powerSeries.length > 0 ? powerSeries : undefined,
      hrSeries: hrSeries.length > 0 ? hrSeries : undefined,
      confidence: totalDurationSec > 0 ? 'high' : 'medium',
      uncertainFields: [],
      missingFields,
      extractionNotes: [`XML TCX analysé : ${tpMatches.length} points de trace détectés.`]
    };
  }
}
