#!/usr/bin/env node
/**
 * EC2: 자키 생일 후원리스트 xlsx 440건(739.69만)에 din donors 정렬
 *
 *   cd ~/youtube && git pull
 *   node scripts/ec2-align-birthday-xlsx.mjs
 *   node scripts/ec2-align-birthday-xlsx.mjs --apply
 *   pm2 restart youtube --update-env
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonPath = path.join(root, "scripts/data/jaki-birthday-xlsx-all.json");
const extra = process.argv.slice(2);
const args = [
  path.join(root, "scripts/align-donors-to-pdf.mjs"),
  `--pdf-json=${jsonPath}`,
  "--user=din",
  "--match-window-min=30",
  ...extra,
];
const r = spawnSync(process.execPath, args, { stdio: "inherit", cwd: root });
process.exit(r.status ?? 1);
