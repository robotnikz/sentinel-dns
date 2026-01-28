import React from 'react';
import { Lock } from 'lucide-react';

export const ReadOnlyFollowerBanner: React.FC<{
  show: boolean;
  className?: string;
  title?: string;
  subtitle?: string;
}> = ({ show, className, title, subtitle }) => {
  if (!show) return null;

  const resolvedTitle = title ?? 'Follower is read-only';
  const resolvedSubtitle =
    subtitle ?? 'Make changes on the leader/VIP. This node will sync and serve DNS automatically.';

  return (
    <div className={className ?? ''}>
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-start gap-2">
        <Lock className="w-4 h-4 mt-0.5" />
        <div>
          <div className="font-medium">{resolvedTitle}</div>
          <div className="text-xs text-zinc-400 mt-1">
            {resolvedSubtitle}
          </div>
        </div>
      </div>
    </div>
  );
};
