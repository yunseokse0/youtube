import type { ToonationListenerSnapshot } from "./browser-relay-policy";

export async function fetchToonationListenerSnapshot(userId: string): Promise<ToonationListenerSnapshot> {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  try {
    const res = await fetch(`/api/donations/toonation/listener?u=${encodeURIComponent(uid)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { status?: ToonationListenerSnapshot } | null;
    return data?.status ?? null;
  } catch {
    return null;
  }
}

export async function pauseToonationServerListenerFromBrowser(
  userId: string,
  linkKey: string,
  ownerName?: string
): Promise<void> {
  const uid = String(userId || "").trim();
  const link = String(linkKey || "").trim();
  if (!uid || !link) return;
  await fetch(`/api/donations/toonation/listener?u=${encodeURIComponent(uid)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alertboxUrl: link,
      ownerName: String(ownerName || "").trim(),
      enabled: false,
    }),
  }).catch(() => {});
}

export async function resumeToonationServerListenerFromBrowser(
  userId: string,
  linkKey: string,
  ownerName?: string
): Promise<void> {
  const uid = String(userId || "").trim();
  const link = String(linkKey || "").trim();
  if (!uid || !link) return;
  await fetch(`/api/donations/toonation/listener?u=${encodeURIComponent(uid)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alertboxUrl: link,
      ownerName: String(ownerName || "").trim(),
      enabled: true,
    }),
  }).catch(() => {});
}
