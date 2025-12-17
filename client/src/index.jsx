import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { App } from './App';
import { CDPProvider } from './providers/CDPProvider';
import './styles/global.css';

/**
 * Root component that conditionally wraps App with CDPProvider
 * Only loads CDP provider when x402 is enabled
 */
function Root() {
  const [x402Enabled, setX402Enabled] = useState(null); // null = loading, true/false = resolved

  useEffect(() => {
    // Fetch x402 config to determine if CDP provider should be loaded
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

  // Show loading state while checking x402 config
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

  // Only wrap with CDPProvider when x402 is enabled
  if (x402Enabled) {
    return (
      <CDPProvider>
        <App />
      </CDPProvider>
    );
  }

  // x402 disabled - render App without CDP provider
  return <App />;
}

const root = document.getElementById('app');
if (root) {
  render(<Root />, root);
} else {
  console.error('Root element #app not found');
}
