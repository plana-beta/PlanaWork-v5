import React from 'react';
import { motion } from 'motion/react';
import { X, CheckCircle, AlertOctagon, RotateCcw, Edit3, Clock } from 'lucide-react';
import { CoachDecision } from '../domain/coachTypes';

interface CoachAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  decisions: CoachDecision[];
}

export const CoachAuditModal: React.FC<CoachAuditModalProps> = ({
  isOpen,
  onClose,
  decisions
}) => {
  if (!isOpen) return null;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'EXECUTED':
      case 'ACCEPTED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            <CheckCircle className="w-3 h-3" />
            <span>{status === 'EXECUTED' ? 'Exécutée' : 'Acceptée'}</span>
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
            <RotateCcw className="w-3 h-3" />
            <span>Refusée</span>
          </span>
        );
      case 'MODIFIED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            <Edit3 className="w-3 h-3" />
            <span>Modifiée</span>
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
            <AlertOctagon className="w-3 h-3" />
            <span>Échec</span>
          </span>
        );
      case 'PROPOSED':
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">
            <Clock className="w-3 h-3" />
            <span>Proposée</span>
          </span>
        );
    }
  };

  return (
    <div
      id="coach-audit-modal-backdrop"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        id="coach-audit-modal-content"
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Historique des Décisions Coach
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Traçabilité complète des propositions, validations et modifications
            </p>
          </div>
          <button
            type="button"
            id="coach-audit-close"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {decisions.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              Aucune décision enregistrée pour le moment.
            </div>
          ) : (
            decisions.map(decision => (
              <div
                key={decision.id}
                id={`audit-item-${decision.id}`}
                className="p-3.5 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {getStatusBadge(decision.userDecision)}
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {decision.proposal.action}
                    </span>
                  </div>
                  <span className="text-slate-400">
                    {new Date(decision.createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="text-slate-700 dark:text-slate-300">
                  <strong>Motif : </strong>
                  <span>{decision.proposal.reason}</span>
                </div>

                {decision.proposal.explanation && (
                  <div className="text-slate-600 dark:text-slate-400 italic bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                    "{decision.proposal.explanation}"
                  </div>
                )}

                {decision.engineResult && (
                  <div className="text-emerald-700 dark:text-emerald-300 font-medium">
                    {decision.engineResult.message}
                  </div>
                )}

                {decision.error && (
                  <div className="text-red-600 dark:text-red-400">
                    Erreur : {decision.error}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-semibold hover:bg-slate-300 dark:hover:bg-slate-600 transition"
          >
            Fermer
          </button>
        </div>
      </motion.div>
    </div>
  );
};
