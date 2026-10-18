import { HealthAdapter, HealthConnectionStatus } from './adapters/types';
import { HealthKitAdapter } from './adapters/HealthKitAdapter';
import { HealthConnectAdapter } from './adapters/HealthConnectAdapter';
import { DemoAdapter } from './adapters/DemoAdapter';
import { useAppStore } from '../store';
import { normalizeWorkout, isDuplicateWorkout, matchToPlannedWorkout } from './SyncService';

class HealthService {
  private adapters: Record<string, HealthAdapter>;
  private demoAdapter: DemoAdapter;

  constructor() {
    this.demoAdapter = new DemoAdapter();
    this.adapters = {
      apple_health: new HealthKitAdapter(),
      google_health_connect: new HealthConnectAdapter(),
      demo: this.demoAdapter
    };
  }

  private getAdapter(source: string): HealthAdapter | null {
    if (source === 'none') return null;
    return this.adapters[source] || null;
  }

  async connect(provider: string): Promise<boolean> {
    const adapter = this.getAdapter(provider);
    if (!adapter) return false;

    const available = await adapter.isAvailable();
    if (!available) {
      console.warn(`[HealthService] ${provider} is not available on this platform.`);
      return false;
    }

    return await adapter.requestPermissions();
  }

  async disconnect(provider: string): Promise<void> {
    const adapter = this.getAdapter(provider);
    if (adapter) {
      await adapter.disconnect();
    }
  }

  async getConnectionStatus(provider: string): Promise<HealthConnectionStatus> {
    const adapter = this.getAdapter(provider);
    if (!adapter) return { available: false, connected: false };
    return await adapter.getConnectionStatus();
  }

  async syncWorkouts(provider: string): Promise<{ success: boolean; message: string; stats?: { analyzed: number; new: number; duplicates: number; matched: number } }> {
    const adapter = this.getAdapter(provider);
    if (!adapter) return { success: false, message: "Aucun fournisseur configuré." };

    const status = await adapter.getConnectionStatus();
    if (!status.available) {
      return { success: false, message: status.error || "Non disponible sur cet appareil." };
    }
    
    if (!status.connected) {
      const granted = await adapter.requestPermissions();
      if (!granted) return { success: false, message: "Permissions refusées." };
    }

    const store = useAppStore.getState();
    const lastSyncStr = localStorage.getItem(`plana_last_sync_${provider}`);
    const endDate = new Date();
    const startDate = new Date();
    
    if (lastSyncStr) {
      // Incremental sync: last sync minus 24 hours (margin for modified workouts)
      startDate.setTime(new Date(lastSyncStr).getTime() - 24 * 60 * 60 * 1000);
    } else {
      // First sync: last 30 days
      startDate.setDate(startDate.getDate() - 30);
    }

    try {
      const extWorkouts = await adapter.getWorkouts(startDate, endDate);
      const existingWorkouts = [...store.actualWorkouts];
      const plannedWorkouts = store.plannedWorkouts;
      
      let analyzedCount = extWorkouts.length;
      let importedCount = 0;
      let duplicateCount = 0;
      let matchedCount = 0;

      for (const ext of extWorkouts) {
        const actual = normalizeWorkout(ext);
        
        if (!isDuplicateWorkout(actual, existingWorkouts)) {
          const matchedPlanned = matchToPlannedWorkout(actual, plannedWorkouts);
          
          if (matchedPlanned) {
            actual.plannedWorkoutId = matchedPlanned.id;
            matchedCount++;
            store.updatePlannedWorkout({
              ...matchedPlanned,
              status: 'completed'
            });
          }
          
          store.addActualWorkout(actual);
          importedCount++;
          existingWorkouts.push(actual);
        } else {
          duplicateCount++;
        }
      }

      store.setSyncStatus('success');
      localStorage.setItem(`plana_last_sync_${provider}`, new Date().toISOString());
      
      return { 
        success: true, 
        message: `Synchronisation terminée. ${analyzedCount} analysées, ${importedCount} nouvelles, ${duplicateCount} doublons ignorés, ${matchedCount} associées au planning.`, 
        stats: { analyzed: analyzedCount, new: importedCount, duplicates: duplicateCount, matched: matchedCount } 
      };
    } catch (err) {
      console.error('[HealthService] Sync error:', err);
      store.setSyncStatus('error');
      return { success: false, message: "Erreur inattendue lors de la lecture des données de santé." };
    }
  }
}

export const healthService = new HealthService();
