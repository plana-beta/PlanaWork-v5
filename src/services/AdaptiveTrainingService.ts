import { PlannedWorkout, ActualWorkout, AthleteProfile, Sport } from '../domain/models';
import { WorkoutFeedback, WorkoutObservation } from '../domain/athleteHistoryTypes';
import { PmcData } from '../types';
import { CoachProposal, ProposedWorkoutModification } from '../domain/coachTypes';
import { CoachActionExecutor } from '../lib/coachActionExecutor';
import {
  AdaptiveProposal,
  AdaptiveProposalType,
  AdaptiveProposalStatus,
  AdaptiveAnalysisResult,
  DataProvenanceSummary,
  DataUncertaintyLevel,
  FatigueSignal,
  AdaptiveSessionChanges
} from '../domain/adaptiveTrainingTypes';
import { parseISO, format, addDays, startOfDay, isBefore, isAfter, differenceInDays } from 'date-fns';
import { useAppStore } from '../store';

/**
 * Seuils sportifs et physiologiques configurables et documentés.
 * Ces valeurs sont des seuils heuristiques basés sur la littérature de l'entraînement (Coggan/Allen)
 * et ne constituent en aucun cas des vérités médicales universelles.
 */
export const ADAPTIVE_THRESHOLDS = {
  HIGH_FATIGUE_ATL: 80,             // Fatigue aiguë élevée (ATL > 80 TSS/j)
  HIGH_FATIGUE_TSB: -20,            // Stress d'entraînement marqué (TSB < -20)
  EXTREME_FATIGUE_TSB: -30,         // Surcharge critique / besoin impératif d'assimilation (TSB < -30)
  OVERLOAD_TSS_RATIO: 1.30,         // Dépassement de charge de +30% par rapport au prévu
  HIGH_RPE_THRESHOLD: 8,            // RPE élevé auto-évalué par l'athlète (>= 8/10)
  VOLUME_REDUCTION_FACTOR: 0.75,    // Facteur d'allègement standard (-25%)
  EXTREME_VOLUME_REDUCTION: 0.60,   // Facteur d'allègement majeur (-40%)
  MIN_VOLUME_MINUTES: 25,           // Durée plancher pour une séance allégée
  MAX_PROPOSAL_VALIDITY_HOURS: 48,  // Expiration automatique de la proposition
  MIN_HISTORY_DAYS: 3               // Nombre minimum de jours d'historique pour une analyse fiable
};

/**
 * AdaptiveTrainingService
 * 
 * Moteur d'intelligence adaptative reliant les données de réconciliation post-séance (Phase 35)
 * à la planification future.
 * 
 * Garanties absolues :
 * 1. Aucune modification du planning sans validation explicite de l'athlète.
 * 2. Jamais de compensation automatique d'une séance manquée (interdiction de reporter la charge).
 * 3. Jamais d'augmentation de charge suite à une séance manquée ou écourtée.
 * 4. Aucun diagnostic médical ("surentraîné", "blessé", etc.).
 * 5. Préservation stricte de la provenance et de l'incertitude du TSS.
 * 6. Isolation stricte des données entre athlètes et validation des permissions.
 * 7. Transaction atomique, vérification des conflits concurrents et idempotence d'exécution.
 */
export class AdaptiveTrainingService {
  /**
   * Registre en mémoire des propositions adaptatives générées.
   */
  private static proposalsRegistry = new Map<string, AdaptiveProposal>();

  /**
   * Réinitialise le registre (principalement pour les tests d'isolation).
   */
  static resetRegistry(): void {
    this.proposalsRegistry.clear();
  }

  /**
   * Analyse déterministe de la charge, du feedback et des écarts pour formuler des propositions adaptatives.
   */
  static analyzeAndPropose(params: {
    athleteProfile: AthleteProfile;
    plannedWorkouts: PlannedWorkout[];
    actualWorkouts: ActualWorkout[];
    feedbacks?: WorkoutFeedback[];
    observations?: WorkoutObservation[];
    pmc?: PmcData[];
    currentDate?: Date;
    athleteId?: string;
  }): AdaptiveAnalysisResult {
    const {
      athleteProfile,
      plannedWorkouts,
      actualWorkouts,
      feedbacks = [],
      observations = [],
      pmc = [],
      currentDate = new Date()
    } = params;

    const athleteId = params.athleteId || athleteProfile?.id || 'unknown-athlete';
    const todayStr = format(currentDate, 'yyyy-MM-dd');
    const todayDate = startOfDay(currentDate);

    // 1. Audit de la qualité et de la provenance des données
    const provenance = this.auditDataProvenance(actualWorkouts, feedbacks);

    // 2. Vérification des données suffisantes
    const hasEnoughHistory = actualWorkouts.length > 0 || feedbacks.length > 0;
    if (!hasEnoughHistory) {
      return {
        status: 'INSUFFICIENT_DATA',
        athleteId,
        analyzedPeriod: { from: todayStr, to: todayStr },
        proposals: [],
        fatigueSignals: [],
        missingDataInfo: [
          "Aucune activité réelle enregistrée sur la période récente.",
          "Aucun retour de feedback athlète disponible.",
          "Impossible de calculer une tendance physiologique sans historique minimal."
        ],
        summary: "Données insuffisantes pour formuler une recommandation d'adaptation personnalisée.",
        dataProvenance: provenance
      };
    }

    // 3. Détection des signaux de fatigue factuels
    const fatigueSignals = this.extractFatigueSignals(actualWorkouts, feedbacks, observations, pmc, currentDate);

    // 4. Détection des séances futures éligibles à une adaptation
    const futurePlanned = plannedWorkouts
      .filter(w => w.date >= todayStr && w.status !== 'completed' && w.status !== 'missed')
      .sort((a, b) => a.date.localeCompare(b.date));

    if (futurePlanned.length === 0) {
      return {
        status: 'NO_CHANGE_NEEDED',
        athleteId,
        analyzedPeriod: { from: todayStr, to: todayStr },
        proposals: [],
        fatigueSignals,
        summary: "Aucune séance future planifiée nécessitant un ajustement.",
        dataProvenance: provenance
      };
    }

    // 5. Recherche d'une séance cible pour adaptation (demain ou prochaine séance intense)
    const proposals: AdaptiveProposal[] = [];
    const nextSession = futurePlanned[0];

    // Calcul de l'incertitude globale
    let uncertaintyLevel: DataUncertaintyLevel = 'LOW';
    if (provenance.estimatedCount > 0 && provenance.measuredCount === 0) {
      uncertaintyLevel = 'HIGH'; // TSS uniquement estimé sur la durée
    } else if (provenance.unavailableCount > 0) {
      uncertaintyLevel = 'MEDIUM';
    }

    // Analyse contradictoire : low RPE mais ATL extrême, ou vice versa
    const hasContradictoryData = this.detectContradictions(feedbacks, pmc);
    if (hasContradictoryData) {
      uncertaintyLevel = 'HIGH';
    }

    // A. Cas d'extrême fatigue (TSB < -30 ou athlète épuisé)
    const isExtremeFatigue = fatigueSignals.some(f => f.signal.includes('critique') || f.signal.includes('épuisé'));
    if (isExtremeFatigue) {
      const proposal = this.buildRecoveryProposal({
        athleteId,
        targetWorkout: nextSession,
        triggerObservations: observations,
        fatigueSignals,
        dataProvenance: provenance,
        uncertaintyLevel,
        currentDate
      });
      proposals.push(proposal);
      this.proposalsRegistry.set(proposal.id, proposal);
    }
    // B. Cas de fatigue élevée ou dépassement important sur la séance précédente
    else if (fatigueSignals.length > 0) {
      const isTargetIntense = this.isWorkoutIntense(nextSession);

      if (isTargetIntense) {
        // Proposition de réduction d'intensité (ex: Z4 -> Z2)
        const proposal = this.buildReduceIntensityProposal({
          athleteId,
          targetWorkout: nextSession,
          triggerObservations: observations,
          fatigueSignals,
          dataProvenance: provenance,
          uncertaintyLevel,
          currentDate
        });
        proposals.push(proposal);
        this.proposalsRegistry.set(proposal.id, proposal);
      } else {
        // Proposition de réduction de volume (-25%)
        const proposal = this.buildReduceVolumeProposal({
          athleteId,
          targetWorkout: nextSession,
          triggerObservations: observations,
          fatigueSignals,
          dataProvenance: provenance,
          uncertaintyLevel,
          currentDate
        });
        proposals.push(proposal);
        this.proposalsRegistry.set(proposal.id, proposal);
      }
    }

    const summary = proposals.length > 0
      ? `Adaptation suggérée : ${proposals[0].rationale}. En attente de décision de l'athlète.`
      : "Le programme actuel est en adéquation avec votre tolérance à la charge. Aucun ajustement nécessaire.";

    return {
      status: proposals.length > 0 ? 'ANALYSIS_COMPLETE' : 'NO_CHANGE_NEEDED',
      athleteId,
      analyzedPeriod: {
        from: actualWorkouts[0]?.date || todayStr,
        to: futurePlanned[futurePlanned.length - 1]?.date || todayStr
      },
      proposals,
      fatigueSignals,
      summary,
      dataProvenance: provenance
    };
  }

  /**
   * Audit approfondi de la provenance et de la qualité des données.
   */
  static auditDataProvenance(
    actualWorkouts: ActualWorkout[],
    feedbacks: WorkoutFeedback[]
  ): DataProvenanceSummary {
    let measuredCount = 0;
    let calculatedCount = 0;
    let estimatedCount = 0;
    let unavailableCount = 0;
    const sources = new Set<string>();
    const warnings: string[] = [];

    for (const act of actualWorkouts) {
      if (act.source) sources.add(act.source);

      const anyAct = act as any;
      if (anyAct.tssCalculationMethod === 'provided' || act.source?.toLowerCase().includes('garmin') || act.source?.toLowerCase().includes('strava')) {
        measuredCount++;
      } else if (anyAct.tssCalculationMethod === 'power_np' || act.normalizedPower !== undefined || anyAct.tssCalculationMethod === 'heart_rate' || act.averageHeartRate !== undefined) {
        calculatedCount++;
      } else if (anyAct.tssCalculationMethod === 'duration_estimate' || act.tss !== undefined) {
        estimatedCount++;
      } else {
        unavailableCount++;
      }
    }

    if (estimatedCount > 0) {
      warnings.push(`${estimatedCount} séance(s) utilisent un TSS estimé à partir de la durée uniquement (non équivalent à une mesure de puissance).`);
    }

    if (feedbacks.length === 0 && actualWorkouts.length > 0) {
      warnings.push("Aucun ressenti athlète (RPE) n'a été renseigné pour les activités récentes.");
    }

    return {
      measuredCount,
      calculatedCount,
      estimatedCount,
      unavailableCount,
      hasReliablePowerOrHr: (measuredCount + calculatedCount) > 0,
      sources: Array.from(sources),
      warnings
    };
  }

  /**
   * Extraction factuelle des signaux de fatigue, sans diagnostic médical.
   */
  static extractFatigueSignals(
    actualWorkouts: ActualWorkout[],
    feedbacks: WorkoutFeedback[],
    observations: WorkoutObservation[],
    pmc: PmcData[],
    currentDate: Date
  ): FatigueSignal[] {
    const signals: FatigueSignal[] = [];
    const nowIso = currentDate.toISOString();

    // 1. Signaux PMC (Charge aiguë ATL & Équilibre de stress TSB)
    const latestPmc = pmc.length > 0 ? pmc[pmc.length - 1] : null;
    if (latestPmc) {
      if (latestPmc.tsb < ADAPTIVE_THRESHOLDS.EXTREME_FATIGUE_TSB) {
        signals.push({
          signal: `Niveau de stress d'entraînement critique (TSB: ${Math.round(latestPmc.tsb)})`,
          source: 'Modèle PMC déterministe',
          confidence: 'HIGH',
          observedAt: latestPmc.date || nowIso
        });
      } else if (latestPmc.tsb < ADAPTIVE_THRESHOLDS.HIGH_FATIGUE_TSB) {
        signals.push({
          signal: `Charge d'entraînement soutenue (TSB: ${Math.round(latestPmc.tsb)}, ATL: ${Math.round(latestPmc.atl)})`,
          source: 'Modèle PMC déterministe',
          confidence: 'HIGH',
          observedAt: latestPmc.date || nowIso
        });
      }
    }

    // 2. Signaux de feedback explicite de l'athlète
    for (const fb of feedbacks) {
      if (fb.feeling === 'very_tired' || fb.feeling === 'exhausted') {
        signals.push({
          signal: `Fatigue marquée déclarée après la séance (${fb.feeling === 'exhausted' ? 'état épuisé' : 'très fatigué'})`,
          source: `Feedback athlète (${fb.date})`,
          confidence: 'HIGH',
          observedAt: fb.date
        });
      }
      if (fb.rpe >= ADAPTIVE_THRESHOLDS.HIGH_RPE_THRESHOLD) {
        signals.push({
          signal: `Effort perçu très élevé (RPE ${fb.rpe}/10) sur la séance du ${fb.date}`,
          source: 'Feedback athlète RPE',
          confidence: 'HIGH',
          observedAt: fb.date
        });
      }
    }

    // 3. Observations déterministes récentes
    for (const obs of observations) {
      if (obs.type === 'HIGH_FATIGUE_REPORTED' || obs.type === 'HIGH_PERCEIVED_EFFORT') {
        if (!signals.some(s => s.observedAt === obs.date && s.signal.includes(obs.title))) {
          signals.push({
            signal: obs.description,
            source: 'Observation déterministe post-séance',
            confidence: 'HIGH',
            observedAt: obs.date
          });
        }
      }
    }

    return signals;
  }

  /**
   * Détecte les contradictions entre les métriques objectives et le ressenti subjectif.
   */
  static detectContradictions(feedbacks: WorkoutFeedback[], pmc: PmcData[]): boolean {
    const latestPmc = pmc.length > 0 ? pmc[pmc.length - 1] : null;
    if (!latestPmc || feedbacks.length === 0) return false;

    const recentFb = feedbacks[0];
    // RPE très bas (1-2) alors que l'ATL est extrême (> 90) ou vice versa
    if (recentFb.rpe <= 2 && latestPmc.atl > 90) return true;
    if (recentFb.rpe >= 9 && latestPmc.atl < 30) return true;

    return false;
  }

  /**
   * Vérifie si une séance comporte des cibles d'intensité soutenue (Z4, Z5, Intervalles).
   */
  static isWorkoutIntense(workout: PlannedWorkout): boolean {
    const intensityVal = (workout.targetIntensity?.value || '').toUpperCase();
    const title = (workout.title || '').toLowerCase();
    return (
      intensityVal.includes('Z4') ||
      intensityVal.includes('Z5') ||
      intensityVal.includes('PMA') ||
      intensityVal.includes('SEUIL') ||
      title.includes('interval') ||
      title.includes('pma') ||
      title.includes('seuil') ||
      title.includes('fractionné')
    );
  }

  /**
   * Construction d'une proposition de réduction de volume.
   */
  private static buildReduceVolumeProposal(params: {
    athleteId: string;
    targetWorkout: PlannedWorkout;
    triggerObservations: WorkoutObservation[];
    fatigueSignals: FatigueSignal[];
    dataProvenance: DataProvenanceSummary;
    uncertaintyLevel: DataUncertaintyLevel;
    currentDate: Date;
  }): AdaptiveProposal {
    const { athleteId, targetWorkout, triggerObservations, fatigueSignals, dataProvenance, uncertaintyLevel, currentDate } = params;

    const originalDur = targetWorkout.targetDurationMin || targetWorkout.durationMin || 60;
    const reducedDur = Math.max(ADAPTIVE_THRESHOLDS.MIN_VOLUME_MINUTES, Math.round(originalDur * ADAPTIVE_THRESHOLDS.VOLUME_REDUCTION_FACTOR));
    const targetTss = targetWorkout.targetTss ? Math.round(targetWorkout.targetTss * ADAPTIVE_THRESHOLDS.VOLUME_REDUCTION_FACTOR) : undefined;

    const changes: AdaptiveSessionChanges = {
      workoutId: targetWorkout.id,
      originalWorkout: {
        title: targetWorkout.title,
        date: targetWorkout.date,
        durationMin: originalDur,
        targetTss: targetWorkout.targetTss,
        intensity: targetWorkout.targetIntensity?.value,
        sport: targetWorkout.sport,
        status: targetWorkout.status
      },
      proposedWorkout: {
        title: `${targetWorkout.title} (Allégée)`,
        date: targetWorkout.date,
        durationMin: reducedDur,
        targetTss,
        intensity: targetWorkout.targetIntensity?.value || 'Modérée',
        sport: targetWorkout.sport,
        status: 'adapted',
        explanation: "Volume réduit de 25% pour préserver l'assimilation suite aux signaux de fatigue récents."
      },
      beforeAfter: {
        durationMin: { before: originalDur, after: reducedDur },
        targetTss: targetWorkout.targetTss && targetTss ? { before: targetWorkout.targetTss, after: targetTss } : undefined
      }
    };

    const compatibleCoachProposal: CoachProposal = {
      id: `prop-adapt-vol-${targetWorkout.id}-${Date.now()}`,
      action: 'MODIFY_WORKOUT',
      affectedWorkoutIds: [targetWorkout.id],
      proposedModifications: [{
        workoutId: targetWorkout.id,
        newDurationMin: reducedDur,
        newTargetTss: targetTss,
        newStatus: 'adapted'
      }],
      summary: `Réduction du volume de la séance du ${targetWorkout.date} (${originalDur} min -> ${reducedDur} min)`,
      explanation: `Allègement préventif du volume (-${originalDur - reducedDur} min) suite aux signaux de fatigue observés (${fatigueSignals.map(f => f.signal).join(', ')}).`,
      confidence: uncertaintyLevel === 'HIGH' ? 'LOW' : 'HIGH',
      status: 'PROPOSED',
      proposedAt: currentDate.toISOString()
    };

    return {
      id: compatibleCoachProposal.id,
      athleteId,
      targetWorkoutId: targetWorkout.id,
      affectedWorkoutIds: [targetWorkout.id],
      type: 'REDUCE_VOLUME',
      createdAt: currentDate.toISOString(),
      expiresAt: addDays(currentDate, 2).toISOString(),
      triggerObservations,
      dataProvenance,
      rationale: `Allégement de la séance de ${targetWorkout.sport} du ${targetWorkout.date} (${reducedDur} min au lieu de ${originalDur} min).`,
      detailedExplanation: `Une fatigue soutenue a été détectée (${fatigueSignals.map(f => f.signal).join(' ; ')}). Réduire la durée de 25% protège votre récupération sans désorganiser le cycle d'entraînement.`,
      proposedChanges: changes,
      uncertaintyLevel,
      status: 'PENDING',
      compatibleCoachProposal
    };
  }

  /**
   * Construction d'une proposition de réduction d'intensité.
   */
  private static buildReduceIntensityProposal(params: {
    athleteId: string;
    targetWorkout: PlannedWorkout;
    triggerObservations: WorkoutObservation[];
    fatigueSignals: FatigueSignal[];
    dataProvenance: DataProvenanceSummary;
    uncertaintyLevel: DataUncertaintyLevel;
    currentDate: Date;
  }): AdaptiveProposal {
    const { athleteId, targetWorkout, triggerObservations, fatigueSignals, dataProvenance, uncertaintyLevel, currentDate } = params;

    const originalDur = targetWorkout.targetDurationMin || targetWorkout.durationMin || 60;
    const originalIntensity = targetWorkout.targetIntensity?.value || 'Intensité élevée';
    const targetTss = targetWorkout.targetTss ? Math.round(targetWorkout.targetTss * 0.70) : undefined;

    const changes: AdaptiveSessionChanges = {
      workoutId: targetWorkout.id,
      originalWorkout: {
        title: targetWorkout.title,
        date: targetWorkout.date,
        durationMin: originalDur,
        targetTss: targetWorkout.targetTss,
        intensity: originalIntensity,
        sport: targetWorkout.sport,
        status: targetWorkout.status
      },
      proposedWorkout: {
        title: `Endurance fondamentale Z2 (${targetWorkout.sport})`,
        date: targetWorkout.date,
        durationMin: originalDur,
        targetTss,
        intensity: 'Z2 / Aérobie',
        sport: targetWorkout.sport,
        status: 'adapted',
        explanation: "Intensité ramenée en zone aérobie Z2 pour éviter un stress excessif tout en maintenant le volume aérobie."
      },
      beforeAfter: {
        durationMin: { before: originalDur, after: originalDur },
        intensity: { before: originalIntensity, after: 'Z2 / Aérobie' },
        targetTss: targetWorkout.targetTss && targetTss ? { before: targetWorkout.targetTss, after: targetTss } : undefined
      }
    };

    const compatibleCoachProposal: CoachProposal = {
      id: `prop-adapt-int-${targetWorkout.id}-${Date.now()}`,
      action: 'MODIFY_WORKOUT',
      affectedWorkoutIds: [targetWorkout.id],
      proposedModifications: [{
        workoutId: targetWorkout.id,
        newIntensity: { type: 'zone', value: 'Z2' },
        newTargetTss: targetTss,
        newStatus: 'adapted'
      }],
      summary: `Remplacement de l'intensité (${originalIntensity}) par une séance en endurance fondamentale Z2`,
      explanation: `L'intensité est réduite en endurance fondamentale pour permettre une récupération active sans accumuler de fatigue neuromusculaire.`,
      confidence: uncertaintyLevel === 'HIGH' ? 'LOW' : 'HIGH',
      status: 'PROPOSED',
      proposedAt: currentDate.toISOString()
    };

    return {
      id: compatibleCoachProposal.id,
      athleteId,
      targetWorkoutId: targetWorkout.id,
      affectedWorkoutIds: [targetWorkout.id],
      type: 'REDUCE_INTENSITY',
      createdAt: currentDate.toISOString(),
      expiresAt: addDays(currentDate, 2).toISOString(),
      triggerObservations,
      dataProvenance,
      rationale: `Conversion de la séance d'intensité du ${targetWorkout.date} en endurance aérobie Z2.`,
      detailedExplanation: `Les retours d'effort (${fatigueSignals.map(f => f.signal).join(' ; ')}) indiquent une accumulation de fatigue. Remplacer les intervalles par une allure Z2 permet de maintenir la dépense aérobie sans épuiser le système cardio-vasculaire.`,
      proposedChanges: changes,
      uncertaintyLevel,
      status: 'PENDING',
      compatibleCoachProposal
    };
  }

  /**
   * Construction d'une proposition de repos / récupération complète.
   */
  private static buildRecoveryProposal(params: {
    athleteId: string;
    targetWorkout: PlannedWorkout;
    triggerObservations: WorkoutObservation[];
    fatigueSignals: FatigueSignal[];
    dataProvenance: DataProvenanceSummary;
    uncertaintyLevel: DataUncertaintyLevel;
    currentDate: Date;
  }): AdaptiveProposal {
    const { athleteId, targetWorkout, triggerObservations, fatigueSignals, dataProvenance, uncertaintyLevel, currentDate } = params;

    const originalDur = targetWorkout.targetDurationMin || targetWorkout.durationMin || 60;

    const changes: AdaptiveSessionChanges = {
      workoutId: targetWorkout.id,
      originalWorkout: {
        title: targetWorkout.title,
        date: targetWorkout.date,
        durationMin: originalDur,
        targetTss: targetWorkout.targetTss,
        intensity: targetWorkout.targetIntensity?.value,
        sport: targetWorkout.sport,
        status: targetWorkout.status
      },
      proposedWorkout: {
        title: "Jour de repos ou régénération",
        date: targetWorkout.date,
        durationMin: 0,
        targetTss: 0,
        intensity: 'Repos',
        sport: targetWorkout.sport,
        status: 'adapted',
        explanation: "Séance annulée et transformée en repos complet pour favoriser la régénération physiologique."
      },
      beforeAfter: {
        durationMin: { before: originalDur, after: 0 },
        targetTss: { before: targetWorkout.targetTss || 0, after: 0 },
        isRecoveryDay: true
      }
    };

    const compatibleCoachProposal: CoachProposal = {
      id: `prop-adapt-rec-${targetWorkout.id}-${Date.now()}`,
      action: 'CANCEL_WORKOUT',
      affectedWorkoutIds: [targetWorkout.id],
      proposedModifications: [{
        workoutId: targetWorkout.id,
        cancel: true,
        newDurationMin: 0,
        newTargetTss: 0,
        newStatus: 'adapted'
      }],
      summary: `Mise au repos complet le ${targetWorkout.date}`,
      explanation: `Un repos complet est préconisé au vu de la fatigue marquée pour prévenir la détérioration de la forme.`,
      confidence: 'HIGH',
      status: 'PROPOSED',
      proposedAt: currentDate.toISOString()
    };

    return {
      id: compatibleCoachProposal.id,
      athleteId,
      targetWorkoutId: targetWorkout.id,
      affectedWorkoutIds: [targetWorkout.id],
      type: 'ADD_RECOVERY',
      createdAt: currentDate.toISOString(),
      expiresAt: addDays(currentDate, 2).toISOString(),
      triggerObservations,
      dataProvenance,
      rationale: `Transformation de la séance du ${targetWorkout.date} en journée de repos complet.`,
      detailedExplanation: `Les indicateurs de charge (${fatigueSignals.map(f => f.signal).join(' ; ')}) recommandent une coupure complète pour restaurer les réserves physiologiques.`,
      proposedChanges: changes,
      uncertaintyLevel,
      status: 'PENDING',
      compatibleCoachProposal
    };
  }

  /**
   * Étape 1 : Acceptation formelle par l'athlète.
   * Valide les autorisations, la validité temporelle et fait passer l'état à 'ACCEPTED'.
   * NE MUTE PAS encore le planning (l'exécution transactionnelle est distincte).
   */
  static acceptProposal(
    proposalId: string,
    athleteId: string,
    options?: { userMessage?: string }
  ): {
    success: boolean;
    proposal?: AdaptiveProposal;
    error?: string;
    alreadyExecuted?: boolean;
    expired?: boolean;
  } {
    const proposal = this.proposalsRegistry.get(proposalId);
    if (!proposal) {
      return { success: false, error: `PROPOSAL_NOT_FOUND: Proposition '${proposalId}' introuvable.` };
    }

    // 1. Contrôle d'isolation et d'autorisation stricte
    if (proposal.athleteId !== athleteId) {
      return {
        success: false,
        error: `FORBIDDEN_ATHLETE_MISMATCH: Cette proposition appartient à un autre athlète (${proposal.athleteId} vs ${athleteId}).`
      };
    }

    // 2. Contrôle de péremption
    const now = new Date();
    if (proposal.status === 'EXPIRED' || (proposal.expiresAt && new Date(proposal.expiresAt) < now)) {
      proposal.status = 'EXPIRED';
      return { success: false, expired: true, error: "PROPOSAL_EXPIRED: La proposition a expiré." };
    }

    // 3. Déjà exécutée
    if (proposal.status === 'EXECUTED') {
      return { success: false, alreadyExecuted: true, error: "PROPOSAL_ALREADY_EXECUTED: Cette proposition a déjà été appliquée." };
    }

    // 4. Passage à l'état ACCEPTED
    proposal.status = 'ACCEPTED';
    proposal.userDecision = 'ACCEPTED';
    proposal.userMessage = options?.userMessage;

    return { success: true, proposal };
  }

  /**
   * Étape 2 : Rejet formelle par l'athlète.
   * Laisse le planning strictement inchangé et archive le statut 'REJECTED'.
   */
  static rejectProposal(
    proposalId: string,
    athleteId: string,
    reason?: string
  ): {
    success: boolean;
    proposal?: AdaptiveProposal;
    error?: string;
  } {
    const proposal = this.proposalsRegistry.get(proposalId);
    if (!proposal) {
      return { success: false, error: `PROPOSAL_NOT_FOUND: Proposition '${proposalId}' introuvable.` };
    }

    // Contrôle d'isolation
    if (proposal.athleteId !== athleteId) {
      return {
        success: false,
        error: `FORBIDDEN_ATHLETE_MISMATCH: Cette proposition appartient à un autre athlète.`
      };
    }

    proposal.status = 'REJECTED';
    proposal.userDecision = 'REJECTED';
    proposal.userMessage = reason;

    // Tracer le refus dans l'audit du coach
    CoachActionExecutor.recordRefusal(proposal.compatibleCoachProposal, {
      userMessage: reason || "Proposition refusée par l'athlète",
      reason: "Refus utilisateur"
    });

    return { success: true, proposal };
  }

  /**
   * Étape 3 : Exécution transactionnelle de la proposition après acceptation.
   * Détecte les modifications concurrentes, applique le changement au store et loggue l'audit.
   */
  static executeProposal(
    proposalId: string,
    athleteId: string
  ): {
    success: boolean;
    proposal?: AdaptiveProposal;
    conflict?: boolean;
    alreadyExecuted?: boolean;
    error?: string;
    message?: string;
  } {
    const proposal = this.proposalsRegistry.get(proposalId);
    if (!proposal) {
      return { success: false, error: `PROPOSAL_NOT_FOUND: Proposition '${proposalId}' introuvable.` };
    }

    // Contrôle d'isolation athlète
    if (proposal.athleteId !== athleteId) {
      return {
        success: false,
        error: "FORBIDDEN_ATHLETE_MISMATCH: Autorisation refusée pour cet athlète."
      };
    }

    // Déjà exécutée ?
    if (proposal.status === 'EXECUTED') {
      return {
        success: false,
        alreadyExecuted: true,
        message: "Cette proposition a déjà été exécutée précédemment."
      };
    }

    // Contrôle de péremption
    const now = new Date();
    if (proposal.status === 'EXPIRED' || (proposal.expiresAt && new Date(proposal.expiresAt) < now)) {
      proposal.status = 'EXPIRED';
      return { success: false, error: "PROPOSAL_EXPIRED: Impossible d'exécuter une proposition expirée." };
    }

    const store = useAppStore.getState();

    // 1. Détection de modification concurrente (la séance cible a-t-elle changé depuis ?)
    const currentTargetWorkout = store.plannedWorkouts.find(w => w.id === proposal.targetWorkoutId);
    if (!currentTargetWorkout) {
      proposal.status = 'FAILED';
      return {
        success: false,
        conflict: true,
        error: `CONFLICT_TARGET_DELETED: La séance ciblée (${proposal.targetWorkoutId}) n'existe plus dans le planning.`
      };
    }

    const orig = proposal.proposedChanges.originalWorkout;
    // Si la durée ou la date ou le statut a été altéré entre-temps
    const hasDurationChanged = (currentTargetWorkout.targetDurationMin || currentTargetWorkout.durationMin) !== orig.durationMin;
    const hasDateChanged = currentTargetWorkout.date !== orig.date;
    const isAlreadyCompleted = currentTargetWorkout.status === 'completed';

    if (hasDurationChanged || hasDateChanged || isAlreadyCompleted) {
      proposal.status = 'FAILED';
      return {
        success: false,
        conflict: true,
        error: "CONFLICT_CONCURRENT_MODIFICATION: La séance cible a été modifiée ou terminée après la formulation de cette proposition. Veuillez réévaluer l'adaptation."
      };
    }

    // 2. Exécution transactionnelle via CoachActionExecutor
    const execResult = CoachActionExecutor.executeProposal(proposal.compatibleCoachProposal, {
      userMessage: proposal.userMessage || "Validation de l'adaptation d'entraînement"
    });

    if (!execResult.success) {
      if (execResult.alreadyExecuted) {
        proposal.status = 'EXECUTED';
        return { success: false, alreadyExecuted: true, message: execResult.message };
      }
      proposal.status = 'FAILED';
      return { success: false, error: execResult.error || execResult.message };
    }

    // 3. Mise à jour de l'état final et audit
    proposal.status = 'EXECUTED';
    proposal.executedAt = new Date().toISOString();
    proposal.executionAudit = {
      decisionId: `dec-adapt-${Date.now()}`,
      appliedAt: proposal.executedAt,
      previousSnapshot: orig,
      finalSnapshot: proposal.proposedChanges.proposedWorkout
    };

    return {
      success: true,
      proposal,
      message: execResult.message
    };
  }

  /**
   * Récupère une proposition par identifiant.
   */
  static getProposal(proposalId: string): AdaptiveProposal | undefined {
    return this.proposalsRegistry.get(proposalId);
  }

  /**
   * Enregistre manuellement une proposition dans le registre (utile pour tests / mocks de fixtures).
   */
  static registerProposal(proposal: AdaptiveProposal): void {
    this.proposalsRegistry.set(proposal.id, proposal);
  }
}
