import React from 'react';
import { Target, Calendar, AlertTriangle, CheckCircle2, Clock, Info } from 'lucide-react';
import { GoalAlignmentAnalysis } from '../domain/trainingProgressionTypes';
import { cn } from '../utils';

interface GoalProgressCardProps {
  alignment?: GoalAlignmentAnalysis;
  className?: string;
}

export const GoalProgressCard: React.FC<GoalProgressCardProps> = ({ alignment, className }) => {
  if (!alignment) {
    return (
      <div className={cn("bg-white border border-gray-100 rounded-3xl p-5 shadow-sm text-center", className)}>
        <Target size={24} className="mx-auto text-slate-300 mb-2" />
        <h4 className="text-sm font-bold text-plana-black">Aucun objectif actif</h4>
        <p className="text-xs text-slate-400 mt-1">Définissez un objectif dans l'onglet Objectif pour suivre votre alignement.</p>
      </div>
    );
  }

  const {
    goalTitle,
    targetDate,
    daysRemaining,
    weeksRemaining,
    isExpired,
    sportFocus,
    isMeasurable,
    limitsExplanation,
    alignmentStatus,
    calendarConstraints,
    recommendationsToAthlete
  } = alignment;

  const getStatusBadge = () => {
    switch (alignmentStatus) {
      case 'PROGRESS_DETECTED':
        return { label: 'Progression mesurée', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
      case 'ON_TRACK':
        return { label: 'Trajectoire alignée', color: 'bg-blue-50 text-blue-700 border-blue-200' };
      case 'NEEDS_ATTENTION':
        return { label: 'Attention requise', color: 'bg-amber-50 text-amber-700 border-amber-200' };
      case 'INSUFFICIENT_DATA':
        return { label: 'Données insuffisantes', color: 'bg-slate-50 text-slate-600 border-slate-200' };
      default:
        return { label: 'Non contraint', color: 'bg-gray-50 text-gray-600 border-gray-200' };
    }
  };

  const badge = getStatusBadge();

  return (
    <div className={cn("bg-white border border-gray-100 rounded-3xl p-6 shadow-sm space-y-4", className)}>
      {/* En-tête */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-orange-50 text-plana-orange flex items-center justify-center">
            <Target size={20} />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              {sportFocus ? `Objectif • ${sportFocus}` : "Objectif sportif"}
            </span>
            <h3 className="text-base font-black text-plana-black tracking-tight">{goalTitle}</h3>
          </div>
        </div>
        <span className={cn("px-3 py-1 rounded-full text-[10px] font-bold border", badge.color)}>
          {badge.label}
        </span>
      </div>

      {/* Décompte et échéance */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-3">
          <Calendar size={18} className="text-slate-400 shrink-0" />
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase">Échéance</div>
            <div className="text-xs font-bold text-plana-black">{targetDate || "Non définie"}</div>
          </div>
        </div>

        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-3">
          <Clock size={18} className="text-slate-400 shrink-0" />
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase">Délai restant</div>
            <div className="text-xs font-bold text-plana-black">
              {isExpired ? (
                <span className="text-red-500 font-bold">Échu</span>
              ) : daysRemaining !== null ? (
                `${daysRemaining} j (${weeksRemaining} sem)`
              ) : (
                "Indéterminé"
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Contraintes de calendrier ou alertes */}
      {calendarConstraints.length > 0 && (
        <div className="space-y-1.5">
          {calendarConstraints.map((c, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs text-slate-600 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span>{c}</span>
            </div>
          ))}
        </div>
      )}

      {/* Explication déterministe & limites */}
      <div className="bg-amber-50/70 border border-amber-200/60 rounded-2xl p-3 flex items-start gap-2.5">
        <Info size={15} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="text-[11px] text-amber-900 leading-relaxed font-medium">
          {limitsExplanation}
        </div>
      </div>

      {/* Recommandations au regard de l'objectif */}
      {recommendationsToAthlete.length > 0 && (
        <div className="pt-1 border-t border-gray-100 space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Conseil de trajectoire
          </span>
          {recommendationsToAthlete.map((rec, idx) => (
            <p key={idx} className="text-xs font-medium text-slate-700">
              {rec}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};
