// What a special rule does, as a plain object the page can draw. Built by the Worker from the text of the rules (lib/special-rule.js reads them; nothing here is written by a model) and
// drawn by the page (`html`). `rules` is { [number]: { parsed, agreed } }; `clauseDoc` is HouseRuleClauses (the House's own Rules text, dev/house-rule-clauses.mjs).
(function (root) {
  'use strict';
  const SR = () => root.SpecialRule;
  const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // the site's date format: day first, short month, day padded ("02 May 2026")
  const fmt = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]} ${MS[Number(m[2]) - 1]} ${m[1]}` : ''; };
  const mins = (m) => (m % 60 === 0 ? `${m / 60} hr` : `${m} min`);
  const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
  const KIND = { 'clauses-waived': 'House rules waived', 'senate-message': 'Message to the Senate', engrossment: 'Engrossment instructions', 'adopts-or-tables': 'Adopts, tables, or cancels another resolution', 'record-insertion': 'Record insertion', 'same-day-waiver': 'Same-day consideration waived', 'suspension-debate': 'Suspension debate changed', 'suspension-authority': 'Suspension authority extended', 'days-not-count': 'Days that do not count', 'nea-not-apply': 'National Emergencies Act window', 'amends-earlier': 'Changes an earlier rule', 'measure-list': 'List of measures', 'amendment-machinery': 'Amendment procedure', other: 'Other provision' };

  // "Ways and Means" -> "Ways and Means Committee's"
  function committeePossessive(name) {
    const n = String(name || '').replace(/^the /i, '').trim();
    return n ? `${n} Committee's` : "the committee's";
  }
  function measureFacts(m) {
    const facts = [];
    if (m.timing === 'same-day') facts.push({ t: 'Taken up as soon as the rule is adopted', hl: true });
    if (m.timing === 'speaker-calls') facts.push({ t: 'Speaker calls up the Committee of the Whole' });
    facts.push({ t: { closed: 'Closed', structured: 'Structured', open: 'Open' }[m.amendments] });
    if (m.substitute) facts.push(m.substitute.kind === 'committee' ? { t: 'Adopts AINS', tip: `Adopts ${committeePossessive(m.substitute.committee)} amendment in the nature of a substitute` } : { t: `Rules Committee Print ${m.substitute.print} adopted with the rule${m.substitute.inLieu ? ", in lieu of the committee's" : ''}` });
    if (m.debateMinutes) facts.push({ t: `${mins(m.debateMinutes)} debate${m.debateCommittees.length ? ' · ' + m.debateCommittees.join(' and ') : ''}` });
    if (m.motionToRecommit) facts.push({ t: `One motion to ${m.motionToRecommit}` });
    if (m.waivesConsideration && m.waivesProvisions) facts.push({ t: 'Points of order waived' });
    else if (m.waivesConsideration) facts.push({ t: 'Points of order against consideration waived' });
    return facts.filter((f) => f.t);
  }

  function chainsFor(rules, n, p, today) {
    let origins = [];
    if (p.kind === 'amends-earlier') origins = SR().originsOf(rules, n, p.n);
    else if (p.kind === 'days-not-count' || p.kind === 'nea-not-apply') origins = [{ resolution: n, section: p.n }];
    const seen = new Set(); const out = [];
    for (const o of origins) {
      const steps = SR().chainOf(rules, o.resolution, o.section);
      if (!steps) continue;
      const sig = steps.map((s) => s.resolution + ':' + s.section).join('>');
      if (seen.has(sig)) continue; seen.add(sig);
      const end = SR().chainEnd(steps, today);
      out.push({
        steps: steps.length > 1 ? steps.map((s) => {
          const origin = rules[s.resolution].parsed.provisions.find((x) => x.n === s.section);
          return { resolution: s.resolution, section: s.section, when: fmt(s.agreed) || null, mine: s.resolution === Number(n), starts: s.kind === 'starts', plain: s.kind === 'starts' ? SR().describe(origin, fmt) : null, from: s.from || null, to: s.to || null };
        }) : [],
        end: { state: end.state, until: fmt(end.iso) || null, days: end.days == null ? null : end.days, text: end.text || null },
      });
    }
    return out;
  }

  // the House's own words for each clause a provision names: the whole clause, or the paragraph when the rule names one ("clause 1(c)")
  function clausesFor(x, clauseDoc) {
    if (!clauseDoc || !x.clauses || !x.clauses.length) return [];
    const out = [];
    for (const c of x.clauses) {
      const m = c.clause.match(/^(\d+)(?:\(([a-z])\))?/); const cl = clauseDoc.rules[c.rule] && clauseDoc.rules[c.rule][m[1]];
      if (!cl) continue;
      out.push({ title: cap(c.text), heading: cl.heading || null, body: m[2] && cl.paragraphs && cl.paragraphs[m[2]] ? cl.paragraphs[m[2]] : cl.text });
    }
    return out;
  }

  function build(rules, n, today, clauseDoc) {
    n = Number(n);
    const r = rules[n];
    if (!r || !r.parsed || !r.parsed.measures) return null;
    const p = r.parsed;
    const provs = p.provisions.filter((x) => !['measure-list', 'amendment-machinery'].includes(x.kind));
    const machinery = p.provisions.filter((x) => x.kind === 'amendment-machinery');
    return {
      n,
      tags: SR().cardTags(p),
      extension: provs.some((x) => ['days-not-count', 'nea-not-apply', 'amends-earlier'].includes(x.kind)),
      measures: p.measures.map((m) => ({ id: SR().measureId(m.id), title: cap(m.title || ''), text: String(m.text || '').replace(/^Sec\. \d+\. /, ''), sec: m.fromList ? `Sec. ${m.n} + list in Sec. ${m.fromList}` : `Sec. ${m.n}`, facts: measureFacts(m) })),
      provisions: provs.map((x) => {
        const plain = SR().describe(x, fmt);
        const rel = (x.kind === 'days-not-count' || x.kind === 'nea-not-apply') ? SR().sharedEmergency(rules, n, x.n) : [];
        return {
          kind: x.kind, label: KIND[x.kind] || KIND.other, sec: x.n, plain: plain || null, text: x.text.replace(/^Sec\. \d+\. /, ''),
          chains: chainsFor(rules, n, x, today),
          related: [...new Set(rel.map((s) => `H.Res. ${s.resolution} §${s.section}`))],
          clauses: clausesFor(x, clauseDoc),
        };
      }),
      machinery: machinery.length && SR().describe(machinery[0]) ? { secs: machinery.map((m) => m.n), plain: SR().describe(machinery[0]) } : null,   // only when a pattern reads it
    };
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const quote = (label, inner) => `<details class="sr-quote"><summary>${esc(label)}</summary><div class="sr-quote-body">${inner}</div></details>`;
  const facts = (list) => `<div class="sr-facts">${list.map((f) => `<span class="sr-fact${f.hl ? ' is-hl' : ''}"${f.tip ? ` title="${esc(f.tip)}"` : ''}>${esc(f.t)}</span>`).join('')}</div>`;

  function chainHtml(c) {
    let h = '';
    if (c.steps.length) {
      h += `<div class="sr-chain">${c.steps.map((s) => {
        const body = s.starts ? `starts it. ${esc(s.plain || '')}` : `changes <span class="sr-old">${esc(s.from)}</span> to <b>${esc(s.to)}</b>.`;
        return `<div class="sr-step${s.mine ? ' is-now' : ''}"><span class="sr-when">${esc(s.when || 'date not read')}</span><br><span class="sr-rl">H.Res. ${s.resolution} §${s.section}</span> ${body}${s.mine ? ' <b>This rule.</b>' : ''}</div>`;
      }).join('')}</div>`;
    }
    if (c.end.state === 'in-effect') h += `<span class="sr-status is-live"><span class="sr-dot"></span>In effect until ${esc(c.end.until)} · ${c.end.days} days left</span>`;
    else if (c.end.state === 'expired') h += `<span class="sr-status"><span class="sr-dot"></span>Expired ${esc(c.end.until)} · ${-c.end.days} days ago</span>`;
    return h;
  }

  // The section drawn in a rule's modal. BETA is said at the top and the rule's own words are one click away from every line.
  function html(model) {
    if (!model) return '';
    const parts = [];
    parts.push(`<div class="sr-head"><span class="sr-title">What this rule does</span><span class="sr-beta">Beta</span></div>
      <p class="sr-note">Beta. This is read from the text of the rule by code, not written by a person, and it can miss or misread a provision. Open "Text of the rule" under any line to check it.</p>`);
    parts.push(`<div class="sr-block"><h4 class="sr-h">Measures considered</h4>${model.measures.map((m) => `<div class="sr-meas"><div class="sr-top"><span class="sr-mid">${esc(m.id)}</span><span class="sr-sec">${esc(m.sec)}</span></div>${m.title ? `<div class="sr-mtitle">${esc(m.title)}</div>` : ''}${facts(m.facts)}${m.text ? quote('Text of the rule', `<p>${esc(m.text)}</p>`) : ''}</div>`).join('')}</div>`);
    const count = model.provisions.length + (model.machinery ? 1 : 0);
    if (count) {
      parts.push(`<div class="sr-block"><h4 class="sr-h">Beyond consideration <small>${count} provision${count === 1 ? '' : 's'}</small></h4>${model.provisions.map((x) => `<div class="sr-prov">
        <div class="sr-kind${x.plain ? '' : ' is-raw'}">${esc(x.label)}${model.extension && ['days-not-count', 'nea-not-apply', 'amends-earlier'].includes(x.kind) ? '<span class="sr-ext">Extension</span>' : ''}<span class="sr-sec">Sec. ${x.sec}</span></div>
        <div class="sr-plain">${x.plain ? esc(x.plain) : `${esc(x.text)}<small class="sr-raw">Shown in the rule's own words: no pattern reads it.</small>`}</div>
        ${x.chains.map(chainHtml).join('')}
        ${x.related.length ? `<div class="sr-related">Also names the emergencies in: ${x.related.map((r) => `<span class="sr-rl">${esc(r)}</span>`).join(', ')}</div>` : ''}
        ${x.clauses.length ? quote('What those clauses say', x.clauses.map((c) => `<p><b>${esc(c.title)}</b>${c.heading ? ` (${esc(c.heading)})` : ''}<br>${esc(c.body)}</p>`).join('') + '<small>Rules of the House, 119th Congress, as the House publishes them.</small>') : ''}
        ${x.plain ? quote('Text of the rule', `<p>${esc(x.text)}</p>`) : ''}</div>`).join('')}
        ${model.machinery ? `<div class="sr-prov"><div class="sr-kind">${esc(KIND['amendment-machinery'])}<span class="sr-sec">Sec. ${model.machinery.secs.join(', ')}</span></div><div class="sr-plain">${esc(model.machinery.plain || '')}</div></div>` : ''}</div>`);
    }
    return parts.join('');
  }


  // The "Text of the rule" and "What those clauses say" drops ease open and shut (0.28 s; none under reduced motion). The details element opens at once and closes at once, so the click is
  // taken over: the chevron turns with `is-open`, the body's height animates, and `open` is set before opening and removed after closing.
  function wire(rootEl) {
    if (!rootEl || rootEl.__srWired) return;
    rootEl.__srWired = true;
    rootEl.addEventListener('click', (e) => {
      const sum = e.target.closest && e.target.closest('.sr-quote > summary');
      if (!sum || !rootEl.contains(sum)) return;
      e.preventDefault();
      const d = sum.parentElement; const body = d.querySelector('.sr-quote-body');
      const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (d.__anim) d.__anim.cancel();
      const opening = !d.classList.contains('is-open');
      if (calm || !body.animate) { d.open = opening; d.classList.toggle('is-open', opening); return; }
      d.classList.toggle('is-open', opening);
      if (opening) d.open = true;
      const full = body.getBoundingClientRect().height;
      const from = opening ? 0 : full; const to = opening ? full : 0;
      body.style.overflow = 'hidden';
      const cs = getComputedStyle(body); const pad = `${cs.paddingTop}`; const box = (h, p, o) => ({ height: h + 'px', paddingTop: p, paddingBottom: p, opacity: o });
      const a = d.__anim = body.animate(opening ? [box(0, '0px', 0), box(full, pad, 1)] : [box(full, pad, 1), box(0, '0px', 0)], { duration: 280, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
      const done = () => { d.__anim = null; body.style.overflow = ''; if (!opening) d.open = false; };
      a.onfinish = done; a.oncancel = () => { body.style.overflow = ''; };
    });
  }

  root.SpecialRuleModel = { build, html, wire, fmt, KIND };
})(typeof globalThis !== 'undefined' ? globalThis : this);
