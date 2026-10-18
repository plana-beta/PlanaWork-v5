import { addDays, format, differenceInDays, parseISO, startOfDay, getDay } from 'date-fns';
import { AthleteProfile, PlannedWorkout, Sport } from '../domain/models';

export function generateTrainingPlan(
  profile: AthleteProfile,
  startDate: Date = new Date(),
  weeksToPlan: number = 4
): PlannedWorkout[] {
  const plan: PlannedWorkout[] = [];
  const daysOfWeekMap = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  
  const availableDays = profile.availability.availableDays;
  if (!availableDays || availableDays.length === 0) return [];

  const maxWeeklyHours = profile.availability.weeklyHours || 0;
  const maxWeeklyMinutes = maxWeeklyHours * 60;
  if (maxWeeklyMinutes <= 0) return [];

  let targetRaceDate: Date | null = null;
  if (profile.goal?.date) {
    targetRaceDate = startOfDay(parseISO(profile.goal.date));
  }

  const isTriathlon = profile.goal?.sportFocus === 'Triathlon';
  const mainSport = profile.goal?.sportFocus !== 'Triathlon' && profile.goal?.sportFocus ? (profile.goal.sportFocus as Sport) : null;

  let workoutCountThisWeek = 0;
  
  for (let week = 0; week < weeksToPlan; week++) {
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const currentDate = addDays(startDate, week * 7 + dayOffset);
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      
      // Stop generating if we are strictly after the race date
      if (targetRaceDate && currentDate > targetRaceDate) {
        continue;
      }

      const dayName = daysOfWeekMap[getDay(currentDate)];
      
      if (availableDays.includes(dayName)) {
        // Taper logic
        let volumeMultiplier = 1;
        if (targetRaceDate) {
           const daysToRace = differenceInDays(targetRaceDate, currentDate);
           if (daysToRace >= 0 && daysToRace <= 7) {
              volumeMultiplier = 0.5; // 50% volume in race week
           } else if (daysToRace > 7 && daysToRace <= 14) {
              volumeMultiplier = 0.75; // 75% volume 2 weeks out
           }
        }

        // Determine sport deterministically based on day offset and week to cycle through
        let sport: Sport = 'Run';
        if (isTriathlon) {
           const cycle = (week * 7 + dayOffset) % 3;
           if (cycle === 0) sport = 'Swim';
           else if (cycle === 1) sport = 'Ride';
           else sport = 'Run';
        } else if (mainSport) {
           sport = mainSport;
        }

        // Get sport level
        let level = 'intermediate';
        if (sport === 'Swim') level = profile.level.swim;
        else if (sport === 'Ride') level = profile.level.ride;
        else if (sport === 'Run') level = profile.level.run;

        // Base duration based on available days
        let duration = Math.floor((maxWeeklyMinutes * volumeMultiplier) / availableDays.length);
        
        // Ensure minimum and sensible durations
        if (duration < 20) duration = 20; 
        
        // If it's a bike and we have time, make it longer
        if (sport === 'Ride' && availableDays.length <= 4 && maxWeeklyMinutes > 300) {
           duration = Math.floor(duration * 1.5);
        }
        
        // Cap durations depending on level
        if (level === 'beginner') {
           duration = Math.min(duration, sport === 'Ride' ? 90 : 45);
        } else if (level === 'intermediate') {
           duration = Math.min(duration, sport === 'Ride' ? 120 : 60);
        } else {
           duration = Math.min(duration, sport === 'Ride' ? 180 : 90);
        }

        // Avoid adding too much if it exceeds maxWeeklyMinutes, but we keep it simple for now
        // Determine intensity
        let intensityValue = 'Z2';
        let explanation = 'Séance d\'endurance fondamentale pour développer la base aérobie.';
        let title = `Endurance ${sport === 'Swim' ? 'Natation' : sport === 'Ride' ? 'Vélo' : 'Course'}`;

        // Add some variation
        if ((week * 7 + dayOffset) % 4 === 0 && level !== 'beginner') {
           intensityValue = 'Z4';
           title = `Intervalles ${sport === 'Swim' ? 'Natation' : sport === 'Ride' ? 'Vélo' : 'Course'}`;
           explanation = 'Séance d\'intensité pour améliorer la capacité maximale.';
        }

        const workoutId = `planned-${dateStr}-${sport.toLowerCase()}`;

        plan.push({
          id: workoutId,
          sport: sport,
          date: dateStr,
          title: title,
          targetDurationMin: duration,
          targetIntensity: {
            type: 'zone',
            value: intensityValue
          },
          explanation: explanation,
          status: 'planned'
        });
      }
    }
  }

  return plan;
}
