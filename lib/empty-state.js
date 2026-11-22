// EMPTY STATES, one system for every panel that has nothing to show.
//
//   EmptyState.html({ shape, title, text, next })   a panel that is empty: a ghost of what will fill it, a headline, one line, and (optionally) a mono amber line such as the next session
//   EmptyState.column(title, text)                  an empty column beside others (the pipeline, procedural stages, nominations): two ghost bill cards sized to the column, a headline, one line
//   EmptyState.week(text)                           the calendar's "this week" strip with no votes: five empty day chips (shapes only, no letters), then the words
//   EmptyState.search(term)                         a search that matched nothing: ghost signer rows, what was searched as a chip, and a Clear search button
//   EmptyState.filtered({ shape, noun, term, tone, cls, attrs, label })   a FILTERED empty state: "No <noun> match" and the filter as the site's own chip with a \u2715; clicking the chip clears the filter. `attrs` is the attribute string that makes that click clear it (the filter's own data-attribute), `tone` the chip's colour key.
//   Any of html and column take `clear: { label, act }` (a button that undoes the filter, wired by data-act) and html takes `term` (what the person filtered or searched for, shown as a chip): every FILTERED empty state offers the way out.
//   EmptyState.detail(text)                         an opened row with nothing posted yet: ghost witness and document lines (shapes only), then the words
//   EmptyState.small(text)                          one quiet line where nothing else fits: a dotted ring and the words
//   EmptyState.allVoted({ who, roll, parties })     nobody missed the roll call: a big green check, "No one missed this vote", a chip per party (all of its seated Members voted), and the roll line
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
    rows: () => [[64, 180], [64, 140], [64, 160]].map(([t, w]) => `<div class="es-step es-row">${bar(t, 'es-tchip')}${bar(w)}</div>`).join(''),
    cards: () => [1, 2].map(() => `<div class="es-card"><span class="es-dot"></span><span class="es-lines">${bar(160)}${bar(220, 'es-faint')}</span></div>`).join(''),
    people: () => [150, 120, 138].map((w) => `<div class="es-step"><span class="es-dot"></span>${bar(w)}</div>`).join(''),
    doc: () => `<div class="es-card es-doc"><span class="es-lines">${bar(180)}${bar(240, 'es-faint')}<span class="es-meter"><i></i></span></span></div>`,
  };
  const clearBtn = (c) => (c && c.act ? `<button type="button" class="es-clear-btn" data-act="${esc(c.act)}">${esc(c.label || 'Clear filter')}</button>` : '');
  const ghost = (shape) => `<div class="es-ghost es-${esc(shape)}" aria-hidden="true">${(SHAPES[shape] || SHAPES.timeline)()}</div>`;
  function html({ shape = 'timeline', title = '', text = '', next = '', term = '', clear = null } = {}) {
    return `<div class="empty-note es"><div class="es-ghost es-${esc(shape)}" aria-hidden="true">${(SHAPES[shape] || SHAPES.timeline)()}</div>`
      + `<div class="es-h">${esc(title)}</div>${term ? `<span class="es-term">\u201c${esc(term)}\u201d</span>` : ''}${next ? `<div class="es-next">${esc(next)}</div>` : ''}${text ? `<p class="es-p">${esc(text)}</p>` : ''}${clearBtn(clear)}</div>`;
  }
  const filtered = ({ shape = 'cards', noun = 'results', term = '', tone = '', cls = '', attrs = '', label = 'Clear filter' } = {}) => `<div class="empty-note es">${ghost(shape)}<div class="es-h">No ${esc(noun)} match<button type="button" class="bills-sort-btn active ${esc(cls)}"${tone ? ` data-tone="${esc(tone)}"` : ''} ${attrs} aria-label="${esc(label)}">${esc(term)}<span aria-hidden="true" class="es-x">\u2715</span></button></div></div>`;
  const column = (title, text, clear, term) => `<div class="empty-note es es-column"><div class="es-ghost" aria-hidden="true">${[1, 2].map(() => `<div class="es-card es-mini"><span class="es-lines"><span class="es-bar" style="width:70%"></span><span class="es-bar es-faint" style="width:100%"></span></span></div>`).join('')}</div><div class="es-h es-h-sm">${esc(title)}</div>${term ? `<span class="es-term">\u201c${esc(term)}\u201d</span>` : ''}${text ? `<p class="es-p">${esc(text)}</p>` : ''}${clearBtn(clear)}</div>`;
  const week = (text) => `<span class="empty-note es es-week"><span class="es-days" aria-hidden="true">${[0, 1, 2, 3, 4].map(() => '<span class="es-day"></span>').join('')}</span><span class="es-wk">${esc(text)}</span></span>`;
  const search = (term) => html({ shape: 'people', title: 'No signers match your search', term, clear: { label: 'Clear search', act: 'clearSignerSearch' } });
  const detail = (text) => `<div class="empty-note es es-detail"><div class="es-ghost es-lines-ghost" aria-hidden="true">${bar(56, 'es-head')}${bar(150)}${bar(56, 'es-head')}${bar(110)}${bar(170, 'es-faint')}</div><span class="es-wk">${esc(text)}</span></div>`;
  const small = (text) => `<div class="empty-note es es-small">${ring()}<span>${esc(text)}</span></div>`;
  // Nobody missed the vote. The big check, what it means, how each party fared (each in its own colour, all of its seated Members), and which roll it was.
  const allVoted = ({ who = 'Members', roll = '', parties = null } = {}) => {
    const chips = parties ? ['D', 'R', 'I'].filter((k) => parties[k] > 0).map((k) => `<span class="es-chip es-chip-${k.toLowerCase()}"><b>${k}</b>${parties[k]} of ${parties[k]}</span>`).join('') : '';
    return `<div class="empty-note es es-allvoted"><svg class="es-ring es-ring-solid es-bigcheck" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6"/><path d="M4.2 7.2l2 2 3.6-4"/></svg>`
      + `<div class="es-h">No one missed this vote</div>${chips ? `<div class="es-chips" aria-label="${esc(who)} who voted, by party">${chips}</div>` : ''}${roll ? `<p class="es-mono">${esc(roll)}</p>` : ''}</div>`;
  };
  const error = (text, hint) => `<div class="empty-note es es-error"><svg class="es-ring es-ring-solid" viewBox="0 0 14 14" width="18" height="18" aria-hidden="true"><circle cx="7" cy="7" r="6"/><path d="M7 4v3.4M7 9.6v.01"/></svg><span class="es-eh">${esc(text)}</span>${hint ? `<span class="es-p">${esc(hint)}</span>` : ''}</div>`;
  root.EmptyState = { ghost, esc, filtered, html, column, week, search, detail, small, allVoted, error };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.EmptyState;
})(typeof globalThis !== 'undefined' ? globalThis : this);
