#!/usr/bin/env node
/**
 * tmp-jaki-birthday-all.json → EC2 원샷 정렬 스크립트
 *   node scripts/build-ec2-birthday-align.mjs
 */
import fs from "fs";

const payload = JSON.parse(fs.readFileSync("tmp-jaki-birthday-all.json", "utf8"));
const rows = payload.rows || [];
if (rows.length !== 440) {
  throw new Error(`expected 440 xlsx rows, got ${rows.length}`);
}

const out = `#!/usr/bin/env node
/** EC2: xlsx 440건(739.69만)에 din donors 를 맞춘다. DIN·푸시=계좌. */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const ROWS = ${JSON.stringify(rows)};
const jsonPath = path.resolve("tmp-jaki-birthday-all.json");
fs.writeFileSync(jsonPath, JSON.stringify({ rows: ROWS, stats: { all: ROWS.length } }));

const extra = process.argv.slice(2);
const args = [
  "scripts/align-donors-to-pdf.mjs",
  "--pdf-json=" + jsonPath,
  "--user=din",
  "--match-window-min=30",
  ...extra,
];
const r = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(r.status ?? 1);
`;

fs.writeFileSync("tmp-ec2-align-birthday.mjs", out, "utf8");
const sum = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
console.log(
  JSON.stringify(
    {
      out: "tmp-ec2-align-birthday.mjs",
      rows: rows.length,
      sum,
      man: Number((sum / 10000).toFixed(2)),
      bytes: out.length,
    },
    null,
    2
  )
);
