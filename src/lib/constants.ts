import type { SigItem } from "@/types";

/** 저장소에 미설정 시 완판 오버레이·관리 화면 기본 도장(`public` 실파일과 동일 경로 유지) */
export const DEFAULT_SIG_SOLD_STAMP_URL = "/images/sigs/stamp.svg";

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
  { id: "sig_aegyo", name: "애교", price: 77000, imageUrl: "/images/sigs/애교.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "sig_dance", name: "댄스", price: 100000, imageUrl: "/images/sigs/댄스.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "sig_meal", name: "식사권", price: 333000, imageUrl: "/images/sigs/식사권.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "sig_voice", name: "보이스", price: 50000, imageUrl: "/images/sigs/보이스.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: true },
  { id: "sig_song", name: "노래", price: 120000, imageUrl: "/images/sigs/노래.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: false },
  { id: "sig_talk", name: "토크", price: 55000, imageUrl: "/images/sigs/토크.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: false },
  { id: "sig_heart", name: "하트", price: 30000, imageUrl: "/images/sigs/하트.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: false },
  { id: "sig_game", name: "게임", price: 88000, imageUrl: "/images/sigs/게임.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: false },
];

/** 오버레이 UI 확인용: true 이면 resolveSigImageUrl 이 항상 더미 SVG 반환(실패 PNG 요청·404 방지) */
let sigImagePlaceholderOnlyForOverlay = false;

export function setSigImagePlaceholderOnlyForOverlay(value: boolean): void {
  sigImagePlaceholderOnlyForOverlay = Boolean(value);
}

export function getSigImagePlaceholderOnlyForOverlay(): boolean {
  return sigImagePlaceholderOnlyForOverlay;
}

/** 저장된 시그 이미지 경로 보정(`/images/sig/` 오타 → `/images/sigs/`) — 인벤·당첨 배열 모두 적용 */
export function normalizeSigImageUrlStored(raw: unknown): string {
  const s = String(raw ?? "").trim().replace(/\\/g, "/");
  if (!s) return "";
  if (s.startsWith("/images/sig/")) {
    return s.replace(/^\/images\/sig\//, "/images/sigs/");
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
      return {
        id: String(x.id || `sig_${Math.random().toString(36).slice(2, 8)}`),
        name: String(x.name || "시그"),
        price: Math.max(0, Math.floor(Number(x.price || 0) || 0)),
        imageUrl: normalizeSigImageUrlStored(x.imageUrl),
        memberId: String(x.memberId || ""),
        maxCount: Math.max(1, Math.floor(Number(x.maxCount || 1) || 1)),
        soldCount: Math.max(0, Math.floor(Number(x.soldCount || 0) || 0)),
        isRolling: rolling,
        isActive: isActive,
      };
    })
    .map((x) => ({ ...x, soldCount: Math.min(x.soldCount, x.maxCount) }));
  return list.length > 0 ? list : DEFAULT_SIG_INVENTORY.map((x) => ({ ...x }));
}

export function resolveSigImageUrl(name: string, imageUrl?: string): string {
  if (sigImagePlaceholderOnlyForOverlay) {
    return "/images/sigs/dummy-sig.svg";
  }
  const raw = normalizeSigImageUrlStored(imageUrl);
  if (raw) {
    if (/(?:_257b_2522id_2522|%257b%2522id%2522|%7b%22id%22)/i.test(raw)) {
      return "/images/sigs/dummy-sig.svg";
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
  if (!safeName) return "/images/sigs/dummy-sig.svg";
  /** public 에 이름별 PNG 가 없으면 404만 줄줄이 남음 → 공통 더미(이미지 URL을 비운 시그) */
  return "/images/sigs/dummy-sig.svg";
}
