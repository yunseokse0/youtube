"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  filterLocalSigCatalog,
  formatLocalSigPrice,
  localSigPriceSourceLabel,
  getLocalSigCardBorderClass,
  LOCAL_SIG_PAGE_SIZE,
  LOCAL_SIG_PRICE_TABS,
  paginateLocalSigCatalog,
  isRemoteSigImageSrc,
  resolveLocalSigImageCandidates,
  resolveLocalSigImageSrc,
  type LocalSigCatalogEntry,
  type LocalSigPriceBucket,
} from "@/lib/local-sig-catalog";
import {
  buildLocalSigEntryFromFileName,
  collectDuplicateItemIds,
  findLocalSigDuplicateGroups,
  listFromDriveFilesNotInCatalog,
} from "@/lib/local-sig-dedup";

type CatalogLiveMeta = {
  via?: "file" | "api" | "none";
  source?: string | null;
  inventoryCount?: number;
  matchedOnDisk?: number;
  fetchError?: string | null;
};

type CatalogPayload = {
  generatedAt?: string;
  count?: number;
  imageBaseUrl?: string;
  items: LocalSigCatalogEntry[];
  live?: CatalogLiveMeta;
};

type LocalSigSortMode = "priceAsc" | "nameAsc";
type LocalSigViewMode = "capture" | "compact";
type LocalSigOverride = { name: string; price: number };

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function parseSigPriceInput(raw: string): number {
  const src = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/원/g, "")
    .replace(/대/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "");
  if (!src) return 0;

  const unitMatch = src.match(/^(\d+(?:\.\d+)?)(만|천|백)$/);
  if (unitMatch) {
    const n = Number(unitMatch[1]) || 0;
    const unit = unitMatch[2];
    const mul = unit === "만" ? 10_000 : unit === "천" ? 1_000 : 100;
    return Math.max(0, Math.floor(n * mul));
  }

  // "8만원대", "10만초반", "9.5만근처" 같이 단위 뒤에 텍스트가 붙는 입력 허용
  const unitPrefix = src.match(/(\d+(?:\.\d+)?)(만|천|백)/);
  if (unitPrefix) {
    const n = Number(unitPrefix[1]) || 0;
    const unit = unitPrefix[2];
    const mul = unit === "만" ? 10_000 : unit === "천" ? 1_000 : 100;
    return Math.max(0, Math.floor(n * mul));
  }

  const digits = src.replace(/[^\d]/g, "");
  return Math.max(0, Math.floor(Number(digits) || 0));
}

const DATA_URL = "/data/local-sigs.json";
const SIG_PLACEHOLDER_SRC = "/images/sigs/dummy-sig.svg";
const FROM_DRIVE_API = "/api/local/sig-from-drive";
const LOGO_SRC = "/images/branding/final-castle-logo.png";
const BG_SRC = "/images/branding/final-castle-bg.png";

function CaptureBrandHeader({ logoOk, onLogoError }: { logoOk: boolean; onLogoError: () => void }) {
  return (
    <header className="mb-5 border-b border-amber-900/10 pb-5 text-center">
      {logoOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={LOGO_SRC}
          alt="Final Castle"
          className="mx-auto mb-3 h-32 w-auto max-w-[320px] object-contain drop-shadow-md"
          onError={onLogoError}
        />
      ) : (
        <div className="mx-auto mb-3 flex h-24 w-24 items-center justify-center rounded-full border-2 border-amber-700/40 bg-amber-100/50 text-4xl">
          🏛
        </div>
      )}
      <h2
        className="text-xl font-bold tracking-wide sm:text-2xl"
        style={{
          fontFamily: "Georgia, 'Times New Roman', serif",
          color: "#8b6914",
        }}
      >
        Final Castle
      </h2>
    </header>
  );
}
const LS_ADDITIONS = "local-sig-manager-additions-v1";
const LS_OVERRIDES = "local-sig-manager-overrides-v1";
/** 캡처용: 유튜브 업로드 기준 최대 페이지 수 */
const CAPTURE_PAGE_LIMIT = 10;

function SigCatalogImage({
  item,
  imageBaseUrl,
  className,
  alt,
}: {
  item: LocalSigCatalogEntry;
  imageBaseUrl: string;
  className?: string;
  alt: string;
}) {
  const candidates = useMemo(
    () => resolveLocalSigImageCandidates(item, imageBaseUrl || null),
    [item, imageBaseUrl]
  );
  const [idx, setIdx] = useState(0);
  const candidatesKey = candidates.join("\0");

  useEffect(() => {
    setIdx(0);
  }, [item.id, candidatesKey]);

  const src = candidates[idx] || "";
  const remote = isRemoteSigImageSrc(src);
  const exhausted = idx >= candidates.length && candidates.length > 0;

  if (!src && !exhausted) {
    return (
      <div className={`flex items-center justify-center bg-black/10 text-[10px] text-amber-900/50 ${className || ""}`}>
        NO IMAGE
      </div>
    );
  }

  if (exhausted) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 bg-black/10 text-center text-[10px] font-semibold text-amber-900/60 ${className || ""}`}
        title={`이미지 없음 — public/images/sigs/from-drive/${alt}.gif 또는 업로드 파일을 넣어 주세요`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={SIG_PLACEHOLDER_SRC} alt="" className="h-10 w-10 opacity-40" />
        <span>이미지 없음</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      crossOrigin={remote ? "anonymous" : undefined}
      onError={() => {
        setIdx((i) => (i + 1 < candidates.length ? i + 1 : candidates.length));
      }}
    />
  );
}

function isLocalAddedItem(item: LocalSigCatalogEntry): boolean {
  return item.priceSource === "local" || item.id.startsWith("local_add_");
}

function AddSigModal({
  onClose,
  onAdd,
  imageBaseUrl,
}: {
  onClose: () => void;
  onAdd: (entry: LocalSigCatalogEntry) => void;
  imageBaseUrl: string;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [imageUrl, setImageUrl] = useState("/images/sigs/from-drive/");
  const parsedPrice = parseSigPriceInput(price);

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const p = parsedPrice;
    let url = imageUrl.trim();
    if (url && !url.startsWith("/") && !/^https?:\/\//i.test(url)) {
      url = `/images/sigs/from-drive/${encodeURIComponent(url)}`;
    }
    const file = url.split("/").pop() || n;
    onAdd({
      id: `local_add_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: n,
      price: p,
      category: "",
      file: safeDecodeURIComponent(file),
      imageUrl: url || `/images/sigs/from-drive/${encodeURIComponent(`${n}.gif`)}`,
      priceSource: "local",
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-amber-200/30 bg-[#2f281f] p-5 text-amber-50"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold">시그 로컬 추가</h2>
        <label className="mb-1 block text-xs text-amber-200/80">이름</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded border border-white/20 bg-black/30 px-2 py-1.5 text-sm"
          placeholder="예: 콩나물"
        />
        <label className="mb-1 block text-xs text-amber-200/80">가격(원)</label>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="mb-3 w-full rounded border border-white/20 bg-black/30 px-2 py-1.5 text-sm"
          placeholder="예: 100000 또는 10만"
        />
        <p className={`mb-3 text-xs ${parsedPrice > 0 ? "text-emerald-300/90" : "text-red-300/90"}`}>
          저장될 금액: {parsedPrice > 0 ? `${parsedPrice.toLocaleString("ko-KR")}원` : "0원 (입력 확인 필요)"}
        </p>
        <label className="mb-1 block text-xs text-amber-200/80">이미지 경로 또는 URL</label>
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          className="mb-1 w-full rounded border border-white/20 bg-black/30 px-2 py-1.5 text-sm"
          placeholder="/images/sigs/from-drive/이름.gif"
        />
        <p className="mb-4 text-[10px] text-amber-200/50">
          파일명만 입력해도 됩니다. 이미지 서버: {imageBaseUrl || "(상대 경로)"}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded border border-white/20 py-2 text-sm"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim()}
            className="flex-1 rounded bg-emerald-700 py-2 text-sm font-semibold disabled:opacity-40"
          >
            추가
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportFromDriveModal({
  files,
  loading,
  onClose,
  onImport,
}: {
  files: string[];
  loading: boolean;
  onClose: () => void;
  onImport: (selected: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(files));

  useEffect(() => {
    setSelected(new Set(files));
  }, [files]);

  const toggle = (f: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-amber-200/30 bg-[#2f281f] p-5 text-amber-50"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-lg font-bold">from-drive 누락 시그</h2>
        <p className="mb-3 text-xs text-amber-200/70">
          라이브 카탈로그에 없는 로컬 GIF {files.length}개 (가격 0원 — 상세에서 수정)
        </p>
        {loading ? (
          <p className="py-8 text-center text-sm">목록 불러오는 중…</p>
        ) : files.length === 0 ? (
          <p className="py-8 text-center text-sm">누락 파일 없음</p>
        ) : (
          <ul className="mb-4 flex-1 overflow-y-auto rounded border border-white/10 bg-black/20 p-2 text-xs">
            {files.map((f) => (
              <li key={f} className="flex items-center gap-2 border-b border-white/5 py-1.5 last:border-0">
                <input
                  type="checkbox"
                  checked={selected.has(f)}
                  onChange={() => toggle(f)}
                />
                <span className="break-all">{f}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded border border-white/20 py-2 text-sm">
            닫기
          </button>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => onImport([...selected])}
            className="flex-1 rounded bg-emerald-700 py-2 text-sm font-semibold disabled:opacity-40"
          >
            {selected.size}개 추가
          </button>
        </div>
      </div>
    </div>
  );
}

function SigDetailModal({
  item,
  imageBaseUrl,
  imageSrc,
  onClose,
  onSave,
  onDeleteLocal,
  hasOverride,
}: {
  item: LocalSigCatalogEntry;
  imageBaseUrl: string;
  imageSrc: string;
  onClose: () => void;
  onSave: (patch: LocalSigOverride) => void;
  onDeleteLocal?: () => void;
  hasOverride: boolean;
}) {
  const [nameInput, setNameInput] = useState(item.name);
  const [priceInput, setPriceInput] = useState(String(item.price || 0));

  useEffect(() => {
    setNameInput(item.name);
    setPriceInput(String(item.price || 0));
  }, [item]);

  const submit = () => {
    const nextName = nameInput.trim();
    const nextPrice = parseSigPriceInput(priceInput);
    if (!nextName) return;
    onSave({ name: nextName, price: nextPrice });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-amber-200/30 bg-[#2f281f] p-5 text-amber-50 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-amber-100">{item.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/20 px-2 py-0.5 text-xs hover:bg-white/10"
          >
            닫기
          </button>
        </div>
        <div className="mb-4 overflow-hidden rounded-lg border border-white/15 bg-black/40">
          <SigCatalogImage
            item={item}
            imageBaseUrl={imageBaseUrl}
            alt={item.name}
            className="mx-auto max-h-64 w-full object-contain"
          />
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-amber-200/70">가격</dt>
            <dd className="font-bold tabular-nums">{formatLocalSigPrice(item.price)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-amber-200/70">파일</dt>
            <dd className="break-all text-right text-xs">{item.file}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-amber-200/70">ID</dt>
            <dd className="break-all text-right text-xs text-neutral-400">{item.id}</dd>
          </div>
          {item.category ? (
            <div className="flex justify-between gap-4">
              <dt className="text-amber-200/70">카테고리</dt>
              <dd>{item.category}</dd>
            </div>
          ) : null}
          {item.priceSource ? (
            <div className="flex justify-between gap-4">
              <dt className="text-amber-200/70">이름·가격</dt>
              <dd className="text-right text-xs text-amber-100/90">
                {localSigPriceSourceLabel(item.priceSource)}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-4 rounded-lg border border-white/15 bg-black/25 p-3">
          <p className="mb-2 text-xs font-semibold text-amber-100">
            이름/가격 직접 설정 {hasOverride ? "(사용자 설정 적용됨)" : ""}
          </p>
          <label className="mb-2 block text-xs text-amber-200/80">이름</label>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            className="mb-3 w-full rounded border border-white/20 bg-black/30 px-2 py-1.5 text-sm text-amber-50 outline-none focus:border-amber-400"
            placeholder="시그 이름"
          />
          <label className="mb-2 block text-xs text-amber-200/80">가격(원)</label>
          <input
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            className="w-full rounded border border-white/20 bg-black/30 px-2 py-1.5 text-sm text-amber-50 outline-none focus:border-amber-400"
            placeholder="예: 23000 또는 2.3만"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!nameInput.trim()}
            className="mt-3 w-full rounded bg-emerald-700/90 py-2 text-sm font-semibold hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            이 값으로 저장
          </button>
          {onDeleteLocal ? (
            <button
              type="button"
              onClick={() => {
                onDeleteLocal();
                onClose();
              }}
              className="mt-2 w-full rounded border border-red-400/50 bg-red-900/40 py-2 text-sm font-semibold text-red-100 hover:bg-red-900/60"
            >
              로컬 추가 항목 삭제
            </button>
          ) : null}
        </div>
        <a
          href={imageSrc}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 block w-full rounded-lg bg-amber-700/90 py-2 text-center text-sm font-semibold hover:bg-amber-600"
        >
          이미지 새 탭에서 열기
        </a>
      </div>
    </div>
  );
}

export default function SigManagerClient() {
  const [items, setItems] = useState<LocalSigCatalogEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<LocalSigPriceBucket>("all");
  const [sortMode, setSortMode] = useState<LocalSigSortMode>("priceAsc");
  const [viewMode, setViewMode] = useState<LocalSigViewMode>("capture");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<LocalSigCatalogEntry | null>(null);
  const [liveMeta, setLiveMeta] = useState<CatalogLiveMeta | null>(null);
  const [imageBaseUrl, setImageBaseUrl] = useState<string>("");
  const [logoOk, setLogoOk] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, LocalSigOverride>>({});
  const [localAdditions, setLocalAdditions] = useState<LocalSigCatalogEntry[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFiles, setImportFiles] = useState<string[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [showDupPanel, setShowDupPanel] = useState(false);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const [isSavingExcel, setIsSavingExcel] = useState(false);
  const [isDeduping, setIsDeduping] = useState(false);
  const captureRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawOv = window.localStorage.getItem(LS_OVERRIDES);
      if (rawOv) {
        const parsed = JSON.parse(rawOv) as Record<string, LocalSigOverride>;
        if (parsed && typeof parsed === "object") setOverrides(parsed);
      }
      const rawAdd = window.localStorage.getItem(LS_ADDITIONS);
      if (rawAdd) {
        const parsed = JSON.parse(rawAdd) as LocalSigCatalogEntry[];
        if (Array.isArray(parsed)) setLocalAdditions(parsed);
      }
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LS_OVERRIDES, JSON.stringify(overrides));
  }, [overrides]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LS_ADDITIONS, JSON.stringify(localAdditions));
  }, [localAdditions]);

  const reloadCatalog = useCallback(async () => {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as CatalogPayload;
    setItems(Array.isArray(data.items) ? data.items : []);
    setLiveMeta(data.live ?? null);
    setImageBaseUrl(String(data.imageBaseUrl || "").trim());
    setLoadError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reloadCatalog();
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "load failed");
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadCatalog]);

  const dedupeLiveInventory = useCallback(
    async (strategy: "nameAndPrice" | "imageUrl") => {
      if (isDeduping) return;
      const label = strategy === "imageUrl" ? "URL·이름" : "이름+가격";
      if (
        !window.confirm(
          `data/sig-inventory-live.json 에서 중복을 제거합니다 (${label}).\n목록 순서상 첫 행만 남깁니다. 계속할까요?`
        )
      ) {
        return;
      }
      setIsDeduping(true);
      try {
        const res = await fetch("/api/local/sig-dedupe-inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategy }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          removedCount?: number;
          before?: number;
          after?: number;
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        await reloadCatalog();
        setShowDuplicatesOnly(false);
        setPage(1);
        alert(
          data.removedCount
            ? `중복 ${data.removedCount}건 제거 (${data.before} → ${data.after}개). 카탈로그를 새로 불러왔습니다.`
            : "중복된 행이 없습니다."
        );
      } catch (e) {
        alert(e instanceof Error ? e.message : "중복 제거에 실패했습니다.");
      } finally {
        setIsDeduping(false);
      }
    },
    [isDeduping, reloadCatalog]
  );

  const catalogItems = useMemo(
    () => [...items, ...localAdditions],
    [items, localAdditions]
  );

  const displayItems = useMemo(
    () =>
      catalogItems.map((item) => {
        const ov = overrides[item.id];
        if (!ov) return item;
        return {
          ...item,
          name: ov.name,
          price: ov.price,
          priceSource: isLocalAddedItem(item) ? ("local" as const) : ("override" as const),
        };
      }),
    [catalogItems, overrides]
  );

  const duplicateGroups = useMemo(
    () => findLocalSigDuplicateGroups(displayItems),
    [displayItems]
  );

  const duplicateIdSet = useMemo(
    () => collectDuplicateItemIds(duplicateGroups),
    [duplicateGroups]
  );

  const filtered = useMemo(() => {
    let list = displayItems;
    if (showDuplicatesOnly) {
      list = list.filter((item) => duplicateIdSet.has(item.id));
      const q = query.trim().toLowerCase();
      if (q) {
        list = list.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            item.file.toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q)
        );
      }
      return list;
    }
    return filterLocalSigCatalog(list, { query, bucket });
  }, [displayItems, query, bucket, showDuplicatesOnly, duplicateIdSet]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sortMode === "priceAsc") {
        const dp = (a.price || 0) - (b.price || 0);
        if (dp !== 0) return dp;
        return a.name.localeCompare(b.name, "ko");
      }
      // nameAsc
      return a.name.localeCompare(b.name, "ko");
    });
    return arr;
  }, [filtered, sortMode]);

  const capturePageSize = useMemo(() => {
    if (sorted.length <= 0) return 1;
    return Math.max(1, Math.ceil(sorted.length / CAPTURE_PAGE_LIMIT));
  }, [sorted.length]);

  const pageSize = viewMode === "capture" ? capturePageSize : LOCAL_SIG_PAGE_SIZE;
  const { pageItems, totalPages, safePage } = useMemo(
    () => paginateLocalSigCatalog(sorted, page, pageSize),
    [sorted, page, pageSize]
  );

  useEffect(() => {
    setPage(1);
  }, [query, bucket]);

  const goPage = useCallback((p: number) => {
    setPage(p);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const pageNumbers = useMemo(() => {
    const nums: number[] = [];
    const maxButtons = 7;
    let start = Math.max(1, safePage - 3);
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);
    for (let i = start; i <= end; i += 1) nums.push(i);
    return nums;
  }, [safePage, totalPages]);

  const saveOverride = useCallback((id: string, patch: LocalSigOverride) => {
    setOverrides((prev) => ({ ...prev, [id]: patch }));
  }, []);

  const resetOverrides = useCallback(() => {
    setOverrides({});
  }, []);

  const addLocalEntry = useCallback((entry: LocalSigCatalogEntry) => {
    setLocalAdditions((prev) => [...prev, entry]);
    setPage(1);
    setBucket((entry.price || 0) > 0 ? "all" : "unpriced");
  }, []);

  const removeLocalEntry = useCallback((id: string) => {
    setLocalAdditions((prev) => prev.filter((x) => x.id !== id));
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const importMissingFromDrive = useCallback(async () => {
    setShowImportModal(true);
    setImportLoading(true);
    setImportFiles([]);
    try {
      const res = await fetch(FROM_DRIVE_API, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { files?: string[] };
      const disk = Array.isArray(data.files) ? data.files : [];
      const missing = listFromDriveFilesNotInCatalog(disk, catalogItems);
      setImportFiles(missing);
    } catch (e) {
      alert(e instanceof Error ? e.message : "from-drive 목록을 불러오지 못했습니다.");
      setShowImportModal(false);
    } finally {
      setImportLoading(false);
    }
  }, [catalogItems]);

  const commitImportFiles = useCallback(
    (fileNames: string[]) => {
      const missing = listFromDriveFilesNotInCatalog(fileNames, catalogItems);
      const next = missing.map((f) => buildLocalSigEntryFromFileName(f));
      setLocalAdditions((prev) => [...prev, ...next]);
      setShowImportModal(false);
      if (next.length > 0) {
        setBucket("unpriced");
        setPage(1);
      }
    },
    [catalogItems]
  );

  const unpricedCount = useMemo(
    () => displayItems.filter((item) => (item.price || 0) <= 0).length,
    [displayItems]
  );

  const imageSrcFor = useCallback(
    (item: LocalSigCatalogEntry) => {
      const list = resolveLocalSigImageCandidates(item, imageBaseUrl || null);
      return list[0] || resolveLocalSigImageSrc(item.imageUrl, imageBaseUrl || null);
    },
    [imageBaseUrl]
  );

  const saveCurrentPageImage = useCallback(async () => {
    const target = captureRef.current;
    if (!target || isSavingImage) return;
    setIsSavingImage(true);
    try {
      target.scrollIntoView({ block: "start" });
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const { default: html2canvas } = await import("html2canvas");
      const scrollHeight = Math.ceil(target.scrollHeight);
      const scrollWidth = Math.ceil(target.scrollWidth);
      const canvas = await html2canvas(target, {
        backgroundColor: "#efe6d6",
        scale: 2,
        useCORS: true,
        height: scrollHeight,
        width: scrollWidth,
        windowHeight: scrollHeight,
        windowWidth: scrollWidth,
        scrollX: 0,
        scrollY: -window.scrollY,
        onclone: (doc) => {
          const cloned = doc.querySelector("[data-sig-capture-root]") as HTMLElement | null;
          if (!cloned) return;
          cloned.style.overflow = "visible";
          cloned.style.height = `${scrollHeight}px`;
          cloned.style.minHeight = `${scrollHeight}px`;
          cloned.querySelectorAll("article").forEach((el) => {
            (el as HTMLElement).style.overflow = "visible";
          });
        },
      });
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/jpeg", 0.95);
      a.download = `sig-list-page-${safePage}.jpg`;
      a.click();
    } catch (e) {
      console.error(e);
      alert("이미지 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSavingImage(false);
    }
  }, [isSavingImage, safePage]);

  const saveAllListExcel = useCallback(async () => {
    if (isSavingExcel) return;
    setIsSavingExcel(true);
    try {
      const sortedAll = [...displayItems].sort((a, b) => {
        if (sortMode === "priceAsc") {
          const dp = (a.price || 0) - (b.price || 0);
          if (dp !== 0) return dp;
          return a.name.localeCompare(b.name, "ko");
        }
        return a.name.localeCompare(b.name, "ko");
      });
      const rows = sortedAll.map((item, idx) => {
        const price = Math.max(0, Math.floor(Number(item.price) || 0));
        return {
          번호: idx + 1,
          이름: item.name,
          금액: price,
          표시금액: `${price.toLocaleString("ko-KR")}원`,
          ID: item.id,
          파일명: item.file,
          이미지URL: imageSrcFor(item),
          가격출처: localSigPriceSourceLabel(item.priceSource),
        };
      });
      const total = rows.reduce((sum, row) => sum + row.금액, 0);
      const avg = rows.length > 0 ? Math.round(total / rows.length) : 0;
      const summary = [
        { 항목: "시그 개수", 값: rows.length },
        { 항목: "총 금액", 값: total },
        { 항목: "평균 금액", 값: avg },
        { 항목: "라이브 개수", 값: items.length },
        { 항목: "로컬 추가 개수", 값: localAdditions.length },
        { 항목: "생성 시각", 값: new Date().toISOString() },
      ];

      const xlsx = await import("xlsx");
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(summary), "요약");
      xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(rows), "시그목록");
      xlsx.writeFile(wb, `sig-list-live-plus-local-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      console.error(e);
      alert("엑셀 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSavingExcel(false);
    }
  }, [displayItems, imageSrcFor, isSavingExcel, items.length, localAdditions.length, sortMode]);

  return (
    <main
      className="min-h-screen text-amber-950"
      style={{
        backgroundColor: "#e8dcc8",
        backgroundImage: `linear-gradient(rgba(232,220,200,0.88), rgba(210,190,160,0.92)), url('${BG_SRC}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="mx-auto max-w-6xl px-4 py-8 pb-16">
        <header className="mb-8 text-center">
          {logoOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={LOGO_SRC}
              alt="Final Castle"
              className="mx-auto mb-3 h-28 w-auto max-w-[280px] object-contain drop-shadow-md"
              onError={() => setLogoOk(false)}
            />
          ) : (
            <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full border-2 border-amber-700/40 bg-amber-100/50 text-3xl">
              🏛
            </div>
          )}
          <h1
            className="text-2xl font-bold tracking-wide sm:text-3xl"
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              color: "#8b6914",
              textShadow: "0 1px 0 rgba(255,255,255,0.5)",
            }}
          >
            Final Castle
          </h1>
          <p className="mt-1 text-sm font-medium text-amber-900/80 sm:text-base">
            Local Signature Manager
          </p>
          <p className="mt-2 text-xs text-amber-900/55">
            라이브 <code className="rounded bg-black/5 px-1">sigInventory</code> 만 사용 ·{" "}
            <code className="rounded bg-black/5 px-1">data/sig-inventory-live.json</code> →{" "}
            <code className="rounded bg-black/5 px-1">npm run sig:export-catalog</code>
          </p>
        </header>

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full sm:max-w-xs">
            <span className="sr-only">시그 이름 검색</span>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-amber-800/50">
              🔍
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="시그 이름 검색…"
              className="w-full rounded-lg border border-amber-800/20 bg-white/60 py-2.5 pl-10 pr-3 text-sm shadow-inner backdrop-blur-sm focus:border-amber-600/40 focus:outline-none focus:ring-2 focus:ring-amber-500/25"
            />
          </label>

          <div className="flex flex-wrap justify-center gap-1.5 sm:justify-end">
            {LOCAL_SIG_PRICE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setBucket(tab.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  bucket === tab.id
                    ? "bg-amber-800 text-amber-50 shadow-md"
                    : "bg-white/50 text-amber-900/80 hover:bg-white/70"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-amber-900/60">
            정렬:{" "}
            <button
              type="button"
              onClick={() => setSortMode("priceAsc")}
              className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                sortMode === "priceAsc"
                  ? "bg-amber-800 text-amber-50"
                  : "bg-white/50 text-amber-900/80 hover:bg-white/70"
              }`}
            >
              가격순(오름차순)
            </button>
            <button
              type="button"
              onClick={() => setSortMode("nameAsc")}
              className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                sortMode === "nameAsc"
                  ? "bg-amber-800 text-amber-50"
                  : "bg-white/50 text-amber-900/80 hover:bg-white/70"
              }`}
            >
              이름순
            </button>
          </p>
          <p className="text-xs text-amber-900/60">
            보기:{" "}
            <button
              type="button"
              onClick={() => setViewMode("capture")}
              className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                viewMode === "capture"
                  ? "bg-amber-800 text-amber-50"
                  : "bg-white/50 text-amber-900/80 hover:bg-white/70"
              }`}
            >
              캡처용(최대 10페이지·5열)
            </button>
            <button
              type="button"
              onClick={() => setViewMode("compact")}
              className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                viewMode === "compact"
                  ? "bg-amber-800 text-amber-50"
                  : "bg-white/50 text-amber-900/80 hover:bg-white/70"
              }`}
            >
              일반(20개/페이지)
            </button>
          </p>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="rounded border border-sky-700/35 bg-sky-700/85 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-600"
          >
            + 시그 추가
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode("compact");
              setBucket("unpriced");
              setPage(1);
            }}
            className="rounded border border-rose-700/35 bg-rose-700/85 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-600"
            title="일반 모드 + 0원/미설정 필터로 전환"
          >
            금액 설정
          </button>
          <button
            type="button"
            onClick={importMissingFromDrive}
            className="rounded border border-violet-700/35 bg-violet-700/85 px-2 py-1 text-[11px] font-semibold text-white hover:bg-violet-600"
          >
            from-drive 누락
          </button>
          <button
            type="button"
            onClick={() => setShowDupPanel((v) => !v)}
            className={`rounded border px-2 py-1 text-[11px] font-semibold ${
              duplicateGroups.length > 0
                ? "border-orange-700/40 bg-orange-600/90 text-white"
                : "border-amber-800/30 bg-white/60 text-amber-900/85"
            }`}
          >
            중복 {duplicateIdSet.size}개
          </button>
          <button
            type="button"
            onClick={resetOverrides}
            disabled={Object.keys(overrides).length === 0}
            className="rounded border border-amber-800/30 bg-white/60 px-2 py-1 text-[11px] font-semibold text-amber-900/85 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            title="이름/가격 사용자 설정 전체 초기화"
          >
            수정 초기화 ({Object.keys(overrides).length})
          </button>
          <button
            type="button"
            onClick={saveCurrentPageImage}
            disabled={isSavingImage || loading || Boolean(loadError)}
            className="rounded border border-emerald-700/40 bg-emerald-700/90 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSavingImage ? "저장 중..." : `현재 페이지 JPG 저장 (${safePage}/${totalPages})`}
          </button>
          <button
            type="button"
            onClick={saveAllListExcel}
            disabled={isSavingExcel || loading || Boolean(loadError)}
            className="rounded border border-blue-700/40 bg-blue-700/90 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            title="로컬 추가 항목 포함 전체 목록 엑셀 저장"
          >
            {isSavingExcel ? "엑셀 저장 중..." : "전체 목록 엑셀 저장(추가 포함)"}
          </button>
        </div>

        {showDupPanel ? (
          <div className="mb-5 rounded-lg border border-orange-700/30 bg-orange-50/80 p-4 text-sm text-amber-950">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">중복 검사 결과 ({duplicateGroups.length}그룹)</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isDeduping || duplicateGroups.length === 0}
                  onClick={() => dedupeLiveInventory("nameAndPrice")}
                  className="rounded border border-orange-800/40 bg-orange-700/90 px-2 py-1 text-[11px] font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isDeduping ? "제거 중…" : "이름+가격 중복 제거"}
                </button>
                <button
                  type="button"
                  disabled={isDeduping || duplicateGroups.length === 0}
                  onClick={() => dedupeLiveInventory("imageUrl")}
                  className="rounded border border-orange-800/30 bg-white/70 px-2 py-1 text-[11px] font-semibold text-orange-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                  title="이미지 URL·이름이 겹치는 행 제거"
                >
                  URL·이름 중복 제거
                </button>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={showDuplicatesOnly}
                    onChange={(e) => {
                      setShowDuplicatesOnly(e.target.checked);
                      if (e.target.checked) setBucket("all");
                      setPage(1);
                    }}
                  />
                  중복 항목만 보기
                </label>
              </div>
            </div>
            {duplicateGroups.length === 0 ? (
              <p className="text-xs text-amber-900/70">중복 없음</p>
            ) : (
              <ul className="max-h-48 space-y-2 overflow-y-auto text-xs">
                {duplicateGroups.map((g) => (
                  <li key={`${g.reason}-${g.key}`} className="rounded border border-orange-800/15 bg-white/50 p-2">
                    <span className="font-semibold text-orange-900">{g.reasonLabel}</span>
                    <span className="text-amber-900/60"> · </span>
                    {g.items.map((it, i) => (
                      <span key={it.id}>
                        {i > 0 ? ", " : ""}
                        <button
                          type="button"
                          className="underline hover:text-orange-800"
                          onClick={() => setDetail(it)}
                        >
                          {it.name} ({formatLocalSigPrice(it.price)})
                        </button>
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {loading ? (
          <p className="py-20 text-center text-amber-900/70">카탈로그 로딩…</p>
        ) : loadError ? (
          <div className="rounded-lg border border-red-400/40 bg-red-950/10 p-6 text-center text-sm text-red-900">
            <p className="font-semibold">카탈로그가 없습니다.</p>
            <p className="mt-2 text-xs">
              EC2 스냅샷을 <code className="rounded bg-black/10 px-1">data/sig-inventory-live.json</code> 에 넣고{" "}
              <code className="rounded bg-black/10 px-1">npm run sig:export-catalog</code> 후 새로고침하세요.
            </p>
            <p className="mt-1 text-xs text-red-800/70">{loadError}</p>
          </div>
        ) : (
          <>
            <div
              ref={captureRef}
              data-sig-capture-root=""
              className={`rounded-xl border border-amber-900/15 bg-[#efe6d6] ${
                viewMode === "capture" ? "mx-auto max-w-[1180px] overflow-visible p-4 pb-8 sm:p-5 sm:pb-10" : "p-3"
              }`}
            >
              {viewMode === "capture" && safePage === 1 ? (
                <CaptureBrandHeader logoOk={logoOk} onLogoError={() => setLogoOk(false)} />
              ) : null}
              {viewMode === "capture" ? (
                safePage > 1 ? (
                  <p className="mb-3 text-center text-sm font-bold text-amber-900">
                    시그 리스트 · {safePage}/{totalPages} 페이지
                  </p>
                ) : null
              ) : (
                <>
                  <p className="mb-2 text-center text-sm font-bold text-amber-900">
                    시그 리스트 · {safePage}/{totalPages} 페이지
                  </p>
                  <p className="mb-3 text-center text-xs text-amber-900/70">
                    {sorted.length}개 표시 (라이브 {items.length} + 로컬 {localAdditions.length}
                    {unpricedCount > 0 ? ` · 0원 ${unpricedCount}개` : ""}) · 페이지당 {pageSize}개
                    {unpricedCount > 0 && bucket !== "unpriced" ? (
                      <>
                        {" "}
                        ·{" "}
                        <button
                          type="button"
                          className="font-semibold text-red-700 underline"
                          onClick={() => {
                            setBucket("unpriced");
                            setPage(1);
                          }}
                        >
                          0원만 보기
                        </button>
                      </>
                    ) : null}
                  </p>
                </>
              )}
              <div
                className={`grid ${
                  viewMode === "capture"
                    ? "grid-cols-5 gap-2.5 sm:gap-3"
                    : "grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
                }`}
              >
                {pageItems.map((item) => (
                  <article
                    key={item.id}
                    className={`flex flex-col rounded-xl border-2 ${getLocalSigCardBorderClass(item.price)} ${
                      viewMode === "capture"
                        ? "overflow-visible bg-white/80"
                        : "overflow-hidden bg-white/55 backdrop-blur-sm"
                    } ${
                      viewMode !== "capture" && duplicateIdSet.has(item.id)
                        ? "ring-2 ring-orange-600 ring-offset-1"
                        : ""
                    }`}
                  >
                    <div
                      className={
                        viewMode === "capture"
                          ? "relative w-full aspect-[2/3] min-h-[120px] bg-black/5 sm:min-h-[140px]"
                          : "relative aspect-square bg-black/5"
                      }
                    >
                      <SigCatalogImage
                        item={item}
                        imageBaseUrl={imageBaseUrl}
                        alt={item.name}
                        className={
                          viewMode === "capture"
                            ? "absolute inset-0 h-full w-full object-contain"
                            : "h-full w-full object-contain p-1"
                        }
                      />
                    </div>
                    <div
                      className={`flex flex-1 flex-col gap-0.5 ${
                        viewMode === "capture" ? "px-1.5 pb-2.5 pt-1" : "gap-1 p-2"
                      }`}
                    >
                      {viewMode === "capture" ? null : (
                        <div className="flex flex-wrap justify-center gap-1">
                          {isLocalAddedItem(item) ? (
                            <span className="rounded bg-sky-700/85 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              로컬
                            </span>
                          ) : null}
                          {duplicateIdSet.has(item.id) ? (
                            <span className="rounded bg-orange-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              중복
                            </span>
                          ) : null}
                          {(!item.name.trim() || item.price <= 0) && (
                            <span className="rounded bg-red-700/85 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              설정 필요
                            </span>
                          )}
                        </div>
                      )}
                      <p
                        className={`text-center font-black tabular-nums ${
                          (item.price || 0) <= 0 ? "text-red-700" : "text-amber-900"
                        } ${viewMode === "capture" ? "text-base leading-tight sm:text-lg" : "text-xs"}`}
                      >
                        {formatLocalSigPrice(item.price)}
                      </p>
                      <p
                        className={`text-center font-bold leading-snug text-amber-950 ${
                          viewMode === "capture"
                            ? "break-words text-sm sm:text-[15px]"
                            : "line-clamp-2 min-h-[2.5rem] text-[11px]"
                        }`}
                      >
                        {item.name}
                      </p>
                      {viewMode === "capture" ? null : (
                        <div className="mt-auto flex gap-1">
                          <a
                            href={imageSrcFor(item)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 rounded border border-amber-800/25 bg-amber-100/60 py-1 text-center text-[10px] font-semibold hover:bg-amber-200/70"
                          >
                            에셋 확인
                          </a>
                          <button
                            type="button"
                            onClick={() => setDetail(item)}
                            className="flex-1 rounded border border-amber-800/25 bg-white/70 py-1 text-[10px] font-semibold hover:bg-white"
                          >
                            상세
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            {viewMode === "capture" ? null : (
              <p className="mt-3 text-center text-xs text-amber-900/60">
                Lazy Loading 활성화됨
              </p>
            )}

            {pageItems.length === 0 ? (
              <p className="py-12 text-center text-sm text-amber-900/60">조건에 맞는 시그가 없습니다.</p>
            ) : null}

            <nav
              className="mt-8 flex flex-wrap items-center justify-center gap-2"
              aria-label="페이지네이션"
            >
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => goPage(safePage - 1)}
                className="rounded-lg border border-amber-800/25 bg-white/60 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              >
                이전
              </button>
              {pageNumbers.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => goPage(n)}
                  className={`min-w-[2.25rem] rounded-lg border px-2 py-1.5 text-sm font-semibold ${
                    n === safePage
                      ? "border-amber-800 bg-amber-800 text-amber-50"
                      : "border-amber-800/20 bg-white/50 hover:bg-white/80"
                  }`}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => goPage(safePage + 1)}
                className="rounded-lg border border-amber-800/25 bg-white/60 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              >
                다음
              </button>
            </nav>

            <p className="mt-6 text-center text-[11px] text-amber-900/50">
              Optimized with Lazy Loading for {items.length} signatures.
            </p>
          </>
        )}

        <footer className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-amber-900/15 pt-4 text-xs text-amber-900/60 sm:flex-row">
          <span>
            총 {displayItems.length}개 (라이브 {items.length} + 로컬 {localAdditions.length})
          </span>
          <span className="text-center sm:text-right">
            {liveMeta?.via === "api" || liveMeta?.via === "file" ? (
              <>
                라이브 DB {liveMeta.inventoryCount ?? items.length}개
                {liveMeta.via === "file" ? ` · ${liveMeta.source}` : ""}
                {imageBaseUrl ? ` · 이미지 ${imageBaseUrl}` : ""}
              </>
            ) : (
              <>라이브 스냅샷 없음 — sig:export-catalog 재실행</>
            )}
          </span>
        </footer>
      </div>

      {showAddModal ? (
        <AddSigModal
          imageBaseUrl={imageBaseUrl}
          onClose={() => setShowAddModal(false)}
          onAdd={addLocalEntry}
        />
      ) : null}

      {showImportModal ? (
        <ImportFromDriveModal
          files={importFiles}
          loading={importLoading}
          onClose={() => setShowImportModal(false)}
          onImport={commitImportFiles}
        />
      ) : null}

      {detail ? (
        <SigDetailModal
          item={detail}
          imageBaseUrl={imageBaseUrl}
          imageSrc={imageSrcFor(detail)}
          onClose={() => setDetail(null)}
          onSave={(patch) => saveOverride(detail.id, patch)}
          onDeleteLocal={
            isLocalAddedItem(detail) ? () => removeLocalEntry(detail.id) : undefined
          }
          hasOverride={Boolean(overrides[detail.id])}
        />
      ) : null}
    </main>
  );
}
