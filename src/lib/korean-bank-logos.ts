/** OBS 텍스트용 1금융권(시중·특수·인터넷) 은행 로고 단축코드 */

export type KoreanBankLogoPreset = {
  code: string;
  label: string;
  /** data URI 또는 `/assets/bank-logos/...` 공개 경로 */
  url: string;
};

/**
 * 1금융권 은행 공식 심볼 마크 SVG 빌더
 */
const BANK_SVG_MARK_BY_STEM: Record<
  string,
  {
    code: string;
    label: string;
    bg: string;
    body: string;
  }
> = {
  kb: {
    code: ":bank-kb:",
    label: "KB국민",
    bg: "#FFBC00",
    body: `
      <!-- KB Star-b 별 엠블럼 -->
      <path d="M32 9 L34.8 17.5 L43.8 17.5 L36.5 22.8 L39.3 31.3 L32 26 L24.7 31.3 L27.5 22.8 L20.2 17.5 L29.2 17.5 Z" fill="#58514B"/>
      <!-- 볼드 KB 워드마크 -->
      <text x="32" y="52" text-anchor="middle" font-family="'Arial Black', Impact, sans-serif" font-size="20" font-weight="900" fill="#231F20">KB</text>
    `,
  },
  shinhan: {
    code: ":bank-shinhan:",
    label: "신한",
    bg: "#0046FF",
    body: `
      <!-- 신한 원형 테두리 & 배경 -->
      <circle cx="32" cy="27" r="17" fill="#002D9C" stroke="#4B88FF" stroke-width="1.5"/>
      <!-- 신한 비둘기 날개 형상 -->
      <path d="M21 34 C21 23 29 15 39 16 C34 19 32 24 35 29 C37 32 36 36 30 38 C25 39 21 37 21 34 Z" fill="#FFFFFF"/>
      <path d="M27 34 C28 27 33 22 39 23 C36 26 36 30 33 33 Z" fill="#FFD000"/>
      <!-- 텍스트 -->
      <text x="32" y="55" text-anchor="middle" font-family="'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="12" font-weight="800" fill="#FFFFFF">신한은행</text>
    `,
  },
  woori: {
    code: ":bank-woori:",
    label: "우리",
    bg: "#0067AC",
    body: `
      <!-- 우리은행 여명 링 -->
      <circle cx="32" cy="27" r="16" fill="none" stroke="#FFFFFF" stroke-width="3"/>
      <circle cx="32" cy="27" r="10" fill="#008BE3"/>
      <!-- 새벽 여명 빛줄기 V자 -->
      <path d="M24 23 L32 35 L40 23 L32 28 Z" fill="#FFFFFF"/>
      <circle cx="32" cy="21" r="3" fill="#FFFFFF"/>
      <!-- 텍스트 -->
      <text x="32" y="55" text-anchor="middle" font-family="'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="12" font-weight="800" fill="#FFFFFF">우리은행</text>
    `,
  },
  hana: {
    code: ":bank-hana:",
    label: "하나",
    bg: "#009591",
    body: `
      <!-- 하나인 레드 원형 머리 -->
      <circle cx="32" cy="17" r="4.5" fill="#E93E30"/>
      <!-- 하나인 역동적인 양팔 & 몸체 곡선 -->
      <path d="M21 27 C24 24 28 23 32 24 C36 23 40 24 43 27 C41 29 38 28 35 28 C34 32 34 36 33 40 C32 40 31 36 30 28 C27 28 24 29 21 27 Z" fill="#FFFFFF"/>
      <path d="M25 29 C28 34 31 38 32 41 C31 36 29 32 27 29 Z" fill="#D4EBE7"/>
      <!-- 텍스트 -->
      <text x="32" y="55" text-anchor="middle" font-family="'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="12" font-weight="800" fill="#FFFFFF">하나은행</text>
    `,
  },
  nh: {
    code: ":bank-nh:",
    label: "NH농협",
    bg: "#009845",
    body: `
      <!-- 농협 V자 이삭 마크 -->
      <path d="M32 12 L38 24 L46 22 L38 29 L41 38 L32 31 L23 38 L26 29 L18 22 L26 24 Z" fill="#FFDE00"/>
      <circle cx="32" cy="25" r="4.5" fill="#009845"/>
      <!-- NH 워드마크 -->
      <text x="32" y="54" text-anchor="middle" font-family="'Arial Black', Impact, sans-serif" font-size="16" font-weight="900" fill="#FFFFFF">NH</text>
    `,
  },
  ibk: {
    code: ":bank-ibk:",
    label: "IBK기업",
    bg: "#024DA1",
    body: `
      <!-- IBK 원형 날개 모티브 -->
      <path d="M20 28 C23 20 33 16 41 20 C36 21 31 23 28 27 C26 30 23 30 20 28 Z" fill="#00A2E8"/>
      <path d="M22 34 C25 26 35 22 43 26 C38 27 33 29 30 33 C28 36 25 36 22 34 Z" fill="#FFFFFF"/>
      <!-- IBK 텍스트 -->
      <text x="32" y="53" text-anchor="middle" font-family="'Arial Black', Impact, sans-serif" font-size="16" font-weight="900" fill="#FFFFFF">IBK</text>
    `,
  },
  sc: {
    code: ":bank-sc:",
    label: "SC제일",
    bg: "#00843D",
    body: `
      <!-- 트위스트 리본 그린/블루 -->
      <path d="M24 16 C20 20 20 27 25 31 C30 35 34 37 38 43 C41 40 40 33 36 29 C31 25 28 23 24 16 Z" fill="#00A0DD"/>
      <path d="M38 17 C34 21 34 28 39 32 C44 36 43 43 38 46 C42 45 45 39 42 34 C39 30 36 26 38 17 Z" fill="#78BE20"/>
      <!-- SC 워드마크 -->
      <text x="32" y="56" text-anchor="middle" font-family="'Arial Black', Impact, sans-serif" font-size="14" font-weight="900" fill="#FFFFFF">SC제일</text>
    `,
  },
  kakao: {
    code: ":bank-kakao:",
    label: "카카오뱅크",
    bg: "#FFE812",
    body: `
      <!-- 카카오뱅크 B 심볼 마크 -->
      <g transform="translate(18, 14)">
        <rect x="0" y="0" width="14" height="20" rx="3" fill="#1E1E1E"/>
        <rect x="14" y="0" width="14" height="18" rx="7" fill="#1E1E1E"/>
        <rect x="14" y="16" width="14" height="19" rx="7" fill="#1E1E1E"/>
        <rect x="0" y="15" width="14" height="20" rx="3" fill="#1E1E1E"/>
        <circle cx="18" cy="9" r="3.5" fill="#FFE812"/>
        <circle cx="18" cy="25.5" r="4" fill="#FFE812"/>
      </g>
      <text x="32" y="57" text-anchor="middle" font-family="'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="9" font-weight="900" fill="#3A1D1D">kakaobank</text>
    `,
  },
  kbank: {
    code: ":bank-kbank:",
    label: "케이뱅크",
    bg: "#0B1437",
    body: `
      <!-- K 기둥 & 날개 -->
      <path d="M22 17 L28 17 L28 42 L22 42 Z" fill="#FFFFFF"/>
      <path d="M28 30 L38 17 L46 17 L34 31 L47 42 L39 42 L28 32 Z" fill="#FF5122"/>
      <!-- 텍스트 -->
      <text x="32" y="55" text-anchor="middle" font-family="'Arial Black', Impact, sans-serif" font-size="10" font-weight="900" fill="#FFFFFF">Kbank</text>
    `,
  },
  toss: {
    code: ":bank-toss:",
    label: "토스뱅크",
    bg: "#0064FF",
    body: `
      <!-- 토스 3D 링 고리 심볼 -->
      <path d="M23 37 C18 31 18 22 24 17 C30 12 39 13 44 19 C48 24 47 33 41 38 C35 43 27 41 23 37 Z" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>
      <path d="M28 34 C31 38 37 38 41 35 C44 32 44 26 40 22 C36 18 30 18 26 22" fill="none" stroke="#79B2FF" stroke-width="4.5" stroke-linecap="round"/>
      <!-- 텍스트 -->
      <text x="32" y="56" text-anchor="middle" font-family="'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="11" font-weight="900" fill="#FFFFFF">toss bank</text>
    `,
  },
};

export function buildOfficialBankSvgString(stem: string): string {
  const meta = BANK_SVG_MARK_BY_STEM[stem];
  if (!meta) return "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${meta.label}">` +
    `<rect width="64" height="64" rx="14" fill="${meta.bg}"/>` +
    meta.body.trim().replace(/\s+/g, " ") +
    `</svg>`
  );
}

function bankLogoDataUri(stem: string): string {
  const svg = buildOfficialBankSvgString(stem);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const BANK_LOGOS: readonly KoreanBankLogoPreset[] = Object.entries(BANK_SVG_MARK_BY_STEM).map(
  ([stem, b]) => ({
    code: b.code,
    label: b.label,
    url: bankLogoDataUri(stem),
  })
);

/** 별칭 → 정식 코드 */
const BANK_ALIASES: Record<string, string> = {
  // KB국민
  ":bank-kb:": ":bank-kb:",
  ":은행-kb:": ":bank-kb:",
  ":은행-국민:": ":bank-kb:",
  ":국민은행:": ":bank-kb:",
  ":kb:": ":bank-kb:",
  ":국민:": ":bank-kb:",
  ":kb국민:": ":bank-kb:",

  // 신한
  ":bank-shinhan:": ":bank-shinhan:",
  ":은행-신한:": ":bank-shinhan:",
  ":신한은행:": ":bank-shinhan:",
  ":신한:": ":bank-shinhan:",
  ":shinhan:": ":bank-shinhan:",

  // 우리
  ":bank-woori:": ":bank-woori:",
  ":은행-우리:": ":bank-woori:",
  ":우리은행:": ":bank-woori:",
  ":우리:": ":bank-woori:",
  ":woori:": ":bank-woori:",

  // 하나
  ":bank-hana:": ":bank-hana:",
  ":은행-하나:": ":bank-hana:",
  ":하나은행:": ":bank-hana:",
  ":하나:": ":bank-hana:",
  ":hana:": ":bank-hana:",

  // NH농협
  ":bank-nh:": ":bank-nh:",
  ":은행-농협:": ":bank-nh:",
  ":농협은행:": ":bank-nh:",
  ":농협:": ":bank-nh:",
  ":nh:": ":bank-nh:",
  ":nh농협:": ":bank-nh:",

  // IBK기업
  ":bank-ibk:": ":bank-ibk:",
  ":은행-기업:": ":bank-ibk:",
  ":기업은행:": ":bank-ibk:",
  ":기업:": ":bank-ibk:",
  ":ibk:": ":bank-ibk:",
  ":ibk기업:": ":bank-ibk:",

  // SC제일
  ":bank-sc:": ":bank-sc:",
  ":은행-제일:": ":bank-sc:",
  ":제일은행:": ":bank-sc:",
  ":제일:": ":bank-sc:",
  ":sc:": ":bank-sc:",
  ":sc제일:": ":bank-sc:",

  // 카카오뱅크
  ":bank-kakao:": ":bank-kakao:",
  ":은행-카카오:": ":bank-kakao:",
  ":카카오뱅크:": ":bank-kakao:",
  ":카카오:": ":bank-kakao:",
  ":kakao:": ":bank-kakao:",
  ":kakaobank:": ":bank-kakao:",

  // 케이뱅크
  ":bank-kbank:": ":bank-kbank:",
  ":은행-케이:": ":bank-kbank:",
  ":케이뱅크:": ":bank-kbank:",
  ":케이:": ":bank-kbank:",
  ":kbank:": ":bank-kbank:",

  // 토스뱅크
  ":bank-toss:": ":bank-toss:",
  ":은행-토스:": ":bank-toss:",
  ":토스뱅크:": ":bank-toss:",
  ":토스:": ":bank-toss:",
  ":toss:": ":bank-toss:",
  ":tossbank:": ":bank-toss:",
};

const URL_BY_CODE = new Map<string, string>();
for (const item of BANK_LOGOS) {
  URL_BY_CODE.set(item.code, item.url);
}
for (const [alias, canonical] of Object.entries(BANK_ALIASES)) {
  const url = URL_BY_CODE.get(canonical);
  if (url) URL_BY_CODE.set(alias, url);
}

const URL_BY_LEGACY_PATH = new Map<string, string>();
for (const [stem, meta] of Object.entries(BANK_SVG_MARK_BY_STEM)) {
  const url = URL_BY_CODE.get(meta.code);
  if (!url) continue;
  URL_BY_LEGACY_PATH.set(`/assets/bank-logos/${stem}.svg`, url);
  URL_BY_LEGACY_PATH.set(`assets/bank-logos/${stem}.svg`, url);
}

/** 긴 코드 우선 매칭 */
export const KOREAN_BANK_LOGO_CODES_SORTED = [...URL_BY_CODE.keys()].sort(
  (a, b) => b.length - a.length
);

export const OBS_TEXT_BANK_LOGO_PRESETS: KoreanBankLogoPreset[] = BANK_LOGOS.map((b) => ({
  ...b,
}));

export function koreanBankLogoUrlForCode(code: string): string | null {
  const key = String(code || "").trim();
  return URL_BY_CODE.get(key) ?? null;
}

/** 저장된 세그먼트의 깨진 `/assets/bank-logos/*.svg` → data URI */
export function resolveKoreanBankLogoUrl(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  if (raw.startsWith("data:image/svg+xml")) return raw;
  const pathOnly = raw.replace(/^https?:\/\/[^/]+/i, "").split("?")[0] || raw;
  return URL_BY_LEGACY_PATH.get(pathOnly) || URL_BY_LEGACY_PATH.get(pathOnly.replace(/^\//, "")) || raw;
}

export function lineContainsKoreanBankLogoCode(line: string): boolean {
  return KOREAN_BANK_LOGO_CODES_SORTED.some((code) => line.includes(code));
}
