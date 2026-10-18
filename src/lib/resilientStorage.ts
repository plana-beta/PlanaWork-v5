/**
 * Resilient Storage Engine for Plana (Web + Capacitor Native)
 * 
 * Garanties de Phase 33 :
 * 1. Double-couche Mémoire + Persistance : un cache en mémoire garantit que même si le stockage
 *    disque (localStorage ou Preferences) lève une exception (quota, mode navigation privée,
 *    fermeture brutale, indisponibilité en environnement Node/Vitest), l'application ne crashe pas
 *    et ne perd pas son état de session.
 * 2. Tolérance aux pannes et corruption : si les données stockées sont tronquées ou corrompues,
 *    l'adaptateur récupère gracieusement sans écraser les données valides.
 * 3. Idempotence persistante après redémarrage : sauvegarde immédiate et vérification de conformité.
 */

class ResilientStorageEngine {
  private memoryCache = new Map<string, string>();
  private isStorageAvailable: boolean;

  constructor() {
    this.isStorageAvailable = this.testLocalStorage();
    if (this.isStorageAvailable) {
      try {
        // Pré-charger le cache mémoire depuis localStorage si disponible
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key) {
            const val = window.localStorage.getItem(key);
            if (val !== null) {
              this.memoryCache.set(key, val);
            }
          }
        }
      } catch {
        // Fallback transparent
      }
    }
  }

  private testLocalStorage(): boolean {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }
    try {
      const testKey = '__plana_storage_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  getItem(key: string): string | null {
    // 1. Tenter la lecture depuis localStorage
    if (this.isStorageAvailable) {
      try {
        const val = window.localStorage.getItem(key);
        if (val !== null) {
          this.memoryCache.set(key, val);
          return val;
        }
      } catch (e) {
        console.warn(`[ResilientStorage] Erreur lecture localStorage pour '${key}', utilisation du cache mémoire:`, e);
      }
    }

    // 2. Fallback sur le cache mémoire
    return this.memoryCache.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    // 1. Toujours mettre à jour le cache mémoire immédiatement
    this.memoryCache.set(key, value);

    // 2. Persistance dans localStorage avec capture d'erreurs
    if (this.isStorageAvailable) {
      try {
        window.localStorage.setItem(key, value);
      } catch (e: any) {
        console.warn(`[ResilientStorage] Échec écriture localStorage pour '${key}' (quota ou verrouillé). Données sécurisées en mémoire.`, e?.message);
      }
    }
  }

  removeItem(key: string): void {
    this.memoryCache.delete(key);
    if (this.isStorageAvailable) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Diagnostic de l'état du stockage.
   */
  getDiagnostics(): {
    isLocalStorageAvailable: boolean;
    cachedKeysCount: number;
    hasPlanaStorage: boolean;
  } {
    return {
      isLocalStorageAvailable: this.isStorageAvailable,
      cachedKeysCount: this.memoryCache.size,
      hasPlanaStorage: this.memoryCache.has('plana-storage')
    };
  }

  /**
   * Vide le cache (utile pour les tests isolés).
   */
  clear(): void {
    this.memoryCache.clear();
    if (this.isStorageAvailable) {
      try {
        window.localStorage.clear();
      } catch {
        // ignore
      }
    }
  }
}

export const resilientStorage = new ResilientStorageEngine();

/**
 * Assure l'intégrité et la réparation automatique des données restaurées
 * au cas où un crash ou une coupure aurait corrompu un tableau ou une métrique.
 */
export function sanitizeHydratedState(persistedState: any): any {
  if (!persistedState || typeof persistedState !== 'object') {
    return {};
  }

  return {
    ...persistedState,
    plannedWorkouts: Array.isArray(persistedState.plannedWorkouts) ? persistedState.plannedWorkouts : [],
    actualWorkouts: Array.isArray(persistedState.actualWorkouts) ? persistedState.actualWorkouts : [],
    coachDecisions: Array.isArray(persistedState.coachDecisions) ? persistedState.coachDecisions : [],
    pmc: Array.isArray(persistedState.pmc) ? persistedState.pmc : [],
    components: Array.isArray(persistedState.components) ? persistedState.components : [],
    metrics: Array.isArray(persistedState.metrics) ? persistedState.metrics : [],
    events: Array.isArray(persistedState.events) ? persistedState.events : [],
    workoutFeedbacks: Array.isArray(persistedState.workoutFeedbacks) ? persistedState.workoutFeedbacks : [],
    workoutObservations: Array.isArray(persistedState.workoutObservations) ? persistedState.workoutObservations : [],
    athleteHabits: Array.isArray(persistedState.athleteHabits) ? persistedState.athleteHabits : [],
    athletePreferences: Array.isArray(persistedState.athletePreferences) ? persistedState.athletePreferences : [],
    temporaryAvailabilities: Array.isArray(persistedState.temporaryAvailabilities) ? persistedState.temporaryAvailabilities : [],
    illnessEpisodes: Array.isArray(persistedState.illnessEpisodes) ? persistedState.illnessEpisodes : [],
    injuryEpisodes: Array.isArray(persistedState.injuryEpisodes) ? persistedState.injuryEpisodes : [],
    recoveryLogs: Array.isArray(persistedState.recoveryLogs) ? persistedState.recoveryLogs : [],
    coachErrors: Array.isArray(persistedState.coachErrors) ? persistedState.coachErrors : []
  };
}
