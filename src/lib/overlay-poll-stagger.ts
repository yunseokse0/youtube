/** OBS 브라우저 소스가 동시에 GET 하면 서버·CEF가 막히므로 소스별로 폴링 시점을 분산 */

export function overlayPollStaggerOffsetMs(sourceKey: string, spreadMs = 1200): number {
  const key = String(sourceKey || "default");
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const spread = Math.max(200, Math.floor(spreadMs));
  return Math.abs(h) % spread;
}

/** intervalMs 주기 폴링을 staggerOffset 뒤에 시작 */
export function startStaggeredOverlayPoll(
  run: () => void,
  intervalMs: number,
  sourceKey: string,
  spreadMs?: number
): () => void {
  const base = Math.max(400, Math.floor(intervalMs));
  const offset = overlayPollStaggerOffsetMs(sourceKey, spreadMs ?? 1200);
  const kick = () => void run();
  let intervalId: number | undefined;
  const startId = window.setTimeout(() => {
    kick();
    intervalId = window.setInterval(kick, base);
  }, offset);
  return () => {
    window.clearTimeout(startId);
    if (intervalId !== undefined) window.clearInterval(intervalId);
  };
}
