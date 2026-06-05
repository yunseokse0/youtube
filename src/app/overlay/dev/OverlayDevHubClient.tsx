"use client";

import { useCallback, useMemo, useState } from "react";
import {
  appendAdminPreviewEmbedToOverlayUrl,
  donorRankingsThemeToSearchParams,
  sanitizeBroadcastOverlayUrl,
} from "@/lib/overlay-params";
import { defaultState } from "@/lib/state";

type OverlayLink = {
  id: string;
  title: string;
  desc: string;
  obsPath: string;
  testPath?: string;
};

function buildObsUrl(origin: string, path: string): string {
  return sanitizeBroadcastOverlayUrl(`${origin}${path.startsWith("/") ? path : `/${path}`}`);
}

function OverlayDevCard({
  link,
  origin,
  userId,
  copiedId,
  onCopy,
}: {
  link: OverlayLink;
  origin: string;
  userId: string;
  copiedId: string | null;
  onCopy: (url: string, id: string) => void;
}) {
  const obsUrl = buildObsUrl(origin, link.obsPath.replace("{u}", encodeURIComponent(userId)));
  const previewSrc = appendAdminPreviewEmbedToOverlayUrl(
    link.obsPath.replace("{u}", encodeURIComponent(userId))
  );
  const testUrl = link.testPath
    ? buildObsUrl(origin, link.testPath.replace("{u}", encodeURIComponent(userId)))
    : null;

  return (
    <article className="rounded-xl border border-white/10 bg-neutral-900/80 p-4 space-y-3">
      <div>
        <h3 className="text-base font-bold text-white">{link.title}</h3>
        <p className="mt-1 text-xs text-neutral-400 leading-relaxed">{link.desc}</p>
      </div>
      <code className="block break-all rounded bg-black/50 px-2 py-1.5 text-[11px] text-emerald-200/90">
        {link.obsPath.replace("{u}", userId)}
      </code>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
          onClick={() => window.open(obsUrl, "_blank", "noopener,noreferrer")}
        >
          OBS용 열기
        </button>
        <button
          type="button"
          className={`rounded px-3 py-1.5 text-xs font-semibold ${
            copiedId === link.id ? "bg-emerald-600 text-white" : "bg-neutral-700 text-neutral-100 hover:bg-neutral-600"
          }`}
          onClick={() => onCopy(obsUrl, link.id)}
        >
          {copiedId === link.id ? "복사됨" : "OBS URL 복사"}
        </button>
        {testUrl ? (
          <button
            type="button"
            className="rounded border border-amber-500/40 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-950/50"
            onClick={() => window.open(testUrl, "_blank", "noopener,noreferrer")}
          >
            테스트 데이터
          </button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-lg border border-white/10 bg-black/60">
        <p className="border-b border-white/5 px-2 py-1 text-[10px] text-neutral-500">
          관리자 미리보기 (hubPreview — OBS에 이 주소 넣지 마세요)
        </p>
        <iframe
          title={link.title}
          src={previewSrc}
          className="h-[220px] w-full border-0"
          style={{ background: "transparent" }}
        />
      </div>
    </article>
  );
}

export default function OverlayDevHubClient() {
  const [userId, setUserId] = useState("finalent");
  const [zoomPct, setZoomPct] = useState("100");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  const donorThemeQ = useMemo(() => {
    const theme = defaultState().donorRankingsTheme;
    const q = donorRankingsThemeToSearchParams(theme);
    q.set("zoomPct", zoomPct);
    return q.toString();
  }, [zoomPct]);

  const links: OverlayLink[] = useMemo(
    () => [
      {
        id: "integrated",
        title: "통합 오버레이",
        desc: "미션·후원·목표 등 메인 방송 화면. host=obs 권장.",
        obsPath: `/overlay?u={u}&host=obs`,
      },
      {
        id: "donor-rankings",
        title: "후원 순위 (상위 N)",
        desc: "기존 후원 순위. 관리자 저장 테마가 서버에서 반영됩니다.",
        obsPath: `/overlay/donor-rankings?u={u}&${donorThemeQ}`,
        testPath: `/overlay/donor-rankings?u={u}&test=true&zoomPct=${zoomPct}`,
      },
      {
        id: "donor-rankings-full",
        title: "후원 순위 · 전체 (분홍)",
        desc: "전체 후원자 목록 + 분홍 테마. 기존 순위와 URL·설정 분리.",
        obsPath: `/overlay/donor-rankings-full?u={u}&host=obs&zoomPct=${zoomPct}`,
      },
      {
        id: "donation-lists",
        title: "후원·기여도 리스트",
        desc: "멤버 계좌·투네·기여도 표.",
        obsPath: `/overlay/donation-lists?u={u}`,
      },
      {
        id: "obs-text",
        title: "OBS 텍스트 (기본 인스턴스)",
        desc: "다중 텍스트는 textId마다 브라우저 소스 추가. /admin/obs-text 에서 인스턴스 ID 확인.",
        obsPath: `/overlay/obs-text?u={u}&host=obs&textId=default`,
      },
      {
        id: "sig-sales",
        title: "시그 회전판",
        desc: "회전판 + 결과. 멤버 필터는 관리자에서 선택 후 spin.",
        obsPath: `/overlay/sig-sales?u={u}&hideSigBoard=1`,
      },
      {
        id: "sig-sales-manual",
        title: "시그 수동 판매",
        desc: "회전판 없음. 「수동 결과 적용(LANDED)」 후 OBS에 표시.",
        obsPath: `/overlay/sig-sales-manual?u={u}&hideSigBoard=1`,
      },
      {
        id: "goal",
        title: "목표 막대",
        desc: "프리셋 목표·현재액.",
        obsPath: `/overlay/goal?u={u}&host=obs`,
      },
      {
        id: "sig-match",
        title: "시그 대전",
        desc: "시그 매치 게이지·듀얼 UI.",
        obsPath: `/overlay/sig-match?u={u}`,
      },
      {
        id: "meal-match",
        title: "식사 대전",
        desc: "식사 배틀 게이지 오버레이.",
        obsPath: `/overlay/meal-match?u={u}`,
      },
    ],
    [donorThemeQ, zoomPct]
  );

  const copyUrl = useCallback(async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* noop */
    }
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 text-white">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold">오버레이 개발 점검 허브</h1>
        <p className="text-sm text-neutral-400 leading-relaxed">
          <code className="text-emerald-300">npm run dev</code> 후 이 페이지에서 웹 미리보기와 OBS용 URL을
          함께 확인하세요. localhost에서는 로그인 없이 <code className="text-neutral-300">u=</code> 만으로{" "}
          <code className="text-neutral-300">/api/state</code> 가 동작합니다.
        </p>
        <ul className="list-disc pl-5 text-xs text-amber-200/90 space-y-1">
          <li>
            <strong>OBS용 열기 / URL 복사</strong> — hubPreview 없는 주소 (방송과 동일)
          </li>
          <li>
            아래 iframe은 관리자 미리보기 모드 — <strong>OBS에 넣으면 안 됨</strong>
          </li>
          <li>
            상태 저장·후원 입력은{" "}
            <a href="/admin" className="text-sky-400 underline">
              /admin
            </a>{" "}
            (로컬은 dev 우회 로그인)
          </li>
        </ul>
      </header>

      <section className="flex flex-wrap items-end gap-4 rounded-xl border border-white/10 bg-neutral-950/80 p-4">
        <label className="text-xs text-neutral-400">
          계정 u=
          <input
            className="mt-1 block w-40 rounded border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
            value={userId}
            onChange={(e) => setUserId(e.target.value.trim() || "finalent")}
          />
        </label>
        <label className="text-xs text-neutral-400">
          zoomPct
          <input
            type="number"
            min={30}
            max={300}
            className="mt-1 block w-24 rounded border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
            value={zoomPct}
            onChange={(e) => setZoomPct(e.target.value)}
          />
        </label>
        <a
          href="/admin"
          className="rounded bg-violet-700 px-4 py-2 text-sm font-semibold hover:bg-violet-600"
        >
          관리자 (/admin)
        </a>
        <a
          href="/admin/obs-text"
          className="rounded border border-violet-500/40 px-4 py-2 text-sm text-violet-100 hover:bg-violet-950/40"
        >
          텍스트 편집
        </a>
        <a
          href="/admin/sig-sales"
          className="rounded border border-amber-500/40 px-4 py-2 text-sm text-amber-100 hover:bg-amber-950/40"
        >
          시그 판매
        </a>
      </section>

      <div className="grid gap-6 md:grid-cols-1">
        {links.map((link) => (
          <OverlayDevCard
            key={link.id}
            link={link}
            origin={origin}
            userId={userId}
            copiedId={copiedId}
            onCopy={copyUrl}
          />
        ))}
      </div>

      <section className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-4 text-xs text-sky-100/90 space-y-2">
        <p className="font-semibold text-sky-100">OBS 로컬 테스트</p>
        <p>
          OBS 브라우저 소스 URL에 위에서 복사한 주소를 넣되,{" "}
          <code className="text-sky-200">localhost</code>는 OBS PC에서만 접근 가능합니다. 다른 PC의 OBS로
          보려면 <code className="text-sky-200">npm run dev -- -H 0.0.0.0</code> 후{" "}
          <code className="text-sky-200">http://&lt;PC IP&gt;:3000/...</code> 를 사용하세요.
        </p>
      </section>
    </div>
  );
}
