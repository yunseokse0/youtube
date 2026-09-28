#!/usr/bin/env python3
"""부하테스트용 한 줄 요약. 누락 = 허브 id 가 정산표(state) 전체에 없는 경우만."""
from __future__ import annotations

import json
import os
import sys


def load_json(path: str) -> tuple[dict, bool]:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            raw = f.read()
        data = json.loads(raw or "{}")
        if isinstance(data, dict):
            return data, True
        return {}, False
    except Exception:
        return {}, False


# 긴 접두어를 먼저. toonation: 을 toona: 보다 앞에 둬야 toonation:din 이 tion:din 으로 안 잘린다.
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


def id_cores(raw: str) -> set[str]:
    raw = (raw or "").strip()
    if not raw:
        return set()
    keys = {raw}
    cur = raw
    for _ in range(8):
        hit = False
        for p in ID_PREFIXES:
            if cur.startswith(p) and len(cur) > len(p):
                cur = cur[len(p) :]
                keys.add(cur)
                hit = True
                break
        if not hit:
            break
    return keys


def add_state_match_keys(keys: set[str], donor: dict) -> None:
    for field in ("id", "externalId"):
        keys |= id_cores(str(donor.get(field) or ""))


def hub_ids_missing(hub_ids: set[str], st_keys: set[str]) -> set[str]:
    return {hid for hid in hub_ids if id_cores(hid).isdisjoint(st_keys)}


def ids_and_sum(rows: list) -> tuple[set[str], int, int]:
    ids: set[str] = set()
    total = 0
    n = 0
    for x in rows:
        if not isinstance(x, dict):
            continue
        iid = str(x.get("id") or "").strip()
        if not iid:
            continue
        ids.add(iid)
        n += 1
        try:
            total += int(x.get("amount") or 0)
        except (TypeError, ValueError):
            pass
    return ids, n, total


def state_match_keys(rows: list) -> set[str]:
    keys: set[str] = set()
    for x in rows:
        if isinstance(x, dict):
            add_state_match_keys(keys, x)
    return keys


def summarize(state: dict, hub: dict, q_n: int, u_n: int, state_bytes: int, parse_ok: bool) -> dict:
    st_rows = state.get("donors") if isinstance(state.get("donors"), list) else []
    h_rows = hub.get("logs") if isinstance(hub.get("logs"), list) else []
    if not h_rows:
        h_rows = hub.get("donationLogs") if isinstance(hub.get("donationLogs"), list) else []
    st_ids, st_n, st_sum = ids_and_sum(st_rows)
    h_ids, h_n, h_sum = ids_and_sum(h_rows)
    missing = sorted(hub_ids_missing(h_ids, state_match_keys(st_rows)))
    by_amt = {str(x.get("id") or ""): int(x.get("amount") or 0) for x in h_rows if isinstance(x, dict)}
    miss_sum = sum(by_amt.get(iid, 0) for iid in missing)
    donors_ok = parse_ok and isinstance(state.get("donors"), list)

    if not donors_ok or state_bytes <= 0:
        verdict = "STATE_FAIL"
        verdict_ko = "정산표를 못 읽음 (0건 표시는 데이터가 없는게 아님)"
    elif len(missing) > 0:
        verdict = "MISSING"
        verdict_ko = "누락 {0}건 — 허브에 있는데 정산표에 없음".format(len(missing))
    elif q_n >= 20 or u_n >= 10:
        verdict = "BACKLOG"
        verdict_ko = "누락은 없으나 QUEUE/UNMATCH 대기 있음"
    else:
        verdict = "OK"
        verdict_ko = "누락 없음"

    return {
        "verdict": verdict,
        "verdict_ko": verdict_ko,
        "state_n": st_n,
        "state_sum": st_sum,
        "hub_n": h_n,
        "hub_sum": h_sum,
        "missing_n": len(missing),
        "missing_sum": miss_sum,
        "missing_ids": missing[:8],
        "queue_n": q_n,
        "unmatch_n": u_n,
        "state_bytes": state_bytes,
    }


def main() -> int:
    if len(sys.argv) < 6:
        print("usage: STATE.json HUB.json QUEUE UNMATCH OUT.json", file=sys.stderr)
        return 2
    state_p, hub_p, q_s, u_s, out_p = sys.argv[1:6]
    q_n = int(q_s or 0)
    u_n = int(u_s or 0)
    state, parse_ok = load_json(state_p)
    hub, _hub_ok = load_json(hub_p)
    state_bytes = 0
    try:
        state_bytes = os.path.getsize(state_p)
    except OSError:
        pass
    out = summarize(state, hub, q_n, u_n, state_bytes, parse_ok)
    with open(out_p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
        f.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
