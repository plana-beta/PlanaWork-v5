import { PlannedWorkout, AthleteProfile } from '../domain/models';
import {
  CoachProposal,
  CoachActionValidationResult,
  CoachActionType,
  ConfidenceAssessment
} from '../domain/coachTypes';
import { getFatigueLevel } from './adaptationEngine';
import { parseISO, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';

export interface ValidationContext {
  plannedWorkouts: PlannedWorkout[];
  currentPmc: { tsb: number; atl: number; ctl: number } | null;
  confidence: ConfidenceAssessment;
  weeklyPlannedLoad: number;
  athleteProfile?: AthleteProfile | null;
}

const ALLOWED_ACTIONS: CoachActionType[] = [
  'ADAPT_PLAN',
  'MODIFY_WORKOUT',
  'MOVE_WORKOUT',
  'CANCEL_WORKOUT',
  'REDUCE_LOAD',
  'INCREASE_LOAD',
  'RECOVERY',
  'NO_CHANGE'
];

const FORBIDDEN_METRIC_KEYS = [
  'recalculatedctl',
  'newctl',
  'recalculatedatl',
  'newatl',
  'recalculatedtsb',
  'newtsb',
  'inventedtss',
  'recalculatedpmc'
];

/**
 * Validateur d'action du Coach IA.
 * 
 * GARDE-FOU STRICT:
 * - Vérifie que l'action est reconnue.
 * - Vérifie l'existence des séances ciblées.
 * - Rejette toute métrique physiologique recalculée ou inventée par l'IA.
 * - Enforce la règle stricte des +5% de la charge hebdomadaire globale prévue.
 * - Enforce l'absence de conflit avec AdaptationEngine (pas d'augmentation sous fatigue).
 * - Enforce l'interdiction de rattrapage de séance manquée (avoidMakeupTraining).
 * - Enforce l'exigence de données d'historique (pas d'augmentation avec INSUFFICIENT_DATA).
 * - Ne modifie JAMAIS le store Zustand.
 */
export function validateCoachProposal(
  proposal: CoachProposal,
  context: ValidationContext
): CoachActionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Vérification du type d'action
  if (!ALLOWED_ACTIONS.includes(proposal.action)) {
    errors.push(`Type d'action inconnu ou non supporté : "${proposal.action}".`);
  }

  // 2. Vérification des séances ciblées (doivent exister dans le plan)
  if (proposal.affectedWorkoutIds && proposal.affectedWorkoutIds.length > 0) {
    for (const id of proposal.affectedWorkoutIds) {
      const exists = context.plannedWorkouts.some(p => p.id === id);
      if (!exists) {
        errors.push(`Séance ciblée inexistante dans le planning : "${id}".`);
      }
    }
  }

  // 3. Détection de métriques physiologiques inventées ou recalculées par Gemini
  const allKeys = [
    ...Object.keys(proposal),
    ...(proposal.sourceContext ? Object.keys(proposal.sourceContext) : [])
  ].map(k => k.toLowerCase());

  const hasForbiddenKeys = allKeys.some(k =>
    FORBIDDEN_METRIC_KEYS.some(forbidden => k.includes(forbidden))
  );

  if (hasForbiddenKeys) {
    errors.push(
      "Rejet strict : la proposition contient des métriques d'entraînement recalculées ou inventées par l'IA. Seul Plana calcule le PMC."
    );
  }

  // 4. Règle des +5% de charge hebdomadaire maximale (sur la charge globale de la semaine)
  let requestedIncreasePercent = proposal.loadIncreasePercent;

  if (requestedIncreasePercent == null && proposal.sourceContext?.loadIncreasePercent != null) {
    requestedIncreasePercent = proposal.sourceContext.loadIncreasePercent;
  }

  // Si des modifications détaillées de séances sont spécifiées (proposedModifications), calculer le TSS résultant pour la semaine
  let proposedLoadFromModifications: number | null = null;
  if (proposal.proposedModifications && proposal.proposedModifications.length > 0 && context.plannedWorkouts.length > 0) {
    // Identifier la semaine de référence
    const targetWorkoutIds = proposal.affectedWorkoutIds.length > 0
      ? proposal.affectedWorkoutIds
      : proposal.proposedModifications.map(m => m.workoutId);
    const refWorkout = context.plannedWorkouts.find(w => targetWorkoutIds.includes(w.id));
    
    let workoutsInWeek = context.plannedWorkouts;
    if (refWorkout?.date) {
      try {
        const refDate = parseISO(refWorkout.date);
        const wStart = startOfWeek(refDate, { weekStartsOn: 1 });
        const wEnd = endOfWeek(refDate, { weekStartsOn: 1 });
        workoutsInWeek = context.plannedWorkouts.filter(w => {
          try {
            const d = parseISO(w.date);
            return isWithinInterval(d, { start: wStart, end: wEnd });
          } catch {
            return false;
          }
        });
      } catch {
        // ignore
      }
    }

    let sumTss = 0;
    for (const w of workoutsInWeek) {
      const mod = proposal.proposedModifications.find(m => m.workoutId === w.id);
      if (mod) {
        if (mod.cancel) {
          sumTss += 0;
        } else if (mod.newTargetTss != null) {
          sumTss += mod.newTargetTss;
        } else if (mod.newDurationMin != null) {
          sumTss += (mod.newDurationMin / 60) * 50;
        } else {
          sumTss += w.targetTss ?? ((w.targetDurationMin / 60) * 50);
        }
      } else {
        sumTss += w.targetTss ?? ((w.targetDurationMin / 60) * 50);
      }
    }
    proposedLoadFromModifications = sumTss;
  }

  const effectiveProposedWeeklyLoad = proposal.sourceContext?.proposedWeeklyLoad ?? proposedLoadFromModifications;

  if (
    requestedIncreasePercent == null &&
    effectiveProposedWeeklyLoad != null &&
    context.weeklyPlannedLoad > 0
  ) {
    const delta = effectiveProposedWeeklyLoad - context.weeklyPlannedLoad;
    if (delta > 0) {
      requestedIncreasePercent = (delta / context.weeklyPlannedLoad) * 100;
    }
  }

  // Prendre également en compte si proposal.constraints.maxWeeklyLoadIncrease dépasse les 5%
  if (proposal.constraints?.maxWeeklyLoadIncrease != null) {
    const limit = proposal.constraints.maxWeeklyLoadIncrease > 1
      ? proposal.constraints.maxWeeklyLoadIncrease
      : proposal.constraints.maxWeeklyLoadIncrease * 100;
    if (limit > 5.0001 && requestedIncreasePercent == null) {
      requestedIncreasePercent = limit;
    }
  }

  // Normaliser si exprimé en ratio décimal (ex: 0.05 = 5%, 0.06 = 6%)
  if (requestedIncreasePercent != null && requestedIncreasePercent > 0 && requestedIncreasePercent <= 1) {
    requestedIncreasePercent = requestedIncreasePercent * 100;
  }

  if (requestedIncreasePercent != null && requestedIncreasePercent > 5.0001) {
    errors.push(
      `Rejet : l'augmentation de charge demandée (+${requestedIncreasePercent.toFixed(1)}%) dépasse le plafond strict de +5% de la charge hebdomadaire prévue.`
    );
  }

  // Vérifier aussi par les TSS bruts si fournis pour toute action
  if (effectiveProposedWeeklyLoad != null && context.weeklyPlannedLoad > 0) {
    const maxAllowedTss = context.weeklyPlannedLoad * 1.05001;
    if (effectiveProposedWeeklyLoad > maxAllowedTss) {
      errors.push(
        `Rejet : la charge hebdomadaire proposée (${Math.round(effectiveProposedWeeklyLoad)} TSS) dépasse la limite autorisée de +5% (${Math.round(context.weeklyPlannedLoad * 1.05)} TSS max).`
      );
    }
  }

  // 5. Exigence de données historiques pour une augmentation
  if (proposal.action === 'INCREASE_LOAD' || (requestedIncreasePercent != null && requestedIncreasePercent > 0)) {
    if (context.confidence.level === 'INSUFFICIENT_DATA') {
      errors.push(
        "Rejet : données historiques insuffisantes (< 4 semaines). Une augmentation de charge ne peut être validée sans historique statistique fiable."
      );
    }
  }

  // 6. Conflit avec AdaptationEngine (Règles physiologiques unifiées)
  const fatigueLevel = getFatigueLevel(context.currentPmc);

  if (fatigueLevel === 'high' || fatigueLevel === 'extreme') {
    if (proposal.action === 'INCREASE_LOAD' || (requestedIncreasePercent != null && requestedIncreasePercent > 0)) {
      errors.push(
        `Rejet (conflit avec AdaptationEngine) : aucune augmentation de charge n'est autorisée en état de fatigue ${fatigueLevel === 'extreme' ? 'extrême' : 'élevée'} (TSB: ${context.currentPmc?.tsb}, ATL: ${context.currentPmc?.atl}).`
      );
    } else if (proposal.action === 'REDUCE_LOAD' || proposal.action === 'RECOVERY' || proposal.action === 'ADAPT_PLAN') {
      warnings.push(
        `Adaptation en cohérence avec AdaptationEngine : allègement validé pour fatigue ${fatigueLevel}.`
      );
    }
  }

  // 7. Règle des séances manquées : réorganisation permise mais interdiction de rattrapage automatique
  if (
    proposal.constraints?.avoidMakeupTraining === false ||
    proposal.constraints?.autoMakeupMissedLoad === true ||
    (typeof proposal.sourceContext?.missedWorkoutLoadAdded === 'number' && proposal.sourceContext.missedWorkoutLoadAdded > 0)
  ) {
    errors.push(
      "Rejet : interdiction formelle de rattraper ou d'ajouter automatiquement la charge d'une séance manquée aux autres séances."
    );
  }

  const isValid = errors.length === 0;

  return {
    valid: isValid,
    errors,
    warnings,
    normalizedAction: isValid ? proposal : undefined,
    blockedReason: isValid ? undefined : errors[0]
  };
}
