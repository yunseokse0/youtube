#!/usr/bin/env node
/**
 * 자키 생일 후원리스트 PDF → JSON (새벽 2시까지)
 *
 *   node scripts/parse-jaki-birthday-pdf.mjs "C:/Users/.../자키 생일 후원리스트.pdf"
 *   node scripts/parse-jaki-birthday-pdf.mjs ./tmp-jaki-donations.pdf --out=tmp-pdf-until-2am.json
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

const CUTOFF_ISO = "2026-09-02T02:00:00+09:00";
const CUTOFF = Date.parse(CUTOFF_ISO);

function parseAt(datePart, h, mi, s) {
  let hour = Number(h);
  if (hour === 24) hour = 0; // PDF 24:xx = 00:xx
  const [Y, M, D] = datePart
    .replace(/\s/g, "")
    .replace(/\.$/, "")
    .split(".")
    .map(Number);
  const iso = `${Y}-${String(M).padStart(2, "0")}-${String(D).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${mi}:${s}+09:00`;
  return Date.parse(iso);
}

function parseAmountNick(block) {
  let target = "toon";
  if ((/push/i.test(block) || /푸시|계좌|account|sms/i.test(block)) && !/toonation/i.test(block)) {
    target = "account";
  }
  if (/DIN\s*·\s*푸시/i.test(block) || /DIN\s*·\s*푸시캐치/i.test(block)) {
    target = "account";
  }

  const lines = String(block || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // 줄1 닉네임 / 줄2 금액(+메모)
  if (lines.length >= 2 && !/\d{3,7}/.test(lines[0])) {
    const am = lines[1].match(/^(\d{3,7})/);
    if (am) {
      return { nick: lines[0], amount: Number(am[1]), target };
    }
  }

  const one = lines[0] || "";
  const glued69 = one.match(/^([^\d]{0,40}?자키집쓰볼탱69)(\d{3,7})/);
  if (glued69) {
    return { nick: glued69[1].trim(), amount: Number(glued69[2]), target };
  }
  const gluedSeog = one.match(/^(자키집-?서그자)(\d{3,7})/);
  if (gluedSeog) {
    return { nick: gluedSeog[1], amount: Number(gluedSeog[2]), target };
  }

  const flat = lines.join(" ");
  const m =
    flat.match(/^([^\d]{1,48}?)(\d{3,7})(?=\s*(?:투네이션|DIN|toonation|push|계정|계좌|[가-힣]))/i) ||
    flat.match(/^([\uac00-\ud7a3A-Za-z0-9 _\-·]{1,48}?)(\d{3,7})/);
  if (!m) return { nick: lines[0] || "", amount: 0, target };
  return {
    nick: m[1].replace(/\s+/g, " ").trim(),
    amount: Number(m[2]),
    target,
  };
}

function normalizeNick(raw) {
  return String(raw || "")
    .replace(/\s+/g, "")
    .replace(/[.,:;!?~'"`()[\]{}<>_-]+/g, "")
    .toLowerCase();
}

async function main() {
  const args = process.argv.slice(2);
  const pdfPath = args.find((a) => !a.startsWith("--"));
  const outArg = args.find((a) => a.startsWith("--out="));
  const outPath = outArg
    ? outArg.slice("--out=".length)
    : path.resolve("tmp-pdf-until-2am.json");

  if (!pdfPath) {
    console.error("사용: node scripts/parse-jaki-birthday-pdf.mjs <pdf> [--out=file.json]");
    process.exit(1);
  }

  const buf = fs.readFileSync(path.resolve(pdfPath));
  const parsed = await pdf(buf);
  const text = parsed.text;

  const re =
    /(\d{4}\.\s*\d{2}\.\s*\d{2}\.\s*)(\d{1,2}):(\d{2}):(\d{2})([\s\S]*?)(?=\d{4}\.\s*\d{2}\.\s*\d{2}\.\s*\d{1,2}:\d{2}:\d{2}|$)/g;
  const all = [];
  let m;
  while ((m = re.exec(text))) {
    const at = parseAt(m[1], m[2], m[3], m[4]);
    if (!Number.isFinite(at)) continue;
    const block = m[5];
    const { nick, amount, target } = parseAmountNick(block);
    const src = /toonation/i.test(block)
      ? "toonation"
      : /push/i.test(block)
        ? "push"
        : "other";
    all.push({
      at,
      atKst: new Date(at).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }),
      nick,
      nickKey: normalizeNick(nick),
      amount,
      target,
      src,
      snip: block.replace(/\s+/g, " ").trim().slice(0, 80),
    });
  }

  const until = all.filter((r) => r.at <= CUTOFF && r.amount > 0);
  const after = all.filter((r) => r.at > CUTOFF && r.amount > 0);
  const sum = (xs) => xs.reduce((a, r) => a + r.amount, 0);

  const payload = {
    cutoff: CUTOFF_ISO,
    sourcePdf: path.resolve(pdfPath),
    parsedAt: new Date().toISOString(),
    stats: {
      all: all.length,
      until2am: until.length,
      untilSum: sum(until),
      untilMan: Number((sum(until) / 10000).toFixed(2)),
      after2am: after.length,
      afterSum: sum(after),
      afterMan: Number((sum(after) / 10000).toFixed(2)),
      zeroAmount: all.filter((r) => !r.amount).length,
    },
    rows: until,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ out: outPath, ...payload.stats }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
