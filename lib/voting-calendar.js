/**
 * The session-day calendar, shared by the House and Senate boards.
 *
 * WHY THIS FILE EXISTS
 * The Senate board is the House page adapted, so it inherits the three-month
 * grid, the THIS WEEK strip and the month navigation. None of that is chamber
 * specific: it renders a list of {date, type} items onto a calendar. What IS
 * chamber specific is where the items come from -- the House reads an ICS of
 * voting days, the Senate reads its own session-day XML -- so the data is
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
  function setData(items) {
    votingCalendarData = Array.isArray(items) ? items : [];
    renderThisWeek();
    renderVotingDaysCalendar();
  }

  function renderThisWeek() {
      const el = document.getElementById('this-week-body');
      if (!el || !votingCalendarData.length) return;

      // Get Mon–Sun of the current week
      const now = new Date();
      const dow = now.getDay(); // 0=Sun
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
      monday.setHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const toDateStr = d => d.toISOString().slice(0, 10);
      const weekDates = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(monday);
          d.setDate(monday.getDate() + i);
          return toDateStr(d);
      });

      // Collect events falling in this week
      const weekEvents = votingCalendarData.filter(e => weekDates.includes(e.date));

      if (!weekEvents.length) {
          el.innerHTML = '<span class="this-week-empty">No votes scheduled this week</span>';
          return;
      }

      const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const TYPE_CLASS = {
          'fly-in':    'this-week-day-fly',
          'fly-out':   'this-week-day-fly',
          'vote-day':  'this-week-day-vote',
          'added':     'this-week-day-vote',
          'cancelled': 'this-week-day-recess',
      };
      const TYPE_LABEL = {
          'fly-in':    'Fly In',
          'fly-out':   'Fly Out',
          'vote-day':  'Votes',
          'added':     'Votes+',
          'cancelled': 'Cancelled',
      };

      // Group events by date so fly-in + vote-day on same day become one chip
      const byDate = new Map();
      weekEvents.forEach(e => {
          if (!byDate.has(e.date)) byDate.set(e.date, new Set());
          byDate.get(e.date).add(e.type);
      });

      el.innerHTML = [...byDate.entries()].map(([date, types]) => {
          const [y, m, d] = date.split('-').map(Number);
          const dayName = DAY_SHORT[new Date(y, m - 1, d).getDay()];
          // Determine class (fly takes priority over vote, added over everything)
          const cls = types.has('added') ? TYPE_CLASS['added']
              : (types.has('fly-in') || types.has('fly-out')) ? TYPE_CLASS['fly-in']
              : types.has('cancelled') ? TYPE_CLASS['cancelled']
              : TYPE_CLASS['vote-day'];
          // Build combined label
          let lbl;
          if (types.has('fly-in') && types.has('vote-day'))       lbl = 'Fly In + Votes';
          else if (types.has('fly-out') && types.has('vote-day')) lbl = 'Votes + Fly Out';
          else if (types.has('fly-in'))                           lbl = 'Fly In';
          else if (types.has('fly-out'))                          lbl = 'Fly Out';
          else if (types.has('added'))                            lbl = 'Votes+';
          else if (types.has('cancelled'))                        lbl = 'Cancelled';
          else                                                    lbl = 'Votes';
          return `<span class="this-week-day ${cls}">${dayName} · ${lbl}</span>`;
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

              // Determine color priority: added > vote/fly > cancelled
              const colorType = types.has('added') ? 'added'
                  : (types.has('vote-day') || types.has('fly-in') || types.has('fly-out')) ? 'vote-day'
                  : types.has('cancelled') ? 'cancelled'
                  : null;
              const c = colorType ? COLORS[colorType] : null;
              const cellClass = ['cal-day', c?.cell, isToday ? 'cal-day-today' : ''].filter(Boolean).join(' ');

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

  root.VotingCalendar = { setData, renderThisWeek, renderVotingDaysCalendar, visibleRange };
})(typeof globalThis !== 'undefined' ? globalThis : this);
