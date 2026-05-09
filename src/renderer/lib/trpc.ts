import type { AppRouter } from '@main/trpc/router';
import { createTRPCClient } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { ipcLink } from 'electron-trpc/renderer';

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = createTRPCClient<AppRouter>({
  links: [ipcLink()],
});
