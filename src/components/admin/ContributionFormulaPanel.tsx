"use client";

import { useEffect, useMemo, useState } from "react";
import type { ContributionFormula } from "@/types";
import {
  contributionFormulaFromPreset,
  contributionFormulaPresetId,
  describeContributionFormula,
  normalizeContributionFormula,
  type ContributionFormulaPresetId,
} from "@/lib/contribution-formula";

type Props = {
  value: ContributionFormula | null | undefined;
  onSave: (next: ContributionFormula) => void;
};

export default function ContributionFormulaPanel({ value, onSave }: Props) {
  const saved = useMemo(() => normalizeContributionFormula(value), [value]);
  const [draft, setDraft] = useState<ContributionFormula>(saved);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const preset = contributionFormulaPresetId(draft);
  const dirty =
    draft.accountWeightPct !== saved.accountWeightPct ||
    draft.toonWeightPct !== saved.toonWeightPct;

  const applyPreset = (id: ContributionFormulaPresetId) => {
    if (id === "custom") {
      setDraft((prev) => ({ ...prev }));
      return;
    }
    setDraft(contributionFormulaFromPreset(id));
  };

  const handleSave = () => {
    const next = normalizeContributionFormula(draft);
    onSave(next);
    setDraft(next);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
  };

  return (
    <div className="rounded border border-cyan-500/40 bg-cyan-950/30 px-3 py-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-cyan-100">가중치 설정</div>
        <div className="text-[11px] text-cyan-200/80">{describeContributionFormula(saved)}</div>
      </div>
      <p className="text-[11px] text-neutral-300 leading-relaxed">
        저장 후 들어오는 후원부터 적용됩니다. 기존 기여도는 유지됩니다. 계좌·투네 금액은 변하지 않습니다.
        toona 허브 연동 시 도네 얼럿의 기여도 점수도 같은 계산식을 따릅니다.
      </p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["both", "계좌+투네"],
            ["account", "계좌만"],
            ["toon", "투네만"],
            ["custom", "커스텀"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`px-2.5 py-1 rounded text-xs border ${
              preset === id
                ? "border-cyan-400 bg-cyan-700/60 text-white"
                : "border-white/10 bg-neutral-900/70 text-neutral-300 hover:bg-neutral-800"
            }`}
            onClick={() => applyPreset(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 max-w-md">
        <label className="text-[11px] text-neutral-400 space-y-1">
          <span>계좌 가중치 (%)</span>
          <input
            className="w-full px-2 py-1.5 rounded bg-neutral-900/80 border border-white/10 text-sm"
            type="number"
            min={0}
            max={200}
            step={1}
            value={draft.accountWeightPct}
            onChange={(e) =>
              setDraft((prev) =>
                normalizeContributionFormula({
                  ...prev,
                  accountWeightPct: e.target.value,
                })
              )
            }
          />
        </label>
        <label className="text-[11px] text-neutral-400 space-y-1">
          <span>투네 가중치 (%)</span>
          <input
            className="w-full px-2 py-1.5 rounded bg-neutral-900/80 border border-white/10 text-sm"
            type="number"
            min={0}
            max={200}
            step={1}
            value={draft.toonWeightPct}
            onChange={(e) =>
              setDraft((prev) =>
                normalizeContributionFormula({
                  ...prev,
                  toonWeightPct: e.target.value,
                })
              )
            }
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!dirty}
          className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:hover:bg-cyan-600 text-xs font-semibold"
          onClick={handleSave}
        >
          계산식 저장
        </button>
        {savedFlash ? (
          <span className="text-[11px] text-emerald-300">저장됨 · 이후 후원부터 적용</span>
        ) : dirty ? (
          <span className="text-[11px] text-amber-300">미저장 변경 있음</span>
        ) : null}
      </div>
    </div>
  );
}
