import { useAuthContext } from '../contexts/AuthContext';

/**
 * Backend-validated authentication hook
 * Uses HttpOnly cookies managed by the backend for secure session management
 * If UI_PASSWORD is set on backend, requires password to access UI
 * If not set, UI is accessible without authentication
 *
 * This hook consumes from AuthContext to ensure a single source of truth
 */
export function useAuth() {
  return useAuthContext();
}
