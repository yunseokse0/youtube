export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

export default function AdminOverlaySettingsRedirectPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  if (searchParams) {
    for (const [key, val] of Object.entries(searchParams)) {
      if (typeof val === "string") params.set(key, val);
      else if (Array.isArray(val) && val[0]) params.set(key, val[0]);
    }
  }
  const qs = params.toString();
  redirect(`/admin${qs ? `?${qs}` : ""}#overlay-settings`);
}
