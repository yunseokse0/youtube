#!/usr/bin/env python3
"""유튜브 후원 장부를 실시간으로 읽을 때의 판정. 저장하지 않는다.

같은 후원 id 본문은 한 건이다. bank:sms:, bank:din:, toonation:din: 은 접두사만 다르다.
사람·말·금액·시각이 같아도 id 본문이 다르면 각각 더한다.
금액은 amount(원)이다. contributionPoints 는 더하지 않는다.
허브에 보이는 목록은 최근 창이다. 줄 수로 빠짐을 판정하지 않고, 그 창의 uid별 amount 합을 장부와 비교한다.
"""
from __future__ import annotations

import json
import sys

ID_PREFIXES = (
    "toonation:din:",
    "bank:din:",
    "bank:sms:",
    "toonation:",
    "bank:",
    "ingest:",
    "toona:",
    "account:",
    "din:",
    "hub:",
    "sms:",
)


def krw(n: int) -> str:
    return "{:,}원".format(int(n))


def as_int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


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


def has_donor_list(state: dict) -> bool:
    if isinstance(state.get("donors"), list):
        return True
    nested = state.get("state")
    return isinstance(nested, dict) and isinstance(nested.get("donors"), list)


def first_word(message: str) -> str:
    parts = str(message or "").strip().split()
    return parts[0] if parts else ""


def member_names(state: dict) -> dict[str, str]:
    members = state.get("members")
    if not isinstance(members, list) and isinstance(state.get("state"), dict):
        members = state["state"].get("members")
    out: dict[str, str] = {}
    if not isinstance(members, list):
        return out
    for member in members:
        if not isinstance(member, dict):
            continue
        mid = str(member.get("id") or "").strip()
        if mid:
            out[mid] = str(member.get("name") or "").strip()
    return out


def content_key(row: dict) -> tuple:
    return (
        str(row.get("name") or row.get("donorName") or "").strip(),
        as_int(row.get("amount")),
        str(row.get("message") or "").strip(),
    )


def analyze(state: dict, hub: dict, prev: dict | None = None, state_ok: bool = True) -> dict:
    rows = donor_rows(state) if state_ok else []
    if not state_ok or not has_donor_list(state):
        return {
            "verdict": "STATE_FAIL",
            "lines": ["판정: STATE_FAIL", "장부를 읽지 못했습니다. 0건으로 보지 않습니다."],
            "snapshot": {},
        }

    names = member_names(state)
    groups: dict[str, list[dict]] = {}
    ledger_sum = 0
    for row in rows:
        ledger_sum += as_int(row.get("amount"))
        groups.setdefault(bare_id(str(row.get("id") or "")), []).append(row)

    extra = 0
    one_copy = 0
    dup_examples = []
    for key, group in groups.items():
        amount = as_int(group[0].get("amount"))
        one_copy += amount
        if len(group) > 1:
            extra += sum(as_int(row.get("amount")) for row in group[1:])
            dup_examples.append((key, group))
    dup_examples.sort(key=lambda item: as_int(item[1][0].get("amount")), reverse=True)

    same_look = {}
    for key, group in groups.items():
        if len(group) != 1:
            continue
        same_look.setdefault(content_key(group[0]), []).append(key)
    same_look_groups = [keys for keys in same_look.values() if len(keys) > 1]

    window: dict[str, dict] = {}
    hub_lines = hub_rows(hub)
    for row in hub_lines:
        key = bare_id(str(row.get("id") or ""))
        if not key or key in window:
            continue
        window[key] = row
    retries = max(0, len(hub_lines) - len(window))

    missing = []
    window_hub_sum = 0
    window_ledger_sum = 0
    for key, row in window.items():
        hub_amount = as_int(row.get("amount"))
        window_hub_sum += hub_amount
        group = groups.get(key) or []
        if not group:
            missing.append(row)
            continue
        window_ledger_sum += sum(as_int(item.get("amount")) for item in group)
    missing_sum = sum(as_int(row.get("amount")) for row in missing)
    window_gap = window_ledger_sum - window_hub_sum

    member_mismatch = 0
    word_counts: dict[str, int] = {}
    for row in rows:
        word = first_word(str(row.get("message") or ""))
        if word:
            word_counts[word] = word_counts.get(word, 0) + 1
        member = names.get(str(row.get("memberId") or "").strip(), "")
        if word and member and word != member:
            member_mismatch += 1

    prev_uids = {}
    if isinstance(prev, dict) and isinstance(prev.get("uids"), dict):
        prev_uids = prev["uids"]
    new_uids = [key for key in groups if key not in prev_uids] if prev_uids else []
    replay_stored = []
    if prev_uids:
        for key, group in groups.items():
            old = prev_uids.get(key)
            if isinstance(old, dict) and len(group) > as_int(old.get("rows")):
                replay_stored.append(key)
    added = 0
    if prev_uids:
        prev_one = as_int(prev.get("oneCopy")) if isinstance(prev, dict) else 0
        added = one_copy - prev_one

    if dup_examples and missing:
        verdict = "DUP_MISSING"
    elif dup_examples:
        verdict = "DUP"
    elif missing:
        verdict = "MISSING"
    else:
        verdict = "OK"

    hub_ok = hub.get("ok") is True
    if not hub_ok:
        verdict = "HUB_FAIL" if verdict == "OK" else verdict

    scenario = str(hub.get("scenario") or "").strip().upper()
    if scenario == "B":
        scenario_line = "시나리오 B: 유튜브가 amount를 더합니다. 이 서버 시트는 그 건을 건너뜁니다."
    elif scenario == "A":
        scenario_line = "시나리오 A: 유튜브 엑셀에 amount를 더하면 이 서버 시트와 두 번 집계됩니다."
    else:
        scenario_line = "시나리오를 허브 응답에서 읽지 못했습니다."

    lines = [
        "판정: {0}".format(verdict),
        scenario_line,
        "장부 {0}줄  uid {1}개  amount 합 {2}".format(len(rows), len(groups), krw(ledger_sum)),
        "uid당 한 번만 더한 합 {0}  두 줄로 더 들어간 금액 {1}".format(krw(one_copy), krw(extra)),
        "최근 창 {0}줄  고유 uid {1}개  같은 uid 재전달 {2}줄".format(len(hub_lines), len(window), retries),
        "창의 uid amount 합 {0}  그 uid의 장부 amount 합 {1}  차이 {2}".format(
            krw(window_hub_sum), krw(window_ledger_sum), krw(window_gap)
        ),
        "창에만 있고 장부에 없는 uid {0}개 {1}".format(len(missing), krw(missing_sum)),
        "줄 수로 빠짐을 보지 않습니다. 창 밖 후원은 이 화면으로 확인할 수 없습니다.",
    ]
    if not hub_ok:
        lines.insert(
            1,
            "허브 로그를 읽지 못했습니다({0}). 로그인 쿠키(COOKIE)를 확인하세요. 빠짐은 판정하지 않았습니다.".format(
                str(hub.get("error") or "응답 없음")
            ),
        )
    if same_look_groups:
        lines.append(
            "이름·금액·말이 같아도 uid가 다른 묶음 {0}개. 각각 더합니다.".format(len(same_look_groups))
        )
    if member_mismatch:
        top_words = sorted(word_counts.items(), key=lambda item: item[1], reverse=True)[:4]
        word_text = ", ".join("{0} {1}".format(word, count) for word, count in top_words)
        lines.append(
            "메시지 첫 단어와 멤버가 다른 줄 {0}건. 첫 단어: {1}".format(member_mismatch, word_text)
        )
    if prev_uids:
        lines.append(
            "직전보다 uid {0}개 추가  한 번 합 {1}  이미 있던 uid가 줄로 다시 늘어남 {2}개".format(
                len(new_uids), krw(added), len(replay_stored)
            )
        )
    if dup_examples:
        lines.append("두 줄 예:")
        for key, group in dup_examples[:3]:
            ids = ", ".join(str(row.get("id") or "") for row in group)
            lines.append("  {0} {1} | {2}".format(key, krw(as_int(group[0].get("amount"))), ids))
    if missing:
        lines.append("장부에 없는 창 uid:")
        for row in missing[:3]:
            lines.append(
                "  {0} {1} {2}".format(
                    bare_id(str(row.get("id") or "")),
                    krw(as_int(row.get("amount"))),
                    str(row.get("donorName") or row.get("name") or ""),
                )
            )

    snapshot = {
        "oneCopy": one_copy,
        "uids": {key: {"rows": len(group), "amount": as_int(group[0].get("amount"))} for key, group in groups.items()},
    }
    return {
        "verdict": verdict,
        "rows": len(rows),
        "uids": len(groups),
        "ledger_sum": ledger_sum,
        "one_copy": one_copy,
        "extra": extra,
        "retries": retries,
        "window_uids": len(window),
        "window_hub_sum": window_hub_sum,
        "window_ledger_sum": window_ledger_sum,
        "missing": len(missing),
        "missing_sum": missing_sum,
        "same_look_groups": len(same_look_groups),
        "member_mismatch": member_mismatch,
        "new_uids": len(new_uids),
        "replay_stored": len(replay_stored),
        "lines": lines,
        "snapshot": snapshot,
    }


def load_json(path: str) -> tuple[dict, bool]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return (data if isinstance(data, dict) else {}), isinstance(data, dict)
    except Exception:
        return {}, False


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: STATE.json HUB.json [PREV.json] [NEXT.json]", file=sys.stderr)
        return 2
    state, state_ok = load_json(sys.argv[1])
    hub, _hub_ok = load_json(sys.argv[2])
    prev = None
    if len(sys.argv) >= 4 and sys.argv[3]:
        prev_data, prev_ok = load_json(sys.argv[3])
        prev = prev_data if prev_ok else None
    report = analyze(state, hub, prev, state_ok)
    sys.stdout.write("\n".join(report["lines"]) + "\n")
    if len(sys.argv) >= 5 and sys.argv[4]:
        try:
            with open(sys.argv[4], "w", encoding="utf-8") as fh:
                json.dump(report.get("snapshot") or {}, fh, ensure_ascii=False)
        except Exception:
            pass
    if report["verdict"] == "STATE_FAIL":
        return 2
    if report["verdict"] != "OK":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
