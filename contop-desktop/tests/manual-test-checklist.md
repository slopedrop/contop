# Desktop GUI Application Shell — Manual Test Checklist

**Story:** 1.8 — Desktop GUI Application Shell
**Prerequisites:** Rust toolchain installed, `GEMINI_API_KEY` env var set, `uv` installed

## Test Cases

### 1. App Launch — Initial State
- [ ] App window opens with title "Contop"
- [ ] Status shows "Stopped" with gray dot
- [ ] "Start Server" button is enabled
- [ ] "Stop Server" button is disabled
- [ ] QR placeholder text reads "Start the server to generate a pairing QR code"
- [ ] No QR image is visible

### 2. Start Server — Status Transitions
- [ ] Click "Start Server"
- [ ] Status immediately changes to "Starting" with amber dot
- [ ] "Start Server" button becomes disabled
- [ ] After a few seconds, status changes to "Running" with green dot
- [ ] "Stop Server" button becomes enabled

### 3. QR Code Display
- [ ] QR code image appears in the window after reaching "Running" state
- [ ] QR code is rendered as a high-resolution image (not ASCII text)
- [ ] QR code has white background padding for readability
- [ ] Placeholder text is hidden while QR code is displayed

### 4. Stop Server
- [ ] Click "Stop Server"
- [ ] QR code image disappears
- [ ] Placeholder text reappears
- [ ] Status returns to "Stopped" with gray dot
- [ ] "Stop Server" button becomes disabled
- [ ] "Start Server" button becomes enabled

### 5. Window Close While Running
- [ ] Start the server (wait for "Running" status)
- [ ] Close the application window
- [ ] Open Task Manager / `tasklist` / `ps aux`
- [ ] Verify no orphaned `uvicorn` or `python` processes remain

### 6. No Orphaned Processes After Close
- [ ] Start server, wait for Running
- [ ] Close the application
- [ ] Run `tasklist | findstr uvicorn` (Windows) or `ps aux | grep uvicorn` (macOS/Linux)
- [ ] Confirm zero matching processes

### 7. Missing GEMINI_API_KEY
- [ ] Unset `GEMINI_API_KEY` environment variable
- [ ] Launch the app and click "Start Server"
- [ ] Server starts but QR code fetch fails
- [ ] Error message is displayed in the QR area or error status shown

### 8. Restart Cycle
- [ ] Click "Start Server" — wait for "Running"
- [ ] Click "Stop Server" — wait for "Stopped"
- [ ] Click "Start Server" again — verify it reaches "Running" again
- [ ] QR code appears on second start
- [ ] Click "Stop Server" — verify clean stop

---

## Story 1.9 — Settings Persistence & Configuration Panel

### 9. First Launch — Default Settings Creation
- [ ] Delete `~/.contop/settings.json` if it exists
- [ ] Launch the app
- [ ] Verify `~/.contop/settings.json` is created with default restricted paths and forbidden commands

### 10. Settings Panel — Open/Close
- [ ] Click the gear icon in the header
- [ ] Verify the main view (status, QR, controls) is hidden and settings panel is shown
- [ ] Click the gear icon again
- [ ] Verify the settings panel is hidden and main view is restored

### 11. Settings Panel — Display Defaults
- [ ] Open Settings panel
- [ ] Verify default restricted paths are listed (e.g., `/root`, `C:\Windows\System32`)
- [ ] Verify default forbidden commands are listed (e.g., `rm -rf /`, `mkfs`)

### 12. Add Restricted Path
- [ ] Open Settings panel
- [ ] Type a new path in the input field and click "Add"
- [ ] Verify the new path appears in the list

### 13. Remove Restricted Path
- [ ] Click "Remove" next to a restricted path
- [ ] Verify the path disappears from the list

### 14. Add Forbidden Command
- [ ] Type a new command in the input field and click "Add"
- [ ] Verify the new command appears in the list

### 15. Remove Forbidden Command
- [ ] Click "Remove" next to a forbidden command
- [ ] Verify the command disappears from the list

### 16. Save Settings
- [ ] Make changes (add/remove paths or commands)
- [ ] Click "Save"
- [ ] Verify "Settings saved" status message appears
- [ ] Open `~/.contop/settings.json` and verify the changes are persisted

### 17. Settings Persistence Across Panel Toggle
- [ ] Close and reopen the Settings panel
- [ ] Verify the saved values are still displayed

### 18. Restore Defaults
- [ ] Click "Restore Defaults"
- [ ] Verify lists reset to defaults
- [ ] Verify "Defaults restored" status message appears

### 19. Corrupted Settings Recovery
- [ ] Close the app
- [ ] Write invalid JSON to `~/.contop/settings.json`
- [ ] Launch the app and open Settings panel
- [ ] Verify defaults are restored

### 20. Settings Accessible When Server Stopped
- [ ] With server stopped, open Settings panel
- [ ] Verify settings load and display correctly (no server dependency)

### 21. View Toggle Correctness
- [ ] Toggle between main view and settings view multiple times
- [ ] Verify both views render correctly each time

## Environment Notes

- **Windows:** `npm run tauri dev` from `contop-desktop/`
- **macOS/Linux:** Same command, ensure Rust and Node.js are installed
- **Port override:** Set `CONTOP_PORT` env var before launching
