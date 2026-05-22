import type { LicenseActiveRecord } from '@carbonbook-cloud/shared';

export async function getLicenseIdByHumanizedKey(
  kv: KVNamespace,
  humanized: string,
): Promise<string | null> {
  return kv.get(`hk:${humanized}`);
}

export async function readActive(
  kv: KVNamespace,
  licenseId: string,
): Promise<LicenseActiveRecord | null> {
  const raw = await kv.get(`la:${licenseId}`);
  return raw ? (JSON.parse(raw) as LicenseActiveRecord) : null;
}

export async function writeActive(kv: KVNamespace, record: LicenseActiveRecord): Promise<void> {
  await kv.put(`la:${record.license_id}`, JSON.stringify(record));
}

export async function writeHumanizedKey(
  kv: KVNamespace,
  humanized: string,
  licenseId: string,
): Promise<void> {
  await kv.put(`hk:${humanized}`, licenseId);
}
