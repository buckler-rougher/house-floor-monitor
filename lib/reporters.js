// Floor reporters: the Twitter list as a feed, with a card row, a handle search,
// threads, an image lightbox and a "new posts" banner.
//
// Shared by both boards. It lived in the House's app.js; the Senate board had it
// removed and the note in AGENTS.md said it should not have been, since the list
// is one list and its handles cover both chambers. The Worker's /api/tweets is
// the same endpoint either way, so what differs per board is only the endpoint
// base and the cards in the row (init's options).
//
// Posts come from a Nitter mirror, so the feed can be down while the board is up:
// an outage is shown as one, and a last-known-good feed is labelled as old.
//
//   Reporters.init({ api: '.../api/tweets', cards: [{ handle, name }, ...] })
//   Reporters.push(data)   // a feed delivered some other way (the House's SSE)

(() => {
  const { escapeHtml: esc } = globalThis.BoardUtil;
  let CFG = { api: '', cards: [] };

  // Allowlist-sanitize HTML from external sources (e.g. nitter tweet bodies).
  // Keeps <a href="https://..."> links; strips everything else.
  function sanitizeTweetHtml(html) {
      if (!html) return '';
      // 1. Keep existing <a href="https://..."> links, strip all other tags
      let out = html
          .replace(/<a\s+[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
              (_, href, inner) =>
                  `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(inner.replace(/<[^>]+>/g, ''))}</a>`)
          .replace(/<[^>]+>/g, '');
      // 2. Auto-link URLs — strip trailing punctuation that's likely not part of the URL
      const trimUrl = u => u.replace(/[.,;:!?)]+$/, '');
      out = out.replace(/(?<![">=/\w])(https?:\/\/[^\s<>"]+)/g,
          m => { const u = trimUrl(m); return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`; });
      // Bare domains with a path (e.g. cbsn.ws/4okdGWi) — require slash to avoid false positives
      out = out.replace(/(?<![">=/\w@.])\b([a-z0-9][a-z0-9-]*\.[a-z]{2,6}\/[^\s<>".,;:!?)]+)/gi,
          (_, url) => `<a href="https://${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`);
      // 3. Auto-link @handles
      out = out.replace(/(?<![/\w@])@([\w]+)/g,
          (_, handle) => `<a href="https://twitter.com/${handle}" target="_blank" rel="noopener noreferrer">@${handle}</a>`);
      return out;
  }


  // Floor Reporters (via nitter proxy)

  const REPORTER_NAMES = {
      '@AdamZHerman':     'Adam Herman',
    '@burgessev':       'Burgess Everett',
      '@HouseInSession':  'Billy House',
      '@NBCPolitics':     'NBC Politics',
      '@ScottNover':      'Scott Nover',
      '@adamwren':        'Adam Wren',
      '@ddale8':          'Daniel Dale',
      '@kwelkernbc':      'Kristen Welker',
      '@kyledcheney':     'Kyle Cheney',
      '@meredithllee':    'Meredith Lee',
      '@metzgov':         'Bryan Metzger',
      '@stephen_neukam':  'Stephen Neukam',
      '@AlecAHernandez':  'Alec Hernandez',
      '@AndrewDesiderio': 'Andrew Desiderio',
      '@AndrewSolender':  'Andrew Solender',
      '@BBCWorld':        'BBC World',
      '@BarakRavid':      'Barak Ravid',
      '@Cat_Zakrzewski':  'Cat Zakrzewski',
      '@ChadPergram':     'Chad Pergram',
      '@CraigCaplan':     'Craig Caplan',
      '@DefenseBaron':    'Jon Harper',
      '@FarnoushAmiri':   'Farnoush Amiri',
      '@InsidePolitics':  'Inside Politics',
      '@John_Hudson':     'John Hudson',
      '@JonathanLanday':  'Jonathan Landay',
      '@JonathanTamari':  'Jonathan Tamari',
      '@KDilanianMSNOW':  'Ken Dilanian',
      '@LisaMascaro':     'Lisa Mascaro',
      '@MacFarlaneNews':  'Scott MacFarlane',
      '@MattGlassman312': 'Matt Glassman',
      '@NormOrnstein':    'Norm Ornstein',
      '@Olivia_Beavers':  'Olivia Beavers',
      '@ReutersZengerle': 'Patricia Zengerle',
      '@UrsulaPerano':    'Ursula Perano',
      '@bresreports':     'Jake Bres',
      '@cami_mondeaux':   'Cami Mondeaux',
      '@connorobrienNH':  'Connor O\'Brien',
      '@emilybrooksnews': 'Emily Brooks',
      '@grace_panetta':   'Grace Panetta',
      '@greggiroux':      'Greg Giroux',
      '@jacq_thomsen':    'Jacqueline Thomsen',
      '@JakeSherman':     'Jake Sherman',
      '@jamiedupree':     'Jamie Dupree',
      '@mkraju':          'Manu Raju',
      '@maxwelltani':     'Maxwell Tani',
      '@mikedebonis':     'Mike DeBonis',
      '@mychaelschnell':  'Mychael Schnell',
      '@nancyayoussef':   'Nancy Youssef',
      '@natalieandrews':  'Natalie Andrews',
      '@pkcapitol':       'Paul Kane',
      '@politico':        'Politico',
      '@ryanjreilly':     'Ryan J. Reilly',
      '@sahilkapur':      'Sahil Kapur',
      '@sarahnferris':    'Sarah Ferris',
      '@scottwongDC':     'Scott Wong',
      '@seungminkim':     'Seung Min Kim',
      '@tvheidihatch':    'Heidi Hatch',
      // Additional handles seen in feed
      '@AdamDalyNews':    'Adam Daly',
      '@CBSNews':         'CBS News',
      '@FoxReports':      'Fox News Reports',
      '@HenryJGomez':     'Henry J. Gomez',
      '@HowardMortman':   'Howard Mortman',
      '@juliegraceb':     'Julie Grace Brufke',
      '@marksatter':      'Mark Satter',
      '@mmillerwtop':     'Mitchell Miller',
      '@wildstein':       'David Wildstein',
      '@KyleAlexStewart': 'Kyle Stewart',
      '@akarl_smith':     'A.G. Karl Smith',
  };

  function tweetRelativeTime(ms) {
      const diff = Math.floor((Date.now() - ms) / 60000);
      if (diff < 1) return 'now';
      if (diff < 60) return `${diff}m`;
      if (diff < 1440) return `${Math.floor(diff / 60)}h`;
      return `${Math.floor(diff / 1440)}d`;
  }

  // Tick all visible tweet timestamps every 30s
  setInterval(() => {
      document.querySelectorAll('.tweet-time[data-ts]').forEach(el => {
          const ts = parseInt(el.dataset.ts, 10);
          if (ts) el.textContent = tweetRelativeTime(ts);
      });
  }, 30_000);

  // New-tweet banner state
  let _feedLoaded    = false; // true after first successful list-feed render
  let _feedNewestTs  = 0;     // pubDate timestamp of newest tweet seen in list feed
  let _feedNewPending = 0;    // count of new tweets not yet scrolled-to by user

  async function fetchTweets(preData = null, userHandle = null) {
      const feed = document.getElementById('tweets-feed');
      if (!feed) return;
      // Don't override a user-profile view with SSE list pushes
      if (preData && window._tweetUserMode) return;
      try {
          let data;
          if (preData) {
              data = preData;
          } else {
              const apiUrl = userHandle
                  ? `${CFG.api}?user=${encodeURIComponent(userHandle)}`
                  : CFG.api;
              // Read the response, not just the body: kvCache marks a last-known-good
              // fallback with X-Stale so we can show the posts AND say they are old.
              // The worker marks a last-known-good fallback in the body (so the SSE
              // push carries it too) and in X-Stale for plain REST callers.
              const resp = await fetch(apiUrl);
              data = await resp.json().catch(() => ({}));
              if (resp.headers.get('X-Stale') === '1' && !data.stale) data = { ...data, stale: true };
          }
          if (!data.tweets || !data.tweets.length) {
              // Distinguish an upstream outage from a genuinely quiet feed. Nitter is
              // down to a single working instance, so this is a question of when.
              feed.innerHTML = data.error === 'upstream-unavailable'
                  ? '<div class="tweets-empty">Reporter feed unavailable — the upstream Twitter mirror is not responding.</div>'
                  : '<div class="tweets-empty">No posts available.</div>';
              return;
          }
          const renderTweet = (t, opts = {}) => {
              const { isThreadParent = false, isThreadReply = false } = opts;
              const rtByHandle = t.rtBy || '';
              const rtByLink = rtByHandle
                  ? `<a href="https://twitter.com/${rtByHandle.replace('@', '')}" target="_blank" rel="noopener">${esc(rtByHandle)}</a>`
                  : '';
              const rtBar = t.isRT
                  ? `<div class="tweet-rt-bar">↩ ${rtByLink} retweeted</div>`
                  : '';

              const onImgError = `this.style.display='none';const w=this.closest('.tweet-images,.tweet-card');if(w&&!w.querySelector('img:not([style*="none"])')&&w!==null)w.style.display='none'`;

              const imagesHtml = t.images && t.images.length
                  ? `<div class="tweet-images tweet-images-${Math.min(t.images.length, 4)}">${
                      t.images.slice(0, 4).map(src =>
                          `<img class="tweet-img" src="${src}" loading="lazy" alt="" style="cursor:pointer" onerror="${onImgError}">`
                      ).join('')
                    }</div>`
                  : '';

              const cardHtml = t.cardImage && !t.images.length
                  ? `<div class="tweet-card"><img class="tweet-card-img tweet-img" src="${t.cardImage}" loading="lazy" alt="" style="cursor:pointer" onerror="this.closest('.tweet-card').style.display='none'"></div>`
                  : '';

              const quoteInner = t.quoteAuthor
                  ? `<span class="tweet-quote-author">${esc(t.quoteAuthor)}</span>
                     <div class="tweet-quote-text">${sanitizeTweetHtml(t.quoteHtml)}</div>`
                  : '';
              const quoteHtml = quoteInner
                  ? (t.quoteUrl
                      ? `<a class="tweet-quote" href="${esc(t.quoteUrl)}" target="_blank" rel="noopener">${quoteInner}</a>`
                      : `<div class="tweet-quote">${quoteInner}</div>`)
                  : '';

              // Sanitize body then fix truncated URLs (display text ending with …) to point at the tweet page
              let bodyHtml = sanitizeTweetHtml(t.html) || esc(t.title || '');
              if (t.link) {
                  bodyHtml = bodyHtml.replace(/<a([^>]*)href="[^"]*"([^>]*)>([^<]*…)<\/a>/g,
                      (_, pre, post, text) => `<a${pre}href="${esc(t.link)}"${post} title="View tweet for full URL">${text}</a>`);
              }

              const avatarLetter = (t.handle || '?').replace('@', '')[0].toUpperCase();
              const bareHandle = (t.handle || '').replace('@', '');
              const avatarSrc = bareHandle ? `https://unavatar.io/x/${bareHandle}` : '';
              const avatarInner = avatarSrc
                  ? `<img src="${avatarSrc}" alt="" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`
                    + `<span style="display:none;width:100%;height:100%;align-items:center;justify-content:center">${avatarLetter}</span>`
                  : avatarLetter;
              const profileUrl = t.handle ? `https://twitter.com/${t.handle.replace('@', '')}` : null;
              const displayName = REPORTER_NAMES[t.handle] || bareHandle || null;
              const authorHtml = profileUrl
                  ? `<a class="tweet-author-block" href="${profileUrl}" target="_blank" rel="noopener">
                      ${displayName ? `<span class="tweet-display-name">${esc(displayName)}</span>` : ''}
                      <span class="tweet-handle">${esc(t.handle || '')}</span>
                    </a>`
                  : `<span class="tweet-author-block">
                      ${displayName ? `<span class="tweet-display-name">${esc(displayName)}</span>` : ''}
                      <span class="tweet-handle">${esc(t.handle || '')}</span>
                    </span>`;

              const cls = ['tweet-item', isThreadParent ? 'tweet-thread-parent' : '', isThreadReply ? 'tweet-thread-reply' : ''].filter(Boolean).join(' ');
              const avatarHtml = profileUrl
                  ? `<a class="tweet-avatar" href="${profileUrl}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${avatarInner}</a>`
                  : `<div class="tweet-avatar">${avatarInner}</div>`;
              const tweetTs = t.pubDate ? new Date(t.pubDate).getTime() : '';
              const tweetTimeText = tweetTs ? tweetRelativeTime(tweetTs) : esc(t.relativeTime || '');
              const tweetFullTime = tweetTs
                  ? new Date(tweetTs).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
                  : '';
              const filterBtn = t.handle
                  ? `<button class="tweet-filter-btn" data-handle="${esc(t.handle)}" title="Filter by ${esc(t.handle)}" aria-label="Filter by ${esc(t.handle)}"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M0.5 1.5L9.5 1.5L6 5.5L6 8.5L4 8.5L4 5.5Z"/></svg></button>`
                  : '';
              return `<div class="${cls}" data-handle="${esc(t.handle || '')}">
                  ${rtBar}
                  <div class="tweet-header">
                      <div class="tweet-author-area">
                          ${avatarHtml}
                          ${authorHtml}
                          ${filterBtn}
                      </div>
                      <span class="tweet-time"${tweetTs ? ` data-ts="${tweetTs}"` : ''}${tweetFullTime ? ` title="${esc(tweetFullTime)}"` : ''}>${tweetTimeText}</span>
                      ${t.link ? `<a class="tweet-ext-link" href="${t.link}" target="_blank" rel="noopener" aria-label="Open on Twitter" title="Open on Twitter"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5"/></svg></a>` : ''}
                  </div>
                  <div class="tweet-body">${bodyHtml}</div>
                  ${imagesHtml}${cardHtml}${quoteHtml}
              </div>`;
          };

          // Snapshot scroll position before innerHTML wipes it (setting innerHTML resets scrollTop)
          const wasScrolledDown = feed.scrollTop > 60;

          // Count tweets newer than the last list-feed render (list mode only)
          let newCount = 0;
          if (_feedLoaded && !userHandle) {
              newCount = data.tweets.filter(t => {
                  const ts = t.pubDate ? new Date(t.pubDate).getTime() : 0;
                  return ts > _feedNewestTs;
              }).length;
          }
          // Keep newest-ts current for list feeds
          if (!userHandle) {
              const latestTs = data.tweets.reduce((max, t) =>
                  Math.max(max, t.pubDate ? new Date(t.pubDate).getTime() : 0), 0);
              if (latestTs > _feedNewestTs) _feedNewestTs = latestTs;
          }

          // Group consecutive reply threads
          const items = [];
          const tweets = data.tweets;
          let i = 0;
          while (i < tweets.length) {
              const t = tweets[i];
              const next = tweets[i + 1];
              // If next tweet is a reply to this tweet's handle, group as thread
              if (next && next.isReply && next.replyTo === t.handle) {
                  items.push(`<div class="tweet-thread">${renderTweet(t, { isThreadParent: true })}${renderTweet(next, { isThreadReply: true })}</div>`);
                  i += 2;
              } else {
                  items.push(renderTweet(t));
                  i += 1;
              }
          }
          // Last-known-good: the posts are real but the upstream mirror is down, so
          // say so rather than letting hours-old posts read as current.
          const staleBanner = data.stale
              ? '<div class="tweets-stale">Upstream mirror unavailable — showing the last posts retrieved.</div>'
              : '';
          feed.innerHTML = staleBanner + items.join('');
          applyTweetFilter();

          // "↑ N new tweets" banner — shown when new posts arrived while user was scrolled down
          if (_feedLoaded && newCount > 0 && !userHandle) {
              if (wasScrolledDown) {
                  _feedNewPending += newCount;
                  const n = _feedNewPending;
                  const banner = document.createElement('button');
                  banner.className = 'tweets-new-banner';
                  banner.textContent = `↑ ${n} new tweet${n === 1 ? '' : 's'}`;
                  banner.addEventListener('click', () => {
                      feed.scrollTo({ top: 0, behavior: 'smooth' });
                      banner.remove();
                      _feedNewPending = 0;
                  });
                  feed.insertBefore(banner, feed.firstChild);
              } else {
                  _feedNewPending = 0; // user is already at top — tweets visible on render
              }
          }
          if (!userHandle) _feedLoaded = true;
      } catch (e) {
          feed.innerHTML = '<div class="tweets-empty">Failed to load posts.</div>';
      }
  }

  // Delegated at the document, so it survives the feed re-rendering.
  document.addEventListener('click', e => {
      // Image lightbox
      const img = e.target.closest('.tweet-img');
      if (img) {
          const container = img.closest('.tweet-images, .tweet-card');
          const allSrcs = container ? [...container.querySelectorAll('.tweet-img')].map(i => i.src) : [img.src];
          openTweetImageLightbox(img.src, allSrcs);
      }
      // Reporter filter button
      const filterBtn = e.target.closest('.tweet-filter-btn');
      if (filterBtn) {
          e.preventDefault();
          const handle = filterBtn.dataset.handle;
          window._tweetFilter = (window._tweetFilter === handle) ? null : handle;
          applyTweetFilter();
      }
  });

  function openTweetImageLightbox(clickedSrc, allSrcs) {
      const srcs = (allSrcs && allSrcs.length) ? allSrcs : [clickedSrc];
      let idx = srcs.indexOf(clickedSrc);
      if (idx === -1) idx = 0;

      let overlay = document.getElementById('tweet-img-lightbox');
      if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'tweet-img-lightbox';
          overlay.innerHTML =
              `<button id="lb-prev" class="lb-nav-btn" aria-label="Previous image">&#8249;</button>` +
              `<img id="tweet-img-lightbox-img" alt="">` +
              `<button id="lb-next" class="lb-nav-btn" aria-label="Next image">&#8250;</button>`;
          overlay.addEventListener('click', e => {
              if (!e.target.closest('.lb-nav-btn') && !e.target.closest('#tweet-img-lightbox-img'))
                  overlay.classList.remove('open');
          });
          overlay.querySelector('#lb-prev').addEventListener('click', e => { e.stopPropagation(); lbNavigate(-1); });
          overlay.querySelector('#lb-next').addEventListener('click', e => { e.stopPropagation(); lbNavigate(1); });
          document.addEventListener('keydown', e => {
              if (!overlay.classList.contains('open')) return;
              if (e.key === 'Escape') overlay.classList.remove('open');
              if (e.key === 'ArrowLeft')  lbNavigate(-1);
              if (e.key === 'ArrowRight') lbNavigate(1);
          });
          document.body.appendChild(overlay);
      }

      overlay._lbSrcs = srcs;
      overlay._lbIdx  = idx;
      lbUpdateImage(overlay);
      overlay.classList.add('open');
  }

  function lbNavigate(dir) {
      const overlay = document.getElementById('tweet-img-lightbox');
      if (!overlay) return;
      const srcs = overlay._lbSrcs || [];
      overlay._lbIdx = (overlay._lbIdx + dir + srcs.length) % srcs.length;
      lbUpdateImage(overlay);
  }

  function lbUpdateImage(overlay) {
      const srcs = overlay._lbSrcs || [];
      const idx  = overlay._lbIdx  || 0;
      overlay.querySelector('#tweet-img-lightbox-img').src = srcs[idx] || '';
      const single = srcs.length <= 1;
      overlay.querySelector('#lb-prev').style.display = single ? 'none' : '';
      overlay.querySelector('#lb-next').style.display = single ? 'none' : '';
  }

  // ── Reporter filter ──────────────────────────────────────────────────────────
  window._tweetFilter   = null;  // '@Handle' of active filter, or null
  window._tweetUserMode = false; // true when showing a specific user's profile feed

  function applyTweetFilter() {
      const handle = window._tweetFilter;

      // Update reporter card active states
      document.querySelectorAll('.reporter-card').forEach(card => {
          card.classList.toggle('active', card.dataset.handle === handle);
      });

      // Active-filter chip — only shown when filtered reporter has no card in the row
      // (reporters in the card row already show their active state via .reporter-card.active)
      const chip = document.getElementById('reporter-active-chip');
      if (chip) {
          const hasCard = handle && !!document.querySelector(`#reporter-cards-row .reporter-card[data-handle="${handle}"]`);
          if (handle && !hasCard) {
              const displayName = REPORTER_NAMES[handle] || handle.replace('@', '');
              const bare = handle.replace('@', '');
              chip.innerHTML =
                  `<img class="reporter-card-avatar" src="https://unavatar.io/x/${esc(bare)}" alt="" onerror="this.style.display='none'">` +
                  `<span class="reporter-chip-name">${esc(displayName)}</span>` +
                  `<span class="reporter-chip-clear" aria-hidden="true">✕</span>`;
              chip.style.display = '';
          } else {
              chip.style.display = 'none';
          }
      }

      const feed = document.getElementById('tweets-feed');
      if (!feed) return;
      feed.querySelectorAll('.tweet-item, .tweet-thread').forEach(el => {
          if (!handle) { el.style.display = ''; return; }
          if (el.classList.contains('tweet-thread')) {
              const handles = [...el.querySelectorAll('[data-handle]')].map(i => i.dataset.handle);
              el.style.display = handles.some(h => h === handle) ? '' : 'none';
          } else {
              el.style.display = (el.dataset.handle === handle) ? '' : 'none';
          }
      });
  }

  function initReporterCards() {
      const DEFAULT_REPORTER_CARDS = CFG.cards;
      const row = document.getElementById('reporter-cards-row');
      if (!row) return;

      row.innerHTML = DEFAULT_REPORTER_CARDS.map(r => {
          const bare = r.handle.replace('@', '');
          return `<button class="reporter-card" data-handle="${esc(r.handle)}">` +
              `<img class="reporter-card-avatar" src="https://unavatar.io/x/${esc(bare)}" alt="" onerror="this.style.display='none'">` +
              `${esc(r.name)}</button>`;
      }).join('');

      // Active-chip clear button
      const activeChip = document.getElementById('reporter-active-chip');
      if (activeChip) {
          activeChip.addEventListener('click', () => {
              window._tweetFilter   = null;
              window._tweetUserMode = false;
              applyTweetFilter();
              fetchTweets();
          });
      }

      row.addEventListener('click', e => {
          const card = e.target.closest('.reporter-card');
          if (!card) return;
          const handle = card.dataset.handle;
          if (window._tweetFilter === handle) {
              // Deselect → back to list feed
              window._tweetFilter   = null;
              window._tweetUserMode = false;
              applyTweetFilter();
              fetchTweets();
          } else {
              // Select → load that user's profile; update card states only,
              // do NOT filter the existing feed so it stays visible until new data arrives
              window._tweetFilter   = handle;
              window._tweetUserMode = true;
              document.querySelectorAll('.reporter-card').forEach(c => {
                  c.classList.toggle('active', c.dataset.handle === handle);
              });
              fetchTweets(null, handle.replace('@', ''));
          }
      });

      const searchBtn     = document.getElementById('reporter-search-btn');
      const searchRow     = document.getElementById('reporter-search-drawer');   // the clipping box the open/close animation resizes
      const searchInput   = document.getElementById('reporter-search-input');
      const searchResults = document.getElementById('reporter-search-results');
      const searchClear   = document.getElementById('reporter-search-clear');

      // Build search index from REPORTER_NAMES + any extra default-card handles not in the map
      const searchIndex = Object.entries(REPORTER_NAMES).map(([handle, name]) => ({ handle, name }));
      DEFAULT_REPORTER_CARDS.forEach(r => {
          if (!REPORTER_NAMES[r.handle]) searchIndex.push({ handle: r.handle, name: r.name });
      });

      // the same drawer the Whip filter uses (lib/animations.js); without it, a plain show and hide
      const setRow = (open) => {
          const A = globalThis.BoardAnimations;
          if (A && A.openDrawer) { if (open) A.openDrawer(searchRow); else A.closeDrawer(searchRow); }
          else searchRow.hidden = !open;
      };

      if (searchBtn && searchRow && searchInput) {
          searchBtn.addEventListener('click', () => {
              const isOpen = !searchRow.hidden;
              setRow(!isOpen);
              // the box says what it searches and rotates through real handles and names (lib/search-field.js), once it is on screen
              if (!isOpen && globalThis.SearchField) SearchField.mount(searchInput, { fields: ['Handle', 'Name'], examples: searchIndex.flatMap((r) => [r.handle, r.name]) });
              if (!isOpen) {
                  searchInput.focus();
                  if (searchResults) searchResults.style.display = 'none';
              }
          });

          if (searchResults) {
              searchInput.addEventListener('input', () => {
                  const val = searchInput.value.trim().toLowerCase();
                  if (!val) { searchResults.style.display = 'none'; return; }
                  const matches = searchIndex.filter(({ handle, name }) =>
                      handle.replace('@', '').toLowerCase().includes(val) ||
                      name.toLowerCase().includes(val)
                  ).slice(0, 8);
                  if (!matches.length) { searchResults.style.display = 'none'; return; }
                  searchResults.innerHTML = matches.map(({ handle, name }) =>
                      `<button class="reporter-search-result" data-handle="${esc(handle)}">` +
                      `<span class="reporter-result-name">${esc(name)}</span>` +
                      `<span class="reporter-result-handle">${esc(handle)}</span>` +
                      `</button>`
                  ).join('');
                  searchResults.style.display = '';
              });

              searchResults.addEventListener('click', e => {
                  const btn = e.target.closest('.reporter-search-result');
                  if (!btn) return;
                  const handle = btn.dataset.handle;
                  window._tweetFilter   = handle;
                  window._tweetUserMode = true;
                  document.querySelectorAll('.reporter-card').forEach(c => {
                      c.classList.toggle('active', c.dataset.handle === handle);
                  });
                  fetchTweets(null, handle.replace('@', ''));
                  searchResults.style.display = 'none';
                  searchInput.value = '';
                  setRow(false);
              });
          }

          searchInput.addEventListener('keydown', e => {
              if (e.key === 'Escape') {
                  setRow(false);
                  if (searchResults) searchResults.style.display = 'none';
                  searchInput.value = '';
              }
          });

          if (searchClear) {
              searchClear.addEventListener('click', () => {
                  searchInput.value = '';
                  if (searchResults) searchResults.style.display = 'none';
                  window._tweetFilter   = null;
                  window._tweetUserMode = false;
                  applyTweetFilter();
                  fetchTweets();
                  setRow(false);
              });
          }
      }
  }


  function init(opts) {
    CFG = { api: opts.api, cards: opts.cards || [] };
    fetchTweets();
    initReporterCards();
  }

  globalThis.Reporters = { init, push: (data) => fetchTweets(data), refresh: () => fetchTweets() };
})();
