import React, { useEffect, useState, useRef } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';

/**
 * TopProgressBar (NProgress Style)
 * 
 * - Appears only when any route change or background fetch/mutation runs for > 400ms.
 * - Zero flicker: fast loads (< 400ms) will never trigger the bar.
 * - Smooth CSS transition and glow effect.
 */
export const TopProgressBar: React.FC = () => {
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const location = useLocation();

  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const isBusy = isFetching > 0 || isMutating > 0;

  const showTimeoutRef = useRef<any>(null);
  const intervalRef = useRef<any>(null);

  // Monitor Route Transitions
  const [isNavigating, setIsNavigating] = useState(false);
  useEffect(() => {
    setIsNavigating(true);
    const timer = setTimeout(() => setIsNavigating(false), 250);
    return () => clearTimeout(timer);
  }, [location.pathname, location.search]);

  const shouldBeActive = isBusy || isNavigating;

  useEffect(() => {
    if (shouldBeActive) {
      // Delay showing progress bar by 400ms to eliminate UI flicker on fast loads
      showTimeoutRef.current = setTimeout(() => {
        setVisible(true);
        setProgress(25);

        // Simulated trickle progress up to 90%
        intervalRef.current = setInterval(() => {
          setProgress((prev) => {
            if (prev >= 90) return prev;
            const step = Math.max(1, (90 - prev) * 0.15);
            return prev + step;
          });
        }, 200);
      }, 400);
    } else {
      if (showTimeoutRef.current) {
        clearTimeout(showTimeoutRef.current);
        showTimeoutRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      if (visible) {
        // Complete the bar smoothly
        setProgress(100);
        const hideTimer = setTimeout(() => {
          setVisible(false);
          setProgress(0);
        }, 300);
        return () => clearTimeout(hideTimer);
      } else {
        setProgress(0);
      }
    }

    return () => {
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [shouldBeActive, visible]);

  if (!visible && progress === 0) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[99999] pointer-events-none h-[2.5px] bg-transparent"
      role="progressbar"
      aria-hidden={!visible}
    >
      <div
        className="h-full bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(99,102,241,0.7)]"
        style={{
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
          transition: progress === 100 ? 'width 200ms ease-out, opacity 300ms ease-out' : 'width 300ms ease-out'
        }}
      />
    </div>
  );
};
