import { describe, it, expect, beforeEach, vi } from 'vitest';
import { coachService } from './coachService';
import { useAppStore } from '../store';

// Mock fetch
global.fetch = vi.fn();

describe('CoachService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAppStore.setState({
      athleteProfile: {
        id: '1',
        level: { swim: 'intermediate', ride: 'intermediate', run: 'intermediate' },
        availability: { weeklyHours: 10, availableDays: ['Lundi', 'Mardi'] },
        dataConnection: 'none'
      },
      plannedWorkouts: [
        {
          id: 'p1', sport: 'Run', date: new Date().toISOString().substring(0, 10), title: 'Run', targetDurationMin: 45, targetIntensity: { type: 'zone', value: 'Z2' }, status: 'planned'
        }
      ],
      actualWorkouts: [],
      pmc: [
        { date: new Date().toISOString().substring(0, 10), ctl: 50, atl: 60, tsb: -10, tss: 0 }
      ]
    });
  });

  it('builds context correctly and calls API', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Réponse test',
        suggestedAction: 'OPEN_TODAY_WORKOUT'
      })
    });

    const response = await coachService.askCoach('Hello');
    
    expect(response.success).toBe(true);
    expect(response.message).toBe('Réponse test');
    expect(response.suggestedAction).toBe('OPEN_TODAY_WORKOUT');

    const callArgs = (global.fetch as any).mock.calls[0];
    expect(callArgs[0]).toBe('/api/coach');
    
    const body = JSON.parse(callArgs[1].body);
    expect(body.prompt).toBe('Hello');
    expect(body.context).toBeDefined();
    expect(body.context.profile.availability.weeklyHours).toBe(10);
    expect(body.context.pmcStatus.ctl).toBe(50);
  });

  it('handles offline/network errors gracefully', async () => {
    (global.fetch as any).mockRejectedValue(new TypeError('Failed to fetch'));

    const response = await coachService.askCoach('Hello');
    
    expect(response.success).toBe(false);
    expect(response.message).toContain('hors-ligne');
  });
});
