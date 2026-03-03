/**
 * 모바일(Capacitor) 및 웹에서 파일 다운로드/열기 지원
 * Android WebView에서는 blob URL + a.click()이 작동하지 않으므로
 * Capacitor Filesystem + FileOpener 사용
 */

async function isCapacitorNative(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** 웹에서 blob 다운로드 (데스크톱/모바일 브라우저) */
function downloadBlobWeb(filename: string, blob: Blob): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Capacitor 네이티브에서 파일 저장 후 열기 */
async function saveAndOpenNative(
  filename: string,
  content: string | Blob,
  mimeType: string
): Promise<void> {
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
  const { FileOpener } = await import("@capacitor-community/file-opener");

  const safeName = filename.replace(/[^a-zA-Z0-9가-힣._-]/g, "_");
  const path = `settlement_${Date.now()}_${safeName}`;

  if (typeof content === "string") {
    await Filesystem.writeFile({
      path,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
  } else {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] || "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(content);
    });
    await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Cache,
    });
  }

  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  const contentType = mimeType.split(";")[0] || "application/octet-stream";
  await FileOpener.open({ filePath: uri, contentType });
}

/**
 * 텍스트/CSV 파일 다운로드 (모바일 앱에서도 동작)
 */
export async function downloadTextFile(
  filename: string,
  content: string,
  mimeType = "text/plain;charset=utf-8"
): Promise<void> {
  const native = await isCapacitorNative();
  if (native) {
    try {
      await saveAndOpenNative(filename, content, mimeType);
    } catch {
      const blob = new Blob([content], { type: mimeType });
      downloadBlobWeb(filename, blob);
    }
  } else {
    const blob = new Blob([content], { type: mimeType });
    downloadBlobWeb(filename, blob);
  }
}

/**
 * Blob 파일 다운로드 (PDF 등, 모바일 앱에서도 동작)
 */
export async function downloadBlobFile(filename: string, blob: Blob): Promise<void> {
  const native = await isCapacitorNative();
  if (native) {
    try {
      await saveAndOpenNative(filename, blob, blob.type);
    } catch {
      downloadBlobWeb(filename, blob);
    }
  } else {
    downloadBlobWeb(filename, blob);
  }
}
