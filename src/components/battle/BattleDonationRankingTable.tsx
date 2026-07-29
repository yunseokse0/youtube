"use client";

import {
  battleDonationRankingTotals,
  battleRankRowBg,
  formatBattleDonationAmount,
  type BattleDonationRankingRow,
} from "@/lib/battle-donation-ranking";
import { resolveDonationTableColumnsOptions } from "@/lib/donation-table-options";
import type { DonationTableColumnsOptions } from "@/types";

type BattleDonationRankingTableProps = {
  rows: BattleDonationRankingRow[];
  compact?: boolean;
  tableOptions?: DonationTableColumnsOptions | null;
  accountLabel?: string;
  toonLabel?: string;
  className?: string;
};

export default function BattleDonationRankingTable({
  rows,
  compact = false,
  tableOptions,
  accountLabel = "계좌후원",
  toonLabel = "웹후원",
  className = "",
}: BattleDonationRankingTableProps) {
  if (rows.length === 0) return null;
  const opts = resolveDonationTableColumnsOptions(tableOptions);
  const totals = battleDonationRankingTotals(rows);
  const cellPad = compact ? "px-1.5 py-0.5" : "px-2 py-1";
  const fontSize = compact ? "text-[11px] sm:text-xs" : "text-xs sm:text-sm";

  return (
    <div
      className={`overflow-hidden rounded-lg border border-black/25 shadow-[0_4px_18px_rgba(0,0,0,0.35)] ${className}`}
      data-battle-donation-table="true"
    >
      <table className={`w-full border-collapse ${fontSize}`} style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "8%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: opts.showCombinedColumn && opts.showContributionColumn ? "18%" : "22%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "16%" }} />
          {opts.showCombinedColumn ? <col style={{ width: "16%" }} /> : null}
          {opts.showContributionColumn ? <col style={{ width: "12%" }} /> : null}
        </colgroup>
        <thead>
          <tr
            style={{
              background: "rgba(74, 55, 40, 0.94)",
              color: "#ffffff",
            }}
          >
            <th className={`${cellPad} text-center font-bold`}>순위</th>
            <th className={`${cellPad} text-center font-bold`}>구분</th>
            <th className={`${cellPad} text-left font-bold`}>스트리머</th>
            <th className={`${cellPad} text-right font-bold`}>{toonLabel}</th>
            <th className={`${cellPad} text-right font-bold`}>{accountLabel}</th>
            {opts.showCombinedColumn ? (
              <th className={`${cellPad} text-right font-bold`}>후원합계</th>
            ) : null}
            {opts.showContributionColumn ? (
              <th className={`${cellPad} text-right font-bold`}>기여도</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={row.memberId}
              style={{
                background: battleRankRowBg(idx),
                color: "#1e293b",
              }}
            >
              <td className={`${cellPad} text-center font-bold tabular-nums`}>{idx + 1}</td>
              <td className={`${cellPad} text-center truncate`}>{row.category || "—"}</td>
              <td className={`${cellPad} truncate font-semibold`}>{row.name}</td>
              <td className={`${cellPad} text-right tabular-nums`}>{formatBattleDonationAmount(row.toon)}</td>
              <td className={`${cellPad} text-right tabular-nums`}>{formatBattleDonationAmount(row.account)}</td>
              {opts.showCombinedColumn ? (
                <td className={`${cellPad} text-right tabular-nums font-bold`}>
                  {formatBattleDonationAmount(row.total)}
                </td>
              ) : null}
              {opts.showContributionColumn ? (
                <td className={`${cellPad} text-right tabular-nums`}>
                  {formatBattleDonationAmount(row.contribution)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
        {opts.showTableSumRow ? (
          <tfoot>
            <tr
              style={{
                background: "rgba(255, 255, 255, 0.88)",
                color: "#0f172a",
                borderTop: "2px solid rgba(74, 55, 40, 0.45)",
              }}
            >
              <td className={`${cellPad} text-center font-black`} colSpan={3}>
                총합
              </td>
              <td className={`${cellPad} text-right tabular-nums font-bold`}>
                {formatBattleDonationAmount(totals.toon)}
              </td>
              <td className={`${cellPad} text-right tabular-nums font-bold`}>
                {formatBattleDonationAmount(totals.account)}
              </td>
              {opts.showCombinedColumn ? (
                <td className={`${cellPad} text-right tabular-nums font-black`}>
                  {formatBattleDonationAmount(totals.total)}
                </td>
              ) : null}
              {opts.showContributionColumn ? (
                <td className={`${cellPad} text-right tabular-nums font-bold`}>
                  {opts.showContributionSum
                    ? formatBattleDonationAmount(totals.contribution)
                    : ""}
                </td>
              ) : null}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
