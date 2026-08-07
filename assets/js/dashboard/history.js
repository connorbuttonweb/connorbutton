/* ==========================================================
   DASHBOARD — PERFORMANCE HISTORY

   Two series, deliberately kept apart:

     actual        reconstructed from recorded holdings snapshots repriced
                   against daily closes. This is the portfolio's real return.
                   It begins when tracking began and cannot reach back further:
                   the brokerage publishes no account-value history and its
                   transaction records carry no share quantities.

     hypothetical  today's holdings marked backwards. NOT the portfolio's
                   return — it ignores everything bought and sold along the
                   way. Shown only while the actual record is too short to
                   chart, and only under an explicit label.

   Nothing here may present the hypothetical series as actual performance.
   ========================================================== */
window.DASH = window.DASH || {};

(function () {
  'use strict';

  const SOURCE = '/assets/data/history.json';
  const MIN_POINTS = 2;
  /* A handful of days is a chartable series but not a meaningful performance
     record — leading a fact sheet with "-4.8%" earned over three days would be
     noise presented as a result. Below this the hypothetical series leads
     instead (always labelled), while the actual one stays one click away. */
  const MEANINGFUL_POINTS = 20;

  async function fetchHistory() {
    const res = await fetch(SOURCE, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' loading history');
    return res.json();
  }

  /* The actual series is time-weighted so contributions don't read as
     performance. The hypothetical has no flows by construction — it is one
     unchanging basket — so it indexes directly off its own values. */
  function buildSeries(history) {
    const M = DASH.metrics;
    const daily = (history && history.daily) || [];
    const hypo = (history && history.hypothetical) || [];

    const actual = daily.length >= MIN_POINTS ? M.twrIndex(daily) : [];
    const hypothetical = hypo.length >= MIN_POINTS
      ? hypo.map(p => ({ date: p.date, index: p.value / hypo[0].value }))
      : [];

    return {
      actual: actual,
      hypothetical: hypothetical,
      hasActual: actual.length >= MIN_POINTS,
      hasHypothetical: hypothetical.length >= MIN_POINTS,
      actualIsMeaningful: actual.length >= MEANINGFUL_POINTS,
      /* ALWAYS lead with the real record when one exists, however short.
         Leading with the hypothetical was tried and it misleads: a number in the
         headline position gets read as "my return" no matter what the banner
         above it says. A short honest series that says so beats a long one that
         answers a different question. */
      defaultMode: actual.length >= MIN_POINTS ? 'actual' : 'hypothetical',
      firstSnapshot: (history && history.meta && history.meta.first_snapshot) || null,
      snapshots: (history && history.snapshots) || [],
      approximated: (history && history.meta && history.meta.approximated) || [],
      priceSource: (history && history.meta && history.meta.price_source) || 'unknown',
      asOf: (history && history.meta && history.meta.as_of) || null
    };
  }

  /* Benchmark indexed from the same start date as whatever the chart shows, so
     both lines begin at $10,000 on the same day. */
  function benchmarkFrom(history, startDate) {
    const raw = (history && history.benchmark) || [];
    const from = raw.filter(p => p.date >= startDate);
    if (from.length < MIN_POINTS) return [];
    const base = from[0].level;
    return from.map(p => ({ date: p.date, index: base ? p.level / base : 1 }));
  }

  DASH.history = {
    SOURCE: SOURCE,
    fetch: fetchHistory,
    buildSeries: buildSeries,
    benchmarkFrom: benchmarkFrom
  };
})();
