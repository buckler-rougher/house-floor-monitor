// What a panel says when its source cannot be reached: plain words, naming the source, with no raw error text in them ("Failed to fetch", "HTTP 500" mean nothing to a reader;
// the console still has them).
//
//   SourceError.text('floor activity', 'senate')   "Could not load floor activity. The Senate's website did not respond. Check back shortly."
//
// `thing` is lowercase and goes after "load". `source` is a key below; an unknown or missing one leaves the middle sentence out. test/source-error.test.js
(function (root) {
  const SOURCES = {
    senate: "The Senate's website",
    congress: 'Congress.gov',
    docs: 'House Docs',
    clerk: "The House Clerk's website",
    mirror: 'The Twitter mirror',
  };

  function text(thing, source) {
    const who = SOURCES[source];
    return `Could not load ${thing}.${who ? ` ${who} did not respond.` : ''} Check back shortly.`;
  }

  // The same words as a panel's own failure state: the ghost of what the panel holds (shape: "rows", "doc", "cards", "people", "column"), "Could not load bills" as the headline, and who did not answer under it, in a faded red.
  function panel(thing, source, shape) {
    const who = SOURCES[source];
    return root.EmptyState.error(`Could not load ${thing}`, `${who ? `${who} did not respond. ` : ''}Check back shortly.`, shape);
  }

  root.SourceError = { text, panel, SOURCES };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SourceError;
})(typeof globalThis !== 'undefined' ? globalThis : this);
