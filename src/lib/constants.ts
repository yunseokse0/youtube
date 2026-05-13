import type { SigItem } from "@/types";
import { isSigLocalAssetsOnlyMode } from "@/lib/sig-image-mode";

/** 저장소에 미설정 시 완판 오버레이·관리 화면 기본 도장(`public` 실파일과 동일 경로 유지) */
export const DEFAULT_SIG_SOLD_STAMP_URL = "/images/sigs/stamp.svg";

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

/** 저장된 시그 이미지 경로 보정(`/images/sig/` 오타 → `/images/sigs/`) — 인벤·시그롤링·당첨 배열 모두 적용 */
export function normalizeSigImageUrlStored(raw: unknown): string {
  let s = String(raw ?? "").trim().replace(/\\/g, "/");
  // 콘솔/메신저 복붙 시 붙는 `: ` 프리픽스 제거
  s = s.replace(/^:\s*/, "");
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
    return s;
  }
  if (
    /^https?:\/\/[^/]*supabase\.co\/storage\/v1\/object\/public\//i.test(s) &&
    /\/sigs\//i.test(s)
  ) {
    if (isSigLocalAssetsOnlyMode()) {
      const fileName = s.split("/").filter(Boolean).pop() || "";
      return fileName ? `/images/sigs/${encodeURIComponent(fileName)}` : BUNDLED_SIG_PLACEHOLDER_URL;
    }
    return s;
  }
  /** Supabase 시그 스토리지 외 http(s)는 일괄 더미(404·ERR_INSUFFICIENT_RESOURCES 완화). 필요 시 다시 업로드 */
  if (/^https?:\/\//i.test(s)) {
    return BUNDLED_SIG_PLACEHOLDER_URL;
  }
  return s;
}

export function normalizeSigInventory(input: unknown): SigItem[] {
  if (!Array.isArray(input)) return DEFAULT_SIG_INVENTORY.map((x) => ({ ...x }));
  const list = input
    .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
    .map((x) => {
      const rolling = Boolean(x.isRolling);
      const activeRaw = x.isActive;
      const isActive = typeof activeRaw === "boolean" ? activeRaw : rolling;
      /** 판매 활성(시그 판매 관리) 기준과 롤링·보드 노출을 1:1로 맞춤 */
      return {
        id: String(x.id || `sig_${Math.random().toString(36).slice(2, 8)}`),
        name: String(x.name || "시그"),
        price: Math.max(0, Math.floor(Number(x.price || 0) || 0)),
        imageUrl: normalizeSigImageUrlStored(x.imageUrl),
        memberId: String(x.memberId || ""),
        maxCount: Math.max(1, Math.floor(Number(x.maxCount || 1) || 1)),
        soldCount: Math.max(0, Math.floor(Number(x.soldCount || 0) || 0)),
        isRolling: isActive,
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
    if (raw.startsWith("/")) return raw;
    if (raw.startsWith("uploads/") || raw.startsWith("images/")) return `/${raw}`;
  }
  const safeName = String(name || "").trim();
  if (!safeName) return BUNDLED_SIG_PLACEHOLDER_URL;
  /** public 에 이름별 PNG 가 없으면 404만 줄줄이 남음 → 공통 더미(이미지 URL을 비운 시그) */
  return BUNDLED_SIG_PLACEHOLDER_URL;
}
