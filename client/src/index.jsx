import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import Router, { route } from 'preact-router';
import { CDPProvider } from './providers/CDPProvider';
import { AuthProvider } from './contexts';
import { LoginPage, ChatPage } from './pages';
import { useAuth } from './hooks';
import './styles/global.css';

/**
 * App Shell component that handles routing
 * Includes auth check and redirects
 */
function AppShell() {
  const { isAuthenticated, isAuthRequired, isChecking, isLoggingOut } = useAuth();

  // Handle auth redirects
  useEffect(() => {
    // Skip during initial auth check or during logout
    if (isChecking || isLoggingOut) return;

    const currentPath = window.location.pathname;

    // If auth is required and user is not authenticated, redirect to login
    if (isAuthRequired && !isAuthenticated && currentPath !== '/login') {
      route('/login', true);
    }

    // If authenticated and on login page, redirect to chat
    if (isAuthenticated && currentPath === '/login') {
      route('/chat', true);
    }
  }, [isAuthenticated, isAuthRequired, isChecking, isLoggingOut]);

  // Handle route changes for auth protection
  const handleRouteChange = (e) => {
    const { url } = e;

    // Skip during auth check or logout
    if (isChecking || isLoggingOut) return;

    // If auth is required and user is not authenticated, redirect to login
    if (isAuthRequired && !isAuthenticated && url !== '/login') {
      route('/login', true);
    }

    // If authenticated and on login page, redirect to chat
    if (isAuthenticated && url === '/login') {
      route('/chat', true);
    }
  };

  // Show loading state while checking auth
  if (isChecking) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-primary, #0a0a0a)',
        color: 'var(--text-secondary, #a1a1a1)',
      }}>
        Loading...
      </div>
    );
  }

  return (
    <Router onChange={handleRouteChange}>
      <LoginPage path="/login" />
      <ChatPage path="/chat/:sessionId?" />
      <Redirect path="/" to="/chat" />
      <NotFound default />
    </Router>
  );
}

/**
 * Redirect component for routes
 */
function Redirect({ to }) {
  useEffect(() => {
    route(to, true);
  }, [to]);
  return null;
}

/**
 * 404 Not Found component - redirects to chat
 */
function NotFound() {
  useEffect(() => {
    route('/chat', true);
  }, []);
  return null;
}

/**
 * Root component that conditionally wraps App with CDPProvider
 * Only loads CDP provider when x402 is enabled
 */
function Root() {
  const [x402Enabled, setX402Enabled] = useState(null);

  useEffect(() => {
    fetch('/api/x402/config')
      .then(res => res.ok ? res.json() : { enabled: false })
      .then(config => {
        setX402Enabled(config.enabled === true);
        if (config.enabled) {
          console.log('[Root] x402 enabled, loading CDP provider');
        } else {
          console.log('[Root] x402 disabled, skipping CDP provider');
        }
      })
      .catch(() => {
        console.log('[Root] Failed to fetch x402 config, disabling CDP provider');
        setX402Enabled(false);
      });
  }, []);

  if (x402Enabled === null) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-primary, #0a0a0a)',
        color: 'var(--text-secondary, #a1a1a1)',
      }}>
        Loading...
      </div>
    );
  }

  if (x402Enabled) {
    return (
      <AuthProvider>
        <CDPProvider>
          <AppShell />
        </CDPProvider>
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

const root = document.getElementById('app');
if (root) {
  render(<Root />, root);
} else {
  console.error('Root element #app not found');
}
