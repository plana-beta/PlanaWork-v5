import { describe, it, expect } from 'vitest';
import { adaptPlan } from './adaptationEngine';
import { AthleteProfile, PlannedWorkout, ActualWorkout } from '../domain/models';
import { PmcData } from '../types';

describe('AdaptationEngine', () => {
  const baseProfile: AthleteProfile = {
    id: 'test-1',
    dataConnection: 'none',
    level: { swim: 'intermediate', ride: 'intermediate', run: 'intermediate' },
    availability: { weeklyHours: 5, availableDays: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] }
  };

  const pmcNormal: PmcData[] = [{ date: '2026-08-28', tsb: 5, atl: 30, ctl: 35, tss: 0 }];
  const pmcFatigue: PmcData[] = [{ date: '2026-08-28', tsb: -25, atl: 90, ctl: 65, tss: 0 }];
  const pmcExtremeFatigue: PmcData[] = [{ date: '2026-08-28', tsb: -35, atl: 100, ctl: 65, tss: 0 }];

  const basePlanned: PlannedWorkout[] = [
    { id: 'p1', sport: 'Run', date: '2026-08-27', title: 'Endurance', targetDurationMin: 45, targetIntensity: { type: 'zone', value: 'Z2' }, status: 'planned' },
    { id: 'p2', sport: 'Ride', date: '2026-08-29', title: 'Intervalles', targetDurationMin: 60, targetIntensity: { type: 'zone', value: 'Z4' }, status: 'planned' }
  ];

  it('Test 1 - Aucune modification si normal', () => {
    const actuals: ActualWorkout[] = [
      { id: 'a1', plannedWorkoutId: 'p1', sport: 'Run', date: '2026-08-27', startTime: '2026-08-27T10:00:00', durationMin: 45, source: 'manual' }
    ];
    const currentDate = new Date('2026-08-28T12:00:00');
    
    const result = adaptPlan(baseProfile, basePlanned, actuals, pmcNormal, currentDate);
    
    // p1 goes to completed, p2 stays unchanged. The engine might say changed=true because p1 changed from 'planned' to 'completed'.
    expect(result.updatedPlannedWorkouts.find(p => p.id === 'p1')?.status).toBe('completed');
    expect(result.updatedPlannedWorkouts.find(p => p.id === 'p2')?.status).toBe('planned');
    // We shouldn't have 'reduced' or 'missed' changes
    expect(result.changes.filter(c => c.type !== 'status_updated').length).toBe(0);
  });

  it('Test 2 - Séance manquée', () => {
    const actuals: ActualWorkout[] = []; // missed p1
    const currentDate = new Date('2026-08-28T12:00:00');
    
    const result = adaptPlan(baseProfile, basePlanned, actuals, pmcNormal, currentDate);
    
    expect(result.changed).toBe(true);
    expect(result.updatedPlannedWorkouts.find(p => p.id === 'p1')?.status).toBe('missed');
    expect(result.changes[0].type).toBe('missed');
  });

  it('Test 4 - Fatigue élevée (Z4 -> Z2)', () => {
    const actuals: ActualWorkout[] = [
      { id: 'a1', plannedWorkoutId: 'p1', sport: 'Run', date: '2026-08-27', startTime: '2026-08-27T10:00:00', durationMin: 45, source: 'manual' }
    ];
    const currentDate = new Date('2026-08-28T12:00:00');
    
    const result = adaptPlan(baseProfile, basePlanned, actuals, pmcFatigue, currentDate);
    
    const p2 = result.updatedPlannedWorkouts.find(p => p.id === 'p2');
    expect(p2?.targetIntensity.value).toBe('Z2'); // downgraded
    expect(p2?.status).toBe('adapted');
    expect(result.changes.some(c => c.type === 'reduced')).toBe(true);
  });

  it('Test 5 - Fatigue extrême (Reduction de volume)', () => {
    const actuals: ActualWorkout[] = [
      { id: 'a1', plannedWorkoutId: 'p1', sport: 'Run', date: '2026-08-27', startTime: '2026-08-27T10:00:00', durationMin: 45, source: 'manual' }
    ];
    const planned: PlannedWorkout[] = [
       { id: 'p1', sport: 'Run', date: '2026-08-27', title: 'Endurance', targetDurationMin: 45, targetIntensity: { type: 'zone', value: 'Z2' }, status: 'planned' },
       { id: 'p2', sport: 'Ride', date: '2026-08-29', title: 'Endurance', targetDurationMin: 120, targetIntensity: { type: 'zone', value: 'Z2' }, status: 'planned' }
    ];
    const currentDate = new Date('2026-08-28T12:00:00');
    
    const result1 = adaptPlan(baseProfile, planned, actuals, pmcExtremeFatigue, currentDate);
    
    const p2_1 = result1.updatedPlannedWorkouts.find(p => p.id === 'p2');
    expect(p2_1?.targetDurationMin).toBeLessThan(120); // volume reduced
    expect(p2_1?.status).toBe('adapted');
    
    // Idempotency: run it again with the adapted plan, should not reduce further
    const result2 = adaptPlan(baseProfile, result1.updatedPlannedWorkouts, actuals, pmcExtremeFatigue, currentDate);
    const p2_2 = result2.updatedPlannedWorkouts.find(p => p.id === 'p2');
    expect(p2_2?.targetDurationMin).toBe(p2_1?.targetDurationMin); // should be equal
  });

  it('Test 6 - Séance réalisée beaucoup plus longtemps que prévu', () => {
    const actuals: ActualWorkout[] = [
      { id: 'a1', plannedWorkoutId: 'p1', sport: 'Run', date: '2026-08-27', startTime: '2026-08-27T10:00:00', durationMin: 90, source: 'manual' } // planned 45, did 90
    ];
    const currentDate = new Date('2026-08-28T12:00:00');
    
    const result = adaptPlan(baseProfile, basePlanned, actuals, pmcNormal, currentDate);
    
    const p2 = result.updatedPlannedWorkouts.find(p => p.id === 'p2');
    // Since p1 was way too hard, p2 should be reduced
    expect(p2?.targetDurationMin).toBeLessThan(60);
    expect(p2?.status).toBe('adapted');
  });

  it('Test 7 - Séance réalisée beaucoup moins longtemps que prévu', () => {
    const actuals: ActualWorkout[] = [
      { id: 'a1', plannedWorkoutId: 'p1', sport: 'Run', date: '2026-08-27', startTime: '2026-08-27T10:00:00', durationMin: 15, source: 'manual' } // planned 45, did 15
    ];
    const currentDate = new Date('2026-08-28T12:00:00');
    
    const result = adaptPlan(baseProfile, basePlanned, actuals, pmcNormal, currentDate);
    
    const p2 = result.updatedPlannedWorkouts.find(p => p.id === 'p2');
    // Shouldn't trigger an extreme catch-up or volume reduction
    expect(p2?.targetDurationMin).toBe(60);
    expect(p2?.status).toBe('planned');
  });

  it('Test 14 - Déterminisme', () => {
    const actuals: ActualWorkout[] = []; 
    const currentDate = new Date('2026-08-28T12:00:00');
    
    const result1 = adaptPlan(baseProfile, basePlanned, actuals, pmcNormal, currentDate);
    const result2 = adaptPlan(baseProfile, basePlanned, actuals, pmcNormal, currentDate);
    
    expect(result1.updatedPlannedWorkouts).toEqual(result2.updatedPlannedWorkouts);
  });
});
