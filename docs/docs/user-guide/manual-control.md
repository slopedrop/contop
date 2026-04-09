---
sidebar_position: 5
---

# Manual Control

Switch to manual control mode when you want to directly operate your desktop remotely, like a traditional remote desktop client.

## Activating Manual Control

Toggle manual control from the session screen. When active, the AI execution bar is replaced with manual control overlay elements.

`[SCREENSHOT: Manual control overlay]`

## Controls

### Virtual Joystick

A floating joystick for cursor movement. Drag to move the mouse cursor on your desktop in real time. Mouse movement events are sent over the unreliable WebRTC data channel (`contop-fast`) for minimal latency.

### Click Buttons

- **Left click** - Tap the L button
- **Right click** - Tap the R button
- **Long press** - Press and hold the L button to initiate a drag operation (sends `mouse_down` on press, `mouse_up` on release)

### Scroll

- **Pinch gesture** - Pinch on the video feed to zoom (video zoom, not desktop scroll)
- **Scroll controls** - Dedicated scroll buttons with 5 clicks per event
- **Long press scroll** - Hold a scroll button for continuous scrolling (250ms delay, 80ms repeat interval, haptic feedback)

### Keyboard Grid

Quick-access keyboard shortcuts:

- **Esc**, **Tab**, **Enter**, **Backspace**, **Delete**
- **Arrow keys** (Up, Down, Left, Right)
- **Modifier combos** (Ctrl+C, Ctrl+V, Ctrl+Z, Ctrl+S)

### Quick Actions

Context-aware suggested actions appear as buttons (max 4 at a time) based on what's visible on screen.

## Coordinate System

Manual control coordinates are captured in screenshot-space and automatically scaled to native screen coordinates using the `_scale()` function. This ensures accurate cursor positioning at all zoom levels and screen resolutions.

## When to Use Manual vs AI

| Use Manual Control | Use AI Execution |
|-------------------|-----------------|
| Precise cursor positioning | Multi-step tasks |
| Gaming or drawing | File operations |
| Password entry | Complex workflows |
| Quick single clicks | Search and navigation |
| Browsing with scrolling | Data processing |

---

**Related:** [Mobile App](/user-guide/mobile-app) · [Agent Execution](/user-guide/agent-execution) · [Vision Routing](/architecture/vision-routing)
