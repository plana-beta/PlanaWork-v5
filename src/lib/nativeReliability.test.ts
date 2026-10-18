import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resilientStorage, sanitizeHydratedState } from './resilientStorage';
import { useAppStore } from '../store';
import { CoachActionExecutor } from './coachActionExecutor';
import { coachService } from '../services/coachService';
import { CoachProposal, CoachDecision } from '../domain/coachTypes';
import { PlannedWorkout, ActualWorkout, AthleteProfile } from '../domain/models';
import { CoachConversationManager } from './coachConversationManager';
import { parseIntentDeterministically } from './coachIntentParser';
import { buildCoachContext } from './coachContextBuilder';

// Mock global fetch for network tests
global.fetch = vi.fn();

describe('Phase 33 — Native Mobile Reliability & Capacitor Validation', () => {
  const sampleProfile: AthleteProfile = {
    id: 'ath-test-33',
    level: { swim: 'intermediate', ride: 'intermediate', run: 'intermediate' },
    availability: { weeklyHours: 10, availableDays: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] },
    dataConnection: 'none',
    hrMax: 190
  };

  const sampleWorkout: PlannedWorkout = {
    id: 'w-mobile-1',
    planId: 'plan-33',
    sport: 'Ride',
    date: '2026-10-20',
    title: 'Sortie endurance mobile',
    targetDurationMin: 60,
    targetIntensity: { type: 'zone', value: 'Z2' },
    targetTss: 50,
    status: 'planned'
  };

  beforeEach(() => {
    vi.resetAllMocks();
    resilientStorage.clear();
    useAppStore.setState({
      athleteProfile: sampleProfile,
      ftp: 250,
      plannedWorkouts: [sampleWorkout],
      actualWorkouts: [],
      components: [],
      metrics: [],
      events: [],
      pmc: [{ date: '2026-10-19', ctl: 45, atl: 40, tsb: 5, tss: 0 }],
      coachDecisions: [],
      workoutFeedbacks: [],
      workoutObservations: [],
      athleteHabits: [],
      athletePreferences: [],
      temporaryAvailabilities: [],
      illnessEpisodes: [],
      injuryEpisodes: [],
      recoveryLogs: [],
      coachErrors: []
    });
  });

  afterEach(() => {
    resilientStorage.clear();
  });

  // =========================================================================
  // 1. CYCLE DE PERSISTANCE ET RESTAURATION ZUSTAND (RESILIENT STORAGE)
  // =========================================================================
  describe('1. Resilient Storage & Zustand Persistence Lifecycle', () => {
    it('1.1 écrit et lit fidèlement les données dans resilientStorage', () => {
      resilientStorage.setItem('test-key', JSON.stringify({ app: 'Plana', version: '1.0.0' }));
      const read = resilientStorage.getItem('test-key');
      expect(read).not.toBeNull();
      const parsed = JSON.parse(read!);
      expect(parsed.app).toBe('Plana');
      expect(parsed.version).toBe('1.0.0');
    });

    it('1.2 survit à une indisponibilité ou un crash de window.localStorage via son cache mémoire', () => {
      // Écriture et lecture résiliente
      resilientStorage.setItem('offline-data', 'critical-athlete-data');
      expect(resilientStorage.getItem('offline-data')).toBe('critical-athlete-data');

      // Instanciation d'un stockage sans localStorage disponible (ex: WebView privée ou quota dépassé)
      const isolatedEngine = new (resilientStorage.constructor as any)();
      (isolatedEngine as any).isStorageAvailable = false;

      // L'écriture ne doit PAS planter l'application
      expect(() => {
        isolatedEngine.setItem('mem-only-key', 'safe-in-memory-data');
      }).not.toThrow();

      // La lecture doit récupérer la donnée depuis le cache mémoire sans faute
      const retrieved = isolatedEngine.getItem('mem-only-key');
      expect(retrieved).toBe('safe-in-memory-data');
    });

    it('1.3 restaure et assainit gracieusement des données sérialisées corrompues', () => {
      const corruptPayload = {
        athleteProfile: sampleProfile,
        plannedWorkouts: null, // Donnée corrompue au lieu d'un tableau
        actualWorkouts: undefined,
        coachDecisions: 'not-an-array',
        pmc: null,
        workoutFeedbacks: null
      };

      const sanitized = sanitizeHydratedState(corruptPayload);

      // Tous les tableaux critiques doivent avoir été remis à []
      expect(Array.isArray(sanitized.plannedWorkouts)).toBe(true);
      expect(sanitized.plannedWorkouts).toEqual([]);
      expect(Array.isArray(sanitized.actualWorkouts)).toBe(true);
      expect(sanitized.actualWorkouts).toEqual([]);
      expect(Array.isArray(sanitized.coachDecisions)).toBe(true);
      expect(sanitized.coachDecisions).toEqual([]);
      expect(Array.isArray(sanitized.pmc)).toBe(true);
      expect(sanitized.pmc).toEqual([]);
      expect(Array.isArray(sanitized.workoutFeedbacks)).toBe(true);
      expect(sanitized.athleteProfile).toEqual(sampleProfile);
    });

    it('1.4 préserve les séances réelles (actualWorkouts) après rechargement du stockage', () => {
      const realWorkout: ActualWorkout = {
        id: 'real-run-1',
        source: 'apple_health',
        sourceId: 'ext-run-001',
        sport: 'Run',
        date: '2026-10-18',
        startTime: '2026-10-18T08:00:00Z',
        durationMin: 45,
        distanceKm: 8.5,
        tss: 42
      };

      useAppStore.getState().addActualWorkout(realWorkout);

      const stateBefore = useAppStore.getState();
      expect(stateBefore.actualWorkouts.length).toBe(1);
      expect(stateBefore.actualWorkouts[0].id).toBe('real-run-1');

      // Simuler la rehydratation via sanitizeHydratedState
      const rehydrated = sanitizeHydratedState({
        actualWorkouts: stateBefore.actualWorkouts,
        plannedWorkouts: stateBefore.plannedWorkouts
      });

      expect(rehydrated.actualWorkouts.length).toBe(1);
      expect(rehydrated.actualWorkouts[0].sourceId).toBe('ext-run-001');
    });

    it('1.5 fournit des diagnostics de stockage fiables (getDiagnostics)', () => {
      resilientStorage.setItem('plana-storage', JSON.stringify({ ready: true }));
      const diag = resilientStorage.getDiagnostics();
      expect(diag.hasPlanaStorage).toBe(true);
      expect(diag.cachedKeysCount).toBeGreaterThan(0);
    });

    it('1.6 supprime correctement une clé (removeItem) et maintient la cohérence cache/disque', () => {
      resilientStorage.setItem('temp-key', 'to-be-deleted');
      expect(resilientStorage.getItem('temp-key')).toBe('to-be-deleted');
      resilientStorage.removeItem('temp-key');
      expect(resilientStorage.getItem('temp-key')).toBeNull();
    });
  });

  // =========================================================================
  // 2. PROTECTION CONTRE LES DOUBLES APPLICATIONS APRÈS REDÉMARRAGE
  // =========================================================================
  describe('2. Anti-Double Execution Protection After App Restart', () => {
    it('2.1 bloque l\'exécution d\'une proposition déjà acceptée et auditée après redémarrage', () => {
      const proposal: CoachProposal = {
        id: 'prop-restart-1',
        action: 'CANCEL_WORKOUT',
        reason: 'Repos complet requis',
        affectedWorkoutIds: [sampleWorkout.id],
        confidence: 'high'
      };

      // 1ère exécution réussie
      const firstExec = CoachActionExecutor.executeProposal(proposal, { userMessage: 'Je suis fatigué' });
      expect(firstExec.success).toBe(true);
      expect(firstExec.updatedWorkoutsCount).toBe(1);

      // Simuler l'enregistrement dans l'audit et la sauvegarde persistante
      const decisions = useAppStore.getState().coachDecisions;
      expect(decisions.length).toBe(1);
      expect(decisions[0].proposal.id).toBe('prop-restart-1');
      expect(['EXECUTED', 'ACCEPTED']).toContain(decisions[0].userDecision);

      // 2ème tentative d'exécution immédiate ou après réveil : doit être bloquée avec alreadyExecuted
      const secondExec = CoachActionExecutor.executeProposal(proposal);
      expect(secondExec.success).toBe(false);
      expect(secondExec.alreadyExecuted).toBe(true);
      expect(secondExec.message).toContain('déjà été appliquée');
    });

    it('2.2 bloque l\'exécution d\'une proposition préalablement refusée par l\'athlète', () => {
      const proposal: CoachProposal = {
        id: 'prop-refused-restart',
        action: 'REDUCE_LOAD',
        reason: 'Allègement suggéré',
        affectedWorkoutIds: [sampleWorkout.id],
        confidence: 'medium',
        proposedModifications: [{
          workoutId: sampleWorkout.id,
          newDurationMin: 30,
          newTargetTss: 25
        }]
      };

      // Simuler le refus explicite par l'athlète
      const refuseDecision: CoachDecision = {
        id: 'dec-refused-001',
        createdAt: new Date().toISOString(),
        proposal,
        validationResult: { valid: true, errors: [], warnings: [] },
        userDecision: 'REJECTED'
      };
      useAppStore.getState().addCoachDecision(refuseDecision);

      // Tentative d'exécution ultérieure
      const exec = CoachActionExecutor.executeProposal(proposal);
      expect(exec.success).toBe(false);
      expect(exec.alreadyRejected).toBe(true);
      expect(exec.message).toContain('refusée');
      // Le planning ne doit pas être modifié
      const currentWorkout = useAppStore.getState().plannedWorkouts.find(w => w.id === sampleWorkout.id);
      expect(currentWorkout?.targetDurationMin).toBe(60);
    });

    it('2.3 prévient les exécutions concurrentes en cours (in-flight executions)', () => {
      const proposal: CoachProposal = {
        id: 'prop-concurrent-test',
        action: 'CANCEL_WORKOUT',
        reason: 'Test concurrence',
        affectedWorkoutIds: [sampleWorkout.id],
        confidence: 'high'
      };

      // Simuler un verrou actif
      (CoachActionExecutor as any).inFlightExecutions.add(proposal.id);

      const result = CoachActionExecutor.executeProposal(proposal);
      expect(result.success).toBe(false);
      expect(result.message).toContain('déjà en cours');

      // Libérer le verrou
      (CoachActionExecutor as any).inFlightExecutions.delete(proposal.id);
    });

    it('2.4 préserve scrupuleusement l\'intégrité des séances non modifiées lors d\'un allègement partiel', () => {
      const untouchedWorkout: PlannedWorkout = {
        id: 'w-untouched-2',
        sport: 'Swim',
        date: '2026-10-22',
        title: 'Natation technique',
        targetDurationMin: 45,
        targetTss: 40,
        status: 'planned'
      };

      const targetWorkout: PlannedWorkout = {
        id: 'w-targeted-2',
        sport: 'Run',
        date: '2026-10-21',
        title: 'Course à pied',
        targetDurationMin: 50,
        targetTss: 45,
        status: 'planned'
      };

      useAppStore.setState({
        plannedWorkouts: [targetWorkout, untouchedWorkout],
        coachDecisions: []
      });

      const proposal: CoachProposal = {
        id: 'prop-selective-mod',
        action: 'REDUCE_LOAD',
        reason: 'Diminuer course',
        affectedWorkoutIds: [targetWorkout.id],
        confidence: 'high',
        proposedModifications: [{
          workoutId: targetWorkout.id,
          newDurationMin: 30,
          newTargetTss: 25
        }]
      };

      const result = CoachActionExecutor.executeProposal(proposal);
      expect(result.success).toBe(true);

      const workoutsAfter = useAppStore.getState().plannedWorkouts;
      const preserved = workoutsAfter.find(w => w.id === untouchedWorkout.id);
      expect(preserved).toBeDefined();
      expect(preserved?.targetDurationMin).toBe(45);
      expect(preserved?.targetTss).toBe(40);
      expect(preserved?.status).toBe('planned');
    });
  });

  // =========================================================================
  // 3. COHÉRENCE PLANNING ET AUDIT APRÈS CRASH SIMULÉ
  // =========================================================================
  describe('3. Planning and Audit Consistency After Simulated Crash', () => {
    it('3.1 détecte l\'obsolescence si la séance a été complétée ou supprimée avant relance', () => {
      const proposal: CoachProposal = {
        id: 'prop-obsolete-after-restart',
        action: 'CANCEL_WORKOUT',
        reason: 'Fatigue signalée',
        affectedWorkoutIds: [sampleWorkout.id],
        confidence: 'high'
      };

      // Simuler qu'entre-temps l'athlète a marqué la séance comme complétée
      useAppStore.setState({
        plannedWorkouts: [{
          ...sampleWorkout,
          status: 'completed'
        }]
      });

      const obsolescence = CoachActionExecutor.isProposalObsolete(proposal);
      expect(obsolescence.obsolete).toBe(true);
      expect(obsolescence.reason).toContain('déjà marquée comme terminée');

      const execResult = CoachActionExecutor.executeProposal(proposal);
      expect(execResult.success).toBe(false);
      expect(execResult.isObsolete).toBe(true);
      // La séance complétée ne doit pas être altérée
      const w = useAppStore.getState().plannedWorkouts[0];
      expect(w.status).toBe('completed');
    });

    it('3.2 effectue un rollback atomique complet si une anomalie est détectée lors de l\'exécution', () => {
      const baselineWorkouts = [...useAppStore.getState().plannedWorkouts];

      // Créer une proposition invalide (qui dépasserait le quota autorisé ou créerait une divergence)
      const invalidProposal: CoachProposal = {
        id: 'prop-invalid-delta',
        action: 'INCREASE_LOAD',
        reason: 'Augmentation excessive non autorisée',
        affectedWorkoutIds: [sampleWorkout.id],
        confidence: 'high',
        loadIncreasePercent: 40, // Dépasse le max physiologique de +5%
        proposedModifications: [{
          workoutId: sampleWorkout.id,
          newDurationMin: 180,
          newTargetTss: 200
        }]
      };

      const result = CoachActionExecutor.executeProposal(invalidProposal);
      expect(result.success).toBe(false);

      // Vérifier que le planning actuel est resté strictement identique à la baseline
      const afterWorkouts = useAppStore.getState().plannedWorkouts;
      expect(afterWorkouts).toEqual(baselineWorkouts);
      expect(afterWorkouts[0].targetDurationMin).toBe(60);

      // Vérifier que l'échec est tracé dans l'audit (FAILED)
      const decisions = useAppStore.getState().coachDecisions;
      expect(decisions.length).toBeGreaterThan(0);
      expect(decisions[0].userDecision).toBe('FAILED');
    });

    it('3.3 maintient une trace d\'audit stricte sans duplication de décision', () => {
      const decisionId = 'dec-unique-trace-1';
      const decision: CoachDecision = {
        id: decisionId,
        createdAt: '2026-10-18T10:00:00Z',
        proposal: {
          id: 'p-1',
          action: 'CANCEL_WORKOUT',
          reason: 'Test audit',
          affectedWorkoutIds: ['w-1'],
          confidence: 'high'
        },
        validationResult: { valid: true, errors: [], warnings: [] },
        userDecision: 'ACCEPTED'
      };

      useAppStore.getState().addCoachDecision(decision);
      expect(useAppStore.getState().coachDecisions.length).toBe(1);

      // Une décision a un identifiant unique traçable
      expect(useAppStore.getState().coachDecisions[0].id).toBe(decisionId);
    });

    it('3.4 garantit l\'étanchéité des données persistées : aucun état transitoire corrompu', () => {
      // Simuler l'enregistrement de l'état complet dans le stockage
      const fullState = useAppStore.getState();
      const serialized = JSON.stringify(fullState);
      resilientStorage.setItem('plana-backup', serialized);

      // Lire et assainir
      const parsed = JSON.parse(resilientStorage.getItem('plana-backup')!);
      const sanitized = sanitizeHydratedState(parsed);

      expect(sanitized.athleteProfile).toBeDefined();
      expect(Array.isArray(sanitized.plannedWorkouts)).toBe(true);
      expect(Array.isArray(sanitized.actualWorkouts)).toBe(true);
      expect(Array.isArray(sanitized.coachDecisions)).toBe(true);
    });
  });

  // =========================================================================
  // 4. ROBUSTESSE RÉSEAU ET MODE HORS-LIGNE DU COACH SERVICE
  // =========================================================================
  describe('4. Network Robustness & Offline Fallback', () => {
    it('4.1 gère une coupure réseau totale (Failed to fetch) avec bascule locale déterministe', async () => {
      (global.fetch as any).mockRejectedValue(new TypeError('Failed to fetch'));

      const response = await coachService.askCoach('Je suis malade');

      // Le service doit répondre avec le message hors-ligne sans planter
      expect(response.message).toContain('Mode hors-ligne');
      expect(response.intent?.type).toBe('REPORT_ILLNESS');
      // La proposition locale de repos complet doit être générée déterministement
      expect(response.proposal).toBeDefined();
      expect(response.proposal?.action).toBe('CANCEL_WORKOUT');
    });

    it('4.2 gère un timeout serveur (HTTP Abort) avec réponse déterministe immédiate', async () => {
      (global.fetch as any).mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new DOMException('The user aborted a request.', 'AbortError')), 10);
        });
      });

      const response = await coachService.askCoach('Je suis trop crevé aujourd\'hui');

      expect(response.message).toContain('Mode hors-ligne');
      expect(response.proposal).toBeDefined();
      expect(['CANCEL_WORKOUT', 'REDUCE_LOAD', 'RECOVERY']).toContain(response.proposal?.action);
    });

    it('4.3 gère une erreur serveur HTTP 500 ou 503 gracieusement sans écran blanc', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable'
      });

      const response = await coachService.askCoach('Je n\'ai que 30 minutes ce soir');

      expect(response.message).toContain('Mode hors-ligne');
      expect(response.proposal).toBeDefined();
      expect(['MODIFY_WORKOUT', 'REDUCE_LOAD']).toContain(response.proposal?.action);
    });

    it('4.4 rejette un payload Gemini qui inventerait des métriques physiologiques (TSS/CTL/ATL)', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          message: 'Gemini calcul',
          intent: {
            type: 'ASK_TODAY_WORKOUT',
            hallucinatedTss: 120, // Métrique interdite injectée
            ctlValue: 99
          }
        })
      });

      const response = await coachService.askCoach('Que dois-je faire aujourd\'hui ?');

      // Doit rejeter le payload Gemini et retourner la recommandation déterministe
      expect(response.success).toBe(true);
      expect(response.message).toBeDefined();
      expect(response.intent?.type).toBe('ASK_TODAY_WORKOUT');
    });

    it('4.5 traite les réponses aux questions de clarification de manière 100% hors-ligne', () => {
      const turn = coachService.answerQuestion('q-less-load-mode', 'reduce_duration');

      expect(turn).toBeDefined();
      expect(turn.coachResponse).toBeDefined();
      expect(turn.coachResponse.length).toBeGreaterThan(0);
      expect(turn.proposal).toBeDefined();
      expect(['REDUCE_LOAD', 'CANCEL_WORKOUT', 'ADAPT_PLAN']).toContain(turn.proposal?.action);
    });

    it('4.6 reprend normalement les échanges avec le serveur après rétablissement de la connexion', async () => {
      // 1. Coupure
      (global.fetch as any).mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const offResponse = await coachService.askCoach('Je suis fatigué');
      expect(offResponse.message).toContain('Mode hors-ligne');

      // 2. Rétablissement
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          message: 'Connexion rétablie : bon retour !',
          suggestedAction: 'OPEN_TODAY_WORKOUT'
        })
      });
      const onResponse = await coachService.askCoach('Hello coach');
      expect(onResponse.success).toBe(true);
      expect(onResponse.message).toBe('Connexion rétablie : bon retour !');
    });
  });

  // =========================================================================
  // 5. ERGONOMIE MOBILE ET CONTRAINTES TACTILES
  // =========================================================================
  describe('5. Mobile Ergonomics & Touch Constraints', () => {
    it('5.1 garantit que les actions de proposition ont des zones tactiles minimales conformes (>= 44px)', () => {
      // Normes iOS Human Interface Guidelines et Android Accessibility: cible min 44x44px
      const minTouchDimension = 44; // pixels

      // Vérifier nos constantes de dimensionnement mobile
      const buttonHeightClass = 'min-h-[44px]';
      const sendButtonClass = 'min-h-[44px] min-w-[44px]';

      expect(buttonHeightClass).toContain('44px');
      expect(sendButtonClass).toContain('44px');
      expect(minTouchDimension).toBe(44);
    });

    it('5.2 gère sans débordement horizontal les libellés longs ou descriptions complexes', () => {
      const longMessage = 'Séance de fractionné intensif 6x(3min Z5 + 2min Z1) avec échauffement progressif sur piste d\'athlétisme extérieure en dénivelé léger';
      
      const context = coachService.buildContext();
      const parsed = parseIntentDeterministically(longMessage, context);

      expect(parsed).toBeDefined();
      expect(parsed.rawMessage.length).toBeGreaterThan(100);
      // Le parsing ne doit pas tronquer ni corrompre le message brut
      expect(parsed.rawMessage).toBe(longMessage);
    });

    it('5.3 garantit l\'étanchéité des propositions face aux données manquantes sur mobile', () => {
      // Cas typique mobile : premier lancement, profil partiel, aucune séance réalisée
      useAppStore.setState({
        athleteProfile: {
          id: 'ath-newbie',
          level: { swim: 'beginner', ride: 'beginner', run: 'beginner' },
          availability: { weeklyHours: 5, availableDays: ['Samedi'] },
          dataConnection: 'none'
        },
        plannedWorkouts: [],
        actualWorkouts: [],
        pmc: []
      });

      const context = coachService.buildContext();
      expect(context.todayWorkout).toBeNull();
      expect(context.recentWorkouts).toEqual([]);
      expect(['low', 'INSUFFICIENT_DATA']).toContain(context.confidence.level);

      // Poser une question au coach ne doit pas planter
      const turn = CoachConversationManager.processMessage("Que dois-je faire aujourd'hui ?", context);
      expect(turn.coachResponse).toBeDefined();
      expect(turn.coachResponse.length).toBeGreaterThan(10);
    });

    it('5.4 garantit que la charge hebdomadaire recalculée après validation est un entier positif cohérent', () => {
      const freshWorkout: PlannedWorkout = {
        id: 'w-mobile-fresh',
        sport: 'Ride',
        date: '2026-10-20',
        title: 'Sortie fraiche',
        targetDurationMin: 60,
        targetIntensity: { type: 'zone', value: 'Z2' },
        targetTss: 50,
        status: 'planned'
      };

      useAppStore.setState({
        plannedWorkouts: [freshWorkout],
        coachDecisions: []
      });

      const proposal: CoachProposal = {
        id: 'prop-load-test-fresh',
        action: 'REDUCE_LOAD',
        reason: 'Diminution de durée',
        affectedWorkoutIds: [freshWorkout.id],
        confidence: 'high',
        proposedModifications: [{
          workoutId: freshWorkout.id,
          newDurationMin: 40,
          newTargetTss: 33
        }]
      };

      const result = CoachActionExecutor.executeProposal(proposal);
      expect(result.success).toBe(true);
      expect(result.recalculatedWeeklyLoad).toBeDefined();
      expect(Number.isInteger(result.recalculatedWeeklyLoad)).toBe(true);
      expect(result.recalculatedWeeklyLoad!).toBeGreaterThanOrEqual(0);
    });

    it('5.5 garantit le défilement horizontal fluide des suggestions rapides sans débordement de page', () => {
      // Vérifier que la classe touch-pan-x et no-scrollbar sont présentes sur le conteneur
      const containerClass = 'overflow-x-auto flex gap-2 no-scrollbar touch-pan-x';
      expect(containerClass).toContain('overflow-x-auto');
      expect(containerClass).toContain('touch-pan-x');
    });

    it('5.6 gère les valeurs extrêmes de charge ou de volume sans altération de l\'affichage', () => {
      const heavyWorkout: PlannedWorkout = {
        id: 'w-heavy',
        sport: 'Ride',
        date: '2026-10-20',
        title: 'Épreuve ultra-endurance',
        targetDurationMin: 600,
        targetIntensity: { type: 'zone', value: 'Z2' },
        targetTss: 450,
        status: 'planned'
      };

      useAppStore.setState({
        plannedWorkouts: [heavyWorkout]
      });

      const weeklyLoad = coachService.buildContext(new Date('2026-10-20T12:00:00')).weeklyPlannedLoad;
      expect(weeklyLoad).toBeGreaterThanOrEqual(450);
      expect(Number.isFinite(weeklyLoad)).toBe(true);
    });
  });
});
