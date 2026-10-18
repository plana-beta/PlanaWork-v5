import {
  CoachIntent,
  CoachQuestion,
  CoachQuestionReason
} from '../domain/coachIntentTypes';
import { BuiltCoachContext } from './coachContextBuilder';
import { AthleteProfile, PlannedWorkout } from '../domain/models';
import { parseISO, format } from 'date-fns';

export interface IntentValidationContext {
  coachContext?: BuiltCoachContext;
  athleteProfile?: AthleteProfile | null;
  plannedWorkouts?: PlannedWorkout[];
  currentDate?: Date;
}

export interface CoachIntentValidationResult {
  valid: boolean;
  intent: CoachIntent;
  blockedReason?: string;
  errors: string[];
  warnings: string[];
  questions?: CoachQuestion[];
  requiresConfirmation?: boolean;
  confirmationTopic?: string;
  suggestedAlternative?: string;
}

/**
 * Valideur déterministe d'intentions utilisateur.
 * Vérifie la compatibilité de l'intention avec l'état physiologique, le planning et les disponibilités.
 */
export function validateCoachIntent(
  intent: CoachIntent,
  valContext: IntentValidationContext = {}
): CoachIntentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const questions: CoachQuestion[] = [];
  let blockedReason: string | undefined;
  let requiresConfirmation = false;
  let confirmationTopic: string | undefined;
  let suggestedAlternative: string | undefined;

  const coachCtx = valContext.coachContext;
  const profile = valContext.athleteProfile || coachCtx?.profile;
  const pmc = coachCtx?.pmcStatus;
  const todayWorkout = coachCtx?.todayWorkout;

  // 1. GESTION DES INTENTIONS DE CHARGE : REQUEST_MORE_LOAD
  if (intent.type === 'REQUEST_MORE_LOAD') {
    // Si fatigue élevée ou extrême -> REJET STRICT
    const isFatigued = pmc && (
      pmc.fatigueLevel === 'high' ||
      pmc.fatigueLevel === 'extreme' ||
      pmc.tsb < -20 ||
      pmc.atl > 80
    );

    if (isFatigued) {
      errors.push("Augmentation de charge refusée : ta fatigue aiguë actuelle (ATL/TSB) nécessite de préserver ta récupération.");
      warnings.push("Le Coach préconise le maintien ou un allègement de charge pour éviter le surmenage.");
      blockedReason = 'FATIGUE_TOO_HIGH';
      return {
        valid: false,
        intent,
        blockedReason,
        errors,
        warnings,
        suggestedAlternative: "Conserver la séance prévue ou opter pour une récupération active Z1"
      };
    }

    // Si données insuffisantes
    if (coachCtx?.confidence?.level === 'INSUFFICIENT_DATA') {
      errors.push("Données d'entraînement insuffisantes pour autoriser une hausse de charge sécurisée.");
      blockedReason = 'INSUFFICIENT_DATA';
      return {
        valid: false,
        intent,
        blockedReason,
        errors,
        warnings
      };
    }

    // Règle des +5% maximum
    if (!intent.constraints.maxWeeklyLoadIncrease || intent.constraints.maxWeeklyLoadIncrease > 0.05) {
      intent.constraints.maxWeeklyLoadIncrease = 0.05;
      warnings.push("La hausse de charge est plafonnée à +5% maximum de la charge hebdomadaire.");
    }
  }

  // 2. DÉPLACEMENT DE SÉANCE : VÉRIFICATION DE LA DISPONIBILITÉ
  if (intent.type === 'REQUEST_MOVE_WORKOUT' && intent.context.targetDate) {
    const targetDateStr = intent.context.targetDate;
    
    // Vérifier si la date cible est bloquée dans les disponibilités
    let isDayBlocked = false;
    let targetDayName = '';

    try {
      const parsedDate = parseISO(targetDateStr);
      targetDayName = format(parsedDate, 'EEEE').toLowerCase(); // e.g. 'wednesday'
    } catch {
      // Ignorer si format de date non ISO
    }

    // Vérifier disponibilités temporaires
    if ((coachCtx as any)?.availability?.temporaryBlockedDates?.includes(targetDateStr)) {
      isDayBlocked = true;
    }

    // Vérifier disponibilités permanentes
    const availableDays = profile?.availability?.availableDays || (coachCtx as any)?.availability?.availableDays;
    if (availableDays && availableDays.length > 0 && targetDayName) {
      if (!availableDays.includes(targetDayName)) {
        isDayBlocked = true;
      }
    }

    if (isDayBlocked) {
      blockedReason = 'DAY_UNAVAILABLE';
      errors.push(`Tu as indiqué ne pas être disponible le ${targetDateStr} (${targetDayName || 'jour ciblé'}).`);
      
      // Proposer une alternative par question ciblée (Max 1 question)
      questions.push({
        id: 'q-alternative-day',
        text: `Tu n'es pas disponible le ${targetDayName || 'jour ciblé'}. Préfères-tu déplacer la séance au lendemain ou annuler cette séance ?`,
        reason: 'UNAVAILABLE_DATE_ALTERNATIVE',
        required: true,
        options: [
          { label: 'Déplacer au lendemain', value: 'next_day' },
          { label: 'Remplacer par du repos', value: 'cancel' }
        ]
      });

      return {
        valid: false,
        intent,
        blockedReason,
        errors,
        warnings,
        questions,
        suggestedAlternative: "Décaler d'un jour supplémentaire ou annuler la séance"
      };
    }
  }

  // 3. AVERSION DÉCLARÉE : CONFIRMATION REQUISE
  if (intent.type === 'REPORT_DISLIKE') {
    requiresConfirmation = true;
    const activity = intent.context.dislikedActivity || 'ce type de séance';
    confirmationTopic = activity;
    
    questions.push({
      id: 'q-confirm-dislike',
      text: `Tu veux que je retienne que tu préfères éviter les ${activity} à l'avenir ?`,
      reason: 'DISLIKE_CONFIRMATION',
      required: true,
      options: [
        { label: 'Oui, retenir pour toujours', value: 'confirm_permanent' },
        { label: 'Non, juste pour cette fois', value: 'temporary_only' }
      ]
    });
  }

  // 4. CHANGEMENT D'OBJECTIF : INFOS MANQUANTES
  if (intent.type === 'REQUEST_GOAL_CHANGE') {
    const newGoal = intent.context.newGoal;
    if (!newGoal?.date) {
      questions.push({
        id: 'q-goal-date',
        text: "Quelle est la date prévue de ton nouvel objectif ?",
        reason: 'MISSING_GOAL_DETAILS',
        required: true
      });
    }
    if (!newGoal?.target && !newGoal?.distanceKm) {
      questions.push({
        id: 'q-goal-target',
        text: "Quel est le format ou la distance visée (ex: Marathon 42km, Semi, 10km) ?",
        reason: 'MISSING_GOAL_DETAILS',
        required: true,
        options: [
          { label: 'Marathon (42.2 km)', value: 'marathon' },
          { label: 'Semi-Marathon (21.1 km)', value: 'half_marathon' },
          { label: '10 km', value: '10km' },
          { label: 'Cyclosportive (120-160 km)', value: 'cyclosportive' }
        ]
      });
    }
  }

  // 5. DEMANDE AMBIGUË D'ALLÈGEMENT
  if (intent.type === 'REQUEST_LESS_LOAD') {
    // Si l'utilisateur n'a précisé ni durée ni intensité et qu'aucune séance du jour n'existe
    if (!intent.context.requestedDurationMin && !intent.constraints.reduceIntensity && !todayWorkout) {
      questions.push({
        id: 'q-less-load-mode',
        text: "Tu souhaites plutôt réduire la durée de ton entraînement ou baisser l'intensité (endurance douce) ?",
        reason: 'AMBIGUOUS_LESS_LOAD',
        required: false,
        options: [
          { label: 'Réduire la durée', value: 'reduce_duration' },
          { label: 'Baisser l\'intensité', value: 'reduce_intensity' }
        ]
      });
    }
  }

  // 6. SANTÉ ET DOULEUR : AUCUN DIAGNOSTIC MÉDICAL
  if (intent.type === 'REPORT_ILLNESS' || intent.type === 'REPORT_PAIN_OR_DISCOMFORT') {
    warnings.push("Information de santé notée. Plana n'établit aucun diagnostic médical. En cas de douleur aiguë ou persistante, consulte un médecin.");
  }

  // 7. SÉANCE MANQUÉE : INTERDICTION DE RATTRAPAGE CUMULATIF
  if (intent.type === 'REPORT_MISSED_WORKOUT') {
    warnings.push("Conformément aux principes d'entraînement de Plana, la charge de la séance manquée ne sera pas reportée en cumul sur les autres jours.");
  }

  // 8. LIMITATION STRICTE DU NOMBRE DE QUESTIONS (MAXIMUM 2 QUESTIONS)
  const finalQuestions = questions.slice(0, 2);

  return {
    valid: errors.length === 0,
    intent,
    blockedReason,
    errors,
    warnings,
    questions: finalQuestions.length > 0 ? finalQuestions : undefined,
    requiresConfirmation,
    confirmationTopic,
    suggestedAlternative
  };
}
