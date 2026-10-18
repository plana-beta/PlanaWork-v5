import { Sport } from './models';
import { ConfidenceLevel, CoachProposal, CoachDecisionStatus } from './coachTypes';

export type CoachIntentType =
  | 'ASK_TODAY_WORKOUT'
  | 'REPORT_FATIGUE'
  | 'REPORT_ILLNESS'
  | 'REPORT_PAIN_OR_DISCOMFORT'
  | 'REPORT_MISSED_WORKOUT'
  | 'REQUEST_LESS_LOAD'
  | 'REQUEST_MORE_LOAD'
  | 'REQUEST_CHANGE_SPORT'
  | 'REQUEST_CHANGE_DURATION'
  | 'REQUEST_CHANGE_INTENSITY'
  | 'REQUEST_MOVE_WORKOUT'
  | 'REQUEST_CANCEL_WORKOUT'
  | 'REQUEST_REPLACE_WORKOUT'
  | 'REQUEST_FULL_WEEK_ADAPTATION'
  | 'REQUEST_GOAL_CHANGE'
  | 'REQUEST_AVAILABILITY_CHANGE'
  | 'REQUEST_RECOVERY'
  | 'ASK_WHY'
  | 'ASK_PLAN_STATUS'
  | 'ASK_GOAL_STATUS'
  | 'REPORT_PREFERENCE'
  | 'REPORT_DISLIKE'
  | 'REPORT_LIKE'
  | 'REQUEST_GENERAL_ADVICE'
  | 'DELEGATE_DECISION'
  | 'UNKNOWN';

export interface CoachIntentContext {
  targetDate?: string;
  targetSport?: Sport | string;
  preferredSport?: Sport | string;
  originalSport?: Sport | string;
  requestedDurationMin?: number;
  fatigueReported?: boolean;
  fatigueScale?: number; // 1-5
  painReported?: boolean;
  painLocation?: string;
  illnessReported?: boolean;
  symptoms?: string[];
  dislikedActivity?: string;
  likedActivity?: string;
  preferenceStatement?: string;
  isTemporary?: boolean;
  isPermanent?: boolean;
  isDelegated?: boolean;
  reason?: string;
  newGoal?: {
    target?: string;
    date?: string;
    distanceKm?: number;
  };
  availabilityChange?: {
    dayOfWeek?: string;
    date?: string;
    isAvailable?: boolean;
    isPermanent?: boolean;
    reason?: string;
  };
  questionAnswer?: {
    questionId: string;
    selectedOption?: string;
    freeText?: string;
  };
  [key: string]: unknown;
}

export interface CoachIntentConstraint {
  reduceIntensity?: boolean;
  reduceDuration?: boolean;
  prioritizeRecovery?: boolean;
  preserveRecovery?: boolean;
  maxDurationMin?: number;
  avoidHighIntensity?: boolean;
  preserveGoal?: boolean;
  preserveKeyWorkout?: boolean;
  allowDelegation?: boolean;
  maxWeeklyLoadIncrease?: number;
  [key: string]: unknown;
}

export type CoachQuestionReason =
  | 'MISSING_TARGET_DATE'
  | 'MISSING_DURATION'
  | 'MISSING_SPORT_CHOICE'
  | 'MISSING_GOAL_DETAILS'
  | 'MISSING_FEELING_ASSESSMENT'
  | 'DISLIKE_CONFIRMATION'
  | 'AMBIGUOUS_LESS_LOAD'
  | 'UNAVAILABLE_DATE_ALTERNATIVE'
  | 'GENERAL_CLARIFICATION';

export interface CoachQuestionOption {
  label: string;
  value: string;
}

export interface CoachQuestion {
  id: string;
  text: string;
  reason: CoachQuestionReason;
  required: boolean;
  options?: CoachQuestionOption[];
}

export interface CoachIntent {
  type: CoachIntentType;
  confidence: ConfidenceLevel;
  context: CoachIntentContext;
  constraints: CoachIntentConstraint;
  rawMessage: string;
  needsClarification?: boolean;
  clarificationReason?: string;
  clarificationQuestions?: CoachQuestion[];
  source: 'deterministic_rule' | 'gemini_interpretation';
  suggestedProposalType?: 'ADAPT_PLAN' | 'MODIFY_WORKOUT' | 'MOVE_WORKOUT' | 'CANCEL_WORKOUT' | 'REDUCE_LOAD' | 'INCREASE_LOAD' | 'RECOVERY' | 'NO_CHANGE';
}

export interface CoachConversationTurn {
  id: string;
  timestamp: string;
  userMessage: string;
  parsedIntent?: CoachIntent;
  confidence?: ConfidenceLevel;
  relevantContextSummary?: string;
  coachResponse: string;
  questions?: CoachQuestion[];
  proposal?: CoachProposal | null;
  userDecision?: CoachDecisionStatus;
  suggestedAction?: string | null;
}
