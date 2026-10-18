import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Activity, TrendingUp, Zap, Info } from 'lucide-react';
import { useAppStore } from '../store';
import { generateRecommendations } from '../lib/recommendationEngine';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import { format, parseISO, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function ProgressionView() {
  const store = useAppStore();
  const pmc = store.pmc;
  const today = new Date();
  const recommendations = useMemo(() => generateRecommendations(store.athleteProfile, store.plannedWorkouts, store.actualWorkouts, store.pmc, today), [store, today]);
  const synthesis = recommendations.find(r => r.type === 'RECOVERY' || r.type === 'PROGRESS') || recommendations[0];

  const displayPmc = useMemo(() => {
    return pmc;
  }, [pmc]);

  const latest = displayPmc[displayPmc.length - 1] || { ctl: 0, atl: 0, tsb: 0 };
  const ctl = Math.round(latest.ctl);
  const atl = Math.round(latest.atl);
  const tsb = Math.round(latest.tsb);



  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-gray-100 shadow-xl rounded-2xl text-xs font-bold text-plana-black">
          <p className="text-slate-500 mb-2 capitalize">{format(parseISO(label), 'd MMM yyyy', { locale: fr })}</p>
          <div className="space-y-1">
            <p className="text-blue-500">Fitness (CTL) : {Math.round(payload[0].value)}</p>
            <p className="text-red-500">Fatigue (ATL) : {Math.round(payload[1].value)}</p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-5 pb-24 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-black text-plana-black tracking-wide">Progression</h2>
        <p className="text-sm text-slate-500 font-medium mt-1">
          L'équilibre charge et récupération
        </p>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-gray-100 rounded-3xl p-4 shadow-sm flex flex-col items-center text-center">
          <TrendingUp size={20} className="text-blue-500 mb-2" />
          <div className="text-2xl font-black text-plana-black">{ctl}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Fitness</div>
        </div>
        
        <div className="bg-white border border-gray-100 rounded-3xl p-4 shadow-sm flex flex-col items-center text-center">
          <Activity size={20} className="text-red-500 mb-2" />
          <div className="text-2xl font-black text-plana-black">{atl}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Fatigue</div>
        </div>
        
        <div className="bg-white border border-gray-100 rounded-3xl p-4 shadow-sm flex flex-col items-center text-center">
          <Zap size={20} className="text-amber-500 mb-2" />
          <div className="text-2xl font-black text-amber-500">{tsb > 0 ? '+' : ''}{tsb}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Forme</div>
        </div>
      </div>

      {/* Insight (Synthèse) */}
      {synthesis && (
        <div className="bg-orange-50 border border-plana-orange/20 rounded-3xl p-5 flex gap-4 items-start">
          <div className="shrink-0 w-8 h-8 rounded-full bg-plana-orange text-white flex items-center justify-center mt-0.5">
            <Info size={16} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-plana-orange uppercase tracking-wider mb-1">
              Synthèse : {synthesis.title}
            </h4>
            <p className="text-sm font-medium text-plana-black leading-relaxed">
              {synthesis.message}
            </p>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
         <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-6">Performance Management Chart</h4>
         <div className="h-64 w-full">
            {displayPmc.length < 2 ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-center p-4">
                <Info size={32} className="text-slate-300 mb-3" />
                <p className="text-slate-500 font-bold">Historique insuffisant</p>
                <p className="text-slate-400 text-sm mt-1">Effectue au moins deux entraînements pour générer ta courbe de charge.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={displayPmc} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCtl" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(val) => { try { return format(parseISO(val), 'd MMM', { locale: fr }) } catch (e) { return val } }}
                    tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 700 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={30}
                  />
                  <YAxis 
                    tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 700 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="ctl" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorCtl)" />
                  <Line type="monotone" dataKey="atl" stroke="#ef4444" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
         </div>
      </div>

    </motion.div>
  );
}
