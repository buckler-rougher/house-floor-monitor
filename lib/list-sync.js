// Redraw a list without rebuilding it, and animate what changes.
//
//   ListSync.sync(list, entries)     entries: [{ key, html, tail? }]   (tail: a button or note under the items, not an item)
//
// An entry whose markup is unchanged keeps its element, so a face already loaded does not blink and a refresh that changes nothing touches nothing.
// What the change is decides the motion:
//   - items only came or went and the ones that stayed kept their order (a "Show 8 more" / "Show fewer" button): each opens up from nothing, or closes to
//     nothing, by height, fade and the gap below it, so what is around it slides instead of jumping;
//   - an item that stays but whose content changes (a list of steps opens inside it) grows or shrinks to its new height, so the items below slide with it;
//   - a new order (a new sort, a filter): the items that stay slide to their new places and the new ones fade in; the ones that left are gone.
// The first drawing and reduced motion are not animated. The list's own row gap is cancelled with a negative margin while an item is zero high, so there is no
// jump at the end.

(function (root) {
  const EASE = 'cubic-bezier(0.15, 0.83, 0.66, 1)';   // --ease-emphasis

  function sync(list, entries) {
    const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const first = !list.querySelector('[data-key]');
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    // anything that is not an entry (a "Loading" note) goes
    [...list.children].forEach((el) => { if (!(el.dataset && el.dataset.key)) el.remove(); });
    // a button or note under the list that this drawing no longer has (the "Show fewer" of another sort) goes at once
    const wanted = new Set(entries.map((e) => e.key));
    [...list.children].forEach((el) => { if (el.dataset.tail && !wanted.has(el.dataset.key)) el.remove(); });
    const present = [...list.children].filter((el) => !el.dataset.leaving);
    const old = new Map(present.map((el) => [el.dataset.key, el]));
    const oldKeys = present.filter((el) => !el.dataset.tail).map((el) => el.dataset.key);
    const newKeys = entries.filter((e) => !e.tail).map((e) => e.key);
    const stay = oldKeys.filter((k) => newKeys.includes(k));
    const leaving = oldKeys.filter((k) => !newKeys.includes(k));
    const arriving = newKeys.filter((k) => !oldKeys.includes(k));
    const sameOrder = stay.join('\u0000') === newKeys.filter((k) => stay.includes(k)).join('\u0000');
    // items only came or went, and the ones that stayed kept their order: nothing needs to slide to a place, the rest just opens or closes around them
    const tailChange = sameOrder && (leaving.length > 0 || arriving.length > 0);
    const animate = !reduce && !first;
    const before = new Map(oldKeys.map((k) => [k, old.get(k).getBoundingClientRect()]));

    // leaving
    for (const k of leaving) {
      const el = old.get(k);
      if (animate && tailChange) {
        el.dataset.leaving = '1';
        const h = el.offsetHeight;
        el.style.overflow = 'hidden';
        el.animate([{ height: h + 'px', opacity: 1, marginBottom: '0px' }, { height: '0px', opacity: 0, marginBottom: -gap + 'px' }], { duration: 240, easing: EASE }).onfinish = () => el.remove();
        el.style.height = '0px'; el.style.marginBottom = -gap + 'px'; el.style.opacity = '0';
      } else el.remove();
    }
    // staying and arriving, in order; items still closing are left where they are
    let prev = null;
    const arrived = [];
    const resized = [];   // items kept whose content changed (a "Steps" list opened inside one): they grow or shrink to their new height
    for (const { key, html, tail } of entries) {
      let el = old.get(key);
      const isNew = !el;
      if (!el || el.dataset.sig !== html) {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        const n = t.content.firstElementChild;
        n.dataset.key = key; n.dataset.sig = html;
        if (tail) n.dataset.tail = '1';
        if (el && el.parentNode === list) { if (!tail) resized.push({ el: n, from: el.offsetHeight }); el.replaceWith(n); }
        el = n;
      }
      let ref = prev ? prev.nextSibling : list.firstChild;
      while (ref && ref.dataset && ref.dataset.leaving) ref = ref.nextSibling;
      if (ref !== el) list.insertBefore(el, ref || null);
      prev = el;
      if (isNew && !tail) arrived.push(el);
    }
    if (!animate) return;
    // what changed inside an item that stayed: it opens or closes to its new height, so what is below it slides with it, and the last item is no different
    for (const { el, from } of resized) {
      const to = el.offsetHeight;
      if (Math.abs(to - from) < 2) continue;
      el.style.overflow = 'hidden';
      el.animate([{ height: from + 'px' }, { height: to + 'px' }], { duration: 260, easing: EASE }).onfinish = () => { el.style.overflow = ''; };
    }
    if (tailChange) {
      for (const el of arrived) {
        const h = el.offsetHeight;
        el.style.overflow = 'hidden';
        el.animate([{ height: '0px', opacity: 0, marginBottom: -gap + 'px' }, { height: h + 'px', opacity: 1, marginBottom: '0px' }], { duration: 280, easing: EASE }).onfinish = () => { el.style.overflow = ''; };
      }
      return;
    }
    if (sameOrder) return;
    for (const k of stay) {
      const el = [...list.children].find((c) => c.dataset.key === k);
      const prev0 = before.get(k);
      if (!el || !prev0) continue;
      const now = el.getBoundingClientRect();
      const dx = prev0.left - now.left, dy = prev0.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 320, easing: EASE });
    }
    for (const el of arrived) el.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: EASE });
  }

  root.ListSync = { sync };
})(globalThis);
