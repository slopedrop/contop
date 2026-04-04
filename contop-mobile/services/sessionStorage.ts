import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SessionMeta, ExecutionEntry } from '../types';

const SESSION_INDEX_KEY = '@contop:session_index';
const sessionEntriesKey = (id: string) => `@contop:session:${id}:entries`;

export async function loadSessionIndex(): Promise<SessionMeta[]> {
  const raw = await AsyncStorage.getItem(SESSION_INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SessionMeta[];
  } catch {
    return [];
  }
}

export async function upsertSessionMeta(meta: SessionMeta): Promise<void> {
  const existing = await loadSessionIndex();
  const idx = existing.findIndex((s) => s.id === meta.id);
  if (idx >= 0) {
    existing.splice(idx, 1); // remove from current position
  }
  existing.unshift(meta); // always prepend — most recently updated first
  await AsyncStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(existing));
}

/** Regex to match base64-encoded image data in JSON strings (JPEG/PNG data URIs or raw b64). */
const B64_IMAGE_RE = /("(?:image_b64|raw_image_b64)"\s*:\s*")(?:[A-Za-z0-9+/=]{200,})(")/g;

/** Track whether storage is full to avoid repeated write attempts. */
let _storageFull = false;

export function isStorageFull(): boolean {
  return _storageFull;
}

export async function saveSessionEntries(sessionId: string, entries: ExecutionEntry[]): Promise<void> {
  if (_storageFull) return; // Skip writes until emergency cleanup runs
  // Strip large base64 screenshot data before persisting — screenshots are
  // only needed for live display, not session history.  Without this,
  // multi-step tasks with many observe_screen calls fill up SQLite (~300-500 KB each).
  const stripped = entries.map((e) => {
    let entry = e;
    // Strip image_b64 / raw_image_b64 from metadata (agent_progress entries)
    if (entry.metadata && ('image_b64' in entry.metadata || 'raw_image_b64' in entry.metadata)) {
      const { image_b64, raw_image_b64, ...rest } = entry.metadata as Record<string, unknown>;
      entry = { ...entry, metadata: rest };
    }
    // Strip base64 images from stringified JSON in content (tool_result entries)
    if (entry.content && entry.content.length > 1000 && entry.content.includes('image_b64')) {
      entry = { ...entry, content: entry.content.replace(B64_IMAGE_RE, '$1[stripped]$2') };
    }
    return entry;
  });
  try {
    await AsyncStorage.setItem(sessionEntriesKey(sessionId), JSON.stringify(stripped));
  } catch (err) {
    if (String(err).includes('SQLITE_FULL') || String(err).includes('disk is full')) {
      console.warn('[sessionStorage] Storage full — running emergency cleanup');
      _storageFull = true;
      await emergencyClearEntries();
      _storageFull = false;
      // Retry once after cleanup
      try {
        await AsyncStorage.setItem(sessionEntriesKey(sessionId), JSON.stringify(stripped));
      } catch {
        // Give up silently — session data is expendable
      }
    }
  }
}

export async function loadSessionEntries(sessionId: string): Promise<ExecutionEntry[]> {
  const raw = await AsyncStorage.getItem(sessionEntriesKey(sessionId));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ExecutionEntry[];
  } catch {
    return [];
  }
}

export async function finalizeSession(id: string, endTime: number): Promise<void> {
  const index = await loadSessionIndex();
  const meta = index.find((s) => s.id === id);
  if (meta) {
    await upsertSessionMeta({ ...meta, endTime });
  }
}

export async function deleteSession(id: string): Promise<void> {
  const index = await loadSessionIndex();
  const filtered = index.filter((s) => s.id !== id);
  await AsyncStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(filtered));
  await AsyncStorage.removeItem(sessionEntriesKey(id));
}

/** Maximum number of sessions to keep. Oldest sessions are pruned on save. */
const MAX_SESSIONS = 20;

/**
 * Prune old sessions beyond MAX_SESSIONS and clear any corrupted/oversized entries.
 * Called on app startup to prevent gradual storage bloat.
 */
export async function pruneOldSessions(): Promise<void> {
  try {
    const index = await loadSessionIndex();
    if (index.length <= MAX_SESSIONS) return;
    // Remove oldest sessions (index is sorted newest-first)
    const toRemove = index.slice(MAX_SESSIONS);
    const toKeep = index.slice(0, MAX_SESSIONS);
    await AsyncStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(toKeep));
    await Promise.all(
      toRemove.map((s) => AsyncStorage.removeItem(sessionEntriesKey(s.id))),
    );
  } catch {
    // Non-critical — don't crash the app if pruning fails
  }
}

/**
 * Emergency cleanup: clear all session data when storage is full.
 * Keeps only the session index (lightweight) and removes all entry data.
 */
export async function emergencyClearEntries(): Promise<void> {
  try {
    const index = await loadSessionIndex();
    await Promise.all(
      index.map((s) => AsyncStorage.removeItem(sessionEntriesKey(s.id))),
    );
    // Reset entry counts so the UI doesn't show stale counts
    const reset = index.map((s) => ({ ...s, entryCount: 0 }));
    await AsyncStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(reset));
  } catch {
    // Last resort: wipe everything
    await AsyncStorage.clear();
  }
}
