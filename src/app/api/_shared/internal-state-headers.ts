/**
 * Edge 등에서 API → 동일 오리진 `/api/state` 호출 시, 클라이언트 요청의 세션 쿠키를 넘기면
 * `?user=`만으로는 부족한 환경에서도 GET/POST가 401이 나지 않게 보조한다.
 */
export function forwardCookieHeader(req: Request): Record<string, string> {
  const cookie = req.headers.get("cookie");
  return cookie ? { Cookie: cookie } : {};
}
