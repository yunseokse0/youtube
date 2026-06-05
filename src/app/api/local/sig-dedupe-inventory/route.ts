import fs from "fs/promises";
import path from "path";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { isLocalSigManagerAllowed } from "@/lib/local-dev-host";
import {
  dedupeSigInventory,
  type SigDedupeStrategy,
} from "@/lib/sig-inventory-dedup";
import type { SigItem } from "@/types";

export const dynamic = "force-dynamic";

const LIVE_JSON = path.join(process.cwd(), "data", "sig-inventory-live.json");

function parseStrategy(raw: string | null): SigDedupeStrategy {
  return raw === "imageUrl" ? "imageUrl" : "nameAndPrice";
}

export async function POST(req: Request) {
  const host = headers().get("host") || headers().get("x-forwarded-host") || "";
  if (!isLocalSigManagerAllowed(host)) {
    return NextResponse.json({ ok: false as const, error: "local only" }, { status: 403 });
  }

  let strategy: SigDedupeStrategy = "nameAndPrice";
  try {
    const body = (await req.json()) as { strategy?: string };
    strategy = parseStrategy(body?.strategy ?? null);
  } catch {
    /* default */
  }

  let data: Record<string, unknown>;
  try {
    const raw = await fs.readFile(LIVE_JSON, "utf8");
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false as const, error: "data/sig-inventory-live.json 없음" },
      { status: 404 }
    );
  }

  const inv = Array.isArray(data.sigInventory) ? (data.sigInventory as SigItem[]) : [];
  const before = inv.length;
  const { nextInventory, removedCount } = dedupeSigInventory(inv, strategy);

  if (removedCount > 0) {
    await fs.writeFile(
      LIVE_JSON,
      JSON.stringify(
        {
          ...data,
          dedupedAt: new Date().toISOString(),
          dedupeStrategy: strategy,
          sigInventory: nextInventory,
        },
        null,
        2
      ),
      "utf8"
    );

    const { spawn } = await import("child_process");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("npm", ["run", "sig:export-catalog"], {
        cwd: process.cwd(),
        shell: true,
        stdio: "ignore",
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`sig:export-catalog exit ${code}`));
      });
    });
  }

  return NextResponse.json({
    ok: true as const,
    strategy,
    before,
    after: nextInventory.length,
    removedCount,
  });
}
