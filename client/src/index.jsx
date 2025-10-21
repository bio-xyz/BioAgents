import { render } from 'preact';
import { App } from './App';
import './styles/global.css';

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
} else {
  console.error('Root element #app not found');
}
