// Committee marks and chips: the little seal-or-monogram + name tags that say which committee a bill
// is in, and how it was reported out.
//
// Shared by both boards. This was the House board's own code (app.js) and the Senate's bill modal
// had no committee detail at all; the chips already knew about Senate committees (a Senate
// systemCode or chamber gives no House seal and an "is-senate" class), so the move was mostly a
// matter of getting it out of one page's script.
//
//   Committees.committeeChipHtml(committee, extraHtml)   // one chip; extraHtml rides inside it
//   Committees.reportChipHtml('Reported by Committee 34 – 12')   // the tally or label for the
//                                                        // reporting committee, or '' for none
//   Committees.committeeMark(committee)                  // { abbr, color, chamber, name, logo }
//
// `committee` is an object { name, chamber, systemCode } or, from cached bills that predate the
// chamber, a plain name.

(() => {
  const { escapeHtml } = globalThis.BoardUtil;

// ── Committee marks ────────────────────────────────────────────────────────
  //
  // The committees have no usable logos. Wikimedia has no systematic collection of
  // their seals; the committee websites sit on four different content systems with
  // hand-rolled icon paths, half of which 404, several of which encode an upload
  // date that will rot, and a number of which resolve to majority-party theme art
  // rather than an institutional seal — Judiciary's lives under
  // republicans-judiciary.house.gov, and Foreign Affairs and Rules point at the
  // same shared party file. Hotlinking that would put partisan branding on the page
  // and break every reorganisation.
  //
  // So the mark is ours: a monogram in a fixed colour, one per committee. It is
  // stable, it is legible at 20px, it belongs to no party, and nothing external can
  // take it away.
  //
  // The table covers the standing committees of the House, which is what a House
  // floor monitor is mostly showing. Everything else — Senate committees on bills
  // referred in both chambers, select and joint committees, anything created after
  // this was written — falls through to a derivation from the name, so an unknown
  // committee gets a sensible mark instead of nothing.
  const COMMITTEE_MARKS = {
      'agriculture':                        ['AG', '#4d7c0f'],
      'appropriations':                     ['AP', '#0e7490'],
      'armed services':                     ['AS', '#7c2d12'],
      'budget':                             ['BU', '#1d4ed8'],
      'education and workforce':            ['ED', '#a16207'],
      'energy and commerce':                ['EC', '#b45309'],
      'ethics':                             ['ET', '#57534e'],
      'financial services':                 ['FS', '#047857'],
      'foreign affairs':                    ['FA', '#1e40af'],
      'homeland security':                  ['HS', '#0f766e'],
      'house administration':               ['HA', '#6d28d9'],
      'intelligence':                       ['IC', '#334155'],
      'judiciary':                          ['JU', '#9333ea'],
      'natural resources':                  ['NR', '#15803d'],
      'oversight and government reform':    ['OV', '#be123c'],
      'rules':                              ['RU', '#7e22ce'],
      'science space and technology':       ['SC', '#0369a1'],
      'small business':                     ['SB', '#c2410c'],
      'transportation and infrastructure':  ['TI', '#b91c1c'],
      'veterans affairs':                   ['VA', '#1e3a8a'],
      'ways and means':                     ['WM', '#065f46'],

      // The Senate committees that actually turn up here, because a bill referred in
      // both chambers carries both. Curated rather than derived for the same reason
      // as above — derivation gave the Senate's Homeland Security and Governmental
      // Affairs the same HS as the House's Homeland Security, and handed three
      // unrelated committees the same colour.
      'commerce science and transportation':       ['CS', '#0e7490'],
      'energy and natural resources':              ['EN', '#166534'],
      'health education labor and pensions':       ['HE', '#7c3aed'],
      'homeland security and governmental affairs':['HG', '#0d9488'],
      'indian affairs':                            ['IA', '#92400e'],
      'small business and entrepreneurship':       ['SE', '#c2410c'],
      'agriculture nutrition and forestry':        ['AN', '#4d7c0f'],
      'banking housing and urban affairs':         ['BK', '#1e40af'],
      'environment and public works':              ['EP', '#047857'],
      'finance':                                   ['FI', '#065f46'],
      'foreign relations':                         ['FR', '#1e3a8a'],
      'rules and administration':                  ['RA', '#7e22ce'],
  };

  // The logos themselves, committed to the repo rather than hotlinked. Harvested
  // once: hotlinking the committees' own sites would have meant four different
  // content systems, paths encoding upload dates like /2024/05/, and a page that
  // breaks on somebody else's redesign. 152K for the set.
  //
  // Most keep their transparency: a seal is a filled circle and belongs on the chip
  // itself, not in a white box. Only three — Armed Services, Natural Resources and
  // Science — are sparse dark line art that would disappear against the card, and
  // those carry a light ground. Decided per file by measuring it rather than by eye.
  //
  // Rendered from vector where a vector exists — Ways and Means' Commons SVG,
  // Agriculture's own logo-2023.svg — at build time rather than shipped as SVG:
  // the Ways and Means file alone is 181K against 6K for the raster, and at the
  // 22px these display at, nothing on screen can tell the difference. The whole
  // set is 112K.
  //
  // Sixteen come from the committee's own site. Three come from Wikimedia instead,
  // because what their own site serves is not a committee mark and Wikimedia holds
  // the institutional seal:
  //   homeland security — its own art reads "HOMELAND SECURITY REPUBLICANS"
  //   ways and means    — its own seal's ring names the sitting chairman; the
  //                       Commons SVG is the plain one, "1789" and nothing else
  //   rules             — its own site serves the shared CMS default, a file
  //                       byte-identical to Foreign Affairs', so a platform icon
  //
  // Wikimedia is not a general answer, which is why it is three and not twenty-one.
  // Only 7 of the 21 House committees have any committee-specific image there at
  // all; the other 14 articles illustrate with the generic seal of the House, which
  // would put the same picture on every chip. And it needs the same judgement:
  // Appropriations' Wikipedia logo is a wordmark reading "CHAIRMAN TOM COLE", so
  // that one keeps the seal off its own site. Resolving these at runtime would
  // therefore not make them self-maintaining, it would just move the wrong picture
  // to wherever an editor put it.
  //
  // Two of the site-sourced ones needed digging past the favicon, which is where
  // this started and is only ever 32 or 48 pixels: Appropriations publishes its
  // seal at 1113px as logosealpng_0.png, and Agriculture's icon cluster comes out
  // of the vector lockup — cropped away from the wordmark beside it, which reads
  // "CHAIRMAN GT THOMPSON".
  //
  // Two still have no usable mark and keep the monogram, which belongs to nobody:
  //   foreign affairs — the shared CMS default again
  //   transportation  — declares no icon at all
  const COMMITTEE_LOGOS = {
      'agriculture':                       'agriculture',
      'appropriations':                    'appropriations',
      'armed services':                    'armed-services',
      'budget':                            'budget',
      'education and workforce':           'education-workforce',
      'energy and commerce':               'energy-commerce',
      'ethics':                            'ethics',
      'financial services':                'financial-services',
      'house administration':              'house-administration',
      'intelligence':                      'intelligence',
      'judiciary':                         'judiciary',
      'natural resources':                 'natural-resources',
      'oversight and government reform':   'oversight',
      'science space and technology':      'science',
      'small business':                    'small-business',
      'veterans affairs':                  'veterans-affairs',
      // From Wikimedia — see above.
      'homeland security':                 'homeland-security',
      'rules':                             'rules',
      'ways and means':                    'ways-and-means',
  };

  // Fallback palette, picked for contrast against the card background rather than
  // for variety — an unknown committee still has to be readable.
  const COMMITTEE_FALLBACK_COLORS = [
      '#475569', '#7c3aed', '#0891b2', '#c2410c', '#15803d',
      '#be123c', '#1d4ed8', '#a16207', '#0f766e', '#9333ea',
  ];

  // "Committee on House Administration", "Ways and Means Committee" and
  // "Education and Workforce Committee" are the same shape of thing wearing three
  // different word orders. Strip the furniture and compare what is left.
  function committeeKey(name) {
      return String(name || '')
          .toLowerCase()
          .replace(/^(?:the\s+)?(?:house|senate|joint)\s+/, '')
          .replace(/^committee\s+on\s+(?:the\s+)?/, '')
          .replace(/\s+committee$/, '')
          .replace(/\bpermanent\s+select\b/, '')
          .replace(/[.,'\u2019]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
  }

  function committeeMark(committee) {
      // Cached bills from before the worker started sending the chamber hold plain
      // strings, and they keep working — just without the chamber.
      const name = typeof committee === 'string' ? committee : (committee && committee.name) || '';
      const sys = typeof committee === 'object' && committee ? committee.systemCode : null;
      let chamber = typeof committee === 'object' && committee ? committee.chamber : null;
      // systemCode is the reliable one: hsju00 is House Judiciary, ssju00 the Senate's.
      if (!chamber && sys) chamber = sys[0] === 's' ? 'Senate' : sys[0] === 'h' ? 'House' : null;

      const key = committeeKey(name);
      // Only for House committees: these are the House's marks, and both chambers
      // have a Judiciary, a Rules, an Agriculture and an Armed Services.
      const logo = chamber !== 'Senate' ? COMMITTEE_LOGOS[key] : null;
      const known = COMMITTEE_MARKS[key];
      if (known) return { abbr: known[0], color: known[1], chamber, name, logo };

      // Initials of the words that carry meaning. "Commerce, Science, and
      // Transportation" -> CS, "Indian Affairs" -> IA.
      const words = key.split(' ').filter((w) => w.length > 2 && !['and', 'the', 'for', 'of'].includes(w));
      const abbr = (words.length >= 2 ? words[0][0] + words[1][0] : (key.slice(0, 2) || '??')).toUpperCase();
      let h = 0;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
      return { abbr, color: COMMITTEE_FALLBACK_COLORS[h % COMMITTEE_FALLBACK_COLORS.length], chamber, name, logo };
  }

  // One chip: the mark, the committee's name, and for the reporting committee the
  // vote it was reported out on.
  function committeeChipHtml(committee, extraHtml) {
      const m = committeeMark(committee);
      const full = [m.chamber ? m.chamber + ' ' : '', /committee/i.test(m.name) ? m.name : m.name + ' Committee']
          .join('').trim();
      const senate = m.chamber === 'Senate' ? ' is-senate' : '';
      // Set on the chip, not the mark: the chip's left edge takes the colour too, and
      // a custom property only travels downwards.
      // The seal where there is one, the monogram where there is not. onerror falls
      // back rather than leaving a hole, so a missing file degrades to the letters.
      const mark = m.logo
          ? `<img class="committee-chip-logo" src="committees/${m.logo}.png" alt="" ` +
            `onerror="this.replaceWith(Object.assign(document.createElement('span'),` +
            `{className:'committee-chip-mark',textContent:${JSON.stringify(m.abbr)}}))">`
          : `<span class="committee-chip-mark" aria-hidden="true">${escapeHtml(m.abbr)}</span>`;
      return `<span class="bill-modal-committee${senate}" style="--mark:${m.color}" title="${escapeHtml(full)}">` +
          mark +
          `<span class="committee-chip-name">${escapeHtml(m.name)}</span>${extraHtml || ''}</span>`;
  }

  // The reporting committee's vote, as the chip carries it: a green-ayes / red-nays tally when the
  // text has one, otherwise how it was reported (unanimous consent, voice vote, or just Reported).
  function reportChipHtml(committeeReport) {
    if (!committeeReport) return '';
    const m = committeeReport.match(/(\d+)\s*[–-]\s*(\d+)/);
    if (m) {
      return `<span class="committee-chip-tally"><b class="ct-aye">${m[1]}</b><span class="ct-sep">–</span><b class="ct-nay">${m[2]}</b></span>`;
    }
    const label = /unanimous consent/i.test(committeeReport) ? 'Unanimous Consent'
      : /voice vote/i.test(committeeReport) ? 'Voice Vote'
      : escapeHtml(committeeReport.replace(/^reported( by committee)?\s*/i, '') || 'Reported');
    return `<span class="committee-chip-tally committee-chip-tally-text">${label}</span>`;
  }

  globalThis.Committees = { COMMITTEE_MARKS, COMMITTEE_LOGOS, committeeKey, committeeMark, committeeChipHtml, reportChipHtml };
})();
