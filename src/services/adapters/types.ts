export interface ExternalWorkout {
  source: 'apple_health' | 'google_health_connect' | 'demo' | 'Garmin';
  sourceId: string;
  sport: string; // Will be normalized (e.g. 'running', 'swimming', 'cycling')
  startTime: string; // ISO 8601 Date String
  endTime?: string; // ISO 8601 Date String
  duration: number; // In seconds (normalized)
  distance?: number; // In meters (normalized)
  
  // Optional metrics
  averageHeartRate?: number; // bpm
  maxHeartRate?: number; // bpm
  averageSpeed?: number; // m/s
  averagePace?: number; // s/m or similar, although speed is better. Let's keep it simple.
  averagePower?: number; // watts
  normalizedPower?: number; // watts
  averageCadence?: number; // spm or rpm
  
  calories?: number;
  elevationGain?: number; // meters
}

export interface HealthConnectionStatus {
  available: boolean;
  connected: boolean;
  error?: string;
}

export interface HealthAdapter {
  isAvailable(): Promise<boolean>;
  requestPermissions(): Promise<boolean>;
  getWorkouts(startDate: Date, endDate: Date): Promise<ExternalWorkout[]>;
  getConnectionStatus(): Promise<HealthConnectionStatus>;
  disconnect(): Promise<void>;
}
