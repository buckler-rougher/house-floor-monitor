// The time machine's interface (lib/replay-agenda.js, lib/replay-ui.js, about 60 KB) is only needed by someone who uses it, so it is not on the page's way in.
//
//   a replay page (?replay=YYYYMMDD): written into the page here, at this spot, as deferred scripts, so they run in the same order they did when they were listed
//   any other page: fetched the first time the Time Machine button is pointed at, focused or touched (so it is usually there by the click), and a click that
//                   beats it waits for the load and then clicks the button again, which the interface now answers.
//
// The versions of the two files live here and nowhere else: bump them in this file.
(function () {
  const FILES = ['lib/replay-agenda.js?v=20261016c', 'lib/replay-ui.js?v=20261022b'];

  if (/[?&]replay=\d{8}/.test(location.search)) {
    document.write(FILES.map((f) => '<scr' + 'ipt defer src="' + f + '"></scr' + 'ipt>').join(''));
    return;
  }

  let loading = null, ready = false;
  const add = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  const load = () => loading || (loading = FILES.reduce((p, f) => p.then(() => add(f)), Promise.resolve()).then(() => { ready = true; }, () => { loading = null; }));
  const onButton = (e) => !!(e.target && e.target.closest && e.target.closest('#replay-btn'));
  ['pointerover', 'focusin', 'touchstart'].forEach((t) => document.addEventListener(t, (e) => { if (!ready && onButton(e)) load(); }, { capture: true, passive: true }));
  document.addEventListener('click', (e) => {
    if (ready || !onButton(e)) return;
    load().then(() => { if (ready) document.getElementById('replay-btn').click(); });
  }, true);
})();
