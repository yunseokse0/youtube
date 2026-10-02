/** OBS 브라우저 소스 — 타이틀 없는 영토 게이지 (`public/overlay.html`). */
export default function HighSocietyOverlayPage({
  searchParams,
}: {
  searchParams?: { u?: string; user?: string };
}) {
  const u = String(searchParams?.u || searchParams?.user || "finalent").trim() || "finalent";
  return (
    <iframe
      src={`/overlay.html?u=${encodeURIComponent(u)}`}
      title="상류사회 오버레이"
      className="h-screen w-screen border-0"
      data-hs-overlay="titleless"
    />
  );
}
