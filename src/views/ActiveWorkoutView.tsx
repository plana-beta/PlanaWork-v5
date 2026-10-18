import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Play, Square, Pause, ChevronLeft, Check, Sparkles, MessageSquare } from 'lucide-react';
import { PlannedWorkout, ActualWorkout } from '../domain/models';
import { WorkoutFeedback, WorkoutRpe, PostWorkoutFeeling } from '../domain/athleteHistoryTypes';
import { useAppStore } from '../store';
import { format } from 'date-fns';

interface Props {
  plannedWorkout: PlannedWorkout;
  onClose: () => void;
}

export default function ActiveWorkoutView({ plannedWorkout, onClose }: Props) {
  const addActualWorkout = useAppStore(s => s.addActualWorkout);
  const updatePlannedWorkout = useAppStore(s => s.updatePlannedWorkout);
  const addWorkoutFeedback = useAppStore(s => s.addWorkoutFeedback);
  
  const [status, setStatus] = useState<'ready' | 'active' | 'paused' | 'feedback' | 'finished'>('ready');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Feedback states (<15s, optional, non-blocking)
  const [selectedRpe, setSelectedRpe] = useState<WorkoutRpe | null>(null);
  const [selectedFeeling, setSelectedFeeling] = useState<PostWorkoutFeeling | null>(null);
  const [comment, setComment] = useState('');

  useEffect(() => {
    let interval: any;
    if (status === 'active') {
      interval = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [status]);

  const handleStart = () => setStatus('active');
  const handlePause = () => setStatus('paused');
  const handleResume = () => setStatus('active');
  
  const handleInitiateFinish = () => {
    // Open quick post-workout debrief
    setStatus('feedback');
  };

  const handleFinalizeWorkout = (saveFeedback: boolean) => {
    setStatus('finished');
    const actualDurationMin = Math.max(1, Math.round(elapsedSeconds / 60));
    const actualId = crypto.randomUUID();
    const todayStr = format(new Date(), 'yyyy-MM-dd');

    // 1. Save ActualWorkout
    const actual: ActualWorkout = {
      id: actualId,
      source: 'demo',
      sport: plannedWorkout.sport,
      date: todayStr,
      startTime: new Date().toISOString(),
      durationMin: actualDurationMin,
      plannedWorkoutId: plannedWorkout.id,
      averageHeartRate: 142, // demo data
      distanceKm: plannedWorkout.sport === 'Run' ? 5.2 : plannedWorkout.sport === 'Ride' ? 25 : undefined,
    };
    addActualWorkout(actual);

    // 2. Mark planned workout completed
    updatePlannedWorkout({ ...plannedWorkout, status: 'completed' });

    // 3. Save WorkoutFeedback if requested
    if (saveFeedback && selectedRpe !== null) {
      const feedback: WorkoutFeedback = {
        id: `fb-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        workoutId: plannedWorkout.id,
        actualWorkoutId: actualId,
        date: todayStr,
        sport: plannedWorkout.sport,
        durationMin: actualDurationMin,
        distanceKm: actual.distanceKm,
        rpe: selectedRpe,
        feeling: selectedFeeling || undefined,
        comment: comment.trim() || undefined,
        createdAt: new Date().toISOString()
      };
      addWorkoutFeedback(feedback);
    }

    onClose();
  };

  const formatTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const RPE_OPTIONS: Array<{ value: WorkoutRpe; label: string; desc: string }> = [
    { value: 1, label: '1', desc: 'Très facile' },
    { value: 2, label: '2', desc: 'Facile' },
    { value: 3, label: '3', desc: 'Normale' },
    { value: 4, label: '4', desc: 'Difficile' },
    { value: 5, label: '5', desc: 'Très difficile' },
  ];

  const FEELING_OPTIONS: Array<{ value: PostWorkoutFeeling; label: string }> = [
    { value: 'very_good', label: 'Très bien' },
    { value: 'good', label: 'Bien' },
    { value: 'tired', label: 'Fatigué' },
    { value: 'very_tired', label: 'Très fatigué' },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: '100%' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: '100%' }} className="fixed inset-0 z-50 bg-plana-black text-white flex flex-col overflow-y-auto">
      <div className="p-5 flex items-center justify-between pt-12">
        <button onClick={onClose} className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center">
          <ChevronLeft size={20} />
        </button>
        <div className="font-bold tracking-wide">{plannedWorkout.sport.toUpperCase()}</div>
        <div className="w-10" />
      </div>

      {status !== 'feedback' ? (
        <>
          <div className="flex-1 flex flex-col items-center justify-center p-5">
            <h2 className="text-2xl font-black mb-8 text-center">{plannedWorkout.title}</h2>
            
            <div className="text-7xl font-black tracking-tighter mb-12 text-plana-orange">
              {formatTime(elapsedSeconds)}
            </div>

            {status === 'ready' && (
              <div className="text-center text-slate-400 font-medium max-w-xs mb-8">
                Objectif: {plannedWorkout.targetDurationMin} min en {plannedWorkout.targetIntensity.value}
              </div>
            )}
          </div>

          <div className="p-8 pb-16 flex justify-center gap-6">
            {status === 'ready' && (
              <button onClick={handleStart} className="w-20 h-20 bg-plana-orange rounded-full flex items-center justify-center text-white shadow-[0_0_40px_rgba(255,107,0,0.4)] active:scale-95 transition-transform">
                <Play size={32} fill="currentColor" className="ml-2" />
              </button>
            )}
            
            {status === 'active' && (
              <button onClick={handlePause} className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-white active:scale-95 transition-transform">
                <Pause size={32} fill="currentColor" />
              </button>
            )}

            {status === 'paused' && (
              <>
                <button onClick={handleResume} className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-white active:scale-95 transition-transform">
                  <Play size={32} fill="currentColor" className="ml-2" />
                </button>
                <button onClick={handleInitiateFinish} className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center text-white shadow-[0_0_40px_rgba(239,68,68,0.4)] active:scale-95 transition-transform">
                  <Square size={28} fill="currentColor" />
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        /* Questionnaire Post-Workout (<15s, optionnel, non bloquant) */
        <div className="flex-1 flex flex-col justify-between p-6 max-w-lg mx-auto w-full">
          <div className="space-y-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-2">
                <Check size={14} /> Séance terminée ({Math.max(1, Math.round(elapsedSeconds / 60))} min)
              </div>
              <h2 className="text-2xl font-black tracking-tight">{plannedWorkout.title}</h2>
              <p className="text-xs text-slate-400 mt-1">Données objectives enregistrées. Ton ressenti permet d'affiner les conseils du Coach.</p>
            </div>

            {/* Question 1: RPE 1 à 5 */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <label className="block text-sm font-bold text-slate-200 mb-1">
                Comment s'est passée la séance ?
              </label>
              <p className="text-[11px] text-slate-400 mb-3">Échelle d'effort perçu (RPE 1 à 5)</p>
              
              <div className="grid grid-cols-5 gap-2">
                {RPE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedRpe(opt.value)}
                    className={`py-3 px-1 rounded-xl flex flex-col items-center justify-center transition-all ${
                      selectedRpe === opt.value
                        ? 'bg-plana-orange text-white ring-2 ring-white/50 scale-105'
                        : 'bg-white/10 text-slate-300 hover:bg-white/15'
                    }`}
                  >
                    <span className="text-lg font-black">{opt.value}</span>
                    <span className="text-[10px] text-center font-medium mt-0.5 leading-tight">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Question 2: Ressenti général (optionnel) */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <label className="block text-sm font-bold text-slate-200 mb-2">
                Comment te sens-tu après cette séance ? <span className="text-xs font-normal text-slate-400">(optionnel)</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {FEELING_OPTIONS.map(f => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setSelectedFeeling(selectedFeeling === f.value ? null : f.value)}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all text-center ${
                      selectedFeeling === f.value
                        ? 'bg-white text-plana-black'
                        : 'bg-white/10 text-slate-300 hover:bg-white/15'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Question 3: Commentaire libre (optionnel) */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <label className="block text-sm font-bold text-slate-200 mb-2 flex items-center justify-between">
                <span>Un commentaire ?</span>
                <span className="text-xs font-normal text-slate-400">optionnel</span>
              </label>
              <textarea
                rows={2}
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Ex: Jambes un peu lourdes au début, bonne météo..."
                className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-plana-orange resize-none"
              />
            </div>
          </div>

          {/* Boutons d'action : Enregistrer ou Passer */}
          <div className="pt-6 pb-8 space-y-3">
            <button
              onClick={() => handleFinalizeWorkout(true)}
              disabled={selectedRpe === null}
              className={`w-full py-4 rounded-2xl font-bold tracking-wide flex items-center justify-center gap-2 transition-all ${
                selectedRpe !== null
                  ? 'bg-plana-orange text-white shadow-lg shadow-plana-orange/20 active:scale-[0.98]'
                  : 'bg-white/10 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Check size={18} /> Enregistrer mon ressenti
            </button>
            <button
              onClick={() => handleFinalizeWorkout(false)}
              className="w-full py-3 rounded-2xl text-xs font-semibold text-slate-400 hover:text-white transition-colors"
            >
              Passer (ignorer le questionnaire)
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
