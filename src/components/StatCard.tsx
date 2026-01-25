import React from 'react';
import { StatCardProps } from '../types';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

const StatCard: React.FC<StatCardProps> = ({ title, value, change, icon: Icon, trend = 'neutral', color = 'zinc' }) => {
  const getIconBadgeClasses = () => {
    switch (color) {
      case 'emerald':
        return { badge: 'bg-emerald-950/30 border-emerald-900/40', icon: 'text-emerald-400' };
      case 'rose':
      case 'red':
        return { badge: 'bg-rose-950/30 border-rose-900/40', icon: 'text-rose-400' };
      case 'amber':
      case 'yellow':
        return { badge: 'bg-amber-950/25 border-amber-900/40', icon: 'text-amber-400' };
      case 'indigo':
      case 'violet':
      case 'purple':
        return { badge: 'bg-indigo-950/30 border-indigo-900/40', icon: 'text-indigo-400' };
      case 'sky':
      case 'blue':
      case 'cyan':
        return { badge: 'bg-sky-950/30 border-sky-900/40', icon: 'text-sky-400' };
      default:
        return { badge: 'bg-zinc-900/50 border-zinc-800', icon: 'text-zinc-300' };
    }
  };

  const getTrendIcon = () => {
    switch (trend) {
      case 'up': return <ArrowUpRight className="w-3 h-3 text-emerald-500" />;
      case 'down': return <ArrowDownRight className="w-3 h-3 text-rose-500" />;
      default: return <Minus className="w-3 h-3 text-zinc-500" />;
    }
  };

  const getTrendColor = () => {
     switch (trend) {
      case 'up': return 'text-emerald-500';
      case 'down': return 'text-rose-500';
      default: return 'text-zinc-500';
    }
  };

  return (
    <div className="dashboard-card p-5 rounded-lg flex flex-col justify-between h-[120px] relative group">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2 text-zinc-400">
           {(() => {
             const { badge, icon } = getIconBadgeClasses();
             return (
               <span className={`inline-flex items-center justify-center w-8 h-8 rounded-md border ${badge}`}>
                 <Icon className={`w-4 h-4 ${icon}`} />
               </span>
             );
           })()}
           <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
        </div>
        {change && (
          <div className={`flex items-center gap-1 text-xs font-mono font-medium ${getTrendColor()} bg-zinc-900/50 px-1.5 py-0.5 rounded border border-zinc-800`}>
            {change}
            {getTrendIcon()}
          </div>
        )}
      </div>
      
      <div>
        <p className="text-3xl font-bold text-white tracking-tight font-mono">{value}</p>
      </div>

      {/* Decorative corner accent */}
      <div className="absolute bottom-0 right-0 w-8 h-8 border-r-2 border-b-2 border-zinc-800 group-hover:border-zinc-600 transition-colors rounded-br-lg"></div>
    </div>
  );
};

export default StatCard;