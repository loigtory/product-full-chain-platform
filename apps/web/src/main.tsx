import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { UiKitPage } from './UiKitPage.tsx';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('WEB_ROOT_MISSING');
}

createRoot(root).render(
  <StrictMode>
    {window.location.pathname === '/ui-kit' ? <UiKitPage /> : <App />}
  </StrictMode>,
);
