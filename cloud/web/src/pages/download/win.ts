import type { APIRoute } from 'astro';
import { redirectToLatest } from '../../lib/latest-download';

// SSR — resolves the latest GitHub Release asset at request time.
export const prerender = false;

// `/download/win` → latest Windows x64 NSIS installer (.exe).
export const GET: APIRoute = () => redirectToLatest('win-x64');
