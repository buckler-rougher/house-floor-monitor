// WAITING FOR THE FLOOR: which bills are waiting in a chamber and why, from Congress.gov's bill list (each bill's type and latest action). Shared by the Worker (which sorts every
// bill of the Congress into the two boards' two columns) and the board (which draws them).
//
//   Pipeline.classify(bill) -> { board: 'house' | 'senate', col: 'calendar' | 'from', tag, cal } | null
//
// THE HOUSE BOARD: "Reported by committees" (col calendar: the House or Union Calendar, a bill a committee has reported that has had no floor action) and "From the Senate" (col
// from: Senate bills the House has received, tag `senate-bill` (a bill the Senate passed becomes "Received in the House" and then "Held at the desk" in the House's own floor log:
// 163 of them on 12 October 2026), and House bills the Senate passed with an amendment and sent back, tag `amended`). THE SENATE BOARD: "On the
// calendar" (col calendar: the Senate Legislative Calendar, General Orders) and "From the House" (col from: House-passed bills received and not acted on, tag `house-bill`, and
// Senate bills the House amended, tag `amended`). A chamber hands the other what it passes, so the two second columns differ by nature: 171 in the House (163 Senate bills,
// 8 amended House bills), 530 House bills in the Senate. It reads the LATEST action only, so a bill whose committee has acted since it arrived is no
// longer in "from the House" (understated, and the board says "no action since"); a bill that has moved on drops out by itself the next time its record updates.

(function (root) {
  const HOUSE_TYPES = new Set(['HR', 'HJRES']);
  const SENATE_TYPES = new Set(['S', 'SJRES']);

  function classify(b) {
    const type = String((b && b.type) || '').toUpperCase();
    const a = String((b && b.a) || '').replace(/\s+/g, ' ').trim();
    if (!a || !(HOUSE_TYPES.has(type) || SENATE_TYPES.has(type))) return null;
    const house = HOUSE_TYPES.has(type);
    let m;
    if (house && (m = /^Placed on the (?:Union|House) Calendar, Calendar No\. (\d+)/i.exec(a))) return { board: 'house', col: 'calendar', tag: null, cal: Number(m[1]) };
    if ((m = /Placed on Senate Legislative Calendar.*?Calendar No\. (\d+)/i.exec(a))) return { board: 'senate', col: 'calendar', tag: house ? 'house-bill' : 'senate-bill', cal: Number(m[1]) };
    if (house && /^Received in the Senate/i.test(a)) return { board: 'senate', col: 'from', tag: 'house-bill', cal: null };
    if (house && /^(?:Message on Senate action sent to the House|Passed Senate with an amendment)/i.test(a)) return { board: 'house', col: 'from', tag: 'amended', cal: null };
    if (!house && /^(?:Received in the House|Referred to the House Committee|Held at the desk)/i.test(a)) return { board: 'house', col: 'from', tag: 'senate-bill', cal: null };
    if (!house && /^(?:Passed House with an amendment|Message on House action received in Senate)/i.test(a)) return { board: 'senate', col: 'from', tag: 'amended', cal: null };
    return null;
  }

  root.Pipeline = { classify };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Pipeline;
})(typeof globalThis !== 'undefined' ? globalThis : this);
