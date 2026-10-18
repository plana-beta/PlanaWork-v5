import { describe, it, expect } from 'vitest';
import { generateRecommendations } from './recommendationEngine';
import { AthleteProfile, PlannedWorkout, ActualWorkout } from '../domain/models';
import { PmcData } from '../types';

describe('RecommendationEngine', () => {
  const baseProfile: AthleteProfile = {
    id: 'test-1',
    dataConnection: 'none',
    level: { swim: 'intermediate', ride: 'intermediate', run: 'intermediate' },
    availability: { weeklyHours: 5, availableDays: ['Lundi', 'Mardi'] }
  };

  const pmcNormal: PmcData[] = [{ date: '2026-08-28', tsb: 5, atl: 30, ctl: 35, tss: 0 }];
  const pmcFatigue: PmcData[] = [{ date: '2026-08-28', tsb: -25, atl: 90, ctl: 65, tss: 0 }];

  it('Test 1 - Séance du jour correctement générée', () => {
    const planned: PlannedWorkout[] = [
      { id: 'p1', sport: 'Run', date: '2026-08-28', title: 'Endurance', targetDurationMin: 45, targetIntensity: { type: 'zone', value: 'Z2' }, status: 'planned' }
    ];
    const recs = generateRecommendations(baseProfile, planned, [], pmcNormal, new Date('2026-08-28T12:00:00'));
    expect(recs.find(r => r.type === 'TODAY_WORKOUT')).toBeDefined();
  });

  it('Test 2 - Repos correctement généré', () => {
    const recs = generateRecommendations(baseProfile, [], [], pmcNormal, new Date('2026-08-28T12:00:00'));
    expect(recs.find(r => r.type === 'INFO')).toBeDefined(); // INFO = Repos
  });

  it('Test 3 - Fatigue élevée prioritaire', () => {
    const planned: PlannedWorkout[] = [
      { id: 'p1', sport: 'Run', date: '2026-08-28', title: 'Endurance', targetDurationMin: 45, targetIntensity: { type: 'zone', value: 'Z2' }, status: 'planned' }
    ];
    const recs = generateRecommendations(baseProfile, planned, [], pmcFatigue, new Date('2026-08-28T12:00:00'));
    expect(recs[0].type).toBe('RECOVERY');
  });

  it('Test 4 - Plan adapté génère une recommandation', () => {
    const planned: PlannedWorkout[] = [
      { id: 'p1', sport: 'Run', date: '2026-08-28', title: 'Endurance', targetDurationMin: 45, targetIntensity: { type: 'zone', value: 'Z2' }, status: 'adapted' }
    ];
    const recs = generateRecommendations(baseProfile, planned, [], pmcNormal, new Date('2026-08-28T12:00:00'));
    expect(recs.find(r => r.type === 'PLAN_ADAPTED')).toBeDefined();
  });

  it('Test 5 - Séance manquée produit un message', () => {
    const planned: PlannedWorkout[] = [
      { id: 'p1', sport: 'Run', date: '2026-08-27', title: 'Endurance', targetDurationMin: 45, targetIntensity: { type: 'zone', value: 'Z2' }, status: 'missed' }
    ];
    const recs = generateRecommendations(baseProfile, planned, [], pmcNormal, new Date('2026-08-28T12:00:00'));
    expect(recs.find(r => r.type === 'MISSED_WORKOUT')).toBeDefined();
  });

  it('Test 6 - Objectif dans moins de 7 jours', () => {
    const prof: AthleteProfile = { ...baseProfile, goal: { id: 'g', title: 'G', date: '2026-08-30', type: 'sprint', sportFocus: 'Triathlon' } };
    const recs = generateRecommendations(prof, [], [], pmcNormal, new Date('2026-08-28T12:00:00'));
    const r = recs.find(r => r.type === 'GOAL');
    expect(r?.message).toContain('course');
  });

  it('Test 7 - Objectif dans plus de 30 jours', () => {
    const prof: AthleteProfile = { ...baseProfile, goal: { id: 'g', title: 'G', date: '2026-10-30', type: 'sprint', sportFocus: 'Triathlon' } };
    const recs = generateRecommendations(prof, [], [], pmcNormal, new Date('2026-08-28T12:00:00'));
    const r = recs.find(r => r.type === 'GOAL');
    expect(r?.message).toContain('foncière');
  });

  it('Test 8 - Progression avec données suffisantes', () => {
    const pmcProgression: PmcData[] = Array.from({length: 15}).map((_, i) => ({ date: 'd', tsb: 0, atl: 0, ctl: 30 + i, tss: 0 }));
    const recs = generateRecommendations(baseProfile, [], [], pmcProgression, new Date('2026-08-28T12:00:00'));
    expect(recs.find(r => r.type === 'PROGRESS')).toBeDefined();
  });

  it('Test 9 - Historique insuffisant', () => {
    const pmcProgression: PmcData[] = Array.from({length: 5}).map((_, i) => ({ date: 'd', tsb: 0, atl: 0, ctl: 30 + i, tss: 0 }));
    const recs = generateRecommendations(baseProfile, [], [], pmcProgression, new Date('2026-08-28T12:00:00'));
    expect(recs.find(r => r.type === 'PROGRESS')).toBeUndefined();
  });

  it('Test 10 - Health Sync', () => {
    const prof: AthleteProfile = { ...baseProfile, dataConnection: 'apple_health' };
    const actuals: ActualWorkout[] = [{ id: 'a', sport: 'Run', source: 'apple_health', date: '2026-08-20', startTime: '', durationMin: 60 }];
    const recs = generateRecommendations(prof, [], actuals, pmcNormal, new Date('2026-08-28T12:00:00'));
    expect(recs.find(r => r.type === 'HEALTH_SYNC')).toBeDefined();
  });

  it('Test 11 - Tri des priorités', () => {
    const planned: PlannedWorkout[] = [
      { id: 'p1', sport: 'Run', date: '2026-08-28', title: 'Endurance', targetDurationMin: 45, targetIntensity: { type: 'zone', value: 'Z2' }, status: 'planned' }
    ];
    const recs = generateRecommendations(baseProfile, planned, [], pmcFatigue, new Date('2026-08-28T12:00:00'));
    // We expect RECOVERY then TODAY_WORKOUT
    expect(recs[0].type).toBe('RECOVERY');
    expect(recs[1].type).toBe('TODAY_WORKOUT');
  });

  it('Test 12 - Déterminisme complet', () => {
    const planned: PlannedWorkout[] = [
      { id: 'p1', sport: 'Run', date: '2026-08-28', title: 'Endurance', targetDurationMin: 45, targetIntensity: { type: 'zone', value: 'Z2' }, status: 'planned' }
    ];
    const recs1 = generateRecommendations(baseProfile, planned, [], pmcNormal, new Date('2026-08-28T12:00:00'));
    const recs2 = generateRecommendations(baseProfile, planned, [], pmcNormal, new Date('2026-08-28T12:00:00'));
    expect(recs1).toEqual(recs2);
  });
});
