import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * OBS·구버전 클라이언트가 잘못 POST 하는 경로.
 * App Router RSC POST로 처리되면 502가 날 수 있어 204로 조용히 응답한다.
 * 실제 텍스트 반영은 POST /api/state + SSE state_updated + GET pick=obs-text.
 */
export async function POST() {
  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "Use GET /overlay/obs-text?u=…&host=obs&textId=… — saves go to POST /api/state",
  });
}
