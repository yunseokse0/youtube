/** DIN(toona) → youtube-git S2S ingest Bearer 검증 */
export function verifyToonaIngestAuth(req: Request):
  | { ok: true }
  | { ok: false; status: number; error: string } {
  const secret = String(process.env.TOONA_INGEST_SECRET || "").trim();
  if (!secret) {
    return { ok: false, status: 503, error: "ingest_secret_not_configured" };
  }
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== secret) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true };
}
