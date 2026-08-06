#!/usr/bin/env bash
set -e

# ── Homebrew ──────────────────────────────────────────────────────────────────
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# ── Formulae ──────────────────────────────────────────────────────────────────
brew install \
  fish git python node \
  ollama wget curl jq \
  ripgrep fd fzf lsd \
  tmux neovim lazygit

# ── Casks ─────────────────────────────────────────────────────────────────────
brew install --cask \
  iterm2 alt-tab rectangle hiddenbar google-chrome firefox \
  obsidian postman unnaturalscrollwheels \
  windscribe spotify qbittorrent docker vlc minecraft

# ── Default shell: fish ───────────────────────────────────────────────────────
FISH_PATH="$(brew --prefix)/bin/fish"
grep -qxF "$FISH_PATH" /etc/shells || echo "$FISH_PATH" | sudo tee -a /etc/shells
chsh -s "$FISH_PATH"

# ── Claude Code ───────────────────────────────────────────────────────────────
curl -fsSL https://claude.ai/install.sh | bash
