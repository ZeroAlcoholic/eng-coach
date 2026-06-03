// The Gemini key lives in this device's localStorage — the whole point of Path B
// (personal use, your own key, capped budget). Shared by every tool in the folder.

const STORAGE_KEY = "gemini_api_key";

export function getApiKey(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

export function setApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key.trim());
}
