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
  const { isAuthenticated, login } = useAuth();

  // If already authenticated, redirect to chat
  if (isAuthenticated) {
    route('/chat', true);
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
