"""
Regression test for the ring/victim mismatch (fixed 3 Oct 2026).

Ring discovery picked up any transaction whose sender merely started with
"VICTIM", rather than the deposit labelled for that specific ring. When several
rings' communities shared an account, RING01 could be assigned another ring's
victim deposit.

The visible symptom was mislabelled data: a ring whose `victim_txn_ids[0]` had
`from: "VICTIM_RING03"`. The consequence was worse than cosmetic — TRD 7.6 traces
taint from that id, so the entire taint trace started from the wrong deposit and
freeze recommendations were computed against money that was never stolen from
this ring.

Checked against the produced artifacts rather than by calling `discover_rings`,
which needs a scored DataFrame and therefore a full model run. The artifact is
what the rest of the system consumes, so that is the right thing to assert on.

If the demo profile has not been generated these tests skip; the pipeline owns
producing it.
"""
import json
import os

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(ROOT, "data", "demo")

TXN_PATH = os.path.join(DEMO, "transactions.json")
RINGS_PATH = os.path.join(DEMO, "outputs", "rings.json")


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


pytestmark = pytest.mark.skipif(
    not (os.path.exists(TXN_PATH) and os.path.exists(RINGS_PATH)),
    reason="demo profile not generated — run python ml/run.py first",
)


@pytest.fixture(scope="module")
def artifacts():
    return _load(TXN_PATH), _load(RINGS_PATH)


class TestVictimBelongsToItsRing:
    def test_each_ring_victim_is_labelled_for_that_ring(self, artifacts):
        transactions, rings = artifacts
        by_id = {t["_id"]: t for t in transactions}

        assert rings, "expected rings in the demo profile"
        for ring in rings:
            ring_id = ring["_id"]
            for vid in ring["victim_txn_ids"]:
                txn = by_id.get(vid)
                assert txn is not None, f"{ring_id} references unknown txn {vid}"
                assert txn["from"] == f"VICTIM_{ring_id}", (
                    f"{ring_id} claims {vid} as its victim deposit, but that "
                    f"transaction was sent by {txn['from']}"
                )

    def test_victim_deposit_lands_on_a_member(self, artifacts):
        # The other half: the money must actually arrive at somebody in the ring,
        # or the taint trace has nothing to follow.
        transactions, rings = artifacts
        by_id = {t["_id"]: t for t in transactions}

        for ring in rings:
            members = set(ring["member_ids"])
            for vid in ring["victim_txn_ids"]:
                assert by_id[vid]["to"] in members, (
                    f"{ring['_id']} victim {vid} pays {by_id[vid]['to']}, "
                    f"which is not a member"
                )

    def test_every_ring_has_a_victim(self, artifacts):
        # A ring with no victim deposit produces empty taint and a freeze of
        # nothing, which reads as "no risk" rather than "not traced".
        _, rings = artifacts
        for ring in rings:
            assert ring["victim_txn_ids"], (
                f"{ring['_id']} has no victim transaction, so TRD 7.6 taint "
                f"tracing has nothing to start from"
            )

    def test_no_victim_deposit_is_claimed_by_two_rings(self, artifacts):
        # If two rings claim the same deposit, one of them is tracing money
        # stolen from the other, which is what made this look like a labelling
        # error when it was a selection error.
        _, rings = artifacts
        seen = {}
        for ring in rings:
            for vid in ring["victim_txn_ids"]:
                assert vid not in seen, (
                    f"{vid} is claimed as victim by both {seen[vid]} and "
                    f"{ring['_id']}"
                )
                seen[vid] = ring["_id"]