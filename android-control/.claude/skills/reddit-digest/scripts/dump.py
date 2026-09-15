#!/usr/bin/env python3
"""
Pull the current uiautomator accessibility tree from the connected device and
parse it. Two modes:

  dump.py feed <xml_out>          -> parse a home-feed screen
  dump.py post <xml_out>          -> parse an open post/comments screen

In both modes this script assumes the raw dump XML has already been pulled to
<xml_out> (via `adb shell uiautomator dump` + `adb shell cat`), and just does
the parsing. Kept separate from the adb calls so it has no dependency on the
device being reachable at parse time.
"""
import re
import sys


def parse_feed(xml_path):
    """Print one line per post card: tap_x tap_y is_ad subreddit | title/body preview"""
    with open(xml_path) as f:
        c = f.read()

    # Each post card is a `post_unit` or `promoted_post_unit` node (bounds),
    # immediately followed by a child node whose content-desc has the full
    # summary text ("From <subreddit>, Posted ..., <title>, ..., <n> upvotes, ...").
    # The header row inside the card (post_header) is the safe tap target —
    # tapping the card's image instead opens an image pager, not the post.
    card_re = re.compile(
        r'resource-id="(post_unit|promoted_post_unit)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
    )
    header_re = re.compile(r'resource-id="post_header"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
    desc_re = re.compile(r'content-desc="((?:From|Ad from) [^"]{5,2000})"')

    for m in card_re.finditer(c):
        card_start = m.end()
        rid = m.group(1)
        cx1, cy1, cx2, cy2 = map(int, m.groups()[1:])

        # look within the next ~1500 chars for this card's header + summary
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
            # fallback: top strip of the card, avoiding the lower image area
            tap_x, tap_y = (cx1 + cx2) // 2, cy1 + 20

        flag = "AD" if is_ad else "POST"
        print(f"{tap_x}\t{tap_y}\t{flag}\t{summary}")


def parse_post(xml_path):
    """Print the readable content-desc/text strings from an open post screen, in order."""
    with open(xml_path) as f:
        c = f.read()
    seen = set()
    for m in re.finditer(r'(?:content-desc|text)="([^"]{2,600})"', c):
        s = m.group(1).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        print(s)


if __name__ == "__main__":
    mode, xml_path = sys.argv[1], sys.argv[2]
    if mode == "feed":
        parse_feed(xml_path)
    elif mode == "post":
        parse_post(xml_path)
    else:
        sys.exit(f"unknown mode {mode!r}")
