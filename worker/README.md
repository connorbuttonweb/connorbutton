# market-proxy worker

`market-proxy.js` is the source for the Cloudflare Worker at
`https://market-proxy.buttonconnor12.workers.dev`.

Browsers can't call Yahoo Finance directly — it sends no CORS headers — so this proxies it.

## Routes

| Route | Used by | Returns |
|---|---|---|
| `/ticker-quote?symbol=XEQT.TO` | [`assets/js/ticker.js`](../assets/js/ticker.js), the scrolling ticker on `/search/` | `{ symbol, price, change, pct }` |
| `/history?symbols=A,B&from=&to=&interval=1d` | the portfolio history rebuild | `{ "A": [{ date, close }], … }` |

`/history` accepts up to 25 symbols, `interval` of `1d`/`1wk`/`1mo`, and returns
**dividend- and split-adjusted** closes so the series is total-return. A symbol that fails
is reported under `_errors` rather than failing the whole request.

## Which file to use

| File | Use it when |
|---|---|
| **`history-route-snippet.js`** | **Preferred.** Adds only `/history` to the worker already running. `/ticker-quote` keeps executing the code proven in production. |
| `market-proxy.js` | A full reconstruction. Only for reference, or if the live source is lost. Deploying it *replaces* what is running. |

**Do this first, whichever path you take:** open the worker in the Cloudflare
dashboard, copy its current source, and paste it over `market-proxy.js` here. The
live source exists nowhere else, and the file currently in the repo is a
reconstruction, not the real thing.

## Is deploying even needed?

Not right now. `rebuild-history.js` runs in Node, which has no CORS restriction,
so it calls Yahoo directly and works today. `/history` becomes worth deploying
when a scheduled cloud agent needs a stable, cached endpoint, or when something
in a browser needs live history.

## Before deploying — read this

**This file was reconstructed from the deployed worker's observable behaviour, not copied
from it.** The live worker's source was never in the repo. Deploying replaces what is
running, so the risk is breaking `/search/`'s ticker.

`/ticker-quote` must keep returning exactly `{ symbol, price, change, pct }` — `ticker.js`
reads those four keys and nothing else.

**`pct` is a percent, not a fraction.** The live worker returns `-0.152` for a −0.15% move,
and `ticker.js` renders it as `${q.pct.toFixed(2)}%`. Returning a fraction would silently
display every symbol as `0.00%`. This was verified against the deployed worker:

```
$ curl -s '.../ticker-quote?symbol=XEQT.TO'
{"symbol":"XEQT.TO","price":45.9,"change":-0.07000000000000028,"pct":-0.15227322166630472}
```

`/history` currently returns **404** on the deployed worker — it only exists in this file
until the worker is redeployed.

## Deploy

```bash
npx wrangler deploy worker/market-proxy.js --name market-proxy --compatibility-date 2024-01-01
```

Then verify both routes and the live page:

```bash
curl -s '.../ticker-quote?symbol=XEQT.TO'
curl -s '.../history?symbols=XEQT.TO&from=2026-07-01&to=2026-08-06&interval=1d'
```

and load `https://www.connorbutton.ca/search/` to confirm the ticker still scrolls and
still colours gains green / losses red.
