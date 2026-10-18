import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store';
import { CoachActionExecutor } from './coachActionExecutor';
import { CoachProposalExplainer } from './coachProposalExplainer';
import { validateCoachProposal } from './coachActionValidator';
import { CoachProposal } from '../domain/coachTypes';

describe('Phase 28 — Coach Proposal, Confirmation & Action Executor Flow', () => {
  beforeEach(() => {
    // Réinitialiser le store avec un plan propre et conforme au modèle PlannedWorkout
    useAppStore.setState({
      plannedWorkouts: [
        {
          id: 'w-1',
          planId: 'test-plan-42',
          date: '2026-03-23',
          sport: 'Run',
          title: 'Course Fractionné',
          targetDurationMin: 60,
          targetIntensity: { type: 'zone', value: 'Z4' },
          targetTss: 70,
          status: 'planned'
        },
        {
          id: 'w-2',
          planId: 'test-plan-42',
          date: '2026-03-24',
          sport: 'Ride',
          title: 'Vélo Endurance Fondamentale',
          targetDurationMin: 90,
          targetIntensity: { type: 'zone', value: 'Z2' },
          targetTss: 80,
          status: 'planned'
        },
        {
          id: 'w-3',
          planId: 'test-plan-42',
          date: '2026-03-25',
          sport: 'Swim',
          title: 'Natation Récupération Active',
          targetDurationMin: 45,
          targetIntensity: { type: 'zone', value: 'Z1' },
          targetTss: 30,
          status: 'planned'
        }
      ],
      actualWorkouts: [],
      coachDecisions: []
    });
  });

  // 1. Avant validation : aucune mutation
  it('1. ne mute jamais le store de séances tant que la proposition n a pas été explicitement validée', () => {
    const workoutsBefore = useAppStore.getState().plannedWorkouts;
    const proposal: CoachProposal = {
      id: 'prop-1',
      action: 'CANCEL_WORKOUT',
      reason: 'Fatigue aiguë',
      affectedWorkoutIds: ['w-1'],
      proposedModifications: [{ workoutId: 'w-1', cancel: true }],
      constraints: { maxWeeklyLoadIncrease: 0.05, prioritizeRecovery: true },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    // Validation seule (préparation de l'UI)
    const validation = validateCoachProposal(proposal, {
      plannedWorkouts: workoutsBefore,
      currentPmc: null,
      confidence: { level: 'HIGH', reasons: [], historyWeeks: 4, recentWorkoutsCount: 3 },
      weeklyPlannedLoad: 180
    });
    expect(validation.valid).toBe(true);

    // Vérification stricte : le store n'a pas bougé
    const workoutsAfter = useAppStore.getState().plannedWorkouts;
    expect(workoutsAfter).toEqual(workoutsBefore);
    expect(workoutsAfter.find(w => w.id === 'w-1')?.status).toBe('planned');
  });

  // 2. Traitement [Refuser] : audit REJECTED et zéro mutation
  it('2. [Refuser] enregistre la décision REJECTED dans l audit et laisse le planning intact', () => {
    const proposal: CoachProposal = {
      id: 'prop-refuse-1',
      action: 'REDUCE_LOAD',
      reason: 'Précaution fatigue',
      affectedWorkoutIds: ['w-1'],
      constraints: { maxWeeklyLoadIncrease: 0.05, reduceIntensity: true },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const initialWorkouts = [...useAppStore.getState().plannedWorkouts];

    // L'athlète clique sur [Refuser]
    useAppStore.getState().addCoachDecision({
      id: 'dec-refuse-1',
      createdAt: new Date().toISOString(),
      proposal,
      validationResult: { valid: true, errors: [], warnings: [] },
      userDecision: 'REJECTED'
    });

    const decisions = useAppStore.getState().coachDecisions;
    expect(decisions.length).toBe(1);
    expect(decisions[0].userDecision).toBe('REJECTED');
    expect(useAppStore.getState().plannedWorkouts).toEqual(initialWorkouts);
  });

  // 3. Traitement [Modifier] : audit MODIFIED et adaptation personnalisée
  it('3. [Modifier] enregistre la personnalisation dans l audit avant validation ultérieure', () => {
    const originalProposal: CoachProposal = {
      id: 'prop-mod-1',
      action: 'REDUCE_LOAD',
      reason: 'Réduction suggérée de 30 min',
      affectedWorkoutIds: ['w-2'],
      proposedModifications: [{ workoutId: 'w-2', newDurationMin: 60 }],
      constraints: { maxWeeklyLoadIncrease: 0.05 },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const modifiedProposal: CoachProposal = {
      ...originalProposal,
      reason: 'Réduction modifiée par athlète à 45 min',
      proposedModifications: [{ workoutId: 'w-2', newDurationMin: 45 }]
    };

    useAppStore.getState().addCoachDecision({
      id: 'dec-mod-1',
      createdAt: new Date().toISOString(),
      proposal: modifiedProposal,
      validationResult: { valid: true, errors: [], warnings: [] },
      userDecision: 'MODIFIED',
      appliedChanges: modifiedProposal.proposedModifications
    });

    const decisions = useAppStore.getState().coachDecisions;
    expect(decisions.length).toBe(1);
    expect(decisions[0].userDecision).toBe('MODIFIED');
    expect(decisions[0].appliedChanges?.[0].newDurationMin).toBe(45);
  });

  // 4. Traitement [Valider] : exécution avec succès
  it('4. [Valider] exécute la proposition via CoachActionExecutor et met à jour l agenda', () => {
    const proposal: CoachProposal = {
      id: 'prop-val-1',
      action: 'CANCEL_WORKOUT',
      reason: 'Repos forcé',
      affectedWorkoutIds: ['w-1'],
      proposedModifications: [{ workoutId: 'w-1', cancel: true }],
      constraints: { maxWeeklyLoadIncrease: 0.05, prioritizeRecovery: true },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = CoachActionExecutor.executeProposal(proposal, { userMessage: 'Oui, j annule' });
    expect(result.success).toBe(true);
    expect(result.updatedWorkoutsCount).toBe(1);

    const updated = useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-1');
    expect(updated?.status).toBe('adapted');
    expect(updated?.targetTss).toBe(0);

    const decisions = useAppStore.getState().coachDecisions;
    expect(decisions.length).toBe(1);
    expect(decisions[0].userDecision).toBe('EXECUTED');
    expect(decisions[0].userMessage).toBe('Oui, j annule');
  });

  // 5. Préservation absolue du planId
  it('5. préserve rigoureusement le planId et les identifiants d origine des séances modifiées', () => {
    const proposal: CoachProposal = {
      id: 'prop-id-1',
      action: 'REDUCE_LOAD',
      reason: 'Allègement Z2',
      affectedWorkoutIds: ['w-2'],
      proposedModifications: [{ workoutId: 'w-2', newDurationMin: 60, newTargetTss: 50 }],
      constraints: { maxWeeklyLoadIncrease: 0.05 },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    CoachActionExecutor.executeProposal(proposal);

    const updated = useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-2');
    expect(updated?.id).toBe('w-2');
    expect(updated?.planId).toBe('test-plan-42');
    expect(updated?.sport).toBe('Ride');
    expect(updated?.targetDurationMin).toBe(60);
  });

  // 6. Rollback atomique si erreur d'exécution ou validation finale négative
  it('6. effectue un rollback complet à l état antérieur si la validation de sécurité échoue à l exécution', () => {
    const snapshotBefore = JSON.parse(JSON.stringify(useAppStore.getState().plannedWorkouts));

    // Proposition illégale : augmentation excessive de charge (+40%)
    const illegalProposal: CoachProposal = {
      id: 'prop-illegal-1',
      action: 'INCREASE_LOAD',
      reason: 'Hausse abusive',
      loadIncreasePercent: 40,
      affectedWorkoutIds: ['w-1'],
      proposedModifications: [{ workoutId: 'w-1', newDurationMin: 180, newTargetTss: 200 }],
      constraints: { maxWeeklyLoadIncrease: 0.40 },
      confidence: 'LOW',
      proposedAt: new Date().toISOString()
    };

    const result = CoachActionExecutor.executeProposal(illegalProposal);
    expect(result.success).toBe(false);

    // Le store doit être identique au snapshot avant l'appel
    const stateAfter = useAppStore.getState().plannedWorkouts;
    expect(stateAfter).toEqual(snapshotBefore);

    // L'audit doit consigner l'échec (FAILED)
    const decisions = useAppStore.getState().coachDecisions;
    expect(decisions.length).toBe(1);
    expect(decisions[0].userDecision).toBe('FAILED');
    expect(decisions[0].error).toBeDefined();
  });

  // 7. Explication Pourquoi ? : TSB négatif sévère pour repos complet
  it('7. Explainer génère une explication objective basée sur un TSB sévère pour CANCEL_WORKOUT', () => {
    const proposal: CoachProposal = {
      id: 'p-exp-1',
      action: 'CANCEL_WORKOUT',
      reason: 'Fatigue',
      affectedWorkoutIds: ['w-1'],
      constraints: { maxWeeklyLoadIncrease: 0.05, prioritizeRecovery: true },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString(),
      sourceContext: { tsb: -25, atl: 85, ctl: 60 }
    };

    const why = CoachProposalExplainer.getWhyExplanation(proposal);
    expect(why).toContain('TSB: -25');
    expect(why).toContain('fatigue aiguë sévère');
  });

  // 8. Explication Pourquoi ? : réduction de charge avec TSB modéré
  it('8. Explainer fournit une justification claire pour REDUCE_LOAD avec TSB < -10', () => {
    const proposal: CoachProposal = {
      id: 'p-exp-2',
      action: 'REDUCE_LOAD',
      reason: 'Adaptation',
      affectedWorkoutIds: ['w-2'],
      constraints: { maxWeeklyLoadIncrease: 0.05 },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString(),
      sourceContext: { tsb: -15, atl: 70, ctl: 55 }
    };

    const why = CoachProposalExplainer.getWhyExplanation(proposal);
    expect(why).toContain('TSB de -15');
    expect(why).toContain('Zone 1/Zone 2');
  });

  // 9. Explication Pourquoi ? : augmentation progressive plafonnée à 5%
  it('9. Explainer met en avant le plafond de sécurité de 5% pour INCREASE_LOAD', () => {
    const proposal: CoachProposal = {
      id: 'p-exp-3',
      action: 'INCREASE_LOAD',
      reason: 'Hausse charge',
      loadIncreasePercent: 4,
      affectedWorkoutIds: ['w-3'],
      constraints: { maxWeeklyLoadIncrease: 0.05 },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString(),
      sourceContext: { tsb: 5 }
    };

    const why = CoachProposalExplainer.getWhyExplanation(proposal);
    expect(why).toContain('+4%');
    expect(why).toContain('5% max');
  });

  // 10. Calcul et affichage de l'impact de charge
  it('10. Explainer calcule correctement le résumé d impact pour les diminutions et augmentations', () => {
    const decreaseProp: CoachProposal = {
      id: 'p-imp-1',
      action: 'REDUCE_LOAD',
      reason: 'Allègement',
      affectedWorkoutIds: ['w-1'],
      constraints: { maxWeeklyLoadIncrease: 0.05 },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString(),
      sourceContext: { weeklyPlannedLoad: 250, proposedWeeklyLoad: 200 }
    };

    const impact = CoachProposalExplainer.getLoadImpactSummary(decreaseProp);
    expect(impact.isDecrease).toBe(true);
    expect(impact.isIncrease).toBe(false);
    expect(impact.diffText).toBe('-50 TSS');

    const increaseProp: CoachProposal = {
      id: 'p-imp-2',
      action: 'INCREASE_LOAD',
      reason: 'Hausse',
      loadIncreasePercent: 5,
      affectedWorkoutIds: ['w-1'],
      constraints: { maxWeeklyLoadIncrease: 0.05 },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const impactInc = CoachProposalExplainer.getLoadImpactSummary(increaseProp);
    expect(impactInc.isIncrease).toBe(true);
    expect(impactInc.diffText).toBe('+5%');
  });

  // 11. Recalcul déterministe du TSS lors de la modification de durée
  it('11. recalcule automatiquement le TSS de manière déterministe lors d une réduction de durée', () => {
    const proposal: CoachProposal = {
      id: 'prop-tss-1',
      action: 'REDUCE_LOAD',
      reason: 'Réduction durée endurance',
      affectedWorkoutIds: ['w-2'],
      proposedModifications: [{ workoutId: 'w-2', newDurationMin: 45 }], // Passe de 90 à 45 min
      constraints: { maxWeeklyLoadIncrease: 0.05 },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = CoachActionExecutor.executeProposal(proposal);
    expect(result.success).toBe(true);

    const workout = useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-2');
    expect(workout?.targetDurationMin).toBe(45);
    // TSS doit être calculé de façon déterministe (inférieur à 80 initial)
    expect(workout?.targetTss).toBeLessThan(80);
    expect(workout?.targetTss).toBeGreaterThan(0);
  });

  // 12. Déplacement de séance sans modification de charge totale
  it('12. MOVE_WORKOUT met à jour la date sans altérer le volume total hebdomadaire', () => {
    const proposal: CoachProposal = {
      id: 'prop-move-1',
      action: 'MOVE_WORKOUT',
      reason: 'Décalage au lendemain',
      affectedWorkoutIds: ['w-3'],
      proposedModifications: [{ workoutId: 'w-3', newDate: '2026-03-26' }],
      constraints: { maxWeeklyLoadIncrease: 0.05 },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = CoachActionExecutor.executeProposal(proposal);
    expect(result.success).toBe(true);

    const workout = useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-3');
    expect(workout?.date).toBe('2026-03-26');
    expect(workout?.targetTss).toBe(30);
  });

  // 13. Blocage si tentative de modification d'une séance introuvable
  it('13. échoue proprement sans mutation si une séance ciblée n existe pas dans le store', () => {
    const proposal: CoachProposal = {
      id: 'prop-missing-1',
      action: 'REDUCE_LOAD',
      reason: 'Séance inexistante',
      affectedWorkoutIds: ['w-unknown-999'],
      proposedModifications: [{ workoutId: 'w-unknown-999', newDurationMin: 30 }],
      constraints: { maxWeeklyLoadIncrease: 0.05 },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = CoachActionExecutor.executeProposal(proposal);
    expect(result.success).toBe(false);
    expect(result.message).toContain('inexistante');
  });

  // 14. Audit complet : stockage successif de plusieurs décisions
  it('14. conserve l historique complet des décisions successives', () => {
    const p1: CoachProposal = {
      id: 'p-hist-1',
      action: 'REDUCE_LOAD',
      reason: '1er motif',
      affectedWorkoutIds: ['w-1'],
      proposedModifications: [{ workoutId: 'w-1', newDurationMin: 40 }],
      constraints: { maxWeeklyLoadIncrease: 0.05 },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };
    CoachActionExecutor.executeProposal(p1);

    const p2: CoachProposal = {
      id: 'p-hist-2',
      action: 'CANCEL_WORKOUT',
      reason: '2e motif',
      affectedWorkoutIds: ['w-2'],
      proposedModifications: [{ workoutId: 'w-2', cancel: true }],
      constraints: { maxWeeklyLoadIncrease: 0.05, prioritizeRecovery: true },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };
    CoachActionExecutor.executeProposal(p2);

    const decisions = useAppStore.getState().coachDecisions;
    expect(decisions.length).toBe(2);
    // Le store place les décisions les plus récentes en tête
    const ids = decisions.map(d => d.proposal.id);
    expect(ids).toContain('p-hist-1');
    expect(ids).toContain('p-hist-2');
  });

  // 15. Blocage strict de rattrapage de charge lors de l'adaptation
  it('15. interdit l ajout compensatoire de charge sur d autres séances lors d une annulation', () => {
    // Proposition invalide : compense une séance annulée en gonflant w-2 au-delà du seuil strict
    const compensatoryProposal: CoachProposal = {
      id: 'p-comp-1',
      action: 'ADAPT_PLAN',
      reason: 'Rattrapage séance manquée',
      affectedWorkoutIds: ['w-1', 'w-2'],
      proposedModifications: [
        { workoutId: 'w-1', cancel: true },
        { workoutId: 'w-2', newDurationMin: 180, newTargetTss: 170 } // 0 + 170 + 30 = 200 TSS > 180 * 1.05 = 189 TSS
      ],
      constraints: { maxWeeklyLoadIncrease: 0.05, autoMakeupMissedLoad: true },
      confidence: 'LOW',
      proposedAt: new Date().toISOString()
    };

    const result = CoachActionExecutor.executeProposal(compensatoryProposal);
    expect(result.success).toBe(false);
    expect(useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-2')?.targetDurationMin).toBe(90);
  });

  // 16. Recalcul de la charge hebdomadaire cible après exécution
  it('16. recalcule et retourne la nouvelle charge hebdomadaire réelle après application', () => {
    const proposal: CoachProposal = {
      id: 'p-recalc-1',
      action: 'CANCEL_WORKOUT',
      reason: 'Suppression w-1',
      affectedWorkoutIds: ['w-1'],
      proposedModifications: [{ workoutId: 'w-1', cancel: true }],
      constraints: { maxWeeklyLoadIncrease: 0.05 },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    // Charge avant : 70 (w-1) + 80 (w-2) + 30 (w-3) = 180 TSS
    const result = CoachActionExecutor.executeProposal(proposal);
    expect(result.success).toBe(true);

    // Charge après annulation de w-1 : 0 + 80 + 30 = 110 TSS
    expect(result.recalculatedWeeklyLoad).toBe(110);
  });
});
