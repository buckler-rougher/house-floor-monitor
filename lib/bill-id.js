/**
 * Bill-identifier normalisation, shared by app.js and worker.js.
 *
 * WHY THIS FILE EXISTS
 * The same measure is spelled three different ways by three different sources:
 *
 *   Whip schedule       "H. Res. 1499"   (and, inconsistently, "H.R.1869")
 *   DomeWatch roll call  "H RES 1499"    (unpunctuated)
 *   Congress.gov links   "H.Res. 1499"   (compact)
 *
 * Comparing any two of those as raw strings fails. That single mistake has now
 * been found three times in this codebase — it hid every H. Res. roll-call
 * result on the site, then again in the worker's /api/ask/votes list, and again
 * in the governing-rule self-reference check. Three copies of the rule meant
 * three chances to get it subtly different, so there is one copy now.
 *
 * LOADING
 * Deliberately written with no `export` syntax: it assigns to globalThis so the
 * same file serves both consumers. worker.js pulls it in with a side-effect
 * `import './lib/bill-id.js'` (esbuild inlines it at deploy); index.html loads
 * it as an ordinary <script> before app.js, so it is a plain synchronous global
 * with no module/defer ordering to reason about.
 */
(function (root) {
  'use strict';

  // Every bill-type prefix, longest first so "H.J.Res." is never partially
  // matched as "H." — the alternation is order-sensitive.
  // Bare "H" and "S" come last: DomeWatch sometimes writes "H 8464" for a House
  // bill, but "H RES 1499" must reach the H.Res. branch first, so the bare forms
  // can only be tried once every longer prefix has failed.
  const TYPE_PATTERN =
    String.raw`H\.?\s*J\.?\s*Res\.?|H\.?\s*Con\.?\s*Res\.?|H\.?\s*Res\.?|H\.?\s*R\.?` +
    String.raw`|S\.?\s*J\.?\s*Res\.?|S\.?\s*Con\.?\s*Res\.?|S\.?\s*Res\.?|H\.?|S\.?`;

  // Spellings that mean the same type as a canonical key.
  const TYPE_ALIAS = { H: 'HR' };

  // Canonical display spelling per normalised type key.
  const DISPLAY = {
    HR: 'H.R.', HRES: 'H. Res.', HJRES: 'H.J. Res.', HCONRES: 'H. Con. Res.',
    S: 'S.', SRES: 'S. Res.', SJRES: 'S.J. Res.', SCONRES: 'S. Con. Res.',
  };

  /**
   * "H. Res. 1499" | "H RES 1499" | "H.Res. 1499" | "HRES1499" -> "HRES1499".
   * Comparison key only — never display this to anyone.
   */
  function normalizeBillId(raw) {
    return String(raw == null ? '' : raw).toUpperCase().replace(/[.\s]/g, '');
  }

  /**
   * Pull the first bill identifier out of arbitrary text. Returns
   * { type, number, normalized, display } or null.
   *
   * `anchored` restricts the match to the start of the string, which is what a
   * roll-call question needs: "H R 1501 - On Passage" is about H.R. 1501, but
   * the question text of an amendment vote also mentions a bill number and must
   * not be read as a vote on the bill itself.
   */
  function parseBillId(text, opts) {
    const anchored = !!(opts && opts.anchored);
    if (!text) return null;
    const re = new RegExp(
      (anchored ? String.raw`^\s*` : String.raw`\b`) + `(${TYPE_PATTERN})\\s*(\\d+)`, 'i');
    const m = String(text).match(re);
    if (!m) return null;
    const rawKey = normalizeBillId(m[1]);
    const typeKey = TYPE_ALIAS[rawKey] || rawKey;
    const display = DISPLAY[typeKey];
    if (!display) return null;
    return {
      type: typeKey,
      number: m[2],
      normalized: typeKey + m[2],
      display: `${display} ${m[2]}`,
    };
  }

  /**
   * The identifier a roll-call question is about, as a normalised key — or null
   * when the question is not a vote on a measure's own passage.
   *
   * Procedural motions (recommit, previous question) and amendment votes name a
   * bill number too; stamping their tally onto the bill would report the wrong
   * outcome, so they are excluded here rather than at every call site.
   */
  function billIdFromRollCallQuestion(question) {
    const q = String(question || '');
    if (!q) return null;
    if (/motion to (commit|recommit|table)|previous question|ordering the previous|motion to refer/i.test(q)) return null;
    if (/\bamendment\b/i.test(q)) return null;
    const parsed = parseBillId(q, { anchored: true });
    return parsed ? parsed.normalized : null;
  }

  /** Do two spellings refer to the same measure? */
  function sameBill(a, b) {
    const na = normalizeBillId(a), nb = normalizeBillId(b);
    return !!na && na === nb;
  }

  root.BillId = { normalizeBillId, parseBillId, billIdFromRollCallQuestion, sameBill, TYPE_PATTERN, DISPLAY };
})(typeof globalThis !== 'undefined' ? globalThis : this);
