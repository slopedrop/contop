# Release Guide

Step-by-step instructions for cutting releases, managing updates, and troubleshooting.

## Prerequisites

Before your first release, ensure all of these are configured:

### Desktop (Tauri)

- [ ] **Tauri updater signing keypair** generated: `npx tauri signer generate -w ~/.tauri/contop.key`
- [ ] **Public key** copied into `contop-desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey` (the base64 string output by the generate command)
- [ ] **GitHub secrets** configured on `slopedrop/contop`:
  - `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/contop.key`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — password used during key generation

### Mobile (Expo / EAS)

- [ ] **EAS project linked**: run `cd contop-mobile && eas init`
- [ ] **GitHub secret**: `EXPO_TOKEN` — from [expo.dev/accounts/settings](https://expo.dev/accounts/[account]/settings)
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

## How to Cut a Desktop Release

1. Bump version in `contop-desktop/src-tauri/tauri.conf.json` and `contop-desktop/package.json`
2. Commit:
   ```bash
   git commit -am "release: desktop v0.2.0"
   ```
3. Tag and push:
   ```bash
   git tag desktop-v0.2.0
   git push origin main desktop-v0.2.0
   ```
4. CI builds on all 3 platforms (Windows, macOS, Linux), signs the update bundles, and publishes to GitHub Releases
5. Verify: check the [Releases page](https://github.com/slopedrop/contop/releases) for:
   - Windows: `.exe` (NSIS installer)
   - macOS: `.dmg`
   - Linux: `.AppImage`, `.deb`
   - `latest.json` (required for auto-updater)

Or use the helper script:

```bash
./scripts/bump-version.sh desktop 0.2.0        # local only — creates commit + tag
./scripts/bump-version.sh desktop 0.2.0 --push  # also pushes, triggering CI
```

## How to Cut a Mobile Release

1. Bump version in `contop-mobile/app.json`
2. Commit, tag, and push:
   ```bash
   git commit -am "release: mobile v1.0.1"
   git tag mobile-v1.0.1
   git push origin main mobile-v1.0.1
   ```
3. CI runs EAS Build:
   - **APK** (preview profile) → attached to GitHub Release
   - **AAB** (production profile) → submitted to Google Play internal testing
   - **iOS** (production profile) → submitted to TestFlight
4. Promote manually in Play Console / App Store Connect when ready

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
2. If a newer version exists, user sees a toast: "Update available — Restart to update"
3. User clicks restart → app downloads the update, restarts
4. After update, `run_first_launch_setup` checks `pyproject_hash` in `setup_status.json` — if dependencies changed, re-runs `uv sync` automatically

## Dependency Installation Behavior

- **Windows:** The NSIS installer detects NVIDIA GPU and runs `uv sync` with the correct extras during installation. Dependencies are ready when the app first launches.
- **macOS / Linux:** No installer hook available (.dmg and .AppImage don't support post-install scripts). Dependencies are installed on first app launch — the app shows progress and disables "Start Server" until complete.
- Installer is ~50 MB (includes uv, Python source, MinGit, PinchTab)
- Dependency installation takes 5-15 minutes depending on internet speed and GPU variant (CUDA PyTorch ~2.5 GB)
- If installation fails, the app will retry on next launch. The server can still start without GPU OmniParser (CPU fallback).

## Windows SmartScreen Warning

Without code signing, users see "Windows protected your PC" on first install. They must click **"More info" → "Run anyway"**.

This is the #1 UX friction point for new users. It's documented on the download page and README.

**Fast-follow:** purchase an Authenticode code signing certificate ($200-400/year) or apply for the free [SignPath OSS program](https://signpath.io/open-source).

## Rollback Strategy

- **Bad release shipped:** Immediately publish a new patched release. Tauri auto-updates to it on next launch.
- **App won't start:** Users download the previous version from [GitHub Releases](https://github.com/slopedrop/contop/releases) and reinstall manually.
- **Corrupted dependency state:** Delete `~/.contop/setup_status.json` to force setup re-run.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| CI build failure | Check Rust toolchain version, Node 22, signing keys configured |
| Update not detected | Verify `latest.json` is attached to the release, pubkey in `tauri.conf.json` matches |
| EAS build queued | Free tier has limited concurrency — wait or upgrade |
| Play Store rejection | Check privacy policy requirement, review permissions |
| First-launch stuck | Delete `~/.contop/setup_status.json` to force re-run |
| GPU not detected | Verify NVIDIA drivers installed, `nvidia-smi` on PATH |
| Tag rejected by CI | Must be exactly `desktop-vX.Y.Z` or `mobile-vX.Y.Z` (e.g., `desktop-v0.1.0-alpha.1`) |
