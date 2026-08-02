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
      <label className={labelClass}>
        <input
          type="checkbox"
          className="rounded border-white/20 bg-neutral-900"
          checked={resolved.showCombinedColumn}
          onChange={(e) => onChange({ showCombinedColumn: e.target.checked })}
        />
        후원합계 열
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
        총합 행
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
    </div>
  );
}
