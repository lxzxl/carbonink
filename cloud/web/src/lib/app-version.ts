import nsgoYaml from '../../../../app/nsgo.yaml?raw';

const match = /^version:\s*["']?([^"'\s#]+)["']?/m.exec(nsgoYaml);
if (!match) {
  throw new Error('Could not parse version from app/nsgo.yaml');
}

export const APP_VERSION = match[1];
