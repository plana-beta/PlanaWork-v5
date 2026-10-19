import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Zap,
  Heart,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Thermometer,
  ShieldAlert,
  Info,
  Calendar,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { PlannedWorkout, ActualWorkout } from '../domain/models';
import { WorkoutFeedback, WorkoutObservation } from '../domain/athleteHistoryTypes';
import { WorkoutReconciliationService } from '../services/WorkoutReconciliationService';
import { WorkoutReconciliationResult } from '../domain/workoutReconciliationTypes';
import { useAppStore } from '../store';
import { coachService } from '../services/coachService';

interface WorkoutReconciliationModalProps {
  isOpen: boolean;
  onClose: () => void;
  plannedWorkout?: PlannedWorkout | null;
  actualWorkout?: ActualWorkout | null;
  onOpenCoach?: (initialPrompt?: string) => void;
}

export const WorkoutReconciliationModal: React.FC<WorkoutReconciliationModalProps> = ({
  isOpen,
  onClose,
  plannedWorkout,
  actualWorkout,
  onOpenCoach
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [feedbackRpe, setFeedbackRpe] = useState<number>(6);
  const [feedbackFeeling, setFeedbackFeeling] = useState<string>('good');
  const [feedbackComment, setFeedbackComment] = useState<string>('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [isExecutingProposal, setIsExecutingProposal] = useState(false);
  const [proposalExecuted, setProposalExecuted] = useState(false);

  const plannedWorkouts = useAppStore(s => s.plannedWorkouts);
  const actualWorkouts = useAppStore(s => s.actualWorkouts);
  const workoutFeedbacks = useAppStore(s => s.workoutFeedbacks);
  const addWorkoutFeedback = useAppStore(s => s.addWorkoutFeedback);
  const ftp = useAppStore(s => s.ftp);
  const hrMax = useAppStore(s => s.athleteProfile?.hrMax);

  // Trouver l'activité réelle si seulement la séance planifiée a été passée
  const targetActual = useMemo(() => {
    if (actualWorkout) return actualWorkout;
    if (!plannedWorkout) return null;
    return actualWorkouts.find(
      a => a.plannedWorkoutId === plannedWorkout.id ||
           (a.date === plannedWorkout.date && a.sport === plannedWorkout.sport)
    ) || null;
  }, [actualWorkout, plannedWorkout, actualWorkouts]);

  // Trouver la séance planifiée si seulement l'activité réelle a été passée
  const targetPlanned = useMemo(() => {
    if (plannedWorkout) return plannedWorkout;
    if (!targetActual) return null;
    return plannedWorkouts.find(
      p => p.id === targetActual.plannedWorkoutId ||
           (p.date === targetActual.date && p.sport === targetActual.sport)
    ) || null;
  }, [plannedWorkout, targetActual, plannedWorkouts]);

  // Trouver le feedback existant
  const existingFeedback = useMemo(() => {
    return workoutFeedbacks.find(
      f => (targetActual && f.actualWorkoutId === targetActual.id) ||
           (targetPlanned && f.workoutId === targetPlanned.id) ||
           (targetActual && f.date === targetActual.date && f.sport === targetActual.sport)
    );
  }, [workoutFeedbacks, targetActual, targetPlanned]);

  // Rapprochement déterministe
  const reconciliation: WorkoutReconciliationResult | null = useMemo(() => {
    if (!targetActual) return null;
    return WorkoutReconciliationService.reconcile({
      actualWorkout: targetActual,
      plannedWorkouts,
      feedback: existingFeedback,
      athleteFtp: ftp,
      athleteHrMax: hrMax
    });
  }, [targetActual, plannedWorkouts, existingFeedback, ftp, hrMax]);

  if (!isOpen) return null;

  const handleSaveFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetActual && !targetPlanned) return;

    setIsSubmittingFeedback(true);
    const dateStr = targetActual?.date || targetPlanned?.date || new Date().toISOString().split('T')[0];
    const sport = targetActual?.sport || targetPlanned?.sport || 'Ride';

    const newFb: WorkoutFeedback = {
      id: existingFeedback?.id || `fb-${Date.now()}`,
      actualWorkoutId: targetActual?.id,
      workoutId: targetPlanned?.id,
      date: dateStr,
      sport,
      durationMin: targetActual?.durationMin || targetPlanned?.targetDurationMin || 45,
      distanceKm: targetActual?.distanceKm || targetPlanned?.distanceKm,
      rpe: feedbackRpe,
      feeling: feedbackFeeling,
      comment: feedbackComment.trim() || undefined,
      temperature: targetActual?.temperature,
      createdAt: existingFeedback?.createdAt || new Date().toISOString()
    };

    addWorkoutFeedback(newFb);
    setIsSubmittingFeedback(false);
    setFeedbackSaved(true);
    setTimeout(() => setFeedbackSaved(false), 2500);
  };

  const handleApplyAdaptation = () => {
    if (!reconciliation?.proposedAdaptation) return;
    setIsExecutingProposal(true);
    try {
      coachService.executeProposal(reconciliation.proposedAdaptation, {
        userMessage: "Validation de l'adaptation post-séance"
      });
      setProposalExecuted(true);
    } finally {
      setIsExecutingProposal(false);
    }
  };

  const getTssBadge = (tssInfo: WorkoutReconciliationResult['tssInfo']) => {
    switch (tssInfo.status) {
      case 'MEASURED_OR_IMPORTED':
        return {
          bg: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
          label: 'Mesuré / Importé'
        };
      case 'DETERMINISTICALLY_CALCULATED':
        return {
          bg: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
          label: 'Calcul déterministe (NP/HR)'
        };
      case 'ESTIMATED':
        return {
          bg: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800',
          label: 'Estimé (durée)'
        };
      default:
        return {
          bg: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200',
          label: 'Indisponible'
        };
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-6"
      >
        {/* En-tête */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Post-Workout Intelligence
              </span>
              {reconciliation?.status === 'MATCH_CONFIRMED' && (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Rapprochée
                </span>
              )}
              {reconciliation?.status === 'MATCH_AMBIGUOUS' && (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  Ambiguïté
                </span>
              )}
            </div>
            <h3 className="font-black text-slate-900 dark:text-white text-lg">
              {targetPlanned?.title || targetActual?.title || 'Détail de la Séance'}
            </h3>
            <p className="text-xs text-slate-500">
              {targetActual?.date || targetPlanned?.date} • {targetActual?.sport || targetPlanned?.sport}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition touch-manipulation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corps */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Cas 1 : Aucune activité réelle enregistrée */}
          {!targetActual && (
            <div className="p-6 text-center space-y-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                <Clock className="w-6 h-6" />
              </div>
              <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                Aucune activité réelle enregistrée
              </h4>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                Cette séance est planifiée ({targetPlanned?.targetDurationMin || 0} min, ~{targetPlanned?.targetTss || 0} TSS), mais aucun enregistrement GPS, FIT, cardio ou saisie réelle n'y est associé.
              </p>
            </div>
          )}

          {/* Cas 2 : Activité réelle disponible avec rapprochement */}
          {targetActual && reconciliation && (
            <>
              {/* Carte Prévu vs Réalisé */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  <span>Prévu au Plan</span>
                  <span>Réalisé</span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Durée cible</span>
                    <strong className="text-base text-slate-800 dark:text-slate-200 font-black">
                      {targetPlanned ? `${targetPlanned.targetDurationMin || targetPlanned.durationMin || 0} min` : 'Non planifiée'}
                    </strong>
                    {targetPlanned?.targetTss && (
                      <span className="text-[11px] text-slate-500 block mt-0.5">
                        ~{targetPlanned.targetTss} TSS
                      </span>
                    )}
                  </div>

                  <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Durée réelle</span>
                    <strong className="text-base text-indigo-600 dark:text-indigo-400 font-black">
                      {targetActual.durationMin} min
                    </strong>
                    {targetActual.tss !== undefined && (
                      <span className="text-[11px] text-indigo-600/80 block mt-0.5 font-bold">
                        {targetActual.tss} TSS
                      </span>
                    )}
                  </div>
                </div>

                {/* Badge Qualité & Provenance du TSS */}
                {reconciliation.tssInfo.actualTss !== undefined && (
                  <div className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${getTssBadge(reconciliation.tssInfo).bg}`}>
                    <div className="flex items-center gap-1.5 font-bold">
                      <Zap className="w-3.5 h-3.5 shrink-0" />
                      <span>Charge : {reconciliation.tssInfo.actualTss} TSS</span>
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-white/60 dark:bg-black/30">
                      {getTssBadge(reconciliation.tssInfo).label}
                    </span>
                  </div>
                )}

                {/* Avertissement TSS estimé */}
                {reconciliation.tssInfo.isEstimatedOnly && (
                  <div className="p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-2">
                    <Info className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                    <p>{reconciliation.tssInfo.reliabilityWarning}</p>
                  </div>
                )}
              </div>

              {/* Écarts notables & Observations déterministes */}
              {reconciliation.observations.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Observations Déterministes ({reconciliation.observations.length})
                  </span>
                  <div className="space-y-1.5">
                    {reconciliation.observations.map(obs => (
                      <div
                        key={obs.id}
                        className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs flex items-start gap-2.5"
                      >
                        <AlertTriangle className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-slate-800 dark:text-slate-200 block">
                            {obs.title}
                          </strong>
                          <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                            {obs.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Proposition d'adaptation si fatigue ou surcharge */}
              {reconciliation.proposedAdaptation && !proposalExecuted && (
                <div className="p-4 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-2xl space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-indigo-900 dark:text-indigo-300">
                    <Sparkles className="w-4 h-4 text-indigo-600" />
                    <span>Conseil Adaptatif du Coach</span>
                  </div>
                  <p className="text-xs text-indigo-950 dark:text-indigo-200 font-medium leading-relaxed">
                    {reconciliation.proposedAdaptation.summary}
                  </p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                    {reconciliation.proposedAdaptation.physiologicalRationale}
                  </p>
                  <button
                    type="button"
                    onClick={handleApplyAdaptation}
                    disabled={isExecutingProposal}
                    className="w-full min-h-[44px] py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 touch-manipulation shadow-sm"
                  >
                    <span>{isExecutingProposal ? "Application..." : "Valider l'adaptation suggérée"}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {proposalExecuted && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 rounded-xl flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Adaptation validée et appliquée avec succès dans votre planning.</span>
                </div>
              )}

              {/* Formulaire de Feedback Athlète (facultatif) */}
              <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
                    Ressenti Athlète post-séance (Facultatif)
                  </span>
                  {feedbackSaved && (
                    <span className="text-[11px] text-emerald-600 font-bold">Enregistré ✓</span>
                  )}
                </div>

                <form onSubmit={handleSaveFeedback} className="space-y-3">
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                      <span>Effort perçu (RPE) :</span>
                      <strong className="text-slate-800 dark:text-slate-200">{feedbackRpe} / 10</strong>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={feedbackRpe}
                      onChange={(e) => setFeedbackRpe(parseInt(e.target.value, 10))}
                      className="w-full accent-indigo-600"
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { id: 'very_good', label: 'Très bien' },
                      { id: 'good', label: 'Bien' },
                      { id: 'tired', label: 'Fatigué' },
                      { id: 'very_tired', label: 'Épuisé' }
                    ].map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFeedbackFeeling(f.id)}
                        className={`min-h-[38px] py-1.5 text-[11px] font-semibold rounded-lg border transition touch-manipulation ${
                          feedbackFeeling === f.id
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <input
                    type="text"
                    placeholder="Commentaire ou ressenti libre (optionnel)..."
                    value={feedbackComment}
                    onChange={(e) => setFeedbackComment(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />

                  <button
                    type="submit"
                    disabled={isSubmittingFeedback}
                    className="w-full min-h-[44px] py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition touch-manipulation"
                  >
                    {isSubmittingFeedback ? "Enregistrement..." : "Enregistrer mon ressenti"}
                  </button>
                </form>
              </div>

              {/* Section secondaire pliable : Détails techniques & provenance */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full p-3.5 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 transition touch-manipulation"
                >
                  <span>Détails techniques & Provenance des données</span>
                  {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                <AnimatePresence>
                  {showAdvanced && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="p-4 space-y-2.5 text-xs text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900"
                    >
                      <p>• <strong>Identifiant réel :</strong> {targetActual.id}</p>
                      <p>• <strong>Source :</strong> {targetActual.source || 'Saisie locale'}</p>
                      <p>• <strong>Rapprochement :</strong> {reconciliation.matchReason}</p>
                      <p>• <strong>Calcul TSS :</strong> {reconciliation.tssInfo.sourceDescription}</p>

                      {reconciliation.context.hasTemperature ? (
                        <p className="flex items-center gap-1.5 text-indigo-600">
                          <Thermometer className="w-3.5 h-3.5" />
                          <span>Température mesurée : {reconciliation.context.temperature}°C ({reconciliation.context.temperatureSource})</span>
                        </p>
                      ) : (
                        <p className="text-slate-400">• Température ambiante : non enregistrée</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}

          {/* Bouton Coach approfondi */}
          {onOpenCoach && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenCoach(`Analyse ma séance de ${targetActual?.sport || targetPlanned?.sport || 'sport'} du ${targetActual?.date || targetPlanned?.date}.`);
              }}
              className="w-full min-h-[44px] py-3 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition hover:opacity-90 active:scale-95 touch-manipulation"
            >
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span>Demander une analyse approfondie au Coach</span>
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
};
