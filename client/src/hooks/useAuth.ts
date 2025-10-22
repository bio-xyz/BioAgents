import { useState, useEffect } from 'preact/hooks';

/**
 * Backend-validated authentication hook
 * Uses HttpOnly cookies managed by the backend for secure session management
 * If UI_PASSWORD is set on backend, requires password to access UI
 * If not set, UI is accessible without authentication
 */
export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthRequired, setIsAuthRequired] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Check auth status from backend
    checkAuthStatus();
  }, []);

  /**
   * Check authentication status from backend
   */
  const checkAuthStatus = async () => {
    try {
      const response = await fetch('/api/auth/status', {
        credentials: 'include', // Important: include cookies
      });

      if (response.ok) {
        const data = await response.json();
        setIsAuthRequired(data.isAuthRequired);
        setIsAuthenticated(data.isAuthenticated);
      }
    } catch (error) {
      console.error('Failed to check auth status:', error);
      // Default to not authenticated
      setIsAuthenticated(false);
      setIsAuthRequired(false);
    } finally {
      setIsChecking(false);
    }
  };

  /**
   * Attempt to login with password
   * Sends password to backend for validation
   * Backend sets HttpOnly cookie on success
   * Returns true if successful, false otherwise
   */
  const login = async (password: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Important: include cookies
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setIsAuthenticated(true);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  };

  /**
   * Logout user
   * Calls backend to clear HttpOnly cookie
   */
  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include', // Important: include cookies
      });
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return {
    isAuthenticated,
    isAuthRequired,
    isChecking,
    login,
    logout,
  };
}
