import { useEffect } from 'preact/hooks';
import { route } from 'preact-router';
import { LoginScreen } from '../components/LoginScreen';
import { useAuth } from '../hooks';

interface LoginPageProps {
  path?: string;
}

/**
 * Login page component
 * Handles authentication and redirects to chat on success
 */
export function LoginPage(_props: LoginPageProps) {
  const { isAuthenticated, isLoggingOut, login } = useAuth();

  // Redirect to chat if already authenticated (use effect to avoid flickering)
  useEffect(() => {
    // Don't redirect while logout is in progress
    if (isAuthenticated && !isLoggingOut) {
      route('/chat', true);
    }
  }, [isAuthenticated, isLoggingOut]);

  // Show nothing while redirecting to prevent flash
  if (isAuthenticated && !isLoggingOut) {
    return null;
  }

  const handleLogin = async (password: string) => {
    const success = await login(password);
    if (success) {
      route('/chat', true);
    }
    return success;
  };

  return <LoginScreen onLogin={handleLogin} />;
}
