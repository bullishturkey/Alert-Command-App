/**
 * useLaunchPrefetch
 * Fires off ALL critical endpoints in parallel the moment the user is authenticated,
 * so every tab feels instant when switched to. Results are written to deviceCache.
 * Runs ONCE per app launch (gated by a ref).
 */
import { useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api';
import { writeCache, CACHE_KEYS } from '../utils/deviceCache';

export function useLaunchPrefetch(enabled: boolean) {
  const fired = useRef(false);

  useEffect(() => {
    if (!enabled || fired.current) return;
    fired.current = true;

    // Kick off everything in parallel — failures are non-fatal.
    const run = async () => {
      try {
        // Stagger the heaviest calls (preflight/AI) slightly so we don't all hit at once.
        const tasks = [
          apiFetch('/api/market/ndx').then((d) => writeCache(CACHE_KEYS.NDX_QUOTE, d)).catch(() => null),
          apiFetch('/api/alerts').then((d) => writeCache(CACHE_KEYS.ALERTS, (d?.alerts || []).slice(0, 100))).catch(() => null),
          apiFetch('/api/preflight').then((d) =>
            writeCache(CACHE_KEYS.PREFLIGHT, { events: d?.economic_events || [], earnings: d?.earnings || [], news: d?.breaking_news || [] })
          ).catch(() => null),
          apiFetch('/api/ai/sentiment').then((d) =>
            writeCache(CACHE_KEYS.AI_SENTIMENT, {
              sentiment: d?.sentiment,
              mode: d?.mode,
              weekly_recap: d?.weekly_recap || null,
              daily_recap: d?.daily_recap || null,
              ndx_price: d?.ndx_price,
              ndx_change: d?.ndx_change,
            })
          ).catch(() => null),
        ];
        await Promise.allSettled(tasks);
      } catch {
        // swallow; cache layer keeps last-known data
      }
    };
    // Small delay so initial nav animations finish first
    const t = setTimeout(run, 400);
    return () => clearTimeout(t);
  }, [enabled]);
}
