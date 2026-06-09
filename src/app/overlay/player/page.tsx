import { redirect } from "next/navigation";

type Props = {
  searchParams?: Record<string, string | string[] | undefined>;
};

/** OBS 오버레이가 아닌 웹 팝업(`/player-alert`)으로 안내 */
export default function LegacyPlayerOverlayRedirectPage({ searchParams }: Props) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (Array.isArray(value)) {
      for (const v of value) q.append(key, v);
    } else if (value != null) {
      q.set(key, value);
    }
  }
  q.delete("host");
  const suffix = q.toString();
  redirect(suffix ? `/player-alert?${suffix}` : "/player-alert");
}
