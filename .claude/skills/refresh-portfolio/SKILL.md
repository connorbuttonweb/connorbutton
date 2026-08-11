---
name: refresh-portfolio
description: This skill should be used when the user asks to "refresh my portfolio", "update the portfolio data", "pull my Questrade data", "update portfolio.json", "refresh the dashboard data", "update my holdings", or otherwise asks to bring assets/data/portfolio.json in line with the live Questrade account. Covers the Questrade MCP call sequence, the merge that preserves accumulated history and hand-entered fund holdings, validation, and publishing.
version: 1.0.0
---

# Refreshing the investment dashboard's data

`/dashboard/` is a single-page fund fact sheet for Connor's portfolio. It reads two
data files, and this skill refreshes both from the live Questrade account:

- `assets/data/portfolio.json` — holdings, activity and fund constituents
- `assets/data/history.json` — the accumulating daily performance series

**A refresh is a merge, not a rebuild.** Several parts of those files either
accumulate over time or are maintained by hand, and none can be reconstructed
from the brokerage feed. `scripts/merge-portfolio.js` exists to protect them.

## Never

- **Never rewrite `history.portfolio`.** It is append-only and is the *only*
  source of return data on the page. The feed has no account-value history, and
  its transaction records carry no share quantities, so a lost equity curve is
  gone permanently.
- **Never overwrite `etfs`.** Fund constituents are typed in from fact sheet PDFs
  and are not available from any brokerage endpoint. They are maintained by the
  `fund-holdings` skill.
- **Never rewrite `history.json`.** Its `snapshots[]` accumulate one entry per
  refresh and are what makes a daily performance series possible at all.
- **Never write account numbers or brokerage UUIDs.** `portfolio.json` is served
  publicly from `www.connorbutton.ca`. Account *names* contain account numbers,
  and deposit descriptions embed them too.
- **Never back-fill history** by marking current holdings backwards against past
  prices. That produces a curve for a portfolio that was never held. Leave the
  figures blank; the dashboard already explains why they are missing.
- **Never correct a flow by editing `history.json`.** `history.flows` is
  re-derived from the activity feed on every `--snapshot` run, so a hand-edit is
  silently reverted by the next one — commit `befd6ef` lost exactly this way.
  Statement-confirmed figures go in `FLOW_OVERRIDES` in
  `scripts/rebuild-history.js`, and never without a comment naming the statement
  and showing the arithmetic. See `references/statement-reconciliation.md`.
- **Never push without asking.** Pushing publishes real balances.

## Workflow

### Step 0 — read the current file first

Read `assets/data/portfolio.json` and record:

- `history.portfolio.length` and the newest `date`
- `Object.keys(etfs).length`
- the newest `activities[].date`

These feed the merge and the validation gate. If the file does not exist, stop
and say so — a refresh has nothing to merge into, and creating one from scratch
would silently discard accumulated history.

### Step 1 — pull from Questrade

Full sequence and the feed's quirks are in **`references/questrade-mcp.md`**;
read it before the first call. In brief:

1. `list_accounts` — keep only `productType: "SD"`; exclude `SDCI` and `QWP`
2. `get_positions` and `get_balances` for each kept account
3. `get_quotes` for every distinct held symbol (20 per call max) — this also
   supplies the `securityUuid` needed next
4. `get_account_activities` per account, `fromDate` = newest stored activity date
   minus 3 days, **paging until `currentPage === totalPages`**
5. `get_historical_data` per symbol, `1wk` granularity, keyed by `securityUuid`

### Step 2 — write a snapshot

Write the pulled responses to a scratch `snapshot.json`, close to raw. The merge
script owns every transformation so they cannot drift between refreshes.

```jsonc
{
  "as_of": "2026-08-05",
  "accounts": [{ "positions": [/* raw get_positions */],
                 "balances":  {/* raw get_balances  */} }],
  "quotes":     [/* raw get_quotes */],
  "activities": [/* raw activity objects, all accounts concatenated */],
  "prices":     { "XEQT.TO": [{ "date": "2026-07-31", "close": 44.80 }] },
  "benchmark":  { "symbol": "VFV.TO", "series": [{ "date": "…", "level": 186.30 }] }
}
```

Two things to fix while assembling it, because the merge script refuses rather
than sanitizes:

- **Rewrite deposit descriptions** that contain account numbers (`"CONT 5383860516"`)
  to something neutral such as `"Contribution"`.

### Step 3 — merge

```bash
node .claude/skills/refresh-portfolio/scripts/merge-portfolio.js \
     <snapshot.json> assets/data/portfolio.json
```

Add `--dry-run` to preview the report without writing. The script derives the
exchange rate, merges positions across accounts with quantity-weighted average
cost, applies the ×100 option multiplier, maps activity types to the contract's
singular vocabulary, de-duplicates activities, appends today's history point, and
carries `etfs` and hand-tagged fields through untouched. It exits non-zero and
writes nothing if anything looks wrong.

### Step 3b — record the holdings snapshot and rebuild the daily series

```bash
node .claude/skills/refresh-portfolio/scripts/rebuild-history.js --snapshot --to <today>
```

This appends what is held right now to `assets/data/history.json`, then reprices
every recorded snapshot against daily closes to produce the portfolio's daily
value series — the only source of the performance figures on the page.

- `--to <today>` extends the series past the brokerage's as-of date, which
  matters because prices move on after the pull. **Omitting it silently
  truncates the series to the brokerage's as-of date.**
- Prices come from the market-proxy worker's `/history` route, falling back to
  Yahoo directly when the worker has not been redeployed.
- Watch the reconciliation it prints: the reconstruction should match each
  snapshot to within roughly 0.1% of portfolio value. A larger gap means a
  symbol is mapped to the wrong Yahoo listing.
- Any held symbol missing from `YAHOO_SYMBOLS` is a hard error rather than a
  silent omission, because skipping one would understate every return.

### Step 4 — validate (a hard gate)

```bash
node .claude/skills/refresh-portfolio/scripts/validate-portfolio.js \
     assets/data/portfolio.json \
     --prev-history-count <N from step 0> --prev-etf-count <N from step 0>
```

Passing the step-0 counts is what proves nothing was dropped. The validator also
loads the dashboard's own `normalize()` and `buildLookThrough()`, so a contract
break fails here rather than in the browser.

**If it fails, do not commit.** Restore with `git checkout -- assets/data/portfolio.json`
and investigate.

### Step 5 — report

Summarize: portfolio value and change since the last snapshot, positions opened
or closed, new activity count, history length before → after, and anything the
feed could not supply. The merge script prints most of this.

### Step 6 — commit, then ask

```bash
git add assets/data/portfolio.json assets/data/history.json
git commit -m "data: portfolio refresh YYYY-MM-DD"
```

Then **stop and ask before pushing.** Pushing publishes real balances to a public
site; it is the user's call every time.

## Common situations

**Re-running on the same day** — replaces that day's history point rather than
appending a second one. Safe.

**A new position appears** — handled automatically, but its `sector` and
`geography` will be `null` (the feed has no equity classification). Tag it by
hand in `positions[]` if the Overview groupings should account for it; the merge
carries those tags forward from then on.

**A fund's holdings need loading** — use the `fund-holdings` skill. This skill's
only obligation is that the `etfs` block survives every refresh untouched.

**Reconciliation warning** — a few dollars' gap between the computed total and
the brokerage's reported equity is expected (the balance snapshot and the quotes
are taken moments apart). More than $25 means a position is missing a quote, or
an option is missing its multiplier.

**The dashboard shows blank returns** — expected until `history.portfolio` has at
least two points. It fills in as snapshots accumulate.

## Resources

- **`references/data-contract.md`** — every field, its units, and a provenance
  table marking what a refresh may rewrite, append, or must never touch.
- **`references/questrade-mcp.md`** — call sequence and the feed quirks that
  cause silent corruption (formatted-string balances, plural type names, paging,
  missing quantities, option multipliers).
- **`references/statement-reconciliation.md`** — the two figures the feed cannot
  supply (market value of an in-kind transfer, and a past option mark), how to
  read them off a monthly statement, what is already corrected, and the one
  correction still outstanding pending the July 2026 statements.
- **`scripts/merge-portfolio.js`** — the transformation and merge.
- **`scripts/validate-portfolio.js`** — the invariant gate.
