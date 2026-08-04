/**
 * 시그 파일명 규칙: `{금액}_{이름}.gif`
 * 예: `1,000,000_버터플라이.gif` → price 1000000, name `버터플라이`
 */

export type SigFileNameMeta = {
  /** 확장자 제외 원본 베이스명 */
  baseName: string;
  /** UI·인벤에 넣을 시그 이름(금액 접두 제거 후) */
  name: string;
  /** 파싱된 금액(없으면 0) */
  price: number;
  /** 파일명 앞부분에서 금액을 읽었는지 */
  priceFromFileName: boolean;
};

function stripExtension(fileName: string): string {
  return String(fileName || "")
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.\\/]+$/, "")
    .trim();
}

/** `1,000,000` / `1000000` / 전각 숫자·콤마 → 정수 */
export function parseSigPriceToken(raw: string): number | null {
  const src = String(raw || "")
    .trim()
    .normalize("NFKC")
    .replace(/[,\s\u00a0\u3000]/g, "")
    .replace(/원$/u, "");
  if (!src) return null;
  if (!/^\d+$/.test(src)) return null;
  const n = Number(src);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * 파일명에서 시그 이름·금액을 추출한다.
 * - `1,000,000_버터플라이` → name 버터플라이, price 1000000
 * - `버터플라이` / `04클럽춤` → name 그대로, price 0
 * - 금액이 아닌 `_` 접두(`foo_bar`)는 전체를 이름으로 둔다
 */
export function parseSigMetaFromFileName(fileName: string): SigFileNameMeta {
  const baseName = stripExtension(fileName);
  if (!baseName) {
    return { baseName: "", name: "", price: 0, priceFromFileName: false };
  }

  const us = baseName.indexOf("_");
  if (us <= 0) {
    return { baseName, name: baseName, price: 0, priceFromFileName: false };
  }

  const priceToken = baseName.slice(0, us);
  const rest = baseName.slice(us + 1).trim();
  const price = parseSigPriceToken(priceToken);
  if (price === null || !rest) {
    return { baseName, name: baseName, price: 0, priceFromFileName: false };
  }

  return {
    baseName,
    name: rest,
    price,
    priceFromFileName: true,
  };
}
