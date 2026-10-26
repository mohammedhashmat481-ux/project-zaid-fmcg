import { useState, useEffect } from 'react';

/**
 * useDelayedLoading Hook
 * 
 * Prevents UI flicker by delaying the loading indicator.
 * If the loading state resolves before `delay` ms (default 400ms),
 * the loading indicator is never shown.
 * If loading persists past 8000ms (8s), `isTakingLonger` is set to true.
 */
export function useDelayedLoading(isLoading: boolean, delay: number = 400) {
  const [showLoading, setShowLoading] = useState(false);
  const [isTakingLonger, setIsTakingLonger] = useState(false);

  useEffect(() => {
    let delayTimer: any = null;
    let longTimer: any = null;

    if (isLoading) {
      delayTimer = setTimeout(() => {
        setShowLoading(true);
      }, delay);

      longTimer = setTimeout(() => {
        setIsTakingLonger(true);
      }, 8000);
    } else {
      setShowLoading(false);
      setIsTakingLonger(false);
    }

    return () => {
      if (delayTimer) clearTimeout(delayTimer);
      if (longTimer) clearTimeout(longTimer);
    };
  }, [isLoading, delay]);

  return { showLoading, isTakingLonger };
}
