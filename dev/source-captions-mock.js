// MOCK (not shipped): the sub-section source captions, drawn on the real panels. Open /?fixtures&captions
// Each caption reuses the panel header's own .panel-source look (small muted capitals, blue link with the arrow), so nothing new is invented.
(function () {
  const cap = (label, links) => {
    const d = document.createElement('div');
    d.className = 'panel-source src-cap';
    d.innerHTML = `${label} ` + links.map((l) => `<a class="source-link has-tail" href="#" onclick="return false">${l}</a>`).join(' · ');
    return d;
  };
  const style = document.createElement('style');
  style.textContent = `.src-cap { margin: var(--sp-4) 0 var(--sp-8); padding: 0 var(--sp-24); } .src-cap.is-inset { padding: 0; margin: var(--sp-10) 0 var(--sp-4); }`;
  document.head.appendChild(style);
  const findText = (root, re, tag) => [...root.querySelectorAll(tag || '*')].find((e) => e.children.length <= 2 && re.test(e.textContent.trim()) && e.textContent.trim().length < 70 && e.getBoundingClientRect().height > 0);
  const put = () => {
    if (document.querySelector('.src-cap')) return;
    const $ = (id) => document.getElementById(id);
    // BILLS THIS WEEK: the status line on each card is the Clerk's floor log, not House Docs
    const bills = $('bills'), sort = bills && bills.querySelector('.bills-sort-bar, .bills-sort-switcher');
    if (sort) { const c = cap('Status lines:', ['Clerk floor log', 'Congress.gov']); c.classList.add('is-inset'); sort.parentElement.insertBefore(c, sort.nextSibling); }
    // MEMBER-INITIATED FLOOR ACTION: where a petition stands on the Discharge Calendar
    const dp = $('discharge-petitions'), dsort = dp && dp.querySelector('.bills-sort-bar, .bills-sort-switcher');
    if (dsort) { const c = cap('Calendar standing:', ['GovInfo House Calendars']); c.classList.add('is-inset'); dsort.parentElement.insertBefore(c, dsort.nextSibling); }
    // APPROPRIATIONS: the funding date and extended programs, and the steps of each bill
    const ap = $('appropriations'), cr = ap && ap.querySelector('.cr-through');
    if (cr) { const band = cr.closest('.cr-text') || cr.parentElement; const c = cap('Date and programs:', ['GovInfo enrolled text']); c.classList.add('is-inset'); band.appendChild(c); }
    const fy = ap && ap.querySelector('.approps-fy');
    if (fy) { const c = cap('Steps:', ['Congress.gov', 'House Committee Repository']); fy.insertAdjacentElement('afterend', c); }
    // VOTE SERIES: the order is the Whip's, the results are roll call data
    const vs = $('vote-series-panel'), vh = vs && vs.querySelector('.panel-header');
    if (vh) { const c = cap('Results:', ['Clerk roll call data']); vh.insertAdjacentElement('afterend', c); }
  };
  let n = 0; const t = setInterval(() => { put(); if (document.querySelector('.src-cap') || ++n > 40) clearInterval(t); }, 500);
})();
