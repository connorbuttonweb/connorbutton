# Fund holdings archive

One markdown file per ETF held, recording the constituents that fund published and the date
it published them. These files are **the source of truth** for the dashboard's look-through —
`assets/data/portfolio.json`'s `etfs{}` block is generated from them and should never be
edited by hand.

| File | Fund | Holdings | Coverage | As at |
|---|---|---|---:|---|
| `XEQT.TO.md` | iShares Core Equity ETF Portfolio | 1,797 | 93.84% | 2026-08-03 |
| `FINN.TO.md` | Fidelity Global Innovators ETF | 105 | 98.84% | 2026-03-31 |
| `VDY.TO.md` | Vanguard FTSE Canadian High Dividend Yield Index ETF | 60 | 99.68% | 2026-07-31 |
| `CHAT.md` | Roundhill Generative AI & Technology ETF | 50 | 100.00% | 2026-08-04 |
| `DRAM.md` | Roundhill Memory ETF | 13 | 100.00% | 2026-08-31 |

## Why these exist

Brokerage feeds report that you own XEQT. They do not report that XEQT owns NVIDIA. Without
these files the dashboard can only say "five ETFs"; with them it can say the portfolio is
19% technology, that 127 companies are held through more than one fund, and that Micron is
one 1.45% exposure arriving through four funds at once rather than four unrelated
positions.

## Reading a file

Frontmatter carries the symbol, the fund's own `as_of`, and the coverage actually listed.
The body notes what was excluded and why, then a table:

| Column | Meaning |
|---|---|
| Ticker | Canonical ticker after normalization. `~NAME` means the provider published no ticker and the name could not be resolved — it still counts toward sector and geography totals but will never be treated as the same holding as another fund's row. |
| Weight % | Percent **of that fund**, not of the portfolio |
| Sector | Normalized to GICS names across providers |
| Geography | Country of listing or domicile as published |

**Coverage is not always 100%, and that is correct.** Cash, futures and sub-0.01% tail
positions are excluded; the shortfall appears on the dashboard as an explicit *Unresolved*
bucket rather than being silently redistributed.

**Some funds hold their exposure synthetically.** DRAM reaches most of its Micron, Samsung
and SK hynix position through total return swaps rather than shares. Those rows count
against the company each swap references — that is the exposure a look-through exists to
measure — and the file states how much of the fund is held that way. The collateral backing
them, a Treasury bill and a government money market fund, is excluded like any other cash.

## Updating

Use the `fund-holdings` skill — it parses each provider's format, normalizes tickers and
sectors, writes these files, and applies them to the dashboard. To correct a single value,
edit the table here and re-run `apply-holdings.js`.

Files are kept after a fund is sold, so historical look-throughs stay reproducible.
