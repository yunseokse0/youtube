#!/usr/bin/env python3
import json
import os
import tempfile
import unittest

from importlib.machinery import SourceFileLoader
from pathlib import Path

HERE = Path(__file__).resolve().parent
mod = SourceFileLoader("lt_sum", str(HERE / "ec2-donation-loadtest-summary.py")).load_module()


class LoadtestSummaryTest(unittest.TestCase):
    def test_hub_smaller_than_state_is_ok(self):
        out = mod.summarize(
            {"donors": [{"id": "a", "amount": 1}, {"id": "b", "amount": 2}, {"id": "c", "amount": 3}]},
            {"logs": [{"id": "c", "amount": 3}]},
            0,
            0,
            200,
            True,
        )
        self.assertEqual(out["verdict"], "OK")
        self.assertEqual(out["missing_n"], 0)
        self.assertEqual(out["state_n"], 3)
        self.assertEqual(out["hub_n"], 1)

    def test_hub_id_missing_from_state(self):
        out = mod.summarize(
            {"donors": [{"id": "a", "amount": 1000}]},
            {"logs": [{"id": "a", "amount": 1000}, {"id": "miss-1", "amount": 5000}]},
            0,
            0,
            200,
            True,
        )
        self.assertEqual(out["verdict"], "MISSING")
        self.assertEqual(out["missing_n"], 1)
        self.assertEqual(out["missing_ids"], ["miss-1"])
        self.assertEqual(out["missing_sum"], 5000)

    def test_mapped_toonation_din_prefix_is_not_missing(self):
        hub_id = "toona.com:jydyej00us5jhp8gtw6k"
        out = mod.summarize(
            {"donors": [{"id": "toonation:din:" + hub_id, "amount": 1000, "externalId": hub_id}]},
            {"logs": [{"id": hub_id, "amount": 1000}]},
            0,
            0,
            200,
            True,
        )
        self.assertEqual(out["verdict"], "OK")
        self.assertEqual(out["missing_n"], 0)

    def test_hub_toona_prefix_matches_state_din_id(self):
        hub_id = "toona.com:cmukq3ku04e5j1ap1aurgqk"
        out = mod.summarize(
            {"donors": [{"id": "toonation:din:" + hub_id, "amount": 1000, "externalId": hub_id}]},
            {"logs": [{"id": "toona:" + hub_id, "amount": 1000}]},
            0,
            0,
            200,
            True,
        )
        self.assertEqual(out["verdict"], "OK")
        self.assertEqual(out["missing_n"], 0)

    def test_unreadable_state_is_fail_not_zero(self):
        out = mod.summarize({}, {}, 0, 0, 0, False)
        self.assertEqual(out["verdict"], "STATE_FAIL")

    def test_cli_writes_json(self):
        with tempfile.TemporaryDirectory() as td:
            st = os.path.join(td, "state.json")
            hb = os.path.join(td, "hub.json")
            outp = os.path.join(td, "out.json")
            with open(st, "w", encoding="utf-8") as f:
                json.dump({"donors": [{"id": "x", "amount": 10}]}, f)
            with open(hb, "w", encoding="utf-8") as f:
                json.dump({"logs": [{"id": "x", "amount": 10}, {"id": "y", "amount": 20}]}, f)
            rc = os.system(f'python3 "{HERE / "ec2-donation-loadtest-summary.py"}" "{st}" "{hb}" 0 0 "{outp}"')
            if rc != 0:
                rc = os.system(f'python "{HERE / "ec2-donation-loadtest-summary.py"}" "{st}" "{hb}" 0 0 "{outp}"')
            self.assertEqual(rc, 0)
            with open(outp, encoding="utf-8") as f:
                data = json.load(f)
            self.assertEqual(data["verdict"], "MISSING")
            self.assertEqual(data["missing_n"], 1)


if __name__ == "__main__":
    unittest.main()
