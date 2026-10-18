import { Sport, AthleteProfile, Goal, PlannedWorkout, ActualWorkout } from '../domain/models';
import {
  ConfidenceLevel,
  CoachProposal,
  CoachActionValidationResult,
  CoachDecisionStatus
} from '../domain/coachTypes';
import {
  WorkoutFeedback,
  WorkoutObservation,
  AthleteHabit,
  AthletePreference,
  SimilarWorkoutsStat
} from '../domain/athleteHistoryTypes';
import {
  AthleteMemoryItem,
  MemoryCategory,
  MemorySource,
  PermanentAvailability,
  TemporaryAvailability,
  IllnessEpisode,
  InjuryEpisode,
  RecoveryLog,
  CoachProposalError,
  AthleteLogicalMemory
} from '../domain/athleteMemoryTypes';
import { parseISO, isBefore, isAfter, startOfDay, differenceInDays } from 'date-fns';

/**
 * Création d'un élément de mémoire normalisé avec métadonnées complètes.
 * Supporte à la fois l'appel par objet d'options ou l'appel positionnel.
 */
export function createMemoryItem<T>(
  categoryOrParams: MemoryCategory | {
    id?: string;
    category: MemoryCategory;
    type?: string;
    value: T;
    source: MemorySource;
    confidence?: ConfidenceLevel | number;
    sampleSize?: number;
    firstObservedAt?: string;
    lastObservedAt?: string;
    expiresAt?: string;
    currentDate?: Date;
    tags?: string[];
  },
  value?: T,
  meta?: {
    source?: MemorySource;
    type?: string;
    confidence?: ConfidenceLevel | number;
    sampleSize?: number;
    firstObservedAt?: string;
    lastObservedAt?: string;
    expiresAt?: string;
    currentDate?: Date;
    tags?: string[];
  }
): AthleteMemoryItem<T> {
  if (typeof categoryOrParams === 'string') {
    const category = categoryOrParams;
    const now = meta?.currentDate ? meta.currentDate.toISOString() : new Date().toISOString();
    let conf: ConfidenceLevel = 'MEDIUM';
    if (typeof meta?.confidence === 'number') {
      conf = meta.confidence >= 0.8 ? 'HIGH' : meta.confidence >= 0.5 ? 'MEDIUM' : 'LOW';
    } else if (meta?.confidence) {
      conf = meta.confidence;
    }

    return {
      id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      category,
      type: meta?.type || category,
      value: value as T,
      source: meta?.source || 'plana_analysis',
      createdAt: now,
      updatedAt: now,
      confidence: conf,
      sampleSize: meta?.sampleSize,
      firstObservedAt: meta?.firstObservedAt || now,
      lastObservedAt: meta?.lastObservedAt || now,
      expiresAt: meta?.expiresAt,
      isOverridden: false,
      tags: meta?.tags
    };
  }

  const params = categoryOrParams;
  const now = params.currentDate ? params.currentDate.toISOString() : new Date().toISOString();
  let conf: ConfidenceLevel = 'MEDIUM';
  if (typeof params.confidence === 'number') {
    conf = params.confidence >= 0.8 ? 'HIGH' : params.confidence >= 0.5 ? 'MEDIUM' : 'LOW';
  } else if (params.confidence) {
    conf = params.confidence;
  }

  return {
    id: params.id || `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    category: params.category,
    type: params.type || params.category,
    value: params.value,
    source: params.source,
    createdAt: now,
    updatedAt: now,
    confidence: conf,
    sampleSize: params.sampleSize,
    firstObservedAt: params.firstObservedAt || now,
    lastObservedAt: params.lastObservedAt || now,
    expiresAt: params.expiresAt,
    isOverridden: false,
    tags: params.tags
  };
}

/**
 * Enregistrement ou révision d'une habitude athlète.
 * RÈGLE STRICTE: Les habitudes sont révisables et ne sont JAMAIS figées définitivement.
 * Une habitude observée n'est PAS une préférence.
 */
export function updateOrReviseHabit(
  existingHabits: AthleteHabit[],
  updatedHabit: Partial<AthleteHabit> & { type: string; description: string },
  currentDate: Date = new Date()
): AthleteHabit {
  const now = currentDate.toISOString();
  const index = existingHabits.findIndex(h => h.id === updatedHabit.id || h.type === updatedHabit.type);

  if (index >= 0) {
    const prev = existingHabits[index];
    const newCount = updatedHabit.occurrenceCount !== undefined
      ? updatedHabit.occurrenceCount
      : (prev.occurrenceCount || 1) + 1;

    let conf: AthleteHabit['confidence'] = 'low';
    if (updatedHabit.confidence) {
      conf = updatedHabit.confidence;
    } else if (newCount >= 3) {
      conf = 'high';
    } else if (newCount === 2) {
      conf = 'medium';
    }

    const revised: AthleteHabit = {
      ...prev,
      ...updatedHabit,
      id: prev.id,
      type: updatedHabit.type,
      description: updatedHabit.description,
      category: updatedHabit.category || prev.category || 'schedule',
      occurrenceCount: newCount,
      confidence: conf,
      firstObservedAt: prev.firstObservedAt || now,
      lastObservedAt: now,
      sources: Array.from(new Set([...(prev.sources || []), ...(updatedHabit.sources || ['post_workout_feedback'])]))
    };
    return revised;
  }

  const initialCount = updatedHabit.occurrenceCount !== undefined ? updatedHabit.occurrenceCount : 1;
  const initialConf = updatedHabit.confidence || (initialCount >= 3 ? 'high' : initialCount === 2 ? 'medium' : 'low');

  const newHabit: AthleteHabit = {
    id: updatedHabit.id || `hab-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    type: updatedHabit.type,
    category: updatedHabit.category || 'schedule',
    description: updatedHabit.description,
    confidence: initialConf,
    firstObservedAt: updatedHabit.firstObservedAt || now,
    lastObservedAt: updatedHabit.lastObservedAt || now,
    occurrenceCount: initialCount,
    period: updatedHabit.period || 'all_time',
    sources: updatedHabit.sources || ['post_workout_feedback']
  };

  return newHabit;
}

/**
 * Gestion et résolution déterministe des conflits de préférences.
 *
 * RÈGLES :
 * 1. Une préférence explicite de l'utilisateur ('user_explicit') prime sur une préférence détectée ('observed_pattern').
 * 2. Entre deux préférences de même portée, la plus récente prend le dessus.
 * 3. L'ancienne préférence n'est PAS supprimée : elle est archivée dans l'historique.
 * 4. Une préférence temporaire active est prioritaire durant sa période de validité.
 */
export function resolvePreferenceConflict(
  existingPreferences: AthletePreference[],
  newPreference: AthletePreference,
  currentDate: Date = new Date()
): {
  updatedPreferences: AthletePreference[];
  activePreferences: AthletePreference[];
  supersededPreference?: AthletePreference;
} {
  const newTopic = extractTopicKey(newPreference.category, newPreference.statement);

  let supersededPreference: AthletePreference | undefined;

  const updatedPreferences: AthletePreference[] = [];

  for (const existing of existingPreferences) {
    const existingTopic = extractTopicKey(existing.category, existing.statement);
    const isConflict = existing.category === newPreference.category && existingTopic === newTopic;

    if (isConflict) {
      supersededPreference = existing;
      // On conserve l'ancienne en désactivant sa confirmation pour archiver
      // ou on l'exclut de la liste courante
    } else {
      updatedPreferences.push(existing);
    }
  }

  const allPrefs = [newPreference, ...updatedPreferences];
  const active = filterActiveAndUnconflictedPreferences(allPrefs, currentDate);

  return {
    updatedPreferences: allPrefs,
    activePreferences: active,
    supersededPreference
  };
}

/**
 * Filtrage des préférences actives en tenant compte :
 * - de la confirmation (isConfirmed === true)
 * - de l'expiration des préférences temporaires
 * - de la priorité des préférences explicites récentes
 * - de la priorité temporaire sur la permanente
 */
export function filterActiveAndUnconflictedPreferences(
  preferences: AthletePreference[],
  currentDate: Date = new Date()
): AthletePreference[] {
  const today = startOfDay(currentDate);

  // 1. Éliminer les préférences non confirmées
  const confirmed = preferences.filter(p => p.isConfirmed);

  // 2. Éliminer les préférences temporaires expirées
  const notExpired = confirmed.filter(pref => {
    if (pref.type === 'TEMPORARY' && pref.endDate) {
      try {
        const end = startOfDay(parseISO(pref.endDate));
        if (isBefore(end, today)) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  });

  // 3. Trier par priorité stricte :
  // a. Préférences temporaires actives d'abord
  // b. Préférences explicites ('user_explicit') ensuite
  // c. Date de création la plus récente
  const sorted = [...notExpired].sort((a, b) => {
    const aIsTemp = a.type === 'TEMPORARY';
    const bIsTemp = b.type === 'TEMPORARY';
    if (aIsTemp && !bIsTemp) return -1;
    if (bIsTemp && !aIsTemp) return 1;

    const aIsExplicit = a.source === 'user_explicit';
    const bIsExplicit = b.source === 'user_explicit';
    if (aIsExplicit && !bIsExplicit) return -1;
    if (bIsExplicit && !aIsExplicit) return 1;

    return b.createdAt.localeCompare(a.createdAt);
  });

  // 4. Déduplication par topic unique : le premier (le plus prioritaire) gagne
  const resolved: AthletePreference[] = [];
  const seenTopics = new Set<string>();

  for (const pref of sorted) {
    const topicKey = `${pref.category}:${extractTopicKey(pref.category, pref.statement)}`;
    if (!seenTopics.has(topicKey)) {
      seenTopics.add(topicKey);
      resolved.push(pref);
    }
  }

  return resolved;
}

function extractTopicKey(category: string, statement: string): string {
  if (category === 'time_of_day') return 'schedule_slot';
  if (category === 'rest_day') return 'rest_day';
  if (category === 'sport_priority') return 'sport_priority';

  const s = statement.toLowerCase();
  if (s.includes('matin') || s.includes('soir') || s.includes('midi')) return 'schedule_slot';
  if (s.includes('vélo') || s.includes('ride')) return 'bike_pref';
  if (s.includes('course') || s.includes('run')) return 'run_pref';
  if (s.includes('fractionné') || s.includes('interval')) return 'interval_pref';
  return s.slice(0, 20);
}

/**
 * Enregistrement d'un Dislike.
 * RÈGLE STRICTE: Un dislike persistant nécessite obligatoirement une confirmation de l'athlète.
 * Sans confirmation -> retourne null (aucun enregistrement permanent).
 */
export function handleDislikeRegistration(params: {
  statement: string;
  isConfirmed: boolean;
  source?: 'user_explicit' | 'coach_confirmed';
  currentDate?: Date;
}): AthletePreference | null {
  if (!params.isConfirmed) {
    return null;
  }

  const now = params.currentDate ? params.currentDate.toISOString() : new Date().toISOString();

  return {
    id: `dislike-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    category: 'dislike',
    statement: params.statement,
    isConfirmed: true,
    type: 'PERSISTENT',
    source: params.source || 'coach_confirmed',
    createdAt: now
  };
}

/**
 * Vérifie si une disponibilité temporaire est active à une date donnée.
 */
export function isTemporaryAvailabilityActive(
  tempAvail: TemporaryAvailability,
  targetDate: Date = new Date()
): boolean {
  try {
    const target = startOfDay(targetDate);
    const start = startOfDay(parseISO(tempAvail.startDate));
    const end = startOfDay(parseISO(tempAvail.endDate));
    return !isBefore(target, start) && !isAfter(target, end);
  } catch {
    return false;
  }
}

/**
 * Analyse et enregistre une décision Coach dans l'audit.
 * RÈGLE STRICTE : Un refus (REJECTED) ne doit JAMAIS créer une préférence ou un dislike automatique.
 */
export function auditCoachDecision(params: {
  id?: string;
  proposal: CoachProposal;
  userDecision: CoachDecisionStatus;
  validationResult: CoachActionValidationResult;
  outcomeObserved?: string;
  currentDate?: Date;
}): {
  decisionRecord: {
    id: string;
    proposal: CoachProposal;
    userDecision: CoachDecisionStatus;
    validationResult: CoachActionValidationResult;
    outcomeObserved?: string;
    createdAt: string;
  };
  inferredPreference: null; // RÈGLE ABSOLUE: zéro inférence automatique de préférence sur une décision unique
} {
  const now = params.currentDate ? params.currentDate.toISOString() : new Date().toISOString();

  return {
    decisionRecord: {
      id: params.id || `decision-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      proposal: params.proposal,
      userDecision: params.userDecision,
      validationResult: params.validationResult,
      outcomeObserved: params.outcomeObserved,
      createdAt: now
    },
    inferredPreference: null // TOUJOURS null: un refus unique n'est jamais une préférence
  };
}

/**
 * Enregistre une erreur ou un échec du Coach pour l'audit technique.
 * Ne jamais envoyer toutes les erreurs en vrac à Gemini.
 */
export function logCoachProposalError(params: {
  proposalId?: string;
  proposalAction?: string;
  category: CoachProposalError['category'];
  errorReason: string;
  contextSnapshot?: Record<string, unknown>;
  currentDate?: Date;
}): CoachProposalError {
  const now = params.currentDate ? params.currentDate.toISOString() : new Date().toISOString();

  return {
    id: `err-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    date: now.split('T')[0],
    proposalId: params.proposalId,
    proposalAction: params.proposalAction,
    category: params.category,
    errorReason: params.errorReason,
    contextSnapshot: params.contextSnapshot,
    createdAt: now
  };
}

export function disputeHabit(habit: AthleteHabit): AthleteHabit {
  return {
    ...habit,
    confidence: 'low',
    description: `${habit.description} (Contestée par l'athlète)`
  };
}

/**
 * Profil de reprise post-maladie / convalescence.
 * Garantit une progression douce (Z1/Z2, durée plafonnée) sans charge brusque.
 */
export function applyReturnToTrainingProfile(episode: IllnessEpisode): {
  maxDurationMin: number;
  maxIntensityZone: string;
  recommendation: string;
} {
  return {
    maxDurationMin: 45,
    maxIntensityZone: 'Z2',
    recommendation: `Reprise progressive post-épisode (${episode.declaredSymptoms?.join(', ') || 'convalescence'}) : limiter la durée à 45min et rester en endurance fondamentale Z1-Z2.`
  };
}

/**
 * Détecte si des refus répétés d'actions coach nécessitent une demande de clarification.
 * RÈGLE : Un refus persistant déclenche une demande de clarification, jamais une préférence arbitraire automatique.
 */
export function checkRepeatedRefusals(
  decisions: Array<{ userDecision: CoachDecisionStatus; proposal?: CoachProposal }>
): {
  requiresClarification: boolean;
  refusalCount: number;
  clarificationPrompt?: string;
} {
  const rejected = decisions.filter(d => d.userDecision === 'REJECTED');
  if (rejected.length >= 3) {
    return {
      requiresClarification: true,
      refusalCount: rejected.length,
      clarificationPrompt: "Tu as décliné plusieurs propositions récentes du Coach. Peux-tu préciser tes contraintes ou préférences actuelles pour adapter au mieux tes séances ?"
    };
  }
  return {
    requiresClarification: false,
    refusalCount: rejected.length
  };
}

/**
 * Gardien de sécurité : Gemini ne possède pas la mémoire et ne peut JAMAIS
 * écrire directement dans AthleteMemory.
 * Tout enregistrement doit passer par les fonctions déterministes de Plana.
 */
export function assertPlanaOwnsMemory(caller: string): void {
  if (caller.toLowerCase().includes('gemini') || caller.toLowerCase().includes('llm') || caller.toLowerCase().includes('model')) {
    throw new Error("VIOLATION DE SÉCURITÉ : Gemini ne possède pas la mémoire et ne peut pas écrire directement dans AthleteMemory.");
  }
}
