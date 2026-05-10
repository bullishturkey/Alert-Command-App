import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOKEN_KEY, GUEST_KEY, SERVER_URL_KEY } from '../constants/auth';

const DEFAULT_API_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
const TIMEOUT_MS = 12000; // 12-second timeout on auth requests

/** Returns AbortController that fires after ms */
function withTimeout(ms: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller;
}

/**
 * Returns the active API base URL.
 * Server URL override has been removed — always uses EXPO_PUBLIC_BACKEND_URL.
 * Any previously stored override is ignored (cleared on startup in loadToken).
 */
export async function getApiUrl(): Promise<string> {
  return DEFAULT_API_URL;
}

interface User {
  id: string;
  email: string;
  username: string;
  is_admin: boolean;
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isGuest: boolean;
  serverUrl: string;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  continueAsGuest: () => void;
  deleteAccount: () => Promise<void>;
  updateServerUrl: (url: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [serverUrl, setServerUrl] = useState(DEFAULT_API_URL);

  useEffect(() => {
    loadToken();
  }, []);

  const loadToken = async () => {
    try {
      // Clear any stale server URL override from the old server-config UI.
      // All requests must use EXPO_PUBLIC_BACKEND_URL from now on.
      await AsyncStorage.removeItem(SERVER_URL_KEY).catch(() => null);

      const apiUrl = DEFAULT_API_URL;
      const saved = await AsyncStorage.getItem(TOKEN_KEY);
      const guestMode = await AsyncStorage.getItem(GUEST_KEY);
      if (saved) {
        const controller = withTimeout(TIMEOUT_MS);
        const resp = await fetch(`${apiUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${saved}` },
          signal: controller.signal,
        }).catch(() => null);

        if (resp?.ok) {
          // Token is valid — restore session
          const data = await resp.json();
          setUser(data.user);
          setToken(saved);
        } else if (resp !== null && (resp.status === 401 || resp.status === 403)) {
          // Server explicitly rejected the token — it is expired or revoked
          await AsyncStorage.removeItem(TOKEN_KEY);
          if (guestMode === 'true') setIsGuest(true);
        }
        // If resp is null (timeout / network error / server restarting):
        // keep the token in AsyncStorage — the user's credentials are still valid.
        // They'll see the login screen and can sign in immediately.
      } else if (guestMode === 'true') {
        setIsGuest(true);
      }
    } catch (e) {
      console.error('Auth load error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const login = useCallback(async (email: string, password: string, rememberMe = false) => {
    const attemptLogin = async (): Promise<Response> => {
      const controller = withTimeout(TIMEOUT_MS);
      return fetch(`${DEFAULT_API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, remember_me: rememberMe }),
        signal: controller.signal,
      });
    };

    let resp: Response;
    try {
      resp = await attemptLogin();
      // If first attempt fails with 401, retry once after a short delay.
      // Handles cold-start race conditions (e.g. stale Mongo connection after
      // app was swipe-closed for a while) where the second attempt succeeds.
      if (resp.status === 401) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          resp = await attemptLogin();
        } catch {
          // If retry throws, keep the original response and let normal error flow handle it
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw new Error('Server is taking too long to respond. Please try again.');
      }
      throw new Error('Cannot reach server. Check your internet connection.');
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Invalid email or password' }));
      throw new Error(err.detail || 'Invalid email or password');
    }
    const data = await resp.json();
    await AsyncStorage.setItem(TOKEN_KEY, data.token);
    await AsyncStorage.removeItem(GUEST_KEY);
    setToken(data.token);
    setUser(data.user);
    setIsGuest(false);
  }, []);

  const register = useCallback(async (email: string, username: string, password: string) => {
    const controller = withTimeout(TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(`${DEFAULT_API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password }),
        signal: controller.signal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error('Server is taking too long to respond. Please try again.');
      throw new Error('Cannot reach server. Check your internet connection.');
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Registration failed' }));
      throw new Error(err.detail || 'Registration failed');
    }
    const data = await resp.json();
    await AsyncStorage.setItem(TOKEN_KEY, data.token);
    await AsyncStorage.removeItem(GUEST_KEY);
    setToken(data.token);
    setUser(data.user);
    setIsGuest(false);
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(GUEST_KEY);
    setToken(null);
    setUser(null);
    setIsGuest(false);
  }, []);

  const continueAsGuest = useCallback(() => {
    AsyncStorage.setItem(GUEST_KEY, 'true');
    setIsGuest(true);
  }, []);

  const deleteAccount = useCallback(async () => {
    if (!token) return;
    const resp = await fetch(`${DEFAULT_API_URL}/api/auth/account`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Failed to delete account' }));
      throw new Error(err.detail || 'Failed to delete account');
    }
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(GUEST_KEY);
    setToken(null);
    setUser(null);
    setIsGuest(false);
  }, [token]);

  const updateServerUrl = useCallback(async (url: string) => {
    const clean = url.trim().replace(/\/$/, '');
    if (clean) {
      await AsyncStorage.setItem(SERVER_URL_KEY, clean);
    } else {
      await AsyncStorage.removeItem(SERVER_URL_KEY);
    }
    setServerUrl(clean || DEFAULT_API_URL);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, isGuest, serverUrl, login, register, logout, continueAsGuest, deleteAccount, updateServerUrl }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
