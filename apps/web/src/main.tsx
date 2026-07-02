import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import { App } from './App';
import { initI18n, i18n } from './i18n';
import './index.css';

// P3-i18n (2026-07-02): synchronously initialise i18next BEFORE the
// first render so the initial paint is already in the user's chosen
// language (no English→zh-TW flash). The root tree is wrapped with
// `<I18nextProvider>` so `useTranslation()` works everywhere below,
// plus a `<LocaleProvider>` (inside App.tsx) so we can also call
// `i18n.changeLanguage()` from outside React.
initI18n();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  </StrictMode>
);
