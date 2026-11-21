// EMPTY STATES, one system for every panel that has nothing to show.
//
//   EmptyState.html({ shape, title, text, next })   a panel that is empty: a ghost of what will fill it, a headline, one line, and (optionally) a mono amber line such as the next session
//   EmptyState.column(title, text)                  an empty column beside others (the pipeline, procedural stages, nominations): two ghost bill cards sized to the column, a headline, one line
//   EmptyState.week(text)                           the calendar's "this week" strip with no votes: the five weekdays as empty chips, then the words
//   EmptyState.search(term)                         a search that matched nothing: says what was searched, and offers to clear it
//   EmptyState.detail(text)                         an opened row with nothing posted yet: ghost witness and document lines, then the words
//   EmptyState.small(text)                          one quiet line where nothing else fits: a dotted ring and the words
//   EmptyState.ok(text, {n, of})                    nothing is wrong and nobody is missing: a green check and, given a count, a full meter that reads like the real tally
//   EmptyState.error(text, hint)                    the source could not be read: an amber ring, said plainly (not the same look as "nothing here")
//
// `shape` is the ghost, drawn in the shape of the real thing: 'timeline' (a vote series), 'rows' (meetings, bills), 'cards' (notices), 'doc' (a petition, a treaty).
// Every ring is a zero-length round-capped dash, so it is a ring of dots and not four dashes. The styles are in styles.css under "EMPTY STATES". Text is escaped here.
(function (root) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ring = (cls) => `<svg class="es-ring ${cls || ''}" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5.5"/></svg>`;
  const bar = (w, cls) => `<span class="es-bar ${cls || ''}" style="width:${w}px"></span>`;
  const SHAPES = {
    timeline: () => [140, 100, 120].map((w) => `<div class="es-step">${ring()}${bar(w)}</div>`).join(''),
    rows: () => [[64, 180], [64, 140], [64, 160]].map(([t, w]) => `<div class="es-step es-row">${bar(t, 'es-chip')}${bar(w)}</div>`).join(''),
    cards: () => [1, 2].map(() => `<div class="es-card"><span class="es-dot"></span><span class="es-lines">${bar(160)}${bar(220, 'es-faint')}</span></div>`).join(''),
    doc: () => `<div class="es-card es-doc"><span class="es-lines">${bar(180)}${bar(240, 'es-faint')}<span class="es-meter"><i></i></span></span></div>`,
  };
  function html({ shape = 'timeline', title = '', text = '', next = '' } = {}) {
    return `<div class="empty-note es"><div class="es-ghost es-${esc(shape)}" aria-hidden="true">${(SHAPES[shape] || SHAPES.timeline)()}</div>`
      + `<div class="es-h">${esc(title)}</div>${next ? `<div class="es-next">${esc(next)}</div>` : ''}${text ? `<p class="es-p">${esc(text)}</p>` : ''}</div>`;
  }
  const column = (title, text) => `<div class="empty-note es es-column"><div class="es-ghost" aria-hidden="true">${[1, 2].map(() => `<div class="es-card es-mini"><span class="es-lines"><span class="es-bar" style="width:70%"></span><span class="es-bar es-faint" style="width:100%"></span></span></div>`).join('')}</div><div class="es-h es-h-sm">${esc(title)}</div>${text ? `<p class="es-p">${esc(text)}</p>` : ''}</div>`;
  const week = (text) => `<span class="empty-note es es-week"><span class="es-days" aria-hidden="true">${['M', 'T', 'W', 'T', 'F'].map((d) => `<span class="es-day">${d}</span>`).join('')}</span><span class="es-wk">${esc(text)}</span></span>`;
  const search = (term) => `<div class="empty-note es es-search">${ring()}<span>No signers match <b>\u201c${esc(term)}\u201d</b></span><button type="button" class="es-clear" data-act="clearSignerSearch">Clear search</button></div>`;
  const detail = (text) => `<div class="empty-note es es-detail"><div class="es-ghost es-lines-ghost" aria-hidden="true"><span class="es-dh">WITNESSES</span>${bar(150)}<span class="es-dh">DOCUMENTS</span>${bar(110)}${bar(170, 'es-faint')}</div><span class="es-wk">${esc(text)}</span></div>`;
  const small = (text) => `<div class="empty-note es es-small">${ring()}<span>${esc(text)}</span></div>`;
  const ok = (text, o) => `<div class="empty-note es es-ok"><svg class="es-ring es-ring-solid" viewBox="0 0 14 14" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="6"/><path d="M4.2 7.2l2 2 3.6-4"/></svg><span>${esc(text)}</span>${o && o.of ? `<span class="es-tally"><span class="es-meter es-meter-full"><i></i></span><span class="es-count">${esc(o.n)} of ${esc(o.of)}</span></span>` : ''}</div>`;
  const error = (text, hint) => `<div class="empty-note es es-error"><svg class="es-ring es-ring-solid" viewBox="0 0 14 14" width="18" height="18" aria-hidden="true"><circle cx="7" cy="7" r="6"/><path d="M7 4v3.4M7 9.6v.01"/></svg><span class="es-eh">${esc(text)}</span>${hint ? `<span class="es-p">${esc(hint)}</span>` : ''}</div>`;
  root.EmptyState = { html, column, week, search, detail, small, ok, error };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.EmptyState;
})(typeof globalThis !== 'undefined' ? globalThis : this);
