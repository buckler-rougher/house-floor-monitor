/**
 * FAA airport delays for the Washington airports, shared by both boards.
 *
 * WHY THIS FILE EXISTS
 * The Senate board is the House page adapted, so it inherits the airport panel.
 * The logic behind it is not a fetch and a render: it filters closures whose
 * window has already ended or has not begun, tells a runway or taxiway NOTAM
 * apart from a real airport closure, and folds ground stop and ground delay
 * programs in on top of the general arrival and departure delays. Copying ~290
 * lines of that into a second board would have produced two versions of those
 * judgements with nothing to keep them in step.
 *
 * DEPENDENCIES ARE INJECTED, not reached for: the panel element, an HTML
 * escaper and the innerHTML-diffing setter all come from init(), so this file
 * knows nothing about either board's `elements` map.
 *
 * LOADING
 * No `export` syntax, matching lib/bill-id.js: assigns to globalThis so a plain
 * <script> tag serves every consumer.
 */
(function (root) {
  'use strict';

  // Last parsed delay state, keyed by airport code. fetchAirportDelays() writes
  // it and updateAirportDelaysDisplay() reads it, including on the SSE path
  // where the display is refreshed without a re-fetch.
  //
  // This was never declared in app.js: it was assigned bare, which sloppy mode
  // quietly turns into a global, so the House board worked by accident. Under
  // this file's 'use strict' the same assignment is a ReferenceError, which is
  // how a latent bug of seven-odd years finally announced itself.
  let airportDelays = null;

  let _listEl = null;
  let _escapeHtml = (s) => String(s ?? '');
  let _setIfChanged = (el, html) => { if (el) el.innerHTML = html; };

  /**
   * @param {object} deps
   * @param {Element} deps.listEl        the panel body to render into
   * @param {function} [deps.escapeHtml] board's escaper; a safe default is used otherwise
   * @param {function} [deps.setIfChanged] board's innerHTML diffing setter
   * @param {string} [deps.workerUrl]   the board's own endpoint for this panel
   */
  function init(deps) {
    _listEl = deps.listEl || null;
    if (deps.escapeHtml) _escapeHtml = deps.escapeHtml;
    if (deps.setIfChanged) _setIfChanged = deps.setIfChanged;
    // The default below is the House prefix, which both boards can reach --
    // the Worker strips either one and lands on the same handler. It still
    // reads wrong for the Senate board to ask for its airports under the other
    // board's name, and it is the sort of thing that looks like the bug when
    // something else breaks, so a board may name its own.
    if (deps.workerUrl) FAA_CONFIG.workerUrl = deps.workerUrl;
  }

  const ARRIVALS_GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52.917 52.917" width="14" height="14" style="vertical-align:middle;margin-left:4px"><g transform="translate(-188.57376,-109.44473)"><path fill="currentColor" d="m 218.8853,125.93666 -5.64152,8.46357 -12.31398,0.95963 c -4.46542,0.31793 -6.48546,1.82059 -6.44456,2.96003 0.0398,1.11042 2.02836,1.92405 5.46064,1.81642 a 0.92036289,0.92036289 0 0 0 -0.38188,0.74518 0.92036289,0.92036289 0 0 0 0.92035,0.92036 0.92036289,0.92036289 0 0 0 0.92036,-0.92036 0.92036289,0.92036289 0 0 0 -0.4656,-0.79995 c 0.20035,-0.0154 0.40337,-0.033 0.61184,-0.0543 l 12.80388,-0.50953 a 0.92036289,0.92036289 0 0 0 -0.60824,0.86506 0.92036289,0.92036289 0 0 0 0.92037,0.92036 0.92036289,0.92036289 0 0 0 0.92035,-0.92036 0.92036289,0.92036289 0 0 0 -0.67593,-0.88728 l 1.9637,-0.078 a 0.92036289,0.92036289 0 0 0 -0.57826,0.85422 0.92036289,0.92036289 0 0 0 0.92036,0.92035 0.92036289,0.92036289 0 0 0 0.92036,-0.92035 0.92036289,0.92036289 0 0 0 -0.64699,-0.87902 l 5.90868,-0.23513 10.34717,-2.35696 1.50172,-8.33851 -3.30005,-0.18655 -3.11196,5.78208 -7.50032,-0.0388 1.55547,-8.02277 z m -24.35201,18.53427 v 1.39888 h 41.04659 v -1.39888 z"/></g></svg>`;
  // Departures: PI TF 016 airplane body flipped vertically (ascending) + baseline rect at bottom
  const DEPARTURES_GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52.917 52.917" width="52.917" height="52.917" style="width:14px;height:14px;vertical-align:middle;margin-left:4px"><g transform="translate(-151.3157,-101.28343)"><path fill="currentColor" fill-rule="evenodd" d="m 171.55992,115.6357 -3.63802,1.4428 4.26537,6.96288 -6.83731,2.63447 -4.89272,-4.32842 -2.94814,1.31723 4.32841,7.27656 10.28723,-1.38028 20.26543,-6.75462 c 4.18881,-1.10754 6.25862,-2.8375 5.84874,-4.0442 -0.36669,-1.07956 -2.74488,-1.78489 -6.93653,-0.53537 l -11.58792,3.36827 z m -14.30145,23.02081 v 1.19166 h 41.02333 v -1.19166 z"/></g></svg>`;

  // FAA Airport Status Configuration
  const FAA_CONFIG = {
      workerUrl: 'https://api.evanhollander.org/house-floor/api/airport-delays',
      wasAirports: ['DCA', 'IAD', 'BWI'], // Always show these WAS airports
      airportsCsvUrl: 'https://raw.githubusercontent.com/lxndrblz/Airports/main/airports.csv',
      refreshInterval: 300000 // Check every 5 minutes
  };

  // Airport name and URL mapping (will be populated from CSV)
  let airportNames = {};
  let airportUrls = {};

  // Fetch airport names from CSV
  async function fetchAirportNames() {
      try {
          const response = await fetch(FAA_CONFIG.airportsCsvUrl);
          if (!response.ok) throw new Error('Failed to fetch airport names');
        
          const csvText = await response.text();
          const lines = csvText.split('\n');
        
          // Skip header and parse each line
          for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (line) {
                  const columns = line.split(',');
                  if (columns.length >= 7) {
                      const iata = columns[0].replace(/"/g, '').trim();    // Column 0: IATA code
                      const name = columns[2].replace(/"/g, '').trim();    // Column 2: Airport name
                      const url = columns[6].replace(/"/g, '').trim();     // Column 6: Airport URL
                      if (iata && name) {
                          airportNames[iata] = name;
                          if (url && url !== '') {
                              airportUrls[iata] = url;
                          }
                      }
                  }
              }
          }
        
      } catch (error) {
          console.error('Failed to load airport names:', error);
          // Fallback to basic mapping
          airportNames = {
              'DCA': 'Ronald Reagan Washington National',
              'IAD': 'Washington Dulles International',
              'BWI': 'Baltimore/Washington International'
          };
          airportUrls = {};
      }
  }

  // Returns true only for full airport closures; runway/taxiway-only NOTAMs return false.
  function isFaaFullAirportClosure(reason) {
      const upper = reason.toUpperCase();

      // Aircraft-class restrictions take priority — "AP CLSD TO NON SKED" is still partial
      if (/\b(CLSD|CLOSED)\s+TO\s+NON[\s-]?SKED\b/.test(upper)) return false;
      if (/\b(CLSD|CLOSED)\s+TO\s+TRANSIENT\b/.test(upper)) return false;
      if (/\b(CLSD|CLOSED)\s+TO\s+(GA|GENERAL\s+AVIATION)\b/.test(upper)) return false;
      if (/\b(CLSD|CLOSED)\s+TO\s+(VFR|IFR)\b/.test(upper)) return false;
      if (/\bNOT\s+AVBL\s+TO\s+NON[\s-]?SKED\b/.test(upper)) return false;

      // Explicit full-airport closure phrases
      if (/\bAP\s+CLSD\b/.test(upper)) return true;
      if (/\bARPT\s+CLSD\b/.test(upper)) return true;
      if (/\bAIRPORT\s+CLSD\b/.test(upper)) return true;
      if (/\bAD\s+CLSD\b/.test(upper)) return true;
      if (/\bCLSD\s+TO\s+ALL\s+(ACFT|ARCRFT|AIRCRAFT)\b/.test(upper)) return true;
      if (/\bAP\s+NOT\s+AVBL\b/.test(upper)) return true;

      // Runway- or taxiway-specific closures — airport remains operational
      if (/\bRWY\s+[\dLRC]/.test(upper)) return false;
      if (/\bTWY\s+[A-Z]/.test(upper)) return false;
      if (/\bRUNWAY\s+\d/.test(upper)) return false;
      if (/\bTAXIWAY\s+/.test(upper)) return false;

      // Unclassifiable — assume full closure to avoid missing genuine closures
      return true;
  }

  // Fetch FAA airport status information
  // The FAA's own response, as the source link's popover shows it (lib/source-pop.js): its update time and the entries for
  // the airports this panel lists, one element per line. Entries for other airports are only counted, so the excerpt stays
  // short; when there is none for ours, that is said in a comment, since "no delay" is itself what the FAA answered.
  function setFaaManifest(doc) {
    if (!root.SourcePop || !_listEl) return;
    const panel = _listEl.closest('.airport-delays-panel');
    if (!panel) return;
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const wanted = new Set(FAA_CONFIG.wasAirports);
    const lines = ['<AIRPORT_STATUS_INFORMATION>'];
    const update = doc.querySelector('Update_Time');
    if (update) lines.push('  <Update_Time>' + esc(update.textContent.trim()) + '</Update_Time>');
    let kept = 0, others = 0;
    // One element per line, nested elements indented, attributes kept (the FAA marks arrival and departure with one).
    const attrs = (el) => [...el.attributes].map((x) => ' ' + x.name + '="' + esc(x.value) + '"').join('');
    const emit = (el, depth, out) => {
      const pad = '  '.repeat(depth);
      if (!el.children.length) { out.push(pad + '<' + el.tagName + attrs(el) + '>' + esc(el.textContent.trim()) + '</' + el.tagName + '>'); return; }
      out.push(pad + '<' + el.tagName + attrs(el) + '>');
      for (const c of el.children) emit(c, depth + 1, out);
      out.push(pad + '</' + el.tagName + '>');
    };
    for (const type of doc.querySelectorAll('Delay_type')) {
      const out = [];
      for (const list of type.children) {
        if (list.tagName === 'Name') continue;
        const entries = [...list.children].filter((e) => {
          const code = e.querySelector('ARPT')?.textContent?.trim();
          if (wanted.has(code)) return true;
          others += 1;
          return false;
        });
        if (!entries.length) continue;
        out.push('    <' + list.tagName + '>');
        for (const e of entries) { kept += 1; emit(e, 3, out); }
        out.push('    </' + list.tagName + '>');
      }
      if (out.length) {
        lines.push('  <Delay_type>', '    <Name>' + esc(type.querySelector('Name')?.textContent?.trim() || '') + '</Name>', ...out, '  </Delay_type>');
      }
    }
    if (!kept) lines.push('  <!-- no entry for ' + FAA_CONFIG.wasAirports.join(', ') + ' -->');
    if (others) lines.push('  <!-- ' + others + ' entr' + (others === 1 ? 'y' : 'ies') + ' for other airports not shown -->');
    lines.push('</AIRPORT_STATUS_INFORMATION>');
    root.SourcePop.set(panel, {
      title: 'The FAA\'s response',
      request: 'GET https://nasstatus.faa.gov/api/airport-status-information',
      xml: lines.join('\n')
    });
  }

  async function fetchAirportDelays(preData = null) {
      try {
          if (!_listEl) return;

          // Show loading state (only if empty to avoid flash on refresh)
          if (!_listEl.hasChildNodes()) {
              _listEl.innerHTML =
                  `<div class="airport-section-header">WAS AREA · ARRIVALS ${ARRIVALS_GLYPH}</div>` +
                  FAA_CONFIG.wasAirports.map(code => `
                      <div class="airport-delay-item">
                          <div class="airport-item-main">
                              <span class="airport-info">${code}</span>
                              <span class="airport-status loading">LOADING</span>
                          </div>
                      </div>
                  `).join('');
          }

          const delays = {};

          // Initialize WAS airports as normal (always show these)
          FAA_CONFIG.wasAirports.forEach(code => {
              delays[code] = { status: 'normal', delay: 'No delays', reason: '', trend: '' };
          });

          // Track connection status
          let connectionStatus = 'connected'; // 'connected', 'disconnected', 'error'

          // Fetch all airport delays from the main API endpoint (or use pre-pushed SSE data)
          try {
              let jsonData;
              if (preData) {
                  jsonData = preData;
              } else {
                  const response = await fetch(FAA_CONFIG.workerUrl);
                  if (!response.ok) throw new Error(`HTTP ${response.status}`);
                  jsonData = await response.json();
              }
              {
                  if (jsonData.error) {
                      throw new Error(jsonData.error);
                  }

                  const xmlText = jsonData.xmlData || '';
                
                  // Parse XML to find all delay types
                  const parser = new DOMParser();
                  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
                  const delayTypes = xmlDoc.querySelectorAll('Delay_type');
                  setFaaManifest(xmlDoc);
                
                  delayTypes.forEach(delayType => {
                      const typeName = delayType.querySelector('Name')?.textContent || '';
                    
                      // Handle Airport Closures
                      if (typeName === 'Airport Closures') {
                          const closures = delayType.querySelectorAll('Airport_Closure_List Airport');
                          closures.forEach(closure => {
                              const airport = closure.querySelector('ARPT')?.textContent?.trim();
                              const reason = closure.querySelector('Reason')?.textContent?.trim() || 'Airport closed';
                              const reopenText = closure.querySelector('Reopen')?.textContent?.trim();
                              const beginText = closure.querySelector('Begin')?.textContent?.trim();

                              if (!airport) return;

                              const now = new Date();

                              // Skip closures whose window has already ended
                              if (reopenText) {
                                  const reopenTime = new Date(reopenText);
                                  if (!isNaN(reopenTime.getTime()) && reopenTime < now) return;
                              }

                              // Skip closures that haven't started yet
                              if (beginText) {
                                  const beginTime = new Date(beginText);
                                  if (!isNaN(beginTime.getTime()) && beginTime > now) return;
                              }

                              // Skip runway/taxiway-only NOTAMs — the airport itself is open
                              if (!isFaaFullAirportClosure(reason)) return;

                              delays[airport] = {
                                  status: 'delay',
                                  delay: 'CLOSED',
                                  reason: reason,
                                  trend: 'Closed'
                              };
                          });
                      }
                    
                      // Handle General Arrival/Departure Delays
                      if (typeName === 'General Arrival/Departure Delay Info') {
                          const delayList = delayType.querySelectorAll('Arrival_Departure_Delay_List Delay');
                          delayList.forEach(delay => {
                              const airport = delay.querySelector('ARPT')?.textContent?.trim();
                              const reason = delay.querySelector('Reason')?.textContent?.trim() || '';
                              const minDelay = delay.querySelector('Min')?.textContent?.trim() || '';
                              const maxDelay = delay.querySelector('Max')?.textContent?.trim() || '';
                              const trend = delay.querySelector('Trend')?.textContent?.trim() || '';
                              const arrDep = delay.querySelector('Arrival_Departure')?.textContent?.trim() || '';

                              if (!airport) return;

                              const isWas = FAA_CONFIG.wasAirports.includes(airport);
                              // WAS airports: arrival delays only; others: departure delays only
                              if (isWas && arrDep !== 'Arrival') return;
                              if (!isWas && arrDep !== 'Departure') return;

                              delays[airport] = {
                                  status: minDelay ? 'delay' : 'normal',
                                  delay: minDelay && maxDelay ? `${minDelay}-${maxDelay} min` : 'No delays',
                                  reason: reason,
                                  trend: trend
                              };
                          });
                      }

                      // Handle Ground Stop Programs (FAA XML: "Ground Stop Programs")
                      if (typeName === 'Ground Stop Programs') {
                          const programs = delayType.querySelectorAll('Ground_Stop_List Program');
                          programs.forEach(program => {
                              const airport = program.querySelector('ARPT')?.textContent?.trim();
                              const reason = program.querySelector('Reason')?.textContent?.trim() || '';
                              const endTime = program.querySelector('End_Time')?.textContent?.trim() || '';

                              if (!airport) return;

                              delays[airport] = {
                                  status: 'ground-stop',
                                  delay: 'GROUND STOP',
                                  reason: reason + (endTime ? ` · until ${endTime}` : ''),
                                  trend: ''
                              };
                          });
                      }

                      // Handle Ground Delay Programs (FAA XML: "Ground Delay Programs") — arrival restrictions
                      if (typeName === 'Ground Delay Programs') {
                          const gds = delayType.querySelectorAll('Ground_Delay_List Ground_Delay');
                          gds.forEach(gd => {
                              const airport = gd.querySelector('ARPT')?.textContent?.trim();
                              const reason = gd.querySelector('Reason')?.textContent?.trim() || '';
                              const avg = gd.querySelector('Avg')?.textContent?.trim() || '';

                              if (!airport) return;
                              // Ground stop takes priority over ground delay
                              if (delays[airport]?.status === 'ground-stop') return;

                              delays[airport] = {
                                  status: 'ground-delay',
                                  delay: avg || 'DELAYED',
                                  reason: reason,
                                  trend: ''
                              };
                          });
                      }
                  });
                
                  // Mark as connected successfully
                  connectionStatus = 'connected';
              }
          } catch (error) {
              console.error('FAA API fetch error:', error);
              connectionStatus = 'disconnected';
          }

          // Update state
          airportDelays = delays;

          // Update display with connection status
          updateAirportDelaysDisplay(connectionStatus);

      } catch (error) {
          console.error('Airport delays fetch error:', error);
          if (_listEl) {
              _setIfChanged(_listEl,
                  `<div class="airport-section-header">WAS AREA · ARRIVALS ${ARRIVALS_GLYPH}</div>` +
                  `<div class="airport-delay-item"><div class="airport-item-main"><span class="airport-info">CONNECTION ERROR</span><span class="airport-status delay">ERROR</span></div></div>`);
          }
      }
  }

  // Render a single airport row (used by updateAirportDelaysDisplay)
  function renderAirportRow(code, data) {
      const statusClass = data.status === 'normal' ? 'normal'
          : data.status === 'ground-stop' ? 'ground-stop'
          : data.status === 'ground-delay' ? 'ground-delay'
          : data.status === 'disconnected' ? 'disconnected'
          : 'delay';
      const delayText = data.status === 'normal' ? 'NO DELAYS'
          : data.status === 'ground-stop' ? 'GROUND STOP'
          : data.status === 'ground-delay' ? (data.delay || 'GROUND DELAY')
          : data.status === 'disconnected' ? 'NO DATA'
          : (data.delay || 'DELAYS');
      const airportName = airportNames[code] || '';
      const airportUrl = airportUrls[code];

      const trendClass = data.trend === 'Increasing' ? 'up' : data.trend === 'Decreasing' ? 'down' : '';
      const trendSymbol = data.trend === 'Increasing' ? '↑' : data.trend === 'Decreasing' ? '↓' : '';
      const hasDetail = data.status !== 'normal' && data.status !== 'disconnected' && data.reason;
      const normalTimeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      const subLine = data.status === 'normal'
          ? `<div class="airport-item-sub"><span class="airport-reason">No delay reported as of ${normalTimeStr}</span></div>`
          : hasDetail
          ? `<div class="airport-item-sub"><span class="airport-reason">${_escapeHtml(data.reason)}</span>${trendSymbol ? `<span class="airport-trend ${trendClass}">${trendSymbol}</span>` : ''}</div>`
          : `<div class="airport-item-sub"></div>`;

      const inner = `<div class="airport-delay-item">
          <div class="airport-info-col">
              <span class="airport-info">${_escapeHtml(code)}${airportName ? ` · ${_escapeHtml(airportName)}` : ''}</span>
              ${subLine}
          </div>
          <span class="airport-status ${statusClass}">${_escapeHtml(delayText)}</span>
      </div>`;

      return airportUrl
          ? `<a href="${_escapeHtml(airportUrl)}" target="_blank" rel="noopener" class="airport-delay-item-link">${inner}</a>`
          : inner;
  }

  // Update airport delays display
  function updateAirportDelaysDisplay(connectionStatus = 'connected') {
      if (!_listEl || !airportDelays) return;

      const wasAirports = FAA_CONFIG.wasAirports;

      // If disconnected, show NO DATA for WAS airports only
      if (connectionStatus === 'disconnected') {
          _setIfChanged(_listEl,
              `<div class="airport-section-header">WAS AREA · ARRIVALS ${ARRIVALS_GLYPH}</div>` +
              wasAirports.map(code => renderAirportRow(code, { status: 'disconnected', delay: 'NO DATA', reason: '', trend: '' })).join(''));
          return;
      }

      // WAS section — always show DCA/IAD/BWI
      const wasHtml = wasAirports.map(code => {
          const data = airportDelays[code] || { status: 'normal', delay: 'No delays', reason: '', trend: '' };
          return renderAirportRow(code, data);
      }).join('');

      // Nationwide section — non-WAS airports with any active delay or ground stop
      const nationalEntries = Object.entries(airportDelays)
          .filter(([code]) => !wasAirports.includes(code))
          .filter(([, data]) => data.status !== 'normal');
      const nationalHtml = nationalEntries.map(([code, data]) => renderAirportRow(code, data)).join('');

      let html = `<div class="airport-section-header">WAS AREA · ARRIVALS ${ARRIVALS_GLYPH}</div>${wasHtml}`;
      if (nationalHtml) {
          html += `<div class="airport-section-header national-header">NATIONWIDE · DEPARTURES ${DEPARTURES_GLYPH}</div>${nationalHtml}`;
      }

      _setIfChanged(_listEl, html);
  }
  root.AirportDelays = {
    init, fetchAirportNames, fetchAirportDelays, updateAirportDelaysDisplay, FAA_CONFIG,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
