export const DONATION_INTAKE_ENV_KEY = "TOONA_INTAKE_MODE";
export const DONATION_INTAKE_ENV_KEY_ALT = "DONATION_INTAKE_MODE";

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
 * .env 설정법:
 *   TOONA_INTAKE_MODE=A    (A모드 · 투네 직접)
 *   TOONA_INTAKE_MODE=B    (B모드 · DIN 허브 투나 프로젝트)
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

function readRawMode(): string {
  const v = String(
    process.env[DONATION_INTAKE_ENV_KEY] ||
      process.env[DONATION_INTAKE_ENV_KEY_ALT] ||
      ""
  )
    .trim()
    .toLowerCase();
  return v;
}

export function getDonationIntakeMode(): DonationIntakeMode {
  const raw = readRawMode();
  if (!raw) return DONATION_INTAKE_MODE_B;
  if (MODE_A_ALIASES.has(raw)) return DONATION_INTAKE_MODE_A;
  if (MODE_B_ALIASES.has(raw)) return DONATION_INTAKE_MODE_B;
  return DONATION_INTAKE_MODE_B;
}

export function isDonationIntakeModeA(): boolean {
  return getDonationIntakeMode() === DONATION_INTAKE_MODE_A;
}

export function isDonationIntakeModeB(): boolean {
  return getDonationIntakeMode() === DONATION_INTAKE_MODE_B;
}

export function describeDonationIntakeMode(): string {
  const mode = getDonationIntakeMode();
  if (mode === "A") {
    return `A모드 (투네 직접 연결 · Toonation WS Direct)`;
  }
  return `B모드 (DIN 허브 연결 · 투나 프로젝트 후원만)`;
}
