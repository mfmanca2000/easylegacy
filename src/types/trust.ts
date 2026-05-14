// EasyLegacy — Trust transfer types

export type TrustStatus = "PENDING" | "BLOCKED" | "GRANTED" | "EXPIRED" | "COMPLETED";

export interface TrustRequestRecord {
  id: string;
  status: TrustStatus;
  spouseNameDisplay: string;
  requestedAt: string;
  waitingUntil: string;
  blockedAt?: string | null;
  grantedAt?: string | null;
  accessTokenExpiry?: string | null;
}

export interface TrustConfigRecord {
  id: string;
  ownerEmailHash: string;
  spouseEmailHash: string;
  waitingPeriodDays: number;
  encryptedVekShard: string;
  vstHash: string;
  salt2Base64: string;
  configured: boolean;
}
