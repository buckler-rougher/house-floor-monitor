/**
 * Reading one field out of a block of XML, shared by worker.js and testable on its own.
 *
 * The Worker reads senate.gov's XML with regular expressions (Workers have no DOMParser, and
 * the shapes are flat and stable). Five handlers each carried their own one-line reader, and
 * they were NOT the same: they differ in whether they tolerate attributes on the opening tag,
 * drop CDATA markers, strip inner tags, or only trim. One reader with those as options, and a
 * name for each combination in use, keeps the differences visible.
 */
(function (root) {
  'use strict';

  // The text of the first <tag>...</tag> in `block`, or '' if there is none.
  //   attrs     the opening tag may carry attributes (NominationDisplayNumber has some)
  //   cdata     drop CDATA markers
  //   strip     replace inner tags with a space
  //   collapse  squeeze runs of whitespace (implied by strip)
  function xmlField(block, tag, { attrs = false, cdata = false, strip = false, collapse = false } = {}) {
    const m = String(block).match(new RegExp(`<${tag}${attrs ? '(?:\\s[^>]*)?' : ''}>([\\s\\S]*?)</${tag}>`));
    if (!m) return '';
    let v = m[1];
    if (cdata) v = v.replace(/<!\[CDATA\[|\]\]>/g, '');
    if (strip) v = v.replace(/<[^>]*>/g, ' ');
    if (strip || collapse) v = v.replace(/\s+/g, ' ');
    return v.trim();
  }
  const xmlText = (b, t) => xmlField(b, t, { cdata: true, strip: true });          // senate.gov: markup and CDATA both possible
  const xmlPlain = (b, t) => xmlField(b, t, { strip: true });                       // plain element text
  const xmlRaw = (b, t) => xmlField(b, t);                                          // trimmed, inner markup kept
  const xmlNomination = (b, t) => xmlField(b, t, { attrs: true, cdata: true, collapse: true });

  root.XmlFields = { xmlField, xmlText, xmlPlain, xmlRaw, xmlNomination };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.XmlFields;
})(typeof globalThis !== 'undefined' ? globalThis : this);
