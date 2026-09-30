#!/usr/bin/env python3
import unittest
from importlib.machinery import SourceFileLoader
from pathlib import Path

HERE = Path(__file__).resolve().parent
mod = SourceFileLoader("ledger_check", str(HERE / "ec2-donation-ledger-check.py")).load_module()


def donor(did: str, amount: int, name: str = "유이", message: str = "잠깐", at: int = 1000) -> dict:
    return {"id": did, "amount": amount, "name": name, "message": message, "at": at}


class LedgerCheckTest(unittest.TestCase):
    def test_identical_bank_and_poll_rows_are_one_extra_copy(self):
        hub_id = "cmumnh225030p5jbudpwtl6fi"
        report = mod.analyze(
            {
                "donors": [
                    donor("bank:sms:" + hub_id, 50000, at=1790684763053),
                    donor("toonation:din:" + hub_id, 50000, at=1790684763053),
                    donor("toonation:din:only-one", 3000, name="오라", message="다른", at=2000),
                ]
            },
            {"logs": []},
        )
        self.assertEqual(report["verdict"], "DUP")
        self.assertEqual(report["pairs"], 1)
        self.assertEqual(report["extra"], 50000)
        self.assertEqual(report["singles"], 1)
        self.assertEqual(report["one_copy"], 53000)
        self.assertEqual(report["sum"], 103000)

    def test_different_hub_ids_are_ok(self):
        report = mod.analyze(
            {"donors": [donor("toonation:din:a", 1000, at=1), donor("toonation:din:b", 2000, name="오라", at=2)]},
            {"logs": []},
        )
        self.assertEqual(report["verdict"], "OK")
        self.assertEqual(report["pairs"], 0)
        self.assertEqual(report["extra"], 0)

    def test_hub_id_absent_from_ledger_is_missing(self):
        report = mod.analyze(
            {"donors": [donor("toonation:din:kept", 1000)]},
            {"logs": [{"id": "kept", "amount": 1000}, {"id": "gone", "amount": 4000}]},
        )
        self.assertEqual(report["verdict"], "MISSING")
        self.assertEqual(report["missing"], 1)
        self.assertEqual(report["missing_sum"], 4000)

    def test_poll_row_covers_hub_id_so_pair_is_dup_not_missing(self):
        hub_id = "cmumnh225030p5jbudpwtl6fi"
        report = mod.analyze(
            {
                "donors": [
                    donor("bank:sms:" + hub_id, 50000),
                    donor("toonation:din:" + hub_id, 50000),
                ]
            },
            {"donationLogs": [{"id": hub_id, "amount": 50000}]},
        )
        self.assertEqual(report["verdict"], "DUP")
        self.assertEqual(report["missing"], 0)

    def test_same_tail_with_different_body_is_not_a_clean_pair(self):
        report = mod.analyze(
            {
                "donors": [
                    donor("bank:sms:same", 1000, name="유이", at=1),
                    donor("toonation:din:same", 2000, name="오라", at=2),
                ]
            },
            {"logs": []},
        )
        self.assertEqual(report["verdict"], "DUP")
        self.assertEqual(report["pairs"], 0)
        self.assertEqual(report["different"], 1)

    def test_unreadable_state(self):
        report = mod.analyze({}, {}, state_ok=False)
        self.assertEqual(report["verdict"], "STATE_FAIL")


if __name__ == "__main__":
    unittest.main()
