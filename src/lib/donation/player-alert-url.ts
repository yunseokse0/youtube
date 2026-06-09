export function normalizePlayerFilter(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function playerFilterMatches(filterRaw: string, playerName?: string): boolean {
  const filter = normalizePlayerFilter(filterRaw);
  if (!filter) return true;
  const player = normalizePlayerFilter(playerName || "");
  if (!player) return false;
  return player === filter || player.includes(filter) || filter.includes(player);
}

export function buildPlayerAlertPopupUrl(userId: string, player?: string): string {
  const uid = String(userId || "").trim() || "finalent";
  const params = new URLSearchParams({ u: uid });
  const p = String(player || "").trim();
  if (p) params.set("player", p);
  return `/player-alert?${params.toString()}`;
}

export function openPlayerAlertPopup(userId: string, player?: string): void {
  if (typeof window === "undefined") return;
  const url = buildPlayerAlertPopupUrl(userId, player);
  window.open(
    url,
    "player-donation-alert",
    "width=1040,height=420,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes"
  );
}
