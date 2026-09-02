#!/usr/bin/env bash
# PDF(새벽 2시까지) 기준으로 din donors 정렬
#   cd ~/youtube && bash deploy/ec2-align-jaki-pdf.sh --dry-run
#   cd ~/youtube && bash deploy/ec2-align-jaki-pdf.sh --apply
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:---dry-run}"
PDF_JSON="${PDF_JSON:-scripts/data/jaki-birthday-until-2am.json}"

if [[ ! -f "$PDF_JSON" ]]; then
  echo "ERROR: $PDF_JSON 없음 — git pull 또는 PDF 파싱 먼저"
  echo "  node scripts/parse-jaki-birthday-pdf.mjs /path/to.pdf --out=$PDF_JSON"
  exit 1
fi

echo "== align donors to PDF ($MODE) =="
node scripts/align-donors-to-pdf.mjs \
  --pdf-json="$PDF_JSON" \
  --user=din \
  --report=tmp-align-donors-report.json \
  "$MODE"

if [[ "$MODE" == "--apply" ]]; then
  pm2 restart youtube --update-env
  sleep 4
  curl -sf --max-time 30 -w "state fast HTTP:%{http_code} time:%{time_total}s\n" \
    "http://127.0.0.1:3000/api/state?u=din&user=din&fast=1" -o /tmp/state-din-after.json || true
  node -e "
    const s=require('/tmp/state-din-after.json');
    const donors=s.donors||[];
    const sum=donors.reduce((a,d)=>a+(Number(d.amount)||0),0);
    console.log(JSON.stringify({
      donors: donors.length,
      sum,
      man: +(sum/10000).toFixed(2),
      members: (s.members||[]).map(m=>({name:m.name,account:m.account,toon:m.toon}))
    },null,2));
  "
fi
