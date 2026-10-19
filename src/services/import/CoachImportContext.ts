import { ActualWorkout } from '../../domain/models';

export interface CompactImportSummary {
  importedWorkoutsCount: number;
  sportsBreakdown: Record<string, number>;
  totalImportedHours: number;
  totalImportedTss: number;
  dateRange: {
    firstDate?: string;
    lastDate?: string;
  };
  mostFrequentSport?: string;
  recentImportedSnippets: Array<{
    date: string;
    sport: string;
    durationMin: number;
    distanceKm?: number;
    tss?: number;
  }>;
}

/**
 * CoachImportContext
 * Génère des synthèses compactes et déterministes des données d'entraînement importées
 * pour enrichir le contexte historique du Coach sans surcharger les prompts ni transmettre
 * de séries temporelles lourdes à Gemini.
 */
export class CoachImportContext {
  /**
   * Construit une synthèse compacte pour le Coach à partir des séances réelles importées.
   */
  static buildCompactSummary(workouts: ActualWorkout[]): CompactImportSummary {
    if (!workouts || workouts.length === 0) {
      return {
        importedWorkoutsCount: 0,
        sportsBreakdown: {},
        totalImportedHours: 0,
        totalImportedTss: 0,
        dateRange: {},
        recentImportedSnippets: []
      };
    }

    const sportsCount: Record<string, number> = {};
    let totalMin = 0;
    let totalTss = 0;

    const sorted = [...workouts].sort((a, b) => b.date.localeCompare(a.date));

    for (const w of workouts) {
      sportsCount[w.sport] = (sportsCount[w.sport] || 0) + 1;
      totalMin += (w.durationMin || 0);
      totalTss += (w.tss || 0);
    }

    let topSport: string | undefined;
    let maxSportCount = 0;
    for (const [sport, count] of Object.entries(sportsCount)) {
      if (count > maxSportCount) {
        maxSportCount = count;
        topSport = sport;
      }
    }

    const recentSnippets = sorted.slice(0, 5).map(w => ({
      date: w.date,
      sport: w.sport,
      durationMin: w.durationMin,
      distanceKm: w.distanceKm,
      tss: w.tss
    }));

    return {
      importedWorkoutsCount: workouts.length,
      sportsBreakdown: sportsCount,
      totalImportedHours: parseFloat((totalMin / 60).toFixed(1)),
      totalImportedTss: Math.round(totalTss),
      dateRange: {
        firstDate: sorted[sorted.length - 1]?.date,
        lastDate: sorted[0]?.date
      },
      mostFrequentSport: topSport,
      recentImportedSnippets: recentSnippets
    };
  }

  /**
   * Génère un paragraphe de texte compact utilisable dans le prompt système du Coach.
   */
  static formatForCoachPrompt(summary: CompactImportSummary): string {
    if (summary.importedWorkoutsCount === 0) {
      return "Historique d'import : Aucun fichier importé.";
    }

    const sportsText = Object.entries(summary.sportsBreakdown)
      .map(([sport, count]) => `${count} ${sport}`)
      .join(', ');

    return `Historique importé (${summary.importedWorkoutsCount} séances : ${sportsText}, total: ${summary.totalImportedHours}h, ${summary.totalImportedTss} TSS, du ${summary.dateRange.firstDate || '?'} au ${summary.dateRange.lastDate || '?'}).`;
  }
}
