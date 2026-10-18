import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Bot, AlertCircle, CheckCircle2, History, HelpCircle, Sparkles } from 'lucide-react';
import { coachService } from '../services/coachService';
import { CoachProposal, CoachQuestion } from '../domain/coachTypes';
import { CoachProposalCard } from '../components/CoachProposalCard';
import { CoachAuditModal } from '../components/CoachAuditModal';
import { useAppStore } from '../store';

interface ChatMessage {
  id: string;
  sender: 'user' | 'coach';
  text: string;
  action?: string | null;
  proposal?: CoachProposal | null;
  proposalStatus?: 'pending' | 'accepted' | 'refused' | 'modified';
  questions?: CoachQuestion[];
  answeredQuestionId?: string;
  timestamp: Date;
}

const QUICK_PROMPTS = [
  "Que dois-je faire aujourd'hui ?",
  "Fais ce que tu penses être le mieux",
  "Je suis trop fatigué aujourd'hui",
  "Pourquoi cette séance ?"
];

export default function CoachView() {
  const plannedWorkouts = useAppStore(state => state.plannedWorkouts);
  const coachDecisions = useAppStore(state => state.coachDecisions || []);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init-1',
      sender: 'coach',
      text: "Salut ! Je suis ton Coach Plana. Je base mes conseils uniquement sur tes données physiologiques réelles et ta progression. Pose-moi une question sur ton état de forme, ton plan d'entraînement, ou tes sensations.",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);

  const sendMessage = async (userText: string) => {
    if (!userText.trim() || isLoading) return;

    setError(null);
    setSuccessNotice(null);

    const newUserMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: userText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, newUserMsg]);
    setIsLoading(true);

    const response = await coachService.askCoach(userText);
    setIsLoading(false);

    if (response.success) {
      if (response.proposal && response.validationResult) {
        // Enregistrer la proposition dans l'audit (PROPOSED)
        useAppStore.getState().addCoachDecision?.({
          id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          createdAt: new Date().toISOString(),
          userMessage: userText,
          proposal: response.proposal,
          validationResult: response.validationResult,
          userDecision: 'PROPOSED'
        });
      }

      setMessages(prev => [...prev, {
        id: `c-${Date.now()}`,
        sender: 'coach',
        text: response.message,
        action: response.suggestedAction,
        proposal: response.validationResult?.valid ? response.proposal : null,
        proposalStatus: response.validationResult?.valid ? 'pending' : undefined,
        questions: response.questions,
        timestamp: new Date()
      }]);
    } else {
      setError(response.message || "Erreur de connexion au coach.");
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const userText = input.trim();
    if (!userText) return;
    setInput('');
    await sendMessage(userText);
  };

  // Traitement d'un clic sur une option de question de clarification
  const handleSelectOption = async (questionId: string, optionValue: string, optionLabel: string) => {
    setError(null);
    setSuccessNotice(null);

    // Ajouter message utilisateur correspondant
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: optionLabel,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    const turn = coachService.answerQuestion(questionId, optionValue);
    setIsLoading(false);

    if (turn.proposal) {
      const val = coachService.validateProposal(turn.proposal);
      useAppStore.getState().addCoachDecision?.({
        id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        createdAt: new Date().toISOString(),
        userMessage: optionLabel,
        proposal: turn.proposal,
        validationResult: val,
        userDecision: 'PROPOSED'
      });
    }

    setMessages(prev => [...prev, {
      id: `c-${Date.now()}`,
      sender: 'coach',
      text: turn.coachResponse,
      action: turn.suggestedAction,
      proposal: turn.proposal,
      proposalStatus: turn.proposal ? 'pending' : undefined,
      questions: turn.questions,
      answeredQuestionId: questionId,
      timestamp: new Date()
    }]);
  };

  // Traitement [Valider] - Déclenche CoachActionExecutor uniquement après validation explicite
  const handleValidateProposal = (messageId: string, proposal: CoachProposal) => {
    setIsExecuting(true);
    setError(null);

    try {
      const result = coachService.executeProposal(proposal, {
        userMessage: messages.find(m => m.id === messageId)?.text
      });

      if (result.success) {
        setMessages(prev =>
          prev.map(m =>
            m.id === messageId ? { ...m, proposalStatus: 'accepted' } : m
          )
        );
        setSuccessNotice(
          `${result.message} Ta charge hebdomadaire cible est maintenant de ${result.recalculatedWeeklyLoad} TSS.`
        );
      } else {
        setError(`Échec de l'ajustement du plan : ${result.message}`);
      }
    } catch (err: any) {
      setError(`Erreur lors de l'exécution : ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // Traitement [Refuser] - Aucune modification du store de planning, traçabilité REJECTED
  const handleRefuseProposal = (messageId: string, proposal: CoachProposal) => {
    useAppStore.getState().addCoachDecision?.({
      id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      createdAt: new Date().toISOString(),
      proposal,
      validationResult: { valid: true, errors: [], warnings: [] },
      userDecision: 'REJECTED'
    });

    setMessages(prev =>
      prev.map(m =>
        m.id === messageId ? { ...m, proposalStatus: 'refused' } : m
      )
    );
  };

  // Traitement [Modifier] - Traçabilité MODIFIED
  const handleModifyProposal = (messageId: string, updatedProposal: CoachProposal) => {
    useAppStore.getState().addCoachDecision?.({
      id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      createdAt: new Date().toISOString(),
      proposal: updatedProposal,
      validationResult: { valid: true, errors: [], warnings: [] },
      userDecision: 'MODIFIED',
      appliedChanges: updatedProposal.proposedModifications
    });

    setMessages(prev =>
      prev.map(m =>
        m.id === messageId
          ? { ...m, proposal: updatedProposal, proposalStatus: 'modified' }
          : m
      )
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 pb-20">
      {/* Header */}
      <div className="p-4 bg-white dark:bg-slate-800 shadow-sm z-10 flex items-center justify-between sticky top-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 rounded-lg">
            <Bot className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Coach IA Plana</h1>
            <p className="text-xs text-slate-500">Moteur conversationnel d'adaptation et explications</p>
          </div>
        </div>

        <button
          type="button"
          id="coach-audit-history-button"
          onClick={() => setShowAuditModal(true)}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold transition"
          title="Consulter l'historique des propositions et décisions"
        >
          <History className="w-4 h-4" />
          <span className="hidden sm:inline">Historique</span>
          {coachDecisions.length > 0 && (
            <span className="ml-1 px-1.5 py-0.2 bg-indigo-600 text-white rounded-full text-[10px]">
              {coachDecisions.length}
            </span>
          )}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div className={`max-w-[90%] md:max-w-[85%] rounded-2xl px-4 py-3 ${
              msg.sender === 'user' 
                ? 'bg-indigo-600 text-white rounded-br-none' 
                : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 shadow-sm border border-slate-100 dark:border-slate-700 rounded-bl-none'
            }`}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.text}</p>
              
              {/* Questions de clarification interactives (0 à 2 max) */}
              {msg.questions && msg.questions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 space-y-2.5">
                  {msg.questions.map((q) => (
                    <div key={q.id} className="text-xs">
                      <p className="font-semibold text-indigo-600 dark:text-indigo-400 mb-1.5 flex items-center gap-1.5">
                        <HelpCircle className="w-3.5 h-3.5" />
                        {q.text}
                      </p>
                      {q.options && q.options.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {q.options.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => handleSelectOption(q.id, opt.value, opt.label)}
                              className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-medium transition border border-indigo-200 dark:border-indigo-800"
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {msg.action && msg.sender === 'coach' && (
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-xs font-medium text-indigo-500 dark:text-indigo-400 uppercase tracking-wider">Action suggérée :</span>
                  <div className="mt-1 inline-block px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-xs">
                    {msg.action}
                  </div>
                </div>
              )}
            </div>

            {/* Carte de proposition Coach Avant / Après / Pourquoi / Impact */}
            {msg.proposal && (
              <div className="w-full max-w-[90%] md:max-w-[85%]">
                {msg.proposalStatus === 'accepted' ? (
                  <div className="mt-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-300 text-xs flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                    <span>Cette proposition a été validée et le nouvel agenda a été appliqué.</span>
                  </div>
                ) : msg.proposalStatus === 'refused' ? (
                  <div className="mt-2 p-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-500 dark:text-slate-400 text-xs">
                    Proposition refusée. Ton planning d'origine est conservé intact.
                  </div>
                ) : (
                  <CoachProposalCard
                    proposal={msg.proposal}
                    plannedWorkouts={plannedWorkouts}
                    onValidate={(p) => handleValidateProposal(msg.id, p)}
                    onRefuse={(p) => handleRefuseProposal(msg.id, p)}
                    onModify={(p) => handleModifyProposal(msg.id, p)}
                    isLoading={isExecuting}
                  />
                )}
              </div>
            )}
          </motion.div>
        ))}
        
        {isLoading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
            <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm border border-slate-100 dark:border-slate-700">
              <div className="flex space-x-2 items-center h-5">
                <div className="w-2 h-2 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </motion.div>
        )}

        {successNotice && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center my-4">
            <div className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 px-4 py-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center space-x-2 text-sm max-w-[85%]">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successNotice}</span>
            </div>
          </motion.div>
        )}

        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center my-4">
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-4 py-2 rounded-lg flex items-center space-x-2 text-sm max-w-[85%]">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          </motion.div>
        )}
      </div>

      {/* Quick Prompts */}
      <div className="px-4 py-2 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm border-t border-slate-200/50 dark:border-slate-700/50 overflow-x-auto flex gap-2 no-scrollbar">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => sendMessage(prompt)}
            disabled={isLoading || isExecuting}
            className="whitespace-nowrap px-3 py-1.5 bg-white dark:bg-slate-700 hover:bg-indigo-50 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 hover:text-indigo-600 rounded-full text-xs border border-slate-200 dark:border-slate-600 transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <Sparkles className="w-3 h-3 text-indigo-500" />
            {prompt}
          </button>
        ))}
      </div>

      {/* Input bar */}
      <div className="p-4 bg-white dark:bg-slate-800 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10 sticky bottom-0">
        <form onSubmit={handleSend} className="flex space-x-2 relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Demande une explication ou une adaptation (ex: fatigué, séance manquée)..."
            className="flex-1 bg-slate-100 dark:bg-slate-900 border-none rounded-full px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 dark:text-white"
            disabled={isLoading || isExecuting}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || isExecuting}
            className="p-3 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>

      <CoachAuditModal
        isOpen={showAuditModal}
        onClose={() => setShowAuditModal(false)}
        decisions={coachDecisions}
      />
    </div>
  );
}
