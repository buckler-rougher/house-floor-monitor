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

    const openDrawer  = () => { drawerOpener = document.activeElement; overlay.style.display = ''; drawer.inert = false; drawer.classList.add('open'); drawer.removeAttribute('aria-hidden'); document.getElementById('suggest-message')?.focus(); startTurnstile(); };
    const closeDrawer = () => { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); drawer.inert = true; overlay.style.display = 'none'; if (drawerOpener && drawerOpener.focus) drawerOpener.focus(); drawerOpener = null; };

    document.getElementById('suggest-fab')?.addEventListener('click', openDrawer);
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
        btn.disabled = true;
        btn.textContent = 'SENDING…';
        try {
            await tokenReady();
            const fd  = new FormData(e.target);
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
