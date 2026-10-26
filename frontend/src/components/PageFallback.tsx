import React from 'react';
import { useDelayedLoading } from '../hooks/useDelayedLoading';

export const PageFallback: React.FC = () => {
  const { showLoading } = useDelayedLoading(true, 400);

  if (!showLoading) {
    return null; // Zero flicker for fast loads under 400ms
  }

  return (
    <div className="w-full min-h-[60vh] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-medium text-slate-400 tracking-wide">Loading workspace...</span>
      </div>
    </div>
  );
};
