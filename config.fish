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
