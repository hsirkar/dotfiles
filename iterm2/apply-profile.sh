#!/usr/bin/env bash
# Applies profile.stripped.json to iTerm2 as a Dynamic Profile, with
# Gruvbox Dark and Gruvbox Light colors merged in.
set -e

ITERM2_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DYNAMIC_PROFILES_DIR="$HOME/Library/Application Support/iTerm2/DynamicProfiles"
DARK_COLORS_URL="https://raw.githubusercontent.com/mbadolato/iTerm2-Color-Schemes/master/schemes/Gruvbox%20Dark.itermcolors"
LIGHT_COLORS_URL="https://raw.githubusercontent.com/mbadolato/iTerm2-Color-Schemes/master/schemes/Gruvbox%20Light.itermcolors"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$DARK_COLORS_URL" -o "$TMP_DIR/dark.itermcolors"
curl -fsSL "$LIGHT_COLORS_URL" -o "$TMP_DIR/light.itermcolors"
plutil -convert json -o "$TMP_DIR/dark.json" "$TMP_DIR/dark.itermcolors"
plutil -convert json -o "$TMP_DIR/light.json" "$TMP_DIR/light.itermcolors"

mkdir -p "$DYNAMIC_PROFILES_DIR"

jq -n \
  --slurpfile profile "$ITERM2_DIR/profile.stripped.json" \
  --slurpfile dark "$TMP_DIR/dark.json" \
  --slurpfile light "$TMP_DIR/light.json" \
  '($dark[0] | with_entries(.key += " (Dark)")) as $dark_colors
   | ($light[0] | with_entries(.key += " (Light)")) as $light_colors
   | {"Profiles": [$profile[0] + $dark_colors + $light_colors]}' \
  > "$DYNAMIC_PROFILES_DIR/rakrish-profile.json"

GUID=$(jq -r '.Guid' "$ITERM2_DIR/profile.stripped.json")
defaults write com.googlecode.iterm2 "Default Bookmark Guid" -string "$GUID"

echo "applied iTerm2 profile with Gruvbox Dark / Light, set as default"

# ── iTerm2: general preferences ────────────────────────────────────────────
# tmux: bury the client session after attaching, don't use a dedicated
# "tmux" profile, and open unrecognized/new tmux windows as tabs in a new
# window (rather than as separate windows).
defaults write com.googlecode.iterm2 AutoHideTmuxClientSession -bool true
defaults write com.googlecode.iterm2 TmuxUsesDedicatedProfile -bool false
defaults write com.googlecode.iterm2 OpenTmuxWindowsIn -int 1

# Appearance > Panes: no per-pane title bar on splits.
defaults write com.googlecode.iterm2 ShowPaneTitles -bool false

# General > Selection: clicking a command doesn't restrict Find/Filter to it.
defaults write com.googlecode.iterm2 ClickToSelectCommand -bool false

# Keys: leader key is Ctrl-a.
defaults write com.googlecode.iterm2 Leader -string "0x61-0x40000-0x0"

echo "applied iTerm2 general preferences"
