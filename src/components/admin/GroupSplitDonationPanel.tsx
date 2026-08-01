"use client";

import { previewGroupSplitDonation } from "@/lib/donation/group-split-donation";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import { normalizeGroupSplitDonationSettings } from "@/lib/state";
import type { AppState } from "@/types";

export function GroupSplitDonationPanel({
  state,
  onExcludeChange,
  onAutoSplitChange,
  compact = false,
}: {
  state: AppState;
  onExcludeChange: (memberId: string, exclude: boolean) => void;
  onAutoSplitChange?: (enabled: boolean) => void;
  compact?: boolean;
}) {
  const splitCfg = normalizeGroupSplitDonationSettings(state.groupSplitDonationSettings);
  const excluded = new Set(splitCfg.excludedMemberIds);
  const samplePreview = previewGroupSplitDonation(state, 1000000, splitCfg);

  return (
    <div
      id="group-split-donation-settings"
      className={`rounded-xl border border-violet-400/30 bg-violet-950/20 space-y-3 ${
        compact ? "p-3" : "p-4"
      }`}
    >
      <div>
        <div className="text-sm font-semibold text-violet-100">단체짠 나누기</div>
        <p className="mt-1 text-[11px] leading-snug text-violet-100/70">
          기본은 <strong className="font-semibold text-violet-50">운영비 제외 전원</strong> 균등 분배입니다. 빼고
          싶은 멤버만 「제외」 체크하세요. <strong className="text-violet-50">후원 총액은 그대로</strong> 두고 멤버
          배분만 바뀝니다.
        </p>
        {!compact ? (
          <p className="mt-1 text-[11px] leading-snug text-violet-100/70">
            아래 <strong className="text-violet-50">후원자 리스트</strong> 「나누기」 — 1인 몫은 내림, 나머지 원은 첫
            분배 멤버에 더해 합계가 원금과 같게 맞춥니다.
          </p>
        ) : null}
        <p className="mt-1 text-[10px] text-violet-200/60">
          예시 100만 원 · 현재 {samplePreview.eligibleMembers.length}명 → 1인당{" "}
          {samplePreview.sharePerMember.toLocaleString("ko-KR")}원
        </p>
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11px] text-violet-100/80">
          <input
            type="checkbox"
            className="mt-0.5 accent-violet-400"
            checked={splitCfg.autoSplitOnKeyword !== false}
            onChange={(e) => onAutoSplitChange?.(e.target.checked)}
            disabled={!onAutoSplitChange}
          />
          <span>
            <strong className="text-violet-50">「단체」·「단체짠」 자동 나누기</strong> — 투네·계좌 후원자명 또는
            메시지에 포함 시 즉시 균등 분배. 불가 시{" "}
            <strong className="text-violet-50">대표(지정) 또는 1위</strong> 멤버에 1인 적립
          </span>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {state.members.map((member) => {
          const operating = isOperatingSettlementMember(
            {
              id: member.id,
              name: member.name,
              operating: member.operating,
              realName: member.realName,
            },
            state.memberPositions || null
          );
          const isExcluded = excluded.has(member.id);
          if (operating) {
            return (
              <div
                key={member.id}
                className="flex items-center gap-2 rounded-lg border border-neutral-600/40 bg-neutral-900/40 px-3 py-2 text-xs text-neutral-500"
              >
                <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px]">운영비</span>
                <span>{member.name} · 자동 제외</span>
              </div>
            );
          }
          return (
            <label
              key={member.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-neutral-200"
            >
              <input
                type="checkbox"
                className="accent-violet-400"
                checked={isExcluded}
                onChange={(e) => onExcludeChange(member.id, e.target.checked)}
              />
              <span>
                {member.name}
                {isExcluded ? " · 제외" : ""}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
