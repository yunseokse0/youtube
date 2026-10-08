export type DonationIngestMode = "toonation" | "toona";

/** A(투네 직접)는 폐기. 화면·저장값 기본은 DIN 허브. */
export const DEFAULT_DONATION_INGEST_MODE: DonationIngestMode = "toona";

const LS_PREFIX = "donationIngestMode";

export function donationIngestModeStorageKey(userId: string): string {
  return `${LS_PREFIX}:${String(userId || "").trim()}`;
}

export function parseDonationIngestMode(_raw: unknown): DonationIngestMode {
  return "toona";
}

export function readDonationIngestMode(userId: string | null | undefined): DonationIngestMode {
  if (typeof window === "undefined") return DEFAULT_DONATION_INGEST_MODE;
  const uid = String(userId || "").trim();
  if (!uid) return DEFAULT_DONATION_INGEST_MODE;
  try {
    return parseDonationIngestMode(window.localStorage.getItem(donationIngestModeStorageKey(uid)));
  } catch {
    return DEFAULT_DONATION_INGEST_MODE;
  }
}

export function writeDonationIngestMode(
  userId: string | null | undefined,
  mode: DonationIngestMode
): void {
  if (typeof window === "undefined") return;
  const uid = String(userId || "").trim();
  if (!uid) return;
  try {
    window.localStorage.setItem(donationIngestModeStorageKey(uid), mode);
  } catch {
    /* ignore */
  }
}

export function getToonaDashboardUrl(): string {
  const fromEnv = String(process.env.NEXT_PUBLIC_TOONA_API_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  return fromEnv || "http://localhost:4000";
}
