import { createContext } from 'preact';
import { useContext, useState, useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

const AUTH_TOKEN_KEY = 'bioagents_auth_token';

interface AuthContextType {
  isAuthenticated: boolean;
  isAuthRequired: boolean;
  isChecking: boolean;
  isLoggingOut: boolean;
  token: string | null;
  userId: string | null;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  getAuthToken: () => string | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * Get stored auth token from localStorage
 */
function getStoredToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Store auth token in localStorage
 */
function storeToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch (error) {
    console.error('Failed to store auth token:', error);
  }
}

/**
 * Clear auth token from localStorage
 */
function clearStoredToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch (error) {
    console.error('Failed to clear auth token:', error);
  }
}

/**
 * Decode JWT payload (without verification - just for reading userId)
 * The server verifies the token, we just need to read the payload
 */
function decodeJWTPayload(token: string): { sub?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    return null;
  }
}

/**
 * AuthProvider component that provides authentication state to all children
 * Uses JWT tokens for authentication - tokens are stored in localStorage
 * and sent via Authorization header to the API
 */
export function AuthProvider({ children }: { children: ComponentChildren }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthRequired, setIsAuthRequired] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  /**
   * Check authentication status with server
   * Sends JWT token in Authorization header if available
   */
  const checkAuthStatus = async () => {
    try {
      const storedToken = getStoredToken();
      const headers: Record<string, string> = {};

      if (storedToken) {
        headers['Authorization'] = `Bearer ${storedToken}`;
      }

      const response = await fetch('/api/auth/status', {
        headers,
      });

      if (response.ok) {
        const data = await response.json();
        setIsAuthRequired(data.isAuthRequired);
        setIsAuthenticated(data.isAuthenticated);

        // Set userId from server response
        if (data.userId) {
          setUserId(data.userId);
        } else if (storedToken) {
          // Fallback: decode userId from JWT payload
          const payload = decodeJWTPayload(storedToken);
          if (payload?.sub) {
            setUserId(payload.sub);
          }
        }

        // If token was invalid, clear it
        if (!data.isAuthenticated && storedToken) {
          clearStoredToken();
          setToken(null);
          setUserId(null);
        }
      }
    } catch (error) {
      console.error('Failed to check auth status:', error);
      setIsAuthenticated(false);
      setIsAuthRequired(false);
    } finally {
      setIsChecking(false);
    }
  };

  /**
   * Login with password - receives JWT token from server
   */
  const login = async (password: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Store the JWT token
          if (data.token) {
            storeToken(data.token);
            setToken(data.token);

            // Decode and set userId from token
            const payload = decodeJWTPayload(data.token);
            if (payload?.sub) {
              setUserId(payload.sub);
            }
          }
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
   * Logout - clears stored JWT token
   */
  const logout = async (): Promise<void> => {
    setIsLoggingOut(true);

    try {
      // Notify server (optional, JWT is stateless)
      await fetch('/api/auth/logout', {
        method: 'POST',
      });
    } catch (error) {
      console.error('Logout request failed:', error);
    }

    // Clear token and state regardless of server response
    clearStoredToken();
    setToken(null);
    setUserId(null);
    setIsAuthenticated(false);
    setIsLoggingOut(false);
  };

  /**
   * Get the current auth token for API calls
   */
  const getAuthToken = (): string | null => {
    return token || getStoredToken();
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isAuthRequired,
        isChecking,
        isLoggingOut,
        token,
        userId,
        login,
        logout,
        getAuthToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth context
 * Must be used within an AuthProvider
 */
export function useAuthContext(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}

/**
 * Utility function to get auth token outside of React components
 * Useful for API calls in utility functions
 */
export function getAuthTokenFromStorage(): string | null {
  return getStoredToken();
}
