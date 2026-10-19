import { PlannedWorkout, ActualWorkout, Sport } from '../domain/models';
import { WorkoutFeedback, WorkoutObservation, ConfidenceLevel } from '../domain/athleteHistoryTypes';
import { CoachProposal } from '../domain/coachTypes';
import {
  ReconciliationMatchStatus,
  MetricComparisonItem,
  TssProvenanceInfo,
  TssProvenanceStatus,
  TssMethod,
  PostWorkoutContextInfo,
  WorkoutReconciliationResult
} from '../domain/workoutReconciliationTypes';
import { analyzeWorkoutExecution } from '../lib/postWorkoutAnalysis';
import { parseISO, differenceInMinutes, addDays, format } from 'date-fns';

/**
 * WorkoutReconciliationService
 * Service central de rapprochement déterministe entre séances planifiées,
 * activités réelles importées/réalisées, retours d'athlète et adaptations futures.
 * 
 * Garanties strictes de Phase 35 :
 * 1. Ne jamais associer automatiquement une activité en cas d'ambiguïté (MATCH_AMBIGUOUS).
 * 2. Comparer uniquement les métriques réellement disponibles, sans jamais substituer 0 à une donnée manquante.
 * 3. Qualifier explicitement la provenance du TSS (MEASURED_OR_IMPORTED, DETERMINISTICALLY_CALCULATED, ESTIMATED, UNAVAILABLE).
 * 4. Identifier clairement l'estimation fondée sur la durée comme NON équivalente à une mesure de puissance.
 * 5. Température réelle avec provenance uniquement ; cause indéterminée signalée si contexte manquant.
 * 6. Aucune compensation brutale d'une séance manquée et aucune mutation automatique du plan.
 */
export class WorkoutReconciliationService {
  /**
   * Rapproche une activité réelle unique avec la liste des séances planifiées.
   */
  static reconcile(params: {
    actualWorkout: ActualWorkout;
    plannedWorkouts: PlannedWorkout[];
    claimedPlannedIds?: Set<string>;
    feedback?: WorkoutFeedback | null;
    currentDate?: Date;
    athleteFtp?: number;
    athleteHrMax?: number;
  }): WorkoutReconciliationResult {
    const { actualWorkout, plannedWorkouts, claimedPlannedIds = new Set(), feedback, currentDate = new Date() } = params;

    // 1. Détection du rapprochement (matching)
    const matchClassification = this.classifyMatch(actualWorkout, plannedWorkouts, claimedPlannedIds);

    const matchedPlanned = matchClassification.matchedPlanned;
    const matchStatus = matchClassification.status;
    const matchReason = matchClassification.reason;
    const matchConfidence = matchClassification.confidence;

    // Si une séance planifiée est fermement ou probablement associée, marquer son ID comme réservé
    if (matchedPlanned && (matchStatus === 'MATCH_CONFIRMED' || matchStatus === 'MATCH_PROBABLE')) {
      claimedPlannedIds.add(matchedPlanned.id);
    }

    // 2. Comparaison des métriques disponibles des deux côtés (jamais de 0 artificiel)
    const comparison = this.buildMetricComparison(actualWorkout, matchedPlanned, feedback);

    // 3. Audit et provenance du TSS
    const tssInfo = this.auditTssProvenance(actualWorkout, matchedPlanned);

    // 4. Analyse post-séance déterministe (faits, observations, ressenti)
    const observations = this.generateObservations(actualWorkout, matchedPlanned, feedback, comparison, currentDate);

    // 5. Contexte et température
    const context = this.extractContext(actualWorkout, feedback);

    // 6. Proposition d'adaptation future (sous contrôle strict athlète, pas de compensation brutale)
    const proposedAdaptation = this.deriveProposedAdaptation(
      actualWorkout,
      matchedPlanned,
      observations,
      feedback,
      plannedWorkouts,
      currentDate
    );

    return {
      actualWorkout,
      plannedWorkout: matchedPlanned,
      status: matchStatus,
      matchConfidence,
      matchReason,
      comparison,
      tssInfo,
      feedback: feedback || undefined,
      observations,
      proposedAdaptation,
      context,
      requiresAthleteDecision: matchStatus === 'MATCH_AMBIGUOUS' || proposedAdaptation !== undefined
    };
  }

  /**
   * Rapproche un ensemble d'activités réelles avec prévention des doubles liaisons.
   */
  static reconcileAll(params: {
    actualWorkouts: ActualWorkout[];
    plannedWorkouts: PlannedWorkout[];
    feedbacks?: WorkoutFeedback[];
    currentDate?: Date;
    athleteFtp?: number;
    athleteHrMax?: number;
  }): WorkoutReconciliationResult[] {
    const claimedPlannedIds = new Set<string>();
    const results: WorkoutReconciliationResult[] = [];

    // Priorité 1 : séances ayant un plannedWorkoutId explicite
    const explicitActuals = params.actualWorkouts.filter(a => !!a.plannedWorkoutId);
    const implicitActuals = params.actualWorkouts.filter(a => !a.plannedWorkoutId);

    const sortedActuals = [...explicitActuals, ...implicitActuals];

    for (const actual of sortedActuals) {
      const fb = params.feedbacks?.find(
        f => (f.actualWorkoutId && f.actualWorkoutId === actual.id) ||
             (f.date === actual.date && f.sport === actual.sport)
      );

      const res = this.reconcile({
        actualWorkout: actual,
        plannedWorkouts: params.plannedWorkouts,
        claimedPlannedIds,
        feedback: fb,
        currentDate: params.currentDate,
        athleteFtp: params.athleteFtp,
        athleteHrMax: params.athleteHrMax
      });

      results.push(res);
    }

    return results;
  }

  /**
   * Classification du rapprochement :
   * MATCH_CONFIRMED, MATCH_PROBABLE, MATCH_AMBIGUOUS, NO_MATCH.
   */
  static classifyMatch(
    actual: ActualWorkout,
    plannedWorkouts: PlannedWorkout[],
    claimedPlannedIds: Set<string>
  ): {
    status: ReconciliationMatchStatus;
    matchedPlanned?: PlannedWorkout;
    reason: string;
    confidence: number;
  } {
    // A. Si l'activité réelle référence directement un identifiant de séance planifiée
    if (actual.plannedWorkoutId) {
      const explicit = plannedWorkouts.find(p => p.id === actual.plannedWorkoutId);
      if (explicit) {
        return {
          status: 'MATCH_CONFIRMED',
          matchedPlanned: explicit,
          reason: `Liaison explicite confirmée via l'identifiant '${actual.plannedWorkoutId}'.`,
          confidence: 1.0
        };
      }
    }

    // B. Candidats disponibles le même jour pour le même sport non encore réservés
    const candidates = plannedWorkouts.filter(
      p => p.date === actual.date && p.sport === actual.sport && !claimedPlannedIds.has(p.id)
    );

    if (candidates.length === 0) {
      return {
        status: 'NO_MATCH',
        reason: `Aucune séance planifiée de ${actual.sport} trouvée le ${actual.date}.`,
        confidence: 0
      };
    }

    // C. Un seul candidat le même jour
    if (candidates.length === 1) {
      const candidate = candidates[0];
      const plannedDur = candidate.targetDurationMin || candidate.durationMin || 0;
      const actualDur = actual.durationMin || 0;
      const durDiff = Math.abs(actualDur - plannedDur);

      // Si écart de durée très faible (<= 15 min ou <= 20%)
      const isDurationClose = plannedDur > 0 ? (durDiff <= 15 || durDiff / plannedDur <= 0.2) : true;

      // Vérification horaire si disponible
      let isTimeClose = true;
      if (actual.startTime && candidate.startTime) {
        try {
          const t1 = parseISO(actual.startTime);
          const t2 = parseISO(candidate.startTime);
          const timeDiff = Math.abs(differenceInMinutes(t1, t2));
          isTimeClose = timeDiff <= 45;
        } catch {
          // ignore parsing error
        }
      }

      if (isDurationClose && isTimeClose) {
        return {
          status: 'MATCH_CONFIRMED',
          matchedPlanned: candidate,
          reason: `Correspondance unique et confirmée le ${actual.date} (${actual.sport}, durée réelle ${actualDur} min vs prévue ${plannedDur} min).`,
          confidence: 0.95
        };
      }

      // Si durée plus éloignée mais seul candidat le même jour
      return {
        status: 'MATCH_PROBABLE',
        matchedPlanned: candidate,
        reason: `Correspondance probable le ${actual.date} avec écart de volume (${actualDur} min vs ${plannedDur} min prévue).`,
        confidence: 0.75
      };
    }

    // D. Plusieurs candidats le même jour pour le même sport -> Détection d'ambiguïté
    const actualDur = actual.durationMin || 0;
    const scoredCandidates = candidates.map(c => {
      const plannedDur = c.targetDurationMin || c.durationMin || 0;
      const durDiff = Math.abs(actualDur - plannedDur);
      return { candidate: c, plannedDur, durDiff };
    }).sort((a, b) => a.durDiff - b.durDiff);

    const best = scoredCandidates[0];
    const secondBest = scoredCandidates[1];

    // RÈGLE STRICTE ANTI-AMBIGUÏTÉ :
    // Si les deux meilleures séances candidates ont un écart similaire avec le réalisé (différence <= 10 min),
    // ou si les durées sont toutes les deux très proches, refuser l'association automatique !
    if (Math.abs(best.durDiff - secondBest.durDiff) <= 10) {
      return {
        status: 'MATCH_AMBIGUOUS',
        reason: `Ambiguïté : ${candidates.length} séances planifiées de ${actual.sport} existent le ${actual.date} sans critère d'attribution décisif. Association automatique bloquée.`,
        confidence: 0.4
      };
    }

    // Si l'un des candidats est nettement plus proche que tous les autres
    return {
      status: 'MATCH_PROBABLE',
      matchedPlanned: best.candidate,
      reason: `Correspondance probable avec '${best.candidate.title}' (${best.plannedDur} min), significativement plus proche que les autres séances du jour.`,
      confidence: 0.8
    };
  }

  /**
   * Comparaison stricte des métriques présentes des deux côtés.
   * Aucune substitution d'un 0 artificiel pour une métrique manquante.
   */
  static buildMetricComparison(
    actual: ActualWorkout,
    planned?: PlannedWorkout,
    feedback?: WorkoutFeedback | null
  ): MetricComparisonItem[] {
    const items: MetricComparisonItem[] = [];

    // 1. Durée
    const plannedDur = planned ? (planned.targetDurationMin ?? planned.durationMin) : undefined;
    const actualDur = actual.durationMin;
    if (plannedDur !== undefined && actualDur !== undefined) {
      const delta = actualDur - plannedDur;
      const pct = plannedDur > 0 ? Math.round((delta / plannedDur) * 100) : 0;
      const isSignificant = Math.abs(delta) >= 10 || Math.abs(pct) >= 15;
      items.push({
        metric: 'duration',
        label: 'Durée',
        unit: 'min',
        plannedValue: plannedDur,
        actualValue: actualDur,
        deltaAbsolute: delta,
        deltaPercentage: pct,
        plannedSource: 'Séance planifiée',
        actualSource: actual.source || 'Donnée réelle',
        confidence: 'HIGH',
        isSignificantDiscrepancy: isSignificant,
        explanation: isSignificant
          ? (delta > 0 ? `Durée prolongée de +${delta} min (+${pct}%)` : `Durée raccourcie de ${delta} min (${pct}%)`)
          : 'Volume réalisé conforme aux prévisions'
      });
    }

    // 2. Distance
    const plannedDist = planned?.distanceKm;
    const actualDist = actual.distanceKm;
    if (plannedDist !== undefined && actualDist !== undefined) {
      const delta = parseFloat((actualDist - plannedDist).toFixed(2));
      const pct = plannedDist > 0 ? Math.round((delta / plannedDist) * 100) : 0;
      const isSignificant = Math.abs(delta) >= 2 || Math.abs(pct) >= 15;
      items.push({
        metric: 'distance',
        label: 'Distance',
        unit: 'km',
        plannedValue: plannedDist,
        actualValue: actualDist,
        deltaAbsolute: delta,
        deltaPercentage: pct,
        plannedSource: 'Séance planifiée',
        actualSource: actual.source || 'Capteur/Trace GPS',
        confidence: 'HIGH',
        isSignificantDiscrepancy: isSignificant,
        explanation: isSignificant
          ? (delta > 0 ? `Distance supérieure de +${delta} km` : `Distance inférieure de ${delta} km`)
          : 'Distance conforme'
      });
    }

    // 3. Charge / TSS
    const plannedTss = planned?.targetTss;
    const actualTss = actual.tss;
    if (plannedTss !== undefined && actualTss !== undefined) {
      const delta = Math.round(actualTss - plannedTss);
      const pct = plannedTss > 0 ? Math.round((delta / plannedTss) * 100) : 0;
      const isSignificant = Math.abs(delta) >= 15 || Math.abs(pct) >= 20;
      items.push({
        metric: 'tss',
        label: 'Charge (TSS)',
        unit: 'TSS',
        plannedValue: plannedTss,
        actualValue: actualTss,
        deltaAbsolute: delta,
        deltaPercentage: pct,
        plannedSource: 'Plan prévisionnel',
        actualSource: actual.source || 'Calcul déterministe',
        confidence: 'HIGH',
        isSignificantDiscrepancy: isSignificant,
        explanation: isSignificant
          ? (delta > 0 ? `Charge réalisée supérieure de +${delta} TSS (+${pct}%)` : `Charge réalisée inférieure de ${delta} TSS (${pct}%)`)
          : 'Charge réalisée en adéquation avec la cible'
      });
    }

    // 4. Puissance / Normalized Power (NP)
    const actualNp = actual.normalizedPower;
    if (actualNp !== undefined) {
      items.push({
        metric: 'power',
        label: 'Puissance (NP)',
        unit: 'W',
        plannedValue: planned?.targetIntensity?.value?.includes('W') ? planned.targetIntensity.value : undefined,
        actualValue: actualNp,
        actualSource: actual.source || 'Capteur de puissance',
        confidence: 'HIGH',
        isSignificantDiscrepancy: false,
        explanation: `Puissance normalisée de ${actualNp} W enregistrée.`
      });
    }

    // 5. Fréquence cardiaque
    const actualHr = actual.averageHeartRate;
    if (actualHr !== undefined) {
      items.push({
        metric: 'heart_rate',
        label: 'Cardio moyen',
        unit: 'bpm',
        actualValue: actualHr,
        actualSource: actual.source || 'Ceinture / Capteur optique',
        confidence: 'HIGH',
        isSignificantDiscrepancy: false,
        explanation: `Fréquence cardiaque moyenne mesurée à ${actualHr} bpm.`
      });
    }

    // 6. RPE / Ressenti athlète
    if (feedback?.rpe !== undefined) {
      items.push({
        metric: 'rpe',
        label: 'Effort perçu (RPE)',
        unit: '/10',
        actualValue: feedback.rpe,
        actualSource: 'Feedback athlète post-séance',
        confidence: 'HIGH',
        isSignificantDiscrepancy: feedback.rpe >= 8 || feedback.rpe <= 2,
        explanation: `Effort perçu auto-évalué à ${feedback.rpe}/10.`
      });
    }

    return items;
  }

  /**
   * Audit strict de la qualité et de la provenance du TSS.
   */
  static auditTssProvenance(
    actual: ActualWorkout,
    planned?: PlannedWorkout
  ): TssProvenanceInfo {
    const plannedTss = planned?.targetTss;
    const actualTss = actual.tss;

    if (actualTss === undefined || actualTss === null) {
      return {
        plannedTss,
        actualTss: undefined,
        status: 'UNAVAILABLE',
        method: 'none',
        sourceDescription: "Aucune valeur de charge disponible.",
        isEstimatedOnly: false
      };
    }

    // Détection de la provenance
    const sourceStr = (actual.source || '').toLowerCase();
    const anyActual = actual as any;

    if (anyActual.tssCalculationMethod === 'provided' || sourceStr.includes('garmin') || sourceStr.includes('fit') || sourceStr.includes('tcx') || sourceStr.includes('strava')) {
      return {
        plannedTss,
        actualTss,
        status: 'MEASURED_OR_IMPORTED',
        method: 'device_provided',
        sourceDescription: `TSS importé directement depuis le fichier/appareil (${actual.source || 'montre/compteur'}).`,
        isEstimatedOnly: false
      };
    }

    if (anyActual.tssCalculationMethod === 'power_np' || actual.normalizedPower !== undefined) {
      return {
        plannedTss,
        actualTss,
        status: 'DETERMINISTICALLY_CALCULATED',
        method: 'power_np',
        sourceDescription: `Calcul déterministe via Puissance Normalisée (${actual.normalizedPower} W) et FTP.`,
        isEstimatedOnly: false
      };
    }

    if (anyActual.tssCalculationMethod === 'heart_rate' || actual.averageHeartRate !== undefined) {
      return {
        plannedTss,
        actualTss,
        status: 'DETERMINISTICALLY_CALCULATED',
        method: 'heart_rate',
        sourceDescription: `Calcul déterministe hrTSS via Fréquence Cardiaque (${actual.averageHeartRate} bpm) et FCmax.`,
        isEstimatedOnly: false
      };
    }

    // Cas résiduel : estimation basée sur la durée uniquement
    return {
      plannedTss,
      actualTss,
      status: 'ESTIMATED',
      method: 'duration_estimate',
      sourceDescription: `Estimation fondée uniquement sur la durée (${actual.durationMin} min).`,
      isEstimatedOnly: true,
      reliabilityWarning: "Estimation fondée uniquement sur la durée. Cette valeur ne reflète pas l'intensité physiologique réelle et est non équivalente à une mesure de puissance."
    };
  }

  /**
   * Analyse des observations post-séance sans diagnostic médical.
   */
  static generateObservations(
    actual: ActualWorkout,
    planned?: PlannedWorkout,
    feedback?: WorkoutFeedback | null,
    comparison: MetricComparisonItem[] = [],
    currentDate: Date = new Date()
  ): WorkoutObservation[] {
    const observations = analyzeWorkoutExecution({
      plannedWorkout: planned,
      actualWorkout: actual,
      feedback,
      currentDate
    });

    // Observation supplémentaire sur la qualité du TSS si estimation uniquement
    const tssComp = comparison.find(c => c.metric === 'tss');
    const isDurationEstimate = (actual as any).tssCalculationMethod === 'duration_estimate';
    if (isDurationEstimate && tssComp) {
      observations.push({
        id: `obs-tss-est-${actual.id}`,
        workoutId: planned?.id,
        actualWorkoutId: actual.id,
        date: actual.date,
        type: 'INTENSITY_DISCREPANCY',
        title: 'Charge estimée (durée uniquement)',
        description: "La charge de cette séance est estimée à partir de la durée uniquement, en l'absence de capteur de puissance ou cardio.",
        createdAt: currentDate.toISOString()
      });
    }

    return observations;
  }

  /**
   * Extraction et validation du contexte environnemental (température réelle).
   */
  static extractContext(
    actual: ActualWorkout,
    feedback?: WorkoutFeedback | null
  ): PostWorkoutContextInfo {
    const rawTemp = actual.temperature ?? feedback?.temperature;
    const indeterminateReasons: string[] = [];

    if (typeof rawTemp === 'number' && !isNaN(rawTemp)) {
      return {
        hasTemperature: true,
        temperature: rawTemp,
        temperatureSource: actual.temperature !== undefined ? `${actual.source || 'Appareil'} (Capteur thermique)` : 'Saisie athlète',
        timestamp: actual.startTime || actual.date,
        indeterminateReasons: []
      };
    }

    indeterminateReasons.push("Température ambiante non enregistrée : impossible d'attribuer une dérive cardiaque à la chaleur.");
    return {
      hasTemperature: false,
      indeterminateReasons
    };
  }

  /**
   * Dérivation d'une proposition d'adaptation si écart significatif ou fatigue prononcée.
   * RÈGLE STRICTE : AUCUNE adaptation automatique, et AUCUNE compensation brutale de séance manquée.
   */
  static deriveProposedAdaptation(
    actual: ActualWorkout,
    planned?: PlannedWorkout,
    observations: WorkoutObservation[] = [],
    feedback?: WorkoutFeedback | null,
    allPlannedWorkouts: PlannedWorkout[] = [],
    currentDate: Date = new Date()
  ): CoachProposal | undefined {
    // Si l'athlète a signalé une fatigue marquée ou un RPE très élevé sur une séance légère
    const hasFatigue = observations.some(o => o.type === 'HIGH_FATIGUE_REPORTED' || o.type === 'HIGH_PERCEIVED_EFFORT');
    const isVeryTired = feedback?.feeling === 'very_tired' || feedback?.feeling === 'exhausted' || (feedback?.rpe ?? 0) >= 9;

    // Prochaine séance planifiée (demain ou après-demain)
    const todayStr = actual.date;
    const tomorrowStr = format(addDays(parseISO(todayStr), 1), 'yyyy-MM-dd');
    const nextPlanned = allPlannedWorkouts.find(p => p.date === tomorrowStr && p.status !== 'completed');

    if ((hasFatigue || isVeryTired) && nextPlanned) {
      const originalDur = nextPlanned.targetDurationMin || nextPlanned.durationMin || 60;
      const reducedDur = Math.max(30, Math.round(originalDur * 0.75));

      return {
        id: `prop-reconcile-fatigue-${actual.id}`,
        action: 'MODIFY_WORKOUT',
        targetWorkoutId: nextPlanned.id,
        affectedWorkoutIds: [nextPlanned.id],
        proposedModifications: [{
          workoutId: nextPlanned.id,
          newDurationMin: reducedDur,
          newTargetTss: nextPlanned.targetTss ? Math.round(nextPlanned.targetTss * 0.7) : undefined,
          newStatus: 'adapted'
        }],
        summary: `Allégement de la séance du ${tomorrowStr} suite à la fatigue signalée`,
        explanation: `Allégement de la séance du ${tomorrowStr} suite à la fatigue signalée`,
        workoutUpdate: {
          targetDurationMin: reducedDur,
          durationMin: reducedDur,
          targetTss: nextPlanned.targetTss ? Math.round(nextPlanned.targetTss * 0.7) : undefined,
          description: `${nextPlanned.description || nextPlanned.title} (Allégé de ${originalDur - reducedDur} min pour favoriser la récupération)`
        },
        physiologicalRationale: "Un niveau élevé d'effort ou de fatigue a été signalé lors de la dernière séance. Réduire temporairement le volume du lendemain protège l'assimilation sans accumuler de retard.",
        impactAnalysis: {
          loadDifferenceTss: nextPlanned.targetTss ? -Math.round(nextPlanned.targetTss * 0.3) : -15,
          fatigueImpact: 'FAVORABLE',
          formTrend: 'STABLE'
        },
        status: 'PROPOSED',
        createdAt: currentDate.toISOString()
      };
    }

    return undefined;
  }
}
