export type DonationIngestMode = "toonation" | "toona";

export const DEFAULT_DONATION_INGEST_MODE: DonationIngestMode = "toonation";

const LS_PREFIX = "donationIngestMode";

export function donationIngestModeStorageKey(userId: string): string {
  return `${LS_PREFIX}:${String(userId || "").trim()}`;
}

export function parseDonationIngestMode(raw: unknown): DonationIngestMode {
  return raw === "toona" ? "toona" : "toonation";
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
