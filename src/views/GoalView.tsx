import React from 'react';
import { motion } from 'motion/react';
import { Droplets, Bike, Footprints, Info } from 'lucide-react';
import { useAppStore } from '../store';
import { generateRecommendations } from '../lib/recommendationEngine';
import { useMemo } from 'react';
import { differenceInDays, parseISO } from 'date-fns';

export default function GoalView() {
  const store = useAppStore();
  const profile = store.athleteProfile;
  const today = new Date();
  const recommendations = useMemo(() => generateRecommendations(store.athleteProfile, store.plannedWorkouts, store.actualWorkouts, store.pmc, today), [store, today]);
  const goalRec = recommendations.find(r => r.type === 'GOAL');

  const goal = profile?.goal;

  if (!goal) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-5 flex items-center justify-center h-full pt-20">
        <p className="text-slate-500 font-medium">Aucun objectif défini</p>
      </motion.div>
    );
  }

  const daysRemaining = goal.date ? Math.max(0, differenceInDays(parseISO(goal.date), new Date())) : null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-5 pb-24 space-y-6">
      {/* Header */}
      <div className="text-center pt-8 pb-4">
        <h2 className="text-3xl font-black text-plana-black tracking-wide mb-1">{goal.title || 'Objectif principal'}</h2>
        <p className="text-sm text-slate-500 font-medium">{goal.date || 'Date à définir'}</p>
        
        {daysRemaining !== null && (
          <div className="mt-8">
            <div className="text-6xl font-black text-plana-orange tracking-tight">{daysRemaining}</div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-2">Jours restants</div>
          </div>
        )}
      </div>

      {/* Préparation */}
      <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm mt-4">
        <div className="flex justify-between items-end mb-4">
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Préparation</h3>
          <span className="text-2xl font-black text-plana-black tracking-tight">
            0 <span className="text-sm text-slate-400 font-bold">%</span>
          </span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex">
          <div className="h-full bg-plana-black rounded-full" style={{ width: '0%' }} />
        </div>
        <div className="text-xs text-slate-400 font-medium mt-3 text-center">Plus de données requises</div>
      </div>

      {/* Ton niveau actuel */}
      <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm">
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-6">Ton niveau actuel</h3>
        
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500">
                <Droplets size={20} />
              </div>
              <span className="font-bold text-plana-black text-sm uppercase tracking-wider">Natation</span>
            </div>
            <span className="px-3 py-1 bg-gray-100 rounded-lg text-[10px] font-bold text-slate-600 uppercase tracking-wider">
              {profile?.level.swim === 'advanced' ? 'Avancé' : profile?.level.swim === 'beginner' ? 'Débutant' : 'Intermédiaire'}
            </span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-500">
                <Bike size={20} />
              </div>
              <span className="font-bold text-plana-black text-sm uppercase tracking-wider">Vélo</span>
            </div>
            <span className="px-3 py-1 bg-gray-100 rounded-lg text-[10px] font-bold text-slate-600 uppercase tracking-wider">
              {profile?.level.ride === 'advanced' ? 'Avancé' : profile?.level.ride === 'beginner' ? 'Débutant' : 'Intermédiaire'}
            </span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-plana-orange">
                <Footprints size={20} />
              </div>
              <span className="font-bold text-plana-black text-sm uppercase tracking-wider">Course</span>
            </div>
            <span className="px-3 py-1 bg-gray-100 rounded-lg text-[10px] font-bold text-slate-600 uppercase tracking-wider">
              {profile?.level.run === 'advanced' ? 'Avancé' : profile?.level.run === 'beginner' ? 'Débutant' : 'Intermédiaire'}
            </span>
          </div>
        </div>
      </div>

      {/* Estimation / Recommandation */}
      {goalRec ? (
        <div className="bg-gray-50 border border-gray-100 rounded-3xl p-5 flex gap-4 items-start">
          <div className="shrink-0 w-8 h-8 rounded-full bg-plana-orange text-white flex items-center justify-center mt-0.5">
            <Info size={16} />
          </div>
          <p className="text-sm font-medium text-plana-black leading-relaxed">
            {goalRec.message}
          </p>
        </div>
      ) : (
        <div className="bg-gray-50 border border-gray-100 rounded-3xl p-5 flex gap-4 items-start">
          <div className="shrink-0 w-8 h-8 rounded-full bg-plana-black text-white flex items-center justify-center mt-0.5">
            <Info size={16} />
          </div>
          <p className="text-sm font-medium text-plana-black leading-relaxed">
            Trajectoire en cours d'analyse. Continue tes entraînements pour obtenir une analyse détaillée.
          </p>
        </div>
      )}
    </motion.div>
  );
}
