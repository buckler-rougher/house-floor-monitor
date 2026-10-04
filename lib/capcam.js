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

  function init(panel, video) {
    if (!panel || !video) return;
    video.muted = true;
    const isLocalFile = window.location.protocol === 'file:';
    let hls = null;
    let loaded = false;

    function start() {
      if (loaded || hls) return;
      if (window.Hls && Hls.isSupported()) {
        hls = new Hls({ maxBufferLength: 4, maxMaxBufferLength: 8, enableWorker: !isLocalFile });
        hls.loadSource(CAPCAM_URL);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { loaded = true; video.play().catch(() => {}); });
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
      start();
      if (loaded) video.play().catch(() => {});
    });
    panel.addEventListener('mouseleave', () => video.pause());
  }

  // `url` so the Senate's floor feed can play the same stream between sittings.
  globalThis.CapCam = { init, url: CAPCAM_URL };
})();
