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
  function drawJson(pre, data, before, after, listKey, noun, mark) {
    const add = (text, cls) => {
      if (!cls) { pre.appendChild(document.createTextNode(text)); return; }
      const sp = document.createElement('span');
      sp.className = cls;
      sp.textContent = text;
      pre.appendChild(sp);
    };
    const what = noun || 'item';
    const note = (n, word) => add('\n    // ' + n + ' ' + word + ' ' + (n === 1 ? what : (what === 'entry' ? 'entries' : what + 's')), 'j-note');
    // An array is the list itself, one element after another; an object is the one element of a list (or the whole answer).
    let lines;
    let markAt = -1;   // the first line of the element `mark` names, so a comment can point at it
    if (Array.isArray(data)) {
      lines = [];
      data.forEach((d, k) => {
        if (k === mark) markAt = lines.length;
        const part = JSON.stringify(d, null, 2).split('\n');
        if (k < data.length - 1) part[part.length - 1] += ',';
        lines.push(...part);
      });
    } else {
      lines = JSON.stringify(data, null, 2).split('\n');
    }
    const wrapped = Array.isArray(data) || before !== undefined || after !== undefined;
    if (wrapped) { add('{', 'j-p'); add('\n  ', null); add('"' + (listKey || 'items') + '"', 'j-key'); add(': [', 'j-p'); if (before) note(before, 'newer'); add('\n', null); }
    lines.forEach((line, i) => {
      const indent = wrapped ? '    ' : '';
      if (i === markAt) { add(indent + '// the entry behind this panel', 'j-note'); add('\n', null); }
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
  // A response can be long (a roster is over half a megabyte) and every token is a node, so the first lines are drawn at once
  // and the rest follow in slices while the popover is open: it opens immediately and the scroll bar grows as it fills.
  let drawToken = 0;
  function progressive(pre, lines, drawLine) {
    const token = ++drawToken;
    const SLICE = 300;
    let at = 0;
    const next = () => {
      if (token !== drawToken || !pre.isConnected) return;
      const host = document.createDocumentFragment();
      const add = (text, cls) => {
        if (!cls) { host.appendChild(document.createTextNode(text)); return; }
        const sp = document.createElement('span');
        sp.className = cls;
        sp.textContent = text;
        host.appendChild(sp);
      };
      for (const end = Math.min(at + SLICE, lines.length); at < end; at++) {
        drawLine(add, lines[at]);
        if (at < lines.length - 1) add('\n', null);
      }
      pre.appendChild(host);
      if (at < lines.length) setTimeout(next, 0);
    };
    next();
  }

  // Laying out HTML for reading, not changing it: one block element per line, indented by how deeply it is nested, and a block that
  // holds only text and inline tags (a table cell, a heading, a paragraph) kept on one line with its content. The tags, their
  // attributes and the text are the publisher's; only the white space between them is the board's.
  const VOID = /^(br|hr|img|input|meta|link|col|wbr)$/i;
  const INLINE = /^(a|b|i|u|em|strong|span|font|small|big|sup|sub|code|abbr|cite|mark|s)$/i;
  function prettyHtml(html) {
    const toks = [];
    for (const t of html.replace(/\s+/g, ' ').split(/(<!--[\s\S]*?-->|<[^>]*>)/)) {
      if (!t) continue;
      if (/^<!--/.test(t)) { toks.push({ k: 'note', t }); continue; }
      const m = t.match(/^<(\/?)([A-Za-z][\w-]*)/);
      if (!m) { if (t.trim()) toks.push({ k: 'text', t: t.replace(/^ | $/g, (x) => x) }); continue; }
      const name = m[2], close = !!m[1];
      if (VOID.test(name) || /\/>$/.test(t)) toks.push({ k: INLINE.test(name) ? 'inline' : 'void', t });
      else if (INLINE.test(name)) toks.push({ k: 'inline', t });
      else toks.push({ k: close ? 'close' : 'open', t, name });
    }
    // which block opens contain another block: those get their own lines, the rest stay on one
    const stack = [];
    for (let i = 0; i < toks.length; i++) {
      const x = toks[i];
      if (x.k === 'open') { x.nested = false; stack.push(x); }
      else if (x.k === 'void' && stack.length) stack[stack.length - 1].nested = true;
      else if (x.k === 'close') {
        let j = stack.length - 1;
        while (j >= 0 && stack[j].name.toLowerCase() !== x.name.toLowerCase()) j--;
        if (j >= 0) {
          const open = stack.splice(j)[0];
          x.leaf = !open.nested; open.leaf = !open.nested;
          if (stack.length) stack[stack.length - 1].nested = true;
        }
      }
    }
    const lines = [];
    let depth = 0, cur = null;
    const flush = () => { if (cur !== null && cur.trim()) lines.push(cur.replace(/\s+$/, '')); cur = null; };
    const start = () => { flush(); cur = '  '.repeat(depth); };
    for (const x of toks) {
      if (x.k === 'note') { start(); cur += x.t; flush(); }
      else if (x.k === 'open') { if (!x.leaf) { start(); cur += x.t; flush(); depth++; } else { start(); cur += x.t; } }
      else if (x.k === 'close') { if (x.leaf) { cur = (cur === null ? '  '.repeat(depth) : cur) + x.t; flush(); } else { flush(); depth = Math.max(0, depth - 1); start(); cur += x.t; flush(); } }
      else if (x.k === 'void' || x.k === 'inline' || x.k === 'text') { if (cur === null) start(); cur += x.t; }
    }
    flush();
    return lines;
  }

  // HTML as the publisher sent it, for a page that is not data (the Senate's floor activity, a House Docs entry): laid out for
  // reading (prettyHtml), tags coloured, text as text. Never inserted as markup.
  function drawHtml(pre, html) {
    progressive(pre, prettyHtml(html), (add, line) => {
      const ind = line.match(/^\s*/)[0];
      add(ind, null);
      for (const tok of line.slice(ind.length).split(/(<!--[\s\S]*?-->|<[^>]*>)/)) {
        if (!tok) continue;
        if (/^<!--/.test(tok)) { add(tok, 'j-note'); continue; }
        const m = tok.match(/^<(\/?)([A-Za-z][\w-]*)([^>]*)>$/);
        if (!m) { add(tok, 'j-str'); continue; }
        add('<' + m[1], 'j-p'); add(m[2], 'j-key'); if (m[3]) add(m[3], 'j-num'); add('>', 'j-p');
      }
    });
  }

  // An iCalendar file as the publisher sent it: one property per line, the property name, its parameters and its value told apart.
  function drawIcs(pre, text) {
    progressive(pre, text.split('\n'), (add, line) => {
      const m = line.match(/^([A-Za-z-]+)((?:;[^:]*)?)(:)(.*)$/);
      if (!m) { add(line, 'j-p'); return; }
      const structural = /^(BEGIN|END)$/.test(m[1]);
      add(m[1], structural ? 'j-p' : 'j-key');
      if (m[2]) add(m[2], 'j-num');
      add(m[3], 'j-p');
      add(m[4], structural ? 'j-p' : 'j-str');
    });
  }

  // XML as the publisher sent it, one element per line, already indented by the caller. Text nodes only.
  function drawXml(pre, xml) {
    progressive(pre, xml.split('\n'), (add, line) => {
      const ind = line.match(/^\s*/)[0];
      const rest = line.slice(ind.length);
      add(ind, null);
      if (/^<!--/.test(rest)) { add(rest, 'j-note'); return; }
      const m = rest.match(/^<(\/?)([A-Za-z_][\w.-]*)((?:\s[^<>]*)?)>(.*?)(?:<\/([A-Za-z_][\w.-]*)>)?$/);
      if (!m) { add(rest, 'j-p'); return; }
      add('<' + m[1], 'j-p'); add(m[2], 'j-key'); if (m[3]) add(m[3], 'j-num'); add('>', 'j-p');
      if (m[4]) add(m[4], 'j-str');
      if (m[5]) { add('</', 'j-p'); add(m[5], 'j-key'); add('>', 'j-p'); }
    });
  }
  function valueTokens(v, add) {
    const m = v.match(/^(".*"|-?\d[\d.eE+-]*|true|false|null)(,?)$/);
    if (!m) { add(v, 'j-p'); return; }
    const t = m[1];
    add(t, t[0] === '"' ? 'j-str' : /^(true|false|null)$/.test(t) ? 'j-lit' : 'j-num');
    if (m[2]) add(m[2], 'j-p');
  }

  function render(a, m) {
    if (!pop) {
      pop = document.createElement('div');
      pop.className = 'source-pop';
      pop.setAttribute('role', 'dialog');
      pop.hidden = true;
      document.body.appendChild(pop);
    }
    pop.textContent = '';
    pop.classList.toggle('has-json', m.json !== undefined || m.xml !== undefined || m.html !== undefined || m.ics !== undefined || (m.parts && m.parts.length > 0));
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
    if (m.ics !== undefined) {
      const pre = document.createElement('pre');
      pre.className = 'source-pop-json';
      pop.appendChild(pre);
      drawIcs(pre, m.ics);
    }
    if (m.html !== undefined) {
      const pre = document.createElement('pre');
      pre.className = 'source-pop-json';
      pop.appendChild(pre);
      drawHtml(pre, m.html);
    }
    if (m.xml !== undefined) {
      const pre = document.createElement('pre');
      pre.className = 'source-pop-json';
      pop.appendChild(pre);
      drawXml(pre, m.xml);
    }
    // Several requests and their responses, one after another (a panel fed by more than one upstream).
    for (const part of m.parts || []) {
      const req = document.createElement('div');
      req.className = 'source-pop-request';
      req.textContent = part.request;
      pop.appendChild(req);
      if (part.note) {
        const n = document.createElement('div');
        n.className = 'source-pop-note';
        n.textContent = part.note;
        pop.appendChild(n);
      }
      const pre = document.createElement('pre');
      pre.className = 'source-pop-json';
      pop.appendChild(pre);
      drawJson(pre, part.json);
    }
    if (m.json !== undefined) {
      const pre = document.createElement('pre');
      pre.className = 'source-pop-json';
      drawJson(pre, m.json, m.before, m.after, m.listKey, m.noun, m.mark);
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
  }

  // A manifest can carry `load`, a function returning a promise of the rest of it ({ html | xml | json, request?, ... }): for a
  // response too large to send with the page, fetched only when somebody opens the popover, and kept for the next time.
  function open(a) {
    const m = a._sourceManifest;
    if (!m) return false;
    if (m.load && (!m._loaded || m.fresh)) {
      render(a, { title: m.title, request: m.request, rows: [['Response', m._failed ? 'Could not be loaded.' : 'Loading...']] });
      if (!m._failed && !m._loading) {
        m._loading = m.load().then((extra) => { Object.assign(m, extra, { _loaded: true }); })
          .catch(() => { m._failed = true; })
          .finally(() => { m._loading = null; if (anchor === a && pop && !pop.hidden) render(a, m._loaded ? m : { title: m.title, request: m.request, rows: [['Response', 'Could not be loaded.']] }); });
      }
      return true;
    }
    render(a, m);
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
    for (const a of section.querySelectorAll(SOURCE_LINK)) {
      if (a.closest(SKIP)) continue;
      a._sourceManifest = manifest || null;
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

  // Pretty-printing an XML element for a manifest: one element per line, attributes kept, a leaf as `<a>text</a>`. A caller
  // picks which elements to show and says what it left out in a comment, so an excerpt reads as one.
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attrs = (el) => [...el.attributes].map((x) => ' ' + x.name + '="' + esc(x.value) + '"').join('');
  function emit(el, depth, lines) {
    const pad = '  '.repeat(depth);
    if (!el.children.length) { lines.push(pad + '<' + el.tagName + attrs(el) + '>' + esc(el.textContent.trim()) + '</' + el.tagName + '>'); return; }
    lines.push(pad + '<' + el.tagName + attrs(el) + '>');
    for (const c of el.children) emit(c, depth + 1, lines);
    lines.push(pad + '</' + el.tagName + '>');
  }
  const note = (depth, text) => '  '.repeat(depth) + '<!-- ' + text.replace(/--/g, '- -') + ' -->';

  root.SourcePop = { set, decorate, close, xml: { emit, note, esc, attrs } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
