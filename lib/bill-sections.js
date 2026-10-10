// The sections of a bill modal: sponsor, support, committees, summary, latest action, links.
//
// Shared by both boards. The House modal was written first and the Senate's copied its look
// section by section ("a bare name line was the thing that made this look like a different modal"),
// which is two copies to keep in step and one of them with less in it. What differs is where the
// data comes from and what each board has to say; each board passes in what it has and this draws it:
//
//   BillSections.sponsor({ name, party, loc, photoUrl, placeholder })
//   BillSections.support({ D, R, I, total, cosponsorCount })
//   BillSections.committees({ committees, report, reportDate, formatDate })
//   BillSections.summary(text)                       // plain text; escaped here
//   BillSections.action({ textHtml, dateHtml })      // both already safe HTML: see below
//   BillSections.links({ linkClass, text, report, reportTitle, reportHelp, memo, memoHelp, congress })
//   BillSections.wireCopyLink(root)                  // the Copy link button's click
//
// `action` takes HTML, not text, because the House's action text can carry markup from the Clerk's
// proceedings and has always been drawn as it arrives, while the Senate's is plain text it escapes
// first. Each board makes its own text safe in the way its source needs. Every other value is
// escaped here.
//
// A section is the empty string when there is nothing to put in it, so a caller can concatenate
// them without testing each one.

(() => {
  const { escapeHtml: esc } = globalThis.BoardUtil;

  function sponsor({ name, party, loc, photoUrl, placeholder }) {
    if (!name) return '';
    const pClass = party === 'R' ? 'republican' : party === 'D' ? 'democrat' : 'independent';
    const pLetter = party === 'R' ? 'R' : party === 'D' ? 'D' : 'I';
    return `
            <div class="bill-modal-section">
                <div class="bill-modal-section-label">SPONSOR</div>
                <div class="absentee-member" style="padding:0;border:none;">
                    <div class="absentee-photo-wrap" style="width:36px;height:36px;border-radius:8px;flex-shrink:0;">
                        <div class="absentee-photo-placeholder">${placeholder || ''}</div>
                        ${photoUrl ? `<img class="absentee-photo" src="${esc(photoUrl)}" alt="${esc(name)}" onload="this.style.opacity='1';" onerror="this.style.display='none';" />` : ''}
                    </div>
                    <div class="absentee-meta">
                        <span class="absentee-name">${esc(name)}</span>
                        <span class="absentee-party-tag ${pClass}">${pLetter}</span>
                        <span class="absentee-state">${esc(loc || '')}</span>
                    </div>
                </div>
            </div>`;
  }

  // The party split of the sponsor and cosponsors together. `total` is how many that is;
  // `cosponsorCount` is how many of them are cosponsors, for the label.
  function support({ D, R, I, total, cosponsorCount }) {
    if (!total) return '';
    const pct = (n) => (n / total * 100).toFixed(1);
    const coLabel = cosponsorCount ? `${cosponsorCount} COSPONSOR${cosponsorCount !== 1 ? 'S' : ''}` : 'NO COSPONSORS';
    return `
            <div class="bill-modal-section">
                <div class="bill-modal-section-label">SUPPORT — ${coLabel}</div>
                <div class="bill-modal-support-bar">
                    ${D ? `<div class="bill-modal-support-fill dem" style="width:${pct(D)}%" title="${D} Democrat${D !== 1 ? 's' : ''}"></div>` : ''}
                    ${R ? `<div class="bill-modal-support-fill rep" style="width:${pct(R)}%" title="${R} Republican${R !== 1 ? 's' : ''}"></div>` : ''}
                    ${I ? `<div class="bill-modal-support-fill ind" style="width:${pct(I)}%" title="${I} Independent${I !== 1 ? 's' : ''}"></div>` : ''}
                </div>
                <div class="bill-modal-support-labels">
                    ${D ? `<span class="bill-modal-support-count dem">${D}D</span>` : ''}
                    ${R ? `<span class="bill-modal-support-count rep">${R}R</span>` : ''}
                    ${I ? `<span class="bill-modal-support-count ind">${I}I</span>` : ''}
                </div>
            </div>`;
  }

  // The committee chips, with the reporting committee's vote carried on the first chip and its date
  // to the right. A bill that was reported but names no committee still shows one generic chip.
  function committees({ committees: list, report, reportDate, formatDate }) {
    const names = list && list.length ? list : (report ? ['Committee'] : []);
    if (!names.length) return '';
    const reportInner = globalThis.Committees.reportChipHtml(report);
    const dateHtml = report && reportDate && formatDate
      ? `<span class="bill-modal-date">${formatDate(reportDate)}</span>` : '';
    return `
        <div class="bill-modal-section">
            <div class="bill-modal-section-label">COMMITTEE</div>
            <div class="bill-modal-committee-row">
                <div class="bill-modal-committees">
                    ${names.map((c, i) => globalThis.Committees.committeeChipHtml(c, i === 0 ? reportInner : '')).join('')}
                </div>
                ${dateHtml}
            </div>
        </div>`;
  }

  function summary(text) {
    if (!text) return '';
    return `
            <div class="bill-modal-body">
                <div class="bill-modal-section-label">SUMMARY (AUTHORED BY CRS)</div>
                <p class="bill-modal-summary">${esc(text)}</p>
            </div>`;
  }

  function action({ textHtml, dateHtml }) {
    if (!textHtml) return '';
    return `
                <div class="bill-modal-section" style="margin-bottom:12px;">
                    <div class="bill-modal-section-label">LATEST ACTION</div>
                    <div class="bill-modal-action bill-modal-action-row">
                        <span class="bill-modal-action-text">${textHtml}</span>
                        ${dateHtml ? `<span class="bill-modal-date">${dateHtml}</span>` : ''}
                    </div>
                </div>`;
  }

  // The links row: the text, the committee report if there is one, the White House memo if there is
  // one, Congress.gov, and a Copy link button. `linkClass` colours them (the House by procedure).
  //
  // `memoHelp` / `reportHelp` are keys of info popups explaining the White House memo (a Statement of
  // Administration Policy) and the committee report. Each draws a (?) joined to its button's right edge as one
  // split button, so it reads as that button's own help and not as a separate control. A board passes a key only
  // when it has the entry (see lib/info-popup.js).
  function links({ linkClass, text, textLabel, textTitle, report, reportTitle, reportHelp, memo, memoHelp, cbo, cboTitle, congress }) {
    const a = (href, label, extra = '') =>
      href ? `<a href="${esc(href)}" class="bill-modal-link ${linkClass || ''}" target="_blank" rel="noopener"${extra}>${label}</a>` : '';
    // A button, and its (?) joined on when it has one.
    const withHelp = (html, href, key, label) => href && key
      ? `<span class="bill-link-group">${html}<button type="button" class="info-btn bill-link-help ${linkClass || ''}" data-info="${esc(key)}" aria-label="${esc(label)}">?</button></span>`
      : html;
    const reportHtml = withHelp(a(report, 'View Committee Report →', ` title="${esc(reportTitle || 'Committee Report')}"`), report, reportHelp, 'About committee reports');
    const memoHtml = withHelp(a(memo, 'View White House Memo →'), memo, memoHelp, 'About White House memos');
    return `
                <div class="bill-modal-section">
                    <div class="bill-modal-section-label">RESOURCES</div>
                    <div class="bill-doc-links">
                        ${a(text, `View Bill Text${textLabel ? ` (${esc(textLabel)})` : ''} →`, textTitle ? ` title="${esc(textTitle)}"` : '')}
                        ${reportHtml}
                        ${memoHtml}
                        ${a(cbo, 'View CBO Cost Estimate →', cboTitle ? ` title="${esc(cboTitle)}"` : '')}
                        ${a(congress, 'View on Congress.gov →')}
                        <button class="bill-modal-link bill-copy-link" id="bill-copy-link" type="button" aria-label="Copy link to this bill"><svg class="bill-copy-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span class="bill-copy-text">Copy link</span></button>
                    </div>
                </div>`;
  }

  // Copies the page's current URL, which both boards keep pointing at the open bill (?bill=...).
  function wireCopyLink(root) {
    const btn = (root || document).querySelector('#bill-copy-link');
    if (!btn) return;
    const label = btn.querySelector('.bill-copy-text');
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        const prev = label ? label.textContent : '';
        if (label) label.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => { if (label) label.textContent = prev; btn.classList.remove('copied'); }, 1500);
      } catch { /* clipboard blocked: nothing to say */ }
    });
  }

  // The modal's source line, at the foot: "Source: Congress.gov", which `wireSource` turns into a popover with the
  // Congress.gov responses the modal's sections were drawn from (lib/source-pop.js). `href` is the bill's Congress.gov page.
  function source(href) {
    return href
      ? `<div class="bill-modal-source">Source: <a href="${esc(href)}" target="_blank" rel="noopener">Congress.gov</a></div>`
      : '';
  }

  // `api` is the board's Worker base ('.../house-floor/api'). The responses are asked for only when the popover is opened.
  function wireSource(root, id, api) {
    const scope = root || document;
    const line = scope.matches && scope.matches('.bill-modal-source') ? scope : scope.querySelector('.bill-modal-source');
    if (!line || !globalThis.SourcePop || !id) return;
    SourcePop.decorate(line);
    SourcePop.set(line, {
      title: 'Congress.gov: ' + id,
      load: async () => {
        const r = await fetch(`${api}/bill-source?id=${encodeURIComponent(id)}`);
        // 404: the Worker has not stored this bill's responses yet (it never asks Congress.gov when the popover opens)
        if (r.status === 404) return { rows: [['Response', 'Not stored for this bill yet.']] };
        const d = await r.json();
        if (!r.ok || d.error || !d.parts) throw new Error(d.error || ('HTTP ' + r.status));
        return { parts: d.parts, at: d.at || undefined };
      },
    });
  }

  globalThis.BillSections = { sponsor, support, committees, summary, action, links, source, wireSource, wireCopyLink };
})();
