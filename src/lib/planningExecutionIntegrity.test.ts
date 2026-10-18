import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../store';
import { CoachActionExecutor } from './coachActionExecutor';
import { validateCoachProposal } from './coachActionValidator';
import { CoachConversationManager } from './coachConversationManager';
import { parseIntentDeterministically, validateGeminiIntentPayload } from './coachIntentParser';
import { CoachProposal, ProposedWorkoutModification } from '../domain/coachTypes';
import { PlannedWorkout, ActualWorkout, AthleteProfile } from '../domain/models';

function setupTestState() {
  const initialProfile: AthleteProfile = {
    id: 'athlete-32',
    name: 'Julien Test',
    level: { swim: 'intermediate', ride: 'intermediate', run: 'intermediate' },
    availability: {
      weeklyHours: 10,
      availableDays: ['Lundi', 'Mercredi', 'Vendredi', 'Samedi', 'monday', 'wednesday', 'friday', 'saturday']
    },
    dataConnection: 'none'
  };

  const initialWorkouts: PlannedWorkout[] = [
    {
      id: 'w-mon',
      planId: 'plan-32',
      date: '2026-04-13', // Lundi
      sport: 'Ride',
      title: 'Intervalles Seuil Z4',
      targetDurationMin: 75,
      targetIntensity: { type: 'zone', value: 'Z4' },
      targetTss: 70,
      status: 'planned'
    },
    {
      id: 'w-wed',
      planId: 'plan-32',
      date: '2026-04-15', // Mercredi
      sport: 'Run',
      title: 'Tempo Z3',
      targetDurationMin: 60,
      targetIntensity: { type: 'zone', value: 'Z3' },
      targetTss: 55,
      status: 'planned'
    },
    {
      id: 'w-fri',
      planId: 'plan-32',
      date: '2026-04-17', // Vendredi
      sport: 'Swim',
      title: 'Technique et Aérobie Z2',
      targetDurationMin: 45,
      targetIntensity: { type: 'zone', value: 'Z2' },
      targetTss: 35,
      status: 'planned'
    },
    {
      id: 'w-sat',
      planId: 'plan-32',
      date: '2026-04-18', // Samedi
      sport: 'Ride',
      title: 'Sortie Longue Z2',
      targetDurationMin: 120,
      targetIntensity: { type: 'zone', value: 'Z2' },
      targetTss: 90,
      status: 'planned'
    }
  ];

  const initialActuals: ActualWorkout[] = [
    {
      id: 'act-prev-1',
      date: '2026-04-10',
      sport: 'Ride',
      startTime: '2026-04-10T09:00:00Z',
      durationMin: 90,
      tss: 65,
      source: 'manual'
    }
  ];

  useAppStore.setState({
    athleteProfile: initialProfile,
    plannedWorkouts: initialWorkouts,
    actualWorkouts: initialActuals,
    pmc: [
      { date: '2026-04-10', ctl: 45, atl: 40, tsb: 5, tss: 65 }
    ],
    coachDecisions: [],
    workoutFeedbacks: [],
    workoutObservations: [],
    athleteHabits: [],
    athletePreferences: [],
    temporaryAvailabilities: [],
    illnessEpisodes: [],
    injuryEpisodes: []
  });
}

describe('Phase 32 — Planning Execution Integrity & End-to-End Coach Validation', () => {
  beforeEach(() => {
    setupTestState();
  });

  // 1. Application réussie d'une proposition
  it("1. application réussie d'une proposition — applique fidèlement les modifications sans altérer les autres séances", () => {
    const proposal: CoachProposal = {
      id: 'prop-succ-1',
      action: 'REDUCE_LOAD',
      reason: 'Fatigue passagère',
      affectedWorkoutIds: ['w-mon'],
      proposedModifications: [
        { workoutId: 'w-mon', newDurationMin: 45, newTargetTss: 35 }
      ],
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const res = CoachActionExecutor.executeProposal(proposal, { userMessage: 'Oui, allège stp' });
    expect(res.success).toBe(true);
    expect(res.updatedWorkoutsCount).toBe(1);

    const updatedMon = useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-mon');
    expect(updatedMon?.targetDurationMin).toBe(45);
    expect(updatedMon?.targetTss).toBe(35);
    expect(updatedMon?.status).toBe('adapted');

    // L'audit doit tracer EXECUTED
    const decisions = useAppStore.getState().coachDecisions;
    expect(decisions.some(d => d.proposal?.id === 'prop-succ-1' && d.userDecision === 'EXECUTED')).toBe(true);
  });

  // 2. Double confirmation
  it('2. double confirmation — empêche une seconde application de la même proposition', () => {
    const proposal: CoachProposal = {
      id: 'prop-double-conf',
      action: 'CANCEL_WORKOUT',
      reason: 'Repos',
      affectedWorkoutIds: ['w-wed'],
      proposedModifications: [{ workoutId: 'w-wed', cancel: true }],
      confidence: 'HIGH'
    };

    // Première exécution
    const res1 = CoachActionExecutor.executeProposal(proposal);
    expect(res1.success).toBe(true);

    // Seconde tentative sur la même proposition
    const res2 = CoachActionExecutor.executeProposal(proposal);
    expect(res2.success).toBe(false);
    expect(res2.alreadyExecuted).toBe(true);
    expect(res2.message).toContain('déjà été appliquée');

    // Vérifier qu'il n'y a pas eu de duplication dans les décisions
    const executedCount = useAppStore.getState().coachDecisions.filter(
      d => d.proposal?.id === 'prop-double-conf' && d.userDecision === 'EXECUTED'
    ).length;
    expect(executedCount).toBe(1);
  });

  // 3. Requêtes serveur répétées
  it('3. requêtes serveur répétées — comportement idempotent garantissant aucun dédoublement de séances', () => {
    const initialCount = useAppStore.getState().plannedWorkouts.length;
    const proposal: CoachProposal = {
      id: 'prop-repeat-req',
      action: 'REDUCE_LOAD',
      reason: 'Séance allégée',
      affectedWorkoutIds: ['w-fri'],
      proposedModifications: [{ workoutId: 'w-fri', newDurationMin: 30, newTargetTss: 20 }],
      confidence: 'HIGH'
    };

    // 3 appels répétés successifs
    CoachActionExecutor.executeProposal(proposal);
    CoachActionExecutor.executeProposal(proposal);
    CoachActionExecutor.executeProposal(proposal);

    const currentWorkouts = useAppStore.getState().plannedWorkouts;
    expect(currentWorkouts.length).toBe(initialCount);
    const friSessions = currentWorkouts.filter(w => w.id === 'w-fri');
    expect(friSessions.length).toBe(1);
  });

  // 4. Refus sans mutation
  it('4. refus sans mutation — le refus conserve l intégrité stricte du planning et trace REJECTED', () => {
    const workoutsBefore = JSON.parse(JSON.stringify(useAppStore.getState().plannedWorkouts));
    const proposal: CoachProposal = {
      id: 'prop-refuse-test',
      action: 'CANCEL_WORKOUT',
      reason: 'Annulation non souhaitée',
      affectedWorkoutIds: ['w-sat'],
      confidence: 'HIGH'
    };

    CoachActionExecutor.recordRefusal(proposal, { userMessage: 'Non je préfère maintenir ma sortie' });

    expect(useAppStore.getState().plannedWorkouts).toEqual(workoutsBefore);
    const decisions = useAppStore.getState().coachDecisions;
    expect(decisions.some(d => d.proposal?.id === 'prop-refuse-test' && d.userDecision === 'REJECTED')).toBe(true);
  });

  // 5. Proposition modifiée puis revalidée
  it('5. proposition modifiée puis revalidée — revalide les contraintes physiologiques avant exécution', () => {
    const originalProposal: CoachProposal = {
      id: 'prop-mod-orig',
      action: 'REDUCE_LOAD',
      reason: 'Réduction standard',
      affectedWorkoutIds: ['w-mon'],
      proposedModifications: [{ workoutId: 'w-mon', newDurationMin: 50 }],
      confidence: 'HIGH'
    };

    // L'athlète personnalise la durée
    const modifiedProposal: CoachProposal = {
      ...originalProposal,
      proposedModifications: [{ workoutId: 'w-mon', newDurationMin: 40 }]
    };

    const modRecord = CoachActionExecutor.recordModification(originalProposal, modifiedProposal);
    expect(modRecord.valid).toBe(true);
    expect(modRecord.decision?.userDecision).toBe('MODIFIED');

    // Exécution de la version modifiée
    const res = CoachActionExecutor.executeProposal(modifiedProposal);
    expect(res.success).toBe(true);
    expect(useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-mon')?.targetDurationMin).toBe(40);
  });

  // 6. Proposition obsolète
  it('6. proposition obsolète — rejette l exécution si la séance ciblée a été supprimée ou effectuée', () => {
    const proposal: CoachProposal = {
      id: 'prop-obsolete',
      action: 'CANCEL_WORKOUT',
      reason: 'Séance disparue',
      affectedWorkoutIds: ['w-inexistante'],
      confidence: 'HIGH'
    };

    const res = CoachActionExecutor.executeProposal(proposal);
    expect(res.success).toBe(false);
    expect(res.isObsolete).toBe(true);
    expect(res.error).toBe('PROPOSAL_OBSOLETE');

    const decisions = useAppStore.getState().coachDecisions;
    expect(decisions.some(d => d.proposal?.id === 'prop-obsolete' && d.userDecision === 'OBSOLETE')).toBe(true);
  });

  // 7. Erreur pendant l'exécution
  it('7. erreur pendant l exécution — gère proprement une exception sans crasher', () => {
    const badProposal = {
      id: 'prop-bad-data',
      action: 'REDUCE_LOAD',
      affectedWorkoutIds: ['w-mon'],
      proposedModifications: [{ workoutId: 'w-mon', newDate: 'date-totalement-invalide' }]
    } as any;

    const res = CoachActionExecutor.executeProposal(badProposal);
    expect(res.success).toBe(false);
    expect(res.message).toBeDefined();
  });

  // 8. Rollback après erreur
  it('8. rollback après erreur — restaure exactement le snapshot initial de planning', () => {
    const snapshotBefore = JSON.parse(JSON.stringify(useAppStore.getState().plannedWorkouts));

    // Créer une proposition qui génèrera une incohérence de doublon
    const corruptedProposal: CoachProposal = {
      id: 'prop-corrupt',
      action: 'MODIFY_WORKOUT',
      reason: 'Test corruption',
      affectedWorkoutIds: ['w-mon'],
      proposedModifications: [
        { workoutId: 'w-mon', newDate: 'date_invalide' }
      ],
      confidence: 'HIGH'
    };

    const res = CoachActionExecutor.executeProposal(corruptedProposal);
    expect(res.success).toBe(false);
    expect(res.rolledBack).toBe(true);
    expect(useAppStore.getState().plannedWorkouts).toEqual(snapshotBefore);
  });

  // 9. Échec de persistance
  it('9. échec de persistance — effectue un rollback propre si le store lève une exception', () => {
    const snapshotBefore = JSON.parse(JSON.stringify(useAppStore.getState().plannedWorkouts));
    const proposal: CoachProposal = {
      id: 'prop-persist-fail',
      action: 'CANCEL_WORKOUT',
      reason: 'Test persistance',
      affectedWorkoutIds: ['w-mon'],
      confidence: 'HIGH'
    };

    // Simuler un bug de persistance
    const originalSetPlanned = useAppStore.getState().setPlannedWorkouts;
    let callCount = 0;
    useAppStore.setState({
      setPlannedWorkouts: (workouts) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Echec écriture localStorage disque saturé');
        }
        originalSetPlanned(workouts);
      }
    });

    const res = CoachActionExecutor.executeProposal(proposal);
    expect(res.success).toBe(false);
    expect(res.rolledBack).toBe(true);

    // Restaurer la méthode originale
    useAppStore.setState({ setPlannedWorkouts: originalSetPlanned });
    expect(useAppStore.getState().plannedWorkouts).toEqual(snapshotBefore);
  });

  // 10. Échec ou indisponibilité de l'audit
  it('10. échec ou indisponibilité de l audit — annule la modification si l audit ne peut pas être écrit', () => {
    const snapshotBefore = JSON.parse(JSON.stringify(useAppStore.getState().plannedWorkouts));
    const proposal: CoachProposal = {
      id: 'prop-audit-fail',
      action: 'REDUCE_LOAD',
      reason: 'Test audit fail',
      affectedWorkoutIds: ['w-mon'],
      confidence: 'HIGH'
    };

    // Simuler une défaillance critique d'audit
    const originalAddDecision = useAppStore.getState().addCoachDecision;
    useAppStore.setState({
      addCoachDecision: () => {
        throw new Error('Base audit inaccessible');
      }
    });

    const res = CoachActionExecutor.executeProposal(proposal);
    expect(res.success).toBe(false);
    expect(res.rolledBack).toBe(true);
    expect(res.error).toContain('AUDIT_PERSISTENCE_FAILED');

    // Restaurer la méthode
    useAppStore.setState({ addCoachDecision: originalAddDecision });
    expect(useAppStore.getState().plannedWorkouts).toEqual(snapshotBefore);
  });

  // 11. Absence de duplication des séances
  it('11. absence de duplication des séances — vérifie que chaque ID de séance reste unique', () => {
    const proposal: CoachProposal = {
      id: 'prop-no-dup',
      action: 'MOVE_WORKOUT',
      reason: 'Déplacement vendredi',
      affectedWorkoutIds: ['w-mon'],
      proposedModifications: [{ workoutId: 'w-mon', newDate: '2026-04-17' }],
      confidence: 'HIGH'
    };

    CoachActionExecutor.executeProposal(proposal);

    const workouts = useAppStore.getState().plannedWorkouts;
    const ids = workouts.map(w => w.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  // 12. Préservation des identifiants
  it('12. préservation des identifiants — conserve scrupuleusement l ID d origine et le planId', () => {
    const proposal: CoachProposal = {
      id: 'prop-id-check',
      action: 'REDUCE_LOAD',
      reason: 'Allègement',
      affectedWorkoutIds: ['w-sat'],
      proposedModifications: [{ workoutId: 'w-sat', newDurationMin: 90 }],
      confidence: 'HIGH'
    };

    CoachActionExecutor.executeProposal(proposal);

    const sat = useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-sat');
    expect(sat?.id).toBe('w-sat');
    expect(sat?.planId).toBe('plan-32');
    expect(sat?.sport).toBe('Ride');
  });

  // 13. Recalcul de la charge planifiée
  it('13. recalcul de la charge planifiée — calcule la nouvelle charge hebdomadaire réelle de manière déterministe', () => {
    // Charge initiale : 70 (mon) + 55 (wed) + 35 (fri) + 90 (sat) = 250 TSS
    const proposal: CoachProposal = {
      id: 'prop-recalc-load',
      action: 'REDUCE_LOAD',
      reason: 'Allègement 50 TSS vers 25 TSS',
      affectedWorkoutIds: ['w-wed'],
      proposedModifications: [{ workoutId: 'w-wed', newTargetTss: 25 }],
      confidence: 'HIGH'
    };

    const res = CoachActionExecutor.executeProposal(proposal);
    expect(res.success).toBe(true);
    expect(res.recalculatedWeeklyLoad).toBe(220); // 250 - 30 = 220
    expect(res.loadDelta).toBe(-30);
  });

  // 14. Séparation charge planifiée / charge réelle
  it('14. séparation charge planifiée / charge réelle — les séances réelles actualWorkouts restent 100% intouchées', () => {
    const actualsBefore = JSON.parse(JSON.stringify(useAppStore.getState().actualWorkouts));

    const proposal: CoachProposal = {
      id: 'prop-sep-load',
      action: 'CANCEL_WORKOUT',
      reason: 'Séance manquée',
      affectedWorkoutIds: ['w-mon'],
      confidence: 'HIGH'
    };

    CoachActionExecutor.executeProposal(proposal);

    const actualsAfter = useAppStore.getState().actualWorkouts;
    expect(actualsAfter).toEqual(actualsBefore);
  });

  // 15. Cohérence des métriques dérivées
  it('15. cohérence des métriques dérivées — recalcul du PMC synchronisé sans données arbitraires', () => {
    const proposal: CoachProposal = {
      id: 'prop-pmc-check',
      action: 'REDUCE_LOAD',
      reason: 'Allègement',
      affectedWorkoutIds: ['w-mon'],
      confidence: 'HIGH'
    };

    const res = CoachActionExecutor.executeProposal(proposal);
    expect(res.recalculatedPmcCount).toBeGreaterThan(0);
    const pmc = useAppStore.getState().pmc;
    expect(pmc.length).toBeGreaterThan(0);
  });

  // 16. Respect des disponibilités
  it('16. respect des disponibilités — refuse le déplacement vers un jour indisponible (ex: Mardi)', () => {
    const snapshotBefore = JSON.parse(JSON.stringify(useAppStore.getState().plannedWorkouts));

    const proposal: CoachProposal = {
      id: 'prop-unavail-day',
      action: 'MOVE_WORKOUT',
      reason: 'Déplacement mardi (jour indisponible)',
      affectedWorkoutIds: ['w-mon'],
      proposedModifications: [{ workoutId: 'w-mon', newDate: '2026-04-14' }], // Mardi !
      confidence: 'HIGH'
    };

    const res = CoachActionExecutor.executeProposal(proposal);
    expect(res.success).toBe(false);
    expect(res.rolledBack).toBe(true);
    expect(useAppStore.getState().plannedWorkouts).toEqual(snapshotBefore);
  });

  // 17. Respect des contraintes de récupération
  it('17. respect des contraintes de récupération — assure que la séance allégée reste en intensité aérobie basse', () => {
    const proposal: CoachProposal = {
      id: 'prop-recov-intensity',
      action: 'RECOVERY',
      reason: 'Récupération active',
      affectedWorkoutIds: ['w-mon'],
      confidence: 'HIGH'
    };

    CoachActionExecutor.executeProposal(proposal);
    const updated = useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-mon');
    expect(updated?.targetIntensity?.value).toContain('Z1/Z2');
  });

  // 18. Respect de la limite de +5 % existante
  it('18. respect de la limite de +5 % existante — bloque toute proposition augmentant la charge de plus de 5%', () => {
    // 250 TSS baseline. Augmentation de 50 TSS (+20%) = illégal
    const illegalIncreaseProposal: CoachProposal = {
      id: 'prop-illegal-increase',
      action: 'INCREASE_LOAD',
      reason: 'Augmentation excessive',
      affectedWorkoutIds: ['w-mon'],
      proposedModifications: [{ workoutId: 'w-mon', newTargetTss: 130 }], // +60 TSS
      confidence: 'HIGH'
    };

    const res = CoachActionExecutor.executeProposal(illegalIncreaseProposal);
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.updatedWorkoutsCount).toBe(0);
  });

  // 19. Refus d'une hausse incompatible avec la fatigue
  it('19. refus d une hausse incompatible avec la fatigue — bloque INCREASE_LOAD si TSB < -20', () => {
    // Simuler fatigue aiguë
    useAppStore.setState({
      pmc: [
        { date: '2026-04-13', ctl: 40, atl: 70, tsb: -30, tss: 90 }
      ]
    });

    const proposal: CoachProposal = {
      id: 'prop-fatigue-block',
      action: 'INCREASE_LOAD',
      reason: 'Tentative hausse sur fatigue',
      affectedWorkoutIds: ['w-mon'],
      confidence: 'HIGH'
    };

    const res = CoachActionExecutor.executeProposal(proposal);
    expect(res.success).toBe(false);
    expect(res.message).toContain('fatigue');
  });

  // 20. Absence de modification des séances non concernées
  it('20. absence de modification des séances non concernées — séances non ciblées 100% identiques', () => {
    const wedBefore = { ...useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-wed') };
    const friBefore = { ...useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-fri') };
    const satBefore = { ...useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-sat') };

    const proposal: CoachProposal = {
      id: 'prop-only-mon',
      action: 'REDUCE_LOAD',
      reason: 'Ajuste seulement lundi',
      affectedWorkoutIds: ['w-mon'],
      proposedModifications: [{ workoutId: 'w-mon', newDurationMin: 45 }],
      confidence: 'HIGH'
    };

    CoachActionExecutor.executeProposal(proposal);

    const workoutsAfter = useAppStore.getState().plannedWorkouts;
    expect(workoutsAfter.find(w => w.id === 'w-wed')).toEqual(wedBefore);
    expect(workoutsAfter.find(w => w.id === 'w-fri')).toEqual(friBefore);
    expect(workoutsAfter.find(w => w.id === 'w-sat')).toEqual(satBefore);
  });

  // 21. Proposition de reprise progressive
  it('21. proposition de reprise progressive — adapte le volume de reprise sans cumul de charge', () => {
    const proposal: CoachProposal = {
      id: 'prop-return-prog',
      action: 'RECOVERY',
      reason: 'Reprise post-arrêt',
      affectedWorkoutIds: ['w-mon'],
      proposedModifications: [{ workoutId: 'w-mon', newDurationMin: 30, newTargetTss: 20 }],
      confidence: 'HIGH'
    };

    const res = CoachActionExecutor.executeProposal(proposal);
    expect(res.success).toBe(true);
    expect(res.recalculatedWeeklyLoad).toBeLessThan(250);
  });

  // 22. Absence de mutation avant confirmation
  it('22. absence de mutation avant confirmation — validation et explication ne mutent rien', () => {
    const workoutsBefore = JSON.parse(JSON.stringify(useAppStore.getState().plannedWorkouts));

    const proposal: CoachProposal = {
      id: 'prop-no-mut-before',
      action: 'CANCEL_WORKOUT',
      reason: 'Fatigue',
      affectedWorkoutIds: ['w-mon'],
      confidence: 'HIGH'
    };

    // Validation seule
    validateCoachProposal(proposal, {
      plannedWorkouts: workoutsBefore,
      currentPmc: null,
      confidence: { level: 'HIGH', reasons: [], historyWeeks: 4, recentWorkoutsCount: 6 },
      weeklyPlannedLoad: 250
    });

    expect(useAppStore.getState().plannedWorkouts).toEqual(workoutsBefore);
  });

  // 23. Absence de mutation après refus
  it('23. absence de mutation après refus — une proposition refusée ne peut pas être forcée à l exécution', () => {
    const proposal: CoachProposal = {
      id: 'prop-refused-perm',
      action: 'CANCEL_WORKOUT',
      reason: 'Refusé',
      affectedWorkoutIds: ['w-mon'],
      confidence: 'HIGH'
    };

    CoachActionExecutor.recordRefusal(proposal);

    const res = CoachActionExecutor.executeProposal(proposal);
    expect(res.success).toBe(false);
    expect(res.alreadyRejected).toBe(true);
    expect(useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-mon')?.status).toBe('planned');
  });

  // 24. Absence de mutation par Gemini
  it('24. absence de mutation par Gemini — un payload Gemini ne peut pas modifier directement le store', () => {
    const workoutsBefore = JSON.parse(JSON.stringify(useAppStore.getState().plannedWorkouts));

    const fakeGeminiPayload = {
      intent: 'REQUEST_LESS_LOAD',
      confidence: 'HIGH',
      entities: { targetDuration: 30 },
      constraints: { reduceIntensity: true }
    };

    const validation = validateGeminiIntentPayload(fakeGeminiPayload);
    expect(validation.valid).toBe(true);

    // Vérifier que le store est strictement inchangé
    expect(useAppStore.getState().plannedWorkouts).toEqual(workoutsBefore);
  });

  // 25. Absence de métriques inventées
  it('25. absence de métriques inventées — rejet absolu si un payload tente d imposer du TSS ou CTL', () => {
    const maliciousGeminiPayload = {
      intent: 'REQUEST_LESS_LOAD',
      confidence: 'HIGH',
      entities: { inventedTSS: 120, inventedCTL: 80 }
    };

    const check = validateGeminiIntentPayload(maliciousGeminiPayload);
    expect(check.valid).toBe(false);
    expect(check.rejectionReason).toContain('Métrique interdite inventée');
  });

  // 26. État UI cohérent après succès
  it('26. état UI cohérent après succès — retourne les détails des séances ajustées et le delta de charge', () => {
    const proposal: CoachProposal = {
      id: 'prop-ui-succ',
      action: 'REDUCE_LOAD',
      reason: 'Allègement séance lundi',
      affectedWorkoutIds: ['w-mon'],
      proposedModifications: [{ workoutId: 'w-mon', newDurationMin: 45, newTargetTss: 40 }],
      confidence: 'HIGH'
    };

    const res = CoachActionExecutor.executeProposal(proposal);
    expect(res.success).toBe(true);
    expect(res.loadDelta).toBe(-30);
    expect(res.affectedWorkouts).toBeDefined();
    expect(res.affectedWorkouts?.[0].id).toBe('w-mon');
    expect(res.affectedWorkouts?.[0].durationMin).toBe(45);
  });

  // 27. État UI cohérent après échec
  it('27. état UI cohérent après échec — message explicatif clair sans prétendre que le planning a changé', () => {
    const invalidProposal: CoachProposal = {
      id: 'prop-ui-fail',
      action: 'INCREASE_LOAD',
      reason: 'Hausse impossible',
      affectedWorkoutIds: ['w-mon'],
      proposedModifications: [{ workoutId: 'w-mon', newTargetTss: 200 }], // +130 TSS
      confidence: 'HIGH'
    };

    const res = CoachActionExecutor.executeProposal(invalidProposal);
    expect(res.success).toBe(false);
    expect(res.message).toBeDefined();
    expect(res.updatedWorkoutsCount).toBe(0);
  });

  // 28. Conservation de l'audit après rollback
  it('28. conservation de l audit après rollback — trace FAILED enregistrée avec raison précise', () => {
    const proposal: CoachProposal = {
      id: 'prop-audit-rollback',
      action: 'MOVE_WORKOUT',
      reason: 'Déplacement jour interdit',
      affectedWorkoutIds: ['w-mon'],
      proposedModifications: [{ workoutId: 'w-mon', newDate: '2026-04-14' }], // Mardi indisponible
      confidence: 'HIGH'
    };

    CoachActionExecutor.executeProposal(proposal);

    const decisions = useAppStore.getState().coachDecisions;
    const failedDecision = decisions.find(d => d.proposal?.id === 'prop-audit-rollback');
    expect(failedDecision).toBeDefined();
    expect(failedDecision?.userDecision).toBe('FAILED');
    expect(failedDecision?.engineResult?.rolledBack).toBe(true);
  });

  // 29. Exécution concurrente de deux confirmations
  it('29. exécution concurrente de deux confirmations — le verrou anti-concurrence bloque la seconde exécution', () => {
    const proposal: CoachProposal = {
      id: 'prop-concurrent-test',
      action: 'CANCEL_WORKOUT',
      reason: 'Double clic simulation',
      affectedWorkoutIds: ['w-fri'],
      confidence: 'HIGH'
    };

    // Simuler un appel concurrent en manipulant le verrou
    (CoachActionExecutor as any).inFlightExecutions.add(proposal.id);

    const res = CoachActionExecutor.executeProposal(proposal);
    expect(res.success).toBe(false);
    expect(res.error).toBe('CONCURRENT_EXECUTION_BLOCKED');

    // Libérer le verrou
    (CoachActionExecutor as any).inFlightExecutions.delete(proposal.id);
  });

  // 30. Non-régression des Phases 26 à 31
  it('30. non-régression des Phases 26 à 31 — flux de bout en bout complet (Message -> Intention -> Proposition -> Validation -> Exécution)', () => {
    // 1. Message naturel de l'athlète
    const userMessage = "Je suis très fatigué aujourd'hui, allège ma séance";
    const context = {
      profile: useAppStore.getState().athleteProfile,
      todayWorkout: useAppStore.getState().plannedWorkouts[0],
      pmcStatus: { ctl: 45, atl: 40, tsb: 5, fatigueLevel: 'optimal' as const },
      weeklyPlannedLoad: 250,
      confidence: { level: 'HIGH' as const, reasons: [], historyWeeks: 4, recentWorkoutsCount: 6 }
    } as any;

    // 2. Détection d'intention
    const intent = parseIntentDeterministically(userMessage, context);
    expect(intent.type).toBe('REPORT_FATIGUE');

    // 3. Tour conversationnel et proposition déterministe
    const turn = CoachConversationManager.processMessage(userMessage, context);
    expect(turn.proposal).not.toBeNull();
    const proposal = turn.proposal!;
    expect(proposal.action).toBe('REDUCE_LOAD');

    // 4. L'athlète valide la proposition
    const result = CoachActionExecutor.executeProposal(proposal, { userMessage });
    expect(result.success).toBe(true);
    expect(result.updatedWorkoutsCount).toBe(1);

    // 5. Vérification de cohérence finale
    const updatedWorkout = useAppStore.getState().plannedWorkouts.find(w => w.id === proposal.affectedWorkoutIds[0]);
    expect(updatedWorkout?.status).toBe('adapted');
    expect(useAppStore.getState().coachDecisions.length).toBeGreaterThan(0);
  });
});
