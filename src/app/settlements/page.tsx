"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SettlementDeleteLog, SettlementRecord, deleteSettlementRecordAndSync, loadSettlementDeleteLogs, loadSettlementRecordsPreferApi } from "@/lib/settlement";
import { loadDailyLog, loadDailyLogFromApi, Donor } from "@/lib/state";

function formatMan( n: number ): string {
  if (n >= 1_0000_0000) return `${(n / 1_0000_0000).toFixed(1)}억`;
  if (n >= 1_0000) return `${(n / 1_0000).toFixed(1)}만`;
  return n.toLocaleString();
}

export default function SettlementsPage() {
  const [records, setRecords] = useState<SettlementRecord[]>([]);
  const [deleteLogs, setDeleteLogs] = useState<SettlementDeleteLog[]>([]);
  const [dailyLog, setDailyLog] = useState<Record<string, { at: string; total: number; members: unknown[]; donors: Donor[] }[]>>({});
  const [titleQuery, setTitleQuery] = useState("");
  const [dateQuery, setDateQuery] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedForGraph, setSelectedForGraph] = useState<string | null>(null);

  useEffect(() => {
    loadSettlementRecordsPreferApi().then(setRecords);
    setDeleteLogs(loadSettlementDeleteLogs());
    loadDailyLogFromApi()
      .then((apiLog) => {
        const local = loadDailyLog();
        const merged = { ...local, ...apiLog };
        setDailyLog(Object.keys(merged).length > 0 ? merged : {});
      })
      .catch(() => setDailyLog(loadDailyLog()));
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

  const filteredRecords = useMemo(() => {
    const titleNeedle = titleQuery.trim().toLowerCase();
    const memberNeedle = memberQuery.trim().toLowerCase();
    return records.filter((r) => {
      if (titleNeedle && !r.title.toLowerCase().includes(titleNeedle)) return false;
      if (memberNeedle) {
        const hasMember = (r.members || []).some((m) =>
          `${m.name || ""} ${m.realName || ""}`.toLowerCase().includes(memberNeedle)
        );
        if (!hasMember) return false;
      }
      if (dateQuery) {
        const ymd = new Date(r.createdAt).toISOString().slice(0, 10);
        if (ymd !== dateQuery) return false;
      }
      return true;
    });
  }, [records, titleQuery, memberQuery, dateQuery]);

  useEffect(() => {
    if (selectedForGraph && !filteredRecords.some((r) => r.id === selectedForGraph)) {
      setSelectedForGraph(null);
    }
  }, [selectedForGraph, filteredRecords]);

  const recordToDonors = useMemo(() => {
    const map = new Map<string, Donor[]>();
    for (const r of filteredRecords) {
      const ymd = new Date(r.createdAt).toISOString().slice(0, 10);
      const entries = dailyLog[ymd] || [];
      const last = entries[entries.length - 1];
      map.set(r.id, last?.donors || []);
    }
    return map;
  }, [filteredRecords, dailyLog]);

  const donorDashboard = useMemo(() => {
    const allDonors: Donor[] = [];
    for (const r of filteredRecords) {
      allDonors.push(...(recordToDonors.get(r.id) || []));
    }
    const totalAmount = allDonors.reduce((s, d) => s + d.amount, 0);
    const byName = new Map<string, { name: string; amount: number; count: number }>();
    for (const d of allDonors) {
      const key = (d.name || "무명").trim() || "무명";
      const prev = byName.get(key) || { name: key, amount: 0, count: 0 };
      byName.set(key, { name: key, amount: prev.amount + d.amount, count: prev.count + 1 });
    }
    const topDonors = Array.from(byName.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
    const broadcastCount = filteredRecords.length;
    const avgPerBroadcast = broadcastCount > 0 ? totalAmount / broadcastCount : 0;
    return { totalAmount, totalCount: allDonors.length, topDonors, broadcastCount, avgPerBroadcast };
  }, [filteredRecords, recordToDonors]);

  const timeGraphData = useMemo(() => {
    const rid = selectedForGraph;
    if (!rid) return null;
    const donors = recordToDonors.get(rid) || [];
    if (donors.length === 0) return null;
    const minAt = Math.min(...donors.map((d) => d.at));
    const BUCKET_MIN = 15;
    const buckets: Record<number, { amount: number; count: number }> = {};
    for (const d of donors) {
      const mins = Math.floor((d.at - minAt) / 60000 / BUCKET_MIN) * BUCKET_MIN;
      if (!buckets[mins]) buckets[mins] = { amount: 0, count: 0 };
      buckets[mins].amount += d.amount;
      buckets[mins].count += 1;
    }
    const sorted = Object.entries(buckets)
      .map(([k, v]) => ({ mins: parseInt(k, 10), ...v }))
      .sort((a, b) => a.mins - b.mins);
    const maxAmount = Math.max(1, ...sorted.map((s) => s.amount));
    return { buckets: sorted, maxAmount, minAt };
  }, [selectedForGraph, recordToDonors]);

  const dashboard = useMemo(() => {
    const totalGross = filteredRecords.reduce((s, r) => s + (r.totalGross || 0), 0);
    const totalFee = filteredRecords.reduce((s, r) => s + (r.totalFee || 0), 0);
    const totalNet = filteredRecords.reduce((s, r) => s + (r.totalNet || 0), 0);
    const byMonth = filteredRecords.reduce<Record<string, { gross: number; fee: number; net: number }>>((acc, r) => {
      const key = new Date(r.createdAt).toISOString().slice(0, 7);
      if (!acc[key]) acc[key] = { gross: 0, fee: 0, net: 0 };
      acc[key].gross += r.totalGross || 0;
      acc[key].fee += r.totalFee || 0;
      acc[key].net += r.totalNet || 0;
      return acc;
    }, {});
    const monthlyData = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v }));
    const byMember = filteredRecords.reduce<Record<string, { name: string; gross: number; fee: number; net: number; count: number }>>((acc, r) => {
      for (const m of r.members || []) {
        const label = (m.name || "").trim() || m.memberId;
        const key = label || `_${m.memberId}`;
        if (!acc[key]) acc[key] = { name: label, gross: 0, fee: 0, net: 0, count: 0 };
        acc[key].gross += m.gross || 0;
        acc[key].fee += m.fee || 0;
        acc[key].net += m.net || 0;
        acc[key].count += 1;
      }
      return acc;
    }, {});
    const memberData = Object.values(byMember)
      .filter((m) => m.net > 0 || m.gross > 0)
      .sort((a, b) => (b.net || 0) - (a.net || 0))
      .slice(0, 15);
    const maxNet = Math.max(1, ...memberData.map((m) => m.net));
    const maxMonthly = Math.max(1, ...monthlyData.map((m) => m.net));
    const totalForPie = memberData.reduce((s, m) => s + m.net, 0);
    const memberPieData = memberData.map((m, i) => ({
      ...m,
      pct: totalForPie > 0 ? (m.net / totalForPie) * 100 : 0,
      color: ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316"][i % 8],
    }));
    return { totalGross, totalFee, totalNet, monthlyData, memberData, memberPieData, maxNet, maxMonthly };
  }, [filteredRecords]);

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">정산 기록</h1>
          <Link className="text-sm underline text-neutral-300" href="/admin">관리자</Link>
        </div>
        <div className="text-sm text-neutral-400">최대 3년치 정산 기록을 보관합니다.</div>
        <div className="rounded border border-white/10 bg-neutral-900/40 p-3">
          <div className="grid grid-cols-1 md:grid-cols-[90px_1fr_90px_1fr] gap-2 items-center">
            <label className="text-xs text-neutral-400">방송 제목</label>
            <input
              className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
              placeholder="제목 검색"
              value={titleQuery}
              onChange={(e) => setTitleQuery(e.target.value)}
            />
            <label className="text-xs text-neutral-400">출연자</label>
            <input
              className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
              placeholder="닉네임/실명 검색"
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[90px_1fr_auto] gap-2 items-center mt-2">
            <label className="text-xs text-neutral-400">날짜</label>
            <input
              type="date"
              className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
              value={dateQuery}
              onChange={(e) => setDateQuery(e.target.value)}
            />
            <button
              className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs whitespace-nowrap"
              onClick={() => {
                setTitleQuery("");
                setMemberQuery("");
                setDateQuery("");
              }}
            >
              필터 초기화
            </button>
          </div>
          <div className="mt-2 text-xs text-neutral-400">
            검색 결과 {filteredRecords.length}건 / 전체 {records.length}건
          </div>
        </div>

        {/* 대시보드 */}
        <section className="rounded border border-white/10 bg-neutral-900/40 p-4 space-y-4">
          <h2 className="text-lg font-semibold">매출 현황 대시보드</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg bg-neutral-800/80 p-3 border border-white/5">
              <div className="text-xs text-neutral-400">총 매출(중간합)</div>
              <div className="text-xl font-bold text-emerald-400">{formatMan(dashboard.totalGross)}</div>
              <div className="text-xs text-neutral-500">{dashboard.totalGross.toLocaleString()}원</div>
            </div>
            <div className="rounded-lg bg-neutral-800/80 p-3 border border-white/5">
              <div className="text-xs text-neutral-400">총 세금</div>
              <div className="text-xl font-bold text-amber-400">{formatMan(dashboard.totalFee)}</div>
              <div className="text-xs text-neutral-500">{dashboard.totalFee.toLocaleString()}원</div>
            </div>
            <div className="rounded-lg bg-neutral-800/80 p-3 border border-white/5">
              <div className="text-xs text-neutral-400">총 정산</div>
              <div className="text-xl font-bold text-blue-400">{formatMan(dashboard.totalNet)}</div>
              <div className="text-xs text-neutral-500">{dashboard.totalNet.toLocaleString()}원</div>
            </div>
            <div className="rounded-lg bg-neutral-800/80 p-3 border border-white/5">
              <div className="text-xs text-neutral-400">정산 건수</div>
              <div className="text-xl font-bold">{filteredRecords.length}</div>
              <div className="text-xs text-neutral-500">건</div>
            </div>
          </div>

          {dashboard.totalGross > 0 && (
            <div className="rounded-lg bg-neutral-800/50 p-4 border border-white/5">
              <h3 className="text-sm font-semibold mb-3">매출 구성 (총매출 대비)</h3>
              <div className="flex gap-4 items-center flex-wrap">
                <div className="flex-1 min-w-[200px] space-y-2">
                  <div className="h-6 rounded bg-neutral-700 overflow-hidden flex">
                    <div
                      className="bg-emerald-500/80"
                      style={{ width: `${(dashboard.totalNet / dashboard.totalGross) * 100}%` }}
                    />
                    <div
                      className="bg-amber-500/80"
                      style={{ width: `${(dashboard.totalFee / dashboard.totalGross) * 100}%` }}
                    />
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500" />정산 {((dashboard.totalNet / dashboard.totalGross) * 100).toFixed(1)}%</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-amber-500" />세금 {((dashboard.totalFee / dashboard.totalGross) * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {dashboard.monthlyData.length > 0 && (
            <div className="rounded-lg bg-neutral-800/50 p-4 border border-white/5">
              <h3 className="text-sm font-semibold mb-3">월별 매출 추이 (막대 그래프)</h3>
              <div className="flex items-end gap-2 h-40">
                {dashboard.monthlyData.map((d) => (
                  <div key={d.month} className="flex-1 flex flex-col items-center gap-1 min-w-[28px] group">
                    <div className="w-full flex flex-col items-center justify-end h-32 gap-0.5">
                      <div
                        className="w-full max-w-10 rounded-t bg-blue-500/80 group-hover:bg-blue-400 transition-colors relative"
                        style={{ height: `${Math.max(8, (d.net / dashboard.maxMonthly) * 100)}%` }}
                        title={`${d.month}: 정산 ${d.net.toLocaleString()}원`}
                      >
                        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-neutral-300 opacity-0 group-hover:opacity-100 whitespace-nowrap">
                          {formatMan(d.net)}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] text-neutral-500 truncate w-full text-center">{d.month.slice(2)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-400">
                {dashboard.monthlyData.map((d) => (
                  <span key={d.month} title={`매출 ${formatMan(d.gross)} / 세금 ${formatMan(d.fee)} / 정산 ${formatMan(d.net)}`}>
                    {d.month}: {formatMan(d.net)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 후원자 대시보드 */}
          {donorDashboard.totalCount > 0 && (
            <div className="rounded-lg bg-neutral-800/50 p-4 border border-white/5">
              <h3 className="text-sm font-semibold mb-3">후원자 현황</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div className="rounded bg-neutral-700/50 p-2">
                  <div className="text-[10px] text-neutral-500">총 후원 건수</div>
                  <div className="text-lg font-bold text-cyan-400">{donorDashboard.totalCount.toLocaleString()}</div>
                </div>
                <div className="rounded bg-neutral-700/50 p-2">
                  <div className="text-[10px] text-neutral-500">총 후원액</div>
                  <div className="text-lg font-bold text-cyan-400">{formatMan(donorDashboard.totalAmount)}</div>
                </div>
                <div className="rounded bg-neutral-700/50 p-2">
                  <div className="text-[10px] text-neutral-500">방송당 평균</div>
                  <div className="text-lg font-bold text-cyan-400">{formatMan(donorDashboard.avgPerBroadcast)}</div>
                </div>
                <div className="rounded bg-neutral-700/50 p-2">
                  <div className="text-[10px] text-neutral-500">건당 평균</div>
                  <div className="text-lg font-bold text-cyan-400">{donorDashboard.totalCount > 0 ? formatMan(donorDashboard.totalAmount / donorDashboard.totalCount) : "-"}</div>
                </div>
              </div>
              <div>
                <div className="text-xs text-neutral-500 mb-2">후원자별 누적 (상위 10명)</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {donorDashboard.topDonors.map((t) => (
                    <div key={t.name} className="flex items-center justify-between text-xs">
                      <span className="truncate max-w-[120px]" title={t.name}>{t.name}</span>
                      <span className="text-cyan-300 font-medium">{formatMan(t.amount)}</span>
                      <span className="text-neutral-500">({t.count}건)</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-[10px] text-neutral-500 mt-2">※ 일일 로그(리셋 시 저장) 기준. 다른 기기에서는 표시되지 않을 수 있습니다.</div>
            </div>
          )}

          {/* 방송별 후원 시점 그래프 */}
          {filteredRecords.length > 0 && (
            <div className="rounded-lg bg-neutral-800/50 p-4 border border-white/5">
              <h3 className="text-sm font-semibold mb-3">후원 시점 분석 (방송 중 어느 시점에 후원이 몰렸는지)</h3>
              <div className="flex flex-wrap gap-2 mb-3">
                {filteredRecords.slice(0, 12).map((r) => {
                  const donors = recordToDonors.get(r.id) || [];
                  const hasData = donors.length > 0;
                  return (
                    <button
                      key={r.id}
                      className={`px-2 py-1 rounded text-xs whitespace-nowrap ${selectedForGraph === r.id ? "bg-cyan-600 text-white" : hasData ? "bg-neutral-700 hover:bg-neutral-600" : "bg-neutral-800 text-neutral-500 cursor-not-allowed"}`}
                      onClick={() => hasData && setSelectedForGraph(selectedForGraph === r.id ? null : r.id)}
                      disabled={!hasData}
                      title={hasData ? `${r.title} (${donors.length}건)` : "후원 데이터 없음"}
                    >
                      {r.title.slice(0, 12)}{r.title.length > 12 ? "…" : ""} {hasData && `(${donors.length})`}
                    </button>
                  );
                })}
              </div>
              {timeGraphData && (
                <div className="space-y-2">
                  <div className="text-xs text-neutral-400">
                    선택: {filteredRecords.find((r) => r.id === selectedForGraph)?.title} · {timeGraphData.buckets.length}개 구간 (15분 단위)
                  </div>
                  <div className="flex items-end gap-1 h-32">
                    {timeGraphData.buckets.map((b) => (
                      <div
                        key={b.mins}
                        className="flex-1 min-w-[12px] flex flex-col items-center justify-end group"
                        title={`${b.mins}분~${b.mins + 15}분: ${formatMan(b.amount)} (${b.count}건)`}
                      >
                        <div
                          className="w-full max-w-8 rounded-t bg-cyan-500/80 group-hover:bg-cyan-400 transition-colors"
                          style={{ height: `${Math.max(4, (b.amount / timeGraphData.maxAmount) * 100)}%` }}
                        />
                        <span className="text-[9px] text-neutral-500 mt-0.5">{b.mins}m</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-neutral-500">가로축: 방송 시작 후 경과 시간(분). 세로축: 해당 구간 후원액.</div>
                </div>
              )}
              {!timeGraphData && selectedForGraph && (
                <div className="text-sm text-neutral-500 py-4">선택한 방송에 후원 데이터가 없습니다.</div>
              )}
              {!selectedForGraph && (
                <div className="text-sm text-neutral-500 py-4">위에서 방송을 선택하면 후원 시점 그래프가 표시됩니다.</div>
              )}
            </div>
          )}

          {dashboard.memberData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-lg bg-neutral-800/50 p-4 border border-white/5">
                <h3 className="text-sm font-semibold mb-3">멤버별 매출 비중 (도넛)</h3>
                <div className="flex items-center gap-4">
                  <div
                    className="w-32 h-32 rounded-full flex-shrink-0 border-4 border-neutral-800"
                    style={{
                      background: dashboard.memberPieData.length > 0
                        ? `conic-gradient(${dashboard.memberPieData.map((m, i) => {
                            const start = dashboard.memberPieData.slice(0, i).reduce((s, x) => s + x.pct, 0);
                            return `${m.color} ${start}% ${start + m.pct}%`;
                          }).join(", ")})`
                        : "var(--tw-bg-opacity, 1) rgb(38 38 38)",
                    }}
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    {dashboard.memberPieData.slice(0, 6).map((m) => (
                      <div key={m.name} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                        <span className="truncate" title={m.name}>{m.name}</span>
                        <span className="text-neutral-400 flex-shrink-0">{m.pct.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-neutral-800/50 p-4 border border-white/5">
                <h3 className="text-sm font-semibold mb-3">멤버별 정산 현황 (막대, 상위 15명)</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {dashboard.memberData.map((m) => (
                    <div key={m.name} className="flex items-center gap-2">
                      <span className="text-sm w-20 truncate" title={m.name}>{m.name}</span>
                      <div className="flex-1 h-5 rounded bg-neutral-700 overflow-hidden min-w-[40px]">
                        <div
                          className="h-full rounded bg-emerald-500/80 transition-all"
                          style={{ width: `${Math.max(2, (m.net / dashboard.maxNet) * 100)}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium w-16 text-right">{formatMan(m.net)}</span>
                      <span className="text-[10px] text-neutral-500">({m.count}회)</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {filteredRecords.length === 0 && (
            <div className="text-sm text-neutral-500 py-4 text-center">필터 조건에 맞는 정산 기록이 없어 대시보드를 표시할 수 없습니다.</div>
          )}
        </section>

        <div className="rounded border border-white/10 bg-neutral-900/50 overflow-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-neutral-400 border-b border-white/10">
                <th className="p-2 text-left">일시</th>
                <th className="p-2 text-left">제목</th>
                <th className="p-2 text-right">참여자</th>
                <th className="p-2 text-right">후원</th>
                <th className="p-2 text-right">최종 정산</th>
                <th className="p-2 text-right">열기</th>
                <th className="p-2 text-right">삭제</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((r) => {
                const donors = recordToDonors.get(r.id) || [];
                return (
                <tr key={r.id} className="border-b border-white/10">
                  <td className="p-2 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="p-2 whitespace-nowrap">{r.title}</td>
                  <td className="p-2 text-right">{r.members.length}</td>
                  <td className="p-2 text-right text-cyan-400" title={donors.length > 0 ? `${donors.length}건` : "데이터 없음"}>{donors.length}</td>
                  <td className="p-2 text-right font-semibold">{r.totalNet.toLocaleString()}</td>
                  <td className="p-2 text-right">
                    <Link className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 whitespace-nowrap inline-block" href={`/settlements/${r.id}`}>상세</Link>
                  </td>
                  <td className="p-2 text-right">
                    <button className="px-2 py-1 rounded bg-red-800 hover:bg-red-700 whitespace-nowrap" onClick={() => onDeleteRecord(r.id)}>삭제</button>
                  </td>
                </tr>
              );
              })}
              {filteredRecords.length === 0 && (
                <tr>
                  <td className="p-4 text-neutral-400" colSpan={7}>조건에 맞는 정산 기록이 없습니다.</td>
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

