#!/usr/bin/env bash
# EC2: :3000 등 LISTEN 점유 프로세스 정리 (pm2 delete 후 zombie node 방지)

port_listen_pids() {
  local port="${1:-3000}"
  local pids=""
  if command -v ss >/dev/null 2>&1; then
    pids="$(ss -lptn "sport = :${port}" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  elif command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -t -i ":${port}" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
  fi
  echo "$pids"
}

port_is_free() {
  local port="${1:-3000}"
  [[ -z "$(port_listen_pids "$port")" ]]
}

show_port_holders() {
  local port="${1:-3000}"
  echo "== :${port} LISTEN =="
  ss -lptn "sport = :${port}" 2>/dev/null || lsof -i ":${port}" -sTCP:LISTEN 2>/dev/null || true
}

free_listen_port() {
  local port="${1:-3000}"
  local attempt pid pids

  for attempt in 1 2 3 4; do
    pids="$(port_listen_pids "$port")"
    if [[ -z "$pids" ]]; then
      echo "== 포트 ${port} 비어 있음 =="
      return 0
    fi

    echo "== 포트 ${port} 점유 (시도 ${attempt}): ${pids//$'\n'/ } =="
    while read -r pid; do
      [[ -z "$pid" ]] && continue
      kill -TERM "$pid" 2>/dev/null || sudo kill -TERM "$pid" 2>/dev/null || true
    done <<< "$pids"
    sleep 2

    pids="$(port_listen_pids "$port")"
    if [[ -n "$pids" ]]; then
      while read -r pid; do
        [[ -z "$pid" ]] && continue
        kill -9 "$pid" 2>/dev/null || sudo kill -9 "$pid" 2>/dev/null || true
      done <<< "$pids"
      sleep 1
    fi

    if command -v fuser >/dev/null 2>&1; then
      fuser -k "${port}/tcp" 2>/dev/null || sudo fuser -k "${port}/tcp" 2>/dev/null || true
      sleep 1
    fi
  done

  if ! port_is_free "$port"; then
    echo "ERROR: 포트 ${port} 해제 실패"
    show_port_holders "$port"
    return 1
  fi
  return 0
}

wait_for_health() {
  local port="${1:-3000}"
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

verify_static_http() {
  local port="${1:-3000}"
  local root="${2:-.}"
  local bid webpack code
  bid="$(tr -d '\n\r' < "${root}/.next/BUILD_ID")"
  webpack="$(grep -oE 'webpack-[a-f0-9]+\.js' "${root}/.next/build-manifest.json" | head -1)"
  if [[ -z "$webpack" ]]; then
    echo "webpack chunk 이름 없음"
    return 1
  fi
  code="$(curl -sf -o /dev/null -w "%{http_code}" "http://127.0.0.1:${port}/_next/static/${bid}/_buildManifest.js" || echo "000")"
  echo "manifest HTTP ${code}"
  [[ "$code" == "200" ]] || return 1
  code="$(curl -sf -o /dev/null -w "%{http_code}" "http://127.0.0.1:${port}/_next/static/chunks/${webpack}" || echo "000")"
  echo "webpack HTTP ${code}"
  [[ "$code" == "200" ]]
}

resolve_smoke_user() {
  local from_env="${DEPLOY_SMOKE_USER:-}"
  if [[ -n "$from_env" ]]; then
    echo "$from_env"
    return 0
  fi
  if [[ -f .env ]]; then
    from_env="$(grep -E '^DEPLOY_SMOKE_USER=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r"' || true)"
    if [[ -n "$from_env" ]]; then
      echo "$from_env"
      return 0
    fi
  fi
  return 1
}

# /api/health 만으로는 부족 — state·MySQL 장애 시 502/504 (OBS·admin 동시 마비)
verify_state_api() {
  local port="${1:-3000}"
  local user code
  user="$(resolve_smoke_user 2>/dev/null || true)"
  if [[ -z "$user" ]]; then
    echo "== /api/state 스모크 생략 (DEPLOY_SMOKE_USER 미설정) =="
    return 0
  fi
  code="$(curl -sf --max-time 15 -o /dev/null -w "%{http_code}" \
    "http://127.0.0.1:${port}/api/state?user=${user}&u=${user}&pick=overlay" || echo "000")"
  echo "/api/state?user=${user} HTTP ${code}"
  [[ "$code" == "200" || "$code" == "304" ]]
}
