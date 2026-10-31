export const DONATION_INTAKE_ENV_KEY = "TOONA_INTAKE_MODE";
export const DONATION_INTAKE_ENV_KEY_ALT = "DONATION_INTAKE_MODE";
export const DONATION_INTAKE_RUNTIME_KV_PREFIX = "din:runtime:intake-mode";

/**
 * KV (Upstash/MySQL) 다운·미설치시 프로세스 생존 동안 모드를 기억하는 인메모리 Fallback.
 * Safety Net: 프로덕션 배포 직후나 KV 장애시에도 모드 전환이 즉시 동작하도록.
 */
type InMemoryModeRecord = { mode: DonationIntakeMode; updatedAt: number };
const inMemoryRuntimeMode = new Map<string, InMemoryModeRecord>();

export type DonationIntakeMode = "A" | "B" | "BOTH";

export const DONATION_INTAKE_MODE_A: DonationIntakeMode = "A";
export const DONATION_INTAKE_MODE_B: DonationIntakeMode = "B";
export const DONATION_INTAKE_MODE_BOTH: DonationIntakeMode = "BOTH";

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
function normalizeRawMode(raw: string | undefined | null): DonationIntakeMode {
  const m = String(raw || "").trim().toUpperCase();
  if (m === "A") return DONATION_INTAKE_MODE_A;
  if (m === "B") return DONATION_INTAKE_MODE_B;
  if (m === "BOTH" || m === "ALL") return DONATION_INTAKE_MODE_BOTH;
  if (m === "DIN_ONLY" || m === "DIN-HUB-ONLY" || m === "B-MODE") return DONATION_INTAKE_MODE_B;
  if (m === "TOONATION_ONLY" || m === "A-MODE" || m === "DIRECT") return DONATION_INTAKE_MODE_A;
  return DONATION_INTAKE_MODE_B;
}

/** env에서 모드 읽기 (KV 다운 시 fallback) */
export function getDonationIntakeEnvFallbackMode(): DonationIntakeMode {
  return normalizeRawMode(
    process.env[DONATION_INTAKE_ENV_KEY] ?? process.env[DONATION_INTAKE_ENV_KEY_ALT]
  );
}

/** 하위 호환용 */
export function getDonationIntakeMode(): DonationIntakeMode {
  return getDonationIntakeEnvFallbackMode();
}

/** 런타임 모드: KV → 인메모리 → env 순서로 읽음. userId가 없으면 env만 참조. */
export async function getRuntimeDonationIntakeMode(
  _userId: string | null | undefined
): Promise<DonationIntakeMode> {
  try {
    const { upstashGetJson } = await import("@/app/api/_shared/upstash");
    const key = `${DONATION_INTAKE_RUNTIME_KV_PREFIX}:${String(_userId ?? "global")}`;
    const kv = await upstashGetJson<{ mode: DonationIntakeMode; updatedAt: number }>(key);
    if (kv?.mode) {
      const normalized = normalizeRawMode(kv.mode);
      if (normalized) return normalized;
    }
  } catch {
    // KV 다운 → 아래 fallback
  }

  if (_userId) {
    const memo = inMemoryRuntimeMode.get(String(_userId));
    if (memo) return memo.mode;
  }

  return getDonationIntakeEnvFallbackMode();
}

/** user별 Runtime 모드 KV에 저장. 저장 성공 여부 boolean 리턴. */
export async function setRuntimeDonationIntakeMode(
  userId: string | null | undefined,
  mode: DonationIntakeMode
): Promise<boolean> {
  if (!userId || !String(userId).trim()) return false;
  const normalizedMode = normalizeRawMode(mode as string) ?? DONATION_INTAKE_MODE_B;
  const memoKey = `${String(userId).trim()}`;
  const nowTs = Date.now();

  inMemoryRuntimeMode.set(memoKey, { mode: normalizedMode, updatedAt: nowTs });

  const key = `${DONATION_INTAKE_RUNTIME_KV_PREFIX}:${memoKey}`;
  const payload = {
    mode: normalizedMode,
    updatedAt: nowTs,
  };
  try {
    const { upstashSetJsonWithSetPath } = await import("@/app/api/_shared/upstash");
    const saved = await upstashSetJsonWithSetPath(key, payload);
    return saved !== false;
  } catch {
    return false;
  }
}

export function isDonationIntakeModeA(): boolean {
  const m = getDonationIntakeMode();
  return m === DONATION_INTAKE_MODE_A || m === DONATION_INTAKE_MODE_BOTH;
}

export function isDonationIntakeModeB(): boolean {
  const m = getDonationIntakeMode();
  return m === DONATION_INTAKE_MODE_B || m === DONATION_INTAKE_MODE_BOTH;
}

export async function isRuntimeDonationIntakeModeA(
  userId: string | null | undefined
): Promise<boolean> {
  const m = await getRuntimeDonationIntakeMode(userId);
  return m === DONATION_INTAKE_MODE_A || m === DONATION_INTAKE_MODE_BOTH;
}

export async function isRuntimeDonationIntakeModeB(
  userId: string | null | undefined
): Promise<boolean> {
  const m = await getRuntimeDonationIntakeMode(userId);
  return m === DONATION_INTAKE_MODE_B || m === DONATION_INTAKE_MODE_BOTH;
}

export function describeDonationIntakeMode(): string {
  const mode = getDonationIntakeMode();
  if (mode === "A") return "A모드 (투네이션 자동 · Toonation WS Direct)";
  if (mode === "BOTH") return "A+B 모드 (양 경로 병행 · 중복 차단)";
  return "B모드 (DIN 허브 모드 · Toona Project Hub)";
}

export function describeDonationIntakeModeShort(mode: DonationIntakeMode): string {
  if (mode === "A") return "A · 투네이션 자동";
  if (mode === "BOTH") return "A+B 병행";
  return "B · DIN 허브 모드";
}

export function describeRuntimeDonationIntakeModeByMode(
  mode: DonationIntakeMode
): string {
  if (mode === "A")
    return "A모드 (투네이션 직접 WebSocket 자동 연결 · 투네이션 링크만 넣으면 OK)";
  if (mode === "BOTH")
    return "A+B 모드 (투네 WS + DIN 허브 양 경로 병행 · dedupHash 중복 차단)";
  return "B모드 (DIN 허브 모드 · DIN 허브 로그인 후 30초/60초 자동 폴링)";
}
