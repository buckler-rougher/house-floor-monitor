#!/usr/bin/env node
// A rehearsal for the Speaker election panel on a LIVE day: the 3 January 2025 captions served as a file that GROWS, the way the House's caption file does through the day, so the panel's own
// polling, parsing and re-reading can be watched against something that is not finished. Everything else is the real page code.
//
//   node dev/live-rehearsal.mjs                        # serve on :3466, one caption cue every 80 ms (the roll in about a minute and a half)
//   MS_PER_CUE=400 PORT=3466 node dev/live-rehearsal.mjs
//
// Then open the page on its fixtures with the live path pointed at it (the panel's `forced` day only picks which day's record to ask for; the harness answers with the fixture):
//   http://localhost:3456/?fixtures&speaker=1&rehearsal=http://localhost:3466/captions.vtt
//
// What it does to the file, on purpose: the file is cut off in the middle of a cue (a file being written is), it is also served once from the start again partway through (a restarted feed), and
// every response carries an Access-Control-Allow-Origin of *, like the House's CDN. GET /reset starts the clock again.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'test', 'speaker-election', 'captions-2025-01-03.vtt'), 'utf8');
const [header, ...cues] = src.split(/\n\n+/);
const PER = Number(process.env.MS_PER_CUE || 80);
const PORT = Number(process.env.PORT || 3466);
let t0 = Date.now();
let served = 0;

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url.startsWith('/reset')) { t0 = Date.now(); served = 0; res.end('reset\n'); return; }
  if (!req.url.startsWith('/captions.vtt')) { res.statusCode = 404; res.end('no'); return; }
  const n = Math.min(cues.length, Math.floor((Date.now() - t0) / PER));
  let body = header + '\n\n' + cues.slice(0, n).join('\n\n') + '\n\n';
  if (n < cues.length) body += cues[n].slice(0, Math.max(14, Math.floor(cues[n].length * 0.55)));   // a cue half written: no closing newline
  served++;
  console.log(`#${served} ${new Date().toISOString().slice(11, 19)} ${n}/${cues.length} cues${n < cues.length ? ' + a half cue' : ' (complete)'}`);
  res.setHeader('Content-Type', 'text/vtt');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}).listen(PORT, () => console.log(`live rehearsal on http://localhost:${PORT}/captions.vtt, one cue per ${PER} ms (${cues.length} cues)`));
