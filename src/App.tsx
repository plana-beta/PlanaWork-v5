/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState, useEffect } from 'react';
import { useAppStore } from './store';
import Layout from './components/Layout';
import TodayView from './views/TodayView';
import PlanningView from './views/PlanningView';
import ProgressionView from './views/ProgressionView';
import GoalView from './views/GoalView';
import ProfileView from './views/ProfileView';
import OnboardingView from './views/OnboardingView';
import { TabID } from './types';
import { AnimatePresence } from 'motion/react';

import CoachView from './views/CoachView';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabID>('today');
  const athleteProfile = useAppStore(state => state.athleteProfile);
  const [isHydrated, setIsHydrated] = useState(false);
  const runAdaptation = useAppStore(state => state.runAdaptation);

  useEffect(() => {
    setIsHydrated(true);
    runAdaptation();
  }, [runAdaptation]);

  if (!isHydrated) return null; // Wait for zustand persist to hydrate

  return (
    <>
      {!athleteProfile ? (
        <OnboardingView onComplete={() => {
           // Completion handled in OnboardingView by calling setAthleteProfile
        }} />
      ) : (
        <Layout activeTab={activeTab} setActiveTab={setActiveTab}>
          <AnimatePresence mode="wait">
            {activeTab === 'today' && <TodayView key="today" />}
            {activeTab === 'plan' && <PlanningView key="plan" />}
            {activeTab === 'progression' && <ProgressionView key="progression" />}
            {activeTab === 'goal' && <GoalView key="goal" />}
            {activeTab === 'profile' && <ProfileView key="profile" />}
            {activeTab === 'coach' && <CoachView key="coach" />}
          </AnimatePresence>
        </Layout>
      )}
    </>
  );
}
