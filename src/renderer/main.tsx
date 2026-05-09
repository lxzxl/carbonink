import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>carbonbook</h1>
      <p>Phase 0 — Hello, world.</p>
    </div>
  </StrictMode>,
);
