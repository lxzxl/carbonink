/** JWT claims shape — MUST match carbonink/src/shared/types.ts LicenseJwtClaims. */
export type LicenseJwtClaims = {
  iss: string;
  license_id: string;
  user_id: string;
  plan: string;
  features: string[];
  devices_max: number;
  issued_at: number;
  expires_at: number;
  grace_until: number;
  support_until?: number;
  revocation_check_after: number;
};

export type LicenseActiveRecord = {
  license_id: string;
  user_id: string;
  plan: string;
  features: string[];
  devices_max: number;
  device_ids: string[];
  issued_at: number;
  expires_at: number;
  grace_until: number;
  revoked: boolean;
  revoked_at: number | null;
  revoked_reason: string | null;
  stripe_subscription_id: string | null;
};

export type RevocationSet = {
  license_ids: string[];
  updated_at: number;
};

export type ApiError = {
  error: {
    _tag: string;
    message: string;
  };
};
