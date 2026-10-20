import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, AlertTriangle, ArrowRight, ShieldAlert, Sparkles, TrendingUp, Info } from 'lucide-react';
import { ProgressionProposal } from '../domain/trainingProgressionTypes';
import { TrainingProgressionService } from '../services/TrainingProgressionService';
import { cn } from '../utils';

interface ProgressionProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  proposal: ProgressionProposal | null;
  onExecuted?: (proposal: ProgressionProposal) => void;
  onRejected?: (proposal: ProgressionProposal) => void;
  athleteId?: string;
}

export const ProgressionProposalModal: React.FC<ProgressionProposalModalProps> = ({
  isOpen,
  onClose,
  proposal,
  onExecuted,
  onRejected,
  athleteId = 'current-athlete'
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userComment, setUserComment] = useState('');

  if (!isOpen || !proposal) return null;

  const handleAcceptAndExecute = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // 1. Acceptation explicite
      const acceptRes = TrainingProgressionService.acceptProposal(proposal.id, athleteId, {
        userMessage: userComment || "Proposition acceptée par l'athlète"
      });

      if (!acceptRes.success) {
        throw new Error(acceptRes.error || "Impossible d'enregistrer l'acceptation de la proposition.");
      }

      // 2. Exécution transactionnelle
      const execRes = TrainingProgressionService.executeProposal(proposal.id, athleteId);

      if (!execRes.success) {
        if (execRes.conflict) {
          throw new Error("Conflit détecté : La séance cible ou l'objectif a été modifié depuis la formulation de la proposition. Veuillez rafraîchir.");
        }
        throw new Error(execRes.error || "Échec de l'application transactionnelle de la proposition.");
      }

      if (onExecuted && execRes.proposal) {
        onExecuted(execRes.proposal);
      }
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Une erreur est survenue lors de l'application de la proposition.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const rejectRes = TrainingProgressionService.rejectProposal(
        proposal.id,
        athleteId,
        userComment || "Refus explicite de l'athlète"
      );

      if (!rejectRes.success) {
        throw new Error(rejectRes.error || "Impossible d'enregistrer le refus.");
      }

      if (onRejected && rejectRes.proposal) {
        onRejected(rejectRes.proposal);
      }
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Une erreur est survenue.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="bg-white rounded-[32px] max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-100 flex flex-col"
        >
          {/* Header */}
          <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-md z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <TrendingUp size={20} />
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Proposition d'évolution • {proposal.type}
                </span>
                <h3 className="text-base font-black text-plana-black tracking-tight">{proposal.title}</h3>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Erreur */}
            {errorMessage && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3 text-xs text-red-700 font-medium">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>{errorMessage}</div>
              </div>
            )}

            {/* Justification lisible */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Justification de l'analyse
              </span>
              <p className="text-sm text-slate-700 font-medium leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                {proposal.justification}
              </p>
            </div>

            {/* Comparatif Avant / Après */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Ajustement proposé
              </span>
              <div className="p-4 bg-amber-50/60 border border-amber-200/60 rounded-2xl flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Actuel</div>
                  <div className="text-sm font-bold text-slate-600">{proposal.currentAndProposedValues.currentValue}</div>
                </div>
                <ArrowRight size={20} className="text-amber-500" />
                <div className="text-right">
                  <div className="text-[10px] font-bold text-amber-700 uppercase">Proposé</div>
                  <div className="text-sm font-black text-amber-800">{proposal.currentAndProposedValues.proposedValue}</div>
                </div>
              </div>
            </div>

            {/* Observations factuelles */}
            {proposal.factualObservations.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Faits observés à la base de la proposition
                </span>
                <div className="space-y-1.5">
                  {proposal.factualObservations.map((obs, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-slate-600 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                      <span>{obs}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risques et limites */}
            {proposal.risksAndLimits.length > 0 && (
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Limites & Précaution
                </span>
                {proposal.risksAndLimits.map((risk, idx) => (
                  <p key={idx} className="text-xs text-slate-500 font-medium">
                    • {risk}
                  </p>
                ))}
              </div>
            )}

            {/* Champ de commentaire optionnel */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Commentaire ou motif de décision (optionnel)
              </label>
              <textarea
                value={userComment}
                onChange={(e) => setUserComment(e.target.value)}
                placeholder="Ex : Je me sens en forme pour absorber cette hausse..."
                rows={2}
                className="w-full text-xs p-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>
          </div>

          {/* Footer actions avec double validation explicite */}
          <div className="p-6 border-t border-gray-100 flex flex-col sm:flex-row gap-3 bg-white sticky bottom-0">
            <button
              onClick={handleReject}
              disabled={isSubmitting}
              className="flex-1 py-3 px-4 rounded-2xl border border-slate-200 text-slate-600 font-bold text-xs uppercase tracking-wider hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Conserver mon plan actuel
            </button>
            <button
              onClick={handleAcceptAndExecute}
              disabled={isSubmitting}
              className="flex-1 py-3 px-4 rounded-2xl bg-plana-black text-white font-bold text-xs uppercase tracking-wider hover:bg-slate-800 transition-colors shadow-lg shadow-black/10 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span>Valider & Appliquer</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
