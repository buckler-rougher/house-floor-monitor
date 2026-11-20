// A KV namespace held in memory (get / put / delete / list): enough for this Worker's use of it. Used ONLY by the staging Worker, which has no KV namespace (wrangler.toml [env.staging]), so nothing it
// does can spend the account's 1,000 daily KV writes. Per isolate: it forgets on a restart, which is fine for testing. Values are kept as strings, as KV keeps them.
(function (root) {
  'use strict';
  function MemoryKv() {
    const m = new Map();
    const shape = (v, type) => (v == null ? null : (type === 'json' || (type && type.type === 'json')) ? JSON.parse(v) : v);
    return {
      async get(key, type) { return m.has(key) ? shape(m.get(key), type) : null; },
      async put(key, value) { m.set(key, typeof value === 'string' ? value : String(value)); },
      async delete(key) { m.delete(key); },
      async list(opts = {}) {
        const keys = [...m.keys()].filter((k) => !opts.prefix || k.startsWith(opts.prefix)).map((name) => ({ name }));
        return { keys, list_complete: true, cursor: undefined };
      },
    };
  }
  root.MemoryKv = MemoryKv;
  if (typeof module !== 'undefined' && module.exports) module.exports = MemoryKv;
})(typeof globalThis !== 'undefined' ? globalThis : this);
