# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Blurry desktop taskbar/shortcut icon on Windows (custom ICO writer with 32x32 first entry to work around Tauri #14596)
- Mobile app icon too close to edges after OS masking (reduced adaptive foreground scale, added padding for iOS/Android)

### Added
- Initial public release
- Desktop app (Windows) with Tauri v2
- Mobile app (Android/iOS) with Expo
- AI agent with multi-model support (Gemini, OpenAI, Anthropic, Ollama)
- Screen capture and GUI automation via OmniParser
- WebRTC peer-to-peer connectivity
- Voice input with Google STT
- Website with project documentation
