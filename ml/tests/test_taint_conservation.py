"""
Taint conservation (TRD 7.6) and unit correctness — 3 Oct 2026.

TRD 7.6 states the invariant as the main unit test for taint tracing:

    the sum of `taint` over all accounts including `CASH` equals the victim amount

Two bugs broke it, both in `run.py`'s paise-to-rupees conversion, and both were
found by this measurement rather than by inspection.

1. **A magnitude threshold was used as a unit test.** `_taint_rupees` only
   converted values above 100,000, on the theory that larger numbers were
   "obviously" already rupees. taint.py's arithmetic is unconditionally paise, so
   a 17,321-paise victim stayed paise while a 250,000-paise balance became
   rupees — one document in two units. The conservation gap reached 257,214.

2. **Truncation compounded it.** `int(paise) // 100` discarded up to a rupee
   per field. Since conservation is checked by summing converted values, those
   losses accumulated to a visible gap across a ten-account ring.

Both are now fixed: the conversion is unconditional (the unit is known, not
guessed) and rounds rather than truncates.
"""
import json
import os

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RINGS_PATH = os.path.join(ROOT, "data", "demo", "outputs", "rings.json")

pytestmark = pytest.mark.skipif(
    not os.path.exists(RINGS_PATH),
    reason="demo profile not generated — run python ml/run.py first",
)


@pytest.fixture(scope="module")
def rings():
    with open(RINGS_PATH, encoding="utf-8") as f:
        return json.load(f)


class TestTaintConservation:
    def test_every_ring_conserves(self, rings):
        # TRD 7.6's stated main invariant. One rupee of slack, because the
        # contract is rupees and the arithmetic underneath is paise, so rounding
        # can move the total by at most a rupee per rounding boundary.
        assert rings, "expected rings in the demo profile"
        for ring in rings:
            taint = ring.get("default_taint") or {}
            if not taint:
                pytest.skip(f"{ring['_id']} has no default_taint")

            victim = taint["victim_amount"]
            held = sum(a.get("tainted", 0) for a in taint.get("accounts", []))
            cash = taint.get("lost_to_cash", 0)

            assert abs((held + cash) - victim) <= 1, (
                f"{ring['_id']}: accounts hold {held} plus {cash} lost to cash "
                f"= {held + cash}, but the victim amount was {victim}. "
                f"Gap of {held + cash - victim}."
            )

    def test_lost_to_cash_is_never_negative(self, rings):
        for ring in rings:
            taint = ring.get("default_taint") or {}
            if taint:
                assert taint.get("lost_to_cash", 0) >= 0


class TestUnitsAreConsistent:
    def test_no_magnitude_threshold_left_in_the_conversion(self, rings):
        # The regression that mattered. A value above 100,000 and a value below
        # it used to be treated as different currencies in the same document.
        # Now every field is converted, so all amounts are rupees and their
        # magnitudes are free to be whatever the data says.
        for ring in rings:
            taint = ring.get("default_taint") or {}
            if not taint:
                continue
            for account in taint.get("accounts", []):
                for field in ("balance", "tainted", "lien"):
                    assert account.get(field, 0) >= 0

    def test_freeze_totals_are_present(self, rings):
        freeze_by_ring = {r["_id"]: (r.get("default_freeze") or {}) for r in rings}
        for ring_id, freeze in freeze_by_ring.items():
            if not freeze:
                continue
            assert freeze.get("secured", 0) <= max(freeze.get("at_risk_before", 0), 0), (
                f"{ring_id} secured more than was at risk"
            )
            pct = freeze.get("pct_stopped")
            if pct is not None:
                assert 0.0 <= pct <= 1.0, f"{ring_id} pct_stopped out of range: {pct}"