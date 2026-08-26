/** 지급 정산서 로고·감사문구 — 계정(userId)별 저장 */

export const SETTLEMENT_LOGO_KEY = "excel-broadcast-settlement-logo-v1";
export const SETTLEMENT_STATEMENT_TEXT_KEY = "excel-broadcast-settlement-statement-text-v1";

/** 지급정산서 하단 기본 문구 */
export const DEFAULT_SETTLEMENT_THANK_YOU = "파이팅 넘치는 스트리머의 노고에 감사드립니다";
/** 회사명을 알 수 없을 때만 쓰는 구형 기본값(신규 계정은 회사명 사용) */
export const DEFAULT_SETTLEMENT_ISSUER_LINE = "BT STUDIO 대장 BT태호 이동환";

export type SettlementStatementText = {
  thankYouMessage: string;
  issuerLine: string;
};

/** 회원가입(계정) 회사명 → 지급정산서 발행자 줄 */
export function buildSettlementIssuerLineFromCompanyName(companyName: string): string {
  return String(companyName || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function defaultSettlementStatementText(companyName?: string | null): SettlementStatementText {
  const issuerFromCompany = buildSettlementIssuerLineFromCompanyName(companyName || "");
  return {
    thankYouMessage: DEFAULT_SETTLEMENT_THANK_YOU,
    issuerLine: issuerFromCompany || DEFAULT_SETTLEMENT_ISSUER_LINE,
  };
}

export function settlementLogoStorageKey(userId?: string | null): string {
  if (!userId) throw new Error("정산서 로고는 계정별로 저장됩니다. 로그인이 필요합니다.");
  return `${SETTLEMENT_LOGO_KEY}:${userId}`;
}

export function settlementStatementTextStorageKey(userId?: string | null): string {
  if (!userId) throw new Error("정산서 문구는 계정별로 저장됩니다. 로그인이 필요합니다.");
  return `${SETTLEMENT_STATEMENT_TEXT_KEY}:${userId}`;
}

export function normalizeSettlementStatementText(
  input: Partial<SettlementStatementText> | null | undefined,
  companyName?: string | null
): SettlementStatementText {
  const defaults = defaultSettlementStatementText(companyName);
  const thankYouRaw = String(input?.thankYouMessage ?? "").trim();
  const issuerRaw = String(input?.issuerLine ?? "").trim();
  const thankYouIsLegacy = !thankYouRaw || thankYouRaw === DEFAULT_SETTLEMENT_THANK_YOU;
  const issuerIsLegacy = !issuerRaw || issuerRaw === DEFAULT_SETTLEMENT_ISSUER_LINE;
  return {
    thankYouMessage: thankYouIsLegacy ? defaults.thankYouMessage : thankYouRaw,
    issuerLine: issuerIsLegacy ? defaults.issuerLine : issuerRaw,
  };
}

export function loadSettlementStatementText(
  userId?: string | null,
  companyName?: string | null
): SettlementStatementText {
  const defaults = defaultSettlementStatementText(companyName);
  if (typeof window === "undefined" || !userId) return defaults;
  try {
    const raw = window.localStorage.getItem(settlementStatementTextStorageKey(userId));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<SettlementStatementText>;
    return normalizeSettlementStatementText(parsed, companyName);
  } catch {
    return defaults;
  }
}

export function saveSettlementStatementText(
  text: Partial<SettlementStatementText>,
  userId?: string | null,
  companyName?: string | null
): SettlementStatementText {
  if (typeof window === "undefined") return normalizeSettlementStatementText(text, companyName);
  if (!userId) throw new Error("정산서 문구는 계정별로 저장됩니다. 로그인이 필요합니다.");
  const normalized = normalizeSettlementStatementText(text, companyName);
  try {
    window.localStorage.setItem(
      settlementStatementTextStorageKey(userId),
      JSON.stringify(normalized)
    );
  } catch {
    throw new Error("정산서 문구 저장에 실패했습니다.");
  }
  return normalized;
}

export async function fetchSettlementStatementTextFromApi(
  userId: string,
  companyName?: string | null
): Promise<SettlementStatementText> {
  const local = loadSettlementStatementText(userId, companyName);
  const defaults = defaultSettlementStatementText(companyName);
  const localCustomized =
    local.thankYouMessage !== defaults.thankYouMessage ||
    local.issuerLine !== defaults.issuerLine;
  try {
    const res = await fetch(
      `/api/settlements/statement-text?user=${encodeURIComponent(userId)}&_t=${Date.now()}`,
      { cache: "no-store", credentials: "include" }
    );
    if (!res.ok) return local;
    const data = (await res.json()) as Partial<SettlementStatementText> & { saved?: boolean };
    const fromServer = normalizeSettlementStatementText(
      {
        thankYouMessage:
          typeof data.thankYouMessage === "string" ? data.thankYouMessage : local.thankYouMessage,
        issuerLine: typeof data.issuerLine === "string" ? data.issuerLine : local.issuerLine,
      },
      companyName
    );
    const normalized =
      data.saved === true ? fromServer : localCustomized ? local : fromServer;
    try {
      saveSettlementStatementText(normalized, userId, companyName);
    } catch {}
    if (data.saved !== true && localCustomized) {
      void saveSettlementStatementTextToApi(local, userId, companyName);
    }
    return normalized;
  } catch {
    return local;
  }
}

export async function saveSettlementStatementTextToApi(
  text: Partial<SettlementStatementText>,
  userId: string,
  companyName?: string | null
): Promise<{ ok: boolean; text: SettlementStatementText }> {
  const normalized = saveSettlementStatementText(text, userId, companyName);
  try {
    const res = await fetch(`/api/settlements/statement-text?user=${encodeURIComponent(userId)}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalized),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    const ok = res.ok && data?.ok !== false;
    return { ok, text: normalized };
  } catch {
    return { ok: false, text: normalized };
  }
}

export async function resolveSettlementStatementText(
  userId?: string | null,
  companyName?: string | null
): Promise<SettlementStatementText> {
  if (!userId) return defaultSettlementStatementText(companyName);
  return fetchSettlementStatementTextFromApi(userId, companyName);
}

export function loadSettlementLogoDataUrl(userId?: string | null): string | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const raw = window.localStorage.getItem(settlementLogoStorageKey(userId));
    if (!raw || !raw.startsWith("data:image/")) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveSettlementLogoDataUrl(dataUrl: string | null, userId?: string | null): void {
  if (typeof window === "undefined") return;
  if (!userId) throw new Error("정산서 로고는 계정별로 저장됩니다. 로그인이 필요합니다.");
  const key = settlementLogoStorageKey(userId);
  try {
    if (!dataUrl) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, dataUrl);
  } catch {
    throw new Error("로고 저장에 실패했습니다. 더 작은 이미지를 사용해 주세요.");
  }
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    img.src = src;
  });
}

/** 업로드 파일을 정산서용 data URL로 변환(최대 360px, PNG) */
export async function fileToSettlementLogoDataUrl(file: File, maxSide = 360): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 업로드할 수 있습니다.");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("캔버스를 사용할 수 없습니다.");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** 서버에서 계정별 로고 불러와 로컬에도 캐시 */
export async function fetchSettlementLogoFromApi(userId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/settlements/logo?user=${encodeURIComponent(userId)}&_t=${Date.now()}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return loadSettlementLogoDataUrl(userId);
    const data = (await res.json()) as { dataUrl?: string | null };
    const url = typeof data?.dataUrl === "string" && data.dataUrl.startsWith("data:image/") ? data.dataUrl : null;
    if (url) {
      try {
        saveSettlementLogoDataUrl(url, userId);
      } catch {}
    }
    return url;
  } catch {
    return loadSettlementLogoDataUrl(userId);
  }
}

export async function saveSettlementLogoToApi(dataUrl: string, userId: string): Promise<boolean> {
  saveSettlementLogoDataUrl(dataUrl, userId);
  try {
    const res = await fetch(`/api/settlements/logo?user=${encodeURIComponent(userId)}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteSettlementLogoFromApi(userId: string): Promise<boolean> {
  saveSettlementLogoDataUrl(null, userId);
  try {
    const res = await fetch(`/api/settlements/logo?user=${encodeURIComponent(userId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 이 계정의 로고만 사용(공용 기본 로고 없음) */
export async function resolveSettlementLogoDataUrl(userId?: string | null): Promise<string | null> {
  if (!userId) return null;
  const stored = loadSettlementLogoDataUrl(userId);
  if (stored) return stored;
  return fetchSettlementLogoFromApi(userId);
}
