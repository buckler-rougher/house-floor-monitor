# Senate captions: recording, replaying, and what a real day showed

The Senate publishes no structured feed of what is happening on the floor. The board reads the closed captions of the floor stream. The captions exist only while a day's stream does, so a
recorder saves them, and a replay script runs a saved day through the same readers the Worker uses. This file is the procedure, and what the first full day (10 November 2026) established.

## The pieces

| Piece | What it does |
|---|---|
| `.github/workflows/record-senate-captions.yml` | Runs on weekdays at 17:07 and 21:07 UTC (GitHub starts these 4 to 6 hours late), waits up to 340 minutes for a live stream, then records it. |
| `dev/record-senate-captions.mjs` | The recorder. Polls the stream's caption playlist every 30 seconds, saves each 12-second WebVTT segment, and stops itself when the playlist ends (`ENDLIST`). |
| `lib/senate-call.js` | Reads calls (quorum calls and roll call votes), the question, the tally, and who has the floor. One state machine for the Worker and the tab. |
| `lib/senate-modes.js` | Reads the floor modes (prayer, pledge, morning business, leader remarks, debate, wrap-up). |
| `dev/replay-senate-captions.mjs` | Replays a saved day through both readers and prints a timeline. |
| `dev/extract-senate-fixture.mjs` | Cuts ranges of a saved day into a test fixture. |
| `test/senate-captions-replay.test.js` | Pins what the first real day showed, using `test/senate-captions-2026-11-10.json`. |
| `dev/captures/senate-stv111026.tar.gz` | The whole of 10 November 2026: 2,889 segments, the combined `captions.txt`, and the recorder's log. |

## After a session: getting the capture

Artifacts expire after 90 days, so download a day worth keeping and commit it under `dev/captures/`.

```bash
gh run list --workflow=record-senate-captions.yml --limit 10
gh run download <run id> -D /tmp/captures/<run id>
```

An artifact over a few kilobytes holds a session; about 250 bytes is "nothing went live within 340 minutes" (read `record.log` in it). Two runs can record the same day, because the playlist
lists every segment from number 1 until the day ends, so the larger one is the more complete. A folder is named `stvMMDDYY`; segment `N` begins `12 * (N - 1)` seconds into the stream, and the
cue times inside it are that elapsed time, not the clock. The stream for 10 November began about 11:48 Eastern, a little ahead of the noon convening.

## Replaying a day

```bash
node dev/replay-senate-captions.mjs /tmp/captures/<run id>/senate-captions-<run id>/stv111026
```

It prints each mode change, each call beginning and ending (with what was counted against what the chair read), and a summary of every call. `--speakers` adds who had the floor and
`--json=out.json` saves the timeline. The clock is stream time. A vote's counted yeas and nays are a floor: the clerk's responses are not captioned, so only the recap, the late votes, and the
heading lists are heard, and the board switches to the chair's tally once it is read.

To check a reader against a day, find the truth by hand first, with the day's segments printed one at a time. The captions roll, so each cue holds the last three lines, and the same words appear in
several cues. A usable dedupe is to take, per segment, the lines that are not a prefix of the line after them.

## Adding a day to the tests

```bash
node dev/extract-senate-fixture.mjs <day folder> test/senate-captions-<date>.json opening=76-95 vote=2356-2364 ...
```

Keep ranges short and named for what they pin, and write the scenario in `test/senate-captions-replay.test.js`. The fixture is verbatim: do not clean up the captioner's errors (see below).

## What 10 November 2026 showed (a full day: 3 quorum calls, one 85-minute roll call, the wrap-up)

These were confirmed from the Senate's own captions. The earlier C-SPAN2 findings in `CLAUDE.md` described the same events in a different format.

**The captioner types section labels.** `QUORUM CALL:` appears on its own line when a quorum call starts, and `VOTE:` when a roll call starts, both before the clerk's first name. `ADJOURN:` and
`RECESS:` appear too. This is the one signal that a call begins, and it says which kind, so a roll call is a vote from its first name. The captioner types the label again after a pause (five
`VOTE:` labels in one roll call, and a second `QUORUM CALL:` inside the same call), so a label for the kind of call already running is the same call.

**A quorum call is started by the speaker and ended by a request.** Started by "I suggest the absence of a quorum" or "I note the absence of a quorum", answered by the chair's "The clerk will call
the roll." Ended, always by a request the chair grants "without objection", in four wordings:

- "I ask that it be VITIATED" (the senator was a hundred characters from the words "quorum call", so a window of 60 was too short)
- "I ask that the quorum call be LIFTED"
- "I ask that we DISPENSE with the quorum call"
- the majority leader's "the order for the quorum call be RESCINDED" (the form the code first knew, from the Record)

The clerk reads only the first name or two before the request, so a quorum call here counts one name. That is normal.

**A roll call.** The chair says "If not, the question is on the motion to proceed. Is there a sufficient second? There appears to be. The clerk will call the roll." The question is stated again by
each cue of the rolling window; the last statement is the complete one. The captions show the clerk's names being read ("MR. ARMSTRONG.") and late votes ("MR. BRITT, AYE."). The responses are
not captioned. About half an hour in, the clerk read a recap as a heading and a list:

    SENATORS VOTING IN THE AFFIRMATIVE -- ARMSTRONG, BARRASSO, BLACKBURN, ... WICKER, YOUNG.
    SENATORS VOTING IN THE NEGATIVE -- BALDWIN, BOOKER, DURBIN, ... ROUNDS. MR. WYDEN, NO. MS. DUCKWORTH, NO.

Bare surnames separated by commas, a full stop after the last. The window scrolls the heading off the top while the list goes on, and the tail of the affirmative list sits just ahead of the
negative heading. The roll lasted 85 minutes and the captions went silent for stretches of it (seven segments with no text, in one place). The chair read "ON THIS VOTE, THE YEAS ARE 62. THE NAYS
ARE 21. THE MOTION IS ADOPTED." Because the window holds three lines, the yeas had scrolled off by the cue that carried the nays, and the outcome came a cue later still.

**Recognition.** The standing form "The Democratic leader is recognized" was never said. The chair said "THE DEMOCRATIC LEADER." and "LEADER THUNE." (a bare title, and a title with a surname), and
for anyone else "THE SENATOR FROM ILLINOIS." The majority leader's first recognition was floor business ("I CALL UP SUBSTITUTE AMENDMENT 6883", "I MOVE TO COMMIT", "I ASK FOR THE YEAS AND
NAYS"), not remarks.

**Opening.** The chaplain's prayer, the pledge, the clerk reading the President pro tempore's appointment of the presiding officer, then "UNDER THE PREVIOUS ORDER, THE LEADERSHIP TIME IS RESERVED.
MORNING BUSINESS IS CLOSED. AND UNDER THE PREVIOUS ORDER, THE SENATE WILL RESUME CONSIDERATION OF THE MOTION TO PROCEED TO H.R. 2347, WHICH THE CLERK WILL REPORT." Morning business was closed
before it began, so that mode never started, which is correct.

**Wrap-up.** "I ask unanimous consent that when the Senate completes its business today, it stand adjourned until 12:00 noon on Wednesday, November 11, following the prayer and pledge, ..." then
"THE SENATE STANDS ADJOURNED UNTIL NOON TOMORROW." Then `ADJOURN:`.

**The captioner makes errors, and they are in the fixtures on purpose.** "WHEN" came out as "EXAMINE" in the wrap-up request. "ARE WE IN A QUORUM CALL" came out as "ARE WOULD NEW ENGLAND A
QUORUM CALL". While a line is being rewritten the window can hold "MR. NOT." or "MR. MR. PETERS:", which the name pattern read as senators.

## What the readers were changed to do (all from this one day)

- A WebVTT segment is read cue by cue (`SenateCall.feedVtt`). Joined, the end of one cue was read as the start of the next. The cue timings in the joined text also ended up inside a vote's question.
- `QUORUM CALL:` and `VOTE:` begin a call. A roll's first name no longer begins one.
- A quorum call ends on vitiated, lifted, dispense, or rescinded.
- Words after "MR." that are not names (`NOT`, `THE`, `MR`, and so on) are not senators.
- Inside an open vote, the clerk starting again at the top of the alphabet is the same vote, unless 20 minutes have passed with nothing heard.
- The question is the last statement of it in the segment.
- The tally is read across cues, and the outcome word is added to a tally read within a minute.
- The heading lists are read, and a list with no heading in the cue is a continuation of the heading before it, for 90 seconds.
- The leader overlay starts on the chair's bare "THE DEMOCRATIC LEADER." and "LEADER THUNE." and ends, or does not start, when the leader moves to run the floor.
- The wrap-up cue tolerates a garbled "when".

Counted at the end of the roll, the replay heard 61 yeas and 21 nays against the chair's 62 and 21. One senator's vote is never captioned.

## Still unknown, to check at the next full session

- The two caption sources have still not been compared: the Worker reads this WebVTT sidecar and the browser reads the video's CEA-608. Everything above is the WebVTT. If the browser's text carries
  no `VOTE:` label or a different window, the tab will read a call later than the Worker (the merge takes whichever is newer).
- A vote that is not a roll call (a voice vote, "the ayes appear to have it") is not read at all.
- Morning business as a mode, executive session, and the leaders' real daily remarks have not been seen; 10 November used none of them. The overlay's end (another recognition, a different member label,
  or 30 minutes) is untested on real remarks beyond the Democratic leader's.
- Whether a `PRESENT` heading exists (only affirmative and negative were heard).
- The two Scotts in a heading list. The clerk's roll read "MR. SCOTT OF FLORIDA." and "MR. SCOTT OF SOUTH CAROLINA." (keyed `SCOTT (FL)` and `SCOTT (SC)`, as designed); a bare "SCOTT" in a recap list is read as the bare key, which lights neither.
- Only the stream for the day the Senate sits is recorded. A pro forma day, or a day the Senate was out, saves nothing, which is expected.
