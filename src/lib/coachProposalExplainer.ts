import { CoachProposal } from '../domain/coachTypes';
import { PlannedWorkout } from '../domain/models';

/**
 * CoachProposalExplainer
 * 
 * Génère des explications objectives et transparentes sur le "Pourquoi ?"
 * d'une proposition sans jamais inventer de données non présentes dans le contexte.
 * 
 * S'appuie sur :
 * - Le contexte physiologique réel (TSB, ATL, CTL)
 * - La charge actuelle et proposée (TSS)
 * - Le statut des séances (séance manquée, fatigue, progression maîtrisée)
 * - La règle stricte de non-rattrapage de charge
 */
export class CoachProposalExplainer {
  /**
   * Retourne l'explication physiologique détaillée et factuelle.
   */
  static getWhyExplanation(proposal: CoachProposal, workouts: PlannedWorkout[] = []): string {
    // Si la proposition contient déjà une explication claire et détaillée fournie
    if (proposal.explanation && proposal.explanation.trim().length > 15) {
      return proposal.explanation;
    }

    const tsb = typeof proposal.sourceContext?.tsb === 'number' ? proposal.sourceContext.tsb : undefined;
    const weeklyLoad = typeof proposal.sourceContext?.weeklyPlannedLoad === 'number' ? proposal.sourceContext.weeklyPlannedLoad : undefined;
    const proposedWeeklyLoad = typeof proposal.sourceContext?.proposedWeeklyLoad === 'number' ? proposal.sourceContext.proposedWeeklyLoad : undefined;

    switch (proposal.action) {
      case 'CANCEL_WORKOUT':
        if (tsb !== undefined && tsb < -20) {
          return `Ton indice de fraîcheur (TSB: ${tsb}) indique une fatigue aiguë sévère. Le repos complet immédiat est nécessaire pour préserver ton organisme et éviter le surentraînement.`;
        }
        return `Le repos complet remplace cette séance afin de permettre une assimilation optimale de la charge accumulée sans accumuler de fatigue supplémentaire.`;

      case 'REDUCE_LOAD':
      case 'RECOVERY':
        if (tsb !== undefined && tsb < -10) {
          return `Avec un TSB de ${tsb}, ton niveau de fatigue est élevé. Réduire le volume et l'intensité en Zone 1/Zone 2 permet de maintenir la dynamique aérobie tout en amorçant la récupération active.`;
        }
        if (weeklyLoad !== undefined && proposedWeeklyLoad !== undefined) {
          return `Allègement préventif : la charge hebdomadaire passe de ${weeklyLoad} à ${proposedWeeklyLoad} TSS pour préserver l'équilibre physiologique.`;
        }
        return `Réduction ciblée de la durée et passage en intensité douce (Z1/Z2) afin de stabiliser ton état de fatigue sans compromettre tes acquis.`;

      case 'INCREASE_LOAD': {
        const pct = proposal.loadIncreasePercent ?? 5;
        if (tsb !== undefined && tsb > 0) {
          return `Ton niveau de fraîcheur est positif (TSB: +${tsb}) et ta charge est bien tolérée. Une progression mesurée de +${pct}% (plafonnée à 5% max) stimule la progression sans risque de rupture.`;
        }
        return `Augmentation progressive calibrée à +${pct}% maximum sur la semaine, respectant le plafond physiologique de sécurité de 5%.`;
      }

      case 'MOVE_WORKOUT':
        return `Déplacement de la séance pour optimiser l'alternance entre journées intenses et récupération, sans modifier la charge totale de travail.`;

      case 'ADAPT_PLAN':
      case 'MODIFY_WORKOUT':
        return `Réorganisation structurée de tes séances pour s'adapter à ton emploi du temps et ta forme actuelle, sans rattrapage artificiel de charge.`;

      case 'NO_CHANGE':
        return `Tes paramètres actuels sont cohérents avec ton cycle d'entraînement. Aucun ajustement n'est requis pour le moment.`;

      default:
        return proposal.reason || "Ajustement du plan pour équilibrer charge et récupération selon les données physiologiques.";
    }
  }

  /**
   * Retourne un résumé du différentiel de charge (TSS ou %).
   */
  static getLoadImpactSummary(proposal: CoachProposal): {
    label: string;
    diffText: string;
    isDecrease: boolean;
    isIncrease: boolean;
  } {
    const isDecrease =
      proposal.action === 'REDUCE_LOAD' ||
      proposal.action === 'CANCEL_WORKOUT' ||
      proposal.action === 'RECOVERY';

    const isIncrease = proposal.action === 'INCREASE_LOAD';

    let diffText = 'Charge optimisée';
    if (proposal.loadIncreasePercent != null && isIncrease) {
      diffText = `+${proposal.loadIncreasePercent}%`;
    } else {
      const weekly = typeof proposal.sourceContext?.weeklyPlannedLoad === 'number' ? proposal.sourceContext.weeklyPlannedLoad : undefined;
      const proposed = typeof proposal.sourceContext?.proposedWeeklyLoad === 'number' ? proposal.sourceContext.proposedWeeklyLoad : undefined;
      if (weekly !== undefined && proposed !== undefined) {
        const diff = proposed - weekly;
        diffText = diff > 0 ? `+${diff} TSS` : `${diff} TSS`;
      }
    }

    const label = isDecrease
      ? 'Allègement de charge'
      : isIncrease
      ? 'Progression contrôlée'
      : 'Stabilité de charge';

    return { label, diffText, isDecrease, isIncrease };
  }
}
