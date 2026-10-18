import { describe, it, expect, beforeEach } from 'vitest';
import { validateCoachProposal, ValidationContext } from './coachActionValidator';
import { buildConfidenceAssessment, calculateObservedTolerance } from './coachContextBuilder';
import { CoachProposal } from '../domain/coachTypes';
import { PlannedWorkout, ActualWorkout } from '../domain/models';
import { useAppStore } from '../store';
import { subDays, format } from 'date-fns';

describe('CoachActionValidator & Confidence Engine (Phase 27)', () => {
  const basePlannedWorkouts: PlannedWorkout[] = [
    {
      id: 'w1',
      sport: 'Run',
      date: '2026-09-20',
      title: 'Endurance fondamentale',
      targetDurationMin: 60,
      targetIntensity: { type: 'zone', value: 'Z2' },
      targetTss: 50,
      status: 'planned'
    },
    {
      id: 'w2',
      sport: 'Ride',
      date: '2026-09-22',
      title: 'Sortie longue',
      targetDurationMin: 120,
      targetIntensity: { type: 'zone', value: 'Z2' },
      targetTss: 100,
      status: 'planned'
    }
  ];

  const baseContext: ValidationContext = {
    plannedWorkouts: basePlannedWorkouts,
    currentPmc: { tsb: 5, atl: 40, ctl: 45 },
    confidence: {
      level: 'HIGH',
      reasons: ['Historique complet et cohérent'],
      historyWeeks: 8,
      recentWorkoutsCount: 8
    },
    weeklyPlannedLoad: 500
  };

  beforeEach(() => {
    // Reset store state
    useAppStore.setState({
      plannedWorkouts: basePlannedWorkouts,
      actualWorkouts: []
    });
  });

  // -------------------------------------------------------------
  // Test 1 : Action valide
  // -------------------------------------------------------------
  it('Test 1 - Action valide acceptée sans erreur', () => {
    const proposal: CoachProposal = {
      id: 'prop-1',
      action: 'MODIFY_WORKOUT',
      reason: 'Ajustement du créneau pour convenance athlète',
      affectedWorkoutIds: ['w1'],
      constraints: {
        preserveGoal: true
      },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = validateCoachProposal(proposal, baseContext);

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.normalizedAction).toBeDefined();
  });

  // -------------------------------------------------------------
  // Test 2 : Workout inexistant
  // -------------------------------------------------------------
  it('Test 2 - Rejet si la séance ciblée est inexistante dans le plan', () => {
    const proposal: CoachProposal = {
      id: 'prop-2',
      action: 'MODIFY_WORKOUT',
      reason: 'Modifier une séance inconnue',
      affectedWorkoutIds: ['unknown_workout_999'],
      constraints: {},
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = validateCoachProposal(proposal, baseContext);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('unknown_workout_999');
    expect(result.blockedReason).toContain('unknown_workout_999');
  });

  // -------------------------------------------------------------
  // Test 3 : Augmentation dépassant +5 % de la charge hebdomadaire
  // -------------------------------------------------------------
  it('Test 3 - Rejet si augmentation dépasse +5 % de la charge hebdomadaire (530 TSS pour 500 prévu)', () => {
    const proposal: CoachProposal = {
      id: 'prop-3',
      action: 'INCREASE_LOAD',
      reason: "L'athlète demande à en faire plus",
      affectedWorkoutIds: ['w2'],
      constraints: {
        maxWeeklyLoadIncrease: 0.06 // 6%
      },
      sourceContext: {
        proposedWeeklyLoad: 530 // 530 > 500 * 1.05 = 525
      },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = validateCoachProposal(proposal, baseContext);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('+5%') || e.includes('dépasse'))).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 4 : Augmentation exactement dans la limite (+5 %)
  // -------------------------------------------------------------
  it('Test 4 - Acceptée si augmentation est exactement dans la limite de +5 % (525 TSS pour 500 prévu)', () => {
    const proposal: CoachProposal = {
      id: 'prop-4',
      action: 'INCREASE_LOAD',
      reason: 'Excellente forme déclarée par athlète',
      affectedWorkoutIds: ['w2'],
      loadIncreasePercent: 5.0,
      constraints: {
        maxWeeklyLoadIncrease: 0.05
      },
      sourceContext: {
        proposedWeeklyLoad: 525
      },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = validateCoachProposal(proposal, baseContext);

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  // -------------------------------------------------------------
  // Test 5 : Historique < 4 semaines -> INSUFFICIENT_DATA & rejet hausse
  // -------------------------------------------------------------
  it('Test 5 - Historique < 4 semaines donne INSUFFICIENT_DATA et bloque toute augmentation de charge', () => {
    const today = new Date();
    // Créer seulement 2 semaines d'historique (14 jours)
    const shortActuals: ActualWorkout[] = [
      {
        id: 'a1',
        sport: 'Run',
        date: format(subDays(today, 10), 'yyyy-MM-dd'),
        startTime: subDays(today, 10).toISOString(),
        durationMin: 45,
        tss: 40,
        source: 'manual'
      },
      {
        id: 'a2',
        sport: 'Ride',
        date: format(subDays(today, 3), 'yyyy-MM-dd'),
        startTime: subDays(today, 3).toISOString(),
        durationMin: 60,
        tss: 50,
        source: 'manual'
      }
    ];

    const assessment = buildConfidenceAssessment(shortActuals, today);
    expect(assessment.level).toBe('INSUFFICIENT_DATA');
    expect(assessment.historyWeeks).toBeLessThan(4);

    const tolerance = calculateObservedTolerance(shortActuals, assessment);
    expect(tolerance).toBeNull(); // Tolérance statistique non inventée

    // Tenter une augmentation avec ce niveau de confiance
    const proposal: CoachProposal = {
      id: 'prop-5',
      action: 'INCREASE_LOAD',
      reason: 'Augmentation sans données historiques',
      affectedWorkoutIds: ['w1'],
      loadIncreasePercent: 3,
      constraints: {},
      confidence: assessment.level,
      proposedAt: today.toISOString()
    };

    const contextWithInsufficientData: ValidationContext = {
      ...baseContext,
      confidence: assessment
    };

    const result = validateCoachProposal(proposal, contextWithInsufficientData);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('données historiques insuffisantes'))).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 6 : Proposition contenant une métrique inventée par Gemini
  // -------------------------------------------------------------
  it('Test 6 - Rejet strict si la proposition contient une métrique inventée ou recalculée par l IA', () => {
    const proposalWithFakeMetrics = {
      id: 'prop-6',
      action: 'MODIFY_WORKOUT',
      reason: 'Modifier la séance',
      affectedWorkoutIds: ['w1'],
      constraints: {},
      confidence: 'HIGH' as const,
      proposedAt: new Date().toISOString(),
      recalculatedCtl: 58, // FORBIDDEN: Seul Plana calcule le CTL
      sourceContext: {
        inventedTss: 85 // FORBIDDEN
      }
    };

    const result = validateCoachProposal(proposalWithFakeMetrics as any, baseContext);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('recalculées ou inventées'))).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 7 : Proposition contradictoire avec AdaptationEngine (hausse sous fatigue)
  // -------------------------------------------------------------
  it('Test 7 - Rejet si proposition est contradictoire avec AdaptationEngine (hausse sous fatigue élevée)', () => {
    const fatigueContext: ValidationContext = {
      ...baseContext,
      currentPmc: { tsb: -25, atl: 88, ctl: 63 } // Fatigue élevée selon AdaptationEngine
    };

    const proposal: CoachProposal = {
      id: 'prop-7',
      action: 'INCREASE_LOAD',
      reason: 'Demande d intensité',
      affectedWorkoutIds: ['w1'],
      loadIncreasePercent: 3,
      constraints: {},
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = validateCoachProposal(proposal, fatigueContext);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('AdaptationEngine') && e.includes('fatigue'))).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 8 : Séance manquée (Interdiction du rattrapage automatique)
  // -------------------------------------------------------------
  it('Test 8 - Rejet si une proposition cherche à rattraper la charge d une séance manquée', () => {
    const proposal: CoachProposal = {
      id: 'prop-8',
      action: 'ADAPT_PLAN',
      reason: 'Séance manquée à rattraper',
      affectedWorkoutIds: ['w1'],
      constraints: {
        avoidMakeupTraining: false // FORBIDDEN: tentative de rattrapage automatique
      },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = validateCoachProposal(proposal, baseContext);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('rattraper'))).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 9 : Action sans mutation Zustand (Pureté garantie)
  // -------------------------------------------------------------
  it('Test 9 - La validation ne modifie en aucun cas le store Zustand', () => {
    const stateBefore = useAppStore.getState();
    const plannedBefore = JSON.stringify(stateBefore.plannedWorkouts);

    const proposal: CoachProposal = {
      id: 'prop-9',
      action: 'CANCEL_WORKOUT',
      reason: 'Mise au repos',
      affectedWorkoutIds: ['w1'],
      constraints: {
        prioritizeRecovery: true
      },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = validateCoachProposal(proposal, baseContext);
    expect(result.valid).toBe(true);

    const stateAfter = useAppStore.getState();
    const plannedAfter = JSON.stringify(stateAfter.plannedWorkouts);

    expect(plannedAfter).toBe(plannedBefore);
  });

  // -------------------------------------------------------------
  // Test 10 : Action valide avec fatigue élevée (Allègement cohérent)
  // -------------------------------------------------------------
  it('Test 10 - Action valide sous fatigue élevée si elle favorise la récupération', () => {
    const fatigueContext: ValidationContext = {
      ...baseContext,
      currentPmc: { tsb: -26, atl: 92, ctl: 66 }
    };

    const proposal: CoachProposal = {
      id: 'prop-10',
      action: 'REDUCE_LOAD',
      reason: 'Allègement pour favoriser la récupération',
      affectedWorkoutIds: ['w1'],
      constraints: {
        reduceIntensity: true,
        prioritizeRecovery: true
      },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = validateCoachProposal(proposal, fatigueContext);

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.warnings.some(w => w.includes('AdaptationEngine'))).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 11 (Phase 27.1 A) : Séance manquée + réorganisation raisonnable -> acceptée
  // -------------------------------------------------------------
  it('Test 11 (Phase 27.1 A) - Séance manquée avec réorganisation raisonnable de la semaine est acceptée', () => {
    // Séance manquée lundi -> Proposition de déplacer la séance clé prévue mercredi à mardi sans ajout de charge
    const proposal: CoachProposal = {
      id: 'prop-missed-reorg',
      action: 'MOVE_WORKOUT',
      reason: 'Séance manquée lundi : déplacement de la séance clé de mercredi à mardi pour préserver la structure',
      affectedWorkoutIds: ['w1'],
      constraints: {
        preserveKeyWorkout: true,
        prioritizeRecovery: true,
        avoidMakeupTraining: true
      },
      sourceContext: {
        currentWeeklyLoad: 500,
        proposedWeeklyLoad: 450 // Pas de charge ajoutée, charge restante cohérente
      },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = validateCoachProposal(proposal, baseContext);

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  // -------------------------------------------------------------
  // Test 12 (Phase 27.1 B) : Séance manquée + ajout automatique de toute la charge perdue -> rejetée
  // -------------------------------------------------------------
  it('Test 12 (Phase 27.1 B) - Séance manquée avec tentative de cumul/rattrapage automatique de charge est rejetée', () => {
    // Tentative d'ajouter automatiquement la charge de 50 TSS perdue sur les autres séances
    const proposalWithAutoMakeup: CoachProposal = {
      id: 'prop-missed-auto-makeup',
      action: 'ADAPT_PLAN',
      reason: 'Séance manquée lundi : report automatique de la charge perdue sur la séance de jeudi',
      affectedWorkoutIds: ['w1'],
      constraints: {
        autoMakeupMissedLoad: true // INTERDIT : rattrapage automatique
      },
      sourceContext: {
        missedWorkoutLoadAdded: 50
      },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = validateCoachProposal(proposalWithAutoMakeup, baseContext);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('rattraper') || e.includes('ajouter automatiquement'))).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 13 (Phase 27.1 C) : Séance manquée + surcharge hebdomadaire > limite -> rejetée
  // -------------------------------------------------------------
  it('Test 13 (Phase 27.1 C) - Séance manquée avec surcharge hebdomadaire dépassant la limite autorisée (+5%) est rejetée', () => {
    // Après une séance manquée, proposition qui monte la charge hebdomadaire à 540 TSS pour 500 prévus (> +5% max de 525 TSS)
    const proposalWithOverload: CoachProposal = {
      id: 'prop-missed-overload',
      action: 'ADAPT_PLAN',
      reason: 'Réorganisation après séance manquée avec augmentation excessive de volume',
      affectedWorkoutIds: ['w1'],
      constraints: {
        preserveGoal: true
      },
      sourceContext: {
        currentWeeklyLoad: 500,
        proposedWeeklyLoad: 540 // 540 > 500 * 1.05 = 525 TSS
      },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = validateCoachProposal(proposalWithOverload, baseContext);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('+5%') || e.includes('dépasse la limite'))).toBe(true);
  });
});
