import { describe, it, expect } from 'vitest';
import { normalizeWorkout, isDuplicateWorkout, matchToPlannedWorkout, normalizeSport } from './SyncService';
import { ExternalWorkout } from './adapters/types';
import { ActualWorkout, PlannedWorkout } from '../domain/models';

describe('SyncService', () => {
  describe('normalizeSport', () => {
    it('normalizes sports correctly', () => {
      expect(normalizeSport('running')).toBe('Run');
      expect(normalizeSport('pool_swimming')).toBe('Swim');
      expect(normalizeSport('biking')).toBe('Ride');
      expect(normalizeSport('cycling')).toBe('Ride');
      expect(normalizeSport('weightlifting')).toBe('Strength');
      expect(normalizeSport('unknown')).toBe('Other');
    });
  });

  describe('normalizeWorkout', () => {
    it('normalizes a valid external workout', () => {
      const ext: ExternalWorkout = {
        source: 'demo',
        sourceId: '123',
        sport: 'running',
        startTime: '2024-01-01T10:00:00Z',
        duration: 3600, // 60 min
        distance: 10000, // 10 km
        averageHeartRate: 150
      };

      const actual = normalizeWorkout(ext);

      expect(actual.source).toBe('demo');
      expect(actual.sourceId).toBe('123');
      expect(actual.sport).toBe('Run');
      expect(actual.date).toBe('2024-01-01');
      expect(actual.durationMin).toBe(60);
      expect(actual.distanceKm).toBe(10);
      expect(actual.averageHeartRate).toBe(150);
    });

    it('normalizes an Apple Health workout with power', () => {
      const ext: ExternalWorkout = {
        source: 'apple_health',
        sourceId: '98765',
        sport: 'VirtualRide',
        startTime: '2023-11-15T18:00:00Z',
        duration: 7200, // 120 min
        normalizedPower: 220
      };

      const actual = normalizeWorkout(ext);

      expect(actual.source).toBe('apple_health');
      expect(actual.sourceId).toBe('98765');
      expect(actual.sport).toBe('Ride'); 
      expect(actual.date).toBe('2023-11-15');
      expect(actual.durationMin).toBe(120);
      expect(actual.normalizedPower).toBe(220);
    });

    it('generates a deterministic ID when sourceId is missing to ensure idempotence', () => {
      const ext = {
        source: 'google_health_connect',
        sport: 'Ride',
        startTime: '2023-11-15T10:00:00Z',
        duration: 3600
      } as any;
      const actual1 = normalizeWorkout(ext);
      const actual2 = normalizeWorkout(ext);
      
      expect(actual1.id).toBe(actual2.id);
      expect(actual1.sourceId).toBe('generated-Ride-2023-11-15-60');
      expect(actual1.id).toBe('google_health_connect-generated-Ride-2023-11-15-60');
    });

    it('preserves the local date correctly when close to midnight without UTC shift issues', () => {
      // Local time string provided by native adapter (e.g., Apple Health usually provides local ISO strings or offset strings)
      // Representing 23:50 local time on Nov 15.
      const ext: ExternalWorkout = {
        source: 'google_health_connect',
        sourceId: 'mid-1',
        sport: 'Run',
        startTime: '2023-11-15T23:50:00', // Local time without Z
        duration: 3600,
      };

      const actual = normalizeWorkout(ext);
      // Ensure the 'date' string stays 2023-11-15 and is not shifted to 2023-11-16 due to UTC conversion
      expect(actual.date).toBe('2023-11-15');
    });
  });

  describe('isDuplicateWorkout', () => {
    it('detects duplicate by sourceId', () => {
      const existing: ActualWorkout[] = [{
        id: '1',
        source: 'demo',
        sourceId: '123',
        sport: 'Run',
        date: '2024-01-01',
        startTime: '2024-01-01T10:00:00Z',
        durationMin: 60
      }];

      const newWorkout: ActualWorkout = {
        id: 'new',
        source: 'demo',
        sourceId: '123',
        sport: 'Run',
        date: '2024-01-01',
        startTime: '2024-01-01T10:00:00Z',
        durationMin: 60
      };

      expect(isDuplicateWorkout(newWorkout, existing)).toBe(true);
    });

    it('detects duplicate by time and duration when sourceId is missing', () => {
      const existing: ActualWorkout[] = [{
        id: '1',
        source: 'manual',
        sport: 'Run',
        date: '2024-01-01',
        startTime: '2024-01-01T10:00:00Z',
        durationMin: 60
      }];

      const newWorkout: ActualWorkout = {
        id: 'new',
        source: 'apple_health',
        sport: 'Run',
        date: '2024-01-01',
        startTime: '2024-01-01T10:05:00Z', // 5 minutes difference
        durationMin: 62 // 2 minutes difference
      };

      expect(isDuplicateWorkout(newWorkout, existing)).toBe(true);
    });

    it('allows non-duplicates', () => {
      const existing: ActualWorkout[] = [{
        id: '1',
        source: 'demo',
        sourceId: '123',
        sport: 'Run',
        date: '2024-01-01',
        startTime: '2024-01-01T10:00:00Z',
        durationMin: 60
      }];

      const newWorkout: ActualWorkout = {
        id: 'new',
        source: 'demo',
        sourceId: '124',
        sport: 'Run',
        date: '2024-01-02',
        startTime: '2024-01-02T10:00:00Z',
        durationMin: 60
      };

      expect(isDuplicateWorkout(newWorkout, existing)).toBe(false);
    });
  });

  describe('matchToPlannedWorkout', () => {
    it('matches by plannedWorkoutId', () => {
      const actual: ActualWorkout = {
        id: 'a1',
        source: 'demo',
        sport: 'Run',
        date: '2024-01-01',
        startTime: '2024-01-01T10:00:00Z',
        durationMin: 48,
        plannedWorkoutId: 'p1'
      };

      const plannedWorkouts: PlannedWorkout[] = [{
        id: 'p1',
        sport: 'Run',
        date: '2024-01-01',
        title: 'Run',
        targetDurationMin: 45,
        targetIntensity: { type: 'zone', value: 'Z2' },
        status: 'planned'
      }];

      const match = matchToPlannedWorkout(actual, plannedWorkouts);
      expect(match).toBeDefined();
      expect(match?.id).toBe('p1');
    });

    it('matches by date and sport', () => {
      const actual: ActualWorkout = {
        id: 'a1',
        source: 'demo',
        sport: 'Run',
        date: '2024-01-01',
        startTime: '2024-01-01T10:00:00Z',
        durationMin: 48
      };

      const plannedWorkouts: PlannedWorkout[] = [{
        id: 'p1',
        sport: 'Run',
        date: '2024-01-01',
        title: 'Run',
        targetDurationMin: 45,
        targetIntensity: { type: 'zone', value: 'Z2' },
        status: 'planned'
      }];

      const match = matchToPlannedWorkout(actual, plannedWorkouts);
      expect(match).toBeDefined();
      expect(match?.id).toBe('p1');
    });
  });
});
