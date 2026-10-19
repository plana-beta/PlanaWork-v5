import {
  ImportAnalysisResult,
  ImportExecutionResult,
  RawExtractedWorkoutData,
  NormalizedWorkoutData,
  DuplicateMatch
} from '../../domain/workoutImportTypes';
import { FileTypeDetector } from './FileTypeDetector';
import { FitParser } from './parsers/FitParser';
import { TcxParser } from './parsers/TcxParser';
import { GpxParser } from './parsers/GpxParser';
import { CsvParser } from './parsers/CsvParser';
import { JsonParser } from './parsers/JsonParser';
import { DocumentParser } from './parsers/DocumentParser';
import { WorkoutNormalizer } from './WorkoutNormalizer';
import { WorkoutImportValidator } from './WorkoutImportValidator';
import { WorkoutDeduplicationService } from './WorkoutDeduplicationService';
import { useAppStore } from '../../store';
import { ActualWorkout } from '../../domain/models';

export interface FileInputData {
  name: string;
  size: number;
  content: string | ArrayBuffer | Uint8Array;
  mimeType?: string;
  ocrText?: string;
}

/**
 * WorkoutFileImportService
 * Orchestrateur universel d'import et d'analyse déterministe de fichiers sportifs.
 * 
 * Garanties strictes de Phase 34 :
 * 1. Séparation absolue des 5 étapes (fichier original, données extraites, normalisation, analyse, confirmation).
 * 2. L'analyse ne mute JAMAIS le store ni le planning d'entraînement.
 * 3. Seule l'action explicite de confirmation (executeImport) insère les séances réelles.
 * 4. Déduplication protectrice : aucun écrasement silencieux d'une séance existante.
 * 5. Calculs physiologiques réservés à TrainingEngine (TSS, hrTSS, NP) sans appel à Gemini.
 */
export class WorkoutFileImportService {
  /**
   * Étape 1 à 4 : Analyse complète d'un fichier sans mutation d'état.
   */
  static async analyzeFile(input: FileInputData): Promise<ImportAnalysisResult> {
    const fileName = input.name;
    const sizeBytes = input.size;

    // 1. Détection sécurisée du format et des limites de taille
    const detection = FileTypeDetector.detect(fileName, input.content);

    const baseResult: ImportAnalysisResult = {
      fileInfo: {
        name: fileName,
        sizeBytes,
        detectedFormat: detection.format,
        mimeType: detection.mimeType,
        isSecurityCompliant: detection.isCompliant
      },
      status: 'ready',
      extractedWorkouts: [],
      normalizedWorkouts: [],
      duplicateMatches: [],
      validationErrors: [],
      validationWarnings: [],
      summaryText: '',
      metricsSummary: {
        totalWorkoutsCount: 0,
        totalDurationMin: 0,
        totalDistanceKm: 0,
        totalEstimatedTss: 0
      }
    };

    if (!detection.isCompliant || detection.format === 'unknown') {
      baseResult.status = detection.error?.includes('volumineux') ? 'invalid' : 'unsupported';
      baseResult.validationErrors.push(detection.error || "Format de fichier non supporté pour l'import d'activités.");
      baseResult.summaryText = detection.error || "Format non supporté.";
      return baseResult;
    }

    // 2. Conversion du contenu en format exploitable par le parseur spécifique
    let extractedWorkouts: RawExtractedWorkoutData[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      switch (detection.format) {
        case 'fit': {
          let buffer: Uint8Array;
          if (typeof input.content === 'string') {
            buffer = new TextEncoder().encode(input.content);
          } else if (input.content instanceof Uint8Array) {
            buffer = input.content;
          } else {
            buffer = new Uint8Array(input.content);
          }
          const fitRes = FitParser.parse(buffer);
          extractedWorkouts = fitRes.workouts;
          errors.push(...fitRes.errors);
          warnings.push(...fitRes.warnings);
          break;
        }

        case 'tcx': {
          const text = this.ensureString(input.content);
          const tcxRes = TcxParser.parse(text);
          extractedWorkouts = tcxRes.workouts;
          errors.push(...tcxRes.errors);
          warnings.push(...tcxRes.warnings);
          break;
        }

        case 'gpx': {
          const text = this.ensureString(input.content);
          const gpxRes = GpxParser.parse(text);
          extractedWorkouts = gpxRes.workouts;
          errors.push(...gpxRes.errors);
          warnings.push(...gpxRes.warnings);
          break;
        }

        case 'csv': {
          const text = this.ensureString(input.content);
          const csvRes = CsvParser.parse(text);
          extractedWorkouts = csvRes.workouts;
          errors.push(...csvRes.errors);
          warnings.push(...csvRes.warnings);
          break;
        }

        case 'json': {
          const text = this.ensureString(input.content);
          const jsonRes = JsonParser.parse(text);
          extractedWorkouts = jsonRes.workouts;
          errors.push(...jsonRes.errors);
          warnings.push(...jsonRes.warnings);
          break;
        }

        case 'pdf': {
          const pdfRes = DocumentParser.parsePdf(input.content);
          extractedWorkouts = pdfRes.workouts;
          errors.push(...pdfRes.errors);
          warnings.push(...pdfRes.warnings);
          break;
        }

        case 'image': {
          const imgRes = DocumentParser.parseImage(fileName, input.ocrText);
          extractedWorkouts = imgRes.workouts;
          errors.push(...imgRes.errors);
          warnings.push(...imgRes.warnings);
          break;
        }

        default:
          errors.push(`Aucun parseur disponible pour le format '${detection.format}'.`);
          break;
      }
    } catch (e: any) {
      errors.push(`Erreur inattendue lors de la lecture du fichier : ${e.message}`);
    }

    if (errors.length > 0 && extractedWorkouts.length === 0) {
      baseResult.status = 'invalid';
      baseResult.validationErrors = errors;
      baseResult.validationWarnings = warnings;
      baseResult.summaryText = errors.join(' ; ');
      return baseResult;
    }

    // 3. Normalisation déterministe et calcul physiologique Plana (TrainingEngine)
    const normalizedWorkouts: NormalizedWorkoutData[] = [];
    const sourceIdentifier = `${detection.format}_import`;

    extractedWorkouts.forEach((raw, idx) => {
      const normalized = WorkoutNormalizer.normalize(raw, sourceIdentifier, idx);
      normalizedWorkouts.push(normalized);
    });

    // 4. Contrôle de validité physiologique et détection des doublons
    const existingActuals = useAppStore.getState?.()?.actualWorkouts || [];
    const plannedWorkouts = useAppStore.getState?.()?.plannedWorkouts || [];
    const duplicateMatches: DuplicateMatch[] = [];

    for (const nw of normalizedWorkouts) {
      // Validation des bornes physiologiques
      const valReport = WorkoutImportValidator.validate(nw);
      if (!valReport.isValid) {
        errors.push(...valReport.errors);
      }
      if (valReport.warnings.length > 0) {
        warnings.push(...valReport.warnings);
      }

      // Vérification des doublons
      const dup = WorkoutDeduplicationService.checkDuplicate(nw, existingActuals);
      if (dup) {
        duplicateMatches.push(dup);
      }

      // Rapprochement avec le planning existant
      const matchingPlanned = WorkoutDeduplicationService.findMatchingPlannedWorkout(nw, plannedWorkouts);
      if (matchingPlanned) {
        nw.matchedPlannedWorkoutId = matchingPlanned.id;
      }
    }

    // 5. Synthèse des métriques
    const totalDurationMin = normalizedWorkouts.reduce((sum, w) => sum + w.durationMin, 0);
    const totalDistanceKm = parseFloat(
      normalizedWorkouts.reduce((sum, w) => sum + (w.distanceKm || 0), 0).toFixed(2)
    );
    const totalEstimatedTss = normalizedWorkouts.reduce((sum, w) => sum + (w.tss || 0), 0);

    // 6. Détermination du statut de confirmation
    let finalStatus: ImportAnalysisResult['status'] = 'ready';
    if (errors.length > 0 && normalizedWorkouts.length === 0) {
      finalStatus = 'invalid';
    } else if (duplicateMatches.length > 0) {
      finalStatus = 'duplicate_warning';
    } else if (
      detection.format === 'image' ||
      detection.format === 'pdf' ||
      normalizedWorkouts.some(w => w.confidence === 'low' || w.uncertainFields.length > 0)
    ) {
      finalStatus = 'needs_confirmation';
    }

    const summaryText = this.buildSummaryText(
      detection.format,
      normalizedWorkouts.length,
      totalDurationMin,
      totalDistanceKm,
      totalEstimatedTss,
      duplicateMatches.length
    );

    return {
      fileInfo: {
        name: fileName,
        sizeBytes,
        detectedFormat: detection.format,
        mimeType: detection.mimeType,
        isSecurityCompliant: true
      },
      status: finalStatus,
      extractedWorkouts,
      normalizedWorkouts,
      duplicateMatches,
      validationErrors: errors,
      validationWarnings: warnings,
      summaryText,
      metricsSummary: {
        totalWorkoutsCount: normalizedWorkouts.length,
        totalDurationMin,
        totalDistanceKm,
        totalEstimatedTss
      }
    };
  }

  /**
   * Étape 5 : Exécution atomique de l'import après confirmation explicite de l'athlète.
   */
  static executeImport(
    analysis: ImportAnalysisResult,
    options?: {
      allowDuplicates?: boolean;
      selectedIndices?: number[];
    }
  ): ImportExecutionResult {
    if (!analysis || analysis.normalizedWorkouts.length === 0) {
      return {
        success: false,
        importedCount: 0,
        skippedDuplicatesCount: 0,
        matchedPlannedCount: 0,
        recalculatedPmcDays: 0,
        message: "Aucun entraînement à importer.",
        importedWorkoutIds: []
      };
    }

    const store = useAppStore.getState();
    const importedIds: string[] = [];
    let skippedDuplicates = 0;
    let matchedPlannedCount = 0;

    const indicesToImport = options?.selectedIndices ?? analysis.normalizedWorkouts.map((_, i) => i);

    for (const idx of indicesToImport) {
      const workout = analysis.normalizedWorkouts[idx];
      if (!workout) continue;

      // Vérifier si doublon et si les doublons sont refusés
      const isDuplicate = analysis.duplicateMatches.some(
        d => d.existingWorkout.sourceId === workout.sourceId ||
             (d.existingWorkout.date === workout.date && d.existingWorkout.sport === workout.sport && Math.abs(d.existingWorkout.durationMin - workout.durationMin) <= 2)
      );

      if (isDuplicate && !options?.allowDuplicates) {
        skippedDuplicates++;
        continue;
      }

      // Conversion en ActualWorkout pour persistance
      const actualWorkout: ActualWorkout = {
        id: workout.id,
        source: workout.source,
        sourceId: workout.sourceId,
        sport: workout.sport,
        date: workout.date,
        startTime: workout.startTime,
        durationMin: workout.durationMin,
        distanceKm: workout.distanceKm,
        averageHeartRate: workout.averageHeartRate,
        normalizedPower: workout.normalizedPower,
        tss: workout.tss,
        title: workout.title,
        temperature: workout.temperature,
        plannedWorkoutId: workout.matchedPlannedWorkoutId
      };

      store.addActualWorkout(actualWorkout);
      importedIds.push(actualWorkout.id);

      if (workout.matchedPlannedWorkoutId) {
        matchedPlannedCount++;
      }
    }

    const recalculatedPmc = store.pmc.length;

    const message = importedIds.length > 0
      ? `${importedIds.length} entraînement(s) importé(s) avec succès. PMC recalculé (${analysis.metricsSummary.totalEstimatedTss} TSS ajoutés).`
      : "Aucun nouvel entraînement n'a été importé (doublons ignorés).";

    return {
      success: importedIds.length > 0,
      importedCount: importedIds.length,
      skippedDuplicatesCount: skippedDuplicates,
      matchedPlannedCount,
      recalculatedPmcDays: recalculatedPmc,
      message,
      importedWorkoutIds: importedIds
    };
  }

  private static ensureString(content: string | ArrayBuffer | Uint8Array): string {
    if (typeof content === 'string') return content;
    const uint8 = content instanceof Uint8Array ? content : new Uint8Array(content);
    return new TextDecoder('utf-8', { fatal: false }).decode(uint8);
  }

  private static buildSummaryText(
    format: string,
    count: number,
    durationMin: number,
    distanceKm: number,
    tss: number,
    duplicateCount: number
  ): string {
    const hours = Math.floor(durationMin / 60);
    const mins = durationMin % 60;
    const durStr = hours > 0 ? `${hours}h${mins > 0 ? mins : ''}` : `${mins} min`;

    let text = `${count} séance(s) détectée(s) au format ${format.toUpperCase()} (${durStr}`;
    if (distanceKm > 0) text += `, ${distanceKm} km`;
    if (tss > 0) text += `, ~${tss} TSS`;
    text += `).`;

    if (duplicateCount > 0) {
      text += ` Attention : ${duplicateCount} doublon(s) potentiel(s) détecté(s).`;
    }

    return text;
  }
}
