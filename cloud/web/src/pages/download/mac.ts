import type { APIRoute } from 'astro';
import { redirectToLatest } from '../../lib/latest-download';

// SSR — resolves the latest GitHub Release asset at request time.
export const prerender = false;

// `/download/mac` → latest macOS .dmg. Defaults to Apple Silicon
// (`arm64`); `?arch=x64` serves the Intel build (linked separately in
// DownloadButtons for the minority of Intel Macs still in use).
export const GET: APIRoute = ({ url }) => {
  const arch = url.searchParams.get('arch') === 'x64' ? 'x64' : 'arm64';
  return redirectToLatest(`mac-${arch}`);
};
