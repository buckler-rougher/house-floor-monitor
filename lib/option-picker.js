// OPTION PICKER (staging only, temporary): two independent groups, the demo prompt and the two top panels. Remembers picks in localStorage.
(function () {
  'use strict';
  if (!/^(?:house|senate)-floor-staging\.evanhollander\.org$/.test(location.hostname)) return;

  const PLAY = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true" style="vertical-align:-2px"><path d="M8 5v14l11-7z"/></svg>';
  const demoSetup = (html) => (doc) => {
    const a = doc.getElementById('session-demo-prompt'); if (!a) return null;
    const orig = a.innerHTML; a.innerHTML = html; a.dataset.pick = '1';
    return () => { a.innerHTML = orig; delete a.dataset.pick; };
  };
  const NOTE = "The House isn't in session";


  // Tag each Last Sitting Day row with its label so the options can address it (and keep doing so when the app re-renders the body).
  function tagRows() {
    const body = document.getElementById('today-house-body'); if (!body) return;
    body.querySelectorAll('.today-row').forEach((r) => { const l = r.querySelector('.today-label'); if (l) r.dataset.k = l.textContent.trim().toLowerCase(); });
    body.querySelectorAll('.today-vote').forEach((v) => { const y = parseInt((v.querySelector('.yea') || {}).textContent, 10), n = parseInt((v.querySelector('.nay') || {}).textContent, 10); if (y + n > 0) v.style.setProperty('--y', (100 * y / (y + n)).toFixed(1) + '%'); });
  }
  // A voting day to judge the layout against: the app's own vote markup, with sample numbers, put in as the app would (and put back after every re-render).
  function sampleVotes(doc) {
    const body = doc.getElementById('today-house-body'); if (!body) return null;
    const v = (roll, what, desc, res, cls, y, n, extra) => `<div class="today-vote"><span class="today-vote-roll">${roll}</span><span class="today-vote-what">${what}</span><span class="today-vote-desc">${desc}</span><span class="today-vote-tally"><span class="today-vote-result ${cls}">${res}</span> <span class="nb"><span class="yea">${y}</span>–<span class="nay">${n}</span></span> · <span class="nb">${extra}</span></span></div>`;
    const html = '<div class="today-row" data-sample="1"><div class="today-label">3 VOTES</div><div class="today-value"><div class="today-votes">'
      + v(612, 'H.R. 4521 · On Passage', 'Federal Aviation Workforce Act', 'Passed', 'ok', 231, 198, '3 not voting · Dem 12–196 · Rep 219–2 · 2:14 PM EST')
      + v(611, 'H.Res. 902 · On Agreeing to the Resolution', 'Providing for consideration of H.R. 4521', 'Agreed to', 'ok', 218, 211, '2 not voting · Dem 0–208 · Rep 218–3 · 1:02 PM EST')
      + v(610, 'H.R. 3310 · On Motion to Recommit', 'Rural Broadband Access Act', 'Failed', 'no', 204, 225, '4 not voting · Dem 203‒10 · Rep 1–215 · 12:21 PM EST')
      + '</div></div></div>';
    let busy = false;
    const put = () => {
      if (busy) return; busy = true;
      body.querySelectorAll('[data-sample]').forEach((n) => n.remove());
      if (!body.querySelector('.today-votes')) { const rows = body.querySelectorAll('.today-row'); const t = document.createElement('div'); t.innerHTML = html; const row = t.firstChild; if (rows.length > 1) rows[0].after(row); else body.appendChild(row); }
      tagRows(); busy = false;
    };
    put();
    const mo = new MutationObserver(() => { if (!busy && !body.querySelector('[data-sample]')) put(); });
    mo.observe(body, { childList: true });
    return () => { mo.disconnect(); body.querySelectorAll('[data-sample]').forEach((n) => n.remove()); };
  }

  const GROUPS = {
    demo: {
      title: 'Demo prompt',
      options: {
        off: { label: 'Current', css: '' },
        A: { label: 'A  Pill', css: `
          #session-demo-prompt[data-pick] { display:flex; flex-direction:column; align-items:center; gap:9px; border:0; margin-top:var(--sp-16); }
          #session-demo-prompt .dm-note { font-size:var(--fs-xs); color:var(--text-muted); letter-spacing:var(--track-wide); text-transform:uppercase; font-family:var(--font-mono); }
          #session-demo-prompt .dm-btn { display:inline-flex; align-items:center; gap:5px; padding:3px 11px; border-radius:999px; border:1px solid color-mix(in srgb,var(--accent-green) 55%,transparent); color:var(--text-primary); background:color-mix(in srgb,var(--accent-green) 10%,var(--bg-elevated)); font-size:var(--fs-sm); font-weight:600; transition:box-shadow .2s, transform .2s; }
          #session-demo-prompt:hover .dm-btn { box-shadow:0 0 14px rgba(63,185,80,.3); transform:translateY(-1px); }
          #session-demo-prompt .dm-btn svg { color:var(--accent-green); }`,
          setup: demoSetup(`<span class="dm-note">${NOTE}</span><span class="dm-btn">${PLAY}See a demo</span>`) },
        B: { label: 'B  Capsule', css: `
          #session-demo-prompt[data-pick] { display:inline-flex; align-items:stretch; border:1px solid var(--border-color); border-radius:var(--radius-8); background:var(--bg-elevated); overflow:hidden; margin-top:var(--sp-10); text-decoration:none; transition:border-color .2s; }
          #session-demo-prompt:hover { border-color:var(--accent-blue); }
          #session-demo-prompt .dm-note { padding:7px 12px; font-size:var(--fs-sm); color:var(--text-muted); letter-spacing:var(--track-wide); text-transform:uppercase; font-family:var(--font-mono); border-right:1px solid var(--border-color); display:flex; align-items:center; }
          #session-demo-prompt .dm-btn { padding:7px 14px; font-size:var(--fs-base); font-weight:600; color:var(--accent-blue); display:flex; align-items:center; gap:6px; transition:background .2s; }
          #session-demo-prompt:hover .dm-btn { background:color-mix(in srgb,var(--accent-blue) 14%,transparent); }`,
          setup: demoSetup(`<span class="dm-note">${NOTE}</span><span class="dm-btn">${PLAY}See a demo</span>`) },
        C: { label: 'C  Solid', css: `
          #session-demo-prompt[data-pick] { display:flex; flex-direction:column; align-items:center; gap:9px; border:0; margin-top:var(--sp-10); }
          #session-demo-prompt .dm-note { font-size:var(--fs-sm); color:var(--text-muted); }
          #session-demo-prompt .dm-btn { display:inline-flex; align-items:center; gap:8px; padding:9px 20px; border-radius:var(--radius-8); background:var(--accent-blue); color:#06101f; font-size:var(--fs-lg); font-weight:700; letter-spacing:.01em; transition:filter .2s, transform .2s; }
          #session-demo-prompt:hover .dm-btn { filter:brightness(1.12); transform:translateY(-1px); }`,
          setup: demoSetup(`<span class="dm-note">${NOTE}. Watch a past day play out.</span><span class="dm-btn">${PLAY}See a demo</span>`) },
      },
    },
    day: {
      title: 'Day shown',
      options: {
        quiet: { label: 'Real (no votes)', css: '' },
        votes: { label: 'Sample vote day', css: '', setup: sampleVotes },
      },
    },
    panels: {
      title: 'Last sitting day',
      options: {
        off: { label: 'Current', css: '' },
        Q1: { label: 'Q1  Strip + table', css: `
          #today-house-body { display:flex; flex-wrap:wrap; gap:0; padding:0; }
          #today-house-body .today-row { display:flex; flex-direction:row; align-items:baseline; gap:10px; padding:12px 22px; flex:1 1 auto; }
          #today-house-body .today-row[data-k="convened"] { order:1; }
          #today-house-body .today-row[data-k="adjourned"] { order:2; }
          #today-house-body .today-row[data-k="next meeting"] { order:3; margin-left:auto; }
          #today-house-body .today-row[data-k$="vote"], #today-house-body .today-row[data-k$="votes"] { order:4; flex:1 0 100%; display:block; padding:0; border-top:1px solid var(--border-color); }
          #today-house-body .today-label { font-size:var(--fs-xs); letter-spacing:var(--track-wider); color:var(--text-muted); white-space:nowrap; }
          #today-house-body .today-row[data-k$="votes"] .today-label, #today-house-body .today-row[data-k$="vote"] .today-label { display:none; }
          #today-house-body .today-time { font-family:var(--font-mono); font-size:var(--fs-3xl); font-weight:600; color:var(--accent-green); margin:0; }
          #today-house-body .today-value { font-size:var(--fs-base); color:var(--text-secondary); }
          #today-house-body .today-votes { gap:0; }
          #today-house-body .today-vote { position:relative; grid-template-columns:3.2rem 1fr auto; padding:12px 22px 14px; }
          #today-house-body .today-vote + .today-vote { border-top:1px solid color-mix(in srgb,var(--border-color) 60%,transparent); }
          #today-house-body .today-vote-tally { grid-column:2 / -1; }
          #today-house-body .today-vote::after { content:''; grid-column:2 / -1; height:4px; border-radius:2px; margin-top:6px; background:linear-gradient(90deg,var(--accent-green) var(--y,50%),var(--accent-red) var(--y,50%)); opacity:.75; }` },
        Q2: { label: 'Q2  Vote cards', css: `
          #today-house-body { display:grid; grid-template-columns:repeat(3,1fr); gap:0; padding:0; }
          #today-house-body .today-row { display:flex; flex-direction:column; gap:3px; padding:12px 22px; border-top:1px solid var(--border-color); }
          #today-house-body .today-row[data-k$="vote"], #today-house-body .today-row[data-k$="votes"] { order:1; grid-column:1 / -1; border-top:0; padding:16px 22px 14px; gap:10px; }
          #today-house-body .today-row[data-k="convened"] { order:2; }
          #today-house-body .today-row[data-k="adjourned"] { order:3; border-left:1px solid var(--border-color); }
          #today-house-body .today-row[data-k="next meeting"] { order:4; border-left:1px solid var(--border-color); }
          #today-house-body .today-label { font-size:var(--fs-xs); letter-spacing:var(--track-wider); color:var(--text-muted); }
          #today-house-body .today-row[data-k$="votes"] .today-label { font-size:var(--fs-sm); color:var(--text-secondary); }
          #today-house-body .today-time { font-family:var(--font-mono); font-size:var(--fs-4xl); font-weight:600; color:var(--text-primary); margin:0; }
          #today-house-body .today-votes { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:10px; }
          #today-house-body .today-vote { display:flex; flex-direction:column; gap:5px; padding:12px 14px; border:1px solid var(--border-color); border-radius:var(--radius-8); background:color-mix(in srgb,var(--bg-elevated) 60%,transparent); position:relative; overflow:hidden; }
          #today-house-body .today-vote-tally { display:block; white-space:normal; line-height:1.7; min-width:0; }
          #today-house-body .today-vote > * { min-width:0; }
          #today-house-body .today-vote-roll { font-size:var(--fs-xs); letter-spacing:var(--track-wider); }
          #today-house-body .today-vote-roll::before { content:'ROLL '; }
          #today-house-body .today-vote-what { font-size:var(--fs-lg); font-weight:600; }
          #today-house-body .today-vote-result { display:inline-block; padding:1px 8px; border-radius:999px; border:1px solid currentColor; margin-right:8px; }
          #today-house-body .today-vote::after { content:''; position:absolute; left:0; right:0; bottom:0; height:3px; background:linear-gradient(90deg,var(--accent-green) var(--y,50%),var(--accent-red) var(--y,50%)); opacity:.8; }` },
        Q3: { label: 'Q3  Quiet ledger', css: `
          #today-house-body { display:block; padding:12px 22px 16px; }
          #today-house-body .today-row[data-k="convened"], #today-house-body .today-row[data-k="adjourned"], #today-house-body .today-row[data-k="next meeting"] { display:inline-flex; align-items:baseline; gap:8px; margin-right:26px; padding:0 0 12px; }
          #today-house-body .today-row[data-k$="vote"], #today-house-body .today-row[data-k$="votes"] { display:block; padding:12px 0 0; border-top:1px solid var(--border-color); }
          #today-house-body .today-row[data-k$="votes"] .today-label, #today-house-body .today-row[data-k$="vote"] .today-label { margin-bottom:8px; }
          #today-house-body .today-label { font-size:var(--fs-xs); letter-spacing:var(--track-wider); color:var(--text-muted); }
          #today-house-body .today-time { font-family:var(--font-mono); font-size:var(--fs-xl); font-weight:600; margin:0; }
          #today-house-body .today-value { font-size:var(--fs-base); }
          #today-house-body .today-votes { gap:2px; }
          #today-house-body .today-vote { display:grid; grid-template-columns:2.6rem 1fr auto; align-items:baseline; padding:7px 0; }
          #today-house-body .today-vote-desc { grid-column:2; grid-row:2; }
          #today-house-body .today-vote-tally { grid-column:3; grid-row:1 / span 2; text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:3px; }
          #today-house-body .today-vote-result { font-size:var(--fs-sm); margin:0; }
          #today-house-body .today-vote::after { content:''; grid-column:1 / -1; height:2px; border-radius:1px; margin-top:7px; background:linear-gradient(90deg,var(--accent-green) var(--y,50%),var(--accent-red) var(--y,50%)); opacity:.55; }` },
      },
    },
  };

  const KEY = 'option-picker3';
  function start() {
    const tb = document.getElementById('today-house-body'); if (tb) { tagRows(); new MutationObserver(tagRows).observe(tb, { childList: true }); }
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:6px;background:#000d;border:1px solid #fff3;border-radius:10px;padding:8px;max-width:96vw';
    const state = {};
    Object.keys(GROUPS).forEach((g) => {
      const G = GROUPS[g]; const st = document.head.appendChild(document.createElement('style')); let cleanup = null;
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:center';
      const t = document.createElement('span'); t.textContent = G.title; t.style.cssText = 'color:#9aa;font:11px system-ui;width:86px'; row.appendChild(t);
      const set = (k) => {
        if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
        st.textContent = G.options[k].css || '';
        if (G.options[k].setup) cleanup = G.options[k].setup(document) || null;
        state[g] = k; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
        [...row.querySelectorAll('button')].forEach((c) => { c.style.background = c.dataset.k === k ? '#2f4a86' : '#1a2233'; });
      };
      Object.keys(G.options).forEach((k) => {
        const b = document.createElement('button'); b.dataset.k = k; b.textContent = G.options[k].label;
        b.style.cssText = 'color:#fff;border:0;border-radius:7px;padding:6px 10px;cursor:pointer;font:12px system-ui;background:#1a2233'; b.onclick = () => set(k); row.appendChild(b);
      });
      bar.appendChild(row);
      const k0 = saved[g] in G.options ? saved[g] : Object.keys(G.options)[1];
      set(k0);
    });
    document.body.appendChild(bar);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
