/**
 * Shared auth storage keys — single source of truth.
 * Both utils/api.ts and contexts/AuthContext.tsx import from here
 * to avoid the token-key mismatch bug that silently breaks authed requests.
 */
export const TOKEN_KEY = 'ac_auth_token';
export const GUEST_KEY = 'ac_guest_mode';
