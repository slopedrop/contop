# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## Desktop [0.1.0-alpha.2] - 2026-04-06

### Fixed
- App failed to find contop-server on launch (both NSIS installer and Scoop portable) — resource path resolution now matches Tauri's bundled layout
- Portable zip now includes all bundled resources (contop-server, uv, PinchTab, MinGit) — previously only contained the bare exe
- Scoop manifest: removed `extract_dir` that caused `_tmp` cleanup error on install

## Desktop [0.1.0-alpha.1] - 2026-04-06

### Added
- First-launch setup wizard with automatic GPU detection and ML dependency installation
- First-launch setup overlay with progress bar, human-readable status, and download size estimates
- Auto-update support via Tauri updater plugin
- NSIS installer runs Python/ML dependency installation with GPU auto-detection (Windows)
- First-launch dependency installer for macOS and Linux
- "Stopping server..." UI feedback when closing the app
- macOS and Linux builds (DMG, AppImage, DEB) alongside Windows NSIS installer
- Portable `.zip` build for Windows alongside NSIS installer
- Homebrew tap for macOS — `brew install slopedrop/contop/contop` (no Gatekeeper warnings)
- Scoop bucket for Windows — `scoop install contop` (no SmartScreen warnings)
- CI auto-updates Homebrew tap and Scoop bucket on every desktop release
- `/api/ml-status` endpoint to check ML stack readiness

### Fixed
- Away Mode cross-platform compilation: adapted to core-graphics 0.24 API changes on macOS (CGEventTap, idle detection), fixed x11rb borrow lifetime on Linux, added IOKit framework linkage
- Blurry taskbar/shortcut icon on Windows (workaround for Tauri #14596)
- Close button deadlock — cleanup now runs on a background thread
- Terminal windows no longer flash on screen during server start (Windows)
- GPU/CPU dependency resolution errors when installing ML stack with `uv sync`
- First-launch setup overlay was never shown (broken `display:none` in HTML)
- Release workflow: added `contents: write` permission for GitHub Release creation

### Changed
- First-launch setup runs in the background so the app window loads immediately
- First-launch dependency install emits structured progress events (stage, message, detail)

## Mobile [0.1.0-alpha.1] - 2026-04-06

### Added
- Initial mobile app with QR code pairing, voice commands, and remote control

### Fixed
- App icon too close to edges after OS masking — adjusted adaptive foreground scale
- Expo packages updated and invalid EAS Build config fixed
- Release workflow: added `contents: write` permission for GitHub Release creation

## Website [0.1.0-alpha.1] - 2026-04-04

### Added
- Live download links that auto-detect visitor OS and pull version/size from GitHub Releases

### Changed
- iOS download card shows "Coming Soon" instead of a broken App Store link
