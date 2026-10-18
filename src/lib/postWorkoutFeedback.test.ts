import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store';
import { PlannedWorkout, ActualWorkout } from '../domain/models';
import { WorkoutFeedback, WorkoutObservation, AthletePreference } from '../domain/athleteHistoryTypes';
import {
  analyzeWorkoutExecution,
  detectAthleteHabits,
  registerPreference,
  registerDislikePreference,
  filterActivePreferences,
  calculateSimilarWorkoutsStat
} from './postWorkoutAnalysis';
import { buildCoachContext, buildConfidenceAssessment } from './coachContextBuilder';
import { CoachActionExecutor } from './coachActionExecutor';
import { validateCoachProposal } from './coachActionValidator';
import { CoachProposal } from '../domain/coachTypes';

describe('Phase 29 — Post-Workout Feedback & Athlete History', () => {
  beforeEach(() => {
    useAppStore.setState({
      athleteProfile: {
        id: 'ath-1',
        name: 'Alex',
        level: {
          swim: 'intermediate',
          ride: 'intermediate',
          run: 'intermediate'
        },
        availability: {
          weeklyHours: 8,
          availableDays: ['tuesday', 'thursday', 'saturday', 'sunday']
        },
        dataConnection: 'demo'
      },
      plannedWorkouts: [
        {
          id: 'pw-1',
          planId: 'plan-101',
          date: '2026-03-24',
          sport: 'Ride',
          title: 'Sortie Z2 Endurance',
          targetDurationMin: 60,
          targetIntensity: { type: 'zone', value: 'Z2' },
          targetTss: 45,
          status: 'planned'
        },
        {
          id: 'pw-2',
          planId: 'plan-101',
          date: '2026-03-25',
          sport: 'Run',
          title: 'Fractionné PMA',
          targetDurationMin: 50,
          targetIntensity: { type: 'zone', value: 'Z5' },
          targetTss: 75,
          status: 'planned'
        }
      ],
      actualWorkouts: [
        {
          id: 'aw-1',
          source: 'manual',
          sport: 'Ride',
          date: '2026-03-24',
          startTime: '2026-03-24T08:00:00Z',
          durationMin: 60,
          plannedWorkoutId: 'pw-1',
          tss: 45
        }
      ],
      workoutFeedbacks: [],
      workoutObservations: [],
      athleteHabits: [],
      athletePreferences: [],
      coachDecisions: [],
      pmc: []
    });
  });

  // 1. RPE correctement associé à une séance
  it('1. RPE correctement associé à une séance', () => {
    const store = useAppStore.getState();
    const feedback: WorkoutFeedback = {
      id: 'fb-1',
      workoutId: 'pw-1',
      actualWorkoutId: 'aw-1',
      date: '2026-03-24',
      sport: 'Ride',
      durationMin: 60,
      rpe: 4,
      createdAt: '2026-03-24T09:30:00Z'
    };

    store.addWorkoutFeedback(feedback);

    const updated = useAppStore.getState();
    expect(updated.workoutFeedbacks).toHaveLength(1);
    expect(updated.workoutFeedbacks[0].rpe).toBe(4);
    expect(updated.workoutFeedbacks[0].workoutId).toBe('pw-1');
    expect(updated.workoutFeedbacks[0].actualWorkoutId).toBe('aw-1');
  });

  // 2. feedback sans commentaire accepté
  it('2. feedback sans commentaire accepté', () => {
    const store = useAppStore.getState();
    const feedback: WorkoutFeedback = {
      id: 'fb-2',
      actualWorkoutId: 'aw-1',
      date: '2026-03-24',
      sport: 'Ride',
      durationMin: 60,
      rpe: 2,
      feeling: 'good',
      createdAt: '2026-03-24T09:30:00Z'
      // comment is undefined
    };

    expect(() => store.addWorkoutFeedback(feedback)).not.toThrow();
    expect(useAppStore.getState().workoutFeedbacks[0].comment).toBeUndefined();
    expect(useAppStore.getState().workoutFeedbacks[0].rpe).toBe(2);
  });

  // 3. commentaire libre correctement stocké
  it('3. commentaire libre correctement stocké', () => {
    const store = useAppStore.getState();
    const commentText = "Jambes un peu lourdes sur la première bosse, mais bon cardio ensuite.";
    const feedback: WorkoutFeedback = {
      id: 'fb-3',
      actualWorkoutId: 'aw-1',
      date: '2026-03-24',
      sport: 'Ride',
      durationMin: 60,
      rpe: 3,
      comment: commentText,
      createdAt: '2026-03-24T09:30:00Z'
    };

    store.addWorkoutFeedback(feedback);
    expect(useAppStore.getState().workoutFeedbacks[0].comment).toBe(commentText);
  });

  // 4. planned vs actual correctement comparé
  it('4. planned vs actual correctement comparé', () => {
    const planned: PlannedWorkout = {
      id: 'pw-test',
      planId: 'plan-1',
      sport: 'Ride',
      title: 'Endurance',
      date: '2026-03-20',
      targetDurationMin: 60,
      targetIntensity: { type: 'zone', value: 'Z2' },
      status: 'planned'
    };

    const actualLong: ActualWorkout = {
      id: 'aw-long',
      source: 'demo',
      sport: 'Ride',
      date: '2026-03-20',
      startTime: '2026-03-20T08:00:00Z',
      durationMin: 85 // +25 min, > 1.15
    };

    const observations = analyzeWorkoutExecution({
      plannedWorkout: planned,
      actualWorkout: actualLong
    });

    const durObs = observations.find(o => o.type === 'DURATION_LONGER_THAN_PLANNED');
    expect(durObs).toBeDefined();
    expect(durObs?.metricsComparison?.plannedDuration).toBe(60);
    expect(durObs?.metricsComparison?.actualDuration).toBe(85);
  });

  // 5. observation créée sans diagnostic
  it('5. observation créée sans diagnostic médical', () => {
    const planned: PlannedWorkout = {
      id: 'pw-light',
      planId: 'plan-1',
      sport: 'Ride',
      title: 'Récupération Active Z1',
      date: '2026-03-20',
      targetDurationMin: 45,
      targetIntensity: { type: 'zone', value: 'Z1' },
      status: 'planned'
    };

    const actual: ActualWorkout = {
      id: 'aw-light',
      source: 'demo',
      sport: 'Ride',
      date: '2026-03-20',
      startTime: '2026-03-20T08:00:00Z',
      durationMin: 45
    };

    const feedback: WorkoutFeedback = {
      id: 'fb-hard',
      actualWorkoutId: 'aw-light',
      date: '2026-03-20',
      sport: 'Ride',
      durationMin: 45,
      rpe: 5,
      feeling: 'very_tired',
      createdAt: '2026-03-20T09:00:00Z'
    };

    const observations = analyzeWorkoutExecution({ plannedWorkout: planned, actualWorkout: actual, feedback });

    // Vérifier l'absence absolue de vocabulaire médical diagnostique
    const prohibitedTerms = ['surentraîné', 'malade', 'pathologie', 'burnout', 'diagnostic médical', 'syndrome'];
    observations.forEach(obs => {
      const fullText = (obs.title + ' ' + obs.description).toLowerCase();
      prohibitedTerms.forEach(term => {
        expect(fullText).not.toContain(term);
      });
    });

    // Constater l'observation factuelle de ressenti élevé
    expect(observations.some(o => o.type === 'HIGH_PERCEIVED_EFFORT')).toBe(true);
  });

  // 6. une seule séance ne crée pas une habitude
  it('6. une seule séance ne crée pas une habitude', () => {
    const singleObs: WorkoutObservation[] = [
      {
        id: 'obs-1',
        actualWorkoutId: 'aw-1',
        date: '2026-03-20',
        type: 'HIGH_PERCEIVED_EFFORT',
        title: 'Ressenti élevé sur charge modérée',
        description: 'Effort perçu 4/5',
        createdAt: '2026-03-20T09:00:00Z'
      }
    ];

    const habits = detectAthleteHabits(singleObs);
    expect(habits).toHaveLength(0); // Règle stricte: 1 seule occurrence n'est jamais une habitude
  });

  // 7. plusieurs observations cohérentes peuvent créer une habitude
  it('7. plusieurs observations cohérentes peuvent créer une habitude', () => {
    const recurringObs: WorkoutObservation[] = [
      {
        id: 'obs-1',
        actualWorkoutId: 'aw-1',
        date: '2026-03-10',
        type: 'HIGH_PERCEIVED_EFFORT',
        title: 'Ressenti élevé',
        description: 'Effort perçu 4/5',
        createdAt: '2026-03-10T09:00:00Z'
      },
      {
        id: 'obs-2',
        actualWorkoutId: 'aw-2',
        date: '2026-03-15',
        type: 'HIGH_PERCEIVED_EFFORT',
        title: 'Ressenti élevé',
        description: 'Effort perçu 5/5',
        createdAt: '2026-03-15T09:00:00Z'
      },
      {
        id: 'obs-3',
        actualWorkoutId: 'aw-3',
        date: '2026-03-20',
        type: 'HIGH_PERCEIVED_EFFORT',
        title: 'Ressenti élevé',
        description: 'Effort perçu 4/5',
        createdAt: '2026-03-20T09:00:00Z'
      }
    ];

    const habits = detectAthleteHabits(recurringObs);
    expect(habits.length).toBeGreaterThanOrEqual(1);
    const intensityHabit = habits.find(h => h.type === 'HIGH_RPE_ON_INTENSITY');
    expect(intensityHabit).toBeDefined();
    expect(intensityHabit?.occurrenceCount).toBe(3);
    expect(intensityHabit?.confidence).toBe('HIGH');
  });

  // 8. préférence explicite correctement enregistrée
  it('8. préférence explicite correctement enregistrée', () => {
    const pref = registerPreference({
      category: 'schedule',
      statement: "Je préfère faire mes sorties longues le dimanche.",
      isConfirmed: true,
      type: 'PERSISTENT',
      source: 'user_explicit'
    });

    expect(pref.isConfirmed).toBe(true);
    expect(pref.type).toBe('PERSISTENT');
    expect(pref.category).toBe('schedule');

    useAppStore.getState().addAthletePreference(pref);
    expect(useAppStore.getState().athletePreferences).toHaveLength(1);
  });

  // 9. dislike non mémorisé sans confirmation
  it('9. dislike non mémorisé sans confirmation', () => {
    // Non confirmé -> retourne null
    const unconfirmedDislike = registerDislikePreference({
      statement: "Je n'aime pas courir sous la pluie.",
      isConfirmed: false
    });
    expect(unconfirmedDislike).toBeNull();

    // Confirmé -> créé proprement
    const confirmedDislike = registerDislikePreference({
      statement: "Je n'aime pas courir sous la pluie.",
      isConfirmed: true,
      source: 'coach_confirmed'
    });
    expect(confirmedDislike).not.toBeNull();
    expect(confirmedDislike?.category).toBe('dislike');
    expect(confirmedDislike?.isConfirmed).toBe(true);
  });

  // 10. préférence temporaire expirée correctement
  it('10. préférence temporaire expirée correctement', () => {
    const now = new Date('2026-03-25T10:00:00Z');

    const expiredPref: AthletePreference = {
      id: 'p-expired',
      category: 'sport',
      statement: "Cette semaine uniquement : pas de natation",
      isConfirmed: true,
      type: 'TEMPORARY',
      endDate: '2026-03-20',
      source: 'user_explicit',
      createdAt: '2026-03-15T00:00:00Z'
    };

    const activePref: AthletePreference = {
      id: 'p-active',
      category: 'sport',
      statement: "Cette quinzaine : privilégier le vélo",
      isConfirmed: true,
      type: 'TEMPORARY',
      endDate: '2026-03-30',
      source: 'user_explicit',
      createdAt: '2026-03-22T00:00:00Z'
    };

    const persistentPref: AthletePreference = {
      id: 'p-persistent',
      category: 'general',
      statement: "Repos complet le lundi",
      isConfirmed: true,
      type: 'PERSISTENT',
      source: 'user_explicit',
      createdAt: '2026-01-01T00:00:00Z'
    };

    const activeList = filterActivePreferences([expiredPref, activePref, persistentPref], now);
    expect(activeList.map(p => p.id)).toEqual(['p-active', 'p-persistent']);
    expect(activeList.find(p => p.id === 'p-expired')).toBeUndefined();
  });

  // 11. historique insuffisant → INSUFFICIENT_DATA
  it('11. historique insuffisant → INSUFFICIENT_DATA', () => {
    // Seulement 1 semaine d'historique
    const workouts: ActualWorkout[] = [
      {
        id: 'w-1',
        source: 'demo',
        sport: 'Ride',
        date: '2026-03-20',
        startTime: '2026-03-20T08:00:00Z',
        durationMin: 60
      }
    ];

    const assessment = buildConfidenceAssessment(workouts, new Date('2026-03-25'));
    expect(assessment.level).toBe('INSUFFICIENT_DATA');
    expect(assessment.historyWeeks).toBeLessThan(4);
  });

  // 12. données objectives absentes → aucune métrique inventée
  it('12. données objectives absentes → aucune métrique inventée', () => {
    const bareWorkout: ActualWorkout = {
      id: 'bare-1',
      source: 'manual',
      sport: 'Run',
      date: '2026-03-24',
      startTime: '2026-03-24T07:00:00Z',
      durationMin: 40
      // no hr, no power, no cadence, no temp
    };

    const observations = analyzeWorkoutExecution({ actualWorkout: bareWorkout });
    observations.forEach(obs => {
      expect(obs.metricsComparison?.temperature).toBeUndefined();
    });
  });

  // 13. température disponible → correctement contextualisée
  it('13. température disponible → correctement contextualisée', () => {
    const hotWorkout: ActualWorkout = {
      id: 'hot-1',
      source: 'Garmin',
      sport: 'Ride',
      date: '2026-03-24',
      startTime: '2026-03-24T14:00:00Z',
      durationMin: 90,
      temperature: 32 // Chaleur importante
    };

    const observations = analyzeWorkoutExecution({ actualWorkout: hotWorkout });
    const tempObs = observations.find(o => o.type === 'TEMPERATURE_CONTEXT');
    expect(tempObs).toBeDefined();
    expect(tempObs?.metricsComparison?.temperature).toBe(32);
    expect(tempObs?.description).toContain('32°C');
  });

  // 14. température absente → aucun champ inventé
  it('14. température absente → aucun champ inventé', () => {
    const normalWorkout: ActualWorkout = {
      id: 'normal-1',
      source: 'manual',
      sport: 'Ride',
      date: '2026-03-24',
      startTime: '2026-03-24T14:00:00Z',
      durationMin: 90
    };

    const observations = analyzeWorkoutExecution({ actualWorkout: normalWorkout });
    expect(observations.find(o => o.type === 'TEMPERATURE_CONTEXT')).toBeUndefined();
  });

  // 15. contexte Coach limité aux informations pertinentes
  it('15. contexte Coach limité aux informations pertinentes', () => {
    // Créer 10 feedbacks
    const manyFeedbacks: WorkoutFeedback[] = Array.from({ length: 10 }).map((_, i) => ({
      id: `fb-${i}`,
      actualWorkoutId: `aw-${i}`,
      date: `2026-03-${10 + i}`,
      sport: 'Ride',
      durationMin: 60,
      rpe: 3,
      createdAt: `2026-03-${10 + i}T10:00:00Z`
    }));

    const context = buildCoachContext(
      null,
      [],
      [],
      [],
      new Date('2026-03-25'),
      { feedbacks: manyFeedbacks }
    );

    // Le contexte consolidé doit limiter la taille pour éviter le bruit
    expect(context.recentFeedbacks?.length).toBeLessThanOrEqual(3);
  });

  // 16. feedback post-workout ne modifie jamais directement le planning
  it('16. feedback post-workout ne modifie jamais directement le planning', () => {
    const plannedBefore = JSON.stringify(useAppStore.getState().plannedWorkouts);

    // Un feedback avec RPE extrême et fatigue aiguë
    const alarmingFeedback: WorkoutFeedback = {
      id: 'fb-alarm',
      workoutId: 'pw-1',
      actualWorkoutId: 'aw-1',
      date: '2026-03-24',
      sport: 'Ride',
      durationMin: 60,
      rpe: 5,
      feeling: 'very_tired',
      comment: 'Épuisement total, incapable de tourner les jambes.',
      createdAt: '2026-03-24T10:00:00Z'
    };

    useAppStore.getState().addWorkoutFeedback(alarmingFeedback);

    const plannedAfter = JSON.stringify(useAppStore.getState().plannedWorkouts);
    // AUCUNE mutation automatique du planning
    expect(plannedAfter).toBe(plannedBefore);
  });

  // 17. séance difficile → possibilité de créer une proposition mais aucune mutation automatique
  it('17. séance difficile → possibilité de créer une proposition mais aucune mutation automatique', () => {
    const store = useAppStore.getState();
    const plannedBefore = [...store.plannedWorkouts];

    const proposal: CoachProposal = {
      id: 'prop-recovery',
      action: 'RECOVERY',
      reason: 'Fatigue aiguë constatée suite au retour de séance',
      affectedWorkoutIds: ['pw-2'],
      proposedModifications: [{ workoutId: 'pw-2', cancel: true }],
      constraints: { maxWeeklyLoadIncrease: 0.05, prioritizeRecovery: true },
      confidence: 'MEDIUM',
      proposedAt: new Date().toISOString()
    };

    // La proposition existe, elle peut être validée par les règles
    const validation = validateCoachProposal(proposal, {
      plannedWorkouts: store.plannedWorkouts,
      currentPmc: null,
      weeklyPlannedLoad: 120,
      confidence: { level: 'MEDIUM', historyWeeks: 5, recentWorkoutsCount: 4, reasons: [] }
    });
    expect(validation.valid).toBe(true);

    // TANT QUE CoachActionExecutor n'est pas appelé avec confirmation utilisateur, le planning reste inchangé
    expect(useAppStore.getState().plannedWorkouts).toEqual(plannedBefore);
  });

  // 18. séance très bien vécue → observation positive conservée
  it('18. séance très bien vécue → observation positive conservée', () => {
    const easyWorkout: ActualWorkout = {
      id: 'aw-easy',
      source: 'manual',
      sport: 'Run',
      date: '2026-03-24',
      startTime: '2026-03-24T08:00:00Z',
      durationMin: 45
    };

    const greatFeedback: WorkoutFeedback = {
      id: 'fb-great',
      actualWorkoutId: 'aw-easy',
      date: '2026-03-24',
      sport: 'Run',
      durationMin: 45,
      rpe: 1,
      feeling: 'very_good',
      comment: 'Sensations parfaites, zéro fatigue.',
      createdAt: '2026-03-24T09:00:00Z'
    };

    const obs = analyzeWorkoutExecution({
      actualWorkout: easyWorkout,
      feedback: greatFeedback
    });

    const posObs = obs.find(o => o.type === 'POSITIVE_WORKOUT_EXPERIENCE');
    expect(posObs).toBeDefined();
    expect(posObs?.description).toContain('RPE 1/5');
  });

  // 19. séance similaire sans données suffisantes → INSUFFICIENT_DATA
  it('19. séance similaire sans données suffisantes → INSUFFICIENT_DATA', () => {
    const target = { sport: 'Ride' as const, durationMin: 60 };

    // Seulement 1 séance similaire passée
    const history1: ActualWorkout[] = [
      {
        id: 'w-prev-1',
        source: 'demo',
        sport: 'Ride',
        date: '2026-03-10',
        startTime: '2026-03-10T08:00:00Z',
        durationMin: 58
      }
    ];

    const statInsufficient = calculateSimilarWorkoutsStat(target, history1, []);
    expect(statInsufficient.status).toBe('INSUFFICIENT_DATA');
    expect(statInsufficient.sampleSize).toBe(1);

    // Ajout de 2 séances supplémentaires (total 3 >= seuil)
    const history3: ActualWorkout[] = [
      ...history1,
      {
        id: 'w-prev-2',
        source: 'demo',
        sport: 'Ride',
        date: '2026-03-14',
        startTime: '2026-03-14T08:00:00Z',
        durationMin: 62,
        tss: 50
      },
      {
        id: 'w-prev-3',
        source: 'demo',
        sport: 'Ride',
        date: '2026-03-18',
        startTime: '2026-03-18T08:00:00Z',
        durationMin: 60,
        tss: 48
      }
    ];

    const feedbacks3: WorkoutFeedback[] = [
      { id: 'f-1', actualWorkoutId: 'w-prev-1', sport: 'Ride', date: '2026-03-10', durationMin: 58, rpe: 3, createdAt: '2026-03-10T09:00:00Z' },
      { id: 'f-2', actualWorkoutId: 'w-prev-2', sport: 'Ride', date: '2026-03-14', durationMin: 62, rpe: 3, createdAt: '2026-03-14T09:00:00Z' }
    ];

    const statAvailable = calculateSimilarWorkoutsStat(target, history3, feedbacks3);
    expect(statAvailable.status).toBe('AVAILABLE');
    expect(statAvailable.sampleSize).toBe(3);
    expect(statAvailable.averageRpe).toBe(3);
  });

  // 20. aucune régression des phases précédentes
  it('20. aucune régression des phases précédentes', () => {
    // Vérifier l'exécution atomique de proposition de Phase 28 en présence de feedback
    const store = useAppStore.getState();
    const proposal: CoachProposal = {
      id: 'prop-p28-compat',
      action: 'MODIFY_WORKOUT',
      reason: 'Allègement de durée',
      affectedWorkoutIds: ['pw-1'],
      proposedModifications: [{ workoutId: 'pw-1', newDurationMin: 45 }],
      constraints: { maxWeeklyLoadIncrease: 0.05, prioritizeRecovery: true },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const execResult = CoachActionExecutor.executeProposal(proposal, {
      userMessage: "Oui, allège ma séance s'il te plaît"
    });

    expect(execResult.success).toBe(true);

    const updated = useAppStore.getState();
    const modifiedWorkout = updated.plannedWorkouts.find(w => w.id === 'pw-1');
    expect(modifiedWorkout?.targetDurationMin).toBe(45);
    expect(modifiedWorkout?.status).toBe('adapted');

    // Vérifier que l'audit trail enregistre la décision EXECUTED
    expect(updated.coachDecisions.length).toBeGreaterThan(0);
    expect(updated.coachDecisions[0].userDecision).toBe('EXECUTED');
  });
});
