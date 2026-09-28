"use client";

import { useMemo, useState } from "react";
import type { Donor } from "@/types";
import {
  fileLabelFromName,
  parseMemberToonationExcelBuffer,
  reconcileMemberToonationExcels,
  type MemberExcelMemberRef,
  type MemberExcelReconcileResult,
} from "@/lib/member-toonation-excel";

function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

type Props = {
  members: MemberExcelMemberRef[];
  donors: Donor[];
  onResultChange?: (result: MemberExcelReconcileResult | null) => void;
  onApplyMissing?: (missingDonors: Donor[]) => void | Promise<void>;
  applyLabel?: string;
  busy?: boolean;
};

export default function MemberExcelAccountReconcile({
  members,
  donors,
  onResultChange,
  onApplyMissing,
  applyLabel = "누락 계좌를 정산에 반영",
  busy = false,
}: Props) {
  const [result, setResult] = useState<MemberExcelReconcileResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState(0);

  const missingSum = useMemo(
    () => (result?.missingAccount || []).reduce((s, r) => s + r.amount, 0),
    [result]
  );

  const applyResult = (next: MemberExcelReconcileResult | null) => {
    setResult(next);
    onResultChange?.(next);
  };

  const onPickFiles = async (files: FileList | null) => {
    setParseError(null);
    if (!files || files.length === 0) {
      setFileCount(0);
      applyResult(null);
      return;
    }
    try {
      const parsed = [];
      for (const file of Array.from(files)) {
        const buf = await file.arrayBuffer();
        parsed.push(parseMemberToonationExcelBuffer(buf, fileLabelFromName(file.name)));
      }
      setFileCount(files.length);
      applyResult(reconcileMemberToonationExcels(parsed, members, donors));
    } catch {
      setParseError("엑셀을 읽지 못했습니다. Time/Name/Amount/Message 형식인지 확인해 주세요.");
      setFileCount(0);
      applyResult(null);
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 space-y-2">
      <div className="text-sm font-semibold text-amber-100">멤버 계좌 엑셀 대조</div>
      <p className="text-[11px] text-neutral-400 leading-relaxed">
        멤버가 보낸 투네/계좌 엑셀(Time·Name·Amount·Message, 투네이션 합계·계좌합계)을 올리면
        은행 SMS가 빠진 계좌 행만 골라 정산에 넣습니다. 이름칸에 예금주+멤버가 붙어 있고 정산은
        이름/메시지로 나뉜 건은 이미 있는 것으로 봅니다.
      </p>
      <input
        type="file"
        accept=".xlsx,.xls"
        multiple
        disabled={busy}
        className="block w-full text-xs text-neutral-300 file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:bg-amber-800 file:text-amber-50"
        onChange={(e) => {
          const list = e.target.files;
          void onPickFiles(list);
        }}
      />
      {parseError ? <p className="text-xs text-red-300">{parseError}</p> : null}
      {result && fileCount > 0 ? (
        <div className="space-y-2 text-xs">
          {result.unresolvedLabels.length > 0 ? (
            <p className="text-amber-200">
              멤버와 파일명이 안 맞음: {result.unresolvedLabels.join(", ")}
            </p>
          ) : null}
          {result.missingAccount.length === 0 ? (
            <p className="text-emerald-300">계좌 구간 누락 없음 · 대조 {fileCount}파일</p>
          ) : (
            <>
              <p className="text-red-200 font-semibold">
                SMS 누락 계좌 {result.missingAccount.length}건 · {won(missingSum)}
              </p>
              <div className="overflow-auto rounded border border-white/10">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-neutral-400 border-b border-white/10">
                      <th className="p-1.5 text-left">멤버</th>
                      <th className="p-1.5 text-left">후원자</th>
                      <th className="p-1.5 text-right">금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.missingAccount.map((row, idx) => (
                      <tr key={`${row.memberId}-${row.at}-${idx}`} className="border-b border-white/5">
                        <td className="p-1.5">{row.memberName}</td>
                        <td className="p-1.5">{row.name}</td>
                        <td className="p-1.5 text-right tabular-nums">{won(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {onApplyMissing ? (
                <button
                  type="button"
                  className="px-3 py-1.5 rounded bg-amber-800 hover:bg-amber-700 text-sm disabled:opacity-50"
                  disabled={busy || result.missingDonors.length === 0}
                  onClick={() => {
                    const missing = result.missingDonors;
                    applyResult({
                      ...result,
                      missingAccount: [],
                      missingDonors: [],
                    });
                    void onApplyMissing(missing);
                  }}
                >
                  {applyLabel} ({result.missingAccount.length}건)
                </button>
              ) : (
                <p className="text-neutral-400">
                  방송 종료 시 이 {result.missingAccount.length}건을 정산 후원에 자동 포함합니다.
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-neutral-500">엑셀을 올리지 않고 정산하면 계좌 SMS 누락이 남을 수 있습니다.</p>
      )}
    </div>
  );
}
