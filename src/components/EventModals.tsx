import React, { useState } from 'react';
import { motion } from 'motion/react';
import { EventGoal } from '../types';
import { differenceInDays, parseISO } from 'date-fns';
import { Target, Flag, X, Save, Plus, Bike, Footprints, Waves } from 'lucide-react';

const timeToMin = (t?: string) => {
  if (!t) return 0;
  const parts = t.split(':');
  if (parts.length !== 2) return 0;
  return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
};

const minToTime = (mins: number) => {
  if (mins === 0) return '--:--';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${m.toString().padStart(2, '0')}`;
};

export function EventsListModal({
  events, onClose, onEdit, onNew, todayStr
}: {
  events: EventGoal[], onClose: () => void, onEdit: (ev: EventGoal) => void, onNew: () => void, todayStr: string
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="p-5 space-y-6 pb-24 absolute inset-0 bg-[#F9FAFB] z-40 min-h-screen overflow-y-auto"
    >
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onClose} className="w-10 h-10 bg-[#FFFFFF] rounded-full text-slate-500 hover:text-[#111111] border border-[#F3F4F6] shadow-sm flex items-center justify-center transition-colors">
           <X size={20} />
        </button>
        <div>
          <h2 className="text-xl font-black text-[#111111] tracking-wide">
            Tous les Objectifs
          </h2>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{events.length} Événements prévus</p>
        </div>
      </div>

      <div className="space-y-4">
        {events.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-sm font-medium">Aucun objectif en cours.</div>
        ) : (
          events.map((ev, index) => {
            const isMain = index === 0;
            const daysLeft = differenceInDays(parseISO(ev.date), parseISO(todayStr));
            
            let totalKm = 0;
            let totalMins = 0;
            
            if (ev.isTriathlon) {
              totalKm = (parseFloat(ev.swimDistance || '0') + parseFloat(ev.bikeDistance || '0') + parseFloat(ev.runDistance || '0'));
              totalMins = timeToMin(ev.swimTime) + timeToMin(ev.bikeTime) + timeToMin(ev.runTime);
            }

            return (
              <div key={ev.id} className={`bg-[#FFFFFF] p-5 rounded-3xl border shadow-sm relative overflow-hidden ${isMain ? 'border-indigo-200 shadow-indigo-500/10' : 'border-[#F3F4F6]'}`}>
                {isMain && (
                  <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-indigo-500/10 to-indigo-500/0 rounded-bl-full -z-10" />
                )}
                
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isMain ? 'bg-indigo-50 text-indigo-500 border border-indigo-100' : 'bg-slate-50 text-slate-500 border border-slate-100'}`}>
                      {isMain ? <Flag size={18} /> : <Target size={18} />}
                    </div>
                    <div>
                      <h3 className="font-bold text-[#111111]">{ev.name}</h3>
                      <p className="text-[10px] text-slate-500 font-bold tracking-wider mt-0.5">
                        {parseISO(ev.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                  <div className={`rounded-xl px-2.5 py-1 flex flex-col items-center ${isMain ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    <span className="text-xs font-black">J-{daysLeft}</span>
                  </div>
                </div>

                <div className="bg-[#F9FAFB] rounded-2xl p-4 flex flex-col gap-3">
                  {ev.isTriathlon ? (
                    <>
                      <div className="flex justify-between items-center mb-1">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cumul Triathlon</div>
                        <div className="text-sm font-black text-indigo-600">
                          {totalKm.toFixed(1)} <span className="text-[10px] text-slate-500">km</span> / {minToTime(totalMins)}
                        </div>
                      </div>
                      <div className="flex justify-between divide-x divide-slate-200 border-t border-slate-200 pt-3">
                        <div className="flex-1 flex flex-col items-center justify-center px-1">
                          <Waves size={14} className="text-[#3B82F6] mb-1" />
                          <span className="text-xs font-bold text-slate-700">{ev.swimDistance || '--'} <span className="text-[9px]">km</span></span>
                          <span className="text-[10px] text-slate-500 font-mono mt-0.5">{ev.swimTime || '--'}</span>
                        </div>
                        <div className="flex-1 flex flex-col items-center justify-center px-1">
                          <Bike size={14} className="text-[#F26A00] mb-1" />
                          <span className="text-xs font-bold text-slate-700">{ev.bikeDistance || '--'} <span className="text-[9px]">km</span></span>
                          <span className="text-[10px] text-slate-500 font-mono mt-0.5">{ev.bikeTime || '--'}</span>
                        </div>
                        <div className="flex-1 flex flex-col items-center justify-center px-1">
                          <Footprints size={14} className="text-[#22A06B] mb-1" />
                          <span className="text-xs font-bold text-slate-700">{ev.runDistance || '--'} <span className="text-[9px]">km</span></span>
                          <span className="text-[10px] text-slate-500 font-mono mt-0.5">{ev.runTime || '--'}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-around">
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Distance</span>
                        <span className="text-sm font-black text-[#111111]">{ev.distance || '--'} km</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Objectif Temps</span>
                        <span className="text-sm font-black text-indigo-500 font-mono">{ev.targetTime || '--'}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 text-center">
                  <button onClick={() => onEdit(ev)} className="text-[10px] font-bold text-slate-500 hover:text-indigo-600 transition-colors uppercase tracking-wider">
                    Modifier cet objectif
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <button
        onClick={onNew}
        className="w-full mt-4 py-4 rounded-3xl bg-[#FFFFFF] border border-[#F3F4F6] text-indigo-500 flex items-center justify-center gap-2 font-bold text-sm hover:bg-indigo-50 transition-all shadow-sm"
      >
        <Plus size={18} />
        Ajouter un objectif
      </button>
    </motion.div>
  );
}

export function EventForm({ 
  event, 
  onClose, 
  onSave, 
  onDelete 
}: { 
  event: EventGoal | 'new', 
  onClose: () => void, 
  onSave: (e: EventGoal) => void,
  onDelete: (id: string) => void 
}) {
  const isNew = event === 'new';
  
  const [name, setName] = useState(isNew ? '' : event.name);
  const [date, setDate] = useState(isNew ? '' : event.date);
  const [isTriathlon, setIsTriathlon] = useState(isNew ? false : event.isTriathlon);
  
  // Single
  const [distance, setDistance] = useState(isNew ? '' : (event.distance || ''));
  const [targetTime, setTargetTime] = useState(isNew ? '' : (event.targetTime || ''));
  
  // Triathlon
  const [swimDistance, setSwimDistance] = useState(isNew ? '' : (event.swimDistance || ''));
  const [swimTime, setSwimTime] = useState(isNew ? '' : (event.swimTime || ''));
  const [bikeDistance, setBikeDistance] = useState(isNew ? '' : (event.bikeDistance || ''));
  const [bikeTime, setBikeTime] = useState(isNew ? '' : (event.bikeTime || ''));
  const [runDistance, setRunDistance] = useState(isNew ? '' : (event.runDistance || ''));
  const [runTime, setRunTime] = useState(isNew ? '' : (event.runTime || ''));

  const handleSave = () => {
     if (!name.trim() || !date) return;
     const ev: EventGoal = {
        id: isNew ? crypto.randomUUID() : event.id,
        name,
        date,
        isTriathlon,
        distance,
        targetTime,
        swimDistance,
        swimTime,
        bikeDistance,
        bikeTime,
        runDistance,
        runTime
     };
     onSave(ev);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="p-5 space-y-6 pb-24 absolute inset-0 bg-[#F9FAFB] z-50 min-h-screen overflow-y-auto"
    >
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="w-10 h-10 bg-[#FFFFFF] rounded-full text-slate-500 hover:text-[#111111] border border-[#F3F4F6] shadow-sm flex items-center justify-center transition-colors">
           <X size={20} />
        </button>
        <h2 className="text-xl font-black text-[#111111] tracking-wide">
          {isNew ? 'Nouvel Objectif' : 'Modifier l\'objectif'}
        </h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1.5">Nom de l'événement</label>
          <input 
            type="text" 
            value={name} 
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Marathon de Paris"
            className="w-full bg-[#FFFFFF] border border-[#F3F4F6] rounded-2xl px-4 py-3 text-[#111111] text-sm focus:outline-none focus:border-indigo-500 transition-colors shadow-sm"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1.5">Date</label>
          <input 
            type="date" 
            value={date} 
            onChange={e => setDate(e.target.value)}
            className="w-full bg-[#FFFFFF] border border-[#F3F4F6] rounded-2xl px-4 py-3 text-[#111111] text-sm focus:outline-none focus:border-indigo-500 transition-colors shadow-sm"
          />
        </div>

        <div className="flex items-center justify-between bg-[#FFFFFF] p-4 rounded-2xl border border-[#F3F4F6] shadow-sm cursor-pointer" onClick={() => setIsTriathlon(!isTriathlon)}>
          <div>
            <h4 className="text-sm font-bold text-[#111111]">Format Triathlon</h4>
            <p className="text-[10px] text-slate-500 mt-0.5">Définir des objectifs par discipline (Natation, Vélo, Course)</p>
          </div>
          <div className={`w-12 h-6 rounded-full flex items-center px-1 transition-colors ${isTriathlon ? 'bg-indigo-500' : 'bg-slate-200'}`}>
            <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${isTriathlon ? 'translate-x-6' : 'translate-x-0'}`} />
          </div>
        </div>

        {!isTriathlon ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1.5">Distance (km)</label>
              <input 
                type="text" 
                value={distance} 
                onChange={e => setDistance(e.target.value)}
                placeholder="Ex: 42.2"
                className="w-full bg-[#FFFFFF] border border-[#F3F4F6] rounded-2xl px-4 py-3 text-[#111111] text-sm focus:outline-none focus:border-indigo-500 transition-colors shadow-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1.5">Temps Visé (HH:MM)</label>
              <input 
                type="text" 
                value={targetTime} 
                onChange={e => setTargetTime(e.target.value)}
                placeholder="HH:MM"
                className="w-full bg-[#FFFFFF] border border-[#F3F4F6] rounded-2xl px-4 py-3 text-[#111111] text-sm focus:outline-none focus:border-indigo-500 transition-colors shadow-sm"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Swim */}
            <div className="bg-[#FFFFFF] p-3 rounded-2xl border border-[#F3F4F6] shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#3B82F6] flex items-center justify-center shrink-0">
                <Waves size={18} />
              </div>
              <div className="flex-1 grid grid-cols-2 gap-2">
                <input 
                  type="text" 
                  value={swimDistance} 
                  onChange={e => setSwimDistance(e.target.value)}
                  placeholder="Dist (km)"
                  className="w-full bg-[#F9FAFB] border border-[#F3F4F6] rounded-xl px-3 py-2 text-[#111111] text-xs focus:outline-none focus:border-indigo-500"
                />
                <input 
                  type="text" 
                  value={swimTime} 
                  onChange={e => setSwimTime(e.target.value)}
                  placeholder="HH:MM"
                  className="w-full bg-[#F9FAFB] border border-[#F3F4F6] rounded-xl px-3 py-2 text-[#111111] text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            
            {/* Bike */}
            <div className="bg-[#FFFFFF] p-3 rounded-2xl border border-[#F3F4F6] shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-50 text-[#F26A00] flex items-center justify-center shrink-0">
                <Bike size={18} />
              </div>
              <div className="flex-1 grid grid-cols-2 gap-2">
                <input 
                  type="text" 
                  value={bikeDistance} 
                  onChange={e => setBikeDistance(e.target.value)}
                  placeholder="Dist (km)"
                  className="w-full bg-[#F9FAFB] border border-[#F3F4F6] rounded-xl px-3 py-2 text-[#111111] text-xs focus:outline-none focus:border-indigo-500"
                />
                <input 
                  type="text" 
                  value={bikeTime} 
                  onChange={e => setBikeTime(e.target.value)}
                  placeholder="HH:MM"
                  className="w-full bg-[#F9FAFB] border border-[#F3F4F6] rounded-xl px-3 py-2 text-[#111111] text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Run */}
            <div className="bg-[#FFFFFF] p-3 rounded-2xl border border-[#F3F4F6] shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-[#22A06B] flex items-center justify-center shrink-0">
                <Footprints size={18} />
              </div>
              <div className="flex-1 grid grid-cols-2 gap-2">
                <input 
                  type="text" 
                  value={runDistance} 
                  onChange={e => setRunDistance(e.target.value)}
                  placeholder="Dist (km)"
                  className="w-full bg-[#F9FAFB] border border-[#F3F4F6] rounded-xl px-3 py-2 text-[#111111] text-xs focus:outline-none focus:border-indigo-500"
                />
                <input 
                  type="text" 
                  value={runTime} 
                  onChange={e => setRunTime(e.target.value)}
                  placeholder="HH:MM"
                  className="w-full bg-[#F9FAFB] border border-[#F3F4F6] rounded-xl px-3 py-2 text-[#111111] text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="pt-6 space-y-3">
        <button
          onClick={handleSave}
          disabled={!name.trim() || !date}
          className="w-full py-4 rounded-3xl bg-indigo-500 text-white flex items-center justify-center gap-2 font-black text-sm hover:bg-indigo-600 transition-all disabled:opacity-50 shadow-md shadow-indigo-500/20"
        >
          <Save size={18} />
          Enregistrer l'objectif
        </button>
        
        {!isNew && (
          <button
            onClick={() => {
              if (window.confirm('Supprimer cet objectif ?')) {
                onDelete(event.id);
              }
            }}
            className="w-full py-4 rounded-3xl bg-transparent border border-rose-200 text-rose-500 flex items-center justify-center gap-2 font-bold text-sm hover:bg-rose-50 transition-all"
          >
            Supprimer
          </button>
        )}
      </div>
    </motion.div>
  );
}
