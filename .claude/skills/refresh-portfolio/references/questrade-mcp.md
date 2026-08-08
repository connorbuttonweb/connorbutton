# Questrade MCP — call sequence and feed quirks

Everything below was established by running against the live account. Several
items are not discoverable from the tool descriptions, and one of them
contradicts its description outright.

## Call sequence

| # | Tool | Notes |
|---|---|---|
| 1 | `list_accounts` | Returns `id` (UUID), `name`, `productType`. **Keep only `productType: "SD"`.** Exclude `SDCI` (custom indexing) and `QWP` (managed) — those are separately managed and are not part of this portfolio. |
| 2 | `get_positions` | One call per selected account. |
| 3 | `get_balances` | One call per selected account. |
| 4 | `get_quotes` | All distinct symbols, **20 per call max**. Also returns the `securityUuid` needed by step 6. |
| 5 | `get_account_activities` | Per account, `fromDate` = newest stored activity date **minus 3 days**. **Paged** — see below. |
| 6 | `get_historical_data` | Per symbol. Needs `securityUuid`, not the symbol. |
| 7 | `list_watchlists` → `get_watchlist` | `get_watchlist` returns quotes inline; no extra quote call needed. |

## Quirks that cause silent corruption

**Account names contain account numbers.** `list_accounts` returns names like
`"TFSA - 53838605"`. Never write the name, the `id`, or anything derived from
them. The merge script builds its own label and throws on any 7+ digit run.

**Deposit descriptions contain account numbers.** Activity descriptions read
`"CONT 5383860516"` and `"CON 4018394710 TO 5383860516"`. These must be
rewritten to something neutral such as `"Contribution"` before the snapshot is
handed to the merge script — the script throws rather than sanitizing, so that a
feed change surfaces instead of being quietly papered over.

**Balances are formatted strings, not numbers.** `"$14,572.58"`, `"-$29.48"`.
Parsing with a naive `parseFloat` yields `NaN`; stripping non-digits without
checking for a leading `-` silently flips the sign of a negative cash balance.

**Activity records carry no share quantity.** The tool description states
quantity is returned; in practice only `amount`, `currency`, `tradeDate`,
`description` and `transactionType` are populated. **This is why the equity curve
cannot be back-filled** — without quantities there is no way to reconstruct what
was held on any past date. History accrues forward instead.

**Activity type names are plural.** `Trades`, `Dividends`, `Deposits`,
`Fees and rebates`, `FX conversion`. The dashboard filters match the singular
contract vocabulary, so an unmapped type shows up as an empty Income tab rather
than an error. `TYPE_MAP` in `merge-portfolio.js` throws on anything unmapped.

**Activities are paged, 20 per page.** Check `metadata.totalPages` and
`metadata.currentPage`; keep requesting until they match. Stopping at page 1
silently truncates history.

**The same activity can appear in both accounts.** An ETF distribution paid into
two accounts produces byte-identical rows (same date, amount and description).
De-duplication keyed on those fields would wrongly collapse them into one, so the
merge script hashes `transactionId` into a `t_`-prefixed fingerprint instead.

**`get_historical_data` needs a `securityUuid`** from `get_quotes`, and caps the
number of candles returned. At `1d` granularity a 3-month window truncates to
roughly the most recent 40 candles (`candlesTruncated: true`) and can end a
session or two behind the live quote. Use `1wk` for anything longer than a
month — it covers the full window in ~14 candles.

**Options are quoted per share and trade in hundreds.** `avgPrice: 2.60` on one
contract of `AGI15JAN27C34.00` means $260, not $2.60. Every value derived from an
option's price needs the ×100 multiplier or the position reads at 1/100th.

**Fractional and non-standard instruments exist.** `GOLD.QM` is a fractional gold
position (`securityType: "Gold"`, quantity 0.3, `isTradable: false`). It is not a
stock and not an ETF; classify it as `Commodity`.

## What the feed does not have

| Missing | Consequence |
|---|---|
| **ETF constituent holdings** | The Fact Sheet's look-through cannot be populated. Constituents come from each fund's own fact sheet and are typed into the `etfs` block by hand. |
| **Account-value history** | No endpoint returns historical account equity. Combined with the missing share quantities, this is why `history.portfolio` is append-only. |
| **MER / management fees** | Each fund's published MER is transcribed by hand into `FUND_MER` in `merge-portfolio.js`; `profile.blended_mer` is then derived from it (portfolio-weighted, recomputed each refresh). A fund with no MER on file blanks the figure rather than being estimated — a guessed fee on a page that presents itself as a fund fact sheet would read as a stated one. |
| **Sector / geography for equities** | Not in the quote payload. Whatever was tagged previously is carried forward by the merge. |

## Deriving the exchange rate

Each account reports equity as `cad`, `usd` and `combinedCad`, so the rate the
broker actually applied can be recovered rather than guessed:

```
fx = (combinedCad - cad) / usd
```

Cross-check across accounts. Agreement to ~5 decimal places confirms the parse;
disagreement means the money strings are being read wrong, not that the rate
moved. The merge script refuses to continue if accounts differ by more than
0.001.

## Reconciliation target

Computed total (positions marked to live quotes + cash) will not exactly equal
the brokerage's reported `totalEquity`, because the balance snapshot and the
quotes are taken at slightly different moments. A gap of a few dollars on a
~$34k portfolio is expected; more than $25 signals a real problem — usually a
position missing a quote, or an option missing its multiplier.
