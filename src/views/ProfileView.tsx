import React from 'react';
import { motion } from 'motion/react';
import { useAppStore } from '../store';
import { generateRecommendations } from '../lib/recommendationEngine';
import { useMemo } from 'react';
import { Activity, Trophy, Zap, Watch, Edit2, LogOut, RefreshCw } from 'lucide-react';
import { healthService } from '../services/healthService';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function ProfileView() {
  const store = useAppStore();
  const profile = store.athleteProfile;
  const today = new Date();
  const recommendations = useMemo(() => generateRecommendations(store.athleteProfile, store.plannedWorkouts, store.actualWorkouts, store.pmc, today), [store, today]);
  const syncRec = recommendations.find(r => r.type === 'HEALTH_SYNC');
  const resetProfile = useAppStore(s => s.resetAthleteProfile);
  const syncStatus = useAppStore(s => s.syncStatus);
  const setSyncStatus = useAppStore(s => s.setSyncStatus);
  const lastSyncedAt = useAppStore(s => s.lastSyncedAt);
  const setLastSyncedAt = useAppStore(s => s.setLastSyncedAt);
  
  const [syncMessage, setSyncMessage] = React.useState('');

  const [syncStats, setSyncStats] = React.useState<any>(null);

  React.useEffect(() => {
  }, [setSyncStatus]);

  const handleSync = async () => {
    if (!profile || profile.dataConnection === 'none') return;
    setSyncStatus('syncing');
    setSyncMessage('Synchronisation...');
    setSyncStats(null);
    
    try {
      const res = await healthService.syncWorkouts(profile.dataConnection);
      if (res.success) {
        setSyncStatus('success');
        setLastSyncedAt(new Date().toISOString());
        setSyncMessage(res.message);
        if (res.stats) {
          setSyncStats(res.stats);
        }
      } else {
        setSyncStatus('error');
        setSyncMessage(res.message || 'Erreur');
      }
    } catch (e) {
      setSyncStatus('error');
      setSyncMessage('Erreur inattendue');
    }
    
    setTimeout(() => {
      if (useAppStore.getState().syncStatus !== 'syncing') {
        setSyncStatus('idle');
      }
    }, 4000);
  };


  if (!profile) return null;

  const daysFormat = {
    'Lundi': 'Lun', 'Mardi': 'Mar', 'Mercredi': 'Mer', 'Jeudi': 'Jeu', 'Vendredi': 'Ven', 'Samedi': 'Sam', 'Dimanche': 'Dim'
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-5 pb-24 space-y-6">
      <div>
        <h2 className="text-3xl font-black text-plana-black tracking-wide">Profil</h2>
        <p className="text-sm font-medium text-slate-500 mt-1">Paramètres et préférences</p>
      </div>

      {/* Objectif */}
      <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Trophy size={14}/> Objectif
        </h3>
        {profile.goal ? (
          <div>
            <div className="font-bold text-plana-black text-lg">{profile.goal.title}</div>
            <div className="text-sm font-medium text-slate-500">{profile.goal.date} • {profile.goal.type.replace('_', ' ')}</div>
          </div>
        ) : (
          <div className="text-sm font-medium text-slate-500">Aucun objectif défini</div>
        )}
      </div>

      {/* Niveaux */}
      <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Activity size={14}/> Niveaux
        </h3>
        <ul className="space-y-3 text-sm font-bold text-plana-black">
          <li className="flex items-center gap-3">
            <span className="text-blue-500 text-lg">🏊</span> Natation 
            <span className="ml-auto text-slate-500 font-medium capitalize">{profile.level.swim}</span>
          </li>
          <li className="flex items-center gap-3">
            <span className="text-emerald-500 text-lg">🚴</span> Cyclisme 
            <span className="ml-auto text-slate-500 font-medium capitalize">{profile.level.ride}</span>
          </li>
          <li className="flex items-center gap-3">
            <span className="text-plana-orange text-lg">🏃</span> Course 
            <span className="ml-auto text-slate-500 font-medium capitalize">{profile.level.run}</span>
          </li>
        </ul>
      </div>

      {/* Disponibilités */}
      <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Zap size={14}/> Disponibilité
        </h3>
        <div className="font-bold text-plana-black mb-2">{profile.availability.weeklyHours}h / semaine</div>
        <div className="flex gap-2 flex-wrap">
          {['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map(day => (
            <div key={day} className={`px-3 py-1.5 rounded-xl text-xs font-bold ${profile.availability.availableDays.includes(day) ? 'bg-orange-50 text-plana-orange' : 'bg-gray-50 text-gray-400'}`}>
              {(daysFormat as any)[day]}
            </div>
          ))}
        </div>
      </div>
      
      {/* Connexions */}
      <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm space-y-4">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <Watch size={14}/> Santé & Données
        </h3>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${profile.dataConnection !== 'none' ? 'bg-green-500' : 'bg-gray-300'}`} />
          <div className="text-sm font-bold text-plana-black">
            {profile.dataConnection === 'apple_health' ? 'Apple Health' : profile.dataConnection === 'google_health_connect' ? 'Google Health Connect' : profile.dataConnection === 'demo' ? 'Mode Démo' : 'Aucune connexion'}
          </div>
        </div>

        {profile.dataConnection === 'none' && (
           <div className="space-y-2 mt-4">
             <button
               onClick={() => store.updateAthleteProfile({ dataConnection: 'apple_health' })}
               className="w-full py-2.5 bg-black text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
             >
               <Watch size={16} /> Connecter Apple Health
             </button>
             <button
               onClick={() => store.updateAthleteProfile({ dataConnection: 'google_health_connect' })}
               className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
             >
               <Activity size={16} /> Connecter Google Health
             </button>
           </div>
        )}

        {(profile.dataConnection === 'apple_health' || profile.dataConnection === 'google_health_connect') && (
           <button
             onClick={async () => {
                await healthService.disconnect(profile.dataConnection);
                store.updateAthleteProfile({ dataConnection: 'none' });
             }}
             className="w-full py-2.5 bg-gray-100 text-gray-500 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95 mb-2"
           >
             <LogOut size={16} /> Déconnecter
           </button>
        )}
        
        {syncRec && (
          <div className="bg-orange-50 p-3 rounded-xl border border-plana-orange/20 flex gap-3 items-start mt-4 mb-2">
            <RefreshCw size={16} className="text-plana-orange shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-bold text-plana-orange">{syncRec.title}</div>
              <div className="text-[10px] font-medium text-plana-black mt-1">{syncRec.message}</div>
            </div>
          </div>
        )}
        
        {profile.dataConnection !== 'none' && (
          <div className="pt-2 border-t border-gray-100">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-medium text-slate-500">Dernière synchro :</span>
              <span className="text-xs font-bold text-plana-black">
                {lastSyncedAt ? formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true, locale: fr }) : 'Jamais'}
              </span>
            </div>
            
            <button
              onClick={handleSync}
              disabled={syncStatus === 'syncing'}
              className="w-full py-2.5 bg-plana-black text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw size={16} className={syncStatus === 'syncing' ? 'animate-spin' : ''} />
              {syncStatus === 'syncing' ? 'Synchronisation...' : 'Synchroniser maintenant'}
            </button>
            
            {(syncStatus === 'success' || syncStatus === 'error') && syncMessage && (
              <div className={`mt-3 text-xs font-bold text-center ${syncStatus === 'success' ? 'text-emerald-500' : 'text-red-500'}`}>
                {syncMessage}
                {syncStats && (
                  <div className="mt-2 text-[10px] text-slate-500 font-medium bg-gray-50 p-2 rounded-lg text-left">
                    • {syncStats.analyzed} activités analysées<br/>
                    • {syncStats.new} nouvelles ajoutées<br/>
                    • {syncStats.duplicates} doublons ignorés<br/>
                    • {syncStats.matched} associées au planning
                  </div>
                )}
              </div>
            )}
            {profile.dataConnection !== 'demo' && (
              <p className="mt-3 text-[10px] text-slate-400 text-center leading-relaxed font-medium">
                La synchronisation native avec Apple Health ou Health Connect est uniquement disponible depuis l'application mobile.
              </p>
            )}
          </div>
        )}
      </div>

      <button 
        onClick={resetProfile}
        className="w-full mt-4 py-4 rounded-2xl bg-red-50 text-red-600 font-bold tracking-wide flex items-center justify-center gap-2 transition-all active:scale-95"
      >
        <LogOut size={18} /> Réinitialiser le profil
      </button>

    </motion.div>
  );
}
