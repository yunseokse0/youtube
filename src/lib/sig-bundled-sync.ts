import { normalizeSigImageUrlStored } from "@/lib/constants";
import type { AppState } from "@/lib/state";

export function sigBundledPathKey(p: string): string {
  return String(p || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

export function sigImageFileBaseKey(urlOrPath: string): string {
  const s = sigBundledPathKey(urlOrPath);
  return s.split("/").filter(Boolean).pop() || "";
}

/** 롤링·인벤·완판 도장에 이미 쓰는 경로(및 파일명) */
export function collectUsedSigImageKeys(state: AppState | null | undefined): {
  paths: Set<string>;
  bases: Set<string>;
} {
  const paths = new Set<string>();
  const bases = new Set<string>();
  const add = (raw: string) => {
    const url = normalizeSigImageUrlStored(raw).trim();
    if (!url) return;
    paths.add(sigBundledPathKey(url));
    const base = sigImageFileBaseKey(url);
    if (base) bases.add(base);
  };
  for (const item of state?.sigInventory || []) {
    add(String(item.imageUrl || ""));
  }
  const sr = state?.sigRolling;
  if (sr && typeof sr === "object" && Array.isArray((sr as { items?: unknown }).items)) {
    for (const row of (sr as { items: { url?: string }[] }).items) {
      add(String(row?.url || ""));
    }
  }
  add(String(state?.sigSoldOutStampUrl || ""));
  return { paths, bases };
}

const SKIP_AUTO_ADD = /\/(dummy-sig\.svg|stamp\.svg|stamp\.png|stamp\.gif|stamp\.webp)$/i;

/** Git 번들 목록 중 롤링에 아직 없는 `/images/sigs/…` 만 */
export function filterBundledPathsNotInUse(
  bundledPaths: string[],
  used: { paths: Set<string>; bases: Set<string> }
): string[] {
  return bundledPaths.filter((p) => {
    const norm = String(p || "").trim();
    if (!norm.startsWith("/images/sigs/")) return false;
    if (SKIP_AUTO_ADD.test(norm)) return false;
    const key = sigBundledPathKey(norm);
    if (used.paths.has(key)) return false;
    const base = sigImageFileBaseKey(norm);
    if (base && used.bases.has(base)) return false;
    return true;
  });
}
