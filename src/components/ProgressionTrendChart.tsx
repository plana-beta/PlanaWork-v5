import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { ProgressionTrendPoint } from '../domain/trainingProgressionTypes';
import { Info } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ProgressionTrendChartProps {
  trendPoints: ProgressionTrendPoint[];
  metricLabel?: string;
  metricUnit?: string;
}

export const ProgressionTrendChart: React.FC<ProgressionTrendChartProps> = ({
  trendPoints,
  metricLabel = "Indicateur moyen",
  metricUnit = "W"
}) => {
  if (!trendPoints || trendPoints.length === 0) {
    return (
      <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm flex flex-col items-center justify-center text-center h-64">
        <Info size={32} className="text-slate-300 mb-2" />
        <h4 className="text-sm font-bold text-plana-black">Aucun historique disponible</h4>
        <p className="text-xs text-slate-400 mt-1">Enregistrez des séances d'entraînement pour visualiser vos tendances multi-semaines.</p>
      </div>
    );
  }

  // Format data for chart : ensure missing measured data is explicitly undefined so recharts connectsNulls={false}
  const chartData = trendPoints.map(p => ({
    date: p.date,
    displayDate: `Sem. ${p.weekNumber}`,
    fullDate: p.date,
    volumeHours: Number((p.volumeMinutes / 60).toFixed(1)),
    tssTotal: p.tssTotal,
    measuredMetric: p.hasMeasuredData && p.measuredMetricValue !== undefined ? p.measuredMetricValue : null,
    hasMeasuredData: p.hasMeasuredData,
    ctl: p.ctl !== undefined ? Math.round(p.ctl) : null
  }));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-100 shadow-xl rounded-2xl text-xs font-bold text-plana-black space-y-1.5">
          <p className="text-slate-500 capitalize">{data.displayDate} ({data.fullDate})</p>
          <div className="space-y-1">
            <p className="text-blue-600">Volume : {data.volumeHours} h ({data.tssTotal} TSS)</p>
            {data.hasMeasuredData && data.measuredMetric !== null ? (
              <p className="text-amber-600">
                {metricLabel} : {data.measuredMetric} {metricUnit}
                <span className="text-[10px] text-emerald-600 font-bold block">✓ Mesure réelle</span>
              </p>
            ) : (
              <p className="text-slate-400 italic font-medium">Aucune mesure directe cette semaine</p>
            )}
            {data.ctl !== null && (
              <p className="text-indigo-500">Fitness (CTL) : {data.ctl}</p>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Évolution multi-semaines de la charge et des performances
          </h4>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Volume hebdomadaire vs indicateurs mesurés (les semaines sans capteur ne sont pas interpolées)
          </p>
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="displayDate"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              unit="h"
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: '#f59e0b' }}
              unit={metricUnit}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 11, fontWeight: 600, paddingTop: 10 }}
              formatter={(value) => {
                if (value === 'volumeHours') return 'Volume (heures)';
                if (value === 'measuredMetric') return `${metricLabel} (${metricUnit})`;
                if (value === 'ctl') return 'Fitness (CTL)';
                return value;
              }}
            />
            <Bar
              yAxisId="left"
              dataKey="volumeHours"
              fill="#e2e8f0"
              radius={[6, 6, 0, 0]}
              maxBarSize={36}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="measuredMetric"
              stroke="#f59e0b"
              strokeWidth={2.5}
              dot={{ r: 4, fill: '#f59e0b', strokeWidth: 2, stroke: '#ffffff' }}
              connectNulls={false} // RÈGLE ABSOLUE : Ne pas relier les périodes sans données !
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="ctl"
              stroke="#6366f1"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              connectNulls={true}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-4 text-[10px] text-slate-400 font-semibold pt-1 border-t border-slate-50">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-slate-200" />
          <span>Volume (h)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span>Mesure directe ({metricUnit})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 bg-indigo-500 border-dashed" />
          <span>Fitness (CTL)</span>
        </div>
      </div>
    </div>
  );
};
