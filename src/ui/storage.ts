/** localStorage persistence layer. Engine stays browser-free; only the UI uses this. */
import type { RunSave } from '../engine/run';

const KEY = 'cardgame_save_v1';

export function saveRun(save: RunSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Storage full or unavailable: playing without persistence is fine.
  }
}

export function loadRun(): RunSave | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as RunSave;
    if (data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Wipes every key this game owns (save, locale, future settings). */
export function clearAllData(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('cardgame')) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
