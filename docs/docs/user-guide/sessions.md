---
sidebar_position: 6
---

# Sessions

Contop persists your interaction history across app restarts so you can review past sessions and resume context.

## Session Persistence

Sessions are stored on-device using AsyncStorage:

- **Session index** - Metadata array at `@contop:session_index` (session ID, name, timestamp, entry count, model used, connection type, tool stats)
- **Session entries** - Per-session entries at `@contop:session:${id}:entries`

### Storage Optimizations

- **Base64 image stripping** - Screenshots (`image_b64` metadata) are removed before persisting to prevent storage bloat (each screenshot is 300–500 KB)
- **Write debouncing** - Persistence writes are debounced at 500ms intervals to avoid excessive I/O
- **Max 20 sessions** - Oldest sessions are pruned automatically on startup
- **Emergency storage** - A `_storageFull` flag prevents cascading writes when storage is nearly full. `emergencyClearEntries()` can nuke entry data while keeping the session index

## Session History

Access past sessions from the session menu. The history viewer supports:

- **Search** - Filter sessions by name, date range (Today, This Week, All), or model used
- **Session cards** - Shows title, date, entry count, and a preview of the first message
- **Resume** - Tap a session to view its full execution thread

### What Gets Restored

When reopening a past session, only `user_message` and `ai_response` entries are reconstructed. Tool calls, tool results, and progress updates are not restored (they reference ephemeral server state).

## Active Session

Only one session can be active at a time (enforced in the Zustand store). Starting a new conversation creates a new session. The active session receives all incoming data channel messages and execution updates.

---

**Related:** [Mobile App](/user-guide/mobile-app) · [State Management](/architecture/state-management) · [Data Channel Protocol](/api-reference/data-channel-protocol)
