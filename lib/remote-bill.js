// A bill modal for any measure, drawn from the Worker's /senate/bill answer (Congress.gov: sponsor, cosponsors, committees, CRS summary, latest action, links),
// for a bill the board has not been given with its week's business. The Senate board opens every bill this way; the House board opens its own richer modal for the
// week's bills and uses this one for any other (a petition's bill, an appropriations bill).
//
//   RemoteBill.skeleton(id, message?)            the modal with the id and the loading dots (or the message, for a failure)
//   RemoteBill.content(bill, opts)               the modal for an answer; opts: { linkClass, photoUrlFor(bioguide), placeholder, formatDate(iso) }
//   RemoteBill.fetch(id, api)                    -> Promise<{ at, bill } | { at, error }>, kept six hours (an error too: a measure Congress.gov does not know
//                                                fails the same way every time, so a failure is kept for half a minute), one request however many ask
//   RemoteBill.cached(id)                        the kept answer, or null
//
// The sections are lib/bill-sections.js, the House modal's own, so both look the same.

(function (root) {
  const { escapeHtml: esc } = root.BoardUtil;
  const BILL_CACHE_MS = 6 * 60 * 60 * 1000;
  const cache = new Map();     // id -> { at, bill } | { at, error }
  const inflight = new Map();  // id -> Promise
  const filling = new Set();   // ids waiting on their full answer

  // The modal's waiting shape, shared by the House's week bills, this modal, and the Senate's: the generic member image and a shimmer for the sponsor's name, a faint blue and red
  // support bar, a committee chip and the lines of the summary, with one quiet line naming the source (that is what is slow). { sections, summary }
  function pending(placeholder) {
    const bsk = (w, h = 12) => `<span class="bsk" style="width:${w};height:${h}px"></span>`;
    return {
      sections: `<div class="bill-modal-pending" role="status" aria-live="polite" aria-label="Loading details from Congress.gov">
        <div class="bill-modal-section"><div class="bill-modal-section-label">SPONSOR</div><div class="absentee-member" style="padding:0;border:none;"><div class="absentee-photo-wrap" style="width:36px;height:36px;border-radius:8px;flex-shrink:0;"><div class="absentee-photo-placeholder">${placeholder || ''}</div></div><div class="absentee-meta">${bsk('9em', 14)}</div></div></div>
        <div class="bill-modal-section"><div class="bill-modal-section-label">SUPPORT</div><span class="bsk bsk-support"></span></div>
        <div class="bill-modal-section"><div class="bill-modal-section-label">COMMITTEE</div>${bsk('13em', 34)}</div>
        <div class="bill-modal-pending-note">Loading from Congress.gov. This can take a while when it is busy.</div>
    </div>`,
      summary: `<div class="bill-modal-body" aria-hidden="true"><div class="bill-modal-section-label">SUMMARY (AUTHORED BY CRS)</div><div class="bill-modal-summary-scroll">${bsk('100%')}${bsk('96%')}${bsk('100%')}${bsk('88%')}${bsk('60%')}</div></div>`,
    };
  }

  function skeleton(id, message, placeholder) {
    // waiting (no message) with the member image to hand: the whole shape of the modal, not three dots
    if (!message && placeholder !== undefined) {
      const p = pending(placeholder);
      return `
        <div class="bill-modal" id="bill-main-panel" role="dialog" aria-modal="true" aria-label="${esc(id)}">
            <button class="bill-modal-close" id="bill-modal-close" aria-label="Close">✕</button>
            <div class="bill-modal-scroll">
                <div class="bill-modal-top">
                    <div class="bill-modal-header"><span class="bill-modal-id">${esc(id)}</span></div>
                    <h2 class="bill-modal-title" aria-hidden="true"><span class="bsk" style="width:90%;height:22px;margin-bottom:8px"></span><span class="bsk" style="width:55%;height:22px"></span></h2>
                </div>
                <div class="bill-modal-sections">${p.sections}</div>
                ${p.summary}
            </div>
        </div>`;
    }
    return `
        <div class="bill-modal" id="bill-main-panel" role="dialog" aria-modal="true" aria-label="${esc(id)}">
            <button class="bill-modal-close" id="bill-modal-close" aria-label="Close">✕</button>
            <div class="bill-modal-scroll">
                <div class="bill-modal-top">
                    <div class="bill-modal-header">
                        <span class="bill-modal-id">${esc(id)}</span>
                    </div>
                    ${message ? `<h2 class="bill-modal-title">${esc(message)}</h2>` : '<div class="loading-indicator" role="status" aria-label="Loading"><i></i><i></i><i></i></div>'}
                </div>
            </div>
        </div>`;
  }

  function content(b, o) {
    const sp = b.sponsor;
    const sections = [
      root.BillSections.sponsor(sp ? {
        name: sp.name, party: sp.party,
        loc: (sp.state || '') + (sp.district != null ? `-${String(sp.district).padStart(2, '0')}` : ''),
        photoUrl: sp.bioguide ? o.photoUrlFor(sp.bioguide) : '', placeholder: o.placeholder,
      } : {}),
      root.BillSections.support(b.support ? { ...b.support, cosponsorCount: b.cosponsorCount } : { total: 0 }),
      root.BillSections.committees({ committees: b.committees, report: b.committeeReport, reportDate: b.committeeReportDate, formatDate: o.formatDate }),
    ].join('');
    // Congress.gov dates an action but gives no time of day, so there is a date and where it came from.
    const actionDate = b.latestActionDate
      ? `${esc(o.formatDate(b.latestActionDate))}${b.congressUrl ? ` <a href="${esc(b.congressUrl)}/actions" class="bill-modal-source-link" target="_blank" rel="noopener">Congress.gov</a>` : ''}` : '';
    const fixtures = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fixtures');
    return `
        <div class="bill-modal" id="bill-main-panel" role="dialog" aria-modal="true">
            <button class="bill-modal-close" id="bill-modal-close" aria-label="Close">✕</button>
            <div class="bill-modal-scroll">
                <div class="bill-modal-top">
                    <div class="bill-modal-header">
                        <span class="bill-modal-id">${esc(b.id)}</span>
                        ${b.policyArea ? `<span class="bill-modal-badge policy">${esc(b.policyArea)}</span>` : ''}
                    </div>
                    <h2 class="bill-modal-title">${esc(b.title || '')}</h2>
                </div>
                <div class="bill-modal-sections">${sections}</div>
                ${root.BillSections.summary(b.summary)}
                <div class="bill-modal-foot">
                    ${root.BillSections.action({ textHtml: b.latestAction ? esc(b.latestAction) : '', dateHtml: actionDate })}
                    ${root.BillSections.links({
                      linkClass: o.linkClass,
                      text: b.textVersionUrl || b.govinfoPdf,
                      textLabel: b.textVersionUrl ? b.textVersionType : null,
                      textTitle: b.textVersionUrl ? [b.textVersionType, b.textVersionDate].filter(Boolean).join(', ') : null,
                      report: b.committeeReportUrl, reportTitle: b.committeeReportCitation,
                      cbo: b.cboCostEstimateUrl, cboTitle: b.cboCostEstimateTitle,
                      rule: b.ruleUrl, ruleTitle: b.ruleTitle,
                      memo: b.sapUrl,
                      memoHelp: (root.InfoPopup.has('sap') || fixtures) ? 'sap' : null,
                      reportHelp: (root.InfoPopup.has('committee-report') || fixtures) ? 'committee-report' : null,
                      congress: b.congressUrl,
                    })}
                    ${root.BillSections.source(b.congressUrl)}
                </div>
            </div>
        </div>`;
  }

  // An answer is kept six hours; a failure only for half a minute, so that a hiccup (HTTP 500 from a slow Congress.gov) is tried again on the next opening instead of
  // being served as "unavailable" all day.
  const ERROR_MS = 30 * 1000;
  function cached(id) {
    const hit = cache.get(id);
    return hit && Date.now() - hit.at <= (hit.error ? ERROR_MS : BILL_CACHE_MS) ? hit : null;
  }

  // ask again, every few seconds, until the full answer arrives (or five tries), then keep it and say so: document 'remotebill:full' with { id, bill }
  function fillIn(id, api, n = 0) {
    if (n >= 5 || filling.has(id)) return;
    filling.add(id);
    setTimeout(async () => {
      filling.delete(id);
      try {
        const r = await fetch(`${api}/senate/bill?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(45000) });
        const bill = r.ok ? await r.json() : null;
        if (bill && !bill.error && !bill.partial) {
          cache.set(id, { at: Date.now(), bill });
          document.dispatchEvent(new CustomEvent('remotebill:full', { detail: { id, bill } }));
          return;
        }
      } catch { /* try again */ }
      fillIn(id, api, n + 1);
    }, 6000);
  }

  function fetchBill(id, api) {
    const hit = cached(id);
    if (hit) return Promise.resolve(hit);
    if (inflight.has(id)) return inflight.get(id);
    const p = (async () => {
      try {
        const r = await fetch(`${api}/senate/bill?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(45000) });   // Congress.gov can take 20+ seconds when it is slow
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const bill = await r.json();
        if (bill.error) throw new Error(bill.error);
        const entry = { at: Date.now(), bill };
        // A partial answer (the Worker's Congress.gov record was slow: no sponsor or subject yet) is shown at once and not kept; the full one is fetched in the background and
        // announced, so an open modal fills in the rest.
        if (bill.partial) { fillIn(id, api); return entry; }
        cache.set(id, entry);
        return entry;
      } catch (e) {
        const entry = { at: Date.now(), error: e.message };
        cache.set(id, entry);   // for ERROR_MS only
        return entry;
      } finally { inflight.delete(id); }
    })();
    inflight.set(id, p);
    return p;
  }

  // drop a kept answer (a failure), so "Try again" asks again at once instead of waiting out the half minute
  function forget(id) { cache.delete(id); }

  root.RemoteBill = { pending, skeleton, content, fetch: fetchBill, cached, forget };
})(globalThis);
