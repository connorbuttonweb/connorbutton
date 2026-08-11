# Reconciling the dashboard against Questrade statements

The brokerage feed cannot supply two things the monthly statements can: the
**market value of an in-kind transfer**, and a **real mark for an option** on a
past date. Both were reconstructed from what the feed does publish, and both
were wrong in the same direction — flattering the return.

This file records how to read the statements for those figures, what has already
been corrected, and the one correction still outstanding.

## What a statement is authoritative for

Reconcile against these, in this order:

1. **Balance Changes** (Summary, ~p5) — the only place market value of transfers
   appears. Verify it before trusting it: `A − B − C + D` must equal the stated
   *Change in balance*, where `C` is *Deposits* and `D` is *Withdrawals*.
2. **Cash changes** (Activity Details) — splits `C` into cash contributions vs
   everything else, which is what isolates the securities.
3. **Options Owned** (Investment Details) — month-end marks. The feed's
   historical option prices are purchase cost, not market.
4. **Transactions** — real sale prices, and `EXP` rows for worthless expiries.

Do **not** copy account numbers into any file in this repo.

## In-kind transfers: market value, not book value

An in-kind transfer arrives with no cash movement, so the feed records amount 0
and puts only `BOOK VALUE` in the description. `rebuild-history.js` parses that,
because it is all there is. The brokerage counts the transfer at **market**.

Book therefore understates any transfer that came across at a gain, and that
understatement is a permanent overstatement of return.

**To read the market value off a statement:**

```
  Deposits (Balance Changes)          market value of ALL deposits + transfers-in
− cash contributions (Cash changes)   the month's actual cash in
= securities transferred in at market
− any cash transferred out same day
= the net flow for that date
```

Put the result in `FLOW_OVERRIDES` in `scripts/rebuild-history.js`, with a
comment showing the arithmetic and naming the statement. **Never add a figure
without that provenance** — commit `befd6ef` left an unsourced $11,402.77 that
turned out to be wrong by $119.08, and nobody could tell where it came from.

### Confirmed

| Date | Account | Derived (book) | Statement (market) | Correction |
|---|---|---|---|---|
| 2026-05-14 | TFSA | $10,253.00 | **$10,953.74** | +$700.74 |
| 2026-06-08 | FHSA | $11,474.48 | **$11,521.85** | +$47.37 |

After these, flows dated ≤ 2026-06-30 total **$27,989.00**, matching the
statements exactly (TFSA deposits $15,445.71 − withdrawals $161.96 + FHSA
deposits $12,705.25). Total contributions $32,189.00; TWR 13.38% → 12.98%.

A new transfer with no override prints a warning on every run and is **not**
fatal — the day publishes at book value until the statement arrives.

### Why the overrides live in code

`befd6ef` corrected these same two dates by hand-editing `history.json` and
changed no script. `history.flows` is re-derived from the activity feed on every
`--snapshot` run, so the next snapshot silently reverted it — and because
`--snapshot-only` does not advance `meta.generated_at`, the file looked
untouched. A constant in `rebuild-history.js` cannot be rewritten by a pipeline
run. Do not move these into a data file.

## OUTSTANDING: option marks across the backfilled period

**Not yet corrected.** Needs the **July 2026 statements for both accounts**.

Backfilled snapshots (2026-05-14 … 2026-07-31, 40 of them) freeze every option
at its **purchase price** for the option's whole life. Live snapshots
(2026-08-04 onward) carry real marks from `get_quotes`. The boundary is visible
in the data:

```
AGI15JAN27C34.00   07-17:2.6  07-24:2.6  07-31:2.6 │ 08-04:2.43  08-06:3.55  08-07:4.58
                   └── backfilled, frozen at cost ─┘ └── live pulls, real market ──┘
```

**Size.** $587.80 of the $737.01 June month-end gap — 80% of it. Option exposure
carried at cost peaks at **15.0% of NAV on 2026-06-26** and runs 7–9% through
July. `IREN20NOV26C45.00` alone is ~$1,846 CAD, up to 7.5% of NAV, frozen at its
$13.00 purchase price across all 14 July snapshots.

### Marks already in hand

| Date | Option | Ours | Statement |
|---|---|---|---|
| 2026-05-29 | `ZEB05JUN26C70.00` | $0.25 | **$0.02** |
| 2026-05-29 | `ZEB05JUN26C69.50` | $0.40 | **$0.02** |
| 2026-06-30 | `PLTR21AUG26C165.00` | $3.30 | **$1.06** |
| 2026-06-30 | `PLTR21AUG26C160.00` | $3.15 | **$1.25** |

### Still needed from the July statements

Five options, across these snapshot dates:

| Option | Snapshot dates held |
|---|---|
| `PLTR21AUG26C160.00` | 07-01 … 07-03 |
| `IREN20NOV26C45.00` | 07-01 … 07-31 (14 snapshots) |
| `ZEB18SEP26C75.50.MX` | 07-07 … 07-31 |
| `AGI15JAN27C34.00` | 07-17 … 07-31 |
| `PXT21AUG26C24.00.MX` | 07-24 … 07-30 |

Take 07-31 marks from **Options Owned**, sale prices and dates from
**Transactions**, and $0 for any `EXP` row.

### Correction rule — step function, never interpolate

For each option, carry the nearest **observed** mark at or before the snapshot
date: purchase cost until the first real observation, then each statement or
trade mark until the next one. Do not interpolate between marks.

`befd6ef` found that fabricated mark-to-market interpolation "creat[es] fake
unrealized gains/recoveries that compound through the TWR chain". A step
function over observed points avoids that while removing the systematic upward
bias of carrying at cost.

**How to apply:** edit `last_price` on the affected
`history.snapshots[].positions[SYM]` entries, then run a full reprice (no
`--snapshot`) to rebuild `daily`, `benchmark` and `hypothetical`. Re-check the
snapshot reconciliation the script prints at the end.

**Why this closes the file.** Afterwards every snapshot is either
statement-verified (≤ 2026-07-31) or live-sourced (≥ 2026-08-04). The backfill
era ends and daily tracking carries it from there — this class of correction
should never be needed again.

## Known residual — leave it

~$147 at June month-end (0.5% of NAV), chiefly BEPC (+$69) and CHAT (+$68):
Yahoo **adjusted** closes vs the brokerage's **raw** closes. Adjusted close
backs out distributions, which is the correct input for a *return* series. This
is a definitional difference between a total-return curve and an account-value
curve, not an error.

Also expect the snapshot reconciliation to report ~$150 on dates where `CAD=X`
has no bar. Yahoo publishes FX Sun–Thu while equities trade Mon–Fri, so on 13 of
44 snapshot dates the check compares a correctly-FX'd curve value against an
expectation converted at *today's* rate
([rebuild-history.js](../scripts/rebuild-history.js), the `reconFx` fallback).
At a consistent rate those gaps collapse to $4–9. The curve is right; the check
is what misreports.
