/**
 * The session-day calendar, shared by the House and Senate boards.
 *
 * WHY THIS FILE EXISTS
 * The Senate board is the House page adapted, so it inherits the three-month
 * grid, the THIS WEEK strip and the month navigation. None of that is chamber
 * specific: it renders a list of {date, type} items onto a calendar. What IS
 * chamber specific is where the items come from -- the House reads an ICS of
 * voting days, the Senate reads its own session-day XML -- so the data are
 * supplied through setData() and the rendering lives here once.
 *
 * The grid carries a fix worth not re-deriving: the month and "today" are both
 * computed from the same Eastern-converted instant. Using toISOString() forces
 * UTC, and after 8pm Eastern that is already tomorrow, which highlighted the
 * wrong day.
 *
 * ITEM SHAPE
 *   { date: 'YYYY-MM-DD', type: 'fly-in'|'fly-out'|'vote-day'|'added'|'cancelled', label?: string }
 * An unknown type simply renders without a colour rather than throwing.
 *
 * LOADING
 * No `export` syntax, matching lib/bill-id.js: assigns to globalThis so a plain
 * <script> tag serves every consumer.
 */
(function (root) {
  'use strict';

  // Owned here rather than by either board, so both go through setData().
  let votingCalendarData = [];

  /** Replace the calendar's items and redraw. */
  const listeners = [];
  /** Run fn(items) once the calendar has items (now if it already does). */
  function onData(fn) { if (votingCalendarData.length) fn(votingCalendarData); else listeners.push(fn); }
  function setData(items) {
    votingCalendarData = Array.isArray(items) ? items : [];
    if (votingCalendarData.length) while (listeners.length) { try { listeners.shift()(votingCalendarData); } catch { /* a listener must not stop the draw */ } }
    renderThisWeek();
    renderVotingDaysCalendar();
  }

  function renderThisWeek() {
      const el = document.getElementById('this-week-body');
      if (!el || !votingCalendarData.length) return;

      const SHORT_MONTH = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;   // local, never UTC: a day must not shift in the evening
      const now = new Date();
      const todayStr = ymd(now);
      const dow = now.getDay();   // 0 = Sunday
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      monday.setDate(monday.getDate() - (dow === 0 ? 6 : dow - 1));

      // Group events by date so fly-in + vote-day on the same day become one card
      const byDate = new Map();
      votingCalendarData.forEach((e) => {
          if (!byDate.has(e.date)) byDate.set(e.date, new Set());
          byDate.get(e.date).add(e.type);
      });
      const hasVotes = (d) => { const t = byDate.get(ymd(d)); return !!t && (t.has('vote-day') || t.has('fly-in') || t.has('fly-out') || t.has('added')); };
      const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
      // Saturday or Sunday with nothing happening: the week is over, show the one coming. A weekend that has votes (a Saturday session; the Congress convening on Sunday 3 January 2027) keeps its own
      // week on screen, with Sat and Sun shown, so the weekend day is never skipped.
      const weekend = dow === 0 || dow === 6;
      const weekendVotesLeft = weekend && [addDays(monday, 5), addDays(monday, 6)].some((d) => ymd(d) >= todayStr && hasVotes(d));
      const upcoming = weekend && !weekendVotesLeft;
      const start = upcoming ? addDays(monday, 7) : monday;
      // Mon-Fri, or all seven when either weekend day of the week shown has votes
      const sevenDays = hasVotes(addDays(start, 5)) || hasVotes(addDays(start, 6));
      const days = Array.from({ length: sevenDays ? 7 : 5 }, (_, i) => addDays(start, i));

      const label = document.querySelector('#this-week-strip .this-week-label');
      if (label) {
          const f = days[0], l = days[days.length - 1];
          label.innerHTML = `<span>${upcoming ? 'NEXT WEEK' : 'THIS WEEK'}</span><span class="this-week-range">${f.getDate()} ${SHORT_MONTH[f.getMonth()]} \u2013 ${l.getDate()} ${SHORT_MONTH[l.getMonth()]}</span>`;
      }

      el.classList.toggle('this-week-body-7', days.length === 7);
      el.innerHTML = days.map((d) => {
          const ds = ymd(d);
          const types = byDate.get(ds) || new Set();
          const votes = types.has('vote-day') || types.has('fly-in') || types.has('fly-out') || types.has('added');
          const kind = votes ? 'vote' : types.has('cancelled') ? 'cancel' : 'none';
          let status;
          if (types.has('fly-in') && types.has('vote-day'))       status = 'Fly In + Votes';
          else if (types.has('fly-out') && types.has('vote-day')) status = 'Votes + Fly Out';
          else if (types.has('fly-in'))                           status = 'Fly In';
          else if (types.has('fly-out'))                          status = 'Fly Out';
          else if (types.has('added'))                            status = 'Votes+';
          else if (types.has('vote-day'))                         status = 'Votes';
          else if (types.has('cancelled'))                        status = 'Cancelled';
          else                                                    status = 'No votes';
          const cls = `this-week-day this-week-day-${kind}${ds < todayStr ? ' this-week-day-past' : ''}${ds === todayStr ? ' this-week-day-today' : ''}`;
          return `<div class="${cls}"><span class="tw-dow">${DOW[d.getDay()]}</span><span class="tw-num">${d.getDate()}</span><span class="tw-status">${status}</span></div>`;
      }).join('');
  }

  let calendarMonthOffset = 0; // months offset from today's month (desktop window center)
  let calendarMobileIdx = 1;   // which of the 3 rendered months is visible on mobile

  function renderVotingDaysCalendar() {
      const prevEl = document.getElementById('voting-calendar-prev');
      const currentEl = document.getElementById('voting-calendar-current');
      const nextEl = document.getElementById('voting-calendar-next');

      if (!prevEl || !currentEl || !nextEl) return;

      // The House operates on Eastern time, and .toISOString() forces UTC — right after
      // 8pm ET that's already past midnight UTC, which was highlighting tomorrow's date
      // as "today". Compute both the month grid and today's date string from the same
      // ET-converted instant instead, so they can't disagree with each other or with the
      // viewer's own arbitrary local timezone.
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const baseMonth = new Date(now.getFullYear(), now.getMonth() + calendarMonthOffset, 1);
      const monthDates = [
          new Date(baseMonth.getFullYear(), baseMonth.getMonth() - 1, 1),
          new Date(baseMonth.getFullYear(), baseMonth.getMonth(), 1),
          new Date(baseMonth.getFullYear(), baseMonth.getMonth() + 1, 1),
      ];

      // Build date → events map
      const eventMap = new Map();
      votingCalendarData.forEach(item => {
          const list = eventMap.get(item.date) || [];
          list.push(item);
          eventMap.set(item.date, list);
      });

      const MONTH_NAMES_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

      const COLORS = {
          'fly-in':    { cell: 'cal-day-vote', num: '#4ade80', lbl: '#86efac' },
          'fly-out':   { cell: 'cal-day-vote', num: '#4ade80', lbl: '#86efac' },
          'vote-day':  { cell: 'cal-day-vote', num: '#4ade80', lbl: '#86efac' },
          'added':     { cell: 'cal-day-added', num: '#fbbf24', lbl: '#fcd34d' },
          'cancelled': { cell: 'cal-day-cancelled', num: '#6e7681', lbl: '#6e7681' },
      };

      const buildMonth = (el, monthStart) => {
          const year = monthStart.getFullYear();
          const month = monthStart.getMonth();
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          const firstDow = monthStart.getDay();

          let html = `<div class="cal-title">${MONTH_NAMES_LONG[month]} ${year}</div>`;
          html += `<div class="cal-grid">`;
          DOW.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });
          for (let i = 0; i < firstDow; i++) html += `<div class="cal-day cal-day-empty"></div>`;

          for (let d = 1; d <= daysInMonth; d++) {
              const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
              const evts = eventMap.get(ds) || [];
              const types = new Set(evts.map(e => e.type));
              const isToday = ds === todayStr;
              const isPast = ds < todayStr;   // YYYY-MM-DD sorts as dates do: a day already gone fades back, so what is still ahead stands out

              // Determine color priority: added > vote/fly > cancelled
              const colorType = types.has('added') ? 'added'
                  : (types.has('vote-day') || types.has('fly-in') || types.has('fly-out')) ? 'vote-day'
                  : types.has('cancelled') ? 'cancelled'
                  : null;
              const c = colorType ? COLORS[colorType] : null;
              const cellClass = ['cal-day', c?.cell, isToday ? 'cal-day-today' : '', isPast ? 'cal-day-past' : ''].filter(Boolean).join(' ');

              // Labels in priority order
              const lbls = [];
              if (types.has('fly-in'))    lbls.push(`<span class="cal-lbl" style="color:${c.lbl}">FLY IN</span>`);
              if (types.has('fly-out'))   lbls.push(`<span class="cal-lbl" style="color:${c.lbl}">FLY OUT</span>`);
              // A board may name the day itself. The House calendar is a voting-days
              // calendar so VOTES is right there; a Senate sitting day may hold no
              // vote at all, and labelling a pro forma VOTES would assert one.
              if (types.has('vote-day'))  lbls.push(`<span class="cal-lbl" style="color:${c.lbl}">${(evts.find((e) => e.type === 'vote-day') || {}).label || 'VOTES'}</span>`);
              if (types.has('added'))     lbls.push(`<span class="cal-lbl" style="color:${c.lbl}">VOTES+</span>`);
              if (types.has('cancelled') && !types.has('vote-day') && !types.has('added'))
                                          lbls.push(`<span class="cal-lbl cal-lbl-strike" style="color:${c.lbl}">VOTES</span>`);

              const numStyle = c ? `style="color:${c.num}"` : '';
              const lblsHtml = lbls.length ? `<div class="cal-lbls">${lbls.join('')}</div>` : '';
              html += `<div class="${cellClass}">
                  <span class="cal-num" ${numStyle}>${d}</span>
                  ${lblsHtml}
              </div>`;
          }
          html += `</div>`;
          el.innerHTML = html;
      };

      buildMonth(prevEl, monthDates[0]);
      buildMonth(currentEl, monthDates[1]);
      buildMonth(nextEl, monthDates[2]);

      // Only highlight the center month if it's actually the current real month
      currentEl.classList.toggle('voting-calendar-month-center', calendarMonthOffset === 0);

      // Mobile nav: mobileIdx 0/1/2 picks which rendered month is shown.
      // Pressing past the edge shifts the 3-month window and wraps around.
      const mobileEls = [prevEl, currentEl, nextEl];
      const updateMobileView = () => {
          mobileEls.forEach((el, i) => el.classList.toggle('cal-mobile-visible', i === calendarMobileIdx));
          const d = monthDates[calendarMobileIdx];
          const titleEl = document.getElementById('calendar-mobile-title');
          if (titleEl) titleEl.textContent = `${MONTH_NAMES_LONG[d.getMonth()]} ${d.getFullYear()}`;
      };
      updateMobileView();

      const prevBtn = document.getElementById('calendar-mobile-prev');
      const nextBtn = document.getElementById('calendar-mobile-next');
      if (prevBtn) prevBtn.onclick = () => {
          if (calendarMobileIdx > 0) {
              calendarMobileIdx--;
              updateMobileView();
          } else {
              calendarMonthOffset -= 3;
              calendarMobileIdx = 2;
              renderVotingDaysCalendar();
          }
      };
      if (nextBtn) nextBtn.onclick = () => {
          if (calendarMobileIdx < 2) {
              calendarMobileIdx++;
              updateMobileView();
          } else {
              calendarMonthOffset += 3;
              calendarMobileIdx = 0;
              renderVotingDaysCalendar();
          }
      };

      // Desktop nav
      const dPrev = document.getElementById('calendar-desktop-prev');
      const dNext = document.getElementById('calendar-desktop-next');
      const dToday = document.getElementById('calendar-desktop-today');
      if (dPrev) dPrev.onclick = () => { calendarMonthOffset -= 3; calendarMobileIdx = 1; renderVotingDaysCalendar(); };
      if (dNext) dNext.onclick = () => { calendarMonthOffset += 3; calendarMobileIdx = 1; renderVotingDaysCalendar(); };
      if (dToday) {
          dToday.classList.toggle('calendar-today-at-current', calendarMonthOffset === 0);
          dToday.setAttribute('aria-disabled', String(calendarMonthOffset === 0));   // already on today: it does nothing, and says so
          dToday.onclick = () => { calendarMonthOffset = 0; calendarMobileIdx = 1; renderVotingDaysCalendar(); };
      }
  }
  // The days the grid is drawing now (the three months around the one in view), as YYYY-MM-DD, for the source popover.
  function visibleRange() {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const base = new Date(now.getFullYear(), now.getMonth() + calendarMonthOffset, 1);
      const first = new Date(base.getFullYear(), base.getMonth() - 1, 1);
      const last = new Date(base.getFullYear(), base.getMonth() + 2, 0);
      const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { from: f(first), to: f(last) };
  }

  root.VotingCalendar = { onData, items: () => votingCalendarData, setData, renderThisWeek, renderVotingDaysCalendar, visibleRange };
})(typeof globalThis !== 'undefined' ? globalThis : this);
