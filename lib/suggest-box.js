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

    const openDrawer  = () => { overlay.style.display = ''; drawer.classList.add('open'); drawer.removeAttribute('aria-hidden'); document.getElementById('suggest-message')?.focus(); };
    const closeDrawer = () => { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); overlay.style.display = 'none'; };

    document.getElementById('suggest-fab')?.addEventListener('click', openDrawer);
    document.getElementById('suggest-close').addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
    });

    // Data & privacy modal
    const dataModal = document.getElementById('suggest-data-modal');
    const openDataModal  = () => { dataModal.style.display = 'flex'; document.getElementById('suggest-data-close').focus(); };
    const closeDataModal = () => { dataModal.style.display = 'none'; document.getElementById('suggest-privacy-link')?.focus(); };
    document.getElementById('suggest-privacy-link').addEventListener('click', e => { e.preventDefault(); openDataModal(); });
    document.getElementById('suggest-data-close').addEventListener('click', closeDataModal);
    document.getElementById('suggest-data-backdrop').addEventListener('click', closeDataModal);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && dataModal.style.display !== 'none') { e.stopPropagation(); closeDataModal(); }
    }, true);

    document.getElementById('suggest-form').addEventListener('submit', async e => {
        e.preventDefault();
        const btn   = document.getElementById('suggest-submit');
        const errEl = document.getElementById('suggest-error');
        errEl.style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'SENDING…';
        try {
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
        }
    });
});
