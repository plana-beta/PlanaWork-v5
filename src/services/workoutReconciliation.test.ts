import { describe, it, expect, beforeEach } from 'vitest';
import { WorkoutReconciliationService } from './WorkoutReconciliationService';
import { PlannedWorkout, ActualWorkout } from '../domain/models';
import { WorkoutFeedback, WorkoutObservation } from '../domain/athleteHistoryTypes';
import { useAppStore } from '../store';
import { CoachActionExecutor } from '../lib/coachActionExecutor';
import { detectAthleteHabits } from '../lib/postWorkoutAnalysis';

describe('Phase 35 — Post-Workout Intelligence & Training Load Reconciliation', () => {
  beforeEach(() => {
    // Réinitialisation propre du store pour garantir l'indépendance des tests
    useAppStore.setState({
      plannedWorkouts: [],
      actualWorkouts: [],
      workoutFeedbacks: [],
      workoutObservations: [],
      athleteHabits: [],
      athletePreferences: [],
      coachDecisions: [],
      ftp: 250,
      athleteProfile: {
        id: 'ath-1',
        name: 'Test Athlete',
        level: { swim: 'intermediate', ride: 'intermediate', run: 'intermediate' },
        availability: { weeklyHours: 10, availableDays: ['Monday', 'Wednesday', 'Saturday'] },
        hrMax: 190,
        dataConnection: 'none'
      }
    });
  });

  // --- 1. Rapprochement des activités (Matching) ---

  it('1.1 rapprochement confirmé par identifiant explicite plannedWorkoutId', () => {
    const planned: PlannedWorkout = {
      id: 'plan-101',
      sport: 'Ride',
      date: '2026-10-20',
      title: 'Sortie Seuil Sweet Spot',
      targetDurationMin: 60,
      targetTss: 65,
      status: 'planned'
    };

    const actual: ActualWorkout = {
      id: 'act-201',
      source: 'Garmin',
      sourceId: 'garmin-activity-999',
      sport: 'Ride',
      date: '2026-10-20',
      durationMin: 62,
      tss: 68,
      plannedWorkoutId: 'plan-101'
    };

    const res = WorkoutReconciliationService.reconcile({
      actualWorkout: actual,
      plannedWorkouts: [planned]
    });

    expect(res.status).toBe('MATCH_CONFIRMED');
    expect(res.plannedWorkout?.id).toBe('plan-101');
    expect(res.matchConfidence).toBe(1.0);
    expect(res.matchReason).toContain("Liaison explicite confirmée");
  });

  it('1.2 rapprochement confirmé par unicité parfaite (date, sport, volume cohérent)', () => {
    const planned: PlannedWorkout = {
      id: 'plan-102',
      sport: 'Run',
      date: '2026-10-20',
      title: 'Footing aérobie',
      targetDurationMin: 45,
      targetTss: 40,
      status: 'planned'
    };

    const actual: ActualWorkout = {
      id: 'act-202',
      source: 'Strava',
      sport: 'Run',
      date: '2026-10-20',
      durationMin: 44,
      distanceKm: 8.2,
      tss: 38
    };

    const res = WorkoutReconciliationService.reconcile({
      actualWorkout: actual,
      plannedWorkouts: [planned]
    });

    expect(res.status).toBe('MATCH_CONFIRMED');
    expect(res.plannedWorkout?.id).toBe('plan-102');
    expect(res.matchConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('1.3 rapprochement probable quand la durée diffère modérément mais reste le seul candidat du jour', () => {
    const planned: PlannedWorkout = {
      id: 'plan-103',
      sport: 'Ride',
      date: '2026-10-21',
      title: 'Endurance longue',
      targetDurationMin: 90,
      targetTss: 85,
      status: 'planned'
    };

    const actual: ActualWorkout = {
      id: 'act-203',
      source: 'Wahoo',
      sport: 'Ride',
      date: '2026-10-21',
      durationMin: 115, // +25 min
      tss: 105
    };

    const res = WorkoutReconciliationService.reconcile({
      actualWorkout: actual,
      plannedWorkouts: [planned]
    });

    expect(res.status).toBe('MATCH_PROBABLE');
    expect(res.plannedWorkout?.id).toBe('plan-103');
    expect(res.matchConfidence).toBe(0.75);
  });

  it('1.4 rapprochement ambigu bloquant toute association automatique en présence de candidats équivalents', () => {
    const plannedMorning: PlannedWorkout = {
      id: 'plan-morning',
      sport: 'Run',
      date: '2026-10-22',
      title: 'Fractionné matin',
      targetDurationMin: 45,
      status: 'planned'
    };

    const plannedEvening: PlannedWorkout = {
      id: 'plan-evening',
      sport: 'Run',
      date: '2026-10-22',
      title: 'Footing soir',
      targetDurationMin: 45,
      status: 'planned'
    };

    const actual: ActualWorkout = {
      id: 'act-run',
      source: 'Garmin',
      sport: 'Run',
      date: '2026-10-22',
      durationMin: 46
    };

    const res = WorkoutReconciliationService.reconcile({
      actualWorkout: actual,
      plannedWorkouts: [plannedMorning, plannedEvening]
    });

    // RÈGLE STRICTE : AUCUNE association automatique si ambiguïté !
    expect(res.status).toBe('MATCH_AMBIGUOUS');
    expect(res.plannedWorkout).toBeUndefined();
    expect(res.requiresAthleteDecision).toBe(true);
    expect(res.matchReason).toContain('Ambiguïté');
  });

  it('1.5 absence de correspondance (NO_MATCH) si aucun sport ou date compatible', () => {
    const planned: PlannedWorkout = {
      id: 'plan-swim',
      sport: 'Swim',
      date: '2026-10-23',
      title: 'Séance natation',
      targetDurationMin: 45,
      status: 'planned'
    };

    const actual: ActualWorkout = {
      id: 'act-ride',
      source: 'Garmin',
      sport: 'Ride', // Vélo alors que natation planifiée
      date: '2026-10-23',
      durationMin: 60
    };

    const res = WorkoutReconciliationService.reconcile({
      actualWorkout: actual,
      plannedWorkouts: [planned]
    });

    expect(res.status).toBe('NO_MATCH');
    expect(res.plannedWorkout).toBeUndefined();
    expect(res.matchConfidence).toBe(0);
  });

  it('1.6 absence de double association : une séance planifiée ne peut être réclamée deux fois dans reconcileAll', () => {
    const planned: PlannedWorkout = {
      id: 'plan-single',
      sport: 'Ride',
      date: '2026-10-24',
      title: 'Sortie unique vélo',
      targetDurationMin: 60,
      status: 'planned'
    };

    const actual1: ActualWorkout = {
      id: 'act-first',
      source: 'Garmin',
      sport: 'Ride',
      date: '2026-10-24',
      durationMin: 60
    };

    const actual2: ActualWorkout = {
      id: 'act-second',
      source: 'Wahoo',
      sport: 'Ride',
      date: '2026-10-24',
      durationMin: 55
    };

    const results = WorkoutReconciliationService.reconcileAll({
      actualWorkouts: [actual1, actual2],
      plannedWorkouts: [planned]
    });

    expect(results).toHaveLength(2);
    // Le premier doit avoir capturé la séance
    expect(results[0].status).toBe('MATCH_CONFIRMED');
    expect(results[0].plannedWorkout?.id).toBe('plan-single');

    // Le second ne doit PAS réclamer la même séance planifiée
    expect(results[1].status).toBe('NO_MATCH');
    expect(results[1].plannedWorkout).toBeUndefined();
  });

  // --- 2. Comparaison des métriques et tolérance aux valeurs manquantes ---

  it('2.1 compare uniquement les métriques disponibles sans remplacer les données manquantes par zéro', () => {
    const planned: PlannedWorkout = {
      id: 'plan-metrics',
      sport: 'Ride',
      date: '2026-10-20',
      title: 'Séance sans capteur de cadence',
      targetDurationMin: 60,
      targetTss: 50
      // Pas de distance, pas de puissance cible
    };

    const actual: ActualWorkout = {
      id: 'act-metrics',
      sport: 'Ride',
      date: '2026-10-20',
      durationMin: 60,
      averageHeartRate: 145
      // Pas de distance, pas de capteur de puissance
    };

    const res = WorkoutReconciliationService.reconcile({
      actualWorkout: actual,
      plannedWorkouts: [planned]
    });

    const comp = res.comparison;
    const durItem = comp.find(c => c.metric === 'duration');
    const hrItem = comp.find(c => c.metric === 'heart_rate');
    const distItem = comp.find(c => c.metric === 'distance');

    expect(durItem).toBeDefined();
    expect(durItem?.plannedValue).toBe(60);
    expect(durItem?.actualValue).toBe(60);

    expect(hrItem).toBeDefined();
    expect(hrItem?.actualValue).toBe(145);
    expect(hrItem?.plannedValue).toBeUndefined(); // Jamais remplacé par 0 !

    // La distance n'étant pas disponible des deux côtés, elle ne doit pas avoir un zéro artificiel
    expect(distItem).toBeUndefined();
  });

  it('2.2 détecte et explicite un écart significatif de durée', () => {
    const planned: PlannedWorkout = {
      id: 'plan-dur',
      sport: 'Run',
      date: '2026-10-20',
      title: 'Footing court',
      targetDurationMin: 40,
      status: 'planned'
    };

    const actual: ActualWorkout = {
      id: 'act-dur',
      sport: 'Run',
      date: '2026-10-20',
      durationMin: 65 // +25 min (+63%)
    };

    const res = WorkoutReconciliationService.reconcile({
      actualWorkout: actual,
      plannedWorkouts: [planned]
    });

    const durComp = res.comparison.find(c => c.metric === 'duration');
    expect(durComp?.isSignificantDiscrepancy).toBe(true);
    expect(durComp?.deltaAbsolute).toBe(25);
    expect(durComp?.deltaPercentage).toBe(63);
    expect(durComp?.explanation).toContain('+25 min');
  });

  it('2.3 détecte et explicite un écart significatif de distance', () => {
    const planned: PlannedWorkout = {
      id: 'plan-dist',
      sport: 'Ride',
      date: '2026-10-20',
      title: 'Sortie rythmée',
      targetDurationMin: 90,
      distanceKm: 50
    };

    const actual: ActualWorkout = {
      id: 'act-dist',
      sport: 'Ride',
      date: '2026-10-20',
      durationMin: 90,
      distanceKm: 40 // -10 km (-20%)
    };

    const res = WorkoutReconciliationService.reconcile({
      actualWorkout: actual,
      plannedWorkouts: [planned]
    });

    const distComp = res.comparison.find(c => c.metric === 'distance');
    expect(distComp?.isSignificantDiscrepancy).toBe(true);
    expect(distComp?.deltaAbsolute).toBe(-10);
    expect(distComp?.deltaPercentage).toBe(-20);
  });

  it('2.4 détecte et explicite un écart significatif de charge (TSS)', () => {
    const planned: PlannedWorkout = {
      id: 'plan-tss',
      sport: 'Ride',
      date: '2026-10-20',
      title: 'Séance tempo',
      targetDurationMin: 60,
      targetTss: 50
    };

    const actual: ActualWorkout = {
      id: 'act-tss',
      sport: 'Ride',
      date: '2026-10-20',
      durationMin: 60,
      tss: 85 // +35 TSS (+70%)
    };

    const res = WorkoutReconciliationService.reconcile({
      actualWorkout: actual,
      plannedWorkouts: [planned]
    });

    const tssComp = res.comparison.find(c => c.metric === 'tss');
    expect(tssComp?.isSignificantDiscrepancy).toBe(true);
    expect(tssComp?.deltaAbsolute).toBe(35);
  });

  // --- 3. Qualité et provenance du TSS ---

  it('3.1 identifie correctement un TSS importé directement du fichier (MEASURED_OR_IMPORTED)', () => {
    const actual: ActualWorkout = {
      id: 'act-garmin',
      source: 'Garmin',
      sport: 'Ride',
      date: '2026-10-20',
      durationMin: 75,
      tss: 72
    };

    const tssInfo = WorkoutReconciliationService.auditTssProvenance(actual);
    expect(tssInfo.status).toBe('MEASURED_OR_IMPORTED');
    expect(tssInfo.method).toBe('device_provided');
    expect(tssInfo.isEstimatedOnly).toBe(false);
    expect(tssInfo.reliabilityWarning).toBeUndefined();
  });

  it('3.2 identifie correctement un TSS calculé déterministement via Puissance Normalisée NP', () => {
    const actual: ActualWorkout = {
      id: 'act-calc-np',
      source: 'manual',
      sport: 'Ride',
      date: '2026-10-20',
      durationMin: 60,
      normalizedPower: 220,
      tss: 68
    };

    const tssInfo = WorkoutReconciliationService.auditTssProvenance(actual);
    expect(tssInfo.status).toBe('DETERMINISTICALLY_CALCULATED');
    expect(tssInfo.method).toBe('power_np');
    expect(tssInfo.isEstimatedOnly).toBe(false);
  });

  it('3.3 identifie correctement un hrTSS calculé déterministement via Fréquence Cardiaque', () => {
    const actual: ActualWorkout = {
      id: 'act-calc-hr',
      source: 'manual',
      sport: 'Run',
      date: '2026-10-20',
      durationMin: 50,
      averageHeartRate: 155,
      tss: 52
    };

    const tssInfo = WorkoutReconciliationService.auditTssProvenance(actual);
    expect(tssInfo.status).toBe('DETERMINISTICALLY_CALCULATED');
    expect(tssInfo.method).toBe('heart_rate');
    expect(tssInfo.isEstimatedOnly).toBe(false);
  });

  it('3.4 distingue et alerte explicitement sur un TSS estimé fondé uniquement sur la durée (ESTIMATED)', () => {
    const actual: ActualWorkout = {
      id: 'act-est',
      source: 'manual',
      sport: 'Ride',
      date: '2026-10-20',
      durationMin: 60,
      tss: 45
      // Ni capteur de puissance ni fréquence cardiaque
    };

    const tssInfo = WorkoutReconciliationService.auditTssProvenance(actual);
    expect(tssInfo.status).toBe('ESTIMATED');
    expect(tssInfo.method).toBe('duration_estimate');
    expect(tssInfo.isEstimatedOnly).toBe(true);
    // Avertissement explicite sur l'absence d'équivalence avec une mesure de puissance
    expect(tssInfo.reliabilityWarning).toContain("Estimation fondée uniquement sur la durée");
    expect(tssInfo.reliabilityWarning).toContain("non équivalente à une mesure de puissance");
  });

  it('3.5 classe comme UNAVAILABLE une charge absente', () => {
    const actual: ActualWorkout = {
      id: 'act-none',
      source: 'manual',
      sport: 'Run',
      date: '2026-10-20',
      durationMin: 30
      // Aucun TSS
    };

    const tssInfo = WorkoutReconciliationService.auditTssProvenance(actual);
    expect(tssInfo.status).toBe('UNAVAILABLE');
    expect(tssInfo.method).toBe('none');
  });

  // --- 4. Analyse post-séance déterministe & feedback ---

  it('4.1 accepte un feedback facultatif avec RPE et sensation sans commentaire', () => {
    const feedback: WorkoutFeedback = {
      id: 'fb-1',
      actualWorkoutId: 'act-fb-1',
      date: '2026-10-20',
      sport: 'Ride',
      durationMin: 60,
      rpe: 6,
      feeling: 'good'
      // Pas de commentaire
    };

    useAppStore.getState().addWorkoutFeedback(feedback);

    const storeFeedbacks = useAppStore.getState().workoutFeedbacks;
    expect(storeFeedbacks).toHaveLength(1);
    expect(storeFeedbacks[0].comment).toBeUndefined();
    expect(storeFeedbacks[0].rpe).toBe(6);
  });

  it('4.2 permet la correction traçable d\'un feedback sans duplication dans le store', () => {
    const originalFeedback: WorkoutFeedback = {
      id: 'fb-traceable',
      actualWorkoutId: 'act-tr',
      date: '2026-10-20',
      sport: 'Run',
      durationMin: 45,
      rpe: 5,
      feeling: 'good'
    };

    useAppStore.getState().addWorkoutFeedback(originalFeedback);
    expect(useAppStore.getState().workoutFeedbacks).toHaveLength(1);

    // L'athlète corrige son évaluation le lendemain (RPE réévalué à 7)
    const correctedFeedback: WorkoutFeedback = {
      id: 'fb-traceable',
      actualWorkoutId: 'act-tr',
      date: '2026-10-20',
      sport: 'Run',
      durationMin: 45,
      rpe: 7,
      feeling: 'tired',
      comment: 'Correction : courbatures ressenties après coup'
    };

    useAppStore.getState().updateWorkoutFeedback(correctedFeedback);

    const storeFeedbacks = useAppStore.getState().workoutFeedbacks;
    expect(storeFeedbacks).toHaveLength(1); // Pas de doublon !
    expect(storeFeedbacks[0].rpe).toBe(7);
    expect(storeFeedbacks[0].feeling).toBe('tired');
    expect(storeFeedbacks[0].comment).toContain('Correction');
    expect((storeFeedbacks[0] as any).updatedAt).toBeDefined();
  });

  it('4.3 détecte une fatigue post-séance élevée (HIGH_FATIGUE_REPORTED)', () => {
    const planned: PlannedWorkout = {
      id: 'plan-fat',
      sport: 'Ride',
      date: '2026-10-20',
      title: 'Endurance',
      targetDurationMin: 60,
      targetTss: 45
    };

    const actual: ActualWorkout = {
      id: 'act-fat',
      sport: 'Ride',
      date: '2026-10-20',
      durationMin: 60,
      tss: 45
    };

    const feedback: WorkoutFeedback = {
      id: 'fb-fat',
      actualWorkoutId: 'act-fat',
      date: '2026-10-20',
      sport: 'Ride',
      durationMin: 60,
      rpe: 8,
      feeling: 'very_tired'
    };

    const res = WorkoutReconciliationService.reconcile({
      actualWorkout: actual,
      plannedWorkouts: [planned],
      feedback
    });

    const fatigueObs = res.observations.find(o => o.type === 'HIGH_FATIGUE_REPORTED');
    expect(fatigueObs).toBeDefined();
    expect(fatigueObs?.title).toContain('Fatigue post-séance marquée');
  });

  // --- 5. Température et contexte réel ---

  it('5.1 utilise la température réelle avec provenance et horodatage sans inventer de données', () => {
    const actual: ActualWorkout = {
      id: 'act-temp',
      source: 'Garmin Edge 840',
      sport: 'Ride',
      date: '2026-10-20',
      startTime: '2026-10-20T14:30:00Z',
      durationMin: 90,
      temperature: 28 // 28°C réels
    };

    const ctx = WorkoutReconciliationService.extractContext(actual);
    expect(ctx.hasTemperature).toBe(true);
    expect(ctx.temperature).toBe(28);
    expect(ctx.temperatureSource).toContain('Capteur thermique');
    expect(ctx.timestamp).toBe('2026-10-20T14:30:00Z');
    expect(ctx.indeterminateReasons).toHaveLength(0);
  });

  it('5.2 signale la cause indéterminée en l\'absence de contexte thermique', () => {
    const actual: ActualWorkout = {
      id: 'act-no-temp',
      source: 'manual',
      sport: 'Run',
      date: '2026-10-20',
      durationMin: 45
      // Aucune température
    };

    const ctx = WorkoutReconciliationService.extractContext(actual);
    expect(ctx.hasTemperature).toBe(false);
    expect(ctx.temperature).toBeUndefined();
    expect(ctx.indeterminateReasons[0]).toContain("Température ambiante non enregistrée");
    expect(ctx.indeterminateReasons[0]).toContain("impossible d'attribuer une dérive cardiaque à la chaleur");
  });

  // --- 6. Proposition d'adaptation déterministe (sans compensation brutale) ---

  it('6.1 propose un allégement en cas de fatigue signalée sans muter le plan automatiquement', () => {
    const todayStr = '2026-10-20';
    const tomorrowStr = '2026-10-21';

    const todayPlanned: PlannedWorkout = {
      id: 'plan-today',
      sport: 'Ride',
      date: todayStr,
      title: 'Séance dure',
      targetDurationMin: 60,
      targetTss: 80
    };

    const tomorrowPlanned: PlannedWorkout = {
      id: 'plan-tomorrow',
      sport: 'Ride',
      date: tomorrowStr,
      title: 'Intervalles Seuil',
      targetDurationMin: 60,
      targetTss: 85,
      status: 'planned'
    };

    useAppStore.getState().addPlannedWorkout(todayPlanned);
    useAppStore.getState().addPlannedWorkout(tomorrowPlanned);

    const actualToday: ActualWorkout = {
      id: 'act-exhausted',
      sport: 'Ride',
      date: todayStr,
      durationMin: 60,
      tss: 85
    };

    const feedbackExhausted: WorkoutFeedback = {
      id: 'fb-exhausted',
      actualWorkoutId: 'act-exhausted',
      date: todayStr,
      sport: 'Ride',
      durationMin: 60,
      rpe: 9,
      feeling: 'very_tired'
    };

    const res = WorkoutReconciliationService.reconcile({
      actualWorkout: actualToday,
      plannedWorkouts: [todayPlanned, tomorrowPlanned],
      feedback: feedbackExhausted
    });

    // 1. Une proposition d'adaptation doit être suggérée
    expect(res.proposedAdaptation).toBeDefined();
    expect(res.proposedAdaptation?.status).toBe('PROPOSED');
    expect(res.proposedAdaptation?.targetWorkoutId).toBe('plan-tomorrow');
    expect(res.proposedAdaptation?.workoutUpdate?.targetDurationMin).toBeLessThan(60);

    // 2. RÈGLE STRICTE : Le store et le planning NE DOIVENT PAS être mutés automatiquement !
    const storeTomorrow = useAppStore.getState().plannedWorkouts.find(p => p.id === 'plan-tomorrow');
    expect(storeTomorrow?.targetDurationMin).toBe(60); // Inchangé tant que non validé par l'athlète !
  });

  it('6.2 n\'applique l\'adaptation qu\'après validation explicite de l\'athlète avec audit complet', () => {
    const tomorrowStr = '2026-10-21';
    const tomorrowPlanned: PlannedWorkout = {
      id: 'plan-tomorrow-validate',
      sport: 'Ride',
      date: tomorrowStr,
      title: 'Séance prévue',
      targetDurationMin: 80,
      targetTss: 90,
      status: 'planned'
    };

    useAppStore.getState().addPlannedWorkout(tomorrowPlanned);

    const proposal: import('../domain/coachTypes').CoachProposal = {
      id: 'prop-validated-1',
      action: 'MODIFY_WORKOUT',
      affectedWorkoutIds: ['plan-tomorrow-validate'],
      proposedModifications: [{
        workoutId: 'plan-tomorrow-validate',
        newDurationMin: 55,
        newTargetTss: 60
      }],
      summary: 'Allègement de la séance',
      explanation: "Allègement de la séance suite à la fatigue",
      status: 'PROPOSED',
      proposedAt: new Date().toISOString()
    };

    // Exécution transactionnelle de la proposition après clic athlète
    const execResult = CoachActionExecutor.executeProposal(proposal, {
      userMessage: "Oui, je valide l'allégement proposé"
    });

    expect(execResult.success).toBe(true);

    // Maintenant le store doit refléter la modification
    const updated = useAppStore.getState().plannedWorkouts.find(p => p.id === 'plan-tomorrow-validate');
    expect(updated?.targetDurationMin).toBe(55);

    // L'audit de décision doit être tracé
    const decisions = useAppStore.getState().coachDecisions;
    expect(decisions.some(d => (d.proposal?.id === 'prop-validated-1' || d.proposalId === 'prop-validated-1') && d.userDecision === 'EXECUTED')).toBe(true);
  });

  it('6.3 ne compense JAMAIS une séance manquée en ajoutant toute sa charge aux séances suivantes', () => {
    const plannedMissed: PlannedWorkout = {
      id: 'plan-missed',
      sport: 'Ride',
      date: '2026-10-19',
      title: 'Sortie manquée',
      targetDurationMin: 120,
      targetTss: 130,
      status: 'missed'
    };

    const nextSession: PlannedWorkout = {
      id: 'plan-next',
      sport: 'Run',
      date: '2026-10-20',
      title: 'Course prévue',
      targetDurationMin: 45,
      targetTss: 40,
      status: 'planned'
    };

    // Vérifier qu'aucune proposition n'additionne 130 TSS sur la séance du lendemain
    const adaptation = WorkoutReconciliationService.deriveProposedAdaptation(
      { id: 'act-none', sport: 'Ride', date: '2026-10-19', durationMin: 0 },
      plannedMissed,
      [],
      null,
      [plannedMissed, nextSession]
    );

    // Soit pas d'adaptation, soit adaptation protectrice, mais JAMAIS de surcharge compensatoire
    if (adaptation && adaptation.workoutUpdate?.targetTss) {
      expect(adaptation.workoutUpdate.targetTss).toBeLessThanOrEqual(nextSession.targetTss || 40);
    }
  });

  // --- 7. Mémoire de l'athlète (Règle de récurrence) ---

  it('7.1 une observation isolée ne crée JAMAIS une habitude persistante dans la mémoire', () => {
    const singleObservation: WorkoutObservation = {
      id: 'obs-single',
      workoutId: 'plan-1',
      actualWorkoutId: 'act-1',
      date: '2026-10-20',
      type: 'HIGH_PERCEIVED_EFFORT',
      title: 'Effort perçu élevé',
      description: 'RPE 8 sur séance Z2',
      createdAt: new Date().toISOString()
    };

    const habits = detectAthleteHabits([singleObservation]);

    // RÈGLE STRICTE PHASE 30 & 35 : Au moins 2 occurrences requises pour initier une habitude
    expect(habits).toHaveLength(0);
  });

  it('7.2 deux occurrences ou plus sur dates distinctes créent une habitude avec confiance traçable', () => {
    const obs1: WorkoutObservation = {
      id: 'obs-1',
      workoutId: 'plan-1',
      actualWorkoutId: 'act-1',
      date: '2026-10-15',
      type: 'HIGH_PERCEIVED_EFFORT',
      title: 'Effort perçu élevé',
      description: 'RPE 8 sur séance Z2',
      createdAt: new Date().toISOString()
    };

    const obs2: WorkoutObservation = {
      id: 'obs-2',
      workoutId: 'plan-2',
      actualWorkoutId: 'act-2',
      date: '2026-10-20',
      type: 'HIGH_PERCEIVED_EFFORT',
      title: 'Effort perçu élevé',
      description: 'RPE 9 sur séance tempo',
      createdAt: new Date().toISOString()
    };

    const habits = detectAthleteHabits([obs1, obs2]);

    expect(habits.length).toBeGreaterThanOrEqual(1);
    expect(habits[0].occurrenceCount).toBe(2);
    expect(habits[0].confidence).toBe('MEDIUM');
    expect(habits[0].sources).toContain('act-1');
    expect(habits[0].sources).toContain('act-2');
  });

  it('7.3 le Coach ne peut pas modifier directement la mémoire sans validation athlète', () => {
    const initialPrefs = useAppStore.getState().athletePreferences;
    expect(initialPrefs).toHaveLength(0);

    // Une réconciliation ne doit pas injecter directement de préférences permanentes non confirmées
    const actual: ActualWorkout = {
      id: 'act-mem-check',
      sport: 'Swim',
      date: '2026-10-20',
      durationMin: 30
    };

    WorkoutReconciliationService.reconcile({
      actualWorkout: actual,
      plannedWorkouts: []
    });

    expect(useAppStore.getState().athletePreferences).toHaveLength(0);
  });

  it('7.4 idempotence de l\'application d\'une décision après redémarrage', () => {
    const planned: PlannedWorkout = {
      id: 'plan-idem',
      sport: 'Ride',
      date: '2026-10-25',
      title: 'Séance pour idempotence',
      targetDurationMin: 60,
      status: 'planned'
    };

    useAppStore.getState().addPlannedWorkout(planned);

    const proposal: import('../domain/coachTypes').CoachProposal = {
      id: 'prop-idem-1',
      action: 'MODIFY_WORKOUT',
      affectedWorkoutIds: ['plan-idem'],
      proposedModifications: [{
        workoutId: 'plan-idem',
        newDurationMin: 45
      }],
      summary: 'Allègement 45 min',
      explanation: 'Allègement 45 min pour test idempotence',
      status: 'PROPOSED',
      proposedAt: new Date().toISOString()
    };

    // 1ère exécution
    const firstExec = CoachActionExecutor.executeProposal(proposal);
    expect(firstExec.success).toBe(true);

    // 2ème tentative d'exécution de la même proposition
    const secondExec = CoachActionExecutor.executeProposal(proposal);
    expect(secondExec.success).toBe(false);
    expect(secondExec.alreadyExecuted).toBe(true);
    expect(secondExec.message).toContain('déjà été appliquée');
  });
});
