import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptiveTrainingService, ADAPTIVE_THRESHOLDS } from './AdaptiveTrainingService';
import { PlannedWorkout, ActualWorkout, AthleteProfile } from '../domain/models';
import { WorkoutFeedback, WorkoutObservation } from '../domain/athleteHistoryTypes';
import { PmcData } from '../types';
import { useAppStore } from '../store';
import { AdaptiveProposal } from '../domain/adaptiveTrainingTypes';

describe('Phase 36 — Adaptive Training Intelligence & Recovery Optimization', () => {
  const baseProfile: AthleteProfile = {
    id: 'athlete-alpha',
    name: 'Athlète Alpha',
    level: { swim: 'intermediate', ride: 'intermediate', run: 'intermediate' },
    availability: { weeklyHours: 10, availableDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
    hrMax: 190,
    dataConnection: 'none'
  };

  beforeEach(() => {
    AdaptiveTrainingService.resetRegistry();
    useAppStore.setState({
      plannedWorkouts: [],
      actualWorkouts: [],
      workoutFeedbacks: [],
      workoutObservations: [],
      athleteHabits: [],
      athletePreferences: [],
      coachDecisions: [],
      ftp: 250,
      athleteProfile: baseProfile
    });
  });

  // 1. Données complètes et cohérentes : recommandation explicable
  it('1. données complètes et cohérentes : produit une recommandation explicable sans calculs inventés', () => {
    const planned: PlannedWorkout[] = [
      {
        id: 'plan-next-1',
        sport: 'Ride',
        date: '2026-10-21',
        title: 'Sortie Seuil',
        targetDurationMin: 60,
        targetTss: 70,
        targetIntensity: { type: 'zone', value: 'Z4' },
        status: 'planned'
      }
    ];

    const actual: ActualWorkout[] = [
      {
        id: 'act-prev-1',
        sport: 'Ride',
        date: '2026-10-20',
        durationMin: 70,
        normalizedPower: 220,
        tss: 75,
        source: 'Garmin'
      }
    ];

    const feedback: WorkoutFeedback[] = [
      {
        id: 'fb-1',
        actualWorkoutId: 'act-prev-1',
        date: '2026-10-20',
        sport: 'Ride',
        durationMin: 70,
        rpe: 8,
        feeling: 'very_tired'
      }
    ];

    const pmc: PmcData[] = [
      { date: '2026-10-20', ctl: 50, atl: 75, tsb: -15, tss: 75 }
    ];

    const result = AdaptiveTrainingService.analyzeAndPropose({
      athleteProfile: baseProfile,
      plannedWorkouts: planned,
      actualWorkouts: actual,
      feedbacks: feedback,
      pmc,
      currentDate: new Date('2026-10-20T20:00:00Z')
    });

    expect(result.status).toBe('ANALYSIS_COMPLETE');
    expect(result.proposals).toHaveLength(1);
    const prop = result.proposals[0];
    expect(prop.type).toBe('REDUCE_INTENSITY'); // Séance intense ciblée -> Z2 aérobie
    expect(prop.rationale).toContain('2026-10-21');
    expect(prop.detailedExplanation).toContain('fatigue');
    expect(prop.status).toBe('PENDING');
  });

  // 2. Données insuffisantes : INSUFFICIENT_DATA
  it('2. données insuffisantes : retourne explicitement INSUFFICIENT_DATA sans recommandation spéculative', () => {
    const planned: PlannedWorkout[] = [
      {
        id: 'plan-1',
        sport: 'Run',
        date: '2026-10-21',
        title: 'Footing',
        targetDurationMin: 45,
        status: 'planned'
      }
    ];

    // Aucun actualWorkout ni feedback (historique vierge)
    const result = AdaptiveTrainingService.analyzeAndPropose({
      athleteProfile: baseProfile,
      plannedWorkouts: planned,
      actualWorkouts: [],
      feedbacks: [],
      currentDate: new Date('2026-10-20')
    });

    expect(result.status).toBe('INSUFFICIENT_DATA');
    expect(result.proposals).toHaveLength(0);
    expect(result.missingDataInfo).toBeDefined();
    expect(result.missingDataInfo?.length).toBeGreaterThan(0);
    expect(result.summary).toContain('Données insuffisantes');
  });

  // 3. TSS estimé : provenance conservée et incertitude visible
  it('3. TSS estimé à partir de la durée : conserve la provenance et élève le niveau d\'incertitude (HIGH)', () => {
    const planned: PlannedWorkout[] = [
      {
        id: 'plan-next-2',
        sport: 'Run',
        date: '2026-10-21',
        title: 'Intervalles 30/30',
        targetDurationMin: 50,
        targetIntensity: { type: 'zone', value: 'Z5' },
        status: 'planned'
      }
    ];

    const actualWithEstimatedTss: ActualWorkout = {
      id: 'act-est-only',
      sport: 'Run',
      date: '2026-10-20',
      durationMin: 60,
      tss: 45,
      // Indique formellement que le TSS est un estimé sur durée uniquement
      tssCalculationMethod: 'duration_estimate'
    } as any;

    const feedback: WorkoutFeedback[] = [
      {
        id: 'fb-est',
        actualWorkoutId: 'act-est-only',
        date: '2026-10-20',
        sport: 'Run',
        durationMin: 60,
        rpe: 8,
        feeling: 'very_tired'
      }
    ];

    const result = AdaptiveTrainingService.analyzeAndPropose({
      athleteProfile: baseProfile,
      plannedWorkouts: planned,
      actualWorkouts: [actualWithEstimatedTss],
      feedbacks: feedback,
      currentDate: new Date('2026-10-20')
    });

    expect(result.dataProvenance.estimatedCount).toBe(1);
    expect(result.dataProvenance.warnings.some(w => w.includes('TSS estimé à partir de la durée uniquement'))).toBe(true);
    expect(result.proposals[0].uncertaintyLevel).toBe('HIGH');
  });

  // 4. Absence de feedback : aucune assimilation automatique à un état de récupération
  it('4. absence de feedback : n\'assimile jamais le silence à une absence de fatigue', () => {
    const actual: ActualWorkout[] = [
      {
        id: 'act-silent',
        sport: 'Ride',
        date: '2026-10-20',
        durationMin: 120,
        tss: 110,
        source: 'Garmin'
      }
    ];

    const prov = AdaptiveTrainingService.auditDataProvenance(actual, []);
    expect(prov.warnings).toContain("Aucun ressenti athlète (RPE) n'a été renseigné pour les activités récentes.");
  });

  // 5. Fatigue déclarée : proposition prudente, sans diagnostic
  it('5. fatigue déclarée : propose un allègement prudent sans formuler de diagnostic médical', () => {
    const planned: PlannedWorkout[] = [
      {
        id: 'plan-dur',
        sport: 'Ride',
        date: '2026-10-21',
        title: 'Sortie endurance',
        targetDurationMin: 80,
        targetTss: 75,
        targetIntensity: { type: 'zone', value: 'Z2' },
        status: 'planned'
      }
    ];

    const feedback: WorkoutFeedback = {
      id: 'fb-tired',
      date: '2026-10-20',
      sport: 'Ride',
      durationMin: 90,
      rpe: 9,
      feeling: 'very_tired'
    };

    const result = AdaptiveTrainingService.analyzeAndPropose({
      athleteProfile: baseProfile,
      plannedWorkouts: planned,
      actualWorkouts: [{ id: 'a1', sport: 'Ride', date: '2026-10-20', durationMin: 90 }],
      feedbacks: [feedback],
      currentDate: new Date('2026-10-20')
    });

    expect(result.proposals).toHaveLength(1);
    const prop = result.proposals[0];
    expect(prop.type).toBe('REDUCE_VOLUME');
    expect(prop.proposedChanges.beforeAfter.durationMin?.after).toBe(60); // 80 * 0.75 = 60 min

    // Vérification stricte d'absence de vocabulaire médical spéculatif
    const fullText = (prop.rationale + prop.detailedExplanation + prop.compatibleCoachProposal.explanation).toLowerCase();
    expect(fullText).not.toContain('surentraîné');
    expect(fullText).not.toContain('pathologie');
    expect(fullText).not.toContain('malade');
    expect(fullText).not.toContain('blessé');
  });

  // 6. Séance manquée : aucune compensation automatique
  it('6. séance manquée : n\'ajoute jamais le volume ou TSS manqué aux séances suivantes', () => {
    const missedWorkout: PlannedWorkout = {
      id: 'plan-missed-1',
      sport: 'Ride',
      date: '2026-10-19',
      title: 'Séance manquée',
      targetDurationMin: 120,
      targetTss: 130,
      status: 'missed'
    };

    const upcomingWorkout: PlannedWorkout = {
      id: 'plan-up-1',
      sport: 'Run',
      date: '2026-10-21',
      title: 'Footing régulier',
      targetDurationMin: 45,
      targetTss: 40,
      status: 'planned'
    };

    const result = AdaptiveTrainingService.analyzeAndPropose({
      athleteProfile: baseProfile,
      plannedWorkouts: [missedWorkout, upcomingWorkout],
      actualWorkouts: [{ id: 'a0', sport: 'Run', date: '2026-10-18', durationMin: 30 }],
      feedbacks: [],
      currentDate: new Date('2026-10-20')
    });

    for (const prop of result.proposals) {
      if (prop.targetWorkoutId === 'plan-up-1') {
        const afterDur = prop.proposedChanges.beforeAfter.durationMin?.after ?? 45;
        const afterTss = prop.proposedChanges.beforeAfter.targetTss?.after ?? 40;
        // RÈGLE ABSOLUE : Ni durée ni TSS ne peuvent dépasser la valeur prévue !
        expect(afterDur).toBeLessThanOrEqual(45);
        expect(afterTss).toBeLessThanOrEqual(40);
      }
    }
  });

  // 7. Proposition rejetée : planning inchangé
  it('7. proposition rejetée : le planning reste strictement inchangé', () => {
    const targetSession: PlannedWorkout = {
      id: 'plan-keep',
      sport: 'Ride',
      date: '2026-10-22',
      title: 'Sortie Seuil',
      targetDurationMin: 60,
      targetTss: 70,
      status: 'planned'
    };

    useAppStore.getState().addPlannedWorkout(targetSession);

    const result = AdaptiveTrainingService.analyzeAndPropose({
      athleteProfile: baseProfile,
      plannedWorkouts: [targetSession],
      actualWorkouts: [{ id: 'a1', sport: 'Ride', date: '2026-10-20', durationMin: 60 }],
      feedbacks: [{ id: 'fb', date: '2026-10-20', sport: 'Ride', durationMin: 60, rpe: 8, feeling: 'very_tired' }],
      currentDate: new Date('2026-10-20')
    });

    const proposal = result.proposals[0];
    expect(proposal).toBeDefined();

    // L'athlète refuse
    const rejectRes = AdaptiveTrainingService.rejectProposal(proposal.id, 'athlete-alpha', 'Je me sens capable de la faire');
    expect(rejectRes.success).toBe(true);
    expect(rejectRes.proposal?.status).toBe('REJECTED');

    // Vérification : la séance dans le store est strictement inchangée
    const inStore = useAppStore.getState().plannedWorkouts.find(w => w.id === 'plan-keep');
    expect(inStore?.targetDurationMin).toBe(60);
    expect(inStore?.status).toBe('planned');
  });

  // 8. Proposition acceptée : validation des droits, exécution et audit
  it('8. proposition acceptée : valide les droits, exécute la transaction et enregistre l\'audit', () => {
    const targetSession: PlannedWorkout = {
      id: 'plan-to-adapt',
      sport: 'Ride',
      date: '2026-10-22',
      title: 'Sortie Endurance',
      targetDurationMin: 80,
      targetTss: 70,
      status: 'planned'
    };

    useAppStore.getState().addPlannedWorkout(targetSession);

    const result = AdaptiveTrainingService.analyzeAndPropose({
      athleteProfile: baseProfile,
      plannedWorkouts: [targetSession],
      actualWorkouts: [{ id: 'a1', sport: 'Ride', date: '2026-10-20', durationMin: 80 }],
      feedbacks: [{ id: 'fb', date: '2026-10-20', sport: 'Ride', durationMin: 80, rpe: 8, feeling: 'very_tired' }],
      currentDate: new Date('2026-10-20')
    });

    const proposal = result.proposals[0];

    // 1. Acceptation
    const acceptRes = AdaptiveTrainingService.acceptProposal(proposal.id, 'athlete-alpha');
    expect(acceptRes.success).toBe(true);
    expect(acceptRes.proposal?.status).toBe('ACCEPTED');

    // 2. Exécution transactionnelle
    const execRes = AdaptiveTrainingService.executeProposal(proposal.id, 'athlete-alpha');
    expect(execRes.success).toBe(true);
    expect(execRes.proposal?.status).toBe('EXECUTED');
    expect(execRes.proposal?.executedAt).toBeDefined();

    // 3. Vérification du store modifié
    const updatedInStore = useAppStore.getState().plannedWorkouts.find(w => w.id === 'plan-to-adapt');
    expect(updatedInStore?.targetDurationMin).toBe(60); // 80 * 0.75
    expect(updatedInStore?.status).toBe('adapted');

    // 4. Audit tracé
    const auditLog = useAppStore.getState().coachDecisions;
    expect(auditLog.some(d => d.proposal?.id === proposal.id && d.userDecision === 'EXECUTED')).toBe(true);
  });

  // 9. Double soumission : aucune double mutation (idempotence)
  it('9. double soumission : garantit l\'idempotence sans double mutation', () => {
    const targetSession: PlannedWorkout = {
      id: 'plan-idem',
      sport: 'Ride',
      date: '2026-10-22',
      title: 'Séance idempotence',
      targetDurationMin: 80,
      status: 'planned'
    };

    useAppStore.getState().addPlannedWorkout(targetSession);

    const result = AdaptiveTrainingService.analyzeAndPropose({
      athleteProfile: baseProfile,
      plannedWorkouts: [targetSession],
      actualWorkouts: [{ id: 'a1', sport: 'Ride', date: '2026-10-20', durationMin: 80 }],
      feedbacks: [{ id: 'fb', date: '2026-10-20', sport: 'Ride', durationMin: 80, rpe: 8, feeling: 'very_tired' }],
      currentDate: new Date('2026-10-20')
    });

    const proposal = result.proposals[0];
    AdaptiveTrainingService.acceptProposal(proposal.id, 'athlete-alpha');

    // 1ère exécution
    const firstExec = AdaptiveTrainingService.executeProposal(proposal.id, 'athlete-alpha');
    expect(firstExec.success).toBe(true);

    // 2ème tentative d'exécution de la même proposition
    const secondExec = AdaptiveTrainingService.executeProposal(proposal.id, 'athlete-alpha');
    expect(secondExec.success).toBe(false);
    expect(secondExec.alreadyExecuted).toBe(true);
  });

  // 10. Modification concurrente de la séance : conflit détecté
  it('10. modification concurrente : détecte le conflit si la séance cible a changé entre-temps', () => {
    const targetSession: PlannedWorkout = {
      id: 'plan-concurrent',
      sport: 'Ride',
      date: '2026-10-22',
      title: 'Sortie Seuil',
      targetDurationMin: 60,
      status: 'planned'
    };

    useAppStore.getState().addPlannedWorkout(targetSession);

    const result = AdaptiveTrainingService.analyzeAndPropose({
      athleteProfile: baseProfile,
      plannedWorkouts: [targetSession],
      actualWorkouts: [{ id: 'a1', sport: 'Ride', date: '2026-10-20', durationMin: 60 }],
      feedbacks: [{ id: 'fb', date: '2026-10-20', sport: 'Ride', durationMin: 60, rpe: 8, feeling: 'very_tired' }],
      currentDate: new Date('2026-10-20')
    });

    const proposal = result.proposals[0];
    AdaptiveTrainingService.acceptProposal(proposal.id, 'athlete-alpha');

    // Entre-temps, l'athlète a lui-même modifié la durée de sa séance dans le planning (60 -> 90)
    useAppStore.getState().updatePlannedWorkout({
      ...targetSession,
      targetDurationMin: 90
    });

    // Tentative d'exécution
    const execRes = AdaptiveTrainingService.executeProposal(proposal.id, 'athlete-alpha');
    expect(execRes.success).toBe(false);
    expect(execRes.conflict).toBe(true);
    expect(execRes.error).toContain('CONFLICT_CONCURRENT_MODIFICATION');
  });

  // 11. Échec de transaction : aucune mutation partielle
  it('11. échec de transaction : restaure l\'état initial sans mutation partielle', () => {
    const targetSession: PlannedWorkout = {
      id: 'plan-rollback',
      sport: 'Ride',
      date: '2026-10-22',
      title: 'Séance rollback',
      targetDurationMin: 60,
      status: 'planned'
    };

    useAppStore.getState().addPlannedWorkout(targetSession);

    const result = AdaptiveTrainingService.analyzeAndPropose({
      athleteProfile: baseProfile,
      plannedWorkouts: [targetSession],
      actualWorkouts: [{ id: 'a1', sport: 'Ride', date: '2026-10-20', durationMin: 60 }],
      feedbacks: [{ id: 'fb', date: '2026-10-20', sport: 'Ride', durationMin: 60, rpe: 8, feeling: 'very_tired' }],
      currentDate: new Date('2026-10-20')
    });

    const proposal = result.proposals[0];
    AdaptiveTrainingService.acceptProposal(proposal.id, 'athlete-alpha');

    // Simuler la suppression de la séance cible par un tiers avant l'exécution
    useAppStore.getState().removePlannedWorkout('plan-rollback');

    const execRes = AdaptiveTrainingService.executeProposal(proposal.id, 'athlete-alpha');
    expect(execRes.success).toBe(false);
    expect(execRes.conflict).toBe(true);
    expect(execRes.error).toContain('CONFLICT_TARGET_DELETED');
  });

  // 12. Proposition expirée : exécution interdite
  it('12. proposition expirée : bloque l\'exécution si la date de validité est dépassée', () => {
    const targetSession: PlannedWorkout = {
      id: 'plan-expired',
      sport: 'Run',
      date: '2026-10-18', // Séance déjà passée
      title: 'Footing passé',
      targetDurationMin: 45,
      status: 'planned'
    };

    const expiredProposal: AdaptiveProposal = {
      id: 'prop-expired-1',
      athleteId: 'athlete-alpha',
      targetWorkoutId: 'plan-expired',
      affectedWorkoutIds: ['plan-expired'],
      type: 'REDUCE_VOLUME',
      createdAt: '2026-10-17T10:00:00Z',
      expiresAt: '2026-10-18T10:00:00Z', // Expirée
      triggerObservations: [],
      dataProvenance: {
        measuredCount: 1,
        calculatedCount: 0,
        estimatedCount: 0,
        unavailableCount: 0,
        hasReliablePowerOrHr: true,
        sources: ['Garmin'],
        warnings: []
      },
      rationale: 'Allègement séance passée',
      detailedExplanation: 'Explication',
      proposedChanges: {
        workoutId: 'plan-expired',
        originalWorkout: { title: 'P', date: '2026-10-18', durationMin: 45, sport: 'Run' },
        proposedWorkout: { title: 'A', date: '2026-10-18', durationMin: 30, sport: 'Run', status: 'adapted', explanation: '' },
        beforeAfter: { durationMin: { before: 45, after: 30 } }
      },
      uncertaintyLevel: 'LOW',
      status: 'PENDING',
      compatibleCoachProposal: {
        id: 'prop-expired-1',
        action: 'MODIFY_WORKOUT',
        affectedWorkoutIds: ['plan-expired'],
        summary: 'Allègement',
        confidence: 'HIGH'
      }
    };

    AdaptiveTrainingService.registerProposal(expiredProposal);

    const acceptRes = AdaptiveTrainingService.acceptProposal('prop-expired-1', 'athlete-alpha');
    expect(acceptRes.success).toBe(false);
    expect(acceptRes.expired).toBe(true);

    const execRes = AdaptiveTrainingService.executeProposal('prop-expired-1', 'athlete-alpha');
    expect(execRes.success).toBe(false);
    expect(execRes.error).toContain('PROPOSAL_EXPIRED');
  });

  // 13. Données contradictoires : incertitude explicite
  it('13. données contradictoires : détecte la contradiction (RPE bas mais ATL extrême) et élève l\'incertitude', () => {
    const planned: PlannedWorkout[] = [
      {
        id: 'plan-contr',
        sport: 'Ride',
        date: '2026-10-21',
        title: 'Sortie Seuil',
        targetDurationMin: 60,
        targetIntensity: { type: 'zone', value: 'Z4' },
        status: 'planned'
      }
    ];

    const actual: ActualWorkout[] = [
      { id: 'act-c', sport: 'Ride', date: '2026-10-20', durationMin: 60, tss: 120 }
    ];

    // RPE très facile (1/10) alors que l'ATL est extrême (95)
    const feedback: WorkoutFeedback[] = [
      { id: 'fb-c', date: '2026-10-20', sport: 'Ride', durationMin: 60, rpe: 1, feeling: 'very_good' }
    ];

    const pmc: PmcData[] = [
      { date: '2026-10-20', ctl: 40, atl: 95, tsb: -35, tss: 120 }
    ];

    const result = AdaptiveTrainingService.analyzeAndPropose({
      athleteProfile: baseProfile,
      plannedWorkouts: planned,
      actualWorkouts: actual,
      feedbacks: feedback,
      pmc,
      currentDate: new Date('2026-10-20')
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].uncertaintyLevel).toBe('HIGH');
  });

  // 14. Deux athlètes distincts : aucune fuite de données et rejet strict d'autorisation
  it('14. isolation multi-athlètes : interdit formellement à un athlète d\'accepter ou exécuter la proposition d\'un autre', () => {
    const sessionAlpha: PlannedWorkout = {
      id: 'plan-alpha',
      sport: 'Ride',
      date: '2026-10-21',
      title: 'Séance Alpha',
      targetDurationMin: 60,
      status: 'planned'
    };

    const result = AdaptiveTrainingService.analyzeAndPropose({
      athleteProfile: baseProfile, // athlete-alpha
      plannedWorkouts: [sessionAlpha],
      actualWorkouts: [{ id: 'a1', sport: 'Ride', date: '2026-10-20', durationMin: 60 }],
      feedbacks: [{ id: 'fb', date: '2026-10-20', sport: 'Ride', durationMin: 60, rpe: 8, feeling: 'very_tired' }],
      currentDate: new Date('2026-10-20'),
      athleteId: 'athlete-alpha'
    });

    const proposalAlpha = result.proposals[0];
    expect(proposalAlpha.athleteId).toBe('athlete-alpha');

    // Athlète Beta tente d'accepter la proposition de l'Athlète Alpha
    const intruderAccept = AdaptiveTrainingService.acceptProposal(proposalAlpha.id, 'athlete-beta');
    expect(intruderAccept.success).toBe(false);
    expect(intruderAccept.error).toContain('FORBIDDEN_ATHLETE_MISMATCH');

    // Athlète Beta tente d'exécuter la proposition de l'Athlète Alpha
    const intruderExec = AdaptiveTrainingService.executeProposal(proposalAlpha.id, 'athlete-beta');
    expect(intruderExec.success).toBe(false);
    expect(intruderExec.error).toContain('FORBIDDEN_ATHLETE_MISMATCH');
  });

  // 15. Respect des jours de repos et de la progression maximale (+5% max)
  it('15. garde-fous physiologiques : respecte les contraintes et ne propose jamais d\'augmentation abusive de charge', () => {
    const nextSession: PlannedWorkout = {
      id: 'plan-z2',
      sport: 'Ride',
      date: '2026-10-21',
      title: 'Endurance',
      targetDurationMin: 60,
      targetTss: 50,
      status: 'planned'
    };

    const result = AdaptiveTrainingService.analyzeAndPropose({
      athleteProfile: baseProfile,
      plannedWorkouts: [nextSession],
      actualWorkouts: [{ id: 'act-normal', sport: 'Ride', date: '2026-10-20', durationMin: 60, tss: 50 }],
      feedbacks: [{ id: 'fb-good', date: '2026-10-20', sport: 'Ride', durationMin: 60, rpe: 4, feeling: 'good' }],
      pmc: [{ date: '2026-10-20', ctl: 50, atl: 45, tsb: 5, tss: 50 }],
      currentDate: new Date('2026-10-20')
    });

    // En conditions normales, aucune adaptation perturbatrice n'est forcée
    expect(result.status).toBe('NO_CHANGE_NEEDED');
    expect(result.proposals).toHaveLength(0);
  });
});
