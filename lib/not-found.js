// The 404 page's "Report an error" link: opens the form on THIS host with the address that was not found and the page that linked to it (if the browser says), so the
// report arrives knowing what failed. suggest-box.js reads `missing` and `from` and writes them into the form.
(function () {
  const a = document.getElementById('nf-report');
  if (!a) return;
  const q = new URLSearchParams({ report: 'error', missing: location.href.slice(0, 300) });
  if (document.referrer) q.set('from', document.referrer.slice(0, 300));
  a.href = '/?' + q.toString();
})();

// The tally as a split-flap sign (an airport arrivals board). Each number is a flap: four half-height pieces (the top and bottom now showing, the flap that folds down and the
// one that folds in behind it); it steps through 0 to 9 until it reaches its number, the left and right ones going round once more than the middle. Plain text if the flaps
// cannot be built or the reader asks for reduced motion.
(function () {
  const els = [...document.querySelectorAll('.nf-split')];
  if (!els.length || !els[0].animate || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  const laps = [1, 2, 1];
  const TICK = 70;   // ms for one flap
  const half = (cls, v) => { const h = document.createElement('span'); h.className = 'nf-h ' + cls; const i = document.createElement('i'); i.textContent = v; h.appendChild(i); return h; };
  const fold = (node, from, to, ms, easing) => node.animate([{ transform: `rotateX(${from}deg)` }, { transform: `rotateX(${to}deg)` }], { duration: ms, easing, fill: 'forwards' }).finished;
  const set = (p, v) => { for (const k of Object.keys(p)) p[k].firstChild.textContent = v; };
  async function spin(p, goal, lap, startDelay) {
    await new Promise((r) => setTimeout(r, startDelay));
    let v = 0;
    const steps = goal + 10 * lap;
    for (let n = 0; n < steps; n++) {
      const next = (v + 1) % 10;
      p.t.firstChild.textContent = next;        // behind the falling flap: the top of the next number
      p.fb.firstChild.textContent = next;       // the flap that lands: the bottom of the next number
      await fold(p.ft, 0, -90, TICK / 2, 'ease-in');
      await fold(p.fb, 90, 0, TICK / 2, 'ease-out');
      v = next;
      set(p, v);                                // settle all four on the new number, then put the folding flaps back
      p.ft.getAnimations().forEach((a) => a.cancel());
      p.fb.getAnimations().forEach((a) => a.cancel());
    }
  }
  let gi = 0;
  els.forEach((el) => {
    const goals = el.textContent.trim().split('').map(Number);
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', goals.join(''));
    el.textContent = '';
    goals.forEach((goal) => {
      const d = document.createElement('span');
      d.className = 'nf-d';
      d.setAttribute('aria-hidden', 'true');
      const p = { t: half('nf-t', 0), b: half('nf-b', 0), ft: half('nf-ft', 0), fb: half('nf-fb', 0) };
      p.fb.style.transform = 'rotateX(90deg)';   // edge-on until its turn
      d.append(p.t, p.b, p.ft, p.fb);
      el.appendChild(d);
      spin(p, goal, laps[gi % laps.length], 350 + gi * 120);
      gi++;
    });
  });
})();
