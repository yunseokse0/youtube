import type { SigItem } from "@/types";
import {
  coerceSigUrlToGithubBundledPath,
  isSigImagesGithubOnlyMode,
  isSigImagesPlaceholderOnlyEnv,
  isSigLocalAssetsOnlyMode,
  shouldStripUntrustedExternalSigImageUrls,
} from "@/lib/sig-image-mode";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";

/** 저장소에 미설정 시 완판 오버레이·관리 화면 기본 도장(`public/images/sigs/stamp.png`) */
export const DEFAULT_SIG_SOLD_STAMP_URL = "/images/sigs/stamp.png";

/** Git·Render 배포본에 포함된 공통 시그 이미지(`public/images/sigs/dummy-sig.svg`) */
export const BUNDLED_SIG_PLACEHOLDER_URL = "/images/sigs/dummy-sig.svg";

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
  /** 상대 경로 `images/…` `uploads/…` → 절대 경로화 (레거시 URL) */
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
  if (isSigImagesGithubOnlyMode() && /\/uploads\/sigs\//i.test(s)) {
    s = coerceSigUrlToGithubBundledPath(s);
    if (s.startsWith("/images/sigs/")) return s;
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
export function getSigRollingGithubRawRoot(): string {
  const raw = typeof process !== "undefined" ? String(process.env.NEXT_PUBLIC_SIG_ROLLING_GITHUB_BASE ?? "").trim() : "";
  if (raw === "0" || raw.toLowerCase() === "off") return "";
  if (raw) return raw.replace(/\/$/, "");
  return "https://raw.githubusercontent.com/yunseokse0/youtube/main/public";
}

export function rewriteSigPathForRollingGithubIfConfigured(resolvedUrl: string): string {
  const s = String(resolvedUrl || "").trim();
  if (!s.startsWith("/images/sigs/")) return resolvedUrl;
  const root = getSigRollingGithubRawRoot();
  if (!root) return resolvedUrl;
  const rel = s.startsWith("/") ? s.slice(1) : s;
  const parts = rel.split("/").filter(Boolean).map((seg) => encodeURIComponent(seg));
  return `${root}/${parts.join("/")}`;
}

/** `/images/sigs/…`·레거시 `/uploads/sigs/…` → GitHub raw(설정 시). 미들웨어 307·클라이언트 공통 */
export function toGithubRawSigAssetUrl(pathOrUrl: string): string | null {
  let s = String(pathOrUrl || "").trim();
  if (!s) return null;
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
  const root = getSigRollingGithubRawRoot();
  if (!root) return null;
  return rewriteSigPathForRollingGithubIfConfigured(s);
}

/** 롤링 카드·GIF 홀드 계산용 — `resolveSigImageUrl` 후 GitHub raw 적용 */
export function resolveSigRollingImageUrl(name: string, imageUrl?: string): string {
  return rewriteSigPathForRollingGithubIfConfigured(resolveSigImageUrl(name, imageUrl));
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
        name: String(x.name || "시그"),
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

export function resolveSigImageUrl(name: string, imageUrl?: string): string {
  if (sigImagePlaceholderOnlyForOverlay) {
    return BUNDLED_SIG_PLACEHOLDER_URL;
  }
  const raw = normalizeSigImageUrlStored(imageUrl);
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
      return raw;
    }
    if (raw.startsWith("/")) return offloadBundledSigPathIfConfigured(raw);
    if (raw.startsWith("uploads/") || raw.startsWith("images/")) {
      return offloadBundledSigPathIfConfigured(`/${raw}`);
    }
  }
  const safeName = String(name || "").trim();
  if (!safeName) return BUNDLED_SIG_PLACEHOLDER_URL;
  /** public 에 이름별 PNG 가 없으면 404만 줄줄이 남음 → 공통 더미(이미지 URL을 비운 시그) */
  return BUNDLED_SIG_PLACEHOLDER_URL;
}
