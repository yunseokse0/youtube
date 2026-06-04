"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ObsTextOverlayView } from "@/components/obs-text/ObsTextOverlayView";
import {
  OBS_TEXT_EMOJI_PRESETS,
  OBS_TEXT_OVERLAY_STATE_KEY,
  appendObsTextInstance,
  applyEffectRangeToBlocks,
  blocksFromMultilineText,
  mergeMultilineDraftIntoObsTextConfig,
  buildObsTextOverlayUrl,
  duplicateObsTextInstance,
  formatObsTextOverlayUrlList,
  defaultObsTextRegistry,
  getObsTextInstance,
  lineCharRangeInMultiline,
  lineIndexAtTextOffset,
  MAX_OBS_TEXT_BLOCKS_PER_INSTANCE,
  MAX_OBS_TEXT_INSTANCES,
  mergeSegmentsFromPlainText,
  multilineTextFromBlocks,
  obsTextRegistrySyncSignature,
  readObsTextRegistryFromState,
  removeObsTextInstance,
  renameObsTextInstance,
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
import { OBS_TEXT_YOUTUBE_EMOJI_PRESETS } from "@/lib/youtube-chat-emojis";
import {
  defaultState,
  loadState,
  loadStateFromApi,
  saveStateAsync,
  type AppState,
} from "@/lib/state";
import { STATE_PICK_OBS_TEXT } from "@/lib/state-api-pick";
import { useSSEConnection } from "@/lib/sse-client";
import {
  createStateUpdatedScheduler,
  DONOR_STATE_UPDATED_DEBOUNCE_MS,
  DONOR_STATE_UPDATED_MAX_WAIT_MS,
  shouldSyncOverlayFromStateUpdatedEvent,
} from "@/lib/overlay-pull-policy";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

type EditMode = "segment" | "char";

function syncDraftFromConfig(
  cfg: ObsTextOverlayConfig,
  setActiveLineIndex: (idx: number) => void,
  setMultilineDraft: (t: string) => void,
  setEditMode: (m: EditMode) => void
) {
  const first = cfg.blocks[0];
  setMultilineDraft(multilineTextFromBlocks(cfg.blocks));
  setActiveLineIndex(0);
  if (first) {
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
  const [activeLineIndex, setActiveLineIndex] = useState(0);
  const [editMode, setEditMode] = useState<EditMode>("segment");
  const [multilineDraft, setMultilineDraft] = useState("방송 텍스트");
  const skipMultilineResyncRef = useRef(false);
  const [pickColor, setPickColor] = useState("#ffffff");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedAllUrls, setCopiedAllUrls] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorPanelRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const loadedRef = useRef(false);
  const createOnMountDoneRef = useRef(false);
  /** SSR·첫 hydration과 동일한 상대 URL → 마운트 후 origin 반영 */
  const [pageOrigin, setPageOrigin] = useState("");
  const pendingRegistrySaveRef = useRef(false);
  const lastPersistedUpdatedAtRef = useRef(0);
  const lastAppliedRemoteSigRef = useRef("");
  const localDirtyRef = useRef(false);
  const skipAutosaveUntilRef = useRef(0);
  const activeInstanceIdRef = useRef(activeInstanceId);
  const registryRef = useRef(registry);
  const configRef = useRef<ObsTextOverlayConfig | null>(null);
  const multilineDraftRef = useRef(multilineDraft);

  const markLocalDirty = useCallback(() => {
    localDirtyRef.current = true;
  }, []);

  const config = useMemo(
    () => getObsTextInstance(registry, activeInstanceId).config,
    [registry, activeInstanceId]
  );

  activeInstanceIdRef.current = activeInstanceId;
  registryRef.current = registry;
  configRef.current = config;
  multilineDraftRef.current = multilineDraft;

  const configForSave = useCallback(
    () =>
      mergeMultilineDraftIntoObsTextConfig(
        configRef.current ?? config,
        multilineDraftRef.current
      ),
    [config]
  );

  const activeInstance = useMemo(
    () => getObsTextInstance(registry, activeInstanceId),
    [registry, activeInstanceId]
  );

  const setConfig = useCallback(
    (updater: ObsTextOverlayConfig | ((prev: ObsTextOverlayConfig) => ObsTextOverlayConfig)) => {
      markLocalDirty();
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
    [activeInstanceId, markLocalDirty]
  );

  const activeBlock = useMemo(() => {
    const idx = Math.max(0, Math.min(activeLineIndex, config.blocks.length - 1));
    return config.blocks[idx] ?? config.blocks[0];
  }, [config.blocks, activeLineIndex]);

  const syncActiveLineFromCaret = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const idx = lineIndexAtTextOffset(el.value, el.selectionStart ?? 0);
    setActiveLineIndex(idx);
  }, []);

  useEffect(() => {
    setPageOrigin(window.location.origin);
  }, []);

  const overlayUrl = useMemo(
    () => buildObsTextOverlayUrl(pageOrigin, userId, activeInstanceId),
    [pageOrigin, userId, activeInstanceId]
  );

  const selectInstance = useCallback(
    (id: string, reg?: ObsTextOverlayRegistry) => {
      const source = reg ?? registryRef.current;
      if (id === activeInstanceIdRef.current && !reg) return;
      setActiveInstanceId(id);
      const cfg = getObsTextInstance(source, id).config;
      syncDraftFromConfig(cfg, setActiveLineIndex, setMultilineDraft, setEditMode);
      if (typeof window !== "undefined") {
        const u = new URL(window.location.href);
        u.searchParams.set("u", userId);
        u.searchParams.set("textId", id);
        u.searchParams.delete("new");
        window.history.replaceState({}, "", `${u.pathname}${u.search}`);
      }
    },
    [userId]
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
            ? {
                ...(activeConfig ?? inst.config),
                revision: Date.now(),
              }
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
        const remote = await loadStateFromApi(userId, { forceFull: true });
        if (!remote) {
          setStatus(
            "저장 실패 — 서버 상태를 불러오지 못했습니다. 시그 목록이 기본값으로 덮이지 않도록 저장을 중단했습니다."
          );
          return false;
        }
        const stamped = stampRegistryForSave(reg, activeId, opts?.activeConfig);
        const os =
          remote.overlaySettings && typeof remote.overlaySettings === "object"
            ? { ...(remote.overlaySettings as Record<string, unknown>) }
            : {};
        os[OBS_TEXT_OVERLAY_STATE_KEY] = stamped;
        const activeRev = Math.max(
          0,
          ...stamped.instances.map((inst) => Number(inst.config.revision || 0))
        );
        const now = Math.max(Date.now(), activeRev);
        const result = await saveStateAsync({
          ...remote,
          overlaySettings: os,
          updatedAt: now,
        });
        if (!result.ok) {
          setStatus("저장 실패 — 네트워크 또는 로그인 상태를 확인하세요");
          return false;
        }
        const serverTs =
          typeof result.serverUpdatedAt === "number" && Number.isFinite(result.serverUpdatedAt)
            ? result.serverUpdatedAt
            : now;
        lastPersistedUpdatedAtRef.current = serverTs;
        lastAppliedRemoteSigRef.current = obsTextRegistrySyncSignature(stamped);
        localDirtyRef.current = false;
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
      if (localDirtyRef.current) return;
      const remoteTs = state.updatedAt || 0;
      if (remoteTs > 0 && remoteTs <= lastPersistedUpdatedAtRef.current) return;

      const reg = readObsTextRegistryFromState(state);
      const remoteSig = obsTextRegistrySyncSignature(reg);
      if (remoteSig === lastAppliedRemoteSigRef.current) {
        loadedRef.current = true;
        return;
      }

      if (createOnMount && !createOnMountDoneRef.current) {
        createOnMountDoneRef.current = true;
        const added = appendObsTextInstance(reg, `텍스트 ${reg.instances.length + 1}`);
        if (!added) return;
        const merged = added.registry;
        const inst = added.instance;
        setRegistry(merged);
        selectInstance(inst.id, merged);
        loadedRef.current = true;
        void persistRegistry(merged, inst.id, {
          activeConfig: inst.config,
          statusMsg: `「${inst.name}」 추가됨 · OBS에 저장됨`,
        });
        return;
      }

      lastAppliedRemoteSigRef.current = remoteSig;
      setRegistry(reg);
      const id = resolveObsTextInstanceId(
        reg,
        initialInstanceId ?? activeInstanceIdRef.current
      );
      setActiveInstanceId(id);
      syncDraftFromConfig(
        getObsTextInstance(reg, id).config,
        setActiveLineIndex,
        setMultilineDraft,
        setEditMode
      );
      loadedRef.current = true;
      skipAutosaveUntilRef.current = Date.now() + 400;
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
    }, {
      debounceMs: DONOR_STATE_UPDATED_DEBOUNCE_MS,
      maxWaitMs: DONOR_STATE_UPDATED_MAX_WAIT_MS,
    });
    scheduleSyncRef.current = schedule;
    return () => {
      cancel();
      scheduleSyncRef.current = null;
    };
  }, [syncFromServer]);

  useSSEConnection((msg) => {
    if (!msg || msg.type !== "state_updated") return;
    if (localDirtyRef.current) return;
    if (
      !shouldSyncOverlayFromStateUpdatedEvent(
        (msg as { updatedAt?: unknown }).updatedAt,
        lastPersistedUpdatedAtRef.current
      )
    ) {
      return;
    }
    scheduleSyncRef.current?.();
  });

  const updateBlock = useCallback((blockId: string, patch: Partial<ObsTextBlock>) => {
    setConfig((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
    }));
  }, [setConfig]);

  const persist = useCallback(async () => {
    const synced = configForSave();
    setConfig(() => synced);
    await persistRegistry(registry, activeInstanceId, { activeConfig: synced });
  }, [persistRegistry, registry, activeInstanceId, configForSave, setConfig]);

  const flushPendingEdits = useCallback(async () => {
    if (!localDirtyRef.current || pendingRegistrySaveRef.current) return;
    const synced = configForSave();
    setConfig(() => synced);
    await persistRegistry(registryRef.current, activeInstanceIdRef.current, {
      activeConfig: synced,
      quiet: true,
      statusMsg: "저장됨 · OBS 반영",
    });
  }, [persistRegistry, configForSave, setConfig]);

  const selectInstanceWithFlush = useCallback(
    (id: string) => {
      if (id === activeInstanceIdRef.current) return;
      if (localDirtyRef.current) {
        void flushPendingEdits().then(() => selectInstance(id));
        return;
      }
      selectInstance(id);
    },
    [selectInstance, flushPendingEdits]
  );

  const autoSaveQuietRef = useRef(false);
  useEffect(() => {
    if (!loadedRef.current) return;
    if (!localDirtyRef.current) return;
    if (pendingRegistrySaveRef.current) return;
    if (Date.now() < skipAutosaveUntilRef.current) return;
    const tid = window.setTimeout(() => {
      autoSaveQuietRef.current = true;
      const synced = mergeMultilineDraftIntoObsTextConfig(config, multilineDraft);
      setConfig(() => synced);
      void persistRegistry(registry, activeInstanceId, {
        activeConfig: synced,
        quiet: true,
        statusMsg: "자동 저장됨 · OBS 반영",
      }).finally(() => {
        autoSaveQuietRef.current = false;
      });
    }, 400);
    return () => window.clearTimeout(tid);
  }, [registry, activeInstanceId, config, multilineDraft, persistRegistry, setConfig]);

  const addInstance = () => {
    const added = appendObsTextInstance(registry);
    if (!added) {
      setStatus(`텍스트 오버레이는 최대 ${MAX_OBS_TEXT_INSTANCES}개까지 추가할 수 있습니다.`);
      return;
    }
    setRegistry(added.registry);
    selectInstance(added.instance.id, added.registry);
    void persistRegistry(added.registry, added.instance.id, {
      activeConfig: added.instance.config,
      statusMsg: `「${added.instance.name}」 추가됨 · OBS에 저장됨`,
    });
  };

  const duplicateInstance = (sourceId: string) => {
    const dup = duplicateObsTextInstance(registry, sourceId);
    if (!dup) {
      setStatus(`복제 실패 — 최대 ${MAX_OBS_TEXT_INSTANCES}개입니다.`);
      return;
    }
    setRegistry(dup.registry);
    selectInstance(dup.instance.id, dup.registry);
    void persistRegistry(dup.registry, dup.instance.id, {
      activeConfig: dup.instance.config,
      statusMsg: `「${dup.instance.name}」 복제됨 · OBS에 저장됨`,
    });
  };

  const removeInstance = (id: string) => {
    const nextReg = removeObsTextInstance(registry, id);
    if (!nextReg) return;
    const nextActiveId =
      activeInstanceId === id ? nextReg.instances[0]?.id ?? activeInstanceId : activeInstanceId;
    setRegistry(nextReg);
    if (activeInstanceId === id && nextReg.instances[0]) {
      selectInstance(nextActiveId, nextReg);
    }
    void persistRegistry(nextReg, nextActiveId, { statusMsg: "오버레이 삭제됨 · OBS에 저장됨" });
  };

  const renameInstance = (id: string, name: string) => {
    markLocalDirty();
    setRegistry((prev) => renameObsTextInstance(prev, id, name));
  };

  const instanceOverlayUrl = useCallback(
    (instanceId: string) => buildObsTextOverlayUrl(pageOrigin, userId, instanceId),
    [pageOrigin, userId]
  );

  const onMultilineChange = useCallback(
    (text: string, opts?: { skipBlocks?: boolean }) => {
      markLocalDirty();
      skipMultilineResyncRef.current = true;
      setMultilineDraft(text);
      if (!opts?.skipBlocks) {
        setConfig((prev) => {
          const blocks = blocksFromMultilineText(text, prev.blocks, prev.defaultColor);
          return { ...prev, blocks };
        });
      }
      const el = textareaRef.current;
      if (el) {
        const idx = lineIndexAtTextOffset(text, el.selectionStart ?? text.length);
        setActiveLineIndex(idx);
      }
    },
    [setConfig, markLocalDirty]
  );

  /** 효과·색상 버튼 클릭 시 textarea blur로 입력이 씹히는 것 방지 */
  const keepTextareaFocus = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const applyEffectToSelection = useCallback(
    (effectId: ObsTextEffectId) => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const speed = activeBlock?.effectSpeed ?? 1;
      markLocalDirty();
      skipMultilineResyncRef.current = true;
      setConfig((prev) => ({
        ...prev,
        blocks: applyEffectRangeToBlocks(
          multilineDraft,
          prev.blocks,
          start,
          end,
          effectId,
          speed,
          prev.defaultColor
        ),
      }));
      requestAnimationFrame(() => el.focus());
    },
    [multilineDraft, activeBlock?.effectSpeed, setConfig, markLocalDirty]
  );

  useEffect(() => {
    if (!loadedRef.current) return;
    if (skipMultilineResyncRef.current) {
      skipMultilineResyncRef.current = false;
      return;
    }
    setMultilineDraft(multilineTextFromBlocks(config.blocks));
  }, [config.blocks]);

  useEffect(() => {
    setActiveLineIndex((idx) =>
      Math.max(0, Math.min(idx, Math.max(0, config.blocks.length - 1)))
    );
  }, [config.blocks.length]);

  const switchToCharMode = () => {
    if (!activeBlock) return;
    const lineText =
      multilineDraft.split(/\r?\n/)[Math.max(0, activeLineIndex)] ??
      blockPlainFromSegments(activeBlock.segments);
    const segs = splitTextToCharSegments(lineText || " ", pickColor);
    setEditMode("char");
    updateBlock(activeBlock.id, { segments: segs });
  };

  const switchToSegmentMode = () => {
    setEditMode("segment");
  };

  const applyColorToSelection = () => {
    const el = textareaRef.current;
    if (!el) return;
    markLocalDirty();
    skipMultilineResyncRef.current = true;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const lineIdx = lineIndexAtTextOffset(multilineDraft, start);
    const targetBlock = config.blocks[lineIdx];
    if (!targetBlock) return;

    if (start === end) {
      if (editMode === "char") {
        updateBlock(targetBlock.id, {
          segments: targetBlock.segments.map((s) => ({ ...s, color: pickColor })),
        });
      } else {
        const { line } = lineCharRangeInMultiline(multilineDraft, lineIdx);
        updateBlock(targetBlock.id, {
          segments: line.trim() ? [{ text: line, color: pickColor }] : targetBlock.segments,
        });
      }
      return;
    }

    const lineRange = lineCharRangeInMultiline(multilineDraft, lineIdx);
    const selStart = Math.max(start, lineRange.start) - lineRange.start;
    const selEnd = Math.min(end, lineRange.end) - lineRange.start;
    const lineText = lineRange.line;

    if (editMode === "char") {
      const merged = mergeSegmentsFromPlainText(
        lineText,
        targetBlock.segments,
        config.defaultColor
      );
      let pos = 0;
      const next = merged.map((seg) => {
        const len = Array.from(seg.text).length;
        const segStart = pos;
        const segEnd = pos + len;
        pos = segEnd;
        const overlaps = segEnd > selStart && segStart < selEnd;
        return overlaps ? { ...seg, color: pickColor } : seg;
      });
      updateBlock(targetBlock.id, { segments: next });
      return;
    }

    const before = lineText.slice(0, selStart);
    const mid = lineText.slice(selStart, selEnd);
    const after = lineText.slice(selEnd);
    const parts: ObsTextSegment[] = [];
    if (before) parts.push({ text: before, color: config.defaultColor });
    if (mid) parts.push({ text: mid, color: pickColor });
    if (after) parts.push({ text: after, color: config.defaultColor });
    updateBlock(targetBlock.id, {
      segments: parts.length ? parts : [{ text: " ", color: pickColor }],
    });
    requestAnimationFrame(() => el.focus());
  };

  const updateCharSegmentColor = (index: number, color: string) => {
    if (!activeBlock) return;
    const next = activeBlock.segments.map((s, i) => (i === index ? { ...s, color } : s));
    updateBlock(activeBlock.id, { segments: next });
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? multilineDraft.length;
    const end = el?.selectionEnd ?? start;
    const nextText = multilineDraft.slice(0, start) + emoji + multilineDraft.slice(end);
    onMultilineChange(nextText);
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = start + emoji.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const removeActiveLine = () => {
    if (config.blocks.length <= 1) return;
    const lines = multilineDraft.split(/\r?\n/);
    const idx = Math.max(0, Math.min(activeLineIndex, lines.length - 1));
    lines.splice(idx, 1);
    onMultilineChange(lines.length ? lines.join("\n") : " ");
    setActiveLineIndex(Math.max(0, idx - 1));
  };

  function blockPlainFromSegments(segments: ObsTextSegment[]): string {
    return segmentsToPlainText(segments).replace(/\u00a0/g, " ");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 text-neutral-100">
      <header className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">OBS 텍스트 오버레이</h1>
          <p className="mt-1 text-sm text-neutral-400 leading-relaxed">
            <strong className="text-neutral-300">Enter</strong>로 줄 추가 · 여러 줄 붙여넣기 즉시 반영 ·
            자동 저장 후 OBS 실시간 갱신. 오버레이마다 브라우저 소스 1개(
            <code className="text-violet-300">textId</code> 다름, 최대 {MAX_OBS_TEXT_INSTANCES}개).
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
          <h2 className="text-sm font-semibold text-violet-100">
            텍스트 오버레이 목록 ({registry.instances.length}/{MAX_OBS_TEXT_INSTANCES})
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-neutral-700 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-600 disabled:opacity-50"
              disabled={saving}
              onClick={() => {
                const origin = pageOrigin || window.location.origin;
                const text = formatObsTextOverlayUrlList(origin, userId, registry);
                void copyTextToClipboard(text).then((ok) => {
                  if (ok) {
                    setCopiedAllUrls(true);
                    setTimeout(() => setCopiedAllUrls(false), 2000);
                    setStatus("전체 OBS URL 목록을 복사했습니다.");
                  }
                });
              }}
            >
              {copiedAllUrls ? "전체 URL 복사됨" : "전체 URL 복사"}
            </button>
            <button
              type="button"
              className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold hover:bg-violet-600 disabled:opacity-50"
              disabled={saving || registry.instances.length >= MAX_OBS_TEXT_INSTANCES}
              onClick={addInstance}
            >
              {saving ? "저장 중…" : "+ 오버레이 추가"}
            </button>
          </div>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-[11px] text-violet-100/85">
          <li>입력창에서 <strong>Enter</strong>로 줄 추가·줄바꿈 → OBS에 줄마다 표시.</li>
          <li>「+ 오버레이 추가」→ 각각 URL 복사 → OBS 브라우저 소스 추가.</li>
          <li>커서가 있는 줄에 효과·정렬·색상이 적용됩니다.</li>
        </ol>
        <div className="space-y-3">
          {registry.instances.map((inst, idx) => {
            const selected = inst.id === activeInstanceId;
            const url = instanceOverlayUrl(inst.id);
            return (
              <div
                key={inst.id}
                className={`rounded-lg border px-3 py-3 space-y-2 ${
                  selected
                    ? "border-violet-400/50 bg-violet-900/40"
                    : "border-white/10 bg-neutral-950/60"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-violet-800/60 px-1.5 py-0.5 text-[10px] font-bold text-violet-100">
                    #{idx + 1}
                  </span>
                  <button
                    type="button"
                    className={`shrink-0 rounded px-2 py-1 text-xs ${
                      selected ? "bg-violet-600 text-white" : "bg-neutral-800 text-neutral-300"
                    }`}
                    onClick={() => selectInstanceWithFlush(inst.id)}
                  >
                    {selected ? "편집 중" : "편집"}
                  </button>
                  <input
                    type="text"
                    className="min-w-[100px] flex-1 rounded border border-white/10 bg-neutral-900 px-2 py-1 text-sm"
                    value={inst.name}
                    onChange={(e) => renameInstance(inst.id, e.target.value)}
                    onFocus={() => selectInstanceWithFlush(inst.id)}
                  />
                  <button
                    type="button"
                    className="text-xs text-sky-300 hover:underline"
                    onClick={() => duplicateInstance(inst.id)}
                  >
                    복제
                  </button>
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
                <code className="block break-all rounded bg-black/35 px-2 py-1 text-[10px] text-neutral-400">
                  textId={inst.id}
                </code>
                <code
                  className="block break-all rounded bg-black/50 px-2 py-1 text-[11px] text-violet-200/90"
                  suppressHydrationWarning
                >
                  {url}
                </code>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600"
                    onClick={() => {
                      void copyTextToClipboard(url).then((ok) => {
                        if (ok) setStatus(`「${inst.name}」 URL 복사됨`);
                      });
                    }}
                  >
                    URL 복사
                  </button>
                  <button
                    type="button"
                    className="rounded bg-indigo-800 px-2 py-1 text-xs hover:bg-indigo-700"
                    onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                  >
                    미리보기
                  </button>
                </div>
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
          <code
            className="flex-1 break-all rounded bg-black/40 px-2 py-1 text-xs text-neutral-300"
            suppressHydrationWarning
          >
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
          브라우저 소스 1920×1080 · 배경 투명 · 입력 후 약 0.4초 자동 저장 · SSE·폴링으로 OBS 즉시 반영
        </p>
      </section>

      <div ref={editorPanelRef} className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <section className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 space-y-3">
            <div>
              <h2 className="font-semibold">여러 줄 텍스트</h2>
              <p className="text-[11px] text-neutral-500">
                {config.blocks.length}줄 · Enter로 줄 추가 · 붙여넣기 즉시 반영 · 최대{" "}
                {MAX_OBS_TEXT_BLOCKS_PER_INSTANCE}줄
              </p>
            </div>
            <textarea
              ref={textareaRef}
              className="min-h-[180px] w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-lg leading-relaxed"
              value={multilineDraft}
              onChange={(e) => {
                const v = e.target.value;
                if (composingRef.current) {
                  onMultilineChange(v, { skipBlocks: true });
                  return;
                }
                onMultilineChange(v);
              }}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={(e) => {
                composingRef.current = false;
                onMultilineChange(e.currentTarget.value);
              }}
              onBlur={(e) => {
                const panel = editorPanelRef.current;
                if (
                  panel &&
                  e.relatedTarget instanceof Node &&
                  panel.contains(e.relatedTarget)
                ) {
                  return;
                }
                void flushPendingEdits();
              }}
              onClick={syncActiveLineFromCaret}
              onKeyUp={syncActiveLineFromCaret}
              onSelect={syncActiveLineFromCaret}
              placeholder={"첫 번째 줄\n두 번째 줄 (Enter로 줄바꿈)"}
            />
            <div className="rounded-lg border border-white/10 bg-neutral-950/80 p-2">
              <p className="mb-1.5 text-[11px] text-neutral-400">
                이모티콘 · 클릭 시 커서 위치에 삽입 ({OBS_TEXT_EMOJI_PRESETS.length}개) · 없는 이모지는
                Win+. 또는 붙여넣기
              </p>
              <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                {OBS_TEXT_EMOJI_PRESETS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    className="rounded-md bg-neutral-800 px-2 py-1 text-xl leading-none hover:bg-neutral-600"
                    onMouseDown={keepTextareaFocus}
                    onClick={() => insertEmoji(em)}
                    title={`${em} 삽입`}
                  >
                    {em}
                  </button>
                ))}
              </div>
              <p className="mb-1.5 mt-3 text-[11px] text-neutral-400">
                유튜브 라이브 채팅 · OBS에 이미지로 표시 ({OBS_TEXT_YOUTUBE_EMOJI_PRESETS.length}개)
              </p>
              <div className="flex flex-wrap gap-2">
                {OBS_TEXT_YOUTUBE_EMOJI_PRESETS.map((preset) => (
                  <button
                    key={preset.code}
                    type="button"
                    className="flex items-center gap-2 rounded-md bg-neutral-800 px-2 py-1.5 text-sm hover:bg-neutral-600"
                    onMouseDown={keepTextareaFocus}
                    onClick={() => insertEmoji(preset.code)}
                    title={`${preset.label} (${preset.code})`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preset.url}
                      alt=""
                      className="h-6 w-6 object-contain"
                      draggable={false}
                    />
                    <span className="text-neutral-300">{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>
            {activeBlock ? (
              <p className="text-[11px] text-amber-200/90">
                커서 줄: {Math.min(activeLineIndex, config.blocks.length - 1) + 1} /{" "}
                {config.blocks.length}
                {activeBlock.effect && activeBlock.effect !== "none"
                  ? ` · ${OBS_TEXT_EFFECT_OPTIONS.find((o) => o.id === activeBlock.effect)?.label ?? activeBlock.effect}`
                  : ""}
              </p>
            ) : null}
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
                  정렬 (커서 줄)
                  <select
                    className="rounded bg-neutral-800 px-2 py-1"
                    value={activeBlock.align ?? "center"}
                    onChange={(e) => {
                      const align = e.target.value as "left" | "center" | "right";
                      markLocalDirty();
                      updateBlock(activeBlock.id, { align });
                    }}
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
                    onClick={removeActiveLine}
                  >
                    커서 줄 삭제
                  </button>
                ) : null}
              </div>
            ) : null}
            {activeBlock ? (
              <div className="space-y-2 border-t border-white/10 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-violet-200">
                    텍스트 효과 (드래그 선택 구간 · 미선택 시 전체)
                  </span>
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
                        onMouseDown={keepTextareaFocus}
                        onClick={() => applyEffectToSelection(opt.id as ObsTextEffectId)}
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
                글자별 색상 (선택 줄)
              </button>
            </div>
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
                onMouseDown={keepTextareaFocus}
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
