(function () {
    // Yahoo Finance symbols — TSX tickers use the ".TO" suffix
    const SYMBOLS    = ['XEQT.TO','ENB.TO','PXT.TO','BEPC.TO','MMY.TO',
                        'HMMJ.TO','VDY.TO','ZEB.TO','VEQT.TO'];
    const REFRESH_MS = 60_000;

    // TSX hours: 9:30–16:00 ET, Mon–Fri
    function isMarketOpen() {
        const et  = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
        const day = et.getDay();
        if (day === 0 || day === 6) return false;
        const mins = et.getHours() * 60 + et.getMinutes();
        return mins >= 9 * 60 + 30 && mins < 16 * 60;
    }

    function positionTicker() {
        const navbar = document.querySelector('.navbar');
        const ticker = document.getElementById('stock-ticker');
        if (navbar && ticker) ticker.style.top = navbar.offsetHeight + 'px';
    }

    function updateMarketStatus() {
        const ticker = document.getElementById('stock-ticker');
        if (ticker) ticker.classList.toggle('stock-ticker--closed', !isMarketOpen());
    }

    async function fetchQuote(symbol) {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const meta  = data.chart.result[0].meta;
        const price = meta.regularMarketPrice;
        const prev  = meta.chartPreviousClose ?? meta.previousClose;
        const change = price - prev;
        const pct    = (change / prev) * 100;
        return { symbol, price, change, pct };
    }

    function buildItems(quotes) {
        return quotes.map(q => {
            if (q.price == null) return '';
            const up      = q.change >= 0;
            const cls     = up ? 'stock-ticker__change--up' : 'stock-ticker__change--down';
            const sign    = up ? '+' : '';
            const arrow   = up ? '▲' : '▼';
            const display = q.symbol.replace(/\.TO$/i, '');
            return `<span class="stock-ticker__item">` +
                `<span class="stock-ticker__symbol">${display}</span>` +
                `<span class="stock-ticker__price">$${q.price.toFixed(2)}</span>` +
                `<span class="${cls}">${arrow} ${sign}${q.change.toFixed(2)} (${sign}${q.pct.toFixed(2)}%)</span>` +
                `<span class="stock-ticker__sep">|</span>` +
                `</span>`;
        }).join('');
    }

    async function refresh() {
        try {
            const quotes = await Promise.all(SYMBOLS.map(fetchQuote));
            const track  = document.getElementById('ticker-track');
            if (!track) return;
            const html = buildItems(quotes);
            track.innerHTML = html + html; // duplicate for seamless loop
            const duration = (track.scrollWidth / 2) / 80; // ~80 px/s
            track.style.animationDuration = `${duration}s`;
        } catch (err) {
            console.warn('Ticker update failed:', err);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        positionTicker();
        updateMarketStatus();
        window.addEventListener('resize', positionTicker);
        refresh();
        setInterval(() => { refresh(); updateMarketStatus(); }, REFRESH_MS);
    });
})();
