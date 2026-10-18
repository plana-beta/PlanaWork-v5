import React from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BikeComponent, MetricData, PmcData, EventGoal } from './types';
import { AthleteProfile, PlannedWorkout, ActualWorkout } from './domain/models';
import { CoachDecision } from './domain/coachTypes';
import {
  WorkoutFeedback,
  WorkoutObservation,
  AthleteHabit,
  AthletePreference
} from './domain/athleteHistoryTypes';
import {
  TemporaryAvailability,
  IllnessEpisode,
  InjuryEpisode,
  RecoveryLog,
  CoachProposalError
} from './domain/athleteMemoryTypes';
import { analyzeWorkoutExecution, detectAthleteHabits } from './lib/postWorkoutAnalysis';
import { resolvePreferenceConflict } from './lib/athleteMemoryManager';
import { format, subDays, addDays } from 'date-fns';
import { generatePMC } from './lib/trainingEngine';
import { adaptPlan } from './lib/adaptationEngine';

interface AppState {
  syncStatus: 'idle' | 'syncing' | 'success' | 'error' | 'not_available';
  lastSyncedAt: string | null;
  setSyncStatus: (status: 'idle' | 'syncing' | 'success' | 'error' | 'not_available') => void;
  setLastSyncedAt: (date: string) => void;


  athleteProfile: AthleteProfile | null;
  setAthleteProfile: (profile: AthleteProfile) => void;
  updateAthleteProfile: (updates: Partial<AthleteProfile>) => void;
  resetAthleteProfile: () => void;

  plannedWorkouts: PlannedWorkout[];
  actualWorkouts: ActualWorkout[];
  
  components: BikeComponent[];
  metrics: MetricData[];
  pmc: PmcData[];
  events: EventGoal[];
  ftp: number;

  setFtp: (ftp: number) => void;
  
  addPlannedWorkout: (p: PlannedWorkout) => void;
  updatePlannedWorkout: (p: PlannedWorkout) => void;
  removePlannedWorkout: (id: string) => void;
  runAdaptation: () => void;
  setPlannedWorkouts: (workouts: PlannedWorkout[]) => void;
  
  addActualWorkout: (a: ActualWorkout) => void;
  updateActualWorkout: (a: ActualWorkout) => void;
  removeActualWorkout: (id: string) => void;

  addComponent: (c: BikeComponent) => void;
  updateComponent: (c: BikeComponent) => void;
  removeComponent: (id: string) => void;
  
  addEvent: (e: EventGoal) => void;
  updateEvent: (e: EventGoal) => void;
  removeEvent: (id: string) => void;

  coachDecisions: CoachDecision[];
  addCoachDecision: (decision: CoachDecision) => void;

  workoutFeedbacks: WorkoutFeedback[];
  workoutObservations: WorkoutObservation[];
  athleteHabits: AthleteHabit[];
  athletePreferences: AthletePreference[];
  temporaryAvailabilities: TemporaryAvailability[];
  illnessEpisodes: IllnessEpisode[];
  injuryEpisodes: InjuryEpisode[];
  recoveryLogs: RecoveryLog[];
  coachErrors: CoachProposalError[];

  addWorkoutFeedback: (feedback: WorkoutFeedback) => void;
  addWorkoutObservations: (observations: WorkoutObservation[]) => void;
  addAthletePreference: (pref: AthletePreference) => void;
  removeAthletePreference: (id: string) => void;
  setAthleteHabits: (habits: AthleteHabit[]) => void;

  addTemporaryAvailability: (item: TemporaryAvailability) => void;
  removeTemporaryAvailability: (id: string) => void;
  addIllnessEpisode: (episode: IllnessEpisode) => void;
  updateIllnessEpisode: (episode: IllnessEpisode) => void;
  addInjuryEpisode: (episode: InjuryEpisode) => void;
  updateInjuryEpisode: (episode: InjuryEpisode) => void;
  addRecoveryLog: (log: RecoveryLog) => void;
  addCoachError: (err: CoachProposalError) => void;
}



export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      
      
      syncStatus: 'idle',
      lastSyncedAt: null,
      setSyncStatus: (status) => set({ syncStatus: status }),
      setLastSyncedAt: (date) => set({ lastSyncedAt: date }),
      athleteProfile: null,


      setAthleteProfile: (profile) => set({ athleteProfile: profile }),
      updateAthleteProfile: (updates) => set((state) => ({ 
        athleteProfile: state.athleteProfile ? { ...state.athleteProfile, ...updates } : null 
      })),
      resetAthleteProfile: () => set({
        athleteProfile: null,
        plannedWorkouts: [],
        actualWorkouts: [],
        components: [],
        events: [],
        metrics: [],
        pmc: [],
        coachDecisions: [],
        workoutFeedbacks: [],
        workoutObservations: [],
        athleteHabits: [],
        athletePreferences: [],
        temporaryAvailabilities: [],
        illnessEpisodes: [],
        injuryEpisodes: [],
        recoveryLogs: [],
        coachErrors: []
      }),

      plannedWorkouts: [],
      actualWorkouts: [],
      
      components: [],
      events: [],
      metrics: [],
      ftp: 250,
      pmc: [],

      setFtp: (ftp) => set((state) => ({ ftp, pmc: generatePMC(state.actualWorkouts, ftp, state.athleteProfile?.hrMax) })),
      
      setPlannedWorkouts: (workouts) => set({ plannedWorkouts: workouts }),
      runAdaptation: () => set((state) => {
        if (!state.athleteProfile) return state;
        const result = adaptPlan(state.athleteProfile, state.plannedWorkouts, state.actualWorkouts, state.pmc);
        if (result.changed) {
          return { plannedWorkouts: result.updatedPlannedWorkouts };
        }
        return state;
      }),
      addPlannedWorkout: (p) => set((state) => ({ plannedWorkouts: [...state.plannedWorkouts, p] })),
      updatePlannedWorkout: (updated) => set((state) => ({
        plannedWorkouts: state.plannedWorkouts.map(p => p.id === updated.id ? updated : p)
      })),
      removePlannedWorkout: (id) => set((state) => ({
        plannedWorkouts: state.plannedWorkouts.filter(p => p.id !== id)
      })),
      
      addActualWorkout: (a) => set((state) => {
        const newActual = [...state.actualWorkouts, a];
        return { actualWorkouts: newActual, pmc: generatePMC(newActual, state.ftp, state.athleteProfile?.hrMax) };
      }),
      updateActualWorkout: (updated) => set((state) => {
        const newActual = state.actualWorkouts.map(a => a.id === updated.id ? updated : a);
        return { actualWorkouts: newActual, pmc: generatePMC(newActual, state.ftp, state.athleteProfile?.hrMax) };
      }),
      removeActualWorkout: (id) => set((state) => {
        const newActual = state.actualWorkouts.filter(a => a.id !== id);
        return { actualWorkouts: newActual, pmc: generatePMC(newActual, state.ftp, state.athleteProfile?.hrMax) };
      }),

      addComponent: (c) => set((state) => ({ components: [...state.components, c] })),
      updateComponent: (updated) => set((state) => ({
        components: state.components.map(c => c.id === updated.id ? updated : c)
      })),
      removeComponent: (id) => set((state) => ({
        components: state.components.filter(c => c.id !== id)
      })),

      addEvent: (e) => set((state) => ({ events: [...state.events, e] })),
      updateEvent: (updated) => set((state) => ({
        events: state.events.map(e => e.id === updated.id ? updated : e)
      })),
      removeEvent: (id) => set((state) => ({
        events: state.events.filter(e => e.id !== id)
      })),

      coachDecisions: [],
      addCoachDecision: (decision) => set((state) => ({
        coachDecisions: [decision, ...state.coachDecisions]
      })),

      workoutFeedbacks: [],
      workoutObservations: [],
      athleteHabits: [],
      athletePreferences: [],
      temporaryAvailabilities: [],
      illnessEpisodes: [],
      injuryEpisodes: [],
      recoveryLogs: [],
      coachErrors: [],

      addWorkoutFeedback: (feedback) => set((state) => {
        const newFeedbacks = [feedback, ...state.workoutFeedbacks];

        // Trouver la séance réelle et planifiée correspondante
        const actualWorkout = state.actualWorkouts.find(
          a => (feedback.actualWorkoutId && a.id === feedback.actualWorkoutId) ||
               (a.date === feedback.date && a.sport === feedback.sport)
        ) || {
          id: feedback.actualWorkoutId || `actual-fallback-${feedback.id}`,
          source: 'manual',
          sport: feedback.sport,
          date: feedback.date,
          startTime: feedback.createdAt,
          durationMin: feedback.durationMin,
          distanceKm: feedback.distanceKm,
          temperature: feedback.temperature
        };

        const plannedWorkout = state.plannedWorkouts.find(
          p => (feedback.workoutId && p.id === feedback.workoutId) ||
               (actualWorkout.plannedWorkoutId && p.id === actualWorkout.plannedWorkoutId) ||
               (p.date === feedback.date && p.sport === feedback.sport)
        );

        // Analyse déterministe
        const newObs = analyzeWorkoutExecution({
          plannedWorkout,
          actualWorkout,
          feedback
        });

        const updatedObservations = [...newObs, ...state.workoutObservations];
        const updatedHabits = detectAthleteHabits(updatedObservations, newFeedbacks, state.actualWorkouts);

        return {
          workoutFeedbacks: newFeedbacks,
          workoutObservations: updatedObservations,
          athleteHabits: updatedHabits
        };
      }),

      addWorkoutObservations: (observations) => set((state) => {
        const updatedObservations = [...observations, ...state.workoutObservations];
        const updatedHabits = detectAthleteHabits(updatedObservations, state.workoutFeedbacks, state.actualWorkouts);
        return {
          workoutObservations: updatedObservations,
          athleteHabits: updatedHabits
        };
      }),

      addAthletePreference: (pref) => set((state) => {
        const { updatedPreferences } = resolvePreferenceConflict(state.athletePreferences, pref);
        return { athletePreferences: updatedPreferences };
      }),

      removeAthletePreference: (id) => set((state) => ({
        athletePreferences: state.athletePreferences.filter(p => p.id !== id)
      })),

      setAthleteHabits: (habits) => set({ athleteHabits: habits }),

      addTemporaryAvailability: (item) => set((state) => ({
        temporaryAvailabilities: [item, ...state.temporaryAvailabilities.filter(t => t.id !== item.id)]
      })),

      removeTemporaryAvailability: (id) => set((state) => ({
        temporaryAvailabilities: state.temporaryAvailabilities.filter(t => t.id !== id)
      })),

      addIllnessEpisode: (episode) => set((state) => ({
        illnessEpisodes: [episode, ...state.illnessEpisodes.filter(e => e.id !== episode.id)]
      })),

      updateIllnessEpisode: (updated) => set((state) => ({
        illnessEpisodes: state.illnessEpisodes.map(e => e.id === updated.id ? updated : e)
      })),

      addInjuryEpisode: (episode) => set((state) => ({
        injuryEpisodes: [episode, ...state.injuryEpisodes.filter(e => e.id !== episode.id)]
      })),

      updateInjuryEpisode: (updated) => set((state) => ({
        injuryEpisodes: state.injuryEpisodes.map(e => e.id === updated.id ? updated : e)
      })),

      addRecoveryLog: (log) => set((state) => ({
        recoveryLogs: [log, ...state.recoveryLogs.filter(r => r.date !== log.date)]
      })),

      addCoachError: (err) => set((state) => ({
        coachErrors: [err, ...state.coachErrors]
      }))
    }),
    {
      name: 'plana-storage',
      partialize: (state) => ({
        athleteProfile: state.athleteProfile,
        ftp: state.ftp,
        plannedWorkouts: state.plannedWorkouts,
        actualWorkouts: state.actualWorkouts,
        components: state.components,
        metrics: state.metrics,
        events: state.events,
        pmc: state.pmc,
        coachDecisions: state.coachDecisions,
        workoutFeedbacks: state.workoutFeedbacks,
        workoutObservations: state.workoutObservations,
        athleteHabits: state.athleteHabits,
        athletePreferences: state.athletePreferences,
        temporaryAvailabilities: state.temporaryAvailabilities,
        illnessEpisodes: state.illnessEpisodes,
        injuryEpisodes: state.injuryEpisodes,
        recoveryLogs: state.recoveryLogs,
        coachErrors: state.coachErrors
      }),
    }
  )
);
