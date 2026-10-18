import { describe, it, expect, beforeEach } from 'vitest';
import { CoachActionExecutor } from './coachActionExecutor';
import { useAppStore } from '../store';
import { CoachProposal } from '../domain/coachTypes';
import { PlannedWorkout } from '../domain/models';

describe('CoachActionExecutor Workflow', () => {
  beforeEach(() => {
    // Initialiser un état propre pour le store
    const initialPlannedWorkouts: PlannedWorkout[] = [
      {
        id: 'w-1',
        title: 'Endurance Fondamentale',
        sport: 'Ride',
        date: '2026-09-22',
        targetDurationMin: 60,
        targetIntensity: { type: 'zone', value: 'Z2' },
        targetTss: 50,
        status: 'planned'
      },
      {
        id: 'w-2',
        title: 'Intervalles Seuil',
        sport: 'Ride',
        date: '2026-09-24',
        targetDurationMin: 75,
        targetIntensity: { type: 'zone', value: 'Z4' },
        targetTss: 85,
        status: 'planned'
      }
    ];

    useAppStore.setState({
      plannedWorkouts: initialPlannedWorkouts,
      actualWorkouts: [],
      pmc: [],
      ftp: 250,
      athleteProfile: {
        id: 'ath-1',
        level: { swim: 'intermediate', ride: 'intermediate', run: 'intermediate' },
        availability: { weeklyHours: 8, availableDays: ['Mardi', 'Jeudi', 'Samedi', 'Dimanche'] },
        dataConnection: 'demo'
      }
    });
  });

  it('exécute avec succès une modification validée et met à jour l agenda', () => {
    const proposal: CoachProposal = {
      id: 'prop-1',
      action: 'REDUCE_LOAD',
      reason: 'Fatigue accumulée',
      explanation: 'Réduction de 30% pour préserver la récupération',
      affectedWorkoutIds: ['w-1'],
      proposedModifications: [
        {
          workoutId: 'w-1',
          newDurationMin: 40,
          newTargetTss: 35,
          newStatus: 'adapted'
        }
      ],
      constraints: {
        reduceIntensity: true,
        maxWeeklyLoadIncrease: 0.05
      },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = CoachActionExecutor.executeProposal(proposal);

    expect(result.success).toBe(true);
    expect(result.updatedWorkoutsCount).toBe(1);

    // Vérifier que le store a bien été mis à jour
    const updatedWorkouts = useAppStore.getState().plannedWorkouts;
    const modifiedWorkout = updatedWorkouts.find(w => w.id === 'w-1');
    expect(modifiedWorkout).toBeDefined();
    expect(modifiedWorkout?.targetDurationMin).toBe(40);
    expect(modifiedWorkout?.targetTss).toBe(35);
    expect(modifiedWorkout?.status).toBe('adapted');
  });

  it('exécute une annulation de séance et allège l agenda', () => {
    const proposal: CoachProposal = {
      id: 'prop-cancel',
      action: 'CANCEL_WORKOUT',
      reason: 'Repos complet nécessaire',
      affectedWorkoutIds: ['w-2'],
      proposedModifications: [
        {
          workoutId: 'w-2',
          cancel: true
        }
      ],
      constraints: {
        prioritizeRecovery: true,
        maxWeeklyLoadIncrease: 0.05
      },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = CoachActionExecutor.executeProposal(proposal);

    expect(result.success).toBe(true);
    const updated = useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-2');
    expect(updated?.targetDurationMin).toBe(0);
    expect(updated?.targetTss).toBe(0);
  });

  it('rejette l exécution si la proposition viole les règles de sécurité physiologique', () => {
    // Surcharge hebdomadaire illicite (+50%)
    const proposal: CoachProposal = {
      id: 'prop-bad',
      action: 'INCREASE_LOAD',
      reason: 'Surcharge trop violente',
      affectedWorkoutIds: ['w-1'],
      proposedModifications: [
        {
          workoutId: 'w-1',
          newDurationMin: 180,
          newTargetTss: 150
        }
      ],
      constraints: {
        maxWeeklyLoadIncrease: 0.50 // Dépasse les 5% autorisés
      },
      confidence: 'HIGH',
      proposedAt: new Date().toISOString()
    };

    const result = CoachActionExecutor.executeProposal(proposal);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Le store ne doit pas avoir changé pour w-1
    const workout = useAppStore.getState().plannedWorkouts.find(w => w.id === 'w-1');
    expect(workout?.targetDurationMin).toBe(60);
  });
});
