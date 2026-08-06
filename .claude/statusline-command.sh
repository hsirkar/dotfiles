#!/usr/bin/env bash
# Claude Code status line script

input=$(cat)

# Current directory (shorten home to ~)
cwd=$(echo "$input" | jq -r '.cwd // .workspace.current_dir // empty')
cwd="${cwd/#\/Users\/$USER/\~}"

# Model display name
model=$(echo "$input" | jq -r '.model.display_name // empty')

# Context window usage (pre-calculated percentage)
ctx_used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
ctx_remaining=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')

# Rate limit usage (token quota out of subscription limits)
five_hour=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
seven_day=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

# Build status line parts
parts=()

# Directory
[ -n "$cwd" ] && parts+=("$(printf '\033[1;34m%s\033[0m' "$cwd")")

# Model
[ -n "$model" ] && parts+=("$(printf '\033[0;36m%s\033[0m' "$model")")

# Context window
if [ -n "$ctx_used" ]; then
  ctx_used_int=$(printf '%.0f' "$ctx_used")
  if [ -n "$ctx_remaining" ]; then
    ctx_remaining_int=$(printf '%.0f' "$ctx_remaining")
    parts+=("$(printf '\033[0;33mctx: %s%% used / %s%% left\033[0m' "$ctx_used_int" "$ctx_remaining_int")")
  else
    parts+=("$(printf '\033[0;33mctx: %s%% used\033[0m' "$ctx_used_int")")
  fi
fi

# Token quota (rate limits)
quota_parts=()
[ -n "$five_hour" ] && quota_parts+=("5h:$(printf '%.0f' "$five_hour")%")
[ -n "$seven_day" ] && quota_parts+=("7d:$(printf '%.0f' "$seven_day")%")
if [ ${#quota_parts[@]} -gt 0 ]; then
  quota_str=$(IFS=' '; echo "${quota_parts[*]}")
  parts+=("$(printf '\033[0;35mquota: %s\033[0m' "$quota_str")")
fi

# Join parts with separator
printf '%s' "$(IFS='  |  '; printf '%b' "${parts[*]}")"
