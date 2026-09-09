import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './state/store';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing from index.html.');

createRoot(root).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
