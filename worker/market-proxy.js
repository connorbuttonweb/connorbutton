/**
 * STOCK TICKER PROXY
 * Yahoo Finance CORS proxy for the ticker bar + market leaders panel
 * on connorbutton.ca/search/, and daily closes for the portfolio dashboard.
 *
 * This is the deployed source, copied out of Cloudflare so it is versioned here.
 * Keep this file in step with the worker whenever either changes.
 *
 * Routes
 *   /ticker-quote?symbol=XEQT.TO
 *       One live quote. CONTRACT IS FIXED — assets/js/ticker.js reads
 *       { symbol, price, change, pct } and nothing else, and renders pct as
 *       `${q.pct.toFixed(2)}%`, so pct is a PERCENT, not a fraction.
 *
 *   /history?symbols=A,B&from=YYYY-MM-DD&to=YYYY-MM-DD&interval=1d
 *       Daily closes for up to 25 symbols, dividend- and split-adjusted so the
 *       series is total-return. Used to rebuild the portfolio's daily value
 *       series in .claude/skills/refresh-portfolio/scripts/rebuild-history.js.
 *
 * Error convention: failures return HTTP 200 with an { error } body rather than
 * a 4xx, so clients handle one shape. Callers must check for `error` on the
 * body — a non-ok status is not the signal.
 */

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

        try {
            if (url.pathname === "/ticker-quote") return await handleTickerQuote(url, corsHeaders);
            if (url.pathname === "/history") return await handleHistory(url, corsHeaders);

            return new Response("Not Found", { status: 404, headers: corsHeaders });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), {
                status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }
    }
};

// --- TICKER QUOTE (single symbol, returns price + change) ---
async function handleTickerQuote(url, corsHeaders) {
    const symbol = url.searchParams.get("symbol");
    if (!symbol) return new Response(JSON.stringify({ error: "No symbol" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    try {
        const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
        const res = await fetch(yfUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const meta = data.chart.result[0].meta;
        const price = meta.regularMarketPrice;
        const prev  = meta.chartPreviousClose ?? meta.previousClose;
        const change = price - prev;
        const pct    = (change / prev) * 100;
        return new Response(JSON.stringify({ symbol, price, change, pct }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
}

// --- HISTORY (daily closes for many symbols, for the portfolio dashboard) ---
async function handleHistory(url, corsHeaders) {
    const json = (body, maxAge) => new Response(JSON.stringify(body), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge || 0}` }
    });

    const raw = url.searchParams.get("symbols") || url.searchParams.get("symbol") || "";
    const symbols = raw.split(",").map(s => s.trim()).filter(Boolean);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const interval = url.searchParams.get("interval") || "1d";

    if (!symbols.length) return json({ error: "No symbols" });
    if (symbols.length > 25) return json({ error: "At most 25 symbols per request" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "")) {
        return json({ error: "from and to must be YYYY-MM-DD" });
    }
    if (!/^(1d|1wk|1mo)$/.test(interval)) return json({ error: "interval must be 1d, 1wk or 1mo" });

    const p1 = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
    const p2 = Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000);

    // Partial results beat none: one delisted or renamed symbol shouldn't fail
    // a rebuild of the whole history, so failures are reported per symbol.
    const results = await Promise.allSettled(symbols.map(async (symbol) => {
        const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
            `?period1=${p1}&period2=${p2}&interval=${interval}`;
        const res = await fetch(yfUrl, {
            headers: { "User-Agent": "Mozilla/5.0" },
            cf: { cacheTtl: 3600, cacheEverything: true }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const r = data?.chart?.result?.[0];
        if (!r || !r.timestamp) return [];

        // adjclose is split- and dividend-adjusted, which is what a total-return
        // series needs; fall back to raw close when Yahoo omits it.
        const closes = r.indicators?.adjclose?.[0]?.adjclose || r.indicators?.quote?.[0]?.close || [];
        const out = [];
        for (let i = 0; i < r.timestamp.length; i++) {
            if (closes[i] == null) continue;          // Yahoo emits nulls on halts
            out.push({
                date: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
                close: Math.round(closes[i] * 10000) / 10000
            });
        }
        return out;
    }));

    const out = {}, errors = {};
    results.forEach((r, i) => {
        if (r.status === "fulfilled") out[symbols[i]] = r.value;
        else errors[symbols[i]] = String(r.reason?.message || r.reason);
    });
    if (Object.keys(errors).length) out._errors = errors;

    return json(out, 3600);
}
