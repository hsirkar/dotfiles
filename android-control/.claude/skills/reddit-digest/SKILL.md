---
name: reddit-digest
description: Drives a connected Android device over adb to open the Reddit app, read through several posts on the feed (including comments), and produce a written summary. Use when the user asks to "check reddit", "scan my reddit feed", "read reddit and summarize", or similar, and a phone/tablet is connected via adb.
---

# Reddit Digest

Automates reading the Reddit app on a connected Android device via `adb`, driven by
the on-screen **accessibility tree** (`uiautomator dump`) rather than screenshots.
Reddit's app exposes post titles, bodies, votes, and comment text directly as
`content-desc`/`text` attributes, so posts can be read as structured text — no
vision round-trip needed for the text itself. Screenshots are only a fallback for
posts that are genuinely image/GIF-driven with little text.

This is faster than a screenshot-per-step loop: each post typically costs one `adb
shell uiautomator dump` + one parse, not several screenshot-and-look cycles.

Default post count is **5** unless the user asks for a different number.

Helper script: `scripts/dump.py` (in this skill's directory), two modes:
- `dump.py feed <xml>` → prints one line per post card: `tap_x  tap_y  POST|AD  <summary text>`
- `dump.py post <xml>` → prints the readable strings from an open post/comments screen, in order

## Fast path: standalone collector (no agent loop)

For the common case (scan N posts on the current feed, comments included), the
whole loop below can run unattended via `scripts/collect_digest.py` — it drives
adb directly with no LLM round-trips per step, and writes structured JSON. Use
this instead of the manual loop whenever the user just wants the raw material
collected; read the resulting JSON afterward and write the actual digest yourself.

```bash
python3 <skill_dir>/scripts/collect_digest.py \
  --count 5 \
  --out "$SCRATCHPAD/reddit-digest/digest.json" \
  --workdir "$SCRATCHPAD/reddit-digest/scratch"
```

Each entry in the output JSON is `{"feed_summary": ..., "detail_lines": [...],
"status": "ok" | "tap_failed"}`. `tap_failed` means the script verified (via
`is_post_detail`) that tapping the post's header didn't open a real post-detail
screen even after one retry — in that case only the feed-preview text is
available, and you should say so rather than inventing comment content for it.

The manual step-by-step loop (2.1–2.6 below) is still the right tool when: the
user wants to watch it happen turn-by-turn, the feed layout/resolution is unusual
enough that the fixed swipe/tap logic needs a human-in-the-loop judgment call, or
`collect_digest.py` needs debugging.

## 0. Setup

Check a device is connected and authorized:

```bash
adb devices
```

- No devices → tell the user to plug in the device and enable USB debugging.
- `unauthorized` → tell the user to tap Allow on the device's popup.
- `device` → proceed.

Use this session's scratchpad directory for all dump/screenshot files, e.g.
`$SCRATCHPAD/reddit-digest/`.

## 1. Open Reddit if not already open

```bash
adb shell dumpsys window | grep mCurrentFocus
```

If the focused package isn't `com.reddit.frontpage`:

```bash
adb shell monkey -p com.reddit.frontpage -c android.intent.category.LAUNCHER 1
```

Wait ~2s, then dump+parse (see step 2.1) to confirm you're on the home feed and not
a login/onboarding screen. If Reddit isn't installed or shows a login wall, tell the
user and stop.

If it's already open, dump+parse first to see current state before assuming you're
at the top of the feed.

## 2. Loop: read N posts (default 5)

Repeat `N` times, keeping a running list of notes (one entry per post).

### 2.1 Find the next post on the feed

```bash
adb shell uiautomator dump /sdcard/window_dump.xml
adb shell cat /sdcard/window_dump.xml > "$SCRATCHPAD/reddit-digest/feed_N.xml"
python3 <skill_dir>/scripts/dump.py feed "$SCRATCHPAD/reddit-digest/feed_N.xml"
```

This prints lines like:

```
449   137   POST   From ClaudeCode, Posted 16h ago, The limits have been reduced..., 786 upvotes, 310 comments
449   982   AD     From grantcash, Promoted post, ...
```

Pick the first `POST` line (not `AD`) that you haven't already opened this run. If
none is present, swipe to scroll the feed and re-dump:

```bash
adb shell input swipe 400 1200 400 400 300
```

### 2.2 Open the post — tap the header, never the image

Tap the `tap_x tap_y` coordinates from the chosen line:

```bash
adb shell input tap <tap_x> <tap_y>
```

**Why the header and not the card body:** these coordinates are computed from the
post's `post_header` node (subreddit/join/menu row). Tapping there reliably opens
the normal scrollable post+comments screen. Tapping a post's image
(`post_self_image`/`post_link_thumbnail`) instead opens an image-focused swipe
viewer that pages to the *next* image post on further swipes — it does not show
that post's comments. Always use the header coordinates the script gives you, not
the geometric center of the card.

Wait ~1s, then dump+parse:

```bash
adb shell uiautomator dump /sdcard/window_dump.xml
adb shell cat /sdcard/window_dump.xml > "$SCRATCHPAD/reddit-digest/post_N_a.xml"
python3 <skill_dir>/scripts/dump.py post "$SCRATCHPAD/reddit-digest/post_N_a.xml"
```

You should see lines like subreddit/author/title, the post body text, vote/comment
counts, and often the first comment(s) already visible. If the dump looks like
you're still on the feed (or on an image pager — no "Level 1 comment" or post body
lines), the tap missed the header; re-derive the tap point and retry once.

### 2.3 Read the post + comments

From the parsed text, note: subreddit, title, body gist, vote/comment counts. If
comments aren't visible yet, scroll for more:

```bash
adb shell input swipe 400 1000 400 500 400
```

then dump+parse again the same way, into a new file (`post_N_b.xml`, etc.). Look
for lines like `Level 1 comment by X, ..., N votes` followed by the comment text —
read the top 2-3. Don't scroll more than ~3-4 times total (body + comments) — this
is a digest, not a full read.

If a post's parsed text is sparse (just title + "Image" with no body/comment text
visible yet — common for pure image/meme posts), it's fine to take one screenshot
to describe the image instead of digging further:

```bash
adb exec-out screencap -p > "$SCRATCHPAD/reddit-digest/post_N.png"
```

Then read it with the Read tool.

### 2.4 Note down the important bits

Subreddit, title, one-two sentence gist, and anything notable from the top
comments (consensus, strong counterpoint, a detail the post left out).

### 2.5 Exit back to the feed

```bash
adb shell input keyevent 4
```

Dump+parse once more to confirm you're back on a feed listing (POST/AD lines show
up again). If not, send `keyevent 4` again.

### 2.6 Continue the loop

Go back to 2.1. The feed generally preserves scroll position, so the next real post
is usually already visible or one short swipe away.

## 3. Summarize

After N posts, give the user a concise digest, one entry per post:

```
r/<subreddit> — <title>
<1-2 sentence gist>
Comments: <notable takeaway, if any>
```

Keep it skimmable. If any posts were skipped (ads, failed taps, login wall,
couldn't get a clean read), mention that briefly at the end.

## Notes

- Coordinates are always derived fresh from the current dump — never reuse
  coordinates from a previous run or a different device/resolution.
- `dump.py`'s parsing depends on Reddit's current accessibility labeling
  (`post_unit`/`promoted_post_unit`/`post_header` resource-ids, `content-desc`
  strings starting with "From "/"Ad from "). If Reddit updates their app and the
  parser stops finding posts (empty output from `dump.py feed`), fall back to a
  screenshot + vision read for that step and mention to the user that the parser
  may need updating.
- If an unexpected dialog appears (permission prompt, update nag), dump/screenshot
  it, dismiss if obviously safe ("Not now"), and continue. If ambiguous, stop and
  ask the user.
- Read-only: never upvote, comment, follow/join, or share anything unless
  explicitly asked.
