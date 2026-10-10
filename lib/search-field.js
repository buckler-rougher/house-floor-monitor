// The board's search box: a small header above it that spells out what can be searched ("SEARCH BY NAME OR STATE"), and, while the box is empty, an example that
// changes by itself, taken from the real data the box searches ("e.g. Pingree" ... "e.g. Maine"), sliding out and in. It is the house-salaries search bar's idea
// (its rotating job titles) made one component for every search box here.
//
//   const f = SearchField.mount(inputEl, { fields: ['Name', 'State'], examples: ['Pingree', 'Maine'] })
//   f.setExamples(listFromTheData)       when the data arrives or changes
//   f.refresh()                          after the page sets the box's value itself
//
// The examples rotate every three seconds, in a shuffled order, and stop while the box has focus or has text; they are not read out (the box's label says what it
// searches). With reduced motion the first example is shown and nothing moves. The box itself is untouched (its own class, its own listeners); it is moved into a
// wrapper that carries the header, and the example is drawn over it with the box's own padding and font. The rotation stops by itself when the box leaves the page.
//
//   SearchField.sample(list, n)          pure: the distinct, non-empty strings of a list, shuffled, at most n   (test/search-field.test.js)
//   SearchField.describe(lead, fields)   pure: the header's words ("Search by name or state")

(function (root) {
  const CYCLE_MS = 3000;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // "Search by" + ["Name", "State"] -> "Search by name or state"; three: "number, sponsor or summary". Shown capitalized by the stylesheet, like every small label.
  function describe(lead, fields) {
    const f = (fields || []).map((x) => String(x).toLowerCase());
    const list = f.length > 1 ? `${f.slice(0, -1).join(', ')} or ${f[f.length - 1]}` : f.join('');
    return `${lead} ${list}`.trim();
  }

  function sample(list, n = 40, random = Math.random) {
    const seen = new Set();
    const out = [];
    for (const x of list || []) {
      const s = String(x == null ? '' : x).trim();
      if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
    }
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out.slice(0, n);
  }

  function mount(input, opts = {}) {
    if (!input || typeof document === 'undefined') return null;
    if (input._searchField) { if (opts.examples) input._searchField.setExamples(opts.examples); return input._searchField; }
    const fields = opts.fields || [];
    const lead = opts.lead || 'Search by';
    const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cs = getComputedStyle(input);

    const field = document.createElement('div');
    field.className = 'search-field';
    field.style.margin = cs.margin;                // the box's own outer spacing moves to the wrapper
    input.style.margin = '0';
    const head = document.createElement('div');
    head.className = 'search-field-head';
    head.setAttribute('aria-hidden', 'true');
    head.textContent = describe(lead, fields);
    const box = document.createElement('div');
    box.className = 'search-field-box';
    input.before(field);
    field.append(head, box);
    box.append(input);
    const example = document.createElement('span');
    example.className = 'search-field-example';
    example.setAttribute('aria-hidden', 'true');
    example.innerHTML = 'e.g. <span class="search-field-word"></span>';
    box.append(example);
    const word = example.querySelector('.search-field-word');
    input.placeholder = '';
    if (!input.getAttribute('aria-label')) input.setAttribute('aria-label', `${lead} ${fields.join(', ')}`.trim());
    // drawn where the box's own text would start, in the box's own face; read once the box is on screen (one in a hidden panel has no face to copy yet)
    let styled = false;
    function styleExample() {
      if (styled || !input.offsetParent) return;
      styled = true;
      const ps = getComputedStyle(input);
      example.style.font = ps.font;
      example.style.padding = `${ps.paddingTop} ${ps.paddingRight} ${ps.paddingBottom} calc(${ps.paddingLeft} + ${ps.borderLeftWidth})`;
      example.style.letterSpacing = ps.letterSpacing;
    }

    let pool = [];
    let idx = 0;
    let focused = false;
    let timer = null;
    const hideIf = () => { styleExample(); example.classList.toggle('is-hidden', input.value.length > 0 || !pool.length); };

    function show(i) { word.textContent = pool[i] || ''; hideIf(); }
    function setExamples(list) {
      pool = sample(list);
      idx = 0;
      show(0);
      if (!reduce && pool.length > 1 && !timer) timer = setTimeout(cycle, CYCLE_MS);
    }
    function cycle() {
      timer = null;
      if (!document.contains(input)) return;       // the box is gone (a closed modal): stop
      hideIf();                                     // a value set by the page (not typed) is noticed here
      if (focused || input.value.length > 0 || pool.length < 2) { timer = setTimeout(cycle, CYCLE_MS); return; }
      idx = (idx + 1) % pool.length;
      word.classList.remove('sf-in');
      word.classList.add('sf-out');
      setTimeout(() => { word.textContent = pool[idx]; word.classList.remove('sf-out'); word.classList.add('sf-in'); }, 350);
      timer = setTimeout(cycle, CYCLE_MS);
    }
    input.addEventListener('focus', () => { focused = true; hideIf(); });
    input.addEventListener('blur', () => { focused = false; hideIf(); });
    input.addEventListener('input', hideIf);

    const api = { setExamples, refresh: hideIf, input };
    input._searchField = api;
    setExamples(opts.examples || []);
    return api;
  }

  root.SearchField = { mount, sample, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SearchField;
})(typeof globalThis !== 'undefined' ? globalThis : this);
