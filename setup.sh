#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${BLUE}==>${NC} $*"; }
success() { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  !${NC} $*"; }
error()   { echo -e "${RED}  ✗${NC} $*"; exit 1; }

# ── Homebrew ──────────────────────────────────────────────────────────────────

if ! command -v brew &>/dev/null; then
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  # Add brew to PATH for the rest of this script (Apple Silicon path)
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
else
  success "Homebrew already installed"
fi

info "Updating Homebrew..."
brew update --quiet

# ── CLI tools ─────────────────────────────────────────────────────────────────

info "Installing CLI tools..."
brew install \
  fzf \
  fd \
  ripgrep \
  lazygit \
  neovim \
  node \
  git
success "CLI tools installed"

# ── Apps (casks) ──────────────────────────────────────────────────────────────

info "Installing iTerm2..."
brew install --cask iterm2
success "iTerm2 installed"

info "Installing JetBrainsMono Nerd Font..."
brew install --cask font-jetbrains-mono-nerd-font
success "JetBrainsMono Nerd Font installed"

# ── LazyVim ───────────────────────────────────────────────────────────────────

NVIM_CONFIG="$HOME/.config/nvim"

install_lazyvim() {
  git clone https://github.com/LazyVim/starter "$NVIM_CONFIG"
  rm -rf "$NVIM_CONFIG/.git"
  success "LazyVim starter cloned"
}

info "Setting up LazyVim..."
if [[ -d "$NVIM_CONFIG" ]]; then
  # Check if it's already a LazyVim install
  if grep -q "LazyVim" "$NVIM_CONFIG/lua/config/lazy.lua" 2>/dev/null; then
    success "LazyVim already configured — skipping"
  else
    warn "~/.config/nvim exists but is not LazyVim — backing up to ~/.config/nvim.bak"
    mv "$NVIM_CONFIG" "${NVIM_CONFIG}.bak"
    install_lazyvim
  fi
else
  install_lazyvim
fi

# ── Claude Code ───────────────────────────────────────────────────────────────

info "Installing Claude Code..."
npm install -g @anthropic-ai/claude-code
success "Claude Code installed"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Open iTerm2 → Preferences → Profiles → Text → change font to 'JetBrainsMono Nerd Font'"
echo "  2. Run 'nvim' — LazyVim will install all plugins on first launch"
echo "  3. Run 'claude' to log in to Claude Code"
