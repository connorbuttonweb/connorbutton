(function () {
    // Yahoo Finance symbols — TSX tickers use the ".TO" suffix
    const SYMBOLS    = ['XEQT.TO','ENB.TO','PXT.TO','BEPC.TO','MMY.TO',
                        'HMMJ.TO','VDY.TO','ZEB.TO','VEQT.TO'];
    const REFRESH_MS = 60_000;

    const YF_BASE    = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=';
    const PROXY      = 'https://corsproxy.io/?';

    // TSX hours: 9:30–16:00 ET, Mon–Fri
    function isMarketOpen() {
        const et  = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
        const day = et.getDay();
        if (day === 0 || day === 6) return false;
        const mins = et.getHours() * 60 + et.getMinutes();
        return mins >= 9 * 60 + 30 && mins < 16 * 60;
    }

    // Position ticker flush below the navbar regardless of its rendered height
    function positionTicker() {
        const navbar = document.querySelector('.navbar');
        const ticker = document.getElementById('stock-ticker');
        if (navbar && ticker) {
            ticker.style.top = navbar.offsetHeight + 'px';
        }
    }

    function updateMarketStatus() {
        const ticker = document.getElementById('stock-ticker');
        if (!ticker) return;
        ticker.classList.toggle('stock-ticker--closed', !isMarketOpen());
    }

    async function fetchQuotes() {
        const url = PROXY + encodeURIComponent(YF_BASE + SYMBOLS.join(','));
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.quoteResponse.result;
    }

    function buildItems(results) {
        return results.map(q => {
            const price  = q.regularMarketPrice;
            const change = q.regularMarketChange;
            const pct    = q.regularMarketChangePercent;
            if (price == null) return '';
            const up      = change >= 0;
            const cls     = up ? 'stock-ticker__change--up' : 'stock-ticker__change--down';
            const sign    = up ? '+' : '';
            const arrow   = up ? '▲' : '▼';
            const display = q.symbol.replace(/\.TO$/i, '');
            return `<span class="stock-ticker__item">` +
                `<span class="stock-ticker__symbol">${display}</span>` +
                `<span class="stock-ticker__price">$${price.toFixed(2)}</span>` +
                `<span class="${cls}">${arrow} ${sign}${change.toFixed(2)} (${sign}${pct.toFixed(2)}%)</span>` +
                `<span class="stock-ticker__sep">|</span>` +
                `</span>`;
        }).join('');
    }

    async function refresh() {
        try {
            const results = await fetchQuotes();
            const track   = document.getElementById('ticker-track');
            if (!track) return;
            const html = buildItems(results);
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
        updateMarketStatus();
        window.addEventListener('resize', positionTicker);
        refresh();
        setInterval(() => { refresh(); updateMarketStatus(); }, REFRESH_MS);
    });
})();
