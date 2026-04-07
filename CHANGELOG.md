# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## Desktop [0.1.0-alpha.4] - 2026-04-07

### Added
- `open_file` tool — open any file in its default application (cross-platform: `os.startfile` on Windows, `open` on macOS, `xdg-open` on Linux)
- `office-documents` built-in skill with `convert_document` tool — convert between file formats (PDF, CSV, PNG, JPG, HTML) using auto-detected best method (Office COM, LibreOffice, or Python libraries)
- ctypes `EnumWindows` fallback for `window_list` when pywinauto is unavailable (Windows)
- Execution agent prompt: Python packages can now be installed on demand — if a script needs a missing package, the agent runs `pip install <package>` and retries instead of giving up or using workarounds

### Fixed
- `execute_accessible` (`set_value`): multi-line text (poems, code snippets, anything containing `\n`) had newlines silently stripped because `pywinauto.type_keys()` was called without `with_newlines=True` — now uses clipboard paste as the primary strategy (fast, preserves newlines/tabs/unicode, works in file dialogs) with a `type_keys(..., with_newlines=True, with_tabs=True)` fallback. Fixes ~32s typing time for long text → <1s via paste, and restores correct line-break handling that regressed weeks ago.
- `execute_accessible` on text editors: Notepad/WordPad/Word/VS Code expose their main editing area as a `Document` control type, but `_INTERACTIVE_TYPES` omitted `Document` — so neither `get_ui_context` nor the "available elements" hint on a not-found error surfaced it, forcing the model to guess `control_type="Edit"` and fail. Added `Document` to `_INTERACTIVE_TYPES` and documented it in the `execute_accessible` prompt snippet alongside a note that `Edit` is only for single-line fields.
- `save_dialog`: returned `status: success` even when intermediate `execute_accessible` calls failed — now checks each step's result and verifies the file exists on disk before reporting success (prevents the "fake success" where the model would claim the file was saved while it never actually was). Also requires `control_type=Edit` on the filename field and `control_type=Button` on the Save button, so fuzzy name matching can't pick up "File name:" label or "Save as type:" combobox instead of the intended control.
- `open_dialog`: same fixes — checks result status of each step and filters by `control_type` to disambiguate elements.
- `write_excel`: `add_sheet` now correctly targets the new sheet for subsequent operations; `merge_cells` and `set_column_width` gained `sheet` parameter support
- `launch_app` (Windows): apps on PATH launch via direct `subprocess.Popen` — no shell chain, no stray windows, no "Select an app" dialogs; apps not on PATH fall back to PowerShell `Start-Process`; return value reflects actual window/process state
- `launch_app` (Linux): removed `xdg-open name:` URI-scheme fallback that triggered the same error-dialog issue as Windows
- `execute_cli`: `start` commands under Git Bash are now backgrounded (`&`) to prevent the stall monitor from killing launched GUI apps
- `save_dialog`/`open_dialog`: fixed hotkey calls passing `coordinates` as JSON string instead of dict; added missing `target` parameter to `execute_gui` calls; removed redundant `target` parameter from `execute_accessible` calls
- `save_dialog`: changed hotkey from Ctrl+Shift+S (triggers Windows Snipping Tool) to Ctrl+S only; fails cleanly if no dialog appears
- `open_file`: removed TOCTOU race condition from file existence check; fixed window matching logic to prioritize new windows over filename match
- `open_file`: fixed tool evaluator classifying it as `empty_command` requiring confirmation — now routes as `workflow_operation` with no confirmation
- `close_app` and `copy_between_apps`: fixed hotkey calls passing `coordinates` as JSON string instead of dict; added missing `target` parameter
- Desktop (dev mode): `resolve_server_paths` now always uses source `contop-server/` directory in debug builds via `#[cfg(debug_assertions)]` — prevents stale bundled resource copy from shadowing code changes; extracted duplicated fallback path logic into `source_tree_paths()` helper
- Code quality: moved ctypes `EnumWindows` callback type to module-level static to avoid recreation overhead on every window enumeration; consolidated redundant window polling logic
- Execution agent prompt: removed misleading `execute_cli` examples for launching apps; added prominent rule to use `open_file`/`launch_app` instead

## Desktop [0.1.0-alpha.3] - 2026-04-06

### Fixed
- App failed to find contop-server on launch (NSIS installer) — resource path resolution now searches all candidate directories across all install methods
- CLI proxy ("Start" button in Settings) failed on installed builds — proxy is now bundled into resources
- Updated model descriptions in Settings: Gemini 3.1 Pro, GPT-5.4

## Desktop [0.1.0-alpha.2] - 2026-04-06

### Fixed
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

## Mobile [0.1.0-alpha.3] - 2026-04-07

### Added
- Intervention card now collapses long commands behind a `Show more`/`Show less` toggle (>200 chars) so the Execute Anyway / Abort buttons stay reachable without scrolling

### Fixed
- `QuickActionBar` crashed with `TypeError: Cannot read property 'displayName' of undefined` because `Text` was imported as a named export instead of the default — fixed the import

## Mobile [0.1.0-alpha.2] - 2026-04-06

### Fixed
- Release APK failed to connect to server over LAN — Android blocked cleartext `ws://` traffic in release builds
- iOS local networking allowed via `NSAllowsLocalNetworking` for LAN connections
- EAS Build failed due to invalid backup XML exclude rules (FullBackupContent lint error)

## Mobile [0.1.0-alpha.1] - 2026-04-06

### Added
- Initial mobile app with QR code pairing, voice commands, and remote control

### Fixed
- App icon too close to edges after OS masking — adjusted adaptive foreground scale
- Expo packages updated and invalid EAS Build config fixed
- Release workflow: added `contents: write` permission for GitHub Release creation
