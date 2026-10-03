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
//
// Each desk is turned to face the rostrum, as the chamber's are: the long edge is
// square to the line from the desk to the rostrum, so the rows read as arcs that
// close in on it. The turn is computed in PIXELS from the panel's real size (the
// panel is not a fixed shape: it is 380 tall on a wide screen and 260 on a phone), so
// the layout is redone whenever the panel resizes.


(() => {
  let _seats = [];
  let _deps = {};
  let _byLast = new Map();
  let _nodes = [];          // { seat, node }

  const fold = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

  // Each side sweeps from the centre aisle outwards. The aisle gap is real: the
  // two parties do not meet in the middle of the chamber and the map shows the
  // well between them.
  const AISLE = 7;      // degrees of clear space either side of centre
  const SPREAD = 76;    // degrees each side occupies

  // Where the arcs are centred, and where the desks face. Both are the rostrum, in
  // percent of the panel: the arcs close in on it and every desk is turned to it.
  const CENTER = { x: 50, y: 92 };
  const ROSTRUM = { x: 50, y: 98 };

  // A desk is a rectangle a little wider than deep. How big is decided by the layout,
  // not guessed: the largest desk at which no two touch on THIS panel, up to what a
  // laptop can use and down to what a phone can still show. A fixed size either
  // overlapped on a small panel or was needlessly small on a large one.
  const MAX_DESK = 15, MIN_DESK = 6, DESK_RATIO = 0.64, CLEAR = 1.5;

  // The four corners of a desk centred at (cx, cy) pixels and turned by `deg`.
  function corners(cx, cy, dw, dh, deg) {
    const a = deg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const x = sx * dw / 2, y = sy * dh / 2;
      return [cx + x * ux - y * uy, cy + x * uy + y * ux];
    });
  }

  // Separating-axis test: do two convex quadrilaterals come within `gap` pixels?
  function touching(A, B, gap) {
    for (const poly of [A, B]) {
      for (let i = 0; i < 4; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % 4];
        const nx = y1 - y2, ny = x2 - x1, len = Math.hypot(nx, ny);
        const proj = (P) => P.map(([x, y]) => (x * nx + y * ny) / len);
        const pa = proj(A), pb = proj(B);
        if (Math.max(...pa) + gap <= Math.min(...pb) || Math.max(...pb) + gap <= Math.min(...pa)) return false;
      }
    }
    return true;
  }

  function anyTouching(list, w, h, dw) {
    const dh = Math.round(dw * DESK_RATIO) || 1;
    const polys = list.map((p) => corners(p.x * w / 100, p.y * h / 100, dw, dh, p.angle));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const d = Math.hypot((list[i].x - list[j].x) * w / 100, (list[i].y - list[j].y) * h / 100);
        if (d > 2 * dw) continue;               // too far apart to touch
        if (touching(polys[i], polys[j], CLEAR)) return true;
      }
    }
    return false;
  }

  /**
   * Every desk's place on a panel `w` by `h` pixels: { ...seat, x, y, angle, dw, dh }
   * with x and y in percent of the panel and `angle` in degrees, the turn that puts
   * the desk's front toward the rostrum. Pure, so it can be tested without a page.
   */
  function place(seats, w, h) {
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
        // centre on both sides and the two parties mirror each other. A clear
        // gap is left between wedges: the real chamber has aisles there.
        const wedge = SPREAD / keys.length;
        const from = AISLE + sec * wedge;
        const span = wedge * 0.86;
        for (const [rowStr, list] of Object.entries(sections[sec])) {
          const row = Number(rowStr);
          list.sort((a, b) => a.order - b.order);
          // Row 1 is the front, nearest the rostrum, and the last row the back
          // wall. Expressed as a fraction of the full depth so the ring spacing
          // does not depend on how many rows a section happens to have.
          const depth = 0.6 + 0.4 * (row - 1) / Math.max(1, rows - 1);
          list.forEach((seat, i) => {
            // The middle of the seat's cell, not the edge of the wedge: seats put
            // at the wedge's ends sat a hair from the next wedge's and overlapped.
            const t = (i + 0.5) / list.length;
            const deg = from + span * t + (wedge - span) / 2;
            // Left side mirrors: 180 degrees is the far left, 0 the far right.
            const a = (side === 'left' ? 180 - deg : deg) * Math.PI / 180;
            // Separate radii: the panel is wider than it is tall, so one radius
            // either ran the back rows off the sides or squashed the arc flat.
            const x = CENTER.x + Math.cos(a) * 44 * depth;
            const y = CENTER.y - Math.sin(a) * 72 * depth;
            // Turn the desk so its front faces the rostrum. An unturned desk's
            // front is its bottom edge (pointing down the screen, 90 degrees), so
            // the turn is the direction to the rostrum less 90.
            const toward = Math.atan2((ROSTRUM.y - y) * h / 100, (ROSTRUM.x - x) * w / 100) * 180 / Math.PI;
            out.push({ ...seat, x, y, angle: toward - 90 });
          });
        }
      }
    }
    // The biggest desk that fits without touching another.
    let dw = MAX_DESK;
    while (dw > MIN_DESK && anyTouching(out, w, h, dw)) dw -= 1;
    const dh = Math.round(dw * DESK_RATIO);
    return out.map((p) => ({ ...p, dw, dh }));
  }

  // Create each desk once; position it, and reposition it when the panel changes.
  function render() {
    const host = document.getElementById('floor-arch');
    if (!host || !_seats.length) return;
    host.querySelectorAll('.sen-desk').forEach((n) => n.remove());
    _byLast = new Map();
    _nodes = [];
    for (const s of _seats.filter((x) => x.side !== 'center')) {
      const el = document.createElement('div');
      el.className = 'sen-desk';
      el.dataset.last = fold(s.last);
      el.dataset.party = s.party || 'I';
      el.title = `Desk ${s.desk} \u2014 ${s.name} (${s.party}-${s.state})`;
      host.appendChild(el);
      _byLast.set(fold(s.last), el);
      _nodes.push({ seat: s, node: el });
    }
    layout();
    apply();
  }

  function layout() {
    const host = document.getElementById('floor-arch');
    if (!host || !_nodes.length) return;
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const placed = place(_nodes.map((n) => n.seat), r.width, r.height);
    const at = new Map(placed.map((p) => [p.desk, p]));
    host.style.setProperty('--sen-desk-w', `${placed[0].dw}px`);
    host.style.setProperty('--sen-desk-h', `${placed[0].dh}px`);
    for (const { seat, node } of _nodes) {
      const p = at.get(seat.desk);
      if (!p) continue;
      node.style.left = `${p.x}%`;
      node.style.top = `${p.y}%`;
      node.style.transform = `rotate(${p.angle.toFixed(1)}deg)`;
    }
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
      // The panel changes shape between a laptop and a phone, and the turn of each
      // desk depends on the shape, so lay out again when it does.
      const host = document.getElementById('floor-arch');
      if (host && typeof ResizeObserver !== 'undefined') new ResizeObserver(() => layout()).observe(host);
    } catch (e) {
      console.error('Desk map unavailable:', e);
    }
  }

  globalThis.SenateChamber = { init, setState, render, place };
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.SenateChamber;
})();
