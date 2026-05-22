const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(ts: number, len: number): string {
  let value = ts;
  let s = '';
  for (let i = len - 1; i >= 0; i--) {
    s = (ENCODING[value % 32] ?? '0') + s;
    value = Math.floor(value / 32);
  }
  return s;
}

function encodeRandom(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) {
    s += ENCODING[b % 32] ?? '0';
  }
  return s;
}

export function newId(prefix: string): string {
  const ts = Date.now();
  return `${prefix}${encodeTime(ts, 10)}${encodeRandom(16)}`;
}

export const newUserId = () => newId('usr_');
export const newLicenseId = () => newId('lic_');
