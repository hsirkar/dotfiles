# ── Homebrew ──────────────────────────────────────────────────────────────────
if test -x /opt/homebrew/bin/brew
    /opt/homebrew/bin/brew shellenv | source
else if test -x /usr/local/bin/brew
    /usr/local/bin/brew shellenv | source
end

# ── Claude Code ───────────────────────────────────────────────────────────────
fish_add_path $HOME/.local/bin

# ── lazygit ───────────────────────────────────────────────────────────────────
alias lg='lazygit'

# ── lsd (recommended aliases) ────────────────────────────────────────────────
alias ls='lsd'
alias l='lsd -l'
alias la='lsd -a'
alias lla='lsd -la'
alias lt='lsd --tree'

# ── tmux ──────────────────────────────────────────────────────────────────────
function tm
    tmux new-session -A -s default
end
