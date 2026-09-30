#!/usr/bin/env python3
"""EC2 후원 장부 확인. 읽기 전용.

누락 = 허브 id 가 장부에 없음.
중복 = 같은 허브 id 가 bank:sms 와 toonation:din 두 줄이고 이름·금액·메시지·시각이 같음.
"""
from __future__ import annotations

import json
import sys

ID_PREFIXES = (
    "toonation:din:",
    "bank:din:",
    "toonation:",
    "bank:sms:",
    "bank:",
    "ingest:",
    "toona:",
    "account:",
    "din:",
    "hub:",
)


def krw(n: int) -> str:
    return "{:,}원".format(int(n))


def bare_id(raw: str) -> str:
    cur = (raw or "").strip()
    for _ in range(8):
        hit = False
        for prefix in ID_PREFIXES:
            if cur.startswith(prefix) and len(cur) > len(prefix):
                cur = cur[len(prefix) :]
                hit = True
                break
        if not hit:
            break
    return cur


def id_cores(raw: str) -> set[str]:
    raw = (raw or "").strip()
    if not raw:
        return set()
    keys = {raw}
    cur = raw
    for _ in range(8):
        hit = False
        for prefix in ID_PREFIXES:
            if cur.startswith(prefix) and len(cur) > len(prefix):
                cur = cur[len(prefix) :]
                keys.add(cur)
                hit = True
                break
        if not hit:
            break
    return keys


def donor_rows(state: dict) -> list[dict]:
    donors = state.get("donors")
    if not isinstance(donors, list) and isinstance(state.get("state"), dict):
        donors = state["state"].get("donors")
    if not isinstance(donors, list):
        return []
    return [row for row in donors if isinstance(row, dict) and str(row.get("id") or "").strip()]


def hub_rows(hub: dict) -> list[dict]:
    logs = hub.get("logs")
    if not isinstance(logs, list) or not logs:
        logs = hub.get("donationLogs")
    if not isinstance(logs, list):
        return []
    return [row for row in logs if isinstance(row, dict) and str(row.get("id") or "").strip()]


def body_key(row: dict) -> tuple:
    try:
        amount = int(row.get("amount") or 0)
    except (TypeError, ValueError):
        amount = 0
    try:
        at = int(row.get("at") or 0)
    except (TypeError, ValueError):
        at = 0
    name = str(row.get("name") or row.get("donorName") or "").strip()
    message = str(row.get("message") or "").strip()
    return (name, amount, message, at)


def state_match_keys(rows: list[dict]) -> set[str]:
    keys: set[str] = set()
    for row in rows:
        keys |= id_cores(str(row.get("id") or ""))
        keys |= id_cores(str(row.get("externalId") or ""))
    return keys


def has_donor_list(state: dict) -> bool:
    if isinstance(state.get("donors"), list):
        return True
    nested = state.get("state")
    return isinstance(nested, dict) and isinstance(nested.get("donors"), list)


def analyze(state: dict, hub: dict, queue_n: int = 0, unmatch_n: int = 0, state_ok: bool = True) -> dict:
    rows = donor_rows(state) if state_ok else []
    if not state_ok or not has_donor_list(state):
        return {
            "verdict": "STATE_FAIL",
            "lines": ["판정: STATE_FAIL", "장부를 읽지 못했습니다. 0건으로 보지 않습니다."],
        }

    groups: dict[str, list[dict]] = {}
    total = 0
    for row in rows:
        total += int(row.get("amount") or 0)
        key = bare_id(str(row.get("id") or ""))
        groups.setdefault(key, []).append(row)

    identical = []
    different = []
    singles = 0
    single_sum = 0
    extra = 0
    for key, group in groups.items():
        if len(group) == 1:
            singles += 1
            single_sum += int(group[0].get("amount") or 0)
            continue
        bodies = {body_key(row) for row in group}
        amount = int(group[0].get("amount") or 0)
        if len(bodies) == 1:
            identical.append((key, group, amount))
            extra += amount * (len(group) - 1)
        else:
            different.append((key, group))

    identical.sort(key=lambda item: item[2], reverse=True)
    one_copy = total - extra

    h_rows = hub_rows(hub)
    st_keys = state_match_keys(rows)
    missing = []
    missing_sum = 0
    for row in h_rows:
        hid = str(row.get("id") or "").strip()
        if id_cores(hid).isdisjoint(st_keys):
            missing.append(row)
            try:
                missing_sum += int(row.get("amount") or 0)
            except (TypeError, ValueError):
                pass

    if identical and missing:
        verdict = "DUP_MISSING"
    elif identical or different:
        verdict = "DUP"
    elif missing:
        verdict = "MISSING"
    else:
        verdict = "OK"

    lines = [
        "판정: {0}".format(verdict),
        "장부 {0}줄  합계 {1}  허브 id {2}개".format(len(rows), krw(total), len(groups)),
        "한 줄 {0}건 {1}".format(singles, krw(single_sum)),
        "같은 후원 두 줄 {0}쌍  한 번 더 들어간 금액 {1}".format(len(identical), krw(extra)),
        "한 줄만 인정한 합계 {0}".format(krw(one_copy)),
    ]
    if identical:
        lines.append("두 줄 예:")
        for key, group, amount in identical[:3]:
            body = body_key(group[0])
            ids = ", ".join(str(row.get("id") or "") for row in group)
            lines.append("  {0} {1} {2} | {3}".format(body[0], krw(amount), body[2], ids))
        if len(identical) > 3:
            lines.append("  … 외 {0}쌍".format(len(identical) - 3))
    if different:
        lines.append("같은 허브 id인데 내용이 다른 묶음 {0}개".format(len(different)))
    if h_rows:
        lines.append("허브 버퍼 {0}건 중 장부에 없는 후원 {1}건 {2}".format(len(h_rows), len(missing), krw(missing_sum)))
    else:
        lines.append("허브 세션이 비어 있어 허브 목록과 장부는 대조하지 못했습니다.")
    lines.append("대기 QUEUE {0}  UNMATCH {1}  (장부 반영 전. 누락이 아님)".format(queue_n, unmatch_n))
    if verdict == "OK":
        lines.append("장부에 같은 후원이 두 줄로 남아 있지 않습니다.")
    return {
        "verdict": verdict,
        "rows": len(rows),
        "sum": total,
        "groups": len(groups),
        "singles": singles,
        "pairs": len(identical),
        "extra": extra,
        "one_copy": one_copy,
        "different": len(different),
        "missing": len(missing),
        "missing_sum": missing_sum,
        "lines": lines,
    }


def main() -> int:
    if len(sys.argv) < 5:
        print("usage: STATE.json HUB.json QUEUE UNMATCH", file=sys.stderr)
        return 2
    state_path, hub_path, queue_s, unmatch_s = sys.argv[1:5]
    try:
        with open(state_path, "r", encoding="utf-8") as fh:
            state = json.load(fh)
        state_ok = isinstance(state, dict)
    except Exception:
        state = {}
        state_ok = False
    try:
        with open(hub_path, "r", encoding="utf-8") as fh:
            hub = json.load(fh)
        if not isinstance(hub, dict):
            hub = {}
    except Exception:
        hub = {}
    try:
        queue_n = int(queue_s or 0)
    except ValueError:
        queue_n = 0
    try:
        unmatch_n = int(unmatch_s or 0)
    except ValueError:
        unmatch_n = 0
    report = analyze(state, hub, queue_n, unmatch_n, state_ok and isinstance(state, dict))
    sys.stdout.write("\n".join(report["lines"]) + "\n")
    if report["verdict"] == "STATE_FAIL":
        return 2
    if report["verdict"] != "OK":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
