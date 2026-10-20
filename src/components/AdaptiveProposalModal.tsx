import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Zap,
  ArrowRight,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Info,
  Calendar,
  Activity
} from 'lucide-react';
import { AdaptiveProposal } from '../domain/adaptiveTrainingTypes';
import { AdaptiveTrainingService } from '../services/AdaptiveTrainingService';
import { useAppStore } from '../store';

interface AdaptiveProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  proposal: AdaptiveProposal | null;
  onExecuted?: (proposal: AdaptiveProposal) => void;
  onRejected?: (proposal: AdaptiveProposal) => void;
}

export const AdaptiveProposalModal: React.FC<AdaptiveProposalModalProps> = ({
  isOpen,
  onClose,
  proposal,
  onExecuted,
  onRejected
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [executionState, setExecutionState] = useState<'idle' | 'accepted' | 'executed' | 'rejected' | 'conflict' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');

  const athleteProfile = useAppStore(s => s.athleteProfile);
  const athleteId = athleteProfile?.id || proposal?.athleteId || 'current-athlete';

  if (!isOpen || !proposal) return null;

  const handleAcceptAndExecute = async () => {
    setIsProcessing(true);
    setStatusMessage("Validation de votre décision...");

    try {
      // Étape 1 : Acceptation formelle
      const acceptRes = AdaptiveTrainingService.acceptProposal(proposal.id, athleteId, {
        userMessage: "Validation explicite par l'athlète"
      });

      if (!acceptRes.success) {
        if (acceptRes.expired) {
          setExecutionState('error');
          setStatusMessage("Cette proposition a expiré. Le planning est resté inchangé.");
          return;
        }
        setExecutionState('error');
        setStatusMessage(acceptRes.error || "Impossible d'accepter cette proposition.");
        return;
      }

      setExecutionState('accepted');
      setStatusMessage("Proposition acceptée. Application transactionnelle au planning...");

      // Petite pause visuelle pour bien distinguer ACCEPTED de EXECUTED
      await new Promise(resolve => setTimeout(resolve, 350));

      // Étape 2 : Exécution transactionnelle
      const execRes = AdaptiveTrainingService.executeProposal(proposal.id, athleteId);

      if (!execRes.success) {
        if (execRes.conflict) {
          setExecutionState('conflict');
          setStatusMessage("Conflit détecté : la séance cible a été modifiée entre-temps. Aucune modification partielle n'a été appliquée.");
          return;
        }
        setExecutionState('error');
        setStatusMessage(execRes.error || "Échec de l'application au planning.");
        return;
      }

      setExecutionState('executed');
      setStatusMessage(execRes.message || "Planning ajusté avec succès.");
      onExecuted?.(execRes.proposal || proposal);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = () => {
    setIsProcessing(true);
    try {
      const rejectRes = AdaptiveTrainingService.rejectProposal(proposal.id, athleteId, "Refus explicite de l'athlète");
      setExecutionState('rejected');
      setStatusMessage("Proposition refusée. Votre planning d'origine est strictement conservé.");
      onRejected?.(rejectRes.proposal || proposal);
    } finally {
      setIsProcessing(false);
    }
  };

  const orig = proposal.proposedChanges.originalWorkout;
  const prop = proposal.proposedChanges.proposedWorkout;
  const ba = proposal.proposedChanges.beforeAfter;

  const getUncertaintyBadge = () => {
    switch (proposal.uncertaintyLevel) {
      case 'LOW':
        return { label: 'Confiance élevée', bg: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' };
      case 'MEDIUM':
        return { label: 'Confiance modérée', bg: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' };
      case 'HIGH':
        return { label: 'Incertitude élevée (TSS estimé)', bg: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' };
      default:
        return { label: 'Données partielles', bg: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };
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
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Intelligence Adaptative
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getUncertaintyBadge().bg}`}>
                  {getUncertaintyBadge().label}
                </span>
              </div>
              <h3 className="font-black text-slate-900 dark:text-white text-base">
                Proposition d'Adaptation
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition touch-manipulation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* État normal (en attente) */}
          {executionState === 'idle' && (
            <>
              {/* Synthèse de la recommandation */}
              <div className="p-4 bg-indigo-50/70 dark:bg-indigo-950/30 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 space-y-2">
                <h4 className="text-sm font-bold text-indigo-950 dark:text-indigo-200 leading-snug">
                  {proposal.rationale}
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {proposal.detailedExplanation}
                </p>
              </div>

              {/* Comparaison Avant / Après */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Ajustement proposé pour le {orig.date}
                </span>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  {/* Séance actuelle */}
                  <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      Programme Actuel
                    </span>
                    <strong className="text-slate-800 dark:text-slate-200 block text-sm">
                      {orig.title}
                    </strong>
                    <div className="text-slate-500 space-y-0.5 text-[11px]">
                      <p>• Durée : <strong>{orig.durationMin} min</strong></p>
                      {orig.targetTss && <p>• Charge : ~{orig.targetTss} TSS</p>}
                      {orig.intensity && <p>• Intensité : {orig.intensity}</p>}
                    </div>
                  </div>

                  {/* Séance adaptée */}
                  <div className="p-3.5 bg-indigo-50/50 dark:bg-indigo-950/40 rounded-2xl border border-indigo-200 dark:border-indigo-800/60 space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block">
                      Version Proposée
                    </span>
                    <strong className="text-indigo-950 dark:text-indigo-200 block text-sm">
                      {prop.title}
                    </strong>
                    <div className="text-indigo-900/80 dark:text-indigo-300 space-y-0.5 text-[11px]">
                      {ba.isRecoveryDay ? (
                        <p className="font-bold text-emerald-600 dark:text-emerald-400">• Repos complet / Régénération</p>
                      ) : (
                        <>
                          <p>• Durée : <strong className="text-indigo-600 dark:text-indigo-400">{prop.durationMin} min</strong></p>
                          {prop.targetTss !== undefined && <p>• Charge : ~{prop.targetTss} TSS</p>}
                          {prop.intensity && <p>• Intensité : {prop.intensity}</p>}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Avertissement sur les limites & incertitudes */}
              {proposal.dataProvenance.warnings.length > 0 && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <span className="font-bold block">Limites des données :</span>
                    <p>{proposal.dataProvenance.warnings[0]}</p>
                  </div>
                </div>
              )}

              {/* Section secondaire pliable : Observations factuelles */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowDetails(!showDetails)}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 transition touch-manipulation"
                >
                  <span>Observations & Faits déclencheurs ({proposal.triggerObservations.length})</span>
                  {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                <AnimatePresence>
                  {showDetails && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="p-3.5 space-y-2 text-xs bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-400"
                    >
                      {proposal.triggerObservations.length > 0 ? (
                        proposal.triggerObservations.map(obs => (
                          <div key={obs.id} className="p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
                            <strong className="block text-slate-800 dark:text-slate-200">{obs.title}</strong>
                            <span className="text-[11px] text-slate-500">{obs.description}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-slate-400 italic">Aucune observation négative isolée ; adaptation basée sur la tendance globale.</p>
                      )}
                      <p className="text-[10px] text-slate-400 pt-1">
                        • Provenance : {proposal.dataProvenance.sources.join(', ') || 'Saisie locale'}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Actions : Accepter / Refuser */}
              <div className="flex items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={isProcessing}
                  className="flex-1 min-h-[44px] py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition touch-manipulation"
                >
                  Refuser l'adaptation
                </button>

                <button
                  type="button"
                  onClick={handleAcceptAndExecute}
                  disabled={isProcessing}
                  className="flex-1 min-h-[44px] py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm touch-manipulation"
                >
                  <span>{isProcessing ? "Application..." : "Accepter & Appliquer"}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

          {/* État : Proposition acceptée en cours d'exécution */}
          {executionState === 'accepted' && (
            <div className="py-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto animate-pulse">
                <Sparkles className="w-6 h-6" />
              </div>
              <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                Proposition acceptée
              </h4>
              <p className="text-xs text-slate-500">{statusMessage}</p>
            </div>
          )}

          {/* État : Proposition exécutée avec succès */}
          {executionState === 'executed' && (
            <div className="py-6 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-base">
                  Adaptation validée et appliquée
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {statusMessage}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[44px] py-3 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl text-xs font-bold hover:opacity-90 transition touch-manipulation"
              >
                Fermer
              </button>
            </div>
          )}

          {/* État : Proposition refusée */}
          {executionState === 'rejected' && (
            <div className="py-6 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 flex items-center justify-center mx-auto">
                <XCircle className="w-8 h-8" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-base">
                  Adaptation refusée
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {statusMessage}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[44px] py-3 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl text-xs font-bold hover:opacity-90 transition touch-manipulation"
              >
                Fermer
              </button>
            </div>
          )}

          {/* État : Conflit de modification concurrente */}
          {executionState === 'conflict' && (
            <div className="py-6 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-600 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <div>
                <h4 className="font-bold text-amber-900 dark:text-amber-200 text-base">
                  Conflit détecté
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                  {statusMessage}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[44px] py-3 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl text-xs font-bold hover:opacity-90 transition touch-manipulation"
              >
                Fermer et actualiser le planning
              </button>
            </div>
          )}

          {/* État : Erreur */}
          {executionState === 'error' && (
            <div className="py-6 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-600 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <div>
                <h4 className="font-bold text-rose-900 dark:text-rose-200 text-base">
                  Action impossible
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                  {statusMessage}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[44px] py-3 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl text-xs font-bold hover:opacity-90 transition touch-manipulation"
              >
                Fermer
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
