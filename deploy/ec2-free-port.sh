#!/usr/bin/env bash
# EC2: :3000 등 LISTEN 점유 프로세스 정리 (pm2 delete 후 zombie node 방지)
free_listen_port() {
  local port="${1:-3000}"
  local pid pids

  sleep 1

  if command -v ss >/dev/null 2>&1; then
    pids="$(ss -lptn "sport = :${port}" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
    if [[ -n "$pids" ]]; then
      echo "== 포트 ${port} 점유 (ss): ${pids} =="
      while read -r pid; do
        [[ -z "$pid" ]] && continue
        kill "$pid" 2>/dev/null || sudo kill "$pid" 2>/dev/null || true
      done <<< "$pids"
      sleep 2
    fi
  fi

  if command -v fuser >/dev/null 2>&1; then
    if fuser "${port}/tcp" >/dev/null 2>&1; then
      echo "== 포트 ${port} fuser -k =="
      fuser -k "${port}/tcp" 2>/dev/null || sudo fuser -k "${port}/tcp" 2>/dev/null || true
      sleep 2
    fi
  elif command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -t -i ":${port}" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
    if [[ -n "$pids" ]]; then
      echo "== 포트 ${port} lsof kill: ${pids} =="
      while read -r pid; do
        [[ -z "$pid" ]] && continue
        kill "$pid" 2>/dev/null || sudo kill "$pid" 2>/dev/null || true
      done <<< "$pids"
      sleep 2
    fi
  fi
}
