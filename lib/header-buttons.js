// The Time Machine and Suggestion Box buttons' hover (desktop, 1120px and wider; the drawn icons and styles are in styles.css under "THE HEADER BUTTONS").
//  - The clock rewinds for as long as the pointer is on the Time Machine button: the minute hand a turn every 1.6 s, the hour hand a twelfth of that. On leave the hands stop where they are and
//    never snap back, so each visit leaves the clock a little earlier.
//  - A small card under each button says what it does.
(function () {
  'use strict';
  const DESKTOP = 1120;
  const rb = document.getElementById('replay-btn'), sb = document.getElementById('suggest-fab');

  const clock = rb && rb.querySelector('.hb-ic');
  if (clock) {
    let m = 0, raf = 0, last = 0;
    const tick = (t) => {
      m -= (t - last) * 0.225; last = t;
      clock.style.setProperty('--m', m + 'deg');
      clock.style.setProperty('--h', (m / 12) + 'deg');
      raf = requestAnimationFrame(tick);
    };
    rb.addEventListener('mouseenter', () => { if (innerWidth < DESKTOP) return; cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(tick); });
    rb.addEventListener('mouseleave', () => cancelAnimationFrame(raf));
  }

  const tip = document.body.appendChild(document.createElement('div'));
  tip.className = 'hb-tip';
  tip.setAttribute('aria-hidden', 'true');
  [[rb, 'Time Machine', 'Replay the floor as it was on any past day.'], [sb, 'Suggestion Box', 'Something wrong or missing? Send a note.']].forEach(([b, title, text]) => {
    if (!b) return;
    b.addEventListener('mouseenter', () => {
      if (innerWidth < DESKTOP) return;
      const r = b.getBoundingClientRect();
      tip.innerHTML = '<b></b>';
      tip.firstChild.textContent = title;
      tip.appendChild(document.createTextNode(text));
      tip.style.left = Math.min(r.left, innerWidth - 222) + 'px';
      tip.style.top = (r.bottom + 8) + 'px';
      tip.style.opacity = 1;
    });
    b.addEventListener('mouseleave', () => { tip.style.opacity = 0; });
  });
})();
