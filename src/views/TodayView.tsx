import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfWeek, endOfWeek, isWithinInterval, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Play, Zap, Droplets, Bike, Footprints, AlertCircle, Info, TrendingUp, CheckCircle, Bell } from 'lucide-react';
import { useAppStore } from '../store';
import ActiveWorkoutView from './ActiveWorkoutView';
import { PlannedWorkout } from '../domain/models';
import { generateRecommendations } from '../lib/recommendationEngine';

export default function TodayView() {
  const today = new Date();
  const dateStr = format(today, 'yyyy-MM-dd');
  
  const profile = useAppStore(s => s.athleteProfile);
  const plannedWorkouts = useAppStore(s => s.plannedWorkouts);
  const actualWorkouts = useAppStore(s => s.actualWorkouts);
  const pmc = useAppStore(s => s.pmc);
  const todaysWorkout = plannedWorkouts.find(w => w.date === dateStr && w.status !== 'completed');

  const recommendations = useMemo(() => {
    return generateRecommendations(profile, plannedWorkouts, actualWorkouts, pmc, today);
  }, [profile, plannedWorkouts, actualWorkouts, pmc, today]); // Note: today is stable within the render cycle, but might want to omit it from deps if it causes re-renders. We'll leave it for now.

  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
  
  const getSportCount = (sport: string, isActual: boolean) => {
    const list = isActual ? actualWorkouts : plannedWorkouts;
    return list.filter(w => w.sport === sport && isWithinInterval(parseISO(w.date), { start: weekStart, end: weekEnd })).length;
  };
  
  const currentPmc = pmc.length > 0 ? pmc[pmc.length - 1] : { tsb: 0, atl: 0 };
  let formText = 'Optimale';
  let formColor = 'text-emerald-500';
  if (currentPmc.tsb < -20) { formText = 'Fatigué'; formColor = 'text-red-500'; }
  else if (currentPmc.tsb < -10) { formText = 'En charge'; formColor = 'text-amber-500'; }
  
  let fatigueText = 'Basse';
  let fatigueColor = 'text-emerald-500';
  if (currentPmc.atl > 80) { fatigueText = 'Élevée'; fatigueColor = 'text-red-500'; }
  else if (currentPmc.atl > 50) { fatigueText = 'Modérée'; fatigueColor = 'text-amber-500'; }

  const [activeWorkout, setActiveWorkout] = useState<PlannedWorkout | null>(null);

  const getSportIcon = (sport: string) => {
    switch (sport) {
      case 'Run': return <Footprints size={18} />;
      case 'Ride': return <Bike size={18} />;
      case 'Swim': return <Droplets size={18} />;
      default: return <Zap size={18} />;
    }
  };

  const getSportColor = (sport: string) => {
    switch (sport) {
      case 'Run': return 'text-plana-orange';
      case 'Ride': return 'text-emerald-500';
      case 'Swim': return 'text-blue-500';
      default: return 'text-gray-500';
    }
  };

  const getRecIcon = (type: string) => {
    switch (type) {
      case 'RECOVERY': return <Zap size={20} className="text-amber-500" />;
      case 'TODAY_WORKOUT': return <Play size={20} className="text-plana-green" />;
      case 'PLAN_ADAPTED': return <AlertCircle size={20} className="text-amber-500" />;
      case 'MISSED_WORKOUT': return <Info size={20} className="text-blue-400" />;
      case 'PROGRESS': return <TrendingUp size={20} className="text-emerald-500" />;
      case 'GOAL': return <CheckCircle size={20} className="text-plana-orange" />;
      case 'HEALTH_SYNC': return <Bell size={20} className="text-slate-400" />;
      case 'INFO': return <Info size={20} className="text-blue-400" />;
      default: return <Zap size={20} className="text-gray-400" />;
    }
  };

  const mainRec = recommendations.length > 0 ? recommendations[0] : null;
  const secondaryRecs = recommendations.slice(1, 3);

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-5 pb-24 space-y-6">
        <div>
          <h2 className="text-3xl font-black text-plana-black tracking-wide">Aujourd'hui</h2>
          <p className="text-sm text-slate-500 font-medium capitalize mt-1">
            {format(today, 'EEEE d MMMM', { locale: fr })}
          </p>
        </div>

        {/* Recommandation Principale */}
        {mainRec && (
          <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4 font-bold text-sm">
              {getRecIcon(mainRec.type)}
              <span className="uppercase tracking-wider text-slate-600">{mainRec.title}</span>
            </div>
            
            <p className="text-lg font-black text-plana-black mb-2">{mainRec.message}</p>
            
            {mainRec.reason && (
              <p className="text-sm font-medium text-slate-500 mb-6">{mainRec.reason}</p>
            )}

            {mainRec.type === 'TODAY_WORKOUT' && todaysWorkout && (
              <button 
                onClick={() => setActiveWorkout(todaysWorkout)}
                className="w-full mt-4 py-4 rounded-2xl bg-plana-black text-white font-bold tracking-wide flex items-center justify-center gap-2 hover:bg-gray-800 transition-colors shadow-lg shadow-black/10 active:scale-[0.98]"
              >
                <Play size={18} fill="currentColor" /> Commencer la séance
              </button>
            )}
          </div>
        )}

        {/* Recommandations Secondaires */}
        {secondaryRecs.length > 0 && (
          <div className="space-y-3">
            {secondaryRecs.map(rec => (
              <div key={rec.id} className="bg-gray-50 border border-gray-100 rounded-2xl p-4 flex gap-4 items-start">
                <div className="mt-0.5">{getRecIcon(rec.type)}</div>
                <div>
                  <h4 className="text-sm font-bold text-plana-black">{rec.title}</h4>
                  <p className="text-xs font-medium text-slate-500 mt-1">{rec.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Séance du jour Fallback if not main rec (e.g. recovery overrides it) */}
        {todaysWorkout && mainRec?.type !== 'TODAY_WORKOUT' && (
          <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
            <div className={`flex items-center gap-2 mb-4 font-bold text-sm ${getSportColor(todaysWorkout.sport)}`}>
              {getSportIcon(todaysWorkout.sport)}
              <span className="uppercase tracking-wider">{todaysWorkout.sport}</span>
            </div>
            
            <h3 className="text-2xl font-black text-plana-black mb-1">
              {todaysWorkout.title}
            </h3>
            {todaysWorkout.status === 'adapted' && (
              <div className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-2">
                <Zap size={12} fill="currentColor" /> Adapté pour toi
              </div>
            )}
            <p className="text-slate-500 font-medium mb-6">{todaysWorkout.targetDurationMin} min • {todaysWorkout.targetIntensity.value}</p>
            
            <button 
              onClick={() => setActiveWorkout(todaysWorkout)}
              className="w-full py-4 rounded-2xl bg-plana-black text-white font-bold tracking-wide flex items-center justify-center gap-2 hover:bg-gray-800 transition-colors shadow-lg shadow-black/10 active:scale-[0.98]"
            >
              <Play size={18} fill="currentColor" /> Commencer la séance
            </button>
          </div>
        )}

        {/* État actuel & Cette semaine  */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">État actuel</h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-slate-600">Forme</span>
                <span className={`text-sm font-black ${formColor}`}>{formText}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-slate-600">Fatigue</span>
                <span className={`text-sm font-black ${fatigueColor}`}>{fatigueText}</span>
              </div>
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">Cette semaine</h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Droplets size={16} className="text-blue-400" />
                <span className="text-sm font-bold text-slate-600">{getSportCount('Swim', true)} / {getSportCount('Swim', false)}</span>
              </div>
              <div className="flex justify-between items-center">
                <Bike size={16} className="text-emerald-500" />
                <span className="text-sm font-bold text-slate-600">{getSportCount('Ride', true)} / {getSportCount('Ride', false)}</span>
              </div>
              <div className="flex justify-between items-center">
                <Footprints size={16} className="text-plana-orange" />
                <span className="text-sm font-bold text-slate-600">{getSportCount('Run', true)} / {getSportCount('Run', false)}</span>
              </div>
            </div>
          </div>
        </div>

      </motion.div>

      <AnimatePresence>
        {activeWorkout && (
          <ActiveWorkoutView 
            plannedWorkout={activeWorkout} 
            onClose={() => setActiveWorkout(null)} 
          />
        )}
      </AnimatePresence>
    </>
  );
}
