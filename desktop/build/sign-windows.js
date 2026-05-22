// electron-builder Windows sign hook — delegates to Azure Trusted Signing.
//
// The GitHub Actions workflow installs signtool + the Trusted Signing dlib
// via `azure/trusted-signing-action`, writes a metadata JSON file at
// build/trusted-signing.json (containing Endpoint + CodeSigningAccountName
// + CertificateProfileName), and exports SIGNTOOL_PATH + DLIB_PATH.
//
// Locally, this script is a no-op (returns without signing) so unsigned
// `pnpm dist:win` builds succeed for developer smoke testing.
exports.default = async function signWindows(configuration) {
  const { execFileSync } = require('node:child_process');
  const { existsSync } = require('node:fs');
  const path = require('node:path');

  const signtool = process.env.SIGNTOOL_PATH;
  const dlib = process.env.DLIB_PATH;
  const metadata = path.resolve(__dirname, 'trusted-signing.json');

  if (!signtool || !dlib || !existsSync(metadata)) {
    process.stderr.write(
      `[sign-windows] Skipping signature for ${configuration.path} — Azure Trusted Signing env not configured (local build).\n`,
    );
    return;
  }

  const args = [
    'sign',
    '/v',
    '/debug',
    '/fd',
    'sha256',
    '/tr',
    'http://timestamp.acs.microsoft.com',
    '/td',
    'sha256',
    '/dlib',
    dlib,
    '/dmdf',
    metadata,
    configuration.path,
  ];

  execFileSync(signtool, args, { stdio: 'inherit' });
};
