import iconv from "iconv-lite";

/**
 * 알려진 시그명 왜곡/오타/텔렉스 변환 매핑
 * - "NO BATIDR" / "NO BATID했O" / "NO BATID횄O" / "NO BATID했다" → "NO BATIDÃO"
 */
const KNOWN_CORRUPTED_SIG_NAMES: Array<{ pattern: RegExp; target: string }> = [
  { pattern: /^no\s*batid[r했횄](?:o|ao)?$/i, target: "NO BATIDÃO" },
  { pattern: /^no\s*batid(?:했다|했|횄)$/i, target: "NO BATIDÃO" },
  { pattern: /^no\s*batid$/i, target: "NO BATIDÃO" },
  { pattern: /^no\s*batidao$/i, target: "NO BATIDÃO" },
];

/**
 * UTF-8로 저장/전송된 텍스트가 Windows CP949(한국어 ANSI)로 잘못 디코딩되어
 * 깨진 외래어/베트남어/포르투갈어(Ã, Õ, Đ, đ, ă, ơ, ư 등) 모지바케를 복구합니다.
 */
export function tryRecoverCp949Mojibake(text: string): string {
  const str = String(text || "").trim();
  if (!str) return "";

  // 한글 음절(\uAC00-\uD7A3)이 없으면 CP949 모지바케 대상이 아님
  if (!/[\uAC00-\uD7A3]/.test(str)) {
    return str;
  }

  try {
    const cp949Bytes = iconv.encode(str, "cp949");
    const utf8Str = iconv.decode(cp949Bytes, "utf8");

    // 복원된 문자열이 원본과 다르고, 깨진 대체문자(\uFFFD)가 없으며,
    // 라틴-1 보충/확장 또는 베트남어 다이아크리틱(\u00C0-\u024F, \u1EA0-\u1EF9)을 복원했는지 검증
    if (
      utf8Str !== str &&
      !utf8Str.includes("\uFFFD") &&
      /[\u00C0-\u024F\u1EA0-\u1EF9]/.test(utf8Str)
    ) {
      return utf8Str;
    }
  } catch {
    // 인코딩 실패 시 원본 유지
  }

  return str;
}

/**
 * 시그니처 이름 왜곡 및 모지바케 자동 복구
 * 1. 알려진 특정 시그명 왜곡("NO BATIDR" 등) 우선 복원
 * 2. 일반 CP949 모지바케("NO BATID횄O", "Ti梳퓆g Vi沼뇍" 등) UTF-8 디코딩 복원
 */
export function repairMojibakeSigName(rawName: string): string {
  const s = String(rawName || "").trim();
  if (!s) return "";

  // 1. 알려진 매핑 확인
  for (const { pattern, target } of KNOWN_CORRUPTED_SIG_NAMES) {
    if (pattern.test(s)) {
      return target;
    }
  }

  // 2. CP949 모지바케 복원 시도
  const recovered = tryRecoverCp949Mojibake(s);
  if (recovered !== s) {
    // 복원 후 다시 알려진 매핑 확인
    for (const { pattern, target } of KNOWN_CORRUPTED_SIG_NAMES) {
      if (pattern.test(recovered)) {
        return target;
      }
    }
    return recovered;
  }

  return s;
}
