"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ObsTextOverlayView } from "@/components/obs-text/ObsTextOverlayView";
import {
  OBS_TEXT_EMOJI_PRESETS,
  OBS_TEXT_OVERLAY_STATE_KEY,
  buildObsTextOverlayUrl,
  createObsTextInstance,
  defaultObsTextRegistry,
  getObsTextInstance,
  mergeSegmentsFromPlainText,
  readObsTextRegistryFromState,
  resolveObsTextInstanceId,
  segmentsToPlainText,
  splitTextToCharSegments,
  type ObsTextBlock,
  type ObsTextEffectId,
  type ObsTextOverlayConfig,
  type ObsTextOverlayPosition,
  type ObsTextOverlayRegistry,
  type ObsTextSegment,
} from "@/lib/obs-text-overlay";
import { OBS_TEXT_EFFECT_OPTIONS } from "@/lib/obs-text-effects";
import {
  defaultState,
  loadState,
  loadStateFromApi,
  saveStateAsync,
  type AppState,
} from "@/lib/state";
import { STATE_PICK_OBS_TEXT } from "@/lib/state-api-pick";
import { useSSEConnection } from "@/lib/sse-client";
import { createStateUpdatedScheduler } from "@/lib/overlay-pull-policy";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

type EditMode = "segment" | "char";

function newBlockId(): string {
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function syncDraftFromConfig(
  cfg: ObsTextOverlayConfig,
  setActiveBlockId: (id: string) => void,
  setPlainDraft: (t: string) => void,
  setEditMode: (m: EditMode) => void
) {
  const first = cfg.blocks[0];
  if (first) {
    setActiveBlockId(first.id);
    setPlainDraft(segmentsToPlainText(first.segments));
    if (first.segments.length > 1 && first.segments.every((s) => Array.from(s.text).length <= 1)) {
      setEditMode("char");
    } else {
      setEditMode("segment");
    }
  }
}

export default function ObsTextOverlayEditor({
  userId,
  initialInstanceId,
  createOnMount = false,
}: {
  userId: string;
  initialInstanceId?: string | null;
  createOnMount?: boolean;
}) {
  const [registry, setRegistry] = useState<ObsTextOverlayRegistry>(defaultObsTextRegistry);
  const [activeInstanceId, setActiveInstanceId] = useState(
    () => resolveObsTextInstanceId(defaultObsTextRegistry(), initialInstanceId)
  );
  const [activeBlockId, setActiveBlockId] = useState<string>("block-1");
  const [editMode, setEditMode] = useState<EditMode>("segment");
  const [plainDraft, setPlainDraft] = useState("방송 텍스트");
  const [pickColor, setPickColor] = useState("#ffffff");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const loadedRef = useRef(false);
  const createOnMountDoneRef = useRef(false);
  const pendingRegistrySaveRef = useRef(false);
  const lastPersistedUpdatedAtRef = useRef(0);
  const skipAutosaveUntilRef = useRef(0);
  const activeInstanceIdRef = useRef(activeInstanceId);
  activeInstanceIdRef.current = activeInstanceId;

  const config = useMemo(
    () => getObsTextInstance(registry, activeInstanceId).config,
    [registry, activeInstanceId]
  );

  const activeInstance = useMemo(
    () => getObsTextInstance(registry, activeInstanceId),
    [registry, activeInstanceId]
  );

  const setConfig = useCallback(
    (updater: ObsTextOverlayConfig | ((prev: ObsTextOverlayConfig) => ObsTextOverlayConfig)) => {
      setRegistry((prev) => ({
        ...prev,
        instances: prev.instances.map((inst) => {
          if (inst.id !== activeInstanceId) return inst;
          const next =
            typeof updater === "function"
              ? (updater as (p: ObsTextOverlayConfig) => ObsTextOverlayConfig)(inst.config)
              : updater;
          return { ...inst, config: next };
        }),
      }));
    },
    [activeInstanceId]
  );

  const activeBlock = useMemo(
    () => config.blocks.find((b) => b.id === activeBlockId) ?? config.blocks[0],
    [config.blocks, activeBlockId]
  );

  const overlayUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return `/overlay/obs-text?u=${userId}&host=obs&textId=${activeInstanceId}`;
    }
    return buildObsTextOverlayUrl(window.location.origin, userId, activeInstanceId);
  }, [userId, activeInstanceId]);

  const selectInstance = useCallback(
    (id: string, reg?: ObsTextOverlayRegistry) => {
      const source = reg ?? registry;
      setActiveInstanceId(id);
      const cfg = getObsTextInstance(source, id).config;
      syncDraftFromConfig(cfg, setActiveBlockId, setPlainDraft, setEditMode);
      if (typeof window !== "undefined") {
        const u = new URL(window.location.href);
        u.searchParams.set("u", userId);
        u.searchParams.set("textId", id);
        u.searchParams.delete("new");
        window.history.replaceState({}, "", `${u.pathname}${u.search}`);
      }
    },
    [registry, userId]
  );

  const stampRegistryForSave = useCallback(
    (
      reg: ObsTextOverlayRegistry,
      activeId: string,
      activeConfig?: ObsTextOverlayConfig
    ): ObsTextOverlayRegistry => ({
      version: 2,
      instances: reg.instances.map((inst) => ({
        ...inst,
        config:
          inst.id === activeId
            ? { ...(activeConfig ?? inst.config), revision: Date.now() }
            : inst.config,
      })),
    }),
    []
  );

  const persistRegistry = useCallback(
    async (
      reg: ObsTextOverlayRegistry,
      activeId: string,
      opts?: { activeConfig?: ObsTextOverlayConfig; statusMsg?: string; quiet?: boolean }
    ): Promise<boolean> => {
      if (!opts?.quiet) {
        setSaving(true);
        setStatus("");
      }
      pendingRegistrySaveRef.current = true;
      try {
        const remote = (await loadStateFromApi(userId)) || loadState(userId) || defaultState();
        const stamped = stampRegistryForSave(reg, activeId, opts?.activeConfig);
        const os =
          remote.overlaySettings && typeof remote.overlaySettings === "object"
            ? { ...(remote.overlaySettings as Record<string, unknown>) }
            : {};
        os[OBS_TEXT_OVERLAY_STATE_KEY] = stamped;
        const now = Date.now();
        const result = await saveStateAsync({
          ...remote,
          overlaySettings: os,
          updatedAt: now,
        });
        if (!result.ok) {
          setStatus("저장 실패 — 네트워크 또는 로그인 상태를 확인하세요");
          return false;
        }
        lastPersistedUpdatedAtRef.current = now;
        setRegistry(stamped);
        if (opts?.statusMsg) setStatus(opts.statusMsg);
        else if (!opts?.quiet) setStatus("저장됨 · OBS에 자동 반영");
        return true;
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "저장 오류");
        return false;
      } finally {
        pendingRegistrySaveRef.current = false;
        if (!opts?.quiet) setSaving(false);
      }
    },
    [userId, stampRegistryForSave]
  );

  const applyRemote = useCallback(
    (state: AppState | null) => {
      if (!state) return;
      if (pendingRegistrySaveRef.current) return;
      const remoteTs = state.updatedAt || 0;
      if (remoteTs > 0 && remoteTs < lastPersistedUpdatedAtRef.current) return;

      const reg = readObsTextRegistryFromState(state);

      if (createOnMount && !createOnMountDoneRef.current) {
        createOnMountDoneRef.current = true;
        const inst = createObsTextInstance(`텍스트 ${reg.instances.length + 1}`);
        const merged: ObsTextOverlayRegistry = {
          version: 2,
          instances: [...reg.instances, inst],
        };
        setRegistry(merged);
        selectInstance(inst.id, merged);
        loadedRef.current = true;
        void persistRegistry(merged, inst.id, {
          activeConfig: inst.config,
          statusMsg: `「${inst.name}」 추가됨 · OBS에 저장됨`,
        });
        return;
      }

      setRegistry(reg);
      const id = resolveObsTextInstanceId(
        reg,
        initialInstanceId ?? activeInstanceIdRef.current
      );
      setActiveInstanceId(id);
      syncDraftFromConfig(
        getObsTextInstance(reg, id).config,
        setActiveBlockId,
        setPlainDraft,
        setEditMode
      );
      loadedRef.current = true;
      skipAutosaveUntilRef.current = Date.now() + 900;
    },
    [initialInstanceId, createOnMount, selectInstance, persistRegistry]
  );

  const applyRemoteRef = useRef(applyRemote);
  applyRemoteRef.current = applyRemote;

  const syncFromServer = useCallback(async () => {
    const remote = await loadStateFromApi(userId, {
      pick: STATE_PICK_OBS_TEXT,
      forceFull: true,
    });
    if (remote) applyRemoteRef.current(remote);
  }, [userId]);

  useEffect(() => {
    void (async () => {
      const remote = await loadStateFromApi(userId, {
        pick: STATE_PICK_OBS_TEXT,
        forceFull: true,
      });
      if (remote) applyRemoteRef.current(remote);
      else applyRemoteRef.current(loadState(userId));
    })();
  }, [userId]);

  const scheduleSyncRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const { schedule, cancel } = createStateUpdatedScheduler(() => {
      void syncFromServer();
    });
    scheduleSyncRef.current = schedule;
    return () => {
      cancel();
      scheduleSyncRef.current = null;
    };
  }, [syncFromServer]);

  useSSEConnection((msg) => {
    if (!msg || msg.type !== "state_updated") return;
    scheduleSyncRef.current?.();
  });

  const updateBlock = useCallback((blockId: string, patch: Partial<ObsTextBlock>) => {
    setConfig((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
    }));
  }, []);

  const persist = useCallback(async () => {
    await persistRegistry(registry, activeInstanceId, { activeConfig: config });
  }, [persistRegistry, registry, activeInstanceId, config]);

  const autoSaveQuietRef = useRef(false);
  useEffect(() => {
    if (!loadedRef.current) return;
    if (pendingRegistrySaveRef.current) return;
    if (Date.now() < skipAutosaveUntilRef.current) return;
    const tid = window.setTimeout(() => {
      autoSaveQuietRef.current = true;
      void persistRegistry(registry, activeInstanceId, {
        activeConfig: config,
        quiet: true,
        statusMsg: "자동 저장됨 · OBS 반영",
      }).finally(() => {
        autoSaveQuietRef.current = false;
      });
    }, 1200);
    return () => window.clearTimeout(tid);
  }, [registry, activeInstanceId, config, persistRegistry]);

  const addInstance = () => {
    if (registry.instances.length >= 24) {
      setStatus("텍스트 오버레이는 최대 24개까지 추가할 수 있습니다.");
      return;
    }
    const inst = createObsTextInstance(`텍스트 ${registry.instances.length + 1}`);
    const nextReg: ObsTextOverlayRegistry = {
      version: 2,
      instances: [...registry.instances, inst],
    };
    setRegistry(nextReg);
    selectInstance(inst.id, nextReg);
    void persistRegistry(nextReg, inst.id, {
      activeConfig: inst.config,
      statusMsg: `「${inst.name}」 추가됨 · OBS에 저장됨`,
    });
  };

  const removeInstance = (id: string) => {
    if (registry.instances.length <= 1) return;
    const nextReg: ObsTextOverlayRegistry = {
      version: 2,
      instances: registry.instances.filter((i) => i.id !== id),
    };
    const nextActiveId =
      activeInstanceId === id ? nextReg.instances[0]?.id ?? activeInstanceId : activeInstanceId;
    setRegistry(nextReg);
    if (activeInstanceId === id && nextReg.instances[0]) {
      selectInstance(nextActiveId, nextReg);
    }
    void persistRegistry(nextReg, nextActiveId, { statusMsg: "오버레이 삭제됨 · OBS에 저장됨" });
  };

  const renameInstance = (id: string, name: string) => {
    setRegistry((prev) => ({
      ...prev,
      instances: prev.instances.map((i) => (i.id === id ? { ...i, name } : i)),
    }));
  };

  const onPlainChange = (text: string) => {
    setPlainDraft(text);
    if (!activeBlock) return;
    if (editMode === "char") {
      const segs = mergeSegmentsFromPlainText(text, activeBlock.segments, config.defaultColor);
      updateBlock(activeBlock.id, { segments: segs });
    } else {
      updateBlock(activeBlock.id, {
        segments: text ? [{ text, color: pickColor }] : [{ text: " ", color: pickColor }],
      });
    }
  };

  const switchToCharMode = () => {
    if (!activeBlock) return;
    const segs = splitTextToCharSegments(plainDraft || " ", pickColor);
    setEditMode("char");
    updateBlock(activeBlock.id, { segments: segs });
  };

  const switchToSegmentMode = () => {
    if (!activeBlock) return;
    const text = segmentsToPlainText(activeBlock.segments);
    setEditMode("segment");
    setPlainDraft(text);
    updateBlock(activeBlock.id, {
      segments: text ? [{ text, color: pickColor }] : [{ text: " ", color: pickColor }],
    });
  };

  const applyColorToSelection = () => {
    const el = textareaRef.current;
    if (!el || !activeBlock) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (start === end) {
      if (editMode === "char") {
        updateBlock(activeBlock.id, {
          segments: activeBlock.segments.map((s) => ({ ...s, color: pickColor })),
        });
      } else {
        updateBlock(activeBlock.id, {
          segments: plainDraft ? [{ text: plainDraft, color: pickColor }] : activeBlock.segments,
        });
      }
      return;
    }
    const before = plainDraft.slice(0, start);
    const mid = plainDraft.slice(start, end);
    const after = plainDraft.slice(end);
    if (editMode === "char") {
      const merged = mergeSegmentsFromPlainText(plainDraft, activeBlock.segments, config.defaultColor);
      let pos = 0;
      const next = merged.map((seg) => {
        const len = Array.from(seg.text).length;
        const segStart = pos;
        const segEnd = pos + len;
        pos = segEnd;
        const overlaps = segEnd > start && segStart < end;
        return overlaps ? { ...seg, color: pickColor } : seg;
      });
      updateBlock(activeBlock.id, { segments: next });
      return;
    }
    const parts: ObsTextSegment[] = [];
    if (before) parts.push({ text: before, color: config.defaultColor });
    if (mid) parts.push({ text: mid, color: pickColor });
    if (after) parts.push({ text: after, color: config.defaultColor });
    updateBlock(activeBlock.id, { segments: parts.length ? parts : [{ text: " ", color: pickColor }] });
  };

  const updateCharSegmentColor = (index: number, color: string) => {
    if (!activeBlock) return;
    const next = activeBlock.segments.map((s, i) => (i === index ? { ...s, color } : s));
    updateBlock(activeBlock.id, { segments: next });
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? plainDraft.length;
    const end = el?.selectionEnd ?? start;
    const nextText = plainDraft.slice(0, start) + emoji + plainDraft.slice(end);
    onPlainChange(nextText);
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = start + emoji.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const addBlock = () => {
    const id = newBlockId();
    setConfig((prev) => ({
      ...prev,
      blocks: [
        ...prev.blocks,
        {
          id,
          segments: [{ text: "새 줄", color: config.defaultColor }],
          visible: true,
          align: "center",
          effect: "none",
          effectSpeed: 1,
        },
      ],
    }));
    setActiveBlockId(id);
    setPlainDraft("새 줄");
    setEditMode("segment");
  };

  const removeBlock = (id: string) => {
    setConfig((prev) => {
      if (prev.blocks.length <= 1) return prev;
      const blocks = prev.blocks.filter((b) => b.id !== id);
      return { ...prev, blocks };
    });
  };

  useEffect(() => {
    if (!activeBlock) return;
    const plain = segmentsToPlainText(activeBlock.segments);
    if (plain !== plainDraft && loadedRef.current) {
      setPlainDraft(plain);
    }
  }, [activeBlock?.id, activeBlock?.segments]);

  const onSelectBlock = (block: ObsTextBlock) => {
    setActiveBlockId(block.id);
    setPlainDraft(segmentsToPlainText(block.segments));
    const isChar =
      block.segments.length > 1 && block.segments.every((s) => Array.from(s.text).length <= 1);
    setEditMode(isChar ? "char" : "segment");
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 text-neutral-100">
      <header className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">OBS 텍스트 오버레이</h1>
          <p className="mt-1 text-sm text-neutral-400">
            오버레이마다 독립 URL · 위치·문구·효과. 입력 후 약 1초 뒤 자동 저장되며 OBS에 반영됩니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            disabled={saving}
            onClick={() => void persist()}
          >
            {saving ? "저장 중…" : "OBS에 저장"}
          </button>
          <button
            type="button"
            className="rounded-lg bg-neutral-700 px-3 py-2 text-sm hover:bg-neutral-600"
            onClick={() => window.open(overlayUrl, "_blank", "noopener,noreferrer")}
          >
            미리보기
          </button>
        </div>
      </header>

      {status ? <p className="text-sm text-emerald-400">{status}</p> : null}

      <section className="rounded-xl border border-violet-500/25 bg-violet-950/20 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-violet-100">텍스트 오버레이 목록</h2>
          <button
            type="button"
            className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold hover:bg-violet-600 disabled:opacity-50"
            disabled={saving}
            onClick={addInstance}
          >
            {saving ? "저장 중…" : "+ 오버레이 추가"}
          </button>
        </div>
        <div className="space-y-2">
          {registry.instances.map((inst) => {
            const selected = inst.id === activeInstanceId;
            return (
              <div
                key={inst.id}
                className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
                  selected
                    ? "border-violet-400/50 bg-violet-900/40"
                    : "border-white/10 bg-neutral-950/60"
                }`}
              >
                <button
                  type="button"
                  className={`shrink-0 rounded px-2 py-1 text-xs ${
                    selected ? "bg-violet-600 text-white" : "bg-neutral-800 text-neutral-300"
                  }`}
                  onClick={() => selectInstance(inst.id)}
                >
                  {selected ? "선택됨" : "편집"}
                </button>
                <input
                  type="text"
                  className="min-w-[120px] flex-1 rounded border border-white/10 bg-neutral-900 px-2 py-1 text-sm"
                  value={inst.name}
                  onChange={(e) => renameInstance(inst.id, e.target.value)}
                  onFocus={() => selectInstance(inst.id)}
                />
                <code className="text-[10px] text-neutral-500">textId={inst.id}</code>
                {registry.instances.length > 1 ? (
                  <button
                    type="button"
                    className="text-xs text-rose-400 hover:underline"
                    onClick={() => removeInstance(inst.id)}
                  >
                    삭제
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">
          OBS URL — {activeInstance.name}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex-1 break-all rounded bg-black/40 px-2 py-1 text-xs text-neutral-300">
            {overlayUrl}
          </code>
          <button
            type="button"
            className={`shrink-0 rounded px-2 py-1 text-xs ${copied ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
            onClick={() => {
              void (async () => {
                const ok = await copyTextToClipboard(overlayUrl);
                if (ok) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } else {
                  setStatus("URL 복사 실패 — 아래 주소를 직접 선택해 복사하세요.");
                }
              })();
            }}
          >
            {copied ? "복사됨!" : "URL 복사"}
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          브라우저 소스 크기 1920×1080 · 배경 투명 · 관리자에서 저장하면 OBS가 자동 갱신됩니다.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <section className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">텍스트 줄</h2>
              <button
                type="button"
                className="rounded bg-sky-800 px-2 py-1 text-xs hover:bg-sky-700"
                onClick={addBlock}
              >
                + 줄 추가
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {config.blocks.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    b.id === activeBlockId
                      ? "bg-amber-600 text-white"
                      : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                  }`}
                  onClick={() => onSelectBlock(b)}
                >
                  {segmentsToPlainText(b.segments).slice(0, 12) || "(빈 줄)"}
                  {b.effect && b.effect !== "none"
                    ? ` · ${OBS_TEXT_EFFECT_OPTIONS.find((o) => o.id === b.effect)?.label ?? b.effect}`
                    : ""}
                  {b.visible === false ? " (숨김)" : ""}
                </button>
              ))}
            </div>
            {activeBlock ? (
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={activeBlock.visible !== false}
                    onChange={(e) => updateBlock(activeBlock.id, { visible: e.target.checked })}
                  />
                  OBS에 표시
                </label>
                <label className="flex items-center gap-2">
                  정렬
                  <select
                    className="rounded bg-neutral-800 px-2 py-1"
                    value={activeBlock.align ?? "center"}
                    onChange={(e) =>
                      updateBlock(activeBlock.id, {
                        align: e.target.value as "left" | "center" | "right",
                      })
                    }
                  >
                    <option value="left">왼쪽</option>
                    <option value="center">가운데</option>
                    <option value="right">오른쪽</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  글자 크기
                  <input
                    type="number"
                    min={12}
                    max={200}
                    className="w-16 rounded bg-neutral-800 px-2 py-1"
                    value={activeBlock.fontSizePx ?? config.defaultFontSizePx}
                    onChange={(e) =>
                      updateBlock(activeBlock.id, { fontSizePx: Number(e.target.value) || undefined })
                    }
                  />
                  px
                </label>
                {config.blocks.length > 1 ? (
                  <button
                    type="button"
                    className="text-rose-400 text-xs hover:underline"
                    onClick={() => removeBlock(activeBlock.id)}
                  >
                    이 줄 삭제
                  </button>
                ) : null}
              </div>
            ) : null}
            {activeBlock ? (
              <div className="space-y-2 border-t border-white/10 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-violet-200">텍스트 효과 (이 줄)</span>
                  <label className="flex items-center gap-2 text-xs text-neutral-400">
                    속도
                    <input
                      type="range"
                      min={0.35}
                      max={3}
                      step={0.05}
                      value={activeBlock.effectSpeed ?? 1}
                      onChange={(e) =>
                        updateBlock(activeBlock.id, {
                          effectSpeed: Number(e.target.value) || 1,
                        })
                      }
                      className="w-24"
                    />
                    <span className="w-8 tabular-nums">×{(activeBlock.effectSpeed ?? 1).toFixed(1)}</span>
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                  {OBS_TEXT_EFFECT_OPTIONS.map((opt) => {
                    const active = (activeBlock.effect ?? "none") === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        title={opt.hint}
                        className={`rounded-lg border px-2 py-2 text-left text-xs transition ${
                          active
                            ? "border-violet-400 bg-violet-900/60 text-violet-100"
                            : "border-white/10 bg-neutral-950/80 text-neutral-300 hover:border-white/25"
                        }`}
                        onClick={() =>
                          updateBlock(activeBlock.id, { effect: opt.id as ObsTextEffectId })
                        }
                      >
                        <span className="block font-semibold">{opt.label}</span>
                        <span className="mt-0.5 block text-[10px] opacity-70">{opt.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm ${editMode === "segment" ? "bg-violet-600" : "bg-neutral-800"}`}
                onClick={switchToSegmentMode}
              >
                구간별 색상
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm ${editMode === "char" ? "bg-violet-600" : "bg-neutral-800"}`}
                onClick={switchToCharMode}
              >
                글자별 색상
              </button>
            </div>
            <textarea
              ref={textareaRef}
              className="min-h-[100px] w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-lg"
              value={plainDraft}
              onChange={(e) => onPlainChange(e.target.value)}
              placeholder="방송에 띄울 문구"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                색상
                <input
                  type="color"
                  value={pickColor}
                  onChange={(e) => setPickColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border-0 bg-transparent"
                />
                <input
                  type="text"
                  value={pickColor}
                  onChange={(e) => setPickColor(e.target.value)}
                  className="w-24 rounded bg-neutral-800 px-2 py-1 text-xs font-mono"
                />
              </label>
              <button
                type="button"
                className="rounded-lg bg-pink-700 px-3 py-1.5 text-sm hover:bg-pink-600"
                onClick={applyColorToSelection}
              >
                {editMode === "char" ? "선택 글자에 색 적용" : "선택 구간에 색 적용"}
              </button>
            </div>
            {editMode === "char" && activeBlock ? (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-white/5 bg-black/30 p-2">
                <p className="mb-2 text-xs text-neutral-500">글자별 색 (클릭하여 변경)</p>
                <div className="flex flex-wrap gap-1">
                  {activeBlock.segments.map((seg, i) => (
                    <label
                      key={`${i}-${seg.text}`}
                      className="inline-flex cursor-pointer flex-col items-center rounded border border-white/10 bg-neutral-900 px-1 py-0.5"
                      title={`${seg.text} · ${seg.color}`}
                    >
                      <span className="text-lg leading-none">{seg.text === " " ? "␣" : seg.text}</span>
                      <input
                        type="color"
                        value={seg.color}
                        onChange={(e) => updateCharSegmentColor(i, e.target.value)}
                        className="h-5 w-8 border-0 bg-transparent p-0"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
            <h2 className="mb-2 text-sm font-semibold text-neutral-300">이모티콘</h2>
            <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
              {OBS_TEXT_EMOJI_PRESETS.map((em) => (
                <button
                  key={em}
                  type="button"
                  className="rounded-lg bg-neutral-800 px-2 py-1 text-xl hover:bg-neutral-700"
                  onClick={() => insertEmoji(em)}
                  title="커서 위치에 삽입"
                >
                  {em}
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 space-y-3">
            <h2 className="font-semibold">레이아웃 · 스타일</h2>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              화면 위치
              <select
                className="rounded bg-neutral-800 px-2 py-1"
                value={config.position}
                onChange={(e) =>
                  setConfig((p) => ({ ...p, position: e.target.value as ObsTextOverlayPosition }))
                }
              >
                <option value="top-left">상단 왼쪽</option>
                <option value="top-center">상단 가운데</option>
                <option value="top-right">상단 오른쪽</option>
                <option value="center">정중앙</option>
                <option value="bottom-left">하단 왼쪽</option>
                <option value="bottom-center">하단 가운데</option>
                <option value="bottom-right">하단 오른쪽</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="flex flex-col gap-1">
                기본 글자 크기 (px)
                <input
                  type="number"
                  min={12}
                  max={200}
                  className="rounded bg-neutral-800 px-2 py-1"
                  value={config.defaultFontSizePx}
                  onChange={(e) =>
                    setConfig((p) => ({ ...p, defaultFontSizePx: Number(e.target.value) || 48 }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1">
                확대 (%)
                <input
                  type="number"
                  min={25}
                  max={300}
                  className="rounded bg-neutral-800 px-2 py-1"
                  value={config.scalePct}
                  onChange={(e) => setConfig((p) => ({ ...p, scalePct: Number(e.target.value) || 100 }))}
                />
              </label>
              <label className="flex flex-col gap-1">
                X 오프셋
                <input
                  type="number"
                  className="rounded bg-neutral-800 px-2 py-1"
                  value={config.offsetX}
                  onChange={(e) => setConfig((p) => ({ ...p, offsetX: Number(e.target.value) || 0 }))}
                />
              </label>
              <label className="flex flex-col gap-1">
                Y 오프셋
                <input
                  type="number"
                  className="rounded bg-neutral-800 px-2 py-1"
                  value={config.offsetY}
                  onChange={(e) => setConfig((p) => ({ ...p, offsetY: Number(e.target.value) || 0 }))}
                />
              </label>
              <label className="flex flex-col gap-1">
                줄 간격
                <input
                  type="number"
                  min={0}
                  max={80}
                  className="rounded bg-neutral-800 px-2 py-1"
                  value={config.lineGapPx}
                  onChange={(e) => setConfig((p) => ({ ...p, lineGapPx: Number(e.target.value) || 0 }))}
                />
              </label>
              <label className="flex flex-col gap-1">
                테두리 두께
                <input
                  type="number"
                  min={0}
                  max={12}
                  className="rounded bg-neutral-800 px-2 py-1"
                  value={config.outlineWidthPx}
                  onChange={(e) =>
                    setConfig((p) => ({ ...p, outlineWidthPx: Number(e.target.value) || 0 }))
                  }
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.outlineEnabled}
                onChange={(e) => setConfig((p) => ({ ...p, outlineEnabled: e.target.checked }))}
              />
              글자 외곽선(가독성)
            </label>
            <label className="flex items-center gap-2 text-sm">
              외곽선 색
              <input
                type="color"
                value={config.outlineColor}
                onChange={(e) => setConfig((p) => ({ ...p, outlineColor: e.target.value }))}
              />
            </label>
          </section>

          <section className="overflow-hidden rounded-xl border border-white/10 bg-neutral-950">
            <p className="border-b border-white/10 px-3 py-2 text-xs text-neutral-500">미리보기</p>
            <div className="relative min-h-[280px] bg-gradient-to-b from-slate-800 to-slate-900">
              <ObsTextOverlayView config={config} preview />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
