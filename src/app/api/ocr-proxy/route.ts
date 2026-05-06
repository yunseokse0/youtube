import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "metadata.google.internal" || h.includes("metadata.google")) return true;

  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (h === "[::1]" || h.startsWith("[fc") || h.startsWith("[fd")) return true;
  return false;
}

function okContentType(ct: string): boolean {
  const c = ct.toLowerCase().trim();
  if (!c) return true;
  if (c.startsWith("image/")) return true;
  if (c.includes("octet-stream")) return true;
  return false;
}

function sniffImageMime(buf: ArrayBuffer): string | null {
  const u = new Uint8Array(buf.byteLength > 16 ? buf.slice(0, 16) : buf);
  if (u.length < 3) return null;
  if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return "image/jpeg";
  if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return "image/png";
  if (u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46) return "image/gif";
  if (u.length >= 12 && u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) return "image/webp";
  return null;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw?.trim()) {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw.trim());
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  if (target.protocol !== "https:" && !(target.protocol === "http:" && process.env.NODE_ENV === "development")) {
    return NextResponse.json({ error: "only https allowed" }, { status: 400 });
  }

  if (isBlockedHostname(target.hostname)) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25_000);

  try {
    const res = await fetch(target.href, {
      redirect: "follow",
      signal: ac.signal,
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent": "SigImageOCR/1.0",
      },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    }

    const ct = res.headers.get("content-type") || "";
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "too large" }, { status: 413 });
    }

    if (!okContentType(ct)) {
      const sniffed = sniffImageMime(buf);
      if (!sniffed) {
        return NextResponse.json({ error: "unsupported content type" }, { status: 415 });
      }
      return new NextResponse(buf, {
        headers: {
          "Content-Type": sniffed,
          "Cache-Control": "private, max-age=120",
        },
      });
    }

    const outType =
      ct && ct.toLowerCase().startsWith("image/") ? ct.split(";")[0].trim() : sniffImageMime(buf) || "application/octet-stream";

    return new NextResponse(buf, {
      headers: {
        "Content-Type": outType,
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
