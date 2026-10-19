import { RawExtractedWorkoutData } from '../../../domain/workoutImportTypes';
import { parseISO, differenceInSeconds } from 'date-fns';

export interface GpxParseResult {
  success: boolean;
  workouts: RawExtractedWorkoutData[];
  errors: string[];
  warnings: string[];
}

/**
 * GpxParser
 * Parseur XML GPS Exchange Format (.GPX).
 * Calcule déterministement la distance (formule de Haversine), le dénivelé positif et la durée.
 */
export class GpxParser {
  static parse(content: string): GpxParseResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return {
        success: false,
        workouts: [],
        errors: ["Le fichier GPX est vide."],
        warnings: []
      };
    }

    if (!content.includes('<gpx') && !content.includes('<trk')) {
      return {
        success: false,
        workouts: [],
        errors: ["Structure GPX invalide : balise <gpx> ou <trk> introuvable."],
        warnings: []
      };
    }

    // Sport / Type de trace
    let sportRaw = 'Other';
    const typeMatch = content.match(/<type>([^<]+)<\/type>/i);
    if (typeMatch) {
      sportRaw = typeMatch[1].trim();
    } else {
      const nameMatch = content.match(/<name>([^<]+)<\/name>/i);
      if (nameMatch) {
        sportRaw = nameMatch[1].trim();
      }
    }

    // Extraction des points de trace <trkpt lat="..." lon="...">
    const trkptRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/gi;
    let match: RegExpExecArray | null;

    interface TrackPoint {
      lat: number;
      lon: number;
      ele?: number;
      time?: string;
      hr?: number;
      power?: number;
    }

    const points: TrackPoint[] = [];

    while ((match = trkptRegex.exec(content)) !== null) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      const body = match[3];

      let ele: number | undefined;
      const eleMatch = body.match(/<ele>([0-9.-]+)<\/ele>/i);
      if (eleMatch) ele = parseFloat(eleMatch[1]);

      let time: string | undefined;
      const timeMatch = body.match(/<time>([^<]+)<\/time>/i);
      if (timeMatch) time = timeMatch[1].trim();

      let hr: number | undefined;
      const hrMatch = body.match(/<(?:gpxtpx:)?hr>([0-9.]+)<\/(?:gpxtpx:)?hr>/i);
      if (hrMatch) hr = parseFloat(hrMatch[1]);

      let power: number | undefined;
      const powerMatch = body.match(/<power>([0-9.]+)<\/power>/i);
      if (powerMatch) power = parseFloat(powerMatch[1]);

      if (!isNaN(lat) && !isNaN(lon)) {
        points.push({ lat, lon, ele, time, hr, power });
      }
    }

    if (points.length === 0) {
      return {
        success: false,
        workouts: [],
        errors: ["Aucun point GPS <trkpt> valide trouvé dans le fichier GPX."],
        warnings
      };
    }

    // Calcul de la distance totale via Haversine
    let totalDistanceMeters = 0;
    let elevationGain = 0;

    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];

      const d = this.haversineDistance(p1.lat, p1.lon, p2.lat, p2.lon);
      totalDistanceMeters += d;

      if (p1.ele != null && p2.ele != null && p2.ele > p1.ele) {
        elevationGain += (p2.ele - p1.ele);
      }
    }

    // Calcul de la durée
    let durationSeconds = 0;
    const firstTime = points[0].time;
    const lastTime = points[points.length - 1].time;

    if (firstTime && lastTime) {
      try {
        const start = parseISO(firstTime);
        const end = parseISO(lastTime);
        const diff = differenceInSeconds(end, start);
        if (diff > 0) durationSeconds = diff;
      } catch {
        // ignore
      }
    }

    if (durationSeconds === 0) {
      // Estimation de secours : 1 point par seconde si timestamps manquants
      durationSeconds = points.length;
      warnings.push("Horodatages absents ou invalides sur les points GPX : durée estimée d'après le nombre de points.");
    }

    // Statistiques FC et Puissance
    const hrValues = points.map(p => p.hr).filter((h): h is number => h != null && h > 0);
    const powerValues = points.map(p => p.power).filter((p): p is number => p != null && p > 0);

    const avgHr = hrValues.length > 0
      ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length)
      : undefined;
    const maxHr = hrValues.length > 0 ? Math.max(...hrValues) : undefined;

    const avgPower = powerValues.length > 0
      ? Math.round(powerValues.reduce((a, b) => a + b, 0) / powerValues.length)
      : undefined;
    const maxPower = powerValues.length > 0 ? Math.max(...powerValues) : undefined;

    const missingFields: string[] = [];
    if (!avgHr) missingFields.push('averageHeartRate');
    if (!avgPower) missingFields.push('power');

    const workout: RawExtractedWorkoutData = {
      sportRaw,
      startTimeRaw: firstTime || new Date().toISOString(),
      durationSecondsRaw: Math.round(durationSeconds),
      distanceMetersRaw: Math.round(totalDistanceMeters),
      averageHeartRateRaw: avgHr,
      maxHeartRateRaw: maxHr,
      averagePowerRaw: avgPower,
      maxPowerRaw: maxPower,
      elevationGainMetersRaw: Math.round(elevationGain),
      powerSeries: powerValues.length > 0 ? powerValues : undefined,
      hrSeries: hrValues.length > 0 ? hrValues : undefined,
      confidence: points.length >= 2 ? 'high' : 'medium',
      uncertainFields: [],
      missingFields,
      extractionNotes: [
        `GPX analysé : ${points.length} points de trace, distance calculée par Haversine (${(totalDistanceMeters / 1000).toFixed(2)} km).`
      ]
    };

    return {
      success: true,
      workouts: [workout],
      errors,
      warnings
    };
  }

  /**
   * Formule de Haversine pour la distance géodésique en mètres entre deux coordonnées (lat, lon).
   */
  private static haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Rayon de la Terre en mètres
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }
}
