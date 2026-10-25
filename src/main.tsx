import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

/* no StrictMode: its double mount would create two WebGL renderers on the same canvas */
createRoot(document.getElementById('root')!).render(<App />);
