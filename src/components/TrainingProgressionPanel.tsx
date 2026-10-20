import React, { useState } from 'react';
import {
  TrendingUp,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Zap,
  Info,
  ShieldCheck,
  ChevronRight,
  Layers,
  Sparkles
} from 'lucide-react';
import { TrainingProgressionAnalysis, ProgressionProposal } from '../domain/trainingProgressionTypes';
import { ProgressionProposalModal } from './ProgressionProposalModal';
import { GoalProgressCard } from './GoalProgressCard';
import { ProgressionTrendChart } from './ProgressionTrendChart';
import { cn } from '../utils';

interface TrainingProgressionPanelProps {
  analysis: TrainingProgressionAnalysis;
  onProposalApplied?: () => void;
  className?: string;
  athleteId?: string;
}

export const TrainingProgressionPanel: React.FC<TrainingProgressionPanelProps> = ({
  analysis,
  onProposalApplied,
  className,
  athleteId = 'current-athlete'
}) => {
  const [selectedProposal, setSelectedProposal] = useState<ProgressionProposal | null>(null);

  const {
    status,
    readableExplanation,
    interpretationLimits,
    metrics,
    stagnation,
    loadTrends,
    trendPoints,
    goalAlignment,
    proposals,
    dataProvenance,
    missingData,
    uncertaintyLevel
  } = analysis;

  const getStatusDisplay = () => {
    switch (status) {
      case 'PROGRESSING':
        return {
          label: 'Progression mesurable',
          color: 'bg-emerald-500 text-white',
          bgColor: 'bg-emerald-50 border-emerald-200',
          icon: TrendingUp
        };
      case 'STABLE':
        return {
          label: 'Niveau stable',
          color: 'bg-blue-500 text-white',
          bgColor: 'bg-blue-50 border-blue-200',
          icon: CheckCircle2
        };
      case 'POTENTIAL_STAGNATION':
        return {
          label: 'Plateau potentiel détecté',
          color: 'bg-amber-500 text-white',
          bgColor: 'bg-amber-50 border-amber-200',
          icon: AlertTriangle
        };
      case 'DECLINING':
        return {
          label: 'Fléchissement constaté',
          color: 'bg-rose-500 text-white',
          bgColor: 'bg-rose-50 border-rose-200',
          icon: Activity
        };
      case 'INSUFFICIENT_DATA':
      default:
        return {
          label: 'Données insuffisantes',
          color: 'bg-slate-400 text-white',
          bgColor: 'bg-slate-50 border-slate-200',
          icon: Info
        };
    }
  };

  const statusConfig = getStatusDisplay();
  const StatusIcon = statusConfig.icon;
  const pendingProposals = proposals.filter(p => p.status === 'PENDING');

  return (
    <div className={cn("space-y-6", className)}>
      {/* 1. Carte principale de statut */}
      <div className={cn("rounded-3xl p-6 border shadow-sm space-y-4", statusConfig.bgColor)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("w-10 h-10 rounded-2xl flex items-center justify-center shadow-md", statusConfig.color)}>
              <StatusIcon size={20} />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Bilan de progression • {analysis.observedPeriod.weeksCount} semaines
              </span>
              <h3 className="text-xl font-black text-plana-black tracking-tight">{statusConfig.label}</h3>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Incertitude</span>
            <span className="text-xs font-bold text-slate-600">
              {uncertaintyLevel === 'LOW' ? 'Faible (Données fiables)' : uncertaintyLevel === 'MEDIUM' ? 'Moyenne' : 'Élevée'}
            </span>
          </div>
        </div>

        <p className="text-sm text-slate-700 font-medium leading-relaxed bg-white/80 p-4 rounded-2xl border border-white">
          {readableExplanation}
        </p>

        {/* Missing data warnings if any */}
        {missingData.length > 0 && (
          <div className="bg-amber-50/80 border border-amber-200 rounded-2xl p-3.5 space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
              <Info size={14} className="shrink-0" />
              <span>Données manquantes ou à consolider</span>
            </div>
            {missingData.map((m, idx) => (
              <p key={idx} className="text-xs text-amber-800 font-medium pl-5">
                • {m}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* 2. Proposition du Coach active (si existante) */}
      {pendingProposals.length > 0 && (
        <div className="bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/10 border border-amber-300 rounded-3xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Sparkles size={18} className="text-amber-600" />
              <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                Proposition d'ajustement du Coach ({pendingProposals[0].type})
              </span>
            </div>
            <span className="text-[10px] font-bold bg-amber-200 text-amber-900 px-2.5 py-0.5 rounded-full">
              Validation requise
            </span>
          </div>
          <p className="text-sm font-semibold text-plana-black">
            {pendingProposals[0].title} : {pendingProposals[0].justification}
          </p>
          <div className="pt-1 flex justify-end">
            <button
              onClick={() => setSelectedProposal(pendingProposals[0])}
              className="px-4 py-2 bg-plana-black text-white rounded-2xl text-xs font-bold uppercase tracking-wider hover:bg-slate-800 transition-colors flex items-center gap-2 shadow-md shadow-black/10"
            >
              <span>Examiner la proposition</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* 3. Alignement sur l'objectif */}
      {goalAlignment && (
        <GoalProgressCard alignment={goalAlignment} />
      )}

      {/* 4. Graphique d'évolution multi-semaines */}
      <ProgressionTrendChart
        trendPoints={trendPoints}
        metricLabel="Puissance normalisée"
        metricUnit="W"
      />

      {/* 5. Métriques comparables par discipline */}
      <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Indicateurs de performance analysés
          </h4>
          <span className="text-xs font-bold text-slate-500">
            {metrics.length} indicateur(s)
          </span>
        </div>

        {metrics.length === 0 ? (
          <p className="text-xs text-slate-400 font-medium italic">
            Aucun indicateur direct comparable calculable sur la période.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {metrics.map((m, idx) => (
              <div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-plana-black">{m.metricName}</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase",
                    m.trend === 'IMPROVING' ? "bg-emerald-100 text-emerald-800" :
                    m.trend === 'DECLINING' ? "bg-rose-100 text-rose-800" :
                    "bg-slate-200 text-slate-700"
                  )}>
                    {m.trend === 'IMPROVING' ? `+${m.relativeDeltaPct}%` :
                     m.trend === 'DECLINING' ? `${m.relativeDeltaPct}%` :
                     'Stable'}
                  </span>
                </div>

                <div className="flex items-baseline justify-between pt-1">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Référence</span>
                    <span className="text-sm font-bold text-slate-600">{m.referenceValue} {m.unit}</span>
                  </div>
                  <ChevronRight size={14} className="text-slate-300" />
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">Récent</span>
                    <span className="text-sm font-black text-plana-black">{m.recentValue} {m.unit}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-400">
                  <span>Échantillon : {m.sampleCount} séances</span>
                  <span className={cn(
                    "font-bold",
                    m.provenance === 'ESTIMATED' ? "text-amber-600" : "text-emerald-600"
                  )}>
                    {m.provenance === 'ESTIMATED' ? 'Estimation' : 'Mesuré'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 6. Alertes et Stagnation */}
      {stagnation.isStagnating && (
        <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-amber-900 font-bold text-xs uppercase tracking-wider">
            <AlertTriangle size={16} />
            <span>Plateau de performance détecté</span>
          </div>
          <p className="text-xs text-amber-900 leading-relaxed font-medium">
            Vos indicateurs sont stables depuis {stagnation.observedDurationWeeks} semaines malgré une charge régulière.
            Règle de sécurité : <strong>Ne pas augmenter la charge</strong>. Une variation des stimuli (séances polarisées) ou une phase d'assimilation est recommandée.
          </p>
        </div>
      )}

      {/* 7. Limites d'interprétation */}
      <div className="bg-slate-50 border border-slate-100 rounded-3xl p-5 space-y-2">
        <div className="flex items-center gap-2 text-slate-400 font-bold text-[10px] uppercase tracking-wider">
          <ShieldCheck size={14} />
          <span>Cadre déterministe & Limites d'interprétation</span>
        </div>
        <div className="space-y-1">
          {interpretationLimits.map((limit, idx) => (
            <p key={idx} className="text-xs text-slate-500 font-medium">
              • {limit}
            </p>
          ))}
        </div>
      </div>

      {/* Modal de décision de proposition */}
      <ProgressionProposalModal
        isOpen={!!selectedProposal}
        onClose={() => setSelectedProposal(null)}
        proposal={selectedProposal}
        athleteId={athleteId}
        onExecuted={() => {
          setSelectedProposal(null);
          if (onProposalApplied) onProposalApplied();
        }}
        onRejected={() => {
          setSelectedProposal(null);
          if (onProposalApplied) onProposalApplied();
        }}
      />
    </div>
  );
};
