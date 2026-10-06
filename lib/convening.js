// When a chamber convenes, and whether that hour has passed. Both boards show one line for it
// ("meets at 9 A.M." until then, "met at 9 A.M." after), so the reading and the comparison are here once.
//
//   Convening.format('3:00pm')            -> '3 P.M.'
//   Convening.format('12 NOON')           -> '12 NOON'
//   Convening.hasMet('2026-10-05', '4:30 P.M.', now?)  // against Eastern time; `now` is for tests
//   Convening.isoDate('Monday, November 9, 2026')      -> '2026-11-09'
//
// The House gives "9 A.M.", "10:30 A.M.", "12 NOON" (its Calendar); the Senate's caucus schedule gives
// "3:00pm". All are read the same way. A time that cannot be read is never "met": the line keeps the
// future tense rather than assert a past it cannot place.

(function (root) {
  const RE = /^(\d{1,2})(?::(\d{2}))?\s*(A\.?M\.?|P\.?M\.?|NOON)/i;

  function minutes(text) {
    const m = RE.exec(String(text || '').trim());
    if (!m) return null;
    const word = m[3].toUpperCase();
    let h = Number(m[1]) % 12;
    if (word === 'NOON') h = 12; else if (word[0] === 'P') h += 12;
    return h * 60 + (Number(m[2]) || 0);
  }

  // "3:00pm" -> "3 P.M.", "10:30 a.m." -> "10:30 A.M.", noon stays NOON. Anything unreadable is returned as given.
  function format(text) {
    const m = RE.exec(String(text || '').trim());
    if (!m) return String(text || '');
    const word = m[3].toUpperCase();
    const clock = `${Number(m[1])}${m[2] && m[2] !== '00' ? ':' + m[2] : ''}`;
    const noon = word === 'NOON' || (word[0] === 'P' && Number(m[1]) === 12 && (!m[2] || m[2] === '00'));
    return noon ? '12 NOON' : `${clock} ${word[0]}.M.`;
  }

  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function isoDate(text) {
    const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(String(text || ''));
    const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
    return mo < 0 ? null : `${m[3]}-${String(mo + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
  }

  function easternNow(now) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now || new Date()).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
  }
  const today = (now) => easternNow(now).date;

  // A date before today has certainly met; one after has not. Today compares the hour.
  function hasMet(iso, timeText, now) {
    const at = minutes(timeText);
    if (at === null) return false;
    const e = easternNow(now);
    if (iso && iso < e.date) return true;
    if (iso && iso > e.date) return false;
    return e.minutes >= at;
  }

  root.Convening = { minutes, format, isoDate, hasMet, today };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Convening;
})(typeof globalThis !== 'undefined' ? globalThis : this);
