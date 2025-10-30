import { render } from 'preact';
import { App } from './App';
import { CDPProvider } from './providers/CDPProvider';
import './styles/global.css';

const root = document.getElementById('app');
if (root) {
  render(
    <CDPProvider>
      <App />
    </CDPProvider>,
    root
  );
} else {
  console.error('Root element #app not found');
}
