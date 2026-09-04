#!/usr/bin/env node
/**
 * Static check that each generated fixture still selects its own mode.
 *
 * Re-implements the decision order of autoSwitchModeFromProceedings() (app.js)
 * closely enough to catch the common failure — a fixture whose text trips an
 * EARLIER branch than intended. The browser is still the authority; this just
 * gives a fast, dependency-free signal before spending a page load per mode.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/modes');

function pick(items, domeText) {
  const dome = (domeText || '').toLowerCase();
  if (dome.includes('recess') || dome.includes('adjourn')) return 'recess';
  if (dome.includes('vote') || dome.includes('voting')) return 'vote';
  const d = items.map(i => i.description);
  const latest = d[0].toLowerCase();
  const trimmed = i => i.trim();

  if (/adjourn|do now recess|stands in recess/.test(latest)) return 'recess';
  if (latest.startsWith('appointment of tellers')) return 'tellers';
  if (d.find(x => /^JOINT SESSION\b/i.test(trimmed(x)) && !/DISSOLVED/i.test(x))) return 'joint-session';
  if (d.find(x => /^CERTIFICATION OF ELECTORAL VOTES\b/i.test(trimmed(x)))) return 'cert-electoral';
  if (d.find(x => /^CERTIFICATION OF ELECTION\b/i.test(trimmed(x)))) return 'cert-election';
  if (d.find(x => { const l = x.toLowerCase();
      return l.includes('20th amendment') && (l.includes('convened') || l.includes('new legislative day')); })) return 'new-session';
  if (d.find(x => /^ADMINISTRATION OF THE OATH OF OFFICE\b/i.test(trimmed(x)))) return 'admin-oath';
  if (latest.includes('sine die')) return 'sine-die';
  const jm = d.find(x => /^JOINT MEETING\b/i.test(trimmed(x)));
  if (jm && !/DISSOLVED/i.test(jm)) return 'joint-meeting';
  if (latest.startsWith('the house received a message from')) return 'message';
  if (latest.includes('prayer') || latest.includes('chaplain')) return 'prayer';
  if (latest.includes('pledge') || latest.includes('allegiance')) return 'pledge';
  if (latest.includes('moment of silence') || latest.includes('silence')) return 'silence';
  if (latest.includes('act as chairman of the committee') || latest.includes('act as chair of the committee')) return 'committee-chair';
  if (latest.includes('speaker pro tempore') || latest.includes('pro tempore')) return 'speaker';

  const recessIdx = d.findIndex(x => /do now recess|stands in recess|adjourn/.test(x.toLowerCase()));
  const cand = recessIdx > 0 ? d.slice(0, recessIdx) : d;
  const has = re => cand.find(x => re.test(x.toLowerCase()));
  const cotw = has(/act as chairman of the committee|committee of the whole|resolved itself into the committee|^debate -/);
  const so = has(/special order speech|special orders/);
  const om = has(/one minute speech|one-minute speech/);
  const mh = has(/morning-hour debate|morning hour debate/);
  if (cotw) return 'debate';
  if (so) return 'special-order';
  if (om) return 'one-minute';
  if (mh) return 'morning-hour';
  if (d.slice(0, 5).find(x => /^OATH OF OFFICE\b/i.test(trimmed(x)))) return 'oath';
  if (/approval of the journal|approved the journal/.test(latest)) return 'journal';
  return 'none';
}

let bad = 0;
for (const mode of readdirSync(MODES).filter(f => !f.endsWith('.json')).sort()) {
  const items = JSON.parse(readFileSync(join(MODES, mode, 'proceedings.json'), 'utf8')).items;
  let domeText = 'House adjourned'; // fixtures/base default
  try {
    domeText = JSON.parse(readFileSync(join(MODES, mode, 'domewatch-floor.json'), 'utf8')).now.text;
  } catch {}
  const got = pick(items, domeText);
  const ok = got === mode;
  if (!ok) bad++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${mode.padEnd(16)} → ${got}`);
}
console.log(bad ? `\n${bad} fixture(s) select the wrong mode` : '\nall 22 fixtures select their own mode');
process.exit(bad ? 1 : 0);
