---
name: reddit-digest
description: Drives a connected Android device over adb to open the Reddit app, read through several posts on the feed (including comments), and produce a written summary. Use when the user asks to "check reddit", "scan my reddit feed", "read reddit and summarize", or similar, and a phone/tablet is connected via adb.
---

# Reddit Digest

Automates reading the Reddit app on a connected Android device via `adb`, using
screenshots + vision to navigate (there is no accessibility-tree dump used here —
everything is driven by looking at screenshots and tapping/swiping coordinates).

Default post count is **5** unless the user asks for a different number.

## 0. Setup

Check a device is connected and authorized:

```bash
adb devices
```

- No devices listed → tell the user to plug in the device and enable USB debugging
  (Settings → About → tap Build number 7x → Developer options → USB debugging).
- Device listed as `unauthorized` → tell the user to check the device screen for the
  "Allow USB debugging?" popup and tap Allow.
- Device listed as `device` → good, proceed.

Save all screenshots to this session's scratchpad directory (never the repo), e.g.
`$SCRATCHPAD/reddit-digest/step_N.png`. Use:

```bash
adb exec-out screencap -p > "$SCRATCHPAD/reddit-digest/step_N.png"
```

then read the PNG with the Read tool to see it (vision).

## 1. Open Reddit if not already open

Check what's in the foreground:

```bash
adb shell dumpsys window | grep mCurrentFocus
```

If the focused package is not `com.reddit.frontpage`, launch it:

```bash
adb shell monkey -p com.reddit.frontpage -c android.intent.category.LAUNCHER 1
```

Wait ~2s, then screenshot to confirm you're on the home feed (not a login screen or
onboarding overlay). If Reddit isn't installed, tell the user and stop. If it opens to
a login wall, tell the user and stop rather than trying to log in.

If it's already open, screenshot to see the current scroll position on the feed
before proceeding — don't assume you're at the top.

## 2. Loop: read N posts (default 5)

Repeat the following `N` times. Keep a running list of notes, one entry per post.

1. **Screenshot the feed.** Read the image. Identify the next post card that:
   - hasn't been opened yet in this run, and
   - is not an ad (ads are labeled "Ad" / "Promoted" next to the poster name — skip
     these, they don't count toward N; keep scrolling until you find a real post).

   If no un-opened real post is visible, swipe up to scroll the feed
   (`adb shell input swipe 400 1200 400 400 300`), wait ~0.5s, and re-screenshot.

2. **Open the post.** Tap the post title/card at the coordinates you identified:

   ```bash
   adb shell input tap <x> <y>
   ```

   Wait ~1.5s, then screenshot to confirm the post detail view opened (look for a
   back/X control top-left and a "Join the conversation" comment box near the
   bottom). If nothing changed, retry the tap once; if it still fails, skip this post
   and move to the next feed item.

3. **Read the post.** From the screenshot, capture: subreddit, author, title, and the
   body text/image. If the body is long or there's an image that got cut off, swipe up
   within the post (`adb shell input swipe 400 1200 400 400 300`) and screenshot again
   to read the rest. Don't scroll more than ~3 times reading the body — this is a
   digest, not a full read.

4. **Read a few top comments.** Keep swiping up (same swipe as above) until comments
   are visible, screenshot, and read the top 2-3 comments (usually the highest-voted
   ones appear first). Note anything that meaningfully adds to or contradicts the
   post, or is the standout/funniest/most-upvoted reply. Don't go deep into reply
   threads.

5. **Note down the important bits** for this post: subreddit, title, one or two
   sentence gist of the content, and anything notable from the top comments (general
   consensus, a strong counterpoint, a key detail the post left out).

6. **Exit the post.** Go back to the feed:

   ```bash
   adb shell input keyevent 4
   ```

   Screenshot to confirm you're back on the feed (not on some intermediate screen —
   if the back button surfaced something else, keyevent 4 again).

7. Continue the loop from step 1. The feed usually preserves scroll position after
   going back, so the next real post should already be visible or one short swipe
   away — don't re-scroll from the top.

## 3. Summarize

After N posts, give the user a concise digest, one entry per post:

```
r/<subreddit> — <title>
<1-2 sentence gist>
Comments: <notable takeaway, if any>
```

Keep the whole summary tight — this is meant to be skimmable, not a transcript. If
any posts were skipped (ads, failed taps, login wall), mention that briefly at the
end rather than silently dropping them.

## Notes

- Screen coordinates depend on the device's actual resolution — always determine tap
  targets by looking at the most recent screenshot, never reuse coordinates from a
  previous run or a different device.
- If at any point the app shows an unexpected dialog (permission prompt, app update
  nag, etc.), screenshot, dismiss it if it's clearly safe to (e.g. "Not now" on an
  update nag), and continue. If it's ambiguous, stop and ask the user.
- This skill only reads — it must never upvote, comment, follow/join, or share
  anything on the user's behalf unless explicitly asked.
