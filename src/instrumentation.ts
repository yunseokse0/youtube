export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { restoreToonationListenersFromStore } = await import("@/lib/donation/toonation/server-listener");
  await restoreToonationListenersFromStore();
}
