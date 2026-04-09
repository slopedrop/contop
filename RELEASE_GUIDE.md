# Release Guide

Step-by-step instructions for cutting releases, managing updates, and troubleshooting.

## Prerequisites

Before your first release, ensure all of these are configured:

### Desktop (Tauri)

- [ ] **Tauri updater signing keypair** generated: `npx tauri signer generate -w ~/.tauri/contop.key`
- [ ] **Public key** copied into `contop-desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey` (the base64 string output by the generate command)
- [ ] **GitHub secrets** configured on `slopedrop/contop`:
  - `TAURI_SIGNING_PRIVATE_KEY` - contents of `~/.tauri/contop.key`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - password used during key generation

### Mobile (Expo / EAS)

- [ ] **EAS project linked**: run `cd contop-mobile && eas init`
- [ ] **GitHub secret**: `EXPO_TOKEN` - from [expo.dev/accounts/settings](https://expo.dev/accounts/[account]/settings)
- [ ] **Android keystore** generated: `keytool -genkey -v -keystore contop.jks -keyalg RSA -keysize 2048 -validity 10000 -alias contop`
- [ ] **Android signing secrets** (for EAS or local builds):
  - `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
- [ ] **Apple Developer account** (for iOS): Apple ID, ASC App ID, Team ID configured in `eas.json`
- [ ] **Google Play Console**: service account JSON key for automated submissions at `contop-mobile/google-play-service-account.json` (gitignored)

## Versioning

**Semantic Versioning (semver):** `MAJOR.MINOR.PATCH`

| Stage | Tag example | GitHub Release | Who it's for |
|-------|-------------|----------------|--------------|
| Alpha | `desktop-v0.1.0-alpha.1` | Pre-release | Internal testers, brave early adopters |
| Beta | `desktop-v0.1.0-beta.1` | Pre-release | Wider testers, feature-complete |
| RC | `desktop-v0.1.0-rc.1` | Pre-release | Final validation |
| Stable | `desktop-v0.1.0` | Latest | Everyone |

Stay on `v0.x.x` while the project is pre-stable. Pre-release tags (`-alpha`, `-beta`, `-rc`) are automatically marked as pre-release by CI and won't be served to auto-update users.

## Changelog

There is one shared `CHANGELOG.md` at the repo root covering both desktop and mobile. Entries are grouped under platform headings when needed.

### How to Maintain It

Keep a running `## [Unreleased]` section at the top. Add notable changes as you commit them - don't wait until release time and try to reconstruct from memory.

```markdown
## [Unreleased]

### Desktop
- Added cross-platform dependency installation
- Fixed NVIDIA GPU detection in installer

### Mobile
- Fixed crash on Android 14 when pairing
```

### At Release Time

1. Rename `[Unreleased]` to the version and date
2. Add a fresh `[Unreleased]` section above it
3. Include the changelog update in the release commit

```markdown
## [Unreleased]

## Desktop [0.1.0-alpha.1] - 2026-04-04

### Added
- Cross-platform dependency installation
- Stopping server status indicator

### Fixed
- NVIDIA GPU detection in NSIS installer
```

### What Goes In

- **Add:** new features, new commands, new UI
- **Fix:** bug fixes
- **Change:** behavior changes, dependency updates
- **Remove:** removed features or deprecated items

Don't log every tiny commit - just the things a user or contributor would care about. If you forget, run `git log --oneline` since the last tag to jog your memory.

## Day-to-Day Development Workflow

### Regular Commits (no release)

Nothing changes from what you've been doing:

```bash
git add ...
git commit -m "feat: add new feature"
git push origin main
```

No version bump, no tag. CI does not trigger. Just update the `[Unreleased]` section in the changelog if the change is notable.

### Pre-Release Checklist

When you're ready to ship a test release:

- [ ] All changes committed and pushed to `main`
- [ ] **Tests pass:**
  - [ ] Server: `cd contop-server && uv run pytest tests/ --tb=short`
  - [ ] Mobile: `cd contop-mobile && npx jest`
  - [ ] Desktop: `cd contop-desktop && npx tsc --noEmit`
  - [ ] Website: `cd website && npm run build`
- [ ] **New/updated tests** written for any new or changed functionality
- [ ] `CHANGELOG.md` - `[Unreleased]` section renamed to version + date, fresh `[Unreleased]` added
- [ ] `README.md` - updated if there are new features, changed setup steps, or new screenshots
- [ ] Docs site (`docs/`) - updated if features, setup, APIs, or architecture changed
- [ ] Tested locally (`npm run tauri dev` for desktop, `npx expo start` for mobile)
- [ ] Run the bump script:
  ```bash
  ./scripts/bump-version.sh desktop 0.1.0-alpha.1 --push
  ```
- [ ] Watch CI at github.com/slopedrop/contop/actions
- [ ] Verify artifacts on the GitHub Releases page
- [ ] Download and smoke-test the installer (or portable zip)
- [ ] Verify Homebrew tap and Scoop bucket were auto-updated (check [homebrew-contop](https://github.com/slopedrop/homebrew-contop) and [scoop-contop](https://github.com/slopedrop/scoop-contop) for new commits)

### Stable Release Checklist

When promoting from alpha/beta to stable:

- [ ] All pre-release checklist items above (including tests)
- [ ] `CHANGELOG.md` - consolidate all alpha/beta entries into one clean stable entry
- [ ] `README.md` - ensure installation instructions point to stable release
- [ ] Docs site (`docs/`) - all pages accurate for this version (installation, quick-start, architecture, API reference)
- [ ] Website (`website/`) - any new features reflected in marketing copy
- [ ] Website download section - verify it picks up the new stable release (happens automatically via GitHub API)
- [ ] `RELEASE_GUIDE.md` - update if any process changed
- [ ] `CONTRIBUTING.md` - update if dev setup steps changed
- [ ] Run the bump script (no pre-release suffix):
  ```bash
  ./scripts/bump-version.sh desktop 0.1.0 --push
  ```
- [ ] Verify auto-updater works: open the previous version → should show update toast
- [ ] Post announcement (GitHub Discussions, social media, etc.)

### Mobile Release Checklist

- [ ] All changes committed and pushed
- [ ] **Tests pass:** `cd contop-mobile && npx jest`
- [ ] **New/updated tests** written for any new or changed functionality
- [ ] `CHANGELOG.md` - mobile section updated under version heading
- [ ] `app.json` version bumped
- [ ] Tested on device/emulator
- [ ] Run the bump script:
  ```bash
  ./scripts/bump-version.sh mobile 1.0.0-alpha.1 --push
  ```
- [ ] Verify APK on GitHub Releases page
- [ ] Side-load APK and smoke-test
- [ ] For stable: promote in Play Console / App Store Connect after testing

### What to Update and When

| What | When to update |
|------|---------------|
| `CHANGELOG.md` | Every notable commit (in `[Unreleased]`), finalize at release time |
| `README.md` | When features, setup steps, or screenshots change |
| Docs site (`docs/`) | When features, setup, architecture, or APIs change (see below) |
| Website (`website/`) | When adding new features users should know about |
| `RELEASE_GUIDE.md` | When the release process itself changes |
| `CONTRIBUTING.md` | When dev setup or contribution process changes |
| Download section | Automatic - pulls from GitHub Releases API |

### Docusaurus Docs (`docs/`)

The documentation site lives in `docs/` and covers user guides, architecture, API reference, and developer guides. Key pages to keep in sync:

| Page | Update when... |
|------|---------------|
| `docs/getting-started/installation.md` | Install steps, system requirements, or download links change |
| `docs/getting-started/quick-start.md` | First-run experience or setup flow changes |
| `docs/developer-guide/build-and-release.md` | Build process, CI/CD, or release workflow changes |
| `docs/user-guide/desktop-app.md` | Desktop features, UI, or settings change |
| `docs/user-guide/mobile-app.md` | Mobile features or setup changes |
| `docs/architecture/*.md` | When internals change (server, transport, state, etc.) |
| `docs/api-reference/*.md` | When REST API, tools, or data channel protocol changes |
| `docs/security/*.md` | When security model, pairing, or away mode changes |

You don't need to update docs on every commit - batch it before releases. Add it to your release checklist: "Are the docs still accurate?"

## How to Cut a Desktop Release

1. Complete the pre-release or stable release checklist above
2. Bump version in `contop-desktop/src-tauri/tauri.conf.json` and `contop-desktop/package.json`
3. Commit:
   ```bash
   git commit -am "release: desktop v0.2.0"
   ```
4. Tag and push:
   ```bash
   git tag desktop-v0.2.0
   git push origin main desktop-v0.2.0
   ```
5. CI builds on all 3 platforms (Windows, macOS, Linux), signs the update bundles, and publishes to GitHub Releases
6. Verify: check the [Releases page](https://github.com/slopedrop/contop/releases) for:
   - Windows: `.exe` (NSIS installer) + portable `.zip` (for Scoop)
   - macOS: `.dmg`
   - Linux: `.AppImage`, `.deb`
   - `latest.json` (required for auto-updater)
7. Homebrew tap and Scoop bucket are auto-updated by CI (see [Package Manager Update](#package-manager-update))

Or use the helper script (handles steps 2-4):

```bash
./scripts/bump-version.sh desktop 0.2.0        # local only - creates commit + tag
./scripts/bump-version.sh desktop 0.2.0 --push  # also pushes, triggering CI
```

## How to Cut a Mobile Release

1. Complete the mobile release checklist above
2. Bump version in `contop-mobile/app.json`
3. Commit, tag, and push:
   ```bash
   git commit -am "release: mobile v1.0.1"
   git tag mobile-v1.0.1
   git push origin main mobile-v1.0.1
   ```
4. CI runs EAS Build:
   - **APK** (preview profile) → attached to GitHub Release
   - **AAB** (production profile) → submitted to Google Play internal testing
   - **iOS** (production profile) → submitted to TestFlight
5. Promote manually in Play Console / App Store Connect when ready

## How to Push an OTA Hotfix (Mobile JS-Only)

For JS-only changes that don't need a new native binary:

```bash
git tag ota-v1.0.1-hotfix.1
git push origin ota-v1.0.1-hotfix.1
```

Or manually:

```bash
cd contop-mobile && eas update --branch production --message "fix: description"
```

## How Auto-Update Works (Desktop)

1. On launch, Tauri checks `latest.json` on GitHub Releases
2. If a newer version exists, user sees a toast: "Update available - Restart to update"
3. User clicks restart → app downloads the update, restarts
4. After update, `run_first_launch_setup` checks `pyproject_hash` in `setup_status.json` - if dependencies changed, re-runs `uv sync` automatically

## Package Manager Update

The Homebrew tap and Scoop bucket are **updated automatically** by the `update-package-managers` job in the desktop release workflow. After the GitHub Release is published, CI computes SHA256 hashes from the build artifacts and pushes updated manifests to both repos.

| Manager | Repo | Install command |
|---------|------|-----------------|
| Homebrew | [slopedrop/homebrew-contop](https://github.com/slopedrop/homebrew-contop) | `brew install slopedrop/contop/contop` |
| Scoop | [slopedrop/scoop-contop](https://github.com/slopedrop/scoop-contop) | `scoop bucket add contop https://github.com/slopedrop/scoop-contop` then `scoop install contop` |

### Requirements

- GitHub secret `PACKAGE_MANAGER_TOKEN` must be set on `slopedrop/contop` - a fine-grained PAT scoped to `slopedrop/homebrew-contop` and `slopedrop/scoop-contop` with `Contents: Read and write` permission.

### Manual update (if CI fails)

```bash
# Homebrew - get SHA256 of the .dmg, update version + sha256 in Casks/contop.rb
shasum -a 256 "Contop Desktop_x.x.x_aarch64.dmg"
cd homebrew-contop && git commit -am "Update contop to x.x.x" && git push

# Scoop - get SHA256 of the portable .zip, update version + url + hash in bucket/contop.json
sha256sum "Contop-Desktop_x.x.x_x64-portable.zip"
cd scoop-contop && git commit -am "Update contop to x.x.x" && git push
```

### When package managers are NOT updated

- Regular commits to main
- Mobile releases
- OTA hotfixes

Only desktop releases (tags matching `desktop-v*`) trigger the update.

## Dependency Installation Behavior

- **Windows (NSIS installer):** The installer detects NVIDIA GPU and runs `uv sync` with the correct extras during installation. Dependencies are ready when the app first launches.
- **Windows (Scoop / portable zip):** No installer runs. Dependencies are installed on first app launch via the setup overlay.
- **macOS / Linux:** No installer hook available (.dmg and .AppImage don't support post-install scripts). Dependencies are installed on first app launch via the setup overlay.
- Installer / portable zip is ~50 MB (includes uv, Python source, MinGit, PinchTab)
- Dependency installation takes 5-15 minutes depending on internet speed and GPU variant (CUDA PyTorch ~2.5 GB, CPU-only ~500 MB)
- First-launch setup shows a full-screen overlay with progress bar, human-readable status, and uv output detail
- If installation fails, the app will retry on next launch. The server can still start without GPU OmniParser (CPU fallback).

## Security Warnings by Install Method

| Install method | Warning? | Notes |
|---------------|----------|-------|
| Homebrew (macOS) | None | Brew removes quarantine flag |
| Scoop (Windows) | None | Portable zip extraction strips Mark of the Web |
| `.dmg` manual (macOS) | Gatekeeper | Right-click → Open → Open |
| `.exe` installer (Windows) | SmartScreen | More info → Run anyway |
| `.AppImage` / `.deb` (Linux) | None | No gatekeeper on Linux |

**Fast-follow:** purchase an Authenticode code signing certificate ($60-80/year) + Apple Developer ($99/year) to eliminate warnings for manual installs. Or apply for the free [SignPath OSS program](https://signpath.io/open-source).

## Rollback Strategy

- **Bad release shipped:** Immediately publish a new patched release. Tauri auto-updates to it on next launch.
- **App won't start:** Users download the previous version from [GitHub Releases](https://github.com/slopedrop/contop/releases) and reinstall manually.
- **Corrupted dependency state:** Delete `~/.contop/setup_status.json` to force setup re-run.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| CI build failure | Check Rust toolchain version, Node 22, signing keys configured |
| Update not detected | Verify `latest.json` is attached to the release, pubkey in `tauri.conf.json` matches |
| EAS build queued | Free tier has limited concurrency - wait or upgrade |
| Play Store rejection | Check privacy policy requirement, review permissions |
| First-launch stuck | Delete `~/.contop/setup_status.json` to force re-run |
| GPU not detected | Verify NVIDIA drivers installed, `nvidia-smi` on PATH |
| Tag rejected by CI | Must be exactly `desktop-vX.Y.Z` or `mobile-vX.Y.Z` (e.g., `desktop-v0.1.0-alpha.1`) |
