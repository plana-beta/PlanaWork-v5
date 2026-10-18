import { describe, it, expect, vi } from 'vitest';
import { HealthKitAdapter } from './HealthKitAdapter';

// Mock capacitor core
vi.mock('@capacitor/core', () => {
  return {
    registerPlugin: () => ({
      isAvailable: vi.fn().mockResolvedValue({ available: true }),
      requestAuthorization: vi.fn().mockResolvedValue({ success: true }),
      queryWorkouts: vi.fn().mockResolvedValue({
        workouts: [{
          uuid: 'hk-123',
          activityType: 'Run',
          startDate: '2023-11-15T23:50:00-05:00',
          endDate: '2023-11-16T00:50:00-05:00',
          duration: 3600,
          totalDistance: 10000,
          averageHeartRate: 155,
          maxHeartRate: 175,
          averagePower: 250,
          totalEnergyBurned: 700
        }]
      }),
      isAuthorized: vi.fn().mockResolvedValue({ authorized: true }),
    })
  };
});

describe('HealthKitAdapter', () => {
  it('instantiates properly', () => {
    const adapter = new HealthKitAdapter();
    expect(adapter).toBeDefined();
  });

  it('maps HK workouts to ExternalWorkout properly', async () => {
    const adapter = new HealthKitAdapter();
    // Bypass the capacitor platform check for testing
    (adapter as any).isCapacitorAvailable = () => true;
    
    const workouts = await adapter.getWorkouts(new Date('2023-01-01'), new Date('2023-12-31'));
    expect(workouts).toHaveLength(1);
    
    const w = workouts[0];
    expect(w.source).toBe('apple_health');
    expect(w.sourceId).toBe('apple_health:hk-123');
    expect(w.sport).toBe('Run');
    expect(w.startTime).toBe('2023-11-15T23:50:00-05:00');
    expect(w.distance).toBe(10000);
    expect(w.averageHeartRate).toBe(155);
    expect(w.maxHeartRate).toBe(175);
    expect(w.averagePower).toBe(250);
  });
});
