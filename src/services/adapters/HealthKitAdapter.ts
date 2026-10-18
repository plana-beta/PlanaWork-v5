import { registerPlugin } from '@capacitor/core';
import { HealthAdapter, ExternalWorkout, HealthConnectionStatus } from './types';

export interface HealthKitPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  requestAuthorization(options: { read: string[] }): Promise<{ success: boolean }>;
  queryWorkouts(options: { startDate: string; endDate: string }): Promise<{ workouts: any[] }>;
  isAuthorized(): Promise<{ authorized: boolean }>;
}

const CapacitorHealthKit = registerPlugin<HealthKitPlugin>('HealthKit');

export class HealthKitAdapter implements HealthAdapter {
  private isCapacitorAvailable(): boolean {
    return typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform();
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isCapacitorAvailable()) return false;
    try {
      const result = await CapacitorHealthKit.isAvailable();
      return result.available;
    } catch(e) {
      return false; // Plugin not registered or error
    }
  }

  async requestPermissions(): Promise<boolean> {
    if (!this.isCapacitorAvailable()) return false;
    try {
      const result = await CapacitorHealthKit.requestAuthorization({
        read: [
          'HKWorkoutTypeIdentifier', 
          'HKQuantityTypeIdentifierHeartRate', 
          'HKQuantityTypeIdentifierCyclingPower', 
          'HKQuantityTypeIdentifierDistanceCycling',
          'HKQuantityTypeIdentifierDistanceWalkingRunning',
          'HKQuantityTypeIdentifierDistanceSwimming'
        ]
      });
      return result.success;
    } catch(e) {
      return false;
    }
  }

  async getWorkouts(startDate: Date, endDate: Date): Promise<ExternalWorkout[]> {
    if (!this.isCapacitorAvailable()) return [];
    
    try {
      const { workouts } = await CapacitorHealthKit.queryWorkouts({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });
      return workouts.map(this.mapToExternalWorkout);
    } catch(e) {
      console.error('[HealthKit] Error querying workouts:', e);
      return [];
    }
  }

  private mapToExternalWorkout(raw: any): ExternalWorkout {
    return {
      source: 'apple_health',
      sourceId: `apple_health:${raw.uuid || raw.id}`,
      sport: raw.activityType || 'Other',
      startTime: raw.startDate, // Native plugin must preserve timezone or ISO 8601 with offset
      endTime: raw.endDate,
      duration: raw.duration,
      distance: raw.totalDistance,
      averageHeartRate: raw.averageHeartRate,
      maxHeartRate: raw.maxHeartRate,
      averagePower: raw.averagePower,
      calories: raw.totalEnergyBurned
    };
  }

  async getConnectionStatus(): Promise<HealthConnectionStatus> {
    if (!this.isCapacitorAvailable()) {
      return {
        available: false,
        connected: false,
        error: 'Apple HealthKit nécessite l\'application native iOS.'
      };
    }
    
    try {
      const { authorized } = await CapacitorHealthKit.isAuthorized();
      return {
        available: true,
        connected: authorized
      };
    } catch(e) {
      return { available: false, connected: false };
    }
  }

  async disconnect(): Promise<void> {
    // HealthKit permissions can only be revoked from iOS Settings
  }
}
