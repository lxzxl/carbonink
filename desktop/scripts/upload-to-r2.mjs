#!/usr/bin/env node
/**
 * Upload electron-builder output to Cloudflare R2.
 *
 * Usage:
 *   node scripts/upload-to-r2.mjs --platform darwin
 *   node scripts/upload-to-r2.mjs --platform win32
 *
 * Uploads all files from `release/` that match the platform's expected
 * extensions, plus the `latest-*.yml` manifest files that electron-updater
 * reads.
 *
 * Required env vars:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const releaseDir = join(__dirname, '..', 'release');

const platform = process.argv.includes('--platform')
  ? process.argv[process.argv.indexOf('--platform') + 1]
  : null;

if (!platform || !['darwin', 'win32'].includes(platform)) {
  process.stderr.write('Usage: node scripts/upload-to-r2.mjs --platform <darwin|win32>\n');
  process.exit(1);
}

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  process.stderr.write('ERROR: Missing R2_* environment variables.\n');
  process.exit(1);
}

const ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// Determine which files to upload based on platform.
const extensions =
  platform === 'darwin'
    ? ['.dmg', '.zip', '.yml', '.yaml', '.blockmap']
    : ['.exe', '.yml', '.yaml', '.blockmap'];

const files = readdirSync(releaseDir).filter((f) => {
  const ext = f.slice(f.lastIndexOf('.'));
  return extensions.includes(ext) && statSync(join(releaseDir, f)).isFile();
});

if (files.length === 0) {
  process.stderr.write(`No uploadable files found in ${releaseDir} for platform ${platform}\n`);
  process.exit(1);
}

// Read version from package.json
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const version = pkg.version;

// Use the S3-compatible API via the AWS CLI which supports S3-compatible
// endpoints. It's pre-installed on GitHub runners.
for (const file of files) {
  const localPath = join(releaseDir, file);
  // Flat manifest layout: latest-mac.yml / latest.yml live at the bucket
  // root of releases/ (no platform subdir), matching the electron-builder
  // `publish.url` of https://r2.carbonink.xyz/releases. electron-updater
  // fetches `<publishUrl>/latest-mac.yml` or `<publishUrl>/latest.yml`
  // so the manifests MUST sit at this path. Binary artifacts are
  // versioned + platform-segregated and referenced by absolute URL
  // inside the manifests.
  const isManifest = file.endsWith('.yml') || file.endsWith('.yaml');
  const r2Key = isManifest ? `releases/${file}` : `releases/${platform}/${version}/${file}`;

  process.stderr.write(`Uploading ${file} -> s3://${R2_BUCKET_NAME}/${r2Key}\n`);

  execSync(
    `aws s3 cp "${localPath}" "s3://${R2_BUCKET_NAME}/${r2Key}" --endpoint-url "${ENDPOINT}"`,
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: R2_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: R2_SECRET_ACCESS_KEY,
        AWS_DEFAULT_REGION: 'auto',
      },
    },
  );
}

process.stderr.write(`\nUploaded ${files.length} files for ${platform} v${version}.\n`);
