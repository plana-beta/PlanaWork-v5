import { registerPlugin } from '@capacitor/core';
import { HealthAdapter, ExternalWorkout, HealthConnectionStatus } from './types';

export interface HealthConnectPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  requestAuthorization(options: { read: string[] }): Promise<{ success: boolean }>;
  readRecords(options: { recordType: string; timeRangeFilter: { startTime: string; endDate: string } }): Promise<{ records: any[] }>;
  checkPermissions(): Promise<{ authorized: boolean }>;
}

const CapacitorHealthConnect = registerPlugin<HealthConnectPlugin>('HealthConnect');

export class HealthConnectAdapter implements HealthAdapter {
  private isCapacitorAvailable(): boolean {
    return typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform();
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isCapacitorAvailable()) return false;
    try {
      const result = await CapacitorHealthConnect.isAvailable();
      return result.available;
    } catch(e) {
      return false; // Plugin not registered or error
    }
  }

  async requestPermissions(): Promise<boolean> {
    if (!this.isCapacitorAvailable()) return false;
    try {
      const result = await CapacitorHealthConnect.requestAuthorization({
        read: ['ExerciseSessionRecord', 'HeartRateRecord', 'PowerRecord', 'DistanceRecord', 'SpeedRecord', 'TotalCaloriesBurnedRecord']
      });
      return result.success;
    } catch(e) {
      return false;
    }
  }

  async getWorkouts(startDate: Date, endDate: Date): Promise<ExternalWorkout[]> {
    if (!this.isCapacitorAvailable()) return [];
    
    try {
      const { records } = await CapacitorHealthConnect.readRecords({
        recordType: 'ExerciseSessionRecord',
        timeRangeFilter: {
          startTime: startDate.toISOString(),
          endDate: endDate.toISOString()
        }
      });
      return records.map(this.mapToExternalWorkout);
    } catch(e) {
      console.error('[HealthConnect] Error reading records:', e);
      return [];
    }
  }

  private mapToExternalWorkout(raw: any): ExternalWorkout {
    return {
      source: 'google_health_connect',
      sourceId: `google_health_connect:${raw.metadata?.id || raw.id}`,
      sport: raw.exerciseType || 'Other',
      startTime: raw.startTime, // Should be local time or ISO 8601 with offset
      endTime: raw.endTime,
      duration: raw.duration ? raw.duration / 1000 : 0, // Assume native sends ms
      distance: raw.distance,
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
        error: 'Google Health Connect nécessite l\'application native Android.'
      };
    }
    
    try {
      const { authorized } = await CapacitorHealthConnect.checkPermissions();
      return {
        available: true,
        connected: authorized
      };
    } catch(e) {
      return { available: false, connected: false };
    }
  }

  async disconnect(): Promise<void> {
    // Health Connect permissions can only be revoked from Android Settings
  }
}
