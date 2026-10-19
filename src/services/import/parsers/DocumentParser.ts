import { RawExtractedWorkoutData } from '../../../domain/workoutImportTypes';

export interface DocumentParseResult {
  success: boolean;
  workouts: RawExtractedWorkoutData[];
  errors: string[];
  warnings: string[];
  isAmbiguous: boolean;
}

/**
 * DocumentParser
 * Extracteur déterministe de données d'entraînement pour documents PDF et captures d'écran d'applications sportives.
 * Respecte la règle d'incertitude : toute valeur extraite par OCR ou heuristique est marquée 'uncertain'
 * et soumise à confirmation explicite de l'athlète.
 */
export class DocumentParser {
  /**
   * Analyse d'un document PDF texte.
   */
  static parsePdf(buffer: Uint8Array | ArrayBuffer | string): DocumentParseResult {
    const textContent = typeof buffer === 'string'
      ? buffer
      : this.extractTextFromPdfBuffer(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));

    if (!textContent || textContent.trim().length === 0) {
      return {
        success: false,
        workouts: [],
        errors: [
          "Document PDF sans texte exploitable (document numérisé ou image pure). " +
          "Pour importer cette séance, exportez un fichier FIT, TCX ou GPX depuis votre montre ou application."
        ],
        warnings: [],
        isAmbiguous: false
      };
    }

    return this.extractFromText(textContent, 'pdf');
  }

  /**
   * Analyse d'une capture d'écran / image d'application sportive (Garmin Connect, Strava, Apple Forme, etc.).
   */
  static parseImage(
    fileName: string,
    extractedOcrText?: string
  ): DocumentParseResult {
    // Si un texte OCR est disponible (par ex. fourni par l'API ou l'analyse)
    if (extractedOcrText && extractedOcrText.trim().length > 0) {
      const res = this.extractFromText(extractedOcrText, 'image');
      // Les données issues d'image sont TOUJOURS considérées comme incertaines
      res.isAmbiguous = true;
      for (const w of res.workouts) {
        w.confidence = 'low';
        w.uncertainFields = Array.from(new Set([...w.uncertainFields, 'sport', 'duration', 'distance']));
        w.extractionNotes = [
          "Données extraites d'une capture d'écran : la confirmation manuelle est obligatoire avant import.",
          ...(w.extractionNotes || [])
        ];
      }
      return res;
    }

    // Si aucune couche OCR n'a pu extraire de texte
    return {
      success: false,
      workouts: [],
      errors: [
        `Image '${fileName}' reçue : aucun texte OCR exploitable n'a été détecté avec certitude. ` +
        `Plana n'invente jamais de données sportives à partir d'une image illisible.`
      ],
      warnings: ["Image sans texte lisible"],
      isAmbiguous: true
    };
  }

  /**
   * Extraction déterministe de métriques sportives à partir de texte brut.
   */
  static extractFromText(text: string, sourceFormat: 'pdf' | 'image'): DocumentParseResult {
    const warnings: string[] = [];
    const uncertainFields: string[] = [];

    // 1. Détection du sport
    let sportRaw = 'Other';
    const lower = text.toLowerCase();
    if (lower.includes('course à pied') || lower.includes('running') || lower.includes('footing') || lower.includes('jogging')) {
      sportRaw = 'Run';
    } else if (lower.includes('vélo') || lower.includes('cyclisme') || lower.includes('sortie vélo') || lower.includes('ride') || lower.includes('cycling') || lower.includes('vtt')) {
      sportRaw = 'Ride';
    } else if (lower.includes('natation') || lower.includes('nage') || lower.includes('swimming') || lower.includes('swim')) {
      sportRaw = 'Swim';
    } else if (lower.includes('musculation') || lower.includes('renforcement') || lower.includes('strength')) {
      sportRaw = 'Strength';
    } else {
      uncertainFields.push('sport');
      warnings.push("Sport non formellement identifié dans le document.");
    }

    // 2. Détection de la durée
    let durationSeconds = 0;
    // Format "01:24:30" ou "45:12"
    const timeMatch = text.match(/\b(\d{1,2}):(\d{2}):(\d{2})\b/);
    const shortTimeMatch = text.match(/\b(\d{1,2}):(\d{2})\b/);
    const minMatch = text.match(/\b(\d{1,3})\s*(?:min|minutes|mn)\b/i);
    const hoursMatch = text.match(/\b(\d{1,2})\s*h\s*(\d{1,2})?\b/i);

    if (timeMatch) {
      durationSeconds = parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseInt(timeMatch[3], 10);
    } else if (hoursMatch) {
      const h = parseInt(hoursMatch[1], 10);
      const m = hoursMatch[2] ? parseInt(hoursMatch[2], 10) : 0;
      durationSeconds = h * 3600 + m * 60;
    } else if (shortTimeMatch) {
      durationSeconds = parseInt(shortTimeMatch[1], 10) * 60 + parseInt(shortTimeMatch[2], 10);
    } else if (minMatch) {
      durationSeconds = parseInt(minMatch[1], 10) * 60;
    } else {
      uncertainFields.push('duration');
      warnings.push("Durée non formellement identifiée dans le document.");
    }

    // 3. Détection de la distance
    let distanceMeters: number | undefined;
    const kmMatch = text.match(/\b(\d{1,3}[.,]\d{1,2})\s*(?:km|kilomètres|kilometres)\b/i);
    const metersMatch = text.match(/\b(\d{3,6})\s*(?:m|mètres|metres)\b/i);

    if (kmMatch) {
      distanceMeters = Math.round(parseFloat(kmMatch[1].replace(',', '.')) * 1000);
    } else if (metersMatch) {
      distanceMeters = parseInt(metersMatch[1], 10);
    }

    // 4. Détection de la Fréquence Cardiaque
    let avgHr: number | undefined;
    const hrMatch = text.match(/\b(\d{2,3})\s*(?:bpm|fc|pulsations)\b/i);
    if (hrMatch) {
      const val = parseInt(hrMatch[1], 10);
      if (val >= 40 && val <= 230) {
        avgHr = val;
      }
    }

    // 5. Détection de la Puissance
    let avgPower: number | undefined;
    const powerMatch = text.match(/\b(\d{2,4})\s*(?:w|watts)\b/i);
    if (powerMatch) {
      const val = parseInt(powerMatch[1], 10);
      if (val >= 30 && val <= 2500) {
        avgPower = val;
      }
    }

    // 6. Détection de la Date
    let startTimeIso = new Date().toISOString();
    const dateMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, '0');
      const month = dateMatch[2].padStart(2, '0');
      const year = dateMatch[3];
      startTimeIso = `${year}-${month}-${day}T10:00:00.000Z`;
    } else {
      uncertainFields.push('date');
      warnings.push("Date non explicitée : date du jour appliquée.");
    }

    const missingFields: string[] = [];
    if (!distanceMeters) missingFields.push('distance');
    if (!avgHr) missingFields.push('averageHeartRate');
    if (!avgPower) missingFields.push('power');

    if (durationSeconds === 0 && !distanceMeters) {
      return {
        success: false,
        workouts: [],
        errors: ["Aucune métrique minimale (durée ou distance) n'a pu être extraite du document."],
        warnings,
        isAmbiguous: true
      };
    }

    const workout: RawExtractedWorkoutData = {
      sportRaw,
      startTimeRaw: startTimeIso,
      durationSecondsRaw: durationSeconds,
      distanceMetersRaw: distanceMeters,
      averageHeartRateRaw: avgHr,
      averagePowerRaw: avgPower,
      confidence: sourceFormat === 'image' ? 'low' : (uncertainFields.length > 0 ? 'medium' : 'high'),
      uncertainFields,
      missingFields,
      extractionNotes: [
        `Extraction documentaire (${sourceFormat.toUpperCase()}) : ` +
        (uncertainFields.length > 0 ? `Champs incertains : [${uncertainFields.join(', ')}]. ` : 'Données lisibles. ') +
        `Confirmation de l'athlète requise.`
      ]
    };

    return {
      success: true,
      workouts: [workout],
      errors: [],
      warnings,
      isAmbiguous: uncertainFields.length > 0 || sourceFormat === 'image'
    };
  }

  /**
   * Extraction sécurisée de flux texte dans un binaire PDF sans exécution de code.
   */
  private static extractTextFromPdfBuffer(bytes: Uint8Array): string {
    const textChunks: string[] = [];
    const latin1 = new TextDecoder('latin1').decode(bytes);

    // 1. Recherche des blocs de texte dans les flux (stream ... endstream)
    const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
    let match: RegExpExecArray | null;

    while ((match = streamRegex.exec(latin1)) !== null) {
      const streamContent = match[1];

      // Extraction des chaînes entre parenthèses (...) Tj ou [(...)] TJ
      const tjRegex = /\(([^)]+)\)\s*Tj/g;
      let tjMatch: RegExpExecArray | null;
      while ((tjMatch = tjRegex.exec(streamContent)) !== null) {
        textChunks.push(tjMatch[1]);
      }

      const tjArrayRegex = /\[([^\]]+)\]\s*TJ/g;
      let tjArrMatch: RegExpExecArray | null;
      while ((tjArrMatch = tjArrayRegex.exec(streamContent)) !== null) {
        const innerTj = tjArrMatch[1];
        const innerStrings = innerTj.match(/\(([^)]+)\)/g);
        if (innerStrings) {
          textChunks.push(innerStrings.map(s => s.slice(1, -1)).join(' '));
        }
      }
    }

    // 2. Recherche générale de chaînes lisibles si les flux sont compressés ou bruts
    if (textChunks.length === 0) {
      // Détecter des lignes de texte claires
      const directStrings = latin1.match(/\(([a-zA-Z0-9À-ÿ\s,.:/_-]{4,})\)/g);
      if (directStrings) {
        textChunks.push(...directStrings.map(s => s.slice(1, -1)));
      }
    }

    return textChunks.join(' ');
  }
}
