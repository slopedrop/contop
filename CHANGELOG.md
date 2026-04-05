# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## Desktop [0.1.0-alpha.1] - 2026-04-04

### Added
- First-launch setup wizard with automatic GPU detection and ML dependency installation
- Auto-update support via Tauri updater plugin
- NSIS installer runs Python/ML dependency installation with GPU auto-detection (Windows)
- First-launch dependency installer for macOS and Linux
- "Stopping server..." UI feedback when closing the app
- macOS and Linux builds (DMG, AppImage, DEB) alongside Windows NSIS installer
- `/api/ml-status` endpoint to check ML stack readiness

### Fixed
- Blurry taskbar/shortcut icon on Windows (workaround for Tauri #14596)
- Close button deadlock — cleanup now runs on a background thread
- Terminal windows no longer flash on screen during server start (Windows)
- GPU/CPU dependency resolution errors when installing ML stack with `uv sync`

### Changed
- First-launch setup runs in the background so the app window loads immediately

## Mobile [0.1.0-alpha.1] - 2026-04-04

### Added
- Initial mobile app with QR code pairing, voice commands, and remote control

### Fixed
- App icon too close to edges after OS masking — adjusted adaptive foreground scale

## Website [0.1.0-alpha.1] - 2026-04-04

### Added
- Live download links that auto-detect visitor OS and pull version/size from GitHub Releases

### Changed
- iOS download card shows "Coming Soon" instead of a broken App Store link
