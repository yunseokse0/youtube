/** OBS 텍스트용 1금융권(시중·특수·인터넷) 은행 로고 단축코드 */

export type KoreanBankLogoPreset = {
  code: string;
  label: string;
  /** `/assets/bank-logos/...` 공개 경로 */
  url: string;
};

const BANK_LOGOS: readonly KoreanBankLogoPreset[] = [
  { code: ":bank-kb:", label: "KB국민", url: "/assets/bank-logos/kb.svg" },
  { code: ":bank-shinhan:", label: "신한", url: "/assets/bank-logos/shinhan.svg" },
  { code: ":bank-woori:", label: "우리", url: "/assets/bank-logos/woori.svg" },
  { code: ":bank-hana:", label: "하나", url: "/assets/bank-logos/hana.svg" },
  { code: ":bank-nh:", label: "NH농협", url: "/assets/bank-logos/nh.svg" },
  { code: ":bank-ibk:", label: "IBK기업", url: "/assets/bank-logos/ibk.svg" },
  { code: ":bank-sc:", label: "SC제일", url: "/assets/bank-logos/sc.svg" },
  { code: ":bank-kakao:", label: "카카오뱅크", url: "/assets/bank-logos/kakao.svg" },
  { code: ":bank-kbank:", label: "케이뱅크", url: "/assets/bank-logos/kbank.svg" },
  { code: ":bank-toss:", label: "토스뱅크", url: "/assets/bank-logos/toss.svg" },
] as const;

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

export function lineContainsKoreanBankLogoCode(line: string): boolean {
  return KOREAN_BANK_LOGO_CODES_SORTED.some((code) => line.includes(code));
}
