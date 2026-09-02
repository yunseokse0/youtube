#!/usr/bin/env bash
# donors 교차경로·재전송 중복 제거
#   cd ~/youtube && bash deploy/ec2-dedupe-donors.sh --dry-run
#   bash deploy/ec2-dedupe-donors.sh --apply
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
USER_ID="${DEDUPE_USER:-din}"

echo "== dedupe donors user=${USER_ID} $* =="
node scripts/dedupe-donors-state.mjs --user="$USER_ID" "$@"

if [[ "${1:-}" == "--apply" ]]; then
  pm2 restart youtube --update-env || true
  sleep 3
  curl -sf --max-time 30 \
    "http://127.0.0.1:3000/api/state?u=${USER_ID}&user=${USER_ID}&fast=1" \
    -o /tmp/state-after-dedupe.json || true
  node -e "
    const s=require('/tmp/state-after-dedupe.json');
    const d=s.donors||[];
    const sum=d.reduce((a,x)=>a+(Number(x.amount)||0),0);
    console.log(JSON.stringify({donors:d.length, man:+(sum/10000).toFixed(2)},null,2));
  "
fi
