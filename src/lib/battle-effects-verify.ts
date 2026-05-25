import { getBattleEffectsScenarioPath } from "@/lib/battle-effects-demo";
import { BATTLE_EFFECTS_DEMO_SCENARIOS } from "@/lib/battle-effects-demo";
import { getMealGaugeOverlayPath } from "@/lib/meal-gauge-demo-paths";
import { OVERLAY_UI_REVISION } from "@/lib/overlay-ui-revision";

export { OVERLAY_UI_REVISION };

export type VerifyCheckItem = {
  id: string;
  label: string;
  hint?: string;
};

export type BattleEffectsVerifyCase = {
  id: string;
  battle: "meal" | "sig";
  title: string;
  description: string;
  /** 식사 대전 등 SSR 가능한 경로 */
  overlayPath?: string;
  /** 시그 대전 — 브라우저에서 snap 인코딩 (모듈 로드 시 btoa 고착 방지) */
  sigScenarioId?: string;
  checks: VerifyCheckItem[];
};

function withHubPreview(base: string): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}hubPreview=1&scalePct=90`;
}

const mealRecommended = BATTLE_EFFECTS_DEMO_SCENARIOS.find((s) => s.id === "meal-all-default");
export const BATTLE_EFFECTS_VERIFY_CASES: BattleEffectsVerifyCase[] = [
  {
    id: "meal-split-gauge",
    battle: "meal",
    title: "식사 대전 · 멤버 분할 게이지",
    description: "3인 분할 · 점수 막대 안 · 이름 막대 아래",
    overlayPath: mealRecommended
      ? getBattleEffectsScenarioPath(mealRecommended)
      : withHubPreview(
          getMealGaugeOverlayPath({
            demo: true,
            fx: "all",
            gaugePreview: true,
            demoTimerSec: 15,
          })
        ),
    checks: [
      {
        id: "meal-title",
        label: "상단에 「식사 대전」 타이틀이 보인다",
      },
      {
        id: "meal-score-in-bar",
        label: "「62 / 100」 형태 점수가 분홍 게이지 막대 안(가운데)에 있다",
        hint: "막대 밖·이름 위에만 떠 있으면 실패",
      },
      {
        id: "meal-names-below",
        label: "멤버1·멤버2·멤버3 이름 pill이 게이지 막대 밖·아래(별도 줄)에 있다",
        hint: "이름이 막대 안·점수와 겹치면 실패",
      },
      {
        id: "meal-rev",
        label: `DEMO · ${OVERLAY_UI_REVISION.meal} · 막대 안 점수 / 아래 이름 분리`,
        hint: "이름이 막대 안에 겹치면 구 번들",
      },
    ],
  },
  {
    id: "sig-dual-vertical",
    battle: "sig",
    title: "시그 대전 · 2팀 2:2",
    description: "타이틀 · A/B팀 박스 · VS 막대(팀 합산)",
    sigScenarioId: "dual-pools-live",
    checks: [
      {
        id: "sig-title",
        label: "상단에 「시그 대전」 타이틀이 보인다",
        hint: "타이머만 있고 타이틀이 없으면 실패",
      },
      {
        id: "sig-vertical",
        label: "좌(A팀)·우(B팀) 각각 한 박스 안에 멤버가 세로로 나열된다",
        hint: "멤버마다 따로 박스 2개씩이면 실패",
      },
      {
        id: "sig-amount-full",
        label: "각 멤버 행에 이름 + 「125,000원」 등 후원 금액이 함께 보인다",
        hint: "「72 시그」처럼 개수로 나오면 실패 · 이름 뒤 배경 막대는 없어야 함",
      },
      {
        id: "sig-team-gauge",
        label: "핑크·블루 VS 막대 안에 A팀/B팀 합산 금액(예: 223,012원)이 흰 글씨로 보인다",
        hint: "막대가 색만 있고 글자가 없으면 실패",
      },
      {
        id: "sig-no-frame",
        label: "오버레이 바깥에 주황/노란 테두리 프레임이 없다 (OBS 투명용)",
      },
      {
        id: "sig-vs-center",
        label: "VS 글자가 핑크·블루 막대 정중앙에 크게 보이고(골드색), 원형 배지·배경 박스가 없다",
        hint: "VS가 막대 위·아래에 떠 있거나 LIVE/집계 pill이 보이면 구 UI",
      },
      {
        id: "sig-rev",
        label: `UI ${OVERLAY_UI_REVISION.sig} · 팀 박스 + VS 막대(팀 합산 금액) · LIVE·집계 pill 없음`,
        hint: "로컬 dev만 DEMO 뱃지 가능 · 「멤버1·멤버2」 한 줄 pill이면 dev:clean",
      },
    ],
  },
];

export function getBattleEffectsVerifyPath(): string {
  return "/overlay/battle-effects-demo/verify";
}

export function getBattleEffectsVerifyHubUrl(origin = "http://localhost:3000"): string {
  return `${origin}${getBattleEffectsVerifyPath()}`;
}
