import {createRoot} from 'react-dom/client';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App.tsx';
import './index.css';
import { initAnalytics } from './analytics.ts';
import { apiPath } from './clientApi.ts';

void initAnalytics(apiPath('/api/posthog-config'));

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <SpeedInsights />
  </>
);
