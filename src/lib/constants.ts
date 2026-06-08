import type { SigItem } from "@/types";
import {
  coerceSigUrlToGithubBundledPath,
  isSigImagesGithubOnlyMode,
  isSigImagesPlaceholderOnlyEnv,
  isDiskUploadFlatFileName,
  isDiskUploadFlatSigImagePath,
  isSigLocalAssetsOnlyMode,
  repairDiskUploadSigImagePath,
  shouldOffloadSigImagesToGithubRaw,
  shouldServeSigImagesFromDisk,
  shouldStripUntrustedExternalSigImageUrls,
} from "@/lib/sig-image-mode";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";

/** 저장소에 미설정 시 완판 오버레이·관리 화면 기본 도장(`public/images/sigs/stamp.png`) */
export const DEFAULT_SIG_SOLD_STAMP_URL = "/images/sigs/stamp.png";

/** Git·Render 배포본에 포함된 공통 시그 이미지(`public/images/sigs/dummy-sig.svg`) */
export const BUNDLED_SIG_PLACEHOLDER_URL = "/images/sigs/dummy-sig.svg";

/** 한방 시그 카드 기본 GIF — 당첨 시그 이미지로 대체하지 않음 */
export const DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE = "/images/sigs/from-drive/한방시그.gif";

/** 인벤·초안 URL이 한방 전용 이미지로 쓸 만한지(당첨 시그 업로드 GIF 오염 방지) */
export function isDedicatedOneShotSigImageUrl(url: string | undefined | null): boolean {
  const s = String(url || "").trim();
  if (!s || s === BUNDLED_SIG_PLACEHOLDER_URL) return false;
  if (s === DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE) return true;
  if (/한방|hanbang|one[_-]?shot/i.test(s)) return true;
  if (s.startsWith("/uploads/sigs/")) {
    return /한방|hanbang|one[_-]?shot/i.test(s);
  }
  return false;
}

/** 방송에서 자주 쓰는 시그 기본 목록(애교·댄스·식사권 외 프리셋) */
export const BROADCAST_SIG_PRESET_NAMES = [
  "애교",
  "댄스",
  "식사권",
  "보이스",
  "노래",
  "토크",
  "하트",
  "게임",
] as const;

export const DEFAULT_SIG_INVENTORY: SigItem[] = [
  { id: "sig_aegyo", name: "애교", price: 77000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "sig_dance", name: "댄스", price: 100000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "sig_meal", name: "식사권", price: 333000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "sig_voice", name: "보이스", price: 50000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "sig_song", name: "노래", price: 120000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, memberId: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: false },
  { id: "sig_talk", name: "토크", price: 55000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, memberId: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: false },
  { id: "sig_heart", name: "하트", price: 30000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, memberId: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: false },
  { id: "sig_game", name: "게임", price: 88000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, memberId: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: false },
];

function decodePercentEncodedText(raw: unknown): string {
  let out = String(raw ?? "").trim();
  for (let i = 0; i < 4; i++) {
    if (!/%[0-9a-f]{2}/i.test(out)) break;
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

/** 오버레이 UI 확인용: true 이면 resolveSigImageUrl 이 항상 더미 SVG 반환(실패 PNG 요청·404 방지) */
let sigImagePlaceholderOnlyForOverlay = false;

export function setSigImagePlaceholderOnlyForOverlay(value: boolean): void {
  sigImagePlaceholderOnlyForOverlay = Boolean(value);
}

export function getSigImagePlaceholderOnlyForOverlay(): boolean {
  return sigImagePlaceholderOnlyForOverlay;
}

/** 쿼리스트링이 경로에 붙거나 `/static/user=…` 등으로 잘못 저장된 값 → 무한 요청·ERR_INSUFFICIENT_RESOURCES 유발 가능 */
function isCorruptSigImageUrlString(s: string): boolean {
  const t = s.trim();
  if (!t || t.startsWith("data:") || t.startsWith("blob:")) return false;
  if (/\/static\/user=/i.test(t)) return true;
  if (/\/_next\/static\/[^?]+\?user=/i.test(t)) return true;
  if (/^\/[^?\s]*user=[^&\s]+\&u=[^&\s]+/i.test(t)) return true;
  return false;
}

/** Twip·구 호스팅 등 배포본에 없는 경로 → 404만 연쇄 */
function isPriorKnownDeadSigImagePath(s: string): boolean {
  return /\/sig_images(\/|$|\?)/i.test(s) || /^sig_images(\/|$|\?)/i.test(s);
}

/** 배포 오리진 절대 URL → `/uploads/sigs/...` 상대 경로(재배포·OCR 동일 오리진) */
function toRelativeSigUploadPathIfApplicable(s: string): string {
  try {
    const u = new URL(s);
    const m = u.pathname.match(/(\/uploads\/sigs\/[^?#]+)/i);
    if (m?.[1]) return m[1];
  } catch {
    /* ignore */
  }
  return s;
}

/** OCR·표시에 쓸 수 있는 신뢰 https 시그 URL */
export function isTrustedStoredSigImageHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    const path = u.pathname;
    if (/\/uploads\/sigs\//i.test(path)) return true;
    if (/\/api\/ftp\/image\//i.test(path)) return true;
    if (/^https?:\/\/[^/]*supabase\.co\/storage\/v1\/object\/public\//i.test(s) && /\/sigs\//i.test(s)) return true;
    if (/raw\.githubusercontent\.com/i.test(u.hostname) && /\/images\/sigs\//i.test(path)) return true;
    return false;
  } catch {
    return false;
  }
}

/** 저장된 시그 이미지 경로 보정(`/images/sig/` 오타 → `/images/sigs/`) — 인벤·시그롤링·당첨 배열 모두 적용 */
export function normalizeSigImageUrlStored(raw: unknown): string {
  let s = String(raw ?? "").trim().replace(/\\/g, "/");
  // 콘솔/메신저 복붙 시 붙는 `: ` 프리픽스 제거
  s = s.replace(/^:\s*/, "");
  /** `//cdn.example/...` 는 브라우저가 현재 origin 기준 https로 요청 → ImageKit 등이 정규화를 빠져나가지 않게 https: 로 고정 */
  if (s.startsWith("//")) s = `https:${s}`;
  if (!s) return "";
  if (isCorruptSigImageUrlString(s)) {
    return BUNDLED_SIG_PLACEHOLDER_URL;
  }
  if (isPriorKnownDeadSigImagePath(s)) {
    return BUNDLED_SIG_PLACEHOLDER_URL;
  }
  /** `./uploads/…` · `uploads/…` → 루트 기준 절대 경로(OBS·오버레이 URL에서 404 방지) */
  if (s.startsWith("./")) s = `/${s.slice(2).replace(/^\/+/, "")}`;
  if (
    !s.startsWith("/") &&
    !s.startsWith("http://") &&
    !s.startsWith("https://") &&
    !s.startsWith("data:") &&
    !s.startsWith("blob:")
  ) {
    if (s.startsWith("images/") || s.startsWith("uploads/")) s = `/${s}`;
  }
  if (s.startsWith("/images/sig/")) {
    s = s.replace(/^\/images\/sig\//, "/images/sigs/");
  }
  if (s.startsWith("/images/sigs/")) {
    if (isSigImagesPlaceholderOnlyEnv()) {
      const lower = s.toLowerCase();
      const keepBundled =
        lower.includes("dummy-sig.svg") ||
        lower.endsWith("/stamp.svg") ||
        lower.endsWith("stamp.svg") ||
        lower.endsWith("/stamp.png") ||
        lower.endsWith("stamp.png");
      if (!keepBundled) return BUNDLED_SIG_PLACEHOLDER_URL;
    }
    return s;
  }
  if (isSigImagesPlaceholderOnlyEnv() && s.startsWith("/uploads/")) {
    return BUNDLED_SIG_PLACEHOLDER_URL;
  }
  /** 사용자 업로드 — OBS·롤링이 배포 오리진 `/api/uploads-sigs` 로 받음(GitHub 파일명만 남기면 404) */
  if (s.startsWith("/uploads/sigs/")) {
    return s;
  }
  if (
    /^https?:\/\/[^/]*supabase\.co\/storage\/v1\/object\/public\//i.test(s) &&
    /\/sigs\//i.test(s)
  ) {
    if (isSigImagesPlaceholderOnlyEnv()) return BUNDLED_SIG_PLACEHOLDER_URL;
    if (isSigLocalAssetsOnlyMode()) {
      const fileName = s.split("/").filter(Boolean).pop() || "";
      return fileName ? `/images/sigs/${encodeURIComponent(fileName)}` : BUNDLED_SIG_PLACEHOLDER_URL;
    }
    return s;
  }
  /** Next 앱 FTP 프록시(시그 이미지) — 배포 Origin 기준 절대 URL */
  if (/^https?:\/\//i.test(s) && /\/api\/ftp\/image\//i.test(s)) {
    if (isSigImagesPlaceholderOnlyEnv()) return BUNDLED_SIG_PLACEHOLDER_URL;
    return s;
  }
  if (/^https?:\/\//i.test(s)) {
    let relUpload = toRelativeSigUploadPathIfApplicable(s);
    if (relUpload !== s && isSigImagesGithubOnlyMode()) {
      relUpload = coerceSigUrlToGithubBundledPath(relUpload);
    }
    if (relUpload !== s) return relUpload;
    if (isTrustedStoredSigImageHttpUrl(s)) return s;
    if (shouldStripUntrustedExternalSigImageUrls()) return BUNDLED_SIG_PLACEHOLDER_URL;
    return s;
  }
  return s;
}

/**
 * 시그 롤링·보드: `/images/sigs/…` 를 GitHub `public/` raw URL로 바꿔 Render 아웃바운드 절감.
 * `NEXT_PUBLIC_SIG_ROLLING_GITHUB_BASE` 가 `0`/`off` 이면 치환 안 함. 미설정 시 본 저장소 `main` 기본값.
 */
function readSigRollingGithubRawRootEnv(): string {
  const raw = typeof process !== "undefined" ? String(process.env.NEXT_PUBLIC_SIG_ROLLING_GITHUB_BASE ?? "").trim() : "";
  if (raw === "0" || raw.toLowerCase() === "off") return "";
  if (raw) return raw.replace(/\/$/, "");
  return "https://raw.githubusercontent.com/yunseokse0/youtube/main/public";
}

export function getSigRollingGithubRawRoot(): string {
  if (!shouldOffloadSigImagesToGithubRaw()) return "";
  return readSigRollingGithubRawRootEnv();
}

/** OBS 방송 — 디스크 모드여도 from-drive 번들 GitHub raw 재시도 */
function getSigRollingGithubRawRootForced(): string {
  return readSigRollingGithubRawRootEnv();
}

function encodeGithubRawPathSegment(seg: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(seg));
  } catch {
    return encodeURIComponent(seg);
  }
}

export function rewriteSigPathForRollingGithubIfConfigured(resolvedUrl: string): string {
  const s = String(resolvedUrl || "").trim();
  if (!s.startsWith("/images/sigs/")) return resolvedUrl;
  const root = getSigRollingGithubRawRoot();
  if (!root) return resolvedUrl;
  const rel = s.startsWith("/") ? s.slice(1) : s;
  const parts = rel.split("/").filter(Boolean).map(encodeGithubRawPathSegment);
  return `${root}/${parts.join("/")}`;
}

function buildGithubRawSigAssetUrl(pathOrUrl: string, forceOverlay = false): string | null {
  let s = String(pathOrUrl || "").trim();
  if (!s) return null;
  if (/\/uploads\/sigs\//i.test(s)) return null;
  if (/^https?:\/\//i.test(s)) {
    if (/raw\.githubusercontent\.com/i.test(s)) return s;
    try {
      const u = new URL(s);
      const m = u.pathname.match(/(\/images\/sigs\/[^?#]+)/i);
      if (m?.[1]) s = m[1];
      else if (/\/uploads\/sigs\//i.test(u.pathname)) {
        s = coerceSigUrlToGithubBundledPath(u.pathname);
      } else return null;
    } catch {
      return null;
    }
  }
  if (s.startsWith("uploads/") || s.startsWith("images/")) s = `/${s}`;
  if (/\/uploads\/sigs\//i.test(s)) s = coerceSigUrlToGithubBundledPath(s);
  if (!s.startsWith("/images/sigs/")) return null;
  const root = forceOverlay ? getSigRollingGithubRawRootForced() : getSigRollingGithubRawRoot();
  if (!root) return null;
  const rel = s.startsWith("/") ? s.slice(1) : s;
  const parts = rel.split("/").filter(Boolean).map(encodeGithubRawPathSegment);
  return `${root}/${parts.join("/")}`;
}

/** `/images/sigs/…`·레거시 `/uploads/sigs/…` → GitHub raw(설정 시). 미들웨어 307·클라이언트 공통 */
export function toGithubRawSigAssetUrl(pathOrUrl: string): string | null {
  if (!shouldOffloadSigImagesToGithubRaw()) return null;
  return buildGithubRawSigAssetUrl(pathOrUrl);
}

/** OBS 방송 — EC2 디스크 모드에서도 from-drive 번들 GitHub raw 재시도(더미 대신 실제 GIF) */
export function toGithubRawSigAssetUrlForced(pathOrUrl: string): string | null {
  return buildGithubRawSigAssetUrl(pathOrUrl, true);
}

/** 롤링·시그 보드 — 당첨 카드와 동일(업로드 동일 오리진, 번들은 from-drive·raw) */
export function resolveSigRollingImageUrl(name: string, imageUrl?: string, userId?: string): string {
  return resolveSigOverlayCardImageUrl(name, imageUrl, userId);
}

/** OBS `<img>`용 — 상대 경로를 현재 오리진 절대 URL로(브라우저 소스 기준) */
export function toSigOverlayAbsoluteAssetUrl(pathOrUrl: string): string {
  const s = String(pathOrUrl || "").trim();
  if (!s || typeof window === "undefined") return s;
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:") || s.startsWith("blob:")) {
    return s;
  }
  if (s.startsWith("/")) return `${window.location.origin}${s}`;
  return s;
}

/**
 * OBS·당첨 카드 — 업로드는 동일 오리진, 번들 GIF는 관리자 미리보기와 동일(raw·from-drive 폴백).
 */
export function resolveSigOverlayCardImageUrl(name: string, imageUrl?: string, userId?: string): string {
  if (sigImagePlaceholderOnlyForOverlay) {
    return BUNDLED_SIG_PLACEHOLDER_URL;
  }
  const candidates = listSigOverlayImageFallbackUrls(name, imageUrl, userId);
  let raw = candidates[0] || resolveSigOverlayStoredPath(name, imageUrl, userId);
  if (raw.startsWith("/uploads/sigs/")) {
    /** OBS·브라우저: EC2/로컬 동일 오리진 우선 — GitHub raw 404 시 검은 칸만 보임 */
    if (typeof window !== "undefined") {
      return toSigOverlayAbsoluteAssetUrl(raw);
    }
    if (shouldServeSigImagesFromDisk()) {
      return raw;
    }
    /** SSR·서버만: GitHub 번들 폴백 */
    const bundled = coerceSigUrlToGithubBundledPath(raw);
    const gh = toGithubRawSigAssetUrl(bundled);
    if (gh) return gh;
    return raw;
  }
  /** 번들·from-drive — 관리자 미리보기와 동일 규칙(GitHub raw·from-drive 폴백) */
  let adminResolved = resolveSigAdminPreviewSrc(raw || imageUrl, name, userId);
  if (isBrokenSigOverlayStoredPath(adminResolved)) {
    const byName = resolveSigBundledFromDriveByName(name);
    adminResolved =
      byName ||
      resolveSigAdminPreviewSrc(byName, name, userId) ||
      candidates.find((c) => !isBrokenSigOverlayStoredPath(c)) ||
      raw;
  }
  if (typeof window !== "undefined") {
    if (adminResolved.startsWith("/")) return toSigOverlayAbsoluteAssetUrl(adminResolved);
    if (adminResolved.startsWith("http://") || adminResolved.startsWith("https://")) {
      return adminResolved;
    }
  }
  if (!adminResolved || isBrokenSigOverlayStoredPath(adminResolved)) {
    const byName = resolveSigBundledFromDriveByName(name);
    if (byName) {
      const gh = toGithubRawSigAssetUrlForced(byName);
      if (typeof window !== "undefined") {
        return toSigOverlayAbsoluteAssetUrl(byName);
      }
      return gh || byName;
    }
  }
  return adminResolved || raw || resolveSigBundledFromDriveByName(name);
}

/** 완판 도장 URL — 롤링 오버레이에서만 GitHub raw로 동일 규칙 적용 */
export function resolveSigRollingStampUrl(storedOrEmpty?: string): string {
  const raw = String(storedOrEmpty || "").trim();
  return rewriteSigPathForRollingGithubIfConfigured(resolveSigImageUrl("stamp", raw || DEFAULT_SIG_SOLD_STAMP_URL));
}

export function normalizeSigInventory(input: unknown): SigItem[] {
  if (!Array.isArray(input)) return DEFAULT_SIG_INVENTORY.map((x) => ({ ...x }));
  const list = input
    .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
    .map((x) => {
      const rollingRaw = x.isRolling;
      const activeRaw = x.isActive;
      const isActive =
        typeof activeRaw === "boolean" ? activeRaw : typeof rollingRaw === "boolean" ? Boolean(rollingRaw) : false;
      /** 판매 활성(`isActive`)과 이미지 롤링 노출(`isRolling`)은 별도 — 관리자 「롤링 제외」가 저장 후에도 유지되게 함 */
      let isRolling = typeof rollingRaw === "boolean" ? Boolean(rollingRaw) : isActive;
      const id = String(x.id || `sig_${Math.random().toString(36).slice(2, 8)}`);
      if (id === ONE_SHOT_SIG_ID) isRolling = false;
      return {
        id,
        name: decodePercentEncodedText(x.name || "시그") || "시그",
        price: Math.max(0, Math.floor(Number(x.price || 0) || 0)),
        imageUrl: normalizeSigImageUrlStored(x.imageUrl),
        memberId: String(x.memberId || ""),
        maxCount: Math.max(1, Math.floor(Number(x.maxCount || 1) || 1)),
        soldCount: Math.max(0, Math.floor(Number(x.soldCount || 0) || 0)),
        isRolling,
        isActive,
      };
    })
    .map((x) => ({ ...x, soldCount: Math.min(x.soldCount, x.maxCount) }));
  return list.length > 0 ? list : DEFAULT_SIG_INVENTORY.map((x) => ({ ...x }));
}

/** 시그 인벤(`sigInventory`)만: id·이름·가격·판매량 등은 유지하고 `imageUrl`만 공용 더미로 통일 */
export function stripSigInventoryImagesKeepList(items: SigItem[] | null | undefined): SigItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((x) => ({ ...x, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL }));
}

/** 번들 시그(`/images/sigs/…`)를 GitHub raw로 우회해 Render 아웃바운드 절감(기본 on, `NEXT_PUBLIC_SIG_ROLLING_GITHUB_BASE=off` 시 비활성) */
function offloadBundledSigPathIfConfigured(path: string): string {
  const s = String(path || "").trim();
  if (!s.startsWith("/images/sigs/")) return s;
  return rewriteSigPathForRollingGithubIfConfigured(s);
}

/** `public/images/sigs/` 루트에만 있고 from-drive 로 옮기지 않은 번들 자산 */
const BUNDLED_SIG_ROOT_ONLY_RE = /\/(dummy-sig\.svg|stamp\.(?:svg|png|gif|webp))$/i;

/**
 * `public/images/sigs/파일.gif` 만 저장된 레거시 — 실제 파일은 `from-drive/` 아래인 경우가 많음.
 * 더미·도장은 루트 경로만 사용(from-drive 로 바꾸면 404).
 */
export function sigBundledFromDriveFallbackPath(storedPath: string): string | null {
  const s = String(storedPath || "").trim();
  if (!/^\/images\/sigs\/[^/]+\.[a-z0-9]+$/i.test(s)) return null;
  if (s.includes("/from-drive/")) return null;
  if (BUNDLED_SIG_ROOT_ONLY_RE.test(s)) return null;
  return s.replace(/^\/images\/sigs\//i, "/images/sigs/from-drive/");
}

/** 표시 이름 ↔ from-drive 파일명 불일치(오타·동음) */
const SIG_FROM_DRIVE_NAME_ALIASES: Record<string, string> = {
  보그댄스: "복고댄스",
};

/** 시그 이름으로 Git 번들 GIF 경로 (`public/images/sigs/from-drive/`) */
export function resolveSigBundledFromDriveByName(name: string): string {
  const n = String(name || "").trim();
  if (!n) return "";
  const fileBase = SIG_FROM_DRIVE_NAME_ALIASES[n] || n;
  return `/images/sigs/from-drive/${encodeURIComponent(fileBase)}.gif`;
}

/** from-drive·루트 번들 후보(방송 OBS 404 연쇄 재시도) */
export function listSigBundledFromDriveCandidatesByName(name: string): string[] {
  const n = String(name || "").trim();
  if (!n) return [];
  const fileBase = SIG_FROM_DRIVE_NAME_ALIASES[n] || n;
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u: string) => {
    const s = String(u || "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  add(`/images/sigs/from-drive/${encodeURIComponent(fileBase)}.gif`);
  add(`/images/sigs/${encodeURIComponent(fileBase)}.gif`);
  if (fileBase !== n) {
    add(`/images/sigs/from-drive/${encodeURIComponent(n)}.gif`);
    add(`/images/sigs/${encodeURIComponent(n)}.gif`);
  }
  return out;
}

/**
 * 레거시 OCR·로마자 경로(`/images/sig/bogdance.png` 등) — 실제 에셋은 from-drive/한글명.gif.
 * 업로드·from-drive·한글 파일명은 유효로 둠.
 */
export function isLegacyRomanizedFlatSigPath(url: string): boolean {
  const raw = String(url || "").trim();
  if (/^\/images\/sig\//i.test(raw)) return true;
  const s = normalizeSigImageUrlStored(raw);
  if (!s.startsWith("/images/sigs/") || s.includes("/from-drive/")) return false;
  if (BUNDLED_SIG_ROOT_ONLY_RE.test(s)) return false;
  if (isDiskUploadFlatSigImagePath(s)) return false;
  const m = s.match(/^\/images\/sigs\/([^/?#]+)$/i);
  if (!m?.[1]) return false;
  let base = m[1];
  try {
    base = decodeURIComponent(base);
  } catch {
    /* keep */
  }
  if (/[가-힣]/.test(base)) return false;
  if (isDiskUploadFlatFileName(base)) return false;
  return true;
}

function isBrokenSigOverlayStoredPath(url: string | undefined | null): boolean {
  const s = String(url || "").trim();
  if (!s || s === BUNDLED_SIG_PLACEHOLDER_URL) return true;
  if (/^\/images\/sig\//i.test(s)) return true;
  return isLegacyRomanizedFlatSigPath(s);
}

function resolveSigOverlayStoredPath(name: string, imageUrl?: string, userId?: string): string {
  const repaired = repairDiskUploadSigImagePath(String(imageUrl ?? "").trim(), userId);
  let raw = normalizeSigImageUrlStored(repaired || imageUrl);
  if (!raw || isBrokenSigOverlayStoredPath(raw)) {
    const byName = resolveSigBundledFromDriveByName(name);
    if (byName) raw = byName;
  } else if (raw.startsWith("/images/sigs/")) {
    const fromDrive = sigBundledFromDriveFallbackPath(raw);
    if (fromDrive) raw = fromDrive;
  }
  if (!raw || isBrokenSigOverlayStoredPath(raw)) {
    raw = resolveSigBundledFromDriveByName(name) || raw;
  }
  return raw;
}

/** OBS·수동 판매 — 저장 경로가 비거나 레거시면 인벤·from-drive 실경로만(더미 금지) */
export function ensureSigOverlayDisplayStoredUrl(
  name: string,
  imageUrl?: string,
  userId?: string
): string {
  const stored = resolveSigOverlayStoredPath(name, imageUrl, userId);
  if (stored && !isBrokenSigOverlayStoredPath(stored)) return stored;
  return resolveSigBundledFromDriveByName(name) || stored || String(imageUrl || "").trim();
}

/** SigSaleMedia 404 시 순차 시도 — 업로드·from-drive·GitHub raw만(더미 제외) */
export function listSigOverlayImageFallbackUrls(
  name: string,
  imageUrl?: string,
  userId?: string
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u: string | null | undefined) => {
    const s = String(u || "").trim();
    if (!s || seen.has(s) || isBrokenSigOverlayStoredPath(s)) return;
    seen.add(s);
    out.push(s);
  };
  const rawStored = String(imageUrl ?? "").trim();
  add(repairDiskUploadSigImagePath(rawStored, userId));
  add(resolveSigOverlayStoredPath(name, imageUrl, userId));
  add(sigBundledFromDriveFallbackPath(rawStored));
  if (isDiskUploadFlatSigImagePath(rawStored)) {
    add(repairDiskUploadSigImagePath(rawStored, userId));
  }
  for (const bundled of listSigBundledFromDriveCandidatesByName(name)) {
    add(bundled);
  }
  const snapshot = [...out];
  for (const base of snapshot) {
    add(toGithubRawSigAssetUrlForced(base));
  }
  return out;
}

/** 관리자 미리보기 — 디스크 업로드 시 동일 오리진, Render GitHub-only 시 raw 우선 */
export function resolveSigAdminPreviewSrc(raw?: string, name?: string, userId?: string): string {
  const v = repairDiskUploadSigImagePath(String(raw ?? "").trim(), userId);
  if (/(?:_257b_2522id_2522|%257b%2522id%2522|%7b%22id%22)/i.test(v)) {
    return toGithubRawSigAssetUrl(BUNDLED_SIG_PLACEHOLDER_URL) || BUNDLED_SIG_PLACEHOLDER_URL;
  }
  const nameStr = String(name ?? "").trim();
  const storedPath = resolveSigOverlayStoredPath(nameStr, v || raw, userId);
  const resolved = resolveSigImageUrl(nameStr, storedPath || v);
  if (!shouldOffloadSigImagesToGithubRaw()) return resolved;
  return toGithubRawSigAssetUrl(resolved) || resolved;
}

/** 미리보기 1차 404 시 시도할 from-drive 경로(GitHub raw) */
export function resolveSigAdminPreviewFallbackSrc(raw?: string, name?: string, userId?: string): string | null {
  const v = repairDiskUploadSigImagePath(String(raw ?? "").trim(), userId);
  const resolved = resolveSigImageUrl(String(name ?? "").trim(), v);
  let path = resolved;
  if (/^https?:\/\//i.test(resolved)) {
    try {
      const u = new URL(resolved);
      const m = u.pathname.match(/(\/images\/sigs\/[^?#]+)/i);
      path = m?.[1] || resolved;
    } catch {
      return null;
    }
  }
  const alt = sigBundledFromDriveFallbackPath(path);
  const byName = name ? resolveSigBundledFromDriveByName(name) : "";
  const candidates = [alt, byName].filter((u): u is string => Boolean(u));
  for (const candidate of candidates) {
    const url = toGithubRawSigAssetUrl(candidate) || candidate;
    if (url && url !== resolveSigAdminPreviewSrc(raw, name, userId)) return url;
  }
  return null;
}

export function resolveSigImageUrl(name: string, imageUrl?: string, userId?: string): string {
  if (sigImagePlaceholderOnlyForOverlay) {
    return BUNDLED_SIG_PLACEHOLDER_URL;
  }
  const input = String(imageUrl ?? "").trim();
  let repaired = repairDiskUploadSigImagePath(input, userId);
  let raw = normalizeSigImageUrlStored(repaired || imageUrl);
  if (shouldServeSigImagesFromDisk()) {
    repaired = repairDiskUploadSigImagePath(raw, userId);
    if (repaired.startsWith("/uploads/sigs/")) return repaired;
    raw = repaired;
  }
  if (raw) {
    if (/(?:_257b_2522id_2522|%257b%2522id%2522|%7b%22id%22)/i.test(raw)) {
      return BUNDLED_SIG_PLACEHOLDER_URL;
    }
    if (
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("data:image/") ||
      raw.startsWith("blob:")
    ) {
      if (shouldServeSigImagesFromDisk()) {
        const diskFromHttp = repairDiskUploadSigImagePath(raw, userId);
        if (diskFromHttp.startsWith("/uploads/sigs/")) return diskFromHttp;
      }
      return raw;
    }
    if (raw.startsWith("/uploads/sigs/")) return raw;
    if (isDiskUploadFlatSigImagePath(raw)) {
      const diskPath = repairDiskUploadSigImagePath(raw, userId);
      if (diskPath.startsWith("/uploads/sigs/")) return diskPath;
    }
    if (raw.startsWith("/")) return offloadBundledSigPathIfConfigured(raw);
    if (raw.startsWith("uploads/") || raw.startsWith("images/")) {
      return offloadBundledSigPathIfConfigured(`/${raw}`);
    }
  }
  const safeName = String(name || "").trim();
  if (!safeName) return BUNDLED_SIG_PLACEHOLDER_URL;
  const byName = resolveSigBundledFromDriveByName(safeName);
  if (byName) {
    const local = offloadBundledSigPathIfConfigured(byName);
    return local || toGithubRawSigAssetUrlForced(byName) || local;
  }
  return BUNDLED_SIG_PLACEHOLDER_URL;
}
