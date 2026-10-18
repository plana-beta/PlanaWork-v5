import { ReactNode } from 'react';
import { Calendar, BarChart2, Target, User, Settings, Activity as ActivityIcon, Bot } from 'lucide-react';
import { TabID } from '../types';
import { cn } from '../utils';

interface LayoutProps {
  children: ReactNode;
  activeTab: TabID;
  setActiveTab: (t: TabID) => void;
}

export default function Layout({ children, activeTab, setActiveTab }: LayoutProps) {
  const navItems = [
    { id: 'today', icon: ActivityIcon, label: 'Aujourd\'hui' },
    { id: 'plan', icon: Calendar, label: 'Plan' },
    { id: 'coach', icon: Bot, label: 'Coach' },
    { id: 'progression', icon: BarChart2, label: 'Progression' },
    { id: 'goal', icon: Target, label: 'Objectif' },
    { id: 'profile', icon: User, label: 'Profil' },
  ] as const;

  return (
    <div className="flex flex-col h-[100dvh] bg-plana-bg overflow-hidden relative">
      {/* Top Header */}
      <header className="flex-none h-16 bg-plana-white border-b border-gray-100 flex items-center justify-between px-4 z-10 safe-top shadow-sm">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="PlanaSport" className="h-8 w-auto object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling!.style.display = 'block'; }} />
          <h1 className="font-bold text-xl text-plana-black hidden">PlanaSport</h1>
        </div>
        <button className="w-10 h-10 rounded-full flex items-center justify-center bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors">
          <Settings size={20} />
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto pb-24 relative">
        <div className="max-w-md mx-auto w-full min-h-full">
          {children}
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className="flex-none absolute bottom-0 left-0 right-0 bg-plana-white border-t border-gray-100 safe-bottom pb-2 pt-2 px-2 z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
        <div className="max-w-md mx-auto w-full flex justify-between items-center">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "flex flex-col items-center justify-center w-16 h-14 rounded-2xl transition-all duration-300",
                  isActive ? "text-plana-orange" : "text-gray-400 hover:text-gray-600"
                )}
              >
                <div className={cn(
                  "relative p-1 rounded-xl transition-all duration-300",
                  isActive ? "bg-orange-50 mb-1" : ""
                )}>
                  <Icon size={isActive ? 24 : 22} strokeWidth={isActive ? 2.5 : 2} />
                </div>
                <span className={cn(
                  "text-[10px] font-medium transition-all duration-300",
                  isActive ? "opacity-100" : "opacity-0 h-0"
                )}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
