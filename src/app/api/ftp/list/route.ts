import { Client, FileType } from "basic-ftp";
import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import { getFtpAccessConfig, safeFtpRemotePathForBrowse } from "@/lib/ftp-config";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const uid = getUserIdFromRequest(req);
    if (!uid) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const cfg = getFtpAccessConfig();
    if (!cfg) {
      return Response.json(
        { ok: false, error: "ftp_not_configured: set FTP_HOST, FTP_USER, FTP_PASSWORD in server env" },
        { status: 500 }
      );
    }
    let remotePath: string;
    try {
      const url = new URL(req.url);
      remotePath = safeFtpRemotePathForBrowse(url.searchParams.get("path"));
    } catch {
      return Response.json({ ok: false, error: "invalid_path" }, { status: 400 });
    }

    const client = new Client();
    client.ftp.verbose = false;
    try {
      await client.access(cfg);
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
