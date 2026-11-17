// card.html: draws one bill as the 1200 x 630 card a shared link previews as. ?bill=hr9600 (and &b=senate). The Worker's /api/og/<bill>.png opens this page in a browser and waits for
// body[data-ready]; body[data-failed] says there was nothing to draw, so the Worker serves the generic image instead.
(function () {
  'use strict';
  const API = 'https://api.evanhollander.org/house-floor/api';
  const TYPES = { hr: 'H.R.', hres: 'H.Res.', hjres: 'H.J.Res.', hconres: 'H.Con.Res.', s: 'S.', sres: 'S.Res.', sjres: 'S.J.Res.', sconres: 'S.Con.Res.' };
  const q = new URLSearchParams(location.search);
  const slug = String(q.get('bill') || '').toLowerCase();
  const senate = q.get('b') === 'senate';
  const m = slug.match(/^(hr|hres|hjres|hconres|s|sres|sjres|sconres)(\d{1,5})$/);
  const id = m ? `${TYPES[m[1]]} ${m[2]}` : null;
  const $ = (n) => document.getElementById(n);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const done = (ok) => { document.body.dataset[ok ? 'ready' : 'failed'] = '1'; };
  const PARTY = { D: 'var(--party-d)', R: 'var(--party-r)', I: 'var(--party-i)' };

  // How the bill is handled this week: one of the three the modal labels, from the week's list; it does not change within the week.
  function procedure(week) {
    if (!week || !id) return null;
    const same = (x) => x && String(x.id).replace(/[\s.]/g, '').toLowerCase() === id.replace(/[\s.]/g, '').toLowerCase();
    if ((week.suspensionBills || []).some(same)) return { text: 'UNDER SUSPENSION', cls: 'suspension' };
    if ((week.ruleBills || []).some(same)) return { text: 'SUBJECT TO A RULE', cls: 'rule' };
    if ((week.mayBeConsideredBills || []).some(same)) return { text: 'MAY BE CONSIDERED', cls: 'maybe' };
    return null;
  }
  function lead(summary, title) {
    let t = String(summary || '').replace(/\s+/g, ' ').trim();
    if (title && t.toLowerCase().startsWith(String(title).toLowerCase())) t = t.slice(String(title).length).trim();
    return t;
  }

  async function main() {
    if (!id) return done(false);
    const get = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [b, week] = await Promise.all([get(`${API}/senate/bill?id=${encodeURIComponent(id)}`), senate ? null : get(`${API}/bills`)]);
    if (!b || !b.title) return done(false);

    const proc = procedure(week);
    $('c-top').innerHTML = `<span class="c-id">${esc(id.replace(/\./g, ''))}</span>${proc ? `<span class="bill-modal-badge ${proc.cls}">${proc.text}</span>` : ''}`;
    $('c-title').textContent = b.title;
    $('c-sum').textContent = lead(b.summary, b.title);
    if (!$('c-sum').textContent) $('c-sum').hidden = true;

    const sp = b.sponsor || null;
    const board = senate ? 'Senate' : 'House';
    let photoReady = Promise.resolve();
    if (sp && sp.name) {
      const bio = sp.bioguide || sp.bioguideId;
      const committee = Array.isArray(b.committees) && b.committees[0] ? (b.committees[0].name || '') : '';
      $('c-spons').style.setProperty('--ring', PARTY[sp.party] || 'var(--text-muted)');
      $('c-spons').innerHTML = `${bio ? `<div class="c-photo"><img id="c-img" src="https://bioguide.congress.gov/photo/${esc(bio)}.jpg" alt=""></div>` : ''}
        <div><div class="c-lab">Sponsor</div><div class="c-name">${senate || /^S/.test(id) ? 'Sen.' : 'Rep.'} ${esc(sp.name)}${sp.party && sp.state ? `<small>${esc(sp.party)}-${esc(sp.state)}</small>` : ''}</div></div>
        ${committee ? `<div class="c-meta">${esc(committee)}</div>` : ''}`;
      const img = $('c-img');
      if (img && !img.complete) photoReady = new Promise((res) => { img.onload = img.onerror = res; setTimeout(res, 4000); });
    } else $('c-spons').hidden = true;

    const s = b.support;
    if (s && s.total) {
      const pct = (n) => (n / s.total * 100).toFixed(1);
      const co = b.cosponsorCount != null ? b.cosponsorCount : Math.max(0, s.total - 1);
      $('c-support').innerHTML = `<div class="c-lab">Support · ${co ? `${co} cosponsor${co === 1 ? '' : 's'}` : 'no cosponsors'}</div>
        <div class="c-bar">${[['D', 'dem'], ['R', 'rep'], ['I', 'ind']].map(([k, c]) => (s[k] ? `<div class="${c}" style="width:${pct(s[k])}%"></div>` : '')).join('')}</div>
        <div class="c-counts">${[['D', 'dem'], ['R', 'rep'], ['I', 'ind']].map(([k, c]) => (s[k] ? `<span class="${c}">${s[k]}${k}</span>` : '')).join('')}</div>`;
    } else $('c-support').hidden = true;

    $('c-site').textContent = `Monitoring the ${board} Floor`;
    $('c-host').textContent = senate ? 'senate-floor.evanhollander.org' : 'house-floor.evanhollander.org';
    $('card').hidden = false;
    await Promise.all([photoReady, document.fonts ? document.fonts.ready : null]);
    done(true);
  }
  main().catch(() => done(false));
})();
