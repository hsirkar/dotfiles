#!/usr/bin/env python3
"""
Standalone collector: drives the Reddit app on a connected Android device via
adb and scrapes N posts (title, body, top comments) from the current feed
position, with no LLM in the loop. Writes structured JSON so an agent can read
it afterward and write the actual summary.

Usage:
    python3 collect_digest.py [--count 5] [--out digest.json] [--serial <adb serial>]

Relies on dump.py (same directory) for parsing uiautomator XML.
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dump as dumplib  # noqa: E402


def adb(args, serial=None, timeout=15):
    cmd = ["adb"] + (["-s", serial] if serial else []) + args
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def dump_xml(tag, workdir, serial=None):
    adb(["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"], serial)
    xml_path = workdir / f"{tag}.xml"
    r = adb(["shell", "cat", "/sdcard/window_dump.xml"], serial)
    xml_path.write_text(r.stdout)
    return xml_path


def parse_feed_lines(xml_path):
    """Returns list of (tap_x, tap_y, is_ad, summary)."""
    import re
    with open(xml_path) as f:
        c = f.read()
    lines = []
    card_re = re.compile(
        r'resource-id="(post_unit|promoted_post_unit)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
    )
    header_re = re.compile(r'resource-id="post_header"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
    desc_re = re.compile(r'content-desc="((?:From|Ad from) [^"]{5,2000})"')
    for m in card_re.finditer(c):
        card_start = m.end()
        rid = m.group(1)
        cx1, cy1, cx2, cy2 = map(int, m.groups()[1:])
        window = c[card_start: card_start + 1500]
        hm = header_re.search(window)
        dm = desc_re.search(window)
        if not dm:
            continue
        summary = dm.group(1)
        is_ad = rid == "promoted_post_unit" or "Promoted" in summary or summary.startswith("Ad from")
        if hm:
            hx1, hy1, hx2, hy2 = map(int, hm.groups())
            tap_x, tap_y = (hx1 + hx2) // 2, (hy1 + hy2) // 2
        else:
            tap_x, tap_y = (cx1 + cx2) // 2, cy1 + 20
        lines.append((tap_x, tap_y, is_ad, summary))
    return lines


def parse_post_lines(xml_path):
    import re
    out = []
    seen = set()
    with open(xml_path) as f:
        c = f.read()
    for m in re.finditer(r'(?:content-desc|text)="([^"]{2,600})"', c):
        s = m.group(1).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def is_post_detail(lines):
    """True if these parsed lines look like an open post (title/body/comments),
    not the feed or an image pager. A real post detail screen always has a
    "Posted by u/..." line or a "<n> votes, <n> comments" summary line near the
    top; the feed listing never does (its per-card text starts with "From ")."""
    import re
    for l in lines[:6]:
        if l.startswith("Posted by ") or re.match(r'^[\d,]+ votes?,', l):
            return True
    return False


def ensure_reddit_open(serial, workdir):
    r = adb(["shell", "dumpsys", "window"], serial)
    focus_line = next((l for l in r.stdout.splitlines() if "mCurrentFocus" in l), "")
    if "com.reddit.frontpage" not in focus_line:
        print("Reddit not in foreground, launching...", file=sys.stderr)
        adb(["shell", "monkey", "-p", "com.reddit.frontpage",
             "-c", "android.intent.category.LAUNCHER", "1"], serial)
        time.sleep(2.5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=5)
    ap.add_argument("--out", default="reddit_digest.json")
    ap.add_argument("--serial", default=None)
    ap.add_argument("--workdir", default=None, help="scratch dir for xml dumps")
    ap.add_argument("--max-scroll-per-post", type=int, default=2)
    ap.add_argument("--max-feed-scroll-attempts", type=int, default=6)
    args = ap.parse_args()

    workdir = Path(args.workdir) if args.workdir else Path.cwd() / "_reddit_digest_scratch"
    workdir.mkdir(parents=True, exist_ok=True)

    d = adb(["devices"], args.serial)
    device_lines = [l for l in d.stdout.splitlines()[1:] if l.strip().endswith("\tdevice")]
    if not device_lines:
        print("No authorized adb device found. Run `adb devices` and check the tablet.", file=sys.stderr)
        sys.exit(1)

    ensure_reddit_open(args.serial, workdir)

    seen_summaries = set()
    posts = []
    step = 0

    while len(posts) < args.count:
        step += 1
        # find next unopened, non-ad post; scroll the feed if needed
        chosen = None
        for attempt in range(args.max_feed_scroll_attempts):
            xml = dump_xml(f"feed_{step}_{attempt}", workdir, args.serial)
            feed = parse_feed_lines(xml)
            for tap_x, tap_y, is_ad, summary in feed:
                key = summary[:120]
                if is_ad or key in seen_summaries:
                    continue
                chosen = (tap_x, tap_y, summary)
                break
            if chosen:
                break
            adb(["shell", "input", "swipe", "400", "1200", "400", "400", "300"], args.serial)
            time.sleep(0.7)

        if not chosen:
            print(f"Couldn't find a fresh post after {args.max_feed_scroll_attempts} scroll "
                  f"attempts, stopping with {len(posts)} posts collected.", file=sys.stderr)
            break

        tap_x, tap_y, summary = chosen
        seen_summaries.add(summary[:120])
        print(f"[{len(posts)+1}/{args.count}] Opening: {summary[:90]}...", file=sys.stderr)

        adb(["shell", "input", "tap", str(tap_x), str(tap_y)], args.serial)
        time.sleep(1.0)

        xml = dump_xml(f"post_{step}_0", workdir, args.serial)
        first_lines = parse_post_lines(xml)

        if not is_post_detail(first_lines):
            # tap missed (or landed on an image pager) - retry once
            print("  tap didn't open the post, retrying...", file=sys.stderr)
            adb(["shell", "input", "tap", str(tap_x), str(tap_y)], args.serial)
            time.sleep(1.2)
            xml = dump_xml(f"post_{step}_0_retry", workdir, args.serial)
            first_lines = parse_post_lines(xml)

        if not is_post_detail(first_lines):
            print("  still failed, recording feed summary only", file=sys.stderr)
            posts.append({
                "feed_summary": summary,
                "detail_lines": [],
                "status": "tap_failed",
            })
            # we may have landed somewhere unexpected (feed scroll / image pager) -
            # back out defensively before continuing to the next post
            for _ in range(3):
                adb(["shell", "input", "keyevent", "4"], args.serial)
                time.sleep(0.6)
                xml = dump_xml(f"backcheck_{step}_recover", workdir, args.serial)
                if parse_feed_lines(xml):
                    break
            continue

        collected_lines = []
        seen_lines = set()
        for line in first_lines:
            seen_lines.add(line)
            collected_lines.append(line)
        for scroll_i in range(1, args.max_scroll_per_post + 1):
            adb(["shell", "input", "swipe", "400", "1000", "400", "500", "400"], args.serial)
            time.sleep(0.6)
            xml = dump_xml(f"post_{step}_{scroll_i}", workdir, args.serial)
            for line in parse_post_lines(xml):
                if line not in seen_lines:
                    seen_lines.add(line)
                    collected_lines.append(line)

        posts.append({
            "feed_summary": summary,
            "detail_lines": collected_lines,
            "status": "ok",
        })

        # back out to feed, verify
        for _ in range(3):
            adb(["shell", "input", "keyevent", "4"], args.serial)
            time.sleep(0.6)
            xml = dump_xml(f"backcheck_{step}", workdir, args.serial)
            if parse_feed_lines(xml):
                break

    out_path = Path(args.out)
    out_path.write_text(json.dumps(posts, indent=2))
    print(f"Wrote {len(posts)} posts to {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
