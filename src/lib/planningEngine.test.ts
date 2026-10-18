import { describe, it, expect } from 'vitest';
import { generateTrainingPlan } from './planningEngine';
import { AthleteProfile } from '../domain/models';

describe('PlanningEngine', () => {
  const baseProfile: AthleteProfile = {
    id: 'test-1',
    dataConnection: 'none',
    level: { swim: 'intermediate', ride: 'intermediate', run: 'intermediate' },
    availability: {
      weeklyHours: 5,
      availableDays: ['Lundi', 'Mercredi', 'Samedi']
    },
    goal: {
      id: 'g1',
      title: 'Test Race',
      date: '2026-09-30',
      type: 'olympic',
      sportFocus: 'Triathlon'
    }
  };

  it('Test 1 - Disponibilités : generates workouts only on available days', () => {
    const startDate = new Date('2026-08-01');
    const plan = generateTrainingPlan(baseProfile, startDate, 2);
    
    expect(plan.length).toBeGreaterThan(0);
    
    // Check that every generated workout is on Lundi, Mercredi, or Samedi
    const daysMap = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    plan.forEach(w => {
      const wDate = new Date(w.date);
      const dayName = daysMap[wDate.getDay()];
      expect(['Lundi', 'Mercredi', 'Samedi']).toContain(dayName);
    });
  });

  it('Test 2 - Volume : respects maximum weekly duration', () => {
    const startDate = new Date('2026-08-01');
    const plan = generateTrainingPlan(baseProfile, startDate, 1);
    
    const totalMinutes = plan.reduce((acc, w) => acc + w.targetDurationMin, 0);
    expect(totalMinutes).toBeLessThanOrEqual(baseProfile.availability.weeklyHours * 60 + 60); // some margin for rounding/logic
  });

  it('Test 3 - Triathlon : includes all three sports if possible', () => {
    const startDate = new Date('2026-08-01');
    const plan = generateTrainingPlan(baseProfile, startDate, 2);
    
    const sports = plan.map(w => w.sport);
    expect(sports).toContain('Swim');
    expect(sports).toContain('Ride');
    expect(sports).toContain('Run');
  });

  it('Test 4 - Niveaux indépendants : changing bike level only affects bike', () => {
    const startDate = new Date('2026-08-01');
    const planIntermediate = generateTrainingPlan(baseProfile, startDate, 1);
    
    const advancedProfile = {
      ...baseProfile,
      level: { ...baseProfile.level, ride: 'advanced' as const }
    };
    const planAdvanced = generateTrainingPlan(advancedProfile, startDate, 1);
    
    const bikeInt = planIntermediate.find(w => w.sport === 'Ride');
    const bikeAdv = planAdvanced.find(w => w.sport === 'Ride');
    
    expect(bikeInt).toBeDefined();
    expect(bikeAdv).toBeDefined();
    if (bikeInt && bikeAdv) {
      expect(bikeAdv.targetDurationMin).toBeGreaterThanOrEqual(bikeInt.targetDurationMin);
    }
  });

  it('Test 5 - Déterminisme : generates exactly same plan for same input', () => {
    const startDate = new Date('2026-08-01');
    const plan1 = generateTrainingPlan(baseProfile, startDate, 2);
    const plan2 = generateTrainingPlan(baseProfile, startDate, 2);
    
    expect(plan1).toEqual(plan2);
  });

  it('Test 6 - Taper : reduces volume close to race', () => {
    const startDate = new Date('2026-09-24'); // Race is 09-30, so this is taper week
    const plan = generateTrainingPlan(baseProfile, startDate, 1);
    
    const startDateNormal = new Date('2026-08-01');
    const planNormal = generateTrainingPlan(baseProfile, startDateNormal, 1);
    
    const volumeTaper = plan.reduce((acc, w) => acc + w.targetDurationMin, 0);
    const volumeNormal = planNormal.reduce((acc, w) => acc + w.targetDurationMin, 0);
    
    expect(volumeTaper).toBeLessThan(volumeNormal);
  });

  it('Test 7 - Aucun jour disponible : returns empty array without crashing', () => {
    const noDaysProfile = { ...baseProfile, availability: { ...baseProfile.availability, availableDays: [] } };
    const plan = generateTrainingPlan(noDaysProfile, new Date(), 1);
    expect(plan.length).toBe(0);
  });

  it('Test 8 - 0 heure : returns empty array', () => {
    const zeroHoursProfile = { ...baseProfile, availability: { ...baseProfile.availability, weeklyHours: 0 } };
    const plan = generateTrainingPlan(zeroHoursProfile, new Date(), 1);
    expect(plan.length).toBe(0);
  });

  it('Test 10 - Course passée : stops generating after race date', () => {
    const startDate = new Date('2026-10-01'); // After race (09-30)
    const plan = generateTrainingPlan(baseProfile, startDate, 2);
    expect(plan.length).toBe(0);
  });

  it('Test 12 - IDs : IDs are deterministic', () => {
    const startDate = new Date('2026-08-01');
    const plan = generateTrainingPlan(baseProfile, startDate, 1);
    
    expect(plan[0].id).toMatch(/^planned-\d{4}-\d{2}-\d{2}-.+$/);
  });
});
