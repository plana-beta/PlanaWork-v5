import { describe, it, expect, beforeEach } from 'vitest';
import { CoachConversationManager } from './coachConversationManager';
import { parseIntentDeterministically, validateGeminiIntentPayload } from './coachIntentParser';
import { validateCoachIntent } from './coachIntentValidator';
import { BuiltCoachContext } from './coachContextBuilder';
import { AthleteProfile, PlannedWorkout, Sport } from '../domain/models';
import { CoachProposal } from '../domain/coachTypes';
import { CoachActionExecutor } from './coachActionExecutor';
import { useAppStore } from '../store';

function createMockContext(overrides?: Partial<BuiltCoachContext>): BuiltCoachContext {
  const defaultProfile: AthleteProfile = {
    id: 'ath-1',
    name: 'Thomas',
    level: {
      swim: 'intermediate',
      ride: 'intermediate',
      run: 'intermediate'
    },
    availability: {
      availableDays: ['monday', 'tuesday', 'thursday', 'saturday', 'sunday'],
      weeklyHours: 10
    },
    goal: {
      id: 'g-1',
      title: 'Cyclosportive Les Alpes',
      date: '2026-09-30',
      type: 'custom',
      sportFocus: 'Ride'
    },
    dataConnection: 'demo'
  };

  const defaultTodayWorkout: any = {
    id: 'w-today',
    date: '2026-09-20',
    title: 'Intervalles Seuil 4x8min',
    sport: 'Ride',
    durationMin: 75,
    targetDurationMin: 75,
    targetTss: 65,
    targetIntensity: { type: 'zone', value: 'Z4' },
    status: 'planned'
  };

  return {
    profile: defaultProfile,
    todayWorkout: defaultTodayWorkout,
    upcomingWorkouts: [],
    recentActuals: [],
    recentWorkouts: [],
    weeklyPlannedLoad: 300,
    pmcStatus: {
      ctl: 55,
      atl: 48,
      tsb: 7,
      fatigueLevel: 'optimal'
    },
    confidence: {
      level: 'HIGH',
      reasons: [],
      historyWeeks: 4,
      recentWorkoutsCount: 14
    },
    tolerance: null,
    historySummary: {
      completedWorkoutsCount: 14,
      missedWorkoutsCount: 0,
      complianceRate: 0.95
    },
    availability: {
      availableDays: ['monday', 'tuesday', 'thursday', 'saturday', 'sunday'],
      temporaryBlockedDates: []
    },
    ...overrides
  } as any;
}

describe('Phase 31 — Coach Conversation & Natural Language Intent Engine', () => {
  beforeEach(() => {
    useAppStore.getState().resetAthleteProfile();
  });

  // 1. ASK_TODAY_WORKOUT
  it('1. ASK_TODAY_WORKOUT — détecte correctement la question sur la séance du jour', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Quelle est ma séance aujourd'hui ?", context);
    expect(intent.type).toBe('ASK_TODAY_WORKOUT');
    expect(intent.confidence).toBe('HIGH');

    const turn = CoachConversationManager.processMessage("Quelle est ma séance aujourd'hui ?", context);
    expect(turn.coachResponse).toContain('Intervalles Seuil 4x8min');
    expect(turn.proposal).toBeNull();
  });

  // 2. REPORT_FATIGUE
  it('2. REPORT_FATIGUE — détecte le signalement de fatigue et propose un allègement sans muter le plan', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Je suis crevé aujourd'hui", context);
    expect(intent.type).toBe('REPORT_FATIGUE');
    expect(intent.constraints.reduceIntensity).toBe(true);

    const turn = CoachConversationManager.processMessage("Je suis crevé aujourd'hui", context);
    expect(turn.proposal).not.toBeNull();
    expect(turn.proposal?.action).toBe('REDUCE_LOAD');
    expect(turn.proposal?.proposedModifications?.[0].newDurationMin).toBeLessThan(75);
  });

  // 3. REPORT_ILLNESS
  it('3. REPORT_ILLNESS — détecte la maladie, propose du repos et respecte la stricte absence de diagnostic', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Je suis malade depuis hier avec un gros rhume", context);
    expect(intent.type).toBe('REPORT_ILLNESS');
    expect(intent.constraints.prioritizeRecovery).toBe(true);

    const turn = CoachConversationManager.processMessage("Je suis malade depuis hier avec un gros rhume", context);
    expect(turn.proposal?.action).toBe('CANCEL_WORKOUT');
    expect(turn.proposal?.proposedModifications?.[0].cancel).toBe(true);
  });

  // 4. REPORT_PAIN_OR_DISCOMFORT
  it('4. REPORT_PAIN_OR_DISCOMFORT — signale une douleur et préconise le repos sans poser de diagnostic médical', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("J'ai une douleur vive au genou", context);
    expect(intent.type).toBe('REPORT_PAIN_OR_DISCOMFORT');
    expect(intent.context.painLocation).toBe('knee');

    const validation = validateCoachIntent(intent, { coachContext: context });
    expect(validation.warnings.some(w => w.includes('diagnostic médical'))).toBe(true);

    const turn = CoachConversationManager.processMessage("J'ai une douleur vive au genou", context);
    expect(turn.proposal?.action).toBe('CANCEL_WORKOUT');
  });

  // 5. REPORT_MISSED_WORKOUT
  it('5. REPORT_MISSED_WORKOUT — enregistre la séance manquée sans rattrapage de charge cumulatif', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Je n'ai pas fait ma séance hier parce que j'étais au travail", context);
    expect(intent.type).toBe('REPORT_MISSED_WORKOUT');

    const validation = validateCoachIntent(intent, { coachContext: context });
    expect(validation.warnings.some(w => w.includes('charge de la séance manquée ne sera pas reportée'))).toBe(true);

    const turn = CoachConversationManager.processMessage("Je n'ai pas fait ma séance hier parce que j'étais au travail", context);
    expect(turn.coachResponse).toContain('ne rattrapons pas cette charge');
  });

  // 6. REQUEST_LESS_LOAD
  it('6. REQUEST_LESS_LOAD — demande un allègement de charge', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Je veux faire quelque chose de plus léger aujourd'hui", context);
    expect(intent.type).toBe('REQUEST_LESS_LOAD');

    const turn = CoachConversationManager.processMessage("Je veux faire quelque chose de plus léger aujourd'hui", context);
    expect(turn.proposal?.action).toBe('REDUCE_LOAD');
    expect(turn.proposal?.proposedModifications?.[0].newTargetTss).toBeLessThan(65);
  });

  // 7. REQUEST_MORE_LOAD
  it('7. REQUEST_MORE_LOAD — demande une augmentation de charge plafonnée à +5%', () => {
    const context = createMockContext({
      pmcStatus: { ctl: 60, atl: 45, tsb: 15, fatigueLevel: 'optimal' }
    });
    const intent = parseIntentDeterministically("Je me sens super bien, je peux en faire plus ?", context);
    expect(intent.type).toBe('REQUEST_MORE_LOAD');
    expect(intent.constraints.maxWeeklyLoadIncrease).toBe(0.05);

    const turn = CoachConversationManager.processMessage("Je me sens super bien, je peux en faire plus ?", context);
    expect(turn.proposal?.action).toBe('INCREASE_LOAD');
    expect(turn.proposal?.proposedModifications?.[0].newTargetTss).toBeGreaterThan(65);
  });

  // 8. REQUEST_CHANGE_SPORT
  it('8. REQUEST_CHANGE_SPORT — remplace la discipline à charge équivalente', () => {
    const context = createMockContext({
      todayWorkout: {
        id: 'w-run',
        date: '2026-09-20',
        title: 'Footing aérobie',
        sport: 'Run',
        durationMin: 50,
        targetTss: 45,
        structure: []
      }
    });
    const intent = parseIntentDeterministically("Je ne veux pas courir aujourd'hui, je veux faire du vélo à la place", context);
    expect(intent.type).toBe('REQUEST_CHANGE_SPORT');
    expect(intent.context.preferredSport).toBe('Ride');

    const turn = CoachConversationManager.processMessage("Je ne veux pas courir aujourd'hui, je veux faire du vélo à la place", context);
    expect(turn.proposal?.action).toBe('MODIFY_WORKOUT');
    expect(turn.proposal?.proposedModifications?.[0].newSport).toBe('Ride');
  });

  // 9. REQUEST_CHANGE_DURATION
  it('9. REQUEST_CHANGE_DURATION — recalibre la durée et calcule le TSS proportionnel', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Je n'ai qu'une heure ce soir", context);
    expect(intent.type).toBe('REQUEST_CHANGE_DURATION');
    expect(intent.context.requestedDurationMin).toBe(60);

    const turn = CoachConversationManager.processMessage("Je n'ai qu'une heure ce soir", context);
    expect(turn.proposal?.proposedModifications?.[0].newDurationMin).toBe(60);
    expect(turn.proposal?.proposedModifications?.[0].newTargetTss).toBe(52); // Math.round(65 * (60/75))
  });

  // 10. REQUEST_MOVE_WORKOUT
  it('10. REQUEST_MOVE_WORKOUT — planifie le déplacement de la séance', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Il pleut, je préfère rouler demain", context, new Date('2026-09-20'));
    expect(intent.type).toBe('REQUEST_MOVE_WORKOUT');
    expect(intent.context.targetDate).toBe('2026-09-21');

    const turn = CoachConversationManager.processMessage("Il pleut, je préfère rouler demain", context, { currentDate: new Date('2026-09-20') });
    expect(turn.proposal?.action).toBe('MOVE_WORKOUT');
    expect(turn.proposal?.proposedModifications?.[0].newDate).toBe('2026-09-21');
  });

  // 11. REQUEST_CANCEL_WORKOUT
  it('11. REQUEST_CANCEL_WORKOUT — annule la séance sans impacter les jours suivants', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Je veux annuler la séance d'aujourd'hui", context);
    expect(intent.type).toBe('REQUEST_CANCEL_WORKOUT');

    const turn = CoachConversationManager.processMessage("Je veux annuler la séance d'aujourd'hui", context);
    expect(turn.proposal?.action).toBe('CANCEL_WORKOUT');
    expect(turn.proposal?.proposedModifications?.[0].cancel).toBe(true);
  });

  // 12. REQUEST_REPLACE_WORKOUT
  it('12. REQUEST_REPLACE_WORKOUT — propose de remplacer une séance par une autre activité', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Remplacer la course par du vélo", context);
    expect(intent.type).toBe('REQUEST_CHANGE_SPORT');
  });

  // 13. REQUEST_FULL_WEEK_ADAPTATION
  it('13. REQUEST_FULL_WEEK_ADAPTATION — prend en compte la demande d adaptation globale', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Je veux préparer ma course différemment et adapter toute la semaine", context);
    expect(intent.type === 'REQUEST_GOAL_CHANGE' || intent.type === 'DELEGATE_DECISION' || intent.type === 'REQUEST_FULL_WEEK_ADAPTATION').toBe(true);
  });

  // 14. ASK_WHY
  it('14. ASK_WHY — génère une explication physiologique transparente sans données inventées', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Pourquoi tu me proposes ça ?", context);
    expect(intent.type).toBe('ASK_WHY');

    const turn = CoachConversationManager.processMessage("Pourquoi tu me proposes ça ?", context);
    expect(turn.coachResponse.length).toBeGreaterThan(20);
    expect(turn.coachResponse).toContain('TSS');
  });

  // 15. Changement d'objectif
  it('15. Changement d objectif — identifie le nouvel objectif et pose les questions nécessaires', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Mon objectif a changé. Je veux maintenant préparer un marathon.", context);
    expect(intent.type).toBe('REQUEST_GOAL_CHANGE');
    expect(intent.context.newGoal?.target).toBe('Marathon');

    const validation = validateCoachIntent(intent, { coachContext: context });
    expect(validation.questions).toBeDefined();
    expect(validation.questions?.some(q => q.id === 'q-goal-date')).toBe(true);
  });

  // 16. Disponibilité temporaire
  it('16. Disponibilité temporaire — détecte une indisponibilité ponctuelle sans modifier le profil permanent', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Mercredi prochain je ne peux pas m'entraîner", context);
    expect(intent.type).toBe('REQUEST_AVAILABILITY_CHANGE');
    expect(intent.context.isTemporary).toBe(true);
    expect(intent.context.isPermanent).toBe(false);
  });

  // 17. Disponibilité permanente
  it('17. Disponibilité permanente — détecte un changement structurel permanent', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("À partir de maintenant je ne suis plus disponible le mercredi", context);
    expect(intent.type).toBe('REQUEST_AVAILABILITY_CHANGE');
    expect(intent.context.isPermanent).toBe(true);
    expect(intent.context.isTemporary).toBe(false);
  });

  // 18. Déclaration de préférence
  it('18. Déclaration de préférence — enregistre la préférence explicite', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Je préfère clairement rouler le mercredi", context);
    expect(intent.type).toBe('REPORT_PREFERENCE');

    const turn = CoachConversationManager.processMessage("Je préfère clairement rouler le mercredi", context);
    expect(turn.coachResponse).toContain("J'enregistre ta préférence");
  });

  // 19. Confirmation de dislike
  it('19. Confirmation de dislike — exige une confirmation explicite avant tout enregistrement persistant', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Je n'aime pas les séances de côtes", context);
    expect(intent.type).toBe('REPORT_DISLIKE');

    const validation = validateCoachIntent(intent, { coachContext: context });
    expect(validation.requiresConfirmation).toBe(true);
    expect(validation.questions?.[0].reason).toBe('DISLIKE_CONFIRMATION');

    // Réponse de confirmation par l'utilisateur
    const answerTurn = CoachConversationManager.handleQuestionAnswer('q-confirm-dislike', 'confirm_permanent', context);
    expect(answerTurn.coachResponse).toContain('enregistré de façon permanente');
  });

  // 20. Intention inconnue
  it('20. Intention inconnue — marque l intention comme UNKNOWN et demande clarification sans crash', () => {
    const context = createMockContext();
    const intent = parseIntentDeterministically("Abracadabra 123 xyz lorem ipsum", context);
    expect(intent.type).toBe('UNKNOWN');
    expect(intent.confidence).toBe('LOW');
    expect(intent.needsClarification).toBe(true);
  });

  // 21. Données insuffisantes
  it('21. Données insuffisantes — bloque l augmentation de charge si confiance insuffisante', () => {
    const context = createMockContext({
      confidence: {
        level: 'INSUFFICIENT_DATA',
        hasEnoughHistory: false,
        dataPoints: 2,
        factors: {
          hasPmcHistory: false,
          hasActualWorkouts: false,
          hasCompletedWorkouts: false,
          daysOfHistory: 2,
          consistencyScore: 0.1
        }
      }
    });

    const intent = parseIntentDeterministically("Je veux augmenter ma charge d'entraînement", context);
    const validation = validateCoachIntent(intent, { coachContext: context });
    expect(validation.valid).toBe(false);
    expect(validation.blockedReason).toBe('INSUFFICIENT_DATA');
  });

  // 22. 2 questions maximum
  it('22. 2 questions maximum — ne pose jamais plus de 2 questions de clarification', () => {
    const context = createMockContext();
    // Demande vague combinant changement d'objectif non spécifié
    const intent = parseIntentDeterministically("Mon objectif a changé", context);
    const validation = validateCoachIntent(intent, { coachContext: context });
    expect((validation.questions || []).length).toBeLessThanOrEqual(2);
  });

  // 23. Aucune question inutile
  it('23. Aucune question inutile — ne pose aucune question si l information est déjà connue', () => {
    const context = createMockContext();
    // Demande complète avec durée précise
    const turn = CoachConversationManager.processMessage("Je n'ai qu'une heure ce soir", context);
    expect(turn.questions).toBeUndefined();
    expect(turn.proposal).not.toBeNull();
  });

  // 24. JSON Gemini invalide rejeté
  it('24. JSON Gemini invalide rejeté — filtre et rejette tout payload non conforme', () => {
    const invalidPayload1 = null;
    const invalidPayload2 = "Not a JSON object";
    const invalidPayload3 = { intent: "MALICIOUS_INTENT" };

    expect(validateGeminiIntentPayload(invalidPayload1).valid).toBe(false);
    expect(validateGeminiIntentPayload(invalidPayload2).valid).toBe(false);
    expect(validateGeminiIntentPayload(invalidPayload3).valid).toBe(false);
  });

  // 25. Métrique Gemini inventée rejetée
  it('25. Métrique Gemini inventée rejetée — rejette toute tentative de Gemini de recalculer TSS ou CTL', () => {
    const inventedPayload = {
      intent: "REQUEST_MOVE_WORKOUT",
      confidence: "HIGH",
      entities: {
        targetDate: "2026-09-22",
        recalculatedTSS: 85, // Interdit !
        inventedCTL: 72      // Interdit !
      }
    };

    const res = validateGeminiIntentPayload(inventedPayload);
    expect(res.valid).toBe(false);
    expect(res.rejectionReason).toContain('Métrique interdite inventée');
  });

  // 26. Action invalide rejetée
  it('26. Action invalide rejetée — rejette le déplacement vers un jour indisponible', () => {
    const context = createMockContext({
      availability: {
        availableDays: ['monday', 'thursday'], // Mercredi indisponible !
        temporaryBlockedDates: []
      }
    });

    const intent = parseIntentDeterministically("Je veux déplacer ma séance à mercredi", context);
    const validation = validateCoachIntent(intent, { coachContext: context });
    expect(validation.valid).toBe(false);
    expect(validation.blockedReason).toBe('DAY_UNAVAILABLE');
    expect(validation.questions?.[0].options).toBeDefined();
  });

  // 27. Fatigue bloquant hausse inadaptée
  it('27. Fatigue bloquant hausse inadaptée — bloque toute hausse de charge en cas de fatigue aiguë', () => {
    const context = createMockContext({
      pmcStatus: { ctl: 50, atl: 85, tsb: -25, fatigueLevel: 'extreme' }
    });

    const intent = parseIntentDeterministically("Je veux ajouter de l'entraînement et augmenter la charge", context);
    const validation = validateCoachIntent(intent, { coachContext: context });
    expect(validation.valid).toBe(false);
    expect(validation.blockedReason).toBe('FATIGUE_TOO_HIGH');
  });

  // 28. Proposition créée sans mutation de plan
  it('28. Proposition créée sans mutation de plan — le store de planning reste intact avant validation', () => {
    const initialWorkout: PlannedWorkout = {
      id: 'w-stable',
      date: '2026-09-20',
      title: 'Séance originale',
      sport: 'Ride',
      durationMin: 90,
      targetTss: 80,
      structure: []
    };

    useAppStore.getState().setPlannedWorkouts([initialWorkout]);
    const context = createMockContext({ todayWorkout: initialWorkout });

    const turn = CoachConversationManager.processMessage("Je suis fatigué, allège", context);
    expect(turn.proposal).not.toBeNull();

    // Vérifier que le store n'a PAS été muté
    const currentWorkouts = useAppStore.getState().plannedWorkouts;
    expect(currentWorkouts[0].durationMin).toBe(90);
    expect(currentWorkouts[0].targetTss).toBe(80);
  });

  // 29. Validation appliquant la modification une seule fois
  it('29. Validation appliquant la modification une seule fois — CoachActionExecutor applique la modification après validation', () => {
    const initialWorkout: PlannedWorkout = {
      id: 'w-val',
      date: '2026-09-20',
      title: 'Séance d origine',
      sport: 'Ride',
      durationMin: 60,
      targetTss: 50,
      structure: []
    };

    useAppStore.getState().setPlannedWorkouts([initialWorkout]);

    const proposal: CoachProposal = {
      id: 'prop-test',
      action: 'REDUCE_LOAD',
      reason: 'Allègement fatigue',
      explanation: 'Explication physiologique',
      affectedWorkoutIds: ['w-val'],
      proposedModifications: [
        {
          workoutId: 'w-val',
          newDurationMin: 40,
          newTargetTss: 30
        }
      ],
      confidence: 'HIGH'
    };

    const res = CoachActionExecutor.executeProposal(proposal);
    expect(res.success).toBe(true);

    const updated = useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-val');
    expect(updated?.durationMin).toBe(40);
    expect(updated?.targetTss).toBe(30);
  });

  // 30. Refus laissant le plan intact
  it('30. Refus laissant le plan intact — refuser une proposition ne modifie pas le plan', () => {
    const initialWorkout: PlannedWorkout = {
      id: 'w-refused',
      date: '2026-09-20',
      title: 'Séance préservée',
      sport: 'Ride',
      durationMin: 70,
      targetTss: 60,
      structure: []
    };

    useAppStore.getState().setPlannedWorkouts([initialWorkout]);

    // L'athlète refuse la proposition : aucune exécution n'est appelée sur le store
    // Audit tracé en tant que REJECTED
    useAppStore.getState().addCoachDecision?.({
      id: 'dec-refused-1',
      createdAt: new Date().toISOString(),
      proposal: {
        id: 'p-ref',
        action: 'CANCEL_WORKOUT',
        reason: 'Test',
        affectedWorkoutIds: ['w-refused'],
        confidence: 'HIGH'
      },
      validationResult: { valid: true, errors: [], warnings: [] },
      userDecision: 'REJECTED'
    });

    const currentWorkouts = useAppStore.getState().plannedWorkouts;
    expect(currentWorkouts[0].durationMin).toBe(70);
    expect(currentWorkouts[0].targetTss).toBe(60);
    expect(useAppStore.getState().coachDecisions?.some(d => d.userDecision === 'REJECTED')).toBe(true);
  });

  // 31. Test supplémentaire : Délégation "Fais ce que tu penses être le mieux"
  it('31. DELEGATE_DECISION — l athlète délègue l analyse sans autoriser de mutation directe sans validation', () => {
    const context = createMockContext({
      pmcStatus: { ctl: 40, atl: 65, tsb: -18, fatigueLevel: 'high' }
    });

    const turn = CoachConversationManager.processMessage("Fais ce que tu penses être le mieux", context);
    expect(turn.parsedIntent?.type).toBe('DELEGATE_DECISION');
    expect(turn.proposal).not.toBeNull();
    // Fatigue élevée -> le coach choisit déterministement REDUCE_LOAD
    expect(turn.proposal?.action).toBe('REDUCE_LOAD');
    expect(turn.proposal?.reason).toContain('Allègement');
  });
});
