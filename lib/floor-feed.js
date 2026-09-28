// Floor feed PiP — the corner video, its controls and its caption track.
//
// Lifted out of app.js unchanged except for where the stream URL comes from.
// The House board has always had this; the Senate board has carried the markup
// for it since it was copied over, invisible, because `.floor-feed` is
// opacity:0 until this code adds `pip-active` at the end of init.
//
// Everything in here was already self-contained: scanned for references out to
// app.js and the only one was `Hls`, the hls.js global, which both pages load.
// So this is a move, not a rewrite, and the House behaviour is byte-identical.
//
// To light it up on a chamber, call init with an endpoint that answers
// { url, isLive }. There is no Senate floor video source yet, which is the only
// reason senate.js does not call this.
//
//   FloorFeed.init({ hlsUrl: 'https://api.evanhollander.org/house-floor/api/hls-url' });

(() => {
  function init(opts) {
    const HLS_URL_ENDPOINT = opts && opts.hlsUrl;
    // No endpoint, no player. The panel stays invisible rather than sitting
    // there saying ACQUIRING FEED at a feed that does not exist.
    if (!HLS_URL_ENDPOINT) return;

    const pip         = document.getElementById('floor-feed');
    const pipVideo    = document.getElementById('player-pip');
    const backdrop    = document.getElementById('pip-backdrop');
    const pipOverlay  = pip?.querySelector('.floor-feed-overlay');
    const closeBtn    = document.getElementById('pip-close-btn');
    if (!pip || !pipVideo) return;

    const pipSnapshot = document.getElementById('player-pip-snapshot');
    const pipLoading  = document.getElementById('pip-loading');
    let pipHls          = null;
    let pipSnapshotHls  = null; // short-lived HLS instance used only to grab the last frame of a finished VOD
    let pipWaitTimer    = null;
    let expanded        = false;
    let edgeKeeper      = null; // interval pinning live playback to the edge
    let pipFrozen       = false; // true once a last-frame snapshot has been captured
    // Bumped on every loadPip(). Snapshot/freeze callbacks capture the value at
    // schedule time and bail if it changed — so an in-flight last-frame grab can
    // never pause/hide a newer live stream that started in the meantime.
    let pipGen          = 0;

    // Enable embedded CEA-608/708 captions on the PiP video. The House feed
    // carries multiple tracks (English CC1 + Spanish), so prefer English and
    // explicitly disable the others — otherwise the first track (sometimes
    // Spanish) would show. Tracks may appear before or after load.
    function isEnglishTrack(t) {
        const lang = (t.language || '').toLowerCase();
        const label = (t.label || '').toLowerCase();
        if (lang) return lang.startsWith('en');
        // No language tag (common for CEA-608): fall back to label heuristics.
        // CC1 is the primary English service; treat unlabeled as English too.
        return /english|cc1|^cc$|primary/.test(label) || label === '';
    }
    // Custom caption rendering: we set the chosen track to 'hidden' (cues stay
    // active and fire cuechange, but the browser does NOT draw them), then paint
    // the active cues into our own overlay. This gives full control over size
    // (scales to the PiP via cq units) and position (always bottom-center),
    // instead of the native 608 renderer's fixed sizing/positioning.
    let pipCaptionTrack = null;
    let pipCaptionOverlay = null;
    function captionOverlay() {
        if (pipCaptionOverlay && pipCaptionOverlay.isConnected) return pipCaptionOverlay;
        const host = pipVideo.parentElement; // .floor-feed-video
        let el = host?.querySelector('.pip-caption-overlay');
        if (!el && host) {
            el = document.createElement('div');
            el.className = 'pip-caption-overlay';
            host.appendChild(el);
        }
        pipCaptionOverlay = el;
        return el;
    }
    let pipCaptionText = '';       // currently displayed text (for dedupe)
    let pipCaptionClearTimer = null;
    // True pop-on: hold the last COMPLETE two-line block on screen, and only swap
    // to the next block once both of its lines are finished — so the caption never
    // scrolls line-by-line and is always a stable two-line frame (one pair behind
    // the audio, like TV pop-on).
    let capDisp = ['', '']; // the held block currently shown
    let capPend = ['', '']; // the next block being built (top, then bottom)
    let capPendSlot = 0;    // which pending line the building line fills
    let capBuilding = '';   // the line currently being spoken (roll-up bottom)

    function commitCaption(el, text) {
        if (text === pipCaptionText) return;
        if (window.__capDebug) console.log('[cap] →', JSON.stringify(text));
        pipCaptionText = text;
        el.textContent = text;
        el.classList.toggle('has-text', !!text);
    }

    let captionsEnabled = true; // CC button only HIDES the overlay (via the
    // .captions-off class); the pop-on frame keeps building in the background so
    // re-enabling shows the current caption immediately.
    function renderActiveCues() {
        const el = captionOverlay();
        if (!el) return;
        const cues = pipCaptionTrack && pipCaptionTrack.activeCues ? [...pipCaptionTrack.activeCues] : [];

        // Senate TV puts the whole roll-up window inside ONE cue, newlines and
        // all: "DIFFERENCE OF OPINION, AND EVEN\nBRET KAVANAUGH IN THE\nDECISION
        // OF OLSTON". The House sends one line per cue, which is what the pop-on
        // block below is built for. Flattening a Senate cue's newlines to spaces
        // made each "line" three times too long, and two of those wrapped to six
        // rows in a panel this narrow.
        //
        // So a multi-line cue is already the block and skips the state machine.
        //
        // Its LAST line is the one the stenographer is typing, growing a word at
        // a time; the lines above it are finished. Showing the last two meant
        // watching the bottom line being written live. Dropping it and showing
        // the two completed lines above is the same pop-on rule the House path
        // follows -- a line appears once it is done -- and costs no delay,
        // because completion is already signalled by a line existing above the
        // one still being typed.
        //
        // House cues have no newlines and never take this path.
        const newest = cues.length ? cues[cues.length - 1] : null;
        const rawNewest = newest ? String(newest.text || '').replace(/<[^>]+>/g, '') : '';
        if (rawNewest.includes('\n')) {
            const rows = rawNewest.split(/\n+/).map((r) => r.replace(/\s+/g, ' ').trim()).filter(Boolean);
            if (pipCaptionClearTimer) { clearTimeout(pipCaptionClearTimer); pipCaptionClearTimer = null; }
            commitCaption(el, rows.slice(0, -1).slice(-2).join('\n'));
            return;
        }
        // Order top→bottom by reading order. Roll-up cues share a startTime and
        // hls.js hands them newest-first, so reverse the array index on ties.
        const indexed = cues.map((c, idx) => ({ c, idx }));
        indexed.sort((a, b) => (a.c.startTime - b.c.startTime) || (b.idx - a.idx));
        const lines = [];
        for (const { c } of indexed) {
            const t = (c.text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            if (t && t !== lines[lines.length - 1]) lines.push(t);
        }
        const building = lines[lines.length - 1] || ''; // bottom = newest = in-progress line

        if (!building) {
            // The cue stream briefly empties between speech segments (~1-3s). Keep
            // the current block on screen and only clear after a genuinely long
            // gap, so normal pauses don't blank the captions (which then skipped
            // content while the pop-on rebuilt).
            if (pipCaptionText && !pipCaptionClearTimer) {
                pipCaptionClearTimer = setTimeout(() => {
                    pipCaptionClearTimer = null;
                    capDisp = ['', '']; capPend = ['', '']; capPendSlot = 0; capBuilding = '';
                    commitCaption(el, '');
                }, 6000);
            }
            return;
        }
        if (pipCaptionClearTimer) { clearTimeout(pipCaptionClearTimer); pipCaptionClearTimer = null; }

        if (building === capBuilding) {
            return; // no change
        }
        if (!capBuilding || building.startsWith(capBuilding)) {
            // First line of a block, or the same line still growing word-by-word.
            capBuilding = building;
            capPend[capPendSlot] = building;
        } else {
            // A new line started → the current pending line just finalized.
            if (capPendSlot === 0) {
                // Top line of the pending block is done; start filling the bottom.
                capPendSlot = 1;
                capPend[1] = building;
            } else {
                // Bottom line done → the pending PAIR is complete. Pop it onto the
                // display (both lines swap at once), and begin the next block.
                capDisp = [capPend[0], capPend[1]];
                capPend = [building, ''];
                capPendSlot = 0;
            }
            capBuilding = building;
        }
        // Only the held, complete block is shown — the in-progress pending block
        // is not displayed until it finishes (true pop-on).
        commitCaption(el, capDisp.filter(Boolean).join('\n'));
    }
    let pipCaptionPoll = null;
    // The video's own CEA-608 track, accumulated for the speaker readout.
    //
    // These cues arrive AHEAD of the picture, while captions.vtt — the sidecar the
    // server parses — is rewritten by the Clerk only every 70-78 seconds. Reading
    // hand-offs off this track is the difference between naming the new speaker as
    // the chair recognises them and naming them a minute later.
    //
    // Roll-up captions repeat the previous line with every new one, so this dedupes
    // by text and keeps a bounded tail: only the recent past can contain a hand-off
    // that has not already been reflected.
    const LIVE_TEXT_MAX = 12000;
    let liveCaptionText = '';
    let liveFirstCueAt = 0;   // when this stream's live track started producing
    let liveLastCueAt = 0;    // when it last did, so a stalled track stops counting
    // Total characters ever appended. liveCaptionText is truncated from the front,
    // so an offset within it shifts as the stream grows; this does not, which is
    // what lets the readout tell one hand-off from the next.
    let liveTotalChars = 0;
    // (characterCount, wallClock) marks, so any position in the stream can be dated.
    // Without this a hand-off is dated when the READOUT first resolved it, which is
    // not when it was spoken: the roster loads asynchronously, so the first
    // successful resolve can land minutes after the text arrived and stamp an old
    // hand-off as brand new — which is how a finished speaker outranks the server.
    const liveMarks = [];
    const _liveSeen = new Set();

    function harvestLiveCues() {
        if (!pipCaptionTrack || !pipCaptionTrack.cues) return;
        const cues = pipCaptionTrack.cues;
        // Only cues playback has actually reached.
        //
        // The track holds everything buffered, which runs AHEAD of the picture —
        // measured at cue start 21607.8 against a currentTime of 21605 — so reading
        // the whole list named the next speaker several seconds before the viewer
        // could hear the chair recognise them. A cue beyond the playhead is not
        // skipped permanently, just left for the tick that reaches it.
        const playhead = pipVideo.currentTime;
        let added = '';
        for (let i = 0; i < cues.length; i++) {
            if (cues[i].startTime > playhead) continue;
            const line = (cues[i].text || '').replace(/\s+/g, ' ').trim();
            if (!line || _liveSeen.has(line)) continue;
            _liveSeen.add(line);
            added += (added ? ' ' : '') + line;
        }
        if (!added) return;
        const now = Date.now();
        if (!liveFirstCueAt) liveFirstCueAt = now;
        liveLastCueAt = now;
        liveTotalChars += added.length + 1;
        liveMarks.push({ c: liveTotalChars, t: now });
        while (liveMarks.length > 600) liveMarks.shift();
        liveCaptionText = (liveCaptionText + ' ' + added).slice(-LIVE_TEXT_MAX);
        // The dedupe set must not grow all session; the tail is what matters.
        if (_liveSeen.size > 4000) _liveSeen.clear();
        if (typeof window.__onLiveCaptionText === 'function') window.__onLiveCaptionText(liveCaptionText);
    }
    window.__liveCaptionText = () => liveCaptionText;
    // How long the live track has been watched without interruption. The speaker
    // readout uses this to decide whether the server's older snapshot leaves any
    // window unaccounted for.
    window.__liveCaptionMeta = () => ({ firstCueAt: liveFirstCueAt, lastCueAt: liveLastCueAt, totalChars: liveTotalChars });
    // When the text at this character position arrived. Older than every mark we
    // still hold means older than the window itself, so it is dated to the oldest
    // mark — old enough to lose to anything the server has.
    window.__liveCaptionTimeAt = (pos) => {
        if (!liveMarks.length) return 0;
        for (const m of liveMarks) if (m.c >= pos) return m.t;
        return liveMarks[liveMarks.length - 1].t;
    };

    function enablePipCaptions() {
        const tracks = [...pipVideo.textTracks].filter(t => t.kind === 'captions' || t.kind === 'subtitles');
        if (!tracks.length) return false;
        const english = tracks.find(isEnglishTrack) || tracks[0];
        // 'hidden' (not 'showing') keeps cues active without native rendering.
        for (const t of tracks) t.mode = (t === english) ? 'hidden' : 'disabled';
        pipCaptionTrack = english;
        // Poll activeCues rather than relying on 'cuechange': Safari does NOT
        // reliably fire cuechange on hidden tracks, but it DOES keep activeCues
        // populated. renderActiveCues dedupes, so a 250ms poll is cheap and
        // repaints only when the caption text actually changes.
        if (!pipCaptionPoll) pipCaptionPoll = setInterval(() => { renderActiveCues(); harvestLiveCues(); }, 250);
        // Also listen for cuechange where it does fire (Chrome) for instant updates.
        english.removeEventListener('cuechange', renderActiveCues);
        english.addEventListener('cuechange', renderActiveCues);
        renderActiveCues();
        return true;
    }

    function hidePipLoading() { if (pipLoading) pipLoading.style.display = 'none'; }
    function resetPipLoading() {
        if (!pipLoading) return;
        pipLoading.style.transition = '';
        pipLoading.style.opacity    = '';
        pipLoading.style.display    = 'flex';
    }

    // Grab the current video frame into pipSnapshot and switch to the still image.
    // `gen` is the loadPip generation this grab belongs to; if a newer stream has
    // loaded since it was scheduled, abort so we never freeze/hide a live video.
    function captureCurrentFrame(gen) {
        if (gen !== pipGen || pipFrozen || !pipSnapshot || !pipVideo.videoWidth) return;
        try {
            // Capture at roughly twice the size it is displayed, as JPEG. At full
            // video resolution as PNG this produced a 2.3MB data URL for a box
            // 218px wide: all of that has to be encoded, assigned and decoded
            // before the still appears, which is dead time on every load where
            // the House is not sitting.
            const CAP_W = 640;
            const scale = pipVideo.videoWidth > CAP_W ? CAP_W / pipVideo.videoWidth : 1;
            const c = document.createElement('canvas');
            c.width  = Math.round(pipVideo.videoWidth  * scale);
            c.height = Math.round(pipVideo.videoHeight * scale);
            c.getContext('2d').drawImage(pipVideo, 0, 0, c.width, c.height);
            const dataUrl = c.toDataURL('image/jpeg', 0.82);
            if (!dataUrl || dataUrl === 'data:,') return;
            if (gen !== pipGen) return; // a live stream loaded during the draw — don't freeze it
            pipFrozen = true;
            // Decode before swapping. Setting src and revealing the image in the
            // same breath left a frame where the image had nothing to paint, the
            // loading overlay's black backing was already gone and the video was
            // already hidden -- and .floor-feed's rounded, translateZ'd clip edge
            // showed through it as a pale hairline. That flash and the caption
            // disappearing were the same moment.
            // Cross-fade rather than swap. The overlay is solid black and the
            // still is a brightly lit chamber, so exchanging one for the other in
            // a single frame is a hard jump from dark to light -- which is what
            // read as a flash, and why the caption looked like it dropped out
            // rather than ended. Fading both on the same curve means no frame
            // where the brightness changes abruptly and no frame where the
            // rounded clip edge has nothing painted against it.
            const FADE = 220;
            const reveal = () => {
                if (gen !== pipGen) return;
                pipSnapshot.style.opacity    = '0';
                pipSnapshot.style.display    = 'block';
                pipSnapshot.removeAttribute('hidden');
                void pipSnapshot.offsetHeight;
                pipSnapshot.style.transition = `opacity ${FADE}ms ease`;
                pipSnapshot.style.opacity    = '1';
                if (pipLoading) {
                    pipLoading.style.transition = `opacity ${FADE}ms ease`;
                    pipLoading.style.opacity    = '0';
                }
                // Settle unconditionally: transitions do not run in a hidden tab.
                setTimeout(() => {
                    if (gen !== pipGen) return;
                    pipVideo.style.display = 'none';
                    hidePipLoading();
                    if (pipLoading) { pipLoading.style.transition = ''; pipLoading.style.opacity = ''; }
                    pipSnapshot.style.transition = '';
                    pipSnapshot.style.opacity    = '';
                }, FADE + 40);
            };
            pipSnapshot.src = dataUrl;
            if (pipSnapshot.decode) pipSnapshot.decode().then(reveal, reveal);
            else reveal();
        } catch {}
    }

    // Seek to the last buffered frame, play one frame to decode it, then freeze.
    // Bails if a newer stream loaded (gen mismatch); retry is capped (~6s).
    function freezePipAtEnd(gen, tries = 0) {
        if (gen !== pipGen || pipFrozen) return;
        const end = pipVideo.seekable.length ? pipVideo.seekable.end(pipVideo.seekable.length - 1) : NaN;
        if (!isFinite(end) || end <= 1) {
            if (tries < 20) setTimeout(() => freezePipAtEnd(gen, tries + 1), 300);
            return;
        }
        const onSeeked = () => {
            const tryGrab = () => {
                if (gen !== pipGen) return;
                if (pipVideo.videoWidth > 0) { pipVideo.pause(); captureCurrentFrame(gen); }
                else { requestAnimationFrame(tryGrab); }
            };
            pipVideo.play().then(() => requestAnimationFrame(tryGrab)).catch(() => requestAnimationFrame(tryGrab));
        };
        pipVideo.addEventListener('seeked', onSeeked, { once: true });
        pipVideo.currentTime = end - 0.3;
    }

    // Load a finished VOD URL, seek to the last second, and freeze on that frame.
    // Used when the page loads while the house is already adjourned.
    function loadPipSnapshot(url) {
        if (pipFrozen) return;
        const gen = pipGen; // tied to the current load; a live loadPip bumps pipGen and invalidates this
        if (pipSnapshotHls) { try { pipSnapshotHls.destroy(); } catch {} pipSnapshotHls = null; }
        if (window.Hls && Hls.isSupported()) {
            const hls = new Hls({ capLevelToPlayerSize: false, startLevel: 0 });
            pipSnapshotHls = hls;
            hls.loadSource(url);
            hls.attachMedia(pipVideo);
            pipVideo.muted = true;
            let grabbed = false;
            hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
                if (grabbed || gen !== pipGen) return;
                const dur = data.details?.totalduration;
                if (!isFinite(dur) || dur < 2) return;
                grabbed = true;
                const onSeeked = () => {
                    const tryGrab = () => {
                        if (gen !== pipGen) { try { hls.destroy(); } catch {} if (pipSnapshotHls === hls) pipSnapshotHls = null; return; }
                        if (pipVideo.videoWidth > 0) {
                            pipVideo.pause();
                            captureCurrentFrame(gen);
                            try { hls.destroy(); } catch {}
                            if (pipSnapshotHls === hls) pipSnapshotHls = null;
                        } else { requestAnimationFrame(tryGrab); }
                    };
                    pipVideo.play().then(() => requestAnimationFrame(tryGrab)).catch(() => {
                        try { hls.destroy(); } catch {}
                        if (pipSnapshotHls === hls) pipSnapshotHls = null;
                    });
                };
                pipVideo.addEventListener('seeked', onSeeked, { once: true });
                pipVideo.currentTime = dur - 1;
            });
            hls.on(Hls.Events.ERROR, (_, d) => {
                if (d.fatal) { try { hls.destroy(); } catch {} if (pipSnapshotHls === hls) pipSnapshotHls = null; }
            });
        } else if (pipVideo.canPlayType('application/vnd.apple.mpegurl')) {
            pipVideo.src = url;
            pipVideo.muted = true;
            pipVideo.addEventListener('loadedmetadata', () => {
                if (isFinite(pipVideo.duration) && pipVideo.duration > 2) pipVideo.currentTime = pipVideo.duration - 1;
            }, { once: true });
            pipVideo.addEventListener('seeked', () => freezePipAtEnd(gen), { once: true });
            pipVideo.load();
        }
    }

    // Match the rendition to the size the video is actually being drawn at.
    //
    // Expanded, the PiP is a real video player and gets the top rendition — that
    // is the point of expanding. Collapsed it is ~220px wide, and decoding the
    // 1280x720 rendition into it was throwing away roughly three quarters of every
    // frame while the two-second live buffer below left no slack to absorb the
    // cost: measured 13-42% dropped frames on the collapsed PiP. Picking the
    // smallest rendition that still covers the box at this display's pixel ratio
    // keeps it sharp and stops the stutter.
    function applyPipLevel() {
        if (!pipHls || !pipHls.levels || !pipHls.levels.length) return;
        const top = pipHls.levels.length - 1;
        if (expanded) { pipHls.nextLevel = top; return; }
        const dpr = window.devicePixelRatio || 1;
        const need = Math.round(pipVideo.getBoundingClientRect().width * dpr);
        if (!need) { pipHls.nextLevel = top; return; }   // not laid out yet — no basis to choose
        let best = top;
        for (let i = 0; i < pipHls.levels.length; i++) {
            const w = pipHls.levels[i].width || 0;
            if (w >= need && w < (pipHls.levels[best].width || Infinity)) best = i;
        }
        pipHls.nextLevel = best;
    }

    // Audio is controlled explicitly by the mute button (below), NOT by
    // expanding/collapsing — so expand/collapse no longer touch muted state.
    function expand() {
        if (expanded) return;
        expanded = true;
        pip.classList.add('pip-expanded');
        if (backdrop) backdrop.classList.add('pip-backdrop-visible');
        if (pipOverlay) pipOverlay.style.pointerEvents = 'none';
        applyPipLevel();
    }

    function collapse() {
        if (!expanded) return;
        expanded = false;
        pip.classList.remove('pip-expanded');
        if (backdrop) backdrop.classList.remove('pip-backdrop-visible');
        if (pipOverlay) pipOverlay.style.pointerEvents = 'auto';
        // Let the collapse transition finish before measuring, or `need` is taken
        // from the expanded box and the top rendition is chosen for a thumbnail.
        setTimeout(applyPipLevel, 250);
    }

    // Mute/unmute toggle
    // ── Live audio tap ────────────────────────────────────────────────────────
    //
    // Feeds the level meter beside the speaker's name from the floor's real audio.
    //
    // captureStream() taps the element's media directly, and crucially it keeps
    // delivering audio while the element is MUTED — verified on the live stream:
    // peak-to-peak 1, 161, 5, 1, 1, 125, 33, 3 with muted true and playback
    // untouched. That matters because the obvious route, createMediaElementSource,
    // hands back pure silence from a muted element, and unmuting to fix that is
    // what froze the video: unmuting an autoplaying element without a user gesture
    // makes Chrome pause it.
    //
    // So nothing here touches `muted`, needs a gesture, or reroutes the element's
    // own audio. The mute button below is left exactly as it was.
    let audioTap = null;        // { ctx, analyser, buf, history }
    let audioTapTried = false;
    let audioTapNextTry = 0;

    function ensureAudioTap() {
        // Called from the meter's animation frame, so the retry is throttled: the
        // audio track is not there the instant the element is, and captureStream()
        // mints a new MediaStream every call.
        if (audioTapTried || performance.now() < audioTapNextTry) return;
        const capture = pipVideo.captureStream || pipVideo.mozCaptureStream;
        if (!capture) { audioTapTried = true; return; }
        audioTapNextTry = performance.now() + 1000;
        try {
            const stream = capture.call(pipVideo);
            if (!stream.getAudioTracks().length) return;   // audio not up yet; retry later
            audioTapTried = true;
            const AC = window.AudioContext || window.webkitAudioContext;
            const ctx = new AC();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            ctx.createMediaStreamSource(stream).connect(analyser);
            // Sunk through a silent gain: some engines will not pull a stream source
            // that reaches no destination, and zero gain guarantees the tap stays
            // inaudible no matter what the element is doing.
            const sink = ctx.createGain(); sink.gain.value = 0;
            analyser.connect(sink); sink.connect(ctx.destination);
            ctx.resume().catch(() => {});
            audioTap = { ctx, analyser, buf: new Uint8Array(analyser.fftSize) };
        } catch (_) {
            audioTap = null;
        }
    }
    // An AudioContext created before any interaction can start suspended; a gesture
    // is the only thing that can start it. Harmless when it is already running.
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
        window.addEventListener(ev, () => { audioTap && audioTap.ctx.resume().catch(() => {}); },
            { capture: true, passive: true }));

    // A single loudness figure, 0..1, or null when there is no real audio to read.
    // The meter owns the scrolling history so that this and the caption-flow
    // fallback below can feed the same animation.
    window.__pipAudioLevel = () => {
        ensureAudioTap();
        if (!audioTap || audioTap.ctx.state !== 'running' || pipVideo.paused) return null;
        audioTap.analyser.getByteTimeDomainData(audioTap.buf);
        let sum = 0;
        for (let i = 0; i < audioTap.buf.length; i++) {
            const d = (audioTap.buf[i] - 128) / 128;
            sum += d * d;
        }
        const rms = Math.sqrt(sum / audioTap.buf.length);
        // Speech RMS sits low; the curve lifts quiet passages into visible range
        // without letting loud ones peg.
        return Math.min(1, Math.pow(rms * 3.2, 0.7));
    };

    const muteBtn = document.getElementById('pip-mute-btn');
    function syncMuteBtn() {
        if (!muteBtn) return;
        const unmuted = !pipVideo.muted;
        muteBtn.classList.toggle('is-unmuted', unmuted);
        muteBtn.setAttribute('aria-pressed', String(unmuted));
        muteBtn.setAttribute('aria-label', unmuted ? 'Mute' : 'Unmute');
        muteBtn.title = unmuted ? 'Mute' : 'Unmute';
    }
    if (muteBtn) {
        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            pipVideo.muted = !pipVideo.muted;
            if (!pipVideo.muted) pipVideo.play().catch(() => {});
            syncMuteBtn();
        });
        pipVideo.addEventListener('volumechange', syncMuteBtn);
        syncMuteBtn();
    }

    // CC toggle (closed captions on/off)
    const ccBtn = document.getElementById('pip-cc-btn');
    if (ccBtn) {
        ccBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            captionsEnabled = !captionsEnabled;
            ccBtn.classList.toggle('is-on', captionsEnabled);
            ccBtn.setAttribute('aria-pressed', String(captionsEnabled));
            // Just hide/show the overlay — captions keep building in the background.
            const ov = captionOverlay();
            if (ov) ov.classList.toggle('captions-off', !captionsEnabled);
        });
    }

    if (pipOverlay) pipOverlay.addEventListener('click', expand);
    if (backdrop) backdrop.addEventListener('click', collapse);
    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); collapse(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expanded) collapse(); });

    // Keep live playback near the edge WITHOUT causing jitter. Frequent small
    // seeks (old: >8s drift every 5s) made the video stutter as it kept snapping
    // forward. Now we only correct a genuinely large fall-behind (>20s), checked
    // every 12s, and land a few seconds back from the edge so it settles instead
    // of immediately drifting past the threshold again.
    function startEdgeKeeper() {
        if (edgeKeeper) clearInterval(edgeKeeper);
        edgeKeeper = setInterval(() => {
            if (pipVideo.paused || pipVideo.seekable.length === 0) return;
            const edge = pipVideo.seekable.end(pipVideo.seekable.length - 1);
            if (isFinite(edge) && (edge - pipVideo.currentTime) > 20) {
                pipVideo.currentTime = edge - 4;
            }
        }, 12000);
    }

    // When the live stream ends, freeze on the last frame. Registered once on the
    // persistent video element; reads pipGen at fire time (the current stream's).
    pipVideo.addEventListener('ended', () => freezePipAtEnd(pipGen));

    // Load the live stream
    function loadPip(url) {
        // A new stream means the live caption watch starts over: the old text
        // belongs to a different timeline and must not be credited as coverage.
        liveCaptionText = '';
        liveFirstCueAt = 0;
        liveLastCueAt = 0;
        liveTotalChars = 0;
        liveMarks.length = 0;
        _liveSeen.clear();
        pipFrozen = false;
        const gen = ++pipGen; // invalidates any in-flight snapshot/freeze from a prior load
        if (pipSnapshotHls) { try { pipSnapshotHls.destroy(); } catch {} pipSnapshotHls = null; }
        pipVideo.style.display = 'block';
        if (pipSnapshot) { pipSnapshot.style.display = 'none'; pipSnapshot.setAttribute('hidden', ''); }
        pipVideo.muted = true;
        if (window.Hls && Hls.isSupported()) {
            if (pipHls) { try { pipHls.destroy(); } catch {} pipHls = null; }
            pipHls = new Hls({
                // Enough buffer to actually survive a hiccup. At maxBufferLength 2
                // with liveSyncDurationCount 1 the player sat one 2s segment from
                // the live edge and repeatedly ran the buffer to zero; measured on
                // the live feed, frames dropped exactly when it did — 0 dropped per
                // 4s while 2s were buffered, 29 then 61 once the buffer hit 0.
                //
                // Six seconds behind the edge instead of two costs nothing that
                // matters here: the speaker attribution beside this video comes
                // from captions that already trail the picture by about 90s, so
                // four more seconds of video latency is not perceptible in context.
                maxBufferLength: 10, maxMaxBufferLength: 30,
                liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 10,
                liveDurationInfinity: true,
                // The level is chosen explicitly in applyPipLevel() rather than by
                // hls.js, because it has to follow expand/collapse rather than the
                // element's size at load time.
                capLevelToPlayerSize: false,
                startLevel: -1,
            });
            pipHls.loadSource(url);
            pipHls.attachMedia(pipVideo);
            pipVideo.addEventListener('canplay', hidePipLoading, { once: true });
            pipHls.on(Hls.Events.MANIFEST_PARSED, () => {
                applyPipLevel();
                pipVideo.play().catch(() => {});
                startEdgeKeeper();
            });
            pipHls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, enablePipCaptions);
            pipHls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { hidePipLoading(); captureCurrentFrame(gen); } });
        } else if (pipVideo.canPlayType('application/vnd.apple.mpegurl')) {
            pipVideo.src = url;
            pipVideo.play().catch(() => {});
            pipVideo.addEventListener('canplay', hidePipLoading, { once: true });
            startEdgeKeeper();
        }
        // Captions: scan now, on new tracks, and poll for the first 20s.
        pipVideo.textTracks.addEventListener('addtrack', enablePipCaptions);
        let capTries = 0;
        const capPoll = setInterval(() => {
            if (enablePipCaptions() || ++capTries > 20) clearInterval(capPoll);
        }, 1000);
    }

    // Fetch stream and load; retry while the feed is still not live.
    // The timer callback clears its own guard before re-entering fetchAndLoad().
    function scheduleFetchAndLoad(delayMs = 5000) {
        if (pipWaitTimer !== null) clearTimeout(pipWaitTimer);
        pipWaitTimer = setTimeout(() => {
            pipWaitTimer = null;
            fetchAndLoad();
        }, delayMs);
    }

    function fetchAndLoad() {
        if (pipWaitTimer !== null) return;
        pipWaitTimer = -1;
        fetch(HLS_URL_ENDPOINT)
            .then(r => r.json())
            .then(d => {
                pipWaitTimer = null;
                if (d?.url && d.isLive) {
                    loadPip(d.url);
                } else if (d?.url && !pipFrozen) {
                    // Leave "acquiring feed" up. loadPipSnapshot has to fetch the
                    // manifest, seek to the end and decode a frame before there is
                    // anything to display; hiding the indicator first left the panel
                    // blank for those few seconds, which reads as the feed being
                    // broken rather than loading. captureCurrentFrame hides it once
                    // the still is actually on screen.
                    loadPipSnapshot(d.url);
                    scheduleFetchAndLoad();
                } else {
                    hidePipLoading();
                    scheduleFetchAndLoad();
                }
            })
            .catch(() => {
                pipWaitTimer = null;
                scheduleFetchAndLoad();
            });
    }

    // Always show PiP immediately
    pip.classList.add('pip-active');
    fetchAndLoad();
  }

  globalThis.FloorFeed = { init };
})();
