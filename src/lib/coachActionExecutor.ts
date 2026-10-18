import { useAppStore } from '../store';
import {
  CoachProposal,
  CoachActionExecutionResult,
  CoachDecision,
  ProposedWorkoutModification
} from '../domain/coachTypes';
import { validateCoachProposal } from './coachActionValidator';
import { calculateWeeklyPlannedLoad } from './coachContextBuilder';
import { generatePMC, calculateDurationTSS } from './trainingEngine';
import { PlannedWorkout } from '../domain/models';
import { parseISO } from 'date-fns';

/**
 * CoachActionExecutor
 * 
 * Exécute une proposition de coach validée UNIQUEMENT après validation explicite de l'athlète.
 * 
 * Garanties strictes :
 * 1. Transaction atomique : copie de travail avant mutation. En cas d'erreur ou d'échec,
 *    l'état initial est restauré (rollback) et une trace FAILED est loggée dans l'audit.
 * 2. Plan Identity préservée : conserve planId, les IDs des séances non concernées,
 *    l'historique, actual workouts et relations existantes.
 * 3. Validation de sécurité finale obligatoire via CoachActionValidator.
 * 4. Recalculs déterministes Plana (charge, semaine, PMC) sans intervention de Gemini.
 * 5. Audit systématique : enregistre un CoachDecision ('EXECUTED' ou 'FAILED').
 */
export class CoachActionExecutor {
  /**
   * Exécute une proposition validée.
   */
  static executeProposal(
    proposal: CoachProposal,
    options?: { userMessage?: string }
  ): CoachActionExecutionResult {
    const store = useAppStore.getState();
    const currentPmc = store.pmc.length > 0 ? store.pmc[store.pmc.length - 1] : null;

    // Déterminer la date cible de référence pour la charge hebdomadaire
    let targetDate = new Date();
    if (proposal.affectedWorkoutIds && proposal.affectedWorkoutIds.length > 0) {
      const firstTarget = store.plannedWorkouts.find(w => proposal.affectedWorkoutIds.includes(w.id));
      if (firstTarget?.date) {
        try {
          targetDate = parseISO(firstTarget.date);
        } catch {
          // ignore
        }
      }
    }

    const currentWeeklyLoad = calculateWeeklyPlannedLoad(store.plannedWorkouts, targetDate);

    // 1. Validation de sécurité finale obligatoire via CoachActionValidator
    const validation = validateCoachProposal(proposal, {
      plannedWorkouts: store.plannedWorkouts,
      currentPmc,
      confidence: proposal.confidence ? {
        level: proposal.confidence,
        reasons: [],
        historyWeeks: 4,
        recentWorkoutsCount: 6
      } : {
        level: 'HIGH',
        reasons: [],
        historyWeeks: 4,
        recentWorkoutsCount: 6
      },
      weeklyPlannedLoad: currentWeeklyLoad,
      athleteProfile: store.athleteProfile
    });

    if (!validation.valid) {
      const failureResult: CoachActionExecutionResult = {
        success: false,
        message: validation.blockedReason || 'La proposition viole les règles de sécurité physiologiques.',
        updatedWorkoutsCount: 0,
        recalculatedWeeklyLoad: currentWeeklyLoad,
        recalculatedPmcCount: store.pmc.length,
        error: validation.errors.join('; ')
      };

      // Enregistrer l'audit d'échec
      const auditEntry: CoachDecision = {
        id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        createdAt: new Date().toISOString(),
        userMessage: options?.userMessage,
        proposal,
        validationResult: validation,
        userDecision: 'FAILED',
        engineResult: failureResult,
        error: failureResult.error
      };
      useAppStore.getState().addCoachDecision?.(auditEntry);

      return failureResult;
    }

    // 2. Préparation atomique : copie de travail pour préserver l'intégrité du plan
    const initialWorkoutsSnapshot = store.plannedWorkouts.map(w => ({ ...w }));
    let updatedWorkouts: PlannedWorkout[] = store.plannedWorkouts.map(w => ({ ...w }));
    let count = 0;
    const appliedModifications: ProposedWorkoutModification[] = [];

    try {
      if (proposal.proposedModifications && proposal.proposedModifications.length > 0) {
        for (const mod of proposal.proposedModifications) {
          const index = updatedWorkouts.findIndex(w => w.id === mod.workoutId);
          if (index !== -1) {
            const original = updatedWorkouts[index];
            if (mod.cancel || proposal.action === 'CANCEL_WORKOUT') {
              updatedWorkouts[index] = {
                ...original,
                // Préservation de l'identité
                id: original.id,
                planId: original.planId,
                sport: original.sport,
                status: 'adapted',
                targetDurationMin: 0,
                targetTss: 0,
                explanation: `Annulée sur recommandation du coach : ${proposal.reason}`
              };
            } else {
              // Recalcul déterministe du TSS si nouvelle durée sans TSS explicite
              const newDuration = mod.newDurationMin ?? original.targetDurationMin;
              let calculatedTss = mod.newTargetTss;
              if (calculatedTss == null) {
                if (mod.newDurationMin != null && mod.newDurationMin !== original.targetDurationMin) {
                  calculatedTss = calculateDurationTSS(newDuration);
                } else {
                  calculatedTss = original.targetTss;
                }
              }

              updatedWorkouts[index] = {
                ...original,
                // Préservation de l'identité
                id: original.id,
                planId: original.planId,
                sport: original.sport,
                date: mod.newDate ?? original.date,
                targetDurationMin: newDuration,
                durationMin: newDuration,
                targetIntensity: mod.newIntensity ?? original.targetIntensity,
                targetTss: calculatedTss,
                status: mod.newStatus ?? 'adapted',
                explanation: proposal.reason
              } as any;
            }
            appliedModifications.push(mod);
            count++;
          }
        }
      } else if (proposal.affectedWorkoutIds && proposal.affectedWorkoutIds.length > 0) {
        // Actions synthétiques sans proposedModifications explicites
        for (const id of proposal.affectedWorkoutIds) {
          const index = updatedWorkouts.findIndex(w => w.id === id);
          if (index !== -1) {
            const original = updatedWorkouts[index];
            if (proposal.action === 'CANCEL_WORKOUT') {
              updatedWorkouts[index] = {
                ...original,
                id: original.id,
                planId: original.planId,
                status: 'adapted',
                targetDurationMin: 0,
                targetTss: 0,
                explanation: `Séance annulée par le coach : ${proposal.reason}`
              };
              appliedModifications.push({ workoutId: id, cancel: true });
              count++;
            } else if (proposal.action === 'REDUCE_LOAD' || proposal.action === 'RECOVERY') {
              const reducedDuration = Math.max(20, Math.round(original.targetDurationMin * 0.7));
              const reducedTss = original.targetTss
                ? Math.round(original.targetTss * 0.7)
                : calculateDurationTSS(reducedDuration);
              updatedWorkouts[index] = {
                ...original,
                id: original.id,
                planId: original.planId,
                targetDurationMin: reducedDuration,
                targetTss: reducedTss,
                targetIntensity: { type: 'zone', value: 'Z1/Z2' },
                status: 'adapted',
                explanation: `Séance allégée par le coach : ${proposal.reason}`
              };
              appliedModifications.push({
                workoutId: id,
                newDurationMin: reducedDuration,
                newTargetTss: reducedTss
              });
              count++;
            } else if (proposal.action === 'INCREASE_LOAD') {
              const mult = 1 + (Math.min(proposal.loadIncreasePercent ?? 5, 5) / 100);
              const newDuration = Math.round(original.targetDurationMin * mult);
              const newTss = original.targetTss
                ? Math.round(original.targetTss * mult)
                : calculateDurationTSS(newDuration);
              updatedWorkouts[index] = {
                ...original,
                id: original.id,
                planId: original.planId,
                targetDurationMin: newDuration,
                targetTss: newTss,
                status: 'adapted',
                explanation: `Progression validée : ${proposal.reason}`
              };
              appliedModifications.push({
                workoutId: id,
                newDurationMin: newDuration,
                newTargetTss: newTss
              });
              count++;
            } else if (proposal.action === 'MOVE_WORKOUT') {
              // Si pas de modification de date détaillée spécifiée
              appliedModifications.push({ workoutId: id });
              count++;
            } else if (proposal.action === 'ADAPT_PLAN' || proposal.action === 'MODIFY_WORKOUT') {
              updatedWorkouts[index] = {
                ...original,
                id: original.id,
                planId: original.planId,
                status: 'adapted',
                explanation: proposal.reason
              };
              appliedModifications.push({ workoutId: id });
              count++;
            }
          }
        }
      }

      // 3. Application au store Zustand
      store.setPlannedWorkouts(updatedWorkouts);

      // 4. Recalcul déterministe de la charge hebdomadaire avec Plana TrainingEngine
      const newWeeklyLoad = calculateWeeklyPlannedLoad(updatedWorkouts, targetDate);

      // 5. Recalcul déterministe du PMC
      const recalculatedPmc = generatePMC(
        store.actualWorkouts,
        store.ftp,
        store.athleteProfile?.hrMax
      );
      useAppStore.setState({ pmc: recalculatedPmc });

      const successResult: CoachActionExecutionResult = {
        success: true,
        message: `Planning ajusté avec succès : ${count} séance(s) mise(s) à jour.`,
        updatedWorkoutsCount: count,
        recalculatedWeeklyLoad: newWeeklyLoad,
        recalculatedPmcCount: recalculatedPmc.length
      };

      // 6. Trace d'audit systématique
      const auditEntry: CoachDecision = {
        id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        createdAt: new Date().toISOString(),
        userMessage: options?.userMessage,
        proposal,
        validationResult: validation,
        userDecision: 'EXECUTED',
        appliedChanges: appliedModifications,
        engineResult: successResult
      };
      useAppStore.getState().addCoachDecision?.(auditEntry);

      return successResult;
    } catch (err: any) {
      // Rollback atomique vers la copie initiale
      store.setPlannedWorkouts(initialWorkoutsSnapshot);

      const rollbackResult: CoachActionExecutionResult = {
        success: false,
        message: `Erreur inattendue lors de l'ajustement du plan. Le planning a été conservé intact.`,
        updatedWorkoutsCount: 0,
        recalculatedWeeklyLoad: currentWeeklyLoad,
        recalculatedPmcCount: store.pmc.length,
        error: err.message
      };

      const auditEntry: CoachDecision = {
        id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        createdAt: new Date().toISOString(),
        userMessage: options?.userMessage,
        proposal,
        validationResult: validation,
        userDecision: 'FAILED',
        engineResult: rollbackResult,
        error: err.message
      };
      useAppStore.getState().addCoachDecision?.(auditEntry);

      return rollbackResult;
    }
  }
}

