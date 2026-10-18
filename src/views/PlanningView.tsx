import { ChevronLeft, ChevronRight, List, Grid } from 'lucide-react';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAppStore } from '../store';
import { TrainingBlock } from '../types';
import { PlannedWorkout } from '../domain/models';
import { format, addDays, startOfWeek, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isSameMonth, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Target, CheckCircle2, Activity as ActivityIcon, Plus, X, Flame, 
  Calendar as CalendarIcon, Bike, Footprints, Waves, Dumbbell, MapPin, 
  Clock, Gauge, ArrowRight, Trash2, Heart, Zap, RefreshCw 
} from 'lucide-react';
import { cn } from '../utils';
import { calculateNP } from '../lib/trainingEngine';
import { EventsListModal, EventForm } from '../components/EventModals';
import { EventGoal } from '../types';

const TEMPLATES = [
  { id: 't1', title: 'Endurance Fondamentale', sport: 'Ride', duration: 120, tss: 90, if: 0.70, desc: 'Sortie longue en zone 2.' },
  { id: 't2', title: 'PMA 30/30', sport: 'Ride', duration: 60, tss: 65, if: 0.85, desc: 'Échauffement puis 2 blocs de 10x 30" Z5 / 30" Z1.' },
  { id: 't3', title: 'Seuil (Sweet Spot)', sport: 'Ride', duration: 90, tss: 110, if: 0.88, desc: '3 blocs de 15 min à 90% FTP.' },
  { id: 't4', title: 'Footing Récupération', sport: 'Run', duration: 45, tss: 40, if: 0.65, desc: 'Course très souple pour oxygéner.' },
];

export default function PlanningView() {
  const { plannedWorkouts, actualWorkouts, addPlannedWorkout: addPlannedWorkout, updatePlannedWorkout: updatePlannedWorkout, removePlannedWorkout: removePlannedWorkout, ftp, events, addEvent, updateEvent, removeEvent } = useAppStore();
  
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarMode, setCalendarMode] = useState<'week' | 'month'>('week');
  const [viewMode, setViewMode] = useState<'calendar' | 'bilan'>('calendar');
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEventsModal, setShowEventsModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventGoal | null | 'new'>(null);
  
  // Add/Edit Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [npStr, setNpStr] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ setComments] = useState('');
  const [sport, setSport] = useState<PlannedWorkout['sport']>('Ride');
  const [timeOfDay, setTimeOfDay] = useState<'morning' | 'afternoon' | 'evening'>('morning');
  const [date, setDate] = useState(format(selectedDate, 'yyyy-MM-dd'));
  const [completed, setCompleted] = useState(false);
  
  // Calc fields
  const [durH, setDurH] = useState('');
  const [durM, setDurM] = useState('');
  const [durS, setDurS] = useState('');
  const [distanceStr, setDistanceStr] = useState('');
  const [speedStr, setSpeedStr] = useState('');
  const [tss, setTss] = useState('');
  const [intensityFactor, setIntensityFactor] = useState('');
  
  const [blocks, setBlocks] = useState<TrainingBlock[]>([]);
  const [activeBlockEdit, setActiveBlockEdit] = useState<{ id: string, metric: keyof TrainingBlock } | null>(null);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const addBlock = () => setBlocks(prev => [...prev, { id: crypto.randomUUID(), type: 'work' }]);
  const updateBlock = (id: string, field: keyof TrainingBlock, value: any) => setBlocks(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b));
  const removeBlock = (id: string) => {
    setBlocks(prev => prev.filter(b => b.id !== id));
    if (activeBlockEdit?.id === id) setActiveBlockEdit(null);
  };

  const formatBlockRange = (min?: string, max?: string) => {
    if (min && max) return `${min}-${max}`;
    if (min) return min;
    if (max) return max;
    return '-';
  };

  const PRESET_BLOCKS = [
    { id: 'pb1', label: 'Échauffement', duration: '15', targetPowerMin: '50%', targetPowerMax: '65%', targetHrMin: '60%', targetHrMax: '70%' },
    { id: 'pb2', label: 'Z2 Endurance', duration: '30', targetPowerMin: '65%', targetPowerMax: '75%', targetHrMin: '70%', targetHrMax: '80%' },
    { id: 'pb3', label: 'PMA', duration: '5', targetPowerMin: '110%', targetPowerMax: '120%', targetHrMin: '90%', targetHrMax: '95%' },
    { id: 'pb4', label: 'Récup', duration: '10', targetPowerMin: '40%', targetPowerMax: '55%', targetHrMin: '50%', targetHrMax: '60%' }
  ];

  const calendarWeeks = useMemo(() => {
    const today = new Date();
    const currentWeekStart = startOfWeek(today, { weekStartsOn: 1 });
    const weeks = [];
    for (let w = -1; w <= 2; w++) {
      const wStart = addDays(currentWeekStart, w * 7);
      const days = [];
      for (let i = 0; i < 7; i++) {
        days.push(addDays(wStart, i));
      }
      weeks.push(days);
    }
    return weeks;
  }, []);

  const monthDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
    const endDate = addDays(startOfWeek(monthEnd, { weekStartsOn: 1 }), 6);
    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [currentMonth]);

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));


  useEffect(() => {
    if (scrollContainerRef.current) {
      const selectedIndex = calendarWeeks.findIndex(w => w.some(d => isSameDay(d, selectedDate)));
      if (selectedIndex !== -1) {
        scrollContainerRef.current.scrollTo({
          left: selectedIndex * scrollContainerRef.current.clientWidth,
          behavior: 'smooth'
        });
      }
    }
  }, [calendarWeeks, selectedDate]);

  const selectedActivities = useMemo(() => {
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    return plannedWorkouts.filter(a => a.date === dateStr);
  }, [plannedWorkouts, selectedDate]);

  const handleApplyTemplate = (tid: string) => {
    const t = TEMPLATES.find(x => x.id === tid);
    if (!t) return;
    setTitle(t.title);
    setSport(t.sport as any);
    setDescription(t.desc);
    
    const h = Math.floor(t.duration / 60);
    const m = Math.floor(t.duration % 60);
    setDurH(h > 0 ? h.toString() : '');
    setDurM(m > 0 || h > 0 ? m.toString() : '');
    setDurS('');
    
    setTss(t.tss.toString());
    setIntensityFactor(t.if.toString());
    setDistanceStr('');
    setSpeedStr('');
  };



  const getTotalMinutes = () => {
    const h = parseInt(durH) || 0;
    const m = parseInt(durM) || 0;
    const s = parseInt(durS) || 0;
    return h * 60 + m + s / 60;
  };

  useEffect(() => {
    const np = parseFloat(npStr);
    const totalMins = getTotalMinutes();
    
    if (!isNaN(np) && ftp > 0 && totalMins > 0) {
      const IF = np / ftp;
      const durationSeconds = totalMins * 60;
      const calcTss = (durationSeconds * np * IF) / (ftp * 3600) * 100;
      setIntensityFactor(IF.toFixed(2));
      setTss(Math.round(calcTss).toString());
    }
  }, [npStr, ftp, durH, durM, durS]);

  const updateDurationFromHours = (hours: number) => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    setDurH(h > 0 ? h.toString() : '');
    setDurM(m > 0 || h > 0 ? m.toString() : '');
  };

  const handleDistanceChange = (val: string) => {
    setDistanceStr(val);
    const d = parseFloat(val);
    const totalMins = getTotalMinutes();
    if (!isNaN(d) && totalMins > 0) {
      setSpeedStr((d / (totalMins / 60)).toFixed(1));
    } else if (!isNaN(d) && speedStr !== '') {
      const s = parseFloat(speedStr);
      if (s > 0) updateDurationFromHours(d / s);
    }
  };

  const handleSpeedChange = (val: string) => {
    setSpeedStr(val);
    const s = parseFloat(val);
    const d = parseFloat(distanceStr);
    if (!isNaN(s) && s > 0 && !isNaN(d)) {
      updateDurationFromHours(d / s);
    } else if (!isNaN(s) && s > 0 && distanceStr === '' && getTotalMinutes() > 0) {
      setDistanceStr((s * (getTotalMinutes() / 60)).toFixed(1));
    }
  };

  const handleDurationChange = (h: string, m: string, s_str: string) => {
    setDurH(h); setDurM(m); setDurS(s_str);
    const h_val = parseInt(h) || 0;
    const m_val = parseInt(m) || 0;
    const s_val = parseInt(s_str) || 0;
    const totalMins = h_val * 60 + m_val + s_val / 60;
    const d = parseFloat(distanceStr);
    if (totalMins > 0 && !isNaN(d)) {
      setSpeedStr((d / (totalMins / 60)).toFixed(1));
    } else if (totalMins > 0 && distanceStr === '' && speedStr !== '') {
      const s = parseFloat(speedStr);
      if (s > 0) setDistanceStr((s * (totalMins / 60)).toFixed(1));
    }
  };

  const handleEditClick = (act: PlannedWorkout) => {
    setEditingId(act.id);
    setTitle(act.title);
    setDescription(act.description || '');
    
    setSport(act.sport || 'Ride');
    
    setDate(act.date);
    setCompleted((act.status === 'completed') || false);
    
    if (act.targetDurationMin) {
      const h = Math.floor(act.targetDurationMin / 60);
      const m = Math.floor(act.targetDurationMin % 60);
      setDurH(h > 0 ? h.toString() : '');
      setDurM(m > 0 || h > 0 ? m.toString() : '');
      setDurS('');
    } else {
      setDurH(''); setDurM(''); setDurS('');
    }
    
    
    
    
    
    
    
    
    setShowAddModal(true);
  };

    const handleAddPlannedWorkout = (e: React.FormEvent) => {
    e.preventDefault();
    const totalMinutes = getTotalMinutes();
    const newPlannedWorkout: PlannedWorkout = {
      id: editingId || `act-${Date.now()}`,
      title: title.trim() || (sport === 'Ride' ? 'Cyclisme' : sport === 'Run' ? 'Course à pied' : sport === 'Swim' ? 'Natation' : sport === 'Strength' ? 'Renforcement' : 'Entraînement'),
      date,
      description,
      sport,
      targetDurationMin: totalMinutes > 0 ? totalMinutes : 60,
      targetIntensity: { type: 'zone', value: 'Z2' },
      targetTss: parseFloat(tss) || undefined,
      status: 'planned'
    };

    if (editingId) {
      updatePlannedWorkout(newPlannedWorkout);
    } else {
      addPlannedWorkout(newPlannedWorkout);
    }
    setShowAddModal(false);
  };

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setNpStr('');
    setDescription('');
    setComments('');
    setDurH('');
    setDurM('');
    setDurS('');
    setDistanceStr('');
    setSpeedStr('');
    setTss('');
    setIntensityFactor('');
    setCompleted(false);
    setBlocks([]);
  };

  const getTypeIcon = (t?: string, size = 18) => {
    switch(t) {
      case 'Ride': return <Bike size={size} />;
      case 'Run': return <Footprints size={size} />;
      case 'Swim': return <Waves size={size} />;
      case 'Strength': return <Dumbbell size={size} />;
      default: return <ActivityIcon size={size} />;
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="p-4 flex flex-col relative h-[calc(100vh-64px)] pb-16"
    >
      
            {/* Header */}
      <div className="flex justify-between items-center mb-4 z-10 shrink-0">
        <h2 className="text-2xl font-black text-plana-black tracking-wide">Planning</h2>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowEventsModal(true)}
            className="px-3 py-2 h-10 rounded-2xl bg-white border border-gray-200 text-slate-600 font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5 shadow-sm hover:bg-gray-50 transition-colors"
          >
            <Target size={14} /> Objectifs
          </button>
          <button 
            onClick={() => { resetForm(); setDate(format(selectedDate, 'yyyy-MM-dd')); setShowAddModal(true); }}
            className="w-10 h-10 rounded-2xl bg-plana-orange hover:bg-[#FF7A00] text-plana-black flex items-center justify-center transition-all shadow-md active:scale-95"
          >
            <Plus size={20} strokeWidth={3} />
          </button>
        </div>
      </div>
      
      {/* View Toggle */}
      <div className="flex bg-gray-100 p-1 rounded-2xl mb-6 shrink-0 w-full">
         <button onClick={() => setViewMode('calendar')} className={cn("flex-1 py-2.5 text-xs font-bold rounded-xl transition-all", viewMode === 'calendar' ? "bg-white shadow-sm text-plana-black" : "text-slate-500 hover:text-plana-black")}>Calendrier</button>
         <button onClick={() => setViewMode('bilan')} className={cn("flex-1 py-2.5 text-xs font-bold rounded-xl transition-all", viewMode === 'bilan' ? "bg-white shadow-sm text-plana-black" : "text-slate-500 hover:text-plana-black")}>Plan vs Réalité</button>
      </div>

      {viewMode === 'calendar' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col min-h-0 overflow-hidden">
                {/* Calendar Toggle & View */}
      <div className="bg-plana-white border border-gray-100 rounded-3xl p-3 mb-6 shrink-0 shadow-sm flex flex-col gap-3">
        <div className="flex justify-between items-center px-1">
           {calendarMode === 'month' ? (
             <div className="flex items-center gap-2">
               <button onClick={handlePrevMonth} className="p-1 hover:bg-gray-100 rounded-lg text-slate-600"><ChevronLeft size={16}/></button>
               <span className="text-sm font-bold capitalize text-plana-black">{format(currentMonth, 'MMMM yyyy', { locale: fr })}</span>
               <button onClick={handleNextMonth} className="p-1 hover:bg-gray-100 rounded-lg text-slate-600"><ChevronRight size={16}/></button>
             </div>
           ) : (
             <span className="text-sm font-bold text-plana-black px-1">Cette Semaine</span>
           )}
           <div className="flex bg-gray-100 rounded-xl p-1">
             <button onClick={() => setCalendarMode('week')} className={cn("p-1.5 rounded-lg transition-colors flex items-center justify-center", calendarMode === 'week' ? "bg-white shadow-sm text-plana-black" : "text-gray-400")}><List size={14}/></button>
             <button onClick={() => setCalendarMode('month')} className={cn("p-1.5 rounded-lg transition-colors flex items-center justify-center", calendarMode === 'month' ? "bg-white shadow-sm text-plana-black" : "text-gray-400")}><Grid size={14}/></button>
           </div>
        </div>

        {calendarMode === 'week' ? (
          <div 
            ref={scrollContainerRef}
            className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory w-full"
          >
            {calendarWeeks.map((week, wIdx) => (
              <div key={wIdx} className="snap-center shrink-0 w-full flex justify-between px-1 gap-1">
                {week.map((d, i) => {
                  const isSelected = isSameDay(d, selectedDate);
                  const isToday = isSameDay(d, new Date());
                  const dayActs = plannedWorkouts.filter(a => a.date === format(d, 'yyyy-MM-dd'));
                  
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDate(d)}
                      className={cn(
                        "flex-1 flex flex-col items-center py-2 rounded-2xl transition-all border",
                        isSelected 
                          ? "bg-plana-black border-plana-black shadow-md scale-105" 
                          : isToday 
                          ? "bg-gray-50 border-gray-100"
                          : "bg-transparent border-transparent hover:bg-gray-50"
                      )}
                    >
                      <span className={cn(
                        "text-[9px] uppercase font-bold tracking-wider", 
                        isSelected ? 'text-gray-300' : 'text-slate-500'
                      )}>
                        {format(d, 'EEE', { locale: fr })}
                      </span>
                      <span className={cn(
                        "text-lg font-black mt-0.5", 
                        isSelected ? 'text-white' : 'text-plana-black'
                      )}>
                        {format(d, 'd')}
                      </span>
                      
                      <div className="mt-1 h-2 flex gap-0.5">
                        {dayActs.length > 0 ? (
                          dayActs.slice(0, 3).map((act, idx) => (
                            <div 
                              key={idx} 
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                (act.status === 'completed') ? 'bg-plana-green' : 'bg-plana-orange'
                              )} 
                            />
                          ))
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-transparent" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="w-full px-1">
             <div className="grid grid-cols-7 gap-1 mb-2">
               {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(day => <div key={day} className="text-center text-[9px] font-bold uppercase tracking-wider text-slate-400">{day}</div>)}
             </div>
             <div className="grid grid-cols-7 gap-1">
               {monthDays.map((d, i) => {
                 const isSelected = isSameDay(d, selectedDate);
                 const isToday = isSameDay(d, new Date());
                 const isCurrentMonth = isSameMonth(d, currentMonth);
                 const dayActs = plannedWorkouts.filter(a => a.date === format(d, 'yyyy-MM-dd'));
                 
                 return (
                   <button
                     key={i}
                     onClick={() => setSelectedDate(d)}
                     className={cn(
                       "aspect-square flex flex-col items-center justify-center rounded-xl transition-all border",
                       !isCurrentMonth ? "opacity-30" : "opacity-100",
                       isSelected 
                          ? "bg-plana-black border-plana-black shadow-md scale-105" 
                          : isToday 
                          ? "bg-gray-50 border-gray-100"
                          : "bg-transparent border-transparent hover:bg-gray-50"
                     )}
                   >
                     <span className={cn(
                        "text-xs font-black", 
                        isSelected ? 'text-white' : 'text-plana-black'
                      )}>
                        {format(d, 'd')}
                      </span>
                      <div className="mt-0.5 h-1.5 flex gap-0.5 flex-wrap justify-center overflow-hidden max-w-[20px]">
                        {dayActs.length > 0 ? (
                          dayActs.slice(0, 4).map((act, idx) => (
                            <div 
                              key={idx} 
                              className={cn(
                                "w-1 h-1 rounded-full",
                                (act.status === 'completed') ? 'bg-plana-green' : 'bg-plana-orange'
                              )} 
                            />
                          ))
                        ) : (
                          <div className="w-1 h-1 rounded-full bg-transparent" />
                        )}
                      </div>
                   </button>
                 );
               })}
             </div>
          </div>
        )}
      </div>

      {/* Selected Day Activities List */}
      <div className="flex-1 overflow-y-auto space-y-4 no-scrollbar pb-8">
        <div className="flex items-center gap-2 mb-2">
          <CalendarIcon size={16} className="text-slate-500" />
          <h3 className="text-sm font-bold text-plana-black capitalize">
            {format(selectedDate, 'EEEE d MMMM yyyy', { locale: fr })}
          </h3>
        </div>

        {selectedActivities.length === 0 ? (
          <div className="bg-gray-50 rounded-3xl border border-gray-200 border-dashed p-8 text-center flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <CalendarIcon className="text-gray-400 w-6 h-6" />
            </div>
            <p className="text-gray-600 font-bold text-sm">Aucun entraînement</p>
            <p className="text-gray-500 text-xs mt-1">Profitez d'un jour de repos ou planifiez une séance.</p>
          </div>
        ) : (
          selectedActivities.map(activity => (
            <div 
              key={activity.id} 
              className={cn(
                "p-5 rounded-3xl flex flex-col gap-3 shadow-sm transition-colors border relative overflow-hidden group cursor-pointer",
                activity.completed 
                  ? "bg-gray-50 border-gray-100 hover:border-plana-green/40" 
                  : "bg-plana-white border-plana-orange/20 hover:border-plana-orange/40"
              )}
              onClick={() => handleEditClick(activity)}
            >
              <button 
                onClick={(e) => { e.stopPropagation(); removePlannedWorkout(activity.id); }}
                className="absolute top-4 right-4 text-gray-300 hover:text-red-500 transition-colors z-10"
              >
                <Trash2 size={16} />
              </button>

              <div className="flex justify-between items-start pr-8">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                    activity.completed ? 'bg-gray-100 text-plana-green' : 'bg-orange-50 text-plana-orange'
                  )}>
                    {getTypeIcon(activity.sport, 24)}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-plana-black">
                      {activity.title}
                      {activity.status === 'adapted' && <span className="ml-2 text-[9px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">Adapté</span>}
                      {activity.status === 'missed' && <span className="ml-2 text-[9px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">Manqué</span>}
                    </h3>
                    <p className="text-xs text-slate-500 font-medium mt-0.5 flex items-center gap-1">
                      {activity.status === 'completed' ? 'Terminé' : activity.status === 'missed' ? 'Manqué' : 'Prévu'}
                      {activity.timeOfDay && ` • ${activity.timeOfDay === 'morning' ? 'Matin' : activity.timeOfDay === 'afternoon' ? 'Après-midi' : 'Soir'}`}
                    </p>
                  </div>
                </div>
              </div>

              {activity.explanation && activity.status === 'adapted' && (
                <p className="text-xs text-amber-700 bg-amber-100/50 p-2.5 rounded-xl border border-amber-200 font-medium">
                  {activity.explanation}
                </p>
              )}
              {activity.description && (
                <p className="text-xs text-slate-600 bg-gray-50/50 p-2.5 rounded-xl border border-gray-100">
                  {activity.description}
                </p>
              )}
              
              <div className="grid grid-cols-4 gap-2 pt-3 border-t border-gray-100 text-xs">
                {activity.normalizedPower ? (
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">NP</span>
                    <span className="text-sm text-plana-black font-bold">{activity.normalizedPower} <span className="text-[10px] font-medium text-slate-500">W</span></span>
                  </div>
                ) : activity.distanceKm ? (
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Dist.</span>
                    <span className="text-sm text-plana-black font-bold">{activity.distanceKm} <span className="text-[10px] font-medium text-slate-500">km</span></span>
                  </div>
                ) : activity.intensityFactor ? (
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">IF</span>
                    <span className="text-sm text-plana-black font-bold">{activity.intensityFactor.toFixed(2)}</span>
                  </div>
                ) : <div />}

                {activity.intensityFactor && activity.normalizedPower ? (
                  <div className="flex flex-col border-x border-gray-100 px-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">IF</span>
                    <span className="text-sm text-plana-black font-bold">{activity.intensityFactor.toFixed(2)}</span>
                  </div>
                ) : <div className="border-x border-gray-100" />}

                {activity.targetDurationMin ? (
                  <div className="flex flex-col text-center border-r border-gray-100 px-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Durée</span>
                    <span className="text-sm text-plana-black font-bold">{Math.floor(activity.targetDurationMin / 60)}h{String(Math.round(activity.targetDurationMin % 60)).padStart(2, '0')}</span>
                  </div>
                ) : <div className="border-r border-gray-100" />}
                 
                 <div className="flex flex-col text-right">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Charge</span>
                    <span className="text-sm text-plana-black font-bold">{activity.tss || 0} <span className="text-[10px] font-medium text-slate-500">TSS</span></span>
                 </div>
              </div>
              
              {/* TARGETS AND BLOCKS DISPLAY */}
              {(activity.targetPower || activity.targetHr || (activity.blocks && activity.blocks.length > 0)) && (
                <div className="mt-1 pt-3 border-t border-gray-100">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {activity.targetPower && (
                      <span className="text-[10px] bg-gray-50 text-slate-700 px-2.5 py-1 rounded-md flex items-center gap-1 font-semibold border border-gray-200">
                        <Zap size={12} className="text-plana-orange"/> {activity.targetPower} W
                      </span>
                    )}
                    {activity.targetHr && (
                      <span className="text-[10px] bg-gray-50 text-slate-700 px-2.5 py-1 rounded-md flex items-center gap-1 font-semibold border border-gray-200">
                        <Heart size={12} className="text-red-500"/> {activity.targetHr} bpm
                      </span>
                    )}
                  </div>
                  {activity.blocks && activity.blocks.length > 0 && (
                    <div className="flex flex-col gap-1.5 mt-2">
                      {activity.blocks.map(b => (
                        <div key={b.id} className="text-[10px] flex items-center gap-2 bg-gray-50 px-2.5 py-2 rounded-lg border border-gray-100">
                           <span className={cn(
                             "font-bold w-12",
                             b.type === 'rest' ? 'text-slate-500' : 'text-plana-orange'
                           )}>
                             {b.duration ? `${b.duration}m` : (b.distance ? `${b.distance}km` : '-')}
                           </span>
                           <span className="text-slate-600 flex-1 truncate font-medium">
                             {b.targetPowerMin ? `${b.targetPowerMin}-${b.targetPowerMax || ''} W` : ''}
                             {b.targetPowerMin && b.targetHrMin ? ' • ' : ''}
                             {b.targetHrMin ? `${b.targetHrMin}-${b.targetHrMax || ''} bpm` : ''}
                           </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* FULL PAGE ADD WORKOUT MODAL */}

        </motion.div>
      )}

            {viewMode === 'bilan' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 overflow-y-auto no-scrollbar space-y-6 pb-8">
          <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-plana-black mb-4">Volume hebdomadaire</h3>
            
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-gray-100 pb-2">
                <div className="col-span-1">Sport</div>
                <div className="col-span-1 text-center">Prévu</div>
                <div className="col-span-1 text-center">Réel</div>
                <div className="col-span-1 text-right">Delta</div>
              </div>
              
              {(() => {
                const start = format(startOfWeek(currentMonth, { weekStartsOn: 1 }), 'yyyy-MM-dd');
                const end = format(addDays(parseISO(start), 7), 'yyyy-MM-dd');
                
                const plannedThisWeek = plannedWorkouts.filter(w => w.date >= start && w.date < end);
                const actualThisWeek = actualWorkouts.filter(w => w.date >= start && w.date < end);
                
                const sports = ['Swim', 'Ride', 'Run'];
                let totalPlanned = 0;
                let totalActual = 0;

                const formatDur = (mins) => `${Math.floor(mins / 60)}h${String(Math.round(mins % 60)).padStart(2, '0')}`;

                return (
                  <>
                    {sports.map(sport => {
                      const planned = plannedThisWeek.filter(w => w.sport === sport).reduce((acc, w) => acc + (w.targetDurationMin || 0), 0);
                      const actual = actualThisWeek.filter(w => w.sport === sport).reduce((acc, w) => acc + (w.durationMin || 0), 0);
                      totalPlanned += planned;
                      totalActual += actual;
                      const delta = actual - planned;
                      const color = sport === 'Swim' ? 'text-blue-400' : sport === 'Ride' ? 'text-emerald-500' : 'text-plana-orange';
                      const Icon = sport === 'Swim' ? Waves : sport === 'Ride' ? Bike : Footprints;

                      return (
                        <div key={sport} className="grid grid-cols-4 gap-2 text-sm font-medium items-center">
                          <div className="col-span-1 flex items-center gap-2 font-bold text-plana-black"><Icon size={16} className={color}/> {sport === 'Swim' ? 'Natation' : sport === 'Ride' ? 'Vélo' : 'Course'}</div>
                          <div className="col-span-1 text-center text-slate-500">{formatDur(planned)}</div>
                          <div className="col-span-1 text-center font-bold">{formatDur(actual)}</div>
                          <div className={`col-span-1 text-right text-xs ${delta > 0 ? 'text-emerald-500' : delta < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                            {delta > 0 ? '+' : ''}{delta}m
                          </div>
                        </div>
                      );
                    })}
                    <div className="grid grid-cols-4 gap-2 text-sm font-black pt-2 border-t border-gray-100">
                      <div className="col-span-1">Total</div>
                      <div className="col-span-1 text-center text-slate-500">{formatDur(totalPlanned)}</div>
                      <div className="col-span-1 text-center">{formatDur(totalActual)}</div>
                      <div className="col-span-1 text-right text-plana-orange text-xs">
                        {totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0}%
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
          
          <div className="bg-orange-50 border border-plana-orange/20 rounded-3xl p-5">
            <h3 className="text-xs font-bold text-plana-orange uppercase tracking-wider mb-2">Bilan global</h3>
            <p className="text-sm font-medium text-plana-black leading-tight">
              La progression suit le plan, continue !
            </p>
          </div>
        </motion.div>
      )}
      <AnimatePresence>
        {showAddModal && (
          <motion.div 
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute inset-0 z-50 bg-plana-bg flex flex-col"
          >
            <div className="px-5 py-4 flex justify-between items-center border-b border-gray-200 bg-white/80 backdrop-blur-md shrink-0">
              <h3 className="text-lg font-black text-plana-black">{editingId ? 'Modifier l\'Entraînement' : 'Ajouter un Entraînement'}</h3>
              <button 
                type="button"
                onClick={() => setShowAddModal(false)}
                className="w-8 h-8 rounded-full bg-gray-100 text-slate-500 hover:text-plana-black hover:bg-gray-200 flex items-center justify-center transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 pb-24 no-scrollbar">
              <form onSubmit={handleAddPlannedWorkout} className="space-y-6">
                
                {/* Templates */}
                {!editingId && (
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-2">Depuis un modèle</label>
                    <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                      {TEMPLATES.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleApplyTemplate(t.id)}
                          className="shrink-0 bg-white border border-gray-200 px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:border-plana-orange hover:text-plana-orange transition-colors shadow-sm"
                        >
                          {t.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-4 bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
                  {/* Type & Status */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">Sport</label>
                      <div className="flex gap-1.5">
                        <button 
                          type="button" onClick={() => setSport('Ride')}
                          className={cn("flex-1 flex justify-center py-2.5 rounded-xl border transition-all", sport === 'Ride' ? 'bg-orange-50 border-plana-orange text-plana-orange' : 'bg-gray-50 border-gray-100 text-slate-500')}
                        ><Bike size={18} /></button>
                        <button 
                          type="button" onClick={() => setSport('Run')}
                          className={cn("flex-1 flex justify-center py-2.5 rounded-xl border transition-all", sport === 'Run' ? 'bg-green-50 border-plana-green text-plana-green' : 'bg-gray-50 border-gray-100 text-slate-500')}
                        ><Footprints size={18} /></button>
                        <button 
                          type="button" onClick={() => setSport('Swim')}
                          className={cn("flex-1 flex justify-center py-2.5 rounded-xl border transition-all", sport === 'Swim' ? 'bg-blue-50 border-plana-blue text-plana-blue' : 'bg-gray-50 border-gray-100 text-slate-500')}
                        ><Waves size={18} /></button>
                        <button 
                          type="button" onClick={() => setSport('Strength')}
                          className={cn("flex-1 flex justify-center py-2.5 rounded-xl border transition-all", sport === 'Strength' ? 'bg-purple-50 border-plana-purple text-plana-purple' : 'bg-gray-50 border-gray-100 text-slate-500')}
                        ><Dumbbell size={18} /></button>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">Statut</label>
                      <select 
                        value={completed ? 'completed' : 'planned'} onChange={e => setCompleted(e.target.value === 'completed')}
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 text-plana-black text-sm focus:outline-none focus:border-plana-orange appearance-none font-medium"
                      >
                        <option value="planned">Prévu</option>
                        <option value="completed">Terminé</option>
                      </select>
                    </div>
                  </div>

                  {/* Title */}
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">Titre de la séance</label>
                    <input 
                      type="text" placeholder="Titre de la séance"
                      value={title} onChange={e => setTitle(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 text-plana-black text-sm focus:outline-none focus:border-plana-orange"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">Description</label>
                    <textarea 
                      rows={2} placeholder="Consignes, sensations..."
                      value={description} onChange={e => setDescription(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 text-plana-black text-sm focus:outline-none focus:border-plana-orange resize-none"
                    />
                  </div>

                  {/* Date & Time */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">Date</label>
                      <input 
                        type="date" value={date} onChange={e => setDate(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 text-plana-black text-sm focus:outline-none focus:border-plana-orange appearance-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">Moment</label>
                      <select 
                        value={timeOfDay} onChange={e => setTimeOfDay(e.target.value as any)}
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 text-plana-black text-sm focus:outline-none focus:border-plana-orange appearance-none"
                      >
                        <option value="morning">Matin</option>
                        <option value="afternoon">Après-midi</option>
                        <option value="evening">Soir</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
                  <h4 className="text-sm font-bold text-plana-black mb-1">Données Physiques</h4>

                  {/* Duration as H:M:S */}
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">Durée (h:m:s)</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="number" min="0" placeholder="h"
                        value={durH} onChange={e => handleDurationChange(e.target.value, durM, durS)}
                        className="w-1/3 bg-gray-50 border border-gray-100 rounded-xl px-2 py-2.5 text-plana-black text-sm text-center focus:outline-none focus:border-plana-orange"
                      />
                      <span className="text-slate-400 font-bold">:</span>
                      <input 
                        type="number" min="0" max="59" placeholder="m"
                        value={durM} onChange={e => handleDurationChange(durH, e.target.value, durS)}
                        className="w-1/3 bg-gray-50 border border-gray-100 rounded-xl px-2 py-2.5 text-plana-black text-sm text-center focus:outline-none focus:border-plana-orange"
                      />
                      <span className="text-slate-400 font-bold">:</span>
                      <input 
                        type="number" min="0" max="59" placeholder="s"
                        value={durS} onChange={e => handleDurationChange(durH, durM, e.target.value)}
                        className="w-1/3 bg-gray-50 border border-gray-100 rounded-xl px-2 py-2.5 text-plana-black text-sm text-center focus:outline-none focus:border-plana-orange"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">Dist. (km)</label>
                      <div className="relative">
                        <MapPin size={14} className="absolute left-3 top-3 text-slate-400" />
                        <input 
                          type="number" step="0.1" min="0" placeholder="---"
                          value={distanceStr} onChange={e => handleDistanceChange(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-100 rounded-xl pl-9 pr-2 py-2.5 text-plana-black text-sm focus:outline-none focus:border-plana-orange"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">Vit. (km/h)</label>
                      <div className="relative">
                        <Gauge size={14} className="absolute left-3 top-3 text-slate-400" />
                        <input 
                          type="number" step="0.1" min="0" placeholder="---"
                          value={speedStr} onChange={e => handleSpeedChange(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-100 rounded-xl pl-9 pr-2 py-2.5 text-plana-black text-sm focus:outline-none focus:border-plana-orange"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                    <div className="flex flex-col">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">Obj. Puissance</label>
                      <div className="relative flex-1">
                        <Zap size={14} className="absolute left-3 top-3 text-slate-400" />
                        <input 
                          type="text" placeholder="Ex: 220"
                          className="w-full h-full bg-gray-50 border border-gray-100 rounded-xl pl-9 pr-2 py-2.5 text-plana-black text-sm focus:outline-none focus:border-plana-orange"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">Obj. BPM</label>
                      <div className="relative flex-1">
                        <Heart size={14} className="absolute left-3 top-3 text-slate-400" />
                        <input 
                          type="text" placeholder="Ex: 145"
                          className="w-full h-full bg-gray-50 border border-gray-100 rounded-xl pl-9 pr-2 py-2.5 text-plana-black text-sm focus:outline-none focus:border-plana-orange"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                    <div>
                      <label className="text-[10px] uppercase font-bold tracking-wider text-plana-orange block mb-1">Puissance Norm. (W)</label>
                      <div className="flex gap-1 relative">
                        <div className="relative flex-1">
                          <Zap size={14} className="absolute left-3 top-3 text-plana-orange" />
                          <input 
                            type="number" min="0" placeholder="Ex: 220"
                            value={npStr} onChange={e => setNpStr(e.target.value)}
                            className="w-full bg-orange-50/50 border border-orange-100 rounded-xl pl-9 pr-2 py-2.5 text-plana-black text-sm focus:outline-none focus:border-plana-orange"
                          />
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">FTP (W)</label>
                      <div className="relative">
                        <Target size={14} className="absolute left-3 top-3 text-slate-400" />
                        <input 
                          type="number" min="0" placeholder="Ex: 250"
                          value={ftp} disabled
                          className="w-full bg-gray-100 border border-gray-100 rounded-xl pl-9 pr-2 py-2.5 text-slate-500 text-sm focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                    <div>
                      <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">Charge TSS</label>
                      <div className="relative">
                        <Flame size={14} className="absolute left-3 top-3 text-slate-400" />
                        <input 
                          type="number" min="1" placeholder="Auto..."
                          value={tss} onChange={e => setTss(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-100 rounded-xl pl-9 pr-2 py-2.5 text-plana-black text-sm focus:outline-none focus:border-plana-orange font-bold text-plana-orange"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">IF (Intensité)</label>
                      <div className="relative">
                        <Zap size={14} className="absolute left-3 top-3 text-slate-400" />
                        <input 
                          type="number" step="0.01" min="0.1" max="1.5" placeholder="Auto..."
                          value={intensityFactor} onChange={e => setIntensityFactor(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-100 rounded-xl pl-9 pr-2 py-2.5 text-plana-black text-sm focus:outline-none focus:border-plana-orange"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Training Blocks */}
                <div className="space-y-4 bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-plana-black">Blocs d'entraînement</h4>
                    <div className="flex gap-2">
                    <button 
                      type="button" onClick={addBlock}
                      className="text-[10px] text-plana-orange font-semibold bg-orange-50 px-3 py-1.5 rounded-lg hover:bg-orange-100 transition-colors"
                    >
                      + Bloc
                    </button>
                    <button 
                      type="button" onClick={() => setBlocks([...blocks, { id: `b-${Date.now()}`, type: 'rest', duration: '5' }])}
                      className="text-[10px] text-slate-600 font-semibold bg-gray-100 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      + Repos
                    </button>
                  </div>
                  </div>
                  
                  <div className="flex gap-2 overflow-x-auto pb-3 no-scrollbar mb-2 border-b border-gray-100">
                    {PRESET_BLOCKS.map(pb => (
                      <button 
                        key={pb.id} type="button" 
                        onClick={() => {
                          setBlocks(prev => [...prev, {
                            id: crypto.randomUUID(),
                            type: 'work',
                            duration: pb.duration,
                            targetPowerMin: pb.targetPowerMin,
                            targetPowerMax: pb.targetPowerMax,
                            targetHrMin: pb.targetHrMin,
                            targetHrMax: pb.targetHrMax
                          }]);
                        }} 
                        className="shrink-0 text-[10px] bg-white border border-gray-200 px-3 py-1.5 rounded-lg text-slate-600 hover:border-plana-black hover:text-plana-black transition-colors flex items-center gap-1 font-semibold"
                      >
                        <Plus size={12}/> {pb.label}
                      </button>
                    ))}
                  </div>
                  
                  {blocks.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-4">Aucun bloc configuré.</p>
                  ) : (
                    <div className="space-y-3">
                      {blocks.map((block, index) => (
                        <div key={block.id} className={cn("p-3 rounded-xl border relative", block.type === 'rest' ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200 shadow-sm')}>
                          {block.type === 'rest' && <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider absolute -top-2 bg-white px-2 rounded-full shadow-sm left-3 border border-gray-200">Repos</div>}
                          <div className="flex justify-between items-center mb-3 mt-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Bloc {index + 1}</span>
                            <button type="button" onClick={() => removeBlock(block.id)} className="text-red-400 hover:text-red-500 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
                          
                          <div className="grid grid-cols-5 gap-1.5">
                            <div>
                              <label className="text-[9px] text-slate-500 block mb-1 text-center font-semibold">Durée</label>
                              <button type="button" onClick={() => setActiveBlockEdit(activeBlockEdit?.id === block.id && activeBlockEdit?.metric === 'duration' ? null : { id: block.id, metric: 'duration' })} className={cn("w-full border rounded-lg px-1 py-1.5 text-plana-black text-[10px] font-bold truncate focus:outline-none transition-colors", activeBlockEdit?.id === block.id && activeBlockEdit?.metric === 'duration' ? 'bg-orange-50 border-plana-orange text-plana-orange' : 'bg-gray-50 border-gray-100 hover:bg-gray-100')}>
                                {block.duration ? `${block.duration}m` : '-'}
                              </button>
                            </div>
                            <div>
                              <label className="text-[9px] text-slate-500 block mb-1 text-center font-semibold">Dist.</label>
                              <button type="button" onClick={() => setActiveBlockEdit(activeBlockEdit?.id === block.id && activeBlockEdit?.metric === 'distance' ? null : { id: block.id, metric: 'distance' })} className={cn("w-full border rounded-lg px-1 py-1.5 text-plana-black text-[10px] font-bold truncate focus:outline-none transition-colors", activeBlockEdit?.id === block.id && activeBlockEdit?.metric === 'distance' ? 'bg-orange-50 border-plana-orange text-plana-orange' : 'bg-gray-50 border-gray-100 hover:bg-gray-100')}>
                                {block.distance ? `${block.distance}km` : '-'}
                              </button>
                            </div>
                            <div>
                              <label className="text-[9px] text-slate-500 block mb-1 text-center font-semibold">Puis.</label>
                              <button type="button" onClick={() => setActiveBlockEdit(activeBlockEdit?.id === block.id && activeBlockEdit?.metric === 'targetPowerMin' ? null : { id: block.id, metric: 'targetPowerMin' })} className={cn("w-full border rounded-lg px-1 py-1.5 text-plana-black text-[10px] font-bold truncate focus:outline-none transition-colors", activeBlockEdit?.id === block.id && activeBlockEdit?.metric === 'targetPowerMin' ? 'bg-orange-50 border-plana-orange text-plana-orange' : 'bg-gray-50 border-gray-100 hover:bg-gray-100')}>
                                {formatBlockRange(block.targetPowerMin, block.targetPowerMax)}
                              </button>
                            </div>
                            <div>
                              <label className="text-[9px] text-slate-500 block mb-1 text-center font-semibold">FC</label>
                              <button type="button" onClick={() => setActiveBlockEdit(activeBlockEdit?.id === block.id && activeBlockEdit?.metric === 'targetHrMin' ? null : { id: block.id, metric: 'targetHrMin' })} className={cn("w-full border rounded-lg px-1 py-1.5 text-plana-black text-[10px] font-bold truncate focus:outline-none transition-colors", activeBlockEdit?.id === block.id && activeBlockEdit?.metric === 'targetHrMin' ? 'bg-orange-50 border-plana-orange text-plana-orange' : 'bg-gray-50 border-gray-100 hover:bg-gray-100')}>
                                {formatBlockRange(block.targetHrMin, block.targetHrMax)}
                              </button>
                            </div>
                            <div>
                              <label className="text-[9px] text-slate-500 block mb-1 text-center font-semibold">Cad.</label>
                              <button type="button" onClick={() => setActiveBlockEdit(activeBlockEdit?.id === block.id && activeBlockEdit?.metric === 'targetCadenceMin' ? null : { id: block.id, metric: 'targetCadenceMin' })} className={cn("w-full border rounded-lg px-1 py-1.5 text-plana-black text-[10px] font-bold truncate focus:outline-none transition-colors", activeBlockEdit?.id === block.id && activeBlockEdit?.metric === 'targetCadenceMin' ? 'bg-orange-50 border-plana-orange text-plana-orange' : 'bg-gray-50 border-gray-100 hover:bg-gray-100')}>
                                {formatBlockRange(block.targetCadenceMin, block.targetCadenceMax)}
                              </button>
                            </div>
                          </div>

                          {activeBlockEdit?.id === block.id && (
                            <motion.div 
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="mt-3 p-3 bg-white rounded-xl border border-plana-orange/30 overflow-hidden"
                            >
                              {activeBlockEdit.metric === 'duration' && (
                                <div>
                                  <span className="text-[10px] text-plana-orange font-bold mb-2 block uppercase tracking-wider">Durée du bloc (minutes)</span>
                                  <input type="number" placeholder="Ex: 15" value={block.duration || ''} onChange={e => updateBlock(block.id, 'duration', e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-plana-black text-sm focus:outline-none focus:border-plana-orange font-bold" />
                                </div>
                              )}
                              {activeBlockEdit.metric === 'distance' && (
                                <div>
                                  <span className="text-[10px] text-plana-orange font-bold mb-2 block uppercase tracking-wider">Distance du bloc (km)</span>
                                  <input type="number" step="0.1" placeholder="Ex: 5.5" value={block.distance || ''} onChange={e => updateBlock(block.id, 'distance', e.target.value)} className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-plana-black text-sm focus:outline-none focus:border-plana-orange font-bold" />
                                </div>
                              )}
                              {activeBlockEdit.metric === 'targetPowerMin' && (
                                <div>
                                  <span className="text-[10px] text-plana-orange font-bold mb-2 block uppercase tracking-wider">Objectif Puissance (W ou %)</span>
                                  <div className="flex items-center gap-2 w-full">
                                    <input type="text" placeholder="Min" value={block.targetPowerMin || ''} onChange={e => updateBlock(block.id, 'targetPowerMin', e.target.value)} className="w-1/2 bg-gray-50 border border-gray-100 rounded-lg px-2 py-2 text-plana-black text-sm text-center focus:outline-none focus:border-plana-orange font-bold" />
                                    <span className="text-slate-400 text-xs font-bold shrink-0">à</span>
                                    <input type="text" placeholder="Max" value={block.targetPowerMax || ''} onChange={e => updateBlock(block.id, 'targetPowerMax', e.target.value)} className="w-1/2 bg-gray-50 border border-gray-100 rounded-lg px-2 py-2 text-plana-black text-sm text-center focus:outline-none focus:border-plana-orange font-bold" />
                                  </div>
                                </div>
                              )}
                              {activeBlockEdit.metric === 'targetHrMin' && (
                                <div>
                                  <span className="text-[10px] text-plana-orange font-bold mb-2 block uppercase tracking-wider">Objectif FC (bpm ou %)</span>
                                  <div className="flex items-center gap-2 w-full">
                                    <input type="text" placeholder="Min" value={block.targetHrMin || ''} onChange={e => updateBlock(block.id, 'targetHrMin', e.target.value)} className="w-1/2 bg-gray-50 border border-gray-100 rounded-lg px-2 py-2 text-plana-black text-sm text-center focus:outline-none focus:border-plana-orange font-bold" />
                                    <span className="text-slate-400 text-xs font-bold shrink-0">à</span>
                                    <input type="text" placeholder="Max" value={block.targetHrMax || ''} onChange={e => updateBlock(block.id, 'targetHrMax', e.target.value)} className="w-1/2 bg-gray-50 border border-gray-100 rounded-lg px-2 py-2 text-plana-black text-sm text-center focus:outline-none focus:border-plana-orange font-bold" />
                                  </div>
                                </div>
                              )}
                              {activeBlockEdit.metric === 'targetCadenceMin' && (
                                <div>
                                  <span className="text-[10px] text-plana-orange font-bold mb-2 block uppercase tracking-wider">Objectif Cadence (rpm)</span>
                                  <div className="flex items-center gap-2 w-full">
                                    <input type="text" placeholder="Min" value={block.targetCadenceMin || ''} onChange={e => updateBlock(block.id, 'targetCadenceMin', e.target.value)} className="w-1/2 bg-gray-50 border border-gray-100 rounded-lg px-2 py-2 text-plana-black text-sm text-center focus:outline-none focus:border-plana-orange font-bold" />
                                    <span className="text-slate-400 text-xs font-bold shrink-0">à</span>
                                    <input type="text" placeholder="Max" value={block.targetCadenceMax || ''} onChange={e => updateBlock(block.id, 'targetCadenceMax', e.target.value)} className="w-1/2 bg-gray-50 border border-gray-100 rounded-lg px-2 py-2 text-plana-black text-sm text-center focus:outline-none focus:border-plana-orange font-bold" />
                                  </div>
                                </div>
                              )}
                            </motion.div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-4">
                  <button
                    type="submit"
                    className="w-full py-4 rounded-2xl bg-plana-black hover:bg-gray-800 text-white font-bold text-sm tracking-wide flex items-center justify-center gap-2 transition-transform active:scale-[0.98] shadow-lg shadow-black/20"
                  >
                    {editingId ? 'Mettre à jour' : 'Enregistrer la séance'} <ArrowRight size={18} strokeWidth={2.5} />
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Event Modals */}
      <AnimatePresence>
        {showEventsModal && !editingEvent && (
          <EventsListModal 
            events={events}
            todayStr={format(new Date(), 'yyyy-MM-dd')}
            onClose={() => setShowEventsModal(false)}
            onEdit={(ev) => setEditingEvent(ev)}
            onNew={() => setEditingEvent('new')}
          />
        )}
        {editingEvent && (
          <EventForm 
            event={editingEvent}
            onClose={() => {
              setEditingEvent(null);
            }}
            onSave={(ev) => {
              if (editingEvent === 'new') addEvent(ev);
              else updateEvent(ev);
              setEditingEvent(null);
            }}
            onDelete={(id) => {
              removeEvent(id);
              setEditingEvent(null);
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
