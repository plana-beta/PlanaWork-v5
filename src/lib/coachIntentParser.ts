import { Sport } from '../domain/models';
import { ConfidenceLevel } from '../domain/coachTypes';
import {
  CoachIntent,
  CoachIntentType,
  CoachIntentContext,
  CoachIntentConstraint,
  CoachQuestion
} from '../domain/coachIntentTypes';
import { BuiltCoachContext } from './coachContextBuilder';
import { addDays, format, nextWednesday, nextTuesday, nextThursday, nextFriday, nextSaturday, nextSunday, nextMonday } from 'date-fns';

/**
 * Mots-clés et expressions régulières pour l'analyse déterministe.
 */
const FORBIDDEN_METRIC_KEYWORDS = [
  'tss', 'ctl', 'atl', 'tsb', 'ftp', 'vo2max', 'power_zone', 'hr_max'
];

/**
 * Normalisation de texte pour parsing résistant aux accents, casse et ponctuation.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extraction de la cible temporelle (aujourd'hui, demain, jour de la semaine...).
 */
export function extractTargetDate(text: string, baseDate: Date = new Date()): { dateStr?: string; isRelative?: string; dayOfWeek?: string } {
  const norm = normalizeText(text);
  const todayStr = format(baseDate, 'yyyy-MM-dd');

  if (norm.includes("aujourd hui") || norm.includes('ce soir') || norm.includes('ce matin') || norm.includes('cet apres midi')) {
    return { dateStr: todayStr, isRelative: 'today' };
  }
  if (norm.includes('demain')) {
    const tomorrow = addDays(baseDate, 1);
    return { dateStr: format(tomorrow, 'yyyy-MM-dd'), isRelative: 'tomorrow' };
  }
  if (norm.includes('apres-demain') || norm.includes('apres demain')) {
    const afterTomorrow = addDays(baseDate, 2);
    return { dateStr: format(afterTomorrow, 'yyyy-MM-dd'), isRelative: 'after_tomorrow' };
  }
  if (norm.includes('hier')) {
    const yesterday = addDays(baseDate, -1);
    return { dateStr: format(yesterday, 'yyyy-MM-dd'), isRelative: 'yesterday' };
  }

  // Jours de la semaine
  const daysMap: Array<{ key: string; fn: (d: Date) => Date; enDay: string }> = [
    { key: 'lundi', fn: nextMonday, enDay: 'monday' },
    { key: 'mardi', fn: nextTuesday, enDay: 'tuesday' },
    { key: 'mercredi', fn: nextWednesday, enDay: 'wednesday' },
    { key: 'jeudi', fn: nextThursday, enDay: 'thursday' },
    { key: 'vendredi', fn: nextFriday, enDay: 'friday' },
    { key: 'samedi', fn: nextSaturday, enDay: 'saturday' },
    { key: 'dimanche', fn: nextSunday, enDay: 'sunday' }
  ];

  for (const item of daysMap) {
    if (norm.includes(item.key)) {
      const target = item.fn(baseDate);
      return { dateStr: format(target, 'yyyy-MM-dd'), dayOfWeek: item.enDay };
    }
  }

  // Match format direct YYYY-MM-DD
  const directMatch = text.match(/\b(202\d-[01]\d-[0-3]\d)\b/);
  if (directMatch) {
    return { dateStr: directMatch[1] };
  }

  return {};
}

/**
 * Extraction du sport mentionné.
 */
export function extractSports(text: string): { preferredSport?: Sport; rejectedSport?: Sport } {
  const norm = normalizeText(text);
  let preferredSport: Sport | undefined;
  let rejectedSport: Sport | undefined;

  // Détection de rejet : "ne veux pas courir", "pas envie de nager", etc.
  if (norm.includes('pas courir') || norm.includes('pas de course') || norm.includes('arreter de courir') || norm.includes('pas envie de courir')) {
    rejectedSport = 'Run';
  } else if (norm.includes('pas rouler') || norm.includes('pas de velo') || norm.includes('pas envie de velo')) {
    rejectedSport = 'Ride';
  } else if (norm.includes('pas nager') || norm.includes('pas de natation') || norm.includes('pas de piscine')) {
    rejectedSport = 'Swim';
  }

  // Détection de préférence / remplacement : "faire du vélo", "rouler demain", "courir à la place"
  if (norm.includes('velo') || norm.includes('rouler') || norm.includes('cyclisme') || norm.includes('sortie velo') || norm.includes('home trainer')) {
    preferredSport = 'Ride';
  } else if (norm.includes('courir') || norm.includes('course a pied') || norm.includes('footing') || norm.includes('trail')) {
    preferredSport = 'Run';
  } else if (norm.includes('natation') || norm.includes('nager') || norm.includes('piscine')) {
    preferredSport = 'Swim';
  }

  return { preferredSport, rejectedSport };
}

/**
 * Extraction de durée demandée en minutes.
 */
export function extractDurationMin(text: string): number | undefined {
  const norm = normalizeText(text);

  // "1 heure", "une heure", "2 heures"
  if (norm.includes('une heure') || norm.includes('1 heure') || norm.includes('1h00') || norm.includes('1h')) {
    if (!norm.includes('1h30') && !norm.includes('1h15') && !norm.includes('1h45')) {
      return 60;
    }
  }
  if (norm.includes('1h30') || norm.includes('une heure et demi') || norm.includes('1h 30')) return 90;
  if (norm.includes('1h15')) return 75;
  if (norm.includes('1h45')) return 105;
  if (norm.includes('2 heures') || norm.includes('2h') || norm.includes('2h00')) return 120;
  if (norm.includes('45 minutes') || norm.includes('45 min') || norm.includes('45m')) return 45;
  if (norm.includes('30 minutes') || norm.includes('30 min') || norm.includes('30m')) return 30;
  if (norm.includes('20 minutes') || norm.includes('20 min')) return 20;

  const matchMin = norm.match(/(\d{1,3})\s*(?:min|minutes)/);
  if (matchMin) {
    return parseInt(matchMin[1], 10);
  }

  return undefined;
}

/**
 * Parseur d'intention déterministe pour Plana.
 * Analyse les règles linguistiques métier sans appeler Gemini ni inventer de métriques.
 */
export function parseIntentDeterministically(
  userMessage: string,
  context?: BuiltCoachContext,
  currentDate: Date = new Date()
): CoachIntent {
  const norm = normalizeText(userMessage);
  const targetDateInfo = extractTargetDate(userMessage, currentDate);
  const sports = extractSports(userMessage);
  const durationMin = extractDurationMin(userMessage);

  // 1. DÉLÉGATION ("Fais ce que tu penses être le mieux")
  if (
    norm.includes('ce que tu penses etre le mieux') ||
    norm.includes('fais ce que tu veux') ||
    norm.includes('decide pour moi') ||
    norm.includes('fais au mieux') ||
    norm.includes('tu geres') ||
    norm.includes('comme tu le sens')
  ) {
    return {
      type: 'DELEGATE_DECISION',
      confidence: 'HIGH',
      context: {
        isDelegated: true,
        targetDate: targetDateInfo.dateStr || format(currentDate, 'yyyy-MM-dd')
      },
      constraints: {
        allowDelegation: true,
        prioritizeRecovery: context?.pmcStatus?.fatigueLevel === 'high' || context?.pmcStatus?.fatigueLevel === 'extreme'
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'ADAPT_PLAN'
    };
  }

  // 2. EXPLICATION ("Pourquoi tu me proposes ça ?")
  if (
    norm.includes('pourquoi tu me proposes') ||
    norm.includes('pourquoi cette proposition') ||
    norm.includes('pourquoi ma seance est') ||
    norm.includes('pourquoi ce changement') ||
    norm.startsWith('pourquoi')
  ) {
    return {
      type: 'ASK_WHY',
      confidence: 'HIGH',
      context: {
        targetDate: targetDateInfo.dateStr
      },
      constraints: {},
      rawMessage: userMessage,
      source: 'deterministic_rule'
    };
  }

  // 3. SÉANCE DU JOUR / QUE DOIS-JE FAIRE AUJOURD'HUI ?
  if (
    norm.includes('que dois-je faire aujourd') ||
    norm.includes('que dois je faire aujourd') ||
    norm.includes('quelle est ma seance') ||
    norm.includes('seance du jour') ||
    norm.includes('programme du jour') ||
    norm.includes('qu est-ce qui est prevu') ||
    norm.includes('qu est ce qui est prevu') ||
    (norm.includes('seance') && norm.includes("aujourd'hui") && !norm.includes('pas') && !norm.includes('annuler'))
  ) {
    return {
      type: 'ASK_TODAY_WORKOUT',
      confidence: 'HIGH',
      context: {
        targetDate: targetDateInfo.dateStr || format(currentDate, 'yyyy-MM-dd')
      },
      constraints: {},
      rawMessage: userMessage,
      source: 'deterministic_rule'
    };
  }

  // 4. MALADIE DÉCLARÉE
  if (
    norm.includes('malade') ||
    norm.includes('fievre') ||
    norm.includes('rhume') ||
    norm.includes('grippe') ||
    norm.includes('covid') ||
    norm.includes('angine') ||
    norm.includes('gastro')
  ) {
    return {
      type: 'REPORT_ILLNESS',
      confidence: 'HIGH',
      context: {
        illnessReported: true,
        symptoms: norm.includes('fievre') ? ['fever'] : norm.includes('rhume') ? ['cold'] : ['general_illness'],
        targetDate: targetDateInfo.dateStr || format(currentDate, 'yyyy-MM-dd')
      },
      constraints: {
        prioritizeRecovery: true,
        reduceIntensity: true,
        avoidHighIntensity: true
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'RECOVERY'
    };
  }

  // 5. DOULEUR / GÊNE PHYSIQUE (Interdiction de diagnostiquer)
  if (
    norm.includes('j ai mal') ||
    norm.includes('douleur') ||
    norm.includes('gene au') ||
    norm.includes('gene a la') ||
    norm.includes('tiraillement') ||
    norm.includes('tendinite') ||
    norm.includes('blessure')
  ) {
    let location = 'general';
    if (norm.includes('genou')) location = 'knee';
    else if (norm.includes('tendon')) location = 'achilles';
    else if (norm.includes('dos')) location = 'back';
    else if (norm.includes('cuisse') || norm.includes('ischio')) location = 'thigh';
    else if (norm.includes('mollet')) location = 'calf';

    return {
      type: 'REPORT_PAIN_OR_DISCOMFORT',
      confidence: 'HIGH',
      context: {
        painReported: true,
        painLocation: location,
        targetDate: targetDateInfo.dateStr || format(currentDate, 'yyyy-MM-dd')
      },
      constraints: {
        prioritizeRecovery: true,
        reduceIntensity: true
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'RECOVERY'
    };
  }

  // 6. FATIGUE / RESSENTI
  if (
    norm.includes('creve') ||
    norm.includes('fatigue') ||
    norm.includes('epuise') ||
    norm.includes('rince') ||
    norm.includes('lessive') ||
    norm.includes('nase') ||
    norm.includes('pas d energie') ||
    norm.includes('trop dur') ||
    norm.includes('mort de fatigue')
  ) {
    return {
      type: 'REPORT_FATIGUE',
      confidence: 'HIGH',
      context: {
        fatigueReported: true,
        targetDate: targetDateInfo.dateStr || format(currentDate, 'yyyy-MM-dd')
      },
      constraints: {
        reduceIntensity: true,
        prioritizeRecovery: true
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'REDUCE_LOAD'
    };
  }

  // 7. SÉANCE MANQUÉE (REPORT_MISSED_WORKOUT)
  if (
    norm.includes('pas fait ma seance') ||
    norm.includes('pas pu m entrainer') ||
    norm.includes('rate ma seance') ||
    norm.includes('manque ma seance') ||
    norm.includes('seance manquee') ||
    (norm.includes('hier') && (norm.includes('travail') || norm.includes('empechement') || norm.includes('pas pu')))
  ) {
    return {
      type: 'REPORT_MISSED_WORKOUT',
      confidence: 'HIGH',
      context: {
        targetDate: targetDateInfo.dateStr || format(addDays(currentDate, -1), 'yyyy-MM-dd'),
        reason: norm.includes('travail') ? 'work' : 'personal'
      },
      constraints: {
        // RÈGLE CARDINALE: Ne jamais rattraper/cumuler automatiquement la charge perdue
        preserveRecovery: true
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'ADAPT_PLAN'
    };
  }

  // 7b. ADAPTATION COMPLÈTE DE LA SEMAINE (REQUEST_FULL_WEEK_ADAPTATION)
  if (
    norm.includes('adapter toute la semaine') ||
    norm.includes('adapter ma semaine') ||
    norm.includes('adapter la semaine') ||
    norm.includes('reorganiser ma semaine') ||
    norm.includes('preparer ma course differemment') ||
    norm.includes('refaire mon planning') ||
    norm.includes('refaire ma semaine')
  ) {
    return {
      type: 'REQUEST_FULL_WEEK_ADAPTATION',
      confidence: 'HIGH',
      context: {
        targetDate: targetDateInfo.dateStr || format(currentDate, 'yyyy-MM-dd')
      },
      constraints: {
        preserveRecovery: true
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'ADAPT_PLAN'
    };
  }

  // 8. CHANGEMENT D'OBJECTIF (REQUEST_GOAL_CHANGE)
  if (
    norm.includes('mon objectif a change') ||
    norm.includes('changer mon objectif') ||
    norm.includes('preparer un marathon') ||
    norm.includes('viser un semi') ||
    norm.includes('nouvel objectif')
  ) {
    let target = 'Course';
    let distKm: number | undefined;
    if (norm.includes('marathon')) {
      target = 'Marathon';
      distKm = 42.195;
    } else if (norm.includes('semi')) {
      target = 'Semi-Marathon';
      distKm = 21.1;
    } else if (norm.includes('10km') || norm.includes('10 km')) {
      target = '10km';
      distKm = 10;
    } else if (norm.includes('cyclosportive') || norm.includes('gran fondo')) {
      target = 'Cyclosportive';
    }

    return {
      type: 'REQUEST_GOAL_CHANGE',
      confidence: distKm ? 'HIGH' : 'MEDIUM',
      context: {
        newGoal: {
          target,
          distanceKm: distKm
        }
      },
      constraints: {
        preserveGoal: true
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'ADAPT_PLAN'
    };
  }

  // 9. DISPONIBILITÉ (PERMANENTE vs TEMPORAIRE)
  if (
    norm.includes('pas disponible') ||
    norm.includes('pas dispo') ||
    norm.includes('ne peux pas m entrainer') ||
    norm.includes('peux pas m entrainer') ||
    norm.includes('plus disponible') ||
    norm.includes('disponibilite')
  ) {
    const isPermanent = norm.includes('a partir de maintenant') || norm.includes('desormais') || norm.includes('definitivement') || norm.includes('toujours');
    const isTemporary = !isPermanent;

    return {
      type: 'REQUEST_AVAILABILITY_CHANGE',
      confidence: 'HIGH',
      context: {
        isPermanent,
        isTemporary,
        targetDate: targetDateInfo.dateStr,
        availabilityChange: {
          dayOfWeek: targetDateInfo.dayOfWeek,
          date: targetDateInfo.dateStr,
          isAvailable: false,
          isPermanent
        }
      },
      constraints: {},
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'ADAPT_PLAN'
    };
  }

  // 10. DEMANDE D'AUGMENTATION DE CHARGE (REQUEST_MORE_LOAD)
  if (
    norm.includes('en faire plus') ||
    norm.includes('ajouter de l entrainement') ||
    norm.includes('augmenter la charge') ||
    (norm.includes('augmenter') && norm.includes('charge')) ||
    norm.includes('seance plus dure') ||
    norm.includes('plus d intensite') ||
    (norm.includes('sens super bien') && norm.includes('plus'))
  ) {
    return {
      type: 'REQUEST_MORE_LOAD',
      confidence: 'HIGH',
      context: {
        targetDate: targetDateInfo.dateStr || format(currentDate, 'yyyy-MM-dd')
      },
      constraints: {
        maxWeeklyLoadIncrease: 0.05
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'INCREASE_LOAD'
    };
  }

  // 11. DEMANDE D'ALLÈGEMENT / MOINS DE CHARGE (REQUEST_LESS_LOAD)
  if (
    norm.includes('faire moins') ||
    norm.includes('plus leger') ||
    norm.includes('alleger') ||
    norm.includes('diminuer la charge') ||
    norm.includes('reduire la charge') ||
    norm.includes('moins dur')
  ) {
    return {
      type: 'REQUEST_LESS_LOAD',
      confidence: 'HIGH',
      context: {
        targetDate: targetDateInfo.dateStr || format(currentDate, 'yyyy-MM-dd')
      },
      constraints: {
        reduceIntensity: true
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'REDUCE_LOAD'
    };
  }

  // 12. DÉPLACER UNE SÉANCE (REQUEST_MOVE_WORKOUT)
  if (
    norm.includes('deplacer') ||
    norm.includes('decaler') ||
    norm.includes('reporter') ||
    (norm.includes('prefere') && norm.includes('demain')) ||
    (norm.includes('il pleut') && (norm.includes('demain') || norm.includes('rouler')))
  ) {
    return {
      type: 'REQUEST_MOVE_WORKOUT',
      confidence: targetDateInfo.dateStr ? 'HIGH' : 'MEDIUM',
      context: {
        targetDate: targetDateInfo.dateStr,
        preferredSport: sports.preferredSport
      },
      constraints: {
        preserveRecovery: true
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'MOVE_WORKOUT'
    };
  }

  // 13. CHANGEMENT DE SPORT / REMPLACEMENT (REQUEST_CHANGE_SPORT / REQUEST_REPLACE_WORKOUT)
  if (
    sports.rejectedSport ||
    (sports.preferredSport && (norm.includes('a la place') || norm.includes('au lieu de') || norm.includes('remplacer'))) ||
    norm.includes('veux faire du velo') ||
    norm.includes('veux courir')
  ) {
    return {
      type: 'REQUEST_CHANGE_SPORT',
      confidence: 'HIGH',
      context: {
        preferredSport: sports.preferredSport,
        originalSport: sports.rejectedSport,
        targetDate: targetDateInfo.dateStr || format(currentDate, 'yyyy-MM-dd')
      },
      constraints: {
        preserveRecovery: true
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'MODIFY_WORKOUT'
    };
  }

  // 14. CHANGEMENT DE DURÉE (REQUEST_CHANGE_DURATION)
  if (
    durationMin !== undefined &&
    (norm.includes('n ai que') || norm.includes('n ai qu') || norm.includes('qu une') || norm.includes('seulement') || norm.includes('pas plus de') || norm.includes('disponible') || norm.includes('temps') || norm.includes('ce soir'))
  ) {
    return {
      type: 'REQUEST_CHANGE_DURATION',
      confidence: 'HIGH',
      context: {
        requestedDurationMin: durationMin,
        targetDate: targetDateInfo.dateStr || format(currentDate, 'yyyy-MM-dd')
      },
      constraints: {
        maxDurationMin: durationMin
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'MODIFY_WORKOUT'
    };
  }

  // 15. ANNULATION DE SÉANCE (REQUEST_CANCEL_WORKOUT)
  if (
    norm.includes('annuler la seance') ||
    norm.includes('supprimer la seance') ||
    norm.includes('pas de sport aujourd') ||
    norm.includes('rien faire aujourd')
  ) {
    return {
      type: 'REQUEST_CANCEL_WORKOUT',
      confidence: 'HIGH',
      context: {
        targetDate: targetDateInfo.dateStr || format(currentDate, 'yyyy-MM-dd')
      },
      constraints: {
        prioritizeRecovery: true
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'CANCEL_WORKOUT'
    };
  }

  // 16. DEMANDE DE RÉCUPÉRATION (REQUEST_RECOVERY)
  if (
    norm.includes('jour de repos') ||
    norm.includes('besoin de recup') ||
    norm.includes('repos complet') ||
    norm.includes('recuperation active')
  ) {
    return {
      type: 'REQUEST_RECOVERY',
      confidence: 'HIGH',
      context: {
        targetDate: targetDateInfo.dateStr || format(currentDate, 'yyyy-MM-dd')
      },
      constraints: {
        prioritizeRecovery: true
      },
      rawMessage: userMessage,
      source: 'deterministic_rule',
      suggestedProposalType: 'RECOVERY'
    };
  }

  // 17. PRÉFÉRENCE EXPLICITE (REPORT_PREFERENCE)
  if (
    norm.includes('je prefere') ||
    norm.includes('ma preference') ||
    norm.includes('j aime m entrainer')
  ) {
    return {
      type: 'REPORT_PREFERENCE',
      confidence: 'HIGH',
      context: {
        preferenceStatement: userMessage,
        preferredSport: sports.preferredSport
      },
      constraints: {},
      rawMessage: userMessage,
      source: 'deterministic_rule'
    };
  }

  // 18. AVERSION / DISLIKE (REPORT_DISLIKE)
  if (
    norm.includes('je ne veux plus faire ce type de seance') ||
    norm.includes('je n aime pas les seances') ||
    norm.includes('je n aime pas') ||
    norm.includes('je deteste') ||
    norm.includes('plus jamais de')
  ) {
    let activity = 'côtes';
    if (norm.includes('cote')) activity = 'séances de côtes';
    else if (norm.includes('fractionne')) activity = 'séances de fractionné';
    else if (norm.includes('home trainer')) activity = 'home trainer';
    else if (norm.includes('piste')) activity = 'séances sur piste';

    return {
      type: 'REPORT_DISLIKE',
      confidence: 'HIGH',
      context: {
        dislikedActivity: activity
      },
      constraints: {},
      rawMessage: userMessage,
      source: 'deterministic_rule'
    };
  }

  // 19. APPRÉCIATION (REPORT_LIKE)
  if (
    norm.includes('j ai adore cette seance') ||
    norm.includes('j ai adore') ||
    norm.includes('super seance') ||
    norm.includes('tu peux m en remettre') ||
    norm.includes('a refaire')
  ) {
    return {
      type: 'REPORT_LIKE',
      confidence: 'HIGH',
      context: {
        likedActivity: 'dernière séance'
      },
      constraints: {},
      rawMessage: userMessage,
      source: 'deterministic_rule'
    };
  }

  // 20. STATUT DU PLAN / DE L'OBJECTIF
  if (norm.includes('affiche mon objectif') || norm.includes('etat de mon objectif')) {
    return {
      type: 'ASK_GOAL_STATUS',
      confidence: 'HIGH',
      context: {},
      constraints: {},
      rawMessage: userMessage,
      source: 'deterministic_rule'
    };
  }
  if (norm.includes('ou en est mon plan') || norm.includes('etat de mon entrainement') || norm.includes('affiche mon plan')) {
    return {
      type: 'ASK_PLAN_STATUS',
      confidence: 'HIGH',
      context: {},
      constraints: {},
      rawMessage: userMessage,
      source: 'deterministic_rule'
    };
  }

  // 21. CONSEIL GÉNÉRAL
  if (norm.includes('conseil') || norm.includes('comment bien recuperer') || norm.includes('echauffement')) {
    return {
      type: 'REQUEST_GENERAL_ADVICE',
      confidence: 'MEDIUM',
      context: {},
      constraints: {},
      rawMessage: userMessage,
      source: 'deterministic_rule'
    };
  }

  // Fallback UNKNOWN
  return {
    type: 'UNKNOWN',
    confidence: 'LOW',
    context: {},
    constraints: {},
    rawMessage: userMessage,
    source: 'deterministic_rule',
    needsClarification: true,
    clarificationReason: "Demande non reconnue par les règles métier de Plana"
  };
}

/**
 * Validation de sécurité et filtrage des sorties brutes retournées par Gemini.
 * GARANTIE STRICTE :
 * - Rejette tout JSON invalide.
 * - Rejette toute métrique physiologique inventée (TSS, CTL, ATL, TSB, zones...).
 * - Valide la présence d'une intention connue.
 */
export function validateGeminiIntentPayload(rawPayload: unknown): {
  valid: boolean;
  intent?: CoachIntent;
  rejectionReason?: string;
} {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return { valid: false, rejectionReason: 'Payload Gemini vide ou non-objet' };
  }

  const p = rawPayload as Record<string, unknown>;

  // Vérifier qu'aucune métrique physiologique n'a été inventée
  for (const key of Object.keys(p)) {
    const lowerKey = key.toLowerCase();
    if (FORBIDDEN_METRIC_KEYWORDS.some(k => lowerKey.includes(k))) {
      return {
        valid: false,
        rejectionReason: `Métrique interdite inventée par Gemini détectée: ${key}`
      };
    }
  }

  // Vérifier dans les sous-objets (entities, constraints, metrics...)
  if (p.entities && typeof p.entities === 'object') {
    for (const key of Object.keys(p.entities as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (FORBIDDEN_METRIC_KEYWORDS.some(k => lowerKey.includes(k))) {
        return {
          valid: false,
          rejectionReason: `Métrique interdite inventée par Gemini dans entities: ${key}`
        };
      }
    }
  }

  const intentType = p.intent as CoachIntentType;
  const validTypes: CoachIntentType[] = [
    'ASK_TODAY_WORKOUT',
    'REPORT_FATIGUE',
    'REPORT_ILLNESS',
    'REPORT_PAIN_OR_DISCOMFORT',
    'REPORT_MISSED_WORKOUT',
    'REQUEST_LESS_LOAD',
    'REQUEST_MORE_LOAD',
    'REQUEST_CHANGE_SPORT',
    'REQUEST_CHANGE_DURATION',
    'REQUEST_CHANGE_INTENSITY',
    'REQUEST_MOVE_WORKOUT',
    'REQUEST_CANCEL_WORKOUT',
    'REQUEST_REPLACE_WORKOUT',
    'REQUEST_FULL_WEEK_ADAPTATION',
    'REQUEST_GOAL_CHANGE',
    'REQUEST_AVAILABILITY_CHANGE',
    'REQUEST_RECOVERY',
    'ASK_WHY',
    'ASK_PLAN_STATUS',
    'ASK_GOAL_STATUS',
    'REPORT_PREFERENCE',
    'REPORT_DISLIKE',
    'REPORT_LIKE',
    'REQUEST_GENERAL_ADVICE',
    'DELEGATE_DECISION',
    'UNKNOWN'
  ];

  if (!intentType || !validTypes.includes(intentType)) {
    return { valid: false, rejectionReason: `Type d'intention non reconnu : ${String(p.intent)}` };
  }

  const confidence: ConfidenceLevel = (p.confidence as ConfidenceLevel) || 'MEDIUM';

  const intent: CoachIntent = {
    type: intentType,
    confidence,
    context: (p.entities as CoachIntentContext) || (p.context as CoachIntentContext) || {},
    constraints: (p.constraints as CoachIntentConstraint) || {},
    rawMessage: (p.rawMessage as string) || '',
    needsClarification: Boolean(p.needsClarification),
    clarificationReason: p.clarificationReason as string | undefined,
    source: 'gemini_interpretation'
  };

  return { valid: true, intent };
}
