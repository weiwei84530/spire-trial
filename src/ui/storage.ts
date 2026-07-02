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
