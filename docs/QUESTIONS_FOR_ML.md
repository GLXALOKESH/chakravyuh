# Questions for the ML side

**From:** Member 1 (server). **For:** Member 3 (ML).

> **Status 3 Oct 2026.** Questions 1–7 were answered and four of the answers
> turned out to need work on the ML side, which has since been done on the
> `impl_pipeline_ml_n_server` branch. Kept for reference; the open items are at
> the bottom.

I have your data in Atlas and the server serves it. Ten questions, ordered by
how much they block the demo. Each one says what I observed and what I need.

Most are answerable in a sentence. The first three are the ones that decide
whether the dashboard looks convincing.

---

## 1. `risk_v2` is on a 0–100 scale, my server expects 0–1

**Blocking.**

`ml/models.py` line 178–179:

```python
result["risk_v1"] = _normalise_to_100(prob_v1)
result["risk_v2"] = _normalise_to_100(prob_v2)
```

The stored values confirm it. In Atlas right now, ring risks are:

```
RING01 risk=0.9999   RING02 risk=0.9992   RING03 risk=0.9998
```

A risk of `0.9999` on a 0–1 scale means the model is certain about every single
ring, which is not what a 0.94 ring-recall model actually produces. On a 0–100
scale those would be **99.99**, which is also implausible.

TRD §6 shows `"risk_v2": 0.88` and the frontend renders it as a percentage bar.

**Which is it?**

- If 0–1 is intended, `models.py` should not be normalising to 100.
- If 0–100 is intended, the server and the frontend need to divide by 100.

I can do the division server-side if you prefer to keep 0–100, but I would
rather fix it at the source — a bare `0.9999` in the database is a trap for
anyone reading it later.

---

## 2. `signals` is empty on 899 of 926 accounts

**Blocking for the explainability panel.**

```
accounts 926 | signals non-empty 27 | risk_v2 >= 0.5 → 27
```

`ml/generate.py` lines 184, 210 and 849 all write:

```python
"signals": [],
```

unconditionally. And `models.py` has `get_signals(account_id, df, v2_model)` at
line 192, which looks like exactly what's needed — but nothing appears to call it
in bulk during the push.

**Is that deliberate, or did the bulk call get missed?** The account panel shows
"why was this flagged" from `signals`, and right now only 27 of 926 accounts
have anything to show.

The shape I expect, per TRD §6:

```json
{ "feature": "pass_through", "label": "Forwards 94% of what it receives", "weight": 0.31 }
```

`label` is written for humans and the frontend renders it verbatim, so it
matters more than it looks.

---

## 3. `role` is null on 900 of 926 accounts

**Mostly fine, but worth confirming.**

```
roles: { source: 3, mule: 14, cash-out: 4, controller: 4, member: 1, null: 900 }
ring_id set: 26
```

`ml/rings.py` assigns roles inside ring detection, so only ring members get one.
That matches TRD §7.5 — roles are a ring concept.

Two things:

- **`relay` never appears.** TRD §7.5 defines it as role 5. Is it unreachable in
  practice, or just absent from this dataset? If unreachable, that's worth
  knowing before the demo because the dashboard legend will show a role that
  never appears.
- **Does the frontend need a role for non-members?** I render `"member"` as the
  fallback. TRD lists `member` as role 6, so that's consistent — confirm.

---

## 4. `recruits` collection has 0 documents

`GET /api/rings/RING01/recruits` returns `[]`. The recruits panel renders empty.

`recruits.json` in `ml/data/demo/outputs/` is 2 bytes, so this looks like the
predictor hasn't been run rather than a push problem.

**Is F10 done?** TRD §7.8 has a sanctioned fallback — a hand-weighted score, in
which case the field should be labelled "risk score", not "probability". Either
is fine, I just need to know which the number is so the frontend labels it
honestly.

---

## 5. `ml/data/demo/transactions.json` still has `amount_paise`

**This will break a re-seed.**

Your Atlas push is correct — `amount: 16835`, no `amount_paise` key. But the
file on disk is:

```
keys: _id,from,to,amount_paise,ts,channel,location,is_fraud
amount_paise present: true   amount present: false
19114400  (= ₹191,144 in paise)
```

So `mongo_pusher.py` converts, or reads something else. If anyone ever runs the
seeder from those files it fails on every transaction, because the server
requires `amount`.

**Which is the source of truth — the file or the push?** If the file is stale,
can it be regenerated so the two agree? I'd rather not have a path where the
obvious command silently fails.

---

## 6. Does the push replace or merge?

`mongo_pusher.py` — if I re-run it with a smaller dataset, do I get 926 accounts
or a mix of old and new? I ask because my seeder truncates inside a transaction,
so re-seeding is always clean. A merge would leave orphans that belong to a
previous run and would show up as accounts with no transactions.

Not urgent, but I'd rather know than find it during a re-run.

---

## 7. `default_taint` has 5 accounts, the ring has 10 members

`RING01` in `rings.json` has 5 members; Atlas shows `default_taint.accounts`
with 5 entries and the ring has 5 members in `member_ids`. Consistent.

Worth confirming though: **`default_taint` and `default_freeze` are what the
dashboard shows whenever Python is down**, which right now is always. If they
are computed once and frozen rather than per-request, that's fine — I just want
to know they're the real values and not placeholders. TRD §6 shows `{}`, and
`{}` produces a flat bar with no explanation.

---

## 8. PR-AUC 1.0 and Ring Recall 1.0

**Worth double-checking before this goes on a slide.**

Perfect scores on both usually mean one of:

- the test set leaked into training
- `is_fraud` or `ring_id` is in the feature set — the label is predicting itself
- the rings were planted and then detected with knowledge of the planting

Your `test` profile is a separate generation run, so genuine leakage is less
likely. But `risk_combined` isn't in the V1 feature list in TRD §7.2, and I'd
want to confirm no target-derived column crept in.

A judge who spots this costs more than a slightly lower honest number. 0.87
with a clean methodology is a better story than 1.0 that needs defending.

---

## 9. Is `ml/run.py` real?

Your guide says `python ml/run.py`. There is no such file — the entry points in
`ml/` are `pipeline.py` and `service.py`.

Is `run.py` something you meant to add, or should the docs say `pipeline.py`?

---

## 10. Which endpoint starts the service?

`ml/service.py` line 203 runs `uvicorn.run("service:app", ...)`. Confirm the
entry point is:

```bash
python ml/service.py     # from the repo root
```

and it binds `0.0.0.0:8000`. Mine calls `http://localhost:8000` and has a 3-second
timeout, so I need to know the port is fixed at 8000.

---

## What I need back

Short answers to **1**, **2** and **5** would unblock the most. The rest I can
work around.

**All ten were answered.** What the answers turned up, fixed on the
`impl_pipeline_ml_n_server` branch:

- `models.py` no longer calls `_normalise_to_100` — the 0–100 scale bug is
  genuinely fixed, scores are true 0–1.
- `mongo_pusher.py` was writing `amount_paise: 0` on every transaction. It read
  the pre-conversion field name while `run.py` had already converted the JSON to
  `amount`, so the ledger was effectively empty against live data.
- Taint conservation was failing by up to **257,214**, not "a few rupees" as I
  first wrote. `run.py` and `service.py` each converted paise to rupees using a
  magnitude threshold as a proxy for unit, so one response contained both
  currencies. Both now convert unconditionally, round rather than truncate, and
  share one `paise_to_rupees`.
- Question 3's victim-label mismatch turned out **not** to be a bug. Ring ids come
  from community discovery order, not from planted ring ids, so the label text is
  incidental. Tightening the match to `VICTIM_{ring_id}` was tried and left every
  ring with zero victims. The structural invariant is now asserted in
  `ml/tests/test_victim_ring_match.py`.

## Still open for Member 3

| | |
| --- | --- |
| Ring risk ~0.999 on all three rings | The scale fix did not change the stored values. Is the model genuinely that confident, or did the push predate the fix? |
| `signals` on 27 of 926 accounts | Understood as deliberate (SHAP above `risk_v2 >= 0.5`). The frontend will render "below the risk threshold" rather than a blank panel |
| `recruits` empty | F10 fell back to a hand-weighted score. Labelled "risk score" as agreed |
| PR-AUC 1.0 / ring recall 1.0 | Acknowledged as "too clean" data |
| **Ring recall is 0.0000** | Found while verifying the fix. Reproduces on unmodified code, so pre-existing. Worth a look |
| `ml/README.md` missing `brew install libomp` | The only non-Python prerequisite, and it fails late and confusingly |
| pytest must run from the repo root | From `ml/`, all 8 files fail to collect |
| 3 scratch files in the repo root | `patch_answers.py`, `patch_gen.py`, `revert_gen.py` |

## What is working, so you know what not to re-check

- 926 accounts, 475 identifiers, 8,041 transactions, 3 rings, 3 alerts
- All 11 endpoints return 200 against your data
- `/api/transactions` paginated, 161 pages at 50 per page
- `/taint` and `/freeze` return `cached: false` — **your service answering live**
- Taint conservation holds, live and cached, gaps 0–1 rupee
- `is_fraud` never appears in any response
- ML suite 33 passed · server suite 117 passed