#!/usr/bin/env python3
"""Hub logs <-> state.donors 정합성. bash -c 따옴표 이슈를 피하기 위해 별도 파일."""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone


def file_size(p: str) -> int:
    try:
        return os.path.getsize(p)
    except OSError:
        return 0


def krw(n) -> str:
    try:
        n = int(n)
    except (TypeError, ValueError):
        n = 0
    return "₩{:,}".format(n)


def fmt_ms(ms) -> str:
    if not ms or ms <= 0:
        return "없음"
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone().strftime("%m-%d %H:%M")
    except Exception:
        return str(ms)


STATE_ID_PREFIXES = (
    "toonation:din:",
    "bank:din:",
    "toonation:",
    "bank:sms:",
    "bank:",
)


def add_state_match_keys(keys: set[str], donor: dict) -> None:
    iid = str(donor.get("id") or "").strip()
    ext = str(donor.get("externalId") or "").strip()
    for raw in (iid, ext):
        if not raw:
            continue
        keys.add(raw)
        for p in STATE_ID_PREFIXES:
            if raw.startswith(p) and len(raw) > len(p):
                keys.add(raw[len(p) :])


def parse_at_to_ms(at) -> int:
    if not at:
        return 0
    if isinstance(at, (int, float)) and at > 1e11:
        return int(at)
    if isinstance(at, (int, float)) and at < 1e11:
        return int(at) * 1000
    try:
        return int(datetime.fromisoformat(str(at).replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return 0


def hub_meta(hub: dict) -> str:
    try:
        sess = hub.get("session") or {}
        email = str(sess.get("email") or "") if isinstance(sess, dict) else ""
        linked = str(sess.get("linkedAt") or "") if isinstance(sess, dict) else ""
        logs = hub.get("logs") or hub.get("donationLogs") or []
        l_n = len(logs) if isinstance(logs, list) else 0
        return (
            f"ok={hub.get('ok')} disabled={hub.get('disabled')} "
            f"email={email or '<none>'} linked={linked or '-'} logs_n={l_n}"
        )
    except Exception as e:
        return f"(meta_parse_err:{e})"


def state_meta(state: dict) -> str:
    try:
        donors = state.get("donors") or []
        d_n = len(donors) if isinstance(donors, list) else 0
        return f"donors_n={d_n} resetAt={state.get('settlementResetAt') or 0}"
    except Exception as e:
        return f"(state_meta_parse_err:{e})"


def write_lines(path: str, lines: list[str]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def bail(out_path: str, msg: str, st_bytes: int, hb_bytes: int, q_n: int, u_n: int, st_m: str, hb_m: str) -> None:
    write_lines(
        out_path,
        [
            f"(정합성 실패: {msg})",
            f"  debug: state_file={st_bytes:,} bytes · hub_file={hb_bytes:,} bytes",
            f"  debug: q_n={q_n} · u_n={u_n}",
            f"  state_meta: {st_m}",
            f"  hub_meta: {hb_m}",
        ],
    )
    sys.exit(0)


def main() -> int:
    if len(sys.argv) < 6:
        print("usage: ec2-donation-integrity.py STATE.json HUB.json QUEUE UNMATCH OUT.txt", file=sys.stderr)
        return 2
    state_file, hub_file, q_s, u_s, out_path = sys.argv[1:6]
    q_n = int(q_s or 0)
    u_n = int(u_s or 0)
    st_bytes = file_size(state_file)
    hb_bytes = file_size(hub_file)
    st_m = "(not-yet-parsed)"
    hb_m = "(not-yet-parsed)"

    try:
        with open(state_file, "r", encoding="utf-8", errors="replace") as f:
            state_raw = f.read()
        state = json.loads(state_raw or "{}")
    except Exception as e:
        bail(out_path, f"state JSON 파싱 실패: {e}", st_bytes, hb_bytes, q_n, u_n, st_m, hb_m)
        return 0

    try:
        with open(hub_file, "r", encoding="utf-8", errors="replace") as f:
            hub_raw = f.read()
        hub = json.loads(hub_raw or "{}")
    except Exception as e:
        bail(out_path, f"hub JSON 파싱 실패: {e}", st_bytes, hb_bytes, q_n, u_n, st_m, hb_m)
        return 0

    st_m = state_meta(state)
    hb_m = hub_meta(hub)

    st_donors = state.get("donors") or []
    reset_at = int(state.get("settlementResetAt") or 0)
    st_ids: set[str] = set()
    st_match: set[str] = set()
    st_sum = 0
    st_cnt = 0
    for d in st_donors:
        try:
            iid = str(d.get("id") or "").strip()
            if not iid:
                continue
            st_ids.add(iid)
            add_state_match_keys(st_match, d)
            st_cnt += 1
            st_sum += int(d.get("amount") or 0)
        except Exception:
            pass

    h_logs = hub.get("logs") or hub.get("donationLogs") or []
    if not isinstance(h_logs, list):
        h_logs = []
    sess = hub.get("session") if isinstance(hub.get("session"), dict) else {}
    hub_email = str((sess or {}).get("email") or "").strip()

    now_ms = int(time.time() * 1000)
    cutoff_1h = now_ms - 3600 * 1000
    cutoff_24h = now_ms - 86400 * 1000
    cutoff_long = now_ms - 86400 * 1000 * 30
    h_ids_1h: set[str] = set()
    h_sum_1h = 0
    h_cnt_1h = 0
    h_ids_24h: set[str] = set()
    h_sum_24h = 0
    h_cnt_24h = 0
    id_to_amt: dict[str, int] = {}
    id_to_ms: dict[str, int] = {}
    for log in h_logs:
        try:
            amt = int(log.get("amount") or 0)
            iid = str(log.get("id") or "").strip()
            if amt <= 0 or not iid:
                continue
            ms = parse_at_to_ms(log.get("at") or log.get("ingestedAt"))
            if not ms or ms < cutoff_long:
                continue
            if amt > id_to_amt.get(iid, 0):
                id_to_amt[iid] = amt
            id_to_ms[iid] = ms
            if ms >= cutoff_24h:
                h_ids_24h.add(iid)
                h_cnt_24h += 1
                h_sum_24h += amt
                if ms >= cutoff_1h:
                    h_ids_1h.add(iid)
                    h_cnt_1h += 1
                    h_sum_1h += amt
        except Exception:
            pass

    st_ids_24h: set[str] = set()
    st_sum_24h = 0
    st_cnt_24h = 0
    st_ids_1h: set[str] = set()
    st_sum_1h = 0
    st_cnt_1h = 0
    st_ids_pres: set[str] = set()
    st_sum_pres = 0
    st_cnt_pres = 0
    st_ids_post: set[str] = set()
    st_sum_post = 0
    st_cnt_post = 0
    for d in st_donors:
        try:
            iid = str(d.get("id") or "").strip()
            if not iid:
                continue
            amt = int(d.get("amount") or 0)
            at = parse_at_to_ms(d.get("at"))
            if at and at >= cutoff_24h:
                st_ids_24h.add(iid)
                st_cnt_24h += 1
                st_sum_24h += amt
                if at >= cutoff_1h:
                    st_ids_1h.add(iid)
                    st_cnt_1h += 1
                    st_sum_1h += amt
            if reset_at > 0:
                if at and at < reset_at:
                    st_ids_pres.add(iid)
                    st_cnt_pres += 1
                    st_sum_pres += amt
                elif at == 0 or at >= reset_at:
                    st_ids_post.add(iid)
                    st_cnt_post += 1
                    st_sum_post += amt
        except Exception:
            pass

    # 누락 = 허브 로그 id 가 state 전체(시간창 무관)에 없음. 1h 창끼리 빼면 ingest 시각 차이로 오탐 남.
    missing_ids_1h = sorted(h_ids_1h - st_match)[:20]
    missing_ids_24h = sorted(h_ids_24h - st_match)[:20]
    excess_ids = sorted(st_ids_24h - h_ids_24h)[:20]
    missing_ids_1h_sum = sum(id_to_amt.get(i, 0) for i in missing_ids_1h)
    missing_ids_24h_sum = sum(id_to_amt.get(i, 0) for i in missing_ids_24h)

    h_cnt_pre = 0
    h_sum_pre = 0
    st_in_pre: set[str] = set()
    st_in_pre_cnt = 0
    st_in_pre_sum = 0
    h_cnt_post = 0
    h_sum_post = 0
    missing_post_ids: list[str] = []
    missing_post_sum = 0
    h_pre_bd_ids: set[str] = set()
    if reset_at > 0:
        pre_cutoff_begin = reset_at - 86400 * 3 * 1000
        h_ids_pre: set[str] = set()
        for iid, ms in id_to_ms.items():
            if pre_cutoff_begin <= ms < reset_at:
                h_ids_pre.add(iid)
                h_cnt_pre += 1
                h_sum_pre += id_to_amt.get(iid, 0)
        for d in st_donors:
            try:
                iid = str(d.get("id") or "").strip()
                if not iid:
                    continue
                amt = int(d.get("amount") or 0)
                at = parse_at_to_ms(d.get("at"))
                if at and pre_cutoff_begin <= at < reset_at:
                    st_in_pre.add(iid)
                    st_in_pre_cnt += 1
                    st_in_pre_sum += amt
            except Exception:
                pass
        h_ids_post: set[str] = set()
        for iid, ms in id_to_ms.items():
            if ms >= reset_at:
                h_ids_post.add(iid)
                h_cnt_post += 1
                h_sum_post += id_to_amt.get(iid, 0)
        missing_post_ids = sorted(h_ids_post - st_match)[:20]
        missing_post_sum = sum(id_to_amt.get(i, 0) for i in missing_post_ids)
        pre_boundary_beg = reset_at - 3600 * 1000
        for iid, ms in id_to_ms.items():
            if pre_boundary_beg <= ms < reset_at:
                h_pre_bd_ids.add(iid)

    warnings: list[str] = []
    level = "OK"
    if q_n >= 100 or u_n >= 50:
        level = "CRITICAL"
        warnings.append(f"백로그 과다: QUEUE {q_n}건 / UNMATCH {u_n}건")
    elif q_n >= 20 or u_n >= 10:
        level = "WARN"
        warnings.append(f"백로그 주의: QUEUE {q_n}건 / UNMATCH {u_n}건")
    if len(h_logs) == 0:
        if hub_email:
            warnings.append(
                "Hub logs 0건 — 세션은 있으나 저장된 후원 로그가 비어 있음 "
                "(정산 리셋으로 비웠거나, 허브 동기화 결과가 0건. 관리자 '후원 로그'와 동일). "
                "허브↔state 누락 교차검증은 불가. 아래는 state 후원만 유효."
            )
        else:
            warnings.append(
                "Hub logs 0건 — DIN 허브 미로그인(COOKIE/email 없음). "
                "허브↔state 교차검증은 불가. 아래는 state 후원만 유효."
            )
        if level == "OK":
            level = "WARN"
    n_miss_24h = len(h_ids_24h - st_match)
    if n_miss_24h >= 10 or missing_ids_24h_sum >= 500000:
        level = "CRITICAL"
        warnings.append(f"24h 허브→정산표 누락: {n_miss_24h}건 / {krw(missing_ids_24h_sum)}")
    elif n_miss_24h >= 3 or missing_ids_24h_sum >= 50000:
        if level not in ("CRITICAL", "WARN"):
            level = "WARN"
        warnings.append(f"24h 허브→정산표 경미 누락: {n_miss_24h}건 / {krw(missing_ids_24h_sum)}")

    if reset_at > 0:
        if st_in_pre_cnt >= 5:
            if level != "CRITICAL":
                level = "CRITICAL" if level == "OK" else level
            warnings.append(
                f"RESET 경계 오류: 리셋({fmt_ms(reset_at)}) 이전 후원 {st_in_pre_cnt}건 / {krw(st_in_pre_sum)} 이 state에 남아있음"
            )
        elif st_in_pre_cnt >= 1:
            if level not in ("CRITICAL", "WARN"):
                level = "WARN"
            warnings.append(f"RESET 경계: 리셋 이전 후원 {st_in_pre_cnt}건 미량 유령")
        if len(missing_post_ids) >= 3 or missing_post_sum >= 100000:
            if len(missing_post_ids) >= 10 or missing_post_sum >= 500000:
                if level != "CRITICAL":
                    level = "CRITICAL" if level == "OK" else level
                warnings.append(
                    f"RESET 이후 누락 심각: POST hub {h_cnt_post}건 중 state에 {len(missing_post_ids)}건 / {krw(missing_post_sum)}"
                )
            else:
                if level not in ("CRITICAL", "WARN"):
                    level = "WARN"
                warnings.append(
                    f"RESET 이후 누락 주의: POST hub {h_cnt_post}건 중 state에 {len(missing_post_ids)}건 / {krw(missing_post_sum)}"
                )
        if len(h_pre_bd_ids) >= 3 and len(h_pre_bd_ids - st_match) >= len(h_pre_bd_ids):
            warnings.append(f"RESET 경계 알림: 리셋 직전 1시간 hub 후원 {len(h_pre_bd_ids)}건이 리셋으로 필터링됨")

    h_ids_all = set(id_to_amt.keys())
    missing_all = sorted(h_ids_all - st_match)
    missing_all_sum = sum(id_to_amt.get(i, 0) for i in missing_all)
    if missing_all:
        if len(missing_all) >= 10 or missing_all_sum >= 500000:
            level = "CRITICAL"
        elif level == "OK":
            level = "WARN"
        warnings.insert(0, f"누락 {len(missing_all)}건 / {krw(missing_all_sum)} — 허브에 있고 정산표에 없음")

    lv_color = {"OK": "\033[32m", "WARN": "\033[33m", "CRITICAL": "\033[31m"}.get(level, "\033[37m")
    if missing_all:
        verdict_line = f"판정: {lv_color}MISSING\033[0m  누락 {len(missing_all)}건 / {krw(missing_all_sum)}"
    elif level == "OK":
        verdict_line = f"판정: {lv_color}OK\033[0m  누락 0건"
    else:
        verdict_line = f"판정: {lv_color}{level}\033[0m  누락 0건 (대기/세션 이슈는 아래 경고)"

    lines = [
        verdict_line,
        "",
        f"  정산표(엑셀 반영 전체) : {st_cnt:>8}건 / {krw(st_sum)}",
        f"  허브 최근버퍼           : {len(h_logs):>8}건 / {krw(sum(id_to_amt.values()))}",
        "    ※ 허브 건수가 정산표보다 작아도 누락이 아님. 허브는 최근 일부만 보관.",
        f"  누락(허브id ∉ 정산표)   : {len(missing_all):>8}건 / {krw(missing_all_sum)}",
    ]
    if missing_all:
        lines.append("  누락 id: " + ", ".join(missing_all[:12]) + (" …" if len(missing_all) > 12 else ""))
    else:
        lines.append("  누락 id: (없음)")
    lines += [
        f"  처리 대기 QUEUE={q_n}  UNMATCH={u_n}  ← 엑셀 반영 전. 누락이 아님",
        "",
        f"  정산 리셋: {fmt_ms(reset_at)}"
        + (f"  ({reset_at:,} ms)" if reset_at > 0 else " (기록 없음)"),
    ]
    if not hub_email:
        lines.append("  Hub email: (없음)  ← COOKIE='sb_user=...' 필요")
    else:
        lines.append(f"  Hub email: {hub_email}")
    if reset_at > 0:
        lines.append(f"   └─ 리셋 이후 POST  : {st_cnt_post:>8}건 / {krw(st_sum_post)}")
        ghost = f"\033[33m{st_cnt_pres:>8}건 / {krw(st_sum_pres)}\033[0m"
        lines.append(
            f"   └─ 리셋 이전 유령  : {ghost}" + ("  ← filter 미작동 의심!" if st_cnt_pres > 0 else "  (clean)")
        )
    lines += [
        "",
        "  ┌─ 참고: 최근 1시간 (창끼리 건수 차이는 누락이 아님)",
        f"  │ 허브버퍼 : {h_cnt_1h:>6}건 / {krw(h_sum_1h)}",
        f"  │ 정산표   : {st_cnt_1h:>6}건 / {krw(st_sum_1h)}",
        f"  │ 누락     : {len(h_ids_1h - st_match)}건 / {krw(missing_ids_1h_sum)}"
        + (f" ({', '.join(missing_ids_1h[:5])})" if missing_ids_1h else " (없음)"),
        "",
        "  ┌─ 참고: 최근 24시간",
        f"  │ 허브버퍼 : {h_cnt_24h:>6}건 / {krw(h_sum_24h)}",
        f"  │ 정산표   : {st_cnt_24h:>6}건 / {krw(st_sum_24h)}",
        f"  │ 누락     : {n_miss_24h}건 / {krw(missing_ids_24h_sum)}"
        + (f" → {', '.join(missing_ids_24h[:5])}" if missing_ids_24h else " (없음)"),
        f"  └ 정산표만 있고 허브에 없음 {len(excess_ids)}건  (허브 버퍼라 정상)",
    ]
    if reset_at > 0:
        lines += [
            "",
            f"  ┌─ 리셋 경계 (resetAt={fmt_ms(reset_at)})",
            f"  │ PRE-RESET Hub (72h) : {h_cnt_pre:>6}건 / {krw(h_sum_pre)}",
            f"  │ PRE-RESET State 유령: {st_in_pre_cnt:>6}건 / {krw(st_in_pre_sum)}"
            + (f"  ({', '.join(sorted(st_in_pre)[:3])})" if st_in_pre else "  (0건 clean!)"),
            f"  │ POST-RESET Hub      : {h_cnt_post:>6}건 / {krw(h_sum_post)}",
            f"  │ POST-RESET State    : {st_cnt_post:>6}건 / {krw(st_sum_post)}",
            f"  │ POST 누락           : {len(missing_post_ids):>6}건 / {krw(missing_post_sum)}"
            + (f"  {', '.join(missing_post_ids[:5])}" if missing_post_ids else "  (clean!)"),
            f"  └ 리셋 직전 1시간 Hub {len(h_pre_bd_ids)}건 → state 없음 = 정상 필터",
        ]
    if warnings:
        lines.append("")
        lines.append("경고 상세:")
        for w in warnings:
            lines.append(f"   {w}")
    write_lines(out_path, lines)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        err_out = sys.argv[5] if len(sys.argv) > 5 else ""
        if err_out:
            try:
                write_lines(err_out, [f"(정합성 예외: {type(e).__name__}: {e})"])
            except Exception:
                pass
        raise SystemExit(0)
