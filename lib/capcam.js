// The Capitol camera in the header: a live view of the building behind the
// weather readout, shown while the pointer is over it.
//
// Shared by both boards. The camera is the Capitol, not a chamber, and it is a
// Senate-hosted stream even on the House board, so the two copies of this were
// pointed at the same URL and had drifted apart in behaviour. The House's was
// the careful one and is what is kept:
//
//   - Nothing is fetched until the first hover. A live video that nobody is
//     looking at costs a steady download, and this one is in the header of a
//     page that is usually left open in a background tab.
//   - A short buffer (4 to 8 seconds). It is a live view; a deep buffer only
//     makes it older.
//   - It pauses when the pointer leaves, and resumes on the next hover.
//   - A fatal stream error tears the player down so the next hover starts clean,
//     where the Senate's copy was left holding a dead one.
//
//   CapCam.init(document.getElementById('weather-panel'),
//               document.getElementById('capcam-video'))

(() => {
  const CAPCAM_URL = 'https://www-senate-gov-media-srs.akamaized.net/hls/live/2036784/capcam/capcam/master.m3u8';

  // The camera's playlist is an EVENT playlist that has never been trimmed: segment 1 onward, 12 s each,
  // so about 94,000 entries (3 MB, 217 KB gzipped) and growing, re-downloaded and re-parsed by hls.js on
  // every refresh. Only the last few segments matter to a live view, so this loader cuts the playlist to
  // them as it arrives, advancing MEDIA-SEQUENCE by what it dropped so the segment numbers stay true, and
  // drops PLAYLIST-TYPE:EVENT so hls.js treats it as the sliding window it is used as. (The download is
  // still the whole file; nothing client-side can ask for less.) Pass `CapCam.hlsConfig` to `new Hls`.
  const KEEP = 8;
  function trimPlaylist(text, keep = KEEP) {
    if (typeof text !== 'string' || text.length < 20000 || !text.includes('#EXTINF')) return text;
    const lines = text.split('\n');
    const first = lines.findIndex((l) => l.startsWith('#EXTINF'));
    const head = lines.slice(0, first).filter((l) => !l.startsWith('#EXT-X-PLAYLIST-TYPE'));
    const segs = [];
    let end = [];
    for (let i = first; i < lines.length; i++) {
      if (lines[i].startsWith('#EXTINF') && i + 1 < lines.length) { segs.push([lines[i], lines[i + 1]]); i++; }
      else if (lines[i].startsWith('#EXT-X-ENDLIST')) end = [lines[i]];
    }
    const drop = Math.max(0, segs.length - keep);
    const at = head.findIndex((l) => l.startsWith('#EXT-X-MEDIA-SEQUENCE'));
    if (at < 0) return text; // cannot keep the numbering true: leave it whole
    head[at] = `#EXT-X-MEDIA-SEQUENCE:${Number(head[at].split(':')[1]) + drop}`;
    return head.concat(...segs.slice(drop)).concat(end).join('\n');
  }
  function trimLoader() {
    const Base = window.Hls && Hls.DefaultConfig && Hls.DefaultConfig.loader;
    if (!Base) return null;
    return class extends Base {
      load(context, config, callbacks) {
        const ok = callbacks.onSuccess;
        super.load(context, config, { ...callbacks, onSuccess: (r, s, c, n) => { r.data = trimPlaylist(r.data); ok(r, s, c, n); } });
      }
    };
  }
  // Read when asked for, not at load: hls.js is a deferred script.
  const hlsConfig = () => { const pLoader = trimLoader(); return pLoader ? { pLoader } : {}; };

  function init(panel, video) {
    if (!panel || !video) return;
    video.muted = true;
    const isLocalFile = window.location.protocol === 'file:';
    let hls = null;
    let loaded = false;
    let hovering = false;

    function start() {
      if (loaded || hls) return;
      if (window.Hls && Hls.isSupported()) {
        hls = new Hls({ maxBufferLength: 4, maxMaxBufferLength: 8, enableWorker: !isLocalFile, ...hlsConfig() });
        hls.loadSource(CAPCAM_URL);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { loaded = true; if (hovering) video.play().catch(() => {}); });
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) { hls.destroy(); hls = null; loaded = false; }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = CAPCAM_URL;
        video.addEventListener('canplay', () => { loaded = true; video.play().catch(() => {}); }, { once: true });
        video.addEventListener('error', () => { loaded = false; });
        video.load();
      }
    }

    panel.addEventListener('mouseenter', () => {
      hovering = true;
      start();
      if (loaded) video.play().catch(() => {});
    });
    panel.addEventListener('mouseleave', () => { hovering = false; video.pause(); });
  }

  // `url` so the Senate's floor feed can play the same stream between sittings.
  globalThis.CapCam = { init, url: CAPCAM_URL, hlsConfig, trimPlaylist };
})();
