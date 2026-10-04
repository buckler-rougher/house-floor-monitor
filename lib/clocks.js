/**
 * The header clock faces, shared by the House and Senate boards.
 *
 * WHY THIS FILE EXISTS
 * The Senate board is the House page adapted, so it inherits the same three
 * <svg class="analog-clock"> faces. Those faces are empty in the markup: the
 * sixty tick marks on each are generated here, and the hands are positioned
 * here. A board that draws its own readouts but never calls initAnalogClocks()
 * gets three blank circles with hands frozen wherever the markup left them,
 * which is exactly what the Senate board showed until this was pulled out.
 *
 * Reimplementing it on the second board was the obvious wrong answer: the tick
 * geometry, the two stroke weights and the two opacities all have to agree
 * between the boards or the faces do not match, and nothing would have caught
 * them drifting.
 *
 * LOADING
 * No `export` syntax on purpose, matching lib/bill-id.js: it assigns to
 * globalThis so a plain <script> tag serves every consumer.
 */
(function (root) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Draw the tick marks into each face. Idempotent: a face that already has
   * ticks is left alone, so calling this twice does not double them up.
   */
  function initAnalogClocks(ids = ['local', 'dc', 'utc']) {
    ids.forEach((id) => {
      const svg = document.getElementById(`${id}-analog`);
      if (!svg) return;
      const ticks = svg.querySelector('.clock-ticks');
      if (!ticks || ticks.childNodes.length) return;
      for (let i = 0; i < 60; i++) {
        const isHour = i % 5 === 0;
        const rad = (i * 6 - 90) * Math.PI / 180;
        const outer = 44;
        const inner = isHour ? 36 : 40;
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', (50 + outer * Math.cos(rad)).toFixed(2));
        line.setAttribute('y1', (50 + outer * Math.sin(rad)).toFixed(2));
        line.setAttribute('x2', (50 + inner * Math.cos(rad)).toFixed(2));
        line.setAttribute('y2', (50 + inner * Math.sin(rad)).toFixed(2));
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('stroke', isHour ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.2)');
        line.setAttribute('stroke-width', isHour ? '2' : '0.8');
        ticks.appendChild(line);
      }
    });
  }

  /** Point the hands. `time` is {hours, minutes, seconds} in the face's own zone. */
  function updateAnalogClock(clockElement, time) {
    if (!clockElement) return;
    const hourDeg = ((time.hours % 12) * 30) + (time.minutes * 0.5);
    const minuteDeg = (time.minutes * 6) + (time.seconds * 0.1);
    const secondDeg = time.seconds * 6;
    clockElement.querySelector('.hour-hand')?.setAttribute('transform', `rotate(${hourDeg.toFixed(2)},50,50)`);
    clockElement.querySelector('.minute-hand')?.setAttribute('transform', `rotate(${minuteDeg.toFixed(2)},50,50)`);
    clockElement.querySelector('.second-hand')?.setAttribute('transform', `rotate(${secondDeg.toFixed(2)},50,50)`);
  }

  /**
   * What a zone is actually showing right now. Intl is asked rather than an
   * offset applied, because it knows when the zone is on daylight time and
   * arithmetic on a fixed offset does not.
   */
  function getTimeParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
    }).formatToParts(date);
    const v = (t) => Number(parts.find((p) => p.type === t).value);
    return { hours: v('hour'), minutes: v('minute'), seconds: v('second') };
  }

  // The header's three readouts (local, Washington, UTC) and their three faces, in one call.
  // Both boards ran this block every second, written out twice. `targets` is the elements:
  //   { local, dc, utc, localAnalog, dcAnalog, utcAnalog }, any of which may be missing.
  // 24-hour with seconds, pinned to en-US so the shape cannot change with the viewer's machine.
  function tick(targets, now = new Date()) {
    const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const set = (node, o) => { if (node) node.textContent = now.toLocaleTimeString('en-US', o); };
    set(targets.local, opts);
    set(targets.dc, { ...opts, timeZone: 'America/New_York' });
    set(targets.utc, { ...opts, timeZone: 'UTC' });
    if (targets.localAnalog) updateAnalogClock(targets.localAnalog, { hours: now.getHours(), minutes: now.getMinutes(), seconds: now.getSeconds() });
    if (targets.dcAnalog) updateAnalogClock(targets.dcAnalog, getTimeParts(now, 'America/New_York'));
    if (targets.utcAnalog) updateAnalogClock(targets.utcAnalog, getTimeParts(now, 'UTC'));
  }

  root.BoardClocks = { initAnalogClocks, updateAnalogClock, getTimeParts, tick };
})(typeof globalThis !== 'undefined' ? globalThis : this);
