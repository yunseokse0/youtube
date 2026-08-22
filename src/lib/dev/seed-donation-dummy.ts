import { syncMemberTotalsFromDonors } from "@/lib/donation/apply-donation-state";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import type { AppState, Donor, Member } from "@/types";

export type SeedDonationDummyMode = "replace" | "append";

export type SeedDonationDummyOptions = {
  mode?: SeedDonationDummyMode;
  /** 단체짠 나누기 테스트용 대액 1건 (기본 true) */
  includeGroupSplitCandidate?: boolean;
  now?: number;
};

function pickPlayableMembers(state: AppState): Member[] {
  const positions = state.memberPositions || null;
  const playable = (state.members || []).filter(
    (m) =>
      !isOperatingSettlementMember(
        { id: m.id, name: m.name, operating: m.operating, realName: m.realName },
        positions
      )
  );
  return playable.length > 0 ? playable : state.members || [];
}

/**
 * 개발 서버용 더미 후원 목록.
 * - 계좌/투네 혼재
 * - 「단체짠더미」 대액 1건 (나누기 버튼 테스트)
 * - 멤버별 소액 여러 건 (삭제 테스트)
 */
export function buildDummyDonationRows(
  state: AppState,
  opts?: SeedDonationDummyOptions
): Donor[] {
  const now = Number(opts?.now) || Date.now();
  const members = pickPlayableMembers(state);
  if (members.length === 0) return [];

  const rows: Donor[] = [];
  let i = 0;
  const push = (partial: Omit<Donor, "id" | "at"> & { id?: string; at?: number }) => {
    i += 1;
    rows.push({
      id: partial.id || `dummy_${now}_${i}`,
      name: partial.name,
      amount: partial.amount,
      memberId: partial.memberId,
      at: partial.at ?? now - (rows.length + 1) * 1000,
      target: partial.target || "account",
      ...(partial.message ? { message: partial.message } : {}),
    });
  };

  if (opts?.includeGroupSplitCandidate !== false) {
    const host = members[0]!;
    push({
      id: `dummy_group_${now}`,
      name: "단체짠더미",
      amount: Math.max(90_000, members.length * 30_000),
      memberId: host.id,
      target: "account",
      message: "단체짠 테스트 — 나누기 버튼 확인용",
    });
  }

  const samples: Array<{ name: string; amount: number; target: "account" | "toon" }> = [
    { name: "더미갑", amount: 50_000, target: "account" },
    { name: "더미을", amount: 30_000, target: "toon" },
    { name: "더미병", amount: 20_000, target: "account" },
    { name: "더미정", amount: 10_000, target: "toon" },
    { name: "더미무", amount: 5_000, target: "account" },
  ];

  samples.forEach((s, idx) => {
    const m = members[idx % members.length]!;
    push({
      name: s.name,
      amount: s.amount,
      memberId: m.id,
      target: s.target,
      message: "개발 더미",
    });
  });

  const treasury = (state.members || []).find(
    (m) =>
      /국고/i.test(String(m.name || "")) ||
      /국고/i.test(String(m.realName || "")) ||
      /국고/i.test(String(state.memberPositions?.[m.id] || ""))
  );
  if (treasury) {
    push({
      name: "국고더미",
      amount: 77_000,
      memberId: treasury.id,
      target: "account",
      message: "국고 배정 테스트",
    });
  }

  return rows;
}

export const OVERLAY_SPLIT_PREVIEW_COUNT = 10;

/** 엑셀표·후원순위 좌우스플릿 확인용: 멤버 10명 + 후원자 10명 */
export function applyOverlaySplitPreviewSeed(
  state: AppState,
  opts?: { now?: number; count?: number }
): { state: AppState; added: Donor[]; memberCount: number } {
  const count = Math.max(5, Math.min(30, Math.floor(Number(opts?.count) || OVERLAY_SPLIT_PREVIEW_COUNT)));
  const now = Number(opts?.now) || Date.now();
  const members: Member[] = Array.from({ length: count }, (_, i) => {
    const idx = i + 1;
    return {
      id: `m${idx}`,
      name: `멤버${idx}`,
      realName: "",
      account: 0,
      toon: 0,
      contribution: 0,
      restroom: 0,
      operating: false,
    };
  });
  const added: Donor[] = members.map((m, i) => {
    const idx = i + 1;
    const amount = (count - i) * 100_000;
    const target: Donor["target"] = i % 2 === 0 ? "account" : "toon";
    return {
      id: `dummy_split_${now}_${idx}`,
      name: `후원자${idx}`,
      amount,
      memberId: m.id,
      at: now - idx * 1000,
      target,
      message: "스플릿 미리보기",
    };
  });
  const next = syncMemberTotalsFromDonors({
    ...state,
    members,
    memberPositions: {},
    donors: added,
    donorRankingsUpdatedAt: now,
    updatedAt: now,
    donorRankingsTheme: {
      ...(state.donorRankingsTheme || {}),
      top: Math.max(Number(state.donorRankingsTheme?.top) || 0, count),
    },
  });
  return { state: next, added, memberCount: members.length };
}

export function applyDonationDummySeed(
  state: AppState,
  opts?: SeedDonationDummyOptions
): { state: AppState; added: Donor[]; mode: SeedDonationDummyMode } {
  const mode: SeedDonationDummyMode = opts?.mode === "append" ? "append" : "replace";
  const added = buildDummyDonationRows(state, opts);
  const now = Number(opts?.now) || Date.now();
  const donors =
    mode === "append"
      ? [...(state.donors || []).filter((d) => !String(d.id || "").startsWith("dummy_")), ...added]
      : added;
  const next = syncMemberTotalsFromDonors({
    ...state,
    donors,
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  });
  return { state: next, added, mode };
}
