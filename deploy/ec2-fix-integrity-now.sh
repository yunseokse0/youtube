#!/usr/bin/env bash
# EC2 CloudShell에서 모니터를 끄지 않고도 적용 가능한 핫픽스.
# 원인: bash double-quoted python -c 안의 ", ".join 이 문자열을 끊어 SyntaxError(rc=1)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd 2>/dev/null || pwd)"
SH=""
for c in \
  "$ROOT/deploy/ec2-donation-monitor.sh" \
  "$HOME/youtube/deploy/ec2-donation-monitor.sh" \
  "$PWD/deploy/ec2-donation-monitor.sh" \
  "$PWD/ec2-donation-monitor.sh"
do
  if [ -f "$c" ]; then SH="$c"; break; fi
done
if [ -z "$SH" ]; then
  echo "ec2-donation-monitor.sh 를 찾지 못했습니다."
  exit 1
fi
python3 - "$SH" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
n = t.count('", ".join')
if n == 0:
    print("이미 패치됐거나 다른 버전입니다:", p)
else:
    p.write_text(t.replace('", ".join', "'|'.join"), encoding="utf-8")
    print("patched", n, "sites in", p)
PY
echo "모니터를 종료(q) 후 다시 실행하세요:"
echo "  TARGET_USER=din PORT=3000 bash deploy/ec2-donation-monitor.sh"
echo "쿠키를 쓰고 있으면 COOKIE=... 도 그대로 붙이면 됩니다."
