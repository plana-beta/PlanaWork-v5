import { useAppStore } from '../store';
import { buildCoachContext, BuiltCoachContext } from '../lib/coachContextBuilder';
import { validateCoachProposal } from '../lib/coachActionValidator';
import { CoachActionExecutor } from '../lib/coachActionExecutor';
import {
  CoachProposal,
  CoachActionValidationResult,
  CoachActionExecutionResult,
  CoachIntent,
  CoachQuestion,
  CoachConversationTurn
} from '../domain/coachTypes';
import { CoachConversationManager } from '../lib/coachConversationManager';
import { parseIntentDeterministically, validateGeminiIntentPayload } from '../lib/coachIntentParser';
import { validateCoachIntent } from '../lib/coachIntentValidator';

export type CoachContext = BuiltCoachContext;

export interface CoachResponse {
  success: boolean;
  message: string;
  suggestedAction?: 'OPEN_TODAY_WORKOUT' | 'OPEN_PLAN' | 'SYNC_HEALTH' | null;
  error?: string;
  proposal?: CoachProposal | null;
  validationResult?: CoachActionValidationResult;
  questions?: CoachQuestion[];
  intent?: CoachIntent;
  turn?: CoachConversationTurn;
}

export class CoachService {
  buildContext(currentDate: Date = new Date()): BuiltCoachContext {
    const store = useAppStore.getState();
    return buildCoachContext(
      store.athleteProfile,
      store.plannedWorkouts,
      store.actualWorkouts,
      store.pmc,
      currentDate,
      {
        feedbacks: store.workoutFeedbacks || [],
        observations: store.workoutObservations || [],
        habits: store.athleteHabits || [],
        preferences: store.athletePreferences || []
      }
    );
  }

  validateProposal(proposal: CoachProposal): CoachActionValidationResult {
    const store = useAppStore.getState();
    const context = this.buildContext();
    const currentPmc = store.pmc.length > 0 ? store.pmc[store.pmc.length - 1] : null;

    return validateCoachProposal(proposal, {
      plannedWorkouts: store.plannedWorkouts,
      currentPmc,
      confidence: context.confidence,
      weeklyPlannedLoad: context.weeklyPlannedLoad,
      athleteProfile: store.athleteProfile
    });
  }

  executeProposal(
    proposal: CoachProposal,
    options?: { userMessage?: string }
  ): CoachActionExecutionResult {
    return CoachActionExecutor.executeProposal(proposal, options);
  }

  recordDecision(decision: import('../domain/coachTypes').CoachDecision): void {
    useAppStore.getState().addCoachDecision?.(decision);
  }

  /**
   * Analyse locale et déterministe d'un message utilisateur.
   */
  parseIntent(userMessage: string, currentDate: Date = new Date()): CoachIntent {
    const context = this.buildContext(currentDate);
    return parseIntentDeterministically(userMessage, context, currentDate);
  }

  /**
   * Traite la réponse à une question de clarification déterministe.
   */
  answerQuestion(
    questionId: string,
    answerValue: string,
    currentDate: Date = new Date()
  ): CoachConversationTurn {
    const context = this.buildContext(currentDate);
    return CoachConversationManager.handleQuestionAnswer(questionId, answerValue, context, { currentDate });
  }

  /**
   * Moteur de conversation unifié.
   * Combine l'analyse d'intention déterministe, les règles de sécurité physiologiques,
   * et le traitement via Gemini côté serveur lorsque connecté.
   */
  async askCoach(prompt: string, currentDate: Date = new Date()): Promise<CoachResponse> {
    const context = this.buildContext(currentDate);

    // Étape 1 : Traitement déterministe local prioritaire (garantie de disponibilité et de conformité)
    const deterministicTurn = CoachConversationManager.processMessage(prompt, context, { currentDate });

    // Si l'intention est bloquée, ou pose des questions, ou est informative (ASK_TODAY_WORKOUT, ASK_WHY, etc.)
    // on s'appuie directement sur les moteurs métier purs pour une fidélité à 100%
    if (
      !deterministicTurn.proposal ||
      (deterministicTurn.questions && deterministicTurn.questions.length > 0) ||
      deterministicTurn.parsedIntent?.type === 'ASK_TODAY_WORKOUT' ||
      deterministicTurn.parsedIntent?.type === 'ASK_WHY' ||
      deterministicTurn.parsedIntent?.type === 'ASK_PLAN_STATUS' ||
      deterministicTurn.parsedIntent?.type === 'ASK_GOAL_STATUS' ||
      deterministicTurn.parsedIntent?.type === 'REPORT_DISLIKE' ||
      deterministicTurn.parsedIntent?.type === 'REPORT_PREFERENCE' ||
      deterministicTurn.parsedIntent?.type === 'DELEGATE_DECISION'
    ) {
      let valRes: CoachActionValidationResult | undefined;
      if (deterministicTurn.proposal) {
        valRes = this.validateProposal(deterministicTurn.proposal);
      }

      return {
        success: true,
        message: deterministicTurn.coachResponse,
        suggestedAction: deterministicTurn.suggestedAction as any,
        proposal: deterministicTurn.proposal,
        validationResult: valRes,
        questions: deterministicTurn.questions,
        intent: deterministicTurn.parsedIntent,
        turn: deterministicTurn
      };
    }

    // Étape 2 : Si connecté au serveur Express avec Gemini actif, enrichir la réponse
    try {
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt, context })
      });

      if (response.ok) {
        const data = await response.json();

        // Sécurité Gemini : valider l'absence de métriques inventées
        const safetyCheck = data.intent ? validateGeminiIntentPayload(data) : { valid: true };
        if (!safetyCheck.valid) {
          console.warn("[CoachService] Rejet payload Gemini :", (safetyCheck as any).rejectionReason);
          // Fallback sur le tour déterministe
          const valRes = deterministicTurn.proposal ? this.validateProposal(deterministicTurn.proposal) : undefined;
          return {
            success: true,
            message: deterministicTurn.coachResponse,
            suggestedAction: deterministicTurn.suggestedAction as any,
            proposal: deterministicTurn.proposal,
            validationResult: valRes,
            questions: deterministicTurn.questions,
            intent: deterministicTurn.parsedIntent,
            turn: deterministicTurn
          };
        }

        // Si Gemini a produit une proposition, la valider rigoureusement
        if (data.proposal) {
          const validation = this.validateProposal(data.proposal);
          data.validationResult = validation;
          if (!validation.valid) {
            console.warn("[CoachService] Proposition Gemini bloquée par le validateur :", validation.errors);
            // Fallback sur la proposition déterministe
            data.proposal = deterministicTurn.proposal;
            data.validationResult = deterministicTurn.proposal ? this.validateProposal(deterministicTurn.proposal) : undefined;
          }
        } else if (deterministicTurn.proposal) {
          data.proposal = deterministicTurn.proposal;
          data.validationResult = this.validateProposal(deterministicTurn.proposal);
        }

        return {
          success: true,
          message: data.message || deterministicTurn.coachResponse,
          suggestedAction: data.suggestedAction || deterministicTurn.suggestedAction,
          proposal: data.proposal,
          validationResult: data.validationResult,
          questions: deterministicTurn.questions,
          intent: deterministicTurn.parsedIntent,
          turn: deterministicTurn
        };
      }
    } catch (error: any) {
      console.warn("[CoachService] Mode hors-ligne ou serveur indisponible, réponse déterministe utilisée:", error?.message);
      return {
        success: false,
        message: `Mode hors-ligne ou serveur indisponible: ${deterministicTurn.coachResponse}`,
        suggestedAction: deterministicTurn.suggestedAction as any,
        proposal: deterministicTurn.proposal,
        validationResult: deterministicTurn.proposal ? this.validateProposal(deterministicTurn.proposal) : undefined,
        questions: deterministicTurn.questions,
        intent: deterministicTurn.parsedIntent,
        turn: deterministicTurn
      };
    }

    // Fallback propre : retour de la décision déterministe
    const valRes = deterministicTurn.proposal ? this.validateProposal(deterministicTurn.proposal) : undefined;
    return {
      success: true,
      message: deterministicTurn.coachResponse,
      suggestedAction: deterministicTurn.suggestedAction as any,
      proposal: deterministicTurn.proposal,
      validationResult: valRes,
      questions: deterministicTurn.questions,
      intent: deterministicTurn.parsedIntent,
      turn: deterministicTurn
    };
  }
}

export const coachService = new CoachService();
