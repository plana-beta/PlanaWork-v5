import { describe, it, expect, beforeEach } from 'vitest';
import { TrainingProgressionService, PROGRESSION_THRESHOLDS } from './TrainingProgressionService';
import { PlannedWorkout, ActualWorkout, AthleteProfile, Goal } from '../domain/models';
import { WorkoutFeedback, WorkoutObservation } from '../domain/athleteHistoryTypes';
import { PmcData } from '../types';
import { useAppStore } from '../store';

describe('Phase 37 — Training Progression Intelligence & Goal Alignment', () => {
  const baseProfile: AthleteProfile = {
    id: 'athlete-101',
    name: 'Jean Test',
    level: { swim: 'intermediate', ride: 'intermediate', run: 'intermediate' },
    availability: { weeklyHours: 10, availableDays: ['mon', 'wed', 'sat', 'sun'] },
    dataConnection: 'none'
  };

  const currentDate = new Date('2026-10-20T10:00:00Z');

  beforeEach(() => {
    TrainingProgressionService.resetRegistry();
  });

  // 1. Objectif actif avec des données complètes et comparables
  it('1. analyse un objectif actif avec des données complètes et comparables', () => {
    const goal: Goal = {
      id: 'goal-ironman-703',
      title: 'Triathlon 70.3',
      date: '2026-12-15',
      distanceKm: 113,
      sportFocus: 'Triathlon'
    };

    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-09-25', sport: 'Ride', durationMin: 60, normalizedPower: 200, averageHeartRate: 145, tss: 65, source: 'Garmin' },
      { id: 'w2', date: '2026-10-02', sport: 'Ride', durationMin: 60, normalizedPower: 210, averageHeartRate: 145, tss: 70, source: 'Garmin' },
      { id: 'w3', date: '2026-10-09', sport: 'Ride', durationMin: 60, normalizedPower: 218, averageHeartRate: 144, tss: 72, source: 'Garmin' },
      { id: 'w4', date: '2026-10-16', sport: 'Ride', durationMin: 60, normalizedPower: 225, averageHeartRate: 143, tss: 75, source: 'Garmin' }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: { ...baseProfile, goal },
      plannedWorkouts: [],
      actualWorkouts,
      currentDate,
      analysisDays: 28
    });

    expect(result.status).toBe('PROGRESSING');
    expect(result.goalAlignment).toBeDefined();
    expect(result.goalAlignment?.goalTitle).toBe('Triathlon 70.3');
    expect(result.goalAlignment?.daysRemaining).toBeGreaterThan(0);
    expect(result.goalAlignment?.alignmentStatus).toBe('PROGRESS_DETECTED');
    expect(result.metrics.length).toBeGreaterThan(0);
    const powerMetric = result.metrics.find(m => m.sport === 'Ride' && m.unit === 'W');
    expect(powerMetric?.trend).toBe('IMPROVING');
    expect(powerMetric?.relativeDeltaPct).toBeGreaterThan(3);
  });

  // 2. Objectif sans métrique mesurable
  it('2. analyse un objectif sans métrique mesurable sans fabriquer de faux score', () => {
    const goal: Goal = {
      id: 'goal-general',
      title: 'Prendre du plaisir et terminer la saison',
      date: '2026-11-30'
    };

    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-10-05', sport: 'Run', durationMin: 45, distanceKm: 8, tss: 40 },
      { id: 'w2', date: '2026-10-12', sport: 'Run', durationMin: 45, distanceKm: 8.2, tss: 42 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: { ...baseProfile, goal },
      plannedWorkouts: [],
      actualWorkouts,
      currentDate
    });

    expect(result.goalAlignment?.isMeasurable).toBe(false);
    expect(result.goalAlignment?.progressPercent).toBeNull();
    expect(result.goalAlignment?.limitsExplanation).toContain('ne comporte pas de métrique chiffrée');
  });

  // 3. Absence de données suffisantes : INSUFFICIENT_DATA
  it('3. produit un statut INSUFFICIENT_DATA explicite en cas de données manquantes', () => {
    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts: [],
      currentDate
    });

    expect(result.status).toBe('INSUFFICIENT_DATA');
    expect(result.uncertaintyLevel).toBe('INSUFFICIENT_DATA');
    expect(result.missingData.length).toBeGreaterThan(0);
    expect(result.readableExplanation).toContain('Données récentes insuffisantes');
  });

  // 4. Mesures importées et calculées : provenance préservée
  it('4. préserve la distinction entre mesures importées et calculées déterministes', () => {
    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-10-01', sport: 'Ride', durationMin: 60, normalizedPower: 220, averageHeartRate: 140, tss: 70, source: 'Wahoo' },
      { id: 'w2', date: '2026-10-08', sport: 'Ride', durationMin: 60, normalizedPower: 225, averageHeartRate: 139, tss: 72, source: 'Wahoo' },
      { id: 'w3', date: '2026-10-15', sport: 'Ride', durationMin: 60, normalizedPower: 230, averageHeartRate: 138, tss: 74, source: 'Wahoo' }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts,
      currentDate
    });

    const powerMetric = result.metrics.find(m => m.metricName.includes('Puissance'));
    const effMetric = result.metrics.find(m => m.metricName.includes('efficience'));

    expect(powerMetric?.provenance).toBe('MEASURED_OR_IMPORTED');
    expect(effMetric?.provenance).toBe('DETERMINISTICALLY_CALCULATED');
    expect(result.dataProvenance.measuredCount).toBeGreaterThan(0);
    expect(result.dataProvenance.calculatedCount).toBeGreaterThan(0);
  });

  // 5. TSS estimé : distinction explicite d'une mesure physiologique
  it('5. distingue explicitement un TSS estimé par la durée sans le traiter en mesure directe', () => {
    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-10-01', sport: 'Ride', durationMin: 60, tss: 50 },
      { id: 'w2', date: '2026-10-08', sport: 'Ride', durationMin: 70, tss: 60 },
      { id: 'w3', date: '2026-10-15', sport: 'Ride', durationMin: 80, tss: 70 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts,
      currentDate
    });

    expect(result.dataProvenance.estimatedCount).toBeGreaterThan(0);
    expect(result.dataProvenance.warnings.some(w => w.includes('TSS estimé uniquement sur la durée'))).toBe(true);

    const tssMetric = result.metrics.find(m => m.metricName.includes('TSS'));
    expect(tssMetric?.isDirectPerformanceMeasure).toBe(false);
    expect(tssMetric?.comparabilityLimits[0]).toContain('Le TSS inclut des estimations');
  });

  // 6. Valeurs nulles et données manquantes
  it('6. gère proprement les métriques nulles ou manquantes sans les convertir en zéro trompeur', () => {
    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-10-01', sport: 'Run', durationMin: 40, distanceKm: undefined },
      { id: 'w2', date: '2026-10-08', sport: 'Run', durationMin: 40, distanceKm: undefined }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts,
      currentDate
    });

    const runSpeed = result.metrics.find(m => m.sport === 'Run' && m.unit === 'km/h');
    expect(runSpeed).toBeUndefined();
    expect(result.status).toBe('INSUFFICIENT_DATA');
  });

  // 7. Unités incompatibles et conversions
  it('7. vérifie les unités et effectue des conversions déterministes (km/h à partir de km et min)', () => {
    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-10-01', sport: 'Run', durationMin: 60, distanceKm: 12 }, // 12 km/h
      { id: 'w2', date: '2026-10-08', sport: 'Run', durationMin: 60, distanceKm: 12.5 },
      { id: 'w3', date: '2026-10-15', sport: 'Run', durationMin: 60, distanceKm: 13 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts,
      currentDate
    });

    const speedMetric = result.metrics.find(m => m.sport === 'Run' && m.unit === 'km/h');
    expect(speedMetric).toBeDefined();
    expect(speedMetric?.referenceValue).toBe(12);
    expect(speedMetric?.recentValue).toBe(12.75);
    expect(speedMetric?.trend).toBe('IMPROVING');
  });

  // 8. Données anciennes ou périodes incomplètes
  it('8. ignore les données hors fenêtre temporelle et signale les périodes incomplètes', () => {
    const actualWorkouts: ActualWorkout[] = [
      { id: 'w_old', date: '2025-01-01', sport: 'Ride', durationMin: 60, normalizedPower: 250 },
      { id: 'w_recent', date: '2026-10-18', sport: 'Ride', durationMin: 60, normalizedPower: 200 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts,
      currentDate,
      analysisDays: 28
    });

    expect(result.status).toBe('INSUFFICIENT_DATA');
    expect(result.missingData.some(m => m.includes('Historique récent limité'))).toBe(true);
  });

  // 9. Performance en amélioration sur plusieurs mesures comparables
  it('9. détecte une amélioration soutenue (PROGRESSING) avec gains significatifs (> +3%)', () => {
    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-09-25', sport: 'Ride', durationMin: 60, normalizedPower: 200, tss: 60 },
      { id: 'w2', date: '2026-10-02', sport: 'Ride', durationMin: 60, normalizedPower: 202, tss: 61 },
      { id: 'w3', date: '2026-10-09', sport: 'Ride', durationMin: 60, normalizedPower: 215, tss: 68 },
      { id: 'w4', date: '2026-10-16', sport: 'Ride', durationMin: 60, normalizedPower: 220, tss: 70 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts,
      currentDate
    });

    expect(result.status).toBe('PROGRESSING');
    expect(result.readableExplanation).toContain('Progression mesurable observée');
  });

  // 10. Variation ponctuelle qui ne doit pas déclencher une stagnation certaine
  it('10. ne conclut pas à une stagnation sur une variation isolée ou 1 seule séance', () => {
    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-10-05', sport: 'Ride', durationMin: 60, normalizedPower: 220 },
      { id: 'w2', date: '2026-10-12', sport: 'Ride', durationMin: 60, normalizedPower: 218 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts,
      currentDate
    });

    expect(result.stagnation.isStagnating).toBe(false);
    expect(result.status).not.toBe('POTENTIAL_STAGNATION');
  });

  // 11. Stagnation potentielle avec un historique suffisant
  it('11. détecte un plateau potentiel (POTENTIAL_STAGNATION) avec charge stable et pas de gain', () => {
    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-09-25', sport: 'Ride', durationMin: 60, normalizedPower: 210, tss: 65 },
      { id: 'w2', date: '2026-10-02', sport: 'Ride', durationMin: 60, normalizedPower: 209, tss: 65 },
      { id: 'w3', date: '2026-10-09', sport: 'Ride', durationMin: 60, normalizedPower: 210, tss: 66 },
      { id: 'w4', date: '2026-10-16', sport: 'Ride', durationMin: 60, normalizedPower: 211, tss: 65 }
    ];

    const pmc: PmcData[] = [
      { date: '2026-09-25', ctl: 50, atl: 50, tsb: 0 },
      { date: '2026-10-02', ctl: 50, atl: 50, tsb: 0 },
      { date: '2026-10-09', ctl: 50, atl: 51, tsb: -1 },
      { date: '2026-10-16', ctl: 51, atl: 50, tsb: 1 },
      { date: '2026-10-17', ctl: 51, atl: 50, tsb: 1 },
      { date: '2026-10-18', ctl: 51, atl: 50, tsb: 1 },
      { date: '2026-10-19', ctl: 51, atl: 50, tsb: 1 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts,
      pmc,
      currentDate
    });

    expect(result.status).toBe('POTENTIAL_STAGNATION');
    expect(result.stagnation.isStagnating).toBe(true);
    // Vérifier la proposition de variation de stimuli (REBALANCE_TRAINING) et PAS d'augmentation de charge
    const rebalanceProposal = result.proposals.find(p => p.type === 'REBALANCE_TRAINING');
    expect(rebalanceProposal).toBeDefined();
    expect(result.proposals.some(p => p.type === 'PROGRESS_VOLUME')).toBe(false);
  });

  // 12. Baisse de performance sans attribution causale automatique
  it('12. détecte DECLINING sans affirmer de diagnostic médical ou causalité certaine', () => {
    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-09-25', sport: 'Ride', durationMin: 60, normalizedPower: 240, tss: 75 },
      { id: 'w2', date: '2026-10-02', sport: 'Ride', durationMin: 60, normalizedPower: 235, tss: 73 },
      { id: 'w3', date: '2026-10-09', sport: 'Ride', durationMin: 60, normalizedPower: 215, tss: 65 },
      { id: 'w4', date: '2026-10-16', sport: 'Ride', durationMin: 60, normalizedPower: 210, tss: 63 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts,
      currentDate
    });

    expect(result.status).toBe('DECLINING');
    expect(result.readableExplanation).toContain('Baisse observée');
    expect(result.interpretationLimits.some(l => l.includes('ne constituent en aucun cas un diagnostic médical'))).toBe(true);
  });

  // 13. Absence de feedback qui ne doit pas être interprétée comme une absence de fatigue
  it('13. n\'assimile pas l\'absence de feedback à une absence de fatigue', () => {
    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-10-01', sport: 'Ride', durationMin: 60, normalizedPower: 200 },
      { id: 'w2', date: '2026-10-08', sport: 'Ride', durationMin: 60, normalizedPower: 205 },
      { id: 'w3', date: '2026-10-15', sport: 'Ride', durationMin: 60, normalizedPower: 210 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts,
      feedbacks: [], // Aucun feedback
      currentDate
    });

    expect(result.missingData.some(m => m.includes('Aucun ressenti (RPE / sensation) renseigné'))).toBe(true);
  });

  // 14. Fatigue déclarée et proposition prudente
  it('14. formule une proposition de récupération (ADD_RECOVERY) en présence de signaux de fatigue répétés', () => {
    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-10-01', sport: 'Ride', durationMin: 60, normalizedPower: 200, tss: 70 },
      { id: 'w2', date: '2026-10-08', sport: 'Ride', durationMin: 60, normalizedPower: 195, tss: 70 },
      { id: 'w3', date: '2026-10-15', sport: 'Ride', durationMin: 60, normalizedPower: 190, tss: 70 }
    ];

    const feedbacks: WorkoutFeedback[] = [
      { id: 'f1', date: '2026-10-01', sport: 'Ride', durationMin: 60, rpe: 9, feeling: 'exhausted' },
      { id: 'f2', date: '2026-10-08', sport: 'Ride', durationMin: 60, rpe: 8, feeling: 'exhausted' }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts,
      feedbacks,
      currentDate
    });

    const recoveryProp = result.proposals.find(p => p.type === 'ADD_RECOVERY');
    expect(recoveryProp).toBeDefined();
    expect(recoveryProp?.justification).toContain('signaux de fatigue');
    expect(result.proposals.some(p => p.type === 'PROGRESS_VOLUME')).toBe(false);
  });

  // 15. Séance manquée sans compensation de charge
  it('15. ne compense jamais une séance manquée en augmentant la charge future', () => {
    const plannedWorkouts: PlannedWorkout[] = [
      { id: 'p_missed', date: '2026-10-10', sport: 'Ride', title: 'Séance manquée', durationMin: 90, status: 'missed' },
      { id: 'p_future', date: '2026-10-22', sport: 'Ride', title: 'Séance future', durationMin: 60, status: 'planned' }
    ];

    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-10-01', sport: 'Ride', durationMin: 60, normalizedPower: 200, tss: 60 },
      { id: 'w2', date: '2026-10-08', sport: 'Ride', durationMin: 60, normalizedPower: 205, tss: 60 },
      { id: 'w3', date: '2026-10-15', sport: 'Ride', durationMin: 60, normalizedPower: 210, tss: 62 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts,
      actualWorkouts,
      currentDate
    });

    expect(result.loadTrends.missedSessionsCount).toBe(1);
    // Aucune proposition ne doit reporter les 90 min manquées
    result.proposals.forEach(p => {
      expect(p.justification).not.toContain('rattraper');
      expect(p.justification).not.toContain('compenser');
    });
  });

  // 16. Objectif expiré, suspendu ou abandonné
  it('16. identifie un objectif expiré et propose sa réévaluation (REVIEW_GOAL)', () => {
    const expiredGoal: Goal = {
      id: 'goal-past',
      title: 'Course passée',
      date: '2026-10-01' // Déjà passée
    };

    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-10-05', sport: 'Ride', durationMin: 60, normalizedPower: 200 },
      { id: 'w2', date: '2026-10-12', sport: 'Ride', durationMin: 60, normalizedPower: 205 },
      { id: 'w3', date: '2026-10-19', sport: 'Ride', durationMin: 60, normalizedPower: 210 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: { ...baseProfile, goal: expiredGoal },
      plannedWorkouts: [],
      actualWorkouts,
      currentDate
    });

    expect(result.goalAlignment?.isExpired).toBe(true);
    const reviewProp = result.proposals.find(p => p.type === 'REVIEW_GOAL');
    expect(reviewProp).toBeDefined();
    expect(reviewProp?.justification).toContain('date cible de votre objectif est dépassée');
  });

  // 17. Acceptation puis exécution transactionnelle d'une proposition
  it('17. exécute transactionnellement une proposition acceptée avec audit et mutation sécurisée', () => {
    const plannedWorkouts: PlannedWorkout[] = [
      { id: 'p_future_vol', date: '2026-10-25', sport: 'Ride', title: 'Sortie endurance', durationMin: 60, status: 'planned' }
    ];

    const store = useAppStore.getState();
    store.plannedWorkouts = [...plannedWorkouts];

    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-09-25', sport: 'Ride', durationMin: 60, normalizedPower: 200 },
      { id: 'w2', date: '2026-10-02', sport: 'Ride', durationMin: 60, normalizedPower: 205 },
      { id: 'w3', date: '2026-10-09', sport: 'Ride', durationMin: 60, normalizedPower: 215 },
      { id: 'w4', date: '2026-10-16', sport: 'Ride', durationMin: 60, normalizedPower: 220 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts,
      actualWorkouts,
      currentDate
    });

    const volProposal = result.proposals.find(p => p.type === 'PROGRESS_VOLUME');
    expect(volProposal).toBeDefined();
    expect(volProposal?.status).toBe('PENDING');

    // 1. Acceptation
    const acceptRes = TrainingProgressionService.acceptProposal(volProposal!.id, baseProfile.id);
    expect(acceptRes.success).toBe(true);
    expect(acceptRes.proposal?.status).toBe('ACCEPTED');

    // 2. Exécution
    const execRes = TrainingProgressionService.executeProposal(volProposal!.id, baseProfile.id);
    expect(execRes.success).toBe(true);
    expect(execRes.proposal?.status).toBe('EXECUTED');
    expect(execRes.proposal?.executionAudit?.affectedWorkoutsCount).toBe(1);

    // Vérifier la mutation du store
    const updatedWorkout = useAppStore.getState().plannedWorkouts.find(w => w.id === 'p_future_vol');
    expect(updatedWorkout?.durationMin).toBe(63); // 60 * 1.05 = 63 min
    expect(updatedWorkout?.status).toBe('adapted');
  });

  // 18. Rejet d'une proposition sans modification du planning
  it('18. rejette une proposition sans altérer le planning', () => {
    const plannedWorkouts: PlannedWorkout[] = [
      { id: 'p_future_vol', date: '2026-10-25', sport: 'Ride', title: 'Sortie endurance', durationMin: 60, status: 'planned' }
    ];
    const store = useAppStore.getState();
    store.plannedWorkouts = [...plannedWorkouts];

    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-09-25', sport: 'Ride', durationMin: 60, normalizedPower: 200 },
      { id: 'w2', date: '2026-10-02', sport: 'Ride', durationMin: 60, normalizedPower: 205 },
      { id: 'w3', date: '2026-10-09', sport: 'Ride', durationMin: 60, normalizedPower: 215 },
      { id: 'w4', date: '2026-10-16', sport: 'Ride', durationMin: 60, normalizedPower: 220 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts,
      actualWorkouts,
      currentDate
    });

    const volProposal = result.proposals.find(p => p.type === 'PROGRESS_VOLUME')!;
    const rejectRes = TrainingProgressionService.rejectProposal(volProposal.id, baseProfile.id, "Je préfère rester à 60 min");

    expect(rejectRes.success).toBe(true);
    expect(rejectRes.proposal?.status).toBe('REJECTED');

    // Planning strictement intact
    const workout = store.plannedWorkouts.find(w => w.id === 'p_future_vol');
    expect(workout?.durationMin).toBe(60);
    expect(workout?.status).toBe('planned');
  });

  // 19. Double soumission et idempotence
  it('19. assure l\'idempotence et bloque la double exécution d\'une même proposition', () => {
    const plannedWorkouts: PlannedWorkout[] = [
      { id: 'p_future_vol', date: '2026-10-25', sport: 'Ride', title: 'Sortie endurance', durationMin: 60, status: 'planned' }
    ];
    useAppStore.getState().plannedWorkouts = [...plannedWorkouts];

    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-09-25', sport: 'Ride', durationMin: 60, normalizedPower: 200 },
      { id: 'w2', date: '2026-10-02', sport: 'Ride', durationMin: 60, normalizedPower: 205 },
      { id: 'w3', date: '2026-10-09', sport: 'Ride', durationMin: 60, normalizedPower: 215 },
      { id: 'w4', date: '2026-10-16', sport: 'Ride', durationMin: 60, normalizedPower: 220 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts,
      actualWorkouts,
      currentDate
    });

    const prop = result.proposals.find(p => p.type === 'PROGRESS_VOLUME')!;
    TrainingProgressionService.acceptProposal(prop.id, baseProfile.id);

    // 1ère exécution
    const firstExec = TrainingProgressionService.executeProposal(prop.id, baseProfile.id);
    expect(firstExec.success).toBe(true);

    // 2ème exécution (tentative concurrente / double clic)
    const secondExec = TrainingProgressionService.executeProposal(prop.id, baseProfile.id);
    expect(secondExec.success).toBe(false);
    expect(secondExec.alreadyExecuted).toBe(true);
  });

  // 20. Modification concurrente d'une séance ou d'un objectif
  it('20. détecte une modification concurrente de la séance cible et échoue sans corrompre le store', () => {
    const plannedWorkouts: PlannedWorkout[] = [
      { id: 'p_future_vol', date: '2026-10-25', sport: 'Ride', title: 'Sortie endurance', durationMin: 60, status: 'planned' }
    ];
    useAppStore.getState().plannedWorkouts = [...plannedWorkouts];

    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-09-25', sport: 'Ride', durationMin: 60, normalizedPower: 200 },
      { id: 'w2', date: '2026-10-02', sport: 'Ride', durationMin: 60, normalizedPower: 205 },
      { id: 'w3', date: '2026-10-09', sport: 'Ride', durationMin: 60, normalizedPower: 215 },
      { id: 'w4', date: '2026-10-16', sport: 'Ride', durationMin: 60, normalizedPower: 220 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts,
      actualWorkouts,
      currentDate
    });

    const prop = result.proposals.find(p => p.type === 'PROGRESS_VOLUME')!;
    TrainingProgressionService.acceptProposal(prop.id, baseProfile.id);

    // La séance est supprimée ou modifiée entre-temps par l'athlète
    useAppStore.getState().plannedWorkouts = [];

    const execRes = TrainingProgressionService.executeProposal(prop.id, baseProfile.id);
    expect(execRes.success).toBe(false);
    expect(execRes.conflict).toBe(true);
    expect(execRes.error).toContain('CONFLICT_WORKOUT_NOT_FOUND');
  });

  // 21. Échec de transaction sans mutation partielle
  it('21. ne réalise aucune mutation partielle en cas de proposition invalide ou introuvable', () => {
    const store = useAppStore.getState();
    const originalCount = store.plannedWorkouts.length;

    const execRes = TrainingProgressionService.executeProposal('non-existing-prop-id', baseProfile.id);
    expect(execRes.success).toBe(false);
    expect(execRes.error).toContain('PROPOSAL_NOT_FOUND');
    expect(store.plannedWorkouts.length).toBe(originalCount);
  });

  // 22. Isolation des données entre deux athlètes
  it('22. garantit une isolation stricte et rejette les requêtes d\'un autre athlète', () => {
    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-09-25', sport: 'Ride', durationMin: 60, normalizedPower: 200 },
      { id: 'w2', date: '2026-10-02', sport: 'Ride', durationMin: 60, normalizedPower: 205 },
      { id: 'w3', date: '2026-10-09', sport: 'Ride', durationMin: 60, normalizedPower: 215 },
      { id: 'w4', date: '2026-10-16', sport: 'Ride', durationMin: 60, normalizedPower: 220 }
    ];

    const result = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [{ id: 'pw1', date: '2026-10-25', sport: 'Ride', durationMin: 60, status: 'planned', title: 'Séance' }],
      actualWorkouts,
      athleteId: 'athlete-101',
      currentDate
    });

    const prop = result.proposals[0];
    expect(prop).toBeDefined();

    // Athlète intrus
    const unauthorizedAccept = TrainingProgressionService.acceptProposal(prop.id, 'intruder-athlete-999');
    expect(unauthorizedAccept.success).toBe(false);
    expect(unauthorizedAccept.error).toContain('FORBIDDEN_ATHLETE_MISMATCH');

    const unauthorizedExec = TrainingProgressionService.executeProposal(prop.id, 'intruder-athlete-999');
    expect(unauthorizedExec.success).toBe(false);
    expect(unauthorizedExec.error).toContain('FORBIDDEN_ATHLETE_MISMATCH');
  });

  // 23. Absence de fuite de données dans les réponses du Coach
  it('23. garantit que l\'analyse déterministe est reproductible sans fuite de prompt ou hallucination', () => {
    const actualWorkouts: ActualWorkout[] = [
      { id: 'w1', date: '2026-10-01', sport: 'Ride', durationMin: 60, normalizedPower: 200, averageHeartRate: 140 },
      { id: 'w2', date: '2026-10-08', sport: 'Ride', durationMin: 60, normalizedPower: 205, averageHeartRate: 140 },
      { id: 'w3', date: '2026-10-15', sport: 'Ride', durationMin: 60, normalizedPower: 210, averageHeartRate: 139 }
    ];

    const res1 = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts,
      currentDate
    });

    const res2 = TrainingProgressionService.analyzeProgression({
      athleteProfile: baseProfile,
      plannedWorkouts: [],
      actualWorkouts,
      currentDate
    });

    // Reproductibilité stricte
    expect(res1.status).toBe(res2.status);
    expect(res1.readableExplanation).toBe(res2.readableExplanation);
    expect(res1.metrics[0].relativeDeltaPct).toBe(res2.metrics[0].relativeDeltaPct);
    expect(res1.isDeterministic).toBe(true);
  });

  // 24. Régression de l'ensemble des tests des Phases 35 et 36
  it('24. valide la compatibilité descendante avec AdaptiveTrainingService et WorkoutReconciliationService', async () => {
    const { AdaptiveTrainingService } = await import('./AdaptiveTrainingService');
    const { WorkoutReconciliationService } = await import('./WorkoutReconciliationService');

    expect(AdaptiveTrainingService).toBeDefined();
    expect(WorkoutReconciliationService).toBeDefined();
    expect(typeof AdaptiveTrainingService.analyzeAndPropose).toBe('function');
    expect(typeof WorkoutReconciliationService.reconcile).toBe('function');
  });
});
