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

  // HTML as the publisher sent it, for a page that is not data (the Senate's floor activity): one block per line, tags
  // coloured, text as text. Never inserted as markup.
  function drawHtml(pre, html) {
    const flat = html.replace(/\s+/g, ' ').replace(/ ?(<(?:(?:div|h2|br|p|ul|li|table|tr)\b|\/(?:div|table|ul)\b)[^>]*>) ?/gi, '\n$1').trim();
    progressive(pre, flat.split('\n'), (add, line) => {
      for (const tok of line.split(/(<[^>]*>)/)) {
        if (!tok) continue;
        const m = tok.match(/^<(\/?)([A-Za-z][\w-]*)([^>]*)>$/);
        if (!m) { add(tok.trim() ? tok : ' ', 'j-str'); continue; }
        add('<' + m[1], 'j-p'); add(m[2], 'j-key'); if (m[3]) add(m[3], 'j-num'); add('>', 'j-p');
      }
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

  function open(a) {
    const m = a._sourceManifest;
    if (!m) return false;
    if (!pop) {
      pop = document.createElement('div');
      pop.className = 'source-pop';
      pop.setAttribute('role', 'dialog');
      pop.hidden = true;
      document.body.appendChild(pop);
    }
    pop.textContent = '';
    pop.classList.toggle('has-json', m.json !== undefined || m.xml !== undefined || m.html !== undefined);
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
