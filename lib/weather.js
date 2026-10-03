// The weather readout in the header: current temperature and conditions for the
// Capitol, from the National Weather Service.
//
// Shared by both boards. It is the Capitol, not a chamber, so there was never a
// reason for two copies, and they had drifted: the same hourly forecast was
// refreshed every 30 minutes on the House board and every 10 on the Senate's.
// The hourly forecast changes hourly, so 30 minutes is the one kept.
//
// Straight to api.weather.gov from the browser: no Worker in the path, so it costs
// nothing to run and does not count against the Worker's limits.
//
//   Weather.init({ temp: el('weather-temp'), condition: el('weather-condition') })

(() => {
  // The Capitol.
  const COORDS = { lat: 38.889722, lon: -77.008889 };
  const REFRESH_MS = 30 * 60 * 1000;

  // The grid point a coordinate falls in does not change, so the hourly-forecast URL
  // is looked up once and kept. A refresh is then one request, not two. If the
  // forecast ever fails the URL is dropped and looked up again, in case the grid
  // was redrawn.
  let forecastUrl = null;

  async function fetchOnce({ temp, condition }) {
    try {
      if (!forecastUrl) {
        const points = await fetch(`https://api.weather.gov/points/${COORDS.lat},${COORDS.lon}`);
        if (!points.ok) throw new Error('Points API failed');
        forecastUrl = (await points.json()).properties.forecastHourly;
      }
      const forecast = await fetch(forecastUrl);
      if (!forecast.ok) { forecastUrl = null; throw new Error('Forecast API failed'); }
      // The first hourly period is the current hour.
      const current = (await forecast.json()).properties.periods[0];
      if (temp) temp.textContent = `${Math.round(current.temperature)}°${current.temperatureUnit}`;
      if (condition) condition.textContent = current.shortForecast;
    } catch (e) {
      console.error('Weather fetch error:', e);
      if (temp) temp.textContent = '--°';
      if (condition) condition.textContent = 'N/A';
    }
  }

  function init({ temp, condition, everyMs = REFRESH_MS }) {
    if (!temp && !condition) return;
    const nodes = { temp, condition };
    fetchOnce(nodes);
    setInterval(() => fetchOnce(nodes), everyMs);
  }

  globalThis.Weather = { init };
})();
