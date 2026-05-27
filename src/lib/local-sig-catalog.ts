export type LocalSigPriceSource =
  | "live"
  | "ocr"
  | "filename"
  | "live-remote"
  | "override"
  | "local";

export type LocalSigCatalogEntry = {
  id: string;
  name: string;
  price: number;
  category?: string;
  file: string;
  imageUrl: string;
  /** 서버에 저장된 원본 경로(있을 때) */
  imageUrlStored?: string;
  /** 이름·가격 출처 */
  priceSource?: LocalSigPriceSource;
  /** 라이브 sigInventory id (있을 때) */
  liveSigId?: string;
};

/** 카탈로그 JSON — 라이브만 사용 시 imageBaseUrl 로 상대 경로 이미지 해석 */
export function resolveLocalSigImageSrc(
  imageUrl: string,
  imageBaseUrl?: string | null
): string {
  const raw = String(imageUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = String(imageBaseUrl || "").replace(/\/$/, "");
  if (base && raw.startsWith("/")) return `${base}${raw}`;
  return raw;
}

function pushUnique(urls: string[], url: string) {
  const s = String(url || "").trim();
  if (!s) return;
  if (!urls.includes(s)) urls.push(s);
}

/** 라이브 DB 로마자·오타 → public/images/sigs/from-drive 파일명 */
export const LOCAL_SIG_FROM_DRIVE_ALIASES: Record<string, string[]> = {
  um: ["음"],
};

function pushFromDriveNameCandidates(urls: string[], baseName: string) {
  const n = String(baseName || "").trim();
  if (!n) return;
  for (const ext of [".gif", ".GIF", ".png", ".PNG", ".webp"]) {
    pushUnique(urls, `/images/sigs/from-drive/${encodeURIComponent(n + ext)}`);
  }
}

export function localSigFromDriveLookupNames(name: string): string[] {
  const primary = String(name || "").trim();
  if (!primary) return [];
  const aliases = LOCAL_SIG_FROM_DRIVE_ALIASES[primary.toLowerCase()] || [];
  return [primary, ...aliases.filter((a) => a !== primary)];
}

function isLikelyUploadHashFile(file: string): boolean {
  const f = String(file || "").trim();
  if (!f) return false;
  // 예: 1779276825060_962d974f.gif
  return /^\d+_[a-f0-9]{6,}\.(gif|png|webp)$/i.test(f);
}

/**
 * 로컬 dev: EC2 /uploads 가 안 뜰 때 public/images/sigs/from-drive 를 순서대로 시도
 */
export function resolveLocalSigImageCandidates(
  item: LocalSigCatalogEntry,
  imageBaseUrl?: string | null
): string[] {
  const urls: string[] = [];
  const stored = String(item.imageUrlStored || item.imageUrl || "").trim();
  const rawImageUrl = String(item.imageUrl || "").trim();
  const name = String(item.name || "").trim();
  const file = String(item.file || "").trim();
  const uploadPath =
    stored.startsWith("/uploads/")
      ? stored
      : rawImageUrl.startsWith("/uploads/")
        ? rawImageUrl
        : "";
  const looksLikeLiveUpload =
    Boolean(uploadPath) || /^https?:\/\/[^/]+\/uploads\//i.test(stored) || /^https?:\/\/[^/]+\/uploads\//i.test(rawImageUrl);

  // 1) 라이브 업로드 항목은 프록시를 먼저 시도 (브라우저 직접 외부 접근보다 안정적)
  if (name && uploadPath) {
    const q = new URLSearchParams({ name, path: uploadPath });
    if (imageBaseUrl) q.set("base", String(imageBaseUrl).replace(/\/$/, ""));
    pushUnique(urls, `/api/local/sig-image?${q.toString()}`);
  }

  // 2) 로컬 from-drive 후보는 "로컬 파일형" 항목에서만 시도
  if (!looksLikeLiveUpload) {
    if (file.includes("/from-drive/")) {
      pushUnique(urls, file.startsWith("/") ? file : `/${file}`);
    } else if (file && !file.includes("/") && !isLikelyUploadHashFile(file)) {
      pushUnique(urls, `/images/sigs/from-drive/${encodeURIComponent(file)}`);
    }
    if (!isLikelyUploadHashFile(file)) {
      for (const driveName of localSigFromDriveLookupNames(name)) {
        pushFromDriveNameCandidates(urls, driveName);
      }
    }
  }

  // 3) EC2 /uploads 직접
  pushUnique(urls, resolveLocalSigImageSrc(stored, imageBaseUrl));
  pushUnique(urls, resolveLocalSigImageSrc(rawImageUrl, imageBaseUrl));

  return urls;
}

export function isRemoteSigImageSrc(src: string): boolean {
  return /^https?:\/\//i.test(String(src || "").trim());
}

export type LocalSigPriceBucket =
  | "all"
  | "unpriced"
  | "under10k"
  | "10k-20k"
  | "20k-30k"
  | "over30k";

export const LOCAL_SIG_PAGE_SIZE = 20;

export const LOCAL_SIG_PRICE_TABS: { id: LocalSigPriceBucket; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "unpriced", label: "0원·미설정" },
  { id: "under10k", label: "1만 원 이하" },
  { id: "10k-20k", label: "1~2만 원" },
  { id: "20k-30k", label: "2~3만 원" },
  { id: "over30k", label: "3만 원 초과" },
];

export function localSigPriceSourceLabel(
  source: LocalSigPriceSource | undefined
): string {
  switch (source) {
    case "live":
      return "라이브 DB (sigInventory)";
    case "live-remote":
      return "라이브 DB (원격 이미지)";
    case "override":
      return "사용자 직접 수정";
    case "local":
      return "로컬 추가";
    case "ocr":
      return "OCR (sig-ocr-results.json)";
    case "filename":
      return "파일명 추정";
    default:
      return "";
  }
}

export function formatLocalSigPrice(price: number): string {
  const n = Math.max(0, Math.floor(Number(price) || 0));
  if (n <= 0) return "0원 · 미설정";
  return `${n.toLocaleString("ko-KR")}원`;
}

export function isLocalSigUnpriced(price: number): boolean {
  return Math.max(0, Math.floor(Number(price) || 0)) <= 0;
}

export function getLocalSigPriceBucket(price: number): LocalSigPriceBucket {
  const p = Math.max(0, Math.floor(Number(price) || 0));
  if (p <= 0) return "unpriced";
  if (p <= 10_000) return "under10k";
  if (p <= 20_000) return "10k-20k";
  if (p <= 30_000) return "20k-30k";
  return "over30k";
}

export function matchesLocalSigPriceBucket(price: number, bucket: LocalSigPriceBucket): boolean {
  if (bucket === "all") return true;
  if (bucket === "unpriced") return isLocalSigUnpriced(price);
  return getLocalSigPriceBucket(price) === bucket;
}

export function getLocalSigCardBorderClass(price: number): string {
  const bucket = getLocalSigPriceBucket(price);
  switch (bucket) {
    case "unpriced":
      return "border-red-500/70 shadow-[0_0_12px_rgba(239,68,68,0.25)] ring-1 ring-red-400/40";
    case "under10k":
      return "border-emerald-400/55 shadow-[0_0_12px_rgba(52,211,153,0.2)]";
    case "10k-20k":
      return "border-sky-400/55 shadow-[0_0_12px_rgba(56,189,248,0.2)]";
    case "20k-30k":
      return "border-violet-400/55 shadow-[0_0_12px_rgba(167,139,250,0.2)]";
    case "over30k":
      return "border-amber-400/60 shadow-[0_0_14px_rgba(251,191,36,0.28)]";
    default:
      return "border-white/20";
  }
}

export function filterLocalSigCatalog(
  items: LocalSigCatalogEntry[],
  opts: { query: string; bucket: LocalSigPriceBucket }
): LocalSigCatalogEntry[] {
  const q = opts.query.trim().toLowerCase();
  return items.filter((item) => {
    if (!matchesLocalSigPriceBucket(item.price, opts.bucket)) return false;
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.file.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q)
    );
  });
}

export function paginateLocalSigCatalog<T>(items: T[], page: number, pageSize = LOCAL_SIG_PAGE_SIZE): {
  pageItems: T[];
  totalPages: number;
  safePage: number;
} {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    pageItems: items.slice(start, start + pageSize),
    totalPages,
    safePage,
  };
}
