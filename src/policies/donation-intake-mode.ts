export const DONATION_INTAKE_ENV_KEY = "TOONA_INTAKE_MODE";
export const DONATION_INTAKE_ENV_KEY_ALT = "DONATION_INTAKE_MODE";
export const DONATION_INTAKE_RUNTIME_KV_PREFIX = "din:runtime:intake-mode";

/**
 * KV (Upstash/MySQL) 다운·미설치시 프로세스 생존 동안 모드를 기억하는 인메모리 Fallback.
 * Safety Net: 프로덕션 배포 직후나 KV 장애시에도 모드 전환이 즉시 동작하도록.
 */
type InMemoryModeRecord = { mode: DonationIntakeMode; updatedAt: number };
const inMemoryRuntimeMode = new Map<string, InMemoryModeRecord>();

export type DonationIntakeMode = "A" | "B";

export const DONATION_INTAKE_MODE_A: DonationIntakeMode = "A";
export const DONATION_INTAKE_MODE_B: DonationIntakeMode = "B";

/**
 * ✅ 사용자 정의 모드 정리 (2026-09-06 VERBATIM)
 *
 *  A 모드 (= 투네 직접 연결 모드, Toonation Direct):
 *    - 후원 출처: Toonation (투네) 브라우저 WS 릴레이 / OBS 직접 WS
 *    - 처리 경로: /api/donations/toonation/ingest
 *    - DIN 허브 폴러 / DONATIONS_INGEST 는 사용 안함
 *
 *  B 모드 (= DIN 허브 연결 모드, DIN Hub · Toona Project):
 *    - 후원 출처: DIN 허브에 등록된 투나(Toona) 프로젝트 후원만 가져옴
 *    - 처리 경로: /api/donations/ingest (TOONA_INGEST_SECRET Bearer 인증)
 *             + instrumentation b-mode poller 가 hub 자동 폴&드레인
 *    - Toonation 직접 WS 리스너는 시작하지 않음
 *
 * .env 설정법 (최초 기본값 / 사용자가 런타임 설정 안했을때 fallback):
 *   TOONA_INTAKE_MODE=A    (A모드 · 투네 직접)
 *   TOONA_INTAKE_MODE=B    (B모드 · DIN 허브 투나 프로젝트)
 *
 * ★ 2026-09-16 런타임 오버라이드 (관리자 헤더 버튼으로 A/B 토글):
 *   관리자 헤더 모드 배지 클릭 → 팝업에서 A 또는 B 클릭 → KV에 user별 저장
 *   → getRuntimeDonationIntakeMode(userId) 가 항상 KV → env 순서로 읽음
 *   → 모든 경로(instrumentation·ingest route·poller)는 이 함수를 최우선 참조
 *
 * 과거 호환 별칭 (하위 호환 유지):
 *   din_only / din-hub-only / b-mode  →  B 모드로 해석
 *   toonation_only / a-mode / direct  →  A 모드로 해석
 */
const MODE_A_ALIASES = new Set([
  "a",
  "a-mode",
  "toonation",
  "toonation_only",
  "direct",
  "ws",
  "browser-relay",
]);

const MODE_B_ALIASES = new Set([
  "b",
  "b-mode",
  "din_only",
  "din-hub-only",
  "din",
  "din-hub",
  "toona",
  "toona-project",
  "hub",
]);

function normalizeRawMode(raw: string | null | undefined): DonationIntakeMode | null {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return null;
  if (MODE_A_ALIASES.has(v)) return DONATION_INTAKE_MODE_A;
  if (MODE_B_ALIASES.has(v)) return DONATION_INTAKE_MODE_B;
  return null;
}

function readRawEnvMode(): string {
  const v = String(
    process.env[DONATION_INTAKE_ENV_KEY] ||
      process.env[DONATION_INTAKE_ENV_KEY_ALT] ||
      ""
  )
    .trim()
    .toLowerCase();
  return v;
}

/** 기본 Env 모드만 읽음 (런타임 오버라이드 없는 경우) */
export function getDonationIntakeEnvFallbackMode(): DonationIntakeMode {
  const fromEnv = normalizeRawMode(readRawEnvMode());
  return fromEnv ?? DONATION_INTAKE_MODE_B;
}

/** 하위 호환용 (사용처 전부 그대로 동작하지만, userId 넘길 수 있을때는 Runtime 함수 쓰세요) */
export function getDonationIntakeMode(): DonationIntakeMode {
  return getDonationIntakeEnvFallbackMode();
}

/** ✅ Runtime 우선순위 1순위 함수 (모든 새로운 경로는 이것을 사용!)
 *  순서: ① KV user 저장값 → ② .env → ③ B 모드 기본
 */
export async function getRuntimeDonationIntakeMode(
  userId: string | null | undefined
): Promise<DonationIntakeMode> {
  if (userId && String(userId).trim()) {
    const key = `${DONATION_INTAKE_RUNTIME_KV_PREFIX}:${String(userId).trim()}`;
    /** ① 인메모리 Fallback 우선 참조 (KV 다운 상태에서 이전에 set한 값 기억) */
    const memoKey = `${String(userId).trim()}`;
    const inMem = inMemoryRuntimeMode.get(memoKey);
    try {
      const { upstashGetJson } = await import("@/app/api/_shared/upstash");
      const raw = (await upstashGetJson(key)) as unknown;
      if (raw && typeof raw === "object" && "mode" in raw) {
        const runtimeMode = normalizeRawMode(String((raw as { mode?: unknown }).mode || ""));
        if (runtimeMode) {
          inMemoryRuntimeMode.set(memoKey, {
            mode: runtimeMode,
            updatedAt: Number((raw as { updatedAt?: unknown }).updatedAt) || Date.now(),
          });
          return runtimeMode;
        }
      }
    } catch {
      /* KV 오류나면 인메모리 Fallback → env fallback 순으로 넘어가기 */
      if (inMem) return inMem.mode;
    }
    if (inMem) return inMem.mode;
  }
  return getDonationIntakeEnvFallbackMode();
}

/** user별 Runtime 모드 KV에 저장. 저장 성공 여부 boolean 리턴.
 *  Safety Net: 영구 저장소(KV) 실패해도 인메모리에는 반드시 저장 → 최소한 현 프로세스에서 적용은 보장
 */
export async function setRuntimeDonationIntakeMode(
  userId: string | null | undefined,
  mode: DonationIntakeMode
): Promise<boolean> {
  if (!userId || !String(userId).trim()) return false;
  const normalizedMode = normalizeRawMode(mode) ?? DONATION_INTAKE_MODE_B;
  const memoKey = `${String(userId).trim()}`;
  const nowTs = Date.now();
  /** 인메모리에 먼저 저장 (영구 저장 실패해도 현 프로세스에서는 적용 보장) */
  inMemoryRuntimeMode.set(memoKey, { mode: normalizedMode, updatedAt: nowTs });

  const key = `${DONATION_INTAKE_RUNTIME_KV_PREFIX}:${memoKey}`;
  const payload = {
    mode: normalizedMode,
    updatedAt: nowTs,
  };
  try {
    const { upstashSetJsonWithSetPath } = await import("@/app/api/_shared/upstash");
    const saved = await upstashSetJsonWithSetPath(key, payload);
    return saved;
  } catch {
    return false;
  }
}

export function isDonationIntakeModeA(): boolean {
  return getDonationIntakeMode() === DONATION_INTAKE_MODE_A;
}

export function isDonationIntakeModeB(): boolean {
  return getDonationIntakeMode() === DONATION_INTAKE_MODE_B;
}

export async function isRuntimeDonationIntakeModeA(
  userId: string | null | undefined
): Promise<boolean> {
  return (await getRuntimeDonationIntakeMode(userId)) === DONATION_INTAKE_MODE_A;
}

export async function isRuntimeDonationIntakeModeB(
  userId: string | null | undefined
): Promise<boolean> {
  return (await getRuntimeDonationIntakeMode(userId)) === DONATION_INTAKE_MODE_B;
}

export function describeDonationIntakeMode(): string {
  const mode = getDonationIntakeMode();
  if (mode === "A") {
    return `A모드 (투네이션 자동 · Toonation WS Direct)`;
  }
  return `B모드 (DIN 허브 모드 · Toona Project Hub)`;
}

export function describeDonationIntakeModeShort(mode: DonationIntakeMode): string {
  return mode === "A" ? "A · 투네이션 자동" : "B · DIN 허브 모드";
}

export function describeRuntimeDonationIntakeModeByMode(
  mode: DonationIntakeMode
): string {
  if (mode === "A") {
    return `A모드 (투네이션 직접 WebSocket 자동 연결 · 투네이션 링크만 넣으면 OK)`;
  }
  return `B모드 (DIN 허브 모드 · DIN 허브 로그인 후 30초/60초 자동 폴링)`;
}
