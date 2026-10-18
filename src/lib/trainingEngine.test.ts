import { describe, it, expect } from 'vitest';
import { calculateNP, calculateIF, calculateTSS, generatePMC } from './trainingEngine';
import { ActualWorkout } from '../domain/models';

describe('Training Engine Calculations', () => {

  it('calculates NP correctly for a constant power', () => {
    // 60 seconds at exactly 200W
    const powerData = Array(60).fill(200);
    const np = calculateNP(powerData);
    expect(Math.round(np)).toBe(200);
  });

  it('calculates IF correctly', () => {
    const np = 200;
    const ftp = 250;
    expect(calculateIF(np, ftp)).toBe(0.8);
  });

  it('calculates TSS correctly (example from prompt)', () => {
    // FTP = 250 W, NP = 200 W, Durée = 60 minutes, IF = 0.80 -> TSS = 64
    const tss = calculateTSS(60 * 60, 200, 250);
    expect(Math.round(tss)).toBe(64);
  });

  it('generates PMC correctly for multiple days', () => {
    const activities: ActualWorkout[] = [
      { id: '1', source: 'demo', startTime: '2024-01-01T10:00', durationMin: 60, sport: 'Ride', date: '2024-01-01', tss: 50 },
      { id: '2', source: 'demo', startTime: '2024-01-01T15:00', durationMin: 60, sport: 'Ride', date: '2024-01-01', tss: 30 }, // Same day, total TSS = 80
      { id: '3', source: 'demo', startTime: '2024-01-02T10:00', durationMin: 0, sport: 'Ride', date: '2024-01-02', tss: 0 },  // Rest day
      { id: '4', source: 'demo', startTime: '2024-01-03T10:00', durationMin: 90, sport: 'Ride', date: '2024-01-03', tss: 100 }
    ];

    const pmc = generatePMC(activities, 250, 190, new Date('2024-01-03'));
    
    // Day 1: 2024-01-01 -> TSS = 80
    // ATL = 0 + (80 - 0) / 7 = 11.42
    // CTL = 0 + (80 - 0) / 42 = 1.90
    // TSB = CTL - ATL = 1.90 - 11.42 = -9.52
    expect(pmc[0].date).toBe('2024-01-01');
    expect(pmc[0].tss).toBe(80);
    expect(pmc[0].atl).toBeCloseTo(11.428, 2);
    expect(pmc[0].ctl).toBeCloseTo(1.904, 2);
    expect(pmc[0].tsb).toBeCloseTo(-9.523, 2);

    // Day 2: 2024-01-02 -> TSS = 0
    // ATL = 11.428 + (0 - 11.428) / 7 = 9.79
    // CTL = 1.904 + (0 - 1.904) / 42 = 1.85
    expect(pmc[1].date).toBe('2024-01-02');
    expect(pmc[1].tss).toBe(0);
    expect(pmc[1].atl).toBeCloseTo(9.795, 2);
    expect(pmc[1].ctl).toBeCloseTo(1.859, 2);

    // Day 3: 2024-01-03 -> TSS = 100
    expect(pmc[2].date).toBe('2024-01-03');
    expect(pmc[2].tss).toBe(100);
  });

  it('uses training load hierarchy correctly (TSS > NP > HR > Duration)', () => {
    const activities: ActualWorkout[] = [
      // 1. Explicit TSS provided: should use 55.
      { id: '1', source: 'demo', startTime: '2024-01-01T10:00', durationMin: 60, sport: 'Ride', date: '2024-01-01', tss: 55, normalizedPower: 200, averageHeartRate: 150 },
      // 2. No TSS, but NP provided (200W, FTP=250 -> TSS=64 for 60min).
      { id: '2', source: 'demo', startTime: '2024-01-02T10:00', durationMin: 60, sport: 'Ride', date: '2024-01-02', normalizedPower: 200, averageHeartRate: 150 },
      // 3. No TSS, no NP, but HR provided (150 bpm, hrMax=190 -> IF=0.789, TSS=~62.3).
      { id: '3', source: 'demo', startTime: '2024-01-03T10:00', durationMin: 60, sport: 'Run', date: '2024-01-03', averageHeartRate: 150 },
      // 4. Duration only (60 min -> 50 TSS).
      { id: '4', source: 'demo', startTime: '2024-01-04T10:00', durationMin: 60, sport: 'Swim', date: '2024-01-04' },
      // 5. Incomplete data (no duration) -> TSS = 0.
      { id: '5', source: 'demo', startTime: '2024-01-05T10:00', durationMin: 0, sport: 'Other', date: '2024-01-05' }
    ];

    const pmc = generatePMC(activities, 250, 190, new Date('2024-01-05'));
    
    // Day 1
    expect(pmc[0].tss).toBe(55);
    
    // Day 2
    expect(pmc[1].tss).toBe(64); // calculateTSS(3600, 200, 250) = 64
    
    // Day 3
    const expectedHrTSS = (3600 * 150 * (150 / 190)) / (190 * 36);
    expect(pmc[2].tss).toBeCloseTo(expectedHrTSS, 1);
    
    // Day 4
    expect(pmc[3].tss).toBe(50); // 60 min * (50/60)
    
    // Day 5
    expect(pmc[4].tss).toBe(0);
  });
});
