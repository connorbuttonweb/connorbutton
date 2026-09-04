# Fund holdings file formats

One section per provider currently in use. All four were established by parsing the real
published files; the quirks are the parts that cost time when they are rediscovered.

---

## iShares / BlackRock — `--vendor ishares`

**Where:** the product page → *Holdings* → "Download holdings" (CSV).
Example: XEQT at `blackrock.com/ca/investors/en/products/309480/`.

**Shape.** Two metadata rows (`Fund Holdings as of,03-Aug-26`), a blank row, then a 26-column
header. Holdings follow; the file ends with a blank row.

```
Ticker,Name,Sector,Asset Class,Market Value,Weight (%),…,Location,Exchange,Currency,…,Market Currency,…
NVDA,NVIDIA CORP,Information Technology,Equity,"642,548,282.37",3.08,…,United States,NASDAQ,CAD,…,USD,…
```

Notes:
- `Weight (%)` is a **number in percent** (`3.08`), not a fraction or a string.
- `Location` is a **full country name**; `Currency` is the fund's base currency, so use
  **`Market Currency`** for the security's own currency.
- `Asset Class` distinguishes `Equity` from `Cash`, `Futures`, `Money Market` and
  `FX` — only `Equity` is a constituent.
- **Very long tail.** XEQT lists 8,501 rows, of which only ~1,850 carry a weight of 0.01%
  or more; the remaining ~6,500 round to 0.00% and contribute nothing. The default
  `--min-weight 0.01` keeps everything measurable and discards the rest.
- Coverage lands around **93.8%** for a global fund-of-funds — the shortfall is cash,
  futures and the sub-0.01% tail, and it correctly shows as *Unresolved*.

---

## Vanguard — `--vendor vanguard`

**Where:** the product page → *Portfolio* → *Holdings details* → export.

**Shape.** Five preamble rows, then the header. Despite a `Top 10 Holdings` label in the
preamble, the export contains the **full holdings list** (60 rows for VDY).

```
Ticker,Holding name,% of market value,Sector,Region,Market value,Shares
RY,Royal Bank of Canada,16.3083%,Financials,CA,"$1,403,294,961.84","4,778,313"
```

Notes:
- Weight is a **percent string with a `%` suffix**.
- `Region` is a **two-letter country code** (`CA`), not a name.
- **Different sector taxonomy** from iShares: `Basic Materials`, `Telecommunications`,
  `Technology` where iShares says `Materials`, `Communication`, `Information Technology`.
  `normalize.js` maps both onto GICS names — without that, the sector rollup silently
  splits one sector into two.
- `as_of` is stated in the preamble (`As at Jun 30 2026`) and is usually **older than the
  download date**. Use the stated date.

---

## Roundhill — `--vendor roundhill`

**Where:** the fund page → *Holdings* → daily CSV.

**Shape.** A single header row, then holdings.

```
Ticker,Name,Identifier,Weight,Shares,Market Value
000660 KS,"SK hynix Inc",6450267,3.56%,"60,475","$66,609,689"
Cash&Other,,Cash&Other,-0.24%,,"$-4,492,674"
```

Notes:
- Tickers are **Bloomberg-style with an exchange suffix** (`2330 TT`, `000660 KS`,
  `SU FP`). `splitExchange()` separates the base symbol from the exchange, and the
  exchange code also supplies the country — there is no geography column.
- **No sector column at all.** Sectors come from `SECTOR_BY_TICKER` in `normalize.js`;
  anything unmapped stays `Unclassified` rather than being guessed.
- **Can total more than 100%.** CHAT publishes 100.67% in securities against −0.24% cash.
  Left as-is the fund would contribute more than its own market value to the look-through
  and break value conservation, so the parser scales the weights back to 100% and records
  the published figure in the markdown.
- **Swap rows carry the contract, not the company.** A swap-based fund publishes total
  return swaps with the contract in the `Ticker` column
  (`6450267 TRS 052427 GS`) and the underlying decorated into the `Name`
  (`SK HYNIX INC-SWAP-GOLD-L`, `MICRON TECHNOLOGY INC SWAP NM`). The parser strips the
  decoration and resolves the row by name, so the weight lands on the company the swap
  references. This matters more than it sounds: DRAM reaches Micron almost entirely through
  swaps, and treating those rows as derivatives to be dropped reported Micron at 1.03%
  instead of 25.35%, with the difference handed to *Unresolved*.
- **Collateral is not a holding.** A swap-based fund parks the notional in Treasury bills
  and a government money market fund — 37.9% of DRAM across `912797VB0` and `FGXXX`,
  offset by −37.7% `Cash&Other`. Those are excluded by `isNonEquity`; counted as
  constituents the T-bill outranks every real name in the fund.
- **Cash and FX rows are identified by the `Identifier` column**, which reads `CASHKRW`,
  `CASHCNY`, `CASHTWD`. The `Ticker` is just the currency code and the `Name` is the
  currency in words (`SOUTH KOREA WON`), neither of which any name-based rule catches
  reliably, so the parser flags the asset class from the identifier instead.

---

## Fidelity (and any PDF listing) — `--vendor generic`

**Where:** the product page → *Portfolio holdings listing* (PDF).

**Shape.** A styled PDF, grouped into `Cash & Other`, `Canadian Equities` and
`Foreign Equities`, each with a subtotal.

```
Security name                     Market value      % of net assets
Canadian Natural Resources        $43,237,142.14    2.59%
```

Notes:
- **No tickers whatsoever** — security names only. This is the hardest input: overlap
  detection depends on identifiers, so names must be resolved through `NAME_TO_TICKER` in
  `normalize.js`. Names that are not in the map stay `~NAME`-keyed and never match another
  fund. For FINN, roughly 60% of names resolve, covering nearly all the weight.
- **The same company can be listed twice** — FINN lists Taiwan Semiconductor at both 4.60%
  and 3.18% (the local line and the ADR). Both map to `TSM` and the parser sums them to
  7.78%, which is the correct combined exposure.
- Section headings imply geography: everything under *Canadian Equities* is Canada. For
  *Foreign Equities* the country has to be supplied per row in the transcription.
- Fidelity publishes **quarterly**, so `as_of` is often months old (March 31 for an August
  download). The dashboard flags anything over 45 days stale — that is working as intended,
  not a bug to hide.

**Transcription format** (TSV, tab-separated):

```
# comments allowed
	Canadian Natural Resources	2.59	Canada
	Amazon.com	10.24	United States
```

Columns: `ticker <TAB> name <TAB> weight% <TAB> geography`. A leading tab leaves the ticker
empty. Three columns (`ticker/name/weight`) and two (`name/weight`) are also accepted.

---

## Adding a new provider

Add a function to `VENDORS` in `parse-holdings.js` returning
`[{ ticker, name, weightPct, sector, geography, currency, assetClass }]`. Everything
downstream — normalization, deduplication, the markdown, the applier — is shared.

Check first whether `generic` will do: for a one-off, transcribing to TSV is usually faster
than writing a parser for a format that appears once.
