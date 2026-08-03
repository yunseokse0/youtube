/** 후원 메시지·멤버명 비교용 정규화(소문자·한글·영숫자만) */
export function normalizeComparableName(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^가-힣a-z0-9]/g, "");
}

const HONORIFIC_SUFFIXES = ["님", "군", "양", "씨", "형", "누나", "오빠", "언니", "선배", "후배"];

/** `피자님` → `피자` 등 호칭 제거 */
export function stripHonorificSuffix(name: string): string {
  let s = normalizeComparableName(name);
  if (!s) return s;
  for (const suf of HONORIFIC_SUFFIXES) {
    const n = normalizeComparableName(suf);
    if (n.length >= 1 && s.endsWith(n) && s.length > n.length) {
      s = s.slice(0, -n.length);
    }
  }
  return s;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) row[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** 0~1 — 1에 가까울수록 동일·유사 */
export function nameSimilarityScore(a: string, b: string): number {
  const na = stripHonorificSuffix(a);
  const nb = stripHonorificSuffix(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const minLen = Math.min(na.length, nb.length);
  const maxLen = Math.max(na.length, nb.length);
  if (minLen >= 2 && (na.includes(nb) || nb.includes(na))) {
    return 0.85 + (minLen / maxLen) * 0.15;
  }
  const dist = levenshtein(na, nb);
  return Math.max(0, 1 - dist / maxLen);
}

export const MEMBER_NAME_FUZZY_THRESHOLD = 0.72;

/** 자동 반영(엑셀표) — 미매칭 UI 제안과 동일한 완화 임계값 */
export const MEMBER_NAME_FUZZY_AUTO_APPLY_THRESHOLD = 0.62;

function effectiveFuzzyThreshold(lookupName: string, override?: number): number {
  if (typeof override === "number") return override;
  const len = stripHonorificSuffix(lookupName).length;
  if (len <= 3) return 0.65;
  if (len <= 4) return 0.68;
  return MEMBER_NAME_FUZZY_THRESHOLD;
}

export function findBestFuzzyNameMatch<TItem>(
  lookupName: string,
  candidates: { label: string; value: TItem }[],
  threshold?: number
): { item: { label: string; value: TItem }; score: number } | null {
  const minScore = effectiveFuzzyThreshold(lookupName, threshold);
  let best: { item: { label: string; value: TItem }; score: number } | null = null;
  for (const c of candidates) {
    const score = nameSimilarityScore(lookupName, c.label);
    if (score < minScore) continue;
    if (!best || score > best.score) best = { item: c, score };
  }
  return best;
}
