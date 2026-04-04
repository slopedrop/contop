---
name: cli-command-patterns
description: Cross-platform CLI command patterns, shell tips, and defensive construction techniques. Load when building shell commands, piping output, or working across Windows/macOS/Linux.
version: "1.1.0"
---

# CLI Command Patterns

All platforms use bash. On Windows, commands run in Git Bash by default. Use forward slashes in paths (`C:/Users/...`). `MSYS_NO_PATHCONV=1` is set automatically.

## Windows Notes

- **GUI apps block** — always append `&` to background: `notepad.exe &`
- **`.exe` suffix** — optional in Git Bash (`notepad` and `notepad.exe` both work)
- **PowerShell** — use `powershell -c "command"` for Windows-only operations (registry, services, COM)
- **Windows-only tools** — `tasklist`, `taskkill`, `netstat`, `systeminfo` work from bash

---

## Command Chaining

```bash
command_a && command_b          # B only if A succeeds
command_a || command_b          # B only if A fails
command_a ; command_b           # both regardless
(cmd && echo ok) || fallback    # compound with fallback
```

---

## Output Filtering

```bash
command | grep "pattern"                    # filter lines
grep -c "ERROR" logfile                     # count matches
command | awk '{print $2}'                  # extract field
command | sort | uniq -c | sort -rn         # count + rank
command | head -20                          # first N lines
grep -n -C 3 "error" log.txt               # context around match
```

### JSON (jq)

```bash
echo '{"name":"Alice"}' | jq '.name'
cat data.json | jq '.[] | select(.status=="err")'
# Windows fallback if jq unavailable:
powershell -c "(Get-Content data.json | ConvertFrom-Json).field"
```

### Text manipulation

```bash
echo "hello world" | sed 's/world/there/'   # replace
grep -v '^$' file.txt                       # remove blank lines
sed -n '10,20p' file.txt                    # line range
wc -l file.txt                              # line count
```

---

## Defensive Construction

### Quoting — #1 source of agent bugs

```bash
cat "/Users/john/My Documents/file.txt"     # ALWAYS quote paths
grep -F "$user_input" file.txt              # -F = literal (safe)
```

### Paths

```bash
# Always use absolute paths — relative paths depend on CWD
cat /home/user/file.txt                     # good
cat file.txt                                # bad

realpath "$path"                            # resolve symlinks
test -f "$file" && cat "$file"              # check before use
```

### Timeout

```bash
timeout 10 find / -name "*.log"             # kill after 10s
```

---

## File Operations

```bash
# Create file (heredoc)
cat > file.txt << 'EOF'
Line one
Line two with $dollar signs preserved
EOF

# Single line
echo "content" > file.txt                   # overwrite
echo "more" >> file.txt                     # append

# Bulk operations
for f in *.txt; do mv "$f" "${f%.txt}.md"; done
find . -name "*.tmp" -delete
find . -size +100M -type f
cp -R src/ dst/

# Read efficiently
cat -n file.txt                             # with line numbers
sed -n '10,20p' file.txt                    # line range
grep -o "pattern" file | wc -l              # count occurrences
```

---

## Process & System

```bash
# Processes
ps aux | grep -i "chrome"                   # Unix
tasklist | grep -i "chrome"                 # Windows (tasklist available in bash)

# Ports
lsof -i :8080                              # macOS
ss -tlnp | grep 8080                       # Linux
netstat -ano | grep :8080                   # Windows

# Kill
pkill -f "name"                            # Unix
taskkill /f /im name.exe                   # Windows

# Download
curl -L -o output.zip "https://example.com/file.zip"
```

---

## Git Patterns

```bash
git branch --show-current
git diff main...HEAD --stat
git log --all --oneline --grep="fix login"
git show HEAD~3:path/to/file.py
git blame -L 10,20 file.py
git log -S "function_name" --oneline
git reset --soft HEAD~1
git ls-files --others --exclude-standard
git stash push -m "wip: feature x"
```

---

## Power Patterns

```bash
# xargs
find . -name "*.pyc" | xargs rm
cat urls.txt | xargs -I {} curl -s {}

# Process substitution
diff <(ls dir1) <(ls dir2)

# Subshell (CWD reverts after)
(cd /tmp && do_work)

# Brace expansion
touch file_{a,b,c}.txt
cp config.yaml{,.bak}
mkdir day_{01..31}
```

---

## Heredocs

```bash
cat > script.py << 'PYEOF'
def hello():
    print("Hello from generated script")
PYEOF

# With variable expansion (no quotes on delimiter)
cat > config.txt << EOF
home=$HOME
date=$(date)
EOF

# Inline in git commit
git commit -m "$(cat <<'EOF'
feat: add new feature

Multi-line description here.
EOF
)"
```

---

## PowerShell (Windows-only operations)

Use `powershell -c "..."` from bash when you need registry, services, COM, or other Windows-only APIs:

```bash
powershell -c "(Get-FileHash 'file.txt' -Algorithm SHA256).Hash"
powershell -c "Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion'"
powershell -c "Get-Service | Where-Object {$_.Status -eq 'Running'}"
powershell -c "Compress-Archive -Path 'folder' -DestinationPath 'archive.zip'"
powershell -c "Expand-Archive -Path 'archive.zip' -DestinationPath 'output'"
```

---

## Agent Principles

```bash
# Idempotent — safe to re-run
mkdir -p /path
cp -n src dst
grep -q "line" file || echo "line" >> file

# Atomic — write to temp, then move
echo "content" > /tmp/tempfile && mv /tmp/tempfile /final/path

# Verify result
curl -o file.zip URL && test -s file.zip && echo "ok"

# Minimal output — reduce token cost
command > /dev/null 2>&1                    # silence
command | head -50                          # limit
git log --oneline -10                       # compact

# Error handling
command 2>&1 || echo "FAILED: command"
command; code=$?; [ $code -ne 0 ] && echo "failed: $code"
filename="${1:-default.txt}"                # default value
```

---

## Quick Reference

| Pattern | What it does |
|---|---|
| `cmd1 && cmd2` | Run cmd2 only if cmd1 succeeds |
| `cmd1 \|\| cmd2` | Run cmd2 only if cmd1 fails |
| `$(command)` | Substitute command output inline |
| `command > file 2>&1` | Redirect stdout + stderr |
| `command \| tee file` | Write to file AND stdout |
| `command &` | Run in background |
| `$?` | Exit code of last command |
| `${var:-default}` | Use default if var is unset |
| `${var%suffix}` | Remove suffix from var |
| `>` / `>>` | Overwrite / append redirect |
| `2>/dev/null` | Suppress stderr |
| `<(command)` | Process substitution |
| `{a,b,c}` | Brace expansion |
