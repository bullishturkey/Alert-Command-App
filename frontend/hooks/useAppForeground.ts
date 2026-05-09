/**
 * useAppForeground
 * Fires `callback` once whenever the app transitions from background → active.
 * Used to trigger silent data refreshes without a full screen reload.
 */
import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

export function useAppForeground(callback: () => void) {
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const callbackRef = useRef(callback);

  // Keep ref up-to-date so we don't need callback in dependency array
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        callbackRef.current();
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, []);
}
