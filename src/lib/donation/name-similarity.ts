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

/** 한글 음절 → [초성, 중성, 종성] (비한글이면 null) */
function decomposeHangulSyllable(ch: string): [number, number, number] | null {
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return null;
  const s = code - 0xac00;
  return [Math.floor(s / 588), Math.floor((s % 588) / 28), s % 28];
}

/** 한 글자 유사도 — 초성 일치에 가중 (지↔자, 히↔하) */
function hangulCharSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const da = decomposeHangulSyllable(a);
  const db = decomposeHangulSyllable(b);
  if (!da || !db) return 0;
  let score = 0;
  if (da[0] === db[0]) score += 0.55;
  if (da[1] === db[1]) score += 0.3;
  if (da[2] === db[2]) score += 0.15;
  return score;
}

/** 동일 길이 한글 이름 — 초성 골격이 같으면 높은 점수 (`지히`↔`자하`) */
function hangulNameSimilarity(a: string, b: string): number {
  if (a.length !== b.length || a.length < 2) return 0;
  let sum = 0;
  let allHangul = true;
  let sameCho = true;
  for (let i = 0; i < a.length; i += 1) {
    const ca = a[i]!;
    const cb = b[i]!;
    const da = decomposeHangulSyllable(ca);
    const db = decomposeHangulSyllable(cb);
    if (!da || !db) {
      allHangul = false;
      break;
    }
    if (da[0] !== db[0]) sameCho = false;
    sum += hangulCharSimilarity(ca, cb);
  }
  if (!allHangul) return 0;
  const avg = sum / a.length;
  if (sameCho) return Math.max(avg, 0.72);
  return avg;
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
  const hangul = hangulNameSimilarity(na, nb);
  const dist = levenshtein(na, nb);
  let edit = Math.max(0, 1 - dist / maxLen);
  /** 2~6자 닉네임 한·두 글자 오타(홍스↔홍쓰, 이자허↔이자하) */
  if (dist === 1 && maxLen >= 2 && maxLen <= 6) {
    edit = Math.max(edit, maxLen <= 3 ? 0.72 : 0.68);
  } else if (dist === 2 && maxLen >= 3 && maxLen <= 8) {
    edit = Math.max(edit, 0.64);
  }
  return Math.max(hangul, edit);
}

export const MEMBER_NAME_FUZZY_THRESHOLD = 0.72;

/** 자동 반영(엑셀표) — 미매칭 UI 제안과 동일한 완화 임계값 */
export const MEMBER_NAME_FUZZY_AUTO_APPLY_THRESHOLD = 0.58;

function effectiveFuzzyThreshold(lookupName: string, override?: number): number {
  if (typeof override === "number") return override;
  const len = stripHonorificSuffix(lookupName).length;
  if (len <= 2) return 0.58;
  if (len <= 3) return 0.62;
  if (len <= 4) return 0.65;
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
