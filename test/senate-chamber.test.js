#!/usr/bin/env node
//
// Contract test for lib/senate-chamber.js -- where each Senate desk goes on the
// floor map, and which way it faces.
//
// WHY THIS EXISTS
// The map was first drawn with desks as unturned rectangles, and desks at the ends
// of neighbouring wedges overlapped. The layout is a pure function of the panel's
// pixel size so that can be measured instead of eyeballed: every desk is a rotated
// rectangle, and no two may touch, at the sizes the panel really takes (it is not a
// fixed shape: 380 tall on a wide screen, 260 on a phone). The seats are the Senate's
// own published floorplan, saved verbatim. No network, no dependencies.
//
//   npm test

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../lib/senate-chamber.js');
const D = require('../lib/senate-desks.js');

const seats = D.parseSeats(fs.readFileSync(path.join(__dirname, 'senate-desks-plan.xml'), 'utf8'));
// The panel's real shapes: wide screen, the narrower tablet, a phone.
const SIZES = [[760, 380], [600, 380], [522, 260], [400, 260], [340, 260]];

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

// The four corners of a desk, in pixels, after its turn.
function corners(p, w, h) {
  const cx = p.x * w / 100, cy = p.y * h / 100, a = p.angle * Math.PI / 180;
  const ux = Math.cos(a), uy = Math.sin(a);
  const hw = p.dw / 2, hh = p.dh / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [cx + x * ux - y * uy, cy + x * uy + y * ux]);
}
// Separating-axis test on two convex quadrilaterals. `gap` pixels of clear space are required.
function overlap(A, B, gap) {
  for (const poly of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % 4];
      const nx = y1 - y2, ny = x2 - x1, len = Math.hypot(nx, ny);
      const proj = (P) => P.map(([x, y]) => (x * nx + y * ny) / len);
      const a = proj(A), b = proj(B);
      if (Math.max(...a) + gap <= Math.min(...b) || Math.max(...b) + gap <= Math.min(...a)) return false;
    }
  }
  return true;
}

test('every desk but the rostrum is placed', () => {
  const placed = C.place(seats, 760, 380);
  assert.strictEqual(placed.length, seats.filter((s) => s.side !== 'center').length);
  assert.strictEqual(placed.length, 100);
});

for (const [w, h] of SIZES) {
  test(`no two desks overlap at ${w} x ${h}`, () => {
    const placed = C.place(seats, w, h);
    const polys = placed.map((p) => corners(p, w, h));
    const clash = [];
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        // Cheap reject first: centres further apart than the desk's diagonal cannot touch.
        const d = Math.hypot((placed[i].x - placed[j].x) * w / 100, (placed[i].y - placed[j].y) * h / 100);
        if (d > 3 * placed[i].dw) continue;
        if (overlap(polys[i], polys[j], 1)) clash.push(`${placed[i].last}/${placed[j].last}`);
      }
    }
    assert.deepStrictEqual(clash, []);
  });

  test(`every desk is inside the panel at ${w} x ${h}`, () => {
    for (const p of C.place(seats, w, h)) {
      for (const [x, y] of corners(p, w, h)) {
        assert.ok(x >= 0 && x <= w && y >= 0 && y <= h, `${p.last} corner ${x.toFixed(1)},${y.toFixed(1)}`);
      }
    }
  });
}

test('every desk faces the rostrum', () => {
  const w = 760, h = 380;
  for (const p of C.place(seats, w, h)) {
    // A desk's front is its bottom edge. After the turn, that edge's outward normal
    // must point at the rostrum.
    const a = (p.angle + 90) * Math.PI / 180;
    const fx = Math.cos(a), fy = Math.sin(a);
    const tx = (C.ROSTRUM.x - p.x) * w / 100, ty = (C.ROSTRUM.y - p.y) * h / 100, len = Math.hypot(tx, ty);
    const dot = (fx * tx + fy * ty) / len;
    assert.ok(dot > 0.999, `${p.last} faces ${Math.acos(Math.min(1, dot)) * 180 / Math.PI} degrees off`);
  }
});

test('each side\'s arcs start level with the rostrum, their ends in a line beside it', () => {
  const placed = C.place(seats, 760, 380);
  for (const side of ['left', 'right']) {
    const mine = placed.filter((p) => p.side === side);
    // The lowest desks on a side sit at the rostrum's own level, one per row.
    const lowest = mine.filter((p) => Math.abs(p.y - C.ROSTRUM.y) < 0.5);
    assert.strictEqual(new Set(lowest.map((p) => p.row)).size, 4, `${side}: an end desk in every row`);
    // ...and none dips below it.
    assert.ok(mine.every((p) => p.y <= C.ROSTRUM.y + 0.5), `${side}: nothing below the rostrum`);
  }
});

test('the end desks face straight across the chamber, and the top desks straight down', () => {
  const placed = C.place(seats, 760, 380);
  for (const p of placed.filter((q) => Math.abs(q.y - C.ROSTRUM.y) < 0.5)) {
    // Facing right (left side) is a quarter turn one way, facing left the other.
    const want = p.side === 'left' ? -90 : 90;
    assert.ok(Math.abs(p.angle - want) < 1, `${p.side} ${p.last}: ${p.angle.toFixed(1)}`);
  }
  // Toward the top the desks face nearly straight down, and the turn grows steadily
  // as the arc comes round to the ends: |turn| rises from the aisle to level.
  const right = placed.filter((q) => q.side === 'right').sort((a, b) => a.y - b.y);
  const third = Math.floor(right.length / 3);
  const mean = (l) => l.reduce((t, q) => t + Math.abs(q.angle), 0) / l.length;
  const topMean = mean(right.slice(0, third)), midMean = mean(right.slice(third, 2 * third)), lowMean = mean(right.slice(2 * third));
  assert.ok(topMean < 30, `top desks turn ${topMean.toFixed(1)} degrees on average, near straight down`);
  assert.ok(topMean < midMean && midMean < lowMean, `${topMean.toFixed(0)} < ${midMean.toFixed(0)} < ${lowMean.toFixed(0)}`);
});

test('the two sides mirror: a desk and its twin turn by opposite amounts', () => {
  const placed = C.place(seats, 760, 380);
  const left = placed.filter((p) => p.side === 'left'), right = placed.filter((p) => p.side === 'right');
  // The front-left and front-right extremes sit at equal distances from the aisle, so
  // the mean turn of each side is equal and opposite.
  const mean = (l) => l.reduce((s, p) => s + p.angle, 0) / l.length;
  assert.ok(mean(left) * mean(right) < 0, 'opposite signs');
});

test('the left side is the Democratic side and sits left of centre', () => {
  const placed = C.place(seats, 760, 380);
  assert.ok(placed.filter((p) => p.side === 'left').every((p) => p.x < 50));
  assert.ok(placed.filter((p) => p.side === 'right').every((p) => p.x > 50));
});

test('desks are as large as fit: bigger on a wide panel, smaller on a phone, within limits', () => {
  const size = (w, h) => C.place(seats, w, h)[0].dw;
  assert.ok(size(760, 380) > size(340, 260), `${size(760, 380)} vs ${size(340, 260)}`);
  for (const [w, h] of SIZES) { const d = size(w, h); assert.ok(d >= 6 && d <= 15, `${w}: ${d}`); }
  const p = C.place(seats, 522, 260)[0];
  assert.ok(p.dw > p.dh, 'wider than deep');
});

test('a phone-sized panel still gets desks big enough to see', () => {
  assert.ok(C.place(seats, 340, 260)[0].dw >= 6);
});

test('a desk keeps its member', () => {
  const placed = C.place(seats, 760, 380);
  const s = placed.find((p) => p.last === 'Schumer');
  assert.strictEqual(s.desk, 10);
  assert.strictEqual(s.state, 'NY');
});

console.log(`\n${n} passed`);
