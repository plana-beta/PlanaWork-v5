import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Activity, Calendar, Trophy, Zap, Watch, Check, AlertCircle, Edit2 } from 'lucide-react';
import { cn } from '../utils';
import { useAppStore } from '../store';
import { generateTrainingPlan } from '../lib/planningEngine';

interface OnboardingViewProps {
  onComplete: () => void;
}

const DAYS_OF_WEEK = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export default function OnboardingView({ onComplete }: OnboardingViewProps) {
  const [step, setStep] = useState(1);
  const totalSteps = 8;
  
  const [goalSport, setGoalSport] = useState<string | null>(null);
  const [goalDistance, setGoalDistance] = useState<string | null>(null);
  const [goalDate, setGoalDate] = useState<string | null>(null);
  const [goalName, setGoalName] = useState<string | null>(null);
  const [levels, setLevels] = useState<{ [key: string]: string | null }>({ Natation: null, Vélo: null, Course: null });
  const [weeklyHours, setWeeklyHours] = useState<string | null>(null);
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [healthConnection, setHealthConnection] = useState<string | null>(null);

  
  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      const profile = {
        id: crypto.randomUUID(),
        goal: {
          id: 'goal-1',
          title: goalName || '',
          date: goalDate || '',
          type: (goalDistance?.toLowerCase().replace(' ', '_') as any) || 'custom',
          sportFocus: (goalSport === 'Triathlon' ? 'Triathlon' : goalSport === 'Course à pied' ? 'Run' : goalSport === 'Cyclisme' ? 'Ride' : goalSport === 'Natation' ? 'Swim' : 'Other') as any
        },
        level: {
          swim: (levels.Natation === 'Avancé' ? 'advanced' : levels.Natation === 'Débutant' ? 'beginner' : 'intermediate') as any,
          ride: (levels.Vélo === 'Avancé' ? 'advanced' : levels.Vélo === 'Débutant' ? 'beginner' : 'intermediate') as any,
          run: (levels.Course === 'Avancé' ? 'advanced' : levels.Course === 'Débutant' ? 'beginner' : 'intermediate') as any,
        },
        availability: {
          weeklyHours: getHoursNum(weeklyHours),
          availableDays: availableDays
        },
        dataConnection: (healthConnection as any) || 'none'
      };
      const store = useAppStore.getState();
      store.setAthleteProfile(profile);
      const plan = generateTrainingPlan(profile);
      store.setPlannedWorkouts(plan);
      onComplete();
    }
  };

  
  const isLevelsComplete = levels.Natation && levels.Vélo && levels.Course;
  
  const canSubmit = goalSport && goalDistance && goalName && goalDate && isLevelsComplete && weeklyHours && availableDays.length > 0;

  const getHoursNum = (h: string | null) => {
    if (!h) return 0;
    const match = h.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };
  
  const hoursNum = getHoursNum(weeklyHours);
  const showWarning = hoursNum > 0 && availableDays.length > 0 && (hoursNum / availableDays.length) >= 3;

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col items-center justify-center p-5 safe-top safe-bottom overflow-hidden">
      
      {/* Progress Bar */}
      <div className="absolute top-10 left-5 right-5 flex gap-1">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div key={i} className={cn("h-1 flex-1 rounded-full transition-all", i < step ? "bg-plana-orange" : "bg-gray-100")} />
        ))}
      </div>
      
      <div className="w-full max-w-md flex-1 flex flex-col mt-16 pb-24 overflow-y-auto no-scrollbar">
        <AnimatePresence mode="wait">
          
          {/* STEP 1: Objectif */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col justify-center">
              <div className="w-16 h-16 rounded-2xl bg-orange-50 text-plana-orange flex items-center justify-center mb-6">
                <Trophy size={32} />
              </div>
              <h1 className="text-3xl font-black text-plana-black mb-2">Quel est ton objectif principal ?</h1>
              <p className="text-slate-500 mb-8 font-medium">Nous allons optimiser ton plan pour ça.</p>
              
              <div className="space-y-3">
                {['Triathlon', 'Course à pied', 'Cyclisme', 'Natation'].map(s => (
                  <button 
                    key={s} 
                    onClick={() => { setGoalSport(s); setTimeout(handleNext, 300); }}
                    className={cn(
                      "w-full p-4 rounded-2xl border-2 text-left font-bold transition-all",
                      goalSport === s ? "border-plana-orange bg-orange-50 text-plana-orange" : "border-gray-100 hover:border-gray-200 text-plana-black"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* STEP 2: Distance */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col justify-center">
              <h1 className="text-3xl font-black text-plana-black mb-2">Quelle distance ?</h1>
              <p className="text-slate-500 mb-8 font-medium">Pour ajuster le volume nécessaire.</p>
              
              <div className="space-y-3">
                {['Sprint', 'Olympique', 'Half / 70.3', 'Ironman', 'Personnalisé'].map(s => (
                  <button 
                    key={s} 
                    onClick={() => { setGoalDistance(s); setTimeout(handleNext, 300); }}
                    className={cn(
                      "w-full p-4 rounded-2xl border-2 text-left font-bold transition-all",
                      goalDistance === s ? "border-plana-orange bg-orange-50 text-plana-orange" : "border-gray-100 hover:border-gray-200 text-plana-black"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* STEP 3: Course cible */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col justify-center">
              <div className="w-16 h-16 rounded-2xl bg-orange-50 text-plana-orange flex items-center justify-center mb-6">
                <Calendar size={32} />
              </div>
              <h1 className="text-3xl font-black text-plana-black mb-2">Ta course cible</h1>
              <p className="text-slate-500 mb-8 font-medium">Quand a-t-elle lieu ?</p>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Nom de la course</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Ironman de Nice"
                    value={goalName || ''}
                    onChange={e => setGoalName(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 font-bold text-plana-black focus:outline-none focus:border-plana-orange focus:bg-white transition-all"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Date</label>
                  <input 
                    type="date" 
                    value={goalDate || ''}
                    onChange={e => setGoalDate(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 font-bold text-plana-black focus:outline-none focus:border-plana-orange focus:bg-white transition-all"
                  />
                </div>
              </div>
              
              <button 
                onClick={handleNext} 
                disabled={!goalName || !goalDate}
                className="mt-8 w-full py-4 rounded-2xl bg-plana-black disabled:bg-gray-200 text-white font-bold tracking-wide flex items-center justify-center gap-2 transition-all"
              >
                Continuer <ArrowRight size={18} />
              </button>
              <button onClick={handleNext} className="mt-4 text-sm font-bold text-slate-400 hover:text-slate-600">
                Passer cette étape (pas de course prévue)
              </button>
            </motion.div>
          )}

          {/* STEP 4: Niveau */}
          {step === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col justify-center">
              <div className="w-16 h-16 rounded-2xl bg-orange-50 text-plana-orange flex items-center justify-center mb-6">
                <Activity size={32} />
              </div>
              <h1 className="text-3xl font-black text-plana-black mb-2">Ton niveau actuel</h1>
              <p className="text-slate-500 mb-8 font-medium">Pour calibrer les séances intelligemment.</p>
              
              <div className="space-y-6">
                {['Natation', 'Vélo', 'Course'].map(sport => (
                  <div key={sport}>
                    <label className="text-xs font-bold text-plana-black uppercase tracking-wider mb-2 block">{sport}</label>
                    <div className="flex gap-2">
                       {['Débutant', 'Intermédiaire', 'Avancé'].map(lvl => {
                         const isSelected = levels[sport] === lvl;
                         return (
                           <button 
                             key={lvl} 
                             onClick={() => setLevels(prev => ({ ...prev, [sport]: lvl }))}
                             className={cn(
                               "flex-1 py-2 text-xs font-bold border rounded-xl transition-all",
                               isSelected 
                                 ? "border-plana-orange bg-orange-50 text-plana-orange shadow-sm" 
                                 : "border-gray-100 hover:border-plana-orange text-plana-black"
                             )}
                           >
                             {lvl}
                           </button>
                         );
                       })}
                    </div>
                  </div>
                ))}
              </div>
              
              <button 
                onClick={handleNext} 
                disabled={!isLevelsComplete}
                className="mt-8 w-full py-4 rounded-2xl bg-plana-black disabled:bg-gray-200 text-white font-bold tracking-wide flex items-center justify-center gap-2 transition-all"
              >
                Continuer <ArrowRight size={18} />
              </button>
            </motion.div>
          )}

          {/* STEP 5: Temps par semaine */}
          {step === 5 && (
            <motion.div key="step5" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col justify-center">
              <div className="w-16 h-16 rounded-2xl bg-orange-50 text-plana-orange flex items-center justify-center mb-6">
                <Zap size={32} />
              </div>
              <h1 className="text-3xl font-black text-plana-black mb-2">Combien de temps ?</h1>
              <p className="text-slate-500 mb-8 font-medium">Temps disponible par semaine.</p>
              
              <div className="grid grid-cols-2 gap-3">
                {['4 h', '6 h', '8 h', '10 h', '12 h+', 'Personnalisé'].map(t => (
                  <button 
                    key={t} 
                    onClick={() => { setWeeklyHours(t); setTimeout(handleNext, 300); }}
                    className={cn(
                      "p-4 rounded-2xl border-2 text-center font-bold transition-all",
                      weeklyHours === t ? "border-plana-orange bg-orange-50 text-plana-orange" : "border-gray-100 text-plana-black hover:border-plana-orange"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* STEP 6: Jours disponibles */}
          {step === 6 && (
            <motion.div key="step6" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col justify-center">
              <div className="w-16 h-16 rounded-2xl bg-orange-50 text-plana-orange flex items-center justify-center mb-6">
                <Calendar size={32} />
              </div>
              <h1 className="text-3xl font-black text-plana-black mb-2">Quand peux-tu t'entraîner ?</h1>
              <p className="text-slate-500 mb-6 font-medium">Sélectionne tes jours disponibles.</p>
              
              <div className="space-y-2">
                {DAYS_OF_WEEK.map(day => {
                  const isSelected = availableDays.includes(day);
                  return (
                    <button
                       key={day}
                       onClick={() => setAvailableDays(prev => isSelected ? prev.filter(d => d !== day) : [...prev, day])}
                       className={cn(
                         "w-full p-4 rounded-2xl border-2 flex justify-between items-center font-bold transition-all", 
                         isSelected ? "border-plana-orange bg-orange-50 text-plana-orange" : "border-gray-100 hover:border-gray-200 text-plana-black"
                       )}
                    >
                       <span>{day}</span>
                       {isSelected ? <Check size={20} /> : <span className="text-gray-300">—</span>}
                    </button>
                  );
                })}
              </div>

              {showWarning && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium flex gap-3 items-start">
                  <AlertCircle size={20} className="shrink-0 mt-0.5 text-amber-500" />
                  <p>Avec {availableDays.length} {availableDays.length === 1 ? 'jour disponible' : 'jours disponibles'}, {weeklyHours} d'entraînement hebdomadaire risque d'être difficile à répartir. (Pense à activer tes jours de récupération active)</p>
                </motion.div>
              )}

              <button 
                 onClick={handleNext} 
                 disabled={availableDays.length === 0}
                 className="mt-8 w-full py-4 rounded-2xl bg-plana-black disabled:bg-gray-200 text-white font-bold tracking-wide flex items-center justify-center gap-2 transition-all"
              >
                Continuer <ArrowRight size={18} />
              </button>
            </motion.div>
          )}

          {/* STEP 7: Connecte tes données */}
          {step === 7 && (
            <motion.div key="step7" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col justify-center">
              <div className="w-16 h-16 rounded-2xl bg-green-50 text-green-500 flex items-center justify-center mb-6">
                <Watch size={32} />
              </div>
              <h1 className="text-3xl font-black text-plana-black mb-2">Connecte tes données</h1>
              <p className="text-slate-500 mb-8 font-medium">Plana s'adapte à ce que tu fais réellement grâce à tes applications de santé.</p>
              
              <div className="space-y-3">
                 <button onClick={() => { setHealthConnection('apple_health'); setTimeout(handleNext, 300); }} className={cn("w-full p-4 rounded-2xl border flex items-center gap-4 transition-all shadow-sm", healthConnection === 'apple_health' ? "border-plana-orange bg-orange-50" : "border-gray-100 hover:border-plana-orange bg-white")}>
                   <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center text-gray-500 font-bold"></div>
                   <div className="text-left flex-1">
                     <div className="font-bold text-plana-black">Apple Health</div>
                     <div className="text-xs text-slate-500 font-medium">Recommandé sur iOS</div>
                   </div>
                 </button>
                 
                 <button onClick={() => { setHealthConnection('google_health_connect'); setTimeout(handleNext, 300); }} className={cn("w-full p-4 rounded-2xl border flex items-center gap-4 transition-all shadow-sm", healthConnection === 'google_health_connect' ? "border-plana-orange bg-orange-50" : "border-gray-100 hover:border-plana-orange bg-white")}>
                   <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center text-gray-500 font-bold">G</div>
                   <div className="text-left flex-1">
                     <div className="font-bold text-plana-black">Google Health Connect</div>
                     <div className="text-xs text-slate-500 font-medium">Recommandé sur Android</div>
                   </div>
                 </button>
              </div>
              
              <button onClick={handleNext} className="mt-6 text-sm font-bold text-slate-400 hover:text-slate-600">
                Passer cette étape pour l'instant
              </button>
            </motion.div>
          )}

          {/* STEP 8: Résumé */}
          {step === 8 && (
            <motion.div key="step8" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col pt-4">
              <h1 className="text-3xl font-black text-plana-black mb-8 text-center">Ton profil</h1>
              
              <div className="space-y-6">
                
                {/* Objectif & Course */}
                <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm relative">
                  <button onClick={() => setStep(1)} className="absolute top-4 right-4 p-2 text-gray-400 hover:text-plana-orange transition-colors"><Edit2 size={16} /></button>
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">Objectif</h3>
                  <div className="font-bold text-plana-black">{goalSport} • {goalDistance}</div>
                  {goalName && goalDate && (
                    <div className="mt-2 text-sm text-slate-500 font-medium">
                      <span className="text-plana-black font-bold">{goalName}</span> — {goalDate}
                    </div>
                  )}
                </div>

                {/* Niveau */}
                <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm relative">
                  <button onClick={() => setStep(4)} className="absolute top-4 right-4 p-2 text-gray-400 hover:text-plana-orange transition-colors"><Edit2 size={16} /></button>
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">Niveau</h3>
                  <ul className="space-y-3 text-sm font-bold text-plana-black">
                    <li className="flex items-center gap-3"><span className="text-blue-500 text-lg">🏊</span> Natation <span className="ml-auto text-slate-500 font-medium">{levels.Natation}</span></li>
                    <li className="flex items-center gap-3"><span className="text-emerald-500 text-lg">🚴</span> Cyclisme <span className="ml-auto text-slate-500 font-medium">{levels.Vélo}</span></li>
                    <li className="flex items-center gap-3"><span className="text-plana-orange text-lg">🏃</span> Course <span className="ml-auto text-slate-500 font-medium">{levels.Course}</span></li>
                  </ul>
                </div>

                {/* Disponibilité */}
                <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm relative">
                  <button onClick={() => setStep(5)} className="absolute top-4 right-4 p-2 text-gray-400 hover:text-plana-orange transition-colors"><Edit2 size={16} /></button>
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">Disponibilité</h3>
                  <div className="font-bold text-plana-black mb-2">{weeklyHours} / semaine</div>
                  <div className="text-sm font-medium text-slate-500 leading-relaxed">
                    Jours : {DAYS_OF_WEEK.map(d => availableDays.includes(d) ? d : null).filter(Boolean).join(' · ')}
                  </div>
                </div>

              </div>

              {!canSubmit && (
                <div className="mt-6 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium text-center">
                  Certaines informations obligatoires sont manquantes. Vérifie tes niveaux et jours disponibles.
                </div>
              )}

              <button 
                 onClick={handleNext} 
                 disabled={!canSubmit}
                 className="mt-8 mb-6 w-full py-4 rounded-2xl bg-plana-black disabled:bg-gray-200 text-white font-bold tracking-wide flex items-center justify-center gap-2 transition-all shadow-xl shadow-black/10 active:scale-95"
              >
                Commencer mon plan <ArrowRight size={18} />
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
