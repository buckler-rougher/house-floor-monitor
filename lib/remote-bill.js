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

  function skeleton(id, message) {
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
                        ${b.policyArea ? `<span class="bill-modal-badge">${esc(b.policyArea)}</span>` : ''}
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

  function fetchBill(id, api) {
    const hit = cached(id);
    if (hit) return Promise.resolve(hit);
    if (inflight.has(id)) return inflight.get(id);
    const p = (async () => {
      try {
        const r = await fetch(`${api}/senate/bill?id=${encodeURIComponent(id)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const bill = await r.json();
        if (bill.error) throw new Error(bill.error);
        const entry = { at: Date.now(), bill };
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

  root.RemoteBill = { skeleton, content, fetch: fetchBill, cached };
})(globalThis);
