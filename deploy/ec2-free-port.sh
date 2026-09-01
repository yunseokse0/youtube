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
    if curl -sf --max-time 3 "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

mysql_port_listening() {
  if command -v ss >/dev/null 2>&1; then
    ss -lntp 2>/dev/null | grep -q ':3306'
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -i :3306 -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

# recover·배포: systemctl active 만으로는 부족 — ECONNREFUSED 127.0.0.1:3306 방지
wait_for_mysql_port() {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if mysql_port_listening; then
      return 0
    fi
    sleep 1
  done
  return 1
}

ensure_mysql_running() {
  if ! systemctl list-unit-files mysql.service >/dev/null 2>&1; then
    echo "WARN: mysql.service 없음 — DATABASE_URL 확인"
    return 0
  fi
  local run_cmd
  run_cmd() {
    if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
  }
  if ! systemctl is-active mysql >/dev/null 2>&1 || ! mysql_port_listening; then
    echo "== MySQL 기동 (inactive 또는 :3306 미수신) =="
    run_cmd systemctl restart mysql 2>/dev/null || run_cmd systemctl start mysql 2>/dev/null || true
  fi
  if wait_for_mysql_port; then
    echo "MySQL :3306 LISTEN OK"
    return 0
  fi
  echo "ERROR: MySQL :3306 미수신 — ECONNREFUSED 원인"
  echo "  sudo journalctl -u mysql -n 40 --no-pager"
  echo "  df -h /  &&  bash deploy/ec2-free-disk.sh"
  run_cmd journalctl -u mysql -n 15 --no-pager 2>/dev/null || true
  return 1
}

ensure_nginx_proxy() {
  local root="${1:-.}"
  local code
  if ! restart_nginx_service "${root}"; then
    return 1
  fi
  code="$(curl -sf --max-time 8 -o /dev/null -w "%{http_code}" "http://127.0.0.1/admin" 2>/dev/null || echo "000")"
  echo "nginx /admin HTTP ${code}"
  [[ "$code" == "200" || "$code" == "302" || "$code" == "307" ]]
}

nginx_port_listening() {
  if command -v ss >/dev/null 2>&1; then
    ss -lntp 2>/dev/null | grep -q ':80 '
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -i :80 -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

wait_for_nginx_port() {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if nginx_port_listening; then
      return 0
    fi
    sleep 1
  done
  return 1
}

restart_nginx_service() {
  local root="${1:-.}"
  local run_cmd
  run_cmd() {
    if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi
  }
  if ! systemctl list-unit-files nginx.service >/dev/null 2>&1; then
    echo "WARN: nginx.service 없음"
    return 1
  fi
  echo "== nginx stop · :80 정리 · start =="
  run_cmd systemctl stop nginx 2>/dev/null || true
  sleep 1
  if command -v fuser >/dev/null 2>&1; then
    run_cmd fuser -k 80/tcp 2>/dev/null || true
    sleep 1
  fi
  if ! run_cmd nginx -t; then
    echo "nginx -t 실패 — reset"
    bash "${root}/deploy/ec2-nginx-reset-youtube.sh" || return 1
    return 0
  fi
  if ! run_cmd systemctl start nginx; then
    echo "ERROR: systemctl start nginx 실패"
    run_cmd journalctl -u nginx -n 25 --no-pager 2>/dev/null || true
    return 1
  fi
  if wait_for_nginx_port; then
    echo "nginx :80 LISTEN OK"
    return 0
  fi
  echo "ERROR: nginx :80 미수신 — journal 확인"
  run_cmd journalctl -u nginx -n 25 --no-pager 2>/dev/null || true
  run_cmd ss -lntp 2>/dev/null | grep -E ':80 |nginx' || true
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
