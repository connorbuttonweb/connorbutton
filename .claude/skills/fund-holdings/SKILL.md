---
name: fund-holdings
description: This skill should be used when the user asks to "add fund holdings", "update the ETF holdings", "load a fact sheet", "I have a new holdings file", "update the look-through", "refresh the fund constituents", or supplies an ETF holdings CSV/PDF to be reflected on the dashboard. Covers parsing each fund provider's format into holdings/<SYMBOL>.md, editing those markdowns, and applying them to the dashboard's look-through.
version: 1.0.0
---

# Fund holdings and the look-through

The dashboard's headline feature unpacks each ETF into the companies it holds, so the
same company held through several funds shows as one combined exposure. Brokerage feeds
do not publish constituents — they come from each fund's own holdings file.

**`holdings/<SYMBOL>.md` is the source of truth.** `portfolio.json`'s `etfs{}` block is
generated from those markdowns and should never be hand-edited.

```
fund holdings file (CSV/PDF)
        │  parse-holdings.js
        ▼
holdings/XEQT.TO.md        ← human-readable, hand-editable, diffable
        │  apply-holdings.js
        ▼
assets/data/portfolio.json → etfs{}
```

## Adding or updating a fund

### 1. Identify the format

| Provider | Vendor flag | Shape |
|---|---|---|
| iShares / BlackRock | `ishares` | CSV, metadata rows then a header; `Weight (%)`, `Location`, `Asset Class` |
| Vanguard | `vanguard` | CSV, preamble then `Ticker,Holding name,% of market value,Sector,Region` |
| Roundhill | `roundhill` | CSV, `Ticker,Name,Identifier,Weight,Shares,Market Value`; Bloomberg-style tickers, no sector |
| Fidelity and other PDFs | `generic` | Transcribe to TSV first — see below |

Details and quirks per provider: **`references/vendor-formats.md`**.

### 2. PDFs must be transcribed first

PDF listings cannot be parsed programmatically here. Read the PDF and write a TSV:

```
ticker <TAB> name <TAB> weight% <TAB> geography
```

Leave `ticker` empty when the provider publishes names only (Fidelity does); the
name-to-ticker map in `scripts/lib/normalize.js` resolves the ones it knows. Lines
starting with `#` are comments. Exclude cash, FX and derivative rows — the parser drops
them anyway, and their weight correctly surfaces as *Unresolved* on the dashboard.

### 3. Parse

```bash
node .claude/skills/fund-holdings/scripts/parse-holdings.js \
  --symbol XEQT.TO --name "iShares Core Equity ETF Portfolio" \
  --as-of 2026-08-03 --vendor ishares --in ~/Downloads/XEQT_holdings.csv
```

`--as-of` is **the fund's own published date**, not today. The dashboard flags holdings
older than 45 days as stale, which only works if this is accurate.

Optional `--min-weight` (default `0.01`, in percent) sets the reporting floor. Broad index
funds list thousands of positions whose weights round to zero; the default keeps every
holding that carries measurable weight.

### 4. Review the markdown

Open `holdings/<SYMBOL>.md`. It records coverage, what was excluded and why, and any
constituent that could not be resolved to a ticker (keyed `~NAME`, so it contributes to
sector and geography totals but never falsely matches another fund's holding).

Correct anything wrong — a ticker, a sector, a weight — directly in the table. The file is
the source of truth, so edits survive.

### 5. Apply

```bash
node .claude/skills/fund-holdings/scripts/apply-holdings.js
node .claude/skills/refresh-portfolio/scripts/validate-portfolio.js \
     assets/data/portfolio.json --prev-history-count N --prev-etf-count N
```

`apply-holdings.js` rebuilds `etfs{}` from every markdown, touching nothing else in
`portfolio.json` — positions, history, activities are all left as found. It also stamps
`canonical_ticker` on directly-held positions so cross-listings fold together.

Add `--dry-run` to preview, `--prune` to drop funds that no longer have a markdown
(otherwise they are kept, so a partially-documented set never loses data).

The validator is a hard gate. Do not commit if it fails.

## Never

- **Never hand-edit `etfs{}` in `portfolio.json`.** It is generated; the next apply
  overwrites it. Edit the markdown.
- **Never invent a ticker to force a match.** A wrong match fabricates overlap that does
  not exist, which is worse than reporting none. Leave it `~name`-keyed.
- **Never set `coverage` by hand.** It is the sum of the listed weights; the applier
  recomputes it and refuses a table totalling over 100%.
- **Never carry a stale `as_of` forward** when re-parsing a newer file.

## Why the normalization matters

No two providers agree on identifiers or sector names — iShares says `NVDA` and
"Information Technology", Vanguard says "Basic Materials", Roundhill says `2330 TT` with no
sector at all, Fidelity publishes names only. Overlap detection only works once these
resolve to one key, which is what `scripts/lib/normalize.js` does.

Two behaviours worth knowing:

- **Cross-listings fold onto one ticker.** Brookfield Renewable trades as `BEPC.TO` in
  Toronto and `BEPC` in New York. Kept apart, a 10% position reads as 7% plus 3% and never
  trips a concentration threshold; folded, it correctly flags.
- **Funds publishing over 100%** in securities (against negative cash) are scaled back to
  100%, so a fund contributes exactly its own market value to the look-through and value
  conservation holds. The published figure is recorded in the markdown.

To add an alias or a name mapping, edit `TICKER_ALIASES` / `NAME_TO_TICKER` in
`scripts/lib/normalize.js`, then re-parse.

## Resources

- **`references/vendor-formats.md`** — each provider's layout, quirks, and where to get the file.
- **`scripts/lib/normalize.js`** — sector taxonomy, country codes, ticker aliases, name map.
- **`scripts/parse-holdings.js`** — vendor file → markdown.
- **`scripts/apply-holdings.js`** — markdowns → `portfolio.json`.
- **`holdings/README.md`** — what the archive is and how to read it.
