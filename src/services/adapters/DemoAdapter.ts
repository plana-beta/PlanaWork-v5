import { HealthAdapter, ExternalWorkout, HealthConnectionStatus } from './types';

export class DemoAdapter implements HealthAdapter {
  private connected = false;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async requestPermissions(): Promise<boolean> {
    this.connected = true;
    return true;
  }

  async getWorkouts(startDate: Date, endDate: Date): Promise<ExternalWorkout[]> {
    if (!this.connected) return [];

    const today = new Date();
    // Normalize to noon to avoid timezone weirdness
    today.setHours(12, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(today.getDate() - 2);

    return [
      {
        source: 'demo',
        sourceId: 'demo-swim-' + twoDaysAgo.toISOString().split('T')[0],
        sport: 'swimming', // We will test normalizer with 'swimming'
        startTime: new Date(twoDaysAgo.getTime() - 45 * 60 * 1000).toISOString(),
        duration: 45 * 60, // 45 minutes in seconds
        distance: 2000, // 2000 meters
        averageHeartRate: 135
      },
      {
        source: 'demo',
        sourceId: 'demo-bike-' + yesterday.toISOString().split('T')[0],
        sport: 'bike', // We will test normalizer with 'bike'
        startTime: new Date(yesterday.getTime() - 92 * 60 * 1000).toISOString(),
        duration: 92 * 60, // 1h32 in seconds
        distance: 45000, // 45 km in meters
        averageHeartRate: 145,
        averagePower: 185
      },
      {
        source: 'demo',
        sourceId: 'demo-run-' + today.toISOString().split('T')[0],
        sport: 'running', // We will test normalizer with 'running'
        startTime: new Date(today.getTime() - 48 * 60 * 1000).toISOString(),
        duration: 48 * 60, // 48 minutes in seconds
        distance: 10000, // 10 km in meters
        averageHeartRate: 162
      }
    ];
  }

  async getConnectionStatus(): Promise<HealthConnectionStatus> {
    return {
      available: true,
      connected: this.connected
    };
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}
