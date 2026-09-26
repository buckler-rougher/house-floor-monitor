// Senate board. Scaffold.
//
// Deliberately not app.js. That file is 12,000 lines built around the House
// Clerk's feed, its caption track and a DOM this document does not have, so
// loading it here would throw on the first missing element and fire a dozen
// requests for House data. The shared layer is the STYLESHEET, which is the part
// that actually wants to stay identical.
//
// What is real here: the roll call list, proxied through the same Worker the
// House board uses. What is not: everything that needs a live feed, which is
// waiting on dev/senate-rollcall-probe.mjs to report whether one exists.

const API = 'https://api.evanhollander.org/senate-floor/api';

// ── Clocks ───────────────────────────────────────────────────────────────────
// 24-hour with seconds, matching the House board's clock trio. Always pinned to
// en-US: passing no locale lets the shape change with the viewer's machine,
// which is how a time once rendered differently abroad than it did in review.
const CLOCKS = [
  ['clock-local', undefined],
  ['clock-dc',    'America/New_York'],
  ['clock-utc',   'UTC'],
];

function tickClocks() {
  const now = new Date();
  for (const [id, timeZone] of CLOCKS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = now.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, ...(timeZone ? { timeZone } : {}),
    });
  }
}

function setToday() {
  const el = document.getElementById('today-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'America/New_York',
  });
}

// ── Roll call votes ──────────────────────────────────────────────────────────
// The Senate's summary list is day-granular and carries no time, and each vote's
// own file shows how far behind the record runs: vote 244 of 24 Sep is stamped
// 13:45 and was last modified 15:05. So this is the record catching up, not a
// live tally, and the panel is labelled to match.
function renderVotes(payload) {
  const feed = document.getElementById('senate-votes-feed');
  const stamp = document.getElementById('senate-votes-updated');
  if (!feed) return;

  const votes = payload?.votes || [];
  if (!votes.length) {
    feed.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'proceedings-item';
    row.textContent = 'No roll call votes recorded for this session yet.';
    feed.appendChild(row);
    return;
  }

  feed.innerHTML = '';
  for (const v of votes.slice(0, 25)) {
    const row = document.createElement('div');
    row.className = 'proceedings-item';

    const num = document.createElement('span');
    num.className = 'proceedings-time';
    // Trailing space: the two spans are adjacent, so without it the roll number
    // runs straight into the measure -- "244H.Con.Res. 89".
    num.textContent = `${v.date} \u00b7 ${v.number} `;

    // textContent throughout: every field here is remote text from senate.gov.
    const body = document.createElement('span');
    body.className = 'proceedings-text';
    const bits = [];
    if (v.issue) bits.push(`${v.issue}:`);
    if (v.question) bits.push(v.question);
    if (v.yeas != null && v.nays != null) bits.push(`${v.yeas}-${v.nays}`);
    if (v.result) bits.push(`(${v.result})`);
    body.textContent = bits.join(' ');

    row.append(num, body);
    feed.appendChild(row);
  }
  if (stamp && payload?.congress) {
    stamp.textContent = `${payload.congress}th Congress, session ${payload.session}`;
  }
}

async function loadVotes() {
  const feed = document.getElementById('senate-votes-feed');
  try {
    const r = await fetch(`${API}/senate/votes`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    renderVotes(await r.json());
  } catch (e) {
    if (!feed) return;
    feed.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'proceedings-item';
    // Say which source failed. A bare "unavailable" sends the reader looking in
    // the wrong place, and this board has two upstreams that fail differently.
    row.textContent = `Roll call list unavailable (${e.message}).`;
    feed.appendChild(row);
  }
}

setToday();
tickClocks();
setInterval(tickClocks, 1000);
loadVotes();
// The record updates in minutes to hours, never seconds, so this is a slow poll
// on purpose. See the modify_date note above.
setInterval(loadVotes, 5 * 60 * 1000);
