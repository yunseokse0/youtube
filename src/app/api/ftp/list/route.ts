import { Client, FileType } from "basic-ftp";
import { getUserIdFromRequest } from "@/app/api/_shared/user-id";

export const runtime = "nodejs";
export const revalidate = 0;

function safeFtpRemotePath(raw: string | null): string {
  const s = String(raw ?? "/").trim().replace(/\\/g, "/") || "/";
  let p = s.startsWith("/") ? s : `/${s}`;
  const segments = p.split("/").filter(Boolean);
  for (const seg of segments) {
    if (seg === "." || seg === "..") {
      throw new Error("invalid_path");
    }
  }
  return segments.length ? `/${segments.join("/")}` : "/";
}

function getFtpConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean | "implicit";
} | null {
  const host = (process.env.FTP_HOST || "").trim();
  const user = (process.env.FTP_USER || "").trim();
  const password = (process.env.FTP_PASSWORD || "").trim();
  if (!host || !user || !password) return null;
  const portRaw = (process.env.FTP_PORT || "21").trim();
  const port = Math.max(1, Math.min(65535, parseInt(portRaw, 10) || 21));
  const secureRaw = (process.env.FTP_SECURE || "").trim().toLowerCase();
  const secure =
    secureRaw === "implicit"
      ? "implicit"
      : secureRaw === "true" || secureRaw === "1" || secureRaw === "explicit";
  return { host, port, user, password, secure };
}

export async function GET(req: Request) {
  try {
    const uid = getUserIdFromRequest(req);
    if (!uid) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const cfg = getFtpConfig();
    if (!cfg) {
      return Response.json(
        { ok: false, error: "ftp_not_configured: set FTP_HOST, FTP_USER, FTP_PASSWORD in server env" },
        { status: 500 }
      );
    }
    let remotePath: string;
    try {
      const url = new URL(req.url);
      remotePath = safeFtpRemotePath(url.searchParams.get("path"));
    } catch {
      return Response.json({ ok: false, error: "invalid_path" }, { status: 400 });
    }

    const client = new Client();
    client.ftp.verbose = false;
    try {
      await client.access({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password,
        secure: cfg.secure,
      });
      const list = await client.list(remotePath);
      const entries = list.map((x) => ({
        name: String(x.name || ""),
        type: x.type === FileType.Directory ? "dir" : x.type === FileType.File ? "file" : x.type === FileType.SymbolicLink ? "symlink" : "unknown",
        size: typeof x.size === "number" ? x.size : undefined,
        rawModifiedAt: x.rawModifiedAt ? String(x.rawModifiedAt) : undefined,
      }));
      return Response.json({ ok: true, path: remotePath, entries }, { status: 200 });
    } finally {
      client.close();
    }
  } catch (e) {
    const msg = String(e);
    return Response.json({ ok: false, error: msg.slice(0, 500) }, { status: 500 });
  }
}
