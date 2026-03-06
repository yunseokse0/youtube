export async function sendSSEUpdate(data: unknown) {
  try {
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: "include",
    });
  } catch {
    // ignore network errors; polling will still update overlays
  }
}
