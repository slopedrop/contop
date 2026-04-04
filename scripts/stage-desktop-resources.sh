#!/bin/bash
# stage-desktop-resources.sh
# Downloads and stages external binaries needed by the Tauri desktop build.
# Run before `tauri build` — called automatically in CI.
#
# Usage: bash scripts/stage-desktop-resources.sh
set -euo pipefail

RESOURCES_DIR="contop-desktop/src-tauri/resources"

# Pinned versions
MINGIT_VERSION="2.47.1"
MINGIT_ASSET="MinGit-${MINGIT_VERSION}-busybox-64-bit.zip"
MINGIT_URL="https://github.com/git-for-windows/git/releases/download/v${MINGIT_VERSION}.windows.1/${MINGIT_ASSET}"

PINCHTAB_VERSION="v0.8.2"
PINCHTAB_ASSET="pinchtab-windows-amd64.exe"
PINCHTAB_URL="https://github.com/pinchtab/pinchtab/releases/download/${PINCHTAB_VERSION}/${PINCHTAB_ASSET}"

UV_URL="https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip"

echo "[stage] Creating resources directory..."
mkdir -p "$RESOURCES_DIR/git-bash"
mkdir -p "$RESOURCES_DIR/contop-server"

# ── uv.exe ────────────────────────────────────────────────────────
if [ ! -f "$RESOURCES_DIR/uv.exe" ]; then
  echo "[stage] Downloading uv..."
  curl -L --fail -o /tmp/uv.zip "$UV_URL"
  unzip -o -j /tmp/uv.zip "uv.exe" -d "$RESOURCES_DIR/"
  rm /tmp/uv.zip
  echo "[stage] uv.exe staged."
else
  echo "[stage] uv.exe already exists, skipping."
fi

# ── MinGit (Git Bash) ────────────────────────────────────────────
if [ ! -f "$RESOURCES_DIR/git-bash/cmd/git.exe" ]; then
  echo "[stage] Downloading MinGit ${MINGIT_VERSION}..."
  curl -L --fail -o /tmp/mingit.zip "$MINGIT_URL"
  unzip -o -q /tmp/mingit.zip -d "$RESOURCES_DIR/git-bash/"
  rm /tmp/mingit.zip
  echo "[stage] MinGit staged."
else
  echo "[stage] MinGit already exists, skipping."
fi

# ── PinchTab ─────────────────────────────────────────────────────
if [ ! -f "$RESOURCES_DIR/pinchtab.exe" ]; then
  echo "[stage] Downloading PinchTab ${PINCHTAB_VERSION}..."
  curl -L --fail -o "$RESOURCES_DIR/pinchtab.exe" "$PINCHTAB_URL"
  echo "[stage] PinchTab staged."
else
  echo "[stage] PinchTab already exists, skipping."
fi

# ── contop-server source ─────────────────────────────────────────
echo "[stage] Copying contop-server source..."
rsync -a --delete \
  --exclude '.venv/' \
  --exclude '__pycache__/' \
  --exclude 'tests/' \
  --exclude '.ruff_cache/' \
  --exclude '.pytest_cache/' \
  contop-server/ "$RESOURCES_DIR/contop-server/"

echo "[stage] All resources staged."
echo "[stage] Contents:"
ls -la "$RESOURCES_DIR/"
