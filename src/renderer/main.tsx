import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@renderer/components/ui/button';
import './styles/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <main className="p-8">
      <h1 className="text-2xl font-semibold">carbonbook</h1>
      <p className="mt-2 text-muted-foreground">Phase 0 — Tailwind + shadcn ready.</p>
      <Button className="mt-4">Hello</Button>
    </main>
  </StrictMode>,
);
