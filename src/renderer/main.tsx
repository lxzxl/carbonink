import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, trpcClient } from '@renderer/lib/trpc';
import { Button } from '@renderer/components/ui/button';
import './styles/globals.css';

const queryClient = new QueryClient();

function App() {
  const hasAny = trpc.organization.hasAny.useQuery();
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">carbonbook</h1>
      <p className="mt-2 text-muted-foreground">
        Organizations exist: {hasAny.isLoading ? 'checking...' : String(hasAny.data ?? false)}
      </p>
      <Button className="mt-4" onClick={() => hasAny.refetch()}>Refresh</Button>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  </StrictMode>,
);
