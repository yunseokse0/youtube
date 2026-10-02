/** 미리보기용. 상태는 `/api/shangliu?u=` 를 폴링한다. */
export default function HighSocietyDemoPage({
  searchParams,
}: {
  searchParams?: { u?: string; user?: string };
}) {
  const u = String(searchParams?.u || searchParams?.user || "finalent").trim() || "finalent";
  return (
    <iframe
      src={`/overlay.html?u=${encodeURIComponent(u)}`}
      title="상류사회 오버레이 미리보기"
      className="h-screen w-screen border-0 bg-[#05020a]"
    />
  );
}
