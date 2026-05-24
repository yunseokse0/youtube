import type { AppState, SigItem } from "@/types";
import { BUNDLED_SIG_PLACEHOLDER_URL } from "@/lib/constants";
import { ONE_SHOT_SIG_ID, canonicalSigIdFromWheelSliceId } from "@/lib/sig-roulette";

/** 로컬·점검용 휠 데모 시그 id — `saveState`·`/api/state` 에서 항상 제거 */
export const WHEEL_DEMO_SIG_ID_PREFIX = "wheel_demo_";

/** 로컬 데모 기본: 회전판 20칸 · 당첨 5개 · 한방 시그 합산 카드 */
export const WHEEL_DEMO_MENU_COUNT = 20;
export const WHEEL_DEMO_WIN_COUNT = 5;

const demoGif = (fileName: string) =>
  `/images/sigs/from-drive/${encodeURIComponent(fileName)}`;

function demoSig(
  n: number,
  name: string,
  fileName: string,
  price: number
): SigItem {
  const id = `${WHEEL_DEMO_SIG_ID_PREFIX}${String(n).padStart(2, "0")}`;
  return {
    id,
    name,
    price,
    imageUrl: demoGif(fileName),
    memberId: "",
    maxCount: 99,
    soldCount: 0,
    isRolling: true,
    isActive: true,
  };
}

/** 회전판 20칸 점검용(로컬 번들 GIF). 라이브 Redis·프로덕션 인벤토리에는 저장하지 않음 */
export const WHEEL_DEMO_SIG_POOL: SigItem[] = [
  demoSig(1, "제로투", "제로투.gif", 77000),
  demoSig(2, "APT", "APT.gif", 38100),
  demoSig(3, "러브쉐이크", "러브쉐이크.gif", 42000),
  demoSig(4, "만사마", "만사마.gif", 29700),
  demoSig(5, "퍼킹뱅어", "퍼킹뱅어.gif", 33400),
  demoSig(6, "사쿠란보", "사쿠란보.gif", 42500),
  demoSig(7, "오빠하앙", "오빠하앙.gif", 28800),
  demoSig(8, "핑크레이디", "핑크레이디.gif", 51200),
  demoSig(9, "복고댄스", "복고댄스.gif", 36500),
  demoSig(10, "브링밤밤", "브링밤밤.gif", 44800),
  demoSig(11, "seaoflove", "seaoflove.gif", 39800),
  demoSig(12, "레인저스", "레인저스.gif", 38100),
  demoSig(13, "이멀전시", "이멀전시.gif", 24500),
  demoSig(14, "롤린", "롤린.gif", 55200),
  demoSig(15, "탕후루", "탕후루.gif", 31800),
  demoSig(16, "나루토", "나루토.gif", 28900),
  demoSig(17, "고민중독", "고민중독.gif", 44100),
  demoSig(18, "크루엘썸머", "크루엘썸머.gif", 36700),
  demoSig(19, "진격의거인", "진격의거인.gif", 50300),
  demoSig(20, "Lostcontrol", "Lostcontrol.gif", 27600),
];

/** 레거시 preview_* id(관리자 폴백 스핀)도 서버 저장 대상에서 제외 */
const LEGACY_PREVIEW_SIG_ID_PREFIX = "preview_";

export function isWheelDemoSigId(id: string | null | undefined): boolean {
  const s = String(id || "").trim();
  if (!s) return false;
  if (s.startsWith(WHEEL_DEMO_SIG_ID_PREFIX)) return true;
  if (s.startsWith(LEGACY_PREVIEW_SIG_ID_PREFIX)) return true;
  return false;
}

export function stripWheelDemoSigsFromInventory(inventory: SigItem[] | undefined | null): SigItem[] {
  if (!Array.isArray(inventory)) return [];
  return inventory.filter((x) => x && !isWheelDemoSigId(x.id));
}

export function stripWheelDemoSigItems<T extends Pick<SigItem, "id">>(items: T[] | undefined | null): T[] {
  if (!Array.isArray(items)) return [];
  return items.filter((x) => x && !isWheelDemoSigId(x.id));
}

/** 로컬·LAN에서만 휠 데모 풀 사용(프로덕션 호스트에서는 URL에 wheelDemo=1 이 있어도 무시) */
export function isWheelDemoHostAllowed(hostname: string): boolean {
  const h = String(hostname || "").toLowerCase().split(":")[0];
  if (!h) return false;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") return true;
  if (h.endsWith(".local")) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/**
 * `hostname` 을 넘기지 않으면 SSR·첫 페인트에서는 false (하이드레이션 불일치 방지).
 * 클라이언트 마운트 후 `window.location.hostname` 을 넘겨 사용한다.
 */
export function isWheelDemoModeFromSearchParams(
  searchParams: { get: (key: string) => string | null } | null | undefined,
  hostname?: string
): boolean {
  if (!searchParams) return false;
  if ((searchParams.get("wheelDemo") || "").trim() !== "1") return false;
  if (hostname === undefined) return false;
  return isWheelDemoHostAllowed(hostname);
}

export function getWheelDemoMenuCountFromSearchParams(
  searchParams: { get: (key: string) => string | null } | null | undefined,
  wheelDemoActive: boolean
): number | null {
  if (!wheelDemoActive) return null;
  const raw =
    (searchParams?.get("wheelDemoMenuCount") || "").trim() ||
    (searchParams?.get("menuCount") || "").trim();
  if (!raw) return WHEEL_DEMO_MENU_COUNT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return WHEEL_DEMO_MENU_COUNT;
  return Math.max(5, Math.min(20, n));
}

export function getWheelDemoWinCountFromSearchParams(
  searchParams: { get: (key: string) => string | null } | null | undefined,
  wheelDemoActive: boolean
): number {
  if (!wheelDemoActive) return WHEEL_DEMO_WIN_COUNT;
  const raw = (searchParams?.get("wheelDemoWins") || "").trim();
  if (!raw) return WHEEL_DEMO_WIN_COUNT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return WHEEL_DEMO_WIN_COUNT;
  return Math.max(2, Math.min(WHEEL_DEMO_WIN_COUNT, n));
}

/** 당첨 N개(기본 5) — 서로 다른 데모 시그에서 무작위 */
export function pickWheelDemoWinners(count = WHEEL_DEMO_WIN_COUNT): SigItem[] {
  const n = Math.max(2, Math.min(WHEEL_DEMO_WIN_COUNT, Math.floor(count)));
  const shuffled = [...WHEEL_DEMO_SIG_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length)).map((x) => ({ ...x }));
}

/**
 * 착지 정합 점검용 당첨 큐.
 * `duplicateLead`: 앞에서부터 같은 시그를 N회 연속 당첨(순차 회전·duplicatePick 검증).
 */
export function buildWheelDemoWinnerQueueForAlignment(opts?: {
  count?: number;
  duplicateLead?: number;
  /** 고정 시드형 큐(테스트 재현). `preset` 이 있으면 무시 */
  preset?: "spread" | "duplicate2" | "duplicate3";
}): SigItem[] {
  const preset = opts?.preset;
  if (preset === "duplicate2") {
    const a = WHEEL_DEMO_SIG_POOL[0]!;
    const rest = WHEEL_DEMO_SIG_POOL.filter((x) => x.id !== a.id).slice(0, 3);
    return [a, { ...a }, ...rest].map((x) => ({ ...x }));
  }
  if (preset === "duplicate3") {
    const a = WHEEL_DEMO_SIG_POOL[3]!;
    const rest = WHEEL_DEMO_SIG_POOL.filter((x) => x.id !== a.id).slice(0, 2);
    return [a, { ...a }, { ...a }, ...rest].map((x) => ({ ...x }));
  }
  if (preset === "spread") {
    return WHEEL_DEMO_SIG_POOL.slice(0, WHEEL_DEMO_WIN_COUNT).map((x) => ({ ...x }));
  }
  const n = Math.max(2, Math.min(WHEEL_DEMO_WIN_COUNT, Math.floor(opts?.count ?? WHEEL_DEMO_WIN_COUNT)));
  const dup = Math.max(0, Math.min(n - 1, Math.floor(opts?.duplicateLead ?? 0)));
  const shuffled = [...WHEEL_DEMO_SIG_POOL].sort(() => Math.random() - 0.5);
  const queue: SigItem[] = [];
  if (dup > 0) {
    const repeat = shuffled[0]!;
    for (let i = 0; i < dup; i++) queue.push({ ...repeat });
  }
  for (const x of shuffled) {
    if (queue.length >= n) break;
    if (dup > 0 && canonicalSigIdFromWheelSliceId(x.id) === canonicalSigIdFromWheelSliceId(queue[0]!.id)) {
      if (queue.length < dup) continue;
    }
    queue.push({ ...x });
  }
  while (queue.length < n && queue.length < shuffled.length) {
    queue.push({ ...shuffled[queue.length]! });
  }
  return queue.slice(0, n);
}

export function buildWheelDemoOneShotFromWinners(winners: SigItem[]): {
  id: string;
  name: string;
  price: number;
} {
  return {
    id: ONE_SHOT_SIG_ID,
    name: "한방 시그",
    price: winners.reduce((sum, x) => sum + Math.max(0, Math.floor(Number(x.price || 0))), 0),
  };
}

/**
 * 휠 표시·폴백 스핀용 인벤토리.
 * 데모 20종을 먼저 두고, 서버 인벤에서 데모 id 는 제외한 뒤 이어 붙임.
 */
export function mergeWheelDemoSigInventory(
  inventory: SigItem[] | undefined | null,
  enabled: boolean
): SigItem[] {
  if (!enabled) return stripWheelDemoSigsFromInventory(inventory);
  const demoIds = new Set(WHEEL_DEMO_SIG_POOL.map((x) => x.id));
  const rest = stripWheelDemoSigsFromInventory(inventory).filter((x) => !demoIds.has(x.id));
  return [...WHEEL_DEMO_SIG_POOL.map((x) => ({ ...x })), ...rest];
}

/** GIF 404 시 더미로 대체하지 않고 빈 칸 방지용 */
export function wheelDemoSigImageFallback(url: string): string {
  const u = String(url || "").trim();
  return u || BUNDLED_SIG_PLACEHOLDER_URL;
}

/** localStorage·Redis 저장 직전 — 휠 데모 시그가 실수로 섞여도 라이브 상태에서 제거 */
export function sanitizeAppStateWheelDemo(state: AppState): AppState {
  const rs = state.rouletteState;
  const nextRs = rs
    ? {
        ...rs,
        result: rs.result && isWheelDemoSigId(rs.result.id) ? null : rs.result,
        results: stripWheelDemoSigItems(rs.results),
        selectedSigs: stripWheelDemoSigItems(rs.selectedSigs),
        sessionExcludedSigIds: (rs.sessionExcludedSigIds || []).filter((id) => !isWheelDemoSigId(id)),
      }
    : rs;
  const presets = state.sigSalesMemberPresets;
  const nextPresets =
    presets && typeof presets === "object"
      ? Object.fromEntries(
          Object.entries(presets).map(([memberId, ids]) => [
            memberId,
            Array.isArray(ids) ? ids.filter((id) => !isWheelDemoSigId(id)) : [],
          ])
        )
      : presets;
  return {
    ...state,
    sigInventory: stripWheelDemoSigsFromInventory(state.sigInventory),
    sigSalesMemberPresets: nextPresets,
    rouletteState: nextRs,
  };
}

export function getSigSalesWheelDemoOverlayQuery(): string {
  return `wheelDemo=1&menuCount=${WHEEL_DEMO_MENU_COUNT}&wheelDemoWins=${WHEEL_DEMO_WIN_COUNT}&wheelDemoAuto=1`;
}

/** 로컬 점검용 경량 데모 경로(권장) — `next/image`/picomatch 없음 */
export function getWheelDemoOverlayPath(_userId = "finalent"): string {
  return "/overlay/sig-sales/wheel-demo";
}

/** 5회전 + 당첨 카드 + 한방 + 데모 판매 확정 */
export function getWheelDemoPlaythroughPath(): string {
  return "/overlay/sig-sales/wheel-demo/playthrough";
}

export function getWheelDemoPlaythroughAutoPath(): string {
  return `${getWheelDemoPlaythroughPath()}?auto=1`;
}

/** 통합 오버레이 + wheelDemo 쿼리(관리자 OBS URL 등) */
export function getSigSalesWheelDemoOverlayPath(userId = "finalent"): string {
  return `/overlay/sig-sales?u=${encodeURIComponent(userId)}&${getSigSalesWheelDemoOverlayQuery()}`;
}

export function isWheelDemoAutoSpinFromSearchParams(
  searchParams: { get: (key: string) => string | null } | null | undefined,
  wheelDemoActive: boolean
): boolean {
  if (!wheelDemoActive) return false;
  const raw = (searchParams?.get("wheelDemoAuto") || "").trim().toLowerCase();
  if (raw === "0" || raw === "false") return false;
  return true;
}
