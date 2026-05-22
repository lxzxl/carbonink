/**
 * Humanized license key: `cbk-XXXXX-XXXXX-XXXXX-XXXXX`
 * 20 Crockford Base32 chars = 100 bits of entropy.
 * Alphabet excludes I, L, O, U.
 */
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

export function generateHumanizedKey(): string {
  const bytes = new Uint8Array(13);
  crypto.getRandomValues(bytes);
  let chars = '';
  for (let i = 0; i < 20; i++) {
    const bitOffset = i * 5;
    const byteIndex = Math.floor(bitOffset / 8);
    const bitShift = bitOffset % 8;
    const hi = bytes[byteIndex] ?? 0;
    const lo = bytes[byteIndex + 1] ?? 0;
    const val = ((hi << 8) | lo) >> (16 - bitShift - 5);
    chars += CROCKFORD[val & 0x1f] ?? '0';
  }
  return `cbk-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}`;
}

export function normalizeHumanizedKey(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, '');
  const noDash = cleaned.replace(/-/g, '');
  if (!/^CBK[0-9A-HJKMNP-TV-Z]{20}$/.test(noDash)) return null;
  return `cbk-${noDash.slice(3, 8)}-${noDash.slice(8, 13)}-${noDash.slice(13, 18)}-${noDash.slice(18, 23)}`.toLowerCase();
}
