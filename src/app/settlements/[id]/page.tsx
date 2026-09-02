"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { SettlementMemberResult, SettlementRecord, deleteSettlementRecordAndSync, getMembersForExport, getTreasuryMembersForExport, isTreasurySettlementMember, loadSettlementRecords, loadSettlementRecordsPreferApi, recordToCsv, recordToReadableTxt, recordToTxt, recoverSettlementRecordsFromAllSources, saveSettlementRecords, saveSettlementRecordsToApi, toPaymentAlignedSettlement, toSettlementFormulaLine, updateSettlementRecordAndRecompute, updateSettlementRecordDonors } from "@/lib/settlement";
import type { SettlementMemberRatioOverrides } from "@/types";
import { aggregateMemberDonors, donorsForSettlementExport, formatExportDateTime, recordToMemberDonorsCsv, recordToMemberDonorsXlsxBlob, resolveSettlementDonors, seedSettlementDonorsForEdit, type DailyLogEntry } from "@/lib/settlement-donor-export";
import { repairDonorTimestamps } from "@/lib/donation/repair-donor-timestamps";
import {
  memberToPaymentStatementPdfBlob,
  recordToFullSettlementPdfBlob,
  settlementGrossAmount,
} from "@/lib/settlement-payment-statement";
import { downloadTextFile, downloadBlobFile } from "@/lib/download";
import { showAppToast } from "@/lib/app-toast";
import Toast from "@/components/Toast";
import { loadDailyLog, loadDailyLogFromApi, loadState, loadStateFromApi, normalizeDonorsArray } from "@/lib/state";
import {
  defaultSettlementStatementText,
  deleteSettlementLogoFromApi,
  fetchSettlementLogoFromApi,
  fetchSettlementStatementTextFromApi,
  fileToSettlementLogoDataUrl,
  loadSettlementStatementText,
  resolveSettlementLogoDataUrl,
  resolveSettlementStatementText,
  saveSettlementLogoToApi,
  saveSettlementStatementTextToApi,
  type SettlementStatementText,
} from "@/lib/settlement-branding";
import type { Donor, DonorTarget } from "@/types";

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

/** 비율·멤버별 세금계산서가 재계산 결과에 실제로 반영됐는지 확인 */
function verifyRatioSettingsApplied(
  updated: SettlementRecord,
  expected: {
    accountRatio: number;
    toonRatio: number;
    feeRate: number;
    useMemberOverrides: boolean;
    overrides: SettlementMemberRatioOverrides;
  }
): boolean {
  if (Math.abs((updated.accountRatio || 0) - expected.accountRatio) > 1e-9) return false;
  if (Math.abs((updated.toonRatio || 0) - expected.toonRatio) > 1e-9) return false;
  if (Math.abs((updated.feeRate || 0) - expected.feeRate) > 1e-9) return false;
  if (!Number.isFinite(updated.totalNet)) return false;

  if (!expected.useMemberOverrides) {
    for (const m of updated.members || []) {
      if (typeof m.taxInvoiceIssued === "boolean") return false;
      if (Math.abs((m.accountRatio ?? expected.accountRatio) - expected.accountRatio) > 1e-9) return false;
      if (Math.abs((m.toonRatio ?? expected.toonRatio) - expected.toonRatio) > 1e-9) return false;
    }
    return true;
  }

  for (const m of updated.members || []) {
    const o = expected.overrides[m.memberId];
    if (!o) continue;
    if (
      typeof o.accountRatio === "number" &&
      Math.abs((m.accountRatio ?? 0) - o.accountRatio) > 1e-9
    ) {
      return false;
    }
    if (typeof o.toonRatio === "number" && Math.abs((m.toonRatio ?? 0) - o.toonRatio) > 1e-9) {
      return false;
    }
    if (typeof o.taxInvoiceIssued === "boolean" && m.taxInvoiceIssued !== o.taxInvoiceIssued) {
      return false;
    }
  }
  return true;
}

function memberRoleBadge(
  m: SettlementMemberResult,
  record: SettlementRecord
): { label: string; className: string } | null {
  const pos = record.memberPositionsAtSettlement;
  if (m.operating) return { label: "운영비", className: "text-sky-300 border-sky-500/40 bg-sky-950/30" };
  if (isTreasurySettlementMember(m, pos)) {
    return { label: "국고", className: "text-amber-300 border-amber-500/40 bg-amber-950/30" };
  }
  return null;
}

export default function SettlementDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const rawId = params?.id || "";
  const id = useMemo(() => {
    try {
      return decodeURIComponent(rawId);
    } catch {
      return rawId;
    }
  }, [rawId]);
  const [user, setUser] = useState<{ id: string; companyName?: string } | null>(null);
  const [records, setRecords] = useState<SettlementRecord[] | null>(null);
  const [detailMissing, setDetailMissing] = useState(false);
  const [detailRecovering, setDetailRecovering] = useState(false);
  const [dailyLog, setDailyLog] = useState<Record<string, DailyLogEntry[]>>({});
  const [referenceDonors, setReferenceDonors] = useState<Donor[]>([]);
  const [copiedMemberId, setCopiedMemberId] = useState<string | null>(null);
  const [copiedKakao, setCopiedKakao] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [fullPdfGenerating, setFullPdfGenerating] = useState(false);
  const [memberPdfId, setMemberPdfId] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [statementText, setStatementText] = useState<SettlementStatementText>(() =>
    defaultSettlementStatementText()
  );
  const [statementTextBusy, setStatementTextBusy] = useState(false);
  const [editingDonors, setEditingDonors] = useState<Donor[] | null>(null);
  const [donorEditBusy, setDonorEditBusy] = useState(false);
  const [donorEditMsg, setDonorEditMsg] = useState<string | null>(null);
  const [ratioBusy, setRatioBusy] = useState(false);
  const [accountRatioInput, setAccountRatioInput] = useState("");
  const [toonRatioInput, setToonRatioInput] = useState("");
  const [taxRateInput, setTaxRateInput] = useState("");
  const [useMemberRatioOverrides, setUseMemberRatioOverrides] = useState(false);
  const [memberRatioInputs, setMemberRatioInputs] = useState<
    Record<string, { account: string; toon: string; taxInvoice: boolean }>
  >({});
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const donorEditDirtyRef = useRef(false);
  /** 비율 UI 편집 중 — 폴링 setRecords 가 개별 비율 ON 토글을 다시 OFF로 덮지 않게 */
  const ratioUiDirtyRef = useRef(false);
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.user) {
          router.replace("/login");
          return;
        }
        const u = data.user as { id: string; companyName?: string };
        setUser(u);
        const companyName = u.companyName || "";
        const local = loadSettlementRecords(u.id);
        setRecords(local);
        loadSettlementRecordsPreferApi(u.id).then(setRecords);
        setDailyLog(loadDailyLog(u.id) as Record<string, DailyLogEntry[]>);
        loadDailyLogFromApi(u.id, { full: true }).then((serverLog) => {
          if (serverLog) setDailyLog(serverLog as Record<string, DailyLogEntry[]>);
        });
        setReferenceDonors(
          repairDonorTimestamps(normalizeDonorsArray(loadState(u.id)?.donors), {
            dailyLog: loadDailyLog(u.id) as Record<string, DailyLogEntry[]>,
          })
        );
        loadStateFromApi(u.id).then((remote) => {
          if (remote) {
            setReferenceDonors(
              repairDonorTimestamps(normalizeDonorsArray(remote.donors), {
                dailyLog: loadDailyLog(u.id) as Record<string, DailyLogEntry[]>,
              })
            );
          }
        });
        void fetchSettlementLogoFromApi(u.id).then((logo) => setLogoPreview(logo));
        setStatementText(loadSettlementStatementText(u.id, companyName));
        void fetchSettlementStatementTextFromApi(u.id, companyName).then(setStatementText);
      });
  }, [router]);

  useEffect(() => {
    if (!user) return;
    void loadStateFromApi(user.id).then((remote) => {
      if (!remote) return;
      setReferenceDonors(repairDonorTimestamps(normalizeDonorsArray(remote.donors), { dailyLog }));
    });
  }, [user, dailyLog]);

  // 디바이스 간 동기화 (후원 편집 중에는 덮어쓰지 않음)
  useEffect(() => {
    if (!user) return;
    const syncRecords = () => {
      if (donorEditDirtyRef.current) return;
      void loadSettlementRecordsPreferApi(user.id).then(setRecords);
    };
    const timer = window.setInterval(syncRecords, 3000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncRecords();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user]);

  const record = useMemo(() => (records || []).find((x) => x.id === id) || null, [records, id]);

  useEffect(() => {
    if (!user || records === null || record) {
      setDetailMissing(false);
      return;
    }
    setDetailMissing(true);
  }, [user, records, record]);

  useEffect(() => {
    if (!user || !detailMissing || record || detailRecovering) return;
    let cancelled = false;
    setDetailRecovering(true);
    void (async () => {
      const fresh = await loadSettlementRecordsPreferApi(user.id);
      if (cancelled) return;
      const found = fresh.find((r) => r.id === id);
      if (found) {
        setRecords(fresh);
        setDetailMissing(false);
        setDetailRecovering(false);
        return;
      }
      const hint = id.includes("깡깡") || decodeURIComponent(rawId).includes("깡깡") ? "깡깡대전" : "";
      if (hint) {
        const report = await recoverSettlementRecordsFromAllSources(user.id, { titleHint: hint });
        if (cancelled) return;
        setRecords(report.merged);
        if (report.merged.some((r) => r.id === id)) {
          setDetailMissing(false);
        }
      }
      setDetailRecovering(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, detailMissing, record, detailRecovering, id, rawId]);

  useEffect(() => {
    ratioUiDirtyRef.current = false;
  }, [record?.id]);

  useEffect(() => {
    if (!record) return;
    if (ratioUiDirtyRef.current) return;
    setAccountRatioInput(String(Math.round((record.accountRatio || 0.7) * 1000) / 10));
    setToonRatioInput(String(Math.round((record.toonRatio || 0.6) * 1000) / 10));
    setTaxRateInput(String(Math.round((record.feeRate || 0.033) * 1000) / 10));
    const inputs: Record<string, { account: string; toon: string; taxInvoice: boolean }> = {};
    let anyOverride = false;
    const defaultTax = Boolean(record.taxInvoiceIssued);
    for (const m of record.members || []) {
      const accDiff = Math.abs((m.accountRatio ?? record.accountRatio) - record.accountRatio) > 1e-9;
      const toonDiff = Math.abs((m.toonRatio ?? record.toonRatio) - record.toonRatio) > 1e-9;
      const taxOverride = typeof m.taxInvoiceIssued === "boolean";
      if (accDiff || toonDiff || taxOverride) anyOverride = true;
      inputs[m.memberId] = {
        account: accDiff ? String(Math.round((m.accountRatio || 0) * 1000) / 10) : "",
        toon: toonDiff ? String(Math.round((m.toonRatio || 0) * 1000) / 10) : "",
        taxInvoice: taxOverride ? Boolean(m.taxInvoiceIssued) : defaultTax,
      };
    }
    setUseMemberRatioOverrides(anyOverride);
    setMemberRatioInputs(inputs);
  }, [record]);

  const viewRecord = useMemo(() => (record ? toPaymentAlignedSettlement(record) : null), [record]);
  const exportMembers = useMemo(
    () => (viewRecord ? getMembersForExport(viewRecord) : []),
    [viewRecord]
  );
  const treasuryExcludedMembers = useMemo(
    () => (viewRecord ? getTreasuryMembersForExport(viewRecord) : []),
    [viewRecord]
  );
  const settlementDonors = useMemo(
    () => (record ? resolveSettlementDonors(record, dailyLog, referenceDonors) : []),
    [record, dailyLog, referenceDonors]
  );

  useEffect(() => {
    if (!record) {
      setEditingDonors(null);
      donorEditDirtyRef.current = false;
      return;
    }
    if (donorEditDirtyRef.current) return;
    setEditingDonors(seedSettlementDonorsForEdit(record, dailyLog, referenceDonors));
  }, [record, dailyLog, referenceDonors]);

  const editableDonors = editingDonors ?? settlementDonors;
  const memberDonorSummary = useMemo(
    () => (record ? aggregateMemberDonors(record, editableDonors) : []),
    [record, editableDonors]
  );
  const memberDonorSummaryByMember = useMemo(() => {
    const map = new Map<string, typeof memberDonorSummary>();
    for (const row of memberDonorSummary) {
      const list = map.get(row.memberId) || [];
      list.push(row);
      map.set(row.memberId, list);
    }
    return map;
  }, [memberDonorSummary]);

  const onDownloadMemberDonorsXlsx = async () => {
    if (!record || !user) return;
    const remote = await loadStateFromApi(user.id);
    const refs = normalizeDonorsArray(remote?.donors ?? loadState(user.id)?.donors);
    const exportDonors = donorsForSettlementExport(record, editableDonors, dailyLog, refs);
    const blob = recordToMemberDonorsXlsxBlob(record, exportDonors);
    await downloadBlobFile(`${record.title}-멤버별후원자.xlsx`, blob);
  };

  const onDownloadMemberDonorsCsv = async () => {
    if (!record || !user) return;
    const remote = await loadStateFromApi(user.id);
    const refs = normalizeDonorsArray(remote?.donors ?? loadState(user.id)?.donors);
    const exportDonors = donorsForSettlementExport(record, editableDonors, dailyLog, refs);
    await downloadTextFile(
      `${record.title}-멤버별후원자.csv`,
      recordToMemberDonorsCsv(record, exportDonors),
      "text/csv;charset=utf-8"
    );
  };

  const saveBankInfo = (memberId: string, patch: { bankName?: string; bankAccount?: string; accountHolder?: string }) => {
    if (!records || !user) return;
    const next = updateMemberBankInfo(records, id, memberId, patch);
    setRecords(next);
    saveSettlementRecords(next, user.id);
    saveSettlementRecordsToApi(next, user.id).catch(() => {});
  };

  const persistSettlementOptions = (
    patch: Pick<
      SettlementRecord,
      "omitTreasuryFromSettlement" | "includeTreasuryInFullStatement" | "taxInvoiceIssued" | "taxInvoiceVatRate"
    >
  ) => {
    if (!records || !user || !record) return;
    const next = updateSettlementRecordAndRecompute(records, id, patch);
    setRecords(next);
    saveSettlementRecords(next, user.id);
    void saveSettlementRecordsToApi(next, user.id);
  };

  const parseRatioPercent = (raw: string, fallback: number): number => {
    const n = Number(String(raw || "").replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.max(0, Math.min(100, n)) / 100;
  };

  const persistRatioSettings = async () => {
    if (!records || !user || !record) return;
    setRatioBusy(true);
    try {
      const accountRatio = parseRatioPercent(accountRatioInput, record.accountRatio);
      const toonRatio = parseRatioPercent(toonRatioInput, record.toonRatio);
      const feeRate = parseRatioPercent(taxRateInput, record.feeRate);
      let memberRatioOverrides: SettlementMemberRatioOverrides = {};
      if (useMemberRatioOverrides) {
        for (const m of record.members || []) {
          const input = memberRatioInputs[m.memberId];
          const account = input?.account.trim()
            ? parseRatioPercent(input.account, accountRatio)
            : undefined;
          const toon = input?.toon.trim() ? parseRatioPercent(input.toon, toonRatio) : undefined;
          const taxInvoice =
            typeof input?.taxInvoice === "boolean"
              ? input.taxInvoice
              : Boolean(record.taxInvoiceIssued);
          memberRatioOverrides[m.memberId] = {
            ...(account != null ? { accountRatio: account } : {}),
            ...(toon != null ? { toonRatio: toon } : {}),
            taxInvoiceIssued: taxInvoice,
          };
        }
      }
      const next = updateSettlementRecordAndRecompute(records, id, {
        accountRatio,
        toonRatio,
        feeRate,
        memberRatioOverrides,
      });
      const updated = next.find((r) => r.id === id);
      const applied = Boolean(
        updated &&
          verifyRatioSettingsApplied(updated, {
            accountRatio,
            toonRatio,
            feeRate,
            useMemberOverrides: useMemberRatioOverrides,
            overrides: memberRatioOverrides,
          })
      );
      setRecords(next);
      saveSettlementRecords(next, user.id);
      const serverOk = await saveSettlementRecordsToApi(next, user.id);
      ratioUiDirtyRef.current = false;

      if (!applied) {
        showAppToast("재계산 결과가 입력값과 일치하지 않습니다. 다시 적용해 주세요.", {
          variant: "error",
          durationMs: 4200,
        });
        return;
      }
      if (serverOk) {
        showAppToast("비율 적용 · 재계산 완료 · 서버에 저장됨", {
          variant: "success",
          durationMs: 3200,
        });
      } else {
        showAppToast("비율 재계산 완료 · 로컬만 저장됨(서버 동기화 실패)", {
          variant: "error",
          durationMs: 4500,
        });
      }
    } catch {
      showAppToast("비율 적용 · 재계산에 실패했습니다.", { variant: "error", durationMs: 4200 });
    } finally {
      setRatioBusy(false);
    }
  };

  const persistDonorAdjustments = (nextDonors: Donor[]) => {
    if (!records || !user || !record) return;
    setDonorEditBusy(true);
    donorEditDirtyRef.current = true;
    setEditingDonors(nextDonors);
    const next = updateSettlementRecordDonors(records, id, nextDonors);
    setRecords(next);
    saveSettlementRecords(next, user.id);
    void saveSettlementRecordsToApi(next, user.id)
      .then((ok) => {
        setDonorEditMsg(ok ? "후원 조정 저장됨 · 정산 금액 재계산" : "로컬만 저장됨(서버 동기화 실패)");
        window.setTimeout(() => setDonorEditMsg(null), 2500);
        if (ok) donorEditDirtyRef.current = false;
      })
      .finally(() => setDonorEditBusy(false));
  };

  const patchEditableDonor = (donorId: string, patch: Partial<Donor>) => {
    const base = editingDonors ?? seedSettlementDonorsForEdit(record!, dailyLog, referenceDonors);
    const next = base.map((d) => (d.id === donorId ? { ...d, ...patch } : d));
    setEditingDonors(next);
    donorEditDirtyRef.current = true;
  };

  const commitEditableDonor = (donorId: string, patch: Partial<Donor>) => {
    const base = editingDonors ?? seedSettlementDonorsForEdit(record!, dailyLog, referenceDonors);
    const next = base.map((d) => (d.id === donorId ? { ...d, ...patch } : d));
    persistDonorAdjustments(next);
  };

  const removeEditableDonor = (donorId: string) => {
    const base = editingDonors ?? seedSettlementDonorsForEdit(record!, dailyLog, referenceDonors);
    if (!window.confirm("이 후원 건을 정산에서 제거할까요? 멤버 정산액이 다시 계산됩니다.")) return;
    persistDonorAdjustments(base.filter((d) => d.id !== donorId));
  };

  const addEditableDonor = (preferTreasury: boolean) => {
    if (!record) return;
    const treasury = record.members.find((m) =>
      isTreasurySettlementMember(m, record.memberPositionsAtSettlement)
    );
    const fallback = record.members[0];
    const memberId = preferTreasury && treasury ? treasury.memberId : fallback?.memberId;
    if (!memberId) return;
    const base = editingDonors ?? seedSettlementDonorsForEdit(record, dailyLog, referenceDonors);
    const row: Donor = {
      id: `d_adj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: "무명",
      amount: 0,
      memberId,
      at: Date.now(),
      target: "account",
    };
    const next = [...base, row];
    persistDonorAdjustments(next);
  };

  const reapplyDonorEdits = () => {
    if (!record) return;
    const base = editingDonors ?? seedSettlementDonorsForEdit(record, dailyLog, referenceDonors);
    persistDonorAdjustments(base);
  };

  const copyKakaoTxt = async () => {
    if (!record) return;
    const txt = recordToReadableTxt(record);
    try {
      await navigator.clipboard.writeText(txt);
      setCopiedKakao(true);
      window.setTimeout(() => setCopiedKakao(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = txt;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedKakao(true);
      window.setTimeout(() => setCopiedKakao(false), 2000);
    }
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
    const res = await deleteSettlementRecordAndSync(record.id, "user-delete-from-detail", user?.id);
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

  const onDownloadFullSettlementPdf = async () => {
    if (!record || fullPdfGenerating) return;
    setFullPdfGenerating(true);
    try {
      const blob = await recordToFullSettlementPdfBlob(record);
      await downloadBlobFile(`${record.title}-전체정산서.pdf`, blob);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "전체 정산서 PDF 생성에 실패했습니다.";
      window.alert(msg);
    } finally {
      setFullPdfGenerating(false);
    }
  };

  const onDownloadMemberPaymentPdf = async (m: SettlementMemberResult) => {
    if (!record || memberPdfId) return;
    setMemberPdfId(m.memberId);
    try {
      const logoDataUrl = await resolveSettlementLogoDataUrl(user?.id);
      const copy = await resolveSettlementStatementText(user?.id, user?.companyName);
      const blob = await memberToPaymentStatementPdfBlob(record, m, {
        logoDataUrl,
        thankYouMessage: copy.thankYouMessage,
        issuerLine: copy.issuerLine,
      });
      const safeName = (m.realName || m.name || m.memberId).replace(/[\\/:*?"<>|]/g, "_");
      await downloadBlobFile(`${record.title}-지급정산서-${safeName}.pdf`, blob);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "지급 정산서 PDF 생성에 실패했습니다.";
      window.alert(msg);
    } finally {
      setMemberPdfId(null);
    }
  };

  const onUploadLogo = async (file: File | null) => {
    if (!file || !user) return;
    try {
      const dataUrl = await fileToSettlementLogoDataUrl(file);
      const ok = await saveSettlementLogoToApi(dataUrl, user.id);
      setLogoPreview(dataUrl);
      if (!ok) {
        window.alert("이 계정 로고를 기기에 저장했습니다. 서버 동기화는 실패했을 수 있습니다.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "로고 업로드에 실패했습니다.";
      window.alert(msg);
    } finally {
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const onResetLogo = async () => {
    if (!user) return;
    try {
      await deleteSettlementLogoFromApi(user.id);
      setLogoPreview(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "로고 삭제에 실패했습니다.";
      window.alert(msg);
    }
  };

  const onSaveStatementText = async () => {
    if (!user || statementTextBusy) return;
    setStatementTextBusy(true);
    try {
      const { ok, text } = await saveSettlementStatementTextToApi(
        statementText,
        user.id,
        user.companyName
      );
      setStatementText(text);
      if (!ok) {
        window.alert("문구를 이 기기에 저장했습니다. 서버 동기화는 실패했을 수 있습니다.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "문구 저장에 실패했습니다.";
      window.alert(msg);
    } finally {
      setStatementTextBusy(false);
    }
  };

  const onResetStatementText = async () => {
    if (!user || statementTextBusy) return;
    const defaults = defaultSettlementStatementText(user.companyName);
    setStatementText(defaults);
    setStatementTextBusy(true);
    try {
      const { ok, text } = await saveSettlementStatementTextToApi(
        defaults,
        user.id,
        user.companyName
      );
      setStatementText(text);
      if (!ok) {
        window.alert("기본 문구를 이 기기에 복구했습니다. 서버 동기화는 실패했을 수 있습니다.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "기본 문구 복구에 실패했습니다.";
      window.alert(msg);
    } finally {
      setStatementTextBusy(false);
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
        <div className="max-w-4xl mx-auto space-y-3">
          <div className="text-neutral-300">
            {detailRecovering ? "정산 기록을 찾는 중…" : "정산 기록을 찾을 수 없습니다."}
          </div>
          {!detailRecovering && id.includes("깡깡") && (
            <p className="text-sm text-neutral-400">
              「깡깡대전 2화」가 목록에 없으면 정산 목록에서 「엑셀 복구」 또는 「JSON 복구」로
              `recoveries/깡깡대전-2화-settlement-import.json` 파일을 불러와 주세요.
            </p>
          )}
          <Link className="underline text-neutral-300" href="/settlements">목록으로</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 md:p-8">
      <Toast />
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
              className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 whitespace-nowrap disabled:opacity-50"
              onClick={onDownloadMemberDonorsXlsx}
              disabled={settlementDonors.length === 0}
              title={settlementDonors.length === 0 ? "이 정산에 연결된 후원 스냅샷이 없습니다" : undefined}
            >
              멤버별 후원자(엑셀)
            </button>
            <button
              className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 whitespace-nowrap disabled:opacity-50"
              onClick={onDownloadMemberDonorsCsv}
              disabled={settlementDonors.length === 0}
            >
              멤버별 후원자(CSV)
            </button>
            <button
              className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 whitespace-nowrap"
              onClick={() => downloadTextFile(`${record.title}.txt`, recordToTxt(record), "text/plain;charset=utf-8")}
            >
              메모장(TXT)
            </button>
            <button
              className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 whitespace-nowrap"
              onClick={copyKakaoTxt}
            >
              {copiedKakao ? "카카오톡 복사됨" : "카카오톡 복사"}
            </button>
            <button className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-60 whitespace-nowrap" onClick={onDownloadPdf} disabled={pdfGenerating}>
              {pdfGenerating ? "PDF 생성 중..." : "화면 PDF"}
            </button>
            <button
              className="px-3 py-2 rounded bg-cyan-800 hover:bg-cyan-700 disabled:opacity-60 whitespace-nowrap"
              onClick={onDownloadFullSettlementPdf}
              disabled={fullPdfGenerating}
              title="엑셀「전체 정산서」양식"
            >
              {fullPdfGenerating ? "전체정산서 생성 중..." : "전체 정산서 PDF"}
            </button>
            <button className="px-3 py-2 rounded bg-red-800 hover:bg-red-700 whitespace-nowrap" onClick={onDeleteRecord}>
              삭제
            </button>
          </div>
        </div>

        <div className="rounded border border-white/10 bg-neutral-900/60 p-3 flex flex-wrap items-center gap-4">
          <div className="text-sm font-semibold whitespace-nowrap">이 계정 지급정산서 로고</div>
          <div className="w-16 h-16 rounded bg-black/40 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="정산서 로고" className="max-w-full max-h-full object-contain" />
            ) : (
              <span className="text-[10px] text-neutral-500">미설정</span>
            )}
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => void onUploadLogo(e.target.files?.[0] || null)}
          />
          <button
            type="button"
            className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 text-sm whitespace-nowrap"
            onClick={() => logoInputRef.current?.click()}
          >
            로고 업로드
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 text-sm whitespace-nowrap disabled:opacity-50"
            onClick={() => void onResetLogo()}
            disabled={!logoPreview}
          >
            로고 삭제
          </button>
          <div className="text-xs text-neutral-400">
            계정마다 다른 로고를 씁니다. 업로드한 로고만 이 계정 지급정산서 PDF에 들어갑니다.
          </div>
        </div>

        <div className="rounded border border-white/10 bg-neutral-900/60 p-3 space-y-3">
          <div className="text-sm font-semibold">지급정산서 하단 문구 (계정별)</div>
          <label className="block space-y-1">
            <span className="text-xs text-neutral-400">감사 문구</span>
            <input
              className="w-full px-3 py-2 rounded bg-black/30 border border-white/10 text-sm"
              value={statementText.thankYouMessage}
              maxLength={160}
              placeholder="파이팅 넘치는 스트리머의 노고에 감사드립니다"
              onChange={(e) =>
                setStatementText((prev) => ({ ...prev, thankYouMessage: e.target.value }))
              }
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-neutral-400">발행자 / 서명 줄</span>
            <input
              className="w-full px-3 py-2 rounded bg-black/30 border border-white/10 text-sm"
              value={statementText.issuerLine}
              maxLength={120}
              placeholder="BT STUDIO 대장 BT태호 이동환"
              onChange={(e) =>
                setStatementText((prev) => ({ ...prev, issuerLine: e.target.value }))
              }
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded bg-emerald-800 hover:bg-emerald-700 text-sm disabled:opacity-60"
              onClick={() => void onSaveStatementText()}
              disabled={statementTextBusy}
            >
              {statementTextBusy ? "저장 중..." : "문구 저장"}
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 text-sm disabled:opacity-60"
              onClick={() => void onResetStatementText()}
              disabled={statementTextBusy}
            >
              기본값으로
            </button>
            <div className="text-xs text-neutral-400">
              지급정산서 PDF 하단의 감사 문구·발행자 줄에 반영됩니다.
            </div>
          </div>
        </div>

        <div className="rounded border border-white/10 bg-neutral-900/60 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">정산 옵션</div>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded border border-white/10 bg-black/20 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(record.taxInvoiceIssued)}
                  onChange={(e) =>
                    persistSettlementOptions({ taxInvoiceIssued: e.target.checked })
                  }
                />
                세금계산서 발행
              </label>
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded border border-white/10 bg-black/20 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(record.omitTreasuryFromSettlement)}
                  onChange={(e) =>
                    persistSettlementOptions({ omitTreasuryFromSettlement: e.target.checked })
                  }
                />
                운영비
              </label>
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded border border-white/10 bg-black/20 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(record.includeTreasuryInFullStatement)}
                  onChange={(e) =>
                    persistSettlementOptions({ includeTreasuryInFullStatement: e.target.checked })
                  }
                />
                전체 정산서에 국고 50% 포함
              </label>
            </div>
          </div>
          <div className="text-xs text-neutral-400">
            · <span className="text-neutral-300">세금계산서 발행</span>: 원천세 차감 후 최종정산에 부가세 10%를 더해 입금액·PDF에 반영합니다.
            멤버별 지정은 아래 「멤버별 개별 비율」ON 후 체크하세요(공통 체크는 기본값).
            {" · "}
            <span className="text-neutral-300">운영비</span>: 국고 멤버 후원을 정산 합계에서 제외합니다.
            {" · "}
            <span className="text-neutral-300">전체 정산서 국고</span>: 전체 PDF에 국고 50% 행을 넣습니다.
          </div>
        </div>

        <div className="rounded border border-cyan-500/30 bg-neutral-900/60 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">비율 조정 (정산 후 수정)</div>
            <button
              type="button"
              className="px-3 py-1.5 rounded bg-cyan-800 hover:bg-cyan-700 text-sm disabled:opacity-60"
              disabled={ratioBusy}
              onClick={() => void persistRatioSettings()}
            >
              {ratioBusy ? "재계산 중…" : "비율 적용 · 재계산"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              className="w-[120px] px-3 py-2 rounded bg-black/30 border border-white/10 text-sm"
              placeholder="계좌 %"
              value={accountRatioInput}
              onChange={(e) => {
                ratioUiDirtyRef.current = true;
                setAccountRatioInput(e.target.value.replace(/[^\d.]/g, ""));
              }}
            />
            <input
              className="w-[120px] px-3 py-2 rounded bg-black/30 border border-white/10 text-sm"
              placeholder="투네 %"
              value={toonRatioInput}
              onChange={(e) => {
                ratioUiDirtyRef.current = true;
                setToonRatioInput(e.target.value.replace(/[^\d.]/g, ""));
              }}
            />
            <input
              className="w-[120px] px-3 py-2 rounded bg-black/30 border border-white/10 text-sm"
              placeholder="원천세 %"
              value={taxRateInput}
              onChange={(e) => {
                ratioUiDirtyRef.current = true;
                setTaxRateInput(e.target.value.replace(/[^\d.]/g, ""));
              }}
            />
            <button
              type="button"
              className={`px-2 py-1.5 rounded border text-xs ${useMemberRatioOverrides ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-400"}`}
              onClick={() => {
                ratioUiDirtyRef.current = true;
                setUseMemberRatioOverrides((v) => {
                  const next = !v;
                  if (next && record) {
                    const defaultTax = Boolean(record.taxInvoiceIssued);
                    setMemberRatioInputs((prev) => {
                      const merged = { ...prev };
                      for (const m of record.members || []) {
                        const cur = merged[m.memberId];
                        merged[m.memberId] = {
                          account: cur?.account || "",
                          toon: cur?.toon || "",
                          taxInvoice:
                            typeof cur?.taxInvoice === "boolean"
                              ? cur.taxInvoice
                              : typeof m.taxInvoiceIssued === "boolean"
                                ? m.taxInvoiceIssued
                                : defaultTax,
                        };
                      }
                      return merged;
                    });
                  }
                  return next;
                });
              }}
            >
              멤버별 개별 비율 {useMemberRatioOverrides ? "ON" : "OFF"}
            </button>
          </div>
          {useMemberRatioOverrides && (
            <div className="overflow-auto rounded border border-white/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-neutral-400 border-b border-white/10">
                    <th className="p-2 text-left">멤버</th>
                    <th className="p-2 text-left">계좌 %</th>
                    <th className="p-2 text-left">투네 %</th>
                    <th className="p-2 text-left">세금계산서</th>
                  </tr>
                </thead>
                <tbody>
                  {(record.members || []).map((m) => (
                    <tr key={m.memberId} className="border-b border-white/10">
                      <td className="p-2">{m.name}</td>
                      <td className="p-2">
                        <input
                          className="w-20 px-2 py-1 rounded bg-black/30 border border-white/10"
                          placeholder={accountRatioInput || "70"}
                          value={memberRatioInputs[m.memberId]?.account || ""}
                          onChange={(e) => {
                            ratioUiDirtyRef.current = true;
                            setMemberRatioInputs((prev) => ({
                              ...prev,
                              [m.memberId]: {
                                account: e.target.value.replace(/[^\d.]/g, ""),
                                toon: prev[m.memberId]?.toon || "",
                                taxInvoice:
                                  prev[m.memberId]?.taxInvoice ?? Boolean(record.taxInvoiceIssued),
                              },
                            }));
                          }}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          className="w-20 px-2 py-1 rounded bg-black/30 border border-white/10"
                          placeholder={toonRatioInput || "60"}
                          value={memberRatioInputs[m.memberId]?.toon || ""}
                          onChange={(e) => {
                            ratioUiDirtyRef.current = true;
                            setMemberRatioInputs((prev) => ({
                              ...prev,
                              [m.memberId]: {
                                account: prev[m.memberId]?.account || "",
                                toon: e.target.value.replace(/[^\d.]/g, ""),
                                taxInvoice:
                                  prev[m.memberId]?.taxInvoice ?? Boolean(record.taxInvoiceIssued),
                              },
                            }));
                          }}
                        />
                      </td>
                      <td className="p-2">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            className="rounded border-white/20"
                            checked={Boolean(
                              memberRatioInputs[m.memberId]?.taxInvoice ?? record.taxInvoiceIssued
                            )}
                            onChange={(e) => {
                              ratioUiDirtyRef.current = true;
                              setMemberRatioInputs((prev) => ({
                                ...prev,
                                [m.memberId]: {
                                  account: prev[m.memberId]?.account || "",
                                  toon: prev[m.memberId]?.toon || "",
                                  taxInvoice: e.target.checked,
                                },
                              }));
                            }}
                          />
                          <span
                            className={
                              memberRatioInputs[m.memberId]?.taxInvoice
                                ? "text-violet-300"
                                : "text-neutral-500"
                            }
                          >
                            {memberRatioInputs[m.memberId]?.taxInvoice ? "발행" : "미발행"}
                          </span>
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-xs text-neutral-400">
            후원 스냅샷은 유지하고 배분·원천세만 다시 계산합니다. 멤버별 세금계산서는 「멤버별 개별 비율」ON 후 체크하고 「비율 적용 · 재계산」으로 저장하세요.
          </div>
        </div>

        <div className="rounded border border-white/10 bg-neutral-900/60 p-3 overflow-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="text-sm font-semibold">멤버별 최종 매출</div>
            <div className="text-xs text-neutral-400">후원 유입(계좌·투네) + 배분 반영 · 세후 입금액(net)</div>
          </div>
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-neutral-400 border-b border-white/10">
                <th className="p-2 text-left">멤버</th>
                <th className="p-2 text-right">계좌 후원</th>
                <th className="p-2 text-right">투네 후원</th>
                <th className="p-2 text-right">계좌 반영</th>
                <th className="p-2 text-right">투네 반영</th>
                <th className="p-2 text-right">세금</th>
                <th className="p-2 text-right">최종 정산</th>
              </tr>
            </thead>
            <tbody>
              {exportMembers.map((m) => {
                const badge = memberRoleBadge(m, record);
                const accountInflow = settlementGrossAmount(m, "account");
                const toonInflow = settlementGrossAmount(m, "toon");
                return (
                  <tr key={`sum-${m.memberId}`} className="border-b border-white/10">
                    <td className="p-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{m.name}</span>
                        {m.realName ? <span className="text-neutral-500 truncate">({m.realName})</span> : null}
                        {badge ? (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${badge.className}`}>
                            {badge.label}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-2 text-right tabular-nums text-sky-300">{accountInflow.toLocaleString()}</td>
                    <td className="p-2 text-right tabular-nums text-violet-300">{toonInflow.toLocaleString()}</td>
                    <td className="p-2 text-right tabular-nums">{m.accountApplied.toLocaleString()}</td>
                    <td className="p-2 text-right tabular-nums">{m.toonApplied.toLocaleString()}</td>
                    <td className="p-2 text-right tabular-nums text-rose-300">{m.fee.toLocaleString()}</td>
                    <td className="p-2 text-right tabular-nums font-extrabold text-emerald-300">
                      {m.net.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold border-t border-white/10">
                <td className="p-2">지급 합계</td>
                <td className="p-2 text-right tabular-nums text-sky-300">
                  {exportMembers.reduce((s, m) => s + settlementGrossAmount(m, "account"), 0).toLocaleString()}
                </td>
                <td className="p-2 text-right tabular-nums text-violet-300">
                  {exportMembers.reduce((s, m) => s + settlementGrossAmount(m, "toon"), 0).toLocaleString()}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {exportMembers.reduce((s, m) => s + m.accountApplied, 0).toLocaleString()}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {exportMembers.reduce((s, m) => s + m.toonApplied, 0).toLocaleString()}
                </td>
                <td className="p-2 text-right tabular-nums text-rose-300">
                  {viewRecord!.totalFee.toLocaleString()}
                </td>
                <td className="p-2 text-right tabular-nums text-emerald-300 text-base">
                  {viewRecord!.totalNet.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
          {treasuryExcludedMembers.length > 0 && (
            <div className="mt-3 pt-3 border-t border-amber-500/20">
              <div className="text-xs font-medium text-amber-300 mb-2">운영비 (정산 제외 · 참고)</div>
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-neutral-500 border-b border-white/5 text-xs">
                    <th className="p-2 text-left">멤버</th>
                    <th className="p-2 text-right">계좌 후원</th>
                    <th className="p-2 text-right">투네 후원</th>
                    <th className="p-2 text-right">계좌 반영</th>
                    <th className="p-2 text-right">투네 반영</th>
                    <th className="p-2 text-right">세금</th>
                    <th className="p-2 text-right">최종</th>
                  </tr>
                </thead>
                <tbody>
                  {treasuryExcludedMembers.map((m) => (
                    <tr key={`treasury-${m.memberId}`} className="border-b border-white/5 text-neutral-400">
                      <td className="p-2">{m.name}</td>
                      <td className="p-2 text-right tabular-nums">{settlementGrossAmount(m, "account").toLocaleString()}</td>
                      <td className="p-2 text-right tabular-nums">{settlementGrossAmount(m, "toon").toLocaleString()}</td>
                      <td className="p-2 text-right tabular-nums">{m.accountApplied.toLocaleString()}</td>
                      <td className="p-2 text-right tabular-nums">{m.toonApplied.toLocaleString()}</td>
                      <td className="p-2 text-right tabular-nums">{m.fee.toLocaleString()}</td>
                      <td className="p-2 text-right tabular-nums">{m.net.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="text-sm text-neutral-300 whitespace-nowrap overflow-x-auto">
          계좌 비율 {(viewRecord!.accountRatio * 100).toFixed(1)}% · 투네 비율 {(viewRecord!.toonRatio * 100).toFixed(1)}% · 세금 {(viewRecord!.feeRate * 100).toFixed(1)}%
          {viewRecord!.vatIncluded ? ` · 부가세 포함(공급가 ÷${(1 + (viewRecord!.vatRate ?? 0.1)).toFixed(1)})` : ""}
          {(() => {
            const members = viewRecord!.members || [];
            const issued = members.filter((m) =>
              typeof m.taxInvoiceIssued === "boolean" ? m.taxInvoiceIssued : Boolean(viewRecord!.taxInvoiceIssued)
            ).length;
            if (issued === 0) return " · 세금계산서 미발행(원천세만)";
            if (issued === members.length) return " · 세금계산서 발행(최종+부가세10%)";
            return ` · 세금계산서 멤버별(${issued}/${members.length}명 발행)`;
          })()}
          <span className="text-neutral-500"> · 금액은 지급정산서(수수료·부가세 공제 후) 기준</span>
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
                <th className="p-2 text-center">지급정산서</th>
                <th className="p-2 text-right">계좌 반영</th>
                <th className="p-2 text-right">투네 반영</th>
                <th className="p-2 text-right">중간합</th>
                <th className="p-2 text-right">세금</th>
                <th className="p-2 text-right">최종 정산</th>
                <th className="p-2 text-left">계산식</th>
              </tr>
            </thead>
            <tbody>
              {exportMembers.map((m) => {
                const badge = memberRoleBadge(m, record);
                return (
                <tr key={m.memberId} className="border-b border-white/10">
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <span>{m.name}</span>
                      {badge ? (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.className}`}>
                          {badge.label}
                        </span>
                      ) : null}
                    </div>
                  </td>
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
                  <td className="p-2 text-center">
                    <button
                      type="button"
                      className="px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700 border border-emerald-500/30 text-xs disabled:opacity-50"
                      disabled={memberPdfId !== null}
                      title="이 멤버 지급 정산서 PDF"
                      onClick={() => void onDownloadMemberPaymentPdf(m)}
                    >
                      {memberPdfId === m.memberId ? "생성 중…" : "PDF"}
                    </button>
                  </td>
                  <td className="p-2 text-right">{m.accountApplied.toLocaleString()}</td>
                  <td className="p-2 text-right">{m.toonApplied.toLocaleString()}</td>
                  <td className="p-2 text-right">{m.gross.toLocaleString()}</td>
                  <td className="p-2 text-right">{m.fee.toLocaleString()}</td>
                  <td className="p-2 text-right font-semibold">{m.net.toLocaleString()}</td>
                  <td className="p-2 text-xs text-neutral-300 whitespace-nowrap">{toSettlementFormulaLine(viewRecord!, m)}</td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="p-2" colSpan={9}>합계</td>
                <td className="p-2 text-right">{viewRecord!.totalGross.toLocaleString()}</td>
                <td className="p-2 text-right">{viewRecord!.totalFee.toLocaleString()}</td>
                <td className="p-2 text-right">{viewRecord!.totalNet.toLocaleString()}</td>
                <td className="p-2" />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="rounded border border-white/10 bg-neutral-900/50 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">멤버별 후원자 내역 · 조정</div>
              <div className="text-xs text-neutral-400 mt-1">
                정산 생성 후에도 후원 목록을 수정할 수 있습니다. 국고 포함 멤버 배정·금액·채널을 바꾸면 정산액이 다시 계산됩니다.
                {" · "}
                {editableDonors.length}건
                {donorEditMsg ? <span className="text-emerald-400 ml-2">{donorEditMsg}</span> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded bg-amber-800 hover:bg-amber-700 text-sm disabled:opacity-50"
                onClick={() => addEditableDonor(true)}
                disabled={
                  !record ||
                  donorEditBusy ||
                  !record.members.some((m) => isTreasurySettlementMember(m, record.memberPositionsAtSettlement))
                }
                title="국고 멤버에 후원 행 추가"
              >
                국고 후원 추가
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-sm disabled:opacity-50"
                onClick={() => addEditableDonor(false)}
                disabled={!record || donorEditBusy}
              >
                후원 행 추가
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded bg-cyan-800 hover:bg-cyan-700 text-sm disabled:opacity-50"
                onClick={reapplyDonorEdits}
                disabled={!record || donorEditBusy || editableDonors.length === 0}
              >
                {donorEditBusy ? "저장 중…" : "재계산·저장"}
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded bg-emerald-800 hover:bg-emerald-700 text-sm disabled:opacity-50"
                onClick={onDownloadMemberDonorsXlsx}
                disabled={editableDonors.length === 0}
              >
                엑셀 다운로드
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-sm disabled:opacity-50"
                onClick={onDownloadMemberDonorsCsv}
                disabled={editableDonors.length === 0}
              >
                CSV 다운로드
              </button>
            </div>
          </div>

          {!record || editableDonors.length === 0 ? (
            <p className="text-sm text-neutral-400">
              후원 목록이 없습니다. 「국고 후원 추가」또는 「후원 행 추가」로 정산 후원을 넣을 수 있습니다.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="overflow-auto rounded border border-amber-500/30 bg-black/30">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="text-neutral-400 border-b border-white/10">
                      <th className="p-2 text-left">후원시각</th>
                      <th className="p-2 text-left">후원자</th>
                      <th className="p-2 text-right">금액</th>
                      <th className="p-2 text-left">채널</th>
                      <th className="p-2 text-left">멤버(국고 포함)</th>
                      <th className="p-2 text-center">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donorsForSettlementExport(record, editableDonors, dailyLog, referenceDonors)
                      .sort((a, b) => {
                        const aT = record.members.find((m) => m.memberId === a.memberId);
                        const bT = record.members.find((m) => m.memberId === b.memberId);
                        const aTreasury = aT
                          ? isTreasurySettlementMember(aT, record.memberPositionsAtSettlement)
                          : false;
                        const bTreasury = bT
                          ? isTreasurySettlementMember(bT, record.memberPositionsAtSettlement)
                          : false;
                        if (aTreasury !== bTreasury) return aTreasury ? -1 : 1;
                        return Number(b.at || 0) - Number(a.at || 0);
                      })
                      .map((d) => {
                        const member = record.members.find((m) => m.memberId === d.memberId);
                        const treasury = member
                          ? isTreasurySettlementMember(member, record.memberPositionsAtSettlement)
                          : false;
                        return (
                          <tr
                            key={d.id}
                            className={`border-b border-white/5 ${treasury ? "bg-amber-950/40" : ""}`}
                          >
                            <td className="p-2 text-neutral-400 tabular-nums whitespace-nowrap">
                              {formatExportDateTime(d.at)}
                            </td>
                            <td className="p-2">
                              <input
                                className="w-full min-w-[7rem] px-2 py-1 rounded bg-neutral-800 border border-white/10"
                                value={d.name}
                                disabled={donorEditBusy}
                                onChange={(e) =>
                                  patchEditableDonor(d.id, {
                                    name: e.target.value,
                                  })
                                }
                                onBlur={() =>
                                  commitEditableDonor(d.id, {
                                    name: String(
                                      (editingDonors ?? []).find((x) => x.id === d.id)?.name ?? d.name
                                    )
                                      .replace(/\s+/g, "") || "무명",
                                  })
                                }
                              />
                            </td>
                            <td className="p-2 text-right">
                              <input
                                type="number"
                                min={0}
                                step={1000}
                                className="w-28 px-2 py-1 rounded bg-neutral-800 border border-white/10 text-right tabular-nums"
                                value={d.amount}
                                disabled={donorEditBusy}
                                onChange={(e) =>
                                  patchEditableDonor(d.id, {
                                    amount: Math.max(0, Math.round(Number(e.target.value) || 0)),
                                  })
                                }
                                onBlur={() =>
                                  commitEditableDonor(d.id, {
                                    amount: Math.max(0, Math.round(Number(d.amount) || 0)),
                                  })
                                }
                              />
                            </td>
                            <td className="p-2">
                              <select
                                className="px-2 py-1 rounded bg-neutral-800 border border-white/10"
                                value={d.target === "toon" ? "toon" : "account"}
                                disabled={donorEditBusy}
                                onChange={(e) =>
                                  commitEditableDonor(d.id, {
                                    target: e.target.value as DonorTarget,
                                  })
                                }
                              >
                                <option value="account">계좌</option>
                                <option value="toon">투네</option>
                              </select>
                            </td>
                            <td className="p-2">
                              <select
                                className={`min-w-[8rem] px-2 py-1 rounded bg-neutral-800 border ${
                                  treasury ? "border-amber-500/50 text-amber-100" : "border-white/10"
                                }`}
                                value={d.memberId}
                                disabled={donorEditBusy}
                                onChange={(e) =>
                                  commitEditableDonor(d.id, { memberId: e.target.value })
                                }
                              >
                                {record.members.map((m) => (
                                  <option key={m.memberId} value={m.memberId}>
                                    {m.name}
                                    {isTreasurySettlementMember(m, record.memberPositionsAtSettlement) ? " (국고)" : ""}
                                    {m.realName ? ` · ${m.realName}` : ""}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2 text-center">
                              <button
                                type="button"
                                className="px-2 py-1 rounded bg-red-950 hover:bg-red-900 border border-red-500/30 text-xs disabled:opacity-50"
                                disabled={donorEditBusy}
                                onClick={() => removeEditableDonor(d.id)}
                              >
                                삭제
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              {getMembersForExport(record).map((m) => {
                const rows = memberDonorSummaryByMember.get(m.memberId) || [];
                if (rows.length === 0) return null;
                const memberTotal = rows.reduce((s, r) => s + r.totalAmount, 0);
                const treasury = isTreasurySettlementMember(m, record.memberPositionsAtSettlement);
                return (
                  <details
                    key={`donors-${m.memberId}`}
                    className={`rounded border bg-black/20 ${
                      treasury ? "border-amber-500/40" : "border-white/10"
                    }`}
                    open={treasury}
                  >
                    <summary className="cursor-pointer select-none px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-medium text-neutral-100">{m.name}</span>
                        {treasury ? (
                          <span className="ml-2 text-xs text-amber-300">국고</span>
                        ) : null}
                        {m.realName ? <span className="text-neutral-500"> ({m.realName})</span> : null}
                        <span className="text-neutral-400 ml-2">후원자 {rows.length}명</span>
                      </span>
                      <span className="font-semibold text-cyan-300 tabular-nums">
                        {memberTotal.toLocaleString()}원
                      </span>
                    </summary>
                    <div className="overflow-auto border-t border-white/10">
                      <table className="w-full text-sm whitespace-nowrap">
                        <thead>
                          <tr className="text-neutral-400 border-b border-white/10">
                            <th className="p-2 text-left">후원자</th>
                            <th className="p-2 text-right">합계</th>
                            <th className="p-2 text-right">횟수</th>
                            <th className="p-2 text-right">계좌</th>
                            <th className="p-2 text-right">투네</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr key={`${row.memberId}-${row.donorName}`} className="border-b border-white/5">
                              <td className="p-2">{row.donorName}</td>
                              <td className="p-2 text-right font-medium tabular-nums">
                                {row.totalAmount.toLocaleString()}
                              </td>
                              <td className="p-2 text-right tabular-nums">{row.count}</td>
                              <td className="p-2 text-right tabular-nums text-neutral-300">
                                {row.accountAmount.toLocaleString()}
                              </td>
                              <td className="p-2 text-right tabular-nums text-neutral-300">
                                {row.toonAmount.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
