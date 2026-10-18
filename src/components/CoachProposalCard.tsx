import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  X,
  Edit2,
  Calendar,
  Clock,
  Zap,
  TrendingDown,
  TrendingUp,
  Activity,
  HelpCircle
} from 'lucide-react';
import { CoachProposal, ProposedWorkoutModification } from '../domain/coachTypes';
import { PlannedWorkout } from '../domain/models';
import { CoachProposalExplainer } from '../lib/coachProposalExplainer';

interface CoachProposalCardProps {
  proposal: CoachProposal;
  plannedWorkouts: PlannedWorkout[];
  onValidate: (proposal: CoachProposal) => void;
  onRefuse: (proposal: CoachProposal) => void;
  onModify?: (proposal: CoachProposal) => void;
  isLoading?: boolean;
}

export const CoachProposalCard: React.FC<CoachProposalCardProps> = ({
  proposal,
  plannedWorkouts,
  onValidate,
  onRefuse,
  onModify,
  isLoading = false
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [customReason, setCustomReason] = useState(proposal.reason);
  const [selectedDuration, setSelectedDuration] = useState<number | undefined>(
    proposal.proposedModifications?.[0]?.newDurationMin
  );

  // Retrouver les séances impactées
  const targetWorkouts = plannedWorkouts.filter(w =>
    proposal.affectedWorkoutIds.includes(w.id)
  );

  const getActionBadgeColor = (action: string) => {
    switch (action) {
      case 'CANCEL_WORKOUT':
      case 'REDUCE_LOAD':
      case 'RECOVERY':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800';
      case 'INCREASE_LOAD':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'MOVE_WORKOUT':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      default:
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800';
    }
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case 'CANCEL_WORKOUT':
        return 'Annulation de séance';
      case 'REDUCE_LOAD':
        return 'Allègement de charge';
      case 'RECOVERY':
        return 'Passage en récupération';
      case 'INCREASE_LOAD':
        return 'Progression (+5% max)';
      case 'MOVE_WORKOUT':
        return 'Déplacement de séance';
      case 'ADAPT_PLAN':
        return 'Réorganisation de la semaine';
      default:
        return 'Modification du planning';
    }
  };

  const handleSaveModification = () => {
    const updatedProposal: CoachProposal = {
      ...proposal,
      reason: customReason,
      proposedModifications: proposal.proposedModifications?.map(mod => ({
        ...mod,
        newDurationMin: selectedDuration ?? mod.newDurationMin
      }))
    };
    setIsEditing(false);
    if (onModify) {
      onModify(updatedProposal);
    }
  };

  return (
    <div
      id={`proposal-card-${proposal.id}`}
      className="bg-white dark:bg-slate-800 rounded-2xl border-2 border-indigo-200 dark:border-indigo-800/80 shadow-md p-5 space-y-4 my-3 text-slate-800 dark:text-slate-100"
    >
      {/* Header : Titre & Badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${getActionBadgeColor(
              proposal.action
            )}`}
          >
            {getActionLabel(proposal.action)}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Confiance : <strong className="text-slate-700 dark:text-slate-200">{proposal.confidence}</strong>
          </span>
        </div>
        <div className="flex items-center space-x-1 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
          <Activity className="w-3.5 h-3.5" />
          <span>Proposition Coach</span>
        </div>
      </div>

      {/* Pourquoi ? (Explication et justification physiologique) */}
      <div className="bg-slate-50 dark:bg-slate-900/60 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-700/60 space-y-1.5">
        <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
          <HelpCircle className="w-3.5 h-3.5 text-indigo-500" />
          <span>Pourquoi ?</span>
        </div>
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {CoachProposalExplainer.getWhyExplanation(proposal, plannedWorkouts)}
        </p>
      </div>

      {/* Bloc Comparatif : Avant / Après */}
      <div className="space-y-2">
        <div className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
          Comparatif Avant / Après
        </div>

        {targetWorkouts.length === 0 ? (
          <div className="text-xs text-slate-500 italic p-2 bg-slate-50 dark:bg-slate-900 rounded-lg">
            Aucune séance ciblée spécifique (action générale de structure).
          </div>
        ) : (
          targetWorkouts.map(workout => {
            const mod = proposal.proposedModifications?.find(
              m => m.workoutId === workout.id
            );
            const isCancelled = mod?.cancel || proposal.action === 'CANCEL_WORKOUT';
            const newDate = mod?.newDate;
            const newDuration = mod?.newDurationMin ?? (
              proposal.action === 'REDUCE_LOAD'
                ? Math.round(workout.targetDurationMin * 0.7)
                : proposal.action === 'INCREASE_LOAD'
                ? Math.round(workout.targetDurationMin * 1.05)
                : workout.targetDurationMin
            );
            const newIntensity = mod?.newIntensity?.value ?? (
              proposal.action === 'RECOVERY' || proposal.action === 'REDUCE_LOAD'
                ? 'Z1/Z2'
                : workout.targetIntensity.value
            );

            return (
              <div
                key={workout.id}
                className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-100 dark:border-slate-800 text-xs"
              >
                {/* Avant */}
                <div className="space-y-1 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-700 pb-2 md:pb-0 md:pr-2">
                  <div className="font-semibold text-slate-500 dark:text-slate-400 uppercase">
                    Avant (Prévu)
                  </div>
                  <div className="font-medium text-slate-900 dark:text-white">
                    {workout.title} ({workout.sport})
                  </div>
                  <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-400">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    <span>{workout.date}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-400">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span>{workout.targetDurationMin} min</span>
                    <span>•</span>
                    <Zap className="w-3 h-3 text-slate-400" />
                    <span>{workout.targetIntensity.value}</span>
                  </div>
                </div>

                {/* Après */}
                <div className="space-y-1">
                  <div className="font-semibold text-indigo-600 dark:text-indigo-400 uppercase flex items-center space-x-1">
                    <span>Après (Recommandé)</span>
                  </div>

                  {isCancelled ? (
                    <div className="p-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-lg text-rose-700 dark:text-rose-300 font-semibold">
                      Séance annulée (Journée de repos complet)
                    </div>
                  ) : (
                    <>
                      <div className="font-medium text-indigo-950 dark:text-indigo-200">
                        {workout.title}
                      </div>
                      <div className="flex items-center space-x-2 text-slate-700 dark:text-slate-300">
                        <Calendar className="w-3 h-3 text-indigo-500" />
                        <span className={newDate ? 'font-bold text-indigo-600 dark:text-indigo-400' : ''}>
                          {newDate || workout.date}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 text-slate-700 dark:text-slate-300">
                        <Clock className="w-3 h-3 text-indigo-500" />
                        <span className="font-bold text-indigo-600 dark:text-indigo-400">
                          {newDuration} min
                        </span>
                        <span>•</span>
                        <Zap className="w-3 h-3 text-indigo-500" />
                        <span className="font-bold text-indigo-600 dark:text-indigo-400">
                          {newIntensity}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Impact physiologique & Charge */}
      {proposal.sourceContext && (
        <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/30 rounded-xl border border-indigo-100 dark:border-indigo-900/60 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            {proposal.action === 'REDUCE_LOAD' || proposal.action === 'CANCEL_WORKOUT' ? (
              <TrendingDown className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <TrendingUp className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            )}
            <div>
              <span className="font-semibold text-slate-900 dark:text-white">Impact charge hebdomadaire : </span>
              <span className="text-slate-600 dark:text-slate-300">
                {proposal.sourceContext.proposedWeeklyLoad != null
                  ? `${proposal.sourceContext.proposedWeeklyLoad} TSS`
                  : 'Charge optimisée'}
              </span>
            </div>
          </div>
          {proposal.loadIncreasePercent != null && (
            <span className="px-2 py-0.5 bg-indigo-200 dark:bg-indigo-800 text-indigo-900 dark:text-indigo-100 rounded font-bold">
              +{proposal.loadIncreasePercent}%
            </span>
          )}
        </div>
      )}

      {/* Mode Édition / Modification si l'athlète veut modifier avant de valider */}
      <AnimatePresence>
        {isEditing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3 bg-slate-100 dark:bg-slate-900 rounded-xl space-y-2 border border-slate-200 dark:border-slate-700 text-xs"
          >
            <div className="font-semibold text-slate-800 dark:text-slate-200">
              Personnaliser la proposition :
            </div>
            <div>
              <label className="block text-slate-500 mb-1">Durée cible (min) :</label>
              <input
                type="number"
                value={selectedDuration ?? ''}
                onChange={e => setSelectedDuration(Number(e.target.value))}
                className="w-full bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
                placeholder="Ex: 45"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">Motif ajusté :</label>
              <input
                type="text"
                value={customReason}
                onChange={e => setCustomReason(e.target.value)}
                className="w-full bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
              />
            </div>
            <div className="flex justify-end space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-2.5 py-1 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSaveModification}
                className="px-3 py-1 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700"
              >
                Appliquer modifications
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Barre d'action tripartite stricte : [Refuser] [Modifier] [Valider] */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
        <button
          type="button"
          id={`proposal-refuse-${proposal.id}`}
          onClick={() => onRefuse(proposal)}
          disabled={isLoading}
          className="flex items-center space-x-1.5 px-3 py-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl transition text-xs font-semibold"
        >
          <X className="w-4 h-4" />
          <span>Refuser</span>
        </button>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            id={`proposal-modify-${proposal.id}`}
            onClick={() => setIsEditing(!isEditing)}
            disabled={isLoading}
            className="flex items-center space-x-1.5 px-3 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition text-xs font-semibold border border-slate-300 dark:border-slate-600"
          >
            <Edit2 className="w-3.5 h-3.5" />
            <span>Modifier</span>
          </button>

          <button
            type="button"
            id={`proposal-validate-${proposal.id}`}
            onClick={() => onValidate(proposal)}
            disabled={isLoading}
            className="flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl shadow-sm transition text-xs font-bold disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            <span>Valider</span>
          </button>
        </div>
      </div>
    </div>
  );
};
