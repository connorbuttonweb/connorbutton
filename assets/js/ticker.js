(function () {
    // Yahoo Finance symbols — TSX uses ".TO", TSX-V uses ".V"
    const SYMBOLS = ['XEQT.TO','ENB.TO','PXT.TO','BEPC.TO','MMY.V',
                     'HMMJ.TO','VDY.TO','ZEB.TO','VEQT.TO'];
    const REFRESH_MS = 60_000;
    const WORKER = 'https://market-proxy.buttonconnor12.workers.dev';

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
        if (navbar && ticker) navbar.style.top = ticker.offsetHeight + 'px';
    }

    function updateMarketStatus() {
        const ticker = document.getElementById('stock-ticker');
        if (ticker) ticker.classList.toggle('stock-ticker--closed', !isMarketOpen());
    }

    async function fetchQuote(symbol) {
        const res  = await fetch(`${WORKER}/ticker-quote?symbol=${encodeURIComponent(symbol)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${symbol}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return data; // { symbol, price, change, pct }
    }

    function buildItems(quotes) {
        return quotes.map(q => {
            const up      = q.change >= 0;
            const cls     = up ? 'stock-ticker__change--up' : 'stock-ticker__change--down';
            const sign    = up ? '+' : '';
            const arrow   = up ? '▲' : '▼';
            const display = q.symbol.replace(/\.(TO|V)$/i, '');
            return `<span class="stock-ticker__item">` +
                `<span class="stock-ticker__symbol">${display}</span>` +
                `<span class="stock-ticker__price">$${q.price.toFixed(2)}</span>` +
                `<span class="${cls}">${arrow} ${sign}${q.change.toFixed(2)} (${sign}${q.pct.toFixed(2)}%)</span>` +
                `<span class="stock-ticker__sep">|</span>` +
                `</span>`;
        }).join('');
    }

    async function refresh() {
        const settled = await Promise.allSettled(SYMBOLS.map(fetchQuote));

        settled.forEach(r => {
            if (r.status === 'rejected') console.warn('Ticker fetch failed:', r.reason);
        });

        const quotes = settled
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);

        if (!quotes.length) return;

        const track = document.getElementById('ticker-track');
        if (!track) return;

        const html = buildItems(quotes);
        track.innerHTML = html + html; // duplicate for seamless loop
        requestAnimationFrame(() => {
            const duration = (track.scrollWidth / 2) / 80; // ~80 px/s
            if (duration > 0) track.style.animationDuration = `${duration}s`;
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        positionTicker();
        updateMarketStatus();
        window.addEventListener('resize', () => {
            positionTicker();
            const track = document.getElementById('ticker-track');
            if (track && track.scrollWidth > 0) {
                requestAnimationFrame(() => {
                    const duration = (track.scrollWidth / 2) / 80;
                    if (duration > 0) track.style.animationDuration = `${duration}s`;
                });
            }
        });
        refresh();
        setInterval(() => { refresh(); updateMarketStatus(); }, REFRESH_MS);
    });
})();
