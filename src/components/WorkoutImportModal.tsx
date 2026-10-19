import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  UploadCloud,
  FileText,
  AlertTriangle,
  CheckCircle2,
  X,
  Activity,
  Calendar,
  Clock,
  Zap,
  Heart,
  HelpCircle,
  RefreshCw,
  FileCheck
} from 'lucide-react';
import { WorkoutFileImportService } from '../services/import/WorkoutFileImportService';
import { ImportAnalysisResult, ImportExecutionResult } from '../domain/workoutImportTypes';

interface WorkoutImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess?: (result: ImportExecutionResult) => void;
}

export const WorkoutImportModal: React.FC<WorkoutImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<ImportAnalysisResult | null>(null);
  const [executionResult, setExecutionResult] = useState<ImportExecutionResult | null>(null);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileSelected = async (file: File) => {
    setErrorMsg(null);
    setIsAnalyzing(true);
    setAnalysisResult(null);
    setExecutionResult(null);

    try {
      let content: ArrayBuffer | string;
      const lowerName = file.name.toLowerCase();

      // Pour les fichiers binaires (FIT, PDF, images)
      if (
        lowerName.endsWith('.fit') ||
        lowerName.endsWith('.pdf') ||
        lowerName.endsWith('.png') ||
        lowerName.endsWith('.jpg') ||
        lowerName.endsWith('.jpeg') ||
        lowerName.endsWith('.webp')
      ) {
        content = await file.arrayBuffer();
      } else {
        // Pour les fichiers textuels (TCX, GPX, CSV, JSON)
        content = await file.text();
      }

      const res = await WorkoutFileImportService.analyzeFile({
        name: file.name,
        size: file.size,
        content,
        mimeType: file.type
      });

      setAnalysisResult(res);

      if (res.status === 'invalid' || res.status === 'unsupported') {
        setErrorMsg(res.validationErrors[0] || res.summaryText);
      }
    } catch (e: any) {
      setErrorMsg(`Erreur de lecture du fichier : ${e.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleConfirmImport = () => {
    if (!analysisResult || isExecuting) return;

    setIsExecuting(true);
    try {
      const exec = WorkoutFileImportService.executeImport(analysisResult, {
        allowDuplicates
      });

      setExecutionResult(exec);
      if (exec.success && onImportSuccess) {
        onImportSuccess(exec);
      }
    } catch (e: any) {
      setErrorMsg(`Erreur lors de l'application de l'import : ${e.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleReset = () => {
    setAnalysisResult(null);
    setExecutionResult(null);
    setErrorMsg(null);
    setAllowDuplicates(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getFormatBadgeColor = (fmt: string) => {
    switch (fmt) {
      case 'fit': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
      case 'tcx': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
      case 'gpx': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
      case 'csv': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';
      case 'json': return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300';
      case 'pdf': return 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300';
      case 'image': return 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300';
      default: return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300';
    }
  };

  const getTssMethodLabel = (method: string) => {
    switch (method) {
      case 'provided': return 'TSS fourni';
      case 'power_np': return 'Puissance (NP)';
      case 'heart_rate': return 'Cardio (hrTSS)';
      case 'duration_estimate': return 'Estimé (durée)';
      default: return 'Non disponible';
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
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Import Universel de Séances
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                FIT, TCX, GPX, CSV, JSON, PDF & captures
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Étape A : Aucun fichier sélectionné -> Zone de dépôt */}
          {!analysisResult && !isAnalyzing && !executionResult && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`p-8 border-2 border-dashed rounded-3xl text-center cursor-pointer transition flex flex-col items-center justify-center gap-3 touch-manipulation ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 hover:bg-slate-50/50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <UploadCloud className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    Déposez votre fichier ici, ou touchez pour parcourir
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Fichiers acceptés jusqu'à 15 Mo
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".fit,.tcx,.gpx,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelected(e.target.files[0]);
                    }
                  }}
                />
              </div>

              {/* Badges des formats supportés */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Formats pris en charge avec calcul déterministe :
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { ext: 'FIT', desc: 'Garmin / Wahoo' },
                    { ext: 'TCX', desc: 'Garmin Training Center' },
                    { ext: 'GPX', desc: 'Traces GPS & altitude' },
                    { ext: 'CSV', desc: 'Tableaux multi-séances' },
                    { ext: 'JSON', desc: 'Strava / Garmin Export' },
                    { ext: 'PDF', desc: 'Rapports d\'entraînement' },
                    { ext: 'Captures', desc: 'Images OCR soumises à confirmation' }
                  ].map(fmt => (
                    <div
                      key={fmt.ext}
                      className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1 border border-slate-200 dark:border-slate-700"
                    >
                      <span className="font-bold text-slate-800 dark:text-slate-100">{fmt.ext}</span>
                      <span className="text-[10px] text-slate-400">({fmt.desc})</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-2xl text-[11px] text-amber-800 dark:text-amber-300 flex gap-2 items-start">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <p>
                  <strong>Confidentialité & Déterminisme :</strong> Vos fichiers sont traités localement.
                  TSS, NP et hrTSS sont calculés par le moteur Plana (TrainingEngine), sans envoi à Gemini.
                </p>
              </div>
            </div>
          )}

          {/* Étape B : Analyse en cours */}
          {isAnalyzing && (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                Analyse déterministe du fichier en cours...
              </p>
              <p className="text-xs text-slate-400">
                Validation du format, extraction des métriques et détection des doublons.
              </p>
            </div>
          )}

          {/* Étape C : Résultat d'analyse & Prévisualisation */}
          {analysisResult && !executionResult && (
            <div className="space-y-4">
              {/* Entête du fichier analysé */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="w-5 h-5 text-indigo-600 shrink-0" />
                  <div className="truncate">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                      {analysisResult.fileInfo.name}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {(analysisResult.fileInfo.sizeBytes / 1024).toFixed(1)} Ko
                    </p>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider ${getFormatBadgeColor(analysisResult.fileInfo.detectedFormat)}`}>
                  {analysisResult.fileInfo.detectedFormat}
                </span>
              </div>

              {/* Message d'erreur bloquant */}
              {errorMsg && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl text-xs text-rose-800 dark:text-rose-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                  <div>
                    <p className="font-bold">Impossible d'importer ce fichier :</p>
                    <p className="mt-0.5">{errorMsg}</p>
                  </div>
                </div>
              )}

              {/* Avertissement doublon */}
              {analysisResult.duplicateMatches.length > 0 && (
                <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs text-amber-900 dark:text-amber-200 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>Doublon potentiel détecté ({analysisResult.duplicateMatches.length})</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    {analysisResult.duplicateMatches[0].reason}
                  </p>
                  <label className="flex items-center gap-2 pt-1 cursor-pointer select-none text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={allowDuplicates}
                      onChange={(e) => setAllowDuplicates(e.target.checked)}
                      className="rounded border-amber-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Forcer l'import et conserver les deux séances</span>
                  </label>
                </div>
              )}

              {/* Avertissement incertitude (image ou PDF) */}
              {analysisResult.status === 'needs_confirmation' && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-2xl text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2">
                  <HelpCircle className="w-4 h-4 shrink-0 mt-0.5 text-blue-600" />
                  <div>
                    <p className="font-bold">Source documentaire / incertaine</p>
                    <p className="text-[11px] mt-0.5">
                      Les métriques ont été extraites par analyse textuelle. Vérifiez les valeurs ci-dessous avant de confirmer.
                    </p>
                  </div>
                </div>
              )}

              {/* Synthèse des séances extraites */}
              {analysisResult.normalizedWorkouts.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 px-1">
                    <span>Séances prêtes ({analysisResult.normalizedWorkouts.length})</span>
                    <span>
                      {analysisResult.metricsSummary.totalDurationMin} min • {analysisResult.metricsSummary.totalDistanceKm} km • ~{analysisResult.metricsSummary.totalEstimatedTss} TSS
                    </span>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {analysisResult.normalizedWorkouts.map((w, idx) => (
                      <div
                        key={w.id}
                        className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Activity className="w-3.5 h-3.5 text-indigo-600" />
                            {w.title}
                          </span>
                          <span className="text-[11px] text-slate-500">{w.date}</span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-700/60">
                          <div>
                            <span className="text-slate-400 block text-[10px]">Durée :</span>
                            <strong>{w.durationMin} min</strong>
                          </div>
                          {w.distanceKm && (
                            <div>
                              <span className="text-slate-400 block text-[10px]">Distance :</span>
                              <strong>{w.distanceKm} km</strong>
                            </div>
                          )}
                          <div>
                            <span className="text-slate-400 block text-[10px]">Charge :</span>
                            <strong className="text-indigo-600 dark:text-indigo-400">
                              {w.tss ? `${w.tss} TSS` : 'N/A'}
                            </strong>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1 text-[10px] text-slate-400">
                          <span>Méthode : {getTssMethodLabel(w.tssCalculationMethod)}</span>
                          {w.matchedPlannedWorkoutId && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                              ✓ Séance planifiée associée
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Boutons d'action */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={handleReset}
                  className="min-h-[44px] px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-xs font-semibold transition touch-manipulation"
                >
                  Choisir un autre fichier
                </button>

                {analysisResult.normalizedWorkouts.length > 0 && (
                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={isExecuting || (analysisResult.duplicateMatches.length > 0 && !allowDuplicates && analysisResult.normalizedWorkouts.length === analysisResult.duplicateMatches.length)}
                    className="min-h-[44px] px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold shadow-sm transition disabled:opacity-50 touch-manipulation flex items-center gap-1.5"
                  >
                    <FileCheck className="w-4 h-4" />
                    <span>
                      {isExecuting ? "Import en cours..." : `Confirmer l'import (${analysisResult.normalizedWorkouts.length})`}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Étape D : Succès de l'import */}
          {executionResult && (
            <div className="py-6 space-y-4 text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-base">
                  Importation terminée avec succès !
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {executionResult.message}
                </p>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl text-xs text-left space-y-1 border border-slate-100 dark:border-slate-700">
                <p>• <strong>{executionResult.importedCount}</strong> séance(s) ajoutée(s) à ton historique réel.</p>
                {executionResult.skippedDuplicatesCount > 0 && (
                  <p className="text-amber-600">• <strong>{executionResult.skippedDuplicatesCount}</strong> doublon(s) ignoré(s).</p>
                )}
                {executionResult.matchedPlannedCount > 0 && (
                  <p className="text-emerald-600">• <strong>{executionResult.matchedPlannedCount}</strong> associée(s) à ton planning prévu.</p>
                )}
                <p>• Courbe de forme (PMC : CTL/ATL/TSB) recalculée déterministement.</p>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[44px] py-3 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 active:scale-95 transition touch-manipulation"
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
