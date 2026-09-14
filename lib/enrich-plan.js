/**
 * Congress.gov enrichment budgeting, shared by worker.js and its test.
 *
 * WHY THIS FILE EXISTS
 * Enrichment is subrequest-bound, not CPU-bound. The Workers FREE plan allows
 * 50 subrequests per invocation and a cold bill costs 5 of them (actions +
 * summaries + the three fetchBillMeta calls), so a ~13-bill week already
 * overruns the cap — and the overrun is SILENT. Past the cap fetch() throws,
 * all three enrichment helpers swallow the error and return null, and every
 * bill after that point is served with no sponsor, cosponsors, committees or
 * summary while the first handful look perfect. That is precisely the "a few
 * bills have info, the vast majority don't" symptom, and nothing in the logs
 * or the response distinguishes it from "Congress.gov has no data".
 *
 * Two rules follow, and both are easy to get subtly wrong, which is why the
 * decision lives here as a pure function with a test rather than inline:
 *
 *   1. Spend a budget deliberately, cold bills first. A bill with no cached
 *      enrichment renders a blank modal; a cached one that misses a refresh is
 *      only slightly stale. Never half-fund a bill — a partial fetch would be
 *      cached as though it were the whole answer.
 *
 *   2. Let a "Congress.gov has nothing yet" answer settle. CRS summaries lag
 *      introduction by weeks, so !cached.summary is permanently true for most
 *      of the schedule. Re-asking every pass spent the entire budget on
 *      questions already answered "no" and starved the bills that had never
 *      been enriched at all — the site would sit in that state indefinitely.
 *
 * LOADING
 * Same convention as lib/bill-id.js: no `export` syntax, assigns to globalThis,
 * so worker.js can side-effect import it (esbuild inlines it at deploy) and the
 * CommonJS test can require it.
 */
(function (root) {
  'use strict';

  // Subrequests per bill, by call. Keep in step with fetchCongressBillStatus,
  // fetchCongressBillSummary and fetchBillMeta in worker.js.
  const COST_STATUS  = 1; // /actions
  const COST_SUMMARY = 1; // /summaries
  const COST_META    = 3; // bill + /cosponsors + /committees

  const DEFAULT_BUDGET          = 30;
  const DEFAULT_RECHECK_NULL_MS = 6 * 60 * 60 * 1000;
  const DEFAULT_TERMINAL        = ['passed', 'failed'];

  /**
   * Decide what each bill should fetch this pass.
   *
   * @param entries [{ id, cached }] — cached is the bill-enrich KV entry or null.
   * @param opts    { budget, now, recheckNullMs, terminalStatuses }
   * @returns { plans, spent, incomplete }
   *   plans[i] carries needsSummary / needsMeta / needsStatusRefresh (already
   *   zeroed for unfunded bills), cost, cold, and skipped.
   *   incomplete is true when at least one bill wanted work it could not afford,
   *   which the caller uses to shorten the payload's cache freshness.
   */
  function planEnrichment(entries, opts) {
    const o = opts || {};
    const budget = o.budget == null ? DEFAULT_BUDGET : o.budget;
    const now = o.now == null ? Date.now() : o.now;
    const recheckNullMs = o.recheckNullMs == null ? DEFAULT_RECHECK_NULL_MS : o.recheckNullMs;
    const terminal = new Set(o.terminalStatuses || DEFAULT_TERMINAL);

    const plans = (entries || []).map((entry, index) => {
      const cached = entry.cached;
      if (!cached) {
        return {
          id: entry.id, cached: null, index, cold: true,
          needsSummary: true, needsMeta: true, needsStatusRefresh: true,
          cost: COST_SUMMARY + COST_META + COST_STATUS, skipped: false,
        };
      }
      // A recent check settles the "nothing published yet" answers. Entries
      // written before checkedAt existed have no timestamp, so they are re-checked
      // once and stamped — no cache-key bump needed to migrate them.
      const settled = typeof cached.checkedAt === 'number'
                   && (now - cached.checkedAt) < recheckNullMs;
      const needsSummary = !cached.summary && !settled;
      // Re-fetch meta when missing, or when the entry predates committeeReportUrl
      // support (key absent entirely — null means "checked, no report").
      const needsMeta = (!cached.meta || !('committeeReportUrl' in cached.meta)) && !settled;
      const needsCommitteeReport = !('committeeReport' in (cached.congressStatus || {})) && !settled;
      // A cached terminal status is re-verified every pass regardless of settling:
      // the original detection may have been a false positive (motion text misread
      // as passage), and showing a bill as passed when it was not is worse than
      // spending one subrequest.
      const needsStatusVerify = terminal.has(cached.congressStatus && cached.congressStatus.status);
      const needsStatusRefresh = needsCommitteeReport || needsStatusVerify;
      return {
        id: entry.id, cached, index, cold: false,
        needsSummary, needsMeta, needsStatusRefresh,
        cost: (needsSummary ? COST_SUMMARY : 0)
            + (needsMeta ? COST_META : 0)
            + (needsStatusRefresh ? COST_STATUS : 0),
        skipped: false,
      };
    });

    // Cold first; Array.prototype.sort is stable, so schedule order breaks ties
    // and the same bills are funded first on every pass until they succeed.
    const order = plans.slice().sort((a, b) => (b.cold ? 1 : 0) - (a.cold ? 1 : 0));

    let remaining = budget;
    let incomplete = false;
    for (const plan of order) {
      if (plan.cost === 0) continue;              // nothing to fetch; cached data still applies
      if (plan.cost <= remaining) { remaining -= plan.cost; continue; }
      // Unaffordable: zero it out entirely rather than half-fetching. Nothing is
      // written to the enrichment cache for this bill, so the next pass retries it.
      plan.needsSummary = plan.needsMeta = plan.needsStatusRefresh = false;
      plan.cost = 0;
      plan.skipped = true;
      incomplete = true;
    }

    return { plans, spent: budget - remaining, incomplete };
  }

  root.EnrichPlan = {
    planEnrichment,
    COST_STATUS, COST_SUMMARY, COST_META,
    DEFAULT_BUDGET, DEFAULT_RECHECK_NULL_MS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
