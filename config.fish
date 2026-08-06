# ── PATH ──────────────────────────────────────────────────────────────────────
/opt/homebrew/bin/brew shellenv | source
fish_add_path $HOME/.local/bin

# ── Aliases ───────────────────────────────────────────────────────────────────
alias sonnet='claude --model sonnet'
alias opus='claude --model opus'
alias resume='claude /resume'
alias lg='lazygit'
alias ls='lsd'
alias l='lsd -l'
alias la='lsd -a'
alias lla='lsd -la'
alias lt='lsd --tree'
alias vi='nvim'

# ── tmux ──────────────────────────────────────────────────────────────────────
function tm
    tmux new-session -A -s default
end
