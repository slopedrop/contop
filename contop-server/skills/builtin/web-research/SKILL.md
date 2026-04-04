---
name: web-research
description: Web browsing strategies, Electron app automation, and search patterns. Load when performing web searches, browsing pages, or controlling Electron apps.
version: "1.0.0"
---

# Web Research & Browser Automation

## When to Use execute_browser vs execute_gui

Use `execute_browser` (PinchTab CDP) when:
- Searching the web (navigate to search engine, fill query, extract results)
- Reading page content or extracting text from a webpage
- Filling forms with text input
- Clicking buttons, links, or interactive elements
- Navigating between pages
- Any task where you need TEXT from a page (not a picture of it)

Use `execute_gui` + `observe_screen` when:
- Task requires VISUAL verification (checking layout, colors, images)
- Drag-and-drop interactions
- Interacting with canvas, WebGL, or heavy JS-rendered apps
- The web app's UI elements are non-standard

PinchTab is automatically downloaded at server startup and started on first browser tool use. If `execute_browser` returns an error, fall back to `execute_gui` + `observe_screen`.

## Electron Apps (VS Code, Slack, Discord, etc.)

Electron apps are desktop applications built with web technologies. To interact with them deterministically:

1. If the app is NOT yet running: launch it with the `--remote-debugging-port=9222` flag via `execute_cli`:
   - `start "" "C:\path\to\app.exe" --remote-debugging-port=9222` (Windows)
   - `open -a "AppName" --args --remote-debugging-port=9222` (macOS)
2. Call `execute_browser` with action="connect_cdp" and url="http://localhost:9222"
3. Once connected, use `execute_browser` for all interactions (snapshot, click, fill, extract_text)

If the app is ALREADY running (user launched it normally), you CANNOT attach CDP. Use `execute_accessible` or `observe_screen` + `execute_gui` instead.

## Browser Security — Intent-Based

Before calling execute_browser for potentially risky operations, evaluate the intent:

**SAFE (proceed without confirmation):**
- Reading/extracting page content
- Navigating to URLs the user explicitly mentioned
- Taking snapshots
- Clicking links to read content

**REQUIRES CAUTION (explain what you'll do before proceeding):**
- Filling forms with user data
- Clicking submit/purchase/delete buttons
- Navigating to financial or authenticated pages
- Any action that could trigger a transaction, send a message, or modify data

If in doubt, tell the user what you're about to do and wait for confirmation. Never silently submit forms, make purchases, or trigger irreversible actions.

## Web App Search Bars

NEVER click the browser address bar to search within a web app. Use the app's own search:
- Gmail/Outlook: `/` or `Ctrl+/` for search
- YouTube: `/` for search
- Slack: `Ctrl+K`
- Google Drive: `/` for search
- Most web apps: look for a search icon or `Ctrl+F`

## Search Strategy
To search online: navigate to a search engine, fill the query, press Enter, extract results. You can also use `execute_gui` with an already-open browser. Never tell the user you cannot browse or search online.
