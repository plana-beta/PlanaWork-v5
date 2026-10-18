import {
  CoachConversationTurn,
  CoachIntent,
  CoachQuestion
} from '../domain/coachIntentTypes';
import {
  CoachProposal,
  CoachActionType,
  ConfidenceLevel
} from '../domain/coachTypes';
import { PlannedWorkout, Sport } from '../domain/models';
import { BuiltCoachContext } from './coachContextBuilder';
import { parseIntentDeterministically } from './coachIntentParser';
import { validateCoachIntent, IntentValidationContext } from './coachIntentValidator';
import { CoachProposalExplainer } from './coachProposalExplainer';
import { format, addDays } from 'date-fns';

export interface ConversationManagerOptions {
  currentDate?: Date;
  customIntent?: CoachIntent;
}

/**
 * Gestionnaire de conversation contextuelle et déterministe pour le Coach Plana.
 * RÈGLE D'OR :
 * - Aucune mutation du plan d'entraînement n'est effectuée lors d'un tour de conversation.
 * - Le Coach génère des explications factuelles, des questions ciblées (0 à 2 max),
 *   et des CoachProposal soumises à la validation explicite de l'athlète.
 */
export class CoachConversationManager {
  /**
   * Traite un message de l'utilisateur et produit un tour de conversation structuré.
   */
  static processMessage(
    userMessage: string,
    coachContext: BuiltCoachContext,
    options: ConversationManagerOptions = {}
  ): CoachConversationTurn {
    const currentDate = options.currentDate || new Date();
    const todayStr = format(currentDate, 'yyyy-MM-dd');

    // 1. Analyse d'intention (Intent Parsing)
    const parsedIntent = options.customIntent || parseIntentDeterministically(userMessage, coachContext, currentDate);

    // 2. Validation physiologique et contextuelle (Intent Validation)
    const valContext: IntentValidationContext = {
      coachContext,
      athleteProfile: coachContext.profile as any,
      plannedWorkouts: coachContext.todayWorkout ? [coachContext.todayWorkout as any] : [],
      currentDate
    };
    const validation = validateCoachIntent(parsedIntent, valContext);

    const turnId = `turn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    // 3. Si l'intention est bloquée ou rejetée pour des raisons de sécurité
    if (!validation.valid) {
      const errorMsg = validation.errors[0] || "Cette action ne peut pas être appliquée.";
      let coachResponse = errorMsg;
      if (validation.suggestedAlternative) {
        coachResponse += ` Suggestion : ${validation.suggestedAlternative}.`;
      }

      return {
        id: turnId,
        timestamp: new Date().toISOString(),
        userMessage,
        parsedIntent,
        confidence: parsedIntent.confidence,
        coachResponse,
        questions: validation.questions,
        proposal: null,
        suggestedAction: null
      };
    }

    // 4. Si des questions de clarification sont nécessaires
    if (validation.questions && validation.questions.length > 0) {
      const questionIntro = parsedIntent.type === 'REPORT_DISLIKE'
        ? "J'ai bien noté ta remarque sur cette séance."
        : "Pour adapter au mieux ton programme, j'ai besoin d'une précision :";

      return {
        id: turnId,
        timestamp: new Date().toISOString(),
        userMessage,
        parsedIntent,
        confidence: parsedIntent.confidence,
        coachResponse: questionIntro,
        questions: validation.questions,
        proposal: null
      };
    }

    // 5. Traitement des intentions informatives ou de statut
    if (parsedIntent.type === 'ASK_TODAY_WORKOUT') {
      return this.handleAskTodayWorkout(turnId, userMessage, parsedIntent, coachContext);
    }

    if (parsedIntent.type === 'ASK_WHY') {
      return this.handleAskWhy(turnId, userMessage, parsedIntent, coachContext);
    }

    if (parsedIntent.type === 'ASK_PLAN_STATUS') {
      const load = coachContext.weeklyPlannedLoad || 0;
      const statusText = `Ton plan prévoit une charge de ${load} TSS cette semaine. Ton état de fraîcheur (TSB: ${coachContext.pmcStatus?.tsb ?? 'N/A'}) et ta fatigue (ATL: ${coachContext.pmcStatus?.atl ?? 'N/A'}) sont sous surveillance.`;
      return {
        id: turnId,
        timestamp: new Date().toISOString(),
        userMessage,
        parsedIntent,
        confidence: 'HIGH',
        coachResponse: statusText,
        proposal: null,
        suggestedAction: 'OPEN_PLAN'
      };
    }

    if (parsedIntent.type === 'ASK_GOAL_STATUS') {
      const goal = coachContext.profile?.goal;
      const goalText = goal
        ? `Ton objectif actuel est "${(goal as any).target || goal.title}" prévu le ${goal.date} (${(goal as any).distanceKm ? (goal as any).distanceKm + ' km' : ''}). Ta condition physique actuelle (CTL: ${coachContext.pmcStatus?.ctl ?? 'N/A'}) progresse conformément à la planification.`
        : "Aucun objectif principal n'est actuellement configuré dans ton profil athlète.";
      return {
        id: turnId,
        timestamp: new Date().toISOString(),
        userMessage,
        parsedIntent,
        confidence: 'HIGH',
        coachResponse: goalText,
        proposal: null
      };
    }

    if (parsedIntent.type === 'REPORT_PREFERENCE') {
      const prefText = parsedIntent.context.preferenceStatement || userMessage;
      return {
        id: turnId,
        timestamp: new Date().toISOString(),
        userMessage,
        parsedIntent,
        confidence: 'HIGH',
        coachResponse: `C'est bien noté ! J'enregistre ta préférence : "${prefText}". Elle sera prise en compte lors des prochaines planifications.`,
        proposal: null
      };
    }

    if (parsedIntent.type === 'REPORT_LIKE') {
      return {
        id: turnId,
        timestamp: new Date().toISOString(),
        userMessage,
        parsedIntent,
        confidence: 'HIGH',
        coachResponse: "Super retour ! J'enregistre que cette séance te convient parfaitement pour en reprogrammer de similaires au moment opportun.",
        proposal: null
      };
    }

    if (parsedIntent.type === 'REPORT_MISSED_WORKOUT') {
      const reasonText = parsedIntent.context.reason === 'work' ? "en raison du travail" : "en raison d'un empêchement";
      return {
        id: turnId,
        timestamp: new Date().toISOString(),
        userMessage,
        parsedIntent,
        confidence: 'HIGH',
        coachResponse: `Séance manquée ${reasonText} enregistrée. Conformément aux principes de Plana, nous ne rattrapons pas cette charge pour éviter tout pic de fatigue. Nous poursuivons le plan prévu.`,
        proposal: null
      };
    }

    if (parsedIntent.type === 'REQUEST_GENERAL_ADVICE') {
      const tsb = coachContext.pmcStatus?.tsb ?? 0;
      let advice = "Pour optimiser ton entraînement, veille à bien respecter les allures cibles et hydrate-toi régulièrement.";
      if (tsb < -15) {
        advice = "Ton niveau de fatigue aigu est important (TSB négatif). Privilégie un sommeil réparateur et une alimentation riche en glucides complexes et protéines ce soir.";
      } else if (tsb > 10) {
        advice = "Tu disposes d'une excellente fraîcheur physique. C'est le moment idéal pour exploiter ton potentiel lors des séances rythmées.";
      }
      return {
        id: turnId,
        timestamp: new Date().toISOString(),
        userMessage,
        parsedIntent,
        confidence: 'MEDIUM',
        coachResponse: advice,
        proposal: null
      };
    }

    // 6. Traitement des intentions d'adaptation (Génération de propositions déterministes)
    const proposal = this.generateProposalForIntent(parsedIntent, coachContext, currentDate);

    let coachMsg = "Voici ma proposition d'adaptation pour ton entraînement :";
    if (parsedIntent.type === 'DELEGATE_DECISION') {
      coachMsg = "J'ai analysé tes métriques récentes, ta fatigue et tes disponibilités. Voici ce qui est le plus adapté pour toi aujourd'hui :";
    } else if (parsedIntent.type === 'REPORT_FATIGUE' || parsedIntent.type === 'REQUEST_LESS_LOAD') {
      coachMsg = "Compte tenu de ta fatigue, j'ai allégé ta séance pour favoriser la récupération sans perdre le bénéfice de l'entraînement :";
    } else if (parsedIntent.type === 'REPORT_ILLNESS') {
      coachMsg = "La santé passe avant tout. En cas d'état fébrile ou de maladie, le repos est impératif :";
    } else if (parsedIntent.type === 'REPORT_PAIN_OR_DISCOMFORT') {
      coachMsg = "Alerte de confort musculaire/articulaire enregistrée. Nous suspendons l'intensité pour préserver ton organisme :";
    } else if (parsedIntent.type === 'REQUEST_MOVE_WORKOUT') {
      coachMsg = `J'ai préparé le déplacement de ta séance au ${parsedIntent.context.targetDate || 'prochain créneau disponible'} :`;
    } else if (parsedIntent.type === 'REQUEST_CHANGE_SPORT') {
      coachMsg = `J'ai converti ta séance vers le ${parsedIntent.context.preferredSport || 'nouveau sport'} à charge équivalente :`;
    } else if (parsedIntent.type === 'REQUEST_CHANGE_DURATION') {
      coachMsg = `Séance recalibrée sur ${parsedIntent.context.requestedDurationMin || 60} minutes :`;
    } else if (parsedIntent.type === 'REQUEST_MORE_LOAD') {
      coachMsg = "Tu es en excellente forme ! J'ai ajouté une progression maîtrisée (+5% max) sur la séance :";
    }

    return {
      id: turnId,
      timestamp: new Date().toISOString(),
      userMessage,
      parsedIntent,
      confidence: parsedIntent.confidence,
      coachResponse: coachMsg,
      proposal,
      suggestedAction: null
    };
  }

  /**
   * Traitement spécifique du flux "Que dois-je faire aujourd'hui ?".
   */
  private static handleAskTodayWorkout(
    turnId: string,
    userMessage: string,
    parsedIntent: CoachIntent,
    coachContext: BuiltCoachContext
  ): CoachConversationTurn {
    const todayWorkout = coachContext.todayWorkout;
    const pmc = coachContext.pmcStatus;

    if (!todayWorkout) {
      return {
        id: turnId,
        timestamp: new Date().toISOString(),
        userMessage,
        parsedIntent,
        confidence: 'HIGH',
        coachResponse: "Aucune séance n'est planifiée pour toi aujourd'hui. C'est une journée de repos prévue au calendrier. Profites-en pour assimiler le travail passé !",
        proposal: null,
        suggestedAction: 'OPEN_PLAN'
      };
    }

    const durationMin = todayWorkout.durationMin || (todayWorkout as any).targetDurationMin || 60;
    const tss = (todayWorkout as any).targetTss || 50;
    const sportLabel = todayWorkout.sport === 'Ride' ? 'Vélo' : todayWorkout.sport === 'Run' ? 'Course à pied' : 'Natation';
    const workoutTitle = (todayWorkout as any).title || todayWorkout.sport;

    let coachResponse = `Aujourd'hui, ton plan prévoit une séance de **${sportLabel}** : "${workoutTitle}" (${durationMin} min, ~${tss} TSS).`;

    // Si fatigue détectée
    if (pmc && (pmc.fatigueLevel === 'high' || pmc.fatigueLevel === 'extreme')) {
      coachResponse += ` Attention, ta fatigue aiguë actuelle est élevée (ATL: ${pmc.atl}, TSB: ${pmc.tsb}). Si tu te sens émoussé, n'hésite pas à me demander d'alléger ou de convertir cette séance en récupération active.`;
    } else {
      coachResponse += ` Ta forme physique est propice à une bonne réalisation. Comment te sens-tu avant d'attaquer ?`;
    }

    return {
      id: turnId,
      timestamp: new Date().toISOString(),
      userMessage,
      parsedIntent,
      confidence: 'HIGH',
      coachResponse,
      proposal: null,
      suggestedAction: 'OPEN_TODAY_WORKOUT'
    };
  }

  /**
   * Traitement spécifique de l'explication "Pourquoi ?".
   */
  private static handleAskWhy(
    turnId: string,
    userMessage: string,
    parsedIntent: CoachIntent,
    coachContext: BuiltCoachContext
  ): CoachConversationTurn {
    const lastDecision = coachContext.historySummary?.lastCoachDecisions?.[0];
    let explanation = "Je calibre chaque recommandation sur tes données réelles (charge PMC, fraîcheur TSB, feedbacks et disponibilités).";

    if (lastDecision?.proposal) {
      explanation = CoachProposalExplainer.getWhyExplanation(lastDecision.proposal);
    } else if (coachContext.todayWorkout) {
      explanation = `Ta séance d'aujourd'hui s'inscrit dans ta planification globale avec une charge ciblée de ${(coachContext.todayWorkout as any).targetTss || 50} TSS pour développer ton endurance sans dépasser ta tolérance.`;
    }

    return {
      id: turnId,
      timestamp: new Date().toISOString(),
      userMessage,
      parsedIntent,
      confidence: 'HIGH',
      coachResponse: explanation,
      proposal: null
    };
  }

  /**
   * Génération déterministe d'une proposition de modification d'entraînement (CoachProposal).
   * RÈGLE STRICTE : Ne mute jamais le store. Retourne un objet de proposition prêt pour validation.
   */
  private static generateProposalForIntent(
    intent: CoachIntent,
    coachContext: BuiltCoachContext,
    currentDate: Date
  ): CoachProposal | null {
    const todayWorkout = coachContext.todayWorkout;
    const targetWorkoutId = todayWorkout?.id || 'w-target';
    const originalDuration = todayWorkout?.durationMin || (todayWorkout as any)?.targetDurationMin || 60;
    const originalTss = (todayWorkout as any)?.targetTss || 50;
    const todayStr = format(currentDate, 'yyyy-MM-dd');
    const weeklyLoad = coachContext.weeklyPlannedLoad || 250;

    let action: CoachActionType = 'ADAPT_PLAN';
    let reason = 'Ajustement de séance';
    let explanation = '';
    const proposedModifications: any[] = [];
    let proposedWeeklyLoad = weeklyLoad;

    switch (intent.type) {
      case 'REPORT_ILLNESS':
      case 'REPORT_PAIN_OR_DISCOMFORT':
        action = 'CANCEL_WORKOUT';
        reason = intent.type === 'REPORT_ILLNESS' ? 'Maladie déclarée - Repos complet' : 'Gêne physique - Mise au repos';
        explanation = "La priorité absolue est la récupération biologique. Aucun entraînement n'est maintenu tant que les symptômes persistent.";
        proposedModifications.push({
          workoutId: targetWorkoutId,
          cancel: true
        });
        proposedWeeklyLoad = Math.max(0, weeklyLoad - originalTss);
        break;

      case 'REPORT_FATIGUE':
      case 'REQUEST_LESS_LOAD':
      case 'REQUEST_RECOVERY': {
        action = intent.type === 'REQUEST_RECOVERY' ? 'RECOVERY' : 'REDUCE_LOAD';
        reason = 'Allègement pour récupération active';
        const newDuration = Math.max(30, Math.round(originalDuration * 0.65));
        const newTss = Math.max(20, Math.round(originalTss * 0.55));
        explanation = `Réduction de la durée (${originalDuration} min → ${newDuration} min) et maintien en Zone 1/Zone 2 pour dissiper la fatigue sans créer de dette supplémentaire.`;
        proposedModifications.push({
          workoutId: targetWorkoutId,
          newDurationMin: newDuration,
          newTargetTss: newTss,
          newIntensity: { type: 'zone', value: 'Z1-Z2' }
        });
        proposedWeeklyLoad = Math.max(0, weeklyLoad - (originalTss - newTss));
        break;
      }

      case 'REQUEST_MORE_LOAD': {
        action = 'INCREASE_LOAD';
        reason = 'Progression de charge maîtrisée (+5%)';
        const maxIncreasePct = intent.constraints.maxWeeklyLoadIncrease || 0.05;
        const additionalTss = Math.min(Math.round(weeklyLoad * maxIncreasePct), 25);
        const newTss = originalTss + additionalTss;
        const newDuration = originalDuration + 15;
        explanation = `Augmentation contenue de +${Math.round(maxIncreasePct * 100)}% maximum sur la séance pour accompagner ta bonne forme sans risquer de pic aigu.`;
        proposedModifications.push({
          workoutId: targetWorkoutId,
          newDurationMin: newDuration,
          newTargetTss: newTss
        });
        proposedWeeklyLoad = weeklyLoad + additionalTss;
        break;
      }

      case 'REQUEST_MOVE_WORKOUT': {
        action = 'MOVE_WORKOUT';
        const targetDate = intent.context.targetDate || format(addDays(currentDate, 1), 'yyyy-MM-dd');
        reason = `Déplacement de la séance au ${targetDate}`;
        explanation = `La séance est reportée au ${targetDate} sans altérer le volume ni la charge de travail hebdomadaire.`;
        proposedModifications.push({
          workoutId: targetWorkoutId,
          newDate: targetDate
        });
        break;
      }

      case 'REQUEST_CHANGE_SPORT': {
        action = 'MODIFY_WORKOUT';
        const targetSport = (intent.context.preferredSport as Sport) || 'Ride';
        reason = `Conversion vers ${targetSport}`;
        explanation = `Remplacement de la discipline tout en conservant une charge d'entraînement physiologique équivalente (~${originalTss} TSS).`;
        proposedModifications.push({
          workoutId: targetWorkoutId,
          newSport: targetSport
        });
        break;
      }

      case 'REQUEST_CHANGE_DURATION': {
        action = 'MODIFY_WORKOUT';
        const newDuration = intent.context.requestedDurationMin || 45;
        const ratio = newDuration / originalDuration;
        const newTss = Math.max(15, Math.round(originalTss * ratio));
        reason = `Ajustement de durée (${newDuration} min)`;
        explanation = `Recalibrage de la séance sur le temps disponible (${newDuration} min) avec recalcul déterministe de la charge cible (~${newTss} TSS).`;
        proposedModifications.push({
          workoutId: targetWorkoutId,
          newDurationMin: newDuration,
          newTargetTss: newTss
        });
        proposedWeeklyLoad = Math.max(0, weeklyLoad - (originalTss - newTss));
        break;
      }

      case 'REQUEST_CANCEL_WORKOUT': {
        action = 'CANCEL_WORKOUT';
        reason = "Annulation de la séance du jour";
        explanation = "La séance est annulée à ta demande. La charge perdue ne sera pas reportée sur d'autres séances.";
        proposedModifications.push({
          workoutId: targetWorkoutId,
          cancel: true
        });
        proposedWeeklyLoad = Math.max(0, weeklyLoad - originalTss);
        break;
      }

      case 'DELEGATE_DECISION': {
        // Délégation : choix de la meilleure stratégie déterministe
        const pmc = coachContext.pmcStatus;
        if (pmc && (pmc.fatigueLevel === 'high' || pmc.fatigueLevel === 'extreme' || pmc.tsb < -15)) {
          action = 'REDUCE_LOAD';
          reason = 'Stratégie déléguée : Allègement préventif de charge';
          const newDuration = Math.round(originalDuration * 0.7);
          const newTss = Math.round(originalTss * 0.6);
          explanation = "Au vu de ta fatigue aiguë calculée par Plana (TSB bas), la décision optimale est d'alléger la séance en Zone 2 pour maintenir l'adaptation sans puiser dans tes réserves.";
          proposedModifications.push({
            workoutId: targetWorkoutId,
            newDurationMin: newDuration,
            newTargetTss: newTss,
            newIntensity: { type: 'zone', value: 'Z2' }
          });
          proposedWeeklyLoad = Math.max(0, weeklyLoad - (originalTss - newTss));
        } else {
          action = 'ADAPT_PLAN';
          reason = 'Stratégie déléguée : Maintien et optimisation de la séance';
          explanation = "Tes métriques de fraîcheur et d'assimilation sont positives. Je te propose de maintenir la séance prévue en veillant à une allure régulière.";
          proposedModifications.push({
            workoutId: targetWorkoutId
          });
        }
        break;
      }

      default:
        action = 'ADAPT_PLAN';
        reason = 'Adaptation du programme';
        explanation = 'Ajustement calculé par Plana selon ton contexte actuel.';
        proposedModifications.push({ workoutId: targetWorkoutId });
        break;
    }

    const proposalId = `prop-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    return {
      id: proposalId,
      action,
      reason,
      explanation,
      affectedWorkoutIds: [targetWorkoutId],
      proposedModifications,
      constraints: {
        ...intent.constraints,
        maxWeeklyLoadIncrease: 0.05
      },
      confidence: intent.confidence,
      sourceContext: {
        currentWeeklyLoad: weeklyLoad,
        proposedWeeklyLoad,
        loadIncreasePercent: proposedWeeklyLoad > weeklyLoad ? Math.round(((proposedWeeklyLoad - weeklyLoad) / weeklyLoad) * 100) : 0,
        tsb: coachContext.pmcStatus?.tsb,
        atl: coachContext.pmcStatus?.atl,
        fatigueLevel: coachContext.pmcStatus?.fatigueLevel
      },
      impact: {
        weeklyTssDelta: proposedWeeklyLoad - weeklyLoad,
        previousWeeklyLoad: weeklyLoad,
        newWeeklyLoad: proposedWeeklyLoad,
        fatigueImpact: proposedWeeklyLoad < weeklyLoad ? 'reduces_fatigue' : proposedWeeklyLoad > weeklyLoad ? 'slight_increase' : 'maintains',
        summary: `Charge hebdomadaire : ${weeklyLoad} → ${proposedWeeklyLoad} TSS`
      },
      proposedAt: new Date().toISOString()
    };
  }

  /**
   * Traite la réponse d'un utilisateur à une question de clarification.
   */
  static handleQuestionAnswer(
    questionId: string,
    answerValue: string,
    coachContext: BuiltCoachContext,
    options: ConversationManagerOptions = {}
  ): CoachConversationTurn {
    const turnId = `turn-ans-${Date.now()}`;

    // Cas 1 : Confirmation de dislike ("q-confirm-dislike")
    if (questionId === 'q-confirm-dislike') {
      const isConfirmed = answerValue === 'confirm_permanent';
      if (isConfirmed) {
        return {
          id: turnId,
          timestamp: new Date().toISOString(),
          userMessage: "Oui, retenir pour toujours",
          confidence: 'HIGH',
          coachResponse: "C'est enregistré de façon permanente dans ta mémoire athlète. Je veillerai à ne plus te proposer ce type de séance.",
          proposal: null
        };
      } else {
        return {
          id: turnId,
          timestamp: new Date().toISOString(),
          userMessage: "Non, juste pour cette fois",
          confidence: 'HIGH',
          coachResponse: "D'accord, c'est pris en compte uniquement pour aujourd'hui sans modifier tes préférences permanentes.",
          proposal: null
        };
      }
    }

    // Cas 2 : Choix du mode d'allègement ("q-less-load-mode")
    if (questionId === 'q-less-load-mode') {
      const intent: CoachIntent = {
        type: 'REQUEST_LESS_LOAD',
        confidence: 'HIGH',
        context: {
          requestedDurationMin: answerValue === 'reduce_duration' ? 40 : undefined
        },
        constraints: {
          reduceDuration: answerValue === 'reduce_duration',
          reduceIntensity: answerValue === 'reduce_intensity'
        },
        rawMessage: answerValue === 'reduce_duration' ? "Réduire la durée" : "Baisser l'intensité",
        source: 'deterministic_rule'
      };

      return this.processMessage(
        intent.rawMessage,
        coachContext,
        { ...options, customIntent: intent }
      );
    }

    // Cas 3 : Alternative de date indisponible ("q-alternative-day")
    if (questionId === 'q-alternative-day') {
      if (answerValue === 'cancel') {
        const cancelIntent: CoachIntent = {
          type: 'REQUEST_CANCEL_WORKOUT',
          confidence: 'HIGH',
          context: {},
          constraints: { prioritizeRecovery: true },
          rawMessage: "Annuler la séance",
          source: 'deterministic_rule'
        };
        return this.processMessage(cancelIntent.rawMessage, coachContext, { ...options, customIntent: cancelIntent });
      } else {
        const currentDate = options.currentDate || new Date();
        const tomorrowStr = format(addDays(currentDate, 1), 'yyyy-MM-dd');
        const moveIntent: CoachIntent = {
          type: 'REQUEST_MOVE_WORKOUT',
          confidence: 'HIGH',
          context: { targetDate: tomorrowStr },
          constraints: { preserveRecovery: true },
          rawMessage: `Déplacer à demain (${tomorrowStr})`,
          source: 'deterministic_rule'
        };
        return this.processMessage(moveIntent.rawMessage, coachContext, { ...options, customIntent: moveIntent });
      }
    }

    return {
      id: turnId,
      timestamp: new Date().toISOString(),
      userMessage: answerValue,
      confidence: 'HIGH',
      coachResponse: "Merci pour ta précision, c'est bien pris en compte.",
      proposal: null
    };
  }
}
