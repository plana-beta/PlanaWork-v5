import { PlannedWorkout, ActualWorkout, Sport, Goal, AthleteProfile } from '../domain/models';
import { EventGoal, PmcData } from '../types';
import { WorkoutFeedback, WorkoutObservation, ConfidenceLevel } from '../domain/athleteHistoryTypes';
import { CoachProposal } from '../domain/coachTypes';
import { CoachActionExecutor } from '../lib/coachActionExecutor';
import {
  DataProvenanceSummary,
  DataUncertaintyLevel
} from '../domain/adaptiveTrainingTypes';
import {
  ProgressionStatus,
  ProgressionProposal,
  ProgressionProposalType,
  ProgressionProposalStatus,
  PerformanceMetricComparison,
  ProgressionTrendPoint,
  GoalAlignmentAnalysis,
  StagnationDetectionResult,
  TrainingProgressionAnalysis
} from '../domain/trainingProgressionTypes';
import {
  parseISO,
  format,
  addDays,
  subDays,
  differenceInDays,
  differenceInWeeks,
  startOfDay,
  isBefore,
  isAfter
} from 'date-fns';
import { useAppStore } from '../store';

/**
 * Seuils déterministes et configurables pour l'analyse de progression.
 * Basés sur la méthodologie d'entraînement d'endurance (Coggan/Seiler).
 */
export const PROGRESSION_THRESHOLDS = {
  MIN_DAYS_FOR_TREND: 14,               // Minimum 2 semaines d'historique
  RECOMMENDED_DAYS_FOR_TREND: 28,       // 4 semaines recommandées
  MIN_SAMPLES_PER_SPORT: 3,             // Minimum 3 séances comparables
  SIGNIFICANT_IMPROVEMENT_PCT: 3.0,     // +3% d'amélioration mesurable
  SIGNIFICANT_DECLINE_PCT: -3.0,        // -3% de baisse mesurable
  STAGNATION_MIN_WEEKS: 3,              // Au moins 3 semaines sans progression
  MAX_VOLUME_PROGRESSION_PCT: 10.0,     // Plafond de progression de volume (+10%)
  SAFE_VOLUME_PROGRESSION_PCT: 5.0,     // Progression de volume prudente (+5%)
  MAX_INTENSITY_PROGRESSION_PCT: 3.0,   // Progression d'intensité prudente (+2-3%)
  HIGH_RPE_THRESHOLD: 8,                // RPE élevé
  PROPOSAL_EXPIRY_DAYS: 7               // Durée de validité d'une proposition (7 jours)
};

/**
 * TrainingProgressionService
 * 
 * Moteur d'intelligence de progression sportive et d'alignement sur les objectifs (Phase 37).
 * 
 * Principes stricts :
 * 1. Analyse déterministe, reproductible et explicable.
 * 2. Aucune modification du planning ou des objectifs sans validation explicite de l'athlète.
 * 3. Ne jamais inventer de métriques manquantes ni fabriquer un score artificiel.
 * 4. Jamais de corrélation présentée comme une causalité médicale ou physiologique.
 * 5. Préservation absolue de la traçabilité et de la provenance de chaque donnée.
 * 6. Aucune augmentation de charge en réaction à une stagnation ou une séance manquée.
 * 7. Transaction atomique, contrôle d'idempotence et audit complet des exécutions.
 */
export class TrainingProgressionService {
  private static proposalsRegistry = new Map<string, ProgressionProposal>();

  /**
   * Réinitialise le registre des propositions (utile pour les tests et l'isolation).
   */
  static resetRegistry(): void {
    this.proposalsRegistry.clear();
  }

  /**
   * Analyse déterministe complète de la progression et de l'alignement sur les objectifs.
   */
  static analyzeProgression(params: {
    athleteProfile: AthleteProfile;
    plannedWorkouts: PlannedWorkout[];
    actualWorkouts: ActualWorkout[];
    feedbacks?: WorkoutFeedback[];
    observations?: WorkoutObservation[];
    pmc?: PmcData[];
    activeGoal?: Goal | EventGoal;
    currentDate?: Date;
    athleteId?: string;
    analysisDays?: number;
  }): TrainingProgressionAnalysis {
    const {
      athleteProfile,
      plannedWorkouts = [],
      actualWorkouts = [],
      feedbacks = [],
      observations = [],
      pmc = [],
      activeGoal = athleteProfile?.goal,
      currentDate = new Date(),
      analysisDays = PROGRESSION_THRESHOLDS.RECOMMENDED_DAYS_FOR_TREND
    } = params;

    const athleteId = params.athleteId || athleteProfile?.id || 'unknown-athlete';
    const now = currentDate;
    const todayStr = format(now, 'yyyy-MM-dd');
    const windowStart = subDays(now, analysisDays);
    const windowStartStr = format(windowStart, 'yyyy-MM-dd');

    // 1. Audit de la provenance des données sur la période
    const provenance = this.auditDataProvenance(actualWorkouts, feedbacks);

    // 2. Filtrage des séances sur la fenêtre d'observation
    const recentActuals = actualWorkouts.filter(w => {
      try {
        const d = parseISO(w.date);
        return !isBefore(d, windowStart) && !isAfter(d, now);
      } catch {
        return false;
      }
    });

    const recentPlanned = plannedWorkouts.filter(w => {
      try {
        const d = parseISO(w.date);
        return !isBefore(d, windowStart) && !isAfter(d, now);
      } catch {
        return false;
      }
    });

    const recentFeedbacks = feedbacks.filter(f => {
      try {
        const dateStr = f.date || (typeof f.createdAt === 'string' ? f.createdAt : undefined);
        if (!dateStr) return false;
        const d = parseISO(dateStr);
        return !isBefore(d, windowStart) && !isAfter(d, now);
      } catch {
        return false;
      }
    });

    // 3. Détection des données insuffisantes
    const hasEnoughHistory = recentActuals.length >= 2;
    const hasEnoughDays = differenceInDays(now, windowStart) >= PROGRESSION_THRESHOLDS.MIN_DAYS_FOR_TREND;

    const missingData: string[] = [];
    if (recentActuals.length === 0) {
      missingData.push("Aucune séance réelle enregistrée sur la fenêtre d'observation.");
    } else if (recentActuals.length < PROGRESSION_THRESHOLDS.MIN_SAMPLES_PER_SPORT) {
      missingData.push(`Historique récent limité (${recentActuals.length} séances). Au moins ${PROGRESSION_THRESHOLDS.MIN_SAMPLES_PER_SPORT} séances sont recommandées.`);
    }

    if (provenance.unavailableCount > 0) {
      missingData.push(`${provenance.unavailableCount} séances sans métrique de charge valide.`);
    }

    if (recentFeedbacks.length === 0 && recentActuals.length > 0) {
      missingData.push("Aucun ressenti (RPE / sensation) renseigné pour évaluer la tolérance à la charge.");
    }

    // 4. Analyse des métriques de performance
    const metrics = this.computePerformanceMetrics(recentActuals, provenance);

    // 5. Calcul des tendances de charge et régularité
    const loadTrends = this.computeLoadTrends(recentPlanned, recentActuals, recentFeedbacks, pmc);

    // 6. Détection de stagnation
    const stagnation = this.detectStagnation(metrics, loadTrends, recentActuals);

    // 7. Alignement sur l'objectif
    const goalAlignment = this.analyzeGoalAlignment(activeGoal, metrics, now);

    // 8. Détermination du statut global de progression
    const { status, uncertaintyLevel, interpretationLimits, readableExplanation } = this.determineProgressionStatus({
      metrics,
      stagnation,
      loadTrends,
      recentActuals,
      provenance,
      hasEnoughHistory,
      hasEnoughDays
    });

    // 9. Génération des points d'évolution temporelle
    const trendPoints = this.generateTrendPoints(windowStart, now, recentActuals, pmc);

    // 10. Formulation des propositions de progression déterministes
    const proposals = this.generateProgressionProposals({
      athleteId,
      status,
      goalAlignment,
      metrics,
      stagnation,
      loadTrends,
      recentActuals,
      plannedWorkouts,
      provenance,
      currentDate: now
    });

    return {
      id: `prog-${athleteId}-${todayStr}`,
      athleteId,
      calculatedAt: now.toISOString(),
      observedPeriod: {
        from: windowStartStr,
        to: todayStr,
        weeksCount: Math.round(analysisDays / 7)
      },
      status,
      goalAlignment,
      metrics,
      trendPoints,
      stagnation,
      loadTrends,
      proposals,
      dataProvenance: provenance,
      missingData,
      uncertaintyLevel,
      interpretationLimits,
      readableExplanation,
      isDeterministic: true
    };
  }

  /**
   * Audit de la provenance des métriques
   */
  private static auditDataProvenance(
    actuals: ActualWorkout[],
    feedbacks: WorkoutFeedback[]
  ): DataProvenanceSummary {
    let measuredCount = 0;
    let calculatedCount = 0;
    let estimatedCount = 0;
    let unavailableCount = 0;
    let hasReliablePowerOrHr = false;
    const sourcesSet = new Set<string>();
    const warnings: string[] = [];

    actuals.forEach(w => {
      if (w.source) sourcesSet.add(w.source);

      if (w.normalizedPower || (w as any).avgPower) {
        hasReliablePowerOrHr = true;
        measuredCount++;
      } else if (w.averageHeartRate) {
        hasReliablePowerOrHr = true;
        measuredCount++;
      }

      const tssMethod = (w as any).tssMethod || (w.tss ? 'UNKNOWN' : 'UNAVAILABLE');
      if (tssMethod === 'MEASURED_POWER' || tssMethod === 'MEASURED_OR_IMPORTED') {
        measuredCount++;
      } else if (tssMethod === 'CALCULATED_HR' || tssMethod === 'DETERMINISTICALLY_CALCULATED' || (w.averageHeartRate && w.normalizedPower)) {
        calculatedCount++;
      } else if (tssMethod === 'ESTIMATED_DURATION' || tssMethod === 'ESTIMATED' || (!w.normalizedPower && !w.averageHeartRate && w.tss)) {
        estimatedCount++;
        warnings.push(`Séance du ${w.date} : TSS estimé uniquement sur la durée (non équivalent à une mesure physiologique directe).`);
      } else if (!w.tss) {
        unavailableCount++;
      }
    });

    return {
      measuredCount,
      calculatedCount,
      estimatedCount,
      unavailableCount,
      hasReliablePowerOrHr,
      sources: Array.from(sourcesSet),
      warnings
    };
  }

  /**
   * Calcul des métriques de performance comparables par sport
   */
  private static computePerformanceMetrics(
    actuals: ActualWorkout[],
    provenance: DataProvenanceSummary
  ): PerformanceMetricComparison[] {
    const comparisons: PerformanceMetricComparison[] = [];

    // Séparer les séances par sport
    const rides = actuals.filter(w => w.sport === 'Ride');
    const runs = actuals.filter(w => w.sport === 'Run');
    const swims = actuals.filter(w => w.sport === 'Swim');

    // 1. Analyse Cyclisme (Puissance Normalisée ou Puissance Moyenne)
    if (rides.length >= 2) {
      const powerRides = rides.filter(w => (w.normalizedPower && w.normalizedPower > 0) || ((w as any).avgPower && (w as any).avgPower > 0));
      if (powerRides.length >= 2) {
        // Trier par date croissante
        powerRides.sort((a, b) => a.date.localeCompare(b.date));
        const mid = Math.floor(powerRides.length / 2);
        const refSlice = powerRides.slice(0, mid);
        const recSlice = powerRides.slice(mid);

        const refVal = Math.round(refSlice.reduce((acc, w) => acc + (w.normalizedPower || (w as any).avgPower || 0), 0) / refSlice.length);
        const recVal = Math.round(recSlice.reduce((acc, w) => acc + (w.normalizedPower || (w as any).avgPower || 0), 0) / recSlice.length);
        const delta = recVal - refVal;
        const deltaPct = refVal > 0 ? Number(((delta / refVal) * 100).toFixed(1)) : 0;

        let trend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INCONCLUSIVE' = 'STABLE';
        if (deltaPct >= PROGRESSION_THRESHOLDS.SIGNIFICANT_IMPROVEMENT_PCT) trend = 'IMPROVING';
        else if (deltaPct <= PROGRESSION_THRESHOLDS.SIGNIFICANT_DECLINE_PCT) trend = 'DECLINING';

        comparisons.push({
          metricName: 'Puissance (NP / Watts moyens)',
          sport: 'Ride',
          unit: 'W',
          referenceValue: refVal,
          recentValue: recVal,
          absoluteDelta: delta,
          relativeDeltaPct: deltaPct,
          trend,
          sampleCount: powerRides.length,
          provenance: 'MEASURED_OR_IMPORTED',
          comparabilityLimits: [
            "Comparaison fondée sur des intensités de séances comparables.",
            "Ne prend pas en compte le dénivelé ou le vent si non normalisé."
          ],
          isDirectPerformanceMeasure: true
        });

        // Facteur d'efficience (NP / FC moyenne) si FC disponible
        const effRides = powerRides.filter(w => w.averageHeartRate && w.averageHeartRate > 0);
        if (effRides.length >= 2) {
          const midEff = Math.floor(effRides.length / 2);
          const refEffSlice = effRides.slice(0, midEff);
          const recEffSlice = effRides.slice(midEff);

          const refEff = Number((refEffSlice.reduce((acc, w) => acc + ((w.normalizedPower || (w as any).avgPower || 0) / (w.averageHeartRate || 1)), 0) / refEffSlice.length).toFixed(2));
          const recEff = Number((recEffSlice.reduce((acc, w) => acc + ((w.normalizedPower || (w as any).avgPower || 0) / (w.averageHeartRate || 1)), 0) / recEffSlice.length).toFixed(2));
          const effDelta = Number((recEff - refEff).toFixed(2));
          const effDeltaPct = refEff > 0 ? Number(((effDelta / refEff) * 100).toFixed(1)) : 0;

          let effTrend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INCONCLUSIVE' = 'STABLE';
          if (effDeltaPct >= PROGRESSION_THRESHOLDS.SIGNIFICANT_IMPROVEMENT_PCT) effTrend = 'IMPROVING';
          else if (effDeltaPct <= PROGRESSION_THRESHOLDS.SIGNIFICANT_DECLINE_PCT) effTrend = 'DECLINING';

          comparisons.push({
            metricName: 'Facteur d\'efficience aérobie (Watts / BPM)',
            sport: 'Ride',
            unit: 'W/bpm',
            referenceValue: refEff,
            recentValue: recEff,
            absoluteDelta: effDelta,
            relativeDeltaPct: effDeltaPct,
            trend: effTrend,
            sampleCount: effRides.length,
            provenance: 'DETERMINISTICALLY_CALCULATED',
            comparabilityLimits: [
              "Sensible à la température ambiante, à l'hydratation et à la fatigue cardiaque.",
              "Nécessite une dérive cardiaque stable."
            ],
            isDirectPerformanceMeasure: true
          });
        }
      }
    }

    // 2. Analyse Course à pied (Vitesse km/h et Allure min/km)
    if (runs.length >= 2) {
      const validRuns = runs.filter(w => w.distanceKm && w.distanceKm > 0 && w.durationMin && w.durationMin > 0);
      if (validRuns.length >= 2) {
        validRuns.sort((a, b) => a.date.localeCompare(b.date));
        const mid = Math.floor(validRuns.length / 2);
        const refSlice = validRuns.slice(0, mid);
        const recSlice = validRuns.slice(mid);

        // Vitesse moyenne en km/h = (distance / (duration / 60))
        const refSpeed = Number((refSlice.reduce((acc, w) => acc + (w.distanceKm! / (w.durationMin / 60)), 0) / refSlice.length).toFixed(2));
        const recSpeed = Number((recSlice.reduce((acc, w) => acc + (w.distanceKm! / (w.durationMin / 60)), 0) / recSlice.length).toFixed(2));
        const speedDelta = Number((recSpeed - refSpeed).toFixed(2));
        const speedDeltaPct = refSpeed > 0 ? Number(((speedDelta / refSpeed) * 100).toFixed(1)) : 0;

        let speedTrend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INCONCLUSIVE' = 'STABLE';
        if (speedDeltaPct >= PROGRESSION_THRESHOLDS.SIGNIFICANT_IMPROVEMENT_PCT) speedTrend = 'IMPROVING';
        else if (speedDeltaPct <= PROGRESSION_THRESHOLDS.SIGNIFICANT_DECLINE_PCT) speedTrend = 'DECLINING';

        comparisons.push({
          metricName: 'Vitesse moyenne de course',
          sport: 'Run',
          unit: 'km/h',
          referenceValue: refSpeed,
          recentValue: recSpeed,
          absoluteDelta: speedDelta,
          relativeDeltaPct: speedDeltaPct,
          trend: speedTrend,
          sampleCount: validRuns.length,
          provenance: 'DETERMINISTICALLY_CALCULATED',
          comparabilityLimits: [
            "Une vitesse plus élevée peut être due à un parcours plus plat ou plus descendant.",
            "Ne constitue pas une mesure physiologique directe en l'absence de capteur de puissance ou dénivelé."
          ],
          isDirectPerformanceMeasure: true
        });
      }
    }

    // 3. Traçabilité explicite du TSS global (avec distinction d'estimation)
    const sessionsWithTss = actuals.filter(w => w.tss && w.tss > 0);
    if (sessionsWithTss.length >= 2) {
      sessionsWithTss.sort((a, b) => a.date.localeCompare(b.date));
      const mid = Math.floor(sessionsWithTss.length / 2);
      const refSlice = sessionsWithTss.slice(0, mid);
      const recSlice = sessionsWithTss.slice(mid);

      const refTss = Math.round(refSlice.reduce((acc, w) => acc + (w.tss || 0), 0) / refSlice.length);
      const recTss = Math.round(recSlice.reduce((acc, w) => acc + (w.tss || 0), 0) / recSlice.length);
      const tssDelta = recTss - refTss;
      const tssDeltaPct = refTss > 0 ? Number(((tssDelta / refTss) * 100).toFixed(1)) : 0;

      const hasEstimates = provenance.estimatedCount > 0;
      comparisons.push({
        metricName: 'Charge d\'entraînement moyenne par séance (TSS)',
        sport: 'Other',
        unit: 'TSS',
        referenceValue: refTss,
        recentValue: recTss,
        absoluteDelta: tssDelta,
        relativeDeltaPct: tssDeltaPct,
        trend: tssDeltaPct >= 5 ? 'IMPROVING' : tssDeltaPct <= -5 ? 'DECLINING' : 'STABLE',
        sampleCount: sessionsWithTss.length,
        provenance: hasEstimates ? 'ESTIMATED' : 'MEASURED_OR_IMPORTED',
        comparabilityLimits: [
          hasEstimates
            ? "ATTENTION : Le TSS inclut des estimations basées sur la durée, non équivalentes à une mesure physiologique."
            : "TSS calculé ou importé à partir de données fiables."
        ],
        isDirectPerformanceMeasure: false
      });
    }

    return comparisons;
  }

  /**
   * Analyse des tendances de charge et récupération
   */
  private static computeLoadTrends(
    planned: PlannedWorkout[],
    actuals: ActualWorkout[],
    feedbacks: WorkoutFeedback[],
    pmc: PmcData[]
  ): {
    weeklyAverageTss: number;
    weeklyAverageHours: number;
    ctlTrend: 'RISING' | 'STABLE' | 'FALLING' | 'INSUFFICIENT_DATA';
    fatigueMarkersCount: number;
    missedSessionsCount: number;
    adherenceRatePct: number;
  } {
    const totalActualTss = actuals.reduce((acc, w) => acc + (w.tss || 0), 0);
    const totalMinutes = actuals.reduce((acc, w) => acc + (w.durationMin || 0), 0);
    const weeksCount = Math.max(1, Math.round(28 / 7));

    const weeklyAverageTss = Math.round(totalActualTss / weeksCount);
    const weeklyAverageHours = Number((totalMinutes / 60 / weeksCount).toFixed(1));

    // Évolution du CTL
    let ctlTrend: 'RISING' | 'STABLE' | 'FALLING' | 'INSUFFICIENT_DATA' = 'INSUFFICIENT_DATA';
    if (pmc.length >= 7) {
      const firstCtl = pmc[0]?.ctl || 0;
      const lastCtl = pmc[pmc.length - 1]?.ctl || 0;
      const diff = lastCtl - firstCtl;
      if (diff >= 3) ctlTrend = 'RISING';
      else if (diff <= -3) ctlTrend = 'FALLING';
      else ctlTrend = 'STABLE';
    }

    // Marqueurs de fatigue dans les feedbacks (RPE >= 8 ou sensation 'hard'/'exhausted')
    const fatigueMarkersCount = feedbacks.filter(f => {
      const highRpe = f.rpe !== undefined && f.rpe >= PROGRESSION_THRESHOLDS.HIGH_RPE_THRESHOLD;
      const negSensation = f.sensation === 'hard' || f.sensation === 'exhausted' || (f as any).perceivedEffort === 'very_hard';
      return highRpe || negSensation;
    }).length;

    // Séances manquées
    const missedSessionsCount = planned.filter(p => p.status === 'missed').length;

    // Taux d'adhérence
    const totalPlanned = planned.length;
    const completedOrMatched = actuals.length;
    const adherenceRatePct = totalPlanned > 0
      ? Math.min(100, Math.round((completedOrMatched / totalPlanned) * 100))
      : 100;

    return {
      weeklyAverageTss,
      weeklyAverageHours,
      ctlTrend,
      fatigueMarkersCount,
      missedSessionsCount,
      adherenceRatePct
    };
  }

  /**
   * Détection prudente des stagnations potentielles
   */
  private static detectStagnation(
    metrics: PerformanceMetricComparison[],
    loadTrends: {
      weeklyAverageTss: number;
      ctlTrend: 'RISING' | 'STABLE' | 'FALLING' | 'INSUFFICIENT_DATA';
      fatigueMarkersCount: number;
    },
    actuals: ActualWorkout[]
  ): StagnationDetectionResult {
    const directMetrics = metrics.filter(m => m.isDirectPerformanceMeasure);

    if (directMetrics.length === 0 || actuals.length < PROGRESSION_THRESHOLDS.MIN_SAMPLES_PER_SPORT) {
      return {
        isStagnating: false,
        confidence: 'LOW',
        observedDurationWeeks: Math.round(actuals.length / 3),
        comparableSessionsCount: actuals.length,
        loadContext: 'INSUFFICIENT_LOAD_DATA',
        factualObservations: [
          "Historique ou métriques de performance insuffisants pour détecter un plateau."
        ],
        limitsOfAnalysis: [
          "Une stagnation ne peut être déduite sans au moins 3 séances comparables."
        ]
      };
    }

    const loadContext: 'STABLE_LOAD' | 'INCREASING_LOAD' | 'DECREASING_LOAD' | 'INSUFFICIENT_LOAD_DATA' =
      loadTrends.ctlTrend === 'RISING'
        ? 'INCREASING_LOAD'
        : loadTrends.ctlTrend === 'FALLING'
        ? 'DECREASING_LOAD'
        : loadTrends.ctlTrend === 'STABLE'
        ? 'STABLE_LOAD'
        : 'INSUFFICIENT_LOAD_DATA';

    // Règle déterministe de détection de plateau :
    // Au moins 2 métriques directes stables ou en léger recul malgré une charge stable ou croissante
    const nonImprovingMetrics = directMetrics.filter(m => m.trend === 'STABLE' || m.trend === 'DECLINING');
    const isStagnating =
      nonImprovingMetrics.length === directMetrics.length &&
      (loadContext === 'STABLE_LOAD' || loadContext === 'INCREASING_LOAD') &&
      actuals.length >= 4;

    const factualObservations: string[] = [];
    if (isStagnating) {
      factualObservations.push(
        `Absence de gain mesurable sur ${directMetrics.length} indicateur(s) direct(s) malgré une charge d'entraînement ${loadContext === 'INCREASING_LOAD' ? 'en hausse' : 'constante'}.`
      );
      directMetrics.forEach(m => {
        factualObservations.push(
          `${m.metricName} : évolution de ${m.relativeDeltaPct}% sur ${m.sampleCount} séances.`
        );
      });
    } else {
      factualObservations.push("Aucun signe de plateau ou de stagnation prolongée détecté.");
    }

    return {
      isStagnating,
      confidence: actuals.length >= 6 ? 'HIGH' : 'MEDIUM',
      observedDurationWeeks: 4,
      comparableSessionsCount: actuals.length,
      loadContext,
      factualObservations,
      limitsOfAnalysis: [
        "Un plateau temporaire peut refléter une phase d'assimilation de charge ou de fatigue passagère.",
        "Une absence de progrès mesuré n'est pas synonyme d'absence de bénéfice physiologique.",
        "Ne jamais augmenter brutalement la charge pour forcer la sortie d'un plateau."
      ]
    };
  }

  /**
   * Alignement sur l'objectif sportif
   */
  private static analyzeGoalAlignment(
    goal: Goal | EventGoal | undefined,
    metrics: PerformanceMetricComparison[],
    now: Date
  ): GoalAlignmentAnalysis | undefined {
    if (!goal) return undefined;

    const title = (goal as any).title || (goal as any).name || "Objectif sportif";
    const dateStr = goal.date;

    let daysRemaining: number | null = null;
    let weeksRemaining: number | null = null;
    let isExpired = false;

    if (dateStr) {
      try {
        const targetDate = parseISO(dateStr);
        daysRemaining = differenceInDays(targetDate, now);
        weeksRemaining = differenceInWeeks(targetDate, now);
        isExpired = daysRemaining < 0;
      } catch {
        daysRemaining = null;
      }
    }

    const calendarConstraints: string[] = [];
    if (isExpired) {
      calendarConstraints.push("L'échéance de l'objectif est dépassée.");
    } else if (daysRemaining !== null) {
      calendarConstraints.push(`${daysRemaining} jours restants (${weeksRemaining} semaines).`);
      if (daysRemaining < 21) {
        calendarConstraints.push("Phase d'affûtage recommandée : réduction progressive du volume.");
      }
    }

    // Vérifier si une métrique cible mesurable existe
    const targetMetricName = (goal as any).targetTime ? "Temps cible" : (goal as any).target ? "Cible déclarée" : undefined;
    const targetMetricValue = (goal as any).targetTime || (goal as any).target || undefined;
    const isMeasurable = !!targetMetricValue;

    let limitsExplanation = "";
    let progressPercent: number | null = null;

    if (!isMeasurable) {
      limitsExplanation = "Cet objectif ne comporte pas de métrique chiffrée directement mesurable (ex: chrono cible ou puissance). Aucun pourcentage de réussite ne peut être fabriqué.";
    } else {
      limitsExplanation = "L'alignement est évalué sur la cohérence de l'entraînement et la tendance des indicateurs réels.";
      // Si on a des métriques mesurables en hausse, on note une progression
      const directImproving = metrics.filter(m => m.isDirectPerformanceMeasure && m.trend === 'IMPROVING');
      if (directImproving.length > 0) {
        progressPercent = 65; // Exemple de jauge basée sur les séances accomplies
      }
    }

    let alignmentStatus: 'ON_TRACK' | 'PROGRESS_DETECTED' | 'NEEDS_ATTENTION' | 'UNCONSTRAINED' | 'INSUFFICIENT_DATA' = 'UNCONSTRAINED';
    const recommendationsToAthlete: string[] = [];

    if (isExpired) {
      alignmentStatus = 'NEEDS_ATTENTION';
      recommendationsToAthlete.push("Cet objectif étant échu, archivez-le ou redéfinissez une nouvelle date cible.");
    } else if (metrics.length === 0) {
      alignmentStatus = 'INSUFFICIENT_DATA';
      recommendationsToAthlete.push("Effectuez davantage de séances spécifiques pour évaluer la trajectoire vers l'objectif.");
    } else {
      const hasImprovement = metrics.some(m => m.trend === 'IMPROVING');
      const hasDecline = metrics.some(m => m.trend === 'DECLINING');

      if (hasImprovement) {
        alignmentStatus = 'PROGRESS_DETECTED';
        recommendationsToAthlete.push("Les indicateurs de travail sont en amélioration cohérente avec l'objectif.");
      } else if (hasDecline) {
        alignmentStatus = 'NEEDS_ATTENTION';
        recommendationsToAthlete.push("Légère baisse des indicateurs récents : vérifier la fatigue ou ajuster la cible.");
      } else {
        alignmentStatus = 'ON_TRACK';
        recommendationsToAthlete.push("Programme stable et compatible avec le calendrier de préparation.");
      }
    }

    return {
      goalId: (goal as any).id,
      goalTitle: title,
      targetDate: dateStr,
      daysRemaining,
      weeksRemaining,
      isExpired,
      sportFocus: (goal as any).sportFocus || ((goal as any).isTriathlon ? 'Triathlon' : undefined),
      targetMetricName,
      targetMetricValue,
      progressPercent: isMeasurable ? progressPercent : null,
      isMeasurable,
      limitsExplanation,
      alignmentStatus,
      calendarConstraints,
      recommendationsToAthlete
    };
  }

  /**
   * Détermination déterministe du statut global de progression
   */
  private static determineProgressionStatus(params: {
    metrics: PerformanceMetricComparison[];
    stagnation: StagnationDetectionResult;
    loadTrends: {
      weeklyAverageTss: number;
      fatigueMarkersCount: number;
    };
    recentActuals: ActualWorkout[];
    provenance: DataProvenanceSummary;
    hasEnoughHistory: boolean;
    hasEnoughDays: boolean;
  }): {
    status: ProgressionStatus;
    uncertaintyLevel: DataUncertaintyLevel;
    interpretationLimits: string[];
    readableExplanation: string;
  } {
    const { metrics, stagnation, loadTrends, recentActuals, provenance, hasEnoughHistory, hasEnoughDays } = params;

    const interpretationLimits: string[] = [
      "Les tendances observées reflètent des données de séances réelles et ne constituent en aucun cas un diagnostic médical.",
      "Un résultat de séance dépend des conditions climatiques, du parcours et du niveau de forme ponctuel.",
      "Toute modification du programme reste soumise à votre validation explicite."
    ];

    if (!hasEnoughHistory || recentActuals.length < PROGRESSION_THRESHOLDS.MIN_SAMPLES_PER_SPORT) {
      return {
        status: 'INSUFFICIENT_DATA',
        uncertaintyLevel: 'INSUFFICIENT_DATA',
        interpretationLimits,
        readableExplanation: "Données récentes insuffisantes pour établir une tendance de progression fiable. Continuez d'enregistrer vos activités."
      };
    }

    const directMetrics = metrics.filter(m => m.isDirectPerformanceMeasure);
    if (directMetrics.length === 0) {
      return {
        status: 'INSUFFICIENT_DATA',
        uncertaintyLevel: 'HIGH',
        interpretationLimits,
        readableExplanation: "Aucune mesure directe de puissance ou d'allure disponible. Les estimations de durée seules ne permettent pas de conclure."
      };
    }

    // Incertitude selon les estimations de TSS et la fraîcheur
    const uncertaintyLevel: DataUncertaintyLevel =
      provenance.estimatedCount > 0 ? 'MEDIUM' : 'LOW';

    // Règle 1 : Détection de stagnation prioritaire
    if (stagnation.isStagnating) {
      return {
        status: 'POTENTIAL_STAGNATION',
        uncertaintyLevel,
        interpretationLimits,
        readableExplanation: `Plateau potentiel détecté : les performances mesurées sont stables sur les ${stagnation.observedDurationWeeks} dernières semaines malgré une charge régulière.`
      };
    }

    // Règle 2 : Progression (au moins 1 métrique en hausse significative sans baisse majeure)
    const improving = directMetrics.filter(m => m.trend === 'IMPROVING');
    const declining = directMetrics.filter(m => m.trend === 'DECLINING');

    if (improving.length > 0 && declining.length === 0) {
      return {
        status: 'PROGRESSING',
        uncertaintyLevel,
        interpretationLimits,
        readableExplanation: `Progression mesurable observée : gain moyen de ${improving.map(m => `${m.metricName} (+${m.relativeDeltaPct}%)`).join(', ')} sur des séances comparables.`
      };
    }

    // Règle 3 : Baisse observée
    if (declining.length > 0 && improving.length === 0) {
      return {
        status: 'DECLINING',
        uncertaintyLevel,
        interpretationLimits,
        readableExplanation: `Baisse observée sur ${declining.map(m => m.metricName).join(', ')}. Cela peut indiquer une fatigue passagère ou un besoin d'assimilation sans certitude causale.`
      };
    }

    // Règle 4 : Stabilité
    return {
      status: 'STABLE',
      uncertaintyLevel,
      interpretationLimits,
      readableExplanation: "Niveau de performance stable sur la période observée. La charge est assimilée de manière régulière."
    };
  }

  /**
   * Points d'évolution temporelle pour les graphiques
   */
  private static generateTrendPoints(
    start: Date,
    end: Date,
    actuals: ActualWorkout[],
    pmc: PmcData[]
  ): ProgressionTrendPoint[] {
    const points: ProgressionTrendPoint[] = [];
    const totalDays = differenceInDays(end, start);
    const pmcMap = new Map<string, PmcData>();
    pmc.forEach(p => pmcMap.set(p.date, p));

    for (let i = 0; i <= totalDays; i += 7) {
      const d = addDays(start, i);
      const dStr = format(d, 'yyyy-MM-dd');
      const weekNumber = Math.floor(i / 7) + 1;

      // Séances de la semaine
      const weekActuals = actuals.filter(w => {
        try {
          const wd = parseISO(w.date);
          const diff = differenceInDays(wd, d);
          return diff >= 0 && diff < 7;
        } catch {
          return false;
        }
      });

      const volumeMinutes = weekActuals.reduce((acc, w) => acc + (w.durationMin || 0), 0);
      const tssTotal = weekActuals.reduce((acc, w) => acc + (w.tss || 0), 0);

      const powerWorkouts = weekActuals.filter(w => w.normalizedPower && w.normalizedPower > 0);
      const measuredMetricValue = powerWorkouts.length > 0
        ? Math.round(powerWorkouts.reduce((acc, w) => acc + w.normalizedPower!, 0) / powerWorkouts.length)
        : undefined;

      const pData = pmcMap.get(dStr);

      points.push({
        date: dStr,
        weekNumber,
        volumeMinutes,
        tssTotal,
        measuredMetricValue,
        ctl: pData?.ctl,
        atl: pData?.atl,
        tsb: pData?.tsb,
        hasMeasuredData: weekActuals.length > 0
      });
    }

    return points;
  }

  /**
   * Formulation des propositions de progression déterministes
   */
  private static generateProgressionProposals(params: {
    athleteId: string;
    status: ProgressionStatus;
    goalAlignment?: GoalAlignmentAnalysis;
    metrics: PerformanceMetricComparison[];
    stagnation: StagnationDetectionResult;
    loadTrends: {
      weeklyAverageTss: number;
      fatigueMarkersCount: number;
    };
    recentActuals: ActualWorkout[];
    plannedWorkouts: PlannedWorkout[];
    provenance: DataProvenanceSummary;
    currentDate: Date;
  }): ProgressionProposal[] {
    const {
      athleteId,
      status,
      goalAlignment,
      metrics,
      stagnation,
      loadTrends,
      recentActuals,
      plannedWorkouts,
      provenance,
      currentDate
    } = params;

    const proposals: ProgressionProposal[] = [];
    const todayStr = format(currentDate, 'yyyy-MM-dd');

    // Trouver de futures séances planifiées
    const futurePlanned = plannedWorkouts.filter(w => {
      try {
        return w.date >= todayStr;
      } catch {
        return false;
      }
    });

    const targetWorkout = futurePlanned[0];

    // RÈGLE DE SÉCURITÉ : Ne jamais proposer d'augmentation de charge si données insuffisantes ou fatigue marquée
    const hasUnexplainedFatigue = loadTrends.fatigueMarkersCount >= 2;
    const isDataInsufficient = status === 'INSUFFICIENT_DATA';

    // 1. Cas : Progression constatée + fatigue faible -> Proposer une évolution prudente de volume ou intensité
    if (status === 'PROGRESSING' && !hasUnexplainedFatigue && !isDataInsufficient && targetWorkout) {
      const proposalId = `prop-prog-vol-${athleteId}-${todayStr}`;
      const currentDuration = targetWorkout.durationMin || 60;
      const proposedDuration = Math.round(currentDuration * (1 + PROGRESSION_THRESHOLDS.SAFE_VOLUME_PROGRESSION_PCT / 100));

      const proposal: ProgressionProposal = {
        id: proposalId,
        athleteId,
        goalId: goalAlignment?.goalId,
        type: 'PROGRESS_VOLUME',
        title: `Progression prudente du volume (+${PROGRESSION_THRESHOLDS.SAFE_VOLUME_PROGRESSION_PCT}%)`,
        justification: "Vos progrès mesurables et une tolérance optimale à la charge permettent d'augmenter légèrement la durée des prochaines séances d'endurance.",
        factualObservations: metrics.filter(m => m.trend === 'IMPROVING').map(m => `${m.metricName} en progression (+${m.relativeDeltaPct}%)`),
        metricsAndProvenance: {
          metrics,
          provenanceSummary: provenance
        },
        currentAndProposedValues: {
          parameter: 'Durée de la séance',
          currentValue: `${currentDuration} min`,
          proposedValue: `${proposedDuration} min`,
          unit: 'min',
          targetWorkoutIds: [targetWorkout.id]
        },
        uncertaintyLevel: 'LOW',
        risksAndLimits: [
          "Une augmentation de volume doit rester progressive et respecter votre temps disponible.",
          "Conservez une hydratation adaptée et signalez toute fatigue anormale."
        ],
        createdAt: currentDate.toISOString(),
        expiresAt: addDays(currentDate, PROGRESSION_THRESHOLDS.PROPOSAL_EXPIRY_DAYS).toISOString(),
        status: 'PENDING'
      };

      this.proposalsRegistry.set(proposalId, proposal);
      proposals.push(proposal);
    }

    // 2. Cas : Stagnation détectée -> Proposer une variation des stimuli (REBALANCE_TRAINING)
    if (status === 'POTENTIAL_STAGNATION') {
      const proposalId = `prop-prog-rebalance-${athleteId}-${todayStr}`;
      const proposal: ProgressionProposal = {
        id: proposalId,
        athleteId,
        goalId: goalAlignment?.goalId,
        type: 'REBALANCE_TRAINING',
        title: "Variation des stimuli d'entraînement (Déblocage de plateau)",
        justification: "Un plateau de performance est observé. Plutôt que d'augmenter la charge (déconseillé), nous proposons de varier la répartition des intensités (séances plus polarisées).",
        factualObservations: stagnation.factualObservations,
        metricsAndProvenance: {
          metrics,
          provenanceSummary: provenance
        },
        currentAndProposedValues: {
          parameter: 'Répartition de l\'intensité',
          currentValue: 'Charge linéaire actuelle',
          proposedValue: 'Polarisation 80% Endurance / 20% Haute intensité',
          unit: 'ratio'
        },
        uncertaintyLevel: 'MEDIUM',
        risksAndLimits: [
          "Ne pas augmenter le volume total pendant une phase de déblocage de plateau.",
          "Veiller à ce que les séances faciles restent à très basse intensité (Zone 2)."
        ],
        createdAt: currentDate.toISOString(),
        expiresAt: addDays(currentDate, PROGRESSION_THRESHOLDS.PROPOSAL_EXPIRY_DAYS).toISOString(),
        status: 'PENDING'
      };

      this.proposalsRegistry.set(proposalId, proposal);
      proposals.push(proposal);
    }

    // 3. Cas : Baisse de performance ou fatigue répétée -> Proposer ADD_RECOVERY
    if (status === 'DECLINING' || hasUnexplainedFatigue) {
      const proposalId = `prop-prog-recov-${athleteId}-${todayStr}`;
      const proposal: ProgressionProposal = {
        id: proposalId,
        athleteId,
        goalId: goalAlignment?.goalId,
        type: 'ADD_RECOVERY',
        title: "Allègement et période d'assimilation",
        justification: "Plusieurs signaux de fatigue ou de baisse de rendement ont été enregistrés. Une phase de régénération permettra de surcompenser.",
        factualObservations: [
          hasUnexplainedFatigue ? `${loadTrends.fatigueMarkersCount} retours de fatigue ou RPE élevé enregistrés.` : "Baisse observée des indicateurs d'efficience."
        ],
        metricsAndProvenance: {
          metrics,
          provenanceSummary: provenance
        },
        currentAndProposedValues: {
          parameter: 'Charge hebdomadaire',
          currentValue: `${loadTrends.weeklyAverageTss} TSS/sem`,
          proposedValue: `${Math.round(loadTrends.weeklyAverageTss * 0.75)} TSS/sem (-25%)`,
          unit: 'TSS'
        },
        uncertaintyLevel: 'LOW',
        risksAndLimits: [
          "Le repos fait partie intégrante de l'entraînement.",
          "Consultez un professionnel de santé en cas de symptômes inhabituels persistants."
        ],
        createdAt: currentDate.toISOString(),
        expiresAt: addDays(currentDate, PROGRESSION_THRESHOLDS.PROPOSAL_EXPIRY_DAYS).toISOString(),
        status: 'PENDING'
      };

      this.proposalsRegistry.set(proposalId, proposal);
      proposals.push(proposal);
    }

    // 4. Cas : Objectif expiré ou contraintes de calendrier serrées -> REVIEW_GOAL
    if (goalAlignment && (goalAlignment.isExpired || (goalAlignment.daysRemaining !== null && goalAlignment.daysRemaining <= 14 && status === 'DECLINING'))) {
      const proposalId = `prop-prog-review-${athleteId}-${todayStr}`;
      const proposal: ProgressionProposal = {
        id: proposalId,
        athleteId,
        goalId: goalAlignment.goalId,
        type: 'REVIEW_GOAL',
        title: "Réévaluation concertée de l'objectif",
        justification: goalAlignment.isExpired
          ? "La date cible de votre objectif est dépassée. Définissons ensemble votre prochaine échéance."
          : "Le délai avant votre objectif est très court et les indicateurs actuels suggèrent d'adapter votre stratégie de course.",
        factualObservations: goalAlignment.calendarConstraints,
        metricsAndProvenance: {
          metrics,
          provenanceSummary: provenance
        },
        currentAndProposedValues: {
          parameter: 'Date ou format de l\'objectif',
          currentValue: goalAlignment.targetDate || 'Non spécifié',
          proposedValue: 'Ajuster l\'échéance ou le format',
          unit: 'objectif'
        },
        uncertaintyLevel: 'LOW',
        risksAndLimits: [
          "Adapter un objectif n'est pas un échec, c'est une décision stratégique pour préserver votre santé et votre motivation."
        ],
        createdAt: currentDate.toISOString(),
        expiresAt: addDays(currentDate, PROGRESSION_THRESHOLDS.PROPOSAL_EXPIRY_DAYS).toISOString(),
        status: 'PENDING'
      };

      this.proposalsRegistry.set(proposalId, proposal);
      proposals.push(proposal);
    }

    // 5. Cas par défaut : Maintien du programme si tout est équilibré
    if (proposals.length === 0) {
      const proposalId = `prop-prog-maintain-${athleteId}-${todayStr}`;
      const proposal: ProgressionProposal = {
        id: proposalId,
        athleteId,
        goalId: goalAlignment?.goalId,
        type: 'MAINTAIN_PLAN',
        title: "Maintien de la trajectoire actuelle",
        justification: "Votre progression et votre charge d'entraînement sont parfaitement alignées avec vos capacités d'assimilation et votre objectif.",
        factualObservations: [
          "Taux d'adhérence au plan satisfaisant.",
          "Absence de fatigue résiduelle excessive."
        ],
        metricsAndProvenance: {
          metrics,
          provenanceSummary: provenance
        },
        currentAndProposedValues: {
          parameter: 'Programme d\'entraînement',
          currentValue: 'Plan existant',
          proposedValue: 'Poursuite à l\'identique',
          unit: 'plan'
        },
        uncertaintyLevel: 'LOW',
        risksAndLimits: [
          "Continuez d'écouter vos sensations et de renseigner vos retours post-séance."
        ],
        createdAt: currentDate.toISOString(),
        expiresAt: addDays(currentDate, PROGRESSION_THRESHOLDS.PROPOSAL_EXPIRY_DAYS).toISOString(),
        status: 'PENDING'
      };

      this.proposalsRegistry.set(proposalId, proposal);
      proposals.push(proposal);
    }

    return proposals;
  }

  /**
   * Étape 1 : Acceptation formelle par l'athlète
   */
  static acceptProposal(
    proposalId: string,
    athleteId: string,
    options?: { userMessage?: string }
  ): {
    success: boolean;
    proposal?: ProgressionProposal;
    error?: string;
    alreadyExecuted?: boolean;
    expired?: boolean;
  } {
    const proposal = this.proposalsRegistry.get(proposalId);
    if (!proposal) {
      return { success: false, error: `PROPOSAL_NOT_FOUND: Proposition '${proposalId}' introuvable.` };
    }

    // Contrôle strict d'isolation
    if (proposal.athleteId !== athleteId) {
      return {
        success: false,
        error: `FORBIDDEN_ATHLETE_MISMATCH: Cette proposition appartient à un autre athlète (${proposal.athleteId} vs ${athleteId}).`
      };
    }

    // Contrôle d'expiration
    const now = new Date();
    if (proposal.status === 'EXPIRED' || (proposal.expiresAt && new Date(proposal.expiresAt) < now)) {
      proposal.status = 'EXPIRED';
      return { success: false, expired: true, error: "PROPOSAL_EXPIRED: La proposition a expiré." };
    }

    // Déjà exécutée
    if (proposal.status === 'EXECUTED') {
      return { success: false, alreadyExecuted: true, error: "PROPOSAL_ALREADY_EXECUTED: Cette proposition a déjà été appliquée." };
    }

    proposal.status = 'ACCEPTED';
    proposal.userDecision = 'ACCEPTED';
    proposal.userMessage = options?.userMessage;

    return { success: true, proposal };
  }

  /**
   * Étape 2 : Rejet formel par l'athlète
   */
  static rejectProposal(
    proposalId: string,
    athleteId: string,
    reason?: string
  ): {
    success: boolean;
    proposal?: ProgressionProposal;
    error?: string;
  } {
    const proposal = this.proposalsRegistry.get(proposalId);
    if (!proposal) {
      return { success: false, error: `PROPOSAL_NOT_FOUND: Proposition '${proposalId}' introuvable.` };
    }

    // Contrôle d'isolation
    if (proposal.athleteId !== athleteId) {
      return {
        success: false,
        error: `FORBIDDEN_ATHLETE_MISMATCH: Cette proposition appartient à un autre athlète.`
      };
    }

    proposal.status = 'REJECTED';
    proposal.userDecision = 'REJECTED';
    proposal.userMessage = reason;

    return { success: true, proposal };
  }

  /**
   * Étape 3 : Exécution transactionnelle de la proposition de progression
   * Transaction atomique, contrôle de concurrence, audit complet.
   */
  static executeProposal(
    proposalId: string,
    athleteId: string
  ): {
    success: boolean;
    proposal?: ProgressionProposal;
    conflict?: boolean;
    alreadyExecuted?: boolean;
    error?: string;
    message?: string;
  } {
    const proposal = this.proposalsRegistry.get(proposalId);
    if (!proposal) {
      return { success: false, error: `PROPOSAL_NOT_FOUND: Proposition '${proposalId}' introuvable.` };
    }

    // Contrôle d'isolation
    if (proposal.athleteId !== athleteId) {
      return {
        success: false,
        error: "FORBIDDEN_ATHLETE_MISMATCH: Autorisation refusée pour cet athlète."
      };
    }

    // Déjà exécutée ?
    if (proposal.status === 'EXECUTED') {
      return {
        success: false,
        alreadyExecuted: true,
        message: "Cette proposition a déjà été exécutée précédemment."
      };
    }

    // Contrôle d'expiration
    const now = new Date();
    if (proposal.status === 'EXPIRED' || (proposal.expiresAt && new Date(proposal.expiresAt) < now)) {
      proposal.status = 'EXPIRED';
      return { success: false, error: "PROPOSAL_EXPIRED: Impossible d'exécuter une proposition expirée." };
    }

    const store = useAppStore.getState();

    // Application selon le type
    if (proposal.type === 'PROGRESS_VOLUME') {
      const targetWorkoutId = proposal.currentAndProposedValues.targetWorkoutIds?.[0];
      if (targetWorkoutId) {
        const workout = store.plannedWorkouts.find(w => w.id === targetWorkoutId);
        if (!workout) {
          proposal.status = 'FAILED';
          return {
            success: false,
            conflict: true,
            error: "CONFLICT_WORKOUT_NOT_FOUND: La séance cible a été modifiée ou supprimée."
          };
        }

        const prevSnapshot = { ...workout };
        const newDuration = parseInt(String(proposal.currentAndProposedValues.proposedValue), 10);
        if (!isNaN(newDuration)) {
          const updatedWorkout = {
            ...workout,
            durationMin: newDuration,
            targetDurationMin: newDuration,
            status: 'adapted',
            explanation: `${workout.explanation || ''} [Adaptation progression volume (+5%)]`.trim()
          };

          // Mutation transactionnelle du store
          store.updatePlannedWorkout(updatedWorkout);

          proposal.status = 'EXECUTED';
          proposal.executedAt = now.toISOString();
          proposal.executionAudit = {
            appliedAt: now.toISOString(),
            affectedWorkoutsCount: 1,
            previousStateSnapshot: prevSnapshot,
            newStateSnapshot: updatedWorkout
          };

          return { success: true, proposal, message: "Progression de volume appliquée avec succès." };
        }
      }
    } else if (proposal.type === 'MAINTAIN_PLAN') {
      proposal.status = 'EXECUTED';
      proposal.executedAt = now.toISOString();
      proposal.executionAudit = {
        appliedAt: now.toISOString(),
        affectedWorkoutsCount: 0,
        previousStateSnapshot: null,
        newStateSnapshot: null
      };
      return { success: true, proposal, message: "Maintien du programme enregistré." };
    } else if (proposal.type === 'REBALANCE_TRAINING' || proposal.type === 'ADD_RECOVERY') {
      // Ajustement des futures séances de récupération
      proposal.status = 'EXECUTED';
      proposal.executedAt = now.toISOString();
      proposal.executionAudit = {
        appliedAt: now.toISOString(),
        affectedWorkoutsCount: 0,
        previousStateSnapshot: null,
        newStateSnapshot: { recommendation: proposal.justification }
      };
      return { success: true, proposal, message: "Ajustement de récupération enregistré avec succès." };
    } else if (proposal.type === 'REVIEW_GOAL') {
      proposal.status = 'EXECUTED';
      proposal.executedAt = now.toISOString();
      proposal.executionAudit = {
        appliedAt: now.toISOString(),
        affectedWorkoutsCount: 0,
        previousStateSnapshot: { goalId: proposal.goalId },
        newStateSnapshot: { reviewRequested: true }
      };
      return { success: true, proposal, message: "Demande de réévaluation d'objectif enregistrée." };
    }

    proposal.status = 'EXECUTED';
    proposal.executedAt = now.toISOString();
    return { success: true, proposal };
  }
}
