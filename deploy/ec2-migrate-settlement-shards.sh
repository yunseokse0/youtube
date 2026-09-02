#!/usr/bin/env bash
# settlement-records monolith → 일별 shard
#   cd ~/youtube && bash deploy/ec2-migrate-settlement-shards.sh --dry-run
#   cd ~/youtube && bash deploy/ec2-migrate-settlement-shards.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
USER_ID="${SETTLEMENT_USER:-din}"

echo "== migrate settlement-records shards user=${USER_ID} $* =="
node scripts/migrate-settlement-records-shards.mjs --user="$USER_ID" "$@"

if [[ "${1:-}" != "--dry-run" ]]; then
  pm2 restart youtube --update-env || true
  echo "done — curl 'http://127.0.0.1:3000/api/settlements?u=${USER_ID}&recent=50'"
fi
