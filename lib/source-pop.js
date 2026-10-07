// Source links, both boards.
//
// A panel's "Source: ..." link is a plain link out to the publisher, marked with a small arrow so it is plain that it
// leaves the site. Where the board has the exact data a panel used, the link becomes a button: it opens a small
// popover with that data (a manifest) and, inside it, the link to the publisher.
//
//   SourcePop.set(sectionEl, { title, request, json, note })   // a manifest: the response the panel used, drawn as JSON
//   SourcePop.set(sectionEl, { title, rows: [[label, value], ...] })   // or labelled rows
//   SourcePop.set(sectionEl, null)                                       // back to a plain link
//
// Every `<span class="...source...">Source: <a target="_blank">` on the page is picked up here at load. Which links
// qualify is deliberately narrow (a link whose parent's class names a source, opening a new tab) so a citation inside
// an explanation or a link in the footer keeps its own behaviour. Values are written as text, never as HTML.

(function (root) {
  'use strict';

  const SOURCE_LINK = '[class*="source"] > a[target="_blank"][href^="http"]';
  const SKIP = '.speech-mode-ai-note, .info-popup-source, .site-footer, .info-popup-caption';

  let pop = null, anchor = null;

  function close() {
    if (pop) pop.hidden = true;
    if (anchor) anchor.setAttribute('aria-expanded', 'false');
    anchor = null;
  }

  function place() {
    if (!pop || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = Math.min(380, window.innerWidth - 24);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
    const below = r.bottom + 8;
    pop.style.top = below + 'px';
    // not enough room underneath: open above the link instead
    const h = pop.offsetHeight;
    if (below + h > window.innerHeight - 12 && r.top - 8 - h > 12) pop.style.top = (r.top - 8 - h) + 'px';
  }

  // JSON as the API sent it, pretty-printed and lightly coloured. Every piece is a text node or a span's
  // textContent, so nothing in the data can become markup. `before` / `after` are counts of the neighbouring entries
  // of a list, drawn as comment lines so it reads as an excerpt of the response and not the whole of it.
  function drawJson(pre, data, before, after, listKey, noun) {
    const add = (text, cls) => {
      if (!cls) { pre.appendChild(document.createTextNode(text)); return; }
      const sp = document.createElement('span');
      sp.className = cls;
      sp.textContent = text;
      pre.appendChild(sp);
    };
    const what = noun || 'item';
    const note = (n, word) => add('\n    // ' + n + ' ' + word + ' ' + (n === 1 ? what : (what === 'entry' ? 'entries' : what + 's')), 'j-note');
    const lines = JSON.stringify(data, null, 2).split('\n');
    const wrapped = before !== undefined || after !== undefined;
    if (wrapped) { add('{', 'j-p'); add('\n  ', null); add('"' + (listKey || 'items') + '"', 'j-key'); add(': [', 'j-p'); if (before) note(before, 'newer'); add('\n', null); }
    lines.forEach((line, i) => {
      const indent = wrapped ? '    ' : '';
      const m = line.match(/^(\s*)("(?:[^"\\]|\\.)*")(:\s*)(.*)$/);
      add(indent + (m ? m[1] : line.match(/^\s*/)[0]), null);
      if (m) {
        add(m[2], 'j-key'); add(m[3], 'j-p');
        valueTokens(m[4], add);
      } else {
        valueTokens(line.trim(), add);
      }
      if (i < lines.length - 1) add('\n', null);
    });
    if (wrapped) { if (after) note(after, 'older'); add('\n  ]\n}', 'j-p'); }
  }
  function valueTokens(v, add) {
    const m = v.match(/^(".*"|-?\d[\d.eE+-]*|true|false|null)(,?)$/);
    if (!m) { add(v, 'j-p'); return; }
    const t = m[1];
    add(t, t[0] === '"' ? 'j-str' : /^(true|false|null)$/.test(t) ? 'j-lit' : 'j-num');
    if (m[2]) add(m[2], 'j-p');
  }

  function open(a) {
    const section = a.closest('[id$="-section"]') || a.parentElement;
    const m = section && section._sourceManifest;
    if (!m) return false;
    if (!pop) {
      pop = document.createElement('div');
      pop.className = 'source-pop';
      pop.setAttribute('role', 'dialog');
      pop.hidden = true;
      document.body.appendChild(pop);
    }
    pop.textContent = '';
    pop.classList.toggle('has-json', m.json !== undefined);
    const title = document.createElement('div');
    title.className = 'source-pop-title';
    title.textContent = m.title || 'Source';
    pop.appendChild(title);
    if (m.request) {
      const req = document.createElement('div');
      req.className = 'source-pop-request';
      req.textContent = m.request;
      pop.appendChild(req);
    }
    if (m.json !== undefined) {
      const pre = document.createElement('pre');
      pre.className = 'source-pop-json';
      drawJson(pre, m.json, m.before, m.after, m.listKey, m.noun);
      pop.appendChild(pre);
    }
    for (const [label, value] of m.rows || []) {
      const row = document.createElement('div');
      row.className = 'source-pop-row';
      const k = document.createElement('div');
      k.className = 'source-pop-label';
      k.textContent = label;
      const v = document.createElement('div');
      v.className = 'source-pop-value';
      v.textContent = value;
      row.append(k, v);
      pop.appendChild(row);
    }
    const out = document.createElement('a');
    out.className = 'source-pop-link source-link';
    out.href = a.href;
    out.target = '_blank';
    out.rel = 'noopener';
    out.textContent = 'Open ' + a.textContent.trim();
    pop.appendChild(out);
    anchor = a;
    a.setAttribute('aria-expanded', 'true');
    pop.hidden = false;
    place();
    return true;
  }

  function decorate(scope) {
    for (const a of (scope || document).querySelectorAll(SOURCE_LINK)) {
      if (a.closest(SKIP)) continue;
      a.classList.add('source-link');
    }
  }

  function set(section, manifest) {
    if (!section) return;
    section._sourceManifest = manifest || null;
    for (const a of section.querySelectorAll(SOURCE_LINK)) {
      if (a.closest(SKIP)) continue;
      a.classList.toggle('has-manifest', !!manifest);
      if (manifest) a.setAttribute('aria-haspopup', 'dialog'); else a.removeAttribute('aria-haspopup');
    }
    if (!manifest && anchor && section.contains(anchor)) close();
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.has-manifest');
    if (a) {
      // a second click on the same link closes it; a click anywhere else on the page does too
      if (anchor === a) { e.preventDefault(); close(); return; }
      if (open(a)) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (pop && !pop.hidden && !(e.target.closest && e.target.closest('.source-pop'))) close();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', place);
  // Scrolling moves the link, so the popover follows it (and closes once the link has left the screen). Scrolling
  // inside the popover's own JSON is not the page moving.
  window.addEventListener('scroll', (e) => {
    if (!pop || pop.hidden || !anchor) return;
    if (pop.contains(e.target)) return;
    const r = anchor.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) close(); else place();
  }, { passive: true, capture: true });

  document.addEventListener('DOMContentLoaded', () => decorate());

  root.SourcePop = { set, decorate, close };
})(typeof globalThis !== 'undefined' ? globalThis : this);
