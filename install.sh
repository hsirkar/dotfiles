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
  windscribe spotify qbittorrent docker

# ── Claude Code ───────────────────────────────────────────────────────────────
curl -fsSL https://claude.ai/install.sh | bash
