"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  BATTLE_EFFECTS_VERIFY_CASES,
  getBattleEffectsVerifyPath,
  OVERLAY_UI_REVISION,
  type BattleEffectsVerifyCase,
} from "@/lib/battle-effects-verify";
import { getBattleEffectsDemoHubPath } from "@/lib/battle-effects-demo";
import {
  appendBattleEffectsHubPreviewParams,
  appendOverlayBuildBust,
  MEAL_MATCH_OVERLAY_UI_REV,
  SIG_MATCH_OVERLAY_UI_REV,
} from "@/lib/overlay-ui-revision";
import {
  buildSigMatchDemoOverlayPathFromScenario,
  SIG_MATCH_DEMO_SCENARIOS,
} from "@/lib/sig-match-demo";

const STORAGE_KEY = "battle-effects-verify-checks-v2";

function loadChecks(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveChecks(map: Record<string, boolean>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function checkKey(caseId: string, checkId: string) {
  return `${caseId}:${checkId}`;
}

function VerifyPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-neutral-950 px-3 py-4 text-white sm:px-5">{children}</main>
  );
}

export default function BattleEffectsVerifyClient() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [iframeKeys, setIframeKeys] = useState<Record<string, number>>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setChecked(loadChecks());
    setMounted(true);
  }, []);

  const toggle = useCallback((caseId: string, checkId: string) => {
    const k = checkKey(caseId, checkId);
    setChecked((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      saveChecks(next);
      return next;
    });
  }, []);

  const reloadCase = useCallback((caseId: string) => {
    setIframeKeys((prev) => ({ ...prev, [caseId]: (prev[caseId] ?? 0) + 1 }));
  }, []);

  const reloadAll = useCallback(() => {
    const next: Record<string, number> = {};
    for (const c of BATTLE_EFFECTS_VERIFY_CASES) {
      next[c.id] = (iframeKeys[c.id] ?? 0) + 1;
    }
    setIframeKeys(next);
    setChecked({});
    saveChecks({});
  }, [iframeKeys]);

  const stats = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const c of BATTLE_EFFECTS_VERIFY_CASES) {
      for (const ch of c.checks) {
        total += 1;
        if (checked[checkKey(c.id, ch.id)]) done += 1;
      }
    }
    return { total, done, allPass: total > 0 && done === total };
  }, [checked]);

  if (!mounted) {
    return (
      <VerifyPageShell>
        <div className="mx-auto max-w-6xl text-sm text-neutral-400">UI 반영 확인 페이지 로딩…</div>
      </VerifyPageShell>
    );
  }

  return (
    <VerifyPageShell>
      <header className="mx-auto mb-4 max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-emerald-100">대전 연출 · UI 반영 확인</h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-neutral-400">
              요청하신 레이아웃(식사: 점수 게이지 안 / 시그: 타이틀·세로 멤버·획득량)이 적용됐는지 체크합니다.
              시그 DEMO 뱃지에 <strong className="text-white">· {OVERLAY_UI_REVISION.sig}</strong> 가 보이면 새
              번들이 로드된 것입니다 (v2·v3이면 구 캐시 → dev:clean 후 새로고침).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={getBattleEffectsDemoHubPath()}
              className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
            >
              ← 통합 허브
            </Link>
            <button
              type="button"
              onClick={reloadAll}
              className="rounded bg-emerald-800 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700"
            >
              전체 새로고침 · 체크 초기화
            </button>
          </div>
        </div>

        <div
          className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
            stats.allPass
              ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-100"
              : "border-white/15 bg-black/30 text-neutral-300"
          }`}
        >
          <span className="font-semibold">
            진행: {stats.done} / {stats.total}
          </span>
          {stats.allPass ? (
            <span className="ml-2">— 모든 항목 통과. OBS·라이브에도 동일 URL로 한 번 더 확인하세요.</span>
          ) : (
            <span className="ml-2 text-neutral-500">— 각 항목을 눈으로 확인 후 체크하세요.</span>
          )}
        </div>

        <ol className="mt-3 list-decimal space-y-1 pl-5 text-[11px] text-neutral-500">
          <li>
            <code className="text-emerald-300">npm run dev</code> 실행 후 이 페이지를 연다
          </li>
          <li>안 보이면 <strong className="text-neutral-400">Ctrl+Shift+R</strong> 또는 「iframe 새로고침」</li>
          <li>
            안 바뀌면 <code className="text-amber-300">npm run dev:clean</code> 후 iframe 새로고침 · 시그는{" "}
            <code className="text-sky-300">data-overlay-ui=&quot;{OVERLAY_UI_REVISION.sig}&quot;</code>
          </li>
        </ol>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
        {BATTLE_EFFECTS_VERIFY_CASES.map((c) => (
          <VerifyCasePanel
            key={c.id}
            verifyCase={c}
            checked={checked}
            onToggle={toggle}
            iframeKey={iframeKeys[c.id] ?? 0}
            onReload={() => reloadCase(c.id)}
            mounted={mounted}
          />
        ))}
      </div>

      <footer className="mx-auto mt-8 max-w-6xl text-[10px] text-neutral-600">
        검증 페이지: {getBattleEffectsVerifyPath()} · UI rev 식사 {OVERLAY_UI_REVISION.meal} / 시그{" "}
        {OVERLAY_UI_REVISION.sig}
      </footer>
    </VerifyPageShell>
  );
}

function VerifyCasePanel({
  verifyCase,
  checked,
  onToggle,
  iframeKey,
  onReload,
  mounted,
}: {
  verifyCase: BattleEffectsVerifyCase;
  checked: Record<string, boolean>;
  onToggle: (caseId: string, checkId: string) => void;
  iframeKey: number;
  onReload: () => void;
  mounted: boolean;
}) {
  const isMeal = verifyCase.battle === "meal";
  const iframeSrc = useMemo(() => {
    if (!mounted) return "";
    let base = "";
    if (verifyCase.battle === "sig" && verifyCase.sigScenarioId) {
      const scenario = SIG_MATCH_DEMO_SCENARIOS.find((s) => s.id === verifyCase.sigScenarioId);
      if (!scenario) return "";
      base = appendBattleEffectsHubPreviewParams(
        buildSigMatchDemoOverlayPathFromScenario(scenario),
        "sig"
      );
    } else if (verifyCase.overlayPath) {
      base = verifyCase.overlayPath;
    }
    if (!base) return "";
    const rev = verifyCase.battle === "meal" ? MEAL_MATCH_OVERLAY_UI_REV : SIG_MATCH_OVERLAY_UI_REV;
    base = appendOverlayBuildBust(base, rev);
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}_verify=${iframeKey}&_t=${Date.now()}`;
  }, [mounted, verifyCase, iframeKey]);

  const fullUrl =
    mounted && iframeSrc && typeof window !== "undefined"
      ? `${window.location.origin}${iframeSrc}`
      : iframeSrc;

  const caseDone = verifyCase.checks.every((ch) => checked[checkKey(verifyCase.id, ch.id)]);

  return (
    <section
      className={`flex flex-col rounded-lg border p-3 ${
        isMeal ? "border-pink-500/30 bg-pink-950/10" : "border-amber-500/30 bg-amber-950/10"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
              isMeal ? "bg-pink-600 text-white" : "bg-amber-600 text-white"
            }`}
          >
            {isMeal ? "식사" : "시그"}
          </span>
          <h2 className={`mt-1 text-sm font-bold ${isMeal ? "text-pink-100" : "text-amber-100"}`}>
            {verifyCase.title}
          </h2>
          <p className="text-[10px] text-neutral-500">{verifyCase.description}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onReload}
            className="rounded border border-white/20 px-2 py-1 text-[10px] hover:bg-white/10"
          >
            iframe 새로고침
          </button>
          {fullUrl ? (
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded px-2 py-1 text-[10px] font-semibold ${
                isMeal ? "bg-pink-700 hover:bg-pink-600" : "bg-amber-700 hover:bg-amber-600"
              }`}
            >
              오버레이 새 탭 ↗
            </a>
          ) : null}
        </div>
      </div>

      {mounted && iframeSrc ? (
        <iframe
          key={iframeKey}
          title={`verify-${verifyCase.id}`}
          src={iframeSrc}
          className="mb-3 w-full rounded border border-white/10 bg-black"
          style={{
            height: verifyCase.battle === "sig" ? "min(92vh, 920px)" : "min(62vh, 580px)",
          }}
        />
      ) : (
        <div
          className="mb-3 flex items-center justify-center rounded border border-white/10 bg-black/50 text-xs text-neutral-500"
          style={{
            height: verifyCase.battle === "sig" ? "min(92vh, 920px)" : "min(62vh, 580px)",
          }}
        >
          미리보기 로딩…
        </div>
      )}

      <ul className="space-y-1.5">
        {verifyCase.checks.map((ch) => {
          const k = checkKey(verifyCase.id, ch.id);
          const isOn = Boolean(checked[k]);
          return (
            <li key={ch.id}>
              <label
                className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs transition ${
                  isOn ? "bg-emerald-900/35 text-emerald-100" : "bg-black/25 text-neutral-300 hover:bg-black/40"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={isOn}
                  onChange={() => onToggle(verifyCase.id, ch.id)}
                />
                <span>
                  {ch.label}
                  {ch.hint ? (
                    <span className="mt-0.5 block text-[10px] text-neutral-500">{ch.hint}</span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <p
        className={`mt-2 text-center text-[10px] font-semibold ${
          caseDone ? "text-emerald-400" : "text-neutral-600"
        }`}
      >
        {caseDone ? "✓ 이 시나리오 통과" : "체크리스트를 완료하세요"}
      </p>

      <code className="mt-2 block max-h-16 overflow-y-auto break-all text-[9px] text-neutral-600">
        {fullUrl || verifyCase.overlayPath || verifyCase.sigScenarioId || "—"}
      </code>
    </section>
  );
}
