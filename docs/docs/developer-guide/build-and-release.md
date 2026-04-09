---
sidebar_position: 5
---

# Build & Release

## Desktop App (Tauri v2)

The Tauri bundler produces platform-specific installers:

| Platform | Format | Output |
|----------|--------|--------|
| Windows | NSIS installer | `Contop Desktop_x.x.x_x64-setup.nsis.exe` |
| Windows | Portable zip (for Scoop) | `Contop-Desktop_x.x.x_x64-portable.zip` |
| macOS | DMG | `Contop Desktop_x.x.x_aarch64.dmg` |
| Linux | AppImage + DEB | `Contop Desktop_x.x.x_amd64.AppImage`, `.deb` |

### Building

```bash
cd contop-desktop
npm run tauri build
```

Output is placed in `src-tauri/target/release/bundle/`.

### Code Signing

Currently unsigned (open-source alpha). Users install via package managers (Homebrew, Scoop) to avoid security warnings, or accept the OS-level warning on manual installs.

- **Windows**: Authenticode signing planned for production (certificate ~$60-80/year, or [SignPath OSS](https://signpath.io/open-source))
- **macOS**: Apple Developer ID signing + notarization planned ($99/year)
- **Linux**: No signing required

### Server Sidecar Bundling

The Python server is bundled as a sidecar. The Tauri app manages it via `uv run uvicorn`:

- The `uv` binary and server code are included in the installer / portable zip
- Server dependencies are resolved at install (NSIS) or first launch (all other methods) via `uv sync`
- NVIDIA GPU is auto-detected - CUDA PyTorch (~2.5 GB) is installed if available, otherwise CPU-only (~500 MB)
- First-launch setup shows a progress overlay with download status
- The sidecar is spawned on app startup and killed on exit

## Mobile App (Expo EAS Build)

Mobile builds use Expo with a managed workflow and dev client for native WebRTC dependencies.

### iOS (TestFlight)

```bash
cd contop-mobile
eas build --platform ios --profile production
eas submit --platform ios
```

### Android (APK)

```bash
cd contop-mobile
eas build --platform android --profile production
```

The APK is available for direct download. Google Play distribution is planned for GA.

:::note
Production builds require EAS Build or `expo run:android` / `expo run:ios` with a dev client due to native WebRTC bridging.
:::

## Distribution Channels

| Platform | Channel | Status | Security Warning? |
|----------|---------|--------|-------------------|
| macOS | Homebrew (`brew install slopedrop/contop/contop`) | Active | None |
| macOS | Direct download (DMG) | Active | Gatekeeper (right-click → Open) |
| Windows | Scoop (`scoop install contop`) | Active | None |
| Windows | Direct download (NSIS installer) | Active | SmartScreen (More info → Run anyway) |
| Linux | Direct download (AppImage / DEB) | Active | None |
| Android | Direct APK | Beta | Install from unknown sources |
| iOS | - | Not yet available | - |
| iOS App Store | Planned | - | - |
| Google Play | Planned | - | - |

### Package Manager Repos

After each desktop release, update the Homebrew tap and Scoop bucket with the new version and SHA256 hash. See the [Release Guide](https://github.com/slopedrop/contop/blob/main/RELEASE_GUIDE.md#package-manager-update) for step-by-step instructions.

| Manager | Repo | Manifest |
|---------|------|----------|
| Homebrew | [slopedrop/homebrew-contop](https://github.com/slopedrop/homebrew-contop) | `Casks/contop.rb` |
| Scoop | [slopedrop/scoop-contop](https://github.com/slopedrop/scoop-contop) | `bucket/contop.json` |

---

**Related:** [Installation](/getting-started/installation) · [Testing](/developer-guide/testing) · [Project Structure](/developer-guide/project-structure)
