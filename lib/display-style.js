// House style for what the board shows, applied to the text on the page as it is drawn:
//
//   US, not U.S.                         "the U.S. House" -> "the US House"
//   bill types without periods           H.R. 1234 -> HR 1234,  H.Res. 12 -> HRes 12,  H.J.Res. 5 -> HJRes 5,  H.Con.Res. 3 -> HConRes 3,
//                                        S. 7 -> S 7,  S.Res. 4 -> SRes 4,  S.J.Res. 2 -> SJRes 2,  S.Con.Res. 1 -> SConRes 1
//   the unpunctuated form of DomeWatch   "H R 4795", "H RES 1490" -> HR 4795, HRes 1490
//
// Only the DISPLAY changes. The ids the code keys on ("H.R. 4795" in a data-bill-id, in a cache key, in a lookup) are untouched, and every spelling above still normalizes to the same key
// (lib/bill-id.js strips the periods and spaces). Text that is somebody else's words is left exactly as they wrote it: the Clerk's floor log, the Whip and Caucus notices, tweets, the
// publishers' responses in the source popovers, CRS summaries, latest-action lines, hearing titles and the captions (the QUOTE selector below, and any element marked data-quote).
//
//   DisplayStyle.text("H.R. 1234 in the U.S. House")   pure: the restyled string   (test/display-style.test.js)
//
// It restyles what is already on the page and what is added or changed later (a MutationObserver), so no template has to remember to. A rewrite is made only when the text changes, so
// the observer does not feed on its own edits.
(function (root) {
  'use strict';

  const RULES = [
    [/\bU\.S\.C\.(?=\s)/g, 'USC'],
    [/\bU\.S\.(?!C)/g, 'US'],
    [/\bH\.\s?J\.\s?Res\.\s?(?=\d)/g, 'HJRes '],
    [/\bH\.\s?Con\.\s?Res\.\s?(?=\d)/g, 'HConRes '],
    [/\bH\.\s?Res\.\s?(?=\d)/g, 'HRes '],
    [/\bH\.\s?R\.\s?(?=\d)/g, 'HR '],
    [/\bS\.\s?J\.\s?Res\.\s?(?=\d)/g, 'SJRes '],
    [/\bS\.\s?Con\.\s?Res\.\s?(?=\d)/g, 'SConRes '],
    [/\bS\.\s?Res\.\s?(?=\d)/g, 'SRes '],
    [/\bS\.\s(?=\d)/g, 'S '],
    [/\bH J RES (?=\d)/g, 'HJRes '],
    [/\bH CON RES (?=\d)/g, 'HConRes '],
    [/\bH RES (?=\d)/g, 'HRes '],
    [/\bH R (?=\d)/g, 'HR '],
    [/\bS J RES (?=\d)/g, 'SJRes '],
    [/\bS CON RES (?=\d)/g, 'SConRes '],
    [/\bS RES (?=\d)/g, 'SRes '],
  ];

  function text(s) {
    if (typeof s !== 'string' || !/[.]|\b[HS] /.test(s)) return s;
    let out = s;
    for (const [re, to] of RULES) out = out.replace(re, to);
    return out;
  }

  // Somebody else's words: left as they wrote them.
  const QUOTE = [
    '[data-quote]', '.proceedings-text', '#whip-updates', '#caucus-notices', '.tweet-item', '.source-pop', '.bill-modal-summary', '.bill-modal-summary-scroll',
    '.bill-modal-action-text', '.approps-action', '.dp-action', '.committee-title', '.floor-feed-captions', '.pip-captions', '.bill-title', '.bill-modal-title',
  ].join(',');
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT', 'CODE', 'PRE', 'INPUT']);
  const ATTRS = ['title', 'aria-label', 'data-tooltip', 'placeholder', 'alt'];

  const quoted = (el) => !!(el && el.closest && el.closest(QUOTE));
  function fixText(n) { const v = text(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
  function fixAttrs(el) {
    if (SKIP_TAGS.has(el.tagName) || quoted(el)) return;
    for (const a of ATTRS) { const t = el.getAttribute(a); if (t) { const v = text(t); if (v !== t) el.setAttribute(a, v); } }
  }
  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) { if (!quoted(node.parentElement) && !SKIP_TAGS.has(node.parentElement && node.parentElement.tagName)) fixText(node); return; }
    if (node.nodeType !== 1 || SKIP_TAGS.has(node.tagName) || quoted(node)) return;
    fixAttrs(node);
    const tw = document.createTreeWalker(node, 1 | 4, {
      acceptNode: (n) => (n.nodeType === 1 && (SKIP_TAGS.has(n.tagName) || n.matches(QUOTE))) ? 2 : 1,   // 2: leave out the element and everything in it
    });
    for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (n.nodeType === 3) fixText(n); else fixAttrs(n); }
  }

  function start() {
    walk(document.body);
    document.title = text(document.title);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') m.addedNodes.forEach(walk);
        else if (m.type === 'characterData') { const p = m.target.parentElement; if (p && !SKIP_TAGS.has(p.tagName) && !quoted(p)) fixText(m.target); }
        else if (m.type === 'attributes') fixAttrs(m.target);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  root.DisplayStyle = { text };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DisplayStyle;
})(typeof globalThis !== 'undefined' ? globalThis : this);
