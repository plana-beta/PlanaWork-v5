import { differenceInDays, addDays, format, parseISO, startOfDay, isValid } from 'date-fns';
import { PmcData } from '../types';
import { ActualWorkout } from '../domain/models';

/**
 * Calcule la Puissance Normalisée (NP) à partir d'un tableau de puissances instantanées (1 seconde).
 * Utilise une moyenne glissante de 30 secondes, élevée à la puissance 4, moyennée, puis racine quatrième.
 */
export function calculateNP(powerData: number[]): number {
  if (!powerData || powerData.length === 0) return 0;
  
  let sumP4 = 0;
  let count = 0;
  
  for (let i = 0; i < powerData.length; i++) {
    let windowSum = 0;
    let windowSize = 0;
    
    // Fenêtre glissante de 30 secondes. Pour t < 30, on utilise les valeurs disponibles (0 à i)
    const startIdx = Math.max(0, i - 29);
    for (let j = startIdx; j <= i; j++) {
      windowSum += powerData[j];
      windowSize++;
    }
    
    const p30 = windowSum / windowSize;
    sumP4 += Math.pow(p30, 4);
    count++;
  }
  
  return count > 0 ? Math.pow(sumP4 / count, 0.25) : 0;
}

/**
 * Calcule l'Intensity Factor (IF).
 */
export function calculateIF(np: number, ftp: number): number {
  if (ftp <= 0) return 0;
  return np / ftp;
}

/**
 * Calcule le Training Stress Score (TSS).
 * TSS = (durée_secondes × NP × IF) / (FTP × 3600) × 100
 */
export function calculateTSS(durationSeconds: number, np: number, ftp: number): number {
  if (ftp <= 0 || durationSeconds <= 0) return 0;
  const IF = calculateIF(np, ftp);
  return (durationSeconds * np * IF) / (ftp * 36);
}

/**
 * Calcule le hrTSS basé sur la fréquence cardiaque.
 */
export function calculateHrTSS(durationSeconds: number, avgHr: number, hrMax: number): number {
  if (hrMax <= 0 || durationSeconds <= 0) return 0;
  const IF_hr = avgHr / hrMax;
  return (durationSeconds * avgHr * IF_hr) / (hrMax * 36);
}

/**
 * Calcule un TSS par défaut basé uniquement sur la durée.
 */
export function calculateDurationTSS(durationMin: number): number {
  if (durationMin <= 0) return 0;
  return (durationMin / 60) * 50; // Estimation : 50 TSS par heure (endurance de base)
}

/**
 * Calcule l'ATL, le CTL, le TSB et génère les données PMC pour une liste d'activités.
 */
export function generatePMC(activities: ActualWorkout[], ftp: number, hrMax: number = 190, upToDate: Date = new Date()): PmcData[] {
  if (!activities || activities.length === 0) return [];
  
  // Trier les activités par date
  const sorted = [...activities].sort((a, b) => a.date.localeCompare(b.date));
  let startDate = startOfDay(parseISO(sorted[0].date));
  
  if (!isValid(startDate)) {
    startDate = startOfDay(new Date());
  }

  // Grouper les TSS par date (TSS journalier)
  const tssMap = new Map<string, number>();
  
  activities.forEach(act => {
    // Hiérarchie de fiabilité: TSS fourni > Puissance (NP) > FC (hrTSS) > Durée
    let activityTss = act.tss;
    
    if (activityTss == null || activityTss === 0) {
      if (act.durationMin && act.durationMin > 0) {
        if (act.normalizedPower && act.normalizedPower > 0 && ftp > 0) {
          activityTss = calculateTSS(act.durationMin * 60, act.normalizedPower, ftp);
        } else if (act.averageHeartRate && act.averageHeartRate > 0 && hrMax > 0) {
          activityTss = calculateHrTSS(act.durationMin * 60, act.averageHeartRate, hrMax);
        } else {
          activityTss = calculateDurationTSS(act.durationMin);
        }
      } else {
        activityTss = 0;
      }
    }
    
    const dStr = format(parseISO(act.date), 'yyyy-MM-dd');
    tssMap.set(dStr, (tssMap.get(dStr) || 0) + activityTss);
  });

  const pmc: PmcData[] = [];
  const endDate = startOfDay(upToDate);
  const totalDays = Math.max(0, differenceInDays(endDate, startDate) + 14); // Générer jusqu'à 14 jours dans le futur par rapport à upToDate
  
  let currentATL = 0;
  let currentCTL = 0;

  for (let i = 0; i <= totalDays; i++) {
    const currentDate = addDays(startDate, i);
    const dateStr = format(currentDate, 'yyyy-MM-dd');
    const tssJour = tssMap.get(dateStr) || 0;

    // Constante de 7 jours pour ATL, 42 jours pour CTL
    currentATL = currentATL + (tssJour - currentATL) / 7;
    currentCTL = currentCTL + (tssJour - currentCTL) / 42;
    
    // TSB = CTL - ATL
    const currentTSB = currentCTL - currentATL;

    pmc.push({
      date: dateStr,
      tss: tssJour,
      atl: currentATL,
      ctl: currentCTL,
      tsb: currentTSB
    });
  }

  return pmc;
}
