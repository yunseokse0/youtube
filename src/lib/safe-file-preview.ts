/** HTTP(비보안) 페이지에서 blob: URL 미리보기 시 브라우저 경고·로드 실패 방지 */

export function createSafeFilePreviewUrl(file: File): Promise<string> {
  if (typeof window === "undefined") return Promise.resolve("");
  if (window.isSecureContext) {
    return Promise.resolve(URL.createObjectURL(file));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("preview_read_failed"));
    reader.readAsDataURL(file);
  });
}

export function revokeSafeFilePreviewUrl(url: string): void {
  const u = String(url || "").trim();
  if (!u || u.startsWith("data:")) return;
  try {
    URL.revokeObjectURL(u);
  } catch {
    /* ignore */
  }
}
