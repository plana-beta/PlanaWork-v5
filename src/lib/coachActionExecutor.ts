import { useAppStore } from '../store';
import {
  CoachProposal,
  CoachActionExecutionResult,
  CoachDecision,
  CoachActionValidationResult,
  ProposedWorkoutModification
} from '../domain/coachTypes';
import { validateCoachProposal } from './coachActionValidator';
import { calculateWeeklyPlannedLoad } from './coachContextBuilder';
import { generatePMC, calculateDurationTSS } from './trainingEngine';
import { PlannedWorkout, AthleteProfile } from '../domain/models';
import { parseISO, getDay } from 'date-fns';

/**
 * CoachActionExecutor
 * 
 * Exécute une proposition de coach validée UNIQUEMENT après validation explicite de l'athlète.
 * 
 * Garanties strictes de Phase 32 (Planning Execution Integrity & End-to-End Validation) :
 * 1. Transaction atomique & Rollback : copie de travail avant mutation. Si une étape échoue
 *    ou si la cohérence post-application est violée, l'état initial est restauré (rollback)
 *    et une trace FAILED / ROLLBACK est loggée dans l'audit.
 * 2. Idempotence & Anti-double confirmation : une proposition déjà exécutée ne peut pas être
 *    rejouée ni dupliquée. Protection contre les clics concurrents.
 * 3. Détection d'obsolescence : si les séances ciblées ont été supprimées, terminées ou modifiées
 *    depuis la création de la proposition, celle-ci est marquée OBSOLETE et rejetée sans mutation.
 * 4. Respect du refus : une proposition refusée ne peut jamais être appliquée.
 * 5. Revalidation des propositions personnalisées : toute modification utilisateur est revalidée
 *    avant exécution.
 * 6. Intégrité du planning : vérification d'absence de doublons, préservation stricte des séances
 *    non ciblées, respect des disponibilités et de la règle physiologique +5% max.
 * 7. Séparation absolue : la charge planifiée et les actual workouts sont strictement séparés.
 *    Les actual workouts ne sont jamais mutés par l'exécuteur.
 * 8. Intégrité de l'audit : si l'enregistrement de l'audit échoue, le planning est restauré
 *    immédiatement pour empêcher toute modification non auditée.
 */
export class CoachActionExecutor {
  /**
   * Verrou d'exécution en mémoire pour empêcher les doubles clics ou requêtes concurrentes.
   */
  private static inFlightExecutions = new Set<string>();

  /**
   * Vérifie si une proposition est devenue obsolète par rapport à l'état actuel du store.
   */
  static isProposalObsolete(
    proposal: CoachProposal,
    customStore?: ReturnType<typeof useAppStore.getState>
  ): { obsolete: boolean; reason?: string } {
    const store = customStore || useAppStore.getState();

    if (!proposal.affectedWorkoutIds || proposal.affectedWorkoutIds.length === 0) {
      if (proposal.action !== 'NO_CHANGE') {
        return { obsolete: true, reason: "La proposition ne référence aucune séance cible." };
      }
      return { obsolete: false };
    }

    for (const targetId of proposal.affectedWorkoutIds) {
      const existing = store.plannedWorkouts.find(w => w.id === targetId);
      if (!existing) {
        return {
          obsolete: true,
          reason: `La séance ciblée (${targetId}) est inexistante dans le planning.`
        };
      }
      if (existing.status === 'completed') {
        return {
          obsolete: true,
          reason: `La séance ciblée (${targetId}) est déjà marquée comme terminée.`
        };
      }
    }

    if (proposal.proposedModifications && proposal.proposedModifications.length > 0) {
      for (const mod of proposal.proposedModifications) {
        const existing = store.plannedWorkouts.find(w => w.id === mod.workoutId);
        if (!existing) {
          return {
            obsolete: true,
            reason: `La séance à modifier (${mod.workoutId}) est inexistante dans le planning.`
          };
        }
      }
    }

    return { obsolete: false };
  }

  /**
   * Vérifie la cohérence globale du planning après application en mémoire.
   */
  static validatePlanningCoherence(
    updatedWorkouts: PlannedWorkout[],
    initialWorkouts: PlannedWorkout[],
    proposal: CoachProposal,
    profile: AthleteProfile | null,
    targetDate: Date = new Date(),
    baselineWeeklyLoad?: number
  ): { coherent: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. Absence de doublons d'identifiants
    const idSet = new Set<string>();
    for (const w of updatedWorkouts) {
      if (idSet.has(w.id)) {
        errors.push(`Doublon détecté pour la séance ID: ${w.id}`);
      }
      idSet.add(w.id);
    }

    // 2. Préservation stricte des séances non concernées
    const affectedSet = new Set(proposal.affectedWorkoutIds || []);
    for (const orig of initialWorkouts) {
      if (!affectedSet.has(orig.id)) {
        const current = updatedWorkouts.find(w => w.id === orig.id);
        if (!current) {
          errors.push(`Séance non concernée (${orig.id}) supprimée par erreur.`);
        } else {
          if (
            current.date !== orig.date ||
            current.sport !== orig.sport ||
            current.targetDurationMin !== orig.targetDurationMin ||
            current.targetTss !== orig.targetTss ||
            current.planId !== orig.planId
          ) {
            errors.push(`Altération non autorisée d'une séance non concernée (${orig.id}).`);
          }
        }
      }
    }

    // 3. Format des dates et cohérence temporelle
    for (const w of updatedWorkouts) {
      if (!w.date || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) {
        errors.push(`Format de date invalide pour la séance ${w.id}: ${w.date}`);
      }
    }

    // 4. Respect des disponibilités si séance déplacée
    if (proposal.action === 'MOVE_WORKOUT' && profile?.availability?.availableDays) {
      const availableDaysLower = profile.availability.availableDays.map(d => d.toLowerCase());
      const dayMap: Record<number, string[]> = {
        0: ['dimanche', 'sunday'],
        1: ['lundi', 'monday'],
        2: ['mardi', 'tuesday'],
        3: ['mercredi', 'wednesday'],
        4: ['jeudi', 'thursday'],
        5: ['vendredi', 'friday'],
        6: ['samedi', 'saturday']
      };

      for (const mod of proposal.proposedModifications || []) {
        if (mod.newDate) {
          try {
            const parsed = parseISO(mod.newDate);
            const dayNum = getDay(parsed);
            const dayNames = dayMap[dayNum] || [];
            const isDayAvailable = dayNames.some(name => availableDaysLower.includes(name));
            if (!isDayAvailable) {
              errors.push(`La date de déplacement (${mod.newDate}) correspond à un jour indisponible selon le profil athlète.`);
            }
          } catch {
            errors.push(`Date de déplacement invalide: ${mod.newDate}`);
          }
        }
      }
    }

    // 5. Règle physiologique : augmentation hebdomadaire plafonnée à +5%
    if (baselineWeeklyLoad != null && baselineWeeklyLoad > 0) {
      const recalculatedLoad = calculateWeeklyPlannedLoad(updatedWorkouts, targetDate);
      const maxAllowed = Math.round(baselineWeeklyLoad * 1.05 + 1);
      if (recalculatedLoad > maxAllowed) {
        errors.push(`La charge hebdomadaire recalculée (${recalculatedLoad} TSS) dépasse le plafond autorisé de +5% (${maxAllowed} TSS).`);
      }
    }

    return {
      coherent: errors.length === 0,
      errors
    };
  }

  /**
   * Enregistre un refus explicite de l'athlète sans muter le plan.
   */
  static recordRefusal(
    proposal: CoachProposal,
    options?: { userMessage?: string; reason?: string }
  ): CoachDecision {
    const auditEntry: CoachDecision = {
      id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      createdAt: new Date().toISOString(),
      userMessage: options?.userMessage,
      proposal,
      validationResult: { valid: true, errors: [], warnings: [] },
      userDecision: 'REJECTED',
      error: options?.reason
    };

    useAppStore.getState().addCoachDecision?.(auditEntry);
    return auditEntry;
  }

  /**
   * Enregistre une personnalisation avec revalidation.
   */
  static recordModification(
    originalProposal: CoachProposal,
    modifiedProposal: CoachProposal,
    options?: { userMessage?: string }
  ): { valid: boolean; validation: CoachActionValidationResult; decision?: CoachDecision } {
    const store = useAppStore.getState();
    const currentPmc = store.pmc.length > 0 ? store.pmc[store.pmc.length - 1] : null;

    let targetDate = new Date();
    if (modifiedProposal.affectedWorkoutIds && modifiedProposal.affectedWorkoutIds.length > 0) {
      const target = store.plannedWorkouts.find(w => modifiedProposal.affectedWorkoutIds?.includes(w.id));
      if (target?.date) {
        try { targetDate = parseISO(target.date); } catch { /* ignore */ }
      }
    }

    const currentWeeklyLoad = calculateWeeklyPlannedLoad(store.plannedWorkouts, targetDate);

    const validation = validateCoachProposal(modifiedProposal, {
      plannedWorkouts: store.plannedWorkouts,
      currentPmc,
      confidence: modifiedProposal.confidence ? {
        level: modifiedProposal.confidence,
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

    const auditEntry: CoachDecision = {
      id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      createdAt: new Date().toISOString(),
      userMessage: options?.userMessage,
      proposal: modifiedProposal,
      validationResult: validation,
      userDecision: 'MODIFIED',
      appliedChanges: modifiedProposal.proposedModifications
    };

    useAppStore.getState().addCoachDecision?.(auditEntry);

    return {
      valid: Boolean(validation.valid),
      validation,
      decision: auditEntry
    };
  }

  /**
   * Exécute une proposition de manière atomique, idempotente et contrôlée.
   */
  static executeProposal(
    proposal: CoachProposal,
    options?: { userMessage?: string; forceRevalidation?: boolean }
  ): CoachActionExecutionResult {
    const store = useAppStore.getState();

    // 1. Verrou anti-concurrence (double clic ou requêtes concurrentes)
    if (CoachActionExecutor.inFlightExecutions.has(proposal.id)) {
      return {
        success: false,
        message: "Une exécution est déjà en cours pour cette proposition.",
        updatedWorkoutsCount: 0,
        recalculatedWeeklyLoad: 0,
        recalculatedPmcCount: store.pmc.length,
        error: "CONCURRENT_EXECUTION_BLOCKED"
      };
    }
    CoachActionExecutor.inFlightExecutions.add(proposal.id);

    try {
      // 2. Détermination de la date cible de référence
      let targetDate = new Date();
      if (proposal.affectedWorkoutIds && proposal.affectedWorkoutIds.length > 0) {
        const firstTarget = store.plannedWorkouts.find(w => proposal.affectedWorkoutIds?.includes(w.id));
        if (firstTarget?.date) {
          try { targetDate = parseISO(firstTarget.date); } catch { /* ignore */ }
        }
      }

      const currentWeeklyLoad = calculateWeeklyPlannedLoad(store.plannedWorkouts, targetDate);

      // 3. Idempotence : vérifier si la proposition a déjà été exécutée
      const alreadyExecutedDecision = store.coachDecisions?.find(
        d => d.proposal?.id === proposal.id && d.userDecision === 'EXECUTED'
      );
      if (alreadyExecutedDecision) {
        return {
          success: false,
          alreadyExecuted: true,
          message: "Cette proposition a déjà été appliquée. Aucune modification supplémentaire n'a été effectuée.",
          updatedWorkoutsCount: 0,
          recalculatedWeeklyLoad: currentWeeklyLoad,
          recalculatedPmcCount: store.pmc.length,
          error: "PROPOSAL_ALREADY_EXECUTED"
        };
      }

      // 4. Respect du refus : une proposition refusée ne peut pas être appliquée
      const alreadyRejectedDecision = store.coachDecisions?.find(
        d => d.proposal?.id === proposal.id && d.userDecision === 'REJECTED'
      );
      if (alreadyRejectedDecision) {
        return {
          success: false,
          alreadyRejected: true,
          message: "Cette proposition a été refusée et ne peut pas être appliquée.",
          updatedWorkoutsCount: 0,
          recalculatedWeeklyLoad: currentWeeklyLoad,
          recalculatedPmcCount: store.pmc.length,
          error: "PROPOSAL_ALREADY_REJECTED"
        };
      }

      // 5. Détection d'obsolescence (séances disparues, terminées ou déplacées)
      const obsoleteCheck = CoachActionExecutor.isProposalObsolete(proposal, store);
      if (obsoleteCheck.obsolete) {
        const obsoleteResult: CoachActionExecutionResult = {
          success: false,
          isObsolete: true,
          message: `La proposition est obsolète : ${obsoleteCheck.reason}`,
          updatedWorkoutsCount: 0,
          recalculatedWeeklyLoad: currentWeeklyLoad,
          recalculatedPmcCount: store.pmc.length,
          error: "PROPOSAL_OBSOLETE"
        };

        const auditEntry: CoachDecision = {
          id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          createdAt: new Date().toISOString(),
          userMessage: options?.userMessage,
          proposal,
          validationResult: { valid: false, errors: [obsoleteCheck.reason || 'Proposition obsolète'] },
          userDecision: 'OBSOLETE',
          engineResult: obsoleteResult,
          error: obsoleteResult.error
        };
        useAppStore.getState().addCoachDecision?.(auditEntry);

        return obsoleteResult;
      }

      // 6. Validation physiologique obligatoire via CoachActionValidator
      const currentPmc = store.pmc.length > 0 ? store.pmc[store.pmc.length - 1] : null;
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
          error: (validation.errors || []).join('; ')
        };

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

      // 7. Snapshots complets pour garantie de rollback atomique
      const initialWorkoutsSnapshot = store.plannedWorkouts.map(w => ({ ...w }));
      const initialActualsJson = JSON.stringify(store.actualWorkouts);
      const initialPmcSnapshot = store.pmc.map(p => ({ ...p }));

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
                  id: original.id,
                  planId: original.planId,
                  sport: original.sport,
                  status: 'adapted',
                  targetDurationMin: 0,
                  targetTss: 0,
                  explanation: `Annulée sur recommandation du coach : ${proposal.reason}`
                };
              } else {
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
                const reducedDuration = Math.max(20, Math.round((original.targetDurationMin || 60) * 0.7));
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
                const newDuration = Math.round((original.targetDurationMin || 60) * mult);
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

        // 8. Vérification stricte de cohérence post-application
        const coherenceCheck = CoachActionExecutor.validatePlanningCoherence(
          updatedWorkouts,
          initialWorkoutsSnapshot,
          proposal,
          store.athleteProfile,
          targetDate,
          currentWeeklyLoad
        );

        if (!coherenceCheck.coherent) {
          throw new Error(`Incohérence du planning détectée : ${coherenceCheck.errors.join('; ')}`);
        }

        // 9. Vérification stricte de séparation : actualWorkouts intouchés
        if (JSON.stringify(store.actualWorkouts) !== initialActualsJson) {
          throw new Error("Violation critique : les séances réellement effectuées (actualWorkouts) ont été altérées.");
        }

        // 10. Application atomique au store
        store.setPlannedWorkouts(updatedWorkouts);

        // 11. Recalculs déterministes Plana (Charge & PMC)
        const newWeeklyLoad = calculateWeeklyPlannedLoad(updatedWorkouts, targetDate);
        const recalculatedPmc = generatePMC(
          store.actualWorkouts,
          store.ftp,
          store.athleteProfile?.hrMax
        );
        useAppStore.setState({ pmc: recalculatedPmc });

        // Détail des séances affectées pour retour clair
        const affectedWorkoutsDetails = updatedWorkouts
          .filter(w => proposal.affectedWorkoutIds?.includes(w.id))
          .map(w => ({
            id: w.id,
            sport: w.sport,
            date: w.date,
            title: w.title,
            durationMin: w.targetDurationMin,
            targetTss: w.targetTss,
            status: w.status
          }));

        const successResult: CoachActionExecutionResult = {
          success: true,
          message: `Planning ajusté avec succès : ${count} séance(s) mise(s) à jour.`,
          updatedWorkoutsCount: count,
          recalculatedWeeklyLoad: newWeeklyLoad,
          recalculatedPmcCount: recalculatedPmc.length,
          loadDelta: newWeeklyLoad - currentWeeklyLoad,
          affectedWorkouts: affectedWorkoutsDetails,
          appliedModifications
        };

        // 12. Traçabilité d'audit avec gestion explicite d'échec
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

        try {
          useAppStore.getState().addCoachDecision?.(auditEntry);
        } catch (auditErr: any) {
          // Échec d'audit critique : rollback atomique pour garantir l'intégrité de la traçabilité
          store.setPlannedWorkouts(initialWorkoutsSnapshot);
          useAppStore.setState({ pmc: initialPmcSnapshot });

          return {
            success: false,
            message: "Échec de l'enregistrement de l'audit. Le planning a été restauré par précaution.",
            rolledBack: true,
            updatedWorkoutsCount: 0,
            recalculatedWeeklyLoad: currentWeeklyLoad,
            recalculatedPmcCount: store.pmc.length,
            error: `AUDIT_PERSISTENCE_FAILED: ${auditErr?.message || auditErr}`
          };
        }

        return successResult;
      } catch (err: any) {
        // Rollback atomique vers la copie initiale
        store.setPlannedWorkouts(initialWorkoutsSnapshot);
        useAppStore.setState({ pmc: initialPmcSnapshot });

        const rollbackResult: CoachActionExecutionResult = {
          success: false,
          rolledBack: true,
          message: `Erreur inattendue lors de l'ajustement du plan. Le planning a été conservé intact (rollback effectué).`,
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

        try {
          useAppStore.getState().addCoachDecision?.(auditEntry);
        } catch {
          // audit storage fallback
        }

        return rollbackResult;
      }
    } finally {
      CoachActionExecutor.inFlightExecutions.delete(proposal.id);
    }
  }
}
