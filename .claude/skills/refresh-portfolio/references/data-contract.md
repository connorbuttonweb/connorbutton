# `assets/data/portfolio.json` — the data contract

The dashboard reads exactly one file. `DASH.data.fetchPortfolio()` in
`assets/js/dashboard/data.js` is the only place the app touches its source.

## Provenance — which parts a refresh may touch

This table is the load-bearing part of this document.

| Section | Provenance | A refresh may… |
|---|---|---|
| `meta.generated_at`, `as_of`, `fx` | Derived from the feed | **rewrite** |
| `meta.inception_date`, `risk_free_rate`, `notes` | Set once | **carry forward** |
| `profile.*` | Derived; `blended_mer` from the hand-kept `FUND_MER` table | **rewrite** |
| `accounts[]` | Derived, except `contribution_room` | **rewrite**, carrying room forward |
| `positions[]` | Derived, except `sector`/`geography`/`market_cap_bucket` | **rewrite**, carrying tags forward |
| `activities[]` | Feed | **merge** — never replace wholesale |
| `dividends_projected[]` | Derived from quote yields | **rewrite**, carrying dates forward |
| `history.portfolio[]` | **Accumulated** | **append only** — never truncate, never reorder |
| `history.benchmarks{}` | Derived | **replace** |
| **`etfs{}`** | **Hand-entered from fund fact sheet PDFs** | **never touch** |

`etfs` and `history.portfolio` cannot be reconstructed from the brokerage feed.
Losing either is unrecoverable.

## Money and units

- Every monetary field is in the position's **native currency**; `currency` says
  which. Conversion to CAD happens in `normalize()` via `meta.fx.USDCAD`, and to
  the display currency at render time only — so rounding never compounds through
  the aggregations.
- Weights and yields are **fractions**, not percentages: `0.0247` is 2.47%.
- Dates are `YYYY-MM-DD`. `meta.generated_at` is a full ISO timestamp.

## Shape

```jsonc
{
  "meta": {
    "generated_at": "2026-08-05T01:49:17.791Z",
    "as_of": "2026-08-04",
    "base_currency": "CAD",
    "fx": { "USDCAD": 1.4045 },     // derived: (combinedCad - cad) / usd
    "inception_date": "2026-05-14", // first brokerage history; never moves
    "risk_free_rate": 0.029,        // for the Sharpe ratio
    "source": "questrade",
    "notes": "…"
  },

  "profile": {
    "blended_mer": 0.0049,          // NOT in the feed — each fund's published MER
                                    // (FUND_MER in merge-portfolio.js) weighted by
                                    // share of the WHOLE portfolio, so non-fund
                                    // holdings and cash sit in the denominator at
                                    // 0%. null if any held fund has no MER on file.
    "distribution_yield": 0.013,    // quote yields weighted by CAD market value
    "holdings_count": 8,
    "etf_count": 4,
    "benchmark_label": "S&P 500 (VFV.TO, CAD)"
  },

  // One logical account. Real account numbers and UUIDs are never stored.
  "accounts": [{
    "id": "main", "type": "Registered", "label": "Connor's Account",
    "cash": 676.26, "currency": "CAD", "buying_power": 660.74,
    "contribution_room": null      // not exposed by the feed; entered by hand
  }],

  "positions": [{
    "symbol": "XEQT.TO", "name": "iShares Core Equity ETF Portfolio",
    "account_id": "main",
    "asset_type": "ETF",           // ETF | Stock | Option | Commodity | Cash
    "currency": "CAD",
    "quantity": 200,
    "avg_cost": 44.1272,           // weighted by quantity across accounts
    "price": 46.01,
    "prev_close": 44.80,           // lastPrice - priceChangeAmount
    "market_value": 9202.00,       // quantity x price x multiplier
    "open_pnl": 374.56,
    "multiplier": 100,             // OPTIONS ONLY; omitted elsewhere
    "sector": null, "geography": null, "market_cap_bucket": null
  }],

  "prices": { "XEQT.TO": [{ "date": "2026-07-31", "close": 44.80 }] },

  // Look-through source. Typed in from each fund's fact sheet — not in the feed.
  // coverage MUST equal the sum of the listed weights; the shortfall surfaces as
  // the visible "Unresolved" bucket rather than being silently dropped.
  "etfs": {
    "XEQT.TO": {
      "name": "iShares Core Equity ETF Portfolio",
      "as_of": "2026-07-31",
      "coverage": 0.972,
      "holdings": [{
        "ticker": "AAPL", "name": "Apple Inc.", "weight": 0.0412,
        "sector": "Technology", "geography": "United States",
        "market_cap_bucket": "Mega", "currency": "USD"
      }]
    }
  },

  "activities": [{
    "uid": "t_1a2b3c4d5e",          // one-way hash of the brokerage transaction id
    "date": "2026-07-31", "type": "Deposit", "account_id": "main",
    "symbol": null, "description": "Contribution",
    "amount": 1500, "currency": "CAD", "quantity": null, "price": null
  }],

  "dividends_projected": [{
    "symbol": "VDY.TO", "annual_rate_per_share": 2.1655,
    "frequency": "monthly", "next_ex_date": null, "next_pay_date": null
  }],

  "history": {
    // APPEND ONLY. net_flow is money in/out since the previous point; TWR strips
    // it before chaining returns, so a wrong value publishes fake performance.
    "portfolio": [{ "date": "2026-08-04", "value": 34432.04, "net_flow": 0 }],
    "benchmarks": { "SPX": [{ "date": "2026-07-31", "level": 186.30 }] }
  },

  "watchlist": [{
    "symbol": "IREN", "name": "IREN Limited",
    "price": 40.78, "prev_close": 39.68, "spark": [/* closes */]
  }],

  // User-edited in the Rebalancing tab.
  "targets": {
    "dimension": "asset_class", "drift_threshold": 0.05,
    "values": { "Equity": 0.85, "Commodities": 0.05, "Cash": 0.08 }
  }
}
```

## Invariants

1. **No account numbers, no brokerage UUIDs** anywhere. Enforced by both scripts.
2. **`history.portfolio` never shrinks**, dates strictly increase, no duplicates.
   Re-running on the same day replaces that day's point rather than appending.
3. **`etfs[sym].coverage` equals the sum of that fund's weights.** The remainder
   becomes the "Unresolved" bucket; a mismatch misstates every look-through
   weight on the page.
4. **Options carry `multiplier: 100`.** Without it the position reads at 1/100th.
5. **Activity types are singular** (`Trade`, not `Trades`) — the Income and
   Activity filters match on these.
6. **Positions + cash reconcile** to the brokerage's reported equity within ~$25;
   a wider gap means a missing quote or a missing multiplier.
7. **`asset_type: "Cash"` rows are never stored.** `normalize()` synthesizes them
   from `accounts[].cash`, which is the single source of truth for cash. Storing
   them too would double-count.

## Adding fund constituents by hand

Fill `etfs[SYMBOL]` from the fund's published holdings:

- `weight` as a fraction of the fund's NAV, not of the portfolio.
- `coverage` = the sum of the weights actually listed. Listing only the top 10 of
  a broad index fund is fine and honest — the rest shows as Unresolved.
- `as_of` = the fact sheet's own date. The Fact Sheet tab flags anything older
  than 45 days as stale.

Nothing else needs changing; the donut, the overlap table, the concentration
badges and the "# of ETFs" column all derive from this block.
