#!/usr/bin/env node
//
// Regression test for the vote-series parser (parseVoteItemsFromHtml in app.js).
//
// WHY THIS EXISTS
// The Democratic Whip's floor notices are hand-written HTML and their shape varies
// constantly. Every vote-timeline bug we have hit came from the parser meeting a real
// notice shape it had not seen — the sentence introducing the next vote glued inside
// the previous <li>, a scheduling paragraph that names a bill, a "Next votes predicted"
// line. Each one silently added or dropped a vote on the live site.
//
// The notices in notices.json are VERBATIM bodies captured from the Whip's public feed,
// including the awkward ones. Run this before deploying a parser change.
//
//   npm test
//
// No network and no dependencies: the bodies are frozen on disk, and the DOM shim below
// covers the handful of DOM calls the parser makes.
//
// UPDATING: to add a case, append to notices.json — capture the body verbatim from
// https://firestore.googleapis.com/v1/projects/pacific-castle-135023/databases/(default)/documents:runQuery
// (collection ActivityFeeds, Office.id C001101; no auth, it is a public feed). Only add
// an expectation you have checked by hand: for a "Floor Update – N Votes" notice the row
// count must equal the N in its own title, which is what checkDeclaredCounts() enforces.

const fs = require('fs');
const path = require('path');

// ── Minimal DOM ──────────────────────────────────────────────────────────────
// parseVoteItemsFromHtml touches exactly: document.createElement('div'), .innerHTML,
// .querySelectorAll('p, li'), and each element's .textContent / .tagName.
// Verified against the captured corpus: no notice nests one list inside another, and
// &nbsp; is the only HTML entity the Whip's editor emits.
// Note <br> contributes NO text in a real browser, so tags are dropped without inserting
// a separator — that is why bodies read "…15 minutesFollowing this vote…", which the
// parser has to cope with.
const decodeEntities = s => s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '’')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

global.document = {
    createElement: () => ({
        _html: '',
        set innerHTML(h) { this._html = h; },
        get innerHTML() { return this._html; },
        querySelectorAll(selector) {
            const tags = selector.split(',').map(s => s.trim());
            const re = new RegExp(`<(${tags.join('|')})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi');
            const out = [];
            let m;
            while ((m = re.exec(this._html)) !== null) {
                out.push({
                    tagName: m[1].toUpperCase(),
                    textContent: decodeEntities(m[2].replace(/<[^>]+>/g, '')),
                });
            }
            return out;
        },
    }),
};

// ── Pull the functions under test straight out of app.js ─────────────────────
// app.js is one large browser script with no module exports, so the functions are
// extracted by name rather than required. Nothing in app.js changes for the test.
const APP = path.join(__dirname, '..', 'app.js');
const source = fs.readFileSync(APP, 'utf8');

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`${name}() not found in app.js — was it renamed?`);
    let depth = 0, i = source.indexOf('{', start);
    for (; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) break;
    }
    if (depth !== 0) throw new Error(`could not find the end of ${name}() in app.js`);
    return source.slice(start, i + 1);
}

const parseVoteItemsFromHtml = new Function(
    'resolveAmendmentVoteEntry',
    `${extractFunction('amendmentSponsorKey')}
     ${extractFunction('parseVoteItemsFromHtml')}
     return parseVoteItemsFromHtml;`
)(
    // Amendment outcomes come from live vote data, which a parse test has none of.
    // Returning null exercises the "amendment item, no result yet" path.
    () => null
);

// ── Comparison ───────────────────────────────────────────────────────────────
// The row shape compared, and the text normalizer. Truncation happens BEFORE the final
// trim so that re-normalizing an already-stored expectation is a no-op — otherwise a
// stored value whose 60th character is a space compares unequal to the same value
// freshly computed.
const normText = s => (s || '').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
const row = v => ({
    billId: v.billId ?? null,
    action: v.action ?? null,
    duration: v.duration ?? null,
    text: normText(v.text),
});
const same = (a, b) => a.billId === b.billId && a.action === b.action
                    && a.duration === b.duration && a.text === b.text;
const show = r => `${r.billId || '(no bill)'} | ${r.action || '(no action)'} | ${r.duration || '—'} | ${r.text}`;

// ── Run ──────────────────────────────────────────────────────────────────────
const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'notices.json'), 'utf8'));

let failed = 0;
for (const c of cases) {
    const label = `${c.publishedAt.slice(0, 16)}  ${c.title}`;
    let got;
    try {
        got = parseVoteItemsFromHtml(c.body).map(row);
    } catch (err) {
        console.log(`FAIL  ${label}\n      threw: ${err.message}`);
        failed++;
        continue;
    }
    const want = c.expected.map(row);
    const ok = got.length === want.length && want.every((w, i) => same(w, got[i]));
    if (ok) { console.log(`pass  ${label}  (${got.length} votes)`); continue; }
    failed++;
    console.log(`FAIL  ${label}`);
    console.log(`      ${c.note}`);
    console.log(`      expected ${want.length} vote(s), got ${got.length}`);
    for (let i = 0; i < Math.max(want.length, got.length); i++) {
        const w = want[i], g = got[i];
        const flag = w && g && same(w, g) ? '   ' : ' ! ';
        console.log(`      ${flag}want: ${w ? show(w) : '(nothing)'}`);
        console.log(`      ${flag} got: ${g ? show(g) : '(nothing)'}`);
    }
}

// A "Floor Update – N Votes" notice states its own vote count, which is an independent
// check on the expectations themselves: it catches an expectation blessed from buggy
// output. Only a notice whose own text is wrong may disagree, and it must say why.
function checkDeclaredCounts() {
    const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    let bad = 0;
    for (const c of cases) {
        const m = c.title.match(/[–\-]\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*votes?/i);
        if (!m) continue;
        const declared = parseInt(m[1], 10) || WORDS[m[1].toLowerCase()];
        if (c.expected.length === declared) continue;
        if (/typo/i.test(c.note)) {
            console.log(`note  ${c.publishedAt.slice(0, 16)}  expects ${c.expected.length} for a "${declared} Votes" title — ${c.note}`);
            continue;
        }
        console.log(`FAIL  ${c.publishedAt.slice(0, 16)}  expectation says ${c.expected.length} votes but the notice title declares ${declared}`);
        bad++;
    }
    return bad;
}
failed += checkDeclaredCounts();

const rows = cases.reduce((n, c) => n + c.expected.length, 0);
console.log(`\n${cases.length} notices, ${rows} vote rows — ${failed ? `${failed} FAILING` : 'all passing'}`);
process.exit(failed ? 1 : 0);
