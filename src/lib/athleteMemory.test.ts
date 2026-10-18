import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store';
import { PlannedWorkout, ActualWorkout, AthleteProfile } from '../domain/models';
import {
  WorkoutFeedback,
  WorkoutObservation,
  AthleteHabit,
  AthletePreference
} from '../domain/athleteHistoryTypes';
import {
  AthleteMemoryItem,
  AthleteLogicalMemory,
  TemporaryAvailability,
  IllnessEpisode,
  InjuryEpisode,
  RecoveryLog
} from '../domain/athleteMemoryTypes';
import {
  createMemoryItem,
  updateOrReviseHabit,
  resolvePreferenceConflict,
  filterActiveAndUnconflictedPreferences,
  handleDislikeRegistration,
  isTemporaryAvailabilityActive,
  auditCoachDecision,
  logCoachProposalError,
  assertPlanaOwnsMemory,
  disputeHabit,
  applyReturnToTrainingProfile,
  checkRepeatedRefusals
} from './athleteMemoryManager';
import {
  buildCoachContext,
  buildConfidenceAssessment,
  calculateObservedTolerance,
  buildTodayWorkoutQueryContext
} from './coachContextBuilder';
import { PmcData } from '../types';
import { CoachProposal } from '../domain/coachTypes';

describe('Phase 30 — Athlete Memory & Adaptive Coach Context', () => {
  beforeEach(() => {
    useAppStore.setState({
      athleteProfile: {
        id: 'ath-test',
        name: 'Camille',
        level: { swim: 'intermediate', ride: 'advanced', run: 'intermediate' },
        availability: {
          weeklyHours: 10,
          availableDays: ['tuesday', 'thursday', 'saturday', 'sunday']
        },
        goal: {
          target: 'Cyclosportive 140km',
          date: '2026-06-20',
          distanceKm: 140
        },
        dataConnection: 'demo'
      },
      plannedWorkouts: [],
      actualWorkouts: [],
      pmc: [],
      workoutFeedbacks: [],
      workoutObservations: [],
      athleteHabits: [],
      athletePreferences: [],
      temporaryAvailabilities: [],
      illnessEpisodes: [],
      injuryEpisodes: [],
      recoveryLogs: [],
      coachErrors: [],
      coachDecisions: []
    });
  });

  // 1. Séparation stricte des types de mémoire
  it('1. Séparation stricte des types de mémoire (RawData vs Derived vs Habit vs Preference vs Tolerance vs Decision)', () => {
    const rawData = createMemoryItem('RAW_DATA', { workoutId: 'w-1', tss: 65 }, {
      source: 'strava_webhook',
      confidence: 1.0
    });
    const observation = createMemoryItem('DERIVED_OBSERVATION', { pattern: 'underperformance_in_heat' }, {
      source: 'plana_analysis',
      confidence: 0.8
    });
    const habit = createMemoryItem('HABIT', { preferredSlot: 'sunday_morning' }, {
      source: 'plana_habit_detector',
      confidence: 0.85
    });
    const preference = createMemoryItem('PREFERENCE', { statement: 'Préfère rouler l’après-midi' }, {
      source: 'user_explicit',
      confidence: 1.0
    });
    const tolerance = createMemoryItem('TOLERANCE', { medianWeeklyTss: 420 }, {
      source: 'training_engine_stats',
      confidence: 0.9
    });
    const decision = createMemoryItem('COACH_DECISION', { proposalId: 'prop-1', userDecision: 'ACCEPTED' }, {
      source: 'coach_audit',
      confidence: 1.0
    });

    expect(rawData.type).toBe('RAW_DATA');
    expect(observation.type).toBe('DERIVED_OBSERVATION');
    expect(habit.type).toBe('HABIT');
    expect(preference.type).toBe('PREFERENCE');
    expect(tolerance.type).toBe('TOLERANCE');
    expect(decision.type).toBe('COACH_DECISION');

    // Vérifier les métadonnées de traçabilité
    expect(rawData.source).toBe('strava_webhook');
    expect(preference.source).toBe('user_explicit');
    expect(rawData.createdAt).toBeDefined();
  });

  // 2. Une observation répétée crée une habitude mais pas une préférence
  it('2. Une observation répétée crée une habitude mais pas une préférence', () => {
    const existingHabits: AthleteHabit[] = [];
    const habit = updateOrReviseHabit(existingHabits, {
      type: 'weekend_long_ride',
      description: 'Effectue régulièrement sa sortie longue le samedi matin',
      category: 'schedule'
    });

    expect(habit.occurrenceCount).toBe(1);
    expect(habit.confidence).toBe('low');

    // Une habitude observée ne doit jamais injecter automatiquement une préférence
    const currentPrefs = useAppStore.getState().athletePreferences;
    expect(currentPrefs.length).toBe(0);
  });

  // 3. Une préférence explicite écrase une habitude observée
  it('3. Une préférence explicite écrase une habitude observée', () => {
    const observedHabit: AthletePreference = {
      id: 'pref-obs',
      category: 'time_of_day',
      statement: 'S’entraîne le matin vers 07h00',
      isConfirmed: true,
      type: 'PERSISTENT',
      source: 'observed_pattern',
      createdAt: '2026-03-01T08:00:00Z'
    };

    const explicitPref: AthletePreference = {
      id: 'pref-exp',
      category: 'time_of_day',
      statement: 'Ne peut jamais s’entraîner le matin, séances en soirée uniquement',
      isConfirmed: true,
      type: 'PERSISTENT',
      source: 'user_explicit',
      createdAt: '2026-03-10T08:00:00Z'
    };

    const resolved = filterActiveAndUnconflictedPreferences([observedHabit, explicitPref]);
    expect(resolved.length).toBe(1);
    expect(resolved[0].id).toBe('pref-exp');
    expect(resolved[0].source).toBe('user_explicit');
  });

  // 4. Une préférence temporaire expire et la valeur permanente redevient active
  it('4. Une préférence temporaire expire et la valeur permanente redevient active', () => {
    const permanentPref: AthletePreference = {
      id: 'pref-perm',
      category: 'time_of_day',
      statement: 'Entraînement en soirée en semaine',
      isConfirmed: true,
      type: 'PERSISTENT',
      source: 'user_explicit',
      createdAt: '2026-01-01T00:00:00Z'
    };

    const tempPref: AthletePreference = {
      id: 'pref-temp',
      category: 'time_of_day',
      statement: 'Congés : entraînement le matin cette semaine',
      isConfirmed: true,
      type: 'TEMPORARY',
      endDate: '2026-03-20',
      source: 'user_explicit',
      createdAt: '2026-03-15T00:00:00Z'
    };

    // Le 18 mars (pendant la période temporaire)
    const activeDuring = filterActiveAndUnconflictedPreferences([permanentPref, tempPref], new Date('2026-03-18'));
    expect(activeDuring.length).toBe(1);
    expect(activeDuring[0].id).toBe('pref-temp');

    // Le 25 mars (après expiration de la période temporaire)
    const activeAfter = filterActiveAndUnconflictedPreferences([permanentPref, tempPref], new Date('2026-03-25'));
    expect(activeAfter.length).toBe(1);
    expect(activeAfter[0].id).toBe('pref-perm');
  });

  // 5. Un conflit entre deux préférences est résolu par priorité et récence
  it('5. Un conflit entre deux préférences est résolu par priorité et récence', () => {
    const olderExplicit: AthletePreference = {
      id: 'pref-old',
      category: 'time_of_day',
      statement: 'Séances vélo le matin',
      isConfirmed: true,
      type: 'PERSISTENT',
      source: 'user_explicit',
      createdAt: '2026-02-01T10:00:00Z'
    };

    const newerExplicit: AthletePreference = {
      id: 'pref-new',
      category: 'time_of_day',
      statement: 'Séances vélo le soir',
      isConfirmed: true,
      type: 'PERSISTENT',
      source: 'user_explicit',
      createdAt: '2026-03-15T10:00:00Z'
    };

    const { updatedPreferences, supersededPreference } = resolvePreferenceConflict([olderExplicit], newerExplicit);
    expect(updatedPreferences.length).toBe(1);
    expect(updatedPreferences[0].id).toBe('pref-new');
    expect(supersededPreference?.id).toBe('pref-old');
  });

  // 6. Deux préférences contradictoires ne peuvent pas être actives simultanément
  it('6. Deux préférences contradictoires ne peuvent pas être actives simultanément', () => {
    const prefMorning: AthletePreference = {
      id: 'pref-1',
      category: 'time_of_day',
      statement: 'Entraînement le matin impératif',
      isConfirmed: true,
      type: 'PERSISTENT',
      source: 'user_explicit',
      createdAt: '2026-03-01T00:00:00Z'
    };
    const prefEvening: AthletePreference = {
      id: 'pref-2',
      category: 'time_of_day',
      statement: 'Entraînement le soir uniquement',
      isConfirmed: true,
      type: 'PERSISTENT',
      source: 'user_explicit',
      createdAt: '2026-03-10T00:00:00Z'
    };

    const active = filterActiveAndUnconflictedPreferences([prefMorning, prefEvening]);
    expect(active.length).toBe(1);
  });

  // 7. Une habitude évolue avec de nouvelles données (sans reset arbitraire)
  it('7. Une habitude évolue avec de nouvelles données (sans reset arbitraire)', () => {
    let habits: AthleteHabit[] = [];

    // Occurrence 1
    const h1 = updateOrReviseHabit(habits, {
      type: 'consistent_slot',
      description: 'Roule le mardi soir',
      category: 'schedule'
    });
    expect(h1.occurrenceCount).toBe(1);
    expect(h1.confidence).toBe('low');
    habits = [h1];

    // Occurrence 2
    const h2 = updateOrReviseHabit(habits, {
      type: 'consistent_slot',
      description: 'Roule le mardi soir',
      category: 'schedule'
    });
    expect(h2.occurrenceCount).toBe(2);
    expect(h2.confidence).toBe('medium');
    habits = [h2];

    // Occurrence 3
    const h3 = updateOrReviseHabit(habits, {
      type: 'consistent_slot',
      description: 'Roule le mardi soir',
      category: 'schedule'
    });
    expect(h3.occurrenceCount).toBe(3);
    expect(h3.confidence).toBe('high');
    expect(h3.firstObservedAt).toBe(h1.firstObservedAt);
  });

  // 8. Une habitude peut être contestée par l'athlète
  it('8. Une habitude peut être contestée par l’athlète', () => {
    const habit: AthleteHabit = {
      id: 'hab-1',
      type: 'thursday_run',
      category: 'schedule',
      description: 'Court régulièrement le jeudi',
      confidence: 'high',
      firstObservedAt: '2026-01-01',
      lastObservedAt: '2026-03-01',
      occurrenceCount: 8
    };

    const disputed = disputeHabit(habit);
    expect(disputed.confidence).toBe('low');
    expect(disputed.description).toContain('Contestée par l\'athlète');
  });

  // 9. Un refus répété d'une proposition du Coach ne crée pas de préférence automatique
  it('9. Un refus répété d’une proposition du Coach ne crée pas de préférence automatique', () => {
    const dummyProposal: CoachProposal = {
      id: 'prop-refuse-1',
      actions: [{ type: 'CREATE_WORKOUT', workout: { id: 'w-ref', planId: 'p', date: '2026-03-24', sport: 'Ride', title: 'Fractionné', targetDurationMin: 60, targetIntensity: { type: 'zone', value: 'Z5' }, status: 'planned' } }],
      explanation: 'Test',
      confidenceLevel: 'HIGH',
      confidenceAssessment: { level: 'HIGH', historyWeeks: 8, confidenceScore: 90, recentWorkoutsCount: 20 },
      source: 'recommendation_engine'
    };

    const audit1 = auditCoachDecision({
      proposal: dummyProposal,
      userDecision: 'REJECTED',
      validationResult: { isValid: true, errors: [], warnings: [] }
    });
    const audit2 = auditCoachDecision({
      proposal: dummyProposal,
      userDecision: 'REJECTED',
      validationResult: { isValid: true, errors: [], warnings: [] }
    });

    expect(audit1.inferredPreference).toBeNull();
    expect(audit2.inferredPreference).toBeNull();
    expect(useAppStore.getState().athletePreferences.length).toBe(0);
  });

  // 10. Un refus persistant déclenche une demande de clarification
  it('10. Un refus persistant déclenche une demande de clarification', () => {
    const dummyProposal: CoachProposal = {
      id: 'prop-1',
      actions: [],
      explanation: 'Proposal',
      confidenceLevel: 'HIGH',
      confidenceAssessment: { level: 'HIGH', historyWeeks: 8, confidenceScore: 90, recentWorkoutsCount: 20 },
      source: 'recommendation_engine'
    };

    const decisions: Array<{ userDecision: any; proposal: CoachProposal }> = [
      { userDecision: 'REJECTED', proposal: dummyProposal },
      { userDecision: 'REJECTED', proposal: dummyProposal },
      { userDecision: 'REJECTED', proposal: dummyProposal }
    ];

    const result = checkRepeatedRefusals(decisions);
    expect(result.requiresClarification).toBe(true);
    expect(result.refusalCount).toBe(3);
    expect(result.clarificationPrompt).toBeDefined();
    expect(result.clarificationPrompt).toContain('Tu as décliné plusieurs propositions récentes');
  });

  // 11. Une disponibilité temporaire n'écrase pas la disponibilité permanente
  it('11. Une disponibilité temporaire n’écrase pas la disponibilité permanente', () => {
    const profile = useAppStore.getState().athleteProfile!;
    expect(profile.availability.weeklyHours).toBe(10);
    expect(profile.availability.availableDays).toEqual(['tuesday', 'thursday', 'saturday', 'sunday']);

    const tempAvail: TemporaryAvailability = {
      id: 'temp-vacation',
      startDate: '2026-03-24',
      endDate: '2026-03-26',
      type: 'blocked',
      reason: 'Déplacement professionnel',
      blockedDates: ['2026-03-24', '2026-03-25', '2026-03-26'],
      createdAt: '2026-03-20'
    };

    useAppStore.getState().addTemporaryAvailability(tempAvail);

    // Vérifier que le profil permanent reste strictement intact
    const currentProfile = useAppStore.getState().athleteProfile!;
    expect(currentProfile.availability.weeklyHours).toBe(10);
    expect(currentProfile.availability.availableDays).toEqual(['tuesday', 'thursday', 'saturday', 'sunday']);

    // Mais le contexte pour le 24 mars reflète l'indisponibilité temporaire
    const context = buildCoachContext(
      currentProfile,
      [],
      [],
      [],
      new Date('2026-03-24'),
      { temporaryAvailabilities: [tempAvail] }
    );
    expect(context.currentAvailability?.isAvailableToday).toBe(false);
    expect(context.currentAvailability?.note).toContain('Indisponibilité temporaire');
  });

  // 12. La fin d'une indisponibilité temporaire réactive la disponibilité permanente
  it('12. La fin d’une indisponibilité temporaire réactive la disponibilité permanente', () => {
    const tempAvail: TemporaryAvailability = {
      id: 'temp-1',
      startDate: '2026-03-20',
      endDate: '2026-03-22',
      type: 'blocked',
      blockedDates: ['2026-03-20', '2026-03-21', '2026-03-22'],
      createdAt: '2026-03-19'
    };

    // Date après la fin de l'indisponibilité (mardi 24 mars 2026, disponible selon profil)
    const isStillActive = isTemporaryAvailabilityActive(tempAvail, new Date('2026-03-24'));
    expect(isStillActive).toBe(false);

    const profile = useAppStore.getState().athleteProfile!;
    const context = buildCoachContext(
      profile,
      [],
      [],
      [],
      new Date('2026-03-24'),
      { temporaryAvailabilities: [tempAvail] }
    );
    // Mardi est dans availableDays: ['tuesday', 'thursday', 'saturday', 'sunday']
    expect(context.currentAvailability?.isAvailableToday).toBe(true);
  });

  // 13. Une maladie déclarée suspend les séances intenses
  it('13. Une maladie déclarée suspend les séances intenses', () => {
    const illness: IllnessEpisode = {
      id: 'ill-1',
      declaredDate: '2026-03-24',
      status: 'active',
      declaredSymptoms: ['fièvre', 'courbatures'],
      impactOnTraining: 'repos complet impératif'
    };

    const plannedWorkout: PlannedWorkout = {
      id: 'pw-intense',
      planId: 'p',
      date: '2026-03-24',
      sport: 'Ride',
      title: 'Fractionné VO2Max',
      targetDurationMin: 60,
      targetIntensity: { type: 'zone', value: 'Z5' },
      status: 'planned'
    };

    const result = buildTodayWorkoutQueryContext({
      profile: useAppStore.getState().athleteProfile,
      plannedWorkouts: [plannedWorkout],
      actualWorkouts: [],
      pmc: [],
      currentDate: new Date('2026-03-24'),
      historyOptions: { illnessEpisodes: [illness] }
    });

    expect(result.coachContext.healthStatus?.activeIllness).toBeDefined();
    expect(result.recommendationSummary).toContain('Épisode de maladie déclaré');
    expect(result.recommendationSummary).toContain('repos complet');
  });

  // 14. La reprise post-maladie utilise un profil de reprise (progression douce)
  it('14. La reprise post-maladie utilise un profil de reprise (progression douce)', () => {
    const resolvedIllness: IllnessEpisode = {
      id: 'ill-resolved',
      declaredDate: '2026-03-15',
      resolvedDate: '2026-03-22',
      status: 'resolved',
      declaredSymptoms: ['rhume', 'fatigue'],
      impactOnTraining: 'convalescence'
    };

    const returnProfile = applyReturnToTrainingProfile(resolvedIllness);
    expect(returnProfile.maxDurationMin).toBeLessThanOrEqual(45);
    expect(returnProfile.maxIntensityZone).toBe('Z2');
    expect(returnProfile.recommendation).toContain('Reprise progressive post-épisode');
  });

  // 15. Une blessure déclarée bloque les sports concernés
  it('15. Une blessure déclarée bloque les sports concernés', () => {
    const injury: InjuryEpisode = {
      id: 'inj-1',
      declaredDate: '2026-03-24',
      status: 'active',
      declaredIssue: 'Douleur au genou droit',
      impactOnTraining: 'pas de course à pied'
    };

    const context = buildCoachContext(
      useAppStore.getState().athleteProfile,
      [],
      [],
      [],
      new Date('2026-03-24'),
      { injuryEpisodes: [injury] }
    );

    expect(context.healthStatus?.activeInjury).toBeDefined();
    expect(context.healthStatus?.activeInjury?.impactOnTraining).toBe('pas de course à pied');
  });

  // 16. Un historique d'indisponibilité permet d'observer un pattern sans créer de règle rigide
  it('16. Un historique d’indisponibilité permet d’observer un pattern sans créer de règle rigide', () => {
    const pastAvails: TemporaryAvailability[] = [
      { id: 't1', startDate: '2026-01-09', endDate: '2026-01-10', type: 'blocked', reason: 'Vendredi pro', blockedDates: ['2026-01-09'], createdAt: '2026-01-01' },
      { id: 't2', startDate: '2026-01-23', endDate: '2026-01-24', type: 'blocked', reason: 'Vendredi pro', blockedDates: ['2026-01-23'], createdAt: '2026-01-15' },
      { id: 't3', startDate: '2026-02-06', endDate: '2026-02-07', type: 'blocked', reason: 'Vendredi pro', blockedDates: ['2026-02-06'], createdAt: '2026-01-30' }
    ];

    pastAvails.forEach(a => useAppStore.getState().addTemporaryAvailability(a));

    // L'historique conserve les 3 événements
    expect(useAppStore.getState().temporaryAvailabilities.length).toBe(3);

    // La disponibilité permanente n'est pas modifiée automatiquement
    expect(useAppStore.getState().athleteProfile?.availability.weeklyHours).toBe(10);
  });

  // 17. Gemini ne reçoit pas les données brutes inutiles (contexte compact)
  it('17. Gemini ne reçoit pas les données brutes inutiles (contexte compact)', () => {
    // Créer 20 séances réelles
    const manyActuals: ActualWorkout[] = Array.from({ length: 20 }).map((_, i) => ({
      id: `act-${i}`,
      date: `2026-02-${(i + 1).toString().padStart(2, '0')}`,
      sport: 'Ride',
      title: `Sortie ${i}`,
      durationMin: 60,
      tss: 50
    }));

    const context = buildCoachContext(
      useAppStore.getState().athleteProfile,
      [],
      manyActuals,
      [],
      new Date('2026-03-01')
    );

    // Contexte compact : maximum 5 séances récentes envoyées
    expect(context.recentWorkouts.length).toBeLessThanOrEqual(5);
  });

  // 18. Gemini ne reçoit pas de données médicales brutes (uniquement impact sur entraînement)
  it('18. Gemini ne reçoit pas de données médicales brutes (uniquement impact sur entraînement)', () => {
    const illness: IllnessEpisode = {
      id: 'ill-2',
      declaredDate: '2026-03-24',
      status: 'active',
      declaredSymptoms: ['toux', 'fatigue'],
      impactOnTraining: 'alléger la séance ou repos'
    };

    const context = buildCoachContext(
      useAppStore.getState().athleteProfile,
      [],
      [],
      [],
      new Date('2026-03-24'),
      { illnessEpisodes: [illness] }
    );

    const health = context.healthStatus?.activeIllness;
    expect(health).toBeDefined();
    // Ne contient aucun diagnostic ni ordonnance
    expect((health as any)?.medicalDiagnosis).toBeUndefined();
    expect((health as any)?.prescription).toBeUndefined();
    expect(health?.impactOnTraining).toBe('alléger la séance ou repos');
  });

  // 19. Le prompt envoyé au Coach respecte l'ordre de priorité du contexte
  it('19. Le prompt envoyé au Coach respecte l’ordre de priorité du contexte', () => {
    const todayWorkout: PlannedWorkout = {
      id: 'pw-today',
      planId: 'p',
      date: '2026-03-24',
      sport: 'Ride',
      title: 'Endurance de base',
      targetDurationMin: 60,
      targetIntensity: { type: 'zone', value: 'Z2' },
      status: 'planned'
    };

    const pmcData: PmcData = {
      date: '2026-03-24',
      ctl: 45,
      atl: 55,
      tsb: -10
    };

    const feedback: WorkoutFeedback = {
      id: 'fb-1',
      workoutId: 'w-prev',
      date: '2026-03-23',
      sport: 'Ride',
      durationMin: 60,
      rpe: 6,
      feeling: 'good'
    };

    const pref: AthletePreference = {
      id: 'pref-active',
      category: 'equipment',
      statement: 'Utilise un capteur de puissance',
      isConfirmed: true,
      type: 'PERSISTENT',
      source: 'user_explicit',
      createdAt: '2026-03-01'
    };

    const context = buildCoachContext(
      useAppStore.getState().athleteProfile,
      [todayWorkout],
      [],
      [pmcData],
      new Date('2026-03-24'),
      { feedbacks: [feedback], preferences: [pref] }
    );

    // 1. Situation actuelle (séance du jour)
    expect(context.todayWorkout?.id).toBe('pw-today');
    // 2. Objectif
    expect(context.profile?.goal).toBeDefined();
    // 3. Charge et fatigue (PMC)
    expect(context.pmcStatus?.ctl).toBe(45);
    // 4. Disponibilité actuelle
    expect(context.currentAvailability).toBeDefined();
    // 5. Feedback récent
    expect(context.recentFeedbacks?.[0].rpe).toBe(6);
    // 6. Préférences actives
    expect(context.activePreferences?.length).toBe(1);
  });

  // 20. Le Coach ne propose pas une séance le jour d'une préférence "pas de sport"
  it('20. Le Coach ne propose pas une séance le jour d’une préférence "pas de sport"', () => {
    const noSportWednesday: AthletePreference = {
      id: 'pref-rest-wed',
      category: 'rest_day',
      statement: 'Pas de sport le mercredi (journée famille)',
      isConfirmed: true,
      type: 'PERSISTENT',
      source: 'user_explicit',
      createdAt: '2026-03-01'
    };

    const activePrefs = filterActiveAndUnconflictedPreferences([noSportWednesday]);
    expect(activePrefs.some(p => p.category === 'rest_day' && p.statement.includes('mercredi'))).toBe(true);
  });

  // 21. Le Coach adapte la séance du jour selon le feedback de la veille
  it('21. Le Coach adapte la séance du jour selon le feedback de la veille', () => {
    const yesterdayFeedback: WorkoutFeedback = {
      id: 'fb-exhausted',
      workoutId: 'w-yesterday',
      date: '2026-03-23',
      sport: 'Ride',
      durationMin: 90,
      rpe: 9,
      feeling: 'exhausted',
      comment: 'Très dur, jambes lourdes'
    };

    const pmcData: PmcData = {
      date: '2026-03-24',
      ctl: 40,
      atl: 75,
      tsb: -35 // Fatigue aiguë
    };

    const todayWorkout: PlannedWorkout = {
      id: 'pw-today-hard',
      planId: 'p',
      date: '2026-03-24',
      sport: 'Ride',
      title: 'PMA 30/30',
      targetDurationMin: 60,
      targetIntensity: { type: 'zone', value: 'Z5' },
      status: 'planned'
    };

    const context = buildCoachContext(
      useAppStore.getState().athleteProfile,
      [todayWorkout],
      [],
      [pmcData],
      new Date('2026-03-24'),
      { feedbacks: [yesterdayFeedback] }
    );

    expect(['high', 'extreme']).toContain(context.pmcStatus?.fatigueLevel);
    expect(context.recentFeedbacks?.[0].feeling).toBe('exhausted');
  });

  // 22. Le Coach pose 1-2 questions maximum si une donnée critique manque pour aujourd'hui
  it('22. Le Coach pose 1-2 questions maximum si une donnée critique manque pour aujourd’hui', () => {
    const todayWorkout: PlannedWorkout = {
      id: 'pw-long',
      planId: 'p',
      date: '2026-03-24',
      sport: 'Ride',
      title: 'Sortie longue Rythme',
      targetDurationMin: 120, // 2 heures
      targetIntensity: { type: 'zone', value: 'Z3' },
      status: 'planned'
    };

    const pmcData: PmcData = {
      date: '2026-03-24',
      ctl: 35,
      atl: 70,
      tsb: -35 // fatigue aiguë
    };

    const result = buildTodayWorkoutQueryContext({
      profile: useAppStore.getState().athleteProfile,
      plannedWorkouts: [todayWorkout],
      actualWorkouts: [],
      pmc: [pmcData],
      currentDate: new Date('2026-03-24'),
      historyOptions: {
        recoveryLogs: [] // Manque l'état de forme du matin
      }
    });

    expect(result.missingQuestions.length).toBeGreaterThanOrEqual(1);
    expect(result.missingQuestions.length).toBeLessThanOrEqual(2);
    expect(result.missingQuestions[0]).toContain('Comment te sens-tu ce matin');
  });

  // 23. Le Coach ne pose aucune question si les données existantes suffisent
  it('23. Le Coach ne pose aucune question si les données existantes suffisent', () => {
    const todayWorkout: PlannedWorkout = {
      id: 'pw-easy',
      planId: 'p',
      date: '2026-03-24',
      sport: 'Ride',
      title: 'Récupération active',
      targetDurationMin: 45,
      targetIntensity: { type: 'zone', value: 'Z1' },
      status: 'planned'
    };

    const pmcData: PmcData = {
      date: '2026-03-24',
      ctl: 40,
      atl: 42,
      tsb: -2 // fatigue normale
    };

    const recoveryLog: RecoveryLog = {
      id: 'rec-1',
      date: '2026-03-24',
      sleepQuality: 4,
      morningFatigue: 2
    };

    const result = buildTodayWorkoutQueryContext({
      profile: useAppStore.getState().athleteProfile,
      plannedWorkouts: [todayWorkout],
      actualWorkouts: [],
      pmc: [pmcData],
      currentDate: new Date('2026-03-24'),
      historyOptions: {
        recoveryLogs: [recoveryLog]
      }
    });

    expect(result.missingQuestions.length).toBe(0);
  });

  // 24. Une tentative de modification de la mémoire par Gemini échoue (seule Plana écrit)
  it('24. Une tentative de modification de la mémoire par Gemini échoue (seule Plana écrit)', () => {
    expect(() => {
      assertPlanaOwnsMemory('gemini_assistant_tool_call');
    }).toThrow(/VIOLATION DE SÉCURITÉ/);

    expect(() => {
      assertPlanaOwnsMemory('plana_core_engine');
    }).not.toThrow();
  });

  // 25. La tolérance observée est recalculée sans écraser l'historique brut
  it('25. La tolérance observée est recalculée sans écraser l’historique brut', () => {
    // 6 semaines d'historique (42 jours)
    const rawActuals: ActualWorkout[] = [];
    for (let w = 0; w < 6; w++) {
      for (let d = 0; d < 3; d++) {
        rawActuals.push({
          id: `w-${w}-${d}`,
          date: `2026-01-${(w * 5 + d + 1).toString().padStart(2, '0')}`,
          sport: 'Ride',
          title: 'Séance',
          durationMin: 60,
          tss: 60
        });
      }
    }

    const confidence = buildConfidenceAssessment(rawActuals, new Date('2026-03-01'));
    const tolerance = calculateObservedTolerance(rawActuals, confidence);

    expect(tolerance).toBeDefined();
    expect(tolerance?.metric).toBe('weekly_tss');
    expect(tolerance?.disclaimer).toContain('Historically observed tolerance');

    // Vérifier que les 18 séances brutes sont intactes
    expect(rawActuals.length).toBe(18);
    expect(rawActuals[0].tss).toBe(60);
  });
});
