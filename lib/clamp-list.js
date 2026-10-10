// A long list shown as its first few items and the top of the next, faded out along the bottom edge, with a + / - to open the rest: the Orders card's motif
// (`.calendar-card`) for a list of cards, in place of a "Show 8 more" button.
//
//   const c = ClampList.mount(listEl, { keep: 3 })    keep: how many items are shown whole (a number, or a function that says)
//   c.refresh()                                        after the items change (it also watches for them by itself)
//   c.close()                                          shut it (a new sort starts shut)
//
// `listEl` stays what it was (a ListSync list); it is moved into a wrapper that clips it. The clip is the height of the first `keep` items plus a slice (PEEK px) of the
// next one, so there is always something to see under the fade; with `keep` or fewer items there is no clip, no fade and no button. Opening grows the clip to the
// list's own height and lets it go (so the list follows later changes); closing sets it back. The fade is an overlay whose opacity changes, as the card's is.
//
//   ClampList.clampPx(tops, keep, peek, total)  pure: the clip height, or null when everything fits   (test/clamp-list.test.js)

(function (root) {
  const PEEK = 56;   // px of the next item left showing under the fade

  function clampPx(tops, keep, peek = PEEK, total = Infinity) {
    if (!tops || tops.length <= keep) return null;
    return Math.min(tops[keep] + peek, total);
  }

  function mount(list, { keep = 3 } = {}) {
    if (!list || typeof document === 'undefined') return null;
    if (list._clamp) return list._clamp;
    const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wrap = document.createElement('div');
    wrap.className = 'clamp is-short';
    const body = document.createElement('div');
    body.className = 'clamp-body';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'clamp-toggle';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Show all');
    btn.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M1.5 6h9" /><path class="v" d="M6 1.5v9" /></svg>';
    list.before(wrap);
    wrap.append(body, btn);
    body.append(list);

    let open = false, busy = false, settle = null, frame = 0;
    const keepN = () => (typeof keep === 'function' ? keep() : keep);
    const items = () => [...list.children].filter((el) => el.dataset && el.dataset.key && !el.dataset.leaving);
    const height = () => { const tops = items().map((el) => el.offsetTop); return clampPx(tops, keepN(), PEEK, list.scrollHeight); };

    function refresh() {
      if (busy) return;
      const px = height();
      wrap.classList.toggle('is-short', px === null);
      if (px === null) { body.style.maxHeight = ''; if (open) setOpen(false, true); return; }
      body.style.maxHeight = open ? 'none' : px + 'px';
    }
    function setOpen(next, quiet) {
      open = next;
      wrap.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Show less' : 'Show all');
      if (quiet) return;
      clearTimeout(settle);
      busy = true;
      if (open) {
        body.style.maxHeight = body.scrollHeight + 'px';
        settle = setTimeout(() => { body.style.maxHeight = 'none'; busy = false; }, reduce ? 0 : 360);
      } else {
        body.style.maxHeight = body.scrollHeight + 'px';
        void body.offsetHeight;                      // commit that height before changing it (a transition cannot start from `none`)
        const px = height();
        body.style.maxHeight = px === null ? '' : px + 'px';
        settle = setTimeout(() => { busy = false; refresh(); }, reduce ? 0 : 360);
      }
    }
    btn.addEventListener('click', () => setOpen(!open));
    const soon = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh); };
    if (root.ResizeObserver) new ResizeObserver(soon).observe(list);
    if (root.MutationObserver) new MutationObserver(soon).observe(list, { childList: true });

    const api = { refresh, close: () => { if (open) setOpen(false); }, wrap };
    list._clamp = api;
    refresh();
    return api;
  }

  root.ClampList = { mount, clampPx };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ClampList;
})(typeof globalThis !== 'undefined' ? globalThis : this);
