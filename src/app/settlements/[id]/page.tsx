"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { SettlementMemberResult, SettlementRecord, deleteSettlementRecordAndSync, loadSettlementRecords, loadSettlementRecordsPreferApi, recordToCsv, recordToTxt, saveSettlementRecords, saveSettlementRecordsToApi, toSettlementFormulaLine } from "@/lib/settlement";
import { downloadTextFile, downloadBlobFile } from "@/lib/download";

function updateMemberBankInfo(
  records: SettlementRecord[],
  recordId: string,
  memberId: string,
  patch: { bankName?: string; bankAccount?: string; accountHolder?: string }
): SettlementRecord[] {
  return records.map((r) => {
    if (r.id !== recordId) return r;
    return {
      ...r,
      members: r.members.map((m) => (m.memberId === memberId ? { ...m, ...patch } : m)),
    };
  });
}

export default function SettlementDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";
  const [records, setRecords] = useState<SettlementRecord[] | null>(null);
  const [copiedMemberId, setCopiedMemberId] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const local = loadSettlementRecords();
    setRecords(local);
    loadSettlementRecordsPreferApi().then(setRecords);
  }, []);
  const record = useMemo(() => (records || []).find((x) => x.id === id) || null, [records, id]);

  const saveBankInfo = (memberId: string, patch: { bankName?: string; bankAccount?: string; accountHolder?: string }) => {
    if (!records) return;
    const next = updateMemberBankInfo(records, id, memberId, patch);
    setRecords(next);
    saveSettlementRecords(next);
    saveSettlementRecordsToApi(next).catch(() => {});
  };

  const copyAccountLine = async (m: SettlementMemberResult) => {
    const bank = (m.bankName || "").trim() || "-";
    const account = (m.bankAccount || "").trim() || "-";
    const holder = (m.accountHolder || m.realName || "").trim() || "-";
    const line = `${bank} / ${account} / ${holder}`;
    try {
      await navigator.clipboard.writeText(line);
      setCopiedMemberId(m.memberId);
      window.setTimeout(() => setCopiedMemberId((prev) => (prev === m.memberId ? null : prev)), 1200);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = line;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedMemberId(m.memberId);
      window.setTimeout(() => setCopiedMemberId((prev) => (prev === m.memberId ? null : prev)), 1200);
    }
  };

  const onDeleteRecord = async () => {
    if (!record) return;
    if (!window.confirm(`정산 기록을 삭제할까요?\n${record.title}\n삭제 후 복구할 수 없습니다.`)) return;
    const res = await deleteSettlementRecordAndSync(record.id, "user-delete-from-detail");
    if (!res.deleted) return;
    router.push("/settlements");
  };

  const onDownloadPdf = async () => {
    if (!record || !contentRef.current || pdfGenerating) return;
    setPdfGenerating(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(contentRef.current, {
        scale: 2,
        backgroundColor: "#0a0a0a",
        useCORS: true,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const usableW = pageW - margin * 2;
      const usableH = pageH - margin * 2;
      const imgW = usableW;
      const imgH = (canvas.height * imgW) / canvas.width;

      let remaining = imgH;
      let y = margin;
      pdf.addImage(imgData, "PNG", margin, y, imgW, imgH, undefined, "FAST");
      remaining -= usableH;

      while (remaining > 0) {
        pdf.addPage();
        y = margin - (imgH - remaining);
        pdf.addImage(imgData, "PNG", margin, y, imgW, imgH, undefined, "FAST");
        remaining -= usableH;
      }

      const pdfOutput = pdf.output("blob");
      const blob = pdfOutput instanceof Blob ? pdfOutput : new Blob([pdfOutput], { type: "application/pdf" });
      await downloadBlobFile(`${record.title}.pdf`, blob);
    } catch {
      window.alert("PDF 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPdfGenerating(false);
    }
  };

  if (records === null) {
    return (
      <main className="min-h-screen p-6">
        <div className="max-w-4xl mx-auto text-neutral-300">정산 기록 불러오는 중...</div>
      </main>
    );
  }

  if (!record) {
    return (
      <main className="min-h-screen p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-neutral-300">정산 기록을 찾을 수 없습니다.</div>
          <Link className="underline text-neutral-300" href="/settlements">목록으로</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div ref={contentRef} className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold whitespace-nowrap">{record.title}</h1>
            <div className="text-sm text-neutral-400 whitespace-nowrap">{new Date(record.createdAt).toLocaleString()}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 whitespace-nowrap" href="/settlements">목록</Link>
            <button
              className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 whitespace-nowrap"
              onClick={() => downloadTextFile(`${record.title}.csv`, recordToCsv(record), "text/csv;charset=utf-8")}
            >
              엑셀(CSV)
            </button>
            <button
              className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 whitespace-nowrap"
              onClick={() => downloadTextFile(`${record.title}.txt`, recordToTxt(record), "text/plain;charset=utf-8")}
            >
              메모장(TXT)
            </button>
            <button className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-60 whitespace-nowrap" onClick={onDownloadPdf} disabled={pdfGenerating}>
              {pdfGenerating ? "PDF 생성 중..." : "PDF"}
            </button>
            <button className="px-3 py-2 rounded bg-red-800 hover:bg-red-700 whitespace-nowrap" onClick={onDeleteRecord}>
              삭제
            </button>
          </div>
        </div>

        <div className="text-sm text-neutral-300 whitespace-nowrap overflow-x-auto">
          계좌 비율 {(record.accountRatio * 100).toFixed(1)}% · 투네 비율 {(record.toonRatio * 100).toFixed(1)}% · 세금 {(record.feeRate * 100).toFixed(1)}%
        </div>

        <div className="rounded border border-white/10 bg-neutral-900/50 overflow-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-neutral-400 border-b border-white/10">
                <th className="p-2 text-left">닉네임</th>
                <th className="p-2 text-left">실명</th>
                <th className="p-2 text-left">은행</th>
                <th className="p-2 text-left">계좌번호</th>
                <th className="p-2 text-left">예금주</th>
                <th className="p-2 text-center">복사</th>
                <th className="p-2 text-right">계좌 반영</th>
                <th className="p-2 text-right">투네 반영</th>
                <th className="p-2 text-right">중간합</th>
                <th className="p-2 text-right">세금</th>
                <th className="p-2 text-right">최종 정산</th>
                <th className="p-2 text-left">계산식</th>
              </tr>
            </thead>
            <tbody>
              {record.members.map((m) => (
                <tr key={m.memberId} className="border-b border-white/10">
                  <td className="p-2">{m.name}</td>
                  <td className="p-2">{m.realName || "-"}</td>
                  <td className="p-2">
                    <input
                      className="w-full px-2 py-1 rounded bg-neutral-800 border border-white/10"
                      defaultValue={m.bankName || ""}
                      placeholder="은행"
                      onBlur={(e) => saveBankInfo(m.memberId, { bankName: e.target.value.trim() })}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      className="w-full px-2 py-1 rounded bg-neutral-800 border border-white/10"
                      defaultValue={m.bankAccount || ""}
                      placeholder="계좌번호"
                      onBlur={(e) => saveBankInfo(m.memberId, { bankAccount: e.target.value.trim() })}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      className="w-full px-2 py-1 rounded bg-neutral-800 border border-white/10"
                      defaultValue={m.accountHolder || m.realName || ""}
                      placeholder="예금주"
                      onBlur={(e) => saveBankInfo(m.memberId, { accountHolder: e.target.value.trim() })}
                    />
                  </td>
                  <td className="p-2 text-center">
                    <button
                      type="button"
                      className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-xs"
                      onClick={() => copyAccountLine(m)}
                    >
                      {copiedMemberId === m.memberId ? "복사됨" : "복사"}
                    </button>
                  </td>
                  <td className="p-2 text-right">{m.accountApplied.toLocaleString()}</td>
                  <td className="p-2 text-right">{m.toonApplied.toLocaleString()}</td>
                  <td className="p-2 text-right">{m.gross.toLocaleString()}</td>
                  <td className="p-2 text-right">{m.fee.toLocaleString()}</td>
                  <td className="p-2 text-right font-semibold">{m.net.toLocaleString()}</td>
                  <td className="p-2 text-xs text-neutral-300 whitespace-nowrap">{toSettlementFormulaLine(record, m)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="p-2" colSpan={8}>합계</td>
                <td className="p-2 text-right">{record.totalGross.toLocaleString()}</td>
                <td className="p-2 text-right">{record.totalFee.toLocaleString()}</td>
                <td className="p-2 text-right">{record.totalNet.toLocaleString()}</td>
                <td className="p-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </main>
  );
}

