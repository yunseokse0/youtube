/** 수동(일반) 타이머 오버레이 글꼴 — 귀여운 손글씨부터 고정폭·디스플레이까지 */

export type TimerFontFamilyId =
  | "mono"
  | "jua"
  | "dongle"
  | "gaegu"
  | "hi-melody"
  | "poor-story"
  | "single-day"
  | "fredoka"
  | "nunito"
  | "do-hyeon"
  | "black-han"
  | "orbit"
  | "song-myung"
  | "press-start"
  | "pretendard"
  | "gothic"
  | "serif";

export const TIMER_FONT_FAMILY_OPTIONS: {
  id: TimerFontFamilyId;
  label: string;
  group: "cute" | "display" | "clean" | "retro";
}[] = [
  { id: "jua", label: "주아 · 동글귀여움", group: "cute" },
  { id: "dongle", label: "동글 · 통통이", group: "cute" },
  { id: "gaegu", label: "개구 · 손글씨", group: "cute" },
  { id: "hi-melody", label: "하이멜로디 · 말랑", group: "cute" },
  { id: "poor-story", label: "푸어스토리 · 동화", group: "cute" },
  { id: "single-day", label: "싱글데이 · 장난감", group: "cute" },
  { id: "fredoka", label: "Fredoka · 둥근영문", group: "cute" },
  { id: "nunito", label: "Nunito · 소프트", group: "cute" },
  { id: "do-hyeon", label: "도현 · 굵은캐주얼", group: "display" },
  { id: "black-han", label: "블랙한산스 · 임팩트", group: "display" },
  { id: "orbit", label: "오빗 · 테크", group: "display" },
  { id: "song-myung", label: "송명 · 우아한명조", group: "display" },
  { id: "mono", label: "고정폭 · 클래식 타이머", group: "clean" },
  { id: "pretendard", label: "Pretendard · 깔끔", group: "clean" },
  { id: "gothic", label: "맑은 고딕 계열", group: "clean" },
  { id: "serif", label: "세리프 · 클래식", group: "clean" },
  { id: "press-start", label: "픽셀 · 레트로", group: "retro" },
];

const TIMER_FONT_FAMILY_CSS: Record<TimerFontFamilyId, string> = {
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace',
  jua: '"Jua", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  dongle: '"Dongle", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  gaegu: '"Gaegu", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  "hi-melody": '"Hi Melody", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  "poor-story": '"Poor Story", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  "single-day": '"Single Day", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  fredoka: '"Fredoka", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  nunito: '"Nunito", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  "do-hyeon": '"Do Hyeon", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  "black-han": '"Black Han Sans", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  orbit: '"Orbit", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  "song-myung": '"Song Myung", "Noto Serif KR", Georgia, serif',
  "press-start": '"Press Start 2P", ui-monospace, monospace',
  pretendard: '"Pretendard Variable", Pretendard, "Noto Sans KR", system-ui, sans-serif',
  gothic: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  serif: 'Georgia, "Times New Roman", "Noto Serif KR", serif',
};

const TIMER_FONT_IDS = new Set<string>(TIMER_FONT_FAMILY_OPTIONS.map((o) => o.id));

/** Google Fonts — 오버레이·관리자 미리보기용 (한 번만 로드) */
export const TIMER_GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Do+Hyeon&family=Dongle:wght@400;700&family=Fredoka:wght@500;600;700&family=Gaegu:wght@400;700&family=Hi+Melody&family=Jua&family=Nunito:wght@700;800&family=Orbit&family=Poor+Story&family=Press+Start+2P&family=Single+Day&family=Song+Myung&display=swap";

export function normalizeTimerFontFamily(raw: unknown): TimerFontFamilyId {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (v === "black-han-sans" || v === "blackhansans") return "black-han";
  if (v === "dohyeon" || v === "do_hyeon") return "do-hyeon";
  if (v === "himelody" || v === "hi_melody") return "hi-melody";
  if (v === "poorstory" || v === "poor_story") return "poor-story";
  if (v === "singleday" || v === "single_day") return "single-day";
  if (v === "pressstart" || v === "press-start-2p" || v === "pixel") return "press-start";
  if (v === "default" || v === "auto" || v === "") return "mono";
  if (TIMER_FONT_IDS.has(v)) return v as TimerFontFamilyId;
  return "mono";
}

export function resolveTimerFontFamilyCss(raw: unknown): string {
  return TIMER_FONT_FAMILY_CSS[normalizeTimerFontFamily(raw)];
}

export function isDefaultTimerFontFamily(raw: unknown): boolean {
  return normalizeTimerFontFamily(raw) === "mono";
}

/** document head에 Google Fonts link 주입 (중복 방지) */
export function ensureTimerGoogleFontsLoaded(): void {
  if (typeof document === "undefined") return;
  const id = "timer-google-fonts";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = TIMER_GOOGLE_FONTS_HREF;
  document.head.appendChild(link);
}
