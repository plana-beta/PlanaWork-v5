import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../store';
import { healthService } from './healthService';
import { HealthKitAdapter } from './adapters/HealthKitAdapter';
import { generatePMC } from '../lib/trainingEngine';
import { ExternalWorkout } from './adapters/types';

describe('HealthKit Integration to PMC', () => {
  beforeEach(() => {
    // Mock localStorage
    const storeMap = new Map<string, string>();
    global.localStorage = {
      getItem: (key: string) => storeMap.get(key) || null,
      setItem: (key: string, value: string) => storeMap.set(key, value),
      removeItem: (key: string) => storeMap.delete(key),
      clear: () => storeMap.clear(),
      length: 0,
      key: (i: number) => null,
    } as Storage;

    const store = useAppStore.getState();
    useAppStore.getState().updateAthleteProfile({ dataConnection: 'apple_health' });
    useAppStore.setState({ actualWorkouts: [], plannedWorkouts: [] });
  });

  it('completes the full flow from HealthKit to PMC', async () => {
    const mockExternalWorkouts: ExternalWorkout[] = [
      {
        source: 'apple_health',
        sourceId: 'apple_health:12345',
        sport: 'Run',
        startTime: '2023-10-15T23:50:00-05:00', // Timezone edge case
        endTime: '2023-10-16T00:50:00-05:00', // Spans midnight
        duration: 3600, // 60 minutes
        distance: 10000,
        averageHeartRate: 155, // Should yield TSS > 0
        calories: 800
      }
    ];

    // Mock HealthKit
    vi.spyOn(HealthKitAdapter.prototype, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(HealthKitAdapter.prototype, 'getConnectionStatus').mockResolvedValue({ available: true, connected: true });
    vi.spyOn(HealthKitAdapter.prototype, 'getWorkouts').mockResolvedValue(mockExternalWorkouts);

    const result = await healthService.syncWorkouts('apple_health');
    
    expect(result.success).toBe(true);
    expect(result.stats?.new).toBe(1);

    const store = useAppStore.getState();
    expect(store.actualWorkouts.length).toBe(1);
    
    const actual = store.actualWorkouts[0];
    expect(actual.source).toBe('apple_health');
    expect(actual.durationMin).toBe(60);
    expect(actual.sport).toBe('Run');
    expect(actual.date).toBe('2023-10-15'); // Check date preservation from start time
    
    expect(actual.tss).toBeGreaterThan(0); // TSS should be calculated based on HR

    // Let's run PMC update
    const today = new Date('2023-10-16');
    const chartData = generatePMC(store.actualWorkouts, 200, 190, today);
    
    // Since we have an activity on 2023-10-15, ATL and CTL should increase on 10-15 and 10-16
    const pmcPoint = chartData.find(d => d.date === '2023-10-15');
    expect(pmcPoint).toBeDefined();
    expect(pmcPoint?.tss).toBe(actual.tss);
    expect(pmcPoint?.atl).toBeGreaterThan(0);
    expect(pmcPoint?.ctl).toBeGreaterThan(0);
    
    // Test second sync (duplicates)
    const result2 = await healthService.syncWorkouts('apple_health');
    expect(result2.success).toBe(true);
    expect(result2.stats?.new).toBe(0);
    expect(result2.stats?.duplicates).toBe(1);
  });
});
