import { ExternalWorkout } from './adapters/types';
import { ActualWorkout, Sport, PlannedWorkout } from '../domain/models';
import { parseISO, format } from 'date-fns';
import { calculateTSS, calculateHrTSS, calculateDurationTSS } from '../lib/trainingEngine';
import { useAppStore } from '../store';

export function normalizeSport(externalSport: string): Sport {
  const s = externalSport.toLowerCase();
  if (s.includes('swim')) return 'Swim';
  if (s.includes('bike') || s.includes('bik') || s.includes('cycl') || s.includes('ride')) return 'Ride';
  if (s.includes('run') || s.includes('jog')) return 'Run';
  if (s.includes('strength') || s.includes('weight')) return 'Strength';
  return 'Other';
}

export function normalizeWorkout(ext: ExternalWorkout): ActualWorkout {
  // duration is in seconds. We need minutes for ActualWorkout
  const durationMin = Math.round(ext.duration / 60);
  
  // distance is in meters. We need km for ActualWorkout
  const distanceKm = ext.distance ? ext.distance / 1000 : undefined;
  
  // ext.startTime is usually an ISO string like "2023-01-01T10:00:00Z" or local "2023-01-01T10:00:00"
  let dateStr = ext.startTime.substring(0, 10);
  if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
     // fallback if it's not a standard ISO format
     dateStr = format(parseISO(ext.startTime), 'yyyy-MM-dd');
  }

  let tss = undefined;
  try {
    const store = useAppStore.getState();
    const hrMax = store.athleteProfile?.hrMax || 190;
    const ftp = 200; // Mock FTP for now, since it's not strictly in profile, or maybe it is per sport

    const np = ext.averagePower || ext.normalizedPower;
    if (np) {
      tss = calculateTSS(ext.duration, np, ftp);
    } else if (ext.averageHeartRate) {
      tss = calculateHrTSS(ext.duration, ext.averageHeartRate, hrMax);
    } else {
      tss = calculateDurationTSS(durationMin);
    }
  } catch (e) {
    // If store is not accessible (e.g. in some pure unit tests), default calculate
    tss = calculateDurationTSS(durationMin);
  }

  // Generate deterministic ID if sourceId is missing to ensure idempotence
  const deterministicId = ext.sourceId || `generated-${ext.sport}-${dateStr}-${durationMin}`;

  return {
    id: `${ext.source}-${deterministicId}`,
    source: ext.source as ActualWorkout['source'],
    sourceId: deterministicId,
    sport: normalizeSport(ext.sport),
    date: dateStr,
    startTime: ext.startTime,
    durationMin,
    distanceKm,
    averageHeartRate: ext.averageHeartRate,
    normalizedPower: ext.averagePower || ext.normalizedPower, // Use average if NP missing
    tss
  };
}

export function isDuplicateWorkout(newWorkout: ActualWorkout, existingWorkouts: ActualWorkout[]): boolean {
  return existingWorkouts.some(existing => {
    // 1. Same source & sourceId -> Duplicate
    if (newWorkout.sourceId && existing.sourceId) {
      if (newWorkout.source === existing.source && newWorkout.sourceId === existing.sourceId) {
        return true;
      }
    }

    // 2. Same sport, very close start time (within 10 minutes), similar duration (within 5 minutes)
    if (newWorkout.sport === existing.sport && newWorkout.date === existing.date) {
      const newTime = parseISO(newWorkout.startTime).getTime();
      const existingTime = parseISO(existing.startTime).getTime();
      
      if (!isNaN(newTime) && !isNaN(existingTime)) {
        const timeDiff = Math.abs(newTime - existingTime) / 60000;
        const durDiff = Math.abs((newWorkout.durationMin || 0) - (existing.durationMin || 0));
        
        if (timeDiff < 10 && durDiff < 5) {
          return true;
        }
      }
    }

    return false;
  });
}

export function matchToPlannedWorkout(
  actual: ActualWorkout, 
  plannedWorkouts: PlannedWorkout[]
): PlannedWorkout | undefined {
  // If it already has an ID, maybe the source provided it (unlikely but possible)
  if (actual.plannedWorkoutId) {
    const found = plannedWorkouts.find(p => p.id === actual.plannedWorkoutId);
    if (found) return found;
  }

  // Filter planned workouts for the same day and sport
  const candidates = plannedWorkouts.filter(p => 
    p.date === actual.date && 
    p.sport === actual.sport &&
    (p.status === 'planned' || p.status === 'missed')
  );

  if (candidates.length === 1) {
    return candidates[0]; // Exactly one match for that day
  }

  if (candidates.length > 1) {
    // Try to match by duration (closest)
    return candidates.reduce((prev, curr) => {
      const prevDiff = Math.abs((prev.targetDurationMin || 0) - (actual.durationMin || 0));
      const currDiff = Math.abs((curr.targetDurationMin || 0) - (actual.durationMin || 0));
      return currDiff < prevDiff ? curr : prev;
    });
  }

  return undefined;
}
