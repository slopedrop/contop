#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/bump-version.sh <desktop|mobile> <version> [--push]
# Example: ./scripts/bump-version.sh desktop 0.2.0
# Example: ./scripts/bump-version.sh mobile 1.0.1 --push

PLATFORM="${1:-}"
VERSION="${2:-}"
PUSH="${3:-}"

if [[ -z "$PLATFORM" || -z "$VERSION" ]]; then
  echo "Usage: $0 <desktop|mobile> <version> [--push]"
  echo "  e.g.: $0 desktop 0.2.0"
  echo "  e.g.: $0 mobile 1.0.1 --push"
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: Invalid semver: $VERSION"
  echo "Expected format: X.Y.Z or X.Y.Z-alpha.1"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

case "$PLATFORM" in
  desktop)
    TAG="desktop-v${VERSION}"

    # Update tauri.conf.json version
    TAURI_CONF="$REPO_ROOT/contop-desktop/src-tauri/tauri.conf.json"
    if [[ ! -f "$TAURI_CONF" ]]; then
      echo "Error: $TAURI_CONF not found"
      exit 1
    fi
    # Use node for reliable JSON editing
    node -e "
      const fs = require('fs');
      const conf = JSON.parse(fs.readFileSync('$TAURI_CONF', 'utf8'));
      conf.version = '$VERSION';
      fs.writeFileSync('$TAURI_CONF', JSON.stringify(conf, null, 2) + '\n');
    "
    echo "Updated $TAURI_CONF → $VERSION"

    # Update package.json version
    PKG="$REPO_ROOT/contop-desktop/package.json"
    if [[ -f "$PKG" ]]; then
      node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('$PKG', 'utf8'));
        pkg.version = '$VERSION';
        fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n');
      "
      echo "Updated $PKG → $VERSION"
    fi
    ;;

  mobile)
    TAG="mobile-v${VERSION}"

    # Update app.json version
    APP_JSON="$REPO_ROOT/contop-mobile/app.json"
    if [[ ! -f "$APP_JSON" ]]; then
      echo "Error: $APP_JSON not found"
      exit 1
    fi
    node -e "
      const fs = require('fs');
      const app = JSON.parse(fs.readFileSync('$APP_JSON', 'utf8'));
      app.expo.version = '$VERSION';
      fs.writeFileSync('$APP_JSON', JSON.stringify(app, null, 2) + '\n');
    "
    echo "Updated $APP_JSON → $VERSION"

    # Update package.json version
    PKG="$REPO_ROOT/contop-mobile/package.json"
    if [[ -f "$PKG" ]]; then
      node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('$PKG', 'utf8'));
        pkg.version = '$VERSION';
        fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n');
      "
      echo "Updated $PKG → $VERSION"
    fi
    ;;

  *)
    echo "Error: Unknown platform '$PLATFORM'. Use 'desktop' or 'mobile'."
    exit 1
    ;;
esac

# Commit and tag
cd "$REPO_ROOT"
git add -A
git commit -m "release: $PLATFORM v$VERSION"
git tag "$TAG"

echo ""
echo "Tag created: $TAG"

if [[ "$PUSH" == "--push" ]]; then
  git push origin main "$TAG"
  echo "Pushed to origin. CI will build the release."
else
  echo "Push with: git push origin main $TAG"
fi
