export type TabID = 'today' | 'plan' | 'progression' | 'goal' | 'profile' | 'coach';

export interface TrainingBlock {
  id: string;
  type?: 'work' | 'rest';
  duration?: string;
  distance?: string;
  targetPowerMin?: string;
  targetPowerMax?: string;
  targetHrMin?: string;
  targetHrMax?: string;
  targetCadenceMin?: string;
  targetCadenceMax?: string;
}


export interface BikeComponent {
  id: string;
  name: string;
  type: 'bike' | 'chain' | 'tires' | 'pads' | 'cassette' | 'shoes' | 'other';
  customType?: string;
  installedAtKm: number;
  maxLifespanKm: number;
  currentKm?: number; // backwards compatibility
  maxKm?: number; // backwards compatibility
  health?: number;
}

export interface MetricData {
  date: string;
  hrv: number;
  rhr: number;
  sleepHours: number;
}

export interface PmcData {
  date: string;
  ctl: number; // Fitness
  atl: number; // Fatigue
  tsb: number; // Form
  tss?: number;
}

export interface EventGoal {
  id: string;
  name: string;
  date: string;
  isTriathlon: boolean;
  distance?: string;
  targetTime?: string;
  swimDistance?: string;
  swimTime?: string;
  bikeDistance?: string;
  bikeTime?: string;
  runDistance?: string;
  runTime?: string;
}

