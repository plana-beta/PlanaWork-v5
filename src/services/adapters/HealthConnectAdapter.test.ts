import { describe, it, expect, vi } from 'vitest';
import { HealthConnectAdapter } from './HealthConnectAdapter';

// Mock capacitor core
vi.mock('@capacitor/core', () => {
  return {
    registerPlugin: () => ({
      isAvailable: vi.fn().mockResolvedValue({ available: true }),
      requestAuthorization: vi.fn().mockResolvedValue({ success: true }),
      readRecords: vi.fn().mockResolvedValue({
        records: [{
          metadata: { id: 'hc-999' },
          exerciseType: 'Ride',
          startTime: '2023-11-15T23:50:00-05:00',
          endTime: '2023-11-16T00:50:00-05:00',
          duration: 3600000, // ms
          distance: 30000,
          averageHeartRate: 140,
          maxHeartRate: 160,
          averagePower: 220,
          totalEnergyBurned: 800
        }]
      }),
      checkPermissions: vi.fn().mockResolvedValue({ authorized: true }),
    })
  };
});

describe('HealthConnectAdapter', () => {
  it('instantiates properly', () => {
    const adapter = new HealthConnectAdapter();
    expect(adapter).toBeDefined();
  });

  it('maps HC records to ExternalWorkout properly', async () => {
    const adapter = new HealthConnectAdapter();
    // Bypass the capacitor platform check for testing
    (adapter as any).isCapacitorAvailable = () => true;
    
    const workouts = await adapter.getWorkouts(new Date('2023-01-01'), new Date('2023-12-31'));
    expect(workouts).toHaveLength(1);
    
    const w = workouts[0];
    expect(w.source).toBe('google_health_connect');
    expect(w.sourceId).toBe('google_health_connect:hc-999');
    expect(w.sport).toBe('Ride');
    expect(w.startTime).toBe('2023-11-15T23:50:00-05:00');
    expect(w.duration).toBe(3600); // Converted from ms
    expect(w.distance).toBe(30000);
    expect(w.averageHeartRate).toBe(140);
    expect(w.maxHeartRate).toBe(160);
    expect(w.averagePower).toBe(220);
  });
});
