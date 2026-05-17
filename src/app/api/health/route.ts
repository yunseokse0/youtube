export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Render·모니터용 경량 헬스체크(상태 저장소·Redis 미접속) */
export async function GET() {
  return Response.json(
    {
      ok: true,
      ts: Date.now(),
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
