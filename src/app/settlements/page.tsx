"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SettlementDeleteLog, SettlementRecord, deleteSettlementRecordAndSync, loadSettlementDeleteLogs, loadSettlementRecordsPreferApi } from "@/lib/settlement";

export default function SettlementsPage() {
  const [records, setRecords] = useState<SettlementRecord[]>([]);
  const [deleteLogs, setDeleteLogs] = useState<SettlementDeleteLog[]>([]);

  useEffect(() => {
    loadSettlementRecordsPreferApi().then(setRecords);
    setDeleteLogs(loadSettlementDeleteLogs());
  }, []);

  const onDeleteRecord = async (recordId: string) => {
    const target = records.find((r) => r.id === recordId);
    if (!target) return;
    if (!window.confirm(`정산 기록을 삭제할까요?\n${target.title}\n삭제 후 복구할 수 없습니다.`)) return;
    const res = await deleteSettlementRecordAndSync(recordId, "user-delete-from-list");
    if (!res.deleted) return;
    setRecords((prev) => prev.filter((r) => r.id !== recordId));
    setDeleteLogs(loadSettlementDeleteLogs());
  };

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">정산 기록</h1>
          <Link className="text-sm underline text-neutral-300" href="/admin">관리자</Link>
        </div>
        <div className="text-sm text-neutral-400">최대 3년치 정산 기록을 보관합니다.</div>
        <div className="rounded border border-white/10 bg-neutral-900/50 overflow-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-neutral-400 border-b border-white/10">
                <th className="p-2 text-left">일시</th>
                <th className="p-2 text-left">제목</th>
                <th className="p-2 text-right">참여자</th>
                <th className="p-2 text-right">최종 정산</th>
                <th className="p-2 text-right">열기</th>
                <th className="p-2 text-right">삭제</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-b border-white/10">
                  <td className="p-2 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="p-2 whitespace-nowrap">{r.title}</td>
                  <td className="p-2 text-right">{r.members.length}</td>
                  <td className="p-2 text-right font-semibold">{r.totalNet.toLocaleString()}</td>
                  <td className="p-2 text-right">
                    <Link className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 whitespace-nowrap inline-block" href={`/settlements/${r.id}`}>상세</Link>
                  </td>
                  <td className="p-2 text-right">
                    <button className="px-2 py-1 rounded bg-red-800 hover:bg-red-700 whitespace-nowrap" onClick={() => onDeleteRecord(r.id)}>삭제</button>
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td className="p-4 text-neutral-400" colSpan={6}>정산 기록이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="rounded border border-white/10 bg-neutral-900/40 overflow-auto">
          <div className="px-3 py-2 border-b border-white/10 text-sm font-semibold">삭제 로그 (보관)</div>
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-neutral-400 border-b border-white/10">
                <th className="p-2 text-left">삭제 시각</th>
                <th className="p-2 text-left">정산 제목</th>
                <th className="p-2 text-left">원본 생성시각</th>
                <th className="p-2 text-right">최종 정산</th>
              </tr>
            </thead>
            <tbody>
              {deleteLogs.map((log) => (
                <tr key={`${log.recordId}_${log.deletedAt}`} className="border-b border-white/10">
                  <td className="p-2">{new Date(log.deletedAt).toLocaleString()}</td>
                  <td className="p-2">{log.title}</td>
                  <td className="p-2">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="p-2 text-right">{log.totalNet.toLocaleString()}</td>
                </tr>
              ))}
              {deleteLogs.length === 0 && (
                <tr>
                  <td className="p-4 text-neutral-400" colSpan={4}>삭제 로그가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

