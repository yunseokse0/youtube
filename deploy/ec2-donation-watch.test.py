#!/usr/bin/env python3
import unittest
from importlib.machinery import SourceFileLoader
from pathlib import Path

HERE = Path(__file__).resolve().parent
mod = SourceFileLoader("donation_watch", str(HERE / "ec2-donation-watch.py")).load_module()


def donor(did: str, amount: int, name: str = "유이", message: str = "자키 합침", member_id: str = "jaki") -> dict:
    return {
        "id": did,
        "amount": amount,
        "contributionPoints": 999,
        "name": name,
        "message": message,
        "memberId": member_id,
        "at": 1000,
    }


MEMBERS = [{"id": "jaki", "name": "자키"}, {"id": "gwak", "name": "곽호경"}]


class DonationWatchTest(unittest.TestCase):
    def test_same_body_with_two_prefixes_is_one_extra_copy(self):
        hub_id = "cmumnh225030p5jbudpwtl6fi"
        report = mod.analyze(
            {
                "members": MEMBERS,
                "donors": [
                    donor("bank:sms:" + hub_id, 50000),
                    donor("toonation:din:" + hub_id, 50000),
                ],
            },
            {"scenario": "B", "logs": [{"id": "toona:" + hub_id, "amount": 50000}]},
        )
        self.assertEqual(report["verdict"], "DUP")
        self.assertEqual(report["extra"], 50000)
        self.assertEqual(report["one_copy"], 50000)
        self.assertEqual(report["ledger_sum"], 100000)
        self.assertEqual(report["window_hub_sum"], 50000)
        self.assertEqual(report["window_ledger_sum"], 100000)
        self.assertEqual(report["missing"], 0)

    def test_same_person_message_amount_with_different_ids_stay_separate(self):
        report = mod.analyze(
            {
                "members": MEMBERS,
                "donors": [
                    donor("bank:sms:aaa", 1000, name="같은", message="같은 문자"),
                    donor("bank:sms:bbb", 1000, name="같은", message="같은 문자"),
                ],
            },
            {"scenario": "B", "logs": []},
        )
        self.assertEqual(report["verdict"], "OK")
        self.assertEqual(report["uids"], 2)
        self.assertEqual(report["one_copy"], 2000)
        self.assertEqual(report["same_look_groups"], 1)
        self.assertEqual(report["extra"], 0)

    def test_hub_retry_lines_are_not_extra_money(self):
        hub_id = "retrycuid"
        logs = [{"id": "toona:" + hub_id, "amount": 3000} for _ in range(3)]
        report = mod.analyze(
            {"members": MEMBERS, "donors": [donor("bank:sms:" + hub_id, 3000)]},
            {"scenario": "B", "logs": logs},
        )
        self.assertEqual(report["verdict"], "OK")
        self.assertEqual(report["retries"], 2)
        self.assertEqual(report["window_hub_sum"], 3000)
        self.assertEqual(report["window_ledger_sum"], 3000)
        self.assertEqual(report["missing"], 0)

    def test_uid_in_the_window_and_absent_from_the_ledger_is_missing(self):
        report = mod.analyze(
            {"members": MEMBERS, "donors": [donor("bank:sms:kept", 1000)]},
            {"logs": [{"id": "toona:kept", "amount": 1000}, {"id": "toona:gone", "amount": 4000}]},
        )
        self.assertEqual(report["verdict"], "MISSING")
        self.assertEqual(report["missing"], 1)
        self.assertEqual(report["missing_sum"], 4000)

    def test_longer_ledger_than_the_window_is_not_missing(self):
        report = mod.analyze(
            {
                "members": MEMBERS,
                "donors": [
                    donor("bank:sms:old", 9000, message="자키 이전"),
                    donor("bank:sms:new", 1000, message="자키 지금"),
                ],
            },
            {"logs": [{"id": "toona:new", "amount": 1000}]},
        )
        self.assertEqual(report["verdict"], "OK")
        self.assertEqual(report["missing"], 0)
        self.assertEqual(report["rows"], 2)
        self.assertEqual(report["window_uids"], 1)

    def test_amount_is_won_not_contribution_points(self):
        report = mod.analyze(
            {"members": MEMBERS, "donors": [donor("bank:sms:one", 3000)]},
            {"logs": [{"id": "toona:one", "amount": 3000, "contributionPoints": 999}]},
        )
        self.assertEqual(report["one_copy"], 3000)
        self.assertEqual(report["window_hub_sum"], 3000)

    def test_replay_that_adds_another_ledger_row_is_counted(self):
        hub_id = "again"
        prev = {"oneCopy": 3000, "uids": {hub_id: {"rows": 1, "amount": 3000}}}
        report = mod.analyze(
            {
                "members": MEMBERS,
                "donors": [
                    donor("bank:sms:" + hub_id, 3000),
                    donor("bank:din:" + hub_id, 3000),
                ],
            },
            {"logs": [{"id": "toona:" + hub_id, "amount": 3000}]},
            prev,
        )
        self.assertEqual(report["replay_stored"], 1)
        self.assertEqual(report["verdict"], "DUP")

    def test_first_word_mismatch_is_reported_without_failing_the_sum(self):
        report = mod.analyze(
            {
                "members": MEMBERS,
                "donors": [donor("bank:sms:gap", 2000, message="간격 7", member_id="gwak")],
            },
            {"logs": [{"id": "toona:gap", "amount": 2000}]},
        )
        self.assertEqual(report["verdict"], "OK")
        self.assertEqual(report["member_mismatch"], 1)

    def test_unreadable_state(self):
        report = mod.analyze({}, {}, None, False)
        self.assertEqual(report["verdict"], "STATE_FAIL")


if __name__ == "__main__":
    unittest.main()
