#!/usr/bin/env bash
# EC2: 시그 업로드 영구 폴더 + (선택) 기존 public/uploads 마이그레이션
set -euo pipefail
DATA_DIR="${SIG_UPLOADS_DATA_DIR:-/var/lib/finalent}"
APP_USER="${APP_USER:-ubuntu}"

sudo mkdir -p "${DATA_DIR}/uploads/sigs"
sudo chown -R "${APP_USER}:${APP_USER}" "${DATA_DIR}"

if [ -d "public/uploads/sigs" ] && [ "$(ls -A public/uploads/sigs 2>/dev/null || true)" ]; then
  echo "Copying public/uploads/sigs -> ${DATA_DIR}/uploads/sigs ..."
  cp -an public/uploads/sigs/. "${DATA_DIR}/uploads/sigs/" 2>/dev/null || cp -r public/uploads/sigs/. "${DATA_DIR}/uploads/sigs/"
fi

echo "OK: sig uploads dir at ${DATA_DIR}/uploads/sigs (owner ${APP_USER})"
echo "Add to .env if needed: SIG_UPLOADS_DATA_DIR=${DATA_DIR}"
