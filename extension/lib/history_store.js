export const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const HISTORY_MAX_ENTRIES = 200;

const STORAGE_KEY = "history";

export async function addHistory({ mode, category, title, text }) {
  if (!text || !text.trim()) return undefined;

  const entry = {
    ts: Date.now(),
    mode,
    category,
    title,
    text,
  };

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const current = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];

  const cutoff = Date.now() - HISTORY_RETENTION_MS;
  const updated = [entry, ...current]
    .filter((item) => item.ts >= cutoff)
    .slice(0, HISTORY_MAX_ENTRIES);

  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
  return entry;
}

export async function listHistory() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const entries = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];

  const cutoff = Date.now() - HISTORY_RETENTION_MS;
  return entries.filter((item) => item.ts >= cutoff);
}

export async function clearHistory() {
  await chrome.storage.local.remove(STORAGE_KEY);
}
