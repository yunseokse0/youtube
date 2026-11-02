/** OBS 텍스트용 1금융권(시중·특수·인터넷) 은행 로고 단축코드 */

export type KoreanBankLogoPreset = {
  code: string;
  label: string;
  /** data URI 또는 `/assets/bank-logos/...` 공개 경로 */
  url: string;
};

function bankLogoDataUri(opts: {
  bg: string;
  fg: string;
  label: string;
  fontSize?: number;
}): string {
  const fontSize = opts.fontSize ?? (opts.label.length >= 3 ? 15 : 22);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img">` +
    `<rect width="64" height="64" rx="14" fill="${opts.bg}"/>` +
    `<text x="32" y="41" text-anchor="middle" ` +
    `font-family="Arial Black,Malgun Gothic,Apple SD Gothic Neo,sans-serif" ` +
    `font-size="${fontSize}" font-weight="800" fill="${opts.fg}">${opts.label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 파일명 stem → 로고 (레거시 `/assets/bank-logos/*.svg` 경로 복구용) */
const BANK_LOGO_BY_STEM: Record<
  string,
  { code: string; label: string; bg: string; fg: string; mark: string; fontSize?: number }
> = {
  kb: { code: ":bank-kb:", label: "KB국민", bg: "#FFCC00", fg: "#1a1a1a", mark: "KB", fontSize: 22 },
  shinhan: {
    code: ":bank-shinhan:",
    label: "신한",
    bg: "#0046FF",
    fg: "#ffffff",
    mark: "신한",
    fontSize: 16,
  },
  woori: {
    code: ":bank-woori:",
    label: "우리",
    bg: "#0067AC",
    fg: "#ffffff",
    mark: "우리",
    fontSize: 16,
  },
  hana: {
    code: ":bank-hana:",
    label: "하나",
    bg: "#009591",
    fg: "#ffffff",
    mark: "하나",
    fontSize: 16,
  },
  nh: { code: ":bank-nh:", label: "NH농협", bg: "#1FAF4C", fg: "#ffffff", mark: "NH", fontSize: 22 },
  ibk: {
    code: ":bank-ibk:",
    label: "IBK기업",
    bg: "#024DA1",
    fg: "#ffffff",
    mark: "IBK",
    fontSize: 18,
  },
  sc: { code: ":bank-sc:", label: "SC제일", bg: "#00843D", fg: "#ffffff", mark: "SC", fontSize: 22 },
  kakao: {
    code: ":bank-kakao:",
    label: "카카오뱅크",
    bg: "#FFE812",
    fg: "#3C1E1E",
    mark: "카카오",
    fontSize: 13,
  },
  kbank: {
    code: ":bank-kbank:",
    label: "케이뱅크",
    bg: "#FF5122",
    fg: "#ffffff",
    mark: "케이",
    fontSize: 16,
  },
  toss: {
    code: ":bank-toss:",
    label: "토스뱅크",
    bg: "#0064FF",
    fg: "#ffffff",
    mark: "토스",
    fontSize: 16,
  },
};

const BANK_LOGOS: readonly KoreanBankLogoPreset[] = Object.values(BANK_LOGO_BY_STEM).map((b) => ({
  code: b.code,
  label: b.label,
  url: bankLogoDataUri({ bg: b.bg, fg: b.fg, label: b.mark, fontSize: b.fontSize }),
}));

/** 별칭 → 정식 코드 */
const BANK_ALIASES: Record<string, string> = {
  ":은행-kb:": ":bank-kb:",
  ":은행-국민:": ":bank-kb:",
  ":국민은행:": ":bank-kb:",
  ":은행-신한:": ":bank-shinhan:",
  ":신한은행:": ":bank-shinhan:",
  ":은행-우리:": ":bank-woori:",
  ":우리은행:": ":bank-woori:",
  ":은행-하나:": ":bank-hana:",
  ":하나은행:": ":bank-hana:",
  ":은행-농협:": ":bank-nh:",
  ":농협은행:": ":bank-nh:",
  ":은행-기업:": ":bank-ibk:",
  ":기업은행:": ":bank-ibk:",
  ":은행-제일:": ":bank-sc:",
  ":제일은행:": ":bank-sc:",
  ":은행-카카오:": ":bank-kakao:",
  ":카카오뱅크:": ":bank-kakao:",
  ":은행-케이:": ":bank-kbank:",
  ":케이뱅크:": ":bank-kbank:",
  ":은행-토스:": ":bank-toss:",
  ":토스뱅크:": ":bank-toss:",
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
for (const [stem, meta] of Object.entries(BANK_LOGO_BY_STEM)) {
  const url = URL_BY_CODE.get(meta.code);
  if (!url) continue;
  URL_BY_LEGACY_PATH.set(`/assets/bank-logos/${stem}.svg`, url);
  URL_BY_LEGACY_PATH.set(`assets/bank-logos/${stem}.svg`, url);
}

/** 긴 코드 우선 */
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
