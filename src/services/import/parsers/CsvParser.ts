import { RawExtractedWorkoutData } from '../../../domain/workoutImportTypes';
import { parseISO, format } from 'date-fns';

export interface CsvParseResult {
  success: boolean;
  workouts: RawExtractedWorkoutData[];
  errors: string[];
  warnings: string[];
}

/**
 * CsvParser
 * Parseur tabulaire robuste supportant virgules, points-virgules, tabulations et pipes.
 * Normalise automatiquement les formats de durée (hh:mm:ss ou secondes), les distances (km ou m)
 * et les formats de nombres à virgule ou point.
 */
export class CsvParser {
  static parse(content: string): CsvParseResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return {
        success: false,
        workouts: [],
        errors: ["Le fichier CSV est vide."],
        warnings: []
      };
    }

    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) {
      return {
        success: false,
        workouts: [],
        errors: ["Le fichier CSV doit contenir au minimum une ligne d'en-tête et une ligne de données."],
        warnings: []
      };
    }

    // 1. Détection du séparateur sur la première ligne
    const headerLine = lines[0];
    const delimiter = this.detectDelimiter(headerLine);
    const headers = this.splitLine(headerLine, delimiter).map(h => h.toLowerCase().trim().replace(/^["']|["']$/g, ''));

    // 2. Indexation des colonnes clés
    const colIndex = {
      date: headers.findIndex(h => /^(date|time|timestamp|start_time|datetime|date_heure|date\/heure|activity_date)$/i.test(h)),
      sport: headers.findIndex(h => /^(sport|activity_type|type|discipline|activity)$/i.test(h)),
      duration: headers.findIndex(h => /^(duration|durée|duree|elapsed_time|moving_time|total_time|time_sec)$/i.test(h)),
      distance: headers.findIndex(h => /^(distance|dist|distance_km|distance_m|distance_meters|distance\s*\(km\)|distance\s*\(m\))$/i.test(h)),
      heartRate: headers.findIndex(h => /^(heart_rate|hr|fc|bpm|avg_hr|average_heartrate|cardio)$/i.test(h)),
      maxHeartRate: headers.findIndex(h => /^(max_heart_rate|max_hr|max_bpm|fc_max)$/i.test(h)),
      power: headers.findIndex(h => /^(power|watts|puissance|avg_power|average_watts)$/i.test(h)),
      normalizedPower: headers.findIndex(h => /^(normalized_power|np|puissance_normalisee)$/i.test(h)),
      tss: headers.findIndex(h => /^(tss|training_stress_score)$/i.test(h)),
      elevation: headers.findIndex(h => /^(elevation|elevation_gain|d\+|denivele|denivele_positif|gain)$/i.test(h)),
      calories: headers.findIndex(h => /^(calories|cal|kcal)$/i.test(h))
    };

    // Si aucune colonne trouvée par regex stricte, chercher des correspondances partielles
    if (colIndex.date === -1) {
      colIndex.date = headers.findIndex(h => h.includes('date') || h.includes('time'));
    }
    if (colIndex.sport === -1) {
      colIndex.sport = headers.findIndex(h => h.includes('sport') || h.includes('type'));
    }
    if (colIndex.duration === -1) {
      colIndex.duration = headers.findIndex(h => h.includes('dur') || h.includes('time'));
    }
    if (colIndex.distance === -1) {
      colIndex.distance = headers.findIndex(h => h.includes('distance') || h.startsWith('dist'));
    }
    if (colIndex.heartRate === -1) {
      colIndex.heartRate = headers.findIndex(h => h.includes('heart') || h.includes('cardio') || h.includes('bpm') || h.includes('hr') || h.includes('fc'));
    }
    if (colIndex.power === -1) {
      colIndex.power = headers.findIndex(h => h.includes('power') || h.includes('puissance') || h.includes('watt'));
    }

    const workouts: RawExtractedWorkoutData[] = [];

    // 3. Parcours des lignes de données
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const cells = this.splitLine(line, delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
      if (cells.length === 0 || cells.every(c => c === '')) continue;

      const rawDate = colIndex.date !== -1 ? cells[colIndex.date] : undefined;
      const rawSport = colIndex.sport !== -1 ? cells[colIndex.sport] : undefined;
      const rawDuration = colIndex.duration !== -1 ? cells[colIndex.duration] : undefined;
      const rawDistance = colIndex.distance !== -1 ? cells[colIndex.distance] : undefined;
      const rawHr = colIndex.heartRate !== -1 ? cells[colIndex.heartRate] : undefined;
      const rawMaxHr = colIndex.maxHeartRate !== -1 ? cells[colIndex.maxHeartRate] : undefined;
      const rawPower = colIndex.power !== -1 ? cells[colIndex.power] : undefined;
      const rawNp = colIndex.normalizedPower !== -1 ? cells[colIndex.normalizedPower] : undefined;
      const rawTss = colIndex.tss !== -1 ? cells[colIndex.tss] : undefined;
      const rawElevation = colIndex.elevation !== -1 ? cells[colIndex.elevation] : undefined;
      const rawCalories = colIndex.calories !== -1 ? cells[colIndex.calories] : undefined;

      // Parsing durée
      const durationSeconds = this.parseDurationToSeconds(rawDuration);
      if (durationSeconds <= 0 && (!rawDistance && !rawHr)) {
        // Ligne sans métrique exploitable
        continue;
      }

      // Parsing distance (détection automatique mètres vs km)
      const distanceMeters = this.parseDistanceToMeters(rawDistance, headers[colIndex.distance]);

      // Parsing valeurs numériques
      const avgHr = this.parseNumber(rawHr);
      const maxHr = this.parseNumber(rawMaxHr);
      const avgPower = this.parseNumber(rawPower);
      const np = this.parseNumber(rawNp);
      const tss = this.parseNumber(rawTss);
      const elevation = this.parseNumber(rawElevation);
      const calories = this.parseNumber(rawCalories);

      // Normalisation date
      const startTimeIso = this.parseDateToIso(rawDate);

      const missingFields: string[] = [];
      if (!distanceMeters) missingFields.push('distance');
      if (!avgHr) missingFields.push('averageHeartRate');
      if (!avgPower && !np) missingFields.push('power');

      workouts.push({
        sportRaw: rawSport || 'Other',
        startTimeRaw: startTimeIso,
        durationSecondsRaw: durationSeconds,
        distanceMetersRaw: distanceMeters,
        averageHeartRateRaw: avgHr,
        maxHeartRateRaw: maxHr,
        averagePowerRaw: avgPower,
        normalizedPowerRaw: np,
        providedTssRaw: tss,
        elevationGainMetersRaw: elevation,
        caloriesRaw: calories,
        confidence: durationSeconds > 0 && rawDate ? 'high' : 'medium',
        uncertainFields: rawDate && !startTimeIso.includes('T') ? ['startTime'] : [],
        missingFields,
        extractionNotes: [`Ligne ${i + 1} CSV extraite avec séparateur '${delimiter}'`]
      });
    }

    if (workouts.length === 0) {
      return {
        success: false,
        workouts: [],
        errors: ["Aucune ligne de données sportives n'a pu être convertie depuis ce fichier CSV."],
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

  private static detectDelimiter(headerLine: string): string {
    const delimiters = [',', ';', '\t', '|'];
    let best = ',';
    let maxCount = -1;

    for (const d of delimiters) {
      const count = headerLine.split(d).length - 1;
      if (count > maxCount) {
        maxCount = count;
        best = d;
      }
    }
    return best;
  }

  private static splitLine(line: string, delimiter: string): string[] {
    // Gestion simplifiée et sûre des guillemets
    const pattern = new RegExp(`(?:^|${delimiter})(?:"([^"]*)"|([^${delimiter}]*))`, 'g');
    const result: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(line)) !== null) {
      const val = match[1] !== undefined ? match[1] : match[2];
      result.push(val);
      if (match.index === pattern.lastIndex) pattern.lastIndex++;
    }

    // Si le regex n'a rien renvoyé (cas standard), fallback sur split classique
    if (result.length === 0) {
      return line.split(delimiter);
    }
    return result;
  }

  private static parseDurationToSeconds(raw?: string): number {
    if (!raw) return 0;
    const clean = raw.trim().replace(',', '.');

    // Cas "hh:mm:ss" ou "mm:ss"
    if (clean.includes(':')) {
      const parts = clean.split(':').map(p => parseFloat(p));
      if (parts.length === 3) {
        return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
      } else if (parts.length === 2) {
        return Math.round(parts[0] * 60 + parts[1]);
      }
    }

    const num = parseFloat(clean);
    if (isNaN(num) || num <= 0) return 0;

    // Si > 300 sans unité, très probablement des secondes (ex: 3600 = 1h)
    // Si <= 300 et nombre entier raisonnable, pourrait être des minutes
    // Heuristique : si > 3600 -> secondes
    if (num > 300) {
      return Math.round(num);
    }
    // Sinon minutes -> convertir en secondes
    return Math.round(num * 60);
  }

  private static parseDistanceToMeters(raw?: string, headerName?: string): number | undefined {
    if (!raw) return undefined;
    const clean = raw.trim().replace(',', '.');
    const num = parseFloat(clean);
    if (isNaN(num) || num <= 0) return undefined;

    const lowerHeader = (headerName || '').toLowerCase();

    // Si l'en-tête indique explicitement km
    if (lowerHeader.includes('_km') || lowerHeader.includes('(km)')) {
      return Math.round(num * 1000);
    }
    // Si l'en-tête indique explicitement m
    if (lowerHeader.includes('_m') || lowerHeader.includes('(m)') || lowerHeader.includes('meter')) {
      return Math.round(num);
    }

    // Heuristique : une séance de sport fait rarement plus de 300 km
    // Donc si la valeur est > 500, c'est presque certainement en mètres (ex: 10000 = 10km)
    if (num > 500) {
      return Math.round(num);
    }
    // Sinon c'est en km (ex: 10.5 km)
    return Math.round(num * 1000);
  }

  private static parseNumber(raw?: string): number | undefined {
    if (!raw) return undefined;
    const clean = raw.trim().replace(',', '.');
    const num = parseFloat(clean);
    return isNaN(num) || num <= 0 ? undefined : num;
  }

  private static parseDateToIso(rawDate?: string): string {
    if (!rawDate) return new Date().toISOString();
    const clean = rawDate.trim();

    // Essai parse ISO direct
    try {
      const parsed = parseISO(clean);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    } catch {
      // ignore
    }

    // Essai format JJ/MM/AAAA ou JJ-MM-AAAA
    const frDateMatch = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (frDateMatch) {
      const day = frDateMatch[1].padStart(2, '0');
      const month = frDateMatch[2].padStart(2, '0');
      const year = frDateMatch[3];
      const hours = (frDateMatch[4] || '10').padStart(2, '0');
      const minutes = (frDateMatch[5] || '00').padStart(2, '0');
      const seconds = (frDateMatch[6] || '00').padStart(2, '0');

      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.000Z`;
    }

    return new Date().toISOString();
  }
}
