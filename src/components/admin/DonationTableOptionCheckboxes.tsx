"use client";

import type { DonationTableColumnsOptions } from "@/types";
import { resolveDonationTableColumnsOptions } from "@/lib/donation-table-options";

type DonationTableOptionCheckboxesProps = {
  value?: DonationTableColumnsOptions | null;
  onChange: (patch: DonationTableColumnsOptions) => void;
  /** 프리셋: 총합 행 미설정 시 showTotal 폴백 */
  sumRowFallback?: boolean;
  compact?: boolean;
  className?: string;
};

export default function DonationTableOptionCheckboxes({
  value,
  onChange,
  sumRowFallback = true,
  compact = false,
  className = "",
}: DonationTableOptionCheckboxesProps) {
  const resolved = resolveDonationTableColumnsOptions(value, {
    showTableSumRow: sumRowFallback,
  });
  const labelClass = compact
    ? "flex items-center gap-2 text-xs text-neutral-200 cursor-pointer select-none"
    : "flex items-center gap-2 text-sm text-neutral-200 cursor-pointer select-none";

  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 ${className}`}
      data-donation-table-options="true"
    >
      <label className={labelClass} title="순위(#1, #2, ...) 열을 표시합니다. 체크 해제 시 순위 열이 숨겨집니다.">
        <input
          type="checkbox"
          className="rounded border-white/20 bg-neutral-900"
          checked={resolved.showRankColumn}
          onChange={(e) => onChange({ showRankColumn: e.target.checked })}
        />
        순위 열
      </label>
      <label className={labelClass}>
        <input
          type="checkbox"
          className="rounded border-white/20 bg-neutral-900"
          checked={resolved.showAccountColumn}
          onChange={(e) => onChange({ showAccountColumn: e.target.checked })}
        />
        계좌 열
      </label>
      <label className={labelClass}>
        <input
          type="checkbox"
          className="rounded border-white/20 bg-neutral-900"
          checked={resolved.showToonColumn}
          onChange={(e) => onChange({ showToonColumn: e.target.checked })}
        />
        투네 열
      </label>
      <label className={labelClass}>
        <input
          type="checkbox"
          className="rounded border-white/20 bg-neutral-900"
          checked={resolved.showCustomColumn}
          onChange={(e) => onChange({ showCustomColumn: e.target.checked })}
        />
        커스텀 열(상벌금 등)
      </label>
      <label className={labelClass}>
        <input
          type="checkbox"
          className="rounded border-white/20 bg-neutral-900"
          checked={resolved.showRoleColumn}
          onChange={(e) => onChange({ showRoleColumn: e.target.checked })}
        />
        직급 열
      </label>
      <label className={labelClass}>
        <input
          type="checkbox"
          className="rounded border-white/20 bg-neutral-900"
          checked={resolved.showCombinedColumn}
          onChange={(e) => onChange({ showCombinedColumn: e.target.checked })}
        />
        후원합계 열(계좌+투네)
      </label>
      <label className={labelClass}>
        <input
          type="checkbox"
          className="rounded border-white/20 bg-neutral-900"
          checked={resolved.showContributionColumn}
          onChange={(e) =>
            onChange({
              showContributionColumn: e.target.checked,
              ...(e.target.checked ? {} : { showContributionSum: false }),
            })
          }
        />
        기여도 열
      </label>
      <label className={labelClass}>
        <input
          type="checkbox"
          className="rounded border-white/20 bg-neutral-900"
          checked={resolved.showRestroomColumn}
          onChange={(e) => onChange({ showRestroomColumn: e.target.checked })}
        />
        화장실 열
      </label>
      <label className={labelClass}>
        <input
          type="checkbox"
          className="rounded border-white/20 bg-neutral-900"
          checked={resolved.showTableSumRow}
          onChange={(e) => onChange({ showTableSumRow: e.target.checked })}
        />
        총합 행(맨 아래)
      </label>
      <label className={`${labelClass}${!resolved.showContributionColumn ? " opacity-45" : ""}`}>
        <input
          type="checkbox"
          className="rounded border-white/20 bg-neutral-900"
          checked={resolved.showContributionSum}
          disabled={!resolved.showContributionColumn}
          onChange={(e) => onChange({ showContributionSum: e.target.checked })}
        />
        기여도 총합
      </label>
      <label className={labelClass} title="6명 이상일 때 표를 좌우 2열로 분할합니다. 체크 해제 시 단일 1열 세로 표로 유지되어 OBS 너비 2000+ 초과를 방지합니다.">
        <input
          type="checkbox"
          className="rounded border-white/20 bg-neutral-900"
          checked={Boolean(resolved.tableSplit)}
          onChange={(e) => onChange({ tableSplit: e.target.checked })}
        />
        좌우 2열 분할(6명 이상)
      </label>
      <label className={labelClass} title="엑셀표 각 멤버 행을 둥근 알약(Pill Capsule) 카드 스타일로 렌더링합니다.">
        <input
          type="checkbox"
          className="rounded border-white/20 bg-neutral-900"
          checked={Boolean(resolved.tablePill)}
          onChange={(e) => onChange({ tablePill: e.target.checked, pillStyle: e.target.checked })}
        />
        알약 형태 디자인(Pill)
      </label>
    </div>
  );
}
