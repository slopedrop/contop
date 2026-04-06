#!/bin/bash
# stage-desktop-resources.sh
# Downloads and stages external binaries needed by the Tauri desktop build.
# Run before `tauri build` — called automatically in CI.
#
# Usage: bash scripts/stage-desktop-resources.sh
# Set CONTOP_PLATFORM to override auto-detection (windows, macos, linux)
set -euo pipefail

RESOURCES_DIR="contop-desktop/src-tauri/resources"

# Detect platform
if [[ -n "${CONTOP_PLATFORM:-}" ]]; then
  PLATFORM="$CONTOP_PLATFORM"
elif [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* || "$OSTYPE" == win* ]]; then
  PLATFORM="windows"
elif [[ "$OSTYPE" == darwin* ]]; then
  PLATFORM="macos"
else
  PLATFORM="linux"
fi

echo "[stage] Platform: $PLATFORM"

# Pinned versions
PINCHTAB_VERSION="v0.8.2"

echo "[stage] Creating resources directory..."
mkdir -p "$RESOURCES_DIR/contop-server"

# ── uv binary ────────────────────────────────────────────────────
case "$PLATFORM" in
  windows)
    UV_URL="https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip"
    UV_BIN="uv.exe"
    ;;
  macos)
    # Universal binary works for both Intel and Apple Silicon
    UV_URL="https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-apple-darwin.tar.gz"
    UV_BIN="uv"
    ;;
  linux)
    UV_URL="https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz"
    UV_BIN="uv"
    ;;
esac

if [ ! -f "$RESOURCES_DIR/$UV_BIN" ]; then
  echo "[stage] Downloading uv..."
  UV_TMPDIR=$(mktemp -d)
  if [[ "$UV_URL" == *.zip ]]; then
    curl -L --fail -o "$UV_TMPDIR/uv.zip" "$UV_URL"
    unzip -o -j "$UV_TMPDIR/uv.zip" "$UV_BIN" -d "$RESOURCES_DIR/"
  else
    curl -L --fail -o "$UV_TMPDIR/uv.tar.gz" "$UV_URL"
    tar -xzf "$UV_TMPDIR/uv.tar.gz" -C "$UV_TMPDIR/"
    find "$UV_TMPDIR" -name "$UV_BIN" -type f -exec cp {} "$RESOURCES_DIR/$UV_BIN" \;
  fi
  rm -rf "$UV_TMPDIR"
  chmod +x "$RESOURCES_DIR/$UV_BIN" 2>/dev/null || true
  echo "[stage] $UV_BIN staged."
else
  echo "[stage] $UV_BIN already exists, skipping."
fi

# ── MinGit (Git Bash) — Windows only ────────────────────────────
if [[ "$PLATFORM" == "windows" ]]; then
  MINGIT_VERSION="2.47.1"
  MINGIT_ASSET="MinGit-${MINGIT_VERSION}-busybox-64-bit.zip"
  MINGIT_URL="https://github.com/git-for-windows/git/releases/download/v${MINGIT_VERSION}.windows.1/${MINGIT_ASSET}"

  mkdir -p "$RESOURCES_DIR/git-bash"
  if [ ! -f "$RESOURCES_DIR/git-bash/cmd/git.exe" ]; then
    MINGIT_TMPDIR=$(mktemp -d)
    echo "[stage] Downloading MinGit ${MINGIT_VERSION}..."
    curl -L --fail -o "$MINGIT_TMPDIR/mingit.zip" "$MINGIT_URL"
    unzip -o -q "$MINGIT_TMPDIR/mingit.zip" -d "$RESOURCES_DIR/git-bash/"
    rm -rf "$MINGIT_TMPDIR"
    echo "[stage] MinGit staged."
  else
    echo "[stage] MinGit already exists, skipping."
  fi
fi

# ── PinchTab ─────────────────────────────────────────────────────
case "$PLATFORM" in
  windows)
    PINCHTAB_ASSET="pinchtab-windows-amd64.exe"
    PINCHTAB_BIN="pinchtab.exe"
    ;;
  macos)
    PINCHTAB_ASSET="pinchtab-darwin-arm64"
    PINCHTAB_BIN="pinchtab"
    ;;
  linux)
    PINCHTAB_ASSET="pinchtab-linux-amd64"
    PINCHTAB_BIN="pinchtab"
    ;;
esac

PINCHTAB_URL="https://github.com/pinchtab/pinchtab/releases/download/${PINCHTAB_VERSION}/${PINCHTAB_ASSET}"

if [ ! -f "$RESOURCES_DIR/$PINCHTAB_BIN" ]; then
  echo "[stage] Downloading PinchTab ${PINCHTAB_VERSION}..."
  curl -L --fail -o "$RESOURCES_DIR/$PINCHTAB_BIN" "$PINCHTAB_URL"
  chmod +x "$RESOURCES_DIR/$PINCHTAB_BIN" 2>/dev/null || true
  echo "[stage] PinchTab staged."
else
  echo "[stage] PinchTab already exists, skipping."
fi

# ── contop-server source ─────────────────────────────────────────
echo "[stage] Copying contop-server source..."
if command -v rsync &>/dev/null; then
  rsync -a --delete \
    --exclude '.venv/' \
    --exclude '__pycache__/' \
    --exclude 'tests/' \
    --exclude '.ruff_cache/' \
    --exclude '.pytest_cache/' \
    contop-server/ "$RESOURCES_DIR/contop-server/"
else
  # Fallback for Windows (no rsync)
  rm -rf "$RESOURCES_DIR/contop-server"
  cp -r contop-server "$RESOURCES_DIR/contop-server"
  rm -rf "$RESOURCES_DIR/contop-server/.venv" \
         "$RESOURCES_DIR/contop-server/tests" \
         "$RESOURCES_DIR/contop-server/.ruff_cache" \
         "$RESOURCES_DIR/contop-server/.pytest_cache"
  find "$RESOURCES_DIR/contop-server" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
fi

echo "[stage] All resources staged."
echo "[stage] Contents:"
ls -la "$RESOURCES_DIR/"
