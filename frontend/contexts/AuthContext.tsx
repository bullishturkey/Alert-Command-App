import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOKEN_KEY, GUEST_KEY } from '../constants/auth';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

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
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  continueAsGuest: () => void;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    loadToken();
  }, []);

  const loadToken = async () => {
    try {
      const saved = await AsyncStorage.getItem(TOKEN_KEY);
      const guestMode = await AsyncStorage.getItem(GUEST_KEY);
      if (saved) {
        const resp = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${saved}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          setUser(data.user);
          setToken(saved);
        } else {
          await AsyncStorage.removeItem(TOKEN_KEY);
          if (guestMode === 'true') setIsGuest(true);
        }
      } else if (guestMode === 'true') {
        setIsGuest(true);
      }
    } catch (e) {
      console.error('Auth load error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const login = useCallback(async (email: string, password: string) => {
    const resp = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Login failed' }));
      throw new Error(err.detail || 'Login failed');
    }
    const data = await resp.json();
    await AsyncStorage.setItem(TOKEN_KEY, data.token);
    await AsyncStorage.removeItem(GUEST_KEY);
    setToken(data.token);
    setUser(data.user);
    setIsGuest(false);
  }, []);

  const register = useCallback(async (email: string, username: string, password: string) => {
    const resp = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password }),
    });
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
    const resp = await fetch(`${API_URL}/api/auth/account`, {
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

  return (
    <AuthContext.Provider value={{ user, token, isLoading, isGuest, login, register, logout, continueAsGuest, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
