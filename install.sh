#!/usr/bin/env bash
set -e

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Homebrew ──────────────────────────────────────────────────────────────────
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# ── Formulae ──────────────────────────────────────────────────────────────────
brew install \
  fish git python node \
  ollama wget curl jq \
  ripgrep fd fzf lsd \
  tmux neovim lazygit

# ── Casks ─────────────────────────────────────────────────────────────────────
brew install --cask --force \
  iterm2 alt-tab rectangle hiddenbar google-chrome firefox \
  obsidian postman unnaturalscrollwheels \
  windscribe spotify qbittorrent docker vlc minecraft \
  font-jetbrains-mono-nerd-font

# ── Startup apps (login items) ────────────────────────────────────────────────
for app in "Rectangle" "AltTab" "UnnaturalScrollWheels" "Hidden Bar"; do
  osascript -e "tell application \"System Events\" to get the name of every login item" | grep -q "$app" || \
  osascript -e "tell application \"System Events\" to make login item at end with properties {path:\"/Applications/$app.app\", hidden:false}"
done

# ── AltTab: import exported settings ──────────────────────────────────────────
defaults import com.lwouis.alt-tab-macos "$DOTFILES_DIR/com.lwouis.alt-tab-macos.plist"
killall AltTab 2>/dev/null || true
open -a AltTab

# ── iTerm2: apply profile + Catppuccin Macchiato/Latte colors ─────────────────
bash "$DOTFILES_DIR/iterm2/apply-profile.sh"

# ── Rectangle: import exported settings ───────────────────────────────────────
jq -r '.defaults | to_entries[] | select(.value | length > 0) | "\(.key)\t\(.value | keys[0])\t\(.value | .[keys[0]])"' "$DOTFILES_DIR/RectangleConfig.json" | \
while IFS=$'\t' read -r key type value; do
  defaults write com.knollsoft.Rectangle "$key" "-$type" "$value"
done
killall Rectangle 2>/dev/null || true
open -a Rectangle

# ── UnnaturalScrollWheels: invert vertical scroll ─────────────────────────────
defaults write com.theron.UnnaturalScrollWheels InvertVerticalScroll -bool true
killall UnnaturalScrollWheels 2>/dev/null || true
open -a UnnaturalScrollWheels

# ── Default shell: fish ───────────────────────────────────────────────────────
FISH_PATH="$(brew --prefix)/bin/fish"
grep -qxF "$FISH_PATH" /etc/shells || echo "$FISH_PATH" | sudo tee -a /etc/shells
[ "$SHELL" = "$FISH_PATH" ] || chsh -s "$FISH_PATH"

# ── Symlink config.fish ───────────────────────────────────────────────────────
mkdir -p "$HOME/.config/fish"
ln -sf "$DOTFILES_DIR/config.fish" "$HOME/.config/fish/config.fish"

# ── Symlink tmux.conf ─────────────────────────────────────────────────────────
ln -sf "$DOTFILES_DIR/.tmux.conf" "$HOME/.tmux.conf"

# ── Symlink nvim config ───────────────────────────────────────────────────────
mkdir -p "$HOME/.config"
ln -sf "$DOTFILES_DIR/nvim" "$HOME/.config/nvim"

# ── Claude Code ───────────────────────────────────────────────────────────────
curl -fsSL https://claude.ai/install.sh | bash

mkdir -p "$HOME/.claude"
ln -sf "$DOTFILES_DIR/.claude/settings.json" "$HOME/.claude/settings.json"
ln -sf "$DOTFILES_DIR/.claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
ln -sf "$DOTFILES_DIR/.claude/statusline-command.sh" "$HOME/.claude/statusline-command.sh"
