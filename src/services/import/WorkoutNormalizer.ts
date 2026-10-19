import { RawExtractedWorkoutData, NormalizedWorkoutData, TssCalculationMethod } from '../../domain/workoutImportTypes';
import { normalizeSport } from '../SyncService';
import { calculateTSS, calculateHrTSS, calculateDurationTSS, calculateNP } from '../../lib/trainingEngine';
import { parseISO, format } from 'date-fns';
import { useAppStore } from '../../store';

/**
 * WorkoutNormalizer
 * Convertit des données brutes hétérogènes en NormalizedWorkoutData
 * et applique les règles de calcul physiologique déterministes Plana (TrainingEngine).
 */
export class WorkoutNormalizer {
  static normalize(
    raw: RawExtractedWorkoutData,
    sourceName: string,
    index: number = 0
  ): NormalizedWorkoutData {
    // 1. Normalisation du sport
    const sport = normalizeSport(raw.sportRaw || 'Other');

    // 2. Normalisation temporelle (date YYYY-MM-DD et ISO startTime)
    let dateStr = '';
    let startTimeIso = raw.startTimeRaw || new Date().toISOString();

    try {
      const parsed = parseISO(startTimeIso);
      if (!isNaN(parsed.getTime())) {
        dateStr = format(parsed, 'yyyy-MM-dd');
      } else {
        dateStr = format(new Date(), 'yyyy-MM-dd');
        startTimeIso = new Date().toISOString();
      }
    } catch {
      dateStr = format(new Date(), 'yyyy-MM-dd');
      startTimeIso = new Date().toISOString();
    }

    // 3. Durée et distance
    const durationMin = Math.round((raw.durationSecondsRaw || 0) / 60);
    const distanceKm = raw.distanceMetersRaw != null && raw.distanceMetersRaw > 0
      ? parseFloat((raw.distanceMetersRaw / 1000).toFixed(2))
      : undefined;

    // 4. Puissance normalisée (calculée depuis série si dispo, sinon fournie)
    let effectiveNp = raw.normalizedPowerRaw || raw.averagePowerRaw;
    if (!effectiveNp && raw.powerSeries && raw.powerSeries.length >= 30) {
      const calculatedNp = calculateNP(raw.powerSeries);
      if (calculatedNp > 0) {
        effectiveNp = Math.round(calculatedNp);
      }
    }

    // 5. Hiérarchie de calcul déterministe du TSS (Phase 34)
    // 1. TSS fourni dans le fichier
    // 2. Calcul par Puissance NP + FTP
    // 3. Calcul par Fréquence Cardiaque hrTSS + HRmax
    // 4. Estimation par Durée (50 TSS/h)
    let calculatedTss: number | undefined;
    let tssMethod: TssCalculationMethod = 'none';

    const storeState = useAppStore.getState?.();
    const ftp = storeState?.ftp || 250;
    const hrMax = storeState?.athleteProfile?.hrMax || 190;
    const durationSec = raw.durationSecondsRaw || durationMin * 60;

    if (raw.providedTssRaw != null && raw.providedTssRaw > 0) {
      calculatedTss = Math.round(raw.providedTssRaw);
      tssMethod = 'provided';
    } else if (effectiveNp != null && effectiveNp > 0 && ftp > 0 && durationSec > 0) {
      calculatedTss = Math.round(calculateTSS(durationSec, effectiveNp, ftp));
      tssMethod = 'power_np';
    } else if (raw.averageHeartRateRaw != null && raw.averageHeartRateRaw > 0 && hrMax > 0 && durationSec > 0) {
      calculatedTss = Math.round(calculateHrTSS(durationSec, raw.averageHeartRateRaw, hrMax));
      tssMethod = 'heart_rate';
    } else if (durationMin > 0) {
      calculatedTss = Math.round(calculateDurationTSS(durationMin));
      tssMethod = 'duration_estimate';
    }

    // 6. Génération de l'identifiant déterministe
    const deterministicKey = raw.externalIdRaw
      ? raw.externalIdRaw
      : `${sport}-${dateStr}-${durationMin}-${distanceKm || 0}-${index}`;
    const id = `${sourceName}-${deterministicKey}`;

    // 7. Titre naturel de l'activité
    const title = this.buildTitle(sport, distanceKm, durationMin);

    return {
      id,
      source: sourceName,
      sourceId: deterministicKey,
      sport,
      date: dateStr,
      startTime: startTimeIso,
      durationMin,
      distanceKm,
      averageHeartRate: raw.averageHeartRateRaw,
      maxHeartRate: raw.maxHeartRateRaw,
      averagePower: raw.averagePowerRaw,
      normalizedPower: effectiveNp,
      averageCadence: raw.averageCadenceRaw,
      elevationGain: raw.elevationGainMetersRaw,
      calories: raw.caloriesRaw,
      temperature: raw.temperatureRaw,
      tss: calculatedTss,
      tssCalculationMethod: tssMethod,
      title,
      confidence: raw.confidence,
      uncertainFields: raw.uncertainFields
    };
  }

  private static buildTitle(sport: string, distanceKm?: number, durationMin?: number): string {
    const sportLabels: Record<string, string> = {
      Run: 'Course à pied',
      Ride: 'Sortie vélo',
      Swim: 'Séance natation',
      Strength: 'Renforcement musculaire',
      Other: 'Activité sportive'
    };

    const base = sportLabels[sport] || 'Activité';
    if (distanceKm) {
      return `${base} (${distanceKm} km)`;
    }
    if (durationMin && durationMin > 0) {
      return `${base} (${durationMin} min)`;
    }
    return base;
  }
}
