// Suggestion box drawer.
//
// Lifted out of app.js unchanged. senate.html has carried the markup -- the
// button, the drawer, the form, the privacy modal -- since it was copied over,
// and clicking it did nothing, because the only code that wires it lived in
// app.js and the Senate board does not load app.js. No console error either,
// which is what made it hard to spot: the listeners were simply never attached.
//
// Self-contained apart from the endpoint it posts to, which both boards share.
// It wires itself on DOMContentLoaded, so loading the file is all it needs.

document.addEventListener('DOMContentLoaded', () => {
    const drawer  = document.getElementById('suggest-drawer');
    const overlay = document.getElementById('suggest-overlay');
    if (!drawer || !overlay) return;

    // Keyboard: while a dialog is open Tab cycles inside it, and closing puts focus back where it was. A closed drawer is `inert`, not just off screen:
    // its nine controls were otherwise still in the tab order, invisible, for anyone moving through the page with a keyboard.
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const trap = (e, box) => {
        if (e.key !== 'Tab') return;
        const items = [...box.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    const dataModal = document.getElementById('suggest-data-modal');
    let drawerOpener = null;
    drawer.inert = true;
    drawer.setAttribute('aria-modal', 'true');
    // Turnstile: a check that stays out of sight unless it has to show itself, and rides along with the
    // form as the field cf-turnstile-response. If it cannot load or run, the form still sends and the
    // server decides what to do about a missing token.
    const TS_KEY = '0x4AAAAAADXezVdye4e6zE_p';
    let tsId = null, tsLoading = null;
    const loadTurnstile = () => tsLoading ??= new Promise((resolve) => {
        if (window.turnstile) return resolve(true);
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
    });
    const startTurnstile = async () => {
        if (tsId !== null || !(await loadTurnstile()) || !window.turnstile) return;
        const box = document.createElement('div');
        box.id = 'suggest-turnstile';
        document.getElementById('suggest-form').appendChild(box);
        try { tsId = window.turnstile.render(box, { sitekey: TS_KEY, appearance: 'interaction-only' }); } catch { box.remove(); }
    };
    // Up to four seconds for a token that is still being made; then send without one.
    const tokenReady = async () => {
        for (let i = 0; tsId !== null && i < 27 && !window.turnstile.getResponse(tsId); i++) await new Promise((r) => setTimeout(r, 150));
    };
    const resetTurnstile = () => { try { if (tsId !== null) window.turnstile.reset(tsId); } catch { /* the form still works */ } };

    // ── Suggestion or error report ──────────────────────────────────────────────────────────────────────────
    // One drawer, two kinds. An error report adds a PANEL list (the panels showing on the page now, the one most in view chosen) and WHAT IT SAID, the text that panel showed,
    // filled in by itself and editable, so a report says exactly what the reader saw. Everything goes in the message (the contact form takes a message, not fields).
    const form = document.getElementById('suggest-form');
    const kindBtns = [...document.querySelectorAll('#suggest-kind .bills-sort-btn')];
    const errFields = document.getElementById('suggest-error-fields');
    const panelSel = document.getElementById('suggest-panel');
    const saidWrap = document.getElementById('suggest-said-wrap');
    const said = document.getElementById('suggest-said');
    const msg = document.getElementById('suggest-message');
    const subjectEl = form.querySelector('input[name="subject"]');
    const baseSubject = subjectEl ? subjectEl.value.replace(/ — Suggestion$/, '') : 'Monitoring the Floor';
    const SAID_MAX = 2400;
    let kind = 'suggestion', panelList = [];

    const SMALL = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'the', 'to']);
    const titleCase = (t) => String(t || '').replace(/\s+/g, ' ').trim().split(' ')
        .map((w, i) => (/\d/.test(w) ? w : (i && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))).join(' ');
    const shown = (el) => !!el && el.getClientRects().length > 0;
    const collectPanels = () => {
        const seen = new Set();
        return [...document.querySelectorAll('.panel-label')].map((l) => {
            const head = l.closest('.panel-header'), el = head && head.parentElement;
            return { el, label: titleCase(l.textContent) };
        }).filter((p) => p.el && p.label && shown(p.el) && !drawer.contains(p.el) && !seen.has(p.el) && seen.add(p.el));
    };
    const mostInView = (list) => {
        let best = -1, bestPx = 0;
        list.forEach((p, i) => { const r = p.el.getBoundingClientRect(); const px = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)); if (px > bestPx) { bestPx = px; best = i; } });
        return best;
    };
    const textOf = (el) => {
        const t = (el.innerText || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
        return t.length > SAID_MAX ? t.slice(0, SAID_MAX).trimEnd() + ' [cut here, the panel has more]' : t;
    };
    // the moment, as the site writes one (day first, short month, 12-hour clock with its zone); under the time machine it is the replayed moment
    const stamp = () => {
        const d = new Date();
        const day = (window.BoardUtil && BoardUtil.fmtDate) ? BoardUtil.fmtDate(d) : d.toDateString();
        return `${day}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}`;
    };
    const fillSaid = () => {
        const i = panelSel.value === '' ? -1 : Number(panelSel.value);
        const p = Number.isInteger(i) && i >= 0 ? panelList[i] : null;
        saidWrap.hidden = !p;
        const body = p ? textOf(p.el).split('\n') : [];
        if (body.length > 1 && body[0].trim().toLowerCase() === p.label.toLowerCase()) body.shift();   // the panel's own title: the list already says it
        said.value = body.join('\n');
        document.getElementById('suggest-stamp').textContent = p ? `Copied from this page at ${stamp()}.` : '';
    };
    const OTHER = [['', 'Something else, or the whole site'], ['accessibility', 'Accessibility: something hard to use']];
    const buildPanels = (pick) => {
        panelList = collectPanels();
        panelSel.innerHTML = '<option value="none">Choose a panel</option>' + panelList.map((p, i) => `<option value="${i}">${p.label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`).join('') + OTHER.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
        panelSel.value = pick === 'accessibility' ? 'accessibility' : pick === 'none' ? 'none' : (() => { const i = mostInView(panelList); return i >= 0 ? String(i) : ''; })();
        fillSaid();
    };
    const setKind = (next, pick) => {
        kind = next;
        kindBtns.forEach((b) => { const on = b.dataset.kind === next; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        const err = next === 'error';
        errFields.hidden = !err;
        document.getElementById('suggest-title').textContent = err ? 'REPORT AN ERROR' : 'SUGGESTION BOX';
        drawer.setAttribute('aria-label', err ? 'Report an error' : 'Suggestion box');
        document.getElementById('suggest-message-label').textContent = err ? 'WHAT IS WRONG' : 'MESSAGE';
        msg.placeholder = err ? 'What should it say, or what is missing?' : 'Ideas, bugs, data questions…';
        if (err) buildPanels(pick);
    };
    kindBtns.forEach((b) => b.addEventListener('click', () => { if (b.dataset.kind !== kind) setKind(b.dataset.kind); }));
    panelSel.addEventListener('change', fillSaid);
    // the text sent for an error report: what is wrong first, then what the reader saw and where
    const errorMessage = () => {
        const opt = panelSel.options[panelSel.selectedIndex];
        const u = new URL(location.href); u.searchParams.delete('report');
        const lines = [msg.value.trim(), '', '--', `Panel: ${opt ? opt.textContent : ''}`, `Page: ${u.href}`, `Time: ${stamp()}`];
        if (!saidWrap.hidden && said.value.trim()) lines.push('', 'What it said:', said.value.trim().split('\n').map((l) => '> ' + l).join('\n'));
        return lines.join('\n');
    };
    const subjectFor = () => {
        if (kind !== 'error') return `${baseSubject} — Suggestion`;
        const opt = panelSel.options[panelSel.selectedIndex];
        return `${baseSubject}: Error report, ${opt ? opt.textContent : ''}`;
    };

    const openDrawer  = (want = 'suggestion', pick) => {
        drawerOpener = document.activeElement; overlay.style.display = ''; drawer.inert = false; drawer.classList.add('open'); drawer.removeAttribute('aria-hidden');
        setKind(want === 'error' ? 'error' : 'suggestion', pick);
        msg.focus(); startTurnstile();
    };
    const closeDrawer = () => { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); drawer.inert = true; overlay.style.display = 'none'; if (drawerOpener && drawerOpener.focus) drawerOpener.focus(); drawerOpener = null; };

    document.getElementById('suggest-fab')?.addEventListener('click', () => openDrawer('suggestion'));
    document.querySelectorAll('[data-report-error]').forEach((b) => b.addEventListener('click', () => openDrawer('error', 'none')));   // from the footer the panel in view is only the footer's neighbour, so the reader chooses
    // /?report=accessibility (the Accessibility page's link) opens the drawer as an error report, then clears itself from the address
    try {
        const u = new URL(location.href), r = u.searchParams.get('report');
        if (r) { u.searchParams.delete('report'); history.replaceState(history.state, '', u); openDrawer('error', r); }
    } catch { /* an address that cannot be rewritten: the footer button still works */ }
    document.getElementById('suggest-close').addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
        else if (drawer.classList.contains('open') && dataModal.style.display === 'none') trap(e, drawer);
    });

    // Data & privacy modal
    const openDataModal  = () => { dataModal.style.display = 'flex'; document.getElementById('suggest-data-close').focus(); };
    const closeDataModal = () => { dataModal.style.display = 'none'; document.getElementById('suggest-privacy-link')?.focus(); };
    document.getElementById('suggest-privacy-link').addEventListener('click', e => { e.preventDefault(); openDataModal(); });
    document.getElementById('suggest-data-close').addEventListener('click', closeDataModal);
    document.getElementById('suggest-data-backdrop').addEventListener('click', closeDataModal);
    document.addEventListener('keydown', e => {
        if (dataModal.style.display === 'none') return;
        if (e.key === 'Escape') { e.stopPropagation(); closeDataModal(); }
        else trap(e, dataModal);
    }, true);

    document.getElementById('suggest-form').addEventListener('submit', async e => {
        e.preventDefault();
        const btn   = document.getElementById('suggest-submit');
        const errEl = document.getElementById('suggest-error');
        errEl.style.display = 'none';
        if (kind === 'error' && panelSel.value === 'none') { errEl.textContent = 'Choose the panel, or "Something else".'; errEl.style.display = ''; panelSel.focus(); return; }
        btn.disabled = true;
        btn.textContent = 'SENDING…';
        try {
            await tokenReady();
            const fd  = new FormData(e.target);
            if (kind === 'error') fd.set('message', errorMessage());
            fd.set('subject', subjectFor());
            const res = await fetch('https://contact.evanhollander.org/api/submit', { method: 'POST', body: fd });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.success) throw new Error(json.error || 'Something went wrong.');
            document.getElementById('suggest-form').style.display = 'none';
            document.getElementById('suggest-success').style.display = '';
        } catch (err) {
            errEl.textContent = err.message;
            errEl.style.display = '';
            btn.disabled = false;
            btn.textContent = 'SEND';
            resetTurnstile();
        }
    });
});
