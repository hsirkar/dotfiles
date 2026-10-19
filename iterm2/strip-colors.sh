#!/usr/bin/env bash
# Strips color values from an exported iTerm2 profile JSON, in place.
# Colors are managed separately via .itermcolors presets.
set -e

FILE="${1:-profile.stripped.json}"
BEFORE=$(jq 'keys | length' "$FILE")

jq 'def is_color: type == "object" and has("Red Component") and has("Green Component") and has("Blue Component");
    with_entries(select(.value | is_color | not))' \
  "$FILE" > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"

AFTER=$(jq 'keys | length' "$FILE")
echo "stripped $((BEFORE - AFTER)) color keys from $FILE"
