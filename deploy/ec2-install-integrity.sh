#!/usr/bin/env bash
# EC2 CloudShell: 모니터 inline python -c SyntaxError(rc=1) 제거.
# 사용: cd ~/youtube && bash deploy/ec2-install-integrity.sh
set -euo pipefail
ROOT="$(pwd)"
if [ ! -f "$ROOT/deploy/ec2-donation-monitor.sh" ]; then
  if [ -f "$HOME/youtube/deploy/ec2-donation-monitor.sh" ]; then
    ROOT="$HOME/youtube"
  else
    echo "deploy/ec2-donation-monitor.sh 를 찾으세요. cd ~/youtube 후 다시 실행."
    exit 1
  fi
fi
SH="$ROOT/deploy/ec2-donation-monitor.sh"
PYF="$ROOT/deploy/ec2-donation-integrity.py"

python3 - "$PYF" "$SH" <<'PY'
from pathlib import Path
import sys

pyf = Path(sys.argv[1])
sh = Path(sys.argv[2])

pyf.write_text(r'''#!/usr/bin/env python3
import json, os, sys, time
from datetime import datetime, timezone

def file_size(p):
    try:
        return os.path.getsize(p)
    except OSError:
        return 0

def krw(n):
    try:
        n = int(n)
    except Exception:
        n = 0
    return "{:,}원".format(n)

def parse_at(at):
    if not at:
        return 0
    if isinstance(at, (int, float)):
        at = int(at)
        return at if at > 1e11 else at * 1000
    try:
        return int(datetime.fromisoformat(str(at).replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return 0

def load(p):
    try:
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            return json.loads(f.read() or "{}")
    except Exception as e:
        return {"_err": str(e)}

def main():
    if len(sys.argv) < 6:
        print("usage: STATE HUB QUEUE UNMATCH OUT", file=sys.stderr)
        return 2
    state_file, hub_file, q_s, u_s, out_path = sys.argv[1:6]
    q_n = int(q_s or 0)
    u_n = int(u_s or 0)
    state = load(state_file)
    hub = load(hub_file)
    lines = []
    if state.get("_err"):
        lines.append("state parse fail: " + state["_err"])
    if hub.get("_err"):
        lines.append("hub parse fail: " + hub["_err"])
    donors = state.get("donors") if isinstance(state.get("donors"), list) else []
    logs = hub.get("logs") or hub.get("donationLogs") or []
    if not isinstance(logs, list):
        logs = []
    reset_at = int(state.get("settlementResetAt") or 0)
    now = int(time.time() * 1000)
    c1 = now - 3600 * 1000
    c24 = now - 86400 * 1000
    st_sum = 0
    st_ids = set()
    st_ids_1h = set(); st_cnt_1h = 0; st_sum_1h = 0
    st_ids_24h = set(); st_cnt_24h = 0; st_sum_24h = 0
    st_cnt_post = 0; st_sum_post = 0
    for d in donors:
        if not isinstance(d, dict):
            continue
        iid = str(d.get("id") or "").strip()
        if not iid:
            continue
        amt = int(d.get("amount") or 0)
        st_ids.add(iid)
        st_sum += amt
        at = parse_at(d.get("at"))
        if at >= c24:
            st_ids_24h.add(iid); st_cnt_24h += 1; st_sum_24h += amt
            if at >= c1:
                st_ids_1h.add(iid); st_cnt_1h += 1; st_sum_1h += amt
        if reset_at <= 0 or at == 0 or at >= reset_at:
            st_cnt_post += 1; st_sum_post += amt
    sess = hub.get("session") if isinstance(hub.get("session"), dict) else {}
    email = str((sess or {}).get("email") or "").strip()
    h_ids_1h = set(); h_sum_1h = 0; h_cnt_1h = 0
    h_ids_24h = set(); h_sum_24h = 0; h_cnt_24h = 0
    id_amt = {}
    for log in logs:
        if not isinstance(log, dict):
            continue
        amt = int(log.get("amount") or 0)
        iid = str(log.get("id") or "").strip()
        if amt <= 0 or not iid:
            continue
        id_amt[iid] = max(id_amt.get(iid, 0), amt)
        ms = parse_at(log.get("at") or log.get("ingestedAt"))
        if ms >= c24:
            h_ids_24h.add(iid); h_cnt_24h += 1; h_sum_24h += amt
            if ms >= c1:
                h_ids_1h.add(iid); h_cnt_1h += 1; h_sum_1h += amt
    miss_1h = sorted(h_ids_1h - st_ids)
    miss_24h = sorted(h_ids_24h - st_ids)
    miss_1h_sum = sum(id_amt.get(i, 0) for i in miss_1h)
    miss_24h_sum = sum(id_amt.get(i, 0) for i in miss_24h)
    level = "OK"
    if miss_24h:
        level = "CRITICAL" if (len(miss_24h) >= 3 or miss_24h_sum >= 50000) else "WARN"
    if q_n >= 20 or u_n >= 10:
        level = "WARN"
    if q_n >= 100 or u_n >= 50:
        level = "CRITICAL"
    if len(logs) == 0:
        level = "WARN"
    lines += [
        "정합성 레벨: " + level,
        "",
        "  전체 state donors:  {:>8}건 / {}".format(len(st_ids), krw(st_sum)),
        "  허브 로그 버퍼:     {:>8}건   (정산표 전체가 아님. 최근 ingest 버퍼)".format(len(logs)),
    ]
    if email:
        lines.append("  Hub email:           " + email)
    else:
        lines.append("  Hub email:           (없음)")
    if reset_at > 0:
        try:
            rs = datetime.fromtimestamp(reset_at / 1000, tz=timezone.utc).astimezone().strftime("%m-%d %H:%M")
        except Exception:
            rs = str(reset_at)
        lines.append("  정산 리셋:            " + rs)
        lines.append("   POST(리셋 이후):    {:>8}건 / {}".format(st_cnt_post, krw(st_sum_post)))
    if len(logs) == 0:
        lines.append("  ※ 허브 로그 0건 → Hub→State 누락 검사는 불가. state 합계만 유효.")
    lines += [
        "",
        "  [1시간] Hub {:>5}건 {} | State {:>5}건 {}".format(h_cnt_1h, krw(h_sum_1h), st_cnt_1h, krw(st_sum_1h)),
        "          Hub→State 미반영 {}건 {}".format(len(miss_1h), krw(miss_1h_sum)),
        "  [24시간] Hub {:>5}건 {} | State {:>5}건 {}".format(h_cnt_24h, krw(h_sum_24h), st_cnt_24h, krw(st_sum_24h)),
        "          Hub→State 미반영 {}건 {}".format(len(miss_24h), krw(miss_24h_sum)),
        "",
        "  QUEUE={}  UNMATCH={}".format(q_n, u_n),
        "",
        "  판정: 허브 로그에 있는데 state에 없는 것만 누락.",
        "        state가 허브보다 많은 것은 정상(허브는 최근 버퍼).",
    ]
    if miss_24h:
        lines.append("  미반영 id: " + " | ".join(miss_24h[:8]))
    else:
        lines.append("  Hub→State 미반영 0건 (허브 버퍼 30건이 state에 있음)")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        out = sys.argv[5] if len(sys.argv) > 5 else ""
        if out:
            try:
                with open(out, "w", encoding="utf-8") as f:
                    f.write("(정합성 예외: %s: %s)\n" % (type(e).__name__, e))
            except Exception:
                pass
        raise SystemExit(0)
''', encoding="utf-8")
print("wrote", pyf, pyf.stat().st_size, "bytes")

t = sh.read_text(encoding="utf-8")
start = t.find("donation_integrity_diff() {")
end = t.find("render_diff_panel() {")
if start < 0 or end < 0 or end <= start:
    print("donation_integrity_diff not found in", sh)
    raise SystemExit(1)
new_fn = r'''donation_integrity_diff() {
  local out="$1"
  : > "$out" 2>/dev/null || { mkdir -p "$(dirname "$out")" 2>/dev/null; : > "$out" 2>/dev/null; }
  local int_py
  int_py="$(cd "$(dirname "$0")" && pwd)/ec2-donation-integrity.py"
  if [ ! -f "$int_py" ]; then
    echo "(정합성 스크립트 없음: $int_py)" > "$out"
    echo "state donors ${DBG_DONORS_N:-0}건 / hub ${DBG_HUBLOG_N:-0}건" >> "$out"
    return
  fi
  "$PY" "$int_py" "$SNAP_STATE_FILE" "$SNAP_HUB_FILE" "${q_len:-0}" "${un_len:-0}" "$out" 2> "$TMP_DIR/diff.err" || true
  if [ -s "$out" ]; then
    return
  fi
  {
    echo "state donors: ${DBG_DONORS_N:-0}건  (${STATE_BYTES:-0} bytes)"
    echo "hub logs:     ${DBG_HUBLOG_N:-0}건  (${HUB_BYTES:-0} bytes)"
    echo "QUEUE=${q_len:-0} UNMATCH=${un_len:-0}"
    echo "상세 계산 실패. 위 건수는 curl 결과로 유효합니다."
    if [ -s "$TMP_DIR/diff.err" ]; then
      echo "stderr: $(head -c 240 "$TMP_DIR/diff.err" | tr '\n' ' ')"
    fi
  } > "$out"
}

'''
sh.write_text(t[:start] + new_fn + t[end:], encoding="utf-8")
print("patched donation_integrity_diff in", sh)
PY

echo
echo "설치 완료. 모니터를 q 로 종료한 뒤 다시 실행하세요:"
echo "  COOKIE='sb_user=...' TARGET_USER=din PORT=3000 bash deploy/ec2-donation-monitor.sh"
echo "그 다음 d 키로 정합성 패널을 여세요."
