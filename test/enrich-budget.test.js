#!/usr/bin/env node
//
// Contract test for lib/enrich-plan.js — how Congress.gov enrichment spends its
// subrequest budget.
//
// WHY THIS EXISTS
// The Workers FREE plan allows 50 subrequests per invocation and a cold bill
// costs 5. The enrichment pass used to fire all of them at once with no cap, so
// on any week with more than ~10 bills the Workers runtime started throwing on
// fetch() partway through — and every enrichment helper swallows its errors, so
// the bills past the cap were served with no sponsor, cosponsors, committees or
// summary while the first handful looked perfect. Nothing in the response or
// the logs distinguished that from "Congress.gov has no data for this bill".
//
// The second failure was slower and worse: !cached.summary is permanently true
// for any bill whose CRS summary has not been written yet, which is most of the
// schedule, so every pass re-asked for all of them and never had budget left
// for a bill that had never been enriched at all. The site stayed that way.
//
// If this file goes red, bill modals start coming up blank again.
//
//   npm test

require('../lib/enrich-plan.js');
const { planEnrichment, DEFAULT_RECHECK_NULL_MS } = globalThis.EnrichPlan;

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`fail  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`pass  ${label}`);
};

const NOW = 1_760_000_000_000;
const cold = n => Array.from({ length: n }, (_, i) => ({ id: `H.R. ${100 + i}`, cached: null }));
const plan = (entries, opts) => planEnrichment(entries, { now: NOW, ...opts });

// ── The cap itself ────────────────────────────────────────────────────────────
// This is the whole point: 13 cold bills want 65 subrequests, the budget is 30,
// and the answer must be "fund 6 fully" — never "start all 13 and see".
{
  const { plans, spent, incomplete } = plan(cold(13), { budget: 30 });
  const funded = plans.filter(p => !p.skipped);
  check('13 cold bills, budget 30 -> 6 funded', funded.length, 6);
  check('13 cold bills -> spends exactly 30', spent, 30);
  check('13 cold bills -> reports incomplete', incomplete, true);
  check('13 cold bills -> 7 deferred', plans.filter(p => p.skipped).length, 7);
}

// Budget is a hard ceiling for every shape of input, not just the tidy one.
for (const [n, budget] of [[1, 30], [6, 30], [7, 30], [40, 30], [3, 4], [100, 50]]) {
  const { plans, spent } = plan(cold(n), { budget });
  const total = plans.reduce((sum, p) => sum + p.cost, 0);
  check(`${n} cold bills, budget ${budget} -> never overspends`, total <= budget && spent === total, true);
}

// A deferred bill is left completely alone — a half-fetched bill would be
// cached as though it were the whole answer.
{
  const { plans } = plan(cold(13), { budget: 30 });
  const skipped = plans.find(p => p.skipped);
  check('deferred bill fetches nothing',
    [skipped.needsSummary, skipped.needsMeta, skipped.needsStatusRefresh, skipped.cost],
    [false, false, false, 0]);
}

// ── Cold bills outrank refreshes ──────────────────────────────────────────────
// A cold bill renders a blank modal; a stale cached one only looks slightly old.
{
  const warm = Array.from({ length: 10 }, (_, i) => ({
    id: `H.R. ${900 + i}`,
    cached: { congressStatus: {}, summary: null, meta: null, checkedAt: NOW - DEFAULT_RECHECK_NULL_MS - 1 },
  }));
  const entries = [...warm, ...cold(4)]; // cold ones deliberately last in schedule order
  const { plans } = plan(entries, { budget: 20 });
  const fundedColdCount = plans.filter(p => p.cold && !p.skipped).length;
  check('4 cold bills jump 10 stale warm ones', fundedColdCount, 4);
}

// ── Settling the "nothing published yet" answers ──────────────────────────────
// The starvation fix. A bill Congress.gov has nothing for must cost 0 next pass.
{
  const settled = [{
    id: 'H.R. 9576',
    cached: { congressStatus: { committeeReport: null }, summary: null, meta: null, checkedAt: NOW - 60_000 },
  }];
  const { plans, spent, incomplete } = plan(settled, { budget: 30 });
  check('recently-checked empty bill costs nothing', [plans[0].cost, spent, incomplete], [0, 0, false]);
}
{
  const stale = [{
    id: 'H.R. 9576',
    cached: { congressStatus: { committeeReport: null }, summary: null, meta: null,
              checkedAt: NOW - DEFAULT_RECHECK_NULL_MS - 1 },
  }];
  check('once stale, the empty bill is asked again', plan(stale, { budget: 30 }).plans[0].cost > 0, true);
}
// Entries written before checkedAt existed must re-check once, then settle.
{
  const legacy = [{ id: 'H.R. 1', cached: { congressStatus: {}, summary: null, meta: null } }];
  check('legacy entry with no checkedAt is re-checked', plan(legacy, { budget: 30 }).plans[0].cost > 0, true);
}
// A fully-populated bill asks for nothing.
{
  const complete = [{
    id: 'H.R. 1',
    cached: { congressStatus: { committeeReport: null }, summary: 'A summary.',
              meta: { sponsor: {}, committeeReportUrl: null }, checkedAt: NOW - 60_000 },
  }];
  check('fully enriched bill costs nothing', plan(complete, { budget: 30 }).plans[0].cost, 0);
}
// ...except a terminal status, which is re-verified even when settled: a false
// positive would show a bill as passed when it was not.
{
  const passed = [{
    id: 'H.R. 1',
    cached: { congressStatus: { status: 'passed', committeeReport: null }, summary: 'A summary.',
              meta: { sponsor: {}, committeeReportUrl: null }, checkedAt: NOW - 60_000 },
  }];
  const p = plan(passed, { budget: 30 }).plans[0];
  check('terminal status is always re-verified', [p.needsStatusRefresh, p.cost], [true, 1]);
}

// ── Convergence ───────────────────────────────────────────────────────────────
// The real regression test. A fresh 25-bill week must finish enriching in a
// bounded number of passes. Before the budget existed it never finished at all.
{
  let entries = cold(25);
  // Two thirds of a real schedule have no CRS summary yet — the exact population
  // that used to consume the whole budget on every pass, forever.
  const hasSummary = i => i % 3 === 0;
  let passes = 0;
  let incomplete = true;
  while (incomplete && passes < 50) {
    passes++;
    const now = NOW + passes * 10 * 60 * 1000; // DO polls every 10 minutes
    const res = planEnrichment(entries, { budget: 30, now });
    incomplete = res.incomplete;
    entries = res.plans.map((p, i) => {
      if (p.skipped || p.cost === 0) return { id: p.id, cached: p.cached };
      return {
        id: p.id,
        cached: {
          congressStatus: { committeeReport: null },
          summary: hasSummary(i) ? 'A summary.' : null,
          meta: { sponsor: {}, committeeReportUrl: null },
          checkedAt: now,
        },
      };
    });
  }
  check('25 cold bills converge', incomplete, false);
  check('25 cold bills converge within 6 passes (~1h of DO polls)', passes <= 6, true);
  check('...and every bill ends up checked', entries.every(e => e.cached), true);
}

// ── The permanent-backlog case ────────────────────────────────────────────────
// Every bill the old uncapped pass overran the cap on was cached as
// {summary: null, meta: null}. Without the settling rule each one asks for all 5
// subrequests again on every pass, so a backlog of them can never drain: the
// budget is spent re-asking settled questions, `incomplete` is permanently true,
// and because an incomplete pass shortens the payload's cache freshness, every
// Durable Object poll re-runs the whole expensive fetch. Settling drains it.
//
// (Cold bills are protected from this separately, by the cold-first ordering
// above — a newly scheduled bill is funded first either way. What settling
// rescues is the backlog itself, and the steady state of the whole pass.)
{
  const stuck = Array.from({ length: 25 }, (_, i) => ({
    id: `H.R. ${100 + i}`,
    cached: { congressStatus: { committeeReport: null }, summary: null, meta: null, checkedAt: NOW - 60_000 },
  }));
  const fresh = [{ id: 'H.R. 9576', cached: null }];

  const settled = plan([...stuck, ...fresh], { budget: 30 });
  check('settled backlog costs nothing',
    settled.plans.filter(p => p.id !== 'H.R. 9576' && p.cost > 0).length, 0);
  check('settled backlog leaves the pass complete', settled.incomplete, false);
  check('new bill still funded alongside it',
    settled.plans.find(p => p.id === 'H.R. 9576').skipped, false);

  // Same input with settling switched off — the state the site was actually in.
  // Run it out: Congress.gov genuinely has nothing for these bills, so every pass
  // re-asks, re-learns nothing, and the backlog never drains.
  const runPasses = (recheckNullMs, count) => {
    let entries = [...stuck, ...fresh];
    let incomplete = null;
    for (let i = 1; i <= count; i++) {
      const now = NOW + i * 10 * 60 * 1000;
      const res = planEnrichment(entries, { budget: 30, now, recheckNullMs });
      incomplete = res.incomplete;
      entries = res.plans.map(p => (p.skipped || p.cost === 0)
        ? { id: p.id, cached: p.cached }
        // Funded, and Congress.gov had nothing — the answer that used not to stick.
        : { id: p.id, cached: { congressStatus: { committeeReport: null }, summary: null,
                                meta: null, checkedAt: now } });
    }
    return incomplete;
  };
  check('without settling, 20 passes still leave work outstanding', runPasses(0, 20), true);
  check('with settling, the backlog drains', runPasses(DEFAULT_RECHECK_NULL_MS, 20), false);
}

// A quick=1 pass plans nothing at all.
check('no entries -> nothing to do', plan([], { budget: 30 }), { plans: [], spent: 0, incomplete: false });

console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
