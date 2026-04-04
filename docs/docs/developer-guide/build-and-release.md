---
sidebar_position: 5
---

# Build & Release

## Desktop App (Tauri v2)

The Tauri bundler produces platform-specific installers:

| Platform | Format | Output |
|----------|--------|--------|
| Windows | NSIS installer | `contop-desktop_x.x.x_x64-setup.exe` |
| macOS | DMG | `contop-desktop_x.x.x_universal.dmg` |
| Linux | AppImage | `contop-desktop_x.x.x_amd64.AppImage` |

### Building

```bash
cd contop-desktop
npm run tauri build
```

Output is placed in `src-tauri/target/release/bundle/`.

### Code Signing

- **Windows**: Authenticode signing (certificate required for production)
- **macOS**: Apple Developer ID signing + notarization
- **Linux**: No signing required for AppImage

### Server Sidecar Bundling

The Python server is bundled as a sidecar. The Tauri app manages it via `uv run uvicorn`:

- The `uv` binary and server code are included in the installer
- Server dependencies are resolved at install or first run via `uv sync`
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

| Platform | Channel | Status |
|----------|---------|--------|
| Windows | Direct download (NSIS) | Active |
| macOS | Direct download (DMG) | Active |
| Linux | Direct download (AppImage) | Active |
| iOS | TestFlight | Beta |
| Android | Direct APK | Beta |
| iOS App Store | Planned | — |
| Google Play | Planned | — |

---

**Related:** [Installation](/getting-started/installation) · [Testing](/developer-guide/testing) · [Project Structure](/developer-guide/project-structure)
