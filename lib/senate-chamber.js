// The Senate chamber floor, drawn from the real desk assignments.
//
// Not the House board's arch. That is built for 435 members with no assigned
// seats, and says so on the panel. The Senate assigns desks and publishes which
// member sits at which, so this draws the actual chamber: Democrats to the
// left of the aisle, Republicans to the right, three wedges a side and four
// rows deep, exactly as the Curator's own map shows it.
//
// The published data gives each desk its PLACE -- side, section, row, order --
// rather than coordinates, because the Senate's own renderer used a Flash
// floorplan that no longer exists. So the arc is computed here from that
// structure: section is an angular wedge, row is a ring, order is the position
// along the ring.

(() => {
  let _seats = [];
  let _deps = {};
  let _byLast = new Map();

  const fold = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  // Each side sweeps from the centre aisle outwards. The aisle gap is real: the
  // two parties do not meet in the middle of the chamber and the map shows the
  // well between them.
  const AISLE = 7;      // degrees of clear space either side of centre
  const SPREAD = 76;    // degrees each side occupies

  function layout(seats) {
    const sides = {};
    for (const s of seats) {
      (sides[s.side] ||= {})[s.section] ||= {};
      ((sides[s.side][s.section])[s.row] ||= []).push(s);
    }
    const out = [];
    for (const [side, sections] of Object.entries(sides)) {
      if (side === 'center') continue;          // the rostrum, not members
      const keys = Object.keys(sections).map(Number).sort((a, b) => a - b);
      const rows = Math.max(...Object.values(sections).flatMap((sec) => Object.keys(sec).map(Number)));
      for (const sec of keys) {
        // Wedges run from the aisle outwards, so section 0 sits nearest the
        // centre on both sides and the two parties mirror each other.
        const w = SPREAD / keys.length;
        const from = AISLE + sec * w;
        const to = from + w * 0.92;             // a sliver between wedges
        for (const [rowStr, list] of Object.entries(sections[sec])) {
          const row = Number(rowStr);
          list.sort((a, b) => a.order - b.order);
          // Row 1 is the front, nearest the rostrum, and row 4 the back wall.
          // Expressed as a fraction of the full depth so the ring spacing does
          // not depend on how many rows a section happens to have.
          const depth = 0.45 + 0.55 * (row - 1) / Math.max(1, rows - 1);
          list.forEach((seat, i) => {
            const t = list.length === 1 ? 0.5 : i / (list.length - 1);
            const deg = from + (to - from) * t;
            // Left side mirrors: 180 degrees is the far left, 0 the far right.
            const a = (side === 'left' ? 180 - deg : deg) * Math.PI / 180;
            // Separate radii: the panel is wider than it is tall, so one radius
            // either ran the back rows off the sides or squashed the arc flat.
            out.push({
              ...seat,
              x: 50 + Math.cos(a) * 44 * depth,
              y: 92 - Math.sin(a) * 72 * depth,
            });
          });
        }
      }
    }
    return out;
  }

  function render() {
    const host = document.getElementById('floor-arch');
    if (!host || !_seats.length) return;
    host.querySelectorAll('.sen-desk').forEach((n) => n.remove());
    for (const s of layout(_seats)) {
      const el = document.createElement('div');
      el.className = 'sen-desk';
      el.dataset.last = fold(s.last);
      el.dataset.party = s.party || 'I';
      el.style.left = `${s.x}%`;
      el.style.top = `${s.y}%`;
      el.title = `Desk ${s.desk} — ${s.name} (${s.party}-${s.state})`;
      host.appendChild(el);
      _byLast.set(fold(s.last), el);
    }
    apply();
  }

  // The board and the floor show the same roll, so they take the same marks.
  let _state = { called: new Set(), votes: new Map() };
  function apply() {
    for (const [key, el] of _byLast) {
      el.classList.toggle('is-called', _state.called.has(key) || _state.votes.has(key));
      el.classList.remove('is-aye', 'is-no', 'is-present');
      const v = _state.votes.get(key);
      if (v) el.classList.add(v === 'NO' ? 'is-no' : v === 'PRESENT' ? 'is-present' : 'is-aye');
    }
  }

  function setState(called, votes) {
    _state = { called: called || new Set(), votes: votes || new Map() };
    apply();
  }

  async function init(deps) {
    _deps = deps || {};
    try {
      const r = await fetch(`${_deps.api}/senate/desks`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      _seats = d.seats || [];
      render();
    } catch (e) {
      console.error('Desk map unavailable:', e);
    }
  }

  globalThis.SenateChamber = { init, setState, render };
})();
