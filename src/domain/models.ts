export type Sport = 'Swim' | 'Ride' | 'Run' | 'Strength' | 'Other';

export interface AthleteProfile {
  id: string;
  name?: string;
  level: {
    swim: 'beginner' | 'intermediate' | 'advanced';
    ride: 'beginner' | 'intermediate' | 'advanced';
    run: 'beginner' | 'intermediate' | 'advanced';
  };
  availability: {
    weeklyHours: number;
    availableDays: string[];
  };
  hrMax?: number;
  goal?: Goal;
  dataConnection: 'none' | 'apple_health' | 'google_health_connect' | 'demo';
}

export interface Goal {
  id?: string;
  title?: string;
  target?: string;
  distanceKm?: number;
  date: string;
  type?: 'sprint' | 'olympic' | 'half' | 'ironman' | 'custom' | string;
  sportFocus?: Sport | 'Triathlon' | string;
  location?: string;
  [key: string]: unknown;
}

export interface PlannedWorkout {
  id: string;
  planId?: string;
  sport: Sport;
  date: string; // YYYY-MM-DD
  title: string;
  description?: string;
  durationMin?: number;
  targetDurationMin?: number;
  targetIntensity?: {
    type: 'zone' | 'hr' | 'power' | 'pace' | 'rpe' | string;
    value: string;
  };
  targetTss?: number;
  explanation?: string; // Why this workout?
  status?: 'planned' | 'completed' | 'partial' | 'missed' | 'adapted' | string;
  structure?: unknown;
  [key: string]: unknown;
}

export interface ActualWorkout {
  id: string;
  title?: string;
  source?: 'apple_health' | 'google_health_connect' | 'manual' | 'demo' | 'Garmin' | string;
  sourceId?: string;
  sport: Sport;
  date: string;
  startTime?: string; // ISO
  durationMin: number;
  distanceKm?: number;
  averageHeartRate?: number;
  normalizedPower?: number;
  tss?: number;
  temperature?: number;
  plannedWorkoutId?: string;
  [key: string]: unknown;
}

export interface WorkoutExecution {
  plannedId: string;
  actualId: string;
  compliancePercentage: number;
  intensityDeviation: number; // positive = harder, negative = easier
}

export interface Recommendation {
  id: string;
  type:
    | 'TODAY_WORKOUT'
    | 'RECOVERY'
    | 'PLAN_ADAPTED'
    | 'MISSED_WORKOUT'
    | 'PROGRESS'
    | 'GOAL'
    | 'HEALTH_SYNC'
    | 'INFO'
    | 'WARNING';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  message: string;
  reason?: string;
  relatedWorkoutId?: string;
  createdAt: string;
}

export * from './coachTypes';
export * from './athleteHistoryTypes';
