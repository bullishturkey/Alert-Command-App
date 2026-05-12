/**
 * deviceCache.ts
 * On-device persistent cache using AsyncStorage.
 * Pattern: stale-while-revalidate — always show cached data instantly,
 * fetch fresh data in the background, save back to cache on success.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_VERSION = '1'; // bump to invalidate all caches on schema changes

export const CACHE_KEYS = {
  NDX_QUOTE:  'cache_v1_ndx',
  QUOTES:     'cache_v1_quotes',
  WATCHLIST:  'cache_v1_watchlist',
  ALERTS:     'cache_v1_alerts',
  PREFLIGHT:  'cache_v1_preflight',
  AI_SENTIMENT: 'cache_v1_ai_sentiment',
} as const;

/** How long cached data is considered "fresh" before we show a stale indicator.
 * Note: cache is ALWAYS used immediately on app launch (stale-while-revalidate);
 * these TTLs only control when we show a "stale" indicator in the UI.
 * Backend is aggressively pre-warmed on the launch tier, so TTLs can be longer. */
export const CACHE_TTL_MS = {
  NDX_QUOTE:    2  * 60_000,      // 2 minutes
  QUOTES:       2  * 60_000,      // 2 minutes
  WATCHLIST:    24 * 3_600_000,   // 24 hours (rarely changes)
  ALERTS:       10 * 60_000,      // 10 minutes
  PREFLIGHT:    60 * 60_000,      // 1 hour
  AI_SENTIMENT: 12 * 3_600_000,   // 12 hours
} as const;

interface CacheEntry<T> {
  data: T;
  savedAt: number;
  version: string;
}

export interface CacheResult<T> {
  data: T;
  savedAt: number;
  /** true when age > ttlMs — data is old but still usable as offline fallback */
  isStale: boolean;
  /** human-readable age string, e.g. "3m ago" */
  ageLabel: string;
}

/** Read a cache entry. Returns null if missing or version mismatch. */
export async function readCache<T>(
  key: string,
  ttlMs: number
): Promise<CacheResult<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (entry.version !== CACHE_VERSION) {
      await AsyncStorage.removeItem(key); // bust old format
      return null;
    }
    const age = Date.now() - entry.savedAt;
    return {
      data: entry.data,
      savedAt: entry.savedAt,
      isStale: age > ttlMs,
      ageLabel: formatAge(age),
    };
  } catch {
    return null;
  }
}

/** Write data to cache. Silently ignores storage errors. */
export async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = {
      data,
      savedAt: Date.now(),
      version: CACHE_VERSION,
    };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch (e) {
    console.warn('[Cache] write failed:', e);
  }
}

/** Clear one or all cache entries */
export async function clearCache(key?: string): Promise<void> {
  try {
    if (key) {
      await AsyncStorage.removeItem(key);
    } else {
      await AsyncStorage.multiRemove(Object.values(CACHE_KEYS));
    }
  } catch {}
}

function formatAge(ageMs: number): string {
  if (ageMs < 60_000) return 'just now';
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  return `${Math.floor(ageMs / 86_400_000)}d ago`;
}
