import { appendSigMatchOverlayCacheParams } from "@/lib/overlay-ui-revision";
import type { AppState } from "@/lib/state";
import { snapshotToSigMatchState } from "@/lib/sig-match-snapshot";

/** 데모 snap 고정 시각 — SSR·클라이언트 URL 인코딩 일치 */
const SIG_MATCH_DEMO_SNAPSHOT_TIME = 1_700_000_000_000;

/** 로컬 시그 대전 오버레이 미리보기 — 서버 Redis 없이 snap URL 로 표시 */

export type SigMatchDemoLayout = "dual-pools" | "triple-pools" | "dual-ranking";

export type SigMatchDemoScenario = {
  id: string;
  label: string;
  description: string;
  layout: SigMatchDemoLayout;
  /** 3초마다 시그 점수 변동 → VS 막대·목표바·왕관 연출 */
  sigPreview?: boolean;
  scoringMode?: "count" | "amount";
  previewGuide?: boolean;
  demoTimerSec?: number;
};

export const SIG_MATCH_DEMO_SCENARIOS: SigMatchDemoScenario[] = [
  {
    id: "dual-pools-live",
    label: "2팀 대결 · 자동 연출",
    description: "2:2 · 멤버별 후원 금액(원) · 플로팅 +N · 막대 스프링",
    layout: "dual-pools",
    sigPreview: true,
    scoringMode: "amount",
  },
  {
    id: "dual-pools",
    label: "2팀 대결 (정적)",
    description: "시그 대전 풀 2개 · 좌·우 막대",
    layout: "dual-pools",
  },
  {
    id: "triple-pools-live",
    label: "3팀 대결 · 자동 연출",
    description: "1:1:1 · 삼자 막대 · 리드 왕관·스윕",
    layout: "triple-pools",
    sigPreview: true,
  },
  {
    id: "triple-pools",
    label: "3팀 대결 (정적)",
    description: "시그 대전 풀 3개 · 삼자 막대",
    layout: "triple-pools",
  },
  {
    id: "dual-ranking-live",
    label: "개인 1:1 · 자동 연출",
    description: "풀 없음 · 상위 2명 VS · 점수 변동",
    layout: "dual-ranking",
    sigPreview: true,
  },
  {
    id: "dual-ranking",
    label: "개인 1:1 (정적)",
    description: "랭킹 상위 2명 자동 매칭",
    layout: "dual-ranking",
  },
  {
    id: "amount-mode",
    label: "금액 집계 모드",
    description: "scoringMode=amount · 원 단위 라벨",
    layout: "dual-pools",
    scoringMode: "amount",
    sigPreview: true,
  },
  {
    id: "ui-guide",
    label: "UI 가이드 배경",
    description: "데스크톱에서 프레임·타이머 영역 확인용 배경",
    layout: "dual-pools",
    previewGuide: true,
    sigPreview: true,
  },
];

function demoMember(id: string, name: string) {
  return {
    id,
    name,
    account: 0,
    toon: 0,
    contribution: 0,
    goal: 0,
    operating: false,
  };
}

export function buildSigMatchDemoSnapshot(
  layout: SigMatchDemoLayout,
  opts?: { scoringMode?: "count" | "amount"; demoTimerSec?: number }
): Record<string, unknown> {
  const members = [
    demoMember("sigdemo-1", "멤버1"),
    demoMember("sigdemo-2", "멤버2"),
    demoMember("sigdemo-3", "멤버3"),
    demoMember("sigdemo-4", "멤버4"),
  ];
  const memberIds = members.map((m) => m.id);

  const useAmount = opts?.scoringMode !== "count";
  const sigMatch: Record<string, number> = useAmount
    ? {
        "sigdemo-1": 125_000,
        "sigdemo-2": 98_000,
        "sigdemo-3": 112_000,
        "sigdemo-4": 76_000,
      }
    : {
        "sigdemo-1": 72,
        "sigdemo-2": 58,
        "sigdemo-3": 65,
        "sigdemo-4": 41,
      };

  let sigMatchPools: { id: string; memberIds: string[] }[] = [];
  if (layout === "dual-pools") {
    sigMatchPools = [
      { id: "pool-a", memberIds: ["sigdemo-1", "sigdemo-2"] },
      { id: "pool-b", memberIds: ["sigdemo-3", "sigdemo-4"] },
    ];
  } else if (layout === "triple-pools") {
    sigMatchPools = [
      { id: "pool-1", memberIds: ["sigdemo-1"] },
      { id: "pool-2", memberIds: ["sigdemo-2"] },
      { id: "pool-3", memberIds: ["sigdemo-3"] },
    ];
    sigMatch["sigdemo-4"] = useAmount ? 54_000 : 28;
  }

  const participantMemberIds =
    layout === "triple-pools" ? ["sigdemo-1", "sigdemo-2", "sigdemo-3"] : memberIds;

  return {
    members,
    donors: [],
    sigMatch,
    donationSyncMode: "sigMatch",
    sigMatchSettings: {
      isActive: true,
      targetCount: 100,
      title: "시그 대전",
      keyword: "시그",
      signatureAmounts: [77, 100, 333],
      scoringMode: opts?.scoringMode === "count" ? "count" : "amount",
      incentivePerPoint: 1000,
      sigMatchPools,
      participantMemberIds,
      overlayTimerDurationSec: 180,
      overlayTimerEndAt: null,
    },
    generalTimer: {
      remainingTime:
        opts?.demoTimerSec != null && Number.isFinite(opts.demoTimerSec)
          ? Math.max(3, Math.min(600, Math.floor(opts.demoTimerSec)))
          : 95,
      isActive: true,
      lastUpdated: SIG_MATCH_DEMO_SNAPSHOT_TIME,
    },
    matchTimerEnabled: { general: true },
    timerDisplayStyles: {
      general: {
        outlineColor: "rgba(6, 12, 24, 0.95)",
        outlineWidth: 0.8,
      },
    },
    updatedAt: SIG_MATCH_DEMO_SNAPSHOT_TIME,
  };
}

export function encodeSigMatchDemoSnapParam(snapshot: Record<string, unknown>): string {
  const json = JSON.stringify(snapshot);
  const bytes = encodeURIComponent(json);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes, "utf8").toString("base64");
  }
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(bytes);
  }
  throw new Error("encodeSigMatchDemoSnapParam: no base64 encoder");
}

/** 데모 허브 인라인 미리보기 — snap URL 없이 AppState 주입 */
export function buildSigMatchDemoAppState(scenario: SigMatchDemoScenario): AppState {
  const raw = buildSigMatchDemoSnapshot(scenario.layout, {
    scoringMode: scenario.scoringMode,
    demoTimerSec: scenario.demoTimerSec,
  });
  const state = snapshotToSigMatchState(raw);
  if (!state) {
    throw new Error(`buildSigMatchDemoAppState: invalid snapshot for scenario ${scenario.id}`);
  }
  return state;
}

export function buildSigMatchDemoOverlayPath(
  layout: SigMatchDemoLayout,
  opts?: {
    scalePct?: number;
    previewGuide?: boolean;
    sigPreview?: boolean;
    scoringMode?: "count" | "amount";
    demoTimerSec?: number;
  }
): string {
  const snap = encodeSigMatchDemoSnapParam(
    buildSigMatchDemoSnapshot(layout, {
      scoringMode: opts?.scoringMode,
      demoTimerSec: opts?.demoTimerSec,
    })
  );
  const q = new URLSearchParams();
  q.set("snap", snap);
  if (opts?.scalePct != null) q.set("scalePct", String(opts.scalePct));
  if (opts?.previewGuide) q.set("previewGuide", "true");
  if (opts?.sigPreview) q.set("sigPreview", "1");
  return appendSigMatchOverlayCacheParams(`/overlay/sig-match?${q.toString()}`);
}

export function buildSigMatchDemoOverlayPathFromScenario(scenario: SigMatchDemoScenario): string {
  return buildSigMatchDemoOverlayPath(scenario.layout, {
    previewGuide: scenario.previewGuide,
    sigPreview: scenario.sigPreview,
    scoringMode: scenario.scoringMode,
    demoTimerSec: scenario.demoTimerSec,
  });
}

export function getSigMatchDemoHubPath(): string {
  return "/overlay/sig-match/demo";
}
