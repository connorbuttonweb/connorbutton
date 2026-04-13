(function () {
    const API_KEY    = 'd61qcv1r01qgcobqh8k0d61qcv1r01qgcobqh8kg'; // ← replace with key from finnhub.io
    const SYMBOLS    = ['AAPL','MSFT','NVDA','TSLA','META','AMZN','GOOGL',
                        'SPY','QQQ','JPM','AMD','NFLX'];
    const REFRESH_MS = 60_000;

    // Position ticker flush below the navbar regardless of its rendered height
    function positionTicker() {
        const navbar = document.querySelector('.navbar');
        const ticker = document.getElementById('stock-ticker');
        if (navbar && ticker) {
            ticker.style.top = navbar.offsetHeight + 'px';
        }
    }

    async function fetchQuote(symbol) {
        const res = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEY}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        return { symbol, price: d.c, change: d.d, pct: d.dp };
    }

    function buildItems(quotes) {
        return quotes.map(q => {
            if (!q.price) return '';
            const up    = q.change >= 0;
            const cls   = up ? 'stock-ticker__change--up' : 'stock-ticker__change--down';
            const sign  = up ? '+' : '';
            const arrow = up ? '▲' : '▼';
            return `<span class="stock-ticker__item">` +
                `<span class="stock-ticker__symbol">${q.symbol}</span>` +
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
            // Dynamic speed: ~80 px/s
            const duration = (track.scrollWidth / 2) / 80;
            track.style.animationDuration = `${duration}s`;
        } catch (err) {
            console.warn('Ticker update failed:', err);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        positionTicker();
        window.addEventListener('resize', positionTicker);
        refresh();
        setInterval(refresh, REFRESH_MS);
    });
})();
