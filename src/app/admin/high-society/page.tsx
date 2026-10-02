export const dynamic = "force-dynamic";

/** 상류사회 영토는 후원과 분리된 서버 연동 컨트롤러(`/admin.html?u=`). */
export default function AdminHighSocietyPopupPage({
  searchParams,
}: {
  searchParams?: { u?: string; user?: string };
}) {
  const u = String(searchParams?.u || searchParams?.user || "finalent").trim() || "finalent";
  return (
    <iframe
      src={`/admin.html?u=${encodeURIComponent(u)}`}
      title="상류사회 백오피스"
      className="h-screen w-screen border-0 bg-[#0a0510]"
    />
  );
}
