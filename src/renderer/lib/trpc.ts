import { createTRPCReact } from '@trpc/react-query';
import { createTRPCClient } from '@trpc/client';
import { ipcLink } from 'electron-trpc/renderer';
import type { AppRouter } from '@main/trpc/router';

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = createTRPCClient<AppRouter>({
  links: [ipcLink()],
});
