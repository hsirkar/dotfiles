#!/usr/bin/env bash
set -e

export NONINTERACTIVE=1

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

# ── Default shell: fish ───────────────────────────────────────────────────────
FISH_PATH="$(brew --prefix)/bin/fish"
grep -qxF "$FISH_PATH" /etc/shells || echo "$FISH_PATH" | sudo tee -a /etc/shells
chsh -s "$FISH_PATH"

# ── Symlink config.fish ───────────────────────────────────────────────────────
DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$HOME/.config/fish"
ln -sf "$DOTFILES_DIR/config.fish" "$HOME/.config/fish/config.fish"

# ── Symlink tmux.conf ─────────────────────────────────────────────────────────
ln -sf "$DOTFILES_DIR/.tmux.conf" "$HOME/.tmux.conf"

# ── Claude Code ───────────────────────────────────────────────────────────────
curl -fsSL https://claude.ai/install.sh | bash

mkdir -p "$HOME/.claude"
ln -sf "$DOTFILES_DIR/.claude/settings.json" "$HOME/.claude/settings.json"
ln -sf "$DOTFILES_DIR/.claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
ln -sf "$DOTFILES_DIR/.claude/statusline-command.sh" "$HOME/.claude/statusline-command.sh"
