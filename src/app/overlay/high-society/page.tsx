import { redirect } from "next/navigation";

/** OBS 브라우저 소스. iframe으로 감싸면 투명 배경이 흰 판으로 남는다. */
export default function HighSocietyOverlayPage({
  searchParams,
}: {
  searchParams?: { u?: string; user?: string };
}) {
  const u = String(searchParams?.u || searchParams?.user || "finalent").trim() || "finalent";
  redirect(`/overlay.html?u=${encodeURIComponent(u)}`);
}
