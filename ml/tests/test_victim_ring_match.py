"""
Regression test for the ring/victim invariant (3 Oct 2026).

Written after an investigation that started from a suspected bug and ended
without one, which is worth recording so nobody repeats it.

What looked like a bug: each ring's `victim_txn_ids[0]` carried a sender label
naming a different ring — RING01's victim was sent by `VICTIM_RING03`. Since
TRD 7.6 traces taint from this id, that reads like the whole trace starts from
the wrong deposit.

It does not. `rings.py` assigns `ring_id` by community discovery order, so a
discovered RING01 is not the planted RING01 — the label text is incidental and
never was a reliable identifier. Tightening the match to `VICTIM_{ring_id}` was
tried and left every ring with zero victims, which is how the false lead was
ruled out.

The invariant that actually matters is structural and is what these tests
assert: the deposit is from an external victim, and it lands on a member of the
ring that claims it. Both have to hold for the taint trace to mean anything.

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
    def test_victim_deposit_is_a_victim_at_all(self, artifacts):
        # The label text cannot be checked against the ring id. Ring ids are
        # assigned by community discovery order in rings.py, not by which planted
        # ring a community came from, so a discovered RING01 is not necessarily
        # related to a planted RING01. What must hold is that the sender is some
        # external victim rather than a ring member or a sentinel.
        transactions, rings = artifacts
        by_id = {t["_id"]: t for t in transactions}

        assert rings, "expected rings in the demo profile"
        for ring in rings:
            for vid in ring["victim_txn_ids"]:
                txn = by_id.get(vid)
                assert txn is not None, f"{ring['_id']} references unknown txn {vid}"
                assert txn["from"].startswith("VICTIM"), (
                    f"{ring['_id']} claims {vid}, sent by {txn['from']}, "
                    f"which is not a victim"
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